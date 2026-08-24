import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { creditCostFor } from "../credits/costs.ts";
import type { CreditContext, CreditMeta } from "../credits/guard.ts";
import { createMockSerpSnapshotPort } from "../dfs/serp.ts";
import fixture from "../dfs/fixtures/serp-organic-live-advanced.json";

/**
 * WHAT THE RESERVE CALL SITE HANDS THE GUARD — the half of the per-keyword price the rest of the
 * fast lane cannot see.
 *
 * This is the standing lesson from `ai-visibility-compare.reserve.test.ts`, applied to the second
 * per-unit tool the moment it exists rather than after it is caught. That file MEASURED the hole:
 * deleting `units:` from the reserve left 2402 fast-lane specs green, because `withCredits` runs
 * the paid-balance gate BEFORE the cost lookup — and `serp_snapshot` is on that gate too, so with
 * no Supabase env every sibling spec's refusal is satisfied without `creditCostFor` ever being
 * reached. A dropped `units:` would sail past the whole suite exactly the same way, and here it
 * would cost MORE than there in one respect: creditsForUnits would throw on the omission rather
 * than silently under-charging, but nothing in the fast lane would ever run the line that throws.
 *
 * So this file substitutes the guard and reads the CreditMeta the handler actually built.
 *
 * THE DOUBLE IS NOT MORE PERMISSIVE THAN THE RUNTIME (the standing lesson: a lenient double turns
 * a missing constraint into a passing test). It does not merely record `meta` — it feeds it to the
 * REAL `creditCostFor`, the same function the real guard calls on the same line, and the assertion
 * is on the CREDIT AMOUNT that comes back. A `units` the handler forgot to pass is therefore a
 * throw out of the real pricing function, exactly as it would be in production.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

/** What the handler handed the guard, plus what the real price table made of it. */
interface Charge {
  readonly meta: CreditMeta;
  readonly cost: number;
}

/**
 * Load the tool with a guard whose withCredits records its CreditMeta and prices it for real, and
 * with a writer that stores nothing — the WRITE is the DB spec's subject; this file is about the
 * amount reserved before any of it runs.
 *
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
  const { makeSerpSnapshotTool } = await import("./serp-snapshot.ts");
  const tool = makeSerpSnapshotTool({
    port: createMockSerpSnapshotPort(fixture, () => "2026-08-24T09:00:00.000Z"),
    writeMeasurements: async () => {},
  });
  const result = await tool.run(CTX, input);
  expect(result.isError).toBeUndefined();
  expect(charges).toHaveLength(1);
  return charges[0] as Charge;
}

const keywords = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `keyword ${i + 1}`);

describe("the reserve is sized from the keyword count, not from the flat table price", () => {
  /**
   * ONE KEYWORD — the signed floor. 13, asserted as a literal: `8 * meta.units + 5` would restate
   * the implementation and stay green if the implementation stopped adding the base.
   */
  it("reserves 13 for one keyword — the count reaches the guard as `units: 1`", async () => {
    const { meta, cost } = await runWithCapturedCharge({
      target: "example.com",
      keywords: keywords(1),
    });
    expect(meta.tool).toBe("serp_snapshot");
    expect(meta.units).toBe(1);
    expect(cost).toBe(13);
  });

  /**
   * TEN KEYWORDS — the ceiling, and the count the signed 5.3x worst case is measured at. 85, not
   * 80 (the base dropped) and not 130 (the base folded into the unit).
   */
  it("reserves 85 for ten keywords — the count the signed worst case is measured at", async () => {
    const { meta, cost } = await runWithCapturedCharge({
      target: "example.com",
      keywords: keywords(10),
    });
    expect(meta.units).toBe(10);
    expect(cost).toBe(85);
    expect(cost).not.toBe(80);
    expect(cost).not.toBe(130);
  });

  /** A middle count, so the two ends above cannot both be satisfied by a constant. */
  it("reserves 45 for five keywords", async () => {
    const { cost } = await runWithCapturedCharge({
      target: "example.com",
      keywords: keywords(5),
    });
    expect(cost).toBe(45);
  });

  /**
   * The reserve NEVER carries an amount. `units` is a count and the price stays in the table; a
   * handler that started passing credits directly would move a signed price out of the
   * human-approved table and into a tool body, which is what the table exists to prevent.
   */
  it("hands the guard a COUNT and nothing resembling a price", async () => {
    const { meta } = await runWithCapturedCharge({
      target: "example.com",
      keywords: keywords(2),
    });
    expect(Object.keys(meta).sort()).toEqual(["tool", "units"]);
    expect(meta.units).toBeLessThanOrEqual(10);
  });

  /**
   * NO jobId — the reserve is ledger-only. A jobId here would key the settlement to a jobs row this
   * synchronous tool never writes, and `get_job_status` would become the only way to learn whether
   * a snapshot that already returned had been charged for.
   */
  it("opens a ledger-only reserve, with no job to settle against", async () => {
    const { meta } = await runWithCapturedCharge({
      target: "example.com",
      keywords: keywords(1),
    });
    expect(meta.jobId).toBeUndefined();
  });
});
