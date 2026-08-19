import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { CREDIT_UNITS, TOOL_COSTS, creditCostFor } from "../credits/costs.ts";
import { CONFIRMATION_THRESHOLD_CREDITS } from "./registry.ts";
import {
  MAX_COMPARE_TARGETS,
  MAX_INTERNAL_LIST_ROWS,
  MIN_COMPARE_TARGETS,
  PLATFORM_MEANS,
  ROW_ORDER,
  ROW_ORDER_MEANS,
  createMockAiVisibilityPort,
  disabledAiVisibilityPort,
  type AiVisibilityCompareResult,
  type AiVisibilityCompareRow,
  type MeasurementScope,
} from "../dfs/llm-mentions.ts";
import {
  CALLER_ORDER_NOTE,
  comparedTargetCount,
  formatAiVisibilityCompare,
  makeAiVisibilityCompareTool,
  type ResolvedTarget,
} from "./ai-visibility-compare.ts";
import { AI_VISIBILITY_JUDGEMENT_NOTE } from "./ai-visibility-shared.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import aggregatedFixture from "../dfs/fixtures/llm-mentions-aggregated-metrics.json";
import crossFixture from "../dfs/fixtures/llm-mentions-cross-aggregated-metrics.json";

/**
 * Fast-lane (DB-less) proofs for ai_visibility_compare. The credit LEDGER behaviour (net
 * -90 x targets on success, release on failure, zero rows on a refusal) is proven against the real
 * stack in ai-visibility-compare.db.test.ts. Here we prove the three things this surface is FOR:
 *
 *   1. THE PER-TARGET PRICE — the only one on this surface. Two targets is 180 and ten is 900,
 *      and the registry's D17 gate weighs THAT product, so a comparison over the safety threshold
 *      asks the caller before it runs and settles nothing until they say yes;
 *   2. NEVER #7 where an invented ranking would sneak in — a side-by-side view is read top-down as
 *      a leaderboard unless it says otherwise. The order is the CALLER's, the answer says so, and
 *      a target the vendor returned no row for is named as unanswered rather than shown as a zero;
 *   3. the free pre-reserve gates — an impossible comparison set, a colliding label, a project
 *      that is not the caller's and the live-disabled refusal all cost nothing.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const mockPort = () =>
  createMockAiVisibilityPort({ aggregated: aggregatedFixture, crossAggregated: crossFixture });

const SUPABASE_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;

/** See the sibling surface: a spec whose result depends on the ambient shell is not a measurement. */
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

/** N domain targets, unlabelled — the shape a caller reaches for first. */
function domains(count: number): { domain: string }[] {
  return Array.from({ length: count }, (_, index) => ({ domain: `rival-${index}.com` }));
}

const TWO_TARGETS = {
  targets: domains(MIN_COMPARE_TARGETS),
  platform: "chat_gpt",
} as const;

const SCOPE: MeasurementScope = {
  platform_requested: "chat_gpt",
  platform_means: PLATFORM_MEANS.chat_gpt,
  vendor_echoed_platform: "chat_gpt",
  location_name: "United States",
  language_code: "en",
  vendor_reported_time_field: "datetime",
  vendor_reported_time_value: "2026-08-18 09:00:00 +00:00",
};

const resolvedTarget = (key: string, domain: string, project: ProjectRef | null = null): ResolvedTarget => ({
  group: { aggregation_key: key, target: { kind: "domain", domain } },
  project,
});

const compareRow = (
  key: string,
  metrics: AiVisibilityCompareRow["vendor_metrics"],
  nested: string[] = [],
): AiVisibilityCompareRow => ({
  aggregation_key: key,
  vendor_metrics: metrics,
  vendor_nested_fields_not_carried: nested,
});

function compareResultWith(
  rows: readonly AiVisibilityCompareRow[],
  keys: readonly string[],
): AiVisibilityCompareResult {
  const answered = new Set(rows.map((row) => row.aggregation_key));
  return {
    groups: keys.map((key) => ({
      aggregation_key: key,
      target: { kind: "domain", domain: `${key}.com` },
    })),
    scope: SCOPE,
    row_order: ROW_ORDER,
    row_order_means: ROW_ORDER_MEANS,
    cost: {
      compared_target_count: keys.length,
      vendor_requests_issued: 1,
      vendor_cost_usd: 0.104,
      vendor_cost_usd_source: "vendor_reported",
      vendor_cost_usd_per_target: 0.104 / keys.length,
    },
    result_set: {
      window_internal_list_limit: MAX_INTERNAL_LIST_ROWS,
      window_row_count: rows.length,
      vendor_total_count: keys.length,
      rows,
    },
    groups_without_vendor_row: keys.filter((key) => !answered.has(key)),
  };
}

/** The confirmation body the D17 gate returns, parsed. Throws if the call was NOT gated. */
function confirmationBody(result: { content: { text: string }[]; isError?: boolean }): {
  requires_confirmation: boolean;
  estimate_credits: number;
  message: string;
} {
  return JSON.parse(result.content[0]?.text ?? "{}") as {
    requires_confirmation: boolean;
    estimate_credits: number;
    message: string;
  };
}

describe("THE PER-TARGET PRICE — 90 per compared target, and the confirmation it earns", () => {
  withoutSupabaseEnv();
  const tool = makeAiVisibilityCompareTool({ port: mockPort(), loadProject });

  /**
   * THE SIGNED ARITHMETIC, as literals. The 2026-08-17 signature (MADDE 2) prices this tool at 90
   * credits PER COMPARED TARGET over 2-10 targets: 180 at the floor, 900 at the ceiling. Charging
   * the flat 90 for a multi-target call would give away up to 810 signed credits, which is why
   * these two numbers are pinned rather than derived from the implementation's own multiplication.
   */
  it("costs 180 for two targets and 900 for ten", () => {
    expect(TOOL_COSTS.ai_visibility_compare).toBe(90);
    expect(creditCostFor("ai_visibility_compare", 2)).toBe(180);
    expect(creditCostFor("ai_visibility_compare", 10)).toBe(900);
    expect(CREDIT_UNITS.ai_visibility_compare.unit).toBe("compared target");
  });

  it("reads the priced unit count off the input — one unit per compared target", () => {
    expect(comparedTargetCount({ ...TWO_TARGETS, internal_list_limit: 100, targets: domains(2) })).toBe(2);
    expect(
      comparedTargetCount({ ...TWO_TARGETS, internal_list_limit: 100, targets: domains(10) }),
    ).toBe(10);
  });

  /**
   * THE D17 GATE, ON THE FIRST TOOL THAT REACHES IT. Three targets is 270 credits, above the
   * 200-credit threshold, so the call returns a confirmation prompt and settles NOTHING — proven
   * by the absence of the credit guard's own failure: with no Supabase env configured, ANY call
   * that reached the reserve would throw naming SUPABASE. This one returns a value instead.
   */
  it("asks before running a comparison above the safety threshold, and charges nothing", async () => {
    const gated = await tool.run(CTX, { targets: domains(3), platform: "chat_gpt" });
    const body = confirmationBody(gated);
    expect(gated.isError).toBeUndefined();
    expect(body.requires_confirmation).toBe(true);
    expect(body.estimate_credits).toBe(270);
    expect(body.estimate_credits).toBeGreaterThan(CONFIRMATION_THRESHOLD_CREDITS);
    expect(body.message).toMatch(/No credits have been charged/i);
    expect(body.message).toMatch(/"confirm": true/);
  });

  it("weighs the WHOLE call: ten targets is estimated at 900, not at the 90 in the table", async () => {
    const gated = await tool.run(CTX, { targets: domains(MAX_COMPARE_TARGETS), platform: "google" });
    expect(confirmationBody(gated).estimate_credits).toBe(900);
    expect(confirmationBody(gated).estimate_credits).not.toBe(TOOL_COSTS.ai_visibility_compare);
  });

  it("does NOT ask at two targets — 180 is under the threshold — and goes on to charge", async () => {
    // Reaching the credit guard is the proof: with no Supabase env the reserve throws naming it.
    await expect(tool.run(CTX, { ...TWO_TARGETS, targets: domains(2) })).rejects.toThrow(/SUPABASE/i);
  });

  it("proceeds past the gate once the caller confirms", async () => {
    await expect(
      tool.run(CTX, { targets: domains(4), platform: "chat_gpt", confirm: true }),
    ).rejects.toThrow(/SUPABASE/i);
  });

  it("bounds the comparison set at exactly the vendor's own 2-10, before any work", async () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { minItems?: number; maxItems?: number }>;
    };
    expect(schema.properties.targets?.minItems).toBe(MIN_COMPARE_TARGETS);
    expect(schema.properties.targets?.maxItems).toBe(MAX_COMPARE_TARGETS);

    const tooFew = await tool.run(CTX, { targets: domains(1), platform: "chat_gpt" });
    expect(tooFew.isError).toBe(true);
    const tooMany = await tool.run(CTX, {
      targets: domains(MAX_COMPARE_TARGETS + 1),
      platform: "chat_gpt",
      confirm: true,
    });
    expect(tooMany.isError).toBe(true);
  });

  it("caps internal_list_limit at the port's constant — the same price control as its sibling", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { maximum?: number; default?: number }>;
    };
    expect(schema.properties.internal_list_limit?.maximum).toBe(MAX_INTERNAL_LIST_ROWS);
  });

  it("advertises its name, the per-target cost and both endpoints of the range", () => {
    expect(tool.name).toBe("ai_visibility_compare");
    expect(tool.description).toContain("Costs 90 credits, charged per compared target");
    expect(tool.description).toContain("two targets cost 180 and ten cost 900");
    expect(tool.description).toMatch(/paid credit balance/i);
    expect(tool.description).toMatch(/charges nothing/i);
    expect(tool.description).not.toMatch(/is (currently )?(turned )?off\b/i);
  });
});

describe("NEVER #7 — a side-by-side view that ranks nothing", () => {
  const KEYS = ["our-brand", "rival-one", "rival-two"];
  const RESOLVED = [
    resolvedTarget("our-brand", "example.com", PROJECT),
    resolvedTarget("rival-one", "rival-one.com"),
    resolvedTarget("rival-two", "rival-two.com"),
  ];

  const ANSWER = () =>
    formatAiVisibilityCompare(
      compareResultWith(
        [
          compareRow("rival-one", { mentions_count: 0, mentions_share: null }),
          compareRow("our-brand", { mentions_count: 37, mentions_share: 0.041 }, ["by_intent"]),
        ],
        KEYS,
      ),
      RESOLVED,
    );

  /**
   * THE ORDER IS THE CALLER'S, and the answer says so. The vendor returned rival-one FIRST here on
   * purpose: if this surface printed rows in vendor order, or sorted them by any figure of its
   * own, the caller's own first target would not come first — and a reader would take the top row
   * for a winner.
   */
  it("lists the targets in the CALLER's order, and says that is why", () => {
    const text = ANSWER();
    expect(text).toContain(CALLER_ORDER_NOTE);
    expect(text).toMatch(/this is not a ranking/i);
    const positions = KEYS.map((key) => text.indexOf(`. ${key} —`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(text).toContain("1. our-brand");
    expect(text).toContain("2. rival-one");
    expect(text).toContain("3. rival-two");
  });

  it("matches rows by the caller's own key, never by position", () => {
    const text = ANSWER();
    const ourBrand = text.slice(text.indexOf("1. our-brand"), text.indexOf("2. rival-one"));
    // The vendor listed rival-one first; the 37 belongs to our-brand and must stay with it.
    expect(ourBrand).toContain("mentions_count 37");
    expect(ourBrand).not.toContain("mentions_count 0");
  });

  it("names a target the vendor did not report on — and refuses to call it a zero", () => {
    const text = ANSWER();
    const rivalTwo = text.slice(text.indexOf("3. rival-two"));
    expect(rivalTwo).toMatch(/returned no row for this target/i);
    expect(rivalTwo).toMatch(/That is not a zero/i);
    expect(text).toMatch(/no row for 1 of the 3 compared targets: rival-two/);
    expect(text).toMatch(/unanswered, not zeroes/i);
  });

  it("keeps a vendor zero as 0 while a vendor null stays words, in the same answer", () => {
    const text = ANSWER();
    expect(text).toContain("mentions_count 0");
    expect(text).toContain("mentions_share not reported by DataForSEO");
  });

  it("prints the platform, the locale, the vendor's timestamp and the missing date range", () => {
    const text = ANSWER();
    expect(text).toContain(PLATFORM_MEANS.chat_gpt);
    expect(text).toContain('location_name "United States"');
    expect(text).toMatch(/DataForSEO reported `datetime`/);
    expect(text).toMatch(/takes no date range/i);
  });

  it("says the comparison was ONE vendor request, not one per target", () => {
    expect(ANSWER()).toMatch(/one request for all of them/i);
  });

  it("invents no score, no share of voice, no winner", () => {
    // The judgement note and the order note DENY these by name, so both are cut before scanning.
    const body = ANSWER()
      .replace(AI_VISIBILITY_JUDGEMENT_NOTE, "")
      .replace(CALLER_ORDER_NOTE, "");
    for (const pattern of [
      /visibility score/i,
      /share of voice/i,
      /sentiment/i,
      /\bwinner\b/i,
      /\bleader\b/i,
      /\bmost visible\b/i,
      /\bahead of\b/i,
      /\bbeats\b/i,
    ]) {
      expect(body, `an invented judgement matching ${pattern}`).not.toMatch(pattern);
    }
    expect(ANSWER()).toContain(AI_VISIBILITY_JUDGEMENT_NOTE);
  });

  it("names a project target as the caller's own project, and a bare domain as a domain", () => {
    const text = ANSWER();
    expect(text).toContain('our-brand — your project "example.com"');
    expect(text).toContain('rival-one — domain "rival-one.com"');
  });

  it("this module's own source ranks nothing and sorts nothing", () => {
    const source = readFileSync(new URL("./ai-visibility-compare.ts", import.meta.url), "utf8");
    for (const pattern of [
      /the most of any/i,
      /more than any other/i,
      /(?:the )?heaviest\b/i,
      /(?:the )?most (?:requests|round.?trips|calls)/i,
      /(?:the )?(?:largest|biggest|highest) number of (?:requests|round.?trips|calls)/i,
      /than any other (?:tool|seogrep)/i,
      /\bbest (?:tool|way) (?:for|to)/i,
    ]) {
      expect(source, `uncheckable superlative matching ${pattern}`).not.toMatch(pattern);
    }
    expect(source).not.toMatch(/\.sort\(/);
    expect(source).not.toMatch(/\.reverse\(\)/);
  });
});

describe("ai_visibility_compare free pre-reserve gates (no credit machinery)", () => {
  withoutSupabaseEnv();
  const serving = () => makeAiVisibilityCompareTool({ port: mockPort(), loadProject });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeAiVisibilityCompareTool({ port: disabledAiVisibilityPort(), loadProject });
    const refused = await tool.run(CTX, { ...TWO_TARGETS, targets: domains(2) });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/not yet enabled/i);
    expect(refused.content[0]?.text).toMatch(/not charged/i);
    expect(refused.content[0]?.text).not.toContain("mentions_count");
  });

  it("refuses two targets sharing one label — free, because the fix is the caller's", async () => {
    const clash = await serving().run(CTX, {
      targets: [
        { domain: "a.com", label: "us" },
        { domain: "b.com", label: "us" },
      ],
      platform: "chat_gpt",
    });
    expect(clash.isError).toBe(true);
    expect(clash.content[0]?.text).toMatch(/Duplicate aggregation_key "us"/);
    expect(clash.content[0]?.text).toMatch(/not charged/i);
  });

  it("refuses a target naming none of domain / keyword / project_id, and one naming several", async () => {
    const none = await serving().run(CTX, {
      targets: [{ domain: "a.com" }, {}],
      platform: "chat_gpt",
    });
    expect(none.isError).toBe(true);
    expect(none.content[0]?.text).toMatch(/this one names none/i);

    const several = await serving().run(CTX, {
      targets: [{ domain: "a.com" }, { domain: "b.com", keyword: "seo" }],
      platform: "chat_gpt",
    });
    expect(several.isError).toBe(true);
    expect(several.content[0]?.text).toMatch(/names several/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const theirs = await serving().run(CTX, {
      targets: [{ domain: "a.com" }, { project_id: OTHER_PROJECT_ID }],
      platform: "chat_gpt",
    });
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
  });

  it("a RESOLVED project_id reaches the credit guard — the gates are not a dead end", async () => {
    await expect(
      serving().run(CTX, {
        targets: [{ project_id: PROJECT_ID }, { domain: "rival.com" }],
        platform: "chat_gpt",
      }),
    ).rejects.toThrow(/SUPABASE/i);
  });

  it("compares keywords without reading a project at all", async () => {
    const tool = makeAiVisibilityCompareTool({
      port: mockPort(),
      loadProject: async () => {
        throw new Error("the project table must not be read for keyword targets");
      },
    });
    await expect(
      tool.run(CTX, {
        targets: [{ keyword: "seo software" }, { keyword: "rank tracker" }],
        platform: "chat_gpt",
      }),
    ).rejects.toThrow(/SUPABASE/i);
  });
});
