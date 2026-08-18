import { describe, expect, it } from "vitest";
import {
  DOMAIN_LOOKUP_HISTORY_LIMIT,
  buildDomainLookupHistory,
  describeLookupChange,
  type DomainLookupHistoryRow,
} from "./lookup-history";

/**
 * The /app/lookups history layer, driven directly — the half no render spec and no source pin can
 * execute. Everything that decides what the page CLAIMS lives here: the order, the bare-target
 * label, the numbers, and above all WHICH TWO RUNS MAY BE SUBTRACTED FROM EACH OTHER.
 *
 * The change rules are asserted as the module states them, with the negative cases carrying the
 * weight: a delta between two runs that measured different things is a metric invented in the
 * panel (NEVER #7), and it is exactly the kind of defect that looks correct on screen.
 */

const EN_US = { language_code: "en", location_code: 2840 };
const TR = { language_code: "tr", location_code: 2792 };

function row(
  over: Partial<DomainLookupHistoryRow> & Pick<DomainLookupHistoryRow, "tool" | "created_at">,
): DomainLookupHistoryRow {
  return {
    target: "example.com",
    project_id: null,
    total: null,
    top: null,
    locale: null,
    ...over,
  };
}

/** A ranked_keywords run in one locale — the tool whose total varies with that locale. */
function ranked(createdAt: string, total: number | null, over: Partial<DomainLookupHistoryRow> = {}) {
  return row({ tool: "ranked_keywords", created_at: createdAt, total, locale: EN_US, ...over });
}

/** An analyze_backlinks run — no locale key at all, by design (BacklinksRunReport). */
function backlinks(createdAt: string, total: number | null, over: Partial<DomainLookupHistoryRow> = {}) {
  return row({ tool: "analyze_backlinks", created_at: createdAt, total, ...over });
}

describe("the history lists every run the tenant owns, newest first", () => {
  it("is empty for no rows, and claims no truncation", () => {
    const history = buildDomainLookupHistory([]);
    expect(history.entries).toEqual([]);
    expect(history.windowFull).toBe(false);
  });

  /**
   * ORDER IS RE-DECIDED HERE, not trusted from the query. The read is pinned separately, but this
   * function is what the page is built from — handed rows in any order it must still put the
   * newest first, or the page dates a lookup history wrongly from the top down.
   */
  it("sorts newest first whatever order the rows arrive in", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-06-01T00:00:00.000Z", 10),
      ranked("2026-08-01T00:00:00.000Z", 30),
      ranked("2026-07-01T00:00:00.000Z", 20),
    ]);
    expect(history.entries.map((entry) => entry.createdAt)).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    ]);
  });

  /**
   * THE ROWS THE PRODUCT COULD NOT SHOW UNTIL NOW. A `project_id`-null run is labelled as what it
   * is and never as a project's — and the label is asserted NEGATIVELY too, because "bare target"
   * quietly becoming "project" is the exact overstatement 0027's nullable column invites.
   */
  it("labels a project_id-null run as a bare target and a project run as a project", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-08-02T00:00:00.000Z", 5, { project_id: null }),
      ranked("2026-08-01T00:00:00.000Z", 5, { project_id: "p-1" }),
    ]);
    expect(history.entries[0]?.scope).toBe("bare-target");
    expect(history.entries[1]?.scope).toBe("project");
  });

  /** An unparseable stamp sorts LAST rather than poisoning the comparison with NaN. */
  it("puts a run with an unreadable timestamp at the bottom instead of losing the order", () => {
    const broken = ranked("not-a-date", 7);
    const good = ranked("2026-01-01T00:00:00.000Z", 7);
    expect(buildDomainLookupHistory([broken, good]).entries.map((e) => e.createdAt)).toEqual([
      good.created_at,
      "not-a-date",
    ]);
    expect(buildDomainLookupHistory([good, broken]).entries.map((e) => e.createdAt)).toEqual([
      good.created_at,
      "not-a-date",
    ]);
  });

  /** A tool outside the three still LISTS — it just carries no numbers this build can read. */
  it("shows a run of an unknown tool without pretending to summarise it", () => {
    const [entry] = buildDomainLookupHistory([
      row({ tool: "some_future_lookup", created_at: "2026-08-01T00:00:00.000Z", total: 12 }),
    ]).entries;
    expect(entry?.tool).toBe("some_future_lookup");
    expect(entry?.summary).toBeNull();
    expect(entry?.change).toBeNull();
  });
});

describe("the history prints what each run found, and never invents it", () => {
  /**
   * A NULL TOTAL IS NOT A ZERO. `RankedKeywordsRunReport.total` is `number | null` because the
   * vendor's `total_count` can be absent, and runs.ts stores that absence as null on purpose.
   */
  it("shows no numbers at all for a run whose total the vendor never gave", () => {
    const absent = buildDomainLookupHistory([ranked("2026-08-01T00:00:00.000Z", null)]).entries[0];
    const zero = buildDomainLookupHistory([ranked("2026-08-01T00:00:00.000Z", 0)]).entries[0];
    expect(absent?.summary).toBeNull();
    // …and it is NOT the answer a real zero gets: those are different findings.
    expect(absent?.summary).not.toBe(zero?.summary);
  });

  /** A REAL zero is a finding — "nothing found", never confused with "the vendor did not say". */
  it("says nothing was found for a total of zero", () => {
    const [entry] = buildDomainLookupHistory([ranked("2026-08-01T00:00:00.000Z", 0)]).entries;
    expect(entry?.summary).toMatch(/no ranked keywords/i);
  });

  /** The line is the card's line — one implementation, so the two surfaces cannot drift apart. */
  it("summarises a run exactly as the project card does", () => {
    const [entry] = buildDomainLookupHistory([
      ranked("2026-08-01T00:00:00.000Z", 1420, {
        top: { keyword: "running shoes", position: 3, search_volume: 74000 },
      }),
    ]).entries;
    expect(entry?.summary).toBe('1420 ranked keywords · biggest: "running shoes" (#3, 74000/mo)');
  });

  /** The locale is READ, not assumed: it is what explains why two runs did or did not compare. */
  it("reads the locale out of the report, and only when both halves are there", () => {
    const both = buildDomainLookupHistory([ranked("2026-08-01T00:00:00.000Z", 1)]).entries[0];
    expect(both?.locale).toEqual({ languageCode: "en", locationCode: 2840 });

    const half = buildDomainLookupHistory([
      ranked("2026-08-01T00:00:00.000Z", 1, { locale: { language_code: "en" } }),
    ]).entries[0];
    expect(half?.locale).toBeNull();
  });
});

describe("a change is measured only between two runs that measured the same thing", () => {
  /** The first run of its kind has nothing to be compared with, and says so by showing nothing. */
  it("shows no change for the only run of its kind", () => {
    const [entry] = buildDomainLookupHistory([ranked("2026-08-01T00:00:00.000Z", 1420)]).entries;
    expect(entry?.change).toBeNull();
  });

  /**
   * THE CHAIN IS CHRONOLOGICAL, not input-ordered, and each run is compared with the one
   * IMMEDIATELY before it. Rows are handed over shuffled precisely because a page that compared
   * against "whatever came first in the array" would look right on sorted input.
   */
  it("compares each run with the one immediately before it, however the rows arrive", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-07-01T00:00:00.000Z", 20),
      ranked("2026-08-01T00:00:00.000Z", 35),
      ranked("2026-06-01T00:00:00.000Z", 10),
    ]);
    expect(history.entries[0]?.change).toEqual({
      delta: 15,
      previousTotal: 20,
      previousCreatedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(history.entries[1]?.change).toEqual({
      delta: 10,
      previousTotal: 10,
      previousCreatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(history.entries[2]?.change).toBeNull();
  });

  /** A fall is a fall — the delta is signed, never an absolute "difference". */
  it("reports a drop as a negative delta", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-08-01T00:00:00.000Z", 900),
      ranked("2026-07-01T00:00:00.000Z", 1000),
    ]);
    expect(history.entries[0]?.change?.delta).toBe(-100);
  });

  /**
   * DIFFERENT LOCALE, DIFFERENT QUESTION. `total` is DataForSEO's `total_count` for the requested
   * language/location pair; the tool's own THIN_RESULT_ROWS note is a MEASURED case of the same
   * domain returning wildly different counts on two locales. Subtracting across them would print
   * a market switch as growth.
   */
  it("refuses to compare two ranked_keywords runs from different locales", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-08-01T00:00:00.000Z", 480, { locale: TR }),
      ranked("2026-07-01T00:00:00.000Z", 11),
    ]);
    expect(history.entries[0]?.change).toBeNull();
    expect(history.entries[1]?.change).toBeNull();
  });

  /** A run whose locale cannot be read is comparable with nothing, in either direction. */
  it("refuses to compare when a ranked_keywords run's locale is unreadable", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-08-01T00:00:00.000Z", 480, { locale: null }),
      ranked("2026-07-01T00:00:00.000Z", 400),
    ]);
    expect(history.entries[0]?.change).toBeNull();
    expect(history.entries[1]?.change).toBeNull();
  });

  /** Different domains are different measurements, whatever else the two runs share. */
  it("refuses to compare two runs of different domains", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-08-01T00:00:00.000Z", 480, { target: "rival.test" }),
      ranked("2026-07-01T00:00:00.000Z", 400, { target: "mine.test" }),
    ]);
    expect(history.entries[0]?.change).toBeNull();
  });

  /** …and different TOOLS never compare, though both totals are counts of something. */
  it("refuses to compare a backlink total with a ranked-keyword total", () => {
    const history = buildDomainLookupHistory([
      backlinks("2026-08-01T00:00:00.000Z", 8300),
      ranked("2026-07-01T00:00:00.000Z", 1420),
    ]);
    expect(history.entries[0]?.change).toBeNull();
  });

  /**
   * analyze_backlinks COMPARES ON THE TARGET ALONE, and carrying no locale is not a reason to
   * refuse: `/v3/backlinks/summary/live` takes `{ target }` only, which is why BacklinksRunReport
   * deliberately has no `locale` key. A rule that demanded a locale from every tool would silently
   * disable this tool's change forever.
   */
  it("compares two analyze_backlinks runs of the same domain, locale or no locale", () => {
    const history = buildDomainLookupHistory([
      backlinks("2026-08-01T00:00:00.000Z", 8300),
      backlinks("2026-07-01T00:00:00.000Z", 8000),
    ]);
    expect(history.entries[0]?.change?.delta).toBe(300);
  });

  /**
   * COMPARE_COMPETITORS NEVER SHOWS A CHANGE. `CompetitorsRunReport.total` is "our own count of
   * the table's rows" (apps/mcp/src/dfs/runs.ts) — 1 target plus however many rivals the CALLER
   * asked about — so a delta would read as "you gained two competitors" when the caller merely
   * passed a longer list. The two runs below are otherwise perfectly comparable, so this test
   * fails the moment the refusal is dropped.
   */
  it("never shows a change for compare_competitors, however comparable the runs look", () => {
    const history = buildDomainLookupHistory([
      row({
        tool: "compare_competitors",
        created_at: "2026-08-01T00:00:00.000Z",
        total: 4,
        locale: EN_US,
      }),
      row({
        tool: "compare_competitors",
        created_at: "2026-07-01T00:00:00.000Z",
        total: 2,
        locale: EN_US,
      }),
    ]);
    expect(history.entries[0]?.change).toBeNull();
    expect(history.entries[1]?.change).toBeNull();
    // …and the numbers themselves are still shown; only the subtraction is refused.
    expect(history.entries[0]?.summary).toMatch(/compared 4 domains/i);
  });

  /**
   * A BROKEN LINK BREAKS THE CHAIN. If the run immediately before had no readable total, the next
   * one is NOT compared with the one before that: "since the previous run" would then name the
   * wrong interval, which is a worse answer than no answer.
   */
  it("does not reach past a run whose own total is unreadable", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-08-01T00:00:00.000Z", 1500),
      ranked("2026-07-01T00:00:00.000Z", null),
      ranked("2026-06-01T00:00:00.000Z", 1000),
    ]);
    expect(history.entries[0]?.change).toBeNull();
    expect(history.entries[1]?.change).toBeNull();
  });

  /** …and neither does it reach past a run that cannot be placed in time at all. */
  it("does not compare across a run whose timestamp is unreadable", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-08-01T00:00:00.000Z", 1500),
      ranked("nonsense", 1200),
    ]);
    expect(history.entries[0]?.change).toBeNull();
    expect(history.entries[1]?.change).toBeNull();
  });

  /**
   * A PROJECT RUN AND A BARE-TARGET RUN OF THE SAME DOMAIN DO COMPARE. `target` is the resolved
   * domain the lookup ran against whichever input produced it (0027), so both measured the same
   * thing; `project_id` records where the request came from and nothing about the measurement.
   */
  it("compares a project run with a bare-target run of the same domain", () => {
    const history = buildDomainLookupHistory([
      ranked("2026-08-01T00:00:00.000Z", 1500, { project_id: "p-1" }),
      ranked("2026-07-01T00:00:00.000Z", 1400, { project_id: null }),
    ]);
    expect(history.entries[0]?.change?.delta).toBe(100);
  });
});

describe("the history says when it could not see the whole table", () => {
  it("flags a full window, and only a full window", () => {
    const rows = [ranked("2026-08-01T00:00:00.000Z", 1), ranked("2026-07-01T00:00:00.000Z", 1)];
    expect(buildDomainLookupHistory(rows, 2).windowFull).toBe(true);
    expect(buildDomainLookupHistory(rows, 3).windowFull).toBe(false);
  });

  /** The default ceiling is the one the query sends, so the flag cannot be true off-by-one. */
  it("defaults to the ceiling the read itself uses", () => {
    expect(DOMAIN_LOOKUP_HISTORY_LIMIT).toBeGreaterThan(0);
    const rows = Array.from({ length: DOMAIN_LOOKUP_HISTORY_LIMIT }, (_unused, index) =>
      ranked(`2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`, index),
    );
    expect(buildDomainLookupHistory(rows).windowFull).toBe(true);
    expect(buildDomainLookupHistory(rows.slice(1)).windowFull).toBe(false);
  });
});

describe("a change reads as one English clause", () => {
  it("signs a rise, keeps a fall's own sign, and names a flat run as unchanged", () => {
    const since = { previousTotal: 1000, previousCreatedAt: "2026-07-01T00:00:00.000Z" };
    expect(describeLookupChange({ delta: 420, ...since })).toBe("+420 since 2026-07-01 (1,000)");
    expect(describeLookupChange({ delta: -420, ...since })).toBe("-420 since 2026-07-01 (1,000)");
    expect(describeLookupChange({ delta: 0, ...since })).toBe("no change since 2026-07-01 (1,000)");
  });
});
