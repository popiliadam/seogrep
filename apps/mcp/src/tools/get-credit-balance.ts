import { z } from "zod";
import { creditBalance, getServiceClient } from "../db.ts";
import { defineTool, textResult } from "./registry.ts";

/**
 * get_credit_balance — the tenant's available credits. 0 credits (reading your balance
 * is free). Balance is the tenant-scoped Σ of the credit ledger (constitution NEVER #2:
 * it derives only from the ledger, never a stored counter); the read is scoped in db.ts.
 *
 * THE SECOND SENTENCE STATES A GATE THIS TOOL DOES NOT OWN, so it is written from the code that
 * DOES. Until 2026-08-25 it said "a balance of 0 blocks paid tools until you top up" — true, and
 * not the rule that actually bites: credits/paid-balance.ts refuses the whole vendor-cost surface
 * on an account that has never PAID, whatever its balance is. A trial account reading 200 credits
 * concluded "mine is not zero, so it works", and it did not. The condition below mirrors
 * hasPaidBalance() (a `purchase` or a positive `adjust` row in the ledger — a machine-issued
 * `grant`, i.e. the trial, is exactly what it does not count) and the refusal the user gets from
 * paidBalanceRequiredMessage(), which is the same rule worded for the same reader.
 *
 * It does NOT say whether THIS account has paid. That would be a second ledger read on a free
 * tool, and the sentence's job is to make the rule knowable before it fires, not to pre-answer it.
 */
export const getCreditBalanceTool = defineTool({
  name: "get_credit_balance",
  description: "Show your available credit balance (the running total of your credit ledger).",
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const balance = await creditBalance(getServiceClient(), ctx.userId);
    const unit = balance === 1 ? "credit" : "credits";
    return textResult(
      `Credit balance: ${balance} ${unit}. Paid tools debit credits when they run, and a ` +
        "balance of 0 blocks them until you top up. Having credits is not always enough: the " +
        "tools that read live data from a paid third-party SEO provider need a PAID balance and " +
        "are not available on trial credits, however many trial credits are left. Buying any " +
        "credit pack unlocks them.",
    );
  },
});
