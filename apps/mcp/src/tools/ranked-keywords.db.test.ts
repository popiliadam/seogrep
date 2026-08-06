import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { AuthContext } from "../auth.ts";
import {
  createMockRankedKeywordsPort,
  disabledRankedKeywordsPort,
  type RankedKeywordsPort,
} from "../dfs/ranked-keywords.ts";
import { makeRankedKeywordsTool } from "./ranked-keywords.ts";
import fixtureResponse from "../dfs/fixtures/ranked-keywords.json";

/**
 * DB-integration proof for ranked_keywords (65, SYNC self-settled surface charge) against a
 * LOCAL Supabase stack. The three money paths:
 *   (a) a SERVING call (mock port injected) reserves + commits ONE chain (net -65) on the
 *       LEDGER, touching NO jobs row (the reserve is ledger-only, keyed to a traceability
 *       uuid) — the exact surface shape;
 *   (b) the LIVE-DISABLED path returns its "not enabled" error BEFORE any reserve, so the
 *       ledger gets ZERO spend rows and the caller is not charged (NEVER #2 + #7);
 *   (c) a DataForSEO FAILURE inside the guarded body reserves and then RELEASES, so the
 *       balance ends where it started — a failed lookup is never billed.
 * No real DataForSEO call happens here (NEVER #5): the serving path uses the fixture-backed
 * mock port, the failure path a throwing stub, and the disabled path never fetches at all.
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
    email: `ranked-${randomUUID()}@example.test`,
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

/** A port that is enabled but whose lookup fails — the "DataForSEO errored" path. */
const failingPort: RankedKeywordsPort = {
  enabled: true,
  fetchRankedKeywords: async () => {
    throw new Error("DataForSEO request failed: HTTP 500");
  },
};

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("ranked_keywords credit path against the local stack", () => {
  it("(a) serving (mock) reserves+commits net -65 on the ledger, touches NO jobs row", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const tool = makeRankedKeywordsTool({ port: createMockRankedKeywordsPort(fixtureResponse) });

    const result = await tool.run(ctx, { target: "example.com", limit: 2 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("seo software");
    expect(result.content[0]?.text).toContain("Ranked keywords for");

    // ONE reserve+commit chain on the ledger, net -65.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_commit"]);
    expect(rows[1]?.delta).toBe(-TOOL_COSTS.ranked_keywords);
    expect(rows[1]?.tool).toBe("ranked_keywords");
    expect(balanceOf(rows)).toBe(200 - TOOL_COSTS.ranked_keywords);

    // Surface shape: no jobs row, and the reserve carries a fresh traceability uuid.
    expect(rows[1]?.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(b) live-disabled returns 'not enabled' with ZERO ledger rows and no charge", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const tool = makeRankedKeywordsTool({ port: disabledRankedKeywordsPort() });

    const result = await tool.run(ctx, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);

    // The gate is PRE-reserve: only the seed purchase row exists — no spend_reserve, no release.
    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase"]);
    expect(balanceOf(rows)).toBe(200); // untouched — the user was not charged
    expect(await jobCount(ctx.userId)).toBe(0);
  });

  it("(c) a DataForSEO failure releases the reserve — the balance ends unchanged", async () => {
    const ctx = await makeCtx();
    await seedPurchase(ctx.userId, 200);
    const tool = makeRankedKeywordsTool({ port: failingPort });

    // The registry converts a thrown handler error into an isError result; the guard has
    // already released the reserve by then.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(tool.run(ctx, { target: "example.com" })).rejects.toThrow(/HTTP 500/);
    } finally {
      errorSpy.mockRestore();
    }

    const rows = await ledgerRows(ctx.userId);
    expect(rows.map((r) => r.kind)).toEqual(["purchase", "spend_reserve", "spend_release"]);
    expect(balanceOf(rows)).toBe(200); // reserve refunded — a failed lookup is never billed
    expect(await jobCount(ctx.userId)).toBe(0);
  });
});
