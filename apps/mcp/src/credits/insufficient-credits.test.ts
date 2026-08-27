import { describe, expect, it } from "vitest";
import {
  InsufficientCreditsError,
  insufficientCreditsMessage,
  isInsufficientBalanceRaise,
  isInsufficientCredits,
} from "./insufficient-credits.ts";
import { markFailure } from "../queue/failure-text.ts";

/**
 * F-5 — running out of credits is the CUSTOMER's news, not an internal fault.
 *
 * Found by the DB lane on 2026-08-27: an existing spec pinned `/insufficient balance/` in
 * `jobs.error` and went red when the async path learned to redact. The redaction did not create
 * the defect — the SYNC path had it all along, answering a customer with 5 credits and a 20-credit
 * tool with "Tool failed unexpectedly … quote reference". A person out of credits was being told
 * to file a bug.
 */
describe("recognising the ledger's raise", () => {
  it.each([
    // migration 0005 / 0033 — the reserve path
    "insufficient balance: cannot reserve 20 (available 5)",
    // migration 0019 — the adjustment guard, reworded
    "insufficient balance: adjust -30 would drive the balance below zero (current balance 10)",
    // Wrapped by a driver that adds its own prefix, and in another case
    'reserve_credits failed: INSUFFICIENT BALANCE: cannot reserve 20 (available 0)',
  ])("matches %j", (raise) => {
    expect(isInsufficientBalanceRaise(raise)).toBe(true);
  });

  it.each([
    "connection reset by peer",
    'relation "credit_ledger" does not exist',
    "reserve_credits did not return a reserve_id",
  ])("does not match %j", (other) => {
    expect(isInsufficientBalanceRaise(other)).toBe(false);
  });
});

describe("the sentence a customer gets", () => {
  it("names what it costs and what they have", () => {
    const text = insufficientCreditsMessage("insufficient balance: cannot reserve 20 (available 5)");

    expect(text).toMatch(/do not have enough credits/i);
    expect(text).toContain("20 credit(s)");
    expect(text).toContain("balance is 5");
    expect(text).toMatch(/top up/i);
  });

  it("says the attempt cost nothing — the reserve never opened", () => {
    const text = insufficientCreditsMessage("insufficient balance: cannot reserve 20 (available 5)");
    expect(text).toMatch(/nothing was charged/i);
  });

  it("drops the figures rather than inventing them when the raise carries none", () => {
    const text = insufficientCreditsMessage("insufficient balance: adjust -30 would drive it below");

    expect(text).toMatch(/do not have enough credits/i);
    // No fabricated numbers — the true half survives alone.
    expect(text).not.toMatch(/\d+ credit\(s\)/);
    expect(text).not.toMatch(/balance is \d/);
  });

  it("carries no RPC name, no function name, no table", () => {
    const text = insufficientCreditsMessage("insufficient balance: cannot reserve 20 (available 5)");

    expect(text).not.toMatch(/reserve_credits|credit_ledger|rpc/i);
  });
});

describe("a failed JOB tells the customer, rather than redacting it", () => {
  it("keeps the sentence verbatim and logs nothing — nothing is withheld", () => {
    const error = new InsufficientCreditsError(
      insufficientCreditsMessage("insufficient balance: cannot reserve 20 (available 5)"),
    );
    const mark = markFailure(error, "3f9c1a20");

    expect(mark.stored).toBe(error.message);
    expect(mark.stored).not.toMatch(/problem on our side/i);
    expect(mark.logged).toBeNull();
  });

  it("is recognised across a duplicated module instance (name fallback)", () => {
    const foreign = new Error("You do not have enough credits to run this tool.");
    foreign.name = "InsufficientCreditsError";

    expect(isInsufficientCredits(foreign)).toBe(true);
    expect(markFailure(foreign, "3f9c1a20").stored).toBe(foreign.message);
  });
});
