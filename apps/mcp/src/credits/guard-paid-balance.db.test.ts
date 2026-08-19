import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withCredits } from "./guard.ts";
import { PAID_BALANCE_TOOLS, isPaidBalanceRequired } from "./paid-balance.ts";
import { TOOL_COSTS } from "./costs.ts";
import { getServiceClient } from "../db.ts";

/**
 * DB proofs that the paid-balance gate stops a trial account BEFORE the reserve — the property
 * the whole design rests on, because a refusal that reserved first would need a refund path.
 *
 * Every case seeds a trial grant LARGER than the tool's cost. That is deliberate: it means a
 * refusal here can only come from the gate, never from an insufficient balance, and it is what
 * makes the "ungated tools still work on trial credits" regression meaningful. The headroom is
 * ASSERTED against the priciest gated tool rather than assumed — see the census block below.
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

/**
 * The census these proofs run over, DERIVED from the gate's own membership rather than listed.
 *
 * It used to be a hand-written array of the ORIGINAL FOUR. PAID_BALANCE_TOOLS has grown well past
 * those four since, and every member added after them was covered by NEITHER of the two blocks
 * below — the generic "refused before any reservation" proof and the "charges normally once
 * purchased" proof both ran over a stale list while reading as if they covered the gate. Deriving
 * it means a tool joining the gate joins the proof in the same commit, with nothing to remember.
 */
const GATED = [...PAID_BALANCE_TOOLS];

/** The ORIGINAL FOUR: the membership this file used to hardcode, kept as the census FLOOR. */
const ORIGINAL_FOUR = [
  "research_keywords",
  "ranked_keywords",
  "analyze_backlinks",
  "compare_competitors",
] as const;

describe("the census the two proofs below run over", () => {
  /**
   * The gate's gate. `it.each([])` registers ZERO tests and still exits 0, so a derivation that
   * silently produced an empty list would turn both blocks below into a green no-op reporting
   * success over nothing. Three independent guards: the census IS the gate's membership, it still
   * contains everything it contained on day one, and it has grown past that.
   */
  it("IS the gate's own membership, and cannot silently shrink to nothing", () => {
    expect(new Set(GATED)).toEqual(PAID_BALANCE_TOOLS);
    expect(GATED).toHaveLength(PAID_BALANCE_TOOLS.size);
    for (const tool of ORIGINAL_FOUR) expect(GATED).toContain(tool);
    expect(GATED.length).toBeGreaterThan(ORIGINAL_FOUR.length);
  });

  /**
   * The SEED's headroom, derived rather than asserted against one named tool. A refusal is only
   * evidence of the GATE if the trial account could otherwise have afforded the call — on an
   * account too poor for the tool, "refused" and "gated" are indistinguishable. So the grant must
   * clear the priciest GATED tool, whichever that is today.
   */
  it("seeds a trial grant that clears the priciest gated tool, so a refusal can only be the gate", () => {
    const priciest = Math.max(...GATED.map((tool) => TOOL_COSTS[tool]));
    expect(priciest).toBeGreaterThan(0);
    expect(TRIAL_GRANT).toBeGreaterThan(priciest);
  });

  /**
   * Every gated tool must actually COST something. A 0-credit member would skip the reserve
   * entirely (withCredits short-circuits on cost 0), and the "charges normally once purchased"
   * block below would then fail with an unreadable ledger-shape mismatch instead of saying so.
   */
  it("gates only tools that charge — a 0-credit member would have no reserve to prove", () => {
    for (const tool of GATED) expect(TOOL_COSTS[tool]).toBeGreaterThan(0);
  });
});

describe("paid-balance gate — trial accounts and every gated DataForSEO tool", () => {
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
