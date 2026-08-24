import type { MeasurementWindow, StoredMeasurement } from "./keyword-positions-store.ts";

/**
 * How a stored series is put into words — the whole honesty surface of `keyword_positions`, kept
 * pure so it can be driven directly by the fast lane.
 *
 * =====================================================================================
 * A GAP IN THE SERIES IS NOT A DECLINE
 * =====================================================================================
 * The one thing a rank tracker must never do is draw a line through the days nobody measured. Two
 * readings a month apart are two observations, not a trend, and the space between them is not a
 * slope — nothing happened there that anybody looked at. So:
 *
 *   - every comparison between two readings carries HOW LONG apart they were, always, so no
 *     movement is ever printed as if it were continuous;
 *   - an interval longer than {@link MAX_CONTIGUOUS_GAP_HOURS} additionally prints
 *     {@link GAP_SENTENCE}, which states in words that nothing was measured in between;
 *   - no word in this module suggests a direction of travel. A movement prints as `#7 → #4`, never
 *     as "improved", "dropped", "gained" or "trend": those are claims about a path, and only the
 *     two endpoints were ever observed (NEVER #7).
 *
 * =====================================================================================
 * THE THREE ANSWERS STAY THREE
 * =====================================================================================
 * `ranked`, `absent_from_examined_results` and `not_measured` are rendered as three different
 * sentences, and a comparison is only ever ARITHMETIC between two `ranked` readings that both
 * carry a rank. Everything else is said in words:
 *
 *   - a reading that found nothing has NO position, so there is no number to subtract from;
 *   - a reading that was never taken says nothing at all about the position, so a comparison
 *     across it would be a claim about an unobserved moment.
 *
 * A `ranked` reading whose vendor rank is null is a fourth case the schema deliberately allows
 * ("found, and the vendor did not say where"), and it is printed as exactly that. It comes in TWO
 * shapes, because `rank_group` (organic-only) and `rank_absolute` (all SERP elements) are two
 * different scales and the vendor may withhold either: "no rank at all" and "no ORGANIC rank, and
 * this absolute one" are separate sentences. Collapsing them printed "DataForSEO reported no rank"
 * over a row where it had reported one — the renderer, not the schema, hiding a fact the vendor
 * sent. Neither scale is ever converted into the other, and no comparison crosses them.
 */

/** Longer than this between two adjacent readings and the answer says so, in words. */
export const MAX_CONTIGUOUS_GAP_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The sentence a gap carries. One constant, so a spec can pin it and a reader cannot miss it. */
export const GAP_SENTENCE =
  "Nothing was measured in between, so these are two separate observations and the change " +
  "between them is not a trend.";

/** What this tool bought, said plainly, since it charges for reading storage rather than measuring. */
export const STORED_READ_NOTE =
  "Every line above is a measurement that was already taken and stored: no search engine was " +
  "contacted for this answer and no new position was read. Each reading holds only for the " +
  "keyword, location, language and device named on its own heading, on the search engine and to " +
  "the depth stated there — a position is a measurement at a moment, not a property of a site. " +
  "Ranks are DataForSEO's own `rank_group` (organic-only) and `rank_absolute` (all SERP " +
  "elements); SeoGrep computes no score, no visibility figure and no ranking of its own.";

/**
 * WHAT MAKES TWO READINGS THE SAME SERIES. Everything a measurement was taken UNDER, including the
 * three facts a caller does not choose: the search engine, the depth that was asked for, and the
 * domain-match rule. They are in the key rather than in the heading alone because a change in any
 * of them forks the series and must: "not found in the 10 results examined" and "not found in the
 * 100 results examined" are answers to different questions, and putting them on one line would
 * turn a re-priced depth into an apparent movement.
 *
 * THE SEPARATOR IS NOT A SPACE, and it is written as an ESCAPE rather than as a raw byte. Two of
 * the seven parts may themselves contain spaces — the keyword ("seo tools") and the location
 * ("United States") — so a space-joined key lets two different identities collide: keyword
 * "seo tools united" in location "States" and keyword "seo tools" in location "United States" join
 * to the same string, and their readings would then be printed as ONE series with a movement
 * between them that nobody measured. A NUL cannot appear in a Postgres `text` value at all, so
 * nothing stored here can forge a boundary. It is spelled as an escape because a RAW NUL in the
 * source makes git treat the file as BINARY and the diff a reviewer needs disappears — measured on
 * this very file, which shipped that way for one commit.
 */
export const SERIES_KEY_SEPARATOR = "\u0000";

export function seriesKeyOf(row: StoredMeasurement): string {
  return [
    row.keyword,
    row.locationName,
    row.languageCode,
    row.device,
    row.searchEngine,
    String(row.depthRequested),
    row.domainMatchRule,
  ].join(SERIES_KEY_SEPARATOR);
}

export interface Series {
  readonly key: string;
  /** Newest first — the order the read returns and the order these are printed in. */
  readonly rows: readonly StoredMeasurement[];
}

/** Split the window into series, keeping the order each series first appears in. */
export function groupIntoSeries(rows: readonly StoredMeasurement[]): readonly Series[] {
  const byKey = new Map<string, StoredMeasurement[]>();
  for (const row of rows) {
    const key = seriesKeyOf(row);
    const existing = byKey.get(key);
    if (existing) existing.push(row);
    else byKey.set(key, [row]);
  }
  return [...byKey].map(([key, seriesRows]) => ({ key, rows: seriesRows }));
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

/** True when two readings are far enough apart that the answer must say nothing was measured. */
export function isGap(newerIso: string, olderIso: string): boolean {
  const ms = Math.abs(Date.parse(newerIso) - Date.parse(olderIso));
  return Number.isFinite(ms) && ms > MAX_CONTIGUOUS_GAP_HOURS * HOUR_MS;
}

/** The heading of one series: what was asked, and everything it was measured under. */
export function renderSeriesHeading(row: StoredMeasurement, storedInWindow: number): string {
  return (
    `"${row.keyword}" on ${row.targetDomain} — ${row.locationName} · language ` +
    `${row.languageCode} · ${row.device} SERP · ${row.searchEngine} · depth ${row.depthRequested} ` +
    `· matched by ${row.domainMatchRule}\n` +
    `${storedInWindow} reading${storedInWindow === 1 ? "" : "s"} in this window, newest first:`
  );
}

/** Our clock and the vendor's, never merged — the port's rule, carried through to the page. */
export function renderClocks(row: StoredMeasurement): string {
  return row.vendorReportedTimeValue === null
    ? "    DataForSEO did not report when it measured; the time above is SeoGrep's own clock at the moment the response arrived."
    : `    DataForSEO reported ${row.vendorReportedTimeField ?? "a time"} "${row.vendorReportedTimeValue}"; the time above is SeoGrep's own clock at the moment the response arrived.`;
}

/** ONE reading. Three shapes for three answers, and TWO more for each rank the vendor withheld. */
export function renderReading(row: StoredMeasurement): string {
  const when = row.fetchedAt;
  if (row.status === "not_measured") {
    return (
      `  ${when} — NOT MEASURED: ${row.notMeasuredReason ?? "no reason recorded"}. The position ` +
      "is unknown; nothing was examined, so this is not a statement that the domain is absent."
    );
  }
  if (row.status === "absent_from_examined_results") {
    return (
      `  ${when} — not found among the ${row.organicItemsExamined ?? 0} organic result(s) ` +
      "examined. That is the absence of a placement within the results examined — not position 0, " +
      "and it says nothing about results beyond those examined."
    );
  }
  const examinedClause = `${row.organicItemsExamined ?? 0} organic result(s) were examined.`;
  if (row.bestRankGroup === null) {
    // TWO SCALES, EITHER OF WHICH THE VENDOR MAY WITHHOLD — so "no rank_group" is NOT "no rank".
    // Collapsing these two into one sentence printed "DataForSEO reported no rank" over a row on
    // which DataForSEO had reported one, on its other scale, and the renderer was the only thing
    // hiding it: the schema stores that shape on purpose (migration 0030 says why it cannot be
    // constrained away).
    if (row.bestRankAbsolute === null) {
      return (
        `  ${when} — found, but DataForSEO reported no rank for the placement on either of its ` +
        `two scales — no rank_group (organic-only) and no rank_absolute (all SERP elements) — so ` +
        `the position is not stated. ${examinedClause}`
      );
    }
    return (
      `  ${when} — found, and DataForSEO reported rank_absolute ${row.bestRankAbsolute} (its rank ` +
      `among ALL SERP elements) but no rank_group, so the ORGANIC position is not stated. ` +
      examinedClause
    );
  }
  const absolute =
    row.bestRankAbsolute === null
      ? "rank_absolute not reported"
      : `rank_absolute ${row.bestRankAbsolute}`;
  return (
    `  ${when} — rank_group #${row.bestRankGroup} (${absolute}), of ` +
    `${row.organicItemsExamined ?? 0} organic result(s) examined.`
  );
}

/**
 * What sits BETWEEN two adjacent readings. `newer` is printed above `older`, so this clause is
 * attached under the newer one and always names the elapsed span.
 *
 * The arithmetic branch is deliberately the narrowest one: both readings ranked, both carrying a
 * `rank_group`. Every other pairing is described rather than subtracted, because there is no second
 * number ON THAT SCALE to subtract — a reported `rank_absolute` is not a substitute, it counts a
 * different set of things — and because a reading that was never taken cannot be an endpoint of
 * anything.
 */
export function renderInterval(newer: StoredMeasurement, older: StoredMeasurement): string {
  const elapsed = elapsedClause(older.fetchedAt, newer.fetchedAt);
  const gap = isGap(newer.fetchedAt, older.fetchedAt) ? ` ${GAP_SENTENCE}` : "";
  if (newer.status === "not_measured" || older.status === "not_measured") {
    return (
      `    ↕ ${elapsed} apart. One of these two readings is a non-measurement, so there is ` +
      `nothing to compare across it.${gap}`
    );
  }
  if (newer.status === "absent_from_examined_results" || older.status === "absent_from_examined_results") {
    const direction =
      newer.status === "absent_from_examined_results"
        ? "the newer reading found no placement at all"
        : "the older reading found no placement at all";
    return (
      `    ↕ ${elapsed} apart. No position change can be stated: ${direction}, and an absence ` +
      `has no position to compare.${gap}`
    );
  }
  if (newer.bestRankGroup === null || older.bestRankGroup === null) {
    // "no rank_group", never "no rank": one of these readings may well carry a rank_absolute, and
    // saying it carries no rank would be the same false sentence renderReading used to print. The
    // absolute is still not substituted — the two are different scales, and subtracting across
    // them would invent a movement on a scale neither reading was compared on.
    return (
      `    ↕ ${elapsed} apart. One of these two readings carries no rank_group, so there is no ` +
      `pair of positions to compare on the organic scale — and rank_absolute is a different scale, ` +
      `never subtracted from a rank_group.${gap}`
    );
  }
  return `    ↕ ${elapsed} apart: rank_group #${older.bestRankGroup} → #${newer.bestRankGroup}.${gap}`;
}

/** One series, readings and intervals interleaved. */
export function renderSeries(series: Series): string {
  const lines: string[] = [];
  const [first] = series.rows;
  if (first === undefined) return "";
  lines.push(renderSeriesHeading(first, series.rows.length));
  series.rows.forEach((row, index) => {
    lines.push(renderReading(row));
    lines.push(renderClocks(row));
    const older = series.rows[index + 1];
    if (older !== undefined) lines.push(renderInterval(row, older));
  });
  return lines.join("\n");
}

/**
 * The window caption — the same discipline every recent slice uses, in the words this subject
 * needs. The two numbers are SEPARATE and differently named: what is in hand under the caller's
 * bound, and how many measurements the same filter matches in storage. The second comes from its
 * own COUNT query and is never rows.length.
 */
export function renderWindowCaption(window: MeasurementWindow, seriesCount: number): string {
  const shown =
    `${window.windowRowCount} reading${window.windowRowCount === 1 ? "" : "s"} in this window ` +
    `(limit ${window.windowLimit}, newest first), across ` +
    `${seriesCount} keyword/locale/device series`;
  const stored =
    `${window.storedMeasurementCount} reading${window.storedMeasurementCount === 1 ? "" : "s"} ` +
    "match this filter in total";
  const slice =
    window.storedMeasurementCount > window.windowRowCount
      ? " — this window is the newest slice of that set, and an older reading of a series may sit " +
        "outside it"
      : "";
  return `${shown}. ${stored}${slice}.`;
}

/** The whole answer. */
export function formatKeywordPositions(
  subject: string,
  filterClause: string,
  window: MeasurementWindow,
): string {
  const series = groupIntoSeries(window.rows);
  return [
    `Stored keyword positions for ${subject}.`,
    filterClause,
    renderWindowCaption(window, series.length),
    series.map(renderSeries).join("\n\n"),
    STORED_READ_NOTE,
  ]
    .filter((block) => block.length > 0)
    .join("\n\n");
}
