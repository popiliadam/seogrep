import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { enqueueJob, getBoss, getJob, stopBoss, type JobMessage } from "./boss.ts";
import { getServiceClient } from "../db.ts";
import { clearToolHandlers, executeJob, registerToolHandler, startWorker } from "./worker.ts";
import { TOOL_COSTS } from "../credits/costs.ts";

/**
 * DB-integration tests for the jobs bridge + pg-boss consumer, against a LOCAL
 * Supabase stack (verify-db env; SUPABASE_DB_URL points at the stack's session-mode
 * Postgres). Test order matters: the enqueue-only spec runs BEFORE any worker is
 * started so its `queued` assertion cannot race a consumer.
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

async function makeUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `worker-${randomUUID()}@example.test`,
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

async function makeQueuedJob(userId: string, tool: string): Promise<string> {
  const { data, error } = await service
    .from("jobs")
    .insert({ user_id: userId, tool, status: "queued" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`jobs insert failed: ${error?.message ?? "no row"}`);
  return data.id;
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

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

beforeAll(async () => {
  const { error } = await service.from("jobs").select("id").limit(1);
  if (error) {
    throw new Error(`cannot reach local Supabase (run via the verify-db env): ${error.message}`);
  }
});

afterEach(() => {
  clearToolHandlers();
});

afterAll(async () => {
  await stopBoss();
});

describe("jobs bridge + worker against the local stack", () => {
  it("enqueueJob inserts a queued jobs row and returns its id", async () => {
    const userId = await makeUserId();
    const { jobId } = await enqueueJob({ userId }, { tool: "list_projects" });

    const job = await getJob(jobId);
    expect(job?.status).toBe("queued");
    expect(job?.tool).toBe("list_projects");
    expect(job?.user_id).toBe(userId);
    expect(job?.project_id).toBeNull();
    expect(job?.started_at).toBeNull();
    expect(job?.finished_at).toBeNull();
  });

  it("queue round-trip: an enqueued job is consumed and marked succeeded with its result", async () => {
    const userId = await makeUserId();
    registerToolHandler("whats_next", async () => ({ advice: ["publish more"] }));
    await startWorker();

    const { jobId } = await enqueueJob({ userId }, { tool: "whats_next" });

    const done = await waitFor(async () => {
      const job = await getJob(jobId);
      return job && (job.status === "succeeded" || job.status === "failed") ? job : null;
    });
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ advice: ["publish more"] });
    expect(done.started_at).not.toBeNull();
    expect(done.finished_at).not.toBeNull();
  });

  it("executeJob success: running -> succeeded with result, credits reserved and committed", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 30);
    const jobId = await makeQueuedJob(userId, "audit_tech");
    registerToolHandler("audit_tech", async () => ({ audited: true }));

    await executeJob({ jobId, userId, tool: "audit_tech", payload: {} });

    const job = await getJob(jobId);
    expect(job?.status).toBe("succeeded");
    expect(job?.result).toEqual({ audited: true });
    expect(job?.started_at).not.toBeNull();
    expect(job?.finished_at).not.toBeNull();
    expect(job?.reserve_id).not.toBeNull();
    expect(await ledgerKinds(userId)).toEqual(["grant", "spend_reserve", "spend_commit"]);
  });

  it("executeJob failure (brief proof b): failed + error set, reserve released", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 30);
    const jobId = await makeQueuedJob(userId, "find_quick_wins");
    registerToolHandler("find_quick_wins", async () => {
      throw new Error("quick wins handler exploded");
    });

    await executeJob({ jobId, userId, tool: "find_quick_wins", payload: {} });

    const job = await getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("quick wins handler exploded");
    expect(job?.finished_at).not.toBeNull();
    expect(await ledgerKinds(userId)).toEqual(["grant", "spend_reserve", "spend_release"]);
  });

  it("executeJob insufficient balance: failed with the DB error, only the grant in the ledger", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, TOOL_COSTS.audit_onpage - 1);
    const jobId = await makeQueuedJob(userId, "audit_onpage");
    let ran = false;
    registerToolHandler("audit_onpage", async () => {
      ran = true;
      return null;
    });

    await executeJob({ jobId, userId, tool: "audit_onpage", payload: {} });

    expect(ran).toBe(false);
    const job = await getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/insufficient balance/);
    expect(await ledgerKinds(userId)).toEqual(["grant"]);
  });

  it("executeJob refuses to re-run a settled job (no double execution, no new ledger rows)", async () => {
    const userId = await makeUserId();
    await seedGrant(userId, 100);
    const jobId = await makeQueuedJob(userId, "audit_tech");
    let calls = 0;
    registerToolHandler("audit_tech", async () => {
      calls += 1;
      return null;
    });

    const message: JobMessage = { jobId, userId, tool: "audit_tech", payload: {} };
    await executeJob(message);
    expect(calls).toBe(1);

    await executeJob(message); // redelivery of the same job must be a no-op
    expect(calls).toBe(1);
    expect(await ledgerKinds(userId)).toEqual(["grant", "spend_reserve", "spend_commit"]);
  });

  it("executeJob with no registered handler marks the job failed", async () => {
    const userId = await makeUserId();
    const jobId = await makeQueuedJob(userId, "generate_report");

    await executeJob({ jobId, userId, tool: "generate_report", payload: {} });

    const job = await getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/no handler registered/);
    expect(await ledgerKinds(userId)).toEqual([]); // failed BEFORE any reserve
  });
});

// --- Fix wave 1 (Important 1): worker cross-checks job ownership -----------
// getJob(id) is an unscoped id-only lookup (see the loud comment on it in
// boss.ts). executeJob is the trusted internal caller that must not act on a
// queue message whose userId does not match the jobs row it names.
describe("executeJob tenant isolation (fix wave 1, Important 1)", () => {
  it("refuses to run when the message userId does not match the job's owner: handler never runs, job fails, no ledger row for anyone", async () => {
    const ownerId = await makeUserId();
    const otherUserId = await makeUserId();
    await seedGrant(ownerId, TOOL_COSTS.audit_tech);
    // otherUserId is FUNDED too — proves the guard is an identity check, not
    // an accidental side effect of the mismatched user lacking balance.
    await seedGrant(otherUserId, TOOL_COSTS.audit_tech);
    const jobId = await makeQueuedJob(ownerId, "audit_tech");
    let ran = false;
    registerToolHandler("audit_tech", async () => {
      ran = true;
      return null;
    });

    // A message claiming a DIFFERENT userId than the job's real owner —
    // forged/corrupted message, or a caller that resolved ownership wrong.
    await executeJob({ jobId, userId: otherUserId, tool: "audit_tech", payload: {} });

    expect(ran).toBe(false); // handler must not run under the wrong identity
    const job = await getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/owner mismatch/i);
    expect(job?.started_at).toBeNull(); // never even reached markJobRunning
    // No credit reserve was ever opened — neither identity's ledger moved
    // past its initial grant (in particular, otherUserId's funded balance
    // was never touched to pay for someone else's job).
    expect(await ledgerKinds(ownerId)).toEqual(["grant"]);
    expect(await ledgerKinds(otherUserId)).toEqual(["grant"]);
  });
});

// --- Fix wave 1 (Important 2): getBoss singleton is promise-cached ---------
// A null-check-then-await cache lets two concurrent first callers each start
// their own PgBoss (the loser leaks a connection stopBoss can never reach).
// Caching the in-flight promise instead closes that window.
describe("getBoss singleton (fix wave 1, Important 2)", () => {
  it("two concurrent first calls resolve to the exact same pg-boss instance", async () => {
    // Force a cold cache: stopBoss clears it synchronously before its own
    // await, so the two getBoss() calls below race from a genuinely empty
    // cache (not an already-resolved one left over from an earlier test).
    await stopBoss();

    const [first, second] = await Promise.all([getBoss(), getBoss()]);

    expect(first).toBe(second);
  });
});
