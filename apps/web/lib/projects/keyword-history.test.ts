import { describe, expect, it } from "vitest";
import {
  KEYWORD_RUN_HISTORY_LIMIT,
  buildKeywordRunHistory,
  describeKeywordRunChange,
  summarizeKeywordRun,
  type KeywordRunHistoryRow,
} from "./keyword-history";

/**
 * The /app/lookups keyword section's whole decision layer (migration 0029): what a run's line
 * says, and — the only interesting question here — which two runs may honestly be subtracted from
 * each other. Pure, so every case below is executed rather than described.
 */

const LOCALE = { language_code: "en", location_code: 2840 };

function run(over: Partial<KeywordRunHistoryRow> = {}): KeywordRunHistoryRow {
  return {
    keyword_set: ["rank tracker", "seo tools"],
    created_at: "2026-08-10T00:00:00.000Z",
    total: 1000,
    answered: 2,
    top: { keyword: "seo tools", search_volume: 900 },
    locale: LOCALE,
    ...over,
  };
}

describe("summarizeKeywordRun — what one run's line claims", () => {
  it("counts the keywords the run was ABOUT and the searches behind them", () => {
    const [entry] = buildKeywordRunHistory([run()]).entries;
    expect(summarizeKeywordRun(entry!)).toBe(
      "2 keywords · 1,000 searches/mo · biggest: “seo tools” (900/mo)",
    );
  });

  it("says '1 keyword', not '1 keywords'", () => {
    const [entry] = buildKeywordRunHistory([
      run({ keyword_set: ["seo tools"], answered: 1 }),
    ]).entries;
    expect(summarizeKeywordRun(entry!)).toMatch(/^1 keyword · /);
  });

  /**
   * COVERAGE IS STATED WHEN IT BITES, and omitted when it does not. `total` is a sum across the
   * ANSWERED keywords, so a reader comparing two runs by eye has to be able to see that the
   * vendor answered for fewer of them — but "2 of 2 answered" on a complete run is noise that
   * trains the eye to skip the clause that matters.
   */
  it("names the answered count only when it is short of the set", () => {
    const [short] = buildKeywordRunHistory([run({ answered: 1 })]).entries;
    expect(summarizeKeywordRun(short!)).toContain("2 keywords, 1 answered");
    const [full] = buildKeywordRunHistory([run({ answered: 2 })]).entries;
    expect(summarizeKeywordRun(full!)).not.toContain("answered");
  });

  /**
   * A NULL IS NEVER RENDERED AS 0. An unreadable total drops the numbers and keeps the subject —
   * the reader still learns which keywords the run was about, which is the half a "0 searches/mo"
   * would have replaced with a measurement nobody made.
   */
  it("drops the numbers rather than inventing a zero when the total is unreadable", () => {
    const [entry] = buildKeywordRunHistory([run({ total: null })]).entries;
    expect(summarizeKeywordRun(entry!)).toBe("2 keywords");
    expect(summarizeKeywordRun(entry!)).not.toMatch(/0 searches/);
  });

  it("prints a genuine ZERO total, because that is a real measurement", () => {
    const [entry] = buildKeywordRunHistory([run({ total: 0, top: null })]).entries;
    expect(summarizeKeywordRun(entry!)).toBe("2 keywords · 0 searches/mo");
  });

  it("omits the headline's volume when the vendor held the keyword but not its volume", () => {
    const [entry] = buildKeywordRunHistory([
      run({ top: { keyword: "seo tools", search_volume: null } }),
    ]).entries;
    expect(summarizeKeywordRun(entry!)).toContain("biggest: “seo tools”");
    expect(summarizeKeywordRun(entry!)).not.toMatch(/\(0\/mo\)/);
  });

  it("drops the headline entirely when `top` is not a readable object", () => {
    const [entry] = buildKeywordRunHistory([run({ top: "seo tools" })]).entries;
    expect(summarizeKeywordRun(entry!)).toBe("2 keywords · 1,000 searches/mo");
  });
});

describe("buildKeywordRunHistory — which runs may be subtracted from which", () => {
  const older = run({ created_at: "2026-08-01T00:00:00.000Z", total: 800 });
  const newer = run({ created_at: "2026-08-10T00:00:00.000Z", total: 1000 });

  it("compares two runs of the SAME set, same locale, same coverage", () => {
    const { entries } = buildKeywordRunHistory([newer, older]);
    expect(entries[0]?.change).toEqual({
      delta: 200,
      previousTotal: 800,
      previousCreatedAt: "2026-08-01T00:00:00.000Z",
    });
    // The oldest run has nothing before it — a first run is not a change of zero.
    expect(entries[1]?.change).toBeNull();
  });

  it("treats a differently ORDERED set as the same subject, because the column is sorted", () => {
    // 0029 stores the set normalized and SORTED, so two runs of the same keywords arrive here
    // identical. This pins that the panel does not re-order or re-key them on its own.
    const { entries } = buildKeywordRunHistory([
      run({ created_at: "2026-08-10T00:00:00.000Z", total: 1000 }),
      run({ created_at: "2026-08-01T00:00:00.000Z", total: 800 }),
    ]);
    expect(entries[0]?.change?.delta).toBe(200);
  });

  /**
   * A SUBSET IS A DIFFERENT SUBJECT. Subtracting the aggregate of one keyword from that of two
   * would print growth the tenant produced by typing an extra word.
   */
  it("never compares a set with its own subset", () => {
    const { entries } = buildKeywordRunHistory([
      run({ created_at: "2026-08-10T00:00:00.000Z", total: 1000 }),
      run({
        created_at: "2026-08-01T00:00:00.000Z",
        keyword_set: ["seo tools"],
        answered: 1,
        total: 800,
      }),
    ]);
    expect(entries[0]?.change).toBeNull();
    expect(entries[1]?.change).toBeNull();
  });

  /**
   * THE SET AXIS ON ITS OWN. The two cases either side of this one change the set AND the
   * coverage together, so each would still pass if only the coverage condition existed. Here the
   * locale and the answered count are identical and only the WORDS differ — so what is measured is
   * the set being part of the key at all.
   */
  it("never compares two same-sized sets of DIFFERENT keywords", () => {
    const { entries } = buildKeywordRunHistory([
      run({
        created_at: "2026-08-10T00:00:00.000Z",
        keyword_set: ["rank tracker", "site audit"],
        total: 1000,
      }),
      run({ created_at: "2026-08-01T00:00:00.000Z", total: 800 }),
    ]);
    expect(entries[0]?.change).toBeNull();
  });

  /** …nor a superset, which is the same refusal approached from the other side. */
  it("never compares a set with a superset of itself", () => {
    const { entries } = buildKeywordRunHistory([
      run({
        created_at: "2026-08-10T00:00:00.000Z",
        keyword_set: ["rank tracker", "seo tools", "site audit"],
        answered: 3,
        total: 1400,
      }),
      run({ created_at: "2026-08-01T00:00:00.000Z", total: 800 }),
    ]);
    expect(entries[0]?.change).toBeNull();
  });

  it("never compares two MARKETS, however identical the keywords", () => {
    const { entries } = buildKeywordRunHistory([
      run({
        created_at: "2026-08-10T00:00:00.000Z",
        total: 1000,
        locale: { language_code: "tr", location_code: 2792 },
      }),
      run({ created_at: "2026-08-01T00:00:00.000Z", total: 800 }),
    ]);
    expect(entries[0]?.change).toBeNull();
  });

  /**
   * NOR TWO DIFFERENT COVERAGES. `total` sums the answered rows, so a keyword crossing from "no
   * data" to "data" adds its whole volume; reporting that as demand growth would be the panel
   * asserting a measurement nobody made. Deliberately conservative — a missing clause is a gap, a
   * wrong clause is a lie.
   */
  it("never compares runs the vendor answered a different number of keywords for", () => {
    const { entries } = buildKeywordRunHistory([
      run({ created_at: "2026-08-10T00:00:00.000Z", total: 1000, answered: 2 }),
      run({ created_at: "2026-08-01T00:00:00.000Z", total: 800, answered: 1 }),
    ]);
    expect(entries[0]?.change).toBeNull();
  });

  it("compares with nothing at all when the locale or the coverage cannot be read", () => {
    const unreadable = buildKeywordRunHistory([
      run({ created_at: "2026-08-10T00:00:00.000Z", total: 1000, locale: { language_code: "en" } }),
      run({ created_at: "2026-08-01T00:00:00.000Z", total: 800, locale: { language_code: "en" } }),
    ]);
    expect(unreadable.entries[0]?.change).toBeNull();

    const noCoverage = buildKeywordRunHistory([
      run({ created_at: "2026-08-10T00:00:00.000Z", total: 1000, answered: null }),
      run({ created_at: "2026-08-01T00:00:00.000Z", total: 800, answered: null }),
    ]);
    expect(noCoverage.entries[0]?.change).toBeNull();
  });

  /**
   * "SINCE THE PREVIOUS RUN" MEANS THE PREVIOUS ONE. A run whose own total is unreadable breaks
   * its group's chain rather than being skipped over — a change measured across a gap would carry
   * the wrong interval in its own sentence.
   */
  it("breaks the chain at an unreadable run instead of comparing across it", () => {
    const { entries } = buildKeywordRunHistory([
      run({ created_at: "2026-08-10T00:00:00.000Z", total: 1000 }),
      run({ created_at: "2026-08-05T00:00:00.000Z", total: null }),
      run({ created_at: "2026-08-01T00:00:00.000Z", total: 800 }),
    ]);
    expect(entries[0]?.change).toBeNull();
    expect(entries[1]?.change).toBeNull();
  });

  it("re-decides NEWEST FIRST rather than trusting the order it was handed", () => {
    const { entries } = buildKeywordRunHistory([older, newer]);
    expect(entries.map((entry) => entry.createdAt)).toEqual([
      "2026-08-10T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    ]);
  });
});

describe("buildKeywordRunHistory — the window and its probe", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      run({ created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }),
    );

  it("lists at most `limit` runs and drops the OLDEST when there are more", () => {
    const { entries } = buildKeywordRunHistory(rows(4), 3);
    expect(entries).toHaveLength(3);
    // Newest first, so the one dropped is 2026-01-01 — the oldest, not whichever arrived last.
    expect(entries.map((entry) => entry.createdAt)).not.toContain("2026-01-01T00:00:00.000Z");
  });

  /**
   * THE FLAG IS THE PROBE, NOT THE FULLNESS. A read that came back with exactly `limit` rows saw
   * no older run, and claiming otherwise would tell a tenant whose whole history fits the page
   * that older paid runs exist which do not.
   */
  it("claims older runs exist ONLY when a row past the limit was actually seen", () => {
    expect(buildKeywordRunHistory(rows(3), 3).windowFull).toBe(false);
    expect(buildKeywordRunHistory(rows(4), 3).windowFull).toBe(true);
    expect(buildKeywordRunHistory([], 3).windowFull).toBe(false);
  });

  it("never measures a listed run against the probe row it dropped", () => {
    // Four runs of one group, the oldest of which is the probe. The oldest LISTED run must have no
    // change: its baseline is a run the reader cannot scroll to.
    const four = [
      run({ created_at: "2026-08-04T00:00:00.000Z", total: 400 }),
      run({ created_at: "2026-08-03T00:00:00.000Z", total: 300 }),
      run({ created_at: "2026-08-02T00:00:00.000Z", total: 200 }),
      run({ created_at: "2026-08-01T00:00:00.000Z", total: 100 }),
    ];
    const { entries } = buildKeywordRunHistory(four, 3);
    expect(entries[2]?.createdAt).toBe("2026-08-02T00:00:00.000Z");
    expect(entries[2]?.change).toBeNull();
    expect(entries[1]?.change?.previousCreatedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("defaults to the shared ceiling the page discloses", () => {
    expect(KEYWORD_RUN_HISTORY_LIMIT).toBe(200);
    expect(buildKeywordRunHistory(rows(KEYWORD_RUN_HISTORY_LIMIT + 1)).windowFull).toBe(true);
  });
});

describe("describeKeywordRunChange", () => {
  it("states a zero delta as no change rather than printing '+0'", () => {
    expect(
      describeKeywordRunChange({
        delta: 0,
        previousTotal: 1000,
        previousCreatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ).toMatch(/^no change since /);
  });

  it("signs a rise and names what it is measured against", () => {
    const text = describeKeywordRunChange({
      delta: 1200,
      previousTotal: 800,
      previousCreatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(text).toContain("+1,200");
    expect(text).toContain("(800)");
  });

  it("carries the minus sign of a fall without adding a second one", () => {
    const text = describeKeywordRunChange({
      delta: -300,
      previousTotal: 800,
      previousCreatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(text).toMatch(/^-300 since /);
  });
});
