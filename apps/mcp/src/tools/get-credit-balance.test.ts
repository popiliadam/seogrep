import { describe, expect, it, vi } from "vitest";

/**
 * The DB is faked down to ONE number. It supplies the balance and nothing else — every sentence
 * under test is written by the tool, so the fake cannot hand this spec the thing it is checking.
 */
const balance = vi.fn(async () => 200);
vi.mock("../db.ts", () => ({
  creditBalance: async () => balance(),
  getServiceClient: () => ({}),
}));

import type { AuthContext } from "../auth.ts";
import { PAID_BALANCE_TOOLS, paidBalanceRequiredMessage } from "../credits/paid-balance.ts";
import { getCreditBalanceTool } from "./get-credit-balance.ts";

/**
 * What get_credit_balance TELLS the customer about when their credits will and will not work.
 *
 * Measured 2026-08-25 (tool review card 3): the answer named the wrong condition. It said a
 * balance of 0 blocks paid tools — true — and stopped there, so a trial account reading 200
 * credits concluded the paid tools would run. They do not: credits/paid-balance.ts refuses the
 * whole vendor-cost surface unless the ledger holds a `purchase` or a positive `adjust`, and a
 * trial `grant` is precisely what it does not count.
 *
 * EVERY assertion here is a REGEX ON MEANING and several are cross-checked against the ENFORCING
 * code's own refusal, so the pin cannot be satisfied by a sentence that merely copies a literal
 * from the source (signed lesson 11).
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

/** "trial credits alone do not unlock these" — the rule paid-balance.ts actually enforces. */
const TRIAL_IS_NOT_ENOUGH = /\btrial\b[^.]*\bcredits?\b/i;
/** "what is needed is a PAID balance." */
const PAID_BALANCE_REQUIRED = /\bpaid\b[^.]{0,40}\bbalance\b/i;

async function answer(): Promise<string> {
  const result = await getCreditBalanceTool.run(CTX, {});
  expect(result.isError).toBeUndefined();
  return result.content[0]?.text ?? "";
}

describe("get_credit_balance names the condition the code really enforces", () => {
  it("still reports the balance itself", async () => {
    balance.mockResolvedValueOnce(200);
    expect(await answer()).toMatch(/balance:\s*200\s+credits/i);
  });

  it("says a PAID balance is required, not merely a non-zero one", async () => {
    const text = await answer();
    expect(text).toMatch(PAID_BALANCE_REQUIRED);
    expect(text).toMatch(TRIAL_IS_NOT_ENOUGH);
  });

  it("makes the SAME claim the refusal makes — the two cannot drift apart", async () => {
    // The refusal is written by the module that enforces the gate. If the balance answer
    // stopped naming the trial rule, this pin goes red without either sentence being copied.
    const refusal = paidBalanceRequiredMessage("ranked_keywords", null);
    for (const pattern of [PAID_BALANCE_REQUIRED, TRIAL_IS_NOT_ENOUGH]) {
      expect(refusal).toMatch(pattern);
      expect(await answer()).toMatch(pattern);
    }
  });

  it("does not present a non-zero balance as sufficient on its own", async () => {
    balance.mockResolvedValueOnce(200);
    const text = await answer();
    // The old answer's whole money content was the zero rule. Whatever else it says, the
    // reply must not stop there: something after it has to qualify "you have credits".
    const zeroRuleEnd = /balance of 0 blocks (?:them|paid tools)[^.]*\./i.exec(text);
    expect(zeroRuleEnd).not.toBeNull();
    const rest = text.slice((zeroRuleEnd?.index ?? 0) + (zeroRuleEnd?.[0].length ?? 0));
    expect(rest).toMatch(TRIAL_IS_NOT_ENOUGH);
  });

  it("the gate it describes is real and non-empty", () => {
    // Guards the opposite failure: describing a restriction that does not exist.
    expect(PAID_BALANCE_TOOLS.size).toBeGreaterThan(0);
  });

  it("is free to read", () => {
    expect(getCreditBalanceTool.name).toBe("get_credit_balance");
  });
});
