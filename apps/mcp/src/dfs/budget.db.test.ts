import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient, type Database, type ServiceClient } from "../db.ts";
import {
  DAILY_BUDGET_USD,
  createDbSpendLedger,
  reserveSpend,
  todaySpendUsd,
  type SpendLedger,
} from "./budget.ts";
import { createLiveClient, type DfsTransport } from "./client.ts";

/**
 * DB-integration proofs for the DataForSEO vendor-budget counter (migration 0014), against a
 * LOCAL Supabase stack (env via guardrails/verify-db.sh, then `pnpm --filter @pseo/mcp test:db`).
 * The four properties the hostile audit (H-03) found missing, measured against the REAL Postgres
 * functions: (a) ATOMIC — barrier-released reservations cannot together outspend the cap;
 * (b) DURABLE — a fresh process sees the day's total; (c) GLOBAL — two independent clients (the
 * web and worker machines) share ONE counter; (d) FAIL-CLOSED — an unreachable counter refuses
 * the call. Plus the exact cap boundary and that the DB's cap is the app's $3.00.
 *
 * NEVER #5 holds: no DataForSEO traffic — the live-client spec drives an injected fake transport
 * and asserts it was never called. Mostly self-cleaning, so it is re-runnable inside one UTC day:
 * reservations are settled back at $0.00 (the honest cost of a call that never happened — an
 * ordinary reconciliation, not a privileged reset; nothing here can DELETE a spend row). The two
 * specs that must leave a settled cost behind keep it small, so a day absorbs ~20 repeat runs;
 * past that the cap spec says plainly that it needs `supabase db reset`.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

/** A brand-new service client — what a restarted machine builds on boot. */
function freshClient(): ServiceClient {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ledger: SpendLedger = createDbSpendLedger();

/** Reservations opened by the running test, settled back to $0.00 afterwards. */
let opened: string[] = [];

async function reserveTracked(estimatedUsd: number, endpoint = "spec"): Promise<string> {
  const id = await ledger.reserve(estimatedUsd, endpoint);
  opened = [...opened, id];
  return id;
}

beforeAll(async () => {
  const { error } = await getServiceClient().rpc("dfs_spend_today_usd");
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

afterEach(async () => {
  // Settle every reservation this test opened at its true cost: $0.00, because no vendor request
  // was ever sent. Anything already settled is skipped rather than double-settled.
  for (const id of opened) {
    await ledger.settle(id, 0, 0).catch(() => undefined);
  }
  opened = [];
});

describe("the migration-0014 vendor-budget counter", () => {
  it("puts the SAME $3.00 cap in the database that the app compiles against", async () => {
    const { data, error } = await getServiceClient().rpc("dfs_daily_budget_usd");
    expect(error).toBeNull();
    expect(Number(data)).toBe(DAILY_BUDGET_USD);
  });

  it("counts an OPEN reservation at its estimate and a SETTLED one at its real cost", async () => {
    const before = await todaySpendUsd(ledger);

    // Through the app-level wrapper, so the whole production path (reserveSpend -> RPC) is what
    // is being measured, not just the SQL.
    const reservation = await reserveSpend(0.2, "search_volume", ledger);
    // The booking is visible BEFORE any vendor request — this is what closes the old window.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(before + 0.2, 5);

    await ledger.settle(reservation.id, 0.075, 3);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(before + 0.075, 5);

    await expect(ledger.settle(reservation.id, 0.075, 3)).rejects.toThrow(/already settled/i);
    await expect(ledger.settle(randomUUID(), 0.01, 1)).rejects.toThrow(/unknown reservation/i);

    // This row is deliberately left settled at its real $0.075: the counter is append-and-settle,
    // never rewind. The cap spec below measures the remaining budget at runtime for that reason.
    opened = [];
  });

  it("two CONCURRENT settlements of the same reservation: exactly one wins", async () => {
    // The serialized double-settle above is the easy half. This is the racing half: the
    // already-settled check must be re-read UNDER the per-day advisory lock (the 0005
    // commit_reserve shape). Reading it BEFORE the lock lets both callers see 'open' and both
    // report success, so the day's recorded cost becomes whichever write landed last with no
    // trace that a second settlement ever happened.
    const id = await reserveTracked(0.3, "double-settle");
    const released = new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Two DIFFERENT costs, both micro: which one wins is irrelevant to the property being
    // measured (exactly one settlement is accepted), and settling near zero keeps the spec
    // re-runnable inside one UTC day instead of eating the day's budget every run.
    const outcomes = await Promise.allSettled(
      [0.000001, 0.000002].map(async (cost) => {
        await released; // barrier: both settlements enter together
        return ledger.settle(id, cost, 1);
      }),
    );

    const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const lost = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(String((lost[0] as PromiseRejectedResult).reason)).toMatch(/already settled/i);
    // Whichever won, the row is settled once and a third attempt is still refused.
    await expect(ledger.settle(id, 0.000003, 1)).rejects.toThrow(/already settled/i);
    opened = [];
  });

  it("(b) DURABLE: a FRESH process sees the day's total, it does not start over at $0.00", async () => {
    const before = await todaySpendUsd(ledger);
    await reserveTracked(0.5, "ranked_keywords");

    // A brand-new client == a restarted or redeployed machine. The old file ledger lived in
    // DFS_BUDGET_DIR=/tmp/dfs-spend, so this is exactly where it handed back a full allowance.
    const rebooted = createDbSpendLedger(freshClient());
    expect(await rebooted.todayUsd()).toBeCloseTo(before + 0.5, 5);
  });

  it("(c) GLOBAL: the web and worker machines spend against ONE counter, not one each", async () => {
    const before = await todaySpendUsd(ledger);
    const web = createDbSpendLedger(freshClient());
    const worker = createDbSpendLedger(freshClient());
    const webReservation = await web.reserve(0.4, "search_volume");
    opened = [...opened, webReservation];
    const workerReservation = await worker.reserve(0.6, "ranked_keywords");
    opened = [...opened, workerReservation];

    // Each machine sees the OTHER machine's spend — the fleet total, not its own private one.
    expect(await web.todayUsd()).toBeCloseTo(before + 1.0, 5);
    expect(await worker.todayUsd()).toBeCloseTo(before + 1.0, 5);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(before + 1.0, 5);
  });

  it("(d) FAIL-CLOSED: an unreachable counter refuses the live call, no HTTP is attempted", async () => {
    // A client whose credentials the database rejects — the stand-in for any reason the counter
    // cannot be read. The old behaviour turned exactly this into "$0.00 spent, go ahead".
    const broken = createDbSpendLedger(
      createClient<Database>(SUPABASE_URL, "not-a-valid-service-role-key", {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    );
    const transport = vi.fn<DfsTransport>(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger: broken });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        client.fetchSearchVolume({ keywords: ["x"], language_code: "en", location_code: 2840 }),
      ).rejects.toThrow(/budget ledger unavailable/i);
      expect(transport).not.toHaveBeenCalled(); // not one paid request went out
      const logged = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(logged).toMatch(/WAKE THE HUMAN/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("(a) ATOMIC: ten barrier-released reservations stop EXACTLY at the cap", async () => {
    // The audit's scenario, run for real: ten callers hit reserve_dfs_spend at the same instant.
    // Under the old read-then-append gate every one of them read the same stale total and every
    // one of them was admitted. Here the booking happens inside the same advisory lock as the
    // check, so exactly as many as fit are admitted and the rest are refused.
    // Take the day to a known $1.50 remaining first, so the slice below is exact in BOTH binary
    // floating point and the column's numeric(12,6) — otherwise the last slice rounds a hair over
    // the cap and the admitted count wobbles between 5 and 6 for reasons that are about IEEE-754,
    // not about the gate.
    const start = await todaySpendUsd(ledger);
    expect(
      start,
      "this spec needs at least $1.50 of the day's budget free — run `supabase db reset`",
    ).toBeLessThan(DAILY_BUDGET_USD - 1.5);
    const topUp = Math.round((DAILY_BUDGET_USD - 1.5 - start) * 1e6) / 1e6;
    if (topUp > 0) await reserveTracked(topUp, "spec-topup");

    const before = await todaySpendUsd(ledger);
    const remaining = DAILY_BUDGET_USD - before;
    expect(remaining).toBeCloseTo(1.5, 9);
    const slice = 0.25; // six fit exactly; the other four must be refused
    expect(10 * slice).toBeGreaterThan(remaining); // without the lock, all ten would pass

    const released = new Promise<void>((resolve) => setTimeout(resolve, 0));
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, async () => {
        await released;
        return ledger.reserve(slice, "concurrent-spec");
      }),
    );

    const admitted = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const refused = outcomes.filter((outcome) => outcome.status === "rejected");
    opened = [
      ...opened,
      ...admitted.map((outcome) => (outcome as PromiseFulfilledResult<string>).value),
    ];

    expect(admitted).toHaveLength(6);
    expect(refused).toHaveLength(4);

    // Each of the four must be the GATE's refusal, not the network's. Ten simultaneous calls
    // through PostgREST occasionally leave one of them holding a dropped connection or a gateway
    // 5xx instead of the RPC's answer — the budget was never violated (the assertions below still
    // pin the day at the cap), but that one call never learned the gate's decision.
    //
    // Such an outcome is INDETERMINATE, not excusable. Widening the matcher to accept it would
    // let the exact regression this spec exists to catch — a gate that stops refusing and starts
    // erroring — pass as a green run (constitution #8). So it is re-issued SERIALLY instead: the
    // day is at the cap by now, so a re-issued call has precisely one correct answer, and the
    // spec still ends up demanding four real "budget exceeded" refusals. What changed is only
    // that the network no longer gets a vote on whether the gate is working.
    for (const outcome of refused) {
      const reason = String((outcome as PromiseRejectedResult).reason);
      if (/budget exceeded/i.test(reason)) continue; // the gate spoke; nothing left to prove
      console.warn(`concurrent reserve failed in transport, re-issuing serially: ${reason}`);
      await expect(ledger.reserve(slice, "concurrent-spec")).rejects.toThrow(/budget exceeded/i);
    }
    // Not one cent over the constitutional cap.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(DAILY_BUDGET_USD, 5);
    expect(await todaySpendUsd(ledger)).toBeLessThanOrEqual(DAILY_BUDGET_USD);

    // And at the cap, the very next call — of any size — is refused.
    await expect(ledger.reserve(0.000001, "one-cent-over")).rejects.toThrow(/budget exceeded/i);
  });
});
