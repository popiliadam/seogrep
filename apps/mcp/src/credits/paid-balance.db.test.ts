import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasPaidBalance } from "./paid-balance.ts";
import { getServiceClient } from "../db.ts";

/**
 * DB proofs for the paid-balance predicate, against a LOCAL Supabase stack (export env via the
 * guardrails/verify-db.sh `supabase status -o env` pattern, then
 * `pnpm --filter @pseo/mcp run test:db`).
 *
 * What each seeded row is FAITHFUL to, so these are not tests of a fiction:
 *   purchase — byte-identical to the row migration 0013's process_paddle_purchase writes
 *              (kind 'purchase', reason 'paddle', job_id = the Paddle transaction ref). That
 *              function is production's ONLY writer of a purchase row; it lives behind the web
 *              app's webhook and is not in this service's typed schema slice, so the row shape
 *              is reproduced here rather than the call.
 *   grant    — what claim_trial appends on signup: the exact thing this gate exists to refuse.
 *   adjust   — a hand-written operator statement. Migration 0019 records that nothing in apps/
 *              or packages/ writes one, so a direct insert IS its production path.
 *
 * Isolation comes from a fresh auth user per test (the ledger is append-only).
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

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `paid-balance-${randomUUID()}@example.test`,
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

/** The row process_paddle_purchase writes when Paddle money lands (migration 0013:64-65). */
async function seedPaddlePurchase(userId: string, amount: number): Promise<void> {
  await insertLedgerRow({
    user_id: userId,
    delta: amount,
    kind: "purchase",
    reason: "paddle",
    job_id: `txn_${randomUUID()}`,
  });
}

/** The signup trial grant — the machine-issued credits this gate refuses to honour. */
async function seedTrialGrant(userId: string, amount: number): Promise<void> {
  await insertLedgerRow({ user_id: userId, delta: amount, kind: "grant", reason: "trial" });
}

describe("hasPaidBalance", () => {
  it("is false for a brand-new account with no ledger rows at all", async () => {
    await expect(hasPaidBalance(await makeUserId())).resolves.toBe(false);
  });

  it("is FALSE for a trial-only account (the whole point of the gate)", async () => {
    const userId = await makeUserId();
    await seedTrialGrant(userId, 200);
    await expect(hasPaidBalance(userId)).resolves.toBe(false);
  });

  it("is true once a Paddle purchase lands", async () => {
    const userId = await makeUserId();
    await seedTrialGrant(userId, 200);
    await expect(hasPaidBalance(userId)).resolves.toBe(false);
    await seedPaddlePurchase(userId, 400);
    await expect(hasPaidBalance(userId)).resolves.toBe(true);
  });

  it("is true for a POSITIVE operator adjust (support gesture counts as paid)", async () => {
    const userId = await makeUserId();
    await seedTrialGrant(userId, 200);
    await insertLedgerRow({ user_id: userId, delta: 50, kind: "adjust", reason: "support gesture" });
    await expect(hasPaidBalance(userId)).resolves.toBe(true);
  });

  it("is FALSE for a NEGATIVE adjust (a correction is not a payment)", async () => {
    // Production holds exactly one adjust row today and it is a -200 archive test. If the sign
    // were ignored, that account would read as paying.
    const userId = await makeUserId();
    await seedTrialGrant(userId, 200);
    await insertLedgerRow({ user_id: userId, delta: -200, kind: "adjust", reason: "archive test" });
    await expect(hasPaidBalance(userId)).resolves.toBe(false);
  });

  it("stays true after a paid account spends its balance back down", async () => {
    // The ledger is append-only, so "has ever paid" cannot be un-said by spending. A customer at
    // zero credits must still get the insufficient-credits error, never the trial refusal.
    const userId = await makeUserId();
    await seedPaddlePurchase(userId, 400);
    await insertLedgerRow({ user_id: userId, delta: -400, kind: "adjust", reason: "spent" });
    await expect(hasPaidBalance(userId)).resolves.toBe(true);
  });

  it("does NOT leak across tenants — a neighbour's purchase never unlocks this account", async () => {
    // The read runs on the RLS-bypassing service client, so the user_id filter is the ONLY thing
    // making it tenant-safe (constitution NEVER #4). Drop the filter and this test goes red.
    const payer = await makeUserId();
    const freeloader = await makeUserId();
    await seedPaddlePurchase(payer, 1000);
    await seedTrialGrant(freeloader, 200);
    await expect(hasPaidBalance(payer)).resolves.toBe(true);
    await expect(hasPaidBalance(freeloader)).resolves.toBe(false);
  });
});
