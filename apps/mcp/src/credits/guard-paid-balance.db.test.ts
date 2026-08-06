import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withCredits } from "./guard.ts";
import { isPaidBalanceRequired } from "./paid-balance.ts";
import { TOOL_COSTS } from "./costs.ts";
import { getServiceClient } from "../db.ts";

/**
 * DB proofs that the paid-balance gate stops a trial account BEFORE the reserve — the property
 * the whole design rests on, because a refusal that reserved first would need a refund path.
 *
 * Every case seeds a trial grant LARGER than the tool's cost. That is deliberate: it means a
 * refusal here can only come from the gate, never from an insufficient balance, and it is what
 * makes the "ungated tools still work on trial credits" regression meaningful.
 *
 * Run against a LOCAL Supabase stack (guardrails/verify-db.sh exports the env).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — export the local stack env (see guardrails/verify-db.sh)`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = getServiceClient();

/** A trial grant that comfortably covers every tool exercised below. */
const TRIAL_GRANT = 200;

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `guard-paid-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function insertLedgerRow(row: {
  user_id: string;
  delta: number;
  kind: string;
  reason?: string;
  job_id?: string;
}): Promise<void> {
  const { error } = await service.from("credit_ledger").insert(row);
  if (error) throw new Error(`ledger seed failed (${row.kind} ${row.delta}): ${error.message}`);
}

/** A trial account: signup grant only, never paid. */
async function makeTrialUser(): Promise<string> {
  const userId = await makeUserId();
  await insertLedgerRow({ user_id: userId, delta: TRIAL_GRANT, kind: "grant", reason: "trial" });
  return userId;
}

/** A paying account: the same trial grant PLUS the row a Paddle purchase writes (0013:64-65). */
async function makePaidUser(): Promise<string> {
  const userId = await makeTrialUser();
  await insertLedgerRow({
    user_id: userId,
    delta: 400,
    kind: "purchase",
    reason: "paddle",
    job_id: `txn_${randomUUID()}`,
  });
  return userId;
}

async function ledgerKinds(userId: string): Promise<string[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("kind")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
  return data.map((row) => row.kind);
}

async function balanceOf(userId: string): Promise<number> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", userId);
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
  return data.reduce((sum, row) => sum + row.delta, 0);
}

const GATED = ["research_keywords", "ranked_keywords", "analyze_backlinks", "compare_competitors"] as const;

describe("paid-balance gate — trial accounts and the four DataForSEO tools", () => {
  it.each(GATED)("refuses %s on a trial account and burns ZERO credits", async (tool) => {
    const userId = await makeTrialUser();
    let handlerRuns = 0;

    const call = withCredits({ userId }, { tool }, async () => {
      handlerRuns += 1;
      return "vendor data";
    });

    await expect(call).rejects.toSatisfy(isPaidBalanceRequired);
    // The vendor is never called, so the refusal costs us nothing either.
    expect(handlerRuns).toBe(0);
    // The ledger is untouched: no reserve, no release, no commit — only the seeded grant.
    expect(await ledgerKinds(userId)).toEqual(["grant"]);
    expect(await balanceOf(userId)).toBe(TRIAL_GRANT);
  });

  it("refuses even though the trial balance would have covered the call", async () => {
    // Pins that the gate — not a shortfall — is what refuses. compare_competitors is the
    // priciest tool at 90 credits and still sits under the 200-credit trial grant.
    expect(TOOL_COSTS.compare_competitors).toBeLessThan(TRIAL_GRANT);
    const userId = await makeTrialUser();
    await expect(
      withCredits({ userId }, { tool: "compare_competitors" }, async () => "data"),
    ).rejects.toThrow(/paid credit balance/i);
  });

  it("names the tool and the zero charge in the message the user reads", async () => {
    const userId = await makeTrialUser();
    await expect(
      withCredits({ userId }, { tool: "analyze_backlinks" }, async () => "data"),
    ).rejects.toThrow(/analyze_backlinks[\s\S]*not charged/i);
  });
});

describe("paid-balance gate — paying accounts are unaffected", () => {
  it.each(GATED)("charges %s normally once the account has purchased", async (tool) => {
    const userId = await makePaidUser();
    const opening = await balanceOf(userId);

    const result = await withCredits({ userId }, { tool }, async () => "vendor data");

    expect(result).toBe("vendor data");
    expect(await ledgerKinds(userId)).toEqual([
      "grant",
      "purchase",
      "spend_reserve",
      "spend_commit",
    ]);
    expect(await balanceOf(userId)).toBe(opening - TOOL_COSTS[tool]);
  });
});

describe("paid-balance gate — the ungated surface still runs on trial credits", () => {
  // The regression that matters most: cutting the vendor surface must not touch the tools whose
  // marginal cost is our own CPU. A gate that quietly caught these would break the trial.
  const UNGATED = [
    "crawl_site",
    "audit_onpage",
    "audit_tech",
    "audit_schema",
    "generate_report",
    "pull_gsc_data",
    "find_quick_wins",
    "detect_cannibalization",
    "analyze_content_decay",
  ] as const;

  it.each(UNGATED)("charges %s normally on a trial account", async (tool) => {
    const userId = await makeTrialUser();

    const result = await withCredits({ userId }, { tool }, async () => "work done");

    expect(result).toBe("work done");
    expect(await ledgerKinds(userId)).toEqual(["grant", "spend_reserve", "spend_commit"]);
    expect(await balanceOf(userId)).toBe(TRIAL_GRANT - TOOL_COSTS[tool]);
  });

  it("still runs the free tools on a trial account without touching the ledger", async () => {
    const userId = await makeTrialUser();
    const result = await withCredits({ userId }, { tool: "whats_next" }, async () => "advice");
    expect(result).toBe("advice");
    expect(await ledgerKinds(userId)).toEqual(["grant"]);
  });
});
