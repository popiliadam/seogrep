import { getServiceClient, type Database, type Json } from "../db.ts";
import type { SerpKeywordRow, SerpPlacement } from "../dfs/serp.ts";

/**
 * The WRITE half of the rank tracker: one `keyword_position_measurements` row (migration 0030) per
 * keyword measured by `serp_snapshot`, in the shape `keyword_positions` already reads back
 * (tools/keyword-positions-store.ts).
 *
 * THE IMPORT FROM dfs/serp.ts IS TYPE-ONLY, and that is load-bearing rather than tidy. A VALUE
 * import would make this module reach `reserveSpend` transitively, and the vendor-spend import
 * graph (credits/paid-balance.graph.test.ts) would then flag it as a spender — which it is not: it
 * writes rows, it cannot buy anything. tools/serp-devices.ts's header records the same lesson from
 * the other direction.
 *
 * =====================================================================================
 * WHAT THE THREE OUTCOMES BECOME ON DISK
 * =====================================================================================
 * The port keeps `ranked` / `absent_from_examined_results` / `not_measured` apart with a
 * discriminated union and 0030 keeps them apart with a `status` column plus seven CHECKs. This
 * module is the ONE place the union is turned into the column, so the mapping is stated once:
 *
 *   ranked                       -> organic_items_examined = the counted items (>= 1 by
 *                                   construction: a placement came out of them),
 *                                   not_measured_reason NULL,
 *                                   best_rank_* = the BEST placement's, either of which may be
 *                                   NULL because the vendor may withhold either scale.
 *   absent_from_examined_results -> organic_items_examined = the counted items (0 is legitimate:
 *                                   an empty SERP), best_rank_* NULL, reason NULL.
 *   not_measured                 -> organic_items_examined NULL (nothing was counted),
 *                                   best_rank_* NULL, not_measured_reason = the port's reason.
 *
 * NOTHING IS CLAMPED TO FIT A CHECK. `best_rank_group <= organic_items_examined` holds because the
 * port measures one page from the top, so a response that breaks it is a response whose ranks do
 * not describe the results it returned — and the honest answer is a rejected INSERT that the caller
 * sees, not a rank quietly moved to make a row storable. See {@link writeSerpMeasurements} for what
 * a rejection costs the tenant (nothing).
 */

/**
 * How many placements one stored row keeps.
 *
 * A domain can appear more than once on one SERP, and at the pinned depth of 100 the theoretical
 * ceiling is 100 placements of one domain in one row. Nothing in a vendor payload is bounded by
 * anything this product controls (0024:28-32 / 0027's rule), so the list is CAPPED and the two
 * counters sit ABOVE it: `placements_found` is the pre-cap truth and never moves, `placements_stored`
 * is what the document really holds. A reader comparing the two learns that it is looking at a
 * projection, from O(1) fields, without walking the array.
 *
 * 20 rather than a larger number because the COLUMNS carry everything a series is read by: the rank
 * that matters is `best_rank_group`, lifted out before this cap is applied, and the list is here for
 * a human opening one measurement. A domain occupying more than twenty organic results of one page
 * is a finding in itself, and the counter above the list is what states it.
 */
export const MAX_STORED_PLACEMENTS = 20;

/** The vendor's own account of the page, kept beside the placements it came with. */
export interface StoredVendorPage {
  readonly check_url: string | null;
  readonly se_results_count: number | null;
  readonly item_types: readonly string[];
  /** The keyword the vendor echoed. NEVER back-filled from the request — the port's rule. */
  readonly echoed_keyword: string | null;
}

/**
 * One row's `report` jsonb. Counters first, then the capped list, then what the vendor said about
 * the page. The `means` sentences the port ships are deliberately NOT stored: they are derivable
 * from `status` and `organic_items_examined`, and storing prose would make a second surface parse
 * English to learn what a row meant (0030's header).
 */
export interface StoredMeasurementReport {
  /** Placements the port found, BEFORE the cap. The claim the row makes about the SERP. */
  readonly placements_found: number;
  /** Placements this document really holds. Equal to `placements_found` until the cap bites. */
  readonly placements_stored: number;
  readonly placements: readonly SerpPlacement[];
  readonly vendor_page: StoredVendorPage;
}

/** The placements of an outcome — empty for the two outcomes that found none. */
function placementsOf(row: SerpKeywordRow): readonly SerpPlacement[] {
  return row.outcome.status === "ranked" ? row.outcome.placements : [];
}

/**
 * THE BEST PLACEMENT — the one whose two ranks are lifted into the columns, chosen BEFORE the cap
 * so a stored `best_rank_group` is the best of everything found rather than the best of what fitted.
 *
 * BEST means LOWEST `rank_group`, because that is the organic scale a series is read on. Two
 * fallbacks follow, and both exist because the vendor may withhold either scale (SerpPlacement
 * carries `rank_group: number | null` beside `rank_absolute: number | null`):
 *
 *   - no placement carries a rank_group -> the lowest `rank_absolute`, which is the only number the
 *     vendor gave. The row then stores a NULL organic rank beside a real absolute one, which 0030
 *     stores on purpose and keyword-positions-format.ts prints as its own sentence.
 *   - no placement carries either -> the first placement the vendor sent. "Found, and the vendor did
 *     not say where" is a real reading, and it needs a placement to carry the row's report.
 *
 * The two columns always come from ONE placement, never from two: `best_rank_absolute` is THAT
 * placement's absolute rank (0030's wording), not the lowest absolute rank on the page.
 */
export function bestPlacement(
  placements: readonly SerpPlacement[],
): SerpPlacement | null {
  const lowestBy = (read: (placement: SerpPlacement) => number | null): SerpPlacement | null => {
    let best: SerpPlacement | null = null;
    for (const placement of placements) {
      const rank = read(placement);
      if (rank === null) continue;
      // Strictly less than: ties keep the placement the vendor sent first.
      if (best === null || rank < (read(best) as number)) best = placement;
    }
    return best;
  };
  return (
    lowestBy((placement) => placement.rank_group) ??
    lowestBy((placement) => placement.rank_absolute) ??
    placements[0] ??
    null
  );
}

/** Build one row's report (pure). The counters are PRE-cap, so truncation never changes a claim. */
export function measurementReport(row: SerpKeywordRow): StoredMeasurementReport {
  const placements = placementsOf(row);
  const stored = placements.slice(0, MAX_STORED_PLACEMENTS);
  return {
    placements_found: placements.length,
    placements_stored: stored.length,
    placements: stored,
    vendor_page: {
      check_url: row.observed.vendor_check_url,
      se_results_count: row.observed.vendor_se_results_count,
      item_types: row.observed.vendor_item_types,
      echoed_keyword: row.observed.vendor_echoed_keyword,
    },
  };
}

/**
 * The report as a `jsonb` value — a ROUND TRIP rather than a cast, for dfs/keyword-runs.ts's third
 * reason, which applies here with full force: `vendor_metrics` is whatever DataForSEO sent, carried
 * verbatim, so a widened parser is one commit away from putting a value in there that changes shape
 * or vanishes on the wire. `JSON.stringify` is exactly the transformation PostgREST is about to
 * apply, so what is type-checked here is what is stored.
 */
export function measurementReportToJson(report: StoredMeasurementReport): Json {
  return JSON.parse(JSON.stringify(report)) as Json;
}

/** Everything a batch of measurement rows is keyed by. */
export interface SerpMeasurementTarget {
  readonly userId: string;
  /**
   * NULL for a bare-target snapshot of a domain that is nobody's project. `user_id` is then the
   * row's only tenant column and its only parent — 0030 states the cost of that in its own words.
   */
  readonly projectId: string | null;
}

type MeasurementInsert = Database["public"]["Tables"]["keyword_position_measurements"]["Insert"];

/** ONE measurement row, from ONE port row (pure — exercised without a database). */
export function measurementRow(
  target: SerpMeasurementTarget,
  row: SerpKeywordRow,
): MeasurementInsert {
  const { measurement, observed, outcome } = row;
  const best = outcome.status === "ranked" ? bestPlacement(outcome.placements) : null;
  return {
    user_id: target.userId,
    project_id: target.projectId,
    keyword: measurement.keyword,
    target_domain: measurement.target_domain,
    location_name: measurement.location_name,
    language_code: measurement.language_code,
    device: measurement.device,
    search_engine: measurement.search_engine,
    depth_requested: measurement.depth_requested,
    domain_match_rule: measurement.domain_match_rule,
    status: outcome.status,
    // A rank exists ONLY on a ranked row, and both come from the SAME placement.
    best_rank_group: best === null ? null : best.rank_group,
    best_rank_absolute: best === null ? null : best.rank_absolute,
    // Present IFF something was examined — the equivalence 0030's first CHECK asserts.
    organic_items_examined:
      outcome.status === "not_measured" ? null : outcome.organic_items_examined,
    // …and its mirror: a reason IFF nothing was measured.
    not_measured_reason: outcome.status === "not_measured" ? outcome.reason : null,
    // Both or neither — the port sets the pair together, and 0030 refuses an unpaired row.
    vendor_reported_time_field: observed.vendor_reported_time_field,
    vendor_reported_time_value: observed.vendor_reported_time_value,
    // OUR clock, the series axis. Never the vendor's, which travels above under its own names.
    fetched_at: observed.fetched_at,
    report: measurementReportToJson(measurementReport(row)),
  };
}

/** The write itself — injectable so a spec can make it fail without breaking a database. */
export type SerpMeasurementWriter = (
  target: SerpMeasurementTarget,
  rows: readonly SerpKeywordRow[],
) => Promise<void>;

/**
 * Record every measurement of one snapshot.
 *
 * ONE INSERT FOR THE WHOLE SNAPSHOT, not one per keyword, and the reason is the failure shape
 * rather than the round trip count. PostgREST sends an array as a single statement, so a row that
 * violates one of 0030's CHECKs rejects the BATCH: either the whole snapshot is stored or none of
 * it is. Row-at-a-time writes would leave the first k keywords stored and then throw — and because
 * the throw releases the reserve (below), the tenant would keep k measurements they were not
 * charged for, which is the one outcome worse than losing all of them.
 *
 * FAIL-CLOSED, the family contract (0024/0025/0026/0027/0029 and dfs/keyword-runs.ts): a PostgREST
 * error is re-thrown, never logged and swallowed. The caller runs inside `withCredits`, which
 * COMMITS a handler that returns and RELEASES one that throws — so throwing means the tenant pays
 * NOTHING for a snapshot whose record was lost. Swallowing would produce the opposite and worse
 * shape: a charged tenant, a delivered answer, and a `keyword_positions` that says forever that the
 * keyword was never measured.
 */
export async function writeSerpMeasurements(
  target: SerpMeasurementTarget,
  rows: readonly SerpKeywordRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getServiceClient()
    .from("keyword_position_measurements")
    .insert(rows.map((row) => measurementRow(target, row)));
  if (error) {
    throw new Error(
      `serp_snapshot: keyword_position_measurements write failed (${error.message})`,
    );
  }
}
