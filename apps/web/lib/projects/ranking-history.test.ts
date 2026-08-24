import { describe, expect, it } from "vitest";
import {
  GAP_SENTENCE,
  MAX_CONTIGUOUS_GAP_HOURS,
  RANKING_HISTORY_LIMIT,
  TRACKED_KEYWORD_LIMIT,
  buildRankingHistory,
  describeInterval,
  describeReading,
  describeSubscription,
  elapsedClause,
  formatReadingTime,
  isGap,
  seriesKeyOf,
  type MeasurementRow,
  type RankingSeries,
  type TrackedKeywordRow,
} from "./ranking-history";

/**
 * The /app/rankings decision layer, driven directly — the half no render spec and no source pin can
 * reach. `page.tsx` is an async Server Component and vitest has no RSC boundary (signed lesson 12),
 * so everything that decides WHAT MAY HONESTLY BE SAID lives in this pure module and is measured
 * here: which readings are one series, which pairs may be subtracted, what an untracked
 * subscription means, and where the window's ceiling actually bites.
 *
 * Sentences are matched with a case-insensitive REGEX on the shortest distinctive fragment, never
 * as a pasted sentence: a literal-matched spec silently stops testing the moment the copy is
 * reworded (signed lesson 11).
 */

const BASE: MeasurementRow = {
  id: "00000000-0000-4000-8000-000000000001",
  project_id: "project-1",
  keyword: "seo tools",
  target_domain: "mine.test",
  location_name: "United States",
  language_code: "en",
  device: "desktop",
  search_engine: "google",
  depth_requested: 100,
  domain_match_rule: "host-or-subdomain",
  status: "ranked",
  best_rank_group: 7,
  best_rank_absolute: 9,
  organic_items_examined: 100,
  not_measured_reason: null,
  vendor_reported_time_field: null,
  vendor_reported_time_value: null,
  fetched_at: "2026-08-10T09:00:00.000Z",
};

function row(over: Partial<MeasurementRow> = {}): MeasurementRow {
  return { ...BASE, ...over };
}

const TRACKED: TrackedKeywordRow = {
  id: "10000000-0000-4000-8000-000000000001",
  project_id: "project-1",
  keyword: "seo tools",
  location_name: "United States",
  language_code: "en",
  device: "desktop",
  created_at: "2026-07-01T09:00:00.000Z",
  untracked_at: null,
};

function tracked(over: Partial<TrackedKeywordRow> = {}): TrackedKeywordRow {
  return { ...TRACKED, ...over };
}

/** Two readings of one series, newest first, as the builder returns them. */
function seriesOf(rows: readonly MeasurementRow[], limit?: number): readonly RankingSeries[] {
  return buildRankingHistory(rows, [], limit).series;
}

describe("a series is everything a reading was measured under", () => {
  /**
   * THE FIVE THE SUBSCRIPTION NAMES. 0030 argues each: "seo tools" on the US desktop SERP and on
   * the UK mobile SERP are two different questions with two different answers, so a reading that
   * differs in any one of them belongs to another series and must never be compared with this one.
   */
  it.each([
    ["target_domain", { target_domain: "rival.test" }],
    ["keyword", { keyword: "rank tracker" }],
    ["location_name", { location_name: "United Kingdom" }],
    ["language_code", { language_code: "tr" }],
    ["device", { device: "mobile" }],
  ])("forks the series when %s differs", (_name, over) => {
    const series = seriesOf([row(), row({ id: "b", ...over, fetched_at: "2026-08-09T09:00:00.000Z" })]);
    expect(series).toHaveLength(2);
    expect(series.every((one) => one.readings.length === 1)).toBe(true);
  });

  /**
   * …AND THE THREE THE CALLER DOES NOT CHOOSE. The MCP tool that reads this same table keys on
   * these too, and the panel must not tell a second story about one table: "not found in the 10
   * results examined" and "not found in the 100 results examined" answer different questions, so a
   * re-priced depth would otherwise print as a movement nobody measured.
   */
  it.each([
    ["search_engine", { search_engine: "bing" }],
    ["depth_requested", { depth_requested: 10 }],
    ["domain_match_rule", { domain_match_rule: "exact-host" }],
  ])("forks the series when %s differs", (_name, over) => {
    const series = seriesOf([row(), row({ id: "b", ...over, fetched_at: "2026-08-09T09:00:00.000Z" })]);
    expect(series).toHaveLength(2);
  });

  /**
   * THE SEPARATOR CANNOT BE FORGED. Two parts may contain spaces, so a space-joined key would let
   * keyword "seo tools united" in location "States" collide with keyword "seo tools" in location
   * "United States" — one series, with a movement between two different questions.
   */
  it("does not let a keyword and a location run together into one key", () => {
    const left = row({ keyword: "seo tools united", location_name: "States" });
    const right = row({ keyword: "seo tools", location_name: "United States" });
    expect(seriesKeyOf(left)).not.toBe(seriesKeyOf(right));
    expect(seriesOf([left, row({ ...right, id: "b" })])).toHaveLength(2);
  });

  it("keeps two readings of ONE identity in one series, newest first", () => {
    const [series] = seriesOf([
      row({ id: "old", fetched_at: "2026-08-01T09:00:00.000Z", best_rank_group: 9 }),
      row({ id: "new", fetched_at: "2026-08-10T09:00:00.000Z", best_rank_group: 4 }),
    ]);
    expect(series?.readings.map((reading) => reading.id)).toEqual(["new", "old"]);
  });
});

describe("the order is TOTAL, not merely newest-first", () => {
  /**
   * ONE SNAPSHOT WRITES A ROW PER KEYWORD, so two readings can share a `fetched_at` exactly. With
   * `fetched_at` as the only key their relative order is undefined — in Postgres and in a JS sort
   * — and on this page that order decides which reading the interval clause is attached to. `id`
   * is the primary key, so breaking the tie on it makes the order total and the sentence defined.
   */
  it("breaks a fetched_at tie on id, descending, whatever order the rows arrive in", () => {
    const same = "2026-08-10T09:00:00.000Z";
    const rows = [
      row({ id: "aaa", fetched_at: same }),
      row({ id: "ccc", fetched_at: same }),
      row({ id: "bbb", fetched_at: same }),
    ];
    const forwards = seriesOf(rows)[0]?.readings.map((reading) => reading.id);
    const backwards = seriesOf([...rows].reverse())[0]?.readings.map((reading) => reading.id);
    expect(forwards).toEqual(["ccc", "bbb", "aaa"]);
    expect(backwards).toEqual(forwards);
  });
});

describe("what may honestly be subtracted from what", () => {
  function intervalBetween(newer: Partial<MeasurementRow>, older: Partial<MeasurementRow>) {
    const [series] = seriesOf([
      row({ id: "new", fetched_at: "2026-08-10T09:00:00.000Z", ...newer }),
      row({ id: "old", fetched_at: "2026-08-10T06:00:00.000Z", ...older }),
    ]);
    return series?.readings[0]?.interval;
  }

  it("subtracts two ranked readings that both carry a rank_group", () => {
    const interval = intervalBetween({ best_rank_group: 4 }, { best_rank_group: 7 });
    expect(interval?.comparison).toEqual({ kind: "positions", from: 7, to: 4 });
    expect(describeInterval(interval!)).toMatch(/#7 → #4/);
  });

  /**
   * A NON-MEASUREMENT IS NEVER AN ENDPOINT. `not_measured` means the vendor did not answer —
   * nothing was examined — so a comparison across it would be a claim about an unobserved moment.
   * It is checked BEFORE every other branch, and it is never worded as "not found".
   */
  it.each([
    ["the newer reading", { status: "not_measured", best_rank_group: null, best_rank_absolute: null, organic_items_examined: null, not_measured_reason: "vendor timeout" }, {}],
    ["the older reading", {}, { status: "not_measured", best_rank_group: null, best_rank_absolute: null, organic_items_examined: null, not_measured_reason: "vendor timeout" }],
  ])("refuses arithmetic when %s was never measured", (_which, newer, older) => {
    const interval = intervalBetween(newer, older);
    expect(interval?.comparison.kind).toBe("not_measured");
    expect(interval?.comparison).not.toHaveProperty("from");
    expect(describeInterval(interval!)).toMatch(/non-measurement/i);
    expect(describeInterval(interval!)).not.toMatch(/not found|→ #/);
  });

  /** AN ABSENCE HAS NO POSITION. "not among the results examined" is not position 0. */
  it("refuses arithmetic when one reading found no placement", () => {
    const interval = intervalBetween(
      { status: "absent_from_examined_results", best_rank_group: null, best_rank_absolute: null },
      {},
    );
    expect(interval?.comparison).toEqual({ kind: "absent", which: "newer" });
    expect(describeInterval(interval!)).toMatch(/no position change/i);
  });

  /**
   * THE TWO SCALES ARE NEVER CROSSED. A reading carrying a rank_absolute and no rank_group is a
   * row 0030 stores on purpose; substituting the absolute would invent a movement on a scale
   * neither reading was compared on.
   */
  it("never substitutes rank_absolute for a missing rank_group", () => {
    const interval = intervalBetween({ best_rank_group: null, best_rank_absolute: 14 }, {});
    expect(interval?.comparison.kind).toBe("no_rank_group");
    expect(describeInterval(interval!)).toMatch(/different scale/i);
    expect(describeInterval(interval!)).not.toMatch(/→ #/);
  });

  /** A status this page does not know is not silently treated as one it does. */
  it("compares nothing across a status it does not recognise", () => {
    const interval = intervalBetween({ status: "probably_ranked" }, {});
    expect(interval?.comparison.kind).toBe("unreadable");
    expect(describeInterval(interval!)).toMatch(/does not recognise/i);
  });

  /** The oldest listed reading of a series has nothing below it on this page to compare with. */
  it("attaches no interval to the oldest reading on the page", () => {
    const [series] = seriesOf([row({ id: "new" }), row({ id: "old", fetched_at: "2026-08-01T09:00:00.000Z" })]);
    expect(series?.readings[0]?.interval).not.toBeNull();
    expect(series?.readings[1]?.interval).toBeNull();
  });
});

describe("a gap is not a decline", () => {
  /** EVERY comparison carries the elapsed span, so no movement can be read as continuous. */
  it("always names how far apart two readings were", () => {
    const [series] = seriesOf([
      row({ id: "new", fetched_at: "2026-08-10T09:00:00.000Z", best_rank_group: 4 }),
      row({ id: "old", fetched_at: "2026-08-10T06:00:00.000Z", best_rank_group: 7 }),
    ]);
    expect(series?.readings[0]?.interval?.elapsed).toBe("3 hours");
    expect(describeInterval(series!.readings[0]!.interval!)).toMatch(/3 hours apart/);
  });

  it("says outright that nothing was measured in between once the readings are far apart", () => {
    const [series] = seriesOf([
      row({ id: "new", fetched_at: "2026-09-10T09:00:00.000Z", best_rank_group: 4 }),
      row({ id: "old", fetched_at: "2026-08-10T09:00:00.000Z", best_rank_group: 7 }),
    ]);
    const interval = series!.readings[0]!.interval!;
    expect(interval.gap).toBe(true);
    expect(describeInterval(interval)).toContain(GAP_SENTENCE);
    expect(describeInterval(interval)).toMatch(/31 days apart/);
  });

  /** The bound is the exported constant's, not a literal: exactly at it is not yet a gap. */
  it("treats exactly the contiguity bound as contiguous and one hour more as a gap", () => {
    const older = "2026-08-10T00:00:00.000Z";
    const atBound = new Date(Date.parse(older) + MAX_CONTIGUOUS_GAP_HOURS * 3600_000).toISOString();
    const pastBound = new Date(Date.parse(atBound) + 3600_000).toISOString();
    expect(isGap(atBound, older)).toBe(false);
    expect(isGap(pastBound, older)).toBe(true);
  });

  it("names an unparseable pair of stamps rather than printing NaN", () => {
    expect(elapsedClause("not-a-date", "2026-08-10T09:00:00.000Z")).toBe("an unknown interval");
  });

  /** No word in a comparison suggests a direction of travel — only the endpoints were observed. */
  it("never uses a word for the path between two readings", () => {
    const [series] = seriesOf([
      row({ id: "new", fetched_at: "2026-08-10T09:00:00.000Z", best_rank_group: 4 }),
      row({ id: "old", fetched_at: "2026-08-10T06:00:00.000Z", best_rank_group: 7 }),
    ]);
    const sentence = describeInterval(series!.readings[0]!.interval!);
    expect(sentence).not.toMatch(/improv|declin|dropp|gain|rose|fell|trend|better|worse/i);
  });
});

describe("the three answers stay three sentences", () => {
  it("says a non-measurement is unknown, never absent", () => {
    const [series] = seriesOf([
      row({
        status: "not_measured",
        best_rank_group: null,
        best_rank_absolute: null,
        organic_items_examined: null,
        not_measured_reason: "vendor returned no task",
      }),
    ]);
    const sentence = describeReading(series!.readings[0]!);
    expect(sentence).toMatch(/not measured/i);
    expect(sentence).toMatch(/vendor returned no task/);
    expect(sentence).toMatch(/unknown/i);
    expect(sentence).not.toMatch(/not found|position 0/i);
  });

  it("says an absence is an absence within the results examined, never position 0", () => {
    const [series] = seriesOf([
      row({
        status: "absent_from_examined_results",
        best_rank_group: null,
        best_rank_absolute: null,
        organic_items_examined: 100,
      }),
    ]);
    const sentence = describeReading(series!.readings[0]!);
    expect(sentence).toMatch(/not found among the 100 organic/i);
    expect(sentence).not.toMatch(/position 0(?!,)/);
    expect(sentence).toMatch(/says nothing about results beyond/i);
  });

  it("prints both vendor scales when both were reported", () => {
    const sentence = describeReading(seriesOf([row()])[0]!.readings[0]!);
    expect(sentence).toMatch(/rank_group #7/);
    expect(sentence).toMatch(/rank_absolute 9/);
  });

  /**
   * "NO rank_group" IS NOT "NO RANK". The two scales are independent and the vendor may withhold
   * either; collapsing them printed "reported no rank" over a row on which it had reported one.
   */
  it("distinguishes no rank at all from no ORGANIC rank beside a reported absolute", () => {
    const neither = describeReading(
      seriesOf([row({ best_rank_group: null, best_rank_absolute: null })])[0]!.readings[0]!,
    );
    const absoluteOnly = describeReading(
      seriesOf([row({ best_rank_group: null, best_rank_absolute: 14 })])[0]!.readings[0]!,
    );
    expect(neither).toMatch(/either of its two scales/i);
    expect(absoluteOnly).toMatch(/rank_absolute 14/);
    expect(absoluteOnly).toMatch(/organic position is not stated/i);
    expect(absoluteOnly).not.toMatch(/no rank for the placement/i);
  });

  it("states a status it does not recognise instead of guessing one", () => {
    const sentence = describeReading(seriesOf([row({ status: "ranked-ish" })])[0]!.readings[0]!);
    expect(sentence).toMatch(/does not recognise/i);
    expect(sentence).not.toMatch(/rank_group #/);
  });
});

describe("untracking ends the subscription, never the readings", () => {
  /**
   * THE DECISION, PINNED. A measurement is a paid fact about a moment; whether anyone is still
   * watching is a separate, free, reversible act. Hiding the readings would delete paid history
   * from the only surface that shows it and re-tracking would resurrect it.
   */
  it("keeps every reading of an untracked series and says when the watching stopped", () => {
    const history = buildRankingHistory(
      [row({ id: "a" }), row({ id: "b", fetched_at: "2026-08-01T09:00:00.000Z" })],
      [tracked({ untracked_at: "2026-08-05T09:00:00.000Z" })],
    );
    expect(history.series).toHaveLength(1);
    expect(history.series[0]?.readings).toHaveLength(2);
    expect(history.series[0]?.subscription?.untrackedAt).toBe("2026-08-05T09:00:00.000Z");
    expect(describeSubscription(history.series[0]!.subscription)).toMatch(/no longer tracked/i);
    expect(describeSubscription(history.series[0]!.subscription)).toMatch(/kept/i);
  });

  /** An ad-hoc snapshot of a domain nobody subscribed to is a first-class row, not an orphan. */
  it("shows a series that no subscription matches, and says so", () => {
    const history = buildRankingHistory([row({ project_id: null })], []);
    expect(history.series).toHaveLength(1);
    expect(history.series[0]?.subscription).toBeNull();
    expect(describeSubscription(null)).toMatch(/not tracked/i);
    expect(describeSubscription(null)).toMatch(/measured and paid for/i);
  });

  it("labels an active subscription with the date it began", () => {
    const history = buildRankingHistory([row()], [tracked()]);
    expect(history.series[0]?.subscription?.trackedSince).toBe("2026-07-01T09:00:00.000Z");
    expect(describeSubscription(history.series[0]!.subscription)).toMatch(/tracked since 2026-07-01/i);
  });

  /** Matched on the five VALUES the two tables share — 0030: "that join is the panel's". */
  it("does not attach a subscription for another locale to this series", () => {
    const history = buildRankingHistory([row()], [tracked({ device: "mobile" })]);
    expect(history.series[0]?.subscription).toBeNull();
  });
});

describe("the tracked keywords with no reading on this page", () => {
  it("lists an active subscription that no series matched", () => {
    const history = buildRankingHistory([], [tracked()]);
    expect(history.awaitingReadings.map((entry) => entry.keyword)).toEqual(["seo tools"]);
  });

  it("does not list a subscription whose series is already on the page", () => {
    const history = buildRankingHistory([row()], [tracked()]);
    expect(history.awaitingReadings).toEqual([]);
  });

  /**
   * ACTIVE ONLY, and that is the other half of the untracking decision: "waiting for its first
   * reading" is false about a keyword nobody watches any more. It drops NO measurement, because by
   * construction every entry on this list has none.
   */
  it("leaves an untracked subscription off the waiting list", () => {
    const history = buildRankingHistory([], [tracked({ untracked_at: "2026-08-05T09:00:00.000Z" })]);
    expect(history.awaitingReadings).toEqual([]);
  });
});

describe("the ceiling, and the probe that justifies disclosing it", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      row({ id: `id-${index}`, fetched_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }),
    );

  it("says nothing about older readings when every reading is on the page", () => {
    expect(buildRankingHistory(rows(3), [], 3).windowFull).toBe(false);
  });

  /** STRICTLY GREATER: a read that came back with exactly `limit` rows saw no older reading. */
  it("reports windowFull only when the probe row actually came back", () => {
    expect(buildRankingHistory(rows(4), [], 3).windowFull).toBe(true);
    expect(buildRankingHistory(rows(4), [], 3).series[0]?.readings).toHaveLength(3);
  });

  /** The probe is cut AFTER the sort, so what leaves is the OLDEST reading. */
  it("drops the oldest reading rather than whichever row arrived last", () => {
    const listed = buildRankingHistory([...rows(4)].reverse(), [], 3).series[0]?.readings;
    expect(listed?.map((reading) => reading.id)).toEqual(["id-3", "id-2", "id-1"]);
  });

  /** The probe is cut BEFORE the series pass: no comparison names a reading off the page. */
  it("compares nothing against a reading the page does not list", () => {
    const readings = buildRankingHistory(rows(4), [], 3).series[0]?.readings;
    expect(readings?.[readings.length - 1]?.interval).toBeNull();
  });

  /**
   * THE CEILING TRAVELS WITH THE HISTORY. A renderer that read the exported constant instead would
   * keep printing 200 for a history built under any other bound, and no render spec could see it.
   */
  it("reports the ceiling that was actually applied, not the default", () => {
    expect(buildRankingHistory(rows(4), [], 3).limit).toBe(3);
    expect(buildRankingHistory(rows(1), []).limit).toBe(RANKING_HISTORY_LIMIT);
    expect(buildRankingHistory([], [tracked()]).trackedLimit).toBe(TRACKED_KEYWORD_LIMIT);
  });

  it("applies the same probe to the subscriptions", () => {
    const many = Array.from({ length: 4 }, (_, index) =>
      tracked({ id: `t-${index}`, keyword: `kw ${index}` }),
    );
    expect(buildRankingHistory([], many, 200, 3).trackedWindowFull).toBe(true);
    expect(buildRankingHistory([], many, 200, 3).awaitingReadings).toHaveLength(3);
    expect(buildRankingHistory([], many, 200, 4).trackedWindowFull).toBe(false);
  });
});

describe("a stored instant is printed to the minute, deterministically", () => {
  /** No Intl, no toLocale*: server and browser must print the same string or hydration mismatches. */
  it("prints UTC to the minute so two readings on one day are distinguishable", () => {
    expect(formatReadingTime("2026-08-10T09:04:33.000Z")).toBe("2026-08-10 09:04 UTC");
    expect(formatReadingTime("2026-08-10T17:41:00.000Z")).toBe("2026-08-10 17:41 UTC");
  });

  it("falls back to the raw value rather than printing Invalid Date", () => {
    expect(formatReadingTime("not-a-date")).toBe("not-a-date");
  });
});
