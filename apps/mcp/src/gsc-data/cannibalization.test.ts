import { describe, expect, it } from "vitest";
import { detectCannibalization } from "./cannibalization.ts";
import { SAMPLE_PULL, gscRow, pullData } from "./fixtures.ts";

/**
 * Cannibalization = one query with >= 2 of the site's pages each taking a meaningful share
 * of its impressions. The engine is pure, so the "meaningful share" floors and the grouping
 * are pinned exactly — a dominant page plus a negligible straggler must NOT be flagged.
 */

describe("detectCannibalization", () => {
  it("groups a query whose two pages each clear the impression + share floors", () => {
    const groups = detectCannibalization(SAMPLE_PULL);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.query).toBe("trail shoes");
    expect(groups[0]!.total_impressions).toBe(1000);
    expect(groups[0]!.pages.map((p) => p.page)).toEqual([
      "https://shop.test/trail", // 600 impressions, listed first
      "https://shop.test/trail-guide", // 400 impressions
    ]);
  });

  it("does NOT flag a dominant page with a negligible straggler (< 10% share)", () => {
    const pull = pullData(
      [
        gscRow({ query: "q", page: "https://x.test/main", impressions: 950 }),
        gscRow({ query: "q", page: "https://x.test/tiny", impressions: 50 }), // 5% share -> not a competitor
      ],
      [],
    );
    expect(detectCannibalization(pull)).toEqual([]);
  });

  it("does NOT flag a page below the absolute impression floor even at a high share", () => {
    const pull = pullData(
      [
        gscRow({ query: "q", page: "https://x.test/a", impressions: 9 }),
        gscRow({ query: "q", page: "https://x.test/b", impressions: 8 }),
      ],
      [],
    );
    // Both are ~50% share but each has < 10 impressions -> no meaningful competition.
    expect(detectCannibalization(pull)).toEqual([]);
  });

  it("does NOT flag a query served by a single page", () => {
    const pull = pullData([gscRow({ query: "solo", page: "https://x.test/solo", impressions: 500 })], []);
    expect(detectCannibalization(pull)).toEqual([]);
  });

  it("orders groups by total impressions, biggest query first", () => {
    const pull = pullData(
      [
        gscRow({ query: "small", page: "https://x.test/s1", impressions: 60 }),
        gscRow({ query: "small", page: "https://x.test/s2", impressions: 40 }),
        gscRow({ query: "big", page: "https://x.test/b1", impressions: 600 }),
        gscRow({ query: "big", page: "https://x.test/b2", impressions: 400 }),
      ],
      [],
    );
    expect(detectCannibalization(pull).map((g) => g.query)).toEqual(["big", "small"]);
  });
});
