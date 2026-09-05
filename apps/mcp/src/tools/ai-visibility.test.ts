import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS, creditCostFor } from "../credits/costs.ts";
import type { CreditContext, CreditMeta } from "../credits/guard.ts";
import {
  DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT,
  LlmMentionsVendorError,
  MAX_INTERNAL_LIST_ROWS,
  PLATFORM_MEANS,
  ROW_ORDER,
  ROW_ORDER_MEANS,
  VENDOR_MAX_INTERNAL_LIST_AGGREGATED,
  buildAiVisibilityRequestBody,
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
import {
  AI_VISIBILITY_JUDGEMENT_NOTE,
  UNVALIDATED_LOCALE_NOTE,
  catchVendorFailure,
} from "./ai-visibility-shared.ts";
import { defaultLocaleWarning } from "../format/locale-default.ts";
import { AI_QUERY_FAN_OUT_MECHANISM } from "./serp-features.ts";
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

  /**
   * THE GATE COMPARES CASE-BLIND, SO THE WIRE MUST NOT. "united states" is waved through by
   * refinePlatformLocale, and sending that raw string would leave the $0.30 the gate exists to save
   * exposed on exactly the input the gate accepts — the vendor was never measured accepting a
   * lower-case name. What goes out is the vendor's own spelling; `google` is untouched.
   */
  it("sends chat_gpt's locale in the vendor's spelling, whatever case the caller typed", () => {
    const sent = buildAiVisibilityRequestBody(
      buildAiVisibilityQuery(
        {
          subject: "domain",
          platform: "chat_gpt",
          internal_list_limit: MAX_INTERNAL_LIST_ROWS,
          location_name: " united states ",
          language_code: "EN",
        },
        "example.com",
      ),
    );
    expect(sent.location_name).toBe("United States");
    expect(sent.language_code).toBe("en");
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

  /**
   * H-2 — THE DEFAULT IS NAMED, because it is KNOWN. This used to end "…so DataForSEO applied its
   * own default and SeoGrep does not know which": an honest sentence about a fact nobody had
   * looked up. The vendor publishes both defaults on both endpoints (`location_code` 2840,
   * `language_code` `en`), so the answer names the locale the lookup really ran in. "We do not
   * know" and "the United States, in English" are different answers to a 90-credit question, and
   * only one of them can be acted on.
   */
  it("names the locale it asked under — and NAMES the vendor default when none was specified", async () => {
    expect(await fixtureAnswer()).toContain('location_name "United States", language_code "en"');
    const silent = formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE], SILENT_SCOPE));
    expect(silent).toMatch(/location_name not specified in this request/i);
    expect(silent).toMatch(/language_code not specified in this request/i);
    expect(silent).toMatch(/published default — location_code 2840, the United States/i);
    expect(silent).toMatch(/published default — "en", English/i);
    // ...and the withdrawn claim is not restated anywhere.
    expect(silent).not.toMatch(/does not know which/i);
  });

  /**
   * H-2 — THE US/ENGLISH DEFAULT WARNING, joined rather than re-worded. This family is the sixth
   * member of the class format/locale-default.ts was written for, and the module's own rule is
   * that one mistake gets ONE sentence: on `google` the shared sentence is used verbatim, with
   * the parameter names THIS family takes substituted in (a location NAME, not a location code).
   */
  it("warns a country-code TLD subject riding the default locale, in the shared wording", () => {
    const scope: MeasurementScope = { ...SILENT_SCOPE, platform_requested: "google" };
    const text = formatAiVisibility({
      ...resultWith([ROW_WITH_ZERO_AND_SILENCE], scope),
      subject: { kind: "domain", domain: "adstark.com.tr" },
    });
    expect(text).toContain(
      defaultLocaleWarning(
        "adstark.com.tr",
        { language_code: "en", location_code: 2840 },
        { language: "language_code", location: "location_name", noun: "value" },
      ),
    );
    // It tells the caller a parameter this tool actually takes.
    expect(text).toMatch(/pass language_code and location_name for it/);
    expect(text).not.toMatch(/pass language_code and location_code for it/);
  });

  /**
   * ...and on `chat_gpt` the ADVICE has to differ, because "pass the locale for that country" is
   * advice DataForSEO refuses. The trigger is the same; the next step is the other platform.
   */
  it("tells a chat_gpt caller the locale cannot be changed, not to change it", () => {
    const scope: MeasurementScope = {
      ...SILENT_SCOPE,
      platform_requested: "chat_gpt",
      platform_means: PLATFORM_MEANS.chat_gpt,
    };
    const text = formatAiVisibility({
      ...resultWith([ROW_WITH_ZERO_AND_SILENCE], scope),
      subject: { kind: "domain", domain: "adstark.com.tr" },
    });
    expect(text).toMatch(/for the united states and english only/i);
    expect(text).toMatch(/no other locale to ask for/i);
    expect(text).not.toMatch(/pass language_code and location_name for it/);
  });

  /** A keyword carries no country, and a caller who CHOSE a locale is not second-guessed. */
  it("stays silent when the subject has no country-code TLD, or the caller named a locale", () => {
    const keyword = formatAiVisibility({
      ...resultWith([ROW_WITH_ZERO_AND_SILENCE], SILENT_SCOPE),
      subject: { kind: "keyword", keyword: "seo software" },
    });
    expect(keyword).not.toMatch(/two-letter country-code TLD/i);
    const chosen = formatAiVisibility({
      ...resultWith([ROW_WITH_ZERO_AND_SILENCE], FULL_SCOPE),
      subject: { kind: "domain", domain: "adstark.com.tr" },
    });
    expect(chosen).not.toMatch(/two-letter country-code TLD/i);
  });

  /**
   * WHAT WAS NOT CHECKED, said out loud. A `google` locale is passed straight to the vendor:
   * SeoGrep does not hold the vendor's free `locations_and_languages` list, so it is not claiming
   * the value is valid. A locale the vendor has no data for comes back THIN rather than as an
   * error — the shape that reads as "nobody mentions you".
   */
  it("says a google locale was not validated, and says nothing of the sort on chat_gpt", () => {
    const scope: MeasurementScope = {
      ...FULL_SCOPE,
      platform_requested: "google",
      platform_means: PLATFORM_MEANS.google,
      location_name: "Turkey",
      language_code: "tr",
    };
    const text = formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE], scope));
    expect(text).toContain(UNVALIDATED_LOCALE_NOTE);
    expect(text).toMatch(/locations_and_languages/);
    // chat_gpt's locale IS checked — claiming otherwise there would be false modesty.
    expect(formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE], FULL_SCOPE))).not.toContain(
      UNVALIDATED_LOCALE_NOTE,
    );
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
   * AV-8 / H-4 — THE NOTE IS PINNED BY WHAT IT SAYS, NOT BY ITS NAME.
   *
   * Every pin on this constant was `toContain(AI_VISIBILITY_JUDGEMENT_NOTE)`, which asserts the
   * constant's IDENTITY: emptying it leaves the suite green. Measured — deleting the ordering
   * sentence from it kept 4198/4198 passing. Two of its three loads had no pin of their own (the
   * referee measured that the "no visibility score" half WAS pinned at :395, so only these two
   * were open), and they are the two that carry the NEVER #7 weight.
   *
   * Read with the SHORTEST DISTINGUISHING PHRASE and `/i`, per signed lesson 11: a test that
   * repeats the source literal is a second copy of the sentence, free to be updated alongside it
   * without ever going red.
   */
  it("pins what the judgement note SAYS: it re-orders nothing, and unreported is not zero", async () => {
    const text = await fixtureAnswer();
    expect(text).toMatch(/re-orders nothing/i);
    expect(text).toMatch(/nothing to sort by/i);
    expect(text).toMatch(/unreported, never as a zero/i);
  });

  /**
   * R-5.5 — the mechanism, on the two surfaces that measure Google's AI answers DIRECTLY and had
   * no fan-out sentence at all until now. It shares the FACT with `serp_snapshot` and
   * `keyword_positions` (AI_QUERY_FAN_OUT_MECHANISM) and not the sentence: their ending is about
   * an AI Overview block "reported above", which this tool never reports.
   *
   * `chat_gpt` gets none of it. Query fan-out is a claim about Google, and printing it under a
   * ChatGPT measurement would assert a mechanism nobody measured there.
   */
  it("qualifies a google measurement with the query fan-out behind it — and only google", () => {
    const google: MeasurementScope = {
      ...FULL_SCOPE,
      platform_requested: "google",
      platform_means: PLATFORM_MEANS.google,
    };
    const text = formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE], google));
    expect(text).toContain(AI_QUERY_FAN_OUT_MECHANISM);
    expect(text).toMatch(/output of that fan-out/i);
    expect(formatAiVisibility(resultWith([ROW_WITH_ZERO_AND_SILENCE], FULL_SCOPE))).not.toContain(
      AI_QUERY_FAN_OUT_MECHANISM,
    );
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

  /**
   * H-1 — THE PLATFORM x LOCALE MATRIX, CHECKED BEFORE THE MONEY MOVES.
   *
   * Measured live 2026-09-04: `platform: "chat_gpt"` with `location_name: "Turkey"` reserved the
   * credits, went out to DataForSEO, and came back `40501 Invalid Field: 'location_name'`; the
   * same again with `language_code: "tr"`. Two doomed attempts at $0.30 of reserved vendor budget
   * each then tripped the $0.50 daily free-vendor allowance and PAUSED the tool for that account
   * until 00:00 UTC — so one caller's locale typo took the tool down for the day.
   *
   * The vendor publishes the rule that makes both refusals predictable without spending anything:
   * "chat_gpt data is available for the United States and English only" (DataForSEO, LLM Mentions
   * aggregated_metrics, read 2026-09-05). This is that rule applied where it costs nothing. It
   * lands in the SCHEMA, not in the handler, so "before the reserve" is a property of the shape
   * rather than of the order somebody happened to write the gates in.
   */
  it("refuses chat_gpt with a non-US location BEFORE any reserve, quoting the vendor", async () => {
    const refused = await serving().run(CTX, {
      subject: "keyword",
      keyword: "seo software",
      platform: "chat_gpt",
      location_name: "Turkey",
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/for the united states and english only/i);
    expect(refused.content[0]?.text).toMatch(/location_name/);
    expect(refused.content[0]?.text).toMatch(/not charged/i);
  });

  it("refuses chat_gpt with a non-English language, and names BOTH fields when both are wrong", async () => {
    const language = await serving().run(CTX, {
      subject: "keyword",
      keyword: "seo software",
      platform: "chat_gpt",
      language_code: "tr",
    });
    expect(language.isError).toBe(true);
    expect(language.content[0]?.text).toMatch(/language_code/);

    const both = await serving().run(CTX, {
      subject: "keyword",
      keyword: "seo software",
      platform: "chat_gpt",
      location_name: "Turkey",
      language_code: "tr",
    });
    expect(both.isError).toBe(true);
    expect(both.content[0]?.text).toMatch(/location_name/);
    expect(both.content[0]?.text).toMatch(/language_code/);
  });

  /**
   * THE GATE IS NOT A BLANKET REFUSAL OF LOCALES, and these are the counter-values the round that
   * found H-1 never ran (signed lesson 13: a prescribed diagnosis is a hypothesis until something
   * measures the other direction). `chat_gpt` in its OWN locale passes; `google` in another
   * country's passes, because DataForSEO publishes 92 locations for it.
   *
   * REACHING THE CREDIT GUARD IS THE ASSERTION: these specs run with no Supabase env, so a call
   * that gets past every free gate throws on it. A refusal would have returned an isError result
   * instead, which is what makes this the negative control for the two specs above.
   */
  it("lets chat_gpt through in its own locale, and google through in any locale", async () => {
    for (const locale of [
      { platform: "chat_gpt", location_name: "United States", language_code: "en" },
      { platform: "chat_gpt", location_name: "united states" },
      { platform: "google", location_name: "Turkey", language_code: "tr" },
    ]) {
      await expect(
        serving().run(CTX, { subject: "domain", project_id: PROJECT_ID, ...locale }),
      ).rejects.toThrow(/SUPABASE/i);
    }
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

// =============================================================================================
// WHAT THE USER IS TOLD WHEN THE VENDOR REFUSES — the other half of the 2026-08-25 damage.
//
// Measured in production, three times out of three:
//
//     Tool "ai_visibility" failed unexpectedly. The server logged the details under
//     reference e383191d — quote it if you report this. You were not charged.
//
// Three things wrong with that sentence, and one spec each below: it called a vendor refusal an
// unexpected crash; it withheld what DataForSEO had already said; and "You were not charged" was
// half true — the credits really were released, but the attempt really did spend SeoGrep's own
// third-party-data allowance, which is why ten of them took the paid surface down.
// =============================================================================================
describe("a vendor refusal is explained, not filed as a crash", () => {
  const refusal = (code: number | null, message: string | null) =>
    new LlmMentionsVendorError(
      DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT,
      code === null ? "transport" : "vendor_status",
      code,
      message,
      "internal detail the user must never see",
    );

  const answerTo = async (error: unknown): Promise<string> => {
    const result = await catchVendorFailure("ai_visibility", () => Promise.reject(error));
    expect(result.isError).toBe(true);
    return result.content[0]?.text ?? "";
  };

  it("never answers a vendor refusal with the generic crash sentence", async () => {
    const text = await answerTo(refusal(40501, "Invalid Field: 'internal_list_limit'."));
    expect(text).not.toMatch(/failed unexpectedly/i);
    expect(text).not.toMatch(/quote it if you report this/i);
    expect(text).not.toMatch(/reference/i);
  });

  it("quotes DataForSEO's OWN status and words, which the old sentence withheld", async () => {
    const text = await answerTo(refusal(40501, "Invalid Field: 'internal_list_limit'."));
    expect(text).toContain("40501");
    expect(text).toContain("Invalid Field: 'internal_list_limit'.");
    expect(text).toContain("aggregated_metrics");
  });

  /**
   * NEVER #7 AT THE FAILURE EDGE. A tool named "AI visibility" answering with an error is read as
   * "we looked and found little". No measurement happened at all, and the answer has to say so.
   */
  it("says the failure implies NOTHING about the subject", async () => {
    const text = await answerTo(refusal(40501, "x"));
    expect(text).toMatch(/says nothing about the subject/i);
    expect(text).toMatch(/no measurement was made at all/i);
  });

  /**
   * THE HALF-TRUTH, CLOSED. The credit claim stays (it is true and it was verified in production:
   * net delta 0, reservation + refund). What is added is the half that was missing, and it is
   * added WITHOUT a dollar figure — our vendor spend is our margin (dfs/budget-error.ts).
   */
  it("tells the truth about cost: credits released, AND our own allowance spent, in no dollars", async () => {
    const text = await answerTo(refusal(40501, "x"));
    expect(text).toMatch(/not charged any credits/i);
    expect(text).toMatch(/daily third-party-data allowance/i);
    expect(text).toMatch(/our cost, not yours/i);
    expect(text).not.toMatch(/\$\d/);
    // The bare claim that used to stand alone must not stand alone any more.
    expect(text).not.toMatch(/You were not charged\.\s*$/);
  });

  it("says so plainly when the vendor gave no status of its own to quote", async () => {
    const text = await answerTo(refusal(null, null));
    expect(text).toMatch(/did not return a readable answer/i);
    expect(text).toMatch(/gave no status of its own/i);
  });

  /**
   * THE CATCH IS NARROW ON PURPOSE. A genuine crash — a broken run-ledger write, a renderer bug —
   * must keep reaching the registry's generic branch. Dressing one as "the vendor had a problem"
   * is the disguise the 2026-08-09 campaign found twelve real failures wearing.
   */
  it("rethrows anything that is NOT a vendor failure", async () => {
    const boom = new Error("subject_lookup_runs write failed");
    await expect(catchVendorFailure("ai_visibility", () => Promise.reject(boom))).rejects.toBe(boom);
  });

  it("passes a successful lookup straight through", async () => {
    const ok = await catchVendorFailure("ai_visibility", async () => ({
      content: [{ type: "text" as const, text: "fine" }],
    }));
    expect(ok.content[0]?.text).toBe("fine");
  });
});

// =============================================================================================
// THE WIRING, NOT THE HELPER — the hole a fresh-context judge found in the first attempt.
//
// Every spec above tests `catchVendorFailure` by CALLING IT. That leaves the thing production
// actually depends on untested: that the ai_visibility HANDLER is wrapped in it. The judge
// deleted the wrap — `return catchVendorFailure("ai_visibility", lookup)` -> `return lookup()` —
// and the whole suite stayed GREEN at 2674/2674. The exact production regression this task exists
// to prevent could be reintroduced with every test in every lane passing. Signed lesson 12's
// shape, one layer up: the helper was proven, the CALL SITE was not.
//
// WHY THE GUARD IS SUBSTITUTED. withCredits runs the paid-balance gate and then the reserve
// before it ever calls the handler body, and this lane has no database — so with the real guard
// the injected port is never reached and the vendor error never happens. The sibling
// ai-visibility-compare.reserve.test.ts established this exact substitution for the same reason;
// this reuses it.
//
// THE DOUBLE IS NOT MORE PERMISSIVE THAN THE RUNTIME on the axis under test: the real guard
// releases the reserve and RETHROWS the body's error, and this one propagates the rejection
// unchanged. It also prices the call through the REAL creditCostFor, so a handler that stopped
// handing the guard a usable CreditMeta throws here exactly as it would in production.
// =============================================================================================
describe("the ai_visibility HANDLER is wired to the vendor-failure branch", () => {
  /**
   * Drive the REAL tool with a port that fails the way DataForSEO failed on 2026-08-25.
   * The error is built from the DYNAMICALLY imported module so its identity is the one the
   * handler's own `instanceof` sees — production's case, not the duplicated-copy case.
   */
  async function runAgainstFailingVendor(
    kind: "vendor_status" | "transport",
  ): Promise<{ isError?: boolean; text: string; priced: number[] }> {
    const priced: number[] = [];
    vi.resetModules();
    vi.doMock("../credits/guard.ts", () => ({
      withCredits: async <T>(_ctx: CreditContext, meta: CreditMeta, fn: () => Promise<T>) => {
        priced.push(creditCostFor(meta.tool, meta.units));
        return fn();
      },
      isReserveCommitFailed: () => false,
    }));
    const mentions = await import("../dfs/llm-mentions.ts");
    const { makeAiVisibilityTool: freshTool } = await import("./ai-visibility.ts");
    const failure = new mentions.LlmMentionsVendorError(
      mentions.DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT,
      kind,
      kind === "vendor_status" ? 40501 : null,
      kind === "vendor_status" ? "Invalid Field: 'internal_list_limit'." : null,
      "operator-only detail that must never reach a user",
    );
    const tool = freshTool({
      port: {
        enabled: true,
        fetchAiVisibility: () => Promise.reject(failure),
        fetchAiVisibilityCompare: () => Promise.reject(failure),
      },
      writeRun: async () => undefined,
    });
    const result = await tool.run(CTX, {
      subject: "keyword",
      keyword: "teeth whitening",
      platform: "chat_gpt",
    });
    return { isError: result.isError, text: result.content[0]?.text ?? "", priced };
  }

  it("answers a vendor refusal through the REAL handler, explained and never as a crash", async () => {
    const { isError, text, priced } = await runAgainstFailingVendor("vendor_status");
    expect(isError).toBe(true);
    expect(text).not.toMatch(/failed unexpectedly/i);
    expect(text).toContain("40501");
    expect(text).toContain("Invalid Field: 'internal_list_limit'.");
    expect(text).toMatch(/not charged any credits/i);
    // The operator-only detail stays operator-only, even on the real path.
    expect(text).not.toContain("operator-only detail that must never reach a user");
    // ...and the guard really was entered at the signed price, so this is the PRICED path.
    expect(priced).toEqual([TOOL_COSTS.ai_visibility]);
  });

  it("does the same when the vendor gave no status at all (transport)", async () => {
    const { isError, text } = await runAgainstFailingVendor("transport");
    expect(isError).toBe(true);
    expect(text).not.toMatch(/failed unexpectedly/i);
    expect(text).toMatch(/did not return a readable answer/i);
  });
});
