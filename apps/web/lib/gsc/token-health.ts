/**
 * How long ago a Google account's credential was last OBSERVED to work.
 *
 * `gsc_accounts.token_checked_at` is stamped on every refresh, successful or fatally failed
 * (migration 0021), so it answers "when did we last actually find out?" — which is the only
 * honest thing a connected-accounts list can say about a credential nobody has exercised today.
 *
 * COMPUTED ON THE SERVER, never inside the client island that renders it. The panel is a
 * `"use client"` component, so it renders once during the RSC pass and again during hydration;
 * a `new Date()` read on both sides straddling midnight would produce two different strings for
 * one row and a hydration mismatch. Passing the finished label down removes the clock from the
 * client entirely — the same reason `lib/format` refuses `toLocale*`.
 *
 * Whole days, floored, in the same shape the MCP side's `renderPullProvenance` uses, so "3 days
 * ago" means the same thing on both surfaces. A FUTURE timestamp (clock skew between the web
 * dyno and Postgres) floors to a negative number and reads "today" rather than "-1 days ago".
 */
export function lastVerifiedLabel(
  tokenCheckedAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!tokenCheckedAt) {
    return null;
  }
  const checked = Date.parse(tokenCheckedAt);
  if (Number.isNaN(checked)) {
    // An unparseable timestamp is not a date to render — saying nothing beats inventing an age.
    return null;
  }
  const days = Math.floor((now.getTime() - checked) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
