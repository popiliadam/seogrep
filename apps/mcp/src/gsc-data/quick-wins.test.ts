import { describe, expect, it } from "vitest";
import { findQuickWins } from "./quick-wins.ts";
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
