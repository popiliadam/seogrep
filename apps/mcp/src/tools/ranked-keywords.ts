import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  POSITION_BAND_KEYS,
  WHOLE_DOMAIN_MEASUREMENT_NOTE,
  WHOLE_DOMAIN_SOURCE_LABEL,
  type DomainOrganicMetrics,
  type PositionBandKey,
} from "../dfs/competitors.ts";
import {
  DEFAULT_RANKED_KEYWORDS_LIMIT,
  DEFAULT_RANKED_KEYWORDS_SORT,
  RANKED_KEYWORDS_MAX_LIMIT,
  RANKED_KEYWORDS_SORTS,
  resolveDefaultRankedKeywordsPort,
  type RankChange,
  type RankedKeywordRow,
  type RankedKeywordsPort,
  type RankedKeywordsResult,
  type RankedKeywordsSort,
} from "../dfs/ranked-keywords.ts";
import {
  rankedKeywordsRunReport,
  writeDomainLookupRun,
  type DomainLookupRunWriter,
} from "../dfs/runs.ts";
import { flatZeroNotes, type FlatZeroColumn } from "../format/flat-zero.ts";
import {
  SEARCH_VOLUME_DESCRIPTION_CLAUSE,
  SEARCH_VOLUME_NOTE,
} from "../format/search-volume.ts";
import { MODEL_PRECISION_CLAUSE } from "../format/quantities.ts";
import { renderVendorFreshness } from "./research-keywords.ts";
import {
  loadOwnProject,
  projectIdField,
  resolveTarget,
  subjectLabel,
  targetField,
  type LoadProjectFn,
  type ProjectRef,
} from "./project-target.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * ranked_keywords — the Google organic keywords a domain ALREADY ranks for, from the
 * DataForSEO Labs "Google Ranked Keywords" endpoint. Synchronous: it returns a table
 * immediately (no background job). It takes EITHER a bare `target` (any public domain, yours
 * or a competitor's) OR a `project_id`, whose stored domain becomes the target.
 *
 * It is built to research_keywords' pattern, and the same two hard product rules shape its
 * credit path:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear
 *      English error and NEVER serves sample/placeholder figures as if they were real
 *      (constitution NEVER #7). The mock fixture exists only for tests.
 *   2. That live-disabled error — and an invalid-domain rejection — are returned BEFORE any
 *      credit reserve, so the ledger is touched ZERO times (constitution NEVER #2).
 *
 * charge:"handler" for the same reason research_keywords uses it: this is a SYNCHRONOUS tool
 * that must run logic BEFORE the reserve, which charge:"surface" (reserve-then-handler) cannot
 * express. On the serving path it settles via withCredits WITHOUT a jobId — the exact SURFACE
 * ledger shape (reserve -> commit, a traceability uuid, no jobs row).
 */

/** United States — the DataForSEO default location_code (same default as research_keywords). */
const DEFAULT_LOCATION_CODE = 2840;

/** English — the default language_code. Paired with the location above by localeHint. */
const DEFAULT_LANGUAGE_CODE = "en";

/**
 * The sort keys the schema offers, derived from the port's own map so the surface can never
 * advertise an ordering the client cannot send (or quietly stop offering one it can).
 */
const SORT_KEYS = Object.keys(RANKED_KEYWORDS_SORTS) as [RankedKeywordsSort, ...RankedKeywordsSort[]];

/** What each ordering means in the header, so "top N" states which "top" the caller got. */
const SORT_LABEL: Record<RankedKeywordsSort, string> = {
  volume: "highest search volume first",
  traffic: "highest estimated traffic first",
  position: "best ranking first",
};

const NOT_ENABLED_MESSAGE =
  "Ranked-keyword lookups are not yet enabled on this deployment. Live DataForSEO data is " +
  "turned off, and SeoGrep never returns sample or placeholder figures as if they were real. " +
  "This tool will start returning data once live DataForSEO access is switched on — you were " +
  "not charged.";

const inputSchema = z.object({
  target: targetField("look up"),
  project_id: projectIdField,
  limit: z
    .number()
    .int()
    .min(1)
    .max(RANKED_KEYWORDS_MAX_LIMIT)
    .default(DEFAULT_RANKED_KEYWORDS_LIMIT)
    .describe(
      `How many ranked keywords to return (1–${RANKED_KEYWORDS_MAX_LIMIT}, default ` +
        `${DEFAULT_RANKED_KEYWORDS_LIMIT}). The header always names the domain's FULL ranked ` +
        "keyword count, so raise this deliberately when the total says there is more worth reading.",
    ),
  sort: z
    .enum(SORT_KEYS)
    .default(DEFAULT_RANKED_KEYWORDS_SORT)
    .describe(
      "How DataForSEO orders the domain's keywords before returning the first `limit` of them: " +
        "'volume' = highest monthly search volume first (default), 'traffic' = highest " +
        "estimated monthly traffic first, 'position' = best ranking first.",
    ),
  language_code: z
    .string()
    .min(2)
    .default(DEFAULT_LANGUAGE_CODE)
    .describe("Language code (default 'en')."),
  location_code: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_LOCATION_CODE)
    .describe("DataForSEO location code (default 2840 = United States)."),
});

type RankedKeywordsInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "List the Google organic keywords a domain already ranks for — organic and on-page position, " +
  "monthly search volume, CPC, competition, estimated traffic, the ranking URL and its SERP " +
  "title — under a summary of the whole domain's organic ranking distribution and estimated " +
  "traffic. Pass a target domain (any public domain, including a competitor's) or a project_id " +
  "to look up one of your own sites. " +
  `Synchronous — returns a table immediately. Costs ${TOOL_COSTS.ranked_keywords} credits. Needs ` +
  "a paid credit balance: it is not available on trial credits. If live DataForSEO access is " +
  "unavailable on this deployment, the tool says so and charges nothing. " +
  SEARCH_VOLUME_DESCRIPTION_CLAUSE;

/**
 * Group digits with commas without depending on ICU/locale data (deterministic). Kept local
 * on purpose: sharing it would mean editing research_keywords, whose behaviour is pinned.
 */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Below this many rows, a lookup left on the US/English DEFAULT is more likely to be a locale
 * mismatch than a genuinely unranked domain, so the output says so. Measured 2026-08-07:
 * adstark.com.tr returned 3 rows, all at search volume 30, on the default; the same domain at
 * tr/2792 returned rows carrying volumes up to 3,600 — the same 65 credits, twice, to discover a parameter the tool never mentioned.
 * Knowing the domain does NOT tell the tool which location_code to use — that mapping is not
 * something this repo has measured (see twoLetterTld below) — so the honest move is to name the
 * assumption, and the domain's country-code TLD, exactly when the assumption looks wrong.
 */
const THIN_RESULT_ROWS = 5;

/** A USD figure with cents — the row-level CPC the vendor quotes to two decimals. */
function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * The label a position band is printed under, DERIVED from the vendor key rather than looked up
 * in a second hand-written table: `pos_2_3` -> `#2-3`, `pos_91_100` -> `#91-100`. compare_competitors
 * prints the same twelve bands under the same labels from its own literal table; deriving them
 * here means the two tools cannot drift into calling one vendor field two different things.
 */
function bandLabel(key: PositionBandKey): string {
  return `#${key.slice("pos_".length).replace(/_/g, "-")}`;
}

/** "#1: 4 · #2-3: 11 · …" for one slice of the twelve bands. */
function renderBands(metrics: DomainOrganicMetrics, bands: readonly PositionBandKey[]): string {
  return bands
    .map((key) => `${bandLabel(key)}: ${metrics[key] === null ? "n/a" : thousands(metrics[key])}`)
    .join(" · ");
}

/** True when DataForSEO returned no domain-level metrics at all. */
function hasNoMetrics(metrics: DomainOrganicMetrics): boolean {
  return Object.values(metrics).every((value) => value === null);
}

/**
 * The domain's organic health card — the `metrics.organic` block that arrives in the SAME paid
 * response as the rows and was previously parsed past and discarded.
 *
 * It goes ABOVE the table on purpose: "this domain holds 4 number-one rankings, 5,312 organic
 * SERPs and an estimated 15,235 visits a month" is the answer to the question most callers are
 * actually asking, and burying it under a thousand bullet lines means the reading model spends
 * its context on the rows before it ever reaches the summary.
 *
 * Every label restates DataForSEO's own definition and is worded identically to
 * compare_competitors' block, because the two tools print the SAME nineteen vendor fields and a
 * reader comparing the two outputs must not have to work out that "Organic SERPs containing the
 * domain" and some other phrasing are the same number. In particular `count` and the `pos_*`
 * bands count SERPs, NOT keywords, and `etv` / `estimated_paid_traffic_cost` are vendor
 * ESTIMATES, so they are labelled as such.
 *
 * The heading NAMES the measurement, and the identical wording is exactly why it has to. This
 * card is `ranked_keywords`' own `result.metrics.organic`; compare_competitors prints the same
 * nineteen fields under the same labels from competitors_domain or domain_rank_overview. Those
 * are separate DataForSEO measurements of the same domain and they disagree — the repo's fixtures
 * put one domain's `is_lost` at 320, 319 and 547 — so an unnamed source made two true numbers
 * look like one broken one. The note below the card says what to make of a difference; it is one
 * line, and it sits AFTER the figures so nothing is buried under it.
 */
function renderHealthCard(metrics: DomainOrganicMetrics): string | null {
  if (hasNoMetrics(metrics)) return null;
  const top = POSITION_BAND_KEYS.slice(0, 4);
  const deeper = POSITION_BAND_KEYS.slice(4);
  return [
    `Across the whole domain — every keyword it ranks for, from ${WHOLE_DOMAIN_SOURCE_LABEL.ranked_keywords}:`,
    `- Organic SERPs containing the domain: ${metric(metrics.count)}`,
    `- Organic SERPs by position, #1-20 — ${renderBands(metrics, top)}`,
    `- Organic SERPs by position, #21-100 — ${renderBands(metrics, deeper)}`,
    `- Estimated monthly organic traffic (ETV): ${metric(metrics.etv)}`,
    `- Estimated monthly cost of the same traffic as paid ads: ${metrics.estimated_paid_traffic_cost === null ? "n/a" : `$${thousands(metrics.estimated_paid_traffic_cost)}`}`,
    `- Since DataForSEO's previous check — newly ranking: ${metric(metrics.is_new)}` +
      ` · moved up: ${metric(metrics.is_up)} · moved down: ${metric(metrics.is_down)}` +
      ` · no longer found: ${metric(metrics.is_lost)}`,
    WHOLE_DOMAIN_MEASUREMENT_NOTE,
  ].join("\n");
}

/** A domain-level metric: a grouped number, or an honest "n/a" when DataForSEO had none. */
function metric(value: number | null): string {
  return value === null ? "n/a" : thousands(value);
}

/**
 * How a row's rank is stated.
 *
 * `rank_group` is the organic rank and stays the headline number — it is what the product has
 * always printed and what "we rank #3" means. `rank_absolute` is appended only when the vendor
 * sent it AND it disagrees, because that disagreement is the whole point: it says a SERP feature
 * sits above this result, so the reader is not scrolling to #3. When they agree, repeating the
 * number would be noise on every single row.
 */
function renderPosition(row: RankedKeywordRow): string {
  const organic = row.position === null ? "n/a" : `#${row.position}`;
  if (row.absolute_position === null || row.absolute_position === row.position) {
    return `position ${organic}`;
  }
  return `position ${organic} organic (#${row.absolute_position} on the page)`;
}

/**
 * How this keyword moved since DataForSEO's previous check.
 *
 * `previous_rank_absolute` is on the ABSOLUTE scale, so the wording says "on the page" — the same
 * words this file already uses for `rank_absolute`. Quoting it as a bare "#18" beside an organic
 * "#3" would invite exactly the comparison the two scales do not support.
 *
 * A flag is reported even without a previous rank, because "moved down" is a fact on its own; a
 * change object with neither flag nor previous rank produces nothing rather than an empty clause.
 */
function renderMovement(change: RankChange): string | null {
  const from =
    change.previous_rank_absolute === null
      ? ""
      : ` from #${change.previous_rank_absolute} on the page`;
  if (change.is_new) return "newly ranking";
  if (change.is_down) return `moved down${from}`;
  if (change.is_up) return `moved up${from}`;
  if (change.previous_rank_absolute !== null) {
    return `previously #${change.previous_rank_absolute} on the page`;
  }
  return null;
}

/**
 * The SERP context line: how the ranking moved, what else is on that results page, and the link
 * to go and look.
 *
 * It is a SECOND line rather than more commas on the first. The metrics spine was already at
 * eight fields; three more — one of them a Google URL — would make a ~330-character line that no
 * reader scans and that costs the calling model real context on every one of a hundred rows.
 * Returns null when the vendor sent none of the three, so a sparse row stays one line.
 *
 * `serp_item_types` is printed MINUS "organic": every row here IS an organic ranking by
 * construction (the request pins `item_types`), so listing it back adds nothing. What remains is
 * the interesting part — `ai_overview`, `people_also_ask`, a video carousel — and it is the
 * direct explanation of the organic/on-page rank gap printed on the line above. The vendor's own
 * identifiers are kept verbatim; inventing friendlier names would be inventing a mapping.
 */
function renderSerpContext(row: RankedKeywordRow): string | null {
  const parts: string[] = [];
  const movement = row.rank_change === null ? null : renderMovement(row.rank_change);
  if (movement !== null) parts.push(movement);
  const features = row.serp_item_types.filter((type) => type !== "organic");
  if (features.length > 0) parts.push(`SERP also shows ${features.join(", ")}`);
  if (row.check_url !== null) parts.push(`verify: ${row.check_url}`);
  return parts.length === 0 ? null : `  ${parts.join(" · ")}`;
}

/**
 * One keyword line — plus, when there is something to say, an indented SERP-context line.
 *
 * `position`, `volume` and the URL keep their long-standing places (including their "n/a"), so a
 * reader's eye lands where it always did. Everything ADDED is omitted outright when the vendor
 * did not send it — research_keywords' rule — because a thousand rows of "CPC n/a, competition
 * n/a" is a thousand rows of nothing, and the fields being new is not a reason to pad them.
 *
 * `difficulty` and `intent` are worded exactly as research_keywords words them, because they are
 * the same two vendor fields; a caller who runs both tools must not have to work out that
 * "difficulty 26/100" and some other phrasing are the same number.
 *
 * DELIBERATELY NOT PRINTED: `serp_item.backlinks_info` and `serp_item.rank_info.page_rank`. Both
 * are paid and both are real, but analyze_backlinks is an entire 70-credit tool whose subject is
 * the backlink picture, and `page_rank` is a proprietary 0-100 score that would need explaining
 * every time it appeared. Two more numbers on an already dense line, restating another tool's
 * subject, with no decision attached to them: not every paid field earns a line.
 */
function renderRow(row: RankedKeywordRow): string {
  const parts = [
    renderPosition(row),
    `volume ${row.search_volume === null ? "n/a" : thousands(row.search_volume)}`,
  ];
  if (row.cpc !== null) parts.push(`CPC ${money(row.cpc)}`);
  if (row.competition_level !== null) parts.push(`competition ${row.competition_level}`);
  if (row.keyword_difficulty !== null) parts.push(`difficulty ${row.keyword_difficulty}/100`);
  if (row.main_intent !== null) {
    const also = row.foreign_intent.length > 0 ? ` (also ${row.foreign_intent.join(", ")})` : "";
    parts.push(`intent ${row.main_intent}${also}`);
  }
  if (row.etv !== null) parts.push(`est. traffic ${thousands(row.etv)}/mo`);
  // The request pins item_types to organic, so a non-organic type means the vendor returned
  // something else and the row is NOT the organic ranking the rest of the line describes.
  if (row.type !== null && row.type !== "organic") parts.push(`SERP element type ${row.type}`);
  parts.push(row.url ?? "n/a");
  const title = row.title === null ? "" : ` — "${row.title}"`;
  const head = `• ${row.keyword} — ${parts.join(", ")}${title}`;
  const context = renderSerpContext(row);
  return context === null ? head : `${head}\n${context}`;
}

/**
 * The vendor freshness line, reusing research_keywords' renderer rather than re-deriving it.
 *
 * ONE product, ONE answer to "how old is too old": that renderer already owns the timestamp
 * parsing, the oldest-row rule and the STALE_PULL_DAYS threshold it imports from gsc-data. The
 * shim below exists only because its parameter is typed to research_keywords' richer row and
 * that file is pinned — the fields this tool has no equivalent for are filled with the same
 * "absent" values the renderer would see for a keyword the vendor knows nothing extra about.
 * A second copy of the sentence would be free to drift from it; this cannot.
 */
function renderFreshness(rows: readonly RankedKeywordRow[], now: Date | undefined): string | null {
  return renderVendorFreshness(
    rows.map((row) => ({
      keyword: row.keyword,
      search_volume: row.search_volume,
      cpc: row.cpc,
      competition: null,
      competition_level: row.competition_level,
      keyword_difficulty: null,
      main_intent: null,
      foreign_intent: [],
      search_volume_trend: null,
      last_updated_time: row.last_updated_time,
      has_data: true,
    })),
    now,
  );
}

/**
 * How the output names what was looked up. `project` is present only when the caller passed a
 * project_id, so a bare-target call renders exactly as it always did.
 */
export interface RankedKeywordsRenderInput {
  readonly language_code: string;
  readonly location_code: number;
  readonly sort?: RankedKeywordsSort;
  readonly project?: ProjectRef | null;
}

/**
 * EVERY PER-ROW NUMERIC COLUMN THIS TABLE PRINTS, in the order {@link renderRow} prints them.
 *
 * `fieldLabel` is the word the row itself uses, never the vendor's raw field name, because the
 * reader has to find the column the note is about by scanning the table above it — `volume`, not
 * `search_volume`; `CPC`, not `cpc`.
 *
 * WHAT IS DELIBERATELY NOT HERE, and why each is a MEASURED exclusion rather than an oversight:
 *
 *   - `position` / `absolute_position` — `rank_group` and `rank_absolute` are 1-based: the first
 *     organic result is #1. A flat zero is not a value this scale can carry, so there is nothing
 *     to detect. (This is the S23 decision file's `rank 0`, narrowed by measurement.)
 *   - the domain health card's figures (`is_lost`, `is_new`, `count`, the position bands, the
 *     card's own `etv`) — ONE value each for the whole answer, not a column with a value per row.
 *     A "this never varied across the rows" claim cannot be made about a single number at all.
 *   - `rank_change` — rendered as WORDS ("moved up", "newly ranking"), not as a number. There is
 *     no printed zero to misread.
 *   - `competition_level` — a vendor BAND ("HIGH"), a string. Same reason.
 *
 * `est. traffic` carries `nonEnglishEvidence: false`: `etv` appears in no non-English vendor
 * response this repo has captured, so its note drops the clause about the vendor returning
 * non-zero values elsewhere rather than claiming evidence that is not here. The other three are
 * backed by `fixtures/keyword-overview-tr.json`, and the tests read that file rather than
 * trusting these flags.
 */
const FLAT_ZERO_COLUMNS: readonly FlatZeroColumn<RankedKeywordRow>[] = [
  {
    fieldLabel: "volume",
    misreadAs: "that nobody searches for any of these",
    nonEnglishEvidence: true,
    valueOf: (row) => row.search_volume,
    // `renderRow` prints this through `thousands`, which is Math.round + digit grouping.
    printedAs: Math.round,
  },
  {
    fieldLabel: "CPC",
    misreadAs: "that none of these keywords are worth anything to advertisers",
    nonEnglishEvidence: true,
    valueOf: (row) => row.cpc,
    // `money` keeps CENTS — a quoted price's own unit (format/quantities.ts, class 3's contrast).
    // So a cpc of 0.004 prints "$0.00" and IS a printed zero here.
    printedAs: (value) => Number(value.toFixed(2)),
  },
  {
    fieldLabel: "difficulty",
    misreadAs: "that every one of these keywords is easy to rank for",
    nonEnglishEvidence: true,
    valueOf: (row) => row.keyword_difficulty,
    // Printed verbatim as `difficulty N/100`; the vendor sends this one as an integer already.
    printedAs: (value) => value,
  },
  {
    fieldLabel: "est. traffic",
    misreadAs: "that none of these rankings bring you any visitors",
    nonEnglishEvidence: false,
    valueOf: (row) => row.etv,
    // `est. traffic N/mo`, also through `thousands`. THIS is the column finding B-2 was measured
    // on: three live rows at 0 < etv < 0.5 all printed 0 and said nothing.
    printedAs: Math.round,
  },
];

/**
 * WHAT `est. traffic` IS AND WHAT ITS DIGITS ARE WORTH (finding B-5).
 *
 * The sibling `my_pages` prints the same DataForSEO field, rounds it the same way, and has always
 * told the reader so; this surface rounded silently. Composed around the SHARED clause in
 * format/quantities.ts rather than restating it, so the two admissions cannot drift into saying
 * different things about one number.
 */
export const ETV_PRECISION_NOTE =
  "`est. traffic` is DataForSEO's own `etv` — its ESTIMATE of the monthly visits that ranking " +
  `earns, not a measurement of your traffic. It is shown to the nearest whole visit: ${MODEL_PRECISION_CLAUSE}.`;

/** Render the ranked keywords as the plain-text tool output (pure — unit-tested directly). */
export function formatRankedKeywords(
  result: RankedKeywordsResult,
  input: RankedKeywordsRenderInput,
  now?: Date,
): string {
  const where = `(language ${input.language_code}, location ${input.location_code})`;
  const subject = subjectLabel(result.target, input.project);
  const card = renderHealthCard(result.metrics);
  if (result.rows.length === 0) {
    // Zero is the thinnest result there is, so it gets the caveat too — it used to be the ONE
    // path that skipped it, and it is precisely the case this hint exists for. The health card
    // still prints when the vendor sent one: "no rows came back" and "this domain ranks for
    // nothing" are different claims, and the card is the evidence that separates them.
    const none = `No Google organic rankings on record for ${subject} ${where}.`;
    return (card === null ? none : `${none}\n\n${card}`) + localeHint(result.target, 0, input);
  }
  const lines = result.rows.map(renderRow);
  const shown = `${result.rows.length} ranked keyword${result.rows.length === 1 ? "" : "s"}`;
  // total_count is the domain's FULL ranked-keyword count, so the header is honest about the
  // request having been truncated by `limit` rather than implying these are all of them.
  const scope =
    result.total_count === null || result.total_count <= result.rows.length
      ? shown
      : `${shown} of ${thousands(result.total_count)}`;
  // items_count is what the VENDOR put in this result; rows.length is what survived projection.
  // A gap means keyword-less items were dropped, and saying so is the difference between a short
  // table and a short table the reader believes is complete.
  const dropped = result.items_count === null ? 0 : Math.max(0, result.items_count - result.rows.length);
  const droppedNote =
    dropped === 0 ? "" : ` (${dropped} returned row${dropped === 1 ? "" : "s"} carried no keyword and were dropped)`;
  const ordering = input.sort === undefined ? "" : `, ${SORT_LABEL[input.sort]}`;
  const heading = `Ranked keywords for ${subject} ${where} — ${scope}${ordering}${droppedNote}:`;
  const freshness = renderFreshness(result.rows, now);
  const body = lines.join("\n") + (freshness === null ? "" : `\n${freshness}`);
  // The heading sits DIRECTLY on the table when there is no card — a blank line the reader has
  // never seen is still a change to the output, even when nothing was added to it.
  const table = card === null ? `${heading}\n${body}` : `${heading}\n\n${card}\n\n${body}`;
  // total_count, NOT rows.length: a 2-row page of a 5,312-keyword domain is TRUNCATED, not thin,
  // and its locale is obviously fine. Only the domain's real ranking count can say otherwise.
  const withHint = table + localeHint(result.target, result.total_count ?? result.rows.length, input);
  // AT THE END, one note per column that never moved off 0 — see format/flat-zero.ts for what was
  // measured and what the sentence is forbidden to claim. The rows themselves are untouched: the
  // `!== null` tests in renderRow still decide whether a number appears at all, and every 0 still
  // prints exactly as the vendor sent it.
  const flat = flatZeroNotes(result.rows, FLAT_ZERO_COLUMNS, "keywords");
  // R-8.9, from the constant four tools share (format/search-volume.ts) — finding B-3. Only the
  // disclosure half: these rows are ordered by the caller's own `sort` (or the vendor's default),
  // NOT by search_volume, so the band sentence would describe an ordering this tool never makes.
  const withVolumeNote = `${withHint}\n\n${SEARCH_VOLUME_NOTE}`;
  // B-5. The `est. traffic` column is `etv` rounded to a whole visit, and until now this surface
  // rounded it and said nothing while the sibling `my_pages` said so plainly about the same vendor
  // field. Printed only when at least one row actually carried an estimate: an admission about a
  // column nobody was shown is noise. The load-bearing clause is the SHARED one.
  const withEtvNote =
    result.rows.some((row) => row.etv !== null)
      ? `${withVolumeNote}\n\n${ETV_PRECISION_NOTE}`
      : withVolumeNote;
  return flat.length === 0 ? withEtvNote : `${withEtvNote}\n\n${flat.join("\n\n")}`;
}

/**
 * Two-letter TLDs that IANA delegated to a country but whose registries sell them worldwide with
 * no local-presence requirement, and whose registrants are overwhelmingly not in that country.
 *
 * They break the two-letter test in the direction that MATTERS. Telling the owner of a `.io` SaaS
 * that their domain is "a two-letter country-code TLD" and that they should pass the location
 * code for "that country" is advice about the British Indian Ocean Territory — a wrong claim
 * stated in the confident voice the rest of the hint earns, and stated exactly when the result
 * was thin and the reader is most inclined to act on it.
 *
 * The list is short and deliberately errs toward EXCLUDING: a genuinely Colombian `.co` site
 * loses the TLD sentence but still gets the generic locale hint below, which is the whole
 * actionable half. Dropping a true clue costs a sentence; keeping a false one costs the reader
 * a 65-credit lookup pointed at the wrong country.
 */
const GENERIC_TWO_LETTER_TLDS: ReadonlySet<string> = new Set([
  "io",
  "ai",
  "co",
  "me",
  "tv",
  "cc",
  "fm",
  "gg",
  "ly",
  "sh",
  "to",
]);

/**
 * The domain's TLD when it is two letters AND is not one of the generically-marketed ones above,
 * otherwise null.
 *
 * Two letters is otherwise the whole test, and it is the whole claim the hint makes: IANA
 * delegates country-code TLDs as two-letter labels. What this deliberately does NOT do is map
 * that label to a DataForSEO location_code. Exactly two codes have been measured here (US 2840,
 * TR 2792) — that is a pair of data points, not a table — and a guessed code does not fail
 * loudly: it returns another country's rankings, which read as perfectly ordinary data.
 */
function twoLetterTld(domain: string): string | null {
  const tld = domain.slice(domain.lastIndexOf(".") + 1).toLowerCase();
  if (!/^[a-z]{2}$/.test(tld)) return null;
  return GENERIC_TWO_LETTER_TLDS.has(tld) ? null : tld;
}

/**
 * The locale caveat, appended ONLY when the result is thin AND the caller never chose a locale.
 * An explicit locale means the user already decided; repeating the hint there would be noise.
 *
 * When the domain carries a country-code TLD the hint NAMES it, because that is the case where
 * the US default is most likely to be wrong — and, since a project_id resolves to the caller's
 * own domain, the case where the caller never typed the domain at all.
 */
function localeHint(
  target: string,
  rankedCount: number,
  input: { language_code: string; location_code: number },
): string {
  const onDefaults =
    input.location_code === DEFAULT_LOCATION_CODE && input.language_code === DEFAULT_LANGUAGE_CODE;
  if (!onDefaults || rankedCount >= THIN_RESULT_ROWS) return "";
  // The zero-row line right above already says there are none, so repeating it here would be
  // both redundant and — with the original "Few results." — a contradiction. Only the populated
  // table needs the count called out, because the table itself does not characterise it.
  const opener = rankedCount === 0 ? "" : "Few results. ";
  const countryCode = twoLetterTld(target);
  const tldClause =
    countryCode === null
      ? "."
      : `, but ${target} is a .${countryCode} domain — a two-letter country-code TLD.`;
  const which = countryCode === null ? "another country" : "that country";
  return (
    `\n\n${opener}This looked up the United States in English (the default)${tldClause} If the ` +
    `site targets ${which}, pass location_code and language_code for it — rankings measured ` +
    "under the wrong locale can badly misrepresent how the site really performs in search."
  );
}

/**
 * One lookup, fetched once: the vendor result AND the text rendered from it.
 *
 * BOTH are returned because the engine must run EXACTLY ONCE. The handler needs the structural
 * result to record the run (migration 0027) and the text to reply with, and re-fetching for the
 * second of those would be a second PAID DataForSEO request AND a second measurement that merely
 * resembles the one the caller was shown — 0024's `AuditRendering` rule, with a vendor invoice
 * attached to getting it wrong.
 */
export interface RankedKeywordsRendering {
  readonly result: RankedKeywordsResult;
  readonly text: string;
}

/**
 * The paid body of one lookup: build the vendor query, fetch it, render it.
 *
 * Exported and DATABASE-FREE on purpose. The handler wraps this in withCredits, whose reserve
 * needs Supabase, so the fast lane can never observe what the handler hands the port. That gap
 * was MEASURED, not assumed: a mutation that hard-coded the port's `sort` — throwing away the
 * caller's ordering on every live call — left all 64 fast-lane specs green. This seam is what a
 * spec can hold on to.
 */
export async function fetchAndRenderRankedKeywords(
  port: RankedKeywordsPort,
  subject: { readonly domain: string; readonly project: ProjectRef | null },
  input: RankedKeywordsInput,
): Promise<RankedKeywordsRendering> {
  const result = await port.fetchRankedKeywords({
    target: subject.domain,
    limit: input.limit,
    sort: input.sort,
    language_code: input.language_code,
    location_code: input.location_code,
  });
  return {
    result,
    text: formatRankedKeywords(result, {
      language_code: input.language_code,
      location_code: input.location_code,
      sort: input.sort,
      project: subject.project,
    }),
  };
}

/** Dependencies — the ranked-keywords port is injectable so tests run offline (mock/disabled). */
export interface RankedKeywordsDeps {
  /**
   * The ranked-keywords port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: RankedKeywordsPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /**
   * The run recorder (default: the real `writeDomainLookupRun`). A PORT for the reason every
   * other writer in this family is one: a spec can make it FAIL without breaking a database, which
   * is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeRun?: DomainLookupRunWriter;
}

export function makeRankedKeywordsTool(deps: RankedKeywordsDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeDomainLookupRun;
  return defineTool<RankedKeywordsInput>({
    name: "ranked_keywords",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — resolve WHAT to look up: exactly one of project_id / target,
      // the project read tenant-scoped, the domain canonicalized by the shared normalizer. Every
      // rejection it returns costs nothing (see project-target.ts).
      const subject = await resolveTarget(
        ctx.userId,
        input,
        deps.loadProject ?? loadOwnProject,
      );
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      const port = deps.port ?? resolveDefaultRankedKeywordsPort();
      // Free pre-reserve gate 2 — refuse rather than reserve credits or serve mock data.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch ->
      // commit as one chain. A fetch failure throws, so withCredits releases (no charge).
      // WHICH PROJECT THE SPEND IS FOR, on the ledger row itself (migration 0033) — the
      // ownership-gated project resolved above. charge:"handler" settles its own credits, so
      // nothing upstream can supply this; undefined on a bare-target call is a REAL answer
      // ("no project scope"), never a gap (credits/guard.ts).
      const meta = { tool: "ranked_keywords", projectId: subject.project?.id } as const;
      return withCredits({ userId: ctx.userId }, meta, async () => {
        const rendered = await fetchAndRenderRankedKeywords(port, subject, input);
        // THE RUN IS RECORDED BEFORE THE REPLY IS RETURNED, and the write is NOT guarded
        // (migration 0027; dfs/runs.ts states the same contract from the other side). withCredits
        // commits a handler that RETURNS and releases one that THROWS, so an error escaping here
        // costs the tenant nothing. Caught and logged instead, the shape would be the house's
        // worst at 65 credits a call: a charged caller, a delivered table, and a panel that says
        // forever that the lookup never ran.
        //
        // `projectId` is null on a bare-target call — the commonest PAID call this tool serves,
        // and the one 0027 made project_id nullable to record. `target` is the RESOLVED domain,
        // never the caller's raw input: it is what was actually looked up, and for a project run
        // it is what the project's domain was AT THE TIME.
        await writeRun(
          {
            userId: ctx.userId,
            projectId: subject.project?.id ?? null,
            tool: "ranked_keywords",
            target: subject.domain,
          },
          rankedKeywordsRunReport(rendered.result, {
            limit: input.limit,
            sort: input.sort,
            language_code: input.language_code,
            location_code: input.location_code,
          }),
        );
        return textResult(rendered.text);
      });
    },
  });
}

/** The production ranked_keywords tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const rankedKeywordsTool = makeRankedKeywordsTool();
