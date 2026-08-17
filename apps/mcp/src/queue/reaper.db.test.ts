import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
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
/**
 * The ledger is append-only, so a spend_reserve row's created_at CANNOT be backdated the way
 * jobs.started_at can. The ledger-keyed specs therefore move the CLOCK forward instead: at
 * `now + 45 min` a reserve created this second is already past the 30-minute orphan cutoff.
 * The jobs lane is neutralised in the same call with a 1-day olderThanMs (its cutoff lands in
 * the real past, so it finds nothing), and `userId` scopes both lanes to the spec's own
 * tenant — without it a future clock would sweep the open reserves of DB specs running in
 * parallel worker processes and make the whole lane flaky.
 */
const FORTY_FIVE_MIN = 45 * 60_000;
const ONE_DAY = 24 * 60 * 60_000;

async function ledgerKinds(userId: string): Promise<string[]> {
  const { data, error } = await service
    .from("credit_ledger")
    .select("kind")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  if (error || !data) throw new Error(`ledger select failed: ${error?.message ?? "no rows"}`);
  return data.map((row) => row.kind);
}

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

/**
 * A ledger-only open reserve — the SYNC surface shape: opened through the real reserve_credits
 * RPC against a traceability uuid, with NO jobs row behind it. Every jobs-keyed detection query
 * (and the whole jobs lane of the reaper) is structurally blind to it.
 */
async function seedSyncReserve(): Promise<{ userId: string; reserveId: string }> {
  const userId = await makeUserId();
  await seedGrant(userId, GRANT);
  const { data, error } = await service.rpc("reserve_credits", {
    p_user_id: userId,
    p_amount: COST,
    p_tool: "audit_tech",
    p_job_id: randomUUID(), // a traceability uuid, exactly like guard.ts's sync path
  });
  if (error || typeof data !== "string") {
    throw new Error(`reserve_credits failed: ${error?.message ?? "no reserve id returned"}`);
  }
  return { userId, reserveId: data };
}

/** Sweep scoped to one tenant with the jobs lane neutralised — see FORTY_FIVE_MIN above. */
async function sweepLedgerFor(userId: string, now: Date) {
  return reconcileStuckJobs({
    now: () => new Date(now.getTime() + FORTY_FIVE_MIN),
    olderThanMs: ONE_DAY,
    userId,
  });
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

  it("already-REFUNDED (L-01): a released reserve is NOT reported as a standing charge", async () => {
    const now = new Date();
    const { userId, jobId, reserveId } = await seedStuckJob(TWENTY_MIN, now, true);
    // The money already went BACK: a previous sweep (or the guard) released the reserve, but
    // the jobs row never flipped out of `running`. release_reserve raises the very same
    // "already settled" here as it does for a COMMITTED reserve — the L-01 root cause.
    const release = await service.rpc("release_reserve", { p_reserve_id: reserveId });
    if (release.error) throw new Error(`release_reserve failed: ${release.error.message}`);
    expect(await creditBalance(service, userId)).toBe(GRANT); // refunded already

    const outcome = await reconcileStuckJobs({ now: () => now });

    expect(outcome.alreadyReleased).toBe(1); // refunded, NOT a standing charge
    expect(outcome.alreadyCommitted).toBe(0);
    expect(outcome.alreadySettled).toBe(1); // the preserved total still counts it once
    expect(outcome.released).toBe(0); // never refunded twice
    expect(await creditBalance(service, userId)).toBe(GRANT); // invariant: no double refund
    const job = await getJob(jobId);
    expect(job?.status).toBe("failed");
    // The user's money is back — telling them a charge stands and to contact support is a lie.
    expect(job?.error).toContain("refunded");
    expect(job?.error).not.toContain("contact support");
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

  it("no-reserve reap: an aged running job that never opened a reserve fails with honest wording, balance untouched", async () => {
    const now = new Date();
    // No reserve_credits call: the worker crashed before any reserve opened. reserve_id NULL
    // and there is no spend_reserve ledger row for this job — nothing to release.
    const userId = await makeUserId();
    await seedGrant(userId, GRANT);
    const jobId = await insertRunningJob(userId, new Date(now.getTime() - TWENTY_MIN), null);
    expect(await creditBalance(service, userId)).toBe(GRANT); // never debited

    const outcome = await reconcileStuckJobs({ now: () => now });

    expect(outcome.released).toBe(0);
    expect(outcome.alreadySettled).toBe(0);
    expect(outcome.orphanReserves).toBe(0);
    expect(outcome.failed).toBe(1);
    expect(await creditBalance(service, userId)).toBe(GRANT); // still whole — nothing to refund
    const job = await getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("no open reserve");
    expect(job?.error).not.toContain("reserve released");
    expect(job?.finished_at).not.toBeNull();
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

/**
 * H-01: the ledger-keyed orphan sweep. Every pre-existing detection path — the reaper's own
 * candidate query and reconciliation.md §2a/§2b/§2c — starts from `jobs`, so an open reserve
 * with NO jobs row (the sync surface) or with a jobs row that is no longer `running` (the
 * async worker marks a commit failure `failed`) was invisible to all of them and held the
 * user's credits forever. These specs drive the reserve through the REAL reserve_credits RPC
 * and assert on the derived balance, which is the only thing the user actually feels.
 */
describe("ledger-keyed orphan reserve sweep (H-01)", () => {
  it("(a) an aged reserve with NO jobs row is released exactly once and the balance returns", async () => {
    const now = new Date();
    const { userId } = await seedSyncReserve();
    expect(await creditBalance(service, userId)).toBe(GRANT - COST); // debited, no result

    const outcome = await sweepLedgerFor(userId, now);

    expect(await creditBalance(service, userId)).toBe(GRANT); // made whole
    expect(await ledgerKinds(userId)).toEqual(["grant", "spend_reserve", "spend_release"]);
    expect(outcome.orphanScanned).toBe(1);
    expect(outcome.orphanReleased).toBe(1);
    expect(outcome.scanned).toBe(0); // the jobs lane never saw it — that is the finding
  });

  it("(b) a second sweep is a no-op: no double refund", async () => {
    const now = new Date();
    const { userId } = await seedSyncReserve();
    await sweepLedgerFor(userId, now);

    const second = await sweepLedgerFor(userId, now);

    expect(second.orphanScanned).toBe(0);
    expect(second.orphanReleased).toBe(0);
    expect(await creditBalance(service, userId)).toBe(GRANT); // still exactly one refund
    expect(await ledgerKinds(userId)).toEqual(["grant", "spend_reserve", "spend_release"]);
  });

  it("(c) a YOUNG ledger-only reserve is untouched — a live sync tool must not be refunded", async () => {
    const now = new Date();
    const { userId } = await seedSyncReserve();

    // Real clock, default 30-minute orphan cutoff: this reserve is seconds old.
    const outcome = await reconcileStuckJobs({ now: () => now, userId });

    expect(outcome.orphanScanned).toBe(0);
    expect(outcome.orphanReleased).toBe(0);
    expect(await creditBalance(service, userId)).toBe(GRANT - COST); // still held, correctly
    expect(await ledgerKinds(userId)).toEqual(["grant", "spend_reserve"]);
  });

  it("(d) an open reserve whose jobs row is 'failed' is caught too (the commit-failure shape)", async () => {
    const now = new Date();
    const userId = await makeUserId();
    await seedGrant(userId, GRANT);
    const jobId = await insertRunningJob(userId, new Date(now.getTime() - TWENTY_MIN), null);
    const reserve = await service.rpc("reserve_credits", {
      p_user_id: userId,
      p_amount: COST,
      p_tool: "audit_tech",
      p_job_id: jobId,
    });
    if (reserve.error || typeof reserve.data !== "string") {
      throw new Error(`reserve_credits failed: ${reserve.error?.message ?? "no reserve id"}`);
    }
    // The worker's commit failed, so it marked the job failed and left the reserve open —
    // out of `running`, hence out of reach of every jobs-keyed query in the repo.
    await service
      .from("jobs")
      .update({ status: "failed", finished_at: now.toISOString(), error: "commit failed" })
      .eq("id", jobId);
    expect(await creditBalance(service, userId)).toBe(GRANT - COST);

    const outcome = await sweepLedgerFor(userId, now);

    expect(outcome.orphanReleased).toBe(1);
    expect(await creditBalance(service, userId)).toBe(GRANT);
    expect(await ledgerKinds(userId)).toEqual(["grant", "spend_reserve", "spend_release"]);
  });
});

/**
 * M-01: enqueueJob inserts the `jobs` row and THEN sends the pg-boss message. A process death
 * between the two leaves a row nobody will ever consume — the catch that would mark it failed
 * never runs, retryLimit is 0, and the reaper only scanned `running`. The user watched a job
 * sit `queued` forever. Same clock/tenant scoping as the ledger lane above.
 */
describe("stuck queued job sweep (M-01)", () => {
  async function insertQueuedJob(userId: string): Promise<string> {
    const inserted = await service
      .from("jobs")
      .insert({ user_id: userId, tool: "audit_tech", status: "queued" })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error(`jobs insert failed: ${inserted.error?.message ?? "no row"}`);
    }
    return inserted.data.id;
  }

  it("(e) an aged QUEUED job is failed with honest wording and the ledger stays empty", async () => {
    const now = new Date();
    const userId = await makeUserId();
    await seedGrant(userId, GRANT);
    const jobId = await insertQueuedJob(userId);

    const outcome = await sweepLedgerFor(userId, now);

    expect(outcome.queuedScanned).toBe(1);
    expect(outcome.queuedFailed).toBe(1);
    const job = await getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("never delivered");
    expect(job?.finished_at).not.toBeNull();
    expect(job?.started_at).toBeNull(); // it was never claimed, so nothing to undo
    // No reserve ever opened on this path, so the wording must not imply one, and the
    // ledger must be untouched beyond the seeded grant.
    expect(job?.error).not.toContain("reserve");
    expect(await ledgerKinds(userId)).toEqual(["grant"]);
    expect(await creditBalance(service, userId)).toBe(GRANT);
  });

  it("(f) a YOUNG queued job is untouched — a worker may still be about to pick it up", async () => {
    const now = new Date();
    const userId = await makeUserId();
    const jobId = await insertQueuedJob(userId);

    const outcome = await reconcileStuckJobs({ now: () => now, userId });

    expect(outcome.queuedScanned).toBe(0);
    expect(outcome.queuedFailed).toBe(0);
    expect((await getJob(jobId))?.status).toBe("queued");
  });
});

/**
 * The DFS lane — observation only. A DataForSEO fan-out books ONE reservation before any HTTP
 * and settles it with the real cost afterwards; a run that dies in between leaves the row open,
 * and an open row charges today's budget its full ESTIMATE until the UTC day rolls over.
 *
 * That conservatism is deliberate and is NOT changed here. What was missing is visibility.
 * Measured live 2026-08-07: one crashed analyze_backlinks call held $0.30 of a $3.00 day against
 * roughly $0.08 of genuine spend, and the only way to discover it was to query the table by
 * hand. A budget that can be consumed invisibly can deny paying customers their DFS calls with
 * no trace of why.
 */
/**
 * EVERY insert here is cleaned up. dfs_spend is shared and day-scoped, and budget.db.test.ts
 * asserts the day's TOTAL against the $3 cap — a leaked 0.30 row makes that spec fail from a
 * different file, which is exactly how this was found: verify-db went red on
 * "a FRESH process sees the day's total" with a difference of precisely 0.30.
 */
describe("reaper — stale DataForSEO reservations", () => {
  /**
   * The SAME client, seen without the app's schema slice. That slice declares
   * `dfs_spend.Insert` as `never` deliberately — nothing in production may write the vendor
   * ledger directly; it goes through the 0014 RPCs — and seeding an abandoned reservation is
   * a fixture job, not an app path. Going around the type here rather than relaxing the slice
   * keeps that production constraint exactly where it is.
   */
  const fixtureWriter: SupabaseClient = service;

  const insertDfsRow = async (
    endpoint: string,
    status: "open" | "settled",
    estimatedUsd: number,
    createdAt: Date,
  ): Promise<void> => {
    const { error } = await fixtureWriter.from("dfs_spend").insert({
      spend_day: createdAt.toISOString().slice(0, 10),
      endpoint,
      estimated_usd: estimatedUsd,
      status,
      created_at: createdAt.toISOString(),
      ...(status === "settled" ? { actual_usd: 0.01, settled_at: createdAt.toISOString() } : {}),
    });
    if (error) throw new Error(`dfs_spend insert failed: ${error.message}`);
  };

  it("counts an abandoned reservation and the USD it is still holding", async () => {
    // Measured as a DELTA and cleaned up afterwards. An absolute >= assertion on this shared
    // table passed under two referee mutations purely on leftover rows from other specs — it
    // was reporting the table's history, not this reservation.
    const stamp = `stale-${randomUUID()}`;
    const now = new Date();
    const before = await reconcileStuckJobs({ now: () => now, olderThanMs: ONE_DAY });
    await insertDfsRow(stamp, "open", 0.3, new Date(now.getTime() - 30 * 60_000));
    try {
      const after = await reconcileStuckJobs({ now: () => now, olderThanMs: ONE_DAY });
      expect(after.staleDfsReserves).toBe(before.staleDfsReserves + 1);
      expect(after.staleDfsEstimatedUsd - before.staleDfsEstimatedUsd).toBeCloseTo(0.3, 5);
    } finally {
      await service.from("dfs_spend").delete().eq("endpoint", stamp);
    }
  });

  it("ignores a reservation that is still in flight", async () => {
    const stamp = `inflight-${randomUUID()}`;
    const now = new Date();
    const before = await reconcileStuckJobs({ now: () => now, olderThanMs: ONE_DAY });
    await insertDfsRow(stamp, "open", 0.3, new Date(now.getTime() - 2_000));
    try {
      const after = await reconcileStuckJobs({ now: () => now, olderThanMs: ONE_DAY });
      // A live fan-out settles in seconds; two seconds old is working, not abandoned.
      expect(after.staleDfsReserves).toBe(before.staleDfsReserves);
    } finally {
      await service.from("dfs_spend").delete().eq("endpoint", stamp);
    }
  });

  /**
   * Found in PRODUCTION, not by the gates: after deploying this lane, the reaper announced
   * "count=1 holdingUsd=0.3000 — charging today's budget" for a row left by the PREVIOUS day's
   * crash. It charges nothing today; migration 0014 sums `where spend_day = today`. The query
   * had no day filter while its own comment and the warning text both claimed it did — a false
   * alarm in the one feature whose entire job is to be trusted.
   */
  it("ignores an abandoned reservation left over from a previous day", async () => {
    const stamp = `yesterday-${randomUUID()}`;
    const now = new Date();
    const yesterday = new Date(now.getTime() - 26 * 60 * 60_000);
    const before = await reconcileStuckJobs({ now: () => now, olderThanMs: ONE_DAY });
    await insertDfsRow(stamp, "open", 0.3, yesterday);
    try {
      const after = await reconcileStuckJobs({ now: () => now, olderThanMs: ONE_DAY });
      expect(after.staleDfsReserves).toBe(before.staleDfsReserves);
      expect(after.staleDfsEstimatedUsd).toBeCloseTo(before.staleDfsEstimatedUsd, 5);
    } finally {
      await service.from("dfs_spend").delete().eq("endpoint", stamp);
    }
  });

  it("ignores a settled reservation however old it is", async () => {
    const stamp = `settled-${randomUUID()}`;
    const now = new Date();
    const before = await reconcileStuckJobs({ now: () => now, olderThanMs: ONE_DAY });
    await insertDfsRow(stamp, "settled", 0.3, new Date(now.getTime() - 86_400_000));
    try {
      const after = await reconcileStuckJobs({ now: () => now, olderThanMs: ONE_DAY });
      expect(after.staleDfsReserves).toBe(before.staleDfsReserves);
    } finally {
      await service.from("dfs_spend").delete().eq("endpoint", stamp);
    }
  });

  it("moves NO money: the lane is a read, and dfs_spend is left exactly as it was", async () => {
    const stamp = `readonly-${randomUUID()}`;
    const now = new Date();
    await insertDfsRow(stamp, "open", 0.3, new Date(now.getTime() - 30 * 60_000));
    try {
      await reconcileStuckJobs({ now: () => now, olderThanMs: ONE_DAY });

      const { data } = await service
        .from("dfs_spend")
        .select("status, actual_usd, settled_at")
        .eq("endpoint", stamp)
        .single();
      expect(data?.status).toBe("open");
      expect(data?.actual_usd).toBeNull();
      expect(data?.settled_at).toBeNull();
    } finally {
      await service.from("dfs_spend").delete().eq("endpoint", stamp);
    }
  });
});
