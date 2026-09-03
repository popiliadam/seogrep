import type { OnpageReport } from "./rules/onpage.ts";
import type { TechReport } from "./rules/tech.ts";
import {
  DEEP_PAGE_DEPTH,
  HEAVY_PAGE_BYTES,
  REDIRECT_CHAIN_MIN,
  SLOW_PAGE_MS,
} from "./rules/tech.ts";
import type { SchemaReport } from "./rules/schema.ts";
import type { AuditSkipped } from "./crawl-data.ts";

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

/**
 * finding-type -> human label. The single source of truth for on-page wording: both the
 * audit_onpage text (below) AND the shareable report (report/model.ts, G1) map counts through
 * THIS map, so a reader who ran the tool sees the same terms in the report. Exported (pure,
 * additive) for that reuse — no behavior change to the formatters.
 */
export const ONPAGE_LABELS: Record<string, string> = {
  missing_title: "missing title",
  // `title_too_long` and `meta_too_long` USED TO SIT HERE and are gone with the rules that fed
  // them (rules/onpage.ts states why: Google publishes no character limit for either field).
  // Removed rather than left as dead keys — a label the engine can never emit is a claim about a
  // finding type this product no longer has.
  title_too_short: "title too short",
  duplicate_title: "duplicate title",
  missing_meta: "missing meta description",
  meta_too_short: "meta description too short",
  duplicate_meta: "duplicate meta description",
  missing_h1: "missing h1",
  multiple_h1: "multiple h1",
  missing_canonical: "missing canonical",
  canonical_elsewhere: "canonical points elsewhere",
  thin_content: "thin content",
  // Faz 1 signal rules. APPENDED, never interleaved: ONPAGE_ORDER is this map's key order and
  // is the summary line's order, so inserting a key higher up would reorder a line that has
  // already shipped — for a rule the older half of the corpus cannot even fire.
  img_missing_alt: "images missing alt text",
  title_equals_h1: "title duplicates the h1",
  og_missing: "no OpenGraph title/description",
  lang_missing: "missing html lang",
  heading_gap: "heading hierarchy gap",
  // The stray-edge rule (rules/onpage.ts, strayFinding). APPENDED for the reason stated above and
  // NOT interleaved beside the other title/meta keys, tempting as that reads: this map's key order
  // IS the summary line's order, so moving these up would reorder a line that already ships.
  //
  // Until these two keys existed the report CONTRADICTED ITSELF — a page whose only defect was a
  // stray edge character printed "Summary: no on-page issues found." directly above the finding,
  // because the summary walks ONPAGE_ORDER and drops any type this map does not name. `counts`
  // was right the whole time; only the naming was missing. report/model.ts reads the same map and
  // inherits the fix.
  title_stray_chars: "title has stray markup",
  meta_stray_chars: "meta description has stray markup",
};
/** The canonical finding-type order (semantic, not by count) — stable tie-break for summaries. */
export const ONPAGE_ORDER = Object.keys(ONPAGE_LABELS);

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

  // Duplicate content — APPENDED, and ONLY when there is a group to show.
  //
  // The silence is the honest rendering, not a saved line: `duplicateGroups` is empty both for a
  // site with no duplicates and for a crawl taken before the fingerprint existed, so a
  // "0 groups" header would state a measurement that, on half the stored corpus, never happened.
  if (report.duplicateGroups.length > 0) {
    lines.push("", `Duplicate content (pages sharing one text fingerprint): ${report.duplicateGroups.length} group(s)`);
    for (const group of report.duplicateGroups.slice(0, MAX_LISTED)) {
      lines.push(`- ${group.urls.length} pages share fingerprint ${group.hash.slice(0, 12)}…`);
      lines.push(bulletList(group.urls, "    "));
    }
    if (report.duplicateGroups.length > MAX_LISTED) {
      lines.push(`  … and ${report.duplicateGroups.length - MAX_LISTED} more group(s)`);
    }
  }

  // THE SNIPPET NOTE, ONCE AND ONLY WHEN IT APPLIES (R-4.4).
  //
  // A missing or short meta description reads as "this page has nothing for Google to show", and
  // that is not what Google says: the snippet is generated PRIMARILY from the page content, and
  // the meta description is used only sometimes. The report keeps the finding — an empty
  // description is still a wasted slot the page owns — and stops implying a consequence it cannot
  // observe. It is a FOOTER rather than a per-page bullet because it qualifies the rule, not the
  // page: repeated under fifty URLs it would be noise, and said once it is the caveat.
  if (metaFindings.some((type) => (report.counts[type] ?? 0) > 0)) {
    lines.push(
      "",
      "Note: Google generates most snippets from the page content itself and uses the meta " +
        "description only sometimes, so these are opportunities rather than errors.",
    );
  }
  return lines.join("\n");
}

/** The finding types the snippet note qualifies — the two that judge a meta description's text. */
const metaFindings = ["missing_meta", "meta_too_short"] as const;

// --- technical -------------------------------------------------------------------

/**
 * THE SKIPPED LIST WAS FIFTY COPIES OF ONE SENTENCE. Measured 2026-08-25 on a live audit: the
 * section printed 50 rows shaped `url (reason)` and the reason was IDENTICAL on all fifty, because
 * a crawl is skipped in bulk — one robots rule, one budget, one host that stopped answering. The
 * repetition was not merely long: it hid the only thing worth reading, which is HOW MANY were
 * skipped for EACH reason. So the reason is now stated ONCE per group with its own count, and the
 * URLs beneath it are examples of that group rather than the group itself.
 *
 * TWO CAPS, and both exist because either axis alone can run away:
 *
 *   - URLS PER REASON. Ten is enough to recognise a pattern (a path prefix, a query parameter, a
 *     subdomain) and short enough that one reason cannot fill the reply. This is the axis the
 *     measurement found.
 *   - REASONS PER CATEGORY. Grouping ALONE would have made the opposite case worse: `fetch failed:
 *     ${message}` and `off-origin redirect to ${target}` embed a variable, so fifty of those are
 *     fifty DISTINCT reasons, and printing each as its own group would have turned 50 lines into
 *     100. Groups are therefore ordered by size — biggest first, so the reason that explains most
 *     of the damage is the one the reader gets — and only the first five are printed.
 *
 * NOTHING IS DROPPED IN SILENCE. Each cap prints what it withheld and why: how many URLs share
 * the reason above, and how many further reasons cover how many further URLs. `skippedCount` in
 * the header is unchanged and still counts every skip, so the totals reconcile.
 */
const MAX_SKIP_REASONS_PER_CATEGORY = 5;
const MAX_SKIP_URLS_PER_REASON = 10;

/** One category's skips grouped by exact reason, biggest group first (reason as tie-break). */
function groupSkipsByReason(skips: readonly AuditSkipped[]): { reason: string; urls: string[] }[] {
  const byReason = new Map<string, string[]>();
  for (const skip of skips) {
    const urls = byReason.get(skip.reason);
    if (urls === undefined) byReason.set(skip.reason, [skip.url]);
    else urls.push(skip.url);
  }
  return [...byReason]
    .map(([reason, urls]) => ({ reason, urls }))
    .sort((a, b) => b.urls.length - a.urls.length || a.reason.localeCompare(b.reason));
}

/** The lines under one `category: N` header — see the two caps documented above. */
function renderSkippedCategory(skips: readonly AuditSkipped[]): string[] {
  const groups = groupSkipsByReason(skips);
  const listed = groups.slice(0, MAX_SKIP_REASONS_PER_CATEGORY);
  const lines = listed.flatMap(({ reason, urls }) => {
    const hidden = urls.length - MAX_SKIP_URLS_PER_REASON;
    return [
      `    ${reason} — ${urls.length} URL(s):`,
      ...urls.slice(0, MAX_SKIP_URLS_PER_REASON).map((url) => `      · ${url}`),
      ...(hidden > 0 ? [`      … and ${hidden} more URL(s) with this reason, not listed`] : []),
    ];
  });
  const restGroups = groups.slice(MAX_SKIP_REASONS_PER_CATEGORY);
  if (restGroups.length === 0) return lines;
  const restUrls = restGroups.reduce((total, group) => total + group.urls.length, 0);
  return [
    ...lines,
    `    … and ${restGroups.length} more reason(s) here, covering ${restUrls} URL(s), not listed`,
  ];
}

/**
 * The three hreflang sections, or nothing at all.
 *
 * Nothing when the crawl never stored alternates (`null`) — the sitemapDiff rule read from the
 * other side: silence there is "nobody looked", and a heading at zero would claim otherwise.
 *
 * The reciprocity section is the one that prints WITHOUT rows, and only in one case: alternates
 * whose target this crawl did not fetch. Their absence from the finding list is a bound of the
 * crawl, not a property of the site, and a reader who is told nothing reads "they are returned".
 */
function hreflangSections(report: TechReport["hreflang"] | undefined): string[] {
  // `undefined` AS WELL AS `null`, and they arrive from different places: null is this engine
  // saying "no page carried alternates", undefined is a row written to audit_runs.report before
  // the field existed. The type cannot see the second — stored jsonb is older than the type —
  // and a guard on null alone would throw while rendering a report a tenant already paid for.
  if (report === null || report === undefined) return [];
  const lines: string[] = [];
  if (report.invalidCodes.length > 0) {
    lines.push("", `Hreflang codes not valid (ISO 639-1 language, optional region): ${report.invalidCodes.length}`);
    lines.push(bulletList(report.invalidCodes.map((c) => `${c.url} — ${c.reason}`)));
  }
  if (report.missingXDefault.length > 0) {
    lines.push(
      "",
      // R-4.11 makes x-default a FALLBACK, not a requirement, and the heading has to carry
      // that: "sets with no x-default" alone reads as a missing mandatory tag.
      `Hreflang sets with no x-default (recommended, not required): ${report.missingXDefault.length}`,
    );
    lines.push(bulletList(report.missingXDefault));
    lines.push("  Note: x-default is the fallback for a visitor whose language the set does not list.");
  }
  if (report.notReciprocated.length > 0 || report.unmeasuredTargets > 0) {
    lines.push(
      "",
      `Hreflang not reciprocated (a pair is ignored unless both pages point at each other): ${report.notReciprocated.length}`,
    );
    if (report.notReciprocated.length > 0) {
      lines.push(bulletList(report.notReciprocated.map((g) => `${g.from} → ${g.to} (hreflang="${g.lang}")`)));
    }
    if (report.unmeasuredTargets > 0) {
      lines.push(
        `  Note: ${report.unmeasuredTargets} alternate(s) point at pages this crawl did not fetch, so whether they point back was not measured.`,
      );
    }
    lines.push("  Note: only the HTML channel is read here; a return link served in a header or a sitemap is not seen.");
  }
  return lines;
}

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
  // THE FIFTH BUCKET, printed only when it has members — and it is the reason the sentence above
  // is not a partition. A page whose stored status is missing or unreadable reads as 0 here
  // (crawl-data.ts asFiniteNumber) and falls into `other`, so before this block existed such a
  // page appeared NOWHERE in the report while the header still counted it among the pages
  // crawled. The four counts are left byte-for-byte as they were, and what does not add up is
  // stated in its own line rather than folded into theirs (NEVER#7).
  if (status.other > 0) {
    lines.push(
      `  ${status.other} page(s) carried no usable status and are in none of the four counts ` +
        `above, so those four do not add up to the ${report.pageCount} page(s) crawled:`,
      bulletList(report.otherStatusUrls, "  "),
    );
  }

  lines.push("", `Redirects surfaced: ${report.redirects.length}`);
  if (report.redirects.length > 0) {
    lines.push(bulletList(report.redirects.map((r) => `${r.url} — ${r.reason}`)));
  }

  lines.push("", `Not crawled (skipped): ${report.skippedCount}`);
  for (const [category, skips] of Object.entries(report.skippedByCategory).sort()) {
    lines.push(`  ${category}: ${skips.length}`, ...renderSkippedCategory(skips));
  }

  lines.push("", `Robots conflicts (noindex but internally linked): ${report.robotsConflicts.length}`);
  if (report.robotsConflicts.length > 0) {
    lines.push(bulletList(report.robotsConflicts.map((c) => `${c.url} (linked from ${c.linkedFrom} page(s))`)));
  }

  // Signal sections — APPENDED, each printed ONLY when non-empty, for the reason the on-page
  // duplicate section states: on a crawl predating these signals every list is empty, and a
  // header reading "Slow pages: 0" would report a measurement that never took place. Each
  // header names the THRESHOLD it used, from the constant, so the number in the prose and the
  // number in the rule cannot drift apart.
  if (report.slowPages.length > 0) {
    lines.push("", `Slow pages (fetch over ${SLOW_PAGE_MS} ms): ${report.slowPages.length}`);
    lines.push(bulletList(report.slowPages.map((p) => `${p.url} (${p.fetchMs} ms)`)));
  }
  if (report.heavyPages.length > 0) {
    lines.push("", `Heavy pages (HTML over ${HEAVY_PAGE_BYTES} bytes): ${report.heavyPages.length}`);
    lines.push(bulletList(report.heavyPages.map((p) => `${p.url} (${p.htmlBytes} bytes)`)));
  }
  if (report.redirectChains.length > 0) {
    lines.push("", `Redirect chains (${REDIRECT_CHAIN_MIN}+ hops): ${report.redirectChains.length}`);
    lines.push(bulletList(report.redirectChains.map((c) => [...c.chain, c.url].join(" → "))));
  }
  if (report.xRobotsConflicts.length > 0) {
    lines.push(
      "",
      `X-Robots-Tag conflicts (header says noindex, meta does not): ${report.xRobotsConflicts.length}`,
    );
    lines.push(bulletList(report.xRobotsConflicts.map((c) => `${c.url} (X-Robots-Tag: ${c.xRobotsTag})`)));
  }
  if (report.deepPages.length > 0) {
    lines.push("", `Deep pages (${DEEP_PAGE_DEPTH}+ clicks from a crawl seed): ${report.deepPages.length}`);
    lines.push(bulletList(report.deepPages.map((p) => `${p.url} (depth ${p.depth})`)));
  }
  if (report.orphanSignals.length > 0) {
    lines.push("", `No internal links found (orphan signal): ${report.orphanSignals.length}`);
    lines.push(bulletList(report.orphanSignals.map((p) => `${p.url} (depth ${p.depth})`)));
    lines.push("  Note: the crawl is bounded, so a page whose only linking page was not fetched appears here too.");
  }

  // Faz 2 graph sections, appended under the same rule as the signal sections above.
  //
  // The sitemap diff prints on a NON-NULL diff even when both lists are empty — unlike every
  // section above it, which prints only when it has rows. That is the point of the null: a diff
  // that exists means the sitemap WAS read, so "0 and 0" is a measured agreement worth stating,
  // where an empty signal list would be an unmeasured axis.
  const diff = report.sitemapDiff;
  if (diff !== null) {
    lines.push("", `Sitemap vs crawl (${diff.sitemapUrls} URL(s) read from the sitemap):`);
    lines.push(
      `  in the sitemap but not crawled: ${diff.missingFromCrawl.length}; ` +
        `crawled but not in the sitemap: ${diff.missingFromSitemap.length}`,
    );
    if (diff.missingFromCrawl.length > 0) {
      lines.push("  In the sitemap, never crawled or skipped:");
      lines.push(bulletList(diff.missingFromCrawl, "    "));
    }
    if (diff.missingFromSitemap.length > 0) {
      lines.push("  Crawled but absent from the sitemap:");
      lines.push(bulletList(diff.missingFromSitemap, "    "));
    }
  }
  if (report.brokenInternalLinks.length > 0) {
    lines.push("", `Broken internal links (target crawled, answered 4xx/5xx): ${report.brokenInternalLinks.length}`);
    lines.push(bulletList(report.brokenInternalLinks.map((l) => `${l.from} → ${l.to} (${l.status})`)));
  }
  lines.push(...hreflangSections(report.hreflang));
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

  // NOT a findings section: nothing here is broken. It exists so a reader whose FAQ markup stopped
  // producing a rich result learns it from the audit rather than from a traffic chart, and it is
  // read off the type NAMES, so a crawl that stored no bodies still says it (R-2.2).
  // `?? []` for the same reason hreflangSections tolerates undefined: a row stored before this
  // field existed has no such key, and rendering it must not throw.
  const retiredTypes = report.retiredTypes ?? [];
  if (retiredTypes.length > 0) {
    lines.push("", "Types that no longer produce a Google rich result:");
    lines.push(
      bulletList(
        retiredTypes.map(
          (type) => `${type} is no longer a Google rich result; keep it only if it serves users.`,
        ),
      ),
    );
  }

  if (report.pagesWithout.length > 0) {
    lines.push("", "Pages with NO structured data:");
    lines.push(bulletList(report.pagesWithout));
  }

  // Faz 3: what the BODIES say. Every block below prints only when it has rows, so a crawl that
  // stored no bodies renders exactly what it always rendered.
  if (report.missingFields.length > 0) {
    lines.push("", `Required fields missing: ${report.missingFields.length}`);
    lines.push(
      bulletList(report.missingFields.map((f) => `${f.url} — ${f.type} is missing ${f.missing.join(", ")}`)),
    );
  }
  if (report.invalidJson.length > 0) {
    lines.push("", `Pages with unparseable JSON-LD: ${report.invalidJson.length}`);
    lines.push(bulletList(report.invalidJson.map((p) => `${p.url} (${p.blocks} block(s) failed to parse)`)));
  }
  if (report.truncatedPages.length > 0) {
    lines.push("", `Pages whose JSON-LD was only partly stored: ${report.truncatedPages.length}`);
    lines.push(bulletList(report.truncatedPages.map((p) => `${p.url} (${p.dropped} block(s) not stored)`)));
    lines.push("  Note: required fields were checked on the stored blocks only.");
  }

  // THE CLOSING NOTE STATES WHAT WAS ACTUALLY DONE, and that differs by crawl. The first wording
  // is the one every crawl before the bodies existed earns, and it stays byte-identical for them;
  // the second is what a crawl carrying bodies earns, because telling that reader "only @type
  // names are analyzed" would describe a run that did not happen.
  lines.push(
    "",
    report.pagesValidated > 0
      ? "Note: detection is JSON-LD only (microdata/RDFa are not read); required fields were " +
          `checked against the stored JSON-LD bodies on ${report.pagesValidated} page(s).`
      : "Note: detection is JSON-LD only (microdata/RDFa are not read); only @type names are " +
          "analyzed, never the JSON-LD body.",
  );
  return lines.join("\n");
}
