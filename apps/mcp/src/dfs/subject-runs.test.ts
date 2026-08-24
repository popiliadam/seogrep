import { describe, expect, it } from "vitest";
import {
  MAX_SUBJECT_RUN_ROWS,
  aiVisibilityCompareRunRows,
  aiVisibilityRunReport,
  discoverKeywordsRunReport,
  discoverSubjectIdentity,
  mentionSubjectIdentity,
  subjectLookupReportToJson,
} from "./subject-runs.ts";
import type { DiscoverKeywordRow, DiscoverKeywordsResult, DiscoverSubject } from "./discover-keywords.ts";
import type {
  AiVisibilityCompareResult,
  AiVisibilityCompareRow,
  AiVisibilityResult,
  AiVisibilityRow,
  MeasurementScope,
} from "./llm-mentions.ts";

/**
 * The write half of migration 0032, unit-tested with no database — the identity derivation, the
 * three report builders, the caps, and the per-subject fan-out of a comparison.
 *
 * WHAT THIS LANE CAN SEE THAT THE DB LANE CANNOT: every branch, cheaply, including the ones a
 * fixture would never reach (a 60-row window, a 60-target comparison, a vendor that answered for
 * some targets and not others). WHAT IT CANNOT SEE, and which subject-lookup-runs.db.test.ts
 * therefore measures instead: whether the row is actually written, whether it is written ONLY on
 * delivery, and whether the jsonb survives PostgREST as numbers rather than strings.
 */

const KEYWORD_ROW: DiscoverKeywordRow = {
  keyword: "seo tools",
  search_volume: 9000,
  cpc: 4.5,
  competition: 0.42,
  competition_level: "MEDIUM",
  keyword_difficulty: 61,
  main_intent: "commercial",
  foreign_intent: ["informational"],
  search_volume_trend: { monthly: 3, quarterly: -2, yearly: null },
  last_updated_time: "2026-08-01 00:00:00 +00:00",
};

function keywordRow(over: Partial<DiscoverKeywordRow> = {}): DiscoverKeywordRow {
  return { ...KEYWORD_ROW, ...over };
}

function discoverResult(over: {
  subject: DiscoverSubject;
  rows?: readonly DiscoverKeywordRow[];
  vendorTotal?: number | null;
  filters?: readonly unknown[];
}): DiscoverKeywordsResult {
  const rows = over.rows ?? [keywordRow()];
  return {
    mode: over.subject.mode,
    mode_means: "what this mode returns",
    subject: over.subject,
    ordered_by_vendor_field: "keyword_info.search_volume",
    vendor_filters_applied: over.filters ?? [],
    window: {
      window_offset: 20,
      window_limit: 100,
      window_row_count: rows.length,
      vendor_total_count: over.vendorTotal === undefined ? 4321 : over.vendorTotal,
      rows,
    },
  };
}

const SCOPE: MeasurementScope = {
  platform_requested: "chat_gpt",
  platform_means: "Mentions observed in ChatGPT answers only.",
  vendor_echoed_platform: "google",
  location_name: "United States",
  language_code: "en",
  vendor_reported_time_field: "datetime",
  vendor_reported_time_value: "2026-08-14 08:12:33 +00:00",
};

function mentionRow(over: Partial<AiVisibilityRow> = {}): AiVisibilityRow {
  return { vendor_metrics: { mentions: 12 }, vendor_nested_fields_not_carried: ["items"], ...over };
}

function compareRow(key: string, mentions: number): AiVisibilityCompareRow {
  return {
    aggregation_key: key,
    vendor_metrics: { mentions },
    vendor_nested_fields_not_carried: [],
  };
}

function visibilityResult(over: {
  rows?: readonly AiVisibilityRow[];
  vendorTotal?: number | null;
}): AiVisibilityResult {
  const rows = over.rows ?? [mentionRow()];
  return {
    subject: { kind: "domain", domain: "example.com" },
    scope: SCOPE,
    row_order: "vendor_response_order",
    row_order_means: "as returned",
    cost: {
      compared_target_count: 1,
      vendor_requests_issued: 1,
      vendor_cost_usd: 0.1,
      vendor_cost_usd_source: "vendor_reported",
      vendor_cost_usd_per_target: 0.1,
    },
    result_set: {
      window_internal_list_limit: 100,
      window_row_count: rows.length,
      vendor_total_count: over.vendorTotal === undefined ? 77 : over.vendorTotal,
      rows,
    },
  };
}

function compareResult(over: {
  keys: readonly string[];
  rows?: readonly AiVisibilityCompareRow[];
  unanswered?: readonly string[];
}): AiVisibilityCompareResult {
  const rows = over.rows ?? over.keys.map((key, index) => compareRow(key, index));
  return {
    groups: over.keys.map((key) => ({
      aggregation_key: key,
      target: key.startsWith("kw:")
        ? { kind: "keyword", keyword: key.slice(3) }
        : { kind: "domain", domain: key },
    })),
    scope: SCOPE,
    row_order: "vendor_response_order",
    row_order_means: "as returned",
    cost: {
      compared_target_count: over.keys.length,
      vendor_requests_issued: 1,
      vendor_cost_usd: 0.2,
      vendor_cost_usd_source: "vendor_reported",
      vendor_cost_usd_per_target: 0.2 / over.keys.length,
    },
    result_set: {
      window_internal_list_limit: 100,
      window_row_count: rows.length,
      vendor_total_count: 999,
      rows,
    },
    groups_without_vendor_row: over.unanswered ?? [],
  };
}

describe("the subject IS the identity, and its kind travels with it", () => {
  /**
   * "ideas" is a SET, so 0029's normalizer applies whole: two calls that differ only in the order
   * or the casing of the seeds are ONE subject. Without that, a tenant's history of the same
   * question forks every time they retype it.
   */
  it("derives a sorted, de-duplicated, lowercased keyword_set from the ideas seeds", () => {
    expect(
      discoverSubjectIdentity({ mode: "ideas", seeds: ["SEO Tools", "rank  tracker", "seo tools"] }),
    ).toEqual({ kind: "keyword_set", subject: ["rank tracker", "seo tools"] });
  });

  /**
   * "ideas" with ONE seed is still a SET. It is a different question from "suggestions" on the
   * same word, and 0032's cardinality CHECK allows a one-element keyword_set for exactly this.
   */
  it("keeps a one-seed ideas lookup a keyword_set rather than a keyword", () => {
    expect(discoverSubjectIdentity({ mode: "ideas", seeds: ["seo tools"] })).toEqual({
      kind: "keyword_set",
      subject: ["seo tools"],
    });
  });

  /** Two different QUESTIONS, one SUBJECT: the mode is stored in the report, not in the identity. */
  it("gives suggestions and related the SAME single-keyword identity", () => {
    const suggestions = discoverSubjectIdentity({ mode: "suggestions", seed: "  SEO   Tools " });
    expect(suggestions).toEqual({ kind: "keyword", subject: ["seo tools"] });
    expect(discoverSubjectIdentity({ mode: "related", seed: "SEO Tools", depth: 3 })).toEqual(
      suggestions,
    );
  });

  /** for_site is the ONE discover mode with a domain, and it is the port's resolved one. */
  it("records for_site as a single-element domain subject", () => {
    expect(
      discoverSubjectIdentity({ mode: "for_site", target: "example.com", include_subdomains: true }),
    ).toEqual({ kind: "domain", subject: ["example.com"] });
  });

  /**
   * The vendor's either/or, shared by BOTH AI tools — which is what makes a domain measured alone
   * and the same domain measured inside a comparison one history rather than two.
   */
  it("derives the same identity for a mention target whichever AI tool asked", () => {
    expect(mentionSubjectIdentity({ kind: "domain", domain: "example.com" }, "ai_visibility")).toEqual(
      { kind: "domain", subject: ["example.com"] },
    );
    expect(
      mentionSubjectIdentity({ kind: "keyword", keyword: "Best SEO Tools" }, "ai_visibility_compare"),
    ).toEqual({ kind: "keyword", subject: ["best seo tools"] });
  });

  /**
   * A SUBJECT THAT NORMALIZES AWAY IS REFUSED HERE, not by PostgREST. `z.string().min(1)` accepts
   * a single space, so this is reachable; 0032's non-empty CHECK would reject it, and the throw
   * would then name a constraint instead of the tool. Either way the tenant pays nothing —
   * withCredits releases on a throw — but only one of the two says what happened.
   */
  it("refuses a subject that normalized to nothing, naming the tool", () => {
    expect(() => discoverSubjectIdentity({ mode: "suggestions", seed: "   " })).toThrow(
      /discover_keywords: the subject normalized to nothing/,
    );
    expect(() => mentionSubjectIdentity({ kind: "keyword", keyword: " " }, "ai_visibility")).toThrow(
      /ai_visibility: the subject normalized to nothing/,
    );
  });
});

describe("discover_keywords' report is structural, counted before the cap, and mode-aware", () => {
  /**
   * THE MODE IS AT THE TOP AND IT IS NOT RECOVERABLE FROM THE SUBJECT: "suggestions" and "related"
   * both produce a 'keyword' row. Without it a row says what was looked up but not what was asked.
   */
  it("stores the mode, the locale and the window as O(1) top-level fields", () => {
    const report = discoverKeywordsRunReport(
      discoverResult({ subject: { mode: "related", seed: "seo tools", depth: 3 } }),
      { language_code: "tr", location_code: 2792 },
    );
    expect(report.mode).toBe("related");
    expect(report.locale).toEqual({ language_code: "tr", location_code: 2792 });
    expect(report.limit).toBe(100);
    expect(report.offset).toBe(20);
    expect(report.total).toBe(4321);
  });

  /**
   * A MODE-SPECIFIC FIELD IS PRESENT ON ITS OWN MODE AND ABSENT — not null — ELSEWHERE. An absent
   * key means "this question does not exist for this mode"; a null would mean "it was not
   * recorded", which is the collapse 0027 refused for a locale column.
   */
  it("carries depth only on related and include_subdomains only on for_site", () => {
    const related = discoverKeywordsRunReport(
      discoverResult({ subject: { mode: "related", seed: "seo tools", depth: 4 } }),
      { language_code: "en", location_code: 2840 },
    );
    expect(related.depth).toBe(4);
    expect("include_subdomains" in related).toBe(false);

    const forSite = discoverKeywordsRunReport(
      discoverResult({
        subject: { mode: "for_site", target: "example.com", include_subdomains: false },
      }),
      { language_code: "en", location_code: 2840 },
    );
    expect(forSite.include_subdomains).toBe(false);
    expect("depth" in forSite).toBe(false);

    const ideas = discoverKeywordsRunReport(
      discoverResult({ subject: { mode: "ideas", seeds: ["seo tools"] } }),
      { language_code: "en", location_code: 2840 },
    );
    expect("depth" in ideas).toBe(false);
    expect("include_subdomains" in ideas).toBe(false);
  });

  /** A vendor null is "the vendor did not say" and is stored as null. 0 is an answer (NEVER #7). */
  it("keeps the vendor's nulls as nulls in the headline row and in the total", () => {
    const report = discoverKeywordsRunReport(
      discoverResult({
        subject: { mode: "ideas", seeds: ["seo tools"] },
        vendorTotal: null,
        rows: [keywordRow({ search_volume: null, cpc: null, keyword_difficulty: null })],
      }),
      { language_code: "en", location_code: 2840 },
    );
    expect(report.total).toBeNull();
    expect(report.top).toEqual({
      keyword: "seo tools",
      search_volume: null,
      cpc: null,
      keyword_difficulty: null,
    });
  });

  /** An empty window has no headline row — and says so with null, never with a zeroed one. */
  it("stores a null headline row on an empty window", () => {
    const report = discoverKeywordsRunReport(
      discoverResult({ subject: { mode: "ideas", seeds: ["seo tools"] }, rows: [] }),
      { language_code: "en", location_code: 2840 },
    );
    expect(report.top).toBeNull();
    expect(report.shown).toBe(0);
    expect(report.rows).toEqual([]);
  });

  /**
   * THE CAP, EXERCISED. Nothing bounds a vendor response — this tool may ask for 1000 rows — so an
   * uncapped row would make the table unbounded. `shown` is the PRE-cap count, so truncating the
   * list never changes what the row claims about the run.
   */
  it("caps the stored rows at MAX_SUBJECT_RUN_ROWS while `shown` stays pre-cap", () => {
    const rows = Array.from({ length: MAX_SUBJECT_RUN_ROWS + 10 }, (_, index) =>
      keywordRow({ keyword: `kw ${index}` }),
    );
    const report = discoverKeywordsRunReport(
      discoverResult({ subject: { mode: "ideas", seeds: ["seo tools"] }, rows }),
      { language_code: "en", location_code: 2840 },
    );
    expect(report.rows).toHaveLength(MAX_SUBJECT_RUN_ROWS);
    expect(report.shown).toBe(MAX_SUBJECT_RUN_ROWS + 10);
    expect(report.rows[0]?.keyword).toBe("kw 0");
  });

  /**
   * THE FILTER LIST IS CAPPED TOO. Two by construction today, but the rule this report obeys is
   * "every list it composes goes through capRows" — a rule a reader can check, where "that one
   * happens to be short" is only a fact about today's input schema.
   */
  it("caps the vendor filter list as well", () => {
    const filters = Array.from({ length: MAX_SUBJECT_RUN_ROWS + 5 }, (_, index) => [
      "keyword_info.search_volume",
      ">",
      index,
    ]);
    const report = discoverKeywordsRunReport(
      discoverResult({ subject: { mode: "ideas", seeds: ["seo"] }, filters }),
      { language_code: "en", location_code: 2840 },
    );
    expect(report.vendor_filters_applied).toHaveLength(MAX_SUBJECT_RUN_ROWS);
  });
});

describe("ai_visibility's report keeps the vendor's two platforms and three clocks apart", () => {
  it("stores the requested platform and the echoed one as two separate fields", () => {
    const report = aiVisibilityRunReport(visibilityResult({}));
    expect(report.platform).toBe("chat_gpt");
    // A row where these disagree describes an assistant the caller did not ask about — which is
    // only visible because they are not the same field.
    expect(report.vendor_echoed_platform).toBe("google");
  });

  /** location_NAME, a string: this vendor family's locale is not the sibling numeric code. */
  it("stores the string locale this endpoint family actually takes", () => {
    expect(aiVisibilityRunReport(visibilityResult({})).locale).toEqual({
      location_name: "United States",
      language_code: "en",
    });
  });

  /** VERBATIM, never parsed: the vendor's format is not ISO-8601 and a parse is an opinion. */
  it("stores the vendor's own clock reading under the key it came from", () => {
    const report = aiVisibilityRunReport(visibilityResult({}));
    expect(report.vendor_reported_time_field).toBe("datetime");
    expect(report.vendor_reported_time_value).toBe("2026-08-14 08:12:33 +00:00");
  });

  it("keeps a missing vendor total as null rather than back-filling it from the rows", () => {
    const report = aiVisibilityRunReport(visibilityResult({ vendorTotal: null }));
    expect(report.total).toBeNull();
    expect(report.shown).toBe(1);
  });

  it("caps the stored rows at MAX_SUBJECT_RUN_ROWS while `shown` stays pre-cap", () => {
    const rows = Array.from({ length: MAX_SUBJECT_RUN_ROWS + 7 }, (_, index) =>
      mentionRow({ vendor_metrics: { mentions: index } }),
    );
    const report = aiVisibilityRunReport(visibilityResult({ rows }));
    expect(report.rows).toHaveLength(MAX_SUBJECT_RUN_ROWS);
    expect(report.shown).toBe(MAX_SUBJECT_RUN_ROWS + 7);
  });
});

describe("a comparison becomes ONE ROW PER COMPARED TARGET (0032's per-subject key)", () => {
  it("writes a row for every target, in the caller's order, each with its own identity", () => {
    const rows = aiVisibilityCompareRunRows(
      compareResult({ keys: ["example.com", "kw:seo tools", "rival.com"] }),
      [null, null, "project-1"],
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.identity)).toEqual([
      { kind: "domain", subject: ["example.com"] },
      { kind: "keyword", subject: ["seo tools"] },
      { kind: "domain", subject: ["rival.com"] },
    ]);
    expect(rows.map((row) => row.projectId)).toEqual([null, null, "project-1"]);
  });

  /**
   * MATCHED ON THE CALLER'S KEY, NEVER BY POSITION. The vendor returns the rows in whatever order
   * it likes; a positional match would put one competitor's figures on another's row, and the row
   * would look perfectly well-formed.
   */
  it("matches vendor rows to targets on the echoed key even when the vendor reorders them", () => {
    const rows = aiVisibilityCompareRunRows(
      compareResult({
        keys: ["a.com", "b.com"],
        rows: [compareRow("b.com", 99), compareRow("a.com", 1)],
      }),
      [null, null],
    );
    expect(rows[0]?.report.rows[0]?.vendor_metrics.mentions).toBe(1);
    expect(rows[1]?.report.rows[0]?.vendor_metrics.mentions).toBe(99);
  });

  /**
   * A TARGET THE VENDOR ANSWERED NOTHING FOR STILL GETS A ROW. The tenant paid 90 credits for it,
   * and "the vendor did not report on this target" is not "this target has zero mentions" — the
   * flag is read off the PORT's own `groups_without_vendor_row`, not re-derived from rows.length.
   */
  it("records an unanswered target as a row carrying answered:false, not as a missing row", () => {
    const rows = aiVisibilityCompareRunRows(
      compareResult({
        keys: ["a.com", "b.com"],
        rows: [compareRow("a.com", 5)],
        unanswered: ["b.com"],
      }),
      [null, null],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.report.answered).toBe(true);
    expect(rows[1]?.report.answered).toBe(false);
    expect(rows[1]?.report.shown).toBe(0);
    expect(rows[1]?.report.rows).toEqual([]);
  });

  /**
   * THE COMPARISON IS RECONSTRUCTABLE FROM ANY ONE OF ITS ROWS — what 0032 traded a `run_id`
   * column for. A row never lists itself among the others.
   */
  it("carries the other targets' labels and the priced target count on every row", () => {
    const rows = aiVisibilityCompareRunRows(
      compareResult({ keys: ["a.com", "b.com", "c.com"] }),
      [null, null, null],
    );
    expect(rows[0]?.report.compared_target_count).toBe(3);
    expect(rows[0]?.report.compared_with).toEqual(["b.com", "c.com"]);
    expect(rows[2]?.report.compared_with).toEqual(["a.com", "b.com"]);
  });

  /** THE `compared_with` CAP, EXERCISED — the same uniform rule every other list here obeys. */
  it("caps compared_with at MAX_SUBJECT_RUN_ROWS", () => {
    const keys = Array.from({ length: MAX_SUBJECT_RUN_ROWS + 10 }, (_, index) => `d${index}.com`);
    const rows = aiVisibilityCompareRunRows(
      compareResult({ keys }),
      keys.map(() => null),
    );
    expect(rows[0]?.report.compared_with).toHaveLength(MAX_SUBJECT_RUN_ROWS);
    expect(rows[0]?.report.compared_target_count).toBe(keys.length);
  });

  it("caps a single target's stored rows while `shown` stays pre-cap", () => {
    const many = Array.from({ length: MAX_SUBJECT_RUN_ROWS + 3 }, (_, index) =>
      compareRow("a.com", index),
    );
    const rows = aiVisibilityCompareRunRows(
      compareResult({ keys: ["a.com", "b.com"], rows: [...many, compareRow("b.com", 0)] }),
      [null, null],
    );
    expect(rows[0]?.report.rows).toHaveLength(MAX_SUBJECT_RUN_ROWS);
    expect(rows[0]?.report.shown).toBe(MAX_SUBJECT_RUN_ROWS + 3);
  });

  /**
   * THE RESPONSE-WIDE COUNT IS NOT ON A PER-SUBJECT ROW. `vendor_total_count` counts rows across
   * EVERY compared target, so a `total` here would be a number a reader takes for this target's.
   */
  it("stores no `total` on a compare row", () => {
    const rows = aiVisibilityCompareRunRows(compareResult({ keys: ["a.com", "b.com"] }), [
      null,
      null,
    ]);
    expect("total" in rows[0]!.report).toBe(false);
  });

  /** A short project list would silently record a project run as a bare one. It is refused. */
  it("refuses a resolved-project list that does not line up with the targets", () => {
    expect(() =>
      aiVisibilityCompareRunRows(compareResult({ keys: ["a.com", "b.com"] }), [null]),
    ).toThrow(/1 resolved projects for 2 compared targets/);
  });
});

describe("the report reaches jsonb as the shape that was type-checked", () => {
  /**
   * THE ROUND TRIP IS WHAT DROPS AN `undefined` KEY. Without it a spread of
   * `{ depth: undefined }` would reach PostgREST and arrive as a null — turning "this question
   * does not exist for this mode" into "it was not recorded".
   */
  it("drops the mode-specific keys that do not apply, rather than nulling them", () => {
    const json = subjectLookupReportToJson(
      discoverKeywordsRunReport(
        discoverResult({ subject: { mode: "ideas", seeds: ["seo tools"] } }),
        { language_code: "en", location_code: 2840 },
      ),
    ) as Record<string, unknown>;
    expect("depth" in json).toBe(false);
    expect("include_subdomains" in json).toBe(false);
  });

  /**
   * THE COUNTERS ARE AT THE TOP LEVEL OF THE STORED DOCUMENT, which is the whole reason the panel
   * can read `report->total` instead of downloading it. Asserted on the JSON that is actually
   * stored, so nesting them under a `counters` object fails here rather than in a blank column.
   */
  it("keeps every headline counter at the TOP of the stored document", () => {
    const discover = subjectLookupReportToJson(
      discoverKeywordsRunReport(
        discoverResult({ subject: { mode: "for_site", target: "example.com", include_subdomains: true } }),
        { language_code: "en", location_code: 2840 },
      ),
    ) as Record<string, unknown>;
    expect(discover.total).toBe(4321);
    expect(discover.shown).toBe(1);
    expect(discover.mode).toBe("for_site");
    expect((discover.top as Record<string, unknown>).keyword).toBe("seo tools");

    const visibility = subjectLookupReportToJson(aiVisibilityRunReport(visibilityResult({}))) as Record<
      string,
      unknown
    >;
    expect(visibility.total).toBe(77);
    expect(visibility.shown).toBe(1);
    expect(visibility.platform).toBe("chat_gpt");

    const compare = subjectLookupReportToJson(
      aiVisibilityCompareRunRows(compareResult({ keys: ["a.com", "b.com"] }), [null, null])[0]!
        .report,
    ) as Record<string, unknown>;
    expect(compare.answered).toBe(true);
    expect(compare.shown).toBe(1);
    expect(compare.compared_target_count).toBe(2);
    expect(compare.platform).toBe("chat_gpt");
  });

  /** A vendor's open key bag survives verbatim — nothing is renamed on the way to disk. */
  it("stores the vendor's own metric keys unchanged", () => {
    const json = subjectLookupReportToJson(
      aiVisibilityRunReport(
        visibilityResult({
          rows: [
            {
              vendor_metrics: { mentions_count: 3, some_ratio: 0.5, absent: null },
              vendor_nested_fields_not_carried: ["items"],
            },
          ],
        }),
      ),
    ) as Record<string, unknown>;
    const rows = json.rows as Record<string, unknown>[];
    expect(rows[0]?.vendor_metrics).toEqual({ mentions_count: 3, some_ratio: 0.5, absent: null });
  });
});
