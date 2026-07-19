import type { AggRow, CrawlSummary, GscSummary, IssueCount, ReportModel } from "./model.ts";
import { isoDate } from "./model.ts";

/**
 * Render a report model as a SELF-CONTAINED HTML document (design D16): a single string with
 * all CSS inline, no external request on load, English copy, and a simple mobile-readable
 * layout. It ends with the "powered by SeoGrep" footer that makes a shared report an organic
 * acquisition surface. This is what generate_report stores in reports.html and the public
 * /r/[slug] page serves.
 *
 * SECURITY: every dynamic value (title, domain, query strings, page URLs) is HTML-escaped
 * through escapeHtml before it enters the markup — a crawled page URL or a Search Console
 * query is untrusted site data and must never be able to inject markup. The static chrome is
 * the only literal HTML. GSC page/query URLs render as escaped TEXT (never href/src), so the
 * document issues no request when opened.
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

/** Inline stylesheet — deliberately tiny, system-font, readable on a phone. */
const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f7f9; color: #1a1a1a;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 56px; }
  header.rpt { border-bottom: 1px solid #e3e5e9; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .muted { color: #6b7280; font-size: 14px; }
  section.rpt { background: #fff; border: 1px solid #e3e5e9; border-radius: 12px;
    padding: 20px; margin: 0 0 20px; }
  h2 { font-size: 18px; margin: 0 0 12px; }
  .stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 12px; }
  .stat { flex: 1 1 120px; border: 1px solid #eceef1; border-radius: 8px; padding: 12px; }
  .stat .n { font-size: 22px; font-weight: 600; }
  .stat .l { color: #6b7280; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eceef1; vertical-align: top; }
  th { color: #6b7280; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.k { word-break: break-word; }
  ul.issues { margin: 0; padding-left: 18px; }
  ul.issues li { margin: 2px 0; }
  h3.toplabel { margin: 16px 0 6px; font-size: 13px; color: #6b7280; font-weight: 600; }
  .hint { color: #6b7280; font-size: 13px; margin: 12px 0 0; }
  footer.rpt { text-align: center; color: #9095a0; font-size: 13px; margin-top: 28px; }
  footer.rpt a { color: #6b7280; }
`;

function issuesBlock(issues: readonly IssueCount[]): string {
  if (issues.length === 0) {
    return `<p class="muted">No basic on-page issues detected in this crawl.</p>`;
  }
  const items = issues
    .map((issue) => `<li><strong>${fmtNum(issue.count)}</strong> — ${escapeHtml(issue.label)}</li>`)
    .join("");
  return `<ul class="issues">${items}</ul>`;
}

function statBlock(n: number, label: string): string {
  return `<div class="stat"><div class="n">${fmtNum(n)}</div><div class="l">${escapeHtml(label)}</div></div>`;
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
    ${issuesBlock(crawl.issues)}
    <p class="hint">This is a light summary. Run <code>audit_onpage</code>, <code>audit_tech</code>,
    or <code>audit_schema</code> for the full issue breakdown.</p>
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

function gscAbsentSection(): string {
  return `<section class="rpt">
    <h2>Search performance</h2>
    <p class="muted">No Search Console data yet. Connect it with <code>connect_gsc</code>, then run
    <code>pull_gsc_data</code> to include search performance here.</p>
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
    ${model.gsc ? gscSection(model.gsc) : gscAbsentSection()}
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
