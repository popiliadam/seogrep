/**
 * THE FEE SENTENCE A FREE REFUSAL ENDS WITH — one wording, one append rule, one file.
 *
 * WHY THIS EXISTS (measured 2026-08-25, tool review card 12). `audit_schema` called on a project
 * with no crawl did not charge — the balance was 5630 before and 5630 after — and said nothing
 * about it. `keyword_positions` in the very same situation ends its refusal with "…and you were
 * not charged". Two refusals, both free, one of them silent: the reader of the silent one has no
 * way to tell a free refusal from a 5-credit one, so the safe assumption is the wrong one.
 *
 * The sentence used to be hand-written at each refusal site, which is why the coverage was
 * patchy: a hand-maintained list of places to repeat a sentence grows holes, and this repo has
 * already paid for that lesson twice (the `rsc-boundary` gate had SIX). So the wording lives
 * HERE and the append is applied at the ONE place each family of refusals is rendered — for the
 * typed pre-condition refusal that is the registry's catch, which every such throw passes
 * through no matter which tool raised it.
 *
 * It lives next to the credits code because what it asserts is a MONEY fact ("nothing left your
 * ledger"), and the only code allowed to assert that is the code that knows whether it is true.
 */

/** The sentence itself. English — the UI-copy language for this product. */
export const NOT_CHARGED_SENTENCE = "You were not charged.";

/**
 * Wordings already in use across the surface that mean "this cost you nothing". Matched with a
 * REGEX ON MEANING rather than against a copy of any source string: several refusals say it in
 * their own words ("charges nothing", "No credits were charged", "you were not charged any
 * credits"), and a literal comparison would append a second, redundant sentence to every one of
 * them. It is deliberately loose for the same reason — this predicate only ever decides whether
 * to ADD a sentence, so a false positive costs a missing reassurance and never a false claim.
 */
const STATES_NO_CHARGE =
  /\b(?:not|never)\s+charged\b|\bcharge[sd]?\s+nothing\b|\bnothing\s+(?:was|has\s+been)\s+charged\b|\bno\s+credits\s+(?:were|have\s+been)\s+charged\b|\bnot\s+be\s+charged\b/i;

/** True when `message` already tells the reader, in some wording, that nothing was charged. */
export function statesNoCharge(message: string): boolean {
  return STATES_NO_CHARGE.test(message);
}

/**
 * Append the fee sentence to a refusal that does not already carry one.
 *
 * `note` is what THIS request can honestly promise — pass null when it can promise nothing, and
 * the message is returned untouched. That is not caution for its own sake: the registry's
 * `refundAssurance` already carves out the states where "you were not charged" would be a claim
 * about a charge nobody has decided yet (an async worker owns the reserve, or a commit whose
 * disposition the ledger itself could not report), and this helper must not talk over it.
 */
export function withNoChargeNote(
  message: string,
  note: string | null = NOT_CHARGED_SENTENCE,
): string {
  if (note === null || statesNoCharge(message)) return message;
  // THE SEPARATOR IS DECIDED BY WHAT CAME BEFORE IT. A one-line refusal is prose, and a sentence
  // follows a sentence after a space. A MULTI-LINE refusal is not prose — zod's input errors end
  // with an indented field path — and a space there produced `→ at project_id You were not
  // charged.`, in which the fee sentence reads as part of the path (measured live on three of six
  // audit_tech refusals, 2026-09-02). One rule, in the one place the append happens.
  return message.includes("\n") ? `${message}\n\n${note}` : `${message} ${note}`;
}
