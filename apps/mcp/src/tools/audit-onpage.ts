import type { AuditCrawl } from "../audit/index.ts";
import { auditOnpage, formatOnpageReport } from "../audit/index.ts";
import { makeAuditTool, type AuditRendering, type AuditToolDeps } from "./audit-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * audit_onpage — 30 credits, SYNC. Runs the on-page rule engine over the project's latest
 * crawl: title / meta-description length + duplicates + absence, h1 count, canonical
 * presence/target, and thin content. Returns a per-page finding list with summary counts.
 */
const DESCRIPTION =
  "Audit on-page SEO for a project's latest crawl: titles, meta descriptions, h1s, " +
  "canonicals, and thin content, per page. Costs 30 credits. Run crawl_site first.";

/**
 * The engine + formatter pair, run ONCE so the recorded report and the returned text are the same
 * measurement rather than two that happen to agree. The text is unchanged: `formatOnpageReport`
 * receives exactly what it received before the run ledger existed.
 *
 * Exported so the fast lane can exercise it under a 0-credit tool name — a spec that named
 * `audit_onpage` would open a credit reserve and need a database (audit-runs.test.ts).
 */
export function renderOnpageAudit(crawl: AuditCrawl): AuditRendering {
  const report = auditOnpage(crawl);
  return { report, text: formatOnpageReport(report, crawl.fetchedAt) };
}

export function makeAuditOnpageTool(deps: AuditToolDeps = {}): RegisteredTool {
  return makeAuditTool("audit_onpage", DESCRIPTION, renderOnpageAudit, deps);
}

export const auditOnpageTool = makeAuditOnpageTool();
