import { auditOnpage, formatOnpageReport } from "../audit/index.ts";
import { makeAuditTool, type AuditToolDeps } from "./audit-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * audit_onpage — 30 credits, SYNC. Runs the on-page rule engine over the project's latest
 * crawl: title / meta-description length + duplicates + absence, h1 count, canonical
 * presence/target, and thin content. Returns a per-page finding list with summary counts.
 */
const DESCRIPTION =
  "Audit on-page SEO for a project's latest crawl: titles, meta descriptions, h1s, " +
  "canonicals, and thin content, per page. Costs 30 credits. Run crawl_site first.";

export function makeAuditOnpageTool(deps: AuditToolDeps = {}): RegisteredTool {
  return makeAuditTool(
    "audit_onpage",
    DESCRIPTION,
    (crawl) => formatOnpageReport(auditOnpage(crawl), crawl.fetchedAt),
    deps,
  );
}

export const auditOnpageTool = makeAuditOnpageTool();
