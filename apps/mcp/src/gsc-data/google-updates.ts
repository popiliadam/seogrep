/**
 * GOOGLE'S PUBLISHED RANKING-UPDATE CALENDAR, as DATA.
 *
 * WHY IT EXISTS (analyze_content_decay B-1, measured live 2026-09-03). A decay analysis compared
 * `2026-06-03..2026-08-31` against `2026-03-05..2026-06-02`, returned ten pages, and told the
 * customer to change every one of them. Both the March 2026 core update (27 Mar) and the May 2026
 * one (21 May) landed inside that BASELINE window. The numbers were right and the attribution was
 * not: a site-wide movement caused by an algorithm update is not ten content problems, and
 * rewriting ten pages is expensive work aimed at the wrong thing. The concept was already in the
 * product one file away — `load.ts` explains a stale pull with "seasonality, a redesign, an
 * algorithm update" — it had simply never been applied to the comparison itself.
 *
 * IT IS A DATED LIST, NOT A RULE, and that distinction is the whole design. Google adds to it, so
 * every entry carries its date and the file carries the day the list was verified. Nothing here is
 * inferred: the dates are the ones the signed reference list records (R-6.8 spam axis, R-6.9 core
 * axis), read from https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history and
 * verified on GOOGLE_UPDATES_VERIFIED_ON. A list like this decays silently — it goes on looking
 * authoritative while missing the update that actually explains a customer's drop — so staleness
 * is not left to a reader to notice: `isUpdateCalendarStale` makes it something the OUTPUT says.
 *
 * WHAT IS DELIBERATELY ABSENT: any claim about what an update DID. Google does not publish
 * per-site effects, so this module answers exactly one question — "did a published update land
 * inside the window you are looking at?" — and the sentence built from it says "may be", never
 * "was". The stale "helpful content system" vocabulary (R-4.6: folded into core in March 2024) is
 * not used anywhere, here or in the sentence.
 */

/** One published update: what Google called it, when its rollout STARTED, and which axis it is on. */
export interface GoogleUpdate {
  readonly name: string;
  /** Rollout start, YYYY-MM-DD (UTC), as Google's status history records it. */
  readonly date: string;
  readonly kind: "core" | "spam" | "discover";
}

/**
 * The day this list was checked against Google's status history. The output says so once the list
 * is older than UPDATE_CALENDAR_STALE_DAYS, so a forgotten file announces itself.
 */
export const GOOGLE_UPDATES_VERIFIED_ON = "2026-09-02";

/** How old the verification may get before the tool warns that the list may be incomplete. */
export const UPDATE_CALENDAR_STALE_DAYS = 90;

/** Every update the reference list records, oldest first (R-6.8 spam, R-6.9 core + Discover). */
export const GOOGLE_UPDATES: readonly GoogleUpdate[] = [
  { name: "March 2024 core update", date: "2024-03-05", kind: "core" },
  { name: "March 2024 spam update", date: "2024-03-05", kind: "spam" },
  { name: "June 2024 spam update", date: "2024-06-20", kind: "spam" },
  { name: "August 2024 core update", date: "2024-08-15", kind: "core" },
  { name: "November 2024 core update", date: "2024-11-11", kind: "core" },
  { name: "December 2024 core update", date: "2024-12-12", kind: "core" },
  { name: "December 2024 spam update", date: "2024-12-19", kind: "spam" },
  { name: "March 2025 core update", date: "2025-03-13", kind: "core" },
  { name: "June 2025 core update", date: "2025-06-30", kind: "core" },
  { name: "August 2025 spam update", date: "2025-08-26", kind: "spam" },
  { name: "December 2025 core update", date: "2025-12-11", kind: "core" },
  { name: "February 2026 Discover update", date: "2026-02-05", kind: "discover" },
  { name: "March 2026 spam update", date: "2026-03-24", kind: "spam" },
  { name: "March 2026 core update", date: "2026-03-27", kind: "core" },
  { name: "May 2026 core update", date: "2026-05-21", kind: "core" },
  { name: "June 2026 spam update", date: "2026-06-24", kind: "spam" },
  { name: "August 2026 spam update", date: "2026-08-18", kind: "spam" },
];

/**
 * The updates whose rollout STARTED inside `[start, end]`, inclusive, oldest first.
 *
 * String comparison, not Date arithmetic: both sides are ISO `YYYY-MM-DD` days from the same
 * source (the pull's own window fields), so lexicographic order IS chronological order and no
 * timezone can move a boundary by a day.
 */
export function updatesInRange(start: string, end: string): GoogleUpdate[] {
  return GOOGLE_UPDATES.filter((update) => update.date >= start && update.date <= end);
}

/** True when the calendar has not been re-verified inside UPDATE_CALENDAR_STALE_DAYS. */
export function isUpdateCalendarStale(now: Date = new Date()): boolean {
  const verifiedAt = Date.parse(`${GOOGLE_UPDATES_VERIFIED_ON}T00:00:00Z`);
  const days = (now.getTime() - verifiedAt) / 86_400_000;
  return days > UPDATE_CALENDAR_STALE_DAYS;
}

/** "27 Mar" — the short day the sentence names an update by (its year is already in its name). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDay(date: string): string {
  const [, month, day] = date.split("-");
  const index = Number(month) - 1;
  return `${Number(day)} ${MONTHS[index] ?? month}`;
}

/**
 * The sentence that goes ABOVE a decay list when a published update landed inside the period being
 * compared — or null when none did.
 *
 * ABOVE, not in the footer: the finding it qualifies is the whole list, and a caveat printed after
 * thirty rows of "rewrite this page" has already lost the argument. It says "may be", because
 * Google publishes when an update rolled out and never what it did to one site — and it names the
 * cheap check (did many pages move at once?) rather than telling the reader to do nothing.
 */
export function renderUpdateOverlap(
  start: string,
  end: string,
  now: Date = new Date(),
): string | null {
  const updates = updatesInRange(start, end);
  if (updates.length === 0) return null;
  const named = updates.map((u) => `${u.name} (${shortDay(u.date)})`).join(", ");
  const stale = isUpdateCalendarStale(now)
    ? ` This update list was last checked on ${GOOGLE_UPDATES_VERIFIED_ON} and may be missing ` +
      "newer ones."
    : "";
  return (
    `Note: the period being compared spans Google's ${named}. A drop that starts near ` +
    "one of those dates may be the update rather than the page — check whether many pages fell " +
    `at once before rewriting any of them.${stale}`
  );
}
