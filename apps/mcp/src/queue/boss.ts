import { PgBoss } from "pg-boss";
import { loadEnv } from "../env.ts";
import {
  getServiceClient,
  type Json,
  type JobRow,
  type JobUpdate,
  type ServiceClient,
} from "../db.ts";
import { errorText, newFailureReference, platformFailureText } from "../failure-redaction.ts";

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
    const detail = errorText(sendError);
    // THE MEASURED LEAK (smoke tour wave 4, F-1). This line used to store `enqueue failed:
    // ${detail}` and get_job_status printed it verbatim, so two production rows answered "why
    // did my 20-credit crawl fail?" with `password authentication failed for user "postgres"`
    // and `getaddrinfo ENOTFOUND base` — our database role and our internal hostname, handed to
    // whoever holds an API key. A queue that will not accept the job is entirely OUR fault and
    // there is nothing in it for the customer to act on, so the stored mark is the generic
    // sentence and the detail goes to the log under the same reference.
    const reference = newFailureReference();
    console.error(`enqueueJob: queue send failed for job ${jobId} [ref ${reference}]: ${detail}`);
    await failJob(jobId, platformFailureText(reference));
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

/** One completed sync run, as its recorder needs it: who, what, and WHEN it actually ran. */
export interface SucceededPullRun {
  readonly userId: string;
  readonly projectId: string;
  readonly result: Json;
  /** When the run actually began — captured by the caller BEFORE it did any work. */
  readonly startedAt: Date;
  /** When the work actually ended — captured by the caller when the pull returned. */
  readonly finishedAt: Date;
}

/**
 * The finish stamp, never earlier than the start stamp.
 *
 * A wall clock can step BACKWARDS (an NTP correction mid-run is the ordinary case), and the two
 * stamps this recorder is handed are two independent reads of it. Storing the pair as measured
 * would persist a negative-length run that every later reader has to defend against forever, so
 * an inverted pair collapses to a zero-length one and is LOGGED — the measurement is wrong
 * either way, and zero is the wrong answer that cannot be rendered as nonsense.
 *
 * It does NOT throw. This sits on the success path of a CHARGED tool: a throw would send
 * withCredits down its release path and hand the user a failure for a pull that completed, so a
 * clock correction would eat delivered work.
 */
export function orderedFinishIso(startedAt: Date, finishedAt: Date): string {
  if (finishedAt.getTime() >= startedAt.getTime()) return finishedAt.toISOString();
  console.error(
    `recordSucceededPull: finish stamp ${finishedAt.toISOString()} precedes start stamp ` +
      `${startedAt.toISOString()} (the wall clock moved backwards mid-run); recording a ` +
      "zero-length run rather than a negative one",
  );
  return startedAt.toISOString();
}

/**
 * Record a completed pull_gsc_data run as a SUCCEEDED jobs row carrying the PullData in
 * `result`. pull_gsc_data is a SYNC (surface-charged) tool, so this row is purely a data
 * carrier: the credit reserve/commit lives on the ledger (keyed to a traceability uuid),
 * and reserve_id is deliberately LEFT NULL here — there is no worker reserve on this path.
 *
 * ALL THREE LIFECYCLE STAMPS COME FROM THE CALLER'S ONE CLOCK. This row is written AFTER the
 * run it describes, which is exactly what made its stamps incoherent: `created_at` defaulted to
 * `now()` at INSERT time — later than the work it supposedly created — and `started_at` was
 * never written at all, because the hand-written Insert type forbade it. `get_job_status` then
 * printed `created …15:42:59.928 · finished …15:42:46.054` to a customer: a job that finished
 * 13.9 seconds before it was created. So `created_at` is stamped with the run's START rather
 * than the insert's instant, and `started_at` with the same value — for a synchronous tool the
 * row IS the run, and there is no queue wait to separate the two.
 *
 * The ASYNC lane keeps the opposite (correct) arrangement and is untouched: enqueueJob lets
 * `created_at` default and leaves `started_at` NULL because the work genuinely has not begun,
 * and markJobRunning stamps `started_at` at the claim. There the gap between the two is real
 * queue wait, and collapsing it would destroy information.
 *
 * ONE STATEMENT, and that is the point. This used to insert a `queued` row and then update it
 * to `succeeded`, because the hand-written jobs.Insert type in db.ts listed no `result` column
 * — a TypeScript restriction that read like a schema fact. The SQL has allowed both columns on
 * insert since migration 0009 added them nullable.
 *
 * The two-step version had a window with nothing behind it. Every OTHER `queued` row in this
 * table is queued because a pg-boss message exists to pick it up; this path enqueues nothing,
 * so a crash, a dropped connection or a PostgREST error between the insert and the update left
 * a row that is `queued` forever — no worker will ever claim it, no reaper looks for it, and
 * `get_job_status` reports it as pending work to a user whose pull actually finished. The row
 * is written in its terminal state instead, so the intermediate state never exists.
 *
 * The contract is otherwise unchanged: same returned `{ jobId }`, same stored row shape.
 */
export async function recordSucceededPull(
  client: ServiceClient,
  params: SucceededPullRun,
): Promise<{ jobId: string }> {
  const startedIso = params.startedAt.toISOString();
  const { data, error } = await client
    .from("jobs")
    .insert({
      user_id: params.userId,
      project_id: params.projectId,
      tool: "pull_gsc_data",
      status: "succeeded",
      created_at: startedIso,
      started_at: startedIso,
      finished_at: orderedFinishIso(params.startedAt, params.finishedAt),
      result: params.result,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`recordSucceededPull: jobs insert failed: ${error?.message ?? "no row"}`);
  }
  return { jobId: data.id };
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

/**
 * Atomically CLAIM a queued job: flip queued -> running and stamp started_at, but ONLY while
 * the row is still `queued`. Returns true iff THIS call won the claim (a row came back);
 * false means another consumer already claimed it (or it is no longer queued) and the caller
 * MUST skip — re-running would open a second credit reserve (B-I1). This compare-and-set is
 * the single atomic gate; it replaces the old unconditional UPDATE paired with a separate
 * read-then-check in executeJob, which had a TOCTOU window between the status read and the
 * write that two concurrent deliveries could both slip through.
 */
export async function markJobRunning(jobId: string): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("id");
  if (error) {
    throw new Error(`markJobRunning failed: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
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
