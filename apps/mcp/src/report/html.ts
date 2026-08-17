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
  OpportunitySummary,
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
 *
 * CONTRAST (R1-e): the chrome grey is #6b6862, measured at 5.5:1 on the #fffdf9 card and 5.2:1
 * on the #faf8f3 page — both clear WCAG AA. It replaced #a8a294, which measured about 2.3:1,
 * below AA at ANY size, and which coloured every stat label, table header, hint AND the footer.
 * The small print was the unreadable print. That hex is named HERE and not in a CSS comment
 * because this stylesheet ships to the reader; the rationale belongs to the source.
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
  /* Label/header/hint/footer grey: 5.5:1 on the card, 5.2:1 on the page — both clear WCAG AA. */
  .stat .l { color: #6b6862; font-family: "Courier New", Courier, monospace; font-size: 11px;
    text-transform: uppercase; letter-spacing: .08em; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e2ddd2; vertical-align: top; }
  th { color: #6b6862; font-family: "Courier New", Courier, monospace; font-weight: 600;
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
  /* Available to assistive tech, absent from the visual design (table captions). */
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
  h3.toplabel { margin: 18px 0 6px; font-family: "Courier New", Courier, monospace; font-size: 11px;
    color: #b45309; font-weight: 600; text-transform: uppercase; letter-spacing: .12em; }
  .hint { color: #6b6862; font-family: "Courier New", Courier, monospace; font-size: 12px; margin: 12px 0 0; }
  /* Staleness is a WARNING, not a footnote: it has to survive being skimmed. */
  .stale { border-left: 3px solid #b45309; background: #fdf6ec; color: #7c2d12;
    padding: 10px 12px; margin: 12px 0; font-size: 14px; }
  footer.rpt { text-align: center; color: #6b6862; font-family: "Courier New", Courier, monospace;
    font-size: 12px; margin-top: 28px; border-top: 1px solid #e2ddd2; padding-top: 18px; }
  footer.rpt a { color: #b45309; text-decoration: none; }
  .share { max-width: 60ch; margin: 0 auto 12px; text-align: left; line-height: 1.6; }
  /*
   * PRINT. An agency report's primary distribution is a PDF, and the screen design fights the
   * page: a drop shadow and two tinted backdrops render as grey wash across every sheet, and a
   * section split across a page break separates a finding from its heading. Ink is spent on the
   * findings, and each section is kept whole.
   */
  @media print {
    body { background: #fff; padding: 0; font-size: 11pt; }
    .wrap { max-width: none; margin: 0; padding: 0; background: #fff;
      border: none; box-shadow: none; }
    section.rpt { background: #fff; break-inside: avoid; page-break-inside: avoid; }
    h2 { break-after: avoid; page-break-after: avoid; }
    h3.toplabel { break-after: avoid; page-break-after: avoid; }
    .stale { background: #fff; border-left-width: 4px; }
    code { background: none; padding: 0; }
    /* The URL is the useful half of a link on paper, where the href cannot be followed. */
    footer.rpt a::after { content: " (" attr(href) ")"; }
  }
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

/** "today" / "1 day ago" / "N days ago" — the age wording renderPullProvenance uses. */
function agePhrase(ageDays: number): string {
  if (ageDays <= 0) return "today";
  return ageDays === 1 ? "1 day ago" : `${fmtNum(ageDays)} days ago`;
}

/**
 * A staleness banner for one dated section, or "" when there is nothing to warn about.
 *
 * A bare date is the whole claim only while the data is recent. Past the threshold it needs a
 * SENTENCE: a report built from a three-month-old measurement is presented in exactly the same
 * words as one built this morning, and the only difference a reader has to notice is a date in
 * small grey type — which is precisely the kind of difference nobody notices. Naming the tool to
 * re-run is what turns the observation into something the reader can act on.
 */
function staleBanner(stale: boolean, ageDays: number | null, tool: string): string {
  if (!stale || ageDays === null) return "";
  return `<p class="stale">This data is ${fmtNum(ageDays)} days old — the findings below describe
    the site as it was then. Run <code>${escapeHtml(tool)}</code> again for current numbers.</p>`;
}

function crawlSection(crawl: CrawlSummary): string {
  const provenance = crawl.fetchedAt
    ? `Crawl from ${escapeHtml(isoDate(crawl.fetchedAt))}${
        crawl.ageDays === null ? "" : ` (${agePhrase(crawl.ageDays)})`
      }.`
    : "Crawl timestamp unavailable.";
  return `<section class="rpt">
    <h2>Site crawl</h2>
    <p class="muted">${provenance}</p>
    ${staleBanner(crawl.stale, crawl.ageDays, "crawl_site")}
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
  // ALWAYS printed, exactly as formatOnpageReport prints it. `pagesWithFindings` is measured on
  // every crawl there has ever been — it is `report.pages.length`, not a signal a legacy crawl
  // could be missing — so the absence-is-not-a-finding rule does not reach it, and suppressing it
  // in the clean case was a plain divergence from the tool rather than a discipline.
  const clean = onpage.pageCount - onpage.pagesWithFindings;
  const split = `<p class="muted">${fmtNum(onpage.pagesWithFindings)} page(s) with findings;
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
  // scope="col" so a screen reader announces the right header with each cell; without it a
  // three-column data table is read as an undifferentiated run of numbers.
  return `<h3 class="toplabel">${escapeHtml(caption)}</h3>
    <table><caption class="visually-hidden">${escapeHtml(caption)}</caption><thead><tr>
      <th scope="col">${escapeHtml(keyHeader)}</th>
      <th scope="col" class="num">Clicks</th>
      <th scope="col" class="num">Impressions</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

function gscSection(gsc: GscSummary): string {
  const cap = gsc.capped
    ? `<p class="muted">Note: a window hit the row cap — top rows only; totals may be partial.</p>`
    : "";
  const window = `${escapeHtml(gsc.windowStart)} to ${escapeHtml(gsc.windowEnd)} (${fmtNum(gsc.days)} days)`;
  // WHEN it was pulled, distinct from WHICH DAYS were asked about: a 28-day window can be read
  // from a pull that ran this morning or one that ran in April.
  const pulled =
    gsc.pulledAt === null
      ? ""
      : `<p class="muted">Pulled ${escapeHtml(isoDate(gsc.pulledAt))}${
          gsc.ageDays === null ? "" : ` (${agePhrase(gsc.ageDays)})`
        }.</p>`;
  return `<section class="rpt">
    <h2>Search performance</h2>
    <p class="muted">Google Search Console — ${window}.</p>
    ${pulled}
    ${staleBanner(gsc.stale, gsc.ageDays, "pull_gsc_data")}
    ${cap}
    <div class="stats">
      ${statBlock(gsc.totalClicks, "Total clicks")}
      ${statBlock(gsc.totalImpressions, "Total impressions")}
      ${statBlock(gsc.rowCount, "Query/page rows")}
    </div>
    ${topTable("Top queries", "Query", gsc.topQueries)}
    ${topTable("Top pages", "Page", gsc.topPages)}
  </section>`;
}

/** One decimal place, for the average positions the discovery engines report. */
function fmtPos(value: number): string {
  return value.toFixed(1);
}

/**
 * The discovery roll-up (R1-b): quick wins, cannibalization and content decay, from the three
 * PURE engines run over the pull this report already loaded.
 *
 * It is a SUMMARY and says so — the paid discovery tools return the full prioritized breakdown,
 * and this section points at them rather than standing in for them.
 */
function opportunitySection(opp: OpportunitySummary): string {
  const empty =
    opp.quickWins.total === 0 && opp.cannibalization.total === 0 && opp.decay.total === 0;
  // Branded exclusions are reported even when nothing else is: a user whose biggest query
  // vanished from the list is owed the reason (formatCannibalization's rule).
  const brandNote =
    opp.brandedExcluded === 0
      ? ""
      : `<p class="hint">Excluded ${fmtNum(opp.brandedExcluded)} branded quer${
          opp.brandedExcluded === 1 ? "y" : "ies"
        }: several of your pages ranking for your own brand is normal — Google shows sitelinks —
        and is not cannibalization.</p>`;
  return `<section class="rpt">
    <h2>Opportunities</h2>
    ${
      empty
        ? `<p class="muted">No quick wins, cannibalization, or content decay found in this
      window.</p>`
        : ""
    }
    ${listBlock(
      "Quick wins (position 8–20 with demand)",
      opp.quickWins,
      (w) =>
        `${escapeHtml(w.query)} → ${urlText(w.page)} — position ${fmtPos(w.position)}, ` +
        `${fmtNum(w.impressions)} impressions`,
    )}
    ${listBlock(
      "Cannibalized queries (several of your pages competing)",
      opp.cannibalization,
      (g) =>
        `${escapeHtml(g.query)} — ${fmtNum(g.pages.length)} competing pages, ` +
        `${fmtNum(g.total_impressions)} impressions`,
    )}
    ${brandNote}
    ${listBlock(
      "Decaying pages (losing clicks vs the previous window)",
      opp.decay,
      (d) =>
        `${urlText(d.page)} — ${fmtNum(d.clicks_lost)} clicks lost ` +
        `(${fmtNum(d.previous_clicks)} → ${fmtNum(d.current_clicks)})`,
    )}
    <p class="hint">This is a summary. Run <code>find_quick_wins</code>,
    <code>detect_cannibalization</code>, or <code>analyze_content_decay</code> for the full
    prioritized breakdown, and <code>audit_content</code> to check whether each page's title
    matches the queries it already ranks for.</p>
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
/**
 * The sharing notice. It lived ONLY in the MCP tool's reply — which the person who GENERATED the
 * report reads, and the person who RECEIVES it never does. The recipient of a forwarded link had
 * no way to know the URL grants access to anyone holding it.
 *
 * WORDED TO WHAT THE CODE ACTUALLY DOES, and no further. `revokeReportLink` nulls `public_slug`
 * so the URL stops resolving from the next request onward, and the Reports page exposes it — so
 * the revoke claim is real. It stops there: the action deletes nothing, and its own docblock is
 * explicit that revoking "ends future access, it cannot un-share what was read", so no promise
 * of deletion or recall is made here.
 */
function shareNotice(): string {
  return `<p class="share">Anyone with this link can open this report — it needs no sign-in.
    The owner can revoke the link from the Reports page of their SeoGrep dashboard, which stops
    future access but cannot un-share what has already been read.</p>`;
}

export function renderReportHtml(model: ReportModel): string {
  const title = escapeHtml(model.title);
  const description = escapeHtml(reportDescription(model));
  const body = `<main class="wrap">
    <header class="rpt">
      <h1>${title}</h1>
      <p class="muted">${escapeHtml(model.domain)} · ${escapeHtml(isoDate(model.generatedAt))}</p>
    </header>
    ${model.crawl ? crawlSection(model.crawl) : crawlAbsentSection()}
    ${model.onpage ? onpageSection(model.onpage) : ""}
    ${model.tech ? techSection(model.tech) : ""}
    ${model.schema ? schemaSection(model.schema) : ""}
    ${model.gsc ? gscSection(model.gsc) : gscAbsentSection(model.gscConnected)}
    ${model.opportunities ? opportunitySection(model.opportunities) : ""}
    <footer class="rpt">
      ${shareNotice()}
      powered by <a href="${MARKETING_URL}" rel="noopener">SeoGrep</a>
    </footer>
  </main>`;

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
