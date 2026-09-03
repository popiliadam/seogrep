import { exactCount } from "./quantities.ts";

/**
 * =====================================================================================
 * THE OUTPUT CEILING — one ceiling, for every tool that renders a paid list
 * =====================================================================================
 * MEASURED 2026-08-25 on `backlink_details`: `limit 200, page_limit 9` returned 187 link rows and
 * produced a reply of 62,729 characters across 404 lines, which the calling client refused with
 * "exceeds maximum allowed tokens". The 35 credits and the vendor's $0.055 were BOTH taken and the
 * customer saw nothing at all — the worst shape this product can produce.
 *
 * `backlink_details` grew a ceiling that day. Its SIBLING at twice the price did not:
 * `analyze_backlinks` sells a 70-credit profile whose `limit` DEFAULTS to its own maximum of
 * 1,000, and the two lists it renders measure ~65 and ~44 characters a row — a full default call
 * computes to ~109,000 characters, 1.7x the reply that was already refused (finding AB-1,
 * 2026-09-04; a CALCULATION from measured row widths, not a live observation).
 *
 * So the mechanism moved here rather than being written a second time. Two tools printing "your
 * reply was cut" in two different sentences is how one of them ends up not saying that the
 * unprinted rows were paid for.
 *
 * WHAT IS **NOT** SOLVED HERE. Lowering a schema maximum would make the oversized call a free
 * validation error, but those maxima are derived from SIGNED prices (NEVER #6) and moving one is a
 * human's decision. Bounding the RENDERED TEXT keeps the window, keeps the price arithmetic
 * untouched, and keeps the fetched rows: the run report written to `domain_lookup_runs` still
 * records the whole window, so nothing measured is lost.
 *
 * THE NUMBERS stay with each caller. The refusal was measured in TOKENS, and how a tool splits
 * its ceiling across its own lists depends on what those lists are; this module holds only the
 * two operations both tools need to perform identically.
 */

/** What one budgeted render produced: the block, and the two row counts that describe it. */
export interface BudgetedRender {
  readonly block: string;
  readonly printed: number;
  readonly omitted: number;
}

/**
 * Render rows until the budget is spent. A row is taken ONLY if it fits whole — a half-printed
 * backlink row is a URL cut in the middle, which reads as a different URL.
 *
 * It stops at the FIRST row that does not fit rather than continuing to look for a smaller one:
 * these lists are ORDERED (strongest first), and skipping a wide row to print a narrow one further
 * down would silently reorder a list whose order is the product claim.
 */
export function renderWithinBudget<Row>(
  rows: readonly Row[],
  render: (row: Row) => string,
  budget: number,
): BudgetedRender {
  const taken: string[] = [];
  let used = 0;
  for (const row of rows) {
    const line = render(row);
    const cost = line.length + 1; // + the newline that joins it to the block
    if (used + cost > budget) break;
    taken.push(line);
    used += cost;
  }
  return { block: taken.join("\n"), printed: taken.length, omitted: rows.length - taken.length };
}

/**
 * What the reader is told when rows were fetched and not printed. It never says "of": both counts
 * describe the SAME window, and the rule both callers keep is that two DIFFERENT sets are never
 * joined — keeping the phrasing free of "N of M" also keeps it from being read as the vendor's
 * whole-set total. It states plainly that the missing rows were paid for, because they were.
 */
export function renderOutputLimitNote(
  noun: string,
  printed: number,
  omitted: number,
  advice: string,
): string {
  return (
    `Output limit reached — ${exactCount(printed)} ${printed === 1 ? noun : `${noun}s`} printed ` +
    `above, ${exactCount(omitted)} more fetched in this same window but not printed: one reply ` +
    `cannot hold them, and they were charged for either way. ${advice}`
  );
}
