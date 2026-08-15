import { describe, expect, it } from "vitest";
import {
  collapseFragments,
  collapseFragmentsAcrossQueries,
  documentOf,
  groupByQuery,
} from "./document.ts";
import { gscRow } from "./fixtures.ts";

/**
 * The shared identity rule: a row is ABOUT a document, and the #fragment is not part of it.
 * detect_cannibalization's own suite already measures this rule end-to-end through its engine
 * (cannibalization.test.ts, unchanged by the extraction). These pin the module directly, because
 * two other engines now depend on it and neither of them counts pages the way cannibalization
 * does.
 */

describe("documentOf", () => {
  it("drops the fragment and keeps everything before it", () => {
    expect(documentOf("https://x.test/a#section")).toBe("https://x.test/a");
    expect(documentOf("https://x.test/a")).toBe("https://x.test/a");
  });

  it("keeps a trailing slash and a query string — both CAN address another document", () => {
    expect(documentOf("https://x.test/a/")).toBe("https://x.test/a/");
    expect(documentOf("https://x.test/a?page=2")).toBe("https://x.test/a?page=2");
    expect(documentOf("https://x.test/a?page=2#top")).toBe("https://x.test/a?page=2");
  });

  it("folds a value that is not a parseable URL rather than throwing", () => {
    expect(documentOf("/relative/path#frag")).toBe("/relative/path");
  });
});

describe("collapseFragments", () => {
  it("sums clicks and impressions, weights position by impressions, recomputes ctr", () => {
    const merged = collapseFragments([
      gscRow({ query: "q", page: "https://x.test/a", impressions: 100, clicks: 10, position: 2 }),
      gscRow({ query: "q", page: "https://x.test/a#s", impressions: 300, clicks: 5, position: 10 }),
    ]);
    expect(merged).toEqual([
      {
        query: "q",
        page: "https://x.test/a",
        impressions: 400,
        clicks: 15,
        position: 8, // (2×100 + 10×300) / 400 — NOT the best position (2) or the mean (6)
        ctr: 0.0375, // 15/400, recomputed rather than carried from either row
      },
    ]);
  });

  it("strips the fragment from a lone anchor row without touching its numbers", () => {
    expect(
      collapseFragments([
        gscRow({ query: "q", page: "https://x.test/a#s", impressions: 30, clicks: 3, position: 9 }),
      ]),
    ).toEqual([
      { query: "q", page: "https://x.test/a", impressions: 30, clicks: 3, position: 9, ctr: 0 },
    ]);
  });

  it("keeps a merged row finite when the document drew no impressions at all", () => {
    const merged = collapseFragments([
      gscRow({ query: "q", page: "https://x.test/a", position: 4 }),
      gscRow({ query: "q", page: "https://x.test/a#s", position: 8 }),
    ]);
    expect(merged[0]?.position).toBe(6); // the unweighted mean, not NaN
    expect(merged[0]?.ctr).toBe(0);
  });
});

describe("groupByQuery / collapseFragmentsAcrossQueries", () => {
  it("groups rows by query, keeping first-seen order", () => {
    const grouped = groupByQuery([
      gscRow({ query: "b", page: "https://x.test/1" }),
      gscRow({ query: "a", page: "https://x.test/2" }),
      gscRow({ query: "b", page: "https://x.test/3" }),
    ]);
    expect([...grouped.keys()]).toEqual(["b", "a"]);
    expect(grouped.get("b")).toHaveLength(2);
  });

  /**
   * The half a per-query fold cannot be assumed to get right: the SAME article under two
   * different queries must stay two rows, because a (query, page) pair is what these tools rank
   * and report. Folding on the document alone would merge two unrelated opportunities into one.
   */
  it("folds fragments WITHIN a query and never merges across queries", () => {
    const rows = collapseFragmentsAcrossQueries([
      gscRow({ query: "q1", page: "https://x.test/a", impressions: 10 }),
      gscRow({ query: "q1", page: "https://x.test/a#s", impressions: 20 }),
      gscRow({ query: "q2", page: "https://x.test/a", impressions: 40 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.query, r.page, r.impressions])).toEqual([
      ["q1", "https://x.test/a", 30],
      ["q2", "https://x.test/a", 40],
    ]);
  });
});
