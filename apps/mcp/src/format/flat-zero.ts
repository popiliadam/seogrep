/**
 * THE "FLAT ZERO" READING NOTE — one sentence, at the end of an answer whose numbers never moved.
 *
 * =====================================================================================
 * WHAT WAS MEASURED, AND WHAT WAS *NOT* WRONG
 * =====================================================================================
 * On the 2026-08-25 walkthrough, three live lookups came back with a difficulty column that was
 * the same digit all the way down:
 *
 *   discover_keywords (suggestions)   13 of 13 rows   keyword_difficulty 0
 *   ranked_keywords                   10 of 10 rows   difficulty 0/100
 *   ranked_keywords (second account)   6 of 6 rows    difficulty 0/100
 *
 * with search volumes between 2,400 and 14,800 a month. A 14,800-a-month query at difficulty 0 is
 * not a number a reader should act on.
 *
 * THE PARSING IS NOT THE DEFECT, and this module does not "fix" it. SeoGrep's rule — a field the
 * vendor did not report is printed in WORDS, never as 0 — holds, and it is pinned in eleven places
 * (`?? null` on the way in, `!== null` on the way out). A 0 reaches the customer only when
 * DataForSEO sent a 0.
 *
 * AND DATAFORSEO REALLY DOES SEND IT. Measured 2026-08-26 against the vendor's own dedicated
 * difficulty endpoint (`bulk_keyword_difficulty`): `dental implants` 44, `invisalign cost` 5,
 * `teeth whitening` 70 in en/US — and, in the SAME tr/TR market that returned the flat zeros,
 * `implant diş fiyatları` came back 12 while `diş teli`, `zirkonyum diş` and `diş beyazlatma` came
 * back 0. The field is present, it works in that market, and it varies. The zeros are the vendor's
 * ANSWER, not an absence.
 *
 * =====================================================================================
 * SO WHAT IS LEFT TO SAY — AND WHAT MAY NEVER BE SAID
 * =====================================================================================
 * What is left is a READING problem, not a data problem: a column that is 0 on every row ranks
 * nothing above anything, so there is no signal in it to act on — and "0" reads as "easy" to
 * every reader who has ever seen a difficulty score. The note below says exactly that much.
 *
 * WHAT IT MAY NOT SAY IS A CAUSE. An earlier draft of this feature proposed telling the customer
 * the field was "more likely absent from your DataForSEO plan than measured — treat it as
 * unavailable". The 2026-08-26 measurement above CHURNED that: the field is on the plan and does
 * work in that market. Publishing it would have been an unmeasured explanation presented to a
 * paying customer as fact (NEVER #7) — the very defect this round exists to remove. The note
 * therefore reports what was observed in THIS response and stops; {@link flatZeroNote}'s own test
 * pins the forbidden vocabulary so the sentence cannot drift back into an explanation.
 *
 * =====================================================================================
 * WHY THE TRIGGER IS A PATTERN AND NOT A FIELD
 * =====================================================================================
 * The condition is "this field never varied in this answer, and the value it never varied from is
 * 0" — not "this field is suspicious". A field-level warning would fire on a legitimate zero (a
 * genuinely uncontested long-tail keyword sitting beside a keyword at 44), which is the same class
 * of error read from the other end: telling the customer a real measurement is unreliable.
 *
 * Three bounds fall out of that, and each is a test:
 *
 *   1. NULLS ARE NOT ZEROS. Rows the vendor said nothing about are ALREADY printed as unreported,
 *      and they are not evidence of anything. The pattern is measured over the rows that actually
 *      printed a number, so a page of silence cannot manufacture a "flat" reading.
 *   2. ONE ROW IS NOT A PATTERN. "It never varied" is vacuous across a single value, so the note
 *      needs {@link MIN_FLAT_ZERO_ROWS} reported values before it will speak.
 *   3. ONE NON-ZERO ENDS IT. A single 12 beside a dozen 0s means the column IS separating
 *      keywords, and the reader can see that for themselves.
 *
 * The value is NEVER suppressed or rewritten. Every 0 still prints on its own row exactly as the
 * vendor sent it; this adds a reading note beside them and changes no number.
 *
 * Pure, dependency-free and deterministic, and it costs nothing: no vendor call, no credit, no
 * price. It lives beside `quantities.ts` for the reason that module states about itself — every
 * consumer is an MCP tool renderer, and putting a formatter behind `packages/core`'s built
 * `dist/` would hide a source change from the MCP test lane until a rebuild.
 */

import { exactCount } from "./quantities.ts";

/**
 * How many REPORTED values the pattern needs before it is a pattern. Two: with one value there is
 * nothing for it to have "not varied" from.
 */
export const MIN_FLAT_ZERO_ROWS = 2;

/** What the note is about, in the words the rows above it already used. */
export interface FlatZeroSubject {
  /**
   * The field name EXACTLY as the rows printed it — `keyword_difficulty` on discover_keywords,
   * `difficulty` on ranked_keywords. A note that names a field the reader cannot find above it is
   * a note about some other output.
   */
  readonly fieldLabel: string;
  /** What the rows are, PLURAL: "keywords". The note never fires on fewer than two. */
  readonly rowsNoun: string;
}

/**
 * The reading note for a column that came back flat at zero — or `null`, which is the answer
 * almost every time.
 *
 * `values` is one entry per row IN THE ORDER THEY WERE RENDERED, with `null` for the rows where
 * the vendor reported nothing. Pass the rows the reader can actually see; on a truncated reply the
 * full window is also safe, because a window that is uniformly zero has no subset that is not.
 */
export function flatZeroNote(
  values: readonly (number | null)[],
  subject: FlatZeroSubject,
): string | null {
  const reported = values.filter((value): value is number => value !== null);
  if (reported.length < MIN_FLAT_ZERO_ROWS) return null;
  if (!reported.every((value) => value === 0)) return null;
  return (
    `READ THESE ZEROS AS "NO SIGNAL", NOT AS "EASY". DataForSEO reported ${subject.fieldLabel} 0 ` +
    // The count is a thing that was COUNTED, so it is printed the one way this product prints a
    // count (quantities.ts, class 1) rather than as a bare integer that groups nothing at 1,000.
    `for every one of the ${exactCount(reported.length)} ${subject.rowsNoun} above that carried ` +
    `a value at all, so this column separates none of them from any other and there is nothing ` +
    `in it to act ` +
    `on. That 0 is a value the vendor SENT, not a field it left out: SeoGrep prints a reported 0 ` +
    `exactly as it arrived and never rewrites one as "not reported", and DataForSEO does report ` +
    `non-zero ${subject.fieldLabel} for other keywords, including in non-English markets. What ` +
    `made THIS set come back flat is not something SeoGrep measured, and it will not guess at it ` +
    `— check a few of these ${subject.rowsNoun} another way before treating any of them as easy.`
  );
}
