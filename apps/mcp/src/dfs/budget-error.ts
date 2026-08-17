/**
 * The DataForSEO daily budget cap, refusing a call — a DESIGNED refusal, not a fault.
 *
 * MEASURED SHAPE (the 2026-08-09 campaign's central lesson, still open on this axis). The cap is
 * enforced by reserve_dfs_spend (migration 0014), which raises a clear English sentence and makes
 * reserveSpend throw. Until this type existed that throw was a plain Error, so it landed in the
 * registry's catch beside the genuine crashes and the user was told:
 *
 *     Tool "ranked_keywords" failed unexpectedly. The server logged the details under
 *     reference 3f9c1a20 — quote it if you report this.
 *
 * Nothing had gone wrong. A guard the constitution requires (NEVER #5) had done exactly its job,
 * and the user was invited to file a bug about it — the same failure mode PreconditionNotMetError
 * and GscReauthRequiredError were written to abolish on their own axes.
 *
 * TYPED, not text-matched, for the reason both of those state: the registry's branch keys on the
 * TYPE, so a plain Error that happens to contain the words "budget exceeded" is still an
 * unexplained throw and still belongs in the generic branch. (budget.ts DOES text-match, but on
 * the OTHER side of the boundary: it is classifying a string raised by Postgres, which cannot
 * carry a JS type. That match happens once, here the result becomes a type, and nothing
 * downstream re-reads the words.)
 *
 * THROWN, not returned, because that is what makes it FREE: withCredits commits a handler that
 * RETURNS and releases only on a THROW (credits/guard.ts), and this error is raised from inside
 * the vendor port, i.e. inside the guarded region on all four DataForSEO tools.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY TO THE USER: the ledger's own sentence. That text names
 * our vendor spend in dollars ("today's spend ($2.9100) plus this call's estimate ($0.3000)
 * would pass the $3.00 cap"). Those are OUR costs, not the customer's, and printing them hands
 * every API-key holder our margin. The registry builds the user's sentence from the fact alone;
 * the full ledger text stays on `detail` for the operator log.
 */
export class DfsBudgetExhaustedError extends Error {
  constructor(
    /** The vendor endpoint the refused call was aimed at — operator context, never user copy. */
    readonly endpoint: string,
    /** The ledger's verbatim refusal, including its USD figures. Operator-facing only. */
    readonly detail: string,
  ) {
    super(`DataForSEO daily budget exhausted (${endpoint}): ${detail}`);
    this.name = "DfsBudgetExhaustedError";
  }
}

/**
 * Narrow an unknown error to the budget refusal.
 *
 * The `name` fallback is included for the same reason isPaidBalanceRequired and
 * isPreconditionNotMet carry one: across a duplicated module instance (test isolation, bundling)
 * `instanceof` alone silently answers false and drops the refusal back into the generic branch.
 * Unlike GscReauthRequiredError — which withholds the fallback because the registry READS its
 * fields and a name-only lookalike would render "undefined" into the sentence — the sentence
 * built for this one uses no field of the error, so a lookalike degrades to nothing.
 */
export function isDfsBudgetExhausted(error: unknown): error is DfsBudgetExhaustedError {
  return (
    error instanceof DfsBudgetExhaustedError ||
    (error instanceof Error && error.name === "DfsBudgetExhaustedError")
  );
}
