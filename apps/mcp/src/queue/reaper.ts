import type { ServiceClient } from "../db.ts";
import { getServiceClient } from "../db.ts";

/**
 * Stuck-job reaper + reconciliation (audit §7). A crashed or redeployed worker can
 * leave a jobs row `running` with an OPEN credit reserve: the user was debited, the
 * work never delivered, and the reserve never settles. This module refunds those open
 * reserves and marks the jobs `failed`, so the balance is made whole and the user can
 * re-run the tool.
 *
 * MONEY DIRECTION — conservative refund. The crashed run did NOT deliver, so its reserve
 * is RELEASED (refunded). There is no automatic replay: the tool payload traveled in the
 * pg-boss queue message, not on the jobs row, so it is gone — the user re-runs. A
 * double-charge is impossible: commit and release are mutually exclusive under the
 * per-user advisory lock in migration 0005, so a reserve the real worker committed
 * concurrently comes back "already settled" here and is skipped (no second settlement).
 *
 * This module NEVER writes the ledger directly: refunds go through the existing
 * release_reserve RPC (the only refund path, advisory-locked); everything else is table
 * reads and one status-guarded jobs UPDATE. guard.ts and the 0005 RPCs are untouched.
 */

/**
 * 15 minutes. MUST exceed the longest job runtime (the crawl time budget is 90s) so a
 * job that is genuinely still running is never reaped.
 */
const DEFAULT_OLDER_THAN_MS = 15 * 60_000;
/** Bounded batch: at most this many stuck jobs per run. */
const DEFAULT_LIMIT = 100;
/** Stamped on a reconciled job whose open reserve WAS released (refunded). */
const RECONCILE_ERROR_RELEASED = "reconciled: worker did not finish; reserve released, re-run the tool";
/**
 * Stamped on a reconciled job whose reserve was ALREADY SETTLED and could not be refunded
 * (released=0, alreadySettled>0): the worker crashed in the window between commit_reserve
 * and completeJob, so the charge stood and the work may be lost. Honest wording — this is
 * NOT a "reserve released, re-run" case; it needs a human, not an automatic refund.
 */
const RECONCILE_ERROR_SETTLED =
  "reconciled: worker did not finish but the charge had already settled; work may be incomplete — contact support for review";
/**
 * Stamped on a reconciled job that had NO open reserve at all (released=0, alreadySettled=0):
 * it crashed before any reserve opened, so nothing was released and nothing settled. Honest
 * wording — the "reserve released" clause would be untrue here. The user was never debited, so
 * re-running the tool is still the correct guidance.
 */
const RECONCILE_ERROR_NO_RESERVE =
  "reconciled: worker did not finish; no open reserve to release, re-run the tool";

export interface ReconcileOptions {
  /** Reap running jobs whose started_at is older than this (default 15 min). */
  olderThanMs?: number;
  /** Injectable clock — tests pin it. */
  now?: () => Date;
  /** Max jobs processed per run (default 100). */
  limit?: number;
}

export interface ReconcileOutcome {
  readonly scanned: number; // stuck candidates found
  readonly released: number; // reserves refunded
  readonly alreadySettled: number; // reserves settled concurrently (skipped, no double-refund)
  readonly failed: number; // jobs transitioned running -> failed
  readonly orphanReserves: number; // open reserves found via ledger.job_id when reserve_id was NULL
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every reserve id carrying a spend_reserve row for this job, found by ledger.job_id
 * (NOT jobs.reserve_id). Keying on job_id finds the reserve even in the
 * crash-before-setJobReserve window, when jobs.reserve_id is still NULL but the ledger
 * reserve is already open (the orphan case).
 *
 * Open-vs-settled is deliberately NOT decided here: an app-side "is it open?" read is a
 * TOCTOU race (the reserve can settle between the read and the release). The authoritative
 * open check is release_reserve's own advisory-locked settled-guard, so this only
 * ENUMERATES reserves and lets the RPC be the arbiter.
 */
async function findJobReserves(client: ServiceClient, jobId: string): Promise<string[]> {
  const { data, error } = await client
    .from("credit_ledger")
    .select("reserve_id")
    .eq("job_id", jobId)
    .eq("kind", "spend_reserve");
  if (error) {
    throw new Error(`findJobReserves(${jobId}) failed: ${error.message}`);
  }
  const ids = new Set<string>();
  for (const row of data ?? []) {
    if (row.reserve_id !== null) ids.add(row.reserve_id);
  }
  return [...ids];
}

/**
 * Running rows with a NULL started_at are not a normal state (markJobRunning always
 * stamps started_at). They cannot be aged, so they are never reaped — only surfaced here
 * for manual inspection.
 */
async function warnRunningWithoutStart(client: ServiceClient, limit: number): Promise<void> {
  const { data, error } = await client
    .from("jobs")
    .select("id")
    .eq("status", "running")
    .is("started_at", null)
    .limit(limit);
  if (error) {
    console.error(`reconcileStuckJobs: running-without-started_at probe failed: ${error.message}`);
    return;
  }
  if (data && data.length > 0) {
    const ids = data.map((row) => row.id).join(", ");
    console.warn(
      `reconcileStuckJobs: ${data.length} running job(s) with NULL started_at left for manual inspection: ${ids}`,
    );
  }
}

/**
 * Refund the open reserves of crashed jobs and mark those jobs failed. Each job is
 * handled independently (per-job catch): one bad job must never abort the batch.
 */
export async function reconcileStuckJobs(opts?: ReconcileOptions): Promise<ReconcileOutcome> {
  const client = getServiceClient();
  const olderThanMs = opts?.olderThanMs ?? DEFAULT_OLDER_THAN_MS;
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const now = opts?.now ?? (() => new Date());
  const nowDate = now();
  const cutoffIso = new Date(nowDate.getTime() - olderThanMs).toISOString();

  await warnRunningWithoutStart(client, limit);

  const { data, error } = await client
    .from("jobs")
    .select("id, reserve_id")
    .eq("status", "running")
    .not("started_at", "is", null)
    .lt("started_at", cutoffIso)
    .order("started_at", { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(`reconcileStuckJobs: candidate query failed: ${error.message}`);
  }
  const candidates = data ?? [];

  let released = 0;
  let alreadySettled = 0;
  let failed = 0;
  let orphanReserves = 0;

  for (const job of candidates) {
    try {
      const reserveWasNull = job.reserve_id === null;
      // Per-job tally (for the honest fail-mark string below); the global counters keep
      // their existing semantics untouched.
      let jobReleased = 0;
      let jobAlreadySettled = 0;

      // Release FIRST, then conditional-fail. Rationale: if we failed the job first and
      // the real worker then committed, we would have a job that is BOTH failed AND
      // charged. Releasing first means a worker's later commit hits "already settled" and
      // its own catch fails the job — a single, refunded, consistent outcome.
      for (const reserveId of await findJobReserves(client, job.id)) {
        const { error: releaseError } = await client.rpc("release_reserve", {
          p_reserve_id: reserveId,
        });
        if (!releaseError) {
          released++;
          jobReleased++;
          if (reserveWasNull) orphanReserves++; // an open reserve found only via job_id
          continue;
        }
        const message = releaseError.message ?? "";
        if (message.includes("already settled")) {
          // The real worker committed/released concurrently under the advisory lock — the
          // settlement stands; re-releasing would double-refund. Skip.
          alreadySettled++;
          jobAlreadySettled++;
        } else if (message.includes("unknown reserve")) {
          // No spend_reserve row for this id — a data anomaly, nothing to refund.
          console.warn(`reconcileStuckJobs: unknown reserve ${reserveId} on job ${job.id}; nothing to refund`);
        } else {
          // Unexpected (e.g. a DB outage). Skip THIS job WITHOUT failing it — never mark a
          // job failed on an unconfirmed release, and never cascade one job's DB error
          // across the batch. The open reserve is left for the next run.
          throw new Error(`release_reserve failed for ${reserveId}: ${message}`);
        }
      }

      // Honest fail-mark, three-way — the stamped wording must match what actually happened:
      //  - a refund happened (released>0)                  → RELEASED ("reserve released, re-run")
      //  - nothing released but a reserve had settled       → SETTLED  (charged; needs a human)
      //  - no reserve at all (crashed before any opened)    → NO_RESERVE (nothing to release, re-run)
      // The settled shape must NOT claim a refund; the no-reserve shape must NOT claim a
      // "reserve released" that never occurred. Money direction is untouched — this only
      // selects the fail-mark string.
      const reconcileError =
        jobReleased > 0
          ? RECONCILE_ERROR_RELEASED
          : jobAlreadySettled > 0
            ? RECONCILE_ERROR_SETTLED
            : RECONCILE_ERROR_NO_RESERVE;

      // Conditional fail: flip to failed ONLY while the row is still `running`. The status
      // guard prevents clobbering a job the real worker completed concurrently (that job
      // is already succeeded/failed, so this update matches 0 rows and is a no-op).
      const failUpdate = await client
        .from("jobs")
        .update({ status: "failed", finished_at: nowDate.toISOString(), error: reconcileError })
        .eq("id", job.id)
        .eq("status", "running")
        .select("id");
      if (failUpdate.error) {
        throw new Error(`reconcileStuckJobs: fail update on job ${job.id} failed: ${failUpdate.error.message}`);
      }
      if (failUpdate.data && failUpdate.data.length > 0) failed++;
    } catch (jobError) {
      // Per-job isolation: one bad job must never abort the batch.
      console.error(`reconcileStuckJobs: skipping job ${job.id}: ${errorDetail(jobError)}`);
    }
  }

  return { scanned: candidates.length, released, alreadySettled, failed, orphanReserves };
}
