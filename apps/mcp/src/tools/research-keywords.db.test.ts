import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import { createMockResearchPort, disabledPort } from "../dfs/client.ts";
import { makeResearchKeywordsTool } from "./research-keywords.ts";
import fixtureResponse from "../dfs/fixtures/keyword-overview.json";
import emptyFixture from "../dfs/fixtures/keyword-overview-tr-empty.json";

/**
 * DB-integration proof for research_keywords (25, SYNC self-settled surface charge) against
 * a LOCAL Supabase stack. The two money paths the brief pins:
 *   (a) a SERVING call (mock port injected) reserves + commits ONE chain (net -25) on the
 *       LEDGER, touching NO jobs row (the reserve is ledger-only, keyed to a traceability
 *       uuid) — the exact surface shape;
 *   (b) the LIVE-DISABLED path returns its "not enabled" error BEFORE any reserve, so the
 *       ledger gets ZERO spend rows and the caller is not charged (NEVER #2 + #7);
 *   (c) a lookup the vendor answered with NO metric for any keyword reserves and then RELEASES —
 *       net 0, no spend_commit (operator decision 2026-08-25). It cannot be gated before the
 *       reserve the way (b) is, so the ledger shape differs and both are pinned.
 * No real DataForSEO call happens here (NEVER #5): the serving path uses the fixture-backed
 * mock port; the disabled path never fetches at all.
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

async function makeCtx(): Promise<AuthContext> {
  const { data, error } = await service.auth.admin.createUser({
    email: `research-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

/**
 * Fund the account the way a REAL caller of this tool is funded: with a purchase.
 *
 * It used to be a trial `grant`. The paid-balance gate (credits/paid-balance.ts, operator
 * decision 2026-08-06) now refuses this tool on a trial account BEFORE the reserve, so a grant
 * fixture would describe a caller who never reaches the credit path these tests are about.
 * Every assertion below is unchanged except the kind of this one seed row; the trial-account
 * REFUSAL is not dropped, it moved to its own file (credits/guard-paid-balance.db.test.ts),
 * which pins it harder than these tests ever did.
 */
async function seedPurchase(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "purchase", reason: "test-seed" });
  if (error) throw new Error(`seed purchase failed: ${error.message}`);
}

interface LedgerRow {
  delta: number;
  kind: string;
  tool: string | null;
  job_id: string | null;
  reserve_id: string | null;
}

async function ledgerRows(userId: string): Promise<LedgerRow[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("delta, kind, tool, job_id, reserve_id")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
  return data;
}

async function jobCount(userId: string): Promise<number> {
  const { count, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`jobs count failed: ${error.message}`);
  return count ?? 0;
}

const balanceOf = (rows: LedgerRow[]): number => rows.reduce((sum, row) => sum + row.delta, 0);

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("research_keywords credit path against the local stack", () => {
  it("(a) serving (mock) reserves+commits net -25 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 100);
    const tool = makeResearchKeywordsTool({ port: createMockResearchPort(fixtureResponse) });

    const result = await tool.run(ctx, { keywords: ["seo software", "rank tracker"] });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("seo software");
    expect(result.content[0]?.text).toContain("total monthly searches");

    // ONE reserve+commit chain on the ledger, net -25.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.research_keywords);
    expect(rows[1]?.tool).toBe("research_keywords");
    expect(balanceOf(rows)).toBe(100 - TOOL_COSTS.research_keywords);

    // Surface shape: no jobs row, and the reserve carries a fresh traceability uuid.
    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  /**
   * (c) OPERATOR DECISION 2026-08-25 — an empty answer is not charged. Unlike (b) this refusal
   * CANNOT be made before the reserve: only DataForSEO's answer reveals that nothing was measured.
   * So the reserve is taken, the body throws, and the guard RELEASES — a reserve/release pair that
   * nets to zero rather than the absence of rows that (b) asserts. The distinction is the point:
   * "not charged" here means refunded within the call, and the ledger is where that is visible.
   */
  it("(c) an empty vendor answer reserves and RELEASES — net 0, no commit row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 100);
    const tool = makeResearchKeywordsTool({ port: createMockResearchPort(emptyFixture) });

    const result = await tool.run(ctx, { keywords: ["diş beyazlatma", "ortodonti"], language_code: "tr", location_code: 2792 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/you were not charged/i);

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(rows.some((r) => r.kind === "spend_commit")).toBe(false);
    expect(balanceOf(rows)).toBe(100); // net zero — the caller pays nothing for no answer
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 100);
    const tool = makeResearchKeywordsTool({ port: disabledPort() });

    const result = await tool.run(ctx, { keywords: ["seo software"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    // The gate is PRE-reserve: only the seed purchase row exists — no spend_reserve, no release.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(100); // untouched — the user was not charged
    expect(await jobCount(ctx.userId)).toBe(0);
  });
});
