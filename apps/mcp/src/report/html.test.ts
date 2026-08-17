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
