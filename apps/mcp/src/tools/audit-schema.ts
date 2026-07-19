import { auditSchema, formatSchemaReport } from "../audit/index.ts";
import { makeAuditTool, type AuditToolDeps } from "./audit-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * audit_schema — 5 credits, SYNC. Runs the structured-data rule engine over the project's
 * latest crawl: which pages have JSON-LD, which have none, and the site-wide spread of
 * @type names. Detection is JSON-LD only (the crawler stores type names, not the body).
 */
const DESCRIPTION =
  "Audit structured data (JSON-LD) for a project's latest crawl: coverage and the spread " +
  "of schema.org @type names, plus pages with none. Costs 5 credits. Run crawl_site first.";

export function makeAuditSchemaTool(deps: AuditToolDeps = {}): RegisteredTool {
  return makeAuditTool(
    "audit_schema",
    DESCRIPTION,
    (crawl) => formatSchemaReport(auditSchema(crawl), crawl.fetchedAt),
    deps,
  );
}

export const auditSchemaTool = makeAuditSchemaTool();
