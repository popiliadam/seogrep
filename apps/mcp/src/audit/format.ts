import type { OnpageReport } from "./rules/onpage.ts";
import type { TechReport } from "./rules/tech.ts";
import type { SchemaReport } from "./rules/schema.ts";

/**
 * Text renderers for the three audit reports. Kept apart from the (pure, structured) rule
 * engines so the rules are asserted on data, not prose. Every renderer opens with the same
 * crawl-provenance line and caps long lists so an MCP text response stays bounded.
 */

/** Max items listed in any one section before the rest are summarized as "… and N more". */
const MAX_LISTED = 50;

function crawlProvenance(fetchedAt: string | null): string {
  return fetchedAt ? `crawl from ${fetchedAt}` : "crawl timestamp unavailable";
}

/** Render up to MAX_LISTED `items` as indented `· ` lines, then a "… and N more" tail. */
function bulletList(items: string[], indent = "  "): string {
  const shown = items.slice(0, MAX_LISTED).map((item) => `${indent}· ${item}`);
  if (items.length > MAX_LISTED) shown.push(`${indent}… and ${items.length - MAX_LISTED} more`);
  return shown.join("\n");
}

// --- on-page ---------------------------------------------------------------------

const ONPAGE_LABELS: Record<string, string> = {
  missing_title: "missing title",
  title_too_long: "title too long",
  title_too_short: "title too short",
  duplicate_title: "duplicate title",
  missing_meta: "missing meta description",
  meta_too_long: "meta description too long",
  meta_too_short: "meta description too short",
  duplicate_meta: "duplicate meta description",
  missing_h1: "missing h1",
  multiple_h1: "multiple h1",
  missing_canonical: "missing canonical",
  canonical_elsewhere: "canonical points elsewhere",
  thin_content: "thin content",
};
const ONPAGE_ORDER = Object.keys(ONPAGE_LABELS);

export function formatOnpageReport(report: OnpageReport, fetchedAt: string | null): string {
  const lines = [`On-page audit — ${report.pageCount} page(s) analyzed (${crawlProvenance(fetchedAt)}).`, ""];

  const summary = ONPAGE_ORDER.filter((type) => (report.counts[type] ?? 0) > 0).map(
    (type) => `${report.counts[type]} ${ONPAGE_LABELS[type]}`,
  );
  lines.push(summary.length > 0 ? `Summary: ${summary.join(", ")}.` : "Summary: no on-page issues found.");

  const clean = report.pageCount - report.pages.length;
  lines.push(`${report.pages.length} page(s) with findings; ${clean} clean.`);

  if (report.pages.length > 0) {
    lines.push("", "Findings by page:");
    for (const page of report.pages.slice(0, MAX_LISTED)) {
      lines.push(`- ${page.url}`);
      for (const finding of page.findings) lines.push(`    · ${finding.text}`);
    }
    if (report.pages.length > MAX_LISTED) {
      lines.push(`  … and ${report.pages.length - MAX_LISTED} more page(s) with findings`);
    }
  }
  return lines.join("\n");
}

// --- technical -------------------------------------------------------------------

export function formatTechReport(report: TechReport, fetchedAt: string | null): string {
  const { status } = report;
  const lines = [
    `Technical audit — ${report.pageCount} page(s), ${report.skippedCount} skipped (${crawlProvenance(fetchedAt)}).`,
    "",
    `HTTP status: ${status.ok2xx} ok (2xx), ${status.redirect3xx} redirect (3xx), ` +
      `${status.clientError4xx} client error (4xx), ${status.serverError5xx} server error (5xx).`,
  ];
  if (report.clientErrorUrls.length > 0) lines.push("  4xx pages:", bulletList(report.clientErrorUrls, "  "));
  if (report.serverErrorUrls.length > 0) lines.push("  5xx pages:", bulletList(report.serverErrorUrls, "  "));

  lines.push("", `Redirects surfaced: ${report.redirects.length}`);
  if (report.redirects.length > 0) {
    lines.push(bulletList(report.redirects.map((r) => `${r.url} — ${r.reason}`)));
  }

  lines.push("", `Not crawled (skipped): ${report.skippedCount}`);
  for (const [category, skips] of Object.entries(report.skippedByCategory).sort()) {
    lines.push(`  ${category}: ${skips.length}`);
    lines.push(bulletList(skips.map((s) => `${s.url} (${s.reason})`), "    "));
  }

  lines.push("", `Robots conflicts (noindex but internally linked): ${report.robotsConflicts.length}`);
  if (report.robotsConflicts.length > 0) {
    lines.push(bulletList(report.robotsConflicts.map((c) => `${c.url} (linked from ${c.linkedFrom} page(s))`)));
  }
  return lines.join("\n");
}

// --- structured data -------------------------------------------------------------

export function formatSchemaReport(report: SchemaReport, fetchedAt: string | null): string {
  const lines = [
    `Structured-data audit — ${report.pageCount} page(s) (${crawlProvenance(fetchedAt)}).`,
    "",
    `Coverage: ${report.pagesWithSchema} of ${report.pageCount} page(s) have JSON-LD; ` +
      `${report.pagesWithout.length} have none.`,
  ];

  if (report.typeCoverage.length > 0) {
    lines.push("", "Types across the site:");
    lines.push(bulletList(report.typeCoverage.map((t) => `${t.type}: ${t.pages} page(s)`)));
  } else {
    lines.push("", "No JSON-LD @type found anywhere on the site.");
  }

  if (report.pagesWithout.length > 0) {
    lines.push("", "Pages with NO structured data:");
    lines.push(bulletList(report.pagesWithout));
  }

  lines.push(
    "",
    "Note: detection is JSON-LD only (microdata/RDFa are not read); only @type names are " +
      "analyzed, never the JSON-LD body.",
  );
  return lines.join("\n");
}
