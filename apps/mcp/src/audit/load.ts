import { getServiceClient } from "../db.ts";
import { getLatestSucceededCrawl } from "../queue/boss.ts";
import { parseCrawlResult, type AuditCrawl } from "./crawl-data.ts";

/**
 * Shared input port for the three audit tools: load the most recent SUCCEEDED crawl for a
 * project (tenant-scoped) and hand back a ready-to-audit AuditCrawl. All three audits run
 * off the same crawl, so this is the ONE place that resolves + defensively parses it.
 */

export type CrawlLoad =
  | { readonly ok: true; readonly crawl: AuditCrawl }
  | { readonly ok: false; readonly error: string };

/** The action-suggesting message an audit gives when there is nothing to audit yet. */
export const NO_CRAWL_MESSAGE = "No crawl found for this project. Run crawl_site first.";

export type LoadCrawlFn = (userId: string, projectId: string) => Promise<CrawlLoad>;

/**
 * Resolve the latest crawl for (userId, projectId). A missing project, another tenant's
 * project, or a project never crawled all resolve to the same NO_CRAWL_MESSAGE — no
 * cross-tenant existence leak, and the message tells the caller exactly what to do next.
 * A stored result that will not parse (corrupt / legacy) is treated the same way: there is
 * nothing auditable, so point the caller back at crawl_site rather than emit a broken audit.
 */
export async function loadLatestCrawl(userId: string, projectId: string): Promise<CrawlLoad> {
  const latest = await getLatestSucceededCrawl(getServiceClient(), projectId, userId);
  if (!latest) return { ok: false, error: NO_CRAWL_MESSAGE };
  const crawl = parseCrawlResult(latest.result);
  if (!crawl || crawl.pages.length === 0) return { ok: false, error: NO_CRAWL_MESSAGE };
  return { ok: true, crawl };
}
