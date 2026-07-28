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
 *   commit fails      -> retry a few times (most settlement failures are a blip), then throw
 *                        a TYPED ReserveCommitFailedError WITHOUT releasing here. The reserve
 *                        is left OPEN on purpose and the ledger-keyed orphan sweep in
 *                        reaper.ts REFUNDS it — see the money-direction note below.
 *   release fails     -> retry the same way, then log loudly and still rethrow fn's ORIGINAL
 *                        error; the open reserve is left for that same sweep.
 *
 * MONEY DIRECTION on a failed commit — RELEASE, decided 2026-07-28. This comment used to say
 * the debit should stand because "the work was delivered". That was wrong on its own terms:
 * withCredits THROWS on a commit failure, so `result` never reaches the caller and the user
 * receives NOTHING. Vendor work having happened is not delivery. The refund is not issued here
 * (this path cannot tell a commit failure from any other ledger failure without guessing);
 * it is issued by ONE idempotent sweep in reaper.ts, arbitrated by release_reserve's own
 * advisory-locked settled-guard, which makes a genuinely committed reserve impossible to
 * refund twice. The typed error below exists so the worker can say so honestly to the user
 * instead of pasting a raw PostgREST string.
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

/**
 * The tool ran, but its reserve could not be settled: a DISTINGUISHABLE signal so callers
 * stop having to pattern-match a raw PostgREST string. The worker turns this into an honest
 * fail-mark, and it names the reserve the reconciliation sweep will refund.
 */
export class ReserveCommitFailedError extends Error {
  readonly reserveId: string;

  constructor(reserveId: string, detail: string) {
    super(`commit_reserve failed: ${detail}`);
    this.name = "ReserveCommitFailedError";
    this.reserveId = reserveId;
  }
}

/**
 * Narrow an unknown error to a commit failure. The `name` fallback keeps this true across a
 * duplicated module instance (test isolation, bundling), where `instanceof` alone silently
 * answers false and would send the caller down the plain-failure branch.
 */
export function isReserveCommitFailed(error: unknown): error is ReserveCommitFailedError {
  return (
    error instanceof ReserveCommitFailedError ||
    (error instanceof Error && error.name === "ReserveCommitFailedError")
  );
}

/** Settlement attempts (commit or release) before the reserve is handed to reconciliation. */
const SETTLE_ATTEMPTS = 3;
/** Base backoff between attempts; short — a settlement must not hold the run open for long. */
const SETTLE_BACKOFF_MS = 150;

/** Errors migration 0005 raises deterministically: retrying can only burn time. */
function isTerminalSettlementError(message: string): boolean {
  return message.includes("already settled") || message.includes("unknown reserve");
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call a settlement RPC with a bounded retry, returning the last error message or null on
 * success. Most settlement failures are transient (a dropped connection, a PostgREST blip),
 * and every one that heals here is an open reserve the reconciliation sweep never has to see.
 * The RPCs' own behaviour is untouched: a retry is just a second call, and 0005's advisory
 * lock plus its settled-guard make a duplicate settlement impossible by construction.
 */
async function settle(
  rpc: "commit_reserve" | "release_reserve",
  reserveId: string,
): Promise<string | null> {
  let lastMessage = "settlement did not run";
  for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt += 1) {
    const client = getServiceClient();
    const { error } =
      rpc === "commit_reserve"
        ? await client.rpc("commit_reserve", { p_reserve_id: reserveId })
        : await client.rpc("release_reserve", { p_reserve_id: reserveId });
    if (!error) return null;
    lastMessage = error.message;
    if (isTerminalSettlementError(lastMessage)) break;
    if (attempt < SETTLE_ATTEMPTS) await sleep(SETTLE_BACKOFF_MS * attempt);
  }
  return lastMessage;
}

async function commit(reserveId: string): Promise<void> {
  const message = await settle("commit_reserve", reserveId);
  if (message !== null) {
    throw new ReserveCommitFailedError(reserveId, message);
  }
}

/** Release an open reserve; on failure log and swallow so the caller's error wins. */
async function releaseSafely(reserveId: string): Promise<void> {
  const message = await settle("release_reserve", reserveId);
  if (message !== null) {
    console.error(
      `release_reserve failed for reserve ${reserveId} (open reserve left for reconciliation): ${message}`,
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
