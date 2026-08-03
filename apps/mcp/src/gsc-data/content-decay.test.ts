import { describe, expect, it } from "vitest";
import { analyzeContentDecay } from "./content-decay.ts";
import { SAMPLE_PULL, gscRow, pullData } from "./fixtures.ts";
import { GSC_FRESHNESS_LAG_DAYS, computeWindows, type DateRange } from "./windows.ts";
import type { PullData } from "./types.ts";

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

/**
 * M-20 — the decay rule is only as honest as the window it reads.
 *
 * Search Console does not finalize the newest days, and it reports an unfinalized day as ZERO
 * rather than as "not in yet". A window that runs up to today therefore books a page's real
 * traffic as real zeros, and a page whose traffic never moved gets reported as decaying — the
 * user then spends credits rewriting a page that is fine.
 *
 * These cases drive the REAL computeWindows through the REAL decay engine over a property that
 * behaves exactly like Search Console does, so they fail the moment the analysis window reaches
 * into unfinalized days again. The thresholds are NOT under test here (they are pinned above);
 * the WINDOW is.
 */
describe("analyzeContentDecay over Search Console's freshness lag (M-20)", () => {
  const REFERENCE = new Date("2026-07-17T00:00:00Z");
  const PAGE = "https://shop.test/steady";
  const MS_PER_DAY = 86_400_000;

  /** The UTC days (YYYY-MM-DD) an inclusive range covers. */
  function daysIn(range: DateRange): string[] {
    const days: string[] = [];
    const last = Date.parse(`${range.end_date}T00:00:00Z`);
    for (let t = Date.parse(`${range.start_date}T00:00:00Z`); t <= last; t += MS_PER_DAY) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
    return days;
  }

  /** The newest day Search Console has finalized as of REFERENCE. */
  const lastFinalized = new Date(REFERENCE.getTime() - GSC_FRESHNESS_LAG_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  /**
   * One page's pull as Search Console would actually report it: a day contributes its REAL
   * clicks once finalized, and 0 before then. `clicksOnDay` is the page's true traffic.
   */
  function pullOverProperty(days: number, clicksOnDay: (day: string) => number): PullData {
    const windows = computeWindows(REFERENCE, days);
    const reported = (range: DateRange): number =>
      daysIn(range).reduce((sum, day) => sum + (day <= lastFinalized ? clicksOnDay(day) : 0), 0);
    return {
      days,
      current: {
        ...windows.current,
        rows: [gscRow({ query: "q", page: PAGE, clicks: reported(windows.current) })],
      },
      previous: {
        ...windows.previous,
        rows: [gscRow({ query: "q", page: PAGE, clicks: reported(windows.previous) })],
      },
    };
  }

  it("does NOT flag a perfectly stable page in the vulnerable band (days=7, shortest allowed)", () => {
    // 7 clicks every single day, forever — nothing about this page changed. With the window
    // ending at today, the 3 unfinalized days read as zeros: 49 -> 28 clicks, a 42.9% "drop".
    expect(analyzeContentDecay(pullOverProperty(7, () => 7))).toEqual([]);
  });

  it("does NOT flag a perfectly stable page at ANY window the tool accepts (7..90)", () => {
    for (let days = 7; days <= 90; days++) {
      expect(analyzeContentDecay(pullOverProperty(days, () => 7)), `days=${days}`).toEqual([]);
    }
  });

  it("does NOT flag a stable page whose daily clicks are large enough to clear both thresholds", () => {
    // The absolute threshold is the only thing that spared low-traffic pages; a busy page has
    // no such luck, so the biggest sites were the most exposed.
    expect(analyzeContentDecay(pullOverProperty(7, () => 500))).toEqual([]);
  });

  it("STILL flags a genuine decay — the window shift must not cost detection power", () => {
    // A real cliff: 10 clicks/day through 2026-07-07, then 1/day. This is the page collapsing,
    // not a reporting artifact, and it must be caught with or without the lag offset.
    const decays = analyzeContentDecay(
      pullOverProperty(7, (day) => (day <= "2026-07-07" ? 10 : 1)),
    );
    expect(decays).toHaveLength(1);
    expect(decays[0]?.page).toBe(PAGE);
    expect(decays[0]?.current_clicks).toBeLessThan(decays[0]!.previous_clicks);
    expect(decays[0]?.drop_ratio).toBeGreaterThan(0.8);
  });
});
