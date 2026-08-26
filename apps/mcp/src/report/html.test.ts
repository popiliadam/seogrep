import { describe, expect, it } from "vitest";
import {
  DEEP_PAGE_DEPTH,
  HEAVY_PAGE_BYTES,
  REDIRECT_CHAIN_MIN,
  SLOW_PAGE_MS,
} from "../audit/index.ts";
import type { ReportModel } from "./model.ts";
import { auditHint, escapeHtml, renderReportHtml } from "./html.ts";

/**
 * Pure unit tests for the self-contained HTML renderer. The document must carry no external
 * request (all CSS inline), escape every dynamic value, and end with the D16
 * "powered by SeoGrep" footer.
 */

/**
 * The DEFAULT for every enriched list: nothing measured, nothing to print. FULL_MODEL is the
 * "ordinary report" fixture, and an ordinary crawl trips none of the signal rules — the sections
 * that DO have rows get their own fixtures below, so a test that asserts a section is absent and
 * one that asserts its contents can never be reading the same model.
 */
const EMPTY = { items: [], total: 0 } as const;

const FULL_MODEL: ReportModel = {
  domain: "example.com",
  gscConnected: true,
  title: "Q3 SEO Report",
  generatedAt: "2026-07-19T00:00:00.000Z",
  crawl: {
    fetchedAt: "2026-07-18T00:00:00.000Z",
    pageCount: 42,
    skippedCount: 3,
    ageDays: 1,
    stale: false,
  },
  onpage: {
    pageCount: 42,
    findings: [
      { label: "missing canonical", count: 42 },
      { label: "missing meta description", count: 7 },
    ],
    pagesWithFindings: 40,
    duplicateGroups: EMPTY,
  },
  tech: {
    pageCount: 42,
    skippedCount: 3,
    ok2xx: 39,
    redirect3xx: 1,
    clientError4xx: 2,
    serverError5xx: 0,
    robotsConflicts: 1,
    clientErrorUrls: EMPTY,
    serverErrorUrls: EMPTY,
    slowPages: EMPTY,
    heavyPages: EMPTY,
    // 0/0: this fixture is a crawl stored BEFORE the crawler recorded fetch time and HTML size,
    // which is what makes its empty slow/heavy lists mean "never measured" rather than "fast".
    // ENRICHED overrides both, because a fixture that HAS speed findings was measured by
    // definition — the two cases must never be reachable from the same numbers.
    pagesTimed: 0,
    pagesSized: 0,
    redirectChains: EMPTY,
    xRobotsConflicts: EMPTY,
    deepPages: EMPTY,
    orphanSignals: EMPTY,
    brokenInternalLinks: EMPTY,
    skippedByCategory: [],
    sitemapDiff: null,
  },
  schema: {
    pageCount: 42,
    pagesWithSchema: 30,
    pagesWithout: 12,
    topTypes: [
      { type: "Article", pages: 20 },
      { type: "WebPage", pages: 10 },
    ],
    pagesValidated: 0,
    missingFields: EMPTY,
    invalidJson: EMPTY,
    truncatedPages: EMPTY,
  },
  gsc: {
    days: 28,
    windowStart: "2026-06-22",
    windowEnd: "2026-07-19",
    pulledAt: "2026-07-19T00:00:00.000Z",
    ageDays: 0,
    stale: false,
    totalClicks: 1234,
    totalImpressions: 56789,
    rowCount: 120,
    capped: false,
    topQueries: [{ key: "seo tools", clicks: 100, impressions: 1000 }],
    topPages: [{ key: "https://example.com/a", clicks: 80, impressions: 900 }],
  },
  opportunities: {
    quickWins: EMPTY,
    cannibalization: EMPTY,
    brandedExcluded: 0,
    decay: EMPTY,
  },
};

describe("escapeHtml", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeHtml(`<script>"a"&'b'`)).toBe("&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;");
  });
});

describe("auditHint", () => {
  it("escapes the tool name so no dynamic value bypasses escaping", () => {
    const out = auditHint("audit<script>");
    expect(out).toContain("audit&lt;script&gt;");
    expect(out).not.toContain("audit<script>");
  });
});

describe("renderReportHtml", () => {
  const html = renderReportHtml(FULL_MODEL);

  it("is a self-contained HTML document with a title and meta description", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Q3 SEO Report</title>");
    expect(html).toContain('<meta name="description"');
    expect(html).toContain("<style>");
  });

  it("makes NO external request on load (no resource-loading tags/attributes)", () => {
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/\bsrc\s*=/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(/i); // no CSS url() fetches
    // The only href in the document is the footer link to the marketing site (navigational,
    // not a resource request); page/query URLs from GSC render as escaped TEXT, never links.
    const hrefs = html.match(/href="[^"]*"/g) ?? [];
    expect(hrefs).toEqual(['href="https://seogrep.com"']);
  });

  it("carries the powered-by-SeoGrep footer linking the marketing site (D16)", () => {
    expect(html).toContain('href="https://seogrep.com"');
    expect(html).toMatch(/powered by\s*<a[^>]*>SeoGrep<\/a>/i);
  });

  it("renders the crawl counts and the REAL on-page findings, not the old shallow string (G1)", () => {
    expect(html).toContain("42"); // pages crawled / missing-canonical count
    // Real engine findings, in the SAME vocabulary audit_onpage prints.
    expect(html).toContain("missing canonical");
    expect(html).toContain("missing meta description");
    expect(html).toContain("7");
    // The misleading blanket string G1 flagged is gone for good.
    expect(html).not.toContain("No basic on-page issues detected");
    // Points the reader at the deep audit tool for the per-page breakdown.
    expect(html).toMatch(/audit_onpage/);
  });

  it("renders the technical-health distribution and robots-conflict count", () => {
    expect(html).toMatch(/audit_tech/);
    expect(html).toContain("39"); // 2xx
    expect(html).toMatch(/2xx/);
    expect(html).toMatch(/4xx/);
    expect(html).toMatch(/5xx/);
    expect(html).toMatch(/robots/i); // robots-conflict line
  });

  it("renders schema coverage and top declared types", () => {
    expect(html).toMatch(/audit_schema/);
    expect(html).toContain("30"); // pagesWithSchema
    expect(html).toContain("Article");
    expect(html).toContain("WebPage");
  });

  it("renders the GSC section totals, window, and top lists", () => {
    expect(html).toContain("2026-06-22");
    expect(html).toContain("2026-07-19");
    expect(html).toContain("1,234");
    expect(html).toContain("seo tools");
    expect(html).toContain("https://example.com/a");
    expect(html).toMatch(/find_quick_wins/);
  });

  it("escapes dynamic values so user/site data cannot inject markup", () => {
    const evil = renderReportHtml({
      ...FULL_MODEL,
      title: "<script>alert(1)</script>",
      gsc: {
        ...FULL_MODEL.gsc!,
        topQueries: [{ key: '"><img src=x onerror=alert(1)>', clicks: 1, impressions: 1 }],
      },
    });
    expect(evil).not.toContain("<script>alert(1)</script>");
    expect(evil).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(evil).not.toMatch(/<img\b/i);
  });

  it("escapes a crawled JSON-LD @type so structured-data names cannot inject markup", () => {
    // @type names come straight from the crawled page's JSON-LD — untrusted site data. They render
    // as escaped TEXT in the schema section, never as a tag or a resource-loading attribute.
    const evil = renderReportHtml({
      ...FULL_MODEL,
      schema: {
        ...FULL_MODEL.schema!,
        topTypes: [{ type: '"><img src=x onerror=alert(1)><script>', pages: 3 }],
      },
    });
    expect(evil).not.toMatch(/<img\b/i);
    expect(evil).not.toMatch(/<script\b/i);
    expect(evil).toContain("&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;");
  });

  it("uses honest zero-issue copy when the on-page engine finds nothing (not the old blanket string)", () => {
    const clean = renderReportHtml({
      ...FULL_MODEL,
      onpage: { pageCount: 18, findings: [], pagesWithFindings: 0, duplicateGroups: EMPTY },
    });
    expect(clean).toContain("No on-page issues found across 18 page");
    expect(clean).not.toContain("No basic on-page issues detected");
    // The findings/clean split prints even here, matching formatOnpageReport, which pushes that
    // line unconditionally. pagesWithFindings is measured on every crawl, so there is nothing
    // for the absence rule to protect.
    expect(clean).toMatch(/0 page\(s\) with findings;\s*18 clean\./);
  });

  it("prints the findings/clean split whenever there ARE findings too", () => {
    // FULL_MODEL: 40 of 42 pages carry a finding.
    expect(renderReportHtml(FULL_MODEL)).toMatch(/40 page\(s\) with findings;\s*2 clean\./);
  });

  it("shows a call-to-action when a section's data is absent", () => {
    const crawlOnly = renderReportHtml({ ...FULL_MODEL, gsc: null });
    expect(crawlOnly).toMatch(/pull_gsc_data/);
    // crawl absent -> every crawl-derived section is null (they co-vary in the real model).
    const gscOnly = renderReportHtml({
      ...FULL_MODEL,
      crawl: null,
      onpage: null,
      tech: null,
      schema: null,
    });
    expect(gscOnly).toMatch(/crawl_site/);
  });
});

/**
 * R1-a. The enriched audit sections: the engine output G1 computed and the report discarded.
 * A model whose lists actually carry rows — the counterpart to FULL_MODEL, whose lists are all
 * empty, so "prints when there are rows" and "stays silent when there are none" are asserted
 * against two different models rather than one ambiguous one.
 */
const ENRICHED: ReportModel = {
  ...FULL_MODEL,
  onpage: {
    ...FULL_MODEL.onpage!,
    duplicateGroups: {
      items: [{ hash: "abc123def456", urls: ["https://example.com/a", "https://example.com/b"] }],
      total: 1,
    },
  },
  tech: {
    ...FULL_MODEL.tech!,
    // A URL unique to THIS block. Sharing /gone with brokenInternalLinks below made the
    // 4xx list unpinnable: dropping it entirely left the URL on the page via the other block,
    // and the assertion passed anyway (measured — the mutation stayed green).
    clientErrorUrls: { items: ["https://example.com/notfound"], total: 1 },
    pagesTimed: 42,
    pagesSized: 42,
    slowPages: { items: [{ url: "https://example.com/slow", fetchMs: 9100 }], total: 1 },
    heavyPages: { items: [{ url: "https://example.com/fat", htmlBytes: 2_100_000 }], total: 1 },
    redirectChains: {
      items: [{ url: "https://example.com/final", chain: ["https://example.com/old"] }],
      total: 1,
    },
    xRobotsConflicts: {
      items: [{ url: "https://example.com/hidden", xRobotsTag: "noindex" }],
      total: 1,
    },
    deepPages: { items: [{ url: "https://example.com/deep", depth: 6 }], total: 1 },
    orphanSignals: { items: [{ url: "https://example.com/lonely", depth: 2 }], total: 1 },
    brokenInternalLinks: {
      items: [{ from: "https://example.com/", to: "https://example.com/gone", status: 404 }],
      total: 1,
    },
    skippedByCategory: [{ label: "robots", count: 2 }],
    sitemapDiff: {
      sitemapUrls: 50,
      missingFromCrawl: { items: ["https://example.com/orphaned"], total: 1 },
      missingFromSitemap: { items: [], total: 0 },
    },
  },
  schema: {
    ...FULL_MODEL.schema!,
    pagesValidated: 42,
    missingFields: {
      items: [{ url: "https://example.com/p", type: "Product", missing: ["offers"] }],
      total: 1,
    },
    invalidJson: { items: [{ url: "https://example.com/bad", blocks: 2 }], total: 1 },
    truncatedPages: { items: [{ url: "https://example.com/big", dropped: 3 }], total: 1 },
  },
};

describe("enriched audit sections (R1-a)", () => {
  const html = renderReportHtml(ENRICHED);

  it("names the URL behind every technical finding, not just the count", () => {
    // A number alone tells nobody which page to fix — the whole point of carrying these lists.
    // The 4xx LIST, distinct from the 4xx stat tile that carries the same words.
    expect(html).toMatch(/Client error pages \(4xx\)/);
    expect(html).toContain("https://example.com/notfound");
    expect(html).toContain("https://example.com/gone");
    expect(html).toContain("https://example.com/slow");
    expect(html).toContain("https://example.com/fat");
    expect(html).toContain("https://example.com/deep");
    expect(html).toContain("https://example.com/lonely");
    expect(html).toContain("https://example.com/hidden");
    expect(html).toMatch(/Broken internal links/);
    expect(html).toMatch(/https:\/\/example\.com\/old.*→.*https:\/\/example\.com\/final/s);
  });

  it("prints each threshold from the RULE'S OWN constant, never a retyped number", () => {
    // Interpolated from SLOW_PAGE_MS / HEAVY_PAGE_BYTES / DEEP_PAGE_DEPTH so the number the
    // reader is given and the number the rule used cannot drift apart.
    expect(html).toContain(`over ${SLOW_PAGE_MS.toLocaleString("en-US")} ms`);
    expect(html).toContain(`over ${HEAVY_PAGE_BYTES.toLocaleString("en-US")} bytes`);
    expect(html).toContain(`${DEEP_PAGE_DEPTH}+ clicks`);
    expect(html).toContain(`${REDIRECT_CHAIN_MIN}+ hops`);
  });

  it("renders the schema body findings and says how many pages were validated", () => {
    expect(html).toMatch(/Required fields missing/);
    expect(html).toContain("Product");
    expect(html).toContain("offers");
    expect(html).toMatch(/unparseable JSON-LD/);
    expect(html).toMatch(/only partly stored/);
    // Whitespace-tolerant: the note wraps in the template, so a literal-substring assertion
    // would fail here and — worse — its negative twin below would pass vacuously.
    expect(html).toMatch(/checked\s+against the stored JSON-LD bodies on 42 page\(s\)/);
  });

  it("renders the site-level duplicate-content group and the skip categories", () => {
    expect(html).toMatch(/Duplicate content/);
    expect(html).toContain("https://example.com/a");
    expect(html).toMatch(/Not crawled/);
    expect(html).toContain("robots");
  });

  it("prints the sitemap diff, which is measured even when one side is 0", () => {
    expect(html).toMatch(/Sitemap vs crawl/);
    expect(html).toContain("50 URL(s) read from the sitemap");
    expect(html).toContain("https://example.com/orphaned");
  });

  it("still emits every crawled URL as escaped TEXT, never as a link or a resource", () => {
    // R1-a widened WHAT is emitted, not HOW: the document must still issue no request on load.
    const hrefs = html.match(/href="[^"]*"/g) ?? [];
    expect(hrefs).toEqual(['href="https://seogrep.com"']);
    expect(html).not.toMatch(/\bsrc\s*=/i);
  });

  it("caps a long list and SAYS how many it left out", () => {
    const many = renderReportHtml({
      ...ENRICHED,
      tech: {
        ...ENRICHED.tech!,
        // 3 shown out of 30 measured: presenting the 3 as the finding is the silent-truncation
        // failure the pre-cap total exists to prevent.
        slowPages: {
          items: [1, 2, 3].map((n) => ({ url: `https://example.com/s${n}`, fetchMs: 9000 })),
          total: 30,
        },
      },
    });
    expect(many).toContain("… and 27 more");
  });
});

/**
 * Page speed as its own findable section (signature item 9, 2026-08-26).
 *
 * The signals were always in the report — buried as two lists inside "Technical health", where a
 * reader looking for speed had no reason to look. Lifting them out costs nothing (the crawl
 * already stored them) and changes no price, but it creates a NEW honesty problem the buried
 * version did not have: a section headed "Page speed" reads as a speed measurement, and ours is
 * a fetch timer, not a browser. Both halves are pinned below.
 */
describe("Page speed section (imza 9)", () => {
  const nSlow = SLOW_PAGE_MS.toLocaleString("en-US");
  const nHeavy = HEAVY_PAGE_BYTES.toLocaleString("en-US");

  /** Measured, and every page inside both thresholds — the only state that may print a zero. */
  const CLEAN: ReportModel = {
    ...FULL_MODEL,
    tech: { ...FULL_MODEL.tech!, pagesTimed: 42, pagesSized: 40 },
  };

  it("gives speed its own heading instead of burying it in Technical health", () => {
    const html = renderReportHtml(ENRICHED);
    expect(html).toMatch(/<h2>Page speed<\/h2>/);

    // POSITION, not mere presence: the findings must have LEFT the technical section. Asserting
    // only that "Slow pages" appears somewhere would pass just as well if nothing had moved.
    const techStart = html.indexOf("<h2>Technical health</h2>");
    const speedStart = html.indexOf("<h2>Page speed</h2>");
    expect(techStart).toBeGreaterThan(-1);
    expect(speedStart).toBeGreaterThan(techStart);
    const techBody = html.slice(techStart, speedStart);
    expect(techBody).not.toMatch(/slow pages/i);
    expect(techBody).not.toMatch(/heavy pages/i);
    expect(html.slice(speedStart)).toMatch(/slow pages/i);
    expect(html.slice(speedStart)).toMatch(/heavy pages/i);
  });

  it("says what the numbers ARE NOT — not lab Core Web Vitals, not field data", () => {
    // NEVER #7: a section called "Page speed" that stayed silent about its provenance would be
    // read as a Lighthouse score. The disclaimer ships in BOTH branches, so both are checked.
    for (const html of [renderReportHtml(ENRICHED), renderReportHtml(FULL_MODEL)]) {
      // WHITESPACE-TOLERANT: the copy wraps inside the template, so a literal-space regex would
      // fail on the line break — and its negative twin in the unmeasured test would then pass
      // vacuously, which is the failure mode that makes a green test worthless.
      expect(html).toMatch(/not\S*\s+lab\s+core\s+web\s+vitals/is);
      expect(html).toMatch(/not\S*\s+field\s+data\s+from\s+real\s+visitors/is);
      expect(html).toMatch(/crawler measurements/i);
      expect(html).toContain("audit_speed");
    }
  });

  it("prints both thresholds from the RULE'S constants, in the speed section itself", () => {
    const speed = renderReportHtml(ENRICHED).split("<h2>Page speed</h2>")[1]!;
    expect(speed).toContain(`over ${nSlow} ms`);
    expect(speed).toContain(`over ${nHeavy} bytes`);
  });

  it("reports an UNMEASURED crawl as unmeasured — never as a zero", () => {
    // FULL_MODEL is pagesTimed/pagesSized 0: a crawl stored before the fields existed. Its empty
    // lists are not evidence the site is fast, so the section may claim nothing about speed.
    const html = renderReportHtml(FULL_MODEL);
    expect(html).toMatch(/no fetch-time or HTML-size signal/i);
    expect(html).toMatch(/unmeasured rather than as zero/i);
    expect(html).toContain("crawl_site");
    expect(html).not.toMatch(/no measured page took longer/i);
    expect(html).not.toMatch(/fetch time measured on/i);
    expect(html).not.toMatch(/slow pages/i);
    expect(html).not.toMatch(/heavy pages/i);
  });

  it("reports a MEASURED, clean crawl with its coverage and an honest zero", () => {
    const html = renderReportHtml(CLEAN);
    // Each axis reports its OWN coverage: 42 timed, 40 sized. One number for both would be a
    // claim the model does not make.
    expect(html).toMatch(/Fetch time measured on\s*<strong>42<\/strong>\s*of\s*42 crawled page\(s\)/);
    expect(html).toMatch(/HTML size on\s*<strong>40<\/strong>/);
    expect(html).toMatch(
      new RegExp(`no measured page took longer than ${nSlow} ms.{0,80}${nHeavy} bytes`, "is"),
    );
    // Still no empty list headers: "clean" is said in a sentence, not as a "Slow pages (0)".
    expect(html).not.toMatch(/slow pages \(/i);
    expect(html).not.toMatch(/no fetch-time or HTML-size signal/i);
  });

  /**
   * THE MIXED CASES. Every fixture above moves both axes together — ENRICHED has findings on
   * both, CLEAN and FULL_MODEL have findings on neither — so both branch conditions could be
   * flipped without a single test noticing. The model-layer "lopsided" spec pins the COUNTING;
   * these two pin the SENTENCE the renderer picks from it, which is a different question.
   */
  it("treats a crawl measured on ONE axis as measured, not as unmeasured", () => {
    // fetchMs recorded, htmlBytes not. Requiring BOTH would report a crawl that WAS timed with
    // "no page here was measured on either axis" — a sentence that is simply false, and the
    // exact zero-for-a-missing-measurement failure this section exists to prevent, inverted.
    const html = renderReportHtml({
      ...FULL_MODEL,
      tech: { ...FULL_MODEL.tech!, pagesTimed: 42, pagesSized: 0 },
    });
    expect(html).toMatch(/Fetch time measured on\s*<strong>42<\/strong>/);
    expect(html).not.toMatch(/no fetch-time or HTML-size signal/i);
    // …and the axis nobody measured is reported as covering 0 pages, which is a COVERAGE fact,
    // not a finding: "HTML size on 0" says nobody looked, where "Heavy pages: 0" would claim
    // somebody looked and found nothing.
    expect(html).toMatch(/HTML size on\s*<strong>0<\/strong>/);
    expect(html).not.toMatch(/heavy pages \(/i);
  });

  it("does NOT call the site clean when only ONE axis is clean", () => {
    // Slow findings, no heavy ones. If either empty list were enough to print the all-clear, the
    // report would say "no measured page took longer than 3,000 ms" and then list the pages that
    // did — a public document contradicting itself two lines apart.
    const html = renderReportHtml({
      ...FULL_MODEL,
      tech: {
        ...FULL_MODEL.tech!,
        pagesTimed: 42,
        pagesSized: 42,
        slowPages: { items: [{ url: "https://example.com/slow", fetchMs: 9100 }], total: 3 },
        heavyPages: EMPTY,
      },
    });
    expect(html).not.toMatch(/no measured page took longer/i);
    expect(html).toMatch(/slow pages \(/i);
    expect(html).toContain("https://example.com/slow");
    // The heavy axis was measured and found nothing, so it stays SILENT rather than printing a 0.
    expect(html).not.toMatch(/heavy pages \(/i);
  });

  it("does NOT claim everything is clean when there ARE findings", () => {
    const html = renderReportHtml(ENRICHED);
    expect(html).toMatch(/Fetch time measured on/i);
    expect(html).not.toMatch(/no measured page took longer/i);
    expect(html).toContain("https://example.com/slow");
    expect(html).toContain("https://example.com/fat");
  });
});

describe("print, sharing, and accessibility (R1-e)", () => {
  const html = renderReportHtml(FULL_MODEL);

  it("carries a print stylesheet that keeps sections whole and stops burning ink", () => {
    // An agency report's primary distribution is a PDF, and the screen design fights the page.
    expect(html).toMatch(/@media print/);
    expect(html).toMatch(/box-shadow:\s*none/);
    expect(html).toMatch(/page-break-inside:\s*avoid/);
  });

  it("tells the RECIPIENT the link is public — the tool's reply never reaches them", () => {
    // The warning previously lived only in the MCP response, which the person who GENERATED the
    // report reads and the person who RECEIVES it never does.
    expect(html).toMatch(/Anyone with this link can open this report/);
    expect(html).toMatch(/needs no sign-in/);
  });

  it("promises only what revokeReportLink actually does", () => {
    // The action nulls public_slug; it deletes NOTHING and cannot recall what was already read.
    expect(html).toMatch(/can revoke the link/);
    expect(html).toMatch(/cannot un-share what has already been read/);
    expect(html).not.toMatch(/delete/i);
    expect(html).not.toMatch(/expires?\b/i);
    expect(html).not.toMatch(/password/i);
  });

  it("exposes a main landmark and scoped table headers", () => {
    expect(html).toMatch(/<main class="wrap">/);
    expect(html).toMatch(/<\/main>/);
    expect(html).not.toMatch(/<div class="wrap">/);
    // Without scope, a three-column data table reads as an undifferentiated run of numbers.
    const headers = html.match(/<th\b[^>]*>/g) ?? [];
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((th) => th.includes('scope="col"'))).toBe(true);
  });

  it("drops the below-AA text colour everywhere it was used", () => {
    // #a8a294 on the card measured ~2.3:1 — below AA at ANY size — and it coloured every stat
    // label, table header, hint and the footer: the small print was the unreadable print.
    expect(html).not.toContain("#a8a294");
  });
});

/**
 * R1-d. escapeHtml is applied at every sink in this file and always has been — but only four of
 * those sinks were pinned by a spec, so deleting it from any of the others turned nothing red.
 * A protection that is correct and unmeasured is one careless edit from being neither.
 *
 * EVERY assertion here is TWO-SIDED, and that is the whole point: "the raw tag is absent" passes
 * trivially when a section is not rendered at all, so each case also demands the ESCAPED form be
 * present. Only the pair proves the value reached the page and was neutralised on the way.
 */
const XSS = '"><img src=x onerror=alert(1)>';
/** What XSS must look like once escaped — asserted so absence alone is never the whole claim. */
const XSS_ESCAPED = "&lt;img src=x onerror=alert(1)&gt;";

function expectNeutralised(html: string): void {
  // No live tag, and no attribute break-out. "onerror=" is deliberately NOT asserted absent: it
  // survives inside the ESCAPED text, harmlessly, and forbidding it would only mean the payload
  // could never be checked for at all.
  expect(html).not.toMatch(/<img\b/i);
  expect(html).not.toContain('"><img');
  expect(html).toContain(XSS_ESCAPED);
}

describe("every dynamic value is escaped (R1-d)", () => {
  it("neutralises a hostile DOMAIN (header text AND the head meta description)", () => {
    // The domain reaches TWO sinks: the header line and reportDescription inside <meta content>.
    const html = renderReportHtml({ ...FULL_MODEL, domain: XSS });
    expectNeutralised(html);
    // The meta value is delimited by double quotes, so an unescaped payload would TERMINATE the
    // attribute and the rest would leak as live markup. Read the attribute back and check the
    // quote never survived: the capture below can only span the whole value if it did not.
    const meta = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
    expect(meta).toContain("&lt;img");
    expect(meta).not.toContain("<");
  });

  it("neutralises a hostile generatedAt (it is echoed raw when it will not parse)", () => {
    // isoDate returns its input unchanged when Date cannot read it, so this string reaches the
    // header and the meta description verbatim — escaping is the only thing standing there.
    const html = renderReportHtml({ ...FULL_MODEL, generatedAt: XSS });
    expectNeutralised(html);
  });

  it("neutralises a hostile crawl fetchedAt", () => {
    const html = renderReportHtml({
      ...FULL_MODEL,
      crawl: { ...FULL_MODEL.crawl!, fetchedAt: XSS },
    });
    expectNeutralised(html);
  });

  it("neutralises hostile GSC window dates", () => {
    const html = renderReportHtml({
      ...FULL_MODEL,
      gsc: { ...FULL_MODEL.gsc!, windowStart: XSS, windowEnd: XSS },
    });
    expectNeutralised(html);
  });

  it("neutralises a hostile pulledAt", () => {
    const html = renderReportHtml({
      ...FULL_MODEL,
      gsc: { ...FULL_MODEL.gsc!, pulledAt: XSS },
    });
    expectNeutralised(html);
  });

  it("neutralises a hostile report title", () => {
    // The title reaches <title> AND the <h1>.
    const html = renderReportHtml({ ...FULL_MODEL, title: XSS });
    expectNeutralised(html);
  });

  it("neutralises hostile crawled URLs in the enriched technical lists (R1-a)", () => {
    const html = renderReportHtml({
      ...ENRICHED,
      tech: { ...ENRICHED.tech!, slowPages: { items: [{ url: XSS, fetchMs: 9000 }], total: 1 } },
    });
    expectNeutralised(html);
  });

  it("neutralises a hostile crawled URL in the HEAVY pages list", () => {
    // The TWIN of the slow-pages case above, and it was missing: dropping urlText from the heavy
    // row left the whole suite green, because the only speed sink anyone had written a spec for
    // was the slow one. Two sinks render the same untrusted crawled URL, so two specs pin them.
    // This section is served verbatim on the public /r/<slug> page, whose own test stubs the
    // report body — so nothing over there pins it either.
    const html = renderReportHtml({
      ...ENRICHED,
      tech: {
        ...ENRICHED.tech!,
        // The slow list is emptied ON PURPOSE: sharing the payload with its twin is exactly how
        // an unescaped sink hides, because the assertion would then pass on the OTHER list's
        // escaping and say nothing at all about this one.
        slowPages: EMPTY,
        heavyPages: { items: [{ url: XSS, htmlBytes: 2_000_000 }], total: 1 },
      },
    });
    expectNeutralised(html);
  });

  it("neutralises a hostile X-Robots-Tag header value", () => {
    // A response HEADER is attacker-controlled on any site that reflects one.
    const html = renderReportHtml({
      ...ENRICHED,
      tech: {
        ...ENRICHED.tech!,
        xRobotsConflicts: { items: [{ url: "https://example.com/x", xRobotsTag: XSS }], total: 1 },
      },
    });
    expectNeutralised(html);
  });

  it("neutralises a hostile JSON-LD @type and missing-field name", () => {
    const html = renderReportHtml({
      ...ENRICHED,
      schema: {
        ...ENRICHED.schema!,
        missingFields: {
          items: [{ url: "https://example.com/p", type: XSS, missing: [XSS] }],
          total: 1,
        },
      },
    });
    expectNeutralised(html);
  });

  it("neutralises a hostile skip-category label", () => {
    const html = renderReportHtml({
      ...ENRICHED,
      tech: { ...ENRICHED.tech!, skippedByCategory: [{ label: XSS, count: 1 }] },
    });
    expectNeutralised(html);
  });

  it("neutralises hostile GSC queries and pages in the Opportunities section (R1-b)", () => {
    const html = renderReportHtml({
      ...FULL_MODEL,
      opportunities: {
        ...FULL_MODEL.opportunities!,
        quickWins: {
          items: [{ query: XSS, page: XSS, clicks: 1, impressions: 50, ctr: 0.02, position: 12 }],
          total: 1,
        },
      },
    });
    expectNeutralised(html);
  });

  /**
   * The two sinks a fresh referee's own mutation caught: dropping escapeHtml from the
   * cannibalization query, or urlText from the decay page, left the ENTIRE suite (1320 tests)
   * green. The Opportunities spec above varies only the QUICK-WINS row builder — one of three —
   * and the other two were never exercised with hostile data. Ders 14, on the row-builder axis:
   * "no holes left" is a claim about the axis you varied, and I had varied only one.
   */
  it("neutralises a hostile CANNIBALIZATION query", () => {
    const html = renderReportHtml({
      ...FULL_MODEL,
      opportunities: {
        ...FULL_MODEL.opportunities!,
        cannibalization: {
          items: [
            {
              query: XSS,
              total_impressions: 900,
              total_clicks: 40,
              pages: [
                { query: XSS, page: "https://example.com/c1", clicks: 30, impressions: 600, ctr: 0.05, position: 4 },
                { query: XSS, page: "https://example.com/c2", clicks: 10, impressions: 300, ctr: 0.03, position: 9 },
              ],
              branded: false,
            },
          ],
          total: 1,
        },
      },
    });
    expectNeutralised(html);
  });

  it("neutralises a hostile DECAY page URL", () => {
    const html = renderReportHtml({
      ...FULL_MODEL,
      opportunities: {
        ...FULL_MODEL.opportunities!,
        decay: {
          items: [
            {
              page: XSS,
              previous_clicks: 120,
              current_clicks: 40,
              clicks_lost: 80,
              drop_ratio: 0.667,
            },
          ],
          total: 1,
        },
      },
    });
    expectNeutralised(html);
  });

  it("neutralises a hostile duplicate-content URL", () => {
    const html = renderReportHtml({
      ...ENRICHED,
      onpage: {
        ...ENRICHED.onpage!,
        duplicateGroups: { items: [{ hash: "abc", urls: [XSS] }], total: 1 },
      },
    });
    expectNeutralised(html);
  });
});

/**
 * R1-c. A report generated today from a three-month-old measurement carried TODAY'S date at the
 * top and said nothing about the age of the data underneath it.
 */
describe("staleness honesty (R1-c)", () => {
  it("dates BOTH sections and warns when either is stale", () => {
    const html = renderReportHtml({
      ...FULL_MODEL,
      crawl: { ...FULL_MODEL.crawl!, ageDays: 95, stale: true },
      gsc: { ...FULL_MODEL.gsc!, ageDays: 62, stale: true },
    });
    expect(html).toMatch(/This data is 95 days old/);
    expect(html).toMatch(/This data is 62 days old/);
    // The warning names the ACTION, which is what makes it usable rather than merely true.
    expect(html).toMatch(/Run\s*<code>crawl_site<\/code>\s*again/);
    expect(html).toMatch(/Run\s*<code>pull_gsc_data<\/code>\s*again/);
  });

  it("dates the pull separately from the window it covers", () => {
    // WHEN it was asked vs WHICH DAYS were asked about: a 28-day window can be read from a pull
    // that ran this morning or one that ran in April.
    const html = renderReportHtml(FULL_MODEL);
    expect(html).toMatch(/Pulled 2026-07-19 \(today\)/);
    expect(html).toContain("2026-06-22"); // the window start is still its own fact
  });

  it("prints the age without a warning while the data is fresh", () => {
    const html = renderReportHtml(FULL_MODEL);
    expect(html).toMatch(/Crawl from 2026-07-18 \(1 day ago\)/);
    expect(html).not.toMatch(/This data is .* days old/);
  });

  it("makes NO freshness claim in either direction when the age is unknown", () => {
    // An undated crawl is not evidence of freshness, and not evidence of decay either.
    const html = renderReportHtml({
      ...FULL_MODEL,
      crawl: { ...FULL_MODEL.crawl!, fetchedAt: null, ageDays: null, stale: false },
      gsc: { ...FULL_MODEL.gsc!, pulledAt: null, ageDays: null, stale: false },
    });
    expect(html).toMatch(/Crawl timestamp unavailable/);
    expect(html).not.toMatch(/This data is/);
    expect(html).not.toMatch(/Pulled /);
  });
});

describe("Opportunities section (R1-b)", () => {
  const WITH_OPPS = renderReportHtml({
    ...FULL_MODEL,
    opportunities: {
      quickWins: {
        items: [
          {
            query: "seo audit tool",
            page: "https://example.com/audit",
            clicks: 3,
            impressions: 400,
            ctr: 0.0075,
            position: 12.4,
          },
        ],
        // 1 shown, 90 qualified — the shortlist is not the answer.
        total: 90,
      },
      cannibalization: {
        items: [
          {
            query: "seo checklist",
            total_impressions: 900,
            total_clicks: 40,
            pages: [
              { query: "seo checklist", page: "https://example.com/c1", clicks: 30, impressions: 600, ctr: 0.05, position: 4 },
              { query: "seo checklist", page: "https://example.com/c2", clicks: 10, impressions: 300, ctr: 0.03, position: 9 },
            ],
            branded: false,
          },
        ],
        total: 1,
      },
      brandedExcluded: 2,
      decay: {
        items: [
          {
            page: "https://example.com/fading",
            previous_clicks: 120,
            current_clicks: 40,
            clicks_lost: 80,
            drop_ratio: 0.667,
          },
        ],
        total: 1,
      },
    },
  });

  it("renders all three discovery engines' findings", () => {
    expect(WITH_OPPS).toMatch(/Quick wins/);
    expect(WITH_OPPS).toContain("seo audit tool");
    expect(WITH_OPPS).toContain("https://example.com/audit");
    expect(WITH_OPPS).toMatch(/Cannibalized queries/);
    expect(WITH_OPPS).toContain("seo checklist");
    expect(WITH_OPPS).toMatch(/Decaying pages/);
    expect(WITH_OPPS).toContain("https://example.com/fading");
    expect(WITH_OPPS).toContain("80"); // clicks lost
  });

  it("carries the engine's PRE-CAP total, not the length of the shortlist", () => {
    // 90 qualified, 1 shown. Presenting the shortlist as the whole answer is the silent
    // truncation findQuickWinsResult's `total` exists to prevent.
    expect(WITH_OPPS).toContain("Quick wins (position 8–20 with demand) (90)");
    expect(WITH_OPPS).toContain("… and 89 more");
  });

  it("SAYS how many branded queries it excluded rather than dropping them silently", () => {
    // A user whose biggest query vanished from the list is owed the reason.
    expect(WITH_OPPS).toMatch(/Excluded 2 branded queries/);
    expect(WITH_OPPS).toMatch(/sitelinks/);
  });

  it("presents itself as a summary and points at the deep tools, audit_content included", () => {
    expect(WITH_OPPS).toMatch(/This is a summary/);
    expect(WITH_OPPS).toMatch(/find_quick_wins/);
    expect(WITH_OPPS).toMatch(/detect_cannibalization/);
    expect(WITH_OPPS).toMatch(/analyze_content_decay/);
    // audit_content is a SEPARATE 12-credit tool; the report points at it, never runs it.
    expect(WITH_OPPS).toMatch(/audit_content/);
  });

  it("says so plainly when the engines found nothing (FULL_MODEL: all three empty)", () => {
    const html = renderReportHtml(FULL_MODEL);
    expect(html).toMatch(/No quick wins, cannibalization, or content decay found/);
    expect(html).not.toMatch(/Quick wins \(/);
    expect(html).not.toMatch(/Excluded \d+ branded/);
  });

  it("renders NO Opportunities section at all when there is no pull to analyze", () => {
    const noPull = renderReportHtml({ ...FULL_MODEL, gsc: null, opportunities: null });
    expect(noPull).not.toMatch(/<h2>Opportunities<\/h2>/);
  });
});

describe("absence is not a finding (R1-a)", () => {
  // FULL_MODEL is an ordinary crawl: every signal list empty, exactly as a crawl taken before
  // those signals existed. A "Slow pages: 0" header would report a measurement that, on the older
  // half of the stored corpus, never happened.
  const html = renderReportHtml(FULL_MODEL);

  it("prints NO header for a signal with no rows", () => {
    expect(html).not.toMatch(/Slow pages/);
    expect(html).not.toMatch(/Heavy pages/);
    expect(html).not.toMatch(/Redirect chains/);
    expect(html).not.toMatch(/Deep pages/);
    expect(html).not.toMatch(/orphan signal/);
    expect(html).not.toMatch(/X-Robots-Tag conflicts/);
    expect(html).not.toMatch(/Broken internal links/);
    expect(html).not.toMatch(/Client error pages/);
    expect(html).not.toMatch(/Duplicate content/);
    expect(html).not.toMatch(/Required fields missing/);
    expect(html).not.toMatch(/Not crawled/);
  });

  it("prints NO sitemap block when the crawl read no sitemap", () => {
    // Silence must never read as "your sitemap and crawl agree" — that claim needs a measurement.
    expect(html).not.toMatch(/Sitemap vs crawl/);
  });

  it("does NOT claim required fields were checked when no body was ever validated", () => {
    // pagesValidated === 0: the crawl predates the stored JSON-LD bodies.
    expect(html).toMatch(/only @type names are analyzed/);
    expect(html).not.toMatch(/checked\s+against the stored JSON-LD bodies/);
  });
});

/**
 * Live product test, 2026-08-07: on a project whose Search Console had been connected since
 * 2026-07-28, the report still printed "Connect it with connect_gsc" while whats_next said it
 * WAS connected. Two live tools contradicting each other about the same project. The section
 * must distinguish not-connected from connected-but-not-pulled.
 */
describe("Search performance section when there is no pull", () => {
  it("tells an UNCONNECTED project to connect", () => {
    const html = renderReportHtml({ ...FULL_MODEL, gsc: null, gscConnected: false });
    expect(html).toContain("connect_gsc");
    expect(html).toMatch(/No Search Console data yet/);
  });

  it("does NOT tell a CONNECTED project to connect — it asks for a pull", () => {
    const html = renderReportHtml({ ...FULL_MODEL, gsc: null, gscConnected: true });
    expect(html).toMatch(/Search Console is connected/);
    expect(html).toContain("pull_gsc_data");
    expect(html).not.toContain("connect_gsc");
  });
});
