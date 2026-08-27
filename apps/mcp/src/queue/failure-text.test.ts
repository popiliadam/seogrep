import { describe, expect, it } from "vitest";
import { ReserveCommitFailedError } from "../credits/guard.ts";
import { PreconditionNotMetError } from "../tools/precondition.ts";
import { COMMIT_FAILED_BY_DISPOSITION, isCustomerFacingFailure, markFailure } from "./failure-text.ts";
import { platformFailureText } from "../failure-redaction.ts";

/**
 * F-1 (smoke tour wave 4) — what a failed background job may say to the customer reading it.
 *
 * THE REGRESSION THESE PIN IS NOT HYPOTHETICAL. Two rows in production, measured 2026-08-27,
 * answered "why did my 20-credit crawl fail?" with our database role name and our internal
 * queue hostname. The two literals appear below as the thing that must NOT come back.
 */

const REF = "3f9c1a20";

describe("markFailure — an UNMARKED error never reaches the customer verbatim", () => {
  it("redacts the message and hands the verbatim text to the log under the same reference", () => {
    const mark = markFailure(new Error('password authentication failed for user "postgres"'), REF);

    expect(mark.stored).toBe(platformFailureText(REF));
    expect(mark.stored).toContain(REF);
    expect(mark.logged).toEqual({
      reference: REF,
      detail: 'password authentication failed for user "postgres"',
    });
  });

  it.each([
    ['password authentication failed for user "postgres"', "postgres"],
    ["getaddrinfo ENOTFOUND base", "ENOTFOUND"],
    ['relation "credit_ledger" does not exist', "credit_ledger"],
    ["connect ECONNREFUSED 10.0.0.4:5432", "10.0.0.4"],
  ])("keeps %j out of the stored text (needle: %s)", (raw, needle) => {
    const mark = markFailure(new Error(raw), REF);

    expect(mark.stored).not.toContain(needle);
    expect(mark.stored).not.toContain(raw);
    // The detail is not destroyed — an operator can still reach it by the reference.
    expect(mark.logged?.detail).toBe(raw);
  });

  it("redacts a non-Error throw too, rather than trusting String(x)", () => {
    const mark = markFailure({ toString: () => "pg: role \"postgres\" cannot login" }, REF);

    expect(mark.stored).toBe(platformFailureText(REF));
    expect(mark.stored).not.toContain("postgres");
  });

  it("says the fault is OURS, so the reader stops checking their own site", () => {
    const mark = markFailure(new Error("getaddrinfo ENOTFOUND base"), REF);

    expect(mark.stored).toMatch(/problem on our side/i);
    expect(mark.stored).toMatch(/not with your site/i);
  });
});

describe("markFailure — a MARKED error is the customer's to read", () => {
  it("returns a pre-condition refusal verbatim and logs nothing (nothing is withheld)", () => {
    const message =
      "No pages could be crawled for https://example.com (robots.txt blocked the crawler).";
    const mark = markFailure(new PreconditionNotMetError(message), REF);

    expect(mark.stored).toBe(message);
    expect(mark.logged).toBeNull();
  });

  it("recognises the marker across a duplicated module instance (name fallback)", () => {
    // The same hazard isPreconditionNotMet guards against: `instanceof` answers false when the
    // module is loaded twice (test isolation, bundling), and a refusal would silently redact.
    const foreign = new Error("Your project is archived.");
    foreign.name = "PreconditionNotMetError";

    expect(isCustomerFacingFailure(foreign)).toBe(true);
    expect(markFailure(foreign, REF).stored).toBe("Your project is archived.");
  });
});

describe("markFailure — a settled-charge failure keeps its money sentence, loses its tail", () => {
  it.each(["open", "refunded", "unknown"] as const)(
    "stores the %s disposition sentence and NOT the raw driver message",
    (disposition) => {
      const error = new ReserveCommitFailedError(
        "reserve-1",
        'update "credit_ledger" violates row-level security policy',
        disposition,
      );
      const mark = markFailure(error, REF);

      expect(mark.stored).toBe(COMMIT_FAILED_BY_DISPOSITION[disposition]);
      // The parenthetical `(${error.message})` this used to append was the same leak one field
      // over: the money sentence was written for the customer, the text stapled to it was not.
      expect(mark.stored).not.toContain("credit_ledger");
      expect(mark.stored).not.toContain("row-level security");
      expect(mark.logged?.detail).toContain("credit_ledger");
    },
  );

  it("still tells the three dispositions apart", () => {
    const sentences = (["open", "refunded", "unknown"] as const).map(
      (d) => markFailure(new ReserveCommitFailedError("reserve-1", "x", d), REF).stored,
    );
    expect(new Set(sentences).size).toBe(3);
  });
});
