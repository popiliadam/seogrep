import type { LedgerEntry } from "@pseo/db/ledger-read";

/**
 * The ONE place that answers "which ledger rows are spend, and how much" for the dashboard.
 *
 * Framework-free and side-effect-free, like ../format: the Overview sparkline and the Usage
 * chart both derive their numbers from here instead of each carrying a private copy of the
 * rule. They used to carry two copies, and both copies were WRONG in the same way — see the
 * shape note below.
 *
 * ## The ledger's spend shape (migrations 0002 / 0005 / 0011)
 *
 * A spend is a reserve -> settle pair, never a single row:
 *
 *   - `spend_reserve`  delta < 0   the ONLY row that moves the balance for a spend
 *                                  (`credit_ledger_spend_reserve_neg_delta`)
 *   - `spend_commit`   delta = 0   a zero-delta settlement MARKER; the balance already moved
 *                                  (`credit_ledger_spend_commit_zero_delta` — a DB CHECK, so
 *                                  `spend_commit AND delta < 0` selects the EMPTY SET on every
 *                                  row that has ever existed)
 *   - `spend_release`  delta > 0   a full refund of the reserve (`release_reserve` reads the
 *                                  reserve's own delta back), so a released reserve nets to 0
 *
 * Both surfaces filtered on `kind === "spend_commit" && delta < 0`, which the CHECK constraint
 * makes unsatisfiable: production had 229 `spend_commit` rows summing to exactly 0 delta and
 * the chart had never drawn a single bar. The rule below is derived from the migrations, not
 * from the old code.
 *
 * ## Model: NET, attributed to each row's OWN day
 *
 * Spend = `Σ(-spend_reserve.delta) - Σ(spend_release.delta)`, i.e. every spend_* row that moves
 * the balance, signed the way a spender reads it. Both terms collapse to the same expression:
 * `-delta` (reserve deltas are negative, release deltas positive).
 *
 * This is deliberately the MIRROR of the balance the sparkline sits next to — the balance is
 * `SUM(delta)` over the same rows — so "credits spent" can never disagree with "credits gone".
 * Two consequences, both intended:
 *
 *   - an OPEN reserve (no commit, no release yet) counts as spent, because the credits HAVE
 *     left the balance; if it is later released, the refund shows up then;
 *   - a refund is attributed to the day the RELEASE row was written, not back-dated to its
 *     reserve, so a day can net negative when yesterday's job refunds today. Bar charts cannot
 *     draw below their baseline, so the chart floors the BAR at zero while the tooltip and the
 *     total keep the true signed figure.
 *
 * The alternative — counting only reserves whose `reserve_id` appears in a `spend_commit` — was
 * rejected: `LedgerEntry` does not carry `reserve_id`, and pairing rows would break at the edge
 * of the fetched window anyway (a reserve inside it, its commit outside, or vice versa), which
 * would make the figure depend on the page size rather than on the ledger.
 *
 * `adjust` is excluded on purpose even when negative: it is the manual-correction escape hatch
 * (0011), not tool spend, and the chart is titled CREDITS SPENT.
 */

/** One balance-moving spend row: `amount` is positive for a debit, negative for a refund. */
export interface SpendEvent {
  /** `created_at` as epoch milliseconds. */
  readonly at: number;
  /** Signed credits: `-delta`, so a reserve is positive and a release negative. */
  readonly amount: number;
}

const BALANCE_MOVING_SPEND_KINDS: ReadonlySet<string> = new Set(["spend_reserve", "spend_release"]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The balance-moving spend rows, oldest first, optionally limited to `since` (epoch ms,
 * inclusive). Rows with an unparseable timestamp or a zero amount are dropped — they can move
 * neither a bar nor the total. Never mutates `entries`.
 */
export function spendEvents(
  entries: readonly LedgerEntry[],
  options: { readonly since?: number | undefined } = {},
): readonly SpendEvent[] {
  const since = options.since;
  return entries
    .filter((entry) => BALANCE_MOVING_SPEND_KINDS.has(entry.kind) && entry.delta !== 0)
    .map((entry) => ({ at: Date.parse(entry.createdAt), amount: -entry.delta }))
    .filter((event) => Number.isFinite(event.at) && (since === undefined || event.at >= since))
    .sort((a, b) => a.at - b.at);
}

/** Midnight UTC of the day `at` falls in, as epoch ms. */
export function utcDayStart(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The trailing `count` UTC day starts ending with (and including) the day `now` falls in,
 * oldest first — the chart's x axis.
 */
export function trailingUtcDays(count: number, now: number): readonly number[] {
  const today = utcDayStart(now);
  return Array.from({ length: count }, (_, index) => today - (count - 1 - index) * DAY_MS);
}

/**
 * Net spend per day for exactly the given days, in the same order. Events outside the day list
 * are ignored (they belong to no bar); a day with a net refund keeps its NEGATIVE value here —
 * flooring is the renderer's job, not the arithmetic's.
 */
export function spendByDay(
  events: readonly SpendEvent[],
  days: readonly number[],
): readonly number[] {
  const totals = new Map<number, number>(days.map((day) => [day, 0]));
  for (const event of events) {
    const day = utcDayStart(event.at);
    const current = totals.get(day);
    if (current === undefined) continue;
    totals.set(day, current + event.amount);
  }
  return days.map((day) => totals.get(day) ?? 0);
}

/** A cumulative point of the sparkline: net spend up to and including `at`. */
export interface CumulativeSpendPoint {
  readonly at: number;
  readonly running: number;
}

/** Running net spend over `events` (assumed oldest first), one point per event. */
export function cumulativeSpend(events: readonly SpendEvent[]): readonly CumulativeSpendPoint[] {
  let running = 0;
  return events.map((event) => {
    running += event.amount;
    return { at: event.at, running };
  });
}
