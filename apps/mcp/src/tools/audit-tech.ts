import { auditTech, formatTechReport } from "../audit/index.ts";
import { makeAuditTool, type AuditToolDeps } from "./audit-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * audit_tech — 15 credits, SYNC. Runs the technical rule engine over the project's latest
 * crawl: HTTP status distribution (4xx/5xx pages), redirects the crawler surfaced, the
 * skipped/not-crawled URLs grouped by reason, and noindex-but-internally-linked conflicts.
 */
const DESCRIPTION =
  "Audit technical SEO for a project's latest crawl: HTTP status spread, redirects, " +
  "skipped URLs by reason, and robots (noindex) conflicts. Costs 15 credits. Run crawl_site first.";

export function makeAuditTechTool(deps: AuditToolDeps = {}): RegisteredTool {
  return makeAuditTool(
    "audit_tech",
    DESCRIPTION,
    (crawl) => formatTechReport(auditTech(crawl), crawl.fetchedAt),
    deps,
  );
}

export const auditTechTool = makeAuditTechTool();
