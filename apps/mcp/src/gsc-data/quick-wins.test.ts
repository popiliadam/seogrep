import { describe, expect, it } from "vitest";
import { MAX_QUICK_WINS, findQuickWins, findQuickWinsResult } from "./quick-wins.ts";
import { SAMPLE_PULL, gscRow, pullData } from "./fixtures.ts";

/**
 * A quick win is a current-window (query, page) ranking in positions 8–20 with enough
 * impressions. The engine is pure, so the bands and the priority order are pinned exactly.
 */

describe("findQuickWins", () => {
  it("selects only rows in position 8–20 with >= 20 impressions, biggest opportunity first", () => {
    const wins = findQuickWins(SAMPLE_PULL);
    // /running (pos 11.2, 800 imp) and /trail-guide (pos 9.1, 400 imp) qualify; /trail
    // (pos 6.4, already winning), /sneakers (pos 2.3), and /niche (8 imp) do not.
    expect(wins.map((w) => w.page)).toEqual([
      "https://shop.test/running",
      "https://shop.test/trail-guide",
    ]);
  });

  it("excludes rows already winning (position < 8) and too-thin demand (< 20 impressions)", () => {
    const pull = pullData(
      [
        gscRow({ query: "already top", page: "https://x.test/top", impressions: 999, position: 7.9 }),
        gscRow({ query: "too thin", page: "https://x.test/thin", impressions: 19, position: 12 }),
        gscRow({ query: "off the map", page: "https://x.test/far", impressions: 999, position: 20.1 }),
      ],
      [],
    );
    expect(findQuickWins(pull)).toEqual([]);
  });

  it("includes the exact band boundaries (position 8 and 20, impressions 20)", () => {
    const pull = pullData(
      [
        gscRow({ query: "edge lo", page: "https://x.test/lo", impressions: 20, position: 8 }),
        gscRow({ query: "edge hi", page: "https://x.test/hi", impressions: 20, position: 20 }),
      ],
      [],
    );
    expect(findQuickWins(pull)).toHaveLength(2);
  });

  it("returns [] when the current window has no rows", () => {
    expect(findQuickWins(pullData([], []))).toEqual([]);
  });
});

/**
 * The #fragment axis, on the SELECTION side rather than the counting side. Google emits one row
 * per SERP appearance, so an article whose section anchors it draws jump-links for arrives as
 * several rows for one query, each carrying a slice of the article's real demand.
 *
 * That breaks quick wins in both directions at once, which is why both are pinned here.
 */
describe("findQuickWins over #fragment rows", () => {
  const article = "https://x.test/guide";

  it("merges a query's anchor rows into the document before reading the bands", () => {
    // Neither row clears the 20-impression floor alone (12 each); the article draws 24.
    const pull = pullData(
      [
        gscRow({ query: "how to x", page: article, impressions: 12, clicks: 1, position: 10 }),
        gscRow({ query: "how to x", page: `${article}#step-2`, impressions: 12, clicks: 0, position: 10 }),
      ],
      [],
    );
    const wins = findQuickWins(pull);
    expect(wins).toHaveLength(1);
    expect(wins[0]).toEqual({
      query: "how to x",
      page: article, // …and NOT "#step-2": a fragment is not a page anyone can edit
      impressions: 24,
      clicks: 1,
      position: 10,
      ctr: 1 / 24,
    });
  });

  it("prints the document even when the only qualifying row Google returned was an anchor", () => {
    const pull = pullData(
      [gscRow({ query: "how to x", page: `${article}#step-2`, impressions: 40, position: 12 })],
      [],
    );
    expect(findQuickWins(pull).map((w) => w.page)).toEqual([article]);
  });

  /** The other direction: one article under TWO queries is two opportunities, not one. */
  it("does NOT merge the same document across different queries", () => {
    const pull = pullData(
      [
        gscRow({ query: "q1", page: article, impressions: 40, position: 12 }),
        gscRow({ query: "q2", page: `${article}#s`, impressions: 30, position: 12 }),
      ],
      [],
    );
    expect(findQuickWins(pull).map((w) => w.query)).toEqual(["q1", "q2"]);
  });
});

/**
 * The shortlist cap, made visible. `findQuickWins` returns at most MAX_QUICK_WINS rows and used
 * to be the ONLY thing a caller got, so a site with hundreds of qualifying queries read "50 quick
 * wins" with nothing saying that was a slice. The pre-cap total is what the formatter needs to
 * say so (tools/find-quick-wins.ts formatGroupedQuickWins).
 */
describe("findQuickWinsResult carries the pre-cap total", () => {
  /** `count` distinct qualifying rows, all inside the bands. */
  function manyWins(count: number) {
    return pullData(
      Array.from({ length: count }, (_unused, i) =>
        gscRow({ query: `q-${i}`, page: `https://x.test/p-${i}`, impressions: 20 + i, position: 12 }),
      ),
      [],
    );
  }

  it("caps the shortlist while reporting how many cleared the bands", () => {
    const result = findQuickWinsResult(manyWins(MAX_QUICK_WINS + 7));
    expect(result.wins).toHaveLength(MAX_QUICK_WINS);
    expect(result.total).toBe(MAX_QUICK_WINS + 7);
  });

  it("reports total === wins.length when nothing was cut", () => {
    const result = findQuickWinsResult(manyWins(3));
    expect(result.total).toBe(3);
    expect(result.wins).toHaveLength(3);
  });

  /**
   * The fixture above is built FROM MAX_QUICK_WINS, so it slides with the constant and proves
   * only that a cap exists. This pins WHICH number ships — the MAX_HREFLANGS pattern.
   */
  it("caps at 50", () => {
    expect(MAX_QUICK_WINS).toBe(50);
  });
});
