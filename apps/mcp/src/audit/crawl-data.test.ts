import { describe, expect, it } from "vitest";
import { parseCrawlResult } from "./crawl-data.ts";
import type { Json } from "../db.ts";

/**
 * The audit input parser is the seam between persisted jsonb and the rule engines, so it
 * must be defensive: non-crawl blobs yield null, malformed pages/skips are dropped, and a
 * legacy result missing jsonLdTypes reads as [] (not a crash).
 */
describe("parseCrawlResult", () => {
  it("parses a well-formed crawl result", () => {
    const result: Json = {
      pages: [
        {
          url: "https://e/a",
          status: 200,
          title: "T",
          metaDescription: "M",
          h1s: ["h"],
          canonical: "https://e/a",
          robotsMeta: null,
          links: ["https://e/b"],
          wordCount: 300,
          jsonLdTypes: ["Article"],
        },
      ],
      skipped: [{ url: "https://e/x", reason: "timeout" }],
      fetchedAt: "2026-07-19T00:00:00.000Z",
    };
    const crawl = parseCrawlResult(result);
    expect(crawl?.pages).toHaveLength(1);
    expect(crawl?.pages[0]?.jsonLdTypes).toEqual(["Article"]);
    expect(crawl?.skipped).toEqual([{ url: "https://e/x", reason: "timeout" }]);
    expect(crawl?.fetchedAt).toBe("2026-07-19T00:00:00.000Z");
  });

  it("returns null for a non-crawl blob", () => {
    expect(parseCrawlResult(null)).toBeNull();
    expect(parseCrawlResult("nope")).toBeNull();
    expect(parseCrawlResult({ foo: 1 })).toBeNull();
    expect(parseCrawlResult([1, 2])).toBeNull();
  });

  it("defaults a legacy page missing jsonLdTypes to [] and drops a page with no url", () => {
    const result: Json = {
      pages: [
        { url: "https://e/a", status: 200, wordCount: 100 }, // pre-jsonLdTypes crawl
        { status: 200 }, // no url -> dropped
      ],
      skipped: [{ reason: "no url so dropped" }],
      fetchedAt: null,
    };
    const crawl = parseCrawlResult(result);
    expect(crawl?.pages).toHaveLength(1);
    expect(crawl?.pages[0]?.jsonLdTypes).toEqual([]);
    expect(crawl?.pages[0]?.h1s).toEqual([]);
    expect(crawl?.skipped).toEqual([]); // the url-less skip is dropped
    expect(crawl?.fetchedAt).toBeNull();
  });
});
