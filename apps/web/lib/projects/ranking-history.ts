import { formatDate } from "../format";

/**
 * THE TENANT'S RANK-TRACKER HISTORY — the stored SERP measurements (`keyword_position_measurements`,
 * migration 0030) grouped into SERIES, plus the subscriptions (`tracked_keywords`) that have no
 * reading on the page yet. PURE: no I/O, no React, no Supabase client, so every decision below is
 * unit-tested directly rather than through an async Server Component vitest has no boundary for
 * (signed lesson 12). The twin of `lookup-history.ts` and `keyword-history.ts`, one subject over.
 *
 * ── WHY /app/rankings IS A PAGE AND NOT A THIRD SECTION OF /app/lookups ──────────────────────
 *
 * /app/lookups is a RUN LOG: its subject is "what have I spent DataForSEO credits on", one row per
 * call, newest first, and its own header refuses to union two differently-shaped run tables because
 * that is "two tables drawn on top of each other". A rank reading is not a run. `serp_snapshot`
 * bills one paid request PER KEYWORD, so the call that produced a reading is not the thing anybody
 * wants to read afterwards; what they want is "where was this keyword, and where was it last week".
 * That is a POINT IN A SERIES, keyed by a subscription tuple, and the series — not the call — is
 * the unit worth showing. Putting a series on the run log would mean either one row per reading
 * (a log that answers nothing about movement) or a nested table inside a log row (a second page
 * wearing the first page's furniture). So it gets its own surface, and /app/lookups keeps meaning
 * exactly one thing.
 *
 * ── WHAT MAKES TWO READINGS THE SAME SERIES ──────────────────────────────────────────────────
 *
 * `tools/keyword-positions-format.ts` already answers this for the MCP tool that reads the SAME
 * table, and the panel deliberately gives the SAME answer: one table must not have two stories told
 * about it. (The rules are RE-STATED here rather than imported — `apps/mcp` and `apps/web` are
 * separate packages with no dependency between them, and inventing one to share four sentences
 * would be the wrong trade.)
 *
 * The SUBSCRIPTION names five of the seven: keyword, location_name, language_code, device — plus,
 * on the measurement side, the target_domain the placements were looked for. 0030's header argues
 * each at length: "seo tools" on the US desktop SERP and on the UK mobile SERP are two different
 * questions with two different answers, so the locale and the device are part of what was
 * subscribed to and never chosen later. Two readings differing in ANY of those five are not the
 * same series and are never compared.
 *
 * The remaining two are the facts the caller does NOT choose — the search engine, the depth that
 * was asked for, and the domain-match rule — and they fork the series for the tool's own stated
 * reason: "not found in the 10 results examined" and "not found in the 100 results examined" are
 * answers to different questions, so a re-priced depth would otherwise print as a movement nobody
 * measured. Keying on all seven is a strictly FINER partition than the five, so it can only ever
 * refuse a comparison the five would have allowed — which is the direction this module errs in
 * everywhere.
 *
 * THE SEPARATOR IS A NUL, written as an ESCAPE. Two parts can contain spaces (the keyword "seo
 * tools", the location "United States"), so a space-joined key lets two different identities
 * collide and print as one series with a movement between them nobody measured. A NUL cannot occur
 * in a Postgres `text` value, so nothing stored can forge a boundary. It is spelled `\u0000`
 * because a RAW NUL byte makes git treat the file as binary and the diff a reviewer needs
 * disappears — measured on the MCP formatter, which shipped that way for one commit.
 *
 * ── THE THREE HONESTY RULES, CARRIED ACROSS FROM THE TOOL ────────────────────────────────────
 *
 * 1. A GAP IS NOT A DECLINE. Two readings a month apart are two observations; nothing is
 *    interpolated between them. Every comparison carries HOW LONG apart the two were, always, and
 *    an interval longer than {@link MAX_CONTIGUOUS_GAP_HOURS} additionally carries
 *    {@link GAP_SENTENCE}. No word here suggests a direction of travel: a movement is `#7 → #4`,
 *    never "improved", "dropped" or "trend" — those are claims about a path, and only the two
 *    endpoints were ever observed (NEVER #7).
 *
 * 2. THE THREE ANSWERS STAY THREE. `ranked`, `absent_from_examined_results` and `not_measured` get
 *    three different sentences and arithmetic happens ONLY between two `ranked` readings that both
 *    carry a `rank_group`. An absence has no position to subtract from; a non-measurement says
 *    nothing at all about the position, so comparing across it would be a claim about an
 *    unobserved moment. `not_measured` is never worded as "not found". A `ranked` reading whose
 *    `rank_group` is null is the fourth case 0030 stores on purpose ("found, and the vendor did
 *    not say where") and it comes in TWO shapes, because `rank_group` (organic-only) and
 *    `rank_absolute` (all SERP elements) are different scales the vendor may withhold either of.
 *    Neither scale is ever converted into the other and no comparison crosses them.
 *
 * 3. NOTHING IS INVENTED. No project name is joined in (a measurement names a DOMAIN; the project
 *    is provenance, and 0030 says so), no rank is guessed, no score, visibility figure or
 *    "estimated" anything is computed. A reading whose stored `status` is not one of the three is
 *    said to be unrecognised rather than assigned a meaning.
 *
 * ── UNTRACKING: THE SUBSCRIPTION MAY END, THE READINGS DO NOT ────────────────────────────────
 *
 * `tracked_keywords.untracked_at` is an ARCHIVE STAMP (0030 follows `projects.archived_at`), and
 * this page's rule is:
 *
 *   A SERIES IS NEVER HIDDEN BY THE STATE OF A SUBSCRIPTION. The measurements are what the tenant
 *   paid for — one paid request each — and they are facts about a moment, not about whether anyone
 *   is still watching. Filtering them by `untracked_at` would delete paid history from the only
 *   surface that shows it, and re-tracking would resurrect it, which would make the page's contents
 *   depend on a free, reversible act. Untracked series therefore render in full, labelled with the
 *   date the watching stopped. The same holds for a series that was NEVER tracked at all: an ad-hoc
 *   `serp_snapshot` of a competitor's domain is a first-class use of the tool, it is stored with no
 *   subscription anywhere, and it appears here for the same reason /app/lookups exists — the paid
 *   call nothing else in the product can show.
 *
 *   THE "no reading yet" LIST HOLDS ACTIVE SUBSCRIPTIONS ONLY. That list says a keyword is waiting
 *   for its first reading, and that sentence is simply false about one nobody is watching any more.
 *   Excluding untracked subscriptions from it drops NO measurement, because by construction every
 *   entry on it has none.
 *
 * ── WHAT A TRUNCATED WINDOW CANNOT SEE ───────────────────────────────────────────────────────
 *
 * The reads ask for `limit + 1` and the extra row is a PROBE: `rows.length >= limit` cannot tell
 * "the tenant has 201 readings" from "the tenant has exactly 200 and every one is on this page",
 * so the second tenant would be told that paid readings exist which do not. The probe is dropped
 * after the sort — so what leaves is the OLDEST reading — and before the series pass, so every
 * comparison on the page names a reading that is ON the page.
 *
 * That truncation has a SECOND consequence this module refuses to hide: a subscription whose
 * readings all fall outside the window looks, from inside the window, exactly like one that has
 * never been measured. So the list is named for what was measured — no reading ON THIS PAGE — and
 * {@link RankingHistory.windowFull} is what lets the surface say so out loud.
 *
 * THE CEILING TRAVELS WITH THE HISTORY ({@link RankingHistory.limit}) rather than being read from
 * the constant by whoever renders the disclosure. The number a page discloses must be the ceiling
 * that was actually applied to the rows in hand; a renderer that printed the exported constant
 * instead would keep printing 200 for a history built under any other bound, and no render spec
 * could tell the difference.
 */

/**
 * How many readings one page shows. A row here is a handful of small scalars — never the `report`
 * jsonb (see the read's own header) — and there is no paging on this surface. It is a CEILING,
 * disclosed the moment it bites.
 */
export const RANKING_HISTORY_LIMIT = 200;

/** How many subscriptions are read. Bounded for the same reason, and disclosed the same way. */
export const TRACKED_KEYWORD_LIMIT = 200;

/** Longer than this between two adjacent readings and the page says so, in words. */
export const MAX_CONTIGUOUS_GAP_HOURS = 24;

/** The sentence a gap carries. One constant, so a spec can pin it and a reader cannot miss it. */
export const GAP_SENTENCE =
  "Nothing was measured in between, so these are two separate observations and the change " +
  "between them is not a trend.";

/** See the module header: a NUL, written as an escape, so no two identities can collide. */
export const SERIES_KEY_SEPARATOR = "\u0000";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The three answers a stored measurement can carry — 0030's `status` column. */
export type MeasurementStatus = "ranked" | "absent_from_examined_results" | "not_measured";

const STATUSES: readonly string[] = ["ranked", "absent_from_examined_results", "not_measured"];

/**
 * One `keyword_position_measurements` row as the page reads it — SCALARS ONLY. `report` is
 * deliberately absent: see `read-measurements.ts` for why a page that reads many rows must never
 * ask for it.
 */
export interface MeasurementRow {
  readonly id: string;
  /** Provenance, and the only thing a subscription can be matched on. Null for an ad-hoc snapshot. */
  readonly project_id: string | null;
  readonly keyword: string;
  readonly target_domain: string;
  readonly location_name: string;
  readonly language_code: string;
  readonly device: string;
  readonly search_engine: string;
  readonly depth_requested: number;
  readonly domain_match_rule: string;
  readonly status: string;
  readonly best_rank_group: number | null;
  readonly best_rank_absolute: number | null;
  readonly organic_items_examined: number | null;
  readonly not_measured_reason: string | null;
  readonly vendor_reported_time_field: string | null;
  readonly vendor_reported_time_value: string | null;
  /** OUR clock at the moment the response arrived — the series axis, never `created_at`. */
  readonly fetched_at: string;
}

/** One `tracked_keywords` row as the page reads it. */
export interface TrackedKeywordRow {
  readonly id: string;
  readonly project_id: string;
  readonly keyword: string;
  readonly location_name: string;
  readonly language_code: string;
  readonly device: string;
  readonly created_at: string;
  /** Null = still watched. An archive stamp, never a delete — see the module header. */
  readonly untracked_at: string | null;
}

/** Everything a reading was taken UNDER. All seven parts key the series; see the header. */
export interface SeriesIdentity {
  readonly targetDomain: string;
  readonly keyword: string;
  readonly locationName: string;
  readonly languageCode: string;
  readonly device: string;
  readonly searchEngine: string;
  readonly depthRequested: number;
  readonly domainMatchRule: string;
}

/** The subscription a series belongs to, when one was found. */
export interface SeriesSubscription {
  readonly trackedSince: string;
  /** Non-null = the tenant stopped watching. The readings still show — see the header. */
  readonly untrackedAt: string | null;
}

/**
 * What may honestly be said between two adjacent readings. Only `positions` is arithmetic; every
 * other shape exists because there is no second number ON THE SAME SCALE to subtract.
 */
export type RankingComparison =
  | { readonly kind: "positions"; readonly from: number; readonly to: number }
  | { readonly kind: "not_measured" }
  | { readonly kind: "absent"; readonly which: "newer" | "older" }
  | { readonly kind: "no_rank_group" }
  | { readonly kind: "unreadable" };

/** What sits between one reading and the next-older one in its series. */
export interface RankingInterval {
  /** Whole days and hours, always stated, so no movement reads as continuous. */
  readonly elapsed: string;
  /** True past {@link MAX_CONTIGUOUS_GAP_HOURS}: the answer must say nothing was measured. */
  readonly gap: boolean;
  readonly comparison: RankingComparison;
}

/** One reading, with the interval to the reading BELOW it (older) already decided. */
export interface RankingReading {
  readonly id: string;
  readonly fetchedAt: string;
  /** Null when the stored status is not one of the three — never guessed into one. */
  readonly status: MeasurementStatus | null;
  readonly bestRankGroup: number | null;
  readonly bestRankAbsolute: number | null;
  readonly organicItemsExamined: number | null;
  readonly notMeasuredReason: string | null;
  readonly vendorReportedTimeField: string | null;
  readonly vendorReportedTimeValue: string | null;
  /** Null on the OLDEST listed reading of a series: there is nothing on this page below it. */
  readonly interval: RankingInterval | null;
}

/** One series: what was measured, whether it is watched, and every reading on this page. */
export interface RankingSeries {
  readonly key: string;
  readonly identity: SeriesIdentity;
  /** Null when no subscription matches — an ad-hoc snapshot, which is a first-class row here. */
  readonly subscription: SeriesSubscription | null;
  /** Newest first. Never empty: a series exists because a reading created it. */
  readonly readings: readonly RankingReading[];
}

/** An ACTIVE subscription with no reading on this page. See the header for what that is not. */
export interface TrackedKeywordEntry {
  readonly id: string;
  readonly keyword: string;
  readonly locationName: string;
  readonly languageCode: string;
  readonly device: string;
  readonly trackedSince: string;
}

/** The page's whole input. */
export interface RankingHistory {
  readonly series: readonly RankingSeries[];
  readonly awaitingReadings: readonly TrackedKeywordEntry[];
  /** The ceiling ACTUALLY applied to the readings in hand — see the header's last paragraph. */
  readonly limit: number;
  /** True when a reading OLDER than the last listed one was actually SEEN (the probe came back). */
  readonly windowFull: boolean;
  /** The ceiling actually applied to the subscriptions. */
  readonly trackedLimit: number;
  readonly trackedWindowFull: boolean;
}

/** The stored status, or null. A fourth value is not silently treated as "some other thing". */
function readStatus(value: string): MeasurementStatus | null {
  return STATUSES.includes(value) ? (value as MeasurementStatus) : null;
}

/** Sortable instant; an unparseable stamp sorts last rather than poisoning the order with NaN. */
function instantOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Newest first, TIE BROKEN BY `id` — descending, exactly as the read orders it.
 *
 * The tiebreak is not decoration. Two readings can share a `fetched_at` to the microsecond (one
 * snapshot writes a row per keyword, and two rows of ONE series differ only when the snapshot was
 * repeated), and `order by fetched_at desc` ALONE leaves their relative order undefined in
 * Postgres and unstable in a JS sort. On this page that order decides which reading the interval
 * clause is attached to, so an undefined order is an undefined sentence. Written as an explicit
 * three-way rather than `b - a`: two unparseable stamps are both `-Infinity`, and
 * `-Infinity - -Infinity` is NaN — a comparator returning NaN leaves the whole order unspecified.
 */
function newestFirst(left: MeasurementRow, right: MeasurementRow): number {
  const a = instantOf(left.fetched_at);
  const b = instantOf(right.fetched_at);
  if (a !== b) return a > b ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id > right.id ? -1 : 1;
}

/** Subscriptions, newest first, tie broken by id — the read's order, re-decided here. */
function subscriptionsNewestFirst(left: TrackedKeywordRow, right: TrackedKeywordRow): number {
  const a = instantOf(left.created_at);
  const b = instantOf(right.created_at);
  if (a !== b) return a > b ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id > right.id ? -1 : 1;
}

/** The seven-part series key. See the module header for every part and for the separator. */
export function seriesKeyOf(row: MeasurementRow): string {
  return [
    row.target_domain,
    row.keyword,
    row.location_name,
    row.language_code,
    row.device,
    row.search_engine,
    String(row.depth_requested),
    row.domain_match_rule,
  ].join(SERIES_KEY_SEPARATOR);
}

/**
 * The five VALUES the two tables meet on (0030: "that join is the panel's, not the database's").
 * `project_id` leads it because a subscription is always a subscription FOR A SITE, while a
 * measurement may carry none at all — which is exactly the ad-hoc snapshot that matches nothing.
 */
function subscriptionKeyOf(row: {
  readonly project_id: string;
  readonly keyword: string;
  readonly location_name: string;
  readonly language_code: string;
  readonly device: string;
}): string {
  return [
    row.project_id,
    row.keyword,
    row.location_name,
    row.language_code,
    row.device,
  ].join(SERIES_KEY_SEPARATOR);
}

/** An elapsed span in whole days and hours. Deterministic — no locale data is consulted. */
export function elapsedClause(fromIso: string, toIso: string): string {
  const ms = Math.abs(Date.parse(toIso) - Date.parse(fromIso));
  if (!Number.isFinite(ms)) return "an unknown interval";
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  if (days === 0 && hours === 0) return "under an hour";
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** True when two readings are far enough apart that the page must say nothing was measured. */
export function isGap(newerIso: string, olderIso: string): boolean {
  const ms = Math.abs(Date.parse(newerIso) - Date.parse(olderIso));
  return Number.isFinite(ms) && ms > MAX_CONTIGUOUS_GAP_HOURS * HOUR_MS;
}

/**
 * What may be said between two readings — the narrowest branch LAST.
 *
 * The order of these guards is the whole of honesty rule 2. A non-measurement is checked FIRST,
 * because a reading that was never taken cannot be an endpoint of anything and must never reach
 * the arithmetic; then an absence, which has no position to subtract from; then a missing
 * `rank_group`, where the other scale's `rank_absolute` is deliberately NOT substituted. Only two
 * `ranked` readings that BOTH carry a `rank_group` are subtracted.
 */
function comparisonBetween(newer: RankingReading, older: RankingReading): RankingComparison {
  if (newer.status === null || older.status === null) return { kind: "unreadable" };
  if (newer.status === "not_measured" || older.status === "not_measured") {
    return { kind: "not_measured" };
  }
  if (newer.status === "absent_from_examined_results") return { kind: "absent", which: "newer" };
  if (older.status === "absent_from_examined_results") return { kind: "absent", which: "older" };
  if (newer.bestRankGroup === null || older.bestRankGroup === null) return { kind: "no_rank_group" };
  return { kind: "positions", from: older.bestRankGroup, to: newer.bestRankGroup };
}

function readingOf(row: MeasurementRow): Omit<RankingReading, "interval"> {
  const status = readStatus(row.status);
  return {
    id: row.id,
    fetchedAt: row.fetched_at,
    status,
    // The rank columns are meaningless off a `ranked` row and 0030 refuses to store them there;
    // they are carried through as read rather than re-derived, so nothing here can invent one.
    bestRankGroup: row.best_rank_group,
    bestRankAbsolute: row.best_rank_absolute,
    organicItemsExamined: row.organic_items_examined,
    notMeasuredReason: row.not_measured_reason,
    vendorReportedTimeField: row.vendor_reported_time_field,
    vendorReportedTimeValue: row.vendor_reported_time_value,
  };
}

function identityOf(row: MeasurementRow): SeriesIdentity {
  return {
    targetDomain: row.target_domain,
    keyword: row.keyword,
    locationName: row.location_name,
    languageCode: row.language_code,
    device: row.device,
    searchEngine: row.search_engine,
    depthRequested: row.depth_requested,
    domainMatchRule: row.domain_match_rule,
  };
}

/**
 * Build everything /app/rankings shows.
 *
 * NEWEST FIRST IS RE-DECIDED HERE rather than merely trusted from the query, for the reason the
 * two lookup builders give: the query's `.order(...)` is pinned by its own source spec, but THIS
 * function is what the page is actually built from and is the only half a pure spec can execute.
 *
 * `measurements` may carry ONE MORE than `limit` — the read's overflow probe. It is sorted with
 * the rest and then cut, so what leaves is the oldest reading rather than whichever row arrived
 * last, and it is cut BEFORE the series pass so nothing on the page is compared against a reading
 * the page does not list. Same for `tracked` and `trackedLimit`.
 *
 * A SERIES IS MATCHED TO AT MOST ONE SUBSCRIPTION, by the newest of its readings that carries a
 * `project_id` at all. A series can mix provenances — the same keyword measured for one domain
 * through a project and ad hoc — because 0030 keys the series on the DOMAIN and calls `project_id`
 * provenance; scanning newest-first makes the answer deterministic. No project NAME is read: the
 * page names the domain that was measured, which is the thing the reading is actually about.
 */
export function buildRankingHistory(
  measurements: readonly MeasurementRow[],
  tracked: readonly TrackedKeywordRow[],
  limit: number = RANKING_HISTORY_LIMIT,
  trackedLimit: number = TRACKED_KEYWORD_LIMIT,
): RankingHistory {
  const orderedMeasurements = [...measurements].sort(newestFirst);
  const listedMeasurements = orderedMeasurements.slice(0, limit);
  const orderedTracked = [...tracked].sort(subscriptionsNewestFirst);
  const listedTracked = orderedTracked.slice(0, trackedLimit);

  const subscriptions = new Map<string, TrackedKeywordRow>();
  for (const row of listedTracked) {
    // First writer wins: the sort above is newest-first, and 0030's unique index makes a second
    // row on one key impossible anyway — this is belt-and-braces against a future widening.
    if (!subscriptions.has(subscriptionKeyOf(row))) {
      subscriptions.set(subscriptionKeyOf(row), row);
    }
  }

  const grouped = new Map<string, { identity: SeriesIdentity; rows: MeasurementRow[] }>();
  for (const row of listedMeasurements) {
    const key = seriesKeyOf(row);
    const existing = grouped.get(key);
    if (existing) existing.rows.push(row);
    else grouped.set(key, { identity: identityOf(row), rows: [row] });
  }

  const matched = new Set<string>();
  const series: RankingSeries[] = [...grouped].map(([key, group]) => {
    let subscription: SeriesSubscription | null = null;
    for (const row of group.rows) {
      if (row.project_id === null) continue;
      const found = subscriptions.get(subscriptionKeyOf({ ...row, project_id: row.project_id }));
      if (found === undefined) continue;
      matched.add(subscriptionKeyOf(found));
      subscription = { trackedSince: found.created_at, untrackedAt: found.untracked_at };
      break;
    }
    const readings: RankingReading[] = group.rows.map((row) => ({
      ...readingOf(row),
      interval: null,
    }));
    // The interval is attached UNDER the newer reading and always names the elapsed span, so no
    // movement on this page can be read as continuous (honesty rule 1).
    const withIntervals = readings.map((reading, index) => {
      const older = readings[index + 1];
      if (older === undefined) return reading;
      return {
        ...reading,
        interval: {
          elapsed: elapsedClause(older.fetchedAt, reading.fetchedAt),
          gap: isGap(reading.fetchedAt, older.fetchedAt),
          comparison: comparisonBetween(reading, older),
        },
      };
    });
    return { key, identity: group.identity, subscription, readings: withIntervals };
  });

  const awaitingReadings: TrackedKeywordEntry[] = listedTracked
    // ACTIVE ONLY. "waiting for its first reading" is false about a keyword nobody watches any
    // more, and no measurement is lost by leaving it out: every entry here has none. See header.
    .filter((row) => row.untracked_at === null && !matched.has(subscriptionKeyOf(row)))
    .map((row) => ({
      id: row.id,
      keyword: row.keyword,
      locationName: row.location_name,
      languageCode: row.language_code,
      device: row.device,
      trackedSince: row.created_at,
    }));

  return {
    series,
    awaitingReadings,
    limit,
    // The PROBE ANSWERED: a reading older than the last listed one really was seen. Strictly
    // greater, because a read that came back with exactly `limit` rows saw no such reading.
    windowFull: orderedMeasurements.length > limit,
    trackedLimit,
    trackedWindowFull: orderedTracked.length > trackedLimit,
  };
}

/**
 * A stored instant to the MINUTE, in UTC, deterministically — never `Intl` or `toLocale*`, so the
 * server and every browser print the same string and hydration cannot mismatch (lib/format.ts's
 * rule). To the minute rather than to the day, because a rank tracker can hold two readings of one
 * series on one date and a date alone would print them as the same moment.
 */
export function formatReadingTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

/** Everything the reading was measured under, minus the keyword and the domain the heading names. */
export function describeMeasurementScope(identity: SeriesIdentity): string {
  return (
    `${identity.locationName} · language ${identity.languageCode} · ${identity.device} SERP · ` +
    `${identity.searchEngine} · depth ${identity.depthRequested} · matched by ` +
    identity.domainMatchRule
  );
}

/**
 * ONE READING, as a sentence. Three shapes for the three answers, TWO more for each rank the
 * vendor withheld, and one for a status this page does not recognise.
 *
 * `not_measured` never uses the words "not found": nothing was examined, so the row is not a
 * statement about the domain's absence at all. `absent_from_examined_results` names the number of
 * results that WERE examined, because that count is the scope of the claim and the claim is
 * worthless without it — it is never "position 0" and says nothing about results beyond those
 * examined.
 */
export function describeReading(reading: RankingReading): string {
  if (reading.status === null) {
    return (
      "This reading was stored with a status this page does not recognise, so what it found is " +
      "not stated here."
    );
  }
  if (reading.status === "not_measured") {
    return (
      `Not measured: ${reading.notMeasuredReason ?? "no reason recorded"}. The position is ` +
      "unknown; nothing was examined, so this is not a statement that the domain is absent."
    );
  }
  if (reading.status === "absent_from_examined_results") {
    return (
      `Not found among the ${reading.organicItemsExamined ?? 0} organic result(s) examined. That ` +
      "is the absence of a placement within the results examined — not position 0, and it says " +
      "nothing about results beyond those examined."
    );
  }
  const examined = `${reading.organicItemsExamined ?? 0} organic result(s) were examined.`;
  if (reading.bestRankGroup === null) {
    // TWO SCALES, EITHER OF WHICH THE VENDOR MAY WITHHOLD — so "no rank_group" is NOT "no rank".
    // Collapsing these two printed "DataForSEO reported no rank" over a row on which it HAD
    // reported one, on its other scale; 0030 stores that shape on purpose and says a constraint
    // cannot refuse it, which makes keeping the two apart a rendering duty.
    if (reading.bestRankAbsolute === null) {
      return (
        "Found, but DataForSEO reported no rank for the placement on either of its two scales — " +
        "no rank_group (organic-only) and no rank_absolute (all SERP elements) — so the position " +
        `is not stated. ${examined}`
      );
    }
    return (
      `Found, and DataForSEO reported rank_absolute ${reading.bestRankAbsolute} (its rank among ` +
      `ALL SERP elements) but no rank_group, so the ORGANIC position is not stated. ${examined}`
    );
  }
  const absolute =
    reading.bestRankAbsolute === null
      ? "rank_absolute not reported"
      : `rank_absolute ${reading.bestRankAbsolute}`;
  return `rank_group #${reading.bestRankGroup} (${absolute}), of ${examined}`;
}

/** Our clock and the vendor's, never merged — 0030's three-clocks rule, carried to the page. */
export function describeClocks(reading: RankingReading): string {
  const ours = "the time above is SeoGrep's own clock at the moment the response arrived";
  return reading.vendorReportedTimeValue === null
    ? `DataForSEO did not report when it measured; ${ours}.`
    : `DataForSEO reported ${reading.vendorReportedTimeField ?? "a time"} ` +
        `"${reading.vendorReportedTimeValue}"; ${ours}.`;
}

/**
 * WHAT SITS BETWEEN TWO READINGS, as a sentence — always beginning with the elapsed span, so no
 * movement can be read as continuous, and carrying {@link GAP_SENTENCE} past the contiguity bound.
 *
 * The arithmetic branch prints `#7 → #4` and nothing else: no "improved", no "up", no arrow of
 * approval. Only the two endpoints were observed, and a word for the path between them would be a
 * claim about days nobody measured.
 */
export function describeInterval(interval: RankingInterval): string {
  const gap = interval.gap ? ` ${GAP_SENTENCE}` : "";
  const head = `${interval.elapsed} apart`;
  switch (interval.comparison.kind) {
    case "unreadable":
      return (
        `${head}. One of these two readings carries a status this page does not recognise, so ` +
        `nothing is compared across it.${gap}`
      );
    case "not_measured":
      return (
        `${head}. One of these two readings is a non-measurement, so there is nothing to compare ` +
        `across it.${gap}`
      );
    case "absent": {
      const which =
        interval.comparison.which === "newer"
          ? "the newer reading found no placement at all"
          : "the older reading found no placement at all";
      return (
        `${head}. No position change can be stated: ${which}, and an absence has no position to ` +
        `compare.${gap}`
      );
    }
    case "no_rank_group":
      return (
        `${head}. One of these two readings carries no rank_group, so there is no pair of ` +
        `positions to compare on the organic scale — and rank_absolute is a different scale, ` +
        `never subtracted from a rank_group.${gap}`
      );
    default:
      return (
        `${head}: rank_group #${interval.comparison.from} → #${interval.comparison.to}.${gap}`
      );
  }
}

/**
 * Whether the tenant is still watching this series, said in words — or that nothing ever watched
 * it, which is the ad-hoc snapshot and is not a defect.
 */
export function describeSubscription(subscription: SeriesSubscription | null): string {
  if (subscription === null) {
    return "Not tracked — a one-off snapshot, kept because it was measured and paid for.";
  }
  if (subscription.untrackedAt !== null) {
    return (
      `No longer tracked since ${formatDate(subscription.untrackedAt)}; watched from ` +
      `${formatDate(subscription.trackedSince)}. The readings below were still measured and are ` +
      "kept."
    );
  }
  return `Tracked since ${formatDate(subscription.trackedSince)}.`;
}
