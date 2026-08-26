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
 * =====================================================================================
 * WHICH COLUMNS THIS COVERS — AND THE TWO THE DECISION FILE CLAIMED IT COVERED AND DOES NOT
 * =====================================================================================
 * Every column bound to this note is declared in the two surfaces, in the order the rows print
 * them, and a NUMERIC column that a surface prints is bound unless there is a measured reason not
 * to be. An arbitrary gap here is the same defect as the one this note exists to remove: a warning
 * that fires on one flat-zero column and stays silent on the one beside it teaches the reader that
 * silence means "measured", which is exactly what it does not mean.
 *
 * The S23 decision file's §4.3 said of three other zeros — `rank 0`, `is_lost: 0`,
 * `trend monthly 0%` — that "4.1's signal covers them too, and nothing more is needed". A render
 * probe on 2026-08-26 showed that was true of NONE of them at the time, and it is only PARTLY
 * true now. NARROWED BY MEASUREMENT:
 *
 *   - `trend monthly 0%` — WAS uncovered, now IS. All three trend legs are bound on
 *     discover_keywords, and a flat 0% leg gets its own note.
 *   - `rank 0` — CANNOT be covered, and not for want of a binding. `rank_group` and
 *     `rank_absolute` are 1-based SERP positions: the first organic result is #1, so a row at
 *     position 0 is not a rank the vendor's scale can express. There is no flat zero to detect,
 *     and a binding would be dead code pretending to guard something.
 *   - `is_lost: 0` — CANNOT be covered either, and this one is STRUCTURAL. `is_lost` is a
 *     DOMAIN-level figure on ranked_keywords' health card: ONE number for the whole answer, not a
 *     column with a value per row. "This never varied across the rows" is not a statement that can
 *     be made about a single value at all — see {@link MIN_FLAT_ZERO_ROWS}, which refuses a
 *     pattern claim over fewer than two. The same applies to every other card metric.
 *
 * So §4.3's claim is narrowed to what was measured: the pattern covers a flat zero in a PER-ROW
 * NUMERIC column, and covers nothing else. Nobody is guarding `rank` or `is_lost`.
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
  /**
   * THE WRONG READING THIS PARTICULAR COLUMN INVITES, as a clause completing "it does NOT mean".
   *
   * Required, not optional, and this is the whole reason the note is parameterised at all. The
   * first version of this file was written for `keyword_difficulty` alone and ended "before
   * treating any of them as easy" — a sentence that is simply FALSE under a flat `search_volume`,
   * where the misreading is "nobody searches for any of these". A generic caveat printed under a
   * column it does not describe is the same defect as a generic zero: text that looks like it is
   * about this measurement and is not.
   */
  readonly misreadAs: string;
  /**
   * Whether THIS REPO HOLDS a captured non-English vendor response carrying this field non-zero.
   *
   * The note's one factual claim about DataForSEO — that it does return non-zero values for the
   * field elsewhere, including outside English-language markets — is what stops a reader
   * concluding the field is simply broken in their market. It is also a claim, so it is made only
   * where a captured response backs it, and the tests read that response rather than trusting this
   * flag. `est. traffic` is the column where it is FALSE: `etv` appears in no non-English capture
   * this repo holds, so the note about it says less rather than claiming more.
   */
  readonly nonEnglishEvidence: boolean;
}

/**
 * The reading note for one column that came back flat at zero — or `null`, which is the answer
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
  // Emitted only where a captured non-English response backs it; see `nonEnglishEvidence`.
  const vendorVaries = subject.nonEnglishEvidence
    ? `, and DataForSEO does report non-zero ${subject.fieldLabel} for other keywords, including ` +
      "in non-English markets"
    : "";
  return (
    `READ THIS FLAT COLUMN AS "NO SIGNAL". DataForSEO reported ${subject.fieldLabel} 0 ` +
    // The count is a thing that was COUNTED, so it is printed the one way this product prints a
    // count (quantities.ts, class 1) rather than as a bare integer that groups nothing at 1,000.
    `for every one of the ${exactCount(reported.length)} ${subject.rowsNoun} above that carried ` +
    `a value at all, so this column separates none of them from any other and there is nothing ` +
    `in it to choose by — it does NOT mean ${subject.misreadAs}. That 0 is a value the vendor ` +
    `SENT, not a field it left out: SeoGrep prints a reported 0 exactly as it arrived and never ` +
    `rewrites one as "not reported"${vendorVaries}. What made THIS set come back flat is not ` +
    `something SeoGrep measured, and it will not guess at it — check a few of these ` +
    `${subject.rowsNoun} another way before acting on ${subject.fieldLabel}.`
  );
}

/**
 * ONE COLUMN of a row, as this note sees it: what it is called and how to read its value off a row.
 */
export interface FlatZeroColumn<Row> extends Omit<FlatZeroSubject, "rowsNoun"> {
  readonly valueOf: (row: Row) => number | null;
}

/**
 * Every flat-zero note this answer has earned, IN THE ORDER THE COLUMNS ARE PRINTED.
 *
 * ORDER IS THE POINT of this function existing rather than each surface looping for itself. When
 * two or three columns come back flat at once the reader gets two or three notes, and the only
 * order that does not read as arbitrary is the order the columns appear on the rows above. The
 * caller therefore declares its columns ONCE, in print order, and both the reserve pass and the
 * printing pass walk that same list — so the room booked for these notes and the notes actually
 * printed can never be computed from two different orders or two different sets.
 */
export function flatZeroNotes<Row>(
  rows: readonly Row[],
  columns: readonly FlatZeroColumn<Row>[],
  rowsNoun: string,
): string[] {
  const notes: string[] = [];
  for (const column of columns) {
    const note = flatZeroNote(rows.map(column.valueOf), { ...column, rowsNoun });
    if (note !== null) notes.push(note);
  }
  return notes;
}
