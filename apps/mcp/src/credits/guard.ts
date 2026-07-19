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
 */

export interface CreditContext {
  userId: string;
}

export interface CreditMeta {
  tool: ToolName;
  jobId: string;
}

async function reserve(ctx: CreditContext, meta: CreditMeta, amount: number): Promise<string> {
  const { data, error } = await getServiceClient().rpc("reserve_credits", {
    p_user_id: ctx.userId,
    p_amount: amount,
    p_tool: meta.tool,
    p_job_id: meta.jobId,
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

  const reserveId = await reserve(ctx, meta, cost);

  try {
    await setJobReserve(meta.jobId, reserveId);
  } catch (error) {
    await releaseSafely(reserveId);
    throw error;
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
