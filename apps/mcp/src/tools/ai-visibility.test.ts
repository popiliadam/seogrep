import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  MAX_INTERNAL_LIST_ROWS,
  PLATFORM_MEANS,
  ROW_ORDER,
  ROW_ORDER_MEANS,
  VENDOR_MAX_INTERNAL_LIST_AGGREGATED,
  createMockAiVisibilityPort,
  disabledAiVisibilityPort,
  type AiVisibilityResult,
  type AiVisibilityRow,
  type MeasurementScope,
} from "../dfs/llm-mentions.ts";
import {
  SUBJECT_INPUT_RULES,
  SUBJECT_SPECIFIC_FIELDS,
  buildAiVisibilityQuery,
  describeSubject,
  formatAiVisibility,
  makeAiVisibilityTool,
} from "./ai-visibility.ts";
import { AI_VISIBILITY_JUDGEMENT_NOTE } from "./ai-visibility-shared.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import aggregatedFixture from "../dfs/fixtures/llm-mentions-aggregated-metrics.json";
import crossFixture from "../dfs/fixtures/llm-mentions-cross-aggregated-metrics.json";

/**
 * Fast-lane (DB-less) proofs for ai_visibility. The credit LEDGER behaviour (mock -> reserve +
 * commit at 90; disabled / trial / DFS-error -> no charge) is proven against the real stack in
 * ai-visibility.db.test.ts. Here we prove the three things this surface is FOR:
 *
 *   1. THE SUBJECT DISCRIMINATION — a domain lookup and a keyword lookup take different inputs,
 *      and a field belonging to the other subject is REJECTED rather than ignored;
 *   2. NEVER #7, at the highest bar on this surface — the platform, the locale, the vendor's own
 *      timestamp and the ABSENCE of any date range are printed on every answer; a vendor null is
 *      words and a vendor 0 is 0; every field keeps the vendor's own name because nobody in this
 *      repo has ever seen a real row of this family;
 *   3. the price control — the schema's maximum IS the port's row cap, because that cap is what
 *      the signed 90 rests on.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const mockPort = () =>
  createMockAiVisibilityPort({ aggregated: aggregatedFixture, crossAggregated: crossFixture });

/**
 * THE ENV THIS FILE MEASURES AGAINST. Every "reaches the credit guard" assertion reads a MISSING
 * Supabase env as its signal — the guard is the first thing past the free gates, and with no DB
 * configured it throws naming SUPABASE. The sibling surface MEASURED that leaving this to the
 * ambient shell makes those specs pass or fail by who ran them, so the env is cleared per test.
 */
const SUPABASE_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;

function withoutSupabaseEnv(): void {
  let saved: Partial<Record<(typeof SUPABASE_ENV_KEYS)[number], string | undefined>> = {};
  beforeEach(() => {
    saved = {};
    for (const key of SUPABASE_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of SUPABASE_ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const FULL_SCOPE: MeasurementScope = {
  platform_requested: "chat_gpt",
  platform_means: PLATFORM_MEANS.chat_gpt,
  vendor_echoed_platform: "chat_gpt",
  location_name: "United States",
  language_code: "en",
  vendor_reported_time_field: "datetime",
  vendor_reported_time_value: "2026-08-18 09:00:00 +00:00",
};

/** The vendor said nothing about WHERE, WHEN, or which platform it really answered on. */
const SILENT_SCOPE: MeasurementScope = {
  platform_requested: "google",
  platform_means: PLATFORM_MEANS.google,
  vendor_echoed_platform: null,
  location_name: null,
  language_code: null,
  vendor_reported_time_field: null,
  vendor_reported_time_value: null,
};

const ROW_WITH_ZERO_AND_SILENCE: AiVisibilityRow = {
  vendor_metrics: { target: "example.com", mentions_count: 0, mentions_share: null },
  vendor_nested_fields_not_carried: ["mentions_by_intent"],
};

function resultWith(
  rows: readonly AiVisibilityRow[],
  scope: MeasurementScope = FULL_SCOPE,
  vendorTotal: number | null = 412,
): AiVisibilityResult {
  return {
    subject: { kind: "domain", domain: "example.com" },
    scope,
    row_order: ROW_ORDER,
    row_order_means: ROW_ORDER_MEANS,
    cost: {
      compared_target_count: 1,
      vendor_requests_issued: 1,
      vendor_cost_usd: 0.103,
      vendor_cost_usd_source: "vendor_reported",
      vendor_cost_usd_per_target: 0.103,
    },
    result_set: {
      window_internal_list_limit: MAX_INTERNAL_LIST_ROWS,
      window_row_count: rows.length,
      vendor_total_count: vendorTotal,
      rows,
    },
  };
}

/** One lookup through the mock port, formatted — the text every honesty pin below reads. */
async function fixtureAnswer(): Promise<string> {
  const result = await mockPort().fetchAiVisibility({
    target: { kind: "domain", domain: "example-fixture.test" },
    platform: "chat_gpt",
    internal_list_limit: MAX_INTERNAL_LIST_ROWS,
    location_name: "United States",
    language_code: "en",
  });
  return formatAiVisibility(result);
}

describe("THE SUBJECT DISCRIMINATION — two subjects, two inputs, nothing borrowed", () => {
  withoutSupabaseEnv();
  const tool = makeAiVisibilityTool({ port: mockPort(), loadProject });

  it("requires the subject and the platform, and defaults neither", () => {
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { default?: unknown; enum?: string[] }>;
    };
    expect(schema.required).toContain("subject");
    expect(schema.required).toContain("platform");
    expect(schema.properties.subject?.default).toBeUndefined();
    expect(schema.properties.platform?.default).toBeUndefined();
    // The platform enum is the VENDOR's two, and there is no "all assistants" option to pick.
    expect(schema.properties.platform?.enum).toEqual(["chat_gpt", "google"]);
  });

  it("rejects a field belonging to the other subject rather than ignoring it", async () => {
    const keywordOnDomain = await tool.run(CTX, {
      subject: "domain",
      target: "example.com",
      keyword: "seo software",
      platform: "chat_gpt",
    });
    expect(keywordOnDomain.isError).toBe(true);
    expect(keywordOnDomain.content[0]?.text).toMatch(/does not take "keyword"/i);
    expect(keywordOnDomain.content[0]?.text).toMatch(/refused rather than ignored/i);

    const domainOnKeyword = await tool.run(CTX, {
      subject: "keyword",
      keyword: "seo software",
      target: "example.com",
      platform: "chat_gpt",
    });
    expect(domainOnKeyword.isError).toBe(true);
    expect(domainOnKeyword.content[0]?.text).toMatch(/does not take "target"/i);

    const projectOnKeyword = await tool.run(CTX, {
      subject: "keyword",
      keyword: "seo software",
      project_id: PROJECT_ID,
      platform: "chat_gpt",
    });
    expect(projectOnKeyword.isError).toBe(true);
    expect(projectOnKeyword.content[0]?.text).toMatch(/does not take "project_id"/i);
  });

  it("refuses a keyword subject with no keyword at all", async () => {
    const missing = await tool.run(CTX, { subject: "keyword", platform: "chat_gpt" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toMatch(/"keyword" is missing/i);
  });

  it("states each subject's rule over exactly the mode-specific fields", () => {
    for (const rule of Object.values(SUBJECT_INPUT_RULES)) {
      for (const field of [...rule.takes, ...rule.requires]) {
        expect(SUBJECT_SPECIFIC_FIELDS).toContain(field);
      }
    }
  });

  it("builds each subject's port query by narrowing, in the vendor's own grammar", () => {
    const domain = buildAiVisibilityQuery(
      {
        subject: "domain",
        platform: "chat_gpt",
        internal_list_limit: MAX_INTERNAL_LIST_ROWS,
        location_name: "United States",
        language_code: "en",
      },
      "example.com",
    );
    expect(domain.target).toEqual({ kind: "domain", domain: "example.com" });
    // The locale key this family takes is location_name (a STRING), never location_code.
    expect(domain).not.toHaveProperty("location_code");
    expect(domain.location_name).toBe("United States");

    const keyword = buildAiVisibilityQuery(
      {
        subject: "keyword",
        keyword: "seo software",
        platform: "google",
        internal_list_limit: 10,
      },
      null,
    );
    expect(keyword.target).toEqual({ kind: "keyword", keyword: "seo software" });
    expect(keyword.location_name).toBeUndefined();
  });
});

describe("the schema's maximum IS the vendor's published ceiling", () => {
  const tool = makeAiVisibilityTool();

  /**
   * WAS "the price control — the schema's maximum IS the port's row cap", asserting 100. The
   * PREMISE was falsified on 2026-08-25: DataForSEO publishes "maximum value: `20`" for this
   * endpoint's `internal_list_limit`, so the surface was advertising — and the port was sending —
   * a value the vendor rejects at the TASK. That is the whole outage, and this is its surface half.
   *
   * The maximum is still asserted AGAINST a port constant rather than restated; the constant it
   * asserts against is now the VENDOR's ceiling for THIS endpoint rather than the pricing basis.
   */
  it("caps internal_list_limit at exactly the vendor's ceiling, and defaults to it", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { default?: number; maximum?: number; minimum?: number }>;
    };
    expect(schema.properties.internal_list_limit?.maximum).toBe(
      VENDOR_MAX_INTERNAL_LIST_AGGREGATED,
    );
    expect(schema.properties.internal_list_limit?.minimum).toBe(1);
    expect(schema.properties.internal_list_limit?.default).toBe(
      VENDOR_MAX_INTERNAL_LIST_AGGREGATED,
    );
    // The surface must never again advertise the PRICING basis as a vendor-accepted value.
    expect(schema.properties.internal_list_limit?.maximum).not.toBe(MAX_INTERNAL_LIST_ROWS);
  });

  it("rejects a row count past the cap before any work", async () => {
    const wide = await tool.run(CTX, {
      subject: "keyword",
      keyword: "x",
      platform: "chat_gpt",
      internal_list_limit: VENDOR_MAX_INTERNAL_LIST_AGGREGATED + 1,
    });
    expect(wide.isError).toBe(true);
    expect(wide.content[0]?.text).toMatch(/invalid input/i);
  });

  it("advertises its name, the 90-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("ai_visibility");
    expect(TOOL_COSTS.ai_visibility).toBe(90);
    expect(tool.description).toContain("Costs 90 credits.");
    const schema = tool.inputJsonSchema as { properties: Record<string, { format?: string }> };
    expect(Object.keys(schema.properties).sort()).toEqual([
      "internal_list_limit",
      "keyword",
      "language_code",
      "location_name",
      "platform",
      "project_id",
      "subject",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
  });

  it("says it needs a paid balance and promises the free refusal", () => {
    expect(tool.description).toMatch(/paid credit balance/i);
    expect(tool.description).toMatch(/charges nothing/i);
    expect(tool.description).not.toMatch(/is (currently )?(turned )?off\b/i);
  });
});

describe("NEVER #7 — one platform, one locale, one moment, and no verdict of ours", () => {
  it("prints the platform's own meaning and keeps the vendor's echo separate from our request", async () => {
    const text = await fixtureAnswer();
    expect(text).toContain(PLATFORM_MEANS.chat_gpt);
    expect(text).toMatch(/says nothing about any other assistant/i);
    expect(text).toMatch(/echoed the platform back as `chat_gpt`/i);
  });

  it("says the platform was NOT confirmed when the vendor echoed none", () => {
    const text = formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE], SILENT_SCOPE));
    expect(text).toMatch(/did not echo a platform back/i);
    expect(text).toMatch(/rather than one the vendor confirmed/i);
  });

  it("names the locale it asked under — or says plainly that none was specified", async () => {
    expect(await fixtureAnswer()).toContain('location_name "United States", language_code "en"');
    const silent = formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE], SILENT_SCOPE));
    expect(silent).toMatch(/location_name not specified in this request/i);
    expect(silent).toMatch(/language_code not specified in this request/i);
  });

  /**
   * THE TIMESTAMP IS THE VENDOR'S OR IT IS ABSENT. `Date.now()` is bracketed so the current year
   * cannot appear in an answer the vendor did not date — a clock reading substituted here would
   * read as "measured just now", which is a different claim from "we do not know when".
   */
  it("prints the vendor's timestamp with the vendor key it came from", async () => {
    const text = await fixtureAnswer();
    expect(text).toMatch(/DataForSEO reported `datetime` 2026-08-18 09:00:00 \+00:00/);
  });

  it("substitutes NO clock reading when the vendor reported no time", () => {
    const before = new Date().getFullYear();
    const text = formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE], SILENT_SCOPE));
    const after = new Date().getFullYear();
    expect(text).toMatch(/did not report when it measured this/i);
    expect(text).toMatch(/does not put its own clock/i);
    for (const year of new Set([before, after])) {
      expect(text, `the current year ${year} leaked into an undated answer`).not.toContain(
        String(year),
      );
    }
  });

  it("says there is no date range to ask for, rather than leaving 'now' to be assumed", async () => {
    for (const text of [await fixtureAnswer(), formatAiVisibility(resultWith([]))]) {
      expect(text).toMatch(/takes no date range/i);
      expect(text).toMatch(/not scoped to a period you chose/i);
    }
  });

  it("prints a vendor zero as 0 and a vendor null in WORDS — never as a zero", () => {
    const text = formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE]));
    expect(text).toContain("mentions_count 0");
    expect(text).toContain("mentions_share not reported by DataForSEO");
    expect(text).not.toContain("mentions_share 0");
  });

  it("keeps the fixture's own zero and its silent siblings apart", async () => {
    const text = await fixtureAnswer();
    // The fixture's second item really did report 0 mentions; the third reported nothing at all.
    expect(text).toContain("mentions_count 0");
    expect(text).toContain("mentions_share not reported by DataForSEO");
    expect(text).toContain("target third-fixture.test");
  });

  it("carries the vendor's own keys, and names the nested fields it did not carry", async () => {
    const text = await fixtureAnswer();
    expect(text).toContain("mentions_count 37");
    expect(text).toContain("sources_count 12");
    expect(text).toMatch(/not carried into this answer: mentions_by_intent, top_sources/);
  });

  it("invents no score, no share of voice, no sentiment and no ranking", async () => {
    const text = await fixtureAnswer();
    // The judgement note DENIES each of these by name, so it is cut out before the body is
    // scanned: a guard that tripped on the denial would push the answer toward saying LESS about
    // what it is not, which is the opposite of what this pin is for.
    const body = text.replace(AI_VISIBILITY_JUDGEMENT_NOTE, "");
    for (const pattern of [
      /visibility score/i,
      /share of voice/i,
      /sentiment/i,
      /\brank(ed|ing)? #?\d/i,
      /\bwinner\b/i,
      /\bleader\b/i,
      /\bmost visible\b/i,
    ]) {
      expect(body, `an invented judgement matching ${pattern}`).not.toMatch(pattern);
    }
    expect(text).toContain(AI_VISIBILITY_JUDGEMENT_NOTE);
    expect(text).toMatch(/computes no visibility score/i);
    expect(text).toMatch(/different answers to the same question/i);
  });

  /**
   * NO SUPERLATIVE ABOUT THE PRODUCT, on the axis two referees already paid for on the sibling
   * surfaces, and no re-ordering of the vendor's rows. Read as SOURCE, comments included, because
   * last time such a sentence lived in a comment before it was copied onto a published page.
   */
  it("this module's own source ranks nothing it has no number for", () => {
    for (const file of ["./ai-visibility.ts", "./ai-visibility-shared.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const pattern of [
        /the most of any/i,
        /more than any other/i,
        /(?:the )?heaviest\b/i,
        /(?:the )?most (?:requests|round.?trips|calls)/i,
        /(?:the )?(?:largest|biggest|highest) number of (?:requests|round.?trips|calls)/i,
        /than any other (?:tool|seogrep)/i,
        /\bbest (?:tool|way) (?:for|to)/i,
      ]) {
        expect(source, `${file}: uncheckable superlative matching ${pattern}`).not.toMatch(pattern);
      }
      expect(source).not.toMatch(/\.sort\(/);
      expect(source).not.toMatch(/\.reverse\(\)/);
    }
  });
});

describe("the output says WHAT was asked and over WHAT set", () => {
  it("names the vendor function from the endpoint the money is spent at", async () => {
    expect(await fixtureAnswer()).toContain("DataForSEO LLM Mentions aggregated_metrics");
  });

  it("describes a domain, a project and a keyword subject in their own terms", () => {
    expect(describeSubject({ kind: "domain", domain: "example.com" })).toBe('"example.com"');
    expect(describeSubject({ kind: "domain", domain: "example.com" }, PROJECT)).toBe(
      'your project "example.com"',
    );
    expect(describeSubject({ kind: "keyword", keyword: "seo software" })).toBe(
      'the keyword "seo software"',
    );
  });

  it("captions the rows with our cap and the vendor's whole-set count, kept apart", async () => {
    const text = await fixtureAnswer();
    // The caption prints the limit that was actually SENT — the vendor's ceiling, not the pricing
    // basis. Printing 100 here would caption the answer with a number the vendor never accepted.
    expect(text).toContain(
      `3 rows came back under an internal_list_limit of ${VENDOR_MAX_INTERNAL_LIST_AGGREGATED}`,
    );
    expect(text).toContain("DataForSEO counts 412 matching this lookup in total");
  });

  it("says so when the vendor gave no total, instead of back-filling one from the rows", () => {
    const text = formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE], FULL_SCOPE, null));
    expect(text).toMatch(/did not say how many this lookup matches in total/i);
    expect(text).not.toMatch(/counts 1 matching/i);
  });

  it("states that this endpoint offers no paging, rather than implying a next page", async () => {
    expect(await fixtureAnswer()).toMatch(/no paging — there is no offset to advance/i);
  });

  it("prints the vendor's own row order, attributed to the vendor", async () => {
    const text = await fixtureAnswer();
    expect(text).toContain(ROW_ORDER_MEANS);
    expect(text).toMatch(/no ranking here is SeoGrep's/i);
  });

  it("answers 'no rows' as a delivered answer, refusing the wider reading", () => {
    const text = formatAiVisibility(resultWith([]));
    expect(text).toMatch(/^No AI-mention rows for/);
    expect(text).toMatch(/not a statement that nobody ever mentions this/i);
    expect(text).toMatch(/it is not a zero/i);
  });

  it("names the resolved PROJECT in the heading when the domain came from one", async () => {
    const result = await mockPort().fetchAiVisibility({
      target: { kind: "domain", domain: "example.com" },
      platform: "chat_gpt",
      internal_list_limit: MAX_INTERNAL_LIST_ROWS,
    });
    expect(formatAiVisibility(result, PROJECT)).toContain('AI visibility for your project "example.com"');
  });
});

describe("ai_visibility free pre-reserve gates (no credit machinery)", () => {
  withoutSupabaseEnv();

  const serving = () => makeAiVisibilityTool({ port: mockPort(), loadProject });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeAiVisibilityTool({ port: disabledAiVisibilityPort(), loadProject });
    const refused = await tool.run(CTX, {
      subject: "keyword",
      keyword: "seo software",
      platform: "chat_gpt",
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/not yet enabled/i);
    expect(refused.content[0]?.text).toMatch(/not charged/i);
    // ...and it never leaks the fixture rows it could have served instead (NEVER #7).
    expect(refused.content[0]?.text).not.toContain("mentions_count");
    expect(refused.content[0]?.text).not.toContain("example-fixture.test");
  });

  it("rejects a non-public domain before anything is charged", async () => {
    const rejected = await serving().run(CTX, {
      subject: "domain",
      target: "not a domain",
      platform: "chat_gpt",
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("rejects a domain subject naming NEITHER project_id nor target, and one naming BOTH", async () => {
    const neither = await serving().run(CTX, { subject: "domain", platform: "chat_gpt" });
    expect(neither.isError).toBe(true);
    expect(neither.content[0]?.text).toMatch(/Nothing to look up/i);

    const both = await serving().run(CTX, {
      subject: "domain",
      target: "example.com",
      project_id: PROJECT_ID,
      platform: "chat_gpt",
    });
    expect(both.isError).toBe(true);
    expect(both.content[0]?.text).toMatch(/not both/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const theirs = await serving().run(CTX, {
      subject: "domain",
      project_id: OTHER_PROJECT_ID,
      platform: "chat_gpt",
    });
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
  });

  it("a RESOLVED project_id reaches the credit guard — the gates are not a dead end", async () => {
    await expect(
      serving().run(CTX, { subject: "domain", project_id: PROJECT_ID, platform: "chat_gpt" }),
    ).rejects.toThrow(/SUPABASE/i);
  });

  /** The keyword subject reads no project at all — proven by a loader that throws if touched. */
  it("a keyword subject never reads a project", async () => {
    const tool = makeAiVisibilityTool({
      port: mockPort(),
      loadProject: async () => {
        throw new Error("the project table must not be read for a keyword subject");
      },
    });
    await expect(
      tool.run(CTX, { subject: "keyword", keyword: "seo software", platform: "chat_gpt" }),
    ).rejects.toThrow(/SUPABASE/i);
  });
});
