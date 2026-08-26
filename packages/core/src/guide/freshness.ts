/**
 * The ONE freshness window this product measures stored data against — PURE: no I/O, no clock
 * of its own, no runtime dependency.
 *
 * WHY IT EXISTS. Three surfaces described the SAME crawl three different ways on 2026-08-25:
 * `audit_schema` printed `crawl from 2026-08-09`, `generate_report` printed `16 days ago`, and
 * `whats_next` called it "fresh" — with nothing anywhere saying what "fresh" meant. Underneath,
 * the number 30 was written out THREE times, in three packages, by three authors:
 * `FRESHNESS_WINDOW_DAYS` (guide/next-step), `STALE_PULL_DAYS` (apps/mcp gsc-data/load) and
 * `STALE_CRAWL_DAYS` (apps/mcp report/model). Each carried a comment saying it was deliberately
 * the same as the others, which is precisely the shape a drift takes: three independent numbers
 * that agree today because someone checked, and disagree tomorrow because nobody re-checked.
 *
 * So the number lives HERE, once, and those three keep their names as ALIASES of it. Renaming
 * them would have been a wider change for no gain — each name says what its surface calls the
 * threshold, and what mattered is that there is now exactly one value to move.
 *
 * The AGE VOCABULARY is here for the same reason: "today" / "1 day ago" / "N days ago" was
 * written out separately in gsc-data/load.ts, report/html.ts and research-keywords.ts. This
 * module is the copy the guide surfaces share, so a router that says "fresh" and a report that
 * says "16 days ago" are quoting one function rather than two opinions.
 *
 * SCOPE, stated plainly: `audit_onpage` / `audit_tech` / `audit_schema` still print a bare
 * `crawl from <iso>` and quote no age at all. Their renderers are pure and clockless, their
 * output is frozen byte-for-byte (audit/format-signals.test.ts) and digest-pinned
 * (audit/format-graph.test.ts), and threading a clock through them is a different change than
 * this one. They cannot CONTRADICT the window — they make no freshness claim — but they do not
 * yet quote it.
 */

/**
 * How many whole days old stored data may be before this product calls it stale.
 *
 * 30 — the value all three previous declarations already carried, moved rather than re-decided.
 * Past a month a crawl or a Search Console pull describes a different period of the site's life,
 * not an older version of the same one.
 */
export const DATA_FRESHNESS_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Whole days between an ISO timestamp and `now`, or null when either will not parse.
 *
 * A NULL AGE IS NEVER A FRESHNESS CLAIM in either direction: not knowing how old data is is not
 * evidence that it is fresh, and it is not evidence that it is stale either. Every caller here
 * has to decide what to do with null explicitly, which is the point of returning it.
 */
export function dataAgeInDays(iso: string | null, now: Date | string): number | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  const nowMs = typeof now === "string" ? Date.parse(now) : now.getTime();
  if (Number.isNaN(at) || Number.isNaN(nowMs)) return null;
  return Math.floor((nowMs - at) / DAY_MS);
}

/**
 * The age of stored data in words: "today", "1 day ago", "N days ago" — or "age unknown" when
 * the timestamp could not be read. Singular at exactly one day, because "1 days ago" is the
 * branch every hand-rolled copy of this got wrong at least once.
 */
export function describeDataAge(ageDays: number | null): string {
  if (ageDays === null) return "age unknown";
  if (ageDays <= 0) return "today";
  return ageDays === 1 ? "1 day ago" : `${ageDays} days ago`;
}

/**
 * Is data of this age past the window? `>=`, so exactly DATA_FRESHNESS_DAYS whole days old is
 * stale — the convention `STALE_PULL_DAYS` and `STALE_CRAWL_DAYS` already used, kept rather than
 * re-argued. Unknown age is not stale (see dataAgeInDays).
 */
export function isStaleAge(ageDays: number | null): boolean {
  return ageDays !== null && ageDays >= DATA_FRESHNESS_DAYS;
}
