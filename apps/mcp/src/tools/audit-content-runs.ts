import type { ContentMatchResult, ContentMismatch } from "@pseo/core";
import { getServiceClient, type Database, type Json } from "../db.ts";
import { discoveryWindowOf, type DiscoveryWindow, type PullData } from "../gsc-data/index.ts";

/**
 * The CONTENT AUDIT RUN LEDGER (migration 0026): one row per audit_content run that delivered.
 *
 * The third sibling of `audit/runs.ts` (0024, crawl audits) and `gsc-data/runs.ts` (0025, pull
 * analyses), and the first that has to record TWO inputs — audit_content reads a stored pull AND
 * a stored crawl, so a run that named only one of them would be missing half its provenance.
 *
 * WHAT IS STORED IS THE STRUCTURAL RESULT, not the rendered text — 0024's and 0025's rule, same
 * reason: the prose is for a human and its wording is free to change, while the numbers under it
 * (how many queries mismatched, the biggest one, how much of the pull could not be joined) are
 * what a second surface can query. Storing the text would force a panel to parse sentences.
 */

/**
 * What the run read, carried on the report.
 *
 * Two provenance facts, because there are two inputs. The WINDOW is the same structure the
 * discovery runs record and is copied for the same reason (`DiscoveryWindow` — the pull it came
 * from can be superseded by a newer one, so a run whose window has to be looked up elsewhere is a
 * run whose window can change after the fact). `crawled_at` is the crawl's own timestamp, which
 * is the other half: a content mismatch is a statement about the page AS CRAWLED, and a title
 * fixed the day after the crawl makes the finding stale in a way the pull's dates cannot show.
 */
export interface ContentAuditReport {
  readonly window: DiscoveryWindow;
  /** The crawl's `fetchedAt`, or null when the stored crawl carried none. */
  readonly crawled_at: string | null;
  /** How many mismatches were found BEFORE the shortlist cap — the headline number. */
  readonly total: number;
  /**
   * The biggest missed opportunity, or null when there is none. Duplicated out of
   * `mismatches[0]` (the list is impressions desc) so the panel can read a run's headline without
   * downloading the run: PostgREST navigates into jsonb but cannot take an array's first element.
   */
  readonly top: {
    readonly query: string;
    readonly page: string;
    readonly impressions: number;
  } | null;
  /** (query, page) pairs that resolved to a crawled page and carried a testable word. */
  readonly analyzed: number;
  /** Pairs whose page is not in the crawl — the join's miss rate, recorded rather than hidden. */
  readonly unmatched_rows: number;
  /** Distinct crawled pages that carried at least one analyzed query. */
  readonly matched_pages: number;
  /** How many pages the crawl held at all, so `matched_pages` has a denominator. */
  readonly crawl_pages: number;
  /** The shortlist as returned, at most MAX_CONTENT_MISMATCHES long. `total` is the pre-cap count. */
  readonly mismatches: readonly ContentMismatch[];
}

/**
 * Build the report from the engine result the FORMATTER is about to render (pure).
 *
 * The result is passed in rather than recomputed, for `AuditRendering`'s reason: a builder that
 * re-ran the engine would store a second measurement that merely resembles the one the caller was
 * shown, and the two would diverge the first time the engine grew any state at all.
 */
export function contentAuditReport(
  pull: PullData,
  crawledAt: string | null,
  crawlPageCount: number,
  result: ContentMatchResult,
): ContentAuditReport {
  const worst = result.mismatches[0];
  return {
    window: discoveryWindowOf(pull),
    crawled_at: crawledAt,
    total: result.total,
    top:
      worst === undefined
        ? null
        : { query: worst.query, page: worst.page, impressions: worst.impressions },
    analyzed: result.analyzed,
    unmatched_rows: result.unmatched_rows,
    matched_pages: result.matched_pages,
    crawl_pages: crawlPageCount,
    mismatches: result.mismatches,
  };
}

/** Everything one `audit_content_runs` row is keyed by. Every field is a tenant key. */
export interface ContentAuditRunTarget {
  readonly userId: string;
  readonly projectId: string;
  /** The SUCCEEDED `pull_gsc_data` job the audit read (NOT NULL in 0026). */
  readonly pullJobId: string;
  /** The SUCCEEDED `crawl_site` job the audit read (NOT NULL in 0026). */
  readonly crawlJobId: string;
}

/** The write itself — injectable so a spec can make it fail without breaking a database. */
export type ContentAuditRunWriter = (
  target: ContentAuditRunTarget,
  report: ContentAuditReport,
) => Promise<void>;

type ContentAuditRunInsert = Database["public"]["Tables"]["audit_content_runs"]["Insert"];

/**
 * The report as a `jsonb` value.
 *
 * A round trip rather than a cast, and it does real work (auditReportToJson and
 * discoveryReportToJson state the same case): `Json` demands the implicit index signature a TS
 * interface never has, so no amount of typing makes `ContentAuditReport` assignable to it, and a
 * bare `as unknown as Json` would ALSO accept a report carrying a Date, a function or an
 * `undefined` — values that either change shape or vanish on the wire, silently. `JSON.stringify`
 * is exactly the transformation PostgREST is about to apply anyway, so what is type-checked here
 * is what is stored.
 */
export function contentAuditReportToJson(report: ContentAuditReport): Json {
  return JSON.parse(JSON.stringify(report)) as Json;
}

/**
 * Record one content audit run.
 *
 * FAIL-CLOSED, and that is the whole contract (0024's and 0025's rule, applied to the tool that
 * reads both): a PostgREST error is re-thrown, never logged and swallowed. The caller runs inside
 * `withCredits`, which COMMITS a handler that returns and RELEASES one that throws — so throwing
 * means the tenant pays nothing for an audit whose record was lost. Swallowing would produce the
 * opposite and worse shape: a charged tenant, a delivered report, and a panel that will forever
 * say the audit never ran.
 */
export async function writeContentAuditRun(
  target: ContentAuditRunTarget,
  report: ContentAuditReport,
): Promise<void> {
  const row: ContentAuditRunInsert = {
    user_id: target.userId,
    project_id: target.projectId,
    pull_job_id: target.pullJobId,
    crawl_job_id: target.crawlJobId,
    report: contentAuditReportToJson(report),
  };
  const { error } = await getServiceClient().from("audit_content_runs").insert(row);
  if (error) {
    throw new Error(`audit_content: audit_content_runs write failed (${error.message})`);
  }
}
