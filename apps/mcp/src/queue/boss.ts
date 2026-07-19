import { PgBoss } from "pg-boss";
import { loadEnv } from "../env.ts";
import {
  getServiceClient,
  type Json,
  type JobRow,
  type JobUpdate,
  type ServiceClient,
} from "../db.ts";

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

/**
 * Read one jobs row scoped to its owner: id = ? AND user_id = ?. This is the ONLY
 * job read a tenant-facing surface may use (get_job_status). The user_id filter is
 * the tenant guard on the RLS-bypassing service client (constitution NEVER #4), so
 * another user's job — or an unknown id — both resolve to null and are therefore
 * INDISTINGUISHABLE to the caller (no cross-tenant existence leak). Never wire the
 * id-only getJob above to a tool surface; it does not scope by owner.
 */
export async function getJobForUser(
  client: ServiceClient,
  jobId: string,
  userId: string,
): Promise<JobRow | null> {
  const { data, error } = await client
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`getJobForUser failed: ${error.message}`);
  }
  return data;
}

/**
 * The latest SUCCEEDED tool-run result a read port returns: the job id, its stored jsonb
 * result, and when the job was created. One shape for every "read the newest succeeded run
 * of tool X" port — crawl (audits), pull (discovery), and now report generation (T12).
 */
export interface LatestResult {
  readonly jobId: string;
  readonly result: Json | null;
  readonly createdAt: string;
}

/**
 * Read the most recent SUCCEEDED `tool` job for a project, tenant-scoped (user_id = the
 * caller AND project_id = the target). This is the ONE generic read port the per-tool
 * accessors below fold onto (referee fold, T12: a third reader — report generation — reads
 * BOTH crawl and pull through this same query rather than adding a third copy).
 *
 * The user_id filter is the tenant guard on the RLS-bypassing service client (constitution
 * NEVER #4): a project that is missing or belongs to another tenant both resolve to null
 * (the caller then tells the user to run the upstream tool first — no cross-tenant existence
 * leak). `jobs` is fully typed here, so the projection needs no cast.
 */
export async function getLatestSucceededResult(
  client: ServiceClient,
  params: { projectId: string; userId: string; tool: string },
): Promise<LatestResult | null> {
  const { data, error } = await client
    .from("jobs")
    .select("id, result, created_at")
    .eq("user_id", params.userId)
    .eq("project_id", params.projectId)
    .eq("tool", params.tool)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`getLatestSucceededResult(${params.tool}) failed: ${error.message}`);
  }
  return data ? { jobId: data.id, result: data.result, createdAt: data.created_at } : null;
}

/** The latest crawl the audits read: its stored CrawlResult and when the job was created. */
export type LatestCrawl = LatestResult;

/**
 * The audit tools' input port: the most recent SUCCEEDED crawl_site run for a project. A thin
 * delegate to getLatestSucceededResult (tool = "crawl_site") — the tenant-scoping and null
 * semantics are the generic's; this keeps the audit call sites (audit/load.ts) unchanged.
 */
export async function getLatestSucceededCrawl(
  client: ServiceClient,
  projectId: string,
  userId: string,
): Promise<LatestCrawl | null> {
  return getLatestSucceededResult(client, { projectId, userId, tool: "crawl_site" });
}

/** The latest pull the discovery tools read: its stored PullData jsonb and when it ran. */
export type LatestPull = LatestResult;

/**
 * The discovery tools' input port: the most recent SUCCEEDED pull_gsc_data run for a project.
 * A thin delegate to getLatestSucceededResult (tool = "pull_gsc_data") — the sibling of
 * getLatestSucceededCrawl for the GSC read path, keeping the discovery call sites
 * (gsc-data/load.ts) unchanged.
 */
export async function getLatestSucceededPull(
  client: ServiceClient,
  projectId: string,
  userId: string,
): Promise<LatestPull | null> {
  return getLatestSucceededResult(client, { projectId, userId, tool: "pull_gsc_data" });
}

/**
 * Record a completed pull_gsc_data run as a SUCCEEDED jobs row carrying the PullData in
 * `result`. pull_gsc_data is a SYNC (surface-charged) tool, so this row is purely a data
 * carrier: the credit reserve/commit lives on the ledger (keyed to a traceability uuid),
 * and reserve_id is deliberately LEFT NULL here — there is no worker reserve on this path.
 * Insert-then-complete mirrors the audit db-test seed shape (jobs.Insert has no result
 * column, so the result lands via the succeeded update).
 */
export async function recordSucceededPull(
  client: ServiceClient,
  params: { userId: string; projectId: string; result: Json },
): Promise<{ jobId: string }> {
  const inserted = await client
    .from("jobs")
    .insert({
      user_id: params.userId,
      project_id: params.projectId,
      tool: "pull_gsc_data",
      status: "queued",
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`recordSucceededPull: jobs insert failed: ${inserted.error?.message ?? "no row"}`);
  }
  const jobId = inserted.data.id;
  const { error } = await client
    .from("jobs")
    .update({ status: "succeeded", finished_at: new Date().toISOString(), result: params.result })
    .eq("id", jobId);
  if (error) {
    throw new Error(`recordSucceededPull: jobs completion failed: ${error.message}`);
  }
  return { jobId };
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

/**
 * Record the credit reserve held by this run (crash forensics + settlement audits).
 * ASSERTS the row exists: the update must touch exactly the one jobs row named by
 * jobId. A 0-row update means the id names no row (a broken reserve trace), so this
 * throws rather than silently succeeding — the credit guard turns that throw into a
 * release. Only the async worker path (a real queued job) reaches here; sync surface
 * tools never call this (they have no jobs row).
 */
export async function setJobReserve(jobId: string, reserveId: string): Promise<void> {
  const { data, error } = await getServiceClient()
    .from("jobs")
    .update({ reserve_id: reserveId })
    .eq("id", jobId)
    .select("id");
  if (error) {
    throw new Error(`setJobReserve failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(
      `setJobReserve: no jobs row ${jobId} to record reserve ${reserveId} (broken reserve trace)`,
    );
  }
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
