import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createServiceClient } from "./server.js";

/**
 * DB-integration proofs for the credit_ledger SHAPE invariants added in migration 0011
 * (B-I4) and the NEGATIVE-BALANCE guard added in migration 0019 (M-09).
 *
 * 0011: service_role holds direct INSERT on credit_ledger (the 0005/0007/0009 RPCs are
 * SECURITY INVOKER and rely on that grant), so before 0011 a bad row — e.g. a
 * `spend_commit` with delta<0 and no reserve_id — was accepted and drove SUM(delta)
 * negative. These CHECK constraints make "the DB is the last word" true at the DB layer
 * (constitution NEVER #2). Two claims are proven here:
 *   - every bad shape the RPCs never produce is now REJECTED, and
 *   - every valid shape the RPCs DO produce is still ACCEPTED (the constraints reject no
 *     legitimate row — the whole point of keeping them conservative).
 *
 * 0019: `adjust` was the ONE kind 0011 deliberately left unbounded, so a typo or a service
 * bug could still write `adjust delta=-500` against a balance of 100. The 0019 trigger
 * closes that under a per-user advisory lock. See the CONTRACT REWRITE callout below — the
 * test that used to PIN the unbounded behaviour now pins the new rule instead.
 *
 * Run via guardrails/verify-db.sh (local stack reset to 0001..0019, then test:db).
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
  /** Defaults to "shape-test". Load-bearing for 0019: an `override:` prefix is the
   * deliberate-correction escape hatch that the negative-balance trigger stands aside for. */
  reason?: string;
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
    reason: seed.reason ?? "shape-test",
    reserve_id: seed.reserveId ?? null,
    job_id: seed.jobId ?? null,
  });
  return { code: error?.code ?? null, message: error?.message ?? null };
}

/** Balance straight off the derived view — the only definition of balance this product has. */
async function balanceOf(userId: string): Promise<number> {
  const { data, error } = await service
    .from("credit_balances")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`credit_balances read failed: ${error.message}`);
  return Number(data?.balance ?? 0);
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

  // =========================================================================================
  // !!! CONTRACT REWRITTEN IN MIGRATION 0019 (M-09) — READ BEFORE TRUSTING THIS TEST'S NAME !!!
  //
  // This test used to be titled "ACCEPTS adjust with any delta (the unconstrained
  // manual-correction escape hatch)" and it POSITIVELY ASSERTED that `adjust delta=-42` is
  // accepted no matter what the balance is. That was a real, deliberate contract in 0011 — and
  // it was also the M-09 hole: it PINNED the looseness, so the audit finding "the DB does not
  // prevent a negative balance" could not be fixed without this test going red.
  //
  // The rewrite (NOT a deletion — deleting a contract test to make a fix pass is an automatic
  // FAIL under CLAUDE.md NEVER #8): `adjust` stays unconstrained on delta SIGN and on
  // reserve_id, which is what the 0011 CHECK constraints do or do not say. What changed is a
  // separate, narrower rule enforced by a trigger, not a constraint: a NEGATIVE adjust may no
  // longer drive the derived balance below zero unless it is explicitly marked deliberate.
  //
  // Everything still legal under 0011 that is ALSO legal under 0019 is still asserted here —
  // delta 0, delta > 0, and a negative delta that stays within the balance. The cases the
  // rewrite moved out (negative beyond balance, and the `override:` escape) are asserted in
  // the 0019 describe block below, so the old test's coverage is preserved, not dropped.
  // =========================================================================================
  it("ACCEPTS adjust with any delta SIGN while the balance stays >= 0 (0011 shape + 0019 rule)", async () => {
    const userId = await makeUserId();
    // Fund first: under 0019 the sign freedom is real, but a negative adjust is now judged
    // against the balance it lands on. 100 covers the -42 below with room to spare.
    expect((await insertRow(userId, { delta: 100, kind: "grant" })).code).toBeNull();

    // adjust remains unconstrained on delta SIGN and on reserve_id: no CHECK names `adjust`.
    for (const delta of [0, -42, 42]) {
      const res = await insertRow(userId, { delta, kind: "adjust" });
      expect(res.code, `adjust delta=${delta} was rejected: ${res.message}`).toBeNull();
    }
    expect(await balanceOf(userId)).toBe(100); // 100 + 0 - 42 + 42
  });
});

/**
 * M-09 (migration 0019). The DB did not prevent a negative balance.
 *
 * packages/core/src/billing/ledger.ts:97-104 rejects an adjust that would drive the balance
 * negative and goals/ledger-integrity.md asserts `balance >= 0`, but 0011:20-33 deliberately
 * left the `adjust` delta unbounded — so a DB-authoritative operator, a recovery script or a
 * service bug could write a negative delta larger than the balance and the DB said yes.
 *
 * Option B, as the operator approved it: a BEFORE INSERT trigger that, for `kind='adjust'`
 * with delta < 0, computes the balance UNDER THE PER-USER ADVISORY LOCK the ledger already
 * uses (0005 reserve_credits / 0007 process_paddle_purchase) and refuses an insert that would
 * take it below zero — UNLESS the row carries an explicit deliberate marker (`reason` prefixed
 * `override:`). Typos and service bugs stop; a legitimate clawback of credit that was granted
 * by mistake and partly spent — which NECESSARILY goes negative — stays possible.
 */
describe("credit_ledger negative-balance guard (migration 0019, M-09)", () => {
  it("REJECTS a negative adjust that would drive the balance below zero", async () => {
    const userId = await makeUserId();
    expect((await insertRow(userId, { delta: 100, kind: "grant" })).code).toBeNull();

    const res = await insertRow(userId, { delta: -500, kind: "adjust" });
    expect(res.code, "a negative adjust beyond the balance was ACCEPTED").not.toBeNull();
    expect(res.message).toMatch(/would drive the balance below zero/);

    // Nothing landed: the balance is exactly what it was.
    expect(await balanceOf(userId)).toBe(100);
  });

  it("REJECTS a negative adjust against a zero balance (the empty-account typo)", async () => {
    const userId = await makeUserId();
    const res = await insertRow(userId, { delta: -1, kind: "adjust" });
    expect(res.message).toMatch(/would drive the balance below zero/);
    expect(await balanceOf(userId)).toBe(0);
  });

  it("ACCEPTS a negative adjust that lands EXACTLY on zero (the boundary is >= 0, not > 0)", async () => {
    const userId = await makeUserId();
    expect((await insertRow(userId, { delta: 100, kind: "grant" })).code).toBeNull();
    const res = await insertRow(userId, { delta: -100, kind: "adjust" });
    expect(res.code, `exact-to-zero adjust was rejected: ${res.message}`).toBeNull();
    expect(await balanceOf(userId)).toBe(0);
  });

  it("ACCEPTS a below-zero adjust when reason is marked `override:` (deliberate correction)", async () => {
    const userId = await makeUserId();
    expect((await insertRow(userId, { delta: 100, kind: "grant" })).code).toBeNull();

    // The real case this exists for: 500 credits were granted by mistake, the user spent 400
    // of them, and the grant is being clawed back. The result MUST be allowed to go negative —
    // refusing it would leave the mistaken grant permanently on the books.
    const res = await insertRow(userId, {
      delta: -500,
      kind: "adjust",
      reason: "override: clawback of mis-granted promo, approved by operator",
    });
    expect(res.code, `override adjust was rejected: ${res.message}`).toBeNull();
    expect(await balanceOf(userId)).toBe(-400);
  });

  it("does NOT treat `override:` appearing later in the reason as the marker (prefix only)", async () => {
    const userId = await makeUserId();
    const res = await insertRow(userId, {
      delta: -50,
      kind: "adjust",
      reason: "customer asked for an override: refund",
    });
    expect(res.message).toMatch(/would drive the balance below zero/);
    expect(await balanceOf(userId)).toBe(0);
  });

  it("leaves a POSITIVE adjust and a normal reserve/commit spend completely unaffected", async () => {
    const userId = await makeUserId();
    expect((await insertRow(userId, { delta: 100, kind: "grant" })).code).toBeNull();

    // A positive adjust: never reaches the guard at all.
    expect((await insertRow(userId, { delta: 25, kind: "adjust" })).code).toBeNull();
    expect(await balanceOf(userId)).toBe(125);

    // The normal spend path, written exactly as reserve_credits + commit_reserve emit it.
    const reserveId = randomUUID();
    const jobId = randomUUID();
    expect(
      (await insertRow(userId, { delta: -20, kind: "spend_reserve", reserveId, jobId })).code,
    ).toBeNull();
    expect(
      (await insertRow(userId, { delta: 0, kind: "spend_commit", reserveId, jobId })).code,
    ).toBeNull();
    expect(await balanceOf(userId)).toBe(105);
  });

  it("does NOT fire for non-adjust kinds — the HOT PATH never enters the trigger body", async () => {
    // This is the behavioural proof that the WHEN clause short-circuits before the function is
    // called: a raw spend_reserve of -999 against a balance of 0 is still ACCEPTED. If the
    // trigger ran for spend kinds it would have to reject this row, and the reserve/commit/
    // release path would pay for a second SUM(delta) and a second advisory lock on every call.
    //
    // It is ALSO the honest statement of what 0019 does NOT cover. reserve_credits (0005)
    // already refuses to oversell under the same lock, so no product path can emit this row;
    // a raw writer still can. Widening the guard to every negative delta was considered and
    // NOT taken — the operator scoped Option B to `adjust` precisely to keep the hot path free.
    const userId = await makeUserId();
    const res = await insertRow(userId, {
      delta: -999,
      kind: "spend_reserve",
      reserveId: randomUUID(),
      jobId: randomUUID(),
    });
    expect(res.code, `raw spend_reserve was rejected: ${res.message}`).toBeNull();
    expect(await balanceOf(userId)).toBe(-999);
  });

  it("holds within ONE multi-row statement too (each row sees its predecessors)", async () => {
    const userId = await makeUserId();
    expect((await insertRow(userId, { delta: 100, kind: "grant" })).code).toBeNull();

    // The plausible worry is that rows of the CURRENT statement are invisible to the trigger, so
    // a batch would judge every row against the pre-statement balance and let them all through.
    // Measured: it does not. A BEFORE ROW trigger runs with the command counter advanced past the
    // rows already inserted by the same command, so -60 then -30 leaves 10 and the third -30 is
    // refused ON THE RUNNING TOTAL. Pinned here so a rewrite to AFTER-STATEMENT (or a future
    // Postgres) cannot quietly lose it.
    const { error } = await service.from("credit_ledger").insert([
      { user_id: userId, delta: -60, kind: "adjust", reason: "batch a" },
      { user_id: userId, delta: -30, kind: "adjust", reason: "batch b" },
      { user_id: userId, delta: -30, kind: "adjust", reason: "batch c" },
    ]);
    expect(error?.message, "a multi-row batch slipped past the guard").toMatch(
      /would drive the balance below zero \(current balance 10\)/,
    );
    // The whole statement rolled back — not one of the three rows landed.
    expect(await balanceOf(userId)).toBe(100);
  });

  it("CONCURRENCY: racing negative adjusts serialize — the balance can never be oversold", async () => {
    const userId = await makeUserId();
    expect((await insertRow(userId, { delta: 100, kind: "grant" })).code).toBeNull();

    // Eight PARALLEL adjusts of -30 demand 240 against a balance of 100. This shape is chosen
    // to DISCRIMINATE, not merely to pass: a guard that reads the balance WITHOUT the advisory
    // lock lets all eight read 100, all eight conclude "100-30 >= 0", and all eight land
    // (balance -140). Only a guard that serializes can stop at floor(100/30) = 3.
    // Same reasoning — and the same expected arithmetic — as ledger-repo.db.test.ts (e).
    const settled = await Promise.all(
      Array.from({ length: 8 }, () => insertRow(userId, { delta: -30, kind: "adjust" })),
    );
    const accepted = settled.filter((r) => r.code === null);
    const rejected = settled.filter((r) => r.code !== null);

    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) {
      expect(r.message).toMatch(/would drive the balance below zero/);
    }

    const balance = await balanceOf(userId);
    expect(balance).toBe(10);
    expect(balance).toBeGreaterThanOrEqual(0); // never oversold
  });
});
