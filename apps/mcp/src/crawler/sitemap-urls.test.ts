import { describe, expect, it } from "vitest";
import {
  boundCrawlResult,
  crawlSite,
  MAX_SITEMAP_URLS_STORED,
  normalizeUrl,
  type CrawlResult,
} from "./crawl.ts";
import { MAX_FIELD_CHARS } from "./page-signals.ts";
import { startFixtureSite } from "./fixtures/site-server.ts";

/**
 * THE STORED SITEMAP LIST (Faz 2a). The crawl already parsed /sitemap.xml to seed itself; it
 * simply threw the list away afterwards, and with it the only thing that can answer "in the
 * sitemap but never crawled" from a stored result.
 *
 * The distinction this file exists to pin: `[]` (a crawl that LOOKED and found no usable
 * sitemap) is not the same answer as ABSENT (a result produced before anything looked), and
 * boundCrawlResult must not collapse the second into the first.
 */

const AT = "2026-08-14T00:00:00.000Z";
const page = (i: number) => ({
  url: `https://x.test/${i}`,
  status: 200,
  title: "t",
  metaDescription: "d",
  h1s: ["h"],
  canonical: null,
  robotsMeta: null,
  links: [],
  wordCount: 1,
  jsonLdTypes: [],
  jsonLdBlocks: [],
  jsonLdTruncated: 0,
  issues: [],
});

describe("crawlSite records what the sitemap advertised", () => {
  it("POSITIVE: every same-origin loc, even the ones the page budget never reached", async () => {
    const site = await startFixtureSite();
    try {
      // maxUrls 2 is the point: the fixture sitemap advertises five URLs and the crawl may only
      // fetch two of them. A list capped to what was CRAWLED would make the diff structurally
      // empty — the three pages nobody visited are exactly the finding.
      const result = await crawlSite(site.origin, { maxUrls: 2, crawlDelayCapMs: 0 });
      expect(result.pages).toHaveLength(2);
      expect(result.sitemapUrls).toEqual(
        ["/", "/about", "/blog", "/noindex", "/orphan"].map((p) => normalizeUrl(site.origin + p)),
      );
    } finally {
      await site.close();
    }
  });

  it("NEGATIVE: no usable sitemap means an EMPTY list — the crawl looked and found none", async () => {
    const site = await startFixtureSite({ sitemap: false });
    try {
      const result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
      expect(result.pages.length).toBeGreaterThan(0); // the BFS fallback still crawled
      expect(result.sitemapUrls).toEqual([]);
    } finally {
      await site.close();
    }
  });

  it("include_paths scopes the stored list exactly as it scopes the crawl", async () => {
    const site = await startFixtureSite();
    try {
      const result = await crawlSite(site.origin, { includePaths: ["/blog"], crawlDelayCapMs: 0 });
      expect(result.sitemapUrls).toEqual([normalizeUrl(site.origin + "/blog")]);
    } finally {
      await site.close();
    }
  });

  it("a blocked origin fetched nothing, so it advertises nothing", async () => {
    const result = await crawlSite("http://10.0.0.1/", { crawlDelayCapMs: 0 });
    expect(result.pages).toEqual([]);
    expect(result.sitemapUrls).toEqual([]);
  });
});

describe("boundCrawlResult bounds the sitemap list (H-02 discipline)", () => {
  it("BOUNDARY: 500 URLs survive, 501 are cut to 500 — the ceiling is pinned", () => {
    const urls = (count: number): string[] =>
      Array.from({ length: count }, (_, i) => `https://x.test/s${i}`);

    const exact = boundCrawlResult({ pages: [], skipped: [], fetchedAt: AT, sitemapUrls: urls(500) });
    expect(exact.sitemapUrls).toHaveLength(500);

    const over = boundCrawlResult({ pages: [], skipped: [], fetchedAt: AT, sitemapUrls: urls(600) });
    expect(over.sitemapUrls).toHaveLength(500);
    expect(over.sitemapUrls?.[499]).toBe("https://x.test/s499");

    expect(MAX_SITEMAP_URLS_STORED).toBe(500);
  });

  it("clamps an absurdly long loc to the shared field ceiling", () => {
    const monster = `https://x.test/${"a".repeat(50_000)}`;
    const bounded = boundCrawlResult({ pages: [], skipped: [], fetchedAt: AT, sitemapUrls: [monster] });
    expect(bounded.sitemapUrls?.[0]?.length).toBe(MAX_FIELD_CHARS + 1); // clampField marks the cut
  });

  it("ABSENT stays absent: a result that never measured a sitemap gains no empty list", () => {
    // The legacy shape — an injected crawl function written before the field existed. Defaulting
    // it to [] would tell the audit "a sitemap was read and held nothing", a measurement nobody
    // made, and the diff section would print on a crawl that cannot support it.
    const legacy: CrawlResult = { pages: [page(1)], skipped: [], fetchedAt: AT };
    const bounded = boundCrawlResult(legacy);
    expect(bounded.sitemapUrls).toBeUndefined();
    expect("sitemapUrls" in bounded).toBe(false);
  });
});
