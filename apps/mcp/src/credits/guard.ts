import { randomUUID } from "node:crypto";
import { TOOL_COSTS, type ToolName } from "./costs.ts";
import {
  PaidBalanceRequiredError,
  hasPaidBalance,
  paidBalanceRequiredMessage,
  requiresPaidBalance,
} from "./paid-balance.ts";
import { getServiceClient } from "../db.ts";
import { optionalWebBaseUrl } from "../env.ts";
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
 *   commit fails      -> retry a few times (most settlement failures are a blip); if the RPC
 *                        still will not confirm, READ THE LEDGER once to see what actually
 *                        happened. A commit that landed and merely lost its reply is a
 *                        SUCCESS. Otherwise throw a TYPED ReserveCommitFailedError carrying
 *                        the reserve's real disposition, WITHOUT releasing here: an open
 *                        reserve is refunded by the ledger-keyed sweep in reaper.ts — see the
 *                        money-direction note below.
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
 * What the ledger says happened to a reserve the commit RPC would not confirm.
 *   committed — the commit DID land (its reply was lost); this is a SUCCESS, not a failure.
 *   refunded  — something released it (the reaper reaping this run); the money is already back.
 *   open      — no settling row: the reconciliation sweep will refund it.
 *   unknown   — the classifying read itself failed; promise the user NOTHING.
 */
export type ReserveDisposition = "committed" | "refunded" | "open" | "unknown";

/**
 * The tool ran, but its reserve could not be settled: a DISTINGUISHABLE signal so callers
 * stop having to pattern-match a raw PostgREST string. `disposition` says what the ledger
 * actually shows, so the worker's fail-mark can promise a refund ONLY when one is really
 * coming — never as a blanket claim.
 */
export class ReserveCommitFailedError extends Error {
  readonly reserveId: string;
  readonly disposition: Exclude<ReserveDisposition, "committed">;

  constructor(
    reserveId: string,
    detail: string,
    disposition: Exclude<ReserveDisposition, "committed">,
  ) {
    super(`commit_reserve failed: ${detail}`);
    this.name = "ReserveCommitFailedError";
    this.reserveId = reserveId;
    this.disposition = disposition;
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

/**
 * Ask the LEDGER what became of a reserve the commit RPC would not confirm. Classification
 * ONLY — a `select`, no RPC, no write: the money authority stays the advisory-locked 0005
 * functions (constitution NEVER #2). The sibling reader in reaper.ts (settlementKind) does the
 * same job for the reaper's fail-marks.
 *
 * This exists because "reserve already settled" is ONE string covering opposite realities: a
 * commit that landed and lost its reply, and a reserve someone else released. Only the ledger
 * tells them apart.
 */
async function readDisposition(reserveId: string): Promise<ReserveDisposition> {
  const { data, error } = await getServiceClient()
    .from("credit_ledger")
    .select("kind")
    .eq("reserve_id", reserveId)
    .in("kind", ["spend_commit", "spend_release"]);
  if (error) {
    console.error(`reserve disposition read failed for ${reserveId}: ${error.message}`);
    return "unknown";
  }
  const kinds = new Set((data ?? []).map((row) => row.kind));
  if (kinds.has("spend_commit")) return "committed";
  if (kinds.has("spend_release")) return "refunded";
  return "open";
}

/**
 * Settle the spend. An unconfirmed RPC is NOT the same as a failed one: a commit can land in
 * the database and lose its reply, after which the retry meets the terminal "already settled".
 * Treating that as a failure told the user their charge had not settled and that reconciliation
 * would refund it — while the ledger held a spend_commit, so the sweep (correctly) skipped it
 * and the promised refund never came. So when the RPC does not confirm, the ledger is read
 * ONCE and gets the final word.
 */
async function commit(reserveId: string): Promise<void> {
  const message = await settle("commit_reserve", reserveId);
  if (message === null) return;

  const disposition = await readDisposition(reserveId);
  // The charge really did settle — a lost response, not a lost charge. Return normally so the
  // caller receives its result and the user is charged exactly once, which is the truth.
  if (disposition === "committed") return;
  throw new ReserveCommitFailedError(reserveId, message, disposition);
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
  // Paid-balance gate — FIRST, ahead of the cost lookup and the reserve alike. It answers a
  // different question from price ("may this account spend real VENDOR money?"), which is why
  // it sits above the 0-credit short-circuit rather than inside the priced branch: a gated tool
  // must never be reachable on trial credits by being cheap. Refusing HERE is what makes the
  // refusal free — nothing is reserved, so nothing needs refunding, and `fn` (the vendor call)
  // never runs. It throws rather than returns because withCredits is generic in T and cannot
  // build a ToolResult; the registry recognises the typed error and prints the sentence.
  if (requiresPaidBalance(meta.tool) && !(await hasPaidBalance(ctx.userId))) {
    throw new PaidBalanceRequiredError(
      meta.tool,
      paidBalanceRequiredMessage(meta.tool, optionalWebBaseUrl()),
    );
  }

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
