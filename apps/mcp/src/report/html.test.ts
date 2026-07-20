import { describe, expect, it } from "vitest";
import type { ReportModel } from "./model.ts";
import { escapeHtml, renderReportHtml } from "./html.ts";

/**
 * Pure unit tests for the self-contained HTML renderer. The document must carry no external
 * request (all CSS inline), escape every dynamic value, and end with the D16
 * "powered by SeoGrep" footer.
 */

const FULL_MODEL: ReportModel = {
  domain: "example.com",
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
  },
  tech: {
    pageCount: 42,
    ok2xx: 39,
    redirect3xx: 1,
    clientError4xx: 2,
    serverError5xx: 0,
    robotsConflicts: 1,
  },
  schema: {
    pageCount: 42,
    pagesWithSchema: 30,
    topTypes: [
      { type: "Article", pages: 20 },
      { type: "WebPage", pages: 10 },
    ],
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
};

describe("escapeHtml", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeHtml(`<script>"a"&'b'`)).toBe("&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;");
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
    const clean = renderReportHtml({ ...FULL_MODEL, onpage: { pageCount: 18, findings: [] } });
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
