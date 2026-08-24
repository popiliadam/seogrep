import { getServiceClient, type Database, type Json } from "../db.ts";
import type {
  AnchorRow,
  BacklinkProfile,
  BacklinkSummary,
  ReferringDomainRow,
} from "./backlinks.ts";
import type {
  ComparisonRow,
  CompetitorComparison,
  DomainOrganicMetrics,
} from "./competitors.ts";
import type {
  BacklinkChangePoint,
  BacklinkChangesResult,
  BacklinkProfilePoint,
} from "./backlink-changes.ts";
import type {
  BacklinkDetailRow,
  BacklinkDetails,
  TargetPageRow,
} from "./backlink-details.ts";
import type {
  DisavowCandidate,
  DisavowCandidates,
  DisavowCriteria,
  ReferringNetworkRow,
} from "./disavow-candidates.ts";
import type {
  RankedKeywordRow,
  RankedKeywordsResult,
  RankedKeywordsSort,
} from "./ranked-keywords.ts";

/**
 * The DOMAIN LOOKUP RUN LEDGER (migration 0027): one row per DFS domain lookup that delivered.
 *
 * The fourth sibling of `audit/runs.ts` (0024, crawl audits), `gsc-data/runs.ts` (0025, pull
 * analyses) and `tools/audit-content-runs.ts` (0026), and the first for tools that read NO stored
 * measurement at all: they call DataForSEO inside the request, print a table and vanish. The
 * tenant pays and, an hour later, has nothing to look at — the panel cannot show that the lookup
 * ever happened.
 *
 * SEVEN TOOLS write here, not three. 0027 opened the table for ranked_keywords (65),
 * analyze_backlinks (70) and compare_competitors (90); migration 0031 widened its `tool` CHECK to
 * cover backlink_changes (35), backlink_details (35), disavow_candidates (40) and my_pages (40),
 * which shipped afterwards with the identical input shape and the identical amnesia. 0031's header
 * records the test a tool must pass to belong here and names the three DFS tools that still fail
 * it (discover_keywords, ai_visibility, ai_visibility_compare — each of which would have to put a
 * non-domain in `target` on some of its rows).
 *
 * WHY THIS MODULE LIVES UNDER `dfs/` rather than `tools/`. It is the write half of the DFS family
 * and it sits beside `dfs/budget.ts`, the other DB-backed module in this directory, under the
 * constitution's SIGNED NEVER #5 exception (audit L-04, human sign-off 2026-08-03) that keeps the
 * DataForSEO adapters here. Nothing in this file talks to DataForSEO: it talks to the SHAPES the
 * three adapters in this directory return, which is why it belongs with them rather than with the
 * three tool surfaces that share nothing but a table.
 *
 * WHAT IS STORED IS THE STRUCTURAL RESULT, not the rendered text — 0024's, 0025's and 0026's rule
 * for the fourth time. The prose is for a human and its wording is free to change; the numbers
 * underneath are what a second surface can query. Storing the table would force a panel to parse
 * sentences to learn how many keywords a domain ranks for.
 */

/**
 * The row cap on every list a report carries.
 *
 * 0026's MAX_CONTENT_MISMATCHES pattern, and here it is load-bearing rather than tidy: the three
 * siblings persist measurements this system already capped on the way in (MAX_PAGES_PERSISTED,
 * MAX_CONTENT_MISMATCHES), while NOTHING caps a vendor response. A `ranked_keywords` call may ask
 * for RANKED_KEYWORDS_MAX_LIMIT = 1000 rows and a full 1000-row result is ~120 KB of raw vendor
 * JSON — one unbounded row would make this table unbounded, an order of magnitude past anything
 * 0024/0025/0026 store. 0027's header states the rule; this constant IS the rule.
 *
 * The headline counters (`total`, `shown`, every `total_count`) are always the PRE-cap numbers, so
 * capping the list never changes what the row claims about the lookup.
 */
export const MAX_RUN_ROWS = 50;

/** The first MAX_RUN_ROWS of a vendor list, verbatim. Applied to every list, uniformly. */
function capRows<Row>(rows: readonly Row[]): readonly Row[] {
  return rows.slice(0, MAX_RUN_ROWS);
}

/**
 * The locale a lookup ran under.
 *
 * It lives INSIDE the report and not in a column, for 0027's reason: analyze_backlinks' vendor
 * endpoint has no locale parameter at all, so a locale column would be null on a whole third of
 * this table's rows for a reason that has nothing to do with the run.
 */
export interface DomainLookupLocale {
  readonly language_code: string;
  readonly location_code: number;
}

/**
 * ranked_keywords' report.
 *
 * `total` and `top` sit at the TOP level, O(1), and that duplication is the whole point (0025's
 * DiscoverySummary states the same case): PostgREST navigates into jsonb but cannot count an array
 * or take its first element, so a summary living only inside `rows` would cost a full report
 * download per card per render.
 */
export interface RankedKeywordsRunReport {
  readonly locale: DomainLookupLocale;
  /** The ordering the vendor applied across the WHOLE ranked set before truncating to `limit`. */
  readonly sort: RankedKeywordsSort;
  /** How many rows the CALLER asked for — not how many arrived, and not how many are stored. */
  readonly limit: number;
  /**
   * DFS `total_count` — the domain's FULL ranked-keyword count, before the caller's `limit` ever
   * applied. NULL when the vendor sent none, and null is stored as null: "the vendor did not say"
   * and "the domain ranks for nothing" are different answers and 0 would merge them.
   */
  readonly total: number | null;
  /** Rows the tool RECEIVED, before MAX_RUN_ROWS. `rows` below may be shorter; this never is. */
  readonly shown: number;
  /** DFS `items_count` — what the vendor put in the result; it can exceed `shown` (see the tool). */
  readonly items_count: number | null;
  /** The first row as ordered by `sort`, or null on an empty result. Duplicated out of rows[0]. */
  readonly top: {
    readonly keyword: string;
    readonly position: number | null;
    readonly search_volume: number | null;
    readonly url: string | null;
  } | null;
  /** The whole-domain organic health card, flat and O(1) — the panel reads it without the rows. */
  readonly metrics: DomainOrganicMetrics;
  /** The first MAX_RUN_ROWS rows, VERBATIM. `total`/`shown` above are the pre-cap numbers. */
  readonly rows: readonly RankedKeywordRow[];
}

/** A capped list plus both honesty counters: the vendor's total, and what arrived before the cap. */
export interface CappedList<Row> {
  /** DFS `total_count` — the full count before the caller's `limit`; null when absent. */
  readonly total_count: number | null;
  /** Rows RECEIVED, before MAX_RUN_ROWS. */
  readonly shown: number;
  readonly rows: readonly Row[];
}

/**
 * analyze_backlinks' report.
 *
 * NO `locale` KEY AT ALL, and that absence is deliberate rather than forgotten: the vendor query
 * for this tool is exactly `{ target, limit }` (BacklinkProfileQuery, dfs/backlinks.ts) and the
 * three Backlinks API endpoints behind it take no locale parameter. A `locale` here would be an
 * invented field describing a question the endpoint does not ask — recorded so a later reader does
 * not "fix" the omission by copying the other two reports' shape.
 */
export interface BacklinksRunReport {
  /** The per-list row cap the CALLER asked for; it applies to both lists below. */
  readonly limit: number;
  /** Profile-level total backlinks. Null stays null — see RankedKeywordsRunReport.total. */
  readonly total: number | null;
  /** The biggest referring domain, or null when there are none. Duplicated out of the list. */
  readonly top: {
    readonly domain: string;
    readonly backlinks: number | null;
    readonly rank: number | null;
  } | null;
  /** The profile summary, VERBATIM — flat, O(1), and the card the panel shows. */
  readonly summary: BacklinkSummary;
  readonly referring_domains: CappedList<ReferringDomainRow>;
  readonly anchors: CappedList<AnchorRow>;
}

/** compare_competitors' report. */
export interface CompetitorsRunReport {
  readonly locale: DomainLookupLocale;
  /** The discovery row cap the caller asked for. Unused on the supplied-competitors flow. */
  readonly limit: number;
  /** True when the rival set came from a discovery request, false when the caller named them. */
  readonly discovered: boolean;
  /** Discovery's `total_count` — how many rivals the vendor has on record; null when skipped. */
  readonly discovered_total_count: number | null;
  /**
   * How many domains were COMPARED — our own count of the table's rows, so unlike the other two
   * reports' `total` it is never nullable: nothing about it comes from the vendor.
   */
  readonly total: number;
  /**
   * The first NON-TARGET row, or null when the target had no rival at all.
   *
   * HONESTY SHERH — this is NOT "the strongest rival", and nothing here should ever be labelled as
   * one. On a DISCOVERY call it is DataForSEO's own first row (their ordering, which they rank by
   * shared SERPs); on a caller-supplied list it is merely the first domain the caller typed. The
   * `discovered` flag beside it is what tells those two apart, and a reader who ignores that flag
   * will label this field wrongly.
   */
  readonly top: {
    readonly domain: string;
    readonly intersections: number | null;
    readonly etv: number | null;
  } | null;
  /**
   * The compared domains, VERBATIM. Already at most MAX_COMPARED_DOMAINS = 4 by construction, so
   * MAX_RUN_ROWS is a NO-OP here — it is applied anyway, uniformly with the other two reports,
   * because a cap that is skipped where it currently cannot bite is a cap that silently stops
   * existing the day the vendor fan-out widens.
   */
  readonly rows: readonly ComparisonRow[];
}


// =================================================================================================
// THE FOUR TOOLS MIGRATION 0031 ADDED — backlink_changes (35), backlink_details (35),
// disavow_candidates (40), my_pages (40).
//
// They shipped after 0027 and shipped the same way the first three did: synchronous,
// charge:"handler", a table printed inside the request and no trace afterwards. 0031's header
// records the test they had to pass to share this table (`target` is genuinely the normalized
// domain the lookup ran against) and which tools still fail it. What follows is the half 0031
// cannot enforce: WHAT each report's headline counters mean, and the cap on every list.
//
// EVERY ONE OF THESE FOUR REPORTS OBEYS THE SAME TWO RULES AS THE FIRST THREE.
//   1. `total` and `top` sit at the TOP level, O(1), because PostgREST navigates into jsonb but
//      cannot count an array or take its first element — a counter reachable only through a row
//      list costs the panel a whole vendor payload per card per render.
//   2. Every list is capRows'd. That matters MORE here than it did for the first three:
//      backlink_details asks the vendor for up to 700 link rows plus 200 page rows per call, and
//      disavow_candidates for up to 300 links plus 50 networks.
//
// WHAT IS DELIBERATELY NOT STORED: disavow_candidates' `disavow_txt`. It is the rendered BODY of a
// Google-format file — prose with a comment header, produced for a human to paste — and 0027's
// rule is that this column holds the structural result and never the rendered text. Everything
// that file is derived FROM is stored (the criteria and the candidate rows), so it can be rebuilt;
// storing the rendering itself would put a formatting decision beyond the reach of a re-render.
// =================================================================================================

/**
 * backlink_changes' report.
 *
 * NO `locale` KEY — the two Backlinks time-series endpoints take no locale parameter, the same
 * absence BacklinksRunReport records for the same family of endpoints.
 *
 * WHAT `total` IS, and it is the one counter in this file that is neither a vendor number nor a
 * count of a single fetched list by accident. It is OUR count of the NEW/LOST series' buckets, and
 * the PROFILE series' bucket count is carried SEPARATELY as `profile_buckets` rather than added to
 * it. The tool refuses to derive any third number from its two series (SERIES_DO_NOT_RECONCILE_NOTE,
 * tools/backlink-changes.ts) because DataForSEO's own published examples for the two endpoints
 * disagree on the same target and window; a stored `total` that summed them would be exactly the
 * reconciliation the tool declines to print, sitting in a column a panel reads without the note.
 */
export interface BacklinkChangesRunReport {
  /** The bucket size the answer is grouped by, as the RESULT reports it (vendor-echoed). */
  readonly group_range: string;
  /** How many periods back the CALLER asked for. Not how many buckets came back. */
  readonly periods: number;
  /** The window the VENDOR says it answered for; null when it did not name the dates. */
  readonly date_from: string | null;
  readonly date_to: string | null;
  /** OUR count of the NEW/LOST series' buckets, pre-cap. Never a sum across the two series. */
  readonly total: number;
  /** OUR count of the PROFILE series' buckets, pre-cap. Kept apart from `total` on purpose. */
  readonly profile_buckets: number;
  /**
   * The LATEST profile bucket — the newest snapshot of the target's own totals in this answer.
   *
   * MEASURED, not positional: the buckets are stored in the vendor's order and nothing here
   * re-sorts them, so "the last element" would be a claim about an ordering DataForSEO documents
   * nowhere. This is the bucket with the greatest parseable `date`; on a tie the earlier one wins,
   * and a series in which no bucket carries a parseable date yields null rather than a guess.
   */
  readonly top: {
    readonly date: string;
    readonly backlinks: number | null;
    readonly referring_domains: number | null;
  } | null;
  /** The first MAX_RUN_ROWS new/lost buckets. `total` above is the pre-cap count. */
  readonly changes: readonly BacklinkChangePoint[];
  /** The first MAX_RUN_ROWS profile buckets. `profile_buckets` above is the pre-cap count. */
  readonly profile: readonly BacklinkProfilePoint[];
}

/**
 * backlink_details' report.
 *
 * NO `locale` KEY, for BacklinksRunReport's reason: these endpoints have none.
 *
 * WHAT `total` IS: the vendor's `total_count` for the LINK set — its count of the whole live
 * backlink set for this target, which the fetched window is only a slice of. It does NOT move with
 * `limit` or `offset`, and the four parameters that WOULD move it (`mode`, `status_type`,
 * `include_subdomains`, the rank scale) are pinned constants in the adapter rather than caller
 * input, which is what makes two runs of this tool against the same target comparable at all.
 * Null stays null: "the vendor did not say" is not "there are none" (NEVER #7).
 */
export interface BacklinkDetailsRunReport {
  /** The link-window row cap the caller asked for. */
  readonly limit: number;
  /** Where the link window starts. Load-bearing for reading `top` — see below. */
  readonly offset: number;
  /** The target-pages row cap the caller asked for. */
  readonly page_limit: number;
  /** DFS `total_count` for the LINK set, before offset/limit. Null = the vendor did not say. */
  readonly total: number | null;
  /** Link rows RECEIVED in the window, before MAX_RUN_ROWS. */
  readonly shown: number;
  /**
   * The FIRST ROW OF THE LINK WINDOW, under the adapter's pinned `rank,desc` ordering.
   *
   * HONESTY ŞERH, CompetitorsRunReport.top's rule applied to a paginated set: at `offset` 0 this
   * really is the highest-ranked live backlink the vendor holds for the target, but at any other
   * offset it is merely where the caller's window begins. `offset` sits beside it precisely so a
   * reader can tell those two apart, and nothing here may be labelled "the best link" without
   * checking it.
   */
  readonly top: {
    readonly domain: string;
    readonly url_to: string | null;
    readonly rank: number | null;
    readonly dofollow: boolean | null;
  } | null;
  /** The link window: the vendor's whole-set count, what arrived, and the capped rows. */
  readonly links: CappedList<BacklinkDetailRow>;
  /** The TARGET'S OWN pages, ordered `backlinks,desc` by the adapter. Same three fields. */
  readonly target_pages: CappedList<TargetPageRow>;
}

/**
 * disavow_candidates' report.
 *
 * NO `locale` KEY, for BacklinksRunReport's reason.
 *
 * WHAT `total` IS: OUR count of the candidate DOMAINS this run produced — not a vendor number, and
 * the report says so by carrying the vendor's own count under a different name
 * (`matching_links_total`). The candidate list is DERIVED from a window of links the caller's own
 * criteria filtered, so every counter here is a statement about THIS run's criteria; `criteria` is
 * stored verbatim beside them so a later reader can see which question was asked.
 */
export interface DisavowCandidatesRunReport {
  /** The thresholds and vendor orderings that produced the list, VERBATIM. */
  readonly criteria: DisavowCriteria;
  /** OUR count of the candidate domains in this run, pre-cap. */
  readonly total: number;
  /** Distinct domains the link window named BEFORE the candidate cap was applied. */
  readonly distinct_domains: number;
  /**
   * DFS `total_count` for the FILTERED link set — the vendor's count of the links matching THIS
   * run's criteria, never of the target's whole backlink profile. Null = the vendor did not say.
   */
  readonly matching_links_total: number | null;
  /** Links RECEIVED in the filtered window, before MAX_RUN_ROWS. */
  readonly matching_links_shown: number;
  /**
   * The first candidate, under the candidate ordering the port applies (vendor `spam_score` first;
   * see compareCandidates). `spam_score` is DataForSEO's per-domain score and is null when the
   * vendor returned none for that domain — which is not 0, and is never rendered as one.
   */
  readonly top: {
    readonly domain: string;
    readonly spam_score: number | null;
    readonly window_link_count: number;
  } | null;
  /**
   * The first MAX_RUN_ROWS candidates. A PLAIN capped array rather than a CappedList: a CappedList
   * carries `total_count`, which on this list would have to be a permanent null standing for
   * "there is no vendor number here at all" rather than for "the vendor did not say" — two
   * different facts under one null is exactly what 0027's locale-column note refuses.
   */
  readonly candidates: readonly DisavowCandidate[];
  /** The referring-network window: a real vendor set, so it keeps its vendor count. */
  readonly referring_networks: CappedList<ReferringNetworkRow>;
}

/** The six reports — the only six things `domain_lookup_runs.report` ever holds. */
export type DomainLookupReport =
  | RankedKeywordsRunReport
  | BacklinksRunReport
  | CompetitorsRunReport
  | BacklinkChangesRunReport
  | BacklinkDetailsRunReport
  | DisavowCandidatesRunReport;

/**
 * Build ranked_keywords' report from the result the FORMATTER is about to render (pure).
 *
 * The result is passed in rather than re-fetched, and here that is not merely tidiness as it is in
 * 0024/0025: a second fetch would be a second PAID vendor call, and a second measurement that
 * merely resembles the one the caller was shown.
 */
export function rankedKeywordsRunReport(
  result: RankedKeywordsResult,
  query: { readonly limit: number; readonly sort: RankedKeywordsSort } & DomainLookupLocale,
): RankedKeywordsRunReport {
  const best = result.rows[0];
  return {
    locale: { language_code: query.language_code, location_code: query.location_code },
    sort: query.sort,
    limit: query.limit,
    total: result.total_count,
    shown: result.rows.length,
    items_count: result.items_count,
    top:
      best === undefined
        ? null
        : {
            keyword: best.keyword,
            position: best.position,
            search_volume: best.search_volume,
            url: best.url,
          },
    metrics: result.metrics,
    rows: capRows(result.rows),
  };
}

/** Build analyze_backlinks' report from the profile the formatter is about to render (pure). */
export function backlinksRunReport(
  profile: BacklinkProfile,
  query: { readonly limit: number },
): BacklinksRunReport {
  const best = profile.top_referring_domains.rows[0];
  return {
    limit: query.limit,
    total: profile.summary.backlinks,
    top:
      best === undefined
        ? null
        : { domain: best.domain, backlinks: best.backlinks, rank: best.rank },
    summary: profile.summary,
    referring_domains: {
      total_count: profile.top_referring_domains.total_count,
      shown: profile.top_referring_domains.rows.length,
      rows: capRows(profile.top_referring_domains.rows),
    },
    anchors: {
      total_count: profile.top_anchors.total_count,
      shown: profile.top_anchors.rows.length,
      rows: capRows(profile.top_anchors.rows),
    },
  };
}

/** Build compare_competitors' report from the comparison the formatter is about to render (pure). */
export function competitorsRunReport(
  comparison: CompetitorComparison,
  query: { readonly limit: number } & DomainLookupLocale,
): CompetitorsRunReport {
  // The FIRST row whose source is not the target — see the honesty sherh on `top`. Matching on
  // `source` rather than on `rows[1]` because the target's position in the table is the renderer's
  // decision, and a report that assumed it would start lying the day that decision changed.
  const rival = comparison.rows.find((row) => row.source !== "target");
  return {
    locale: { language_code: query.language_code, location_code: query.location_code },
    limit: query.limit,
    discovered: comparison.discovered,
    discovered_total_count: comparison.discovered_total_count,
    total: comparison.rows.length,
    top:
      rival === undefined
        ? null
        : { domain: rival.domain, intersections: rival.intersections, etv: rival.metrics.etv },
    rows: capRows(comparison.rows),
  };
}

/** A VendorWindow as a CappedList: the vendor's whole-set count, what ARRIVED, the capped rows. */
function cappedWindow<Row>(window: {
  readonly vendor_total_count: number | null;
  readonly rows: readonly Row[];
}): CappedList<Row> {
  return {
    total_count: window.vendor_total_count,
    shown: window.rows.length,
    rows: capRows(window.rows),
  };
}

/**
 * The profile bucket with the greatest PARSEABLE date, or null when no bucket has one.
 *
 * Measured rather than positional — see BacklinkChangesRunReport.top. A tie keeps the EARLIER
 * element (strict `>`), so the answer is deterministic for a vendor that repeats a date.
 */
function latestProfilePoint(
  points: readonly BacklinkProfilePoint[],
): BacklinkProfilePoint | null {
  let best: BacklinkProfilePoint | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const at = Date.parse(point.date);
    if (Number.isNaN(at) || at <= bestAt) continue;
    best = point;
    bestAt = at;
  }
  return best;
}

/** Build backlink_changes' report from the result the formatter is about to render (pure). */
export function backlinkChangesRunReport(
  changes: BacklinkChangesResult,
  query: { readonly periods: number },
): BacklinkChangesRunReport {
  const latest = latestProfilePoint(changes.profile);
  return {
    group_range: changes.group_range,
    periods: query.periods,
    date_from: changes.date_from,
    date_to: changes.date_to,
    total: changes.changes.length,
    profile_buckets: changes.profile.length,
    top:
      latest === null
        ? null
        : {
            date: latest.date,
            backlinks: latest.backlinks,
            referring_domains: latest.referring_domains,
          },
    changes: capRows(changes.changes),
    profile: capRows(changes.profile),
  };
}

/** Build backlink_details' report from the details the formatter is about to render (pure). */
export function backlinkDetailsRunReport(
  details: BacklinkDetails,
  query: {
    readonly limit: number;
    readonly offset: number;
    readonly page_limit: number;
  },
): BacklinkDetailsRunReport {
  const best = details.links.rows[0];
  return {
    limit: query.limit,
    offset: query.offset,
    page_limit: query.page_limit,
    total: details.links.vendor_total_count,
    shown: details.links.rows.length,
    top:
      best === undefined
        ? null
        : {
            domain: best.domain_from,
            url_to: best.url_to,
            rank: best.rank,
            dofollow: best.dofollow,
          },
    links: cappedWindow(details.links),
    target_pages: cappedWindow(details.target_pages),
  };
}

/**
 * Build disavow_candidates' report from the result the formatter is about to render (pure).
 *
 * It takes NO query argument, and that is not an omission: every parameter this tool accepts is
 * already inside `result.criteria`, carried there by the port so the ANSWER states the question.
 * Re-reading them off the input here would open the one gap that matters — a criterion the port
 * clamped (clampLinkRows, clampSpamScore) would be recorded at the value the caller typed rather
 * than the value the lookup ran under.
 */
export function disavowCandidatesRunReport(
  result: DisavowCandidates,
): DisavowCandidatesRunReport {
  const best = result.candidates.rows[0];
  return {
    criteria: result.criteria,
    total: result.candidates.window_candidate_count,
    distinct_domains: result.candidates.window_distinct_domain_count,
    matching_links_total: result.links.vendor_total_count,
    matching_links_shown: result.links.rows.length,
    top:
      best === undefined
        ? null
        : {
            domain: best.domain,
            spam_score: best.spam_score,
            window_link_count: best.window_link_count,
          },
    candidates: capRows(result.candidates.rows),
    referring_networks: cappedWindow(result.referring_networks),
  };
}

/** Everything one `domain_lookup_runs` row is keyed by. */
export interface DomainLookupRunTarget {
  readonly userId: string;
  /**
   * The project the lookup was resolved from, or NULL for a bare-target call.
   *
   * Nullable on purpose (0027's third departure from its siblings): looking up somebody else's
   * domain is the point of these tools, and that call has no project at all. `user_id` is the only
   * tenant guarantee on such a row, which is exactly what 0027's composite-FK note says out loud.
   */
  readonly projectId: string | null;
  /** One of the seven synchronous lookups — the CHECK constraint's vocabulary, typed. */
  readonly tool: DomainLookupTool;
  /** The RESOLVED normalized domain the lookup ran against, never the caller's raw input. */
  readonly target: string;
}

/**
 * The SEVEN tools the CHECK constraint names, after migration 0031 widened it from 0027's three.
 * An eighth is a compile error before it is a 23514 — which is the order those two failures should
 * arrive in, because only the first of them is free.
 */
export type DomainLookupTool =
  | "ranked_keywords"
  | "analyze_backlinks"
  | "compare_competitors"
  | "backlink_changes"
  | "backlink_details"
  | "disavow_candidates";

/** The write itself — injectable so a spec can make it fail without breaking a database. */
export type DomainLookupRunWriter = (
  target: DomainLookupRunTarget,
  report: DomainLookupReport,
) => Promise<void>;

type DomainLookupRunInsert = Database["public"]["Tables"]["domain_lookup_runs"]["Insert"];

/**
 * The report as a `jsonb` value.
 *
 * A ROUND TRIP rather than a cast, and it does real work here for the same two reasons
 * audit-content-runs.ts gives — plus a third that is specific to this table. `Json` demands the
 * implicit index signature a TS interface never has, so no amount of typing makes
 * `RankedKeywordsRunReport` assignable to it; and a bare `as unknown as Json` would ALSO accept a
 * report carrying a Date, a function or an `undefined` — values that either change shape or vanish
 * on the wire, silently.
 *
 * WHY IT APPLIES HERE SPECIFICALLY, rather than being copied because the siblings do it: these
 * three reports are the only ones in the family built from a THIRD PARTY's payload. The rows are
 * stored VERBATIM out of a zod parse of a DataForSEO response, so their concrete field set is
 * whatever the vendor sent — a widened parser is one commit away from putting a value in here that
 * nobody in this repo wrote. `JSON.stringify` is exactly the transformation PostgREST is about to
 * apply anyway, so what is type-checked here is what is stored, whoever authored the fields.
 */
export function domainLookupReportToJson(report: DomainLookupReport): Json {
  return JSON.parse(JSON.stringify(report)) as Json;
}

/**
 * Record one domain lookup run.
 *
 * FAIL-CLOSED, and that is the whole contract (0024/0025/0026's rule, applied to the three tools
 * that pay a vendor per call): a PostgREST error is re-thrown, never logged and swallowed. The
 * caller runs inside `withCredits`, which COMMITS a handler that returns and RELEASES one that
 * throws — so throwing means the tenant pays NOTHING for a lookup whose record was lost. At 65-90
 * credits a call this is the most expensive place in the product to get that backwards. Swallowing
 * would produce the opposite and worse shape: a charged tenant, a delivered table, and a panel
 * that will forever say the lookup never ran.
 */
export async function writeDomainLookupRun(
  target: DomainLookupRunTarget,
  report: DomainLookupReport,
): Promise<void> {
  const row: DomainLookupRunInsert = {
    user_id: target.userId,
    project_id: target.projectId,
    tool: target.tool,
    target: target.target,
    report: domainLookupReportToJson(report),
  };
  const { error } = await getServiceClient().from("domain_lookup_runs").insert(row);
  if (error) {
    throw new Error(`${target.tool}: domain_lookup_runs write failed (${error.message})`);
  }
}
