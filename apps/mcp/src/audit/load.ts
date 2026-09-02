import { getServiceClient } from "../db.ts";
import { getLatestSucceededCrawl, getSucceededCrawlById } from "../queue/boss.ts";
import { parseCrawlResult, type AuditCrawl } from "./crawl-data.ts";

/**
 * Shared input port for the three audit tools: load the most recent SUCCEEDED crawl for a
 * project (tenant-scoped) and hand back a ready-to-audit AuditCrawl. All three audits run
 * off the same crawl, so this is the ONE place that resolves + defensively parses it.
 */

export type CrawlLoad =
  | {
      readonly ok: true;
      readonly crawl: AuditCrawl;
      /**
       * The `jobs` row the crawl was read from — what `audit_runs.crawl_job_id` records, so an
       * audit run can be traced back to the exact crawl it judged (migration 0024).
       *
       * OPTIONAL on the type, ALWAYS present from this loader. It is optional so that the
       * DB-less fakes injected as `loadCrawl` in the fast lane keep compiling; that leniency is
       * paid for at the call site rather than here — `makeAuditTool` THROWS when a tool that
       * produces a structural report is handed a load with no job id, so a missing id fails
       * closed (no charge) instead of silently skipping the write.
       */
      readonly jobId?: string;
      /**
       * TRUE when the caller NAMED this crawl (`job_id`), false/absent when the loader picked the
       * newest one. It changes nothing about the audit and one sentence about the report: a crawl
       * the caller did not choose is one they should be told they can choose.
       */
      readonly requested?: boolean;
    }
  | { readonly ok: false; readonly error: string };

/** The action-suggesting message an audit gives when there is nothing to audit yet. */
export const NO_CRAWL_MESSAGE = "No crawl found for this project. Run crawl_site first.";

/**
 * The refusal for a `job_id` that names no auditable crawl. DELIBERATELY DIFFERENT from
 * NO_CRAWL_MESSAGE and deliberately uniform within itself: the caller supplied an id, so "run
 * crawl_site first" would be the wrong instruction, and every way the id can fail to resolve — not
 * this project's, not this tenant's, not a crawl, still running, failed — answers this one
 * sentence. The uniformity is the same existence guard the sibling message carries.
 */
export const NO_SUCH_CRAWL_MESSAGE =
  "No succeeded crawl_site job with that job_id for this project. Run list_jobs to see which " +
  "crawls can be audited.";

export type LoadCrawlFn = (
  userId: string,
  projectId: string,
  jobId?: string,
) => Promise<CrawlLoad>;

/**
 * Resolve the latest crawl for (userId, projectId). A missing project, another tenant's
 * project, or a project never crawled all resolve to the same NO_CRAWL_MESSAGE — no
 * cross-tenant existence leak, and the message tells the caller exactly what to do next.
 * A stored result that will not parse (corrupt / legacy) is treated the same way: there is
 * nothing auditable, so point the caller back at crawl_site rather than emit a broken audit.
 */
export async function loadLatestCrawl(
  userId: string,
  projectId: string,
  jobId?: string,
): Promise<CrawlLoad> {
  const client = getServiceClient();
  const notFound = jobId === undefined ? NO_CRAWL_MESSAGE : NO_SUCH_CRAWL_MESSAGE;
  const row =
    jobId === undefined
      ? await getLatestSucceededCrawl(client, projectId, userId)
      : await getSucceededCrawlById(client, { jobId, projectId, userId });
  if (!row) return { ok: false, error: notFound };
  const crawl = parseCrawlResult(row.result);
  if (!crawl || crawl.pages.length === 0) return { ok: false, error: notFound };
  return { ok: true, crawl, jobId: row.jobId, requested: jobId !== undefined };
}

/**
 * THE SCOPE SENTENCE every audit opens with — WHICH crawl was judged, and how big it was.
 *
 * Measured live 2026-09-02 and this is the hole it closes: a project's newest crawl was a
 * one-page `include_paths` run taken three minutes after a 51-page one. `audit_onpage` charged 30
 * credits, audited the ONE page, and said `1 page(s) analyzed` — honest, but not a warning, and
 * with no way for the reader to learn which of the two crawls they had just paid to judge.
 * `audit_content`, at 12 credits, was already printing its coverage ratio; this is that discipline
 * moved into the shared loader so all four audits inherit it instead of one of them having it.
 *
 * The job id is SHORTENED, not omitted: eight hex characters are enough to match a row in
 * `list_jobs` by eye and short enough to keep the line readable. The selection note is printed
 * only when the loader CHOSE the crawl — a caller who passed `job_id` already knows which one it
 * is, and telling them how to do what they just did is noise.
 */
export function crawlScopeLine(load: Extract<CrawlLoad, { ok: true }>): string {
  const when = load.crawl.fetchedAt?.slice(0, 10) ?? "an unrecorded date";
  const which = load.jobId === undefined ? "the stored crawl" : `crawl ${load.jobId.slice(0, 8)}`;
  const scope =
    `Audited ${which} from ${when}: ${load.crawl.pages.length} page(s), ` +
    `${load.crawl.skipped.length} URL(s) skipped.`;
  if (load.requested === true) return scope;
  return (
    `${scope} That is this project's most recent crawl — pass job_id (from list_jobs) to audit ` +
    "a different one, or run crawl_site again to widen it."
  );
}
