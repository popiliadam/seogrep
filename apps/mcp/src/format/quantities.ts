/**
 * SHARED NUMBER AND UNIT FORMATTING — one product, one way to print a quantity.
 *
 * =====================================================================================
 * WHY THIS MODULE EXISTS
 * =====================================================================================
 * The same measurement was reaching the customer in three different shapes. `keyword_gap` printed
 * "an estimated 21 visits/mo"; `ranked_keywords` printed "est. traffic 117/mo" off a vendor `etv`
 * of 116.64; `my_pages` printed "etv 86.03599891066551". The first two are the same claim said two
 * ways. The third is a DIFFERENT claim, and a false one.
 *
 * =====================================================================================
 * ROUNDING IS A CLAIM, NOT A COSMETIC
 * =====================================================================================
 * `86.03599891066551` asserts that a model knows a page's monthly traffic to fifteen significant
 * figures. It does not. But rounding asserts something too — that the digits which survive are
 * digits somebody measured — so each quantity below states the precision it claims and WHY that
 * precision is the honest one for it. A number is only ever moved from one of these classes to
 * another deliberately.
 *
 * The four classes, and their rules:
 *
 *   1. EXACT COUNTS — {@link exactCount}. Things the vendor COUNTED: backlinks, referring domains,
 *      SERPs containing a page, position-bucket occupancies, rows in a window, a rank on a fixed
 *      scale. Every digit is real, so no digit is dropped; the only transformation is grouping
 *      them so a seven-digit count is readable. A fractional value arriving here would mean the
 *      field is not the count it is documented to be, and it is rounded to a whole unit rather
 *      than printed as a fraction of a countable thing.
 *
 *   2. ESTIMATED MONTHLY VISITS — {@link estimatedVisitsPerMonth}. DataForSEO's `etv` is a MODEL
 *      OUTPUT and arrives as a raw float. Two reasons the honest unit is one whole visit: a visit
 *      is an event and half of one never happened, and the model's own resolution is nowhere near
 *      a thousandth of a visit. This matches what `ranked_keywords` already prints — `etv 116.64`
 *      renders "117/mo" there and here — which is the reference this module was written against.
 *
 *   3. ESTIMATED MONTHLY MONEY — {@link estimatedMonthlyCostUsd}. Same model, same objection to
 *      trailing digits, so cents are deliberately NOT kept: `estimated_paid_traffic_cost` is a
 *      modelled monthly total, and "$5,120.75" reads as an invoice. THE CONTRAST IS THE POINT — a
 *      QUOTED price (a keyword's CPC, which `ranked_keywords` prints to two decimals) keeps its
 *      cents, because cents are the unit that price is actually quoted in and rounding it would
 *      destroy precision the vendor really has. Rounding a model's monthly total removes precision
 *      nobody had; keeping cents on it would invent precision nobody had. Different quantities,
 *      different rules, both stated.
 *
 *   4. BUCKET DATE LABELS — {@link bucketDateLabel}. Not a rounding rule but the same principle
 *      applied to a series label: drop a component that is provably carrying no information, and
 *      nothing else. See that function's own note for the narrow condition it will act on.
 *
 * Pure, dependency-free and deterministic — no `Intl`, no ICU, no locale data, so the same input
 * prints the same string on every machine that runs the server.
 *
 * WHERE THIS LIVES, AND WHY NOT `packages/core`: every consumer is an MCP tool renderer, and core
 * is the home of things a second app would otherwise re-implement. Putting it in core would also
 * put it behind core's built `dist/`, where a source change is invisible to the MCP test lane
 * until a rebuild — a real cost paid for no current reader. Move it there when a second package
 * needs to print the same quantities.
 */

/**
 * The ONE rounding primitive, so every "whole unit" in this module means the same operation:
 * `Math.round`, which sends exact halves toward +Infinity. The vendor sends no negative estimate
 * and no negative count, so the asymmetry at -0.5 is unreachable rather than tolerated.
 */
function toWholeUnit(value: number): number {
  return Math.round(value);
}

/**
 * Group an ALREADY-WHOLE number's digits in threes. Deliberately not exported: grouping is a
 * display step that says nothing about precision, and every caller must go through one of the
 * quantity functions below so that the precision claim is made explicitly.
 */
function groupDigits(whole: number): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * CLASS 1 — a quantity the vendor COUNTED. Loses nothing; grouping only. See the header.
 */
export function exactCount(value: number): string {
  return groupDigits(toWholeUnit(value));
}

/**
 * WHY THE TRAILING DIGITS ARE GONE, in the product's own words — ONE clause, for every surface
 * that prints a class-2 or class-3 estimate.
 *
 * Rounding is a claim (see the header), so a surface that rounds owes the reader the reason. It
 * was being made in exactly one place: `my_pages` said it, and `ranked_keywords` rounded the SAME
 * vendor field the same way and said nothing (finding B-5, 2026-09-03). Two admissions written
 * twice is how they drift into saying different things about one number, so the load-bearing half
 * lives here and both surfaces compose their sentence around it.
 */
export const MODEL_PRECISION_CLAUSE =
  "they come out of a model, and the further decimal places that model emits are not precision " +
  "it has";

/**
 * CLASS 2 — a MODELLED monthly visit estimate, to the nearest whole visit, carrying its unit.
 * Returns e.g. "117/mo" so the number can never be read as a per-day or lifetime figure.
 */
export function estimatedVisitsPerMonth(value: number): string {
  return `${groupDigits(toWholeUnit(value))}/mo`;
}

/**
 * CLASS 3 — a MODELLED monthly USD total, to the nearest whole dollar, carrying its unit.
 * Returns e.g. "$5,121/mo". Cents are dropped on purpose; see the header's contrast with a
 * quoted CPC, which keeps them.
 */
export function estimatedMonthlyCostUsd(value: number): string {
  return `$${groupDigits(toWholeUnit(value))}/mo`;
}

/**
 * A vendor timestamp whose UTC time component is PROVABLY ZERO, reduced to its calendar date.
 *
 * DataForSEO labels each bucket of its backlink time series with a stored timestamp —
 * "2021-12-31 00:00:00 +00:00" — and the time half of that label is not a measurement. It is the
 * same eleven characters on every row of every series, and printing it 26 times in one answer
 * buries the dates a reader came for under noise that never varies.
 *
 * THE CONDITION IS NARROW ON PURPOSE. Only a midnight-UTC time is dropped, and only when the
 * offset is itself zero or absent: "2021-12-31 00:00:00 +03:00" is NOT midnight UTC, and a
 * timestamp carrying a real time of day is carrying information nobody here measured away. Any
 * string this rule does not match is returned VERBATIM, including one that is not a timestamp at
 * all — the vendor's own label is always a safer answer than a label we invented for it.
 *
 * It also does not restate the date as the bucket it belongs to ("December 2021"): the vendor
 * stored a date, and re-labelling it as a period would publish a reading of that date rather than
 * the date itself.
 */
export function bucketDateLabel(vendorDate: string): string {
  const midnightUtc = /^(\d{4}-\d{2}-\d{2})[ T]00:00:00(?:\.0+)?(?: ?(?:\+00:00|\+0000|Z))?$/;
  return midnightUtc.exec(vendorDate)?.[1] ?? vendorDate;
}
