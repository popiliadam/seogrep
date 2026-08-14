import type { AuditCrawl } from "../audit/index.ts";
import { auditTech, formatTechReport } from "../audit/index.ts";
import { makeAuditTool, type AuditRendering, type AuditToolDeps } from "./audit-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * audit_tech — 15 credits, SYNC. Runs the technical rule engine over the project's latest
 * crawl: HTTP status distribution (4xx/5xx pages), redirects the crawler surfaced, the
 * skipped/not-crawled URLs grouped by reason, and noindex-but-internally-linked conflicts.
 */
const DESCRIPTION =
  "Audit technical SEO for a project's latest crawl: HTTP status spread, redirects, " +
  "skipped URLs by reason, and robots (noindex) conflicts. Costs 15 credits. Run crawl_site first.";

/** One engine run, two consumers — the recorded report and the returned text (audit-onpage.ts). */
export function renderTechAudit(crawl: AuditCrawl): AuditRendering {
  const report = auditTech(crawl);
  return { report, text: formatTechReport(report, crawl.fetchedAt) };
}

export function makeAuditTechTool(deps: AuditToolDeps = {}): RegisteredTool {
  return makeAuditTool("audit_tech", DESCRIPTION, renderTechAudit, deps);
}

export const auditTechTool = makeAuditTechTool();
