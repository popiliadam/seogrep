import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { creditCostFor } from "../credits/costs.ts";
import type { CreditContext, CreditMeta } from "../credits/guard.ts";
import { createMockAiVisibilityPort } from "../dfs/llm-mentions.ts";
import aggregatedFixture from "../dfs/fixtures/llm-mentions-aggregated-metrics.json";
import crossFixture from "../dfs/fixtures/llm-mentions-cross-aggregated-metrics.json";

/**
 * WHAT THE RESERVE CALL SITE HANDS THE GUARD — the one half of the per-target price the rest of
 * the fast lane cannot see.
 *
 * ai_visibility_compare reads its target count TWICE: the registry's D17 hook weighs it before
 * dispatch (pinned in ai-visibility-compare.test.ts, where a ten-target call is estimated at 900),
 * and the handler's own `withCredits({...}, { tool, units })` reserves from it. Only the first half
 * was pinned here. The second was measured by DELETING `units:` from the reserve call and running
 * the fast lane: 2402 specs stayed GREEN, and only the DB lane went red.
 *
 * The reason is an ORDERING one and it is worth naming, because it will hide the next such
 * mutation too: withCredits runs the paid-balance gate BEFORE the cost lookup, and
 * ai_visibility_compare requires a paid balance. With no Supabase env the gate throws first, so
 * every sibling spec's `rejects.toThrow(/SUPABASE/i)` is satisfied without creditCostFor ever
 * being reached — a dropped `units:` sails past a suite that looks like it is exercising the
 * charge. The sibling specs are right about what they pin; they simply stop one step early.
 *
 * So this file substitutes the guard and reads the CreditMeta the handler actually built.
 *
 * THE DOUBLE IS DELIBERATELY NOT MORE PERMISSIVE THAN THE RUNTIME (the standing lesson: a lenient
 * double turns a missing constraint into a passing test). It does not merely record `meta` — it
 * feeds it to the REAL creditCostFor, the same function the real guard calls on the same line, and
 * the assertion is on the CREDIT AMOUNT that comes back. A `units` the handler forgot to pass is
 * therefore not a shape mismatch this file could shrug off: it is a throw out of the real pricing
 * function, exactly as it would be in production.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

/** What the handler handed the guard, plus what the real price table made of it. */
interface Charge {
  readonly meta: CreditMeta;
  readonly cost: number;
}

/**
 * Load the tool with a guard whose withCredits records its CreditMeta and prices it for real.
 * `vi.doMock` (not `vi.mock`) so the substitution is scoped to this file's dynamic import rather
 * than hoisted over a module graph other specs share.
 */
async function runWithCapturedCharge(input: unknown): Promise<Charge> {
  const charges: Charge[] = [];
  vi.resetModules();
  vi.doMock("../credits/guard.ts", () => ({
    withCredits: async <T>(_ctx: CreditContext, meta: CreditMeta, fn: () => Promise<T>) => {
      // The real guard's own line, run for real: this is where a missing `units` throws.
      charges.push({ meta, cost: creditCostFor(meta.tool, meta.units) });
      return fn();
    },
    isReserveCommitFailed: () => false,
  }));
  const { makeAiVisibilityCompareTool } = await import("./ai-visibility-compare.ts");
  const tool = makeAiVisibilityCompareTool({
    port: createMockAiVisibilityPort({
      aggregated: aggregatedFixture,
      crossAggregated: crossFixture,
    }),
    // The run-ledger write (migration 0032), stubbed for the same reason the PORT above is: this
    // file substitutes the guard so the handler body REALLY runs, and the real writer reaches
    // Supabase, which this lane has no env for. Nothing here asserts anything about the write —
    // that it happens on delivery and never on a refusal is subject-lookup-runs.db.test.ts's
    // question, against a real database. Every assertion below is untouched.
    writeRun: async () => undefined,
  });
  const result = await tool.run(CTX, input);
  expect(result.isError).toBeUndefined();
  expect(charges).toHaveLength(1);
  return charges[0] as Charge;
}

function domains(count: number): { domain: string }[] {
  return Array.from({ length: count }, (_, i) => ({ domain: `site-${i + 1}.com` }));
}

describe("the reserve is sized from the compared target count, not from the flat table price", () => {
  /**
   * TWO TARGETS — the signed floor, and the only target count that reaches the reserve without a
   * confirmation. 180, asserted as a literal: `90 * meta.units` would restate the implementation
   * and stay green if the implementation stopped multiplying.
   */
  it("reserves 180 for two targets — the count reaches the guard as `units: 2`", async () => {
    const { meta, cost } = await runWithCapturedCharge({
      targets: domains(2),
      platform: "chat_gpt",
    });
    expect(meta.tool).toBe("ai_visibility_compare");
    expect(meta.units).toBe(2);
    expect(cost).toBe(180);
  });

  /**
   * TEN TARGETS (confirmed) — the ceiling. The number the registry's gate asked the caller to
   * confirm (900) and the number the reserve is sized from must be the SAME, and this is the half
   * of that equality the fast lane was missing.
   */
  it("reserves 900 for ten confirmed targets — the amount the D17 prompt quoted", async () => {
    const { meta, cost } = await runWithCapturedCharge({
      targets: domains(10),
      platform: "google",
      confirm: true,
    });
    expect(meta.units).toBe(10);
    expect(cost).toBe(900);
  });

  /**
   * The reserve NEVER carries an amount. `units` is a count and the price stays in the table; a
   * handler that started passing credits directly would move a signed price out of the
   * human-approved table and into a tool body, which is what the table exists to prevent.
   *
   * The key set stays an exhaustive WHITELIST rather than a "no amount key" search, so a price
   * arriving under any name is still caught. `projectId` joined it on 2026-09-03 (H-1): it is the
   * ledger's project scope (migration 0033), a subject and not a price, and the reserve carrying
   * it is pinned by this tool's own project-scope spec.
   */
  it("hands the guard a COUNT and nothing resembling a price", async () => {
    const { meta } = await runWithCapturedCharge({ targets: domains(2), platform: "chat_gpt" });
    expect(Object.keys(meta).sort()).toEqual(["projectId", "tool", "units"]);
    expect(meta.units).toBeLessThanOrEqual(10);
  });
});
