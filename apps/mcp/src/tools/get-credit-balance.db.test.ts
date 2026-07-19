import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getServiceClient } from "../db.ts";
import type { AuthContext } from "../auth.ts";
import { getCreditBalanceTool } from "./get-credit-balance.ts";

/**
 * DB-integration proofs for get_credit_balance against a LOCAL Supabase stack (test:db
 * lane). Balance is the tenant-scoped Σ of the credit ledger (constitution NEVER #2):
 * zero with no ledger, the running sum after grant/spend rows, and never another
 * tenant's total. Rows are appended directly here (test seed) — the same sanctioned
 * append the packages/db grant path uses.
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
    email: `bal-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, keyId: `key-${randomUUID()}` };
}

async function appendLedger(
  userId: string,
  delta: number,
  kind: string,
  reserveId?: string,
): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta, kind, reason: "test-seed", reserve_id: reserveId ?? null });
  if (error) throw new Error(`ledger seed failed: ${error.message}`);
}

/** Bulk-append `count` grant rows of `delta` each in one request (fast >1000-row seed). */
async function appendManyGrants(userId: string, count: number, delta: number): Promise<void> {
  const rows = Array.from({ length: count }, () => ({
    user_id: userId,
    delta,
    kind: "grant",
    reason: "bulk-seed",
  }));
  const { error } = await service.from("credit_ledger").insert(rows);
  if (error) throw new Error(`bulk ledger seed failed: ${error.message}`);
}

beforeAll(async () => {
  const { error } = await service.from("credit_ledger").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("get_credit_balance against the local stack", () => {
  it("reports 0 credits for a brand-new user with no ledger rows", async () => {
    const ctx = await makeCtx();
    const result = await getCreditBalanceTool.run(ctx, {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/balance: 0 credits/i);
  });

  it("sums grant and spend rows into the available balance", async () => {
    const ctx = await makeCtx();
    await appendLedger(ctx.userId, 100, "grant");
    const reserveId = randomUUID();
    await appendLedger(ctx.userId, -20, "spend_reserve", reserveId);

    const result = await getCreditBalanceTool.run(ctx, {});
    expect(result.content[0]?.text).toMatch(/balance: 80 credits/i);
  });

  it("counts only the calling tenant's ledger", async () => {
    const a = await makeCtx();
    const b = await makeCtx();
    await appendLedger(a.userId, 50, "grant");
    await appendLedger(b.userId, 999, "grant");

    const aResult = await getCreditBalanceTool.run(a, {});
    expect(aResult.content[0]?.text).toMatch(/balance: 50 credits/i);
  });

  it("sums the WHOLE ledger past PostgREST's 1000-row page (aggregate, not app-side Σ)", async () => {
    // Regression guard: an app-side `select(delta)` + reduce silently truncates at
    // config.toml's [api] max_rows = 1000, under-reporting the balance for any account with
    // 1000+ ledger rows. The balance MUST derive from the DB aggregate (credit_balances view),
    // where the SUM runs server-side over every row and returns a single row — no page cap.
    const ctx = await makeCtx();
    const rowCount = 1500; // > max_rows, so a truncating read would report 1000, not 1500.
    await appendManyGrants(ctx.userId, rowCount, 1);

    const result = await getCreditBalanceTool.run(ctx, {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/balance: 1500 credits/i);
  });
});
