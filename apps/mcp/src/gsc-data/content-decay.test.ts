import { describe, expect, it } from "vitest";
import { analyzeContentDecay, DECAY_MIN_DROP_RATIO } from "./content-decay.ts";
import { SAMPLE_PULL, gscRow, pullData } from "./fixtures.ts";
import { GSC_FRESHNESS_LAG_DAYS, computeWindows, type DateRange } from "./windows.ts";
import type { GscRow, PullData } from "./types.ts";

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
      // B-2: the row Google sent carries impressions and position too, and the engine threw both
      // away — so "I lost the ranking" and "I kept the ranking and lost the clicks" left this
      // function as the same finding and got the same instruction.
      previous_impressions: 640,
      current_impressions: 600,
      previous_position: 5.1,
      current_position: 6.4,
    });
  });

  /**
   * B-2, THE TWO CASES THE OLD SHAPE COULD NOT TELL APART — measured live 2026-09-03, where ten
   * decaying pages came back and not one carried an impression figure. R-7.12 is why this is not
   * academic: AI Overview impressions are INSIDE these numbers while their clicks are not, so a
   * page can hold every impression it had and still bleed clicks, and "refresh the content" is
   * not the answer to a SERP change.
   *
   * TWO fixtures that are IDENTICAL on the click axis — both fall 80 → 20 — so anything reading
   * clicks alone gives them the same answer, and this spec is the only thing separating them.
   */
  it("separates a page that lost its ranking from one that kept it and lost the clicks", () => {
    const row = (over: Partial<GscRow>): GscRow =>
      gscRow({ query: "q", page: "https://x.test/p", ...over });
    const previous = [row({ clicks: 80, impressions: 1000, position: 4 })];

    const lostRanking = analyzeContentDecay(
      pullData([row({ clicks: 20, impressions: 200, position: 28 })], previous),
    );
    expect(lostRanking[0]).toMatchObject({
      previous_impressions: 1000,
      current_impressions: 200,
      previous_position: 4,
      current_position: 28,
    });

    const keptRanking = analyzeContentDecay(
      pullData([row({ clicks: 20, impressions: 1000, position: 4.1 })], previous),
    );
    expect(keptRanking[0]).toMatchObject({
      previous_impressions: 1000,
      current_impressions: 1000,
      previous_position: 4,
      current_position: 4.1,
    });
    // The two are identical on the axis the engine used to read, which is the finding itself.
    expect(lostRanking[0]?.clicks_lost).toBe(keptRanking[0]?.clicks_lost);
  });

  /**
   * The average is IMPRESSION-WEIGHTED, the rule collapseFragments applies one level down
   * (document.ts): Google's own position is already an impression-weighted mean over appearances,
   * so a plain mean across a page's queries would invent a different kind of number. Here a plain
   * mean reads 15.5 while the weighted one reads 3.25 — the position most impressions were at.
   */
  it("averages a page's position across its queries by impressions, not by row count", () => {
    const pull = pullData(
      [
        gscRow({ query: "q1", page: "https://x.test/p", clicks: 2, impressions: 990, position: 3 }),
        gscRow({ query: "q2", page: "https://x.test/p", clicks: 0, impressions: 10, position: 28 }),
      ],
      [gscRow({ query: "q1", page: "https://x.test/p", clicks: 40, impressions: 900, position: 2 })],
    );
    const [decay] = analyzeContentDecay(pull);
    expect(decay?.current_position).toBeCloseTo(3.25, 10);
    expect(decay?.current_impressions).toBe(1000);
  });

  /**
   * A page that vanished from the current window has NO position there, and null is the honest
   * value: 0 would read as "pinned at the top" (the fixtures file's own caveat), and carrying the
   * previous window's number forward would claim a rank nobody measured.
   */
  it("reports no current position at all for a page that stopped appearing", () => {
    const pull = pullData(
      [],
      [gscRow({ query: "q", page: "https://x.test/p", clicks: 40, impressions: 900, position: 6 })],
    );
    expect(analyzeContentDecay(pull)[0]).toMatchObject({
      current_clicks: 0,
      current_impressions: 0,
      current_position: null,
      previous_position: 6,
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
        // This fixture models the CLICK axis only — its rows carry no impressions, and with no
        // impressions there is no weight to average a position by, which is what null says.
        previous_impressions: 0,
        current_impressions: 0,
        previous_position: null,
        current_position: null,
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
        // This fixture models the CLICK axis only, so its rows carry no impressions — and with no
        // impressions there is no weight to average a position by, which is what null says.
        previous_impressions: 0,
        current_impressions: 0,
        previous_position: null,
        current_position: null,
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
