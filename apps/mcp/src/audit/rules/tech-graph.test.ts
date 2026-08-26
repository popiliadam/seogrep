import { describe, expect, it } from "vitest";
import { auditTech } from "./tech.ts";
import type { AuditCrawl, AuditPage, AuditSkipped } from "../crawl-data.ts";

/**
 * The Faz 2 GRAPH rules — sitemap↔crawl diff and broken internal links. POSITIVE / NEGATIVE /
 * FIELD-ABSENT for each, the contract tech-signals.test.ts set.
 *
 * The two negatives that carry the design are:
 *  - a sitemap URL the crawler SKIPPED is not "missing from the crawl" (it was accounted for), and
 *  - a link target this crawl never fetched is NOT a broken link (it has no measured status).
 * A rule that got either wrong would still pass its positive test.
 */

function page(p: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    status: 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 0,
    jsonLdTypes: [],
    ...p,
  };
}

const AT = "2026-08-14T00:00:00.000Z";
const crawl = (
  pages: AuditPage[],
  extra: { skipped?: AuditSkipped[]; sitemapUrls?: string[] } = {},
): AuditCrawl => ({
  pages,
  skipped: extra.skipped ?? [],
  fetchedAt: AT,
  ...(extra.sitemapUrls === undefined ? {} : { sitemapUrls: extra.sitemapUrls }),
});

describe("sitemap_diff", () => {
  it("POSITIVE: names both directions and the sitemap size it measured against", () => {
    const report = auditTech(
      crawl([page({ url: "https://e/" }), page({ url: "https://e/found-by-link" })], {
        sitemapUrls: ["https://e/", "https://e/never-crawled"],
      }),
    );
    expect(report.sitemapDiff).toEqual({
      sitemapUrls: 2,
      missingFromCrawl: ["https://e/never-crawled"],
      missingFromSitemap: ["https://e/found-by-link"],
    });
  });

  it("NEGATIVE: a SKIPPED sitemap URL was accounted for, so it is not a gap", () => {
    // The crawler decided not to fetch it and said so. Listing it here would turn the crawler's
    // own bounds (robots, budget, non-HTML) into findings about the site.
    const report = auditTech(
      crawl([page({ url: "https://e/" })], {
        skipped: [{ url: "https://e/private", reason: "blocked by robots.txt" }],
        sitemapUrls: ["https://e/", "https://e/private"],
      }),
    );
    expect(report.sitemapDiff).toEqual({
      sitemapUrls: 2,
      missingFromCrawl: [],
      missingFromSitemap: [],
    });
  });

  it("NEGATIVE: a trailing slash is not a different page", () => {
    const report = auditTech(
      crawl([page({ url: "https://e/about" })], { sitemapUrls: ["https://e/about/"] }),
    );
    expect(report.sitemapDiff?.missingFromCrawl).toEqual([]);
    expect(report.sitemapDiff?.missingFromSitemap).toEqual([]);
  });

  it("ABSENT: no sitemapUrls at all — the section does not exist (null, not an empty diff)", () => {
    // The legacy shape. An empty diff would claim "your sitemap and your crawl agree", which is
    // precisely what a crawl with no sitemap list cannot support.
    expect(auditTech(crawl([page({ url: "https://e/" })])).sitemapDiff).toBeNull();
  });

  it("EMPTY: a crawl that looked and found no usable sitemap also claims nothing", () => {
    expect(auditTech(crawl([page({ url: "https://e/" })], { sitemapUrls: [] })).sitemapDiff).toBeNull();
  });
});

describe("broken_internal_links", () => {
  it("POSITIVE: a link to a page this crawl fetched and got a 404 from", () => {
    const report = auditTech(
      crawl([
        page({ url: "https://e/", links: ["https://e/gone", "https://e/ok"] }),
        page({ url: "https://e/gone", status: 404 }),
        page({ url: "https://e/ok", status: 200 }),
      ]),
    );
    expect(report.brokenInternalLinks).toEqual([
      { from: "https://e/", to: "https://e/gone", status: 404 },
    ]);
  });

  it("POSITIVE: 5xx counts too, and each SOURCE page is reported separately", () => {
    const report = auditTech(
      crawl([
        page({ url: "https://e/a", links: ["https://e/down"] }),
        page({ url: "https://e/b", links: ["https://e/down"] }),
        page({ url: "https://e/down", status: 503 }),
      ]),
    );
    expect(report.brokenInternalLinks).toEqual([
      { from: "https://e/a", to: "https://e/down", status: 503 },
      { from: "https://e/b", to: "https://e/down", status: 503 },
    ]);
  });

  /**
   * The crawl is bounded. A link to a page outside its budget, or off-site, is not evidence of
   * anything — counting it would report a 404 the crawler never saw.
   *
   * THE FIXTURE CARRIES A REAL BROKEN PAGE ON PURPOSE, and it was not always so: the first draft
   * of this spec fed a crawl with no 4xx page at all, and a mutation that counted every
   * uncrawled target as a 404 left it GREEN — the rule short-circuits when nothing is broken, so
   * the assertion was defended by that early exit rather than by the guard it claims to pin.
   */
  it("NEGATIVE: a target this crawl never fetched has NO status and is not counted", () => {
    const report = auditTech(
      crawl([
        page({
          url: "https://e/",
          links: ["https://e/never-fetched", "https://other.test/x", "https://e/gone"],
        }),
        page({ url: "https://e/gone", status: 404 }),
      ]),
    );
    // ONLY the measured one. The uncrawled and the off-site target contribute nothing, on a crawl
    // where the rule is demonstrably firing.
    expect(report.brokenInternalLinks).toEqual([
      { from: "https://e/", to: "https://e/gone", status: 404 },
    ]);
  });

  it("NEGATIVE: a healthy site produces nothing, and a redirect (3xx) is not broken", () => {
    const report = auditTech(
      crawl([
        page({ url: "https://e/", links: ["https://e/moved", "https://e/ok"] }),
        page({ url: "https://e/moved", status: 301 }),
        page({ url: "https://e/ok", status: 200 }),
      ]),
    );
    expect(report.brokenInternalLinks).toEqual([]);
  });

  it("normalizes trailing slashes on BOTH sides, and reports one row per source", () => {
    const report = auditTech(
      crawl([
        page({ url: "https://e/", links: ["https://e/gone/", "https://e/gone"] }),
        page({ url: "https://e/gone", status: 410 }),
      ]),
    );
    expect(report.brokenInternalLinks).toEqual([
      { from: "https://e/", to: "https://e/gone", status: 410 },
    ]);
  });

  it("FIELD-ABSENT: an old-shaped crawl with no new fields reports an empty list", () => {
    const report = auditTech(
      crawl([page({ url: "https://e/", links: ["https://e/a"] }), page({ url: "https://e/a" })]),
    );
    expect(report.brokenInternalLinks).toEqual([]);
    expect(report.sitemapDiff).toBeNull();
  });
});
