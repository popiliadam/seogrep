import { describe, expect, it } from "vitest";
import { analyzeContentDecay } from "./content-decay.ts";
import { SAMPLE_PULL, gscRow, pullData } from "./fixtures.ts";

/**
 * Content decay = a page that lost a meaningful amount AND proportion of its clicks between
 * the previous and current windows. Clicks aggregate per page (a page can rank for several
 * queries). The engine is pure, so both thresholds and the ordering are pinned exactly.
 */

describe("analyzeContentDecay", () => {
  it("flags a page that lost both enough clicks and a big enough share", () => {
    const decays = analyzeContentDecay(SAMPLE_PULL);
    // /trail: 60 -> 30 clicks (lost 30, 50% down). Others moved by < 5 clicks.
    expect(decays).toHaveLength(1);
    expect(decays[0]).toEqual({
      page: "https://shop.test/trail",
      previous_clicks: 60,
      current_clicks: 30,
      clicks_lost: 30,
      drop_ratio: 0.5,
    });
  });

  it("does NOT flag a small absolute drop even at a high ratio", () => {
    const pull = pullData(
      [gscRow({ query: "q", page: "https://x.test/p", clicks: 1 })],
      [gscRow({ query: "q", page: "https://x.test/p", clicks: 4 })], // lost 3 (< 5) though 75% down
    );
    expect(analyzeContentDecay(pull)).toEqual([]);
  });

  it("does NOT flag a big absolute drop that is a small proportion", () => {
    const pull = pullData(
      [gscRow({ query: "q", page: "https://x.test/p", clicks: 90 })],
      [gscRow({ query: "q", page: "https://x.test/p", clicks: 100 })], // lost 10 but only 10% down
    );
    expect(analyzeContentDecay(pull)).toEqual([]);
  });

  it("aggregates a page's clicks across its queries before comparing", () => {
    const pull = pullData(
      [
        gscRow({ query: "q1", page: "https://x.test/p", clicks: 5 }),
        gscRow({ query: "q2", page: "https://x.test/p", clicks: 5 }),
      ],
      [
        gscRow({ query: "q1", page: "https://x.test/p", clicks: 40 }),
        gscRow({ query: "q2", page: "https://x.test/p", clicks: 40 }),
      ],
    );
    // 80 -> 10 clicks for the page overall: lost 70, 87.5% down.
    expect(analyzeContentDecay(pull)).toEqual([
      {
        page: "https://x.test/p",
        previous_clicks: 80,
        current_clicks: 10,
        clicks_lost: 70,
        drop_ratio: 0.875,
      },
    ]);
  });

  it("orders decays by clicks lost, biggest bleed first", () => {
    const pull = pullData(
      [
        gscRow({ query: "a", page: "https://x.test/a", clicks: 0 }),
        gscRow({ query: "b", page: "https://x.test/b", clicks: 0 }),
      ],
      [
        gscRow({ query: "a", page: "https://x.test/a", clicks: 20 }),
        gscRow({ query: "b", page: "https://x.test/b", clicks: 50 }),
      ],
    );
    expect(analyzeContentDecay(pull).map((d) => d.page)).toEqual([
      "https://x.test/b",
      "https://x.test/a",
    ]);
  });
});
