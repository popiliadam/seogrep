/**
 * "You do not have enough credits" — a typed refusal, because it is the CUSTOMER's business.
 *
 * WHY IT IS TYPED AND NOT A STRING (found 2026-08-27 by the DB lane, smoke tour wave 4, F-5).
 * `reserve_credits` raises `insufficient balance: cannot reserve 20 (available 5)` (migration
 * 0033), guard.ts wrapped it in a plain `Error`, and NOTHING downstream recognised it — so on the
 * synchronous path it fell into tools/registry.ts's unexpected-failure branch and answered a
 * customer who had simply run out of credits with "Tool failed unexpectedly … quote reference
 * 3f9c1a20". A person out of credits was being told to file a bug.
 *
 * It surfaced when the async path grew the same redaction the sync path already had: an existing
 * DB spec pinned `/insufficient balance/` in `jobs.error` and went red. The redaction did not
 * create the defect — it made the sync path's version of it visible on a second surface.
 *
 * THE NUMBERS ARE KEPT. What it costs and what you have is the whole answer, and neither is an
 * internal detail: the price is public (tool docs) and the balance is the customer's own, already
 * readable through get_credit_balance. What is dropped is the RPC's phrasing and its function name.
 */
export class InsufficientCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Narrow an unknown error to this refusal. The `name` fallback keeps it true across a duplicated
 * module instance (test isolation, bundling), where `instanceof` alone silently answers false —
 * the same hazard `isPreconditionNotMet` guards against, and the reason it is shaped this way.
 */
export function isInsufficientCredits(error: unknown): error is InsufficientCreditsError {
  return (
    error instanceof InsufficientCreditsError ||
    (error instanceof Error && error.name === "InsufficientCreditsError")
  );
}

/**
 * Does this Postgres error text carry the ledger's insufficient-balance raise?
 *
 * Matched on the SHORTEST DISTINCTIVE FRAGMENT and case-insensitively (signed lesson 11), not on
 * a copy of the raise line: the message interpolates two numbers and has been reworded once
 * already across migrations 0005, 0019 and 0033. `insufficient balance` is the part all three
 * share.
 */
export function isInsufficientBalanceRaise(detail: string): boolean {
  return /insufficient balance/i.test(detail);
}

/**
 * The customer's sentence, with the two numbers when the raise carried them.
 *
 * The parse is best-effort BY DESIGN and its failure is harmless: without the figures the reader
 * still learns the true thing — they are out of credits and topping up fixes it — instead of a
 * reference number. Inventing figures when the parse fails would be the one wrong answer here,
 * so a miss simply drops them.
 */
export function insufficientCreditsMessage(detail: string): string {
  const figures = /cannot reserve\s+(\d+)\s*\(available\s+(\d+)\)/i.exec(detail);
  const cost = figures?.[1];
  const balance = figures?.[2];
  const numbers =
    cost !== undefined && balance !== undefined
      ? ` This one costs ${cost} credit(s) and your balance is ${balance}.`
      : "";
  return (
    `You do not have enough credits to run this tool.${numbers} ` +
    "Top up your balance and run it again — nothing was charged for this attempt. " +
    "get_credit_balance shows where you stand."
  );
}
