import { describe, expect, it, vi } from "vitest";
import {
  DAILY_BUDGET_USD,
  createMemorySpendLedger,
  reserveSpend,
  settleSpend,
  todaySpendUsd,
  type SpendLedger,
} from "./budget.ts";

/**
 * Unit proofs for the DataForSEO daily vendor-budget guard (apps/mcp side). The counter itself
 * is a port, so nothing here needs a database or a network; the migration-0014 RPCs behind the
 * production implementation are proven separately in budget.db.test.ts.
 *
 * The four properties the hostile audit (H-03) found missing are what these specs pin:
 * ATOMIC (a reservation is visible to the next caller before the vendor request runs), GLOBAL
 * and DURABLE (one shared counter — proven end-to-end against Postgres in the DB lane) and
 * FAIL-CLOSED (an uncountable day refuses the call instead of assuming $0.00).
 */

/** Silence + capture the WAKE-THE-HUMAN lines a refusal prints. */
function captureWakeLines(): { lines: () => string; restore: () => void } {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return {
    lines: () => spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n"),
    restore: () => spy.mockRestore(),
  };
}

describe("reserveSpend", () => {
  it("books the estimate and returns a reservation naming its endpoint", async () => {
    const ledger = createMemorySpendLedger();
    const reservation = await reserveSpend(0.1, "search_volume", ledger);

    expect(reservation.estimatedUsd).toBe(0.1);
    expect(reservation.endpoint).toBe("search_volume");
    expect(reservation.id).not.toBe("");
    // ATOMIC: the booking is on the counter BEFORE the vendor request goes out, so the next
    // caller is measured against it rather than against a stale total.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.1, 5);
  });

  it("refuses (and wakes the human) when the estimate would pass the cap", async () => {
    const ledger = createMemorySpendLedger();
    ledger.seed(2.95);
    const wake = captureWakeLines();
    try {
      await expect(reserveSpend(0.1, "search_volume", ledger)).rejects.toThrow(/budget exceeded/i);
      expect(wake.lines()).toMatch(/WAKE THE HUMAN/);
    } finally {
      wake.restore();
    }
    // A refused call books nothing.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(2.95, 5);
  });

  it("admits a call that lands EXACTLY on the cap and refuses the next cent", async () => {
    const ledger = createMemorySpendLedger();
    ledger.seed(2.9);
    await expect(reserveSpend(0.1, "search_volume", ledger)).resolves.toBeTruthy();
    expect(await todaySpendUsd(ledger)).toBeCloseTo(DAILY_BUDGET_USD, 5);

    const wake = captureWakeLines();
    try {
      await expect(reserveSpend(0.01, "search_volume", ledger)).rejects.toThrow(/budget exceeded/i);
    } finally {
      wake.restore();
    }
  });

  it("FAIL-CLOSED: an unreadable counter refuses the call instead of assuming $0.00", async () => {
    const ledger = createMemorySpendLedger();
    ledger.breakWith(new Error("connection reset by peer"));
    const wake = captureWakeLines();
    try {
      await expect(reserveSpend(0.1, "search_volume", ledger)).rejects.toThrow(
        /budget ledger unavailable/i,
      );
      expect(wake.lines()).toMatch(/WAKE THE HUMAN/);
      expect(wake.lines()).toMatch(/cannot be counted/i);
    } finally {
      wake.restore();
    }
  });

  it("ATOMIC: barrier-released callers cannot together outspend the cap", async () => {
    // The exact shape the audit walked past: ten callers enter the gate at the same instant and
    // each one then holds a vendor request open. With the booking written INSIDE the gate, only
    // the ones that fit are admitted; the rest are refused before any request is sent.
    const ledger = createMemorySpendLedger();
    const released = new Promise<void>((resolve) => setTimeout(resolve, 0));
    const wake = captureWakeLines();
    let admitted = 0;
    try {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, async () => {
          await released; // barrier: all ten reach the gate together
          const reservation = await reserveSpend(0.5, "search_volume", ledger);
          admitted += 1;
          await new Promise((resolve) => setTimeout(resolve, 5)); // the vendor request window
          await settleSpend(reservation, 0.5, 1, ledger);
        }),
      );
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(6);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(4);
    } finally {
      wake.restore();
    }

    expect(admitted).toBe(6); // 6 x $0.50 = $3.00 — the cap, not a cent over
    expect(await todaySpendUsd(ledger)).toBeLessThanOrEqual(DAILY_BUDGET_USD);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(3.0, 5);
  });
});

describe("settleSpend", () => {
  it("replaces the estimate with the REAL cost, so the day's total is what was billed", async () => {
    const ledger = createMemorySpendLedger();
    const reservation = await reserveSpend(0.1, "search_volume", ledger);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.1, 5);

    await settleSpend(reservation, 0.075, 3, ledger);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.075, 5);
    expect(ledger.rows()).toEqual([
      { id: reservation.id, endpoint: "search_volume", estimatedUsd: 0.1, actualUsd: 0.075, rowCount: 3 },
    ]);
  });

  it("an UNSETTLED reservation keeps costing its estimate (a failed run never gets it back)", async () => {
    const ledger = createMemorySpendLedger();
    await reserveSpend(0.3, "backlinks_summary", ledger); // the vendor request then threw
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.3, 5);
  });

  it("does NOT throw when the counter rejects: the paid data is already in hand", async () => {
    // Failing here would discard a call the business has been billed for without making the
    // budget any safer — the reservation stays open at its estimate either way. It must still be
    // LOUD, because a real cost above that estimate is under-counted until the day rolls over.
    const ledger = createMemorySpendLedger();
    const reservation = await reserveSpend(0.1, "search_volume", ledger);
    ledger.breakWith(new Error("socket hang up"));

    const wake = captureWakeLines();
    try {
      await expect(settleSpend(reservation, 0.42, 1, ledger)).resolves.toBeUndefined();
      expect(wake.lines()).toMatch(/WAKE THE HUMAN/);
      expect(wake.lines()).toMatch(/stays OPEN/);
      expect(wake.lines()).toMatch(/UNDER-COUNTED/);
    } finally {
      wake.restore();
    }
  });
});

describe("the cap itself", () => {
  it("is the $3.00 sanctioned daily figure", () => {
    expect(DAILY_BUDGET_USD).toBe(3.0);
  });
});

describe("createMemorySpendLedger (the spec seam)", () => {
  it("satisfies the SpendLedger port", async () => {
    const ledger: SpendLedger = createMemorySpendLedger();
    const id = await ledger.reserve(0.2, "ranked_keywords");
    await ledger.settle(id, 0.13, 42);
    expect(await ledger.todayUsd()).toBeCloseTo(0.13, 5);
    await expect(ledger.settle(id, 0.13, 42)).rejects.toThrow(/already settled/i);
    await expect(ledger.settle("nope", 0.1, 1)).rejects.toThrow(/unknown reservation/i);
  });
});
