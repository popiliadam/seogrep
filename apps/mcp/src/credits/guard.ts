import { randomUUID } from "node:crypto";
import { TOOL_COSTS, type ToolName } from "./costs.ts";
import { getServiceClient } from "../db.ts";
import { setJobReserve } from "../queue/boss.ts";

/**
 * Credit guard around a tool run. All ledger writes go through the migration-0005
 * RPCs — reserve_credits already debits the balance under a per-user advisory
 * lock; commit_reserve finalizes with a zero-delta row; release_reserve refunds.
 * The guard's contract:
 *
 *   cost 0            -> run fn directly; the ledger (and env/DB) is never touched.
 *   reserve -> fn ok  -> commit_reserve; exactly one commit row settles the spend.
 *   reserve -> fn err -> release_reserve, then rethrow fn's error unchanged.
 *   commit fails      -> rethrow WITHOUT releasing: the work was delivered and the
 *                        reserve already carries the debit; refunding delivered
 *                        work would be the wrong money direction. The open reserve
 *                        stays visible (jobs.reserve_id) for reconciliation.
 *   release fails     -> log loudly, still rethrow fn's ORIGINAL error; the open
 *                        reserve stays visible for reconciliation.
 *
 * Two settlement shapes share this one guard, distinguished by whether meta.jobId is set:
 *
 *   ASYNC (worker) — meta.jobId is the REAL queued jobs.id. The reserve is recorded on
 *     that row via setJobReserve, and the write is ASSERTED (a 0-row update means the
 *     row vanished / the id is wrong -> throw + release, never a silent no-op).
 *   SYNC (surface) — meta.jobId is omitted. No jobs row exists, so setJobReserve is
 *     NEVER called; the ledger reserve still carries a fresh traceability uuid in its
 *     p_job_id (so every spend is traceable), but the jobs table is untouched. This is
 *     the reserve-trace fix: previously a synthetic uuid was written to setJobReserve
 *     and matched 0 rows, silently breaking the audit trail for sync priced tools.
 */

export interface CreditContext {
  userId: string;
}

export interface CreditMeta {
  tool: ToolName;
  /**
   * The real queued jobs.id for the ASYNC worker path. Omit on the SYNC surface path
   * (no jobs row): the reserve is then ledger-only, with a traceability uuid for
   * p_job_id, and no jobs row is written.
   */
  jobId?: string;
}

async function reserve(
  userId: string,
  tool: ToolName,
  jobId: string,
  amount: number,
): Promise<string> {
  const { data, error } = await getServiceClient().rpc("reserve_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_tool: tool,
    p_job_id: jobId,
  });
  if (error) {
    throw new Error(`reserve_credits failed: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error("reserve_credits did not return a reserve_id");
  }
  return data;
}

async function commit(reserveId: string): Promise<void> {
  const { error } = await getServiceClient().rpc("commit_reserve", { p_reserve_id: reserveId });
  if (error) {
    throw new Error(`commit_reserve failed: ${error.message}`);
  }
}

/** Release an open reserve; on failure log and swallow so the caller's error wins. */
async function releaseSafely(reserveId: string): Promise<void> {
  const { error } = await getServiceClient().rpc("release_reserve", { p_reserve_id: reserveId });
  if (error) {
    console.error(
      `release_reserve failed for reserve ${reserveId} (open reserve left for reconciliation): ${error.message}`,
    );
  }
}

/**
 * Run `fn` under a credit reserve for `meta.tool`. The cost comes from TOOL_COSTS
 * (the human-approved table) — never from the caller.
 */
export async function withCredits<T>(
  ctx: CreditContext,
  meta: CreditMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const cost = TOOL_COSTS[meta.tool];
  if (cost === 0) {
    return fn();
  }

  // p_job_id on the ledger: the real jobs row (async) or a fresh traceability uuid
  // (sync surface). Either way every spend_reserve row carries a job_id.
  const ledgerJobId = meta.jobId ?? randomUUID();
  const reserveId = await reserve(ctx.userId, meta.tool, ledgerJobId, cost);

  // Record the reserve on the jobs row ONLY on the async path. setJobReserve asserts it
  // touched a row, so a broken reserve trace (0 rows) throws here instead of silently
  // no-opping; the sync surface path has no jobs row and skips this entirely.
  if (meta.jobId !== undefined) {
    try {
      await setJobReserve(meta.jobId, reserveId);
    } catch (error) {
      await releaseSafely(reserveId);
      throw error;
    }
  }

  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await releaseSafely(reserveId);
    throw error;
  }

  await commit(reserveId);
  return result;
}
