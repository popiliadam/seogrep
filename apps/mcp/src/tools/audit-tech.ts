import type { AuditCrawl } from "../audit/index.ts";
import { auditTech, formatTechReport } from "../audit/index.ts";
import { makeAuditTool, type AuditRendering, type AuditToolDeps } from "./audit-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * audit_tech — 15 credits, SYNC. Runs the technical rule engine over the project's latest crawl.
 *
 * THE FORMATTER PRINTS FIFTEEN SECTIONS AND THIS SENTENCE ONCE NAMED FOUR (measured 2026-08-26 on a
 * real render, both ends: an empty crawl and a crawl carrying every signal). The eight it left
 * out — slow pages, heavy pages, redirect chains, X-Robots-Tag conflicts, deep pages, the orphan
 * signal, the sitemap↔crawl diff, broken internal links — were the half added after the sentence
 * was written, so a caller deciding whether to spend 15 credits was reading a price tag for a
 * third of the goods. The three hreflang sections (2026-09-02) shipped WITH their clause,
 * because the spec below derives the list from a render and fails on a section nobody named.
 *
 * THE SPLIT IS PART OF THE HONESTY, not a detail. Four sections are counts the engine always
 * takes, so they print at zero as readily as at fifty. The rest print only when they have rows —
 * because on a crawl predating the signal an empty list means "nobody looked", and a header
 * reading "Slow pages: 0" would report a measurement that never happened (format.ts states this
 * rule at the sections themselves). The sitemap diff is the one exception in the other direction:
 * it prints whenever a sitemap was READ, since a diff that exists makes "0 and 0" a measured
 * agreement. Promising twelve sections unconditionally would be a second falsehood, not a fix.
 *
 * This is the LLM-facing surface (tools/list), so it names the sections and nothing else; the
 * long form lives on the docs page (gen-tool-docs.mjs → DOC_PROSE.audit_tech), and BOTH are
 * checked against a real render in audit-tech.test.ts so neither can drift from the formatter.
 */
const DESCRIPTION =
  "Audit technical SEO for a project's latest crawl. " +
  "Always reported: HTTP status, Redirects surfaced, Not crawled (skipped URLs grouped by reason), " +
  "Robots conflicts (noindex but internally linked). " +
  "Reported only when the crawl has them: Slow pages, Heavy pages, Redirect chains, " +
  "X-Robots-Tag conflicts, Deep pages, No internal links found (orphan signal), " +
  "Broken internal links, Hreflang codes not valid, Hreflang sets with no x-default, " +
  "Hreflang not reciprocated, Sitemap vs crawl (printed whenever a sitemap was read — even at zero). " +
  "Costs 15 credits. Run crawl_site first.";

/** One engine run, two consumers — the recorded report and the returned text (audit-onpage.ts). */
export function renderTechAudit(crawl: AuditCrawl): AuditRendering {
  const report = auditTech(crawl);
  return { report, text: formatTechReport(report, crawl.fetchedAt) };
}

export function makeAuditTechTool(deps: AuditToolDeps = {}): RegisteredTool {
  return makeAuditTool("audit_tech", DESCRIPTION, renderTechAudit, deps);
}

export const auditTechTool = makeAuditTechTool();
