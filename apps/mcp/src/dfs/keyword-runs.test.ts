import { describe, expect, it } from "vitest";
import type { KeywordOverviewRow } from "./client.ts";
import {
  MAX_KEYWORD_RUN_ROWS,
  keywordResearchReportToJson,
  keywordResearchRunReport,
  normalizeKeywordSet,
} from "./keyword-runs.ts";

/**
 * The PURE half of the keyword research run ledger (migration 0029): the identity derivation and
 * the report constructor. Everything here runs without a database, which is what makes the
 * decisions in `keyword-runs.ts` checkable at all — the writer itself is exercised against a real
 * stack in tools/keyword-research-runs.db.test.ts.
 */

function row(over: Partial<KeywordOverviewRow> & { keyword: string }): KeywordOverviewRow {
  return {
    search_volume: null,
    cpc: null,
    competition_level: null,
    competition: null,
    keyword_difficulty: null,
    main_intent: null,
    foreign_intent: [],
    search_volume_trend: null,
    last_updated_time: null,
    has_data: true,
    ...over,
  };
}

const LOCALE = { language_code: "en", location_code: 2840 } as const;

/** The report for `rows`, with the set derived from `keywords` exactly as the tool derives it. */
function reportFor(rows: readonly KeywordOverviewRow[], keywords: readonly string[]) {
  return keywordResearchRunReport(rows, {
    keywords,
    keywordSet: normalizeKeywordSet(keywords),
    ...LOCALE,
  });
}

describe("normalizeKeywordSet — what identifies a keyword-set lookup (0029)", () => {
  it("drops ORDER: the same keywords typed in any order are ONE subject", () => {
    expect(normalizeKeywordSet(["rank tracker", "seo tools"])).toEqual(
      normalizeKeywordSet(["seo tools", "rank tracker"]),
    );
    // …and the stored form is the sorted one, so the column itself is comparable with `=`.
    expect(normalizeKeywordSet(["seo tools", "rank tracker"])).toEqual([
      "rank tracker",
      "seo tools",
    ]);
  });

  it("drops CASE, because the vendor echoes keywords lowercased", () => {
    expect(normalizeKeywordSet(["SEO Tools"])).toEqual(["seo tools"]);
    expect(normalizeKeywordSet(["SEO Tools", "seo tools"])).toEqual(["seo tools"]);
  });

  it("collapses whitespace and trims, so one typed space is not a second subject", () => {
    expect(normalizeKeywordSet(["  seo   tools \t"])).toEqual(["seo tools"]);
  });

  it("de-duplicates, so `requested` and the subject's size are different facts", () => {
    expect(normalizeKeywordSet(["seo tools", "SEO  TOOLS", " seo tools "])).toEqual(["seo tools"]);
  });

  it("drops blanks, and an all-blank list has NO subject at all", () => {
    // The tool refuses this case before the reserve; 0029's CHECK refuses it in the database.
    expect(normalizeKeywordSet(["   ", "\t", ""])).toEqual([]);
    expect(normalizeKeywordSet(["  ", "seo tools"])).toEqual(["seo tools"]);
  });

  it("keeps a 39-keyword SUBSET a different subject from the 40-keyword list", () => {
    const forty = Array.from({ length: 40 }, (_, index) => `kw ${index}`);
    const subset = forty.slice(0, 39);
    expect(normalizeKeywordSet(forty)).not.toEqual(normalizeKeywordSet(subset));
  });
});

describe("keywordResearchRunReport — the four counters are four different facts", () => {
  it("separates what was ASKED, what the SUBJECT is, what RETURNED and what was ANSWERED", () => {
    const report = reportFor(
      [
        row({ keyword: "seo tools", search_volume: 1000 }),
        row({ keyword: "rank tracker", has_data: false }),
      ],
      // Three arguments, two distinct keywords: a repeat is the difference between the first two.
      ["SEO Tools", "seo tools", "rank tracker"],
    );
    expect(report.requested).toBe(3);
    expect(report.subject).toBe(2);
    expect(report.returned).toBe(2);
    // The no-data row RETURNED but was not ANSWERED — the coverage the panel keys its change on.
    expect(report.answered).toBe(1);
  });

  it("counts the total the way the tool's own sentence does — our sum, never nullable", () => {
    const report = reportFor(
      [
        row({ keyword: "a", search_volume: 1000 }),
        row({ keyword: "b", search_volume: 210 }),
        row({ keyword: "c", has_data: false }),
      ],
      ["a", "b", "c"],
    );
    expect(report.total).toBe(1210);
  });

  it("gives an empty answer a total of 0 and no headline — 0 rows is a real measurement", () => {
    const report = reportFor([], ["seo tools"]);
    expect(report.total).toBe(0);
    expect(report.returned).toBe(0);
    expect(report.answered).toBe(0);
    expect(report.top).toBeNull();
  });
});

describe("keywordResearchRunReport — the headline, and the nulls under it", () => {
  it("picks the HIGHEST-VOLUME answered keyword, not the first row", () => {
    const report = reportFor(
      [
        row({ keyword: "small", search_volume: 90 }),
        row({ keyword: "big", search_volume: 12100 }),
        row({ keyword: "middle", search_volume: 400 }),
      ],
      ["small", "big", "middle"],
    );
    expect(report.top?.keyword).toBe("big");
    expect(report.top?.search_volume).toBe(12100);
  });

  it("never lets a NO-DATA row be the headline, whatever it carries", () => {
    // A no-data row with a volume is exactly the shape client.ts warns about: the vendor holds
    // nothing, and folding that into a number is how "no figure" became "zero searches".
    const report = reportFor(
      [
        row({ keyword: "ghost", search_volume: 99999, has_data: false }),
        row({ keyword: "real", search_volume: 12 }),
      ],
      ["ghost", "real"],
    );
    expect(report.top?.keyword).toBe("real");
  });

  it("stores a vendor NULL as null in the headline — 0 is a price, not an absence", () => {
    const report = reportFor(
      [row({ keyword: "seo tools", search_volume: 1000, cpc: null, keyword_difficulty: null })],
      ["seo tools"],
    );
    expect(report.top?.cpc).toBeNull();
    expect(report.top?.keyword_difficulty).toBeNull();
    expect(report.top?.competition_level).toBeNull();
  });

  it("stores a vendor NULL as null in every stored ROW too", () => {
    const report = reportFor([row({ keyword: "unknown", has_data: false })], ["unknown"]);
    expect(report.rows[0]?.search_volume).toBeNull();
    expect(report.rows[0]?.cpc).toBeNull();
    // …and a genuine zero survives as zero, because that IS a measurement.
    const zero = reportFor([row({ keyword: "zero", search_volume: 0 })], ["zero"]);
    expect(zero.rows[0]?.search_volume).toBe(0);
    expect(zero.total).toBe(0);
  });
});

describe("keywordResearchRunReport — the cap", () => {
  const many = Array.from({ length: MAX_KEYWORD_RUN_ROWS + 7 }, (_, index) =>
    row({ keyword: `kw-${index}`, search_volume: index + 1 }),
  );

  it("truncates the stored rows at MAX_KEYWORD_RUN_ROWS", () => {
    const report = reportFor(many, ["kw-0"]);
    expect(report.rows).toHaveLength(MAX_KEYWORD_RUN_ROWS);
  });

  it("leaves every counter at its PRE-cap value, so the row's claims do not shrink with it", () => {
    const report = reportFor(many, ["kw-0"]);
    expect(report.returned).toBe(many.length);
    expect(report.answered).toBe(many.length);
    expect(report.total).toBe(many.reduce((sum, one) => sum + (one.search_volume ?? 0), 0));
    // …and the headline is the biggest row of ALL of them, which the cap threw away.
    expect(report.top?.keyword).toBe(`kw-${many.length - 1}`);
  });
});

describe("keywordResearchReportToJson — what is type-checked is what is stored", () => {
  it("round-trips through JSON, dropping nothing the panel reads", () => {
    const report = reportFor([row({ keyword: "seo tools", search_volume: 5 })], ["seo tools"]);
    const json = keywordResearchReportToJson(report) as Record<string, unknown>;
    expect(json.total).toBe(5);
    expect(json.locale).toEqual({ language_code: "en", location_code: 2840 });
    expect((json.rows as unknown[]).length).toBe(1);
  });

  it("strips an `undefined` a widened vendor parser could smuggle in, rather than storing it", () => {
    const smuggled = {
      ...reportFor([row({ keyword: "a", search_volume: 1 })], ["a"]),
      // The exact shape the round trip exists for: it vanishes on the wire silently otherwise.
      extra: undefined,
    } as never;
    expect(Object.keys(keywordResearchReportToJson(smuggled) as object)).not.toContain("extra");
  });
});
