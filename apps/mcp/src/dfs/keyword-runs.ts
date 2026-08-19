import { getServiceClient, type Database, type Json } from "../db.ts";
import type { KeywordOverviewRow } from "./client.ts";

/**
 * The KEYWORD RESEARCH RUN LEDGER (migration 0029): one row per research_keywords call that
 * delivered.
 *
 * The FIFTH sibling of `audit/runs.ts` (0024), `gsc-data/runs.ts` (0025),
 * `tools/audit-content-runs.ts` (0026) and `dfs/runs.ts` (0027) — and the one 0027 explicitly did
 * not take, because its subject is a keyword LIST rather than a domain and it had nothing to put
 * in a column called `target`. 0029 gives it a table whose columns are true of a keyword-set
 * lookup, and this module is its write half. research_keywords costs 25 credits (NEVER #6 —
 * unchanged here), returns a table inside the request and, until now, vanished.
 *
 * WHY THIS MODULE LIVES UNDER `dfs/` rather than `tools/`: `runs.ts`'s reason, unchanged. It is
 * the write half of the DFS family and sits beside `dfs/budget.ts`, the other DB-backed module in
 * this directory, under the constitution's SIGNED NEVER #5 exception (audit L-04, human sign-off
 * 2026-08-03) that keeps the DataForSEO adapters here. Nothing in this file talks to DataForSEO:
 * it talks to the SHAPE `client.ts` returns.
 *
 * WHAT IS STORED IS THE STRUCTURAL RESULT, not the rendered text — the family rule for the fifth
 * time. `formatKeywordOverview`'s sentences are for a human and free to change; the numbers under
 * them are what a second surface can query.
 */

/**
 * The row cap on the stored keyword list.
 *
 * 100 rather than 0027's MAX_RUN_ROWS = 50, and the difference is argued in 0029's header rather
 * than copied: nothing bounds a ranked_keywords answer (up to 1000 rows, ~120 KB), while
 * research_keywords' own input schema is `.max(100)` — so the payload here is bounded at ~100
 * small rows by construction, the same size class as a 50-row ranked_keywords report, and the
 * whole answer is what the tenant paid 25 credits for.
 *
 * It is a CONSTANT that happens to equal today's input ceiling and does NOT track it. The day a
 * signed decision widens the tool to 200 keywords, the stored payload stays at 100 — which is
 * exactly the property that makes this a cap rather than a restatement of the schema. The
 * headline counters below are always PRE-cap, so truncating the list never changes what the row
 * claims about the run.
 */
export const MAX_KEYWORD_RUN_ROWS = 100;

/** The locale a lookup ran under. Every run has one — see 0029 on why it is not a column. */
export interface KeywordRunLocale {
  readonly language_code: string;
  readonly location_code: number;
}

/**
 * research_keywords' report.
 *
 * THE FOUR COUNTERS ARE FOUR DIFFERENT FACTS and they are stored separately on purpose, because
 * collapsing them is how a coverage change gets printed as a demand change:
 *
 *   requested — how many keywords the CALLER passed, before normalization;
 *   subject   — how many DISTINCT keywords the run is about (= keyword_set's length);
 *   returned  — how many rows the vendor sent back;
 *   answered  — how many of those carried any metric at all (`has_data`).
 *
 * `requested` > `subject` exactly when the caller repeated or re-cased a keyword; `subject` >
 * `returned` when the vendor answered for fewer keywords than were asked about. The panel folds
 * `answered` into its comparison key so that two runs of the same set with different coverage are
 * never subtracted from each other.
 */
export interface KeywordResearchRunReport {
  readonly locale: KeywordRunLocale;
  /**
   * Total monthly searches across the returned rows — the number the tool's own first sentence
   * prints, and the O(1) headline the panel reads as `report->total`.
   *
   * OUR OWN SUM, so unlike `RankedKeywordsRunReport.total` it is never nullable and nothing about
   * it comes from a single vendor field (`CompetitorsRunReport.total` carries the same honesty
   * note). A keyword with no volume contributes nothing; the per-row nulls survive VERBATIM in
   * `rows` below, where "the vendor did not say" stays distinguishable from "zero searches".
   */
  readonly total: number;
  /** Keywords the CALLER passed, before normalization — see the four-counters note above. */
  readonly requested: number;
  /** Distinct keywords the run is about: the length of the `keyword_set` column. */
  readonly subject: number;
  /** Rows the vendor RETURNED, before MAX_KEYWORD_RUN_ROWS. `rows` may be shorter; this never is. */
  readonly returned: number;
  /** Of those, how many carried metrics. Coverage — and half of the panel's comparison key. */
  readonly answered: number;
  /**
   * The highest-volume keyword the vendor had data for, or null when it had data for none.
   * Duplicated out of `rows` so the panel never downloads the list (0025's DiscoverySummary case).
   *
   * TIES GO TO THE ROW THE VENDOR SENT FIRST — stated because it is arbitrary, not because it is
   * meaningful. `cpc` and `keyword_difficulty` stay NULL when the vendor sent none: 0 is a price
   * and a difficulty, and neither is what "we do not know" means.
   */
  readonly top: {
    readonly keyword: string;
    readonly search_volume: number | null;
    readonly cpc: number | null;
    readonly competition_level: string | null;
    readonly keyword_difficulty: number | null;
  } | null;
  /** The first MAX_KEYWORD_RUN_ROWS rows, VERBATIM. The counters above are the pre-cap numbers. */
  readonly rows: readonly KeywordOverviewRow[];
}

/**
 * The normalized keyword set a run is ABOUT — 0029's identity column, derived here and nowhere
 * else.
 *
 * trim → collapse internal whitespace runs to one space → lowercase → drop blanks → dedupe →
 * sort ascending. 0029's header argues each step; the two that change what a "run" means:
 *
 *   ORDER IS DROPPED, so the same forty keywords typed in a different order are the same subject.
 *   CASE IS DROPPED, because DataForSEO's keyword_overview echoes keywords lowercased (measured on
 *   the repo's own captured response fixture), so "SEO Tools" and "seo tools" are one row on the
 *   vendor's side and keeping them apart here would split one subject into two.
 *
 * BLANKS ARE DROPPED rather than kept as "": a keyword that is only whitespace identifies nothing
 * and would be a member of the set that no vendor row can ever correspond to. An input of nothing
 * BUT blanks therefore normalizes to the empty array — which the tool refuses before the credit
 * reserve, free of charge, because 0029's CHECK would otherwise reject a call the caller had
 * already been served.
 *
 * PURE and exported so the identity is testable without a database.
 */
export function normalizeKeywordSet(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of keywords) {
    const normalized = raw.trim().replace(/\s+/g, " ").toLowerCase();
    if (normalized.length > 0) seen.add(normalized);
  }
  return [...seen].sort();
}

/** The first MAX_KEYWORD_RUN_ROWS rows, verbatim. */
function capRows(rows: readonly KeywordOverviewRow[]): readonly KeywordOverviewRow[] {
  return rows.slice(0, MAX_KEYWORD_RUN_ROWS);
}

/**
 * The highest-volume row the vendor had DATA for.
 *
 * `has_data` gates it rather than `search_volume !== null`, and the two differ: the vendor returns
 * an item for a keyword it knows nothing about, and `client.ts`'s own type comment says folding
 * that into a number is how "we hold no figure" became "nobody searches it". A no-data row can
 * never be the headline of a run.
 */
function headlineRow(rows: readonly KeywordOverviewRow[]): KeywordOverviewRow | null {
  let best: KeywordOverviewRow | null = null;
  for (const row of rows) {
    if (!row.has_data || row.search_volume === null) continue;
    // Strictly greater: ties keep the row the vendor sent first (see the field's note).
    if (best === null || row.search_volume > (best.search_volume ?? -1)) best = row;
  }
  return best;
}

/**
 * Build research_keywords' report from the rows the FORMATTER is about to render (pure).
 *
 * The rows are passed in rather than re-fetched, and here that is not tidiness: a second fetch
 * would be a second PAID vendor call, and a second measurement that merely resembles the one the
 * caller was shown.
 */
export function keywordResearchRunReport(
  rows: readonly KeywordOverviewRow[],
  query: {
    /** The caller's raw keyword argument — its LENGTH is `requested`, before normalization. */
    readonly keywords: readonly string[];
    /** The normalized set the row is keyed by; its length is `subject`. */
    readonly keywordSet: readonly string[];
  } & KeywordRunLocale,
): KeywordResearchRunReport {
  const best = headlineRow(rows);
  return {
    locale: { language_code: query.language_code, location_code: query.location_code },
    // `?? 0` on a per-row null adds nothing and is the same arithmetic the tool's own header
    // explains at length. The null itself is NOT flattened — it survives in `rows` below.
    total: rows.reduce((sum, row) => sum + (row.search_volume ?? 0), 0),
    requested: query.keywords.length,
    subject: query.keywordSet.length,
    returned: rows.length,
    answered: rows.filter((row) => row.has_data).length,
    top:
      best === null
        ? null
        : {
            keyword: best.keyword,
            search_volume: best.search_volume,
            cpc: best.cpc,
            competition_level: best.competition_level,
            keyword_difficulty: best.keyword_difficulty,
          },
    rows: capRows(rows),
  };
}

/** Everything one `keyword_research_runs` row is keyed by. */
export interface KeywordResearchRunTarget {
  readonly userId: string;
  /** The NORMALIZED set (normalizeKeywordSet's output), never the caller's raw argument. */
  readonly keywordSet: readonly string[];
}

/** The write itself — injectable so a spec can make it fail without breaking a database. */
export type KeywordResearchRunWriter = (
  target: KeywordResearchRunTarget,
  report: KeywordResearchRunReport,
) => Promise<void>;

type KeywordResearchRunInsert = Database["public"]["Tables"]["keyword_research_runs"]["Insert"];

/**
 * The report as a `jsonb` value.
 *
 * A ROUND TRIP rather than a cast, for `runs.ts`'s three reasons — the third of which applies here
 * with full force: `rows` is stored VERBATIM out of a zod parse of a DataForSEO response, so its
 * concrete field set is whatever the vendor sent, and a widened parser is one commit away from
 * putting a Date, a function or an `undefined` in there — values that change shape or vanish on
 * the wire, silently. `JSON.stringify` is exactly the transformation PostgREST is about to apply,
 * so what is type-checked here is what is stored, whoever authored the fields.
 */
export function keywordResearchReportToJson(report: KeywordResearchRunReport): Json {
  return JSON.parse(JSON.stringify(report)) as Json;
}

/**
 * Record one keyword research run.
 *
 * FAIL-CLOSED, and that is the whole contract (0024/0025/0026/0027's rule): a PostgREST error is
 * re-thrown, never logged and swallowed. The caller runs inside `withCredits`, which COMMITS a
 * handler that returns and RELEASES one that throws — so throwing means the tenant pays NOTHING
 * for a run whose record was lost. Swallowing would produce the opposite and worse shape: a
 * charged tenant, a delivered table, and a panel that will forever say the lookup never ran.
 */
export async function writeKeywordResearchRun(
  target: KeywordResearchRunTarget,
  report: KeywordResearchRunReport,
): Promise<void> {
  const row: KeywordResearchRunInsert = {
    user_id: target.userId,
    keyword_set: [...target.keywordSet],
    report: keywordResearchReportToJson(report),
  };
  const { error } = await getServiceClient().from("keyword_research_runs").insert(row);
  if (error) {
    throw new Error(`research_keywords: keyword_research_runs write failed (${error.message})`);
  }
}
