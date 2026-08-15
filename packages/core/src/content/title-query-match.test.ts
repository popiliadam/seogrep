import { describe, expect, it } from "vitest";
import {
  analyzeTitleQueryMatch,
  contentPageKey,
  CONTENT_STOPWORDS,
  MAX_CONTENT_MISMATCHES,
  meaningfulWords,
  type ContentPageRecord,
  type ContentQueryRow,
} from "./title-query-match.js";

/**
 * The audit_content engine, in full. Every case here is a rule the tool's copy promises, so each
 * one is written so that REMOVING the rule turns this file red rather than merely narrowing it.
 */

function row(over: Partial<ContentQueryRow> & { query: string; page: string }): ContentQueryRow {
  return { impressions: 100, clicks: 0, ...over };
}

function page(over: Partial<ContentPageRecord> & { url: string }): ContentPageRecord {
  return { title: null, h1s: [], ...over };
}

describe("meaningfulWords", () => {
  it("splits on punctuation and drops the stopwords", () => {
    expect(meaningfulWords("shoes for the trail, running!")).toEqual([
      "shoes",
      "trail",
      "running",
    ]);
  });

  it("drops the Turkish stopwords too", () => {
    expect(meaningfulWords("beyaz ve siyah bir masa ile sandalye")).toEqual([
      "beyaz",
      "siyah",
      "masa",
      "sandalye",
    ]);
  });

  it("yields nothing for a query made only of stopwords", () => {
    expect(meaningfulWords("the a an and")).toEqual([]);
  });

  it("keeps digits, which are part of what a page has to say", () => {
    expect(meaningfulWords("iphone 15 pro")).toEqual(["iphone", "15", "pro"]);
  });

  /**
   * The stopword list is a PRODUCT decision (every word on it is a word a page is no longer
   * required to carry), so it is pinned as a list rather than sampled — a silent addition here
   * silently converts real mismatches into passes.
   */
  it("is exactly the signed minimal bilingual list", () => {
    expect([...CONTENT_STOPWORDS]).toEqual([
      "the",
      "a",
      "an",
      "and",
      "or",
      "in",
      "on",
      "for",
      "to",
      "of",
      "ve",
      "ile",
      "bir",
    ]);
  });
});

describe("contentPageKey", () => {
  it("drops the #fragment Google emits for jump-link appearances", () => {
    expect(contentPageKey("https://shop.test/post#section")).toBe("https://shop.test/post");
  });

  it("treats a trailing slash as insignificant", () => {
    expect(contentPageKey("https://shop.test/post/")).toBe("https://shop.test/post");
  });

  it("leaves a bare origin alone rather than reducing it to a scheme", () => {
    expect(contentPageKey("https://shop.test/")).toBe("https://shop.test");
  });

  it("keeps the query string — it can be a genuinely different page", () => {
    expect(contentPageKey("https://shop.test/p?id=2")).toBe("https://shop.test/p?id=2");
  });
});

describe("what counts as a match", () => {
  it("a query whose every meaningful word is in the title is NOT reported", () => {
    const result = analyzeTitleQueryMatch(
      [row({ query: "running shoes", page: "https://shop.test/running" })],
      [page({ url: "https://shop.test/running", title: "The best running shoes of 2026" })],
    );
    expect(result.mismatches).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.analyzed).toBe(1);
  });

  /**
   * MUTATION GUARD (h1s). The words live ONLY in the h1 here, so an engine that read the title
   * alone would report this page — the exact false finding the two-field haystack exists to
   * prevent. Removing `h1s` from the haystack turns this red.
   */
  it("a word carried only by an h1 counts as said", () => {
    const result = analyzeTitleQueryMatch(
      [row({ query: "trail running shoes", page: "https://shop.test/trail" })],
      [
        page({
          url: "https://shop.test/trail",
          title: "Our 2026 collection",
          h1s: ["Trail running shoes for every season"],
        }),
      ],
    );
    expect(result.mismatches).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("reports the words that appear in neither the title nor any h1", () => {
    const result = analyzeTitleQueryMatch(
      [row({ query: "waterproof trail shoes", page: "https://shop.test/trail", clicks: 3 })],
      [page({ url: "https://shop.test/trail", title: "Trail shoes", h1s: ["Trail shoes"] })],
    );
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({
      query: "waterproof trail shoes",
      page: "https://shop.test/trail",
      title: "Trail shoes",
      missing_words: ["waterproof"],
      matched_words: 2,
      total_words: 3,
      clicks: 3,
    });
    expect(result.mismatches[0]?.match_ratio).toBeCloseTo(2 / 3, 10);
  });

  it("a page with no title and no h1 misses everything", () => {
    const result = analyzeTitleQueryMatch(
      [row({ query: "trail shoes", page: "https://shop.test/bare" })],
      [page({ url: "https://shop.test/bare" })],
    );
    expect(result.mismatches[0]).toMatchObject({
      title: null,
      missing_words: ["trail", "shoes"],
      matched_words: 0,
      total_words: 2,
      match_ratio: 0,
    });
  });

  it("matches case-insensitively, in both directions", () => {
    const result = analyzeTitleQueryMatch(
      [row({ query: "TRAIL Shoes", page: "https://shop.test/trail" })],
      [page({ url: "https://shop.test/trail", title: "trail SHOES" })],
    );
    expect(result.total).toBe(0);
  });

  /** The Turkish dotted capital lowercases to i + combining dot; the fold is what saves it. */
  it("matches a Turkish query against a title written in capitals", () => {
    const result = analyzeTitleQueryMatch(
      [row({ query: "istanbul ofis", page: "https://shop.test/ofis" })],
      [page({ url: "https://shop.test/ofis", title: "İSTANBUL OFİS MOBİLYALARI" })],
    );
    expect(result.total).toBe(0);
  });

  it("matches a word inside a longer word (substring, not token equality)", () => {
    const result = analyzeTitleQueryMatch(
      [row({ query: "shoe", page: "https://shop.test/trail" })],
      [page({ url: "https://shop.test/trail", title: "Trail shoes" })],
    );
    expect(result.total).toBe(0);
  });

  it("skips a query that has no meaningful word at all", () => {
    const result = analyzeTitleQueryMatch(
      [row({ query: "the and or", page: "https://shop.test/trail" })],
      [page({ url: "https://shop.test/trail", title: "Nothing in common" })],
    );
    expect(result.total).toBe(0);
    expect(result.analyzed).toBe(0);
  });

  it("folds a fragment row onto the crawled document and sums its demand", () => {
    const result = analyzeTitleQueryMatch(
      [
        row({ query: "waterproof shoes", page: "https://shop.test/trail#a", impressions: 30, clicks: 1 }),
        row({ query: "waterproof shoes", page: "https://shop.test/trail#b", impressions: 12, clicks: 2 }),
      ],
      [page({ url: "https://shop.test/trail", title: "Trail shoes" })],
    );
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({ impressions: 42, clicks: 3 });
    expect(result.unmatched_rows).toBe(0);
  });
});

describe("ordering and the shortlist cap", () => {
  /**
   * MUTATION GUARD (ordering). Clicks and impressions disagree on purpose: the low-click row is
   * the biggest missed opportunity and must lead. Sorting by clicks turns this red.
   */
  it("orders by impressions descending, not by clicks", () => {
    const result = analyzeTitleQueryMatch(
      [
        row({ query: "alpha widget", page: "https://shop.test/a", impressions: 90, clicks: 40 }),
        row({ query: "beta widget", page: "https://shop.test/b", impressions: 900, clicks: 1 }),
      ],
      [
        page({ url: "https://shop.test/a", title: "Page A" }),
        page({ url: "https://shop.test/b", title: "Page B" }),
      ],
    );
    expect(result.mismatches.map((m) => m.query)).toEqual(["beta widget", "alpha widget"]);
  });

  it("breaks an impressions tie by query, so the same input renders the same bytes", () => {
    const result = analyzeTitleQueryMatch(
      [
        row({ query: "zeta widget", page: "https://shop.test/z", impressions: 50 }),
        row({ query: "alpha widget", page: "https://shop.test/a", impressions: 50 }),
      ],
      [
        page({ url: "https://shop.test/z", title: "Z" }),
        page({ url: "https://shop.test/a", title: "A" }),
      ],
    );
    expect(result.mismatches.map((m) => m.query)).toEqual(["alpha widget", "zeta widget"]);
  });

  it("caps the shortlist at 50 and still reports the pre-cap total", () => {
    expect(MAX_CONTENT_MISMATCHES).toBe(50);
    const rows = Array.from({ length: 60 }, (_unused, i) =>
      row({ query: `widget-${i} missingword`, page: "https://shop.test/p", impressions: i + 1 }),
    );
    const result = analyzeTitleQueryMatch(rows, [
      page({ url: "https://shop.test/p", title: "A page about nothing relevant" }),
    ]);
    expect(result.mismatches).toHaveLength(MAX_CONTENT_MISMATCHES);
    expect(result.total).toBe(60);
    // The cap keeps the TOP of the ordering, not an arbitrary 50.
    expect(result.mismatches[0]?.impressions).toBe(60);
  });

  it("honours an explicit smaller limit without touching the total", () => {
    const rows = Array.from({ length: 5 }, (_unused, i) =>
      row({ query: `widget-${i} missingword`, page: "https://shop.test/p", impressions: i + 1 }),
    );
    const result = analyzeTitleQueryMatch(
      rows,
      [page({ url: "https://shop.test/p", title: "Unrelated" })],
      2,
    );
    expect(result.mismatches).toHaveLength(2);
    expect(result.total).toBe(5);
  });
});

describe("the join's own honesty", () => {
  it("counts a query whose page was never crawled instead of dropping it", () => {
    const result = analyzeTitleQueryMatch(
      [
        row({ query: "trail shoes", page: "https://shop.test/never-crawled" }),
        row({ query: "trail shoes", page: "https://shop.test/trail" }),
      ],
      [page({ url: "https://shop.test/trail", title: "Trail shoes" })],
    );
    expect(result.unmatched_rows).toBe(1);
    expect(result.analyzed).toBe(1);
    expect(result.matched_pages).toBe(1);
  });

  it("counts distinct analyzed pages, not analyzed pairs", () => {
    const result = analyzeTitleQueryMatch(
      [
        row({ query: "trail shoes", page: "https://shop.test/trail" }),
        row({ query: "hiking shoes", page: "https://shop.test/trail" }),
      ],
      [page({ url: "https://shop.test/trail", title: "Trail shoes" })],
    );
    expect(result.analyzed).toBe(2);
    expect(result.matched_pages).toBe(1);
  });

  it("an empty pull yields an empty, honest result", () => {
    const result = analyzeTitleQueryMatch([], [page({ url: "https://shop.test/", title: "Home" })]);
    expect(result).toEqual({
      mismatches: [],
      total: 0,
      analyzed: 0,
      unmatched_rows: 0,
      matched_pages: 0,
    });
  });

  it("an empty crawl reports every pair as unmatched, never as a finding", () => {
    const result = analyzeTitleQueryMatch(
      [
        row({ query: "trail shoes", page: "https://shop.test/trail" }),
        row({ query: "road shoes", page: "https://shop.test/road" }),
      ],
      [],
    );
    expect(result.total).toBe(0);
    expect(result.mismatches).toEqual([]);
    expect(result.unmatched_rows).toBe(2);
    expect(result.analyzed).toBe(0);
  });

  it("the first crawl record wins when two urls fold to one page", () => {
    const result = analyzeTitleQueryMatch(
      [row({ query: "trail shoes", page: "https://shop.test/trail" })],
      [
        page({ url: "https://shop.test/trail", title: "Trail shoes" }),
        page({ url: "https://shop.test/trail/", title: "Something else entirely" }),
      ],
    );
    expect(result.total).toBe(0);
  });
});
