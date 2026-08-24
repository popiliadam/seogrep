import { describe, expect, it } from "vitest";
import {
  SUBJECT_RUN_HISTORY_LIMIT,
  buildSubjectRunHistory,
  describeSubjectKind,
  questionOf,
  readMarket,
  summarizeSubjectRun,
  type SubjectRunHistoryRow,
} from "./subject-history";

/**
 * The pure half of /app/lookups' third section — every decision it makes, with no database and no
 * React (vitest has no RSC boundary; signed lesson 12).
 *
 * The load-bearing group is the LAST one: this module deliberately produces NO change clause for
 * any of the three tools, and an absence is the easiest thing in a codebase to lose by accident.
 * It is pinned structurally — the entry must carry no `change` key at all — so a later edit that
 * adds one has to argue with a red spec rather than with a paragraph.
 */

function row(over: Partial<SubjectRunHistoryRow> = {}): SubjectRunHistoryRow {
  return {
    tool: "discover_keywords",
    subject_kind: "keyword_set",
    subject: ["rank tracker", "seo tools"],
    project_id: null,
    created_at: "2026-08-20T10:00:00.000Z",
    mode: "ideas",
    platform: null,
    total: 4321,
    shown: 25,
    answered: null,
    top: { keyword: "seo tools", search_volume: 9000 },
    locale: { language_code: "en", location_code: 2840 },
    compared_target_count: null,
    ...over,
  };
}

describe("the market is read out of EITHER vendor family's locale shape", () => {
  /** Labs takes a numeric location_code; both halves or nothing. */
  it("renders the Labs locale pair", () => {
    expect(readMarket({ language_code: "tr", location_code: 2792 })).toBe("tr · 2792");
  });

  /**
   * THE KEY DECIDES WHICH SHAPE THIS IS, not the value. A Labs locale is broken unless BOTH halves
   * are readable; `{ language_code: "tr" }` alone carries NEITHER family's location key, so it is
   * not a Labs locale with a missing half and not a mentions one — it is unreadable.
   */
  it("refuses a half-read Labs locale rather than guessing the missing half", () => {
    expect(readMarket({ location_code: 2792 })).toBeNull();
    expect(readMarket({ location_code: 2792, language_code: null })).toBeNull();
    expect(readMarket({ location_code: null, language_code: "tr" })).toBeNull();
    expect(readMarket({ language_code: "tr" })).toBeNull();
  });

  /**
   * The LLM Mentions family takes a STRING `location_name`, and BOTH of its fields are optional on
   * the wire — so one alone is a real, complete answer here: "asked in English, no location given"
   * is what the request actually was.
   */
  it("renders the mentions locale, including when only one half was sent", () => {
    expect(readMarket({ location_name: "United States", language_code: "en" })).toBe(
      "en · United States",
    );
    expect(readMarket({ location_name: "United States", language_code: null })).toBe(
      "United States",
    );
    expect(readMarket({ location_name: null, language_code: "en" })).toBe("en");
  });

  it("reads nothing out of a locale that is absent or not an object", () => {
    expect(readMarket(null)).toBeNull();
    expect(readMarket("en · 2840")).toBeNull();
    expect(readMarket(["en", 2840])).toBeNull();
    expect(readMarket({ location_name: null, language_code: null })).toBeNull();
  });
});

describe("what was ASKED is narrowed on the tool, not on the subject", () => {
  /** "suggestions" and "related" produce identical rows otherwise — the mode is the question. */
  it("reads the mode for discover_keywords and the platform for the two AI tools", () => {
    expect(questionOf(row({ mode: "related" }))).toBe("related");
    expect(questionOf(row({ tool: "ai_visibility", mode: "related", platform: "chat_gpt" }))).toBe(
      "chat_gpt",
    );
    expect(
      questionOf(row({ tool: "ai_visibility_compare", platform: "google", mode: "ideas" })),
    ).toBe("google");
  });

  it("reads nothing when the field its tool needs is missing", () => {
    expect(questionOf(row({ mode: null }))).toBeNull();
    expect(questionOf(row({ tool: "ai_visibility", platform: 7 }))).toBeNull();
  });
});

describe("the summary is per tool, and a silence is never a zero", () => {
  it("counts discover_keywords' window, the vendor's whole set and the headline keyword", () => {
    expect(summarizeSubjectRun(row())).toBe(
      "25 keywords in this window · 4,321 matching in total · biggest: “seo tools” (9,000/mo)",
    );
  });

  /**
   * A vendor null is "the vendor did not say" and is printed in WORDS. Rendering it as 0 would
   * publish a measurement of the whole set that nobody made.
   */
  it("says the vendor declined to give a total rather than printing a zero", () => {
    expect(summarizeSubjectRun(row({ total: null }))).toBe(
      "25 keywords in this window · DataForSEO did not say how many match in total · biggest: “seo tools” (9,000/mo)",
    );
  });

  /** `top` is chosen from rows the vendor had data for, so a missing volume prints no volume. */
  it("prints a headline keyword without a volume when the vendor gave none", () => {
    expect(summarizeSubjectRun(row({ top: { keyword: "seo tools", search_volume: null } }))).toMatch(
      /biggest: “seo tools”$/,
    );
    expect(summarizeSubjectRun(row({ top: null }))).toBe(
      "25 keywords in this window · 4,321 matching in total",
    );
  });

  it("counts ai_visibility's rows beside the vendor's own total", () => {
    expect(
      summarizeSubjectRun(row({ tool: "ai_visibility", shown: 1, total: 77, top: null })),
    ).toBe("1 row · 77 matching in total");
  });

  /**
   * THE UNANSWERED TARGET, said in words. "The vendor did not report on this target" and "this
   * target has zero mentions" are different answers to a question that cost 90 credits, and this
   * is the sentence that keeps them apart on the panel.
   */
  it("names an unanswered compare target as unanswered rather than as a zero", () => {
    expect(
      summarizeSubjectRun(
        row({
          tool: "ai_visibility_compare",
          answered: false,
          shown: 0,
          total: null,
          compared_target_count: 4,
        }),
      ),
    ).toBe("compared with 3 other targets · DataForSEO reported nothing for this one — unanswered, not zero");
  });

  it("counts an answered compare target's rows and the comparison it belonged to", () => {
    expect(
      summarizeSubjectRun(
        row({
          tool: "ai_visibility_compare",
          answered: true,
          shown: 2,
          total: null,
          compared_target_count: 2,
        }),
      ),
    ).toBe("compared with 1 other target · 2 rows from DataForSEO");
  });

  /** A report that could not be read shows the subject and NO numbers — never a fabricated 0. */
  it("returns null when the run's own counter is unreadable", () => {
    expect(summarizeSubjectRun(row({ shown: null }))).toBeNull();
    expect(summarizeSubjectRun(row({ shown: "25" }))).toBeNull();
  });

  /** A tool this build does not know about still lists, on the one figure every report carries. */
  it("still summarizes a tool name this build does not recognise", () => {
    expect(summarizeSubjectRun(row({ tool: "some_future_tool", shown: 3 }))).toBe("3 rows");
  });
});

describe("the subject KIND is printed, because it is half the identity", () => {
  it("names each kind, and counts a seed set", () => {
    expect(describeSubjectKind("domain", 1)).toBe("domain");
    expect(describeSubjectKind("keyword", 1)).toBe("keyword");
    expect(describeSubjectKind("keyword_set", 1)).toBe("1 seed keyword");
    expect(describeSubjectKind("keyword_set", 12)).toBe("12 seed keywords");
  });

  /** An unknown kind prints ITSELF: a row this build cannot read is still one the tenant paid for. */
  it("prints an unknown kind verbatim rather than inventing a label", () => {
    expect(describeSubjectKind("url", 1)).toBe("url");
  });
});

describe("the history is newest first, bounded, and honest about its ceiling", () => {
  it("sorts newest first regardless of the order the rows arrived in", () => {
    const history = buildSubjectRunHistory([
      row({ created_at: "2026-08-01T00:00:00.000Z", subject: ["old"] }),
      row({ created_at: "2026-08-20T00:00:00.000Z", subject: ["new"] }),
    ]);
    expect(history.entries.map((entry) => entry.subject)).toEqual([["new"], ["old"]]);
  });

  /**
   * THE PROBE IS THE MEASUREMENT, and it is strictly greater: a read that came back with exactly
   * `limit` rows saw no older run, and claiming one would tell a tenant that paid runs exist which
   * do not.
   */
  it("reports windowFull only when a row OLDER than the last listed one was seen", () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        row({ created_at: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` }),
      );
    expect(buildSubjectRunHistory(rows(3), 3).windowFull).toBe(false);
    expect(buildSubjectRunHistory(rows(4), 3).windowFull).toBe(true);
    expect(buildSubjectRunHistory(rows(4), 3).entries).toHaveLength(3);
    // …and what was DROPPED is the OLDEST run, not whichever row happened to arrive last.
    expect(
      buildSubjectRunHistory(rows(4), 3).entries.map((entry) => entry.createdAt),
    ).not.toContain("2026-08-01T00:00:00.000Z");
    expect(SUBJECT_RUN_HISTORY_LIMIT).toBeGreaterThan(0);
  });

  /** WHERE THE REQUEST CAME FROM — never a claim about what was measured. */
  it("labels a project-less run 'bare-subject' rather than 'bare-target'", () => {
    expect(buildSubjectRunHistory([row()]).entries[0]?.scope).toBe("bare-subject");
    expect(buildSubjectRunHistory([row({ project_id: "p1" })]).entries[0]?.scope).toBe("project");
  });

  /** A subject that did not arrive as an array cannot be printed as one; it becomes empty. */
  it("survives a subject column that is not an array", () => {
    const history = buildSubjectRunHistory([
      row({ subject: "seo tools" as unknown as string[] }),
    ]);
    expect(history.entries[0]?.subject).toEqual([]);
  });
});

describe("NO RUN ON THIS TABLE GETS A CHANGE CLAUSE", () => {
  /**
   * THE ABSENCE IS THE DESIGN, and it is pinned structurally rather than by a comment. Three
   * separate refusals (see the module header): discover_keywords' total moves with five
   * caller-chosen dimensions this read does not fetch and counts vendor-generated keywords on
   * three of four modes; ai_visibility's figures have no established meaning at all, because no
   * response from that vendor family has ever been captured; and a compare row deliberately
   * carries no total to subtract.
   *
   * A later edit that adds a `change` field has to turn this red first — which is exactly the
   * conversation that should happen before a panel starts subtracting these numbers.
   */
  it("produces entries with no `change` key at all, even for two identical runs", () => {
    const twice = [
      row({ created_at: "2026-08-20T00:00:00.000Z", total: 5000 }),
      row({ created_at: "2026-08-10T00:00:00.000Z", total: 4000 }),
    ];
    const history = buildSubjectRunHistory(twice);
    expect(history.entries).toHaveLength(2);
    for (const entry of history.entries) {
      expect("change" in entry).toBe(false);
      expect(Object.keys(entry).sort()).toEqual(
        ["createdAt", "market", "question", "scope", "subject", "subjectKind", "summary", "tool"].sort(),
      );
    }
  });

  /** …and no rendered clause smuggles one in through the summary either. */
  it("never prints a since-clause or a signed delta in the summary", () => {
    const history = buildSubjectRunHistory([
      row({ created_at: "2026-08-20T00:00:00.000Z", total: 5000 }),
      row({ created_at: "2026-08-10T00:00:00.000Z", total: 4000 }),
    ]);
    for (const entry of history.entries) {
      expect(entry.summary ?? "").not.toMatch(/since|\+[\d,]+|no change/i);
    }
  });
});
