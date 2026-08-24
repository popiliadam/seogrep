import type {
  SerpKeywordRow,
  SerpPlacement,
  SerpSnapshotResult,
} from "../dfs/serp.ts";

/**
 * How ONE snapshot is put into words — the honesty surface of `serp_snapshot`, kept pure so the
 * fast lane can drive it directly.
 *
 * =====================================================================================
 * THE THREE ANSWERS STAY THREE, AND THE PORT ALREADY WROTE THEIR SENTENCES
 * =====================================================================================
 * `ranked`, `absent_from_examined_results` and `not_measured` are three different answers, and the
 * port ships the sentence for each one on the outcome itself (`means`). This module PRINTS those
 * sentences rather than composing its own, for a reason that is not laziness: the port's wording is
 * what the storage layer and `keyword_positions` were both built against, and a second set of words
 * here would be a second place for "searched and not found" to drift into "we do not know". There is
 * no branch below that can turn an absence into a zero, because there is no number to print.
 *
 * =====================================================================================
 * THE SCOPE TRAVELS WITH THE ANSWER (NEVER #7)
 * =====================================================================================
 * A SERP position is a measurement at a moment, on ONE locale, ONE device, ONE search engine, to
 * ONE depth. So every snapshot prints what it was measured under, and the port's own
 * `device_means` and `domain_match_rule_means` sentences come with it. Nothing here computes a
 * visibility score, a share of voice or a ranking of its own; the ranks are DataForSEO's own
 * `rank_group` and `rank_absolute` under the vendor's own names, and the two are never converted
 * into each other.
 *
 * THE SCOPE OF AN ABSENCE IS THE COUNTED RESULTS, never the depth that was asked for: the vendor
 * may return fewer results than the depth. `depth_requested` is printed as what was ASKED, and the
 * examined count is printed separately as what was COUNTED — they are two different numbers and
 * this module never substitutes one for the other.
 */

/** The keyword order is the CALLER's; nothing here re-sorts by rank. */
export const CALLER_ORDER_NOTE =
  "The keywords below are in the order you passed them. This is not a ranking of them: SeoGrep " +
  "sorts nothing and computes no score, no visibility figure and no position of its own.";

/** What was stored, and where to read it back. Printed on every snapshot that stored rows. */
export function storedNote(count: number): string {
  return (
    `${count} measurement${count === 1 ? "" : "s"} recorded — one per keyword, whether or not a ` +
    "placement was found. keyword_positions reads them back, together with any earlier reading " +
    "of the same keyword on the same locale and device."
  );
}

/** One placement, under the vendor's own field names. Nothing is renamed and nothing is computed. */
export function renderPlacement(placement: SerpPlacement): string {
  const group =
    placement.rank_group === null
      ? "rank_group not reported"
      : `rank_group #${placement.rank_group}`;
  const absolute =
    placement.rank_absolute === null
      ? "rank_absolute not reported"
      : `rank_absolute ${placement.rank_absolute}`;
  const url = placement.url === null ? "no URL reported" : placement.url;
  return `    ${group} (${absolute}) — ${url}`;
}

/**
 * ONE keyword's answer: the outcome's own sentence, then whatever the outcome carries.
 *
 * A `ranked` block prints EVERY placement, not just the best one: a domain appearing twice on one
 * SERP is a finding, and collapsing it to one line would hide it. The count of results examined is
 * printed on the ranked block too, because "#3" means nothing without the set it is #3 of.
 */
export function renderKeywordRow(index: number, row: SerpKeywordRow): string {
  const heading = `${index + 1}. "${row.measurement.keyword}"`;
  const outcome = row.outcome;
  if (outcome.status === "not_measured") {
    return `${heading} — NOT MEASURED: ${outcome.reason}\n    ${outcome.means}`;
  }
  if (outcome.status === "absent_from_examined_results") {
    return `${heading} — not found among the ${outcome.organic_items_examined} organic ` +
      `result(s) examined.\n    ${outcome.means}`;
  }
  const found =
    `${heading} — found in ${outcome.placements.length} of the ` +
    `${outcome.organic_items_examined} organic result(s) examined:`;
  return [found, ...outcome.placements.map(renderPlacement), `    ${outcome.means}`].join("\n");
}

/**
 * OUR clock and the vendor's, never merged. `fetched_at` is when THIS process received the
 * response; the vendor's own time is printed under the key it arrived on, or its absence is stated.
 * The port refuses to substitute one for the other and this line carries that refusal to the page.
 */
export function renderClocks(rows: readonly SerpKeywordRow[]): string {
  const reported = rows.filter((row) => row.observed.vendor_reported_time_value !== null);
  const [first] = rows;
  const ours =
    first === undefined
      ? ""
      : `SeoGrep's own clock at the moment the first response arrived: ${first.observed.fetched_at}.`;
  if (reported.length === 0) {
    return `${ours} DataForSEO did not report when it measured, so no vendor time is shown.`;
  }
  const sample = reported[0] as SerpKeywordRow;
  return (
    `${ours} DataForSEO reported ` +
    `${sample.observed.vendor_reported_time_field ?? "a time"} ` +
    `"${sample.observed.vendor_reported_time_value ?? ""}" for ${reported.length} of ` +
    `${rows.length} keyword(s); that is the vendor's account of when it measured, and it is a ` +
    "different claim from the clock reading above."
  );
}

/** The whole answer. */
export function formatSerpSnapshot(subject: string, result: SerpSnapshotResult): string {
  const asked = result.asked;
  const [first] = result.rows;
  const scope =
    `SERP snapshot for ${subject} — ${asked.keywords.length} keyword(s) on ` +
    `${asked.search_engine} organic results, ${asked.location_name} · language ` +
    `${asked.language_code} · ${asked.device} SERP · depth ${asked.depth_requested} requested.`;
  const meaning =
    first === undefined
      ? ""
      : `${first.measurement.device_means} ${first.measurement.domain_match_rule_means}`;
  const examined =
    "Each answer below states how many organic results were actually COUNTED in the response, " +
    `which is what an absence is scoped to — never the depth of ${asked.depth_requested} that ` +
    "was asked for, since DataForSEO may return fewer results than that.";
  return [
    scope,
    meaning,
    `${CALLER_ORDER_NOTE} ${examined}`,
    result.rows.map((row, index) => renderKeywordRow(index, row)).join("\n\n"),
    renderClocks(result.rows),
    storedNote(result.rows.length),
  ]
    .filter((block) => block.length > 0)
    .join("\n\n");
}
