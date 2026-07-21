import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";

/**
 * DB-integration proofs for the credit_ledger SHAPE invariants added in migration 0011
 * (B-I4). service_role holds direct INSERT on credit_ledger (the 0005/0007/0009 RPCs are
 * SECURITY INVOKER and rely on that grant), so before 0011 a bad row — e.g. a
 * `spend_commit` with delta<0 and no reserve_id — was accepted and drove SUM(delta)
 * negative. These CHECK constraints make "the DB is the last word" true at the DB layer
 * (constitution NEVER #2). Two claims are proven here:
 *   - every bad shape the RPCs never produce is now REJECTED, and
 *   - every valid shape the RPCs DO produce is still ACCEPTED (the constraints reject no
 *     legitimate row — the whole point of keeping them conservative).
 * Run via guardrails/verify-db.sh (local stack reset to 0001..0011, then test:db).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run these tests via guardrails/verify-db.sh`);
  }
  return value;
}

requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createServiceClient();

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `shape-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

interface LedgerSeed {
  delta: number;
  kind: string;
  reserveId?: string | null;
  jobId?: string | null;
}

/** Direct service_role insert (bypasses the RPCs on purpose — the shape armor must hold
 * even against a raw writer). Returns the PostgREST error (null when the row was accepted). */
async function insertRow(
  userId: string,
  seed: LedgerSeed,
): Promise<{ code: string | null; message: string | null }> {
  const { error } = await service.from("credit_ledger").insert({
    user_id: userId,
    delta: seed.delta,
    // kind is deliberately widened to string: these tests intentionally probe values the
    // typed RPC path never emits, so the DB CHECK — not the type — is what must reject them.
    kind: seed.kind as never,
    reason: "shape-test",
    reserve_id: seed.reserveId ?? null,
    job_id: seed.jobId ?? null,
  });
  return { code: error?.code ?? null, message: error?.message ?? null };
}

beforeAll(async () => {
  const { error } = await service.from("credit_ledger").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via verify-db.sh): ${error.message}`);
  }
});

describe("credit_ledger shape constraints (migration 0011, B-I4)", () => {
  it("REJECTS a spend_commit whose delta is not zero", async () => {
    const userId = await makeUserId();
    const res = await insertRow(userId, {
      delta: -999,
      kind: "spend_commit",
      reserveId: randomUUID(),
    });
    expect(res.code).toBe("23514"); // check_violation
    expect(res.message).toMatch(/credit_ledger_spend_commit_zero_delta/);
  });

  it("REJECTS a spend_reserve whose delta is positive", async () => {
    const userId = await makeUserId();
    const res = await insertRow(userId, {
      delta: 10,
      kind: "spend_reserve",
      reserveId: randomUUID(),
    });
    expect(res.code).toBe("23514");
    expect(res.message).toMatch(/credit_ledger_spend_reserve_neg_delta/);
  });

  it("REJECTS a spend_release whose delta is not positive", async () => {
    const userId = await makeUserId();
    const res = await insertRow(userId, {
      delta: -5,
      kind: "spend_release",
      reserveId: randomUUID(),
    });
    expect(res.code).toBe("23514");
    expect(res.message).toMatch(/credit_ledger_spend_release_pos_delta/);
  });

  it("REJECTS any spend_* row with a NULL reserve_id", async () => {
    const userId = await makeUserId();
    // delta is a valid spend_reserve delta (<0); the ONLY violation is the missing reserve_id.
    const res = await insertRow(userId, { delta: -10, kind: "spend_reserve", reserveId: null });
    expect(res.code).toBe("23514");
    expect(res.message).toMatch(/credit_ledger_spend_reserve_id_present/);
  });

  it("REJECTS a grant with a non-positive delta", async () => {
    const userId = await makeUserId();
    const res = await insertRow(userId, { delta: 0, kind: "grant" });
    expect(res.code).toBe("23514");
    expect(res.message).toMatch(/credit_ledger_grant_pos_delta/);
  });

  it("REJECTS a purchase with a non-positive delta", async () => {
    const userId = await makeUserId();
    const res = await insertRow(userId, { delta: -1, kind: "purchase" });
    expect(res.code).toBe("23514");
    expect(res.message).toMatch(/credit_ledger_purchase_pos_delta/);
  });

  it("ACCEPTS every shape the RPCs actually produce (conservative — rejects no valid row)", async () => {
    const userId = await makeUserId();
    const reserveId = randomUUID();
    // grant(+), purchase(+), spend_reserve(<0 + reserve_id), spend_commit(0 + reserve_id),
    // spend_release(>0 + reserve_id) — the exact shapes reserve/commit/release/grant/purchase emit.
    const valid: LedgerSeed[] = [
      { delta: 100, kind: "grant" },
      { delta: 50, kind: "purchase", jobId: "txn_ref_1" },
      { delta: -20, kind: "spend_reserve", reserveId, jobId: randomUUID() },
      { delta: 0, kind: "spend_commit", reserveId, jobId: randomUUID() },
      { delta: 20, kind: "spend_release", reserveId: randomUUID(), jobId: randomUUID() },
    ];
    for (const seed of valid) {
      const res = await insertRow(userId, seed);
      expect(res.code, `valid ${seed.kind} was rejected: ${res.message}`).toBeNull();
    }
  });

  it("ACCEPTS adjust with any delta (the unconstrained manual-correction escape hatch)", async () => {
    const userId = await makeUserId();
    // adjust is deliberately left unconstrained on delta AND reserve_id.
    for (const delta of [0, -42, 42]) {
      const res = await insertRow(userId, { delta, kind: "adjust" });
      expect(res.code, `adjust delta=${delta} was rejected: ${res.message}`).toBeNull();
    }
  });
});
