import type { AuditCrawl } from "../audit/index.ts";
import { auditSchema, formatSchemaReport } from "../audit/index.ts";
import { makeAuditTool, type AuditRendering, type AuditToolDeps } from "./audit-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * audit_schema — 5 credits, SYNC. Runs the structured-data rule engine over the project's
 * latest crawl: which pages have JSON-LD, which have none, and the site-wide spread of
 * @type names. Detection is JSON-LD only (the crawler stores type names, not the body).
 */
/**
 * THE DESCRIPTION IS A COVERAGE CLAIM, NOT A VALIDATION CLAIM (operator-signed 2026-08-25, and
 * the price was signed UNCHANGED at 5 credits in the same decision).
 *
 * The old wording opened with "Audit structured data (JSON-LD)", which a reader reasonably takes
 * as "checks whether my structured data is correct". It does not, and the tool's own report note
 * already admitted so: only `@type` NAMES are analyzed, never the JSON-LD body — the crawler
 * stores the type names and nothing else (crawler/crawl.ts). Invalid, incomplete or mis-typed
 * markup is therefore invisible to this tool, and a customer who read the old sentence would have
 * concluded the opposite from a clean-looking report.
 *
 * So the sentence says what the 5 credits actually buy — which pages carry JSON-LD, which carry
 * none, and how often each @type name appears — and names the limit rather than leaving it to be
 * discovered. Real JSON-LD validation is a SEPARATE, separately-priced tool and is deliberately
 * not built here; the description must not imply this one is it.
 */
const DESCRIPTION =
  "Report structured-data coverage AND required-field validation for a project's latest crawl: " +
  "which pages carry JSON-LD, which carry none, how often each schema.org @type name appears " +
  "site-wide, which blocks fail to parse, and — on pages whose crawl stored the JSON-LD bodies — " +
  "which known types are missing required fields. Detection is JSON-LD only; microdata and RDFa " +
  "are not read, unknown @type names are never judged, and a crawl made before bodies were stored " +
  "counts for coverage but is not validated. Costs 5 credits. Run crawl_site first.";

/** One engine run, two consumers — the recorded report and the returned text (audit-onpage.ts). */
export function renderSchemaAudit(crawl: AuditCrawl): AuditRendering {
  const report = auditSchema(crawl);
  return { report, text: formatSchemaReport(report, crawl.fetchedAt) };
}

export function makeAuditSchemaTool(deps: AuditToolDeps = {}): RegisteredTool {
  return makeAuditTool("audit_schema", DESCRIPTION, renderSchemaAudit, deps);
}

export const auditSchemaTool = makeAuditSchemaTool();
