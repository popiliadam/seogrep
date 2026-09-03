import { getServiceClient } from "../db.ts";
import type { TrackedDevice } from "./serp-devices.ts";

/**
 * The read layer behind `keyword_positions`: the stored SERP measurements for one domain, newest
 * first, and — as a SEPARATE query — how many the filter matches in total.
 *
 * TWO NUMBERS, TWO QUERIES, ON PURPOSE. `windowRowCount` is what came back under the caller's
 * bounds; `storedMeasurementCount` is the whole matching set. The second is NEVER derived from the
 * first: a count taken from the rows in hand is a count of the window, and printing it as the
 * total is how a slice starts advertising itself as a census. It is also why the count uses
 * `head: true` — PostgREST caps a page at 1000 rows with no error, so counting client-side would
 * silently under-report the moment a tenant has a real history.
 *
 * NEVER #4: this client is service-role and bypasses RLS, so both statements carry their own
 * `.eq("user_id", …)`.
 */

/** The three answers a stored measurement can carry — migration 0030's `status` column. */
export type MeasurementStatus = "ranked" | "absent_from_examined_results" | "not_measured";

/** One stored measurement, exactly as the table holds it. Nothing is computed on the way out. */
export interface StoredMeasurement {
  readonly keyword: string;
  readonly targetDomain: string;
  readonly locationName: string;
  readonly languageCode: string;
  readonly device: TrackedDevice;
  readonly searchEngine: string;
  readonly depthRequested: number;
  readonly domainMatchRule: string;
  readonly status: MeasurementStatus;
  readonly bestRankGroup: number | null;
  readonly bestRankAbsolute: number | null;
  readonly organicItemsExamined: number | null;
  readonly notMeasuredReason: string | null;
  readonly vendorReportedTimeField: string | null;
  readonly vendorReportedTimeValue: string | null;
  readonly fetchedAt: string;
  /**
   * What the row's `report` jsonb held, or NULL when nothing readable was stored in it. The
   * distinction carries the whole finding: `null` means NOT RECORDED, and never "there was no URL
   * and no feature on that page".
   */
  readonly report: StoredReportSummary | null;
}

/**
 * The two facts `serp_snapshot` bought from DataForSEO, wrote into `report`, and that nothing in
 * the product could read back (S-1): the ranking page's URL, and the vendor's own list of what
 * else was on that SERP.
 */
export interface StoredReportSummary {
  /** The ranking page's URL, or NULL when the vendor sent that placement without one. */
  readonly rankedUrl: string | null;
  /** DataForSEO's page-level `item_types`, verbatim. Nothing is recognised, so nothing drops. */
  readonly itemTypes: readonly string[];
}

/**
 * READ ONE ROW'S `report` JSONB — defensively, because a jsonb column is not a promise about its
 * shape. Everything in there came from a vendor payload, and the shape this reader knows is
 * `serp-snapshot-store.ts`'s `StoredMeasurementReport` as it stood when the row was written.
 *
 * ANY SHAPE IT CANNOT READ BECOMES `null`, NEVER A THROW. This read runs INSIDE `withCredits`,
 * after the reserve: a throw would release the reserve and refuse an answer the tenant's stored
 * measurements can perfectly well supply, over one malformed document. "Not recorded" is the
 * honest degradation, and the formatter prints it in those words.
 *
 * THE URL IS THE ONE WHOSE RANKS THE COLUMNS LIFTED, matched on `best_rank_group` and, when the
 * vendor withheld the organic scale, on `best_rank_absolute` — the same order `bestPlacement`
 * chose them in on the way out. Anything else would print a URL beside a rank it does not belong
 * to: the report's placement list is the vendor's order, not a ranking, and its first entry is
 * not the row's best.
 */
export function readStoredReport(
  value: unknown,
  bestRankGroup: number | null,
  bestRankAbsolute: number | null,
): StoredReportSummary | null {
  if (!isRecord(value)) return null;
  const page = value.vendor_page;
  // THE GUARD IS ON `vendor_page`, NOT ON THE PLACEMENTS, and that is the honest boundary. A
  // report without it is a shape this reader does not know, and returning an EMPTY feature list
  // for one would print "SERP features besides organic: none reported" — a claim about a page
  // whose features were never written down. Not recorded is not the same as nothing there.
  if (!isRecord(page) || !Array.isArray(page.item_types)) return null;
  const itemTypes = page.item_types.filter((type): type is string => typeof type === "string");
  const placements = Array.isArray(value.placements) ? value.placements.filter(isRecord) : [];
  const match =
    bestRankGroup !== null
      ? placements.find((placement) => placement.rank_group === bestRankGroup)
      : bestRankAbsolute !== null
        ? placements.find((placement) => placement.rank_absolute === bestRankAbsolute)
        : undefined;
  const url = match?.url;
  return { rankedUrl: typeof url === "string" ? url : null, itemTypes };
}

/** True for a plain JSON object — an array and `null` are both `typeof "object"` in JS. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What the caller narrowed the read to. `targetDomain` is the subject; the rest are optional. */
export interface MeasurementFilter {
  readonly targetDomain: string;
  readonly keyword?: string;
  readonly locationName?: string;
  readonly languageCode?: string;
  readonly device?: TrackedDevice;
}

/** The window in hand, and the whole-set count that is deliberately not derived from it. */
export interface MeasurementWindow {
  readonly rows: readonly StoredMeasurement[];
  readonly windowLimit: number;
  readonly windowRowCount: number;
  readonly storedMeasurementCount: number;
}

export type CountMeasurementsFn = (userId: string, filter: MeasurementFilter) => Promise<number>;
export type LoadMeasurementsFn = (
  userId: string,
  filter: MeasurementFilter,
  limit: number,
) => Promise<readonly StoredMeasurement[]>;

/**
 * The columns this reader projects, written as ONE string literal rather than a concatenation.
 * That is not formatting: supabase-js derives the row type from the literal, so a column name that
 * does not exist on the table is a TYPE ERROR here — while a `const COLUMNS = "a, " + "b"` widens
 * to `string`, hands back `GenericStringError`, and forces the cast that would have made a typo
 * invisible until runtime.
 *
 * `report` IS THE ONE NON-SCALAR IN THE LIST, and it is projected on purpose (S-1).
 * `serp_snapshot` writes the ranking URL and DataForSEO's page-level `item_types` into it; this
 * read charges 10 credits and, without the column, could say neither which page ranked nor
 * whether an AI Overview was on it — data that was measured, stored and PAID FOR, and reachable
 * from nowhere in the product. The web Rankings page still skips `report` deliberately
 * (`ranking-history.ts`, "SCALARS ONLY"): it paints a long history in one query, while this read
 * is bounded at 200 rows by its own schema and does not carry that reason.
 */
const COLUMNS =
  "keyword, target_domain, location_name, language_code, device, search_engine, depth_requested, domain_match_rule, status, best_rank_group, best_rank_absolute, organic_items_examined, not_measured_reason, vendor_reported_time_field, vendor_reported_time_value, fetched_at, report" as const;

/**
 * Apply the caller's narrowing. The tenant filter and the subject are NOT optional and are applied
 * by the callers below rather than here, so no future filter object can accidentally drop them.
 */
function narrow<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  filter: MeasurementFilter,
): T {
  let narrowed = query;
  if (filter.keyword !== undefined) narrowed = narrowed.eq("keyword", filter.keyword);
  if (filter.locationName !== undefined) {
    narrowed = narrowed.eq("location_name", filter.locationName);
  }
  if (filter.languageCode !== undefined) {
    narrowed = narrowed.eq("language_code", filter.languageCode);
  }
  if (filter.device !== undefined) narrowed = narrowed.eq("device", filter.device);
  return narrowed;
}

/**
 * How many measurements this filter matches, in total. Runs BEFORE any credit reserve: it is what
 * lets the tool refuse — free — to charge for a read of an empty store.
 */
export const countStoredMeasurements: CountMeasurementsFn = async (userId, filter) => {
  const base = getServiceClient()
    .from("keyword_position_measurements")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("target_domain", filter.targetDomain);
  const { count, error } = await narrow(base, filter);
  if (error) throw new Error(`keyword_position_measurements count failed: ${error.message}`);
  return count ?? 0;
};

/**
 * The window: the newest `limit` measurements matching the filter. Ordered by `fetched_at` — the
 * moment the measurement was taken — and never by `created_at`, which would re-date a row written
 * later than it was measured (migration 0030's three-clocks note).
 */
export const loadStoredMeasurements: LoadMeasurementsFn = async (userId, filter, limit) => {
  const base = getServiceClient()
    .from("keyword_position_measurements")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("target_domain", filter.targetDomain);
  const { data, error } = await narrow(base, filter)
    .order("fetched_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`keyword_position_measurements read failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    keyword: row.keyword,
    targetDomain: row.target_domain,
    locationName: row.location_name,
    languageCode: row.language_code,
    device: row.device as TrackedDevice,
    searchEngine: row.search_engine,
    depthRequested: row.depth_requested,
    domainMatchRule: row.domain_match_rule,
    status: row.status as MeasurementStatus,
    bestRankGroup: row.best_rank_group,
    bestRankAbsolute: row.best_rank_absolute,
    organicItemsExamined: row.organic_items_examined,
    notMeasuredReason: row.not_measured_reason,
    vendorReportedTimeField: row.vendor_reported_time_field,
    vendorReportedTimeValue: row.vendor_reported_time_value,
    fetchedAt: row.fetched_at,
    report: readStoredReport(row.report, row.best_rank_group, row.best_rank_absolute),
  }));
};
