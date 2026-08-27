import { isReserveCommitFailed, type ReserveCommitFailedError } from "../credits/guard.ts";
import { isFreeVendorSpendLimit } from "../credits/free-vendor-calls.ts";
import { isPaidBalanceRequired } from "../credits/paid-balance.ts";
import { isDfsBudgetExhausted } from "../dfs/budget-error.ts";
import { isGscReauthRequired } from "../gsc-data/reauth-error.ts";
import { isPreconditionNotMet } from "../tools/precondition.ts";
import { errorText, platformFailureText } from "../failure-redaction.ts";

/**
 * What a FAILED background job is allowed to say to the customer who reads it.
 *
 * WHY THIS EXISTS — THE ASYMMETRY IT CLOSES (measured 2026-08-27, smoke tour wave 4, F-1).
 * `tools/registry.ts` already states and enforces this policy on the SYNCHRONOUS path, in its
 * own words: "Anything that escapes a handler is an UNEXPECTED failure, and those come from the
 * layers that describe our internals: Postgres names the relation, an RPC names the function, a
 * provider names its endpoint. Handing that to whoever holds an API key maps the schema for
 * them." It redacts, logs the verbatim message under a reference, and hands the caller the
 * reference.
 *
 * That same comment then carves out "a worker's fail-mark" as something it does not touch —
 * which was true, and left the ASYNC path with no policy at all. `jobs.error` took whatever
 * `error.message` happened to be and `get_job_status` printed it verbatim. Two live rows in
 * production say exactly what that costs:
 *
 *     Job 24c43b20-… (crawl_site) failed: enqueue failed: password authentication failed for user "postgres".
 *     Job d0dea4d5-… (crawl_site) failed: enqueue failed: getaddrinfo ENOTFOUND base.
 *
 * A paying customer was handed our database role name and an internal hostname, in answer to
 * "why did my 20-credit crawl fail?" — and told nothing they could act on. Both halves are the
 * defect: the leak, and the fact that the sentence is useless to its reader.
 *
 * THE RULE, AND WHICH WAY IT FAILS. A message reaches the customer verbatim only when its thrower
 * MARKED it as written for them. Everything else is redacted. The default is deliberate: an
 * unmarked message is one nobody promised was customer-safe, and treating "unmarked" as "safe"
 * is the single mistake that puts the next Postgres error in front of the next customer. The
 * cost of getting it wrong in THIS direction is a customer who sees a reference instead of a
 * sentence someone forgot to mark — a support question, not a disclosure.
 *
 * This is the same shape as `ProjectSignals.domainUnreachable` in the guide ladder: `undefined`
 * means "nobody checked", never "fine".
 */

/**
 * Does this error carry a message its thrower WROTE FOR THE CUSTOMER?
 *
 * The list is the registry's own, one for one — the typed refusals it already returns verbatim on
 * the synchronous path. Keeping the two in step is the point: the same failure must not be a
 * readable sentence when a tool runs inline and a reference number when the identical work runs
 * through the queue. `isReserveCommitFailed` is here because its text is chosen per disposition
 * below, not because the underlying `error.message` is safe — that message is dropped.
 */
export function isCustomerFacingFailure(error: unknown): boolean {
  return (
    isPreconditionNotMet(error) ||
    isGscReauthRequired(error) ||
    isDfsBudgetExhausted(error) ||
    isPaidBalanceRequired(error) ||
    isFreeVendorSpendLimit(error)
  );
}

/**
 * Stamped when the tool ran but its charge could not settle (guard.ts's ReserveCommitFailedError).
 * This is NOT the same story as a handler failure: the run produced a result the user never
 * received. What happens to their credits NEXT depends on the reserve's actual disposition, so
 * each one gets its own sentence. A single blanket "reconciliation refunds it automatically"
 * was a promise the code could not keep for every shape — the reaper skips a settled reserve,
 * so a user told to expect a refund would have waited for one that never came.
 */
const COMMIT_FAILED_PREFIX = "the tool ran but its credit charge could not be settled";
export const COMMIT_FAILED_BY_DISPOSITION: Record<
  ReserveCommitFailedError["disposition"],
  string
> = {
  // Verified open in the ledger: the sweep WILL find and refund it. A promise we can keep.
  open: `${COMMIT_FAILED_PREFIX} — the reserve is still open and reconciliation refunds it automatically; re-run the tool`,
  // Already released: the money is back now. Nothing further is coming, so do not imply it is.
  refunded: `${COMMIT_FAILED_PREFIX} — the reserve had already been refunded, so you were not charged; re-run the tool`,
  // The classifying read failed too. Promise NOTHING; point at the one path that can resolve it.
  unknown: `${COMMIT_FAILED_PREFIX} and the reserve's final state could not be confirmed — contact support if your balance looks short`,
};

/** What gets written to `jobs.error`, and what (if anything) an operator must be able to grep. */
export interface FailureMark {
  /** The text stored in `jobs.error` — this is what get_job_status prints to the customer. */
  readonly stored: string;
  /**
   * The verbatim message to log, with `reference`, when it is NOT in `stored`. Null when the
   * stored text already carries everything (nothing is being withheld, so nothing is logged
   * twice).
   */
  readonly logged: { readonly reference: string; readonly detail: string } | null;
}

/**
 * Decide what a failed job says and what the operator log has to carry, given the raw error.
 *
 * PURE — the reference is passed in rather than generated here, so every branch of this decision
 * is assertable without stubbing a random source.
 *
 * The commit-failure branch keeps its per-disposition sentence and DROPS the raw `error.message`
 * it used to append in parentheses. That parenthetical was the same leak one field over: the
 * money sentence was written for the customer, the text stapled to it was not.
 */
export function markFailure(error: unknown, reference: string): FailureMark {
  if (isReserveCommitFailed(error)) {
    return {
      stored: COMMIT_FAILED_BY_DISPOSITION[error.disposition],
      logged: { reference, detail: errorText(error) },
    };
  }
  if (isCustomerFacingFailure(error)) {
    return { stored: errorText(error), logged: null };
  }
  return { stored: platformFailureText(reference), logged: { reference, detail: errorText(error) } };
}
