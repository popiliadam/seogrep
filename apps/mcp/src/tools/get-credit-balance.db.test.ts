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
});
