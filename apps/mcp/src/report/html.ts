import {
  DEEP_PAGE_DEPTH,
  HEAVY_PAGE_BYTES,
  REDIRECT_CHAIN_MIN,
  SLOW_PAGE_MS,
} from "../audit/index.ts";
import type {
  AggRow,
  CappedList,
  CrawlSummary,
  GscSummary,
  OnpageSummary,
  ReportModel,
  SchemaSummary,
  TechSummary,
} from "./model.ts";
import { isoDate } from "./model.ts";

/**
 * Render a report model as a SELF-CONTAINED HTML document (design D16): a single string with
 * all CSS inline, no external request on load, English copy, and a simple mobile-readable
 * layout. It ends with the "powered by SeoGrep" footer that makes a shared report an organic
 * acquisition surface. This is what generate_report stores in reports.html and the public
 * /r/[slug] page serves.
 *
 * SECURITY: every dynamic value (title, domain, GSC query strings, crawled page URLs, JSON-LD
 * @type names, and X-Robots-Tag header values) is HTML-escaped through escapeHtml before it
 * enters the markup — all of it is untrusted site data and must never be able to inject markup.
 * R1-a widened WHAT is emitted (the audit sections now list the URLs behind their counts, because
 * a number alone tells nobody which page to fix) but not HOW: a crawled URL renders as escaped
 * TEXT and is never emitted as href/src, so the document still issues no request when opened.
 * The static chrome is the only literal HTML.
 */

/** Escape the five HTML-significant characters so untrusted data cannot break out of text. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Integer with thousands separators (locale-independent, deterministic). */
function fmtNum(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + String(Math.abs(Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const MARKETING_URL = "https://seogrep.com";

/**
 * Inline stylesheet — the site's "manpage" aesthetic in email-grade, self-contained form:
 * warm paper card on a desk backdrop, system serif body (Georgia) + system mono chrome
 * (Courier New), hairline rules, one amber accent, square corners. No external requests.
 */
const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px 48px; background: #f0ede5; color: #1c1b18;
    font: 16px/1.65 Georgia, "Times New Roman", serif; }
  .wrap { max-width: 840px; margin: 0 auto; padding: 40px 36px 48px; background: #faf8f3;
    border: 1px solid #e2ddd2; box-shadow: 0 24px 48px -24px rgba(28,27,24,0.25); }
  header.rpt { border-bottom: 1px solid #1c1b18; padding-bottom: 18px; margin-bottom: 28px; }
  h1 { font-family: Georgia, serif; font-weight: 500; font-size: 30px; letter-spacing: -0.01em; margin: 0 0 6px; }
  .muted { color: #6b6862; font-family: "Courier New", Courier, monospace; font-size: 13px; }
  section.rpt { background: #fffdf9; border: 1px solid #e2ddd2;
    padding: 22px 24px; margin: 0 0 22px; }
  h2 { font-family: Georgia, serif; font-weight: 500; font-size: 20px; margin: 0 0 12px; }
  .stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 12px; }
  .stat { flex: 1 1 120px; border: 1px solid #e2ddd2; padding: 14px 12px; }
  .stat .n { font-family: Georgia, serif; font-size: 26px; font-weight: 500; letter-spacing: -0.01em; }
  .stat .l { color: #a8a294; font-family: "Courier New", Courier, monospace; font-size: 11px;
    text-transform: uppercase; letter-spacing: .08em; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e2ddd2; vertical-align: top; }
  th { color: #a8a294; font-family: "Courier New", Courier, monospace; font-weight: 600;
    font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  td { color: #524f48; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.k { word-break: break-word; font-family: "Courier New", Courier, monospace; font-size: 13px; }
  code { font-family: "Courier New", Courier, monospace; font-size: 13px; background: #f5f2ea; padding: 1px 6px; }
  ul.issues { margin: 0; padding-left: 18px; color: #524f48; }
  ul.issues li { margin: 3px 0; }
  /* Crawled URLs render as TEXT, never links — long paths must wrap rather than widen the page. */
  .u { font-family: "Courier New", Courier, monospace; font-size: 13px; word-break: break-word; }
  li.more { list-style: none; margin-left: -18px; }
  h3.toplabel { margin: 18px 0 6px; font-family: "Courier New", Courier, monospace; font-size: 11px;
    color: #b45309; font-weight: 600; text-transform: uppercase; letter-spacing: .12em; }
  .hint { color: #a8a294; font-family: "Courier New", Courier, monospace; font-size: 12px; margin: 12px 0 0; }
  footer.rpt { text-align: center; color: #a8a294; font-family: "Courier New", Courier, monospace;
    font-size: 12px; margin-top: 28px; border-top: 1px solid #e2ddd2; padding-top: 18px; }
  footer.rpt a { color: #b45309; text-decoration: none; }
`;

function statBlock(n: number, label: string): string {
  return `<div class="stat"><div class="n">${fmtNum(n)}</div><div class="l">${escapeHtml(label)}</div></div>`;
}

/**
 * A "run <code>tool</code> for the full per-page breakdown" hint — the report is a summary.
 * `tool` is escaped like every other dynamic value in this file (defense-in-depth: today all
 * call sites pass static literals, but the file's contract is "every dynamic value is escaped").
 * Exported so the escaping is directly testable.
 */
export function auditHint(tool: string): string {
  return `<p class="hint">Run <code>${escapeHtml(tool)}</code> for the full per-page breakdown.</p>`;
}

/**
 * A capped list as a labelled block: the caption with the PRE-CAP total, the rows, and a
 * "… and N more" tail when the cap cut some.
 *
 * RETURNS "" WHEN THERE IS NOTHING, and that empty string is the absence-is-not-a-finding rule
 * living at the renderer (audit/format.ts does exactly this): every one of these lists is empty
 * both for a clean site AND for a crawl taken before the signal existed, so a "Slow pages: 0"
 * header would report a measurement that never happened. Silence is the honest rendering.
 *
 * `row` returns already-escaped HTML — each caller escapes its own untrusted fields, because only
 * the caller knows which parts are data and which are the static labels around them.
 */
function listBlock<T>(caption: string, list: CappedList<T>, row: (item: T) => string): string {
  if (list.total === 0) return "";
  const hidden = list.total - list.items.length;
  const tail = hidden > 0 ? `<li class="more">… and ${fmtNum(hidden)} more</li>` : "";
  return `<h3 class="toplabel">${escapeHtml(caption)} (${fmtNum(list.total)})</h3>
    <ul class="issues">${list.items.map((item) => `<li>${row(item)}</li>`).join("")}${tail}</ul>`;
}

/** A crawled URL as escaped, non-linking text — the shape every URL in an audit section takes. */
function urlText(url: string): string {
  return `<span class="u">${escapeHtml(url)}</span>`;
}

function crawlSection(crawl: CrawlSummary): string {
  const provenance = crawl.fetchedAt
    ? `Crawl from ${escapeHtml(isoDate(crawl.fetchedAt))}.`
    : "Crawl timestamp unavailable.";
  return `<section class="rpt">
    <h2>Site crawl</h2>
    <p class="muted">${provenance}</p>
    <div class="stats">
      ${statBlock(crawl.pageCount, "Pages crawled")}
      ${statBlock(crawl.skippedCount, "Pages skipped")}
    </div>
  </section>`;
}

/**
 * On-page findings from the REAL engine (G1). Counts (numbers) + static ONPAGE_LABELS strings
 * only — no page URL is emitted. When the engine finds nothing the copy is HONEST about the page
 * count analyzed, never the old blanket "no basic on-page issues" line the shallow check printed.
 */
function onpageSection(onpage: OnpageSummary): string {
  const body =
    onpage.findings.length === 0
      ? `<p class="muted">No on-page issues found across ${fmtNum(onpage.pageCount)} page(s).</p>`
      : `<ul class="issues">${onpage.findings
          .map((f) => `<li><strong>${fmtNum(f.count)}</strong> — ${escapeHtml(f.label)}</li>`)
          .join("")}</ul>`;
  const clean = onpage.pageCount - onpage.pagesWithFindings;
  const split =
    onpage.findings.length === 0
      ? ""
      : `<p class="muted">${fmtNum(onpage.pagesWithFindings)} page(s) with findings;
      ${fmtNum(clean)} clean.</p>`;
  return `<section class="rpt">
    <h2>On-page issues</h2>
    ${body}
    ${split}
    ${listBlock(
      "Duplicate content (pages sharing one text fingerprint)",
      onpage.duplicateGroups,
      (g) =>
        `<strong>${fmtNum(g.urls.length)}</strong> pages share one fingerprint: ` +
        g.urls.map(urlText).join(", "),
    )}
    ${auditHint("audit_onpage")}
  </section>`;
}

/**
 * The sitemap↔crawl block. Unlike every list around it this prints even at 0 and 0: a NON-null
 * diff means the sitemap was actually read, so "0 missing either way" is a measured agreement
 * worth stating, where an empty signal list would be an unmeasured axis (audit/format.ts).
 */
function sitemapBlock(tech: TechSummary): string {
  const diff = tech.sitemapDiff;
  if (diff === null) return "";
  return `<h3 class="toplabel">Sitemap vs crawl</h3>
    <p class="muted">${fmtNum(diff.sitemapUrls)} URL(s) read from the sitemap ·
    ${fmtNum(diff.missingFromCrawl.total)} in the sitemap but not crawled ·
    ${fmtNum(diff.missingFromSitemap.total)} crawled but not in the sitemap.</p>
    ${listBlock("In the sitemap, never crawled or skipped", diff.missingFromCrawl, urlText)}
    ${listBlock("Crawled but absent from the sitemap", diff.missingFromSitemap, urlText)}`;
}

/**
 * Technical health from the REAL engine. G1 printed the four status counts and a robots-conflict
 * number; the engine had already computed nine more sections and the report threw them away.
 *
 * Every threshold in the copy is INTERPOLATED FROM THE RULE'S OWN CONSTANT, never retyped, so the
 * number a reader is given and the number the rule used cannot drift apart (audit/format.ts).
 */
function techSection(tech: TechSummary): string {
  return `<section class="rpt">
    <h2>Technical health</h2>
    <div class="stats">
      ${statBlock(tech.ok2xx, "OK (2xx)")}
      ${statBlock(tech.redirect3xx, "Redirects (3xx)")}
      ${statBlock(tech.clientError4xx, "Client errors (4xx)")}
      ${statBlock(tech.serverError5xx, "Server errors (5xx)")}
    </div>
    <p class="muted">Robots conflicts (noindex but internally linked): <strong>${fmtNum(tech.robotsConflicts)}</strong></p>
    ${listBlock("Client error pages (4xx)", tech.clientErrorUrls, urlText)}
    ${listBlock("Server error pages (5xx)", tech.serverErrorUrls, urlText)}
    ${listBlock(
      "Broken internal links",
      tech.brokenInternalLinks,
      (l) => `${urlText(l.from)} → ${urlText(l.to)} (${fmtNum(l.status)})`,
    )}
    ${listBlock(
      `Slow pages (over ${fmtNum(SLOW_PAGE_MS)} ms)`,
      tech.slowPages,
      (p) => `${urlText(p.url)} — ${fmtNum(p.fetchMs)} ms`,
    )}
    ${listBlock(
      `Heavy pages (HTML over ${fmtNum(HEAVY_PAGE_BYTES)} bytes)`,
      tech.heavyPages,
      (p) => `${urlText(p.url)} — ${fmtNum(p.htmlBytes)} bytes`,
    )}
    ${listBlock(
      `Redirect chains (${fmtNum(REDIRECT_CHAIN_MIN)}+ hops)`,
      tech.redirectChains,
      (c) => [...c.chain, c.url].map(urlText).join(" → "),
    )}
    ${listBlock(
      "X-Robots-Tag conflicts (header says noindex, meta does not)",
      tech.xRobotsConflicts,
      (c) => `${urlText(c.url)} — <code>${escapeHtml(c.xRobotsTag)}</code>`,
    )}
    ${listBlock(
      `Deep pages (${fmtNum(DEEP_PAGE_DEPTH)}+ clicks from a crawl seed)`,
      tech.deepPages,
      (p) => `${urlText(p.url)} — depth ${fmtNum(p.depth)}`,
    )}
    ${listBlock(
      "No internal links found (orphan signal)",
      tech.orphanSignals,
      (p) => `${urlText(p.url)} — depth ${fmtNum(p.depth)}`,
    )}
    ${
      tech.orphanSignals.total > 0
        ? `<p class="hint">The crawl is bounded, so a page whose only linking page was not
      fetched appears here too.</p>`
        : ""
    }
    ${
      tech.skippedByCategory.length > 0
        ? `<h3 class="toplabel">Not crawled (${fmtNum(tech.skippedCount)})</h3>
    <ul class="issues">${tech.skippedByCategory
      .map((s) => `<li><strong>${fmtNum(s.count)}</strong> — ${escapeHtml(s.label)}</li>`)
      .join("")}</ul>`
        : ""
    }
    ${sitemapBlock(tech)}
    ${auditHint("audit_tech")}
  </section>`;
}

/**
 * Structured-data coverage from the REAL engine (G1). The @type names are crawled site data
 * (untrusted), so each renders as escaped TEXT; the counts are numbers. No URL is emitted.
 */
function schemaSection(schema: SchemaSummary): string {
  const types =
    schema.topTypes.length === 0
      ? `<p class="muted">No JSON-LD structured data found.</p>`
      : `<ul class="issues">${schema.topTypes
          .map((t) => `<li><strong>${fmtNum(t.pages)}</strong> — ${escapeHtml(t.type)}</li>`)
          .join("")}</ul>`;
  // The closing note states WHAT WAS ACTUALLY DONE, and that differs by crawl (audit/format.ts).
  // pagesValidated is 0 on every crawl stored before the JSON-LD bodies shipped, and claiming the
  // fields were checked there would be the strongest possible claim about the least-measured axis.
  const note =
    schema.pagesValidated > 0
      ? `Detection is JSON-LD only (microdata/RDFa are not read); required fields were checked
        against the stored JSON-LD bodies on ${fmtNum(schema.pagesValidated)} page(s).`
      : `Detection is JSON-LD only (microdata/RDFa are not read); only @type names are analyzed,
        never the JSON-LD body.`;
  return `<section class="rpt">
    <h2>Structured data</h2>
    <div class="stats">
      ${statBlock(schema.pagesWithSchema, "Pages with schema")}
      ${statBlock(schema.pagesWithout, "Pages without")}
      ${statBlock(schema.pageCount, "Pages crawled")}
    </div>
    ${types}
    ${listBlock(
      "Required fields missing",
      schema.missingFields,
      (f) => `${urlText(f.url)} — ${escapeHtml(f.type)} is missing ${escapeHtml(f.missing.join(", "))}`,
    )}
    ${listBlock(
      "Pages with unparseable JSON-LD",
      schema.invalidJson,
      (p) => `${urlText(p.url)} — ${fmtNum(p.blocks)} block(s) failed to parse`,
    )}
    ${listBlock(
      "Pages whose JSON-LD was only partly stored",
      schema.truncatedPages,
      (p) => `${urlText(p.url)} — ${fmtNum(p.dropped)} block(s) not stored`,
    )}
    <p class="hint">${note}</p>
    ${auditHint("audit_schema")}
  </section>`;
}

function crawlAbsentSection(): string {
  return `<section class="rpt">
    <h2>Site crawl</h2>
    <p class="muted">No crawl yet. Run <code>crawl_site</code> to include a site-health summary here.</p>
  </section>`;
}

function topTable(caption: string, keyHeader: string, rows: readonly AggRow[]): string {
  if (rows.length === 0) {
    return `<p class="muted">${escapeHtml(caption)}: no data in this window.</p>`;
  }
  const body = rows
    .map(
      (row) =>
        `<tr><td class="k">${escapeHtml(row.key)}</td>` +
        `<td class="num">${fmtNum(row.clicks)}</td>` +
        `<td class="num">${fmtNum(row.impressions)}</td></tr>`,
    )
    .join("");
  return `<h3 class="toplabel">${escapeHtml(caption)}</h3>
    <table><thead><tr>
      <th>${escapeHtml(keyHeader)}</th><th class="num">Clicks</th><th class="num">Impressions</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

function gscSection(gsc: GscSummary): string {
  const cap = gsc.capped
    ? `<p class="muted">Note: a window hit the row cap — top rows only; totals may be partial.</p>`
    : "";
  const window = `${escapeHtml(gsc.windowStart)} to ${escapeHtml(gsc.windowEnd)} (${fmtNum(gsc.days)} days)`;
  return `<section class="rpt">
    <h2>Search performance</h2>
    <p class="muted">Google Search Console — ${window}.</p>
    ${cap}
    <div class="stats">
      ${statBlock(gsc.totalClicks, "Total clicks")}
      ${statBlock(gsc.totalImpressions, "Total impressions")}
      ${statBlock(gsc.rowCount, "Query/page rows")}
    </div>
    ${topTable("Top queries", "Query", gsc.topQueries)}
    ${topTable("Top pages", "Page", gsc.topPages)}
    <p class="hint">Run <code>find_quick_wins</code>, <code>detect_cannibalization</code>, or
    <code>analyze_content_decay</code> for deeper opportunity analysis.</p>
  </section>`;
}

/**
 * The "no search data" section. It must distinguish NOT CONNECTED from CONNECTED-BUT-NOT-PULLED:
 * telling a connected user to connect is a factual error, and it contradicted whats_next on the
 * same project in the live product test (2026-08-07).
 */
function gscAbsentSection(connected: boolean): string {
  const body = connected
    ? `Search Console is connected, but no performance data has been pulled yet. Run
    <code>pull_gsc_data</code> to include search performance here.`
    : `No Search Console data yet. Connect it with <code>connect_gsc</code>, then run
    <code>pull_gsc_data</code> to include search performance here.`;
  return `<section class="rpt">
    <h2>Search performance</h2>
    <p class="muted">${body}</p>
  </section>`;
}

/** A one-line description for the document &lt;head&gt; (escaped at the call site). */
export function reportDescription(model: ReportModel): string {
  return `SEO report for ${model.domain}, generated by SeoGrep on ${isoDate(model.generatedAt)}.`;
}

/** Render the full self-contained HTML document for a report model. */
export function renderReportHtml(model: ReportModel): string {
  const title = escapeHtml(model.title);
  const description = escapeHtml(reportDescription(model));
  const body = `<div class="wrap">
    <header class="rpt">
      <h1>${title}</h1>
      <p class="muted">${escapeHtml(model.domain)} · ${escapeHtml(isoDate(model.generatedAt))}</p>
    </header>
    ${model.crawl ? crawlSection(model.crawl) : crawlAbsentSection()}
    ${model.onpage ? onpageSection(model.onpage) : ""}
    ${model.tech ? techSection(model.tech) : ""}
    ${model.schema ? schemaSection(model.schema) : ""}
    ${model.gsc ? gscSection(model.gsc) : gscAbsentSection(model.gscConnected)}
    <footer class="rpt">powered by <a href="${MARKETING_URL}" rel="noopener">SeoGrep</a></footer>
  </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="description" content="${description}">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>${body}</body>
</html>`;
}
