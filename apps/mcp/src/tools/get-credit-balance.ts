import { z } from "zod";
import { creditBalance, getServiceClient } from "../db.ts";
import { hasPaidBalance } from "../credits/paid-balance.ts";
import { CARD_URI } from "../ui/card.ts";
import { defineTool, textResultWithCard } from "./registry.ts";

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
 * IT NOW SAYS WHETHER THIS ACCOUNT HAS PAID, and the argument it used to make against that was
 * measured on 2026-08-26 rather than repeated. The claim was "that would be a second ledger read
 * on a free tool". The read is `hasPaidBalance`, one `limit(1)` existence probe: EXPLAIN ANALYZE
 * on the live ledger put it at 0.082 ms for an account that has paid and 0.287 ms for the worst
 * case — an account with no purchase row at all, where the probe scans the table. It runs in
 * parallel with the balance read, so it costs no round trip either. Against that, 327 of the
 * answer's 356 characters were a warning about somebody else's account.
 *
 * BOTH BRANCHES STILL NAME THE RULE. The point was never to hide the gate from a paid customer —
 * it is that a rule stated as a settled fact ("you are unlocked") and a rule stated as a pending
 * threat read differently to the person who has to act on it, and only one of them is true here.
 */
export const getCreditBalanceTool = defineTool({
  name: "get_credit_balance",
  description: "Show your available credit balance (the running total of your credit ledger).",
  inputSchema: z.object({}),
  /**
   * THE MCP APPS RENDERING PROBE (2026-08-27) — see ui/card.ts for what it is measuring and
   * why this tool is the one carrying it: 0 credits, no parameters, and an answer whose two facts
   * (a number and a gate) are enough to tell a rendered view from a blank one. The sentence
   * below is unchanged and stays the whole answer; a host that ignores `_meta` sees exactly what
   * it saw yesterday.
   */
  ui: { resourceUri: CARD_URI },
  handler: async (ctx) => {
    const [balance, paid] = await Promise.all([
      creditBalance(getServiceClient(), ctx.userId),
      hasPaidBalance(ctx.userId),
    ]);
    const unit = balance === 1 ? "credit" : "credits";
    const gate = paid
      ? "Your account has a paid balance, so the tools that read live data from a paid " +
        "third-party SEO provider are unlocked — trial credits alone would not have been enough."
      : "Having credits is not always enough: the tools that read live data from a paid " +
        "third-party SEO provider need a PAID balance and are not available on trial credits, " +
        "however many trial credits are left. Buying any credit pack unlocks them.";
    const sentence =
      `Credit balance: ${balance} ${unit}. Paid tools debit credits when they run, and a ` +
      `balance of 0 blocks them until you top up. ${gate}`;
    return textResultWithCard(sentence, {
      kind: "metric",
      title: "Credit balance",
      value: String(balance),
      unit,
      // The badge states the gate the sentence states. "Paid" only when the ledger says so; a
      // trial account must not read as unlocked on the card while the sentence says it is not.
      badge: paid ? "Paid" : "Trial",
      facts: [
        {
          label: "Vendor tools",
          value: paid ? "Unlocked" : "Locked — needs a paid balance",
        },
      ],
    });
  },
});
