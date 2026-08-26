import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withCredits } from "./guard.ts";
import {
  FREE_VENDOR_CALL_ESTIMATE_USD,
  FREE_VENDOR_SPEND_DAILY_USD,
  MAX_COUNTED_ROWS,
  isFreeVendorSpendLimit,
  type FreeVendorSpendCounter,
} from "./free-vendor-calls.ts";

/**
 * PROOF THAT THE GATE IS WIRED, not merely written.
 *
 * The module spec beside this one proves what assertFreeVendorCallBudget decides. That is worth
 * nothing if withCredits never calls it, and a gate nobody calls is exactly the shape of failure
 * this project has measured before — so this file drives the guard itself.
 *
 * TWO instruments, because either alone would pass for the wrong reason:
 *
 *   1. The paid-balance port is injected as "yes, this account has paid". Without it the gate
 *      above this one refuses first and every assertion below would be measuring THAT gate.
 *   2. Every SUPABASE_* variable is stripped. withCredits' next step after the allowance gate is
 *      the credit RESERVE, which builds a DB client — so a call that gets PAST the gate dies with
 *      the loadEnv error rather than the typed refusal. Deleting the gate call from guard.ts turns
 *      these red instead of green.
 */

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  consoleError.mockRestore();
});

/** A counter port that always answers `usedUsd`, recording what it was asked. */
function counterAt(usedUsd: number): FreeVendorSpendCounter & { calls: [string, number][] } {
  const calls: [string, number][] = [];
  return {
    calls,
    async spentTodayUsd(userId, maxRows) {
      calls.push([userId, maxRows]);
      return usedUsd;
    },
  };
}

/** A PAYING account, so the gate above the one under test steps aside. */
const PAID = async (): Promise<boolean> => true;

describe("withCredits enforces the free-vendor-call allowance", () => {
  it("refuses a vendor tool once the allowance is spent — before any reserve, and fn never runs", async () => {
    let ran = 0;
    const counter = counterAt(FREE_VENDOR_SPEND_DAILY_USD);
    const thrown = await withCredits(
      { userId: "tenant-a" },
      { tool: "research_keywords" },
      async () => {
        ran += 1;
        return "vendor data";
      },
      { hasPaidBalance: PAID, freeVendorSpend: counter },
    ).catch((error: unknown) => error);

    expect(isFreeVendorSpendLimit(thrown)).toBe(true);
    // The vendor body never ran, so no DataForSEO reservation was booked: the refusal is free to
    // BOTH sides, which is the entire point of placing the gate above the reserve.
    expect(ran).toBe(0);
    expect(counter.calls).toEqual([["tenant-a", MAX_COUNTED_ROWS]]);
  });

  it("does NOT refuse the same tool while the allowance is unspent", async () => {
    // Under the limit the gate steps aside and the call proceeds to the credit RESERVE, which
    // needs a DB client and cannot build one here. The distinction that matters is the ERROR: a
    // guard that rationed paying customers would answer with the typed refusal instead.
    const thrown = await withCredits(
      { userId: "tenant-a" },
      { tool: "research_keywords" },
      async () => "vendor data",
      { hasPaidBalance: PAID, freeVendorSpend: counterAt(FREE_VENDOR_SPEND_DAILY_USD - 0.01) },
    ).catch((error: unknown) => error);

    expect(isFreeVendorSpendLimit(thrown)).toBe(false);
  });

  it("admits the FIRST call to the dearest tool even though it costs more than the budget", async () => {
    // The `used < budget` rule, seen from the guard: a fresh account must be able to hit one
    // failure on any tool. A `used + estimate <= budget` rule would refuse this call outright.
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.ai_visibility_compare).toBeGreaterThan(
      FREE_VENDOR_SPEND_DAILY_USD,
    );
    const thrown = await withCredits(
      { userId: "tenant-a" },
      { tool: "ai_visibility_compare", units: 2 },
      async () => "compared",
      { hasPaidBalance: PAID, freeVendorSpend: counterAt(0) },
    ).catch((error: unknown) => error);

    expect(isFreeVendorSpendLimit(thrown)).toBe(false);
  });

  it("never rations a 0-credit, non-vendor tool", async () => {
    const counter = counterAt(9999);
    await expect(
      withCredits({ userId: "tenant-a" }, { tool: "whats_next" }, async () => "advice", {
        hasPaidBalance: PAID,
        freeVendorSpend: counter,
      }),
    ).resolves.toBe("advice");
    expect(counter.calls).toEqual([]);
  });

  it("never rations a priced tool that spends no vendor money", async () => {
    // generate_report costs credits but buys no vendor request, so an exhausted allowance must not
    // touch it. It still needs a DB for its reserve — what is asserted is that the failure is NOT
    // this gate's.
    const thrown = await withCredits(
      { userId: "tenant-a" },
      { tool: "generate_report" },
      async () => "report",
      { hasPaidBalance: PAID, freeVendorSpend: counterAt(9999) },
    ).catch((error: unknown) => error);

    expect(isFreeVendorSpendLimit(thrown)).toBe(false);
  });

  it("refuses fail-closed when the allowance cannot be counted", async () => {
    const broken: FreeVendorSpendCounter = {
      spentTodayUsd: async () => {
        throw new Error("connection reset");
      },
    };
    const thrown = await withCredits(
      { userId: "tenant-a" },
      { tool: "serp_snapshot" },
      async () => "snapshot",
      { hasPaidBalance: PAID, freeVendorSpend: broken },
    ).catch((error: unknown) => error);

    expect(isFreeVendorSpendLimit(thrown)).toBe(true);
  });
});
