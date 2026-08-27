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

/**
 * Only `hasPaidBalance` is faked, through importOriginal: `paidBalanceRequiredMessage` and
 * `PAID_BALANCE_TOOLS` stay REAL, because the specs below cross-check the answer against the
 * enforcing module's own words and a faked refusal would let both drift together.
 *
 * The default is an account that has NOT paid — the branch every spec written before 2026-08-26
 * was measuring — so none of them changes meaning here.
 */
const paid = vi.fn(async () => false);
vi.mock("../credits/paid-balance.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credits/paid-balance.ts")>()),
  hasPaidBalance: async () => paid(),
}));

import type { AuthContext } from "../auth.ts";
import { PAID_BALANCE_TOOLS, paidBalanceRequiredMessage } from "../credits/paid-balance.ts";
import { CARD_URI } from "../ui/card.ts";
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


/**
 * G10 — measured 2026-08-26: 327 of the answer's 356 characters were a rule that did not apply
 * to the reader. The operator's account holds two `purchase` rows, so the paragraph warning that
 * trial credits will not unlock the vendor tools was, for them, about somebody else.
 *
 * The fix is NOT to delete the rule. It is to answer the question the rule raises — does it
 * apply to ME — which the old answer deliberately refused to do on a cost argument. That cost was
 * measured: the check is one `limit(1)` existence probe, 0.082 ms on a paid account and 0.287 ms
 * on the worst case (a full scan for an account with no purchase row at all).
 */
describe("the answer says whether the paid-balance gate applies to THIS account", () => {
  it("tells a paid account the vendor tools are unlocked, and still names the rule", async () => {
    paid.mockResolvedValueOnce(true);
    balance.mockResolvedValueOnce(4519);
    const text = await answer();
    expect(text).toMatch(/balance:\s*4519\s+credits/i);
    // The rule is still named — a customer must be able to learn it from this answer…
    expect(text).toMatch(PAID_BALANCE_REQUIRED);
    expect(text).toMatch(TRIAL_IS_NOT_ENOUGH);
    // …but it is now stated as SETTLED for them, not as a warning hanging over them.
    expect(text).toMatch(/unlocked|available to you/i);
    expect(text).not.toMatch(/buying any credit pack unlocks them/i);
  });

  it("still tells an unpaid account how to unlock them", async () => {
    paid.mockResolvedValueOnce(false);
    const text = await answer();
    expect(text).toMatch(/buying any credit pack unlocks them/i);
    expect(text).not.toMatch(/unlocked for you|available to you/i);
  });

  /**
   * The two branches must not both be renderable at once: an answer carrying the "you are
   * unlocked" sentence AND the "buy a pack to unlock" sentence would be telling the reader both
   * that the gate is settled and that it is not.
   */
  it("never renders both branches in one answer", async () => {
    for (const isPaid of [true, false]) {
      paid.mockResolvedValueOnce(isPaid);
      const text = await answer();
      const settled = /are unlocked|available to you/i.test(text);
      const pitch = /buying any credit pack unlocks them/i.test(text);
      expect(settled).not.toBe(pitch);
    }
  });

  /**
   * The paid answer is the one that used to be mostly irrelevant, so it must actually be
   * shorter than the answer it replaced — 356 characters, measured on the live tool.
   */
  it("is shorter for the account the old paragraph was not about", async () => {
    // The 356 was measured with THIS balance printed. Leaving the balance to the 200-credit
    // default made the comparison pass on two fewer digits rather than on fewer words — a green
    // for the wrong reason, caught before it was believed.
    paid.mockResolvedValueOnce(true);
    balance.mockResolvedValueOnce(4519);
    expect((await answer()).length).toBeLessThan(356);
  });
});

/**
 * THE MCP APPS PROBE MAY NOT CHANGE THE ANSWER (2026-08-27, SEP-1865).
 *
 * The view is an ADDITIONAL channel. `content` stays the whole answer — it is what the model
 * reads, what every client without the extension shows, and what this project's smoke tour has
 * been measuring tool by tool; a view that quietly became the real answer would invalidate that
 * record without failing anything.
 *
 * The second pin is the one that earns its place: the view may never know something the sentence
 * does not. Both facts are asserted AGAINST THE TEXT rather than against the fake, so a
 * structuredContent that drifted from the prose — the two surfaces telling different stories
 * about one account — fails here rather than in front of a customer.
 */
describe("the MCP Apps view rides along without changing the answer", () => {
  it("declares the view and keeps content the whole answer", async () => {
    expect(getCreditBalanceTool.uiResourceUri).toBe(CARD_URI);
    balance.mockResolvedValueOnce(4519);
    const result = await getCreditBalanceTool.run(CTX, {});
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toMatch(PAID_BALANCE_REQUIRED);
    expect(result.content[0]?.text).toMatch(/balance:\s*4519\s+credits/i);
  });

  /**
   * THE DATA CHANNEL MAY NOT SHOW LESS THAN THE WHOLE ANSWER.
   *
   * Measured live 2026-08-27, minutes after the probe deployed: a client that receives both
   * channels rendered ONLY `structuredContent`, so the model saw `{"balance":…,"paid":…}` and
   * lost the sentence — with it, the clause that says trial credits do not unlock the vendor
   * tools. The extension promises `content` is what the model reads; that promise belongs to the
   * host, and this one did not keep it.
   *
   * So the pin is not "summary exists" but "summary IS the text": a field that merely looked
   * like a summary would satisfy the first and still lose the gate clause. Asserted against the
   * content block itself, never against a literal.
   */
  it("carries the whole sentence in the data channel too", async () => {
    paid.mockResolvedValueOnce(false);
    const result = await getCreditBalanceTool.run(CTX, {});
    expect(result.structuredContent?.summary).toBe(result.content[0]?.text);
    // The clause a host that shows only data would otherwise drop.
    expect(String(result.structuredContent?.summary)).toMatch(TRIAL_IS_NOT_ENOUGH);
  });

  it("states nothing in the data channel that the sentence does not state", async () => {
    balance.mockResolvedValueOnce(4519);
    paid.mockResolvedValueOnce(true);
    const result = await getCreditBalanceTool.run(CTX, {});
    const text = result.content[0]?.text ?? "";
    // The number: read back OUT of the sentence, so a fake balance cannot satisfy both sides.
    const quoted = Number(/balance:\s*(\d+)/i.exec(text)?.[1]);
    expect(result.structuredContent?.balance).toBe(quoted);
    // The gate: `paid` true must coincide with the sentence that says this account is unlocked.
    expect(result.structuredContent?.paid).toBe(true);
    expect(text).toMatch(/\bunlocked\b/i);
  });

  it("says the account is NOT unlocked in both channels at once", async () => {
    paid.mockResolvedValueOnce(false);
    const result = await getCreditBalanceTool.run(CTX, {});
    expect(result.structuredContent?.paid).toBe(false);
    expect(result.content[0]?.text ?? "").not.toMatch(/\bunlocked\b/i);
  });
});
