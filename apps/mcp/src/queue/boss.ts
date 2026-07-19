import { PgBoss } from "pg-boss";
import { loadEnv } from "../env.ts";
import { getServiceClient, type Json, type JobRow, type JobUpdate } from "../db.ts";

/**
 * Queue + jobs bridge. Owns the pg-boss instance over SUPABASE_DB_URL for async job
 * delivery, plus the jobs-table read/writes and the ledger-RPC reserve bookkeeping
 * (setJobReserve). Its service-role Supabase client — for the jobs table and the
 * migration-0005 ledger RPCs — now comes from db.ts (the single client owner); this
 * module no longer defines a parallel client or schema slice.
 *
 * SUPABASE_DB_URL must be a Supavisor SESSION-mode connection (port 5432) or a
 * direct Postgres connection. The transaction pooler (port 6543) is FORBIDDEN:
 * pg-boss holds long-lived connections and uses session state (LISTEN/NOTIFY,
 * advisory locks) that transaction pooling breaks.
 */

// Re-exported from the consolidated DB module so existing consumers (worker.ts,
// the db-integration specs) keep importing the jobs row types from here.
export type { Json, JobRow, JobStatus } from "../db.ts";

/** Single queue for tool runs; the message routes to a per-tool handler. */
export const JOBS_QUEUE = "tool-jobs";

/** Payload carried on the queue (the jobs table itself stores no tool input). */
export interface JobMessage {
  jobId: string;
  userId: string;
  tool: string;
  payload: Record<string, unknown>;
}

let bossPromise: Promise<PgBoss> | null = null;

async function createBoss(): Promise<PgBoss> {
  const env = loadEnv();
  // SESSION mode / direct connection only — see the module comment.
  const boss = new PgBoss({ connectionString: env.SUPABASE_DB_URL, schema: "pgboss" });
  boss.on("error", (error) => console.error("pg-boss error:", error));
  await boss.start();
  await boss.createQueue(JOBS_QUEUE, { retryLimit: 0 }); // ON CONFLICT DO NOTHING — idempotent
  return boss;
}

/**
 * Lazy pg-boss singleton in its own `pgboss` schema. Queue retryLimit is pinned
 * to 0: a failed run must never be re-executed automatically — retries around
 * credit reserves are a money decision, not queue plumbing (see worker.ts).
 *
 * The cache holds the in-flight PROMISE, not the resolved instance. Caching
 * only the resolved instance (null-check-then-await) leaves a window, between
 * the check and `await boss.start()`, where two concurrent first callers both
 * see no cached instance and each start their own PgBoss — the loser leaks a
 * connection pool that stopBoss can never reach. Caching the promise closes
 * that window: the assignment below happens synchronously (before either
 * internal await runs), so every caller — concurrent or not — awaits the
 * exact same promise and resolves to the exact same instance.
 */
export async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = createBoss().catch((error: unknown) => {
      // Startup failed — drop the cached rejection so the NEXT call gets a
      // fresh attempt instead of permanently awaiting a broken promise.
      bossPromise = null;
      throw error;
    });
  }
  return bossPromise;
}

/** Graceful shutdown: waits for in-flight work, then closes the pool (SIGTERM path). */
export async function stopBoss(): Promise<void> {
  if (!bossPromise) return;
  const promise = bossPromise;
  bossPromise = null;
  const boss = await promise;
  await boss.stop({ graceful: true, close: true });
}

export interface EnqueueContext {
  userId: string;
}

export interface EnqueueInput {
  tool: string;
  projectId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Create the jobs row (status `queued`) and hand the run to pg-boss. If the queue
 * send fails after the insert, the row is marked failed so no job can sit
 * `queued` forever with no message behind it.
 */
export async function enqueueJob(
  ctx: EnqueueContext,
  input: EnqueueInput,
): Promise<{ jobId: string }> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("jobs")
    .insert({
      user_id: ctx.userId,
      project_id: input.projectId ?? null,
      tool: input.tool,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`enqueueJob: jobs insert failed: ${error?.message ?? "no row returned"}`);
  }
  const jobId = data.id;

  const message: JobMessage = {
    jobId,
    userId: ctx.userId,
    tool: input.tool,
    payload: input.payload ?? {},
  };
  try {
    const boss = await getBoss();
    await boss.send(JOBS_QUEUE, message);
  } catch (sendError) {
    const detail = sendError instanceof Error ? sendError.message : String(sendError);
    await failJob(jobId, `enqueue failed: ${detail}`);
    throw new Error(`enqueueJob: queue send failed: ${detail}`);
  }
  return { jobId };
}

/**
 * Read one jobs row (null when the id is unknown).
 *
 * id-only lookup — callers exposing this to tenants MUST scope by user_id
 * (see get_job_status). This function does NOT check ownership itself;
 * today's callers (executeJob, tests) are trusted internal call sites that
 * already hold the expected user_id and cross-check it themselves before
 * acting on the row.
 */
export async function getJob(jobId: string): Promise<JobRow | null> {
  const { data, error } = await getServiceClient()
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) {
    throw new Error(`getJob failed: ${error.message}`);
  }
  return data;
}

async function updateJob(
  jobId: string,
  patch: JobUpdate,
  what: string,
): Promise<void> {
  const { error } = await getServiceClient().from("jobs").update(patch).eq("id", jobId);
  if (error) {
    throw new Error(`${what} failed: ${error.message}`);
  }
}

/** Transition to `running` and stamp started_at (worker calls this before the tool runs). */
export async function markJobRunning(jobId: string): Promise<void> {
  await updateJob(
    jobId,
    { status: "running", started_at: new Date().toISOString() },
    "markJobRunning",
  );
}

/** Record the credit reserve held by this run (crash forensics + settlement audits). */
export async function setJobReserve(jobId: string, reserveId: string): Promise<void> {
  await updateJob(jobId, { reserve_id: reserveId }, "setJobReserve");
}

/** Terminal success: status, finish stamp, and the tool result payload. */
export async function completeJob(jobId: string, result: Json | null): Promise<void> {
  await updateJob(
    jobId,
    { status: "succeeded", finished_at: new Date().toISOString(), result },
    "completeJob",
  );
}

/** Terminal failure: status, finish stamp, and the failure detail. */
export async function failJob(jobId: string, errorMessage: string): Promise<void> {
  await updateJob(
    jobId,
    { status: "failed", finished_at: new Date().toISOString(), error: errorMessage },
    "failJob",
  );
}
