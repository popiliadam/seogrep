import { describe, expect, it } from "vitest";
import { parseCrawlResult } from "./crawl-data.ts";
import type { Json } from "../db.ts";

/**
 * The audit view must carry the ABSENCE of the Faz 2/3 fields, not default it away — the same
 * contract crawl-data-signals.test.ts pins for the Faz 1 signals, and for the same reason: the
 * rule engines cannot re-derive a distinction the parser has already thrown away.
 *
 * THREE states, three meanings:
 *   undefined — the stored crawl predates the field (nobody looked);
 *   []        — the crawl looked and found nothing;
 *   non-empty — there is something to compare / validate.
 */

const LEGACY_PAGE = {
  url: "https://e/a",
  status: 200,
  title: null,
  metaDescription: null,
  h1s: [],
  canonical: null,
  robotsMeta: null,
  links: [],
  wordCount: 0,
  jsonLdTypes: ["Product"],
  issues: [],
};

function parse(result: Json): NonNullable<ReturnType<typeof parseCrawlResult>> {
  const crawl = parseCrawlResult(result);
  if (crawl === null) throw new Error("fixture must parse");
  return crawl;
}

describe("parseCrawlResult — the graph/body fields keep their absence", () => {
  it("an OLD-SHAPED result leaves sitemapUrls and jsonLdBlocks undefined", () => {
    const crawl = parse({ pages: [LEGACY_PAGE], skipped: [], fetchedAt: null });
    expect(crawl.sitemapUrls).toBeUndefined();
    expect(crawl.pages[0]?.jsonLdBlocks).toBeUndefined();
    expect(crawl.pages[0]?.jsonLdTruncated).toBeUndefined();
    // …while the field that has ALWAYS been defaulted keeps its default.
    expect(crawl.pages[0]?.jsonLdTypes).toEqual(["Product"]);
  });

  it("an EMPTY list is preserved as empty — it is a measurement, not an absence", () => {
    const crawl = parse({
      pages: [{ ...LEGACY_PAGE, jsonLdBlocks: [], jsonLdTruncated: 0 }],
      skipped: [],
      fetchedAt: null,
      sitemapUrls: [],
    });
    expect(crawl.sitemapUrls).toEqual([]);
    expect(crawl.pages[0]?.jsonLdBlocks).toEqual([]);
    expect(crawl.pages[0]?.jsonLdTruncated).toBe(0);
  });

  it("the values survive the jsonb round trip, non-strings dropped", () => {
    const crawl = parse({
      pages: [
        {
          ...LEGACY_PAGE,
          jsonLdBlocks: ['{"@type":"Product"}', 42, "{}"],
          jsonLdTruncated: 3,
        },
      ],
      skipped: [],
      fetchedAt: null,
      sitemapUrls: ["https://e/", 7, "https://e/b"],
    });
    expect(crawl.sitemapUrls).toEqual(["https://e/", "https://e/b"]);
    expect(crawl.pages[0]?.jsonLdBlocks).toEqual(['{"@type":"Product"}', "{}"]);
    expect(crawl.pages[0]?.jsonLdTruncated).toBe(3);
  });

  it("a NON-ARRAY sitemapUrls is treated as absent, not as an empty measurement", () => {
    const crawl = parse({ pages: [LEGACY_PAGE], skipped: [], fetchedAt: null, sitemapUrls: "nope" });
    expect(crawl.sitemapUrls).toBeUndefined();
  });
});
