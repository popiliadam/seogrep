import { randomBytes } from "node:crypto";

/**
 * What a redacted failure LOOKS LIKE — the correlation handle, and the sentence that stands in
 * for a message the customer must not be shown.
 *
 * WHY IT IS ITS OWN MODULE (2026-08-27). It used to be private to `tools/registry.ts`, which was
 * true while the SYNCHRONOUS path was the only one that redacted anything. It is not any more:
 * the async worker's fail-mark now makes the same promise to a customer reading get_job_status —
 * "the server logged the details under this reference" — and a promise made in two places with
 * two independently-generated handle formats is a promise support cannot keep. One generator, one
 * width, one spelling, so an operator greps the reference a customer quotes without first asking
 * which surface produced it.
 *
 * A LEAF ON PURPOSE — node:crypto and nothing else. The classification ("is this error's message
 * written for the customer?") needs the typed-refusal narrowers and lives in
 * `queue/failure-text.ts`; those narrowers reach `credits/guard.ts`, which imports `queue/boss.ts`,
 * so a `boss.ts` that wanted the SENTENCE would have had to import a module that imports it back.
 * Splitting the two keeps the enqueue path — the one that produced the measured leak — free of
 * that cycle. What is here is what every failing surface needs and nothing else.
 */

/**
 * Entropy in a failure REFERENCE. 4 bytes = 8 hex chars: short enough for a human to read
 * back out of a chat transcript, wide enough (4.3e9) that two failures a support thread is
 * comparing are not plausibly the same reference. It is a correlation handle, not a secret
 * and not a security control, so this is sized for legibility rather than unguessability.
 */
export const FAILURE_REFERENCE_BYTES = 4;

/** A fresh correlation handle linking one caller-visible failure to one server log line. */
export function newFailureReference(): string {
  return randomBytes(FAILURE_REFERENCE_BYTES).toString("hex");
}

/**
 * The sentence a customer gets for a failure nobody wrote for them.
 *
 * It says three things, and each is load-bearing. That the fault is OURS, so the reader stops
 * re-checking their own site and their own arguments — the leak this replaced (a `getaddrinfo
 * ENOTFOUND` on OUR queue host) would have had a customer hunting a DNS problem that was never
 * theirs. That the details are recorded, so "we cannot tell you" does not read as "nobody knows".
 * And the reference, so support can reach the verbatim text the customer never saw.
 *
 * It deliberately makes NO claim about credits. What a failed job did to a reserve depends on
 * where it failed — the worker settles its own, and `refundAssurance` in tools/registry.ts
 * documents why a blanket promise is one the code cannot keep for every shape. A wrong money
 * sentence is a worse failure than a missing one.
 */
export function platformFailureText(reference: string): string {
  return (
    "the job could not be completed — this was a problem on our side, not with your site or " +
    `your request. The server logged the details under reference ${reference}; quote it if you ` +
    "report this."
  );
}

/** An unknown throw as text. Mirrors registry.ts's `errorMessage` — same rule, same fallback. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
