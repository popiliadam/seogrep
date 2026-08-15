import { describe, expect, it } from "vitest";
import { analyzeContentDecay, DECAY_MIN_DROP_RATIO } from "./content-decay.ts";
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

  /**
   * The bigcattr shape (measured 2026-08-09, www.bigcattr.com), applied to the DECAY axis rather
   * than the cannibalization one: Google emits one row per SERP appearance and it draws jump-links
   * into an article's sections, so one article arrives as a bare row plus `#anchor` rows — and
   * WHICH anchors it draws is Google's decision, per window.
   *
   * So the click mass of a perfectly stable article can sit on the bare URL in the previous window
   * and on an anchor in the current one. Keyed by the raw page string that reads as a page which
   * lost every one of its 40 clicks, and the user is told to rewrite an article whose traffic did
   * not move. Keyed by the document, the totals are 40 and 40.
   */
  it("does NOT flag a stable article whose clicks moved between its bare URL and an #anchor", () => {
    const article = "https://www.bigcattr.com/blog/icerik/british-shorthair-kedi-cinsi";
    const pull = pullData(
      [
        gscRow({ query: "british kedi cinsleri", page: article, clicks: 0 }),
        gscRow({ query: "british kedi cinsleri", page: `${article}#renkler`, clicks: 40 }),
      ],
      [
        gscRow({ query: "british kedi cinsleri", page: article, clicks: 40 }),
        gscRow({ query: "british kedi cinsleri", page: `${article}#renkler`, clicks: 0 }),
      ],
    );
    expect(analyzeContentDecay(pull)).toEqual([]);
  });

  /**
   * THE COUNTERWEIGHT, so the fold above cannot be mistaken for "anchors are ignored": an article
   * that genuinely lost its clicks is still flagged, and it is reported under the DOCUMENT — the
   * URL the user can act on — even when every row Google returned carried a fragment.
   */
  it("still flags a real collapse, and names the document rather than an anchor", () => {
    const article = "https://x.test/guide";
    const pull = pullData(
      [gscRow({ query: "q", page: `${article}#intro`, clicks: 2 })],
      [
        gscRow({ query: "q", page: `${article}#intro`, clicks: 30 }),
        gscRow({ query: "q", page: `${article}#steps`, clicks: 10 }),
      ],
    );
    expect(analyzeContentDecay(pull)).toEqual([
      {
        page: article,
        previous_clicks: 40,
        current_clicks: 2,
        clicks_lost: 38,
        drop_ratio: 0.95,
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
const MS_PER_DAY = 86_400_000;
const REFERENCE = new Date("2026-07-17T00:00:00Z");
const PAGE = "https://shop.test/steady";

/** The UTC days (YYYY-MM-DD) an inclusive range covers. */
function daysIn(range: DateRange): string[] {
  const days: string[] = [];
  const last = Date.parse(`${range.end_date}T00:00:00Z`);
  for (let t = Date.parse(`${range.start_date}T00:00:00Z`); t <= last; t += MS_PER_DAY) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

describe("analyzeContentDecay over Search Console's freshness lag (M-20)", () => {
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

/**
 * M-20, made durable. The bounded claim in the public docs — "measured against lags of up to 5
 * days, no unfinalized day is read as a traffic collapse" (tools-reference/pull-gsc-data.mdx) —
 * rested on numbers that existed only in a transcript: no committed artifact backed them. Signed
 * lesson 9: a behaviour claim is not durable until something that RUNS measures it. This is that
 * something, and it states the SAME bound the doc does.
 *
 * The distinction the sweep turns on: GSC_FRESHNESS_LAG_DAYS is how far back WE end the window,
 * which is fixed. How far behind Search Console ACTUALLY is, is not ours to choose. Only the
 * difference — `actualLag - GSC_FRESHNESS_LAG_DAYS` days, call it k — lands inside the current
 * window unfinalized, so a perfectly stable page reads as a k/days drop. That clears the 30%
 * relative threshold once k >= 0.3 * days, and the shortest window the tool accepts (days=7) is
 * therefore the worst case: k=2 is 28.6% and survives, k=3 is 42.9% and does not.
 *
 * Pure sweep over computeWindows + analyzeContentDecay: no I/O, no wall clock, no fixtures.
 */
describe("analyzeContentDecay across the documented freshness-lag band (M-20)", () => {
  /** The largest ACTUAL Search Console lag the public docs claim protection through. */
  const MAX_PROTECTED_LAG_DAYS = 5;
  /** Well above DECAY_MIN_ABS_DROP, so the absolute threshold never masks a ratio failure. */
  const DAILY_CLICKS = 500;

  /**
   * One perfectly stable page — the same clicks every day, forever — reported the way Search
   * Console reports it when it is `actualLagDays` behind: a day inside the window contributes
   * its real clicks once finalized and 0 before then. Any decay found here is manufactured.
   */
  function stablePull(days: number, actualLagDays: number): PullData {
    const windows = computeWindows(REFERENCE, days);
    const lastFinalized = new Date(REFERENCE.getTime() - actualLagDays * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);
    const reported = (range: DateRange): number =>
      daysIn(range).reduce((sum, day) => sum + (day <= lastFinalized ? DAILY_CLICKS : 0), 0);
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

  it("flags nothing for a stable page at ANY lag 0..5 and ANY window 7..90", () => {
    for (let actualLag = 0; actualLag <= MAX_PROTECTED_LAG_DAYS; actualLag += 1) {
      for (let days = 7; days <= 90; days += 1) {
        expect(
          analyzeContentDecay(stablePull(days, actualLag)),
          `actualLag=${actualLag} days=${days}`,
        ).toEqual([]);
      }
    }
  });

  it("names the boundary explicitly: one day past the band, the same page IS flagged", () => {
    // The guard is bounded and the docs say so. Pinning where it ENDS is what stops "up to 5
    // days" from quietly being read as a promise about 6 — and it is the second half of the
    // regression alarm: shrink the lag constant or lose the window shift and the band closes
    // in, which the sweep above catches. Widen nothing silently either way.
    expect(analyzeContentDecay(stablePull(7, MAX_PROTECTED_LAG_DAYS))).toEqual([]);

    const overrun = analyzeContentDecay(stablePull(7, MAX_PROTECTED_LAG_DAYS + 1));
    expect(overrun).toHaveLength(1);
    expect(overrun[0]?.page).toBe(PAGE);
    // 3 of the 7 current days unfinalized: a 42.9% phantom drop, over the 30% threshold.
    expect(overrun[0]?.drop_ratio).toBeCloseTo(3 / 7, 10);
  });

  it("derives that bound from the constants rather than restating the number", () => {
    // Where 5 comes from: the window offset, plus however many unfinalized days the relative
    // threshold still tolerates in the SHORTEST window. Cut GSC_FRESHNESS_LAG_DAYS to 2 and this
    // expects 4 — so the doc's figure and the code's real behaviour cannot drift apart in silence.
    const shortestWindow = 7;
    const toleratedUnfinalizedDays = Math.ceil(DECAY_MIN_DROP_RATIO * shortestWindow) - 1;
    expect(GSC_FRESHNESS_LAG_DAYS + toleratedUnfinalizedDays).toBe(MAX_PROTECTED_LAG_DAYS);
  });
});
