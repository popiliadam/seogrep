import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { creditBalance, getServiceClient } from "../db.ts";
import { getJob } from "./boss.ts";
import { reconcileStuckJobs } from "./reaper.ts";
import { TOOL_COSTS } from "../credits/costs.ts";

/**
 * DB-integration tests for the stuck-job reaper against a LOCAL Supabase stack (verify-db
 * env). Reserves are opened through the REAL reserve_credits RPC — never hand-inserted —
 * so every test exercises the genuine reserve/commit/release money path.
 *
 * The reaper scans running jobs globally, but its 15-min age filter is a hard isolator:
 * only deliberately-aged (started_at = 20 min ago) jobs qualify, and only these tests age
 * jobs, so the outcome counters are deterministic. Isolation matches the sibling
 * worker.db.test.ts: a unique user per test + the verify-db `db reset` (seeded ledger rows
 * and users can't be deleted — append-only ledger + ON DELETE RESTRICT — so reset is it).
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
requireEnv("SUPABASE_DB_URL");

const service = getServiceClient();

const COST = TOOL_COSTS.audit_tech; // 15 — a real priced tool
const GRANT = 30;
const TWENTY_MIN = 20 * 60_000;
const ONE_MIN = 60_000;

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `reaper-${randomUUID()}@example.test`,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function seedGrant(userId: string, amount: number): Promise<void> {
  const { error } = await service
    .from("credit_ledger")
    .insert({ user_id: userId, delta: amount, kind: "grant", reason: "test-seed" });
  if (error) throw new Error(`seed grant failed: ${error.message}`);
}

/** Insert a jobs row driven to `running` with an explicit (backdated) started_at and an
 *  optional reserve_id. The jobs Insert slice only accepts `queued`, so we insert then UPDATE. */
async function insertRunningJob(
  userId: string,
  startedAt: Date,
  reserveId: string | null,
): Promise<string> {
  const inserted = await service
    .from("jobs")
    .insert({ user_id: userId, tool: "audit_tech", status: "queued" })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`jobs insert failed: ${inserted.error?.message ?? "no row"}`);
  }
  const jobId = inserted.data.id;
  const { error } = await service
    .from("jobs")
    .update({ status: "running", started_at: startedAt.toISOString(), reserve_id: reserveId })
    .eq("id", jobId);
  if (error) throw new Error(`jobs running-update failed: ${error.message}`);
  return jobId;
}

/**
 * Seed a funded user with an aged `running` job holding a genuine open reserve (opened via
 * the real reserve_credits RPC, so the balance is really debited). `stampReserve=false`
 * leaves jobs.reserve_id NULL — the orphan / crash-before-setJobReserve shape.
 */
async function seedStuckJob(
  ageMs: number,
  now: Date,
  stampReserve: boolean,
): Promise<{ userId: string; jobId: string; reserveId: string }> {
  const userId = await makeUserId();
  await seedGrant(userId, GRANT);
  const jobId = await insertRunningJob(userId, new Date(now.getTime() - ageMs), null);
  const { data, error } = await service.rpc("reserve_credits", {
    p_user_id: userId,
    p_amount: COST,
    p_tool: "audit_tech",
    p_job_id: jobId,
  });
  if (error || typeof data !== "string") {
    throw new Error(`reserve_credits failed: ${error?.message ?? "no reserve id returned"}`);
  }
  if (stampReserve) await service.from("jobs").update({ reserve_id: data }).eq("id", jobId);
  return { userId, jobId, reserveId: data };
}

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

describe("reconcileStuckJobs against the local stack", () => {
  it("happy reap: an aged running job with an open reserve is refunded and marked failed", async () => {
    const now = new Date();
    const { userId, jobId } = await seedStuckJob(TWENTY_MIN, now, true);
    expect(await creditBalance(service, userId)).toBe(GRANT - COST);

    const outcome = await reconcileStuckJobs({ now: () => now });

    expect(outcome.released).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.alreadySettled).toBe(0);
    expect(outcome.orphanReserves).toBe(0);
    expect(await creditBalance(service, userId)).toBe(GRANT); // reserve refunded
    const job = await getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("reconciled");
    expect(job?.finished_at).not.toBeNull();
  });

  it("young job untouched: a job started 1 min ago is not a candidate and keeps its debit", async () => {
    const now = new Date();
    const { userId, jobId } = await seedStuckJob(ONE_MIN, now, true);

    const outcome = await reconcileStuckJobs({ now: () => now });

    expect(outcome.scanned).toBe(0);
    expect(outcome.released).toBe(0);
    expect((await getJob(jobId))?.status).toBe("running");
    expect(await creditBalance(service, userId)).toBe(GRANT - COST); // still debited
  });

  it("already-settled: a committed reserve is skipped (no double refund), honest fail-mark", async () => {
    const now = new Date();
    const { userId, jobId, reserveId } = await seedStuckJob(TWENTY_MIN, now, true);
    // The real worker finished just as the reaper runs: the reserve is committed.
    const commit = await service.rpc("commit_reserve", { p_reserve_id: reserveId });
    if (commit.error) throw new Error(`commit_reserve failed: ${commit.error.message}`);
    expect(await creditBalance(service, userId)).toBe(GRANT - COST); // commit stands

    const outcome = await reconcileStuckJobs({ now: () => now });

    expect(outcome.alreadySettled).toBe(1);
    expect(outcome.released).toBe(0);
    expect(await creditBalance(service, userId)).toBe(GRANT - COST); // invariant: NOT re-refunded
    // Crash-after-commit is charged + unrefundable — the fail-mark must NOT claim a refund.
    const job = await getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("already settled");
    expect(job?.error).not.toContain("reserve released");
  });

  it("orphan reserve: an open reserve found via ledger.job_id when jobs.reserve_id is NULL", async () => {
    const now = new Date();
    // stampReserve=false → reserve_id NULL, the crash-before-setJobReserve window.
    const { userId, jobId } = await seedStuckJob(TWENTY_MIN, now, false);
    expect(await creditBalance(service, userId)).toBe(GRANT - COST);

    const outcome = await reconcileStuckJobs({ now: () => now });

    expect(outcome.orphanReserves).toBe(1);
    expect(outcome.released).toBe(1);
    expect(await creditBalance(service, userId)).toBe(GRANT); // refunded via job_id lookup
    expect((await getJob(jobId))?.status).toBe("failed");
  });

  it("batch isolation: a healthy stuck job is reaped alongside a broken (already-released) one", async () => {
    const now = new Date();
    const healthy = await seedStuckJob(TWENTY_MIN, now, true);
    // Broken: reserve already released before the reaper runs → release raises "already
    // settled"; the per-job handling swallows it and still processes the healthy job.
    const broken = await seedStuckJob(TWENTY_MIN, now, true);
    const release = await service.rpc("release_reserve", { p_reserve_id: broken.reserveId });
    if (release.error) throw new Error(`release_reserve failed: ${release.error.message}`);

    const outcome = await reconcileStuckJobs({ now: () => now });

    expect(outcome.released).toBe(1); // only the healthy reserve
    expect(outcome.alreadySettled).toBe(1); // the broken one
    expect((await getJob(healthy.jobId))?.status).toBe("failed");
    expect((await getJob(broken.jobId))?.status).toBe("failed");
    expect(await creditBalance(service, healthy.userId)).toBe(GRANT); // refunded
    expect(await creditBalance(service, broken.userId)).toBe(GRANT); // already refunded, not double
  });
});
