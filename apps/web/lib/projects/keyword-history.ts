import { formatDate, formatNumber } from "../format";

/**
 * THE TENANT'S KEYWORD RESEARCH HISTORY — every `keyword_research_runs` row they own (migration
 * 0029), newest first, with a change-since-the-previous-run wherever two runs actually measured
 * the same thing. PURE — no I/O, no React, no Supabase client, so every decision below is
 * unit-tested directly (vitest has no RSC boundary; signed lesson 12). The twin of
 * `lookup-history.ts`, one table over.
 *
 * WHERE THIS SURFACE LIVES, AND WHERE IT DELIBERATELY DOES NOT. It is a second section of
 * /app/lookups, the account's lookup history, and it is NOT on the project card. research_keywords
 * takes no project — its input is `keywords` + a locale and nothing else — so there is no project
 * to scope a card line to, and putting one there would mean inventing a project↔keyword-set
 * relation the tool never established (constitution NEVER #7 in its quietest form). It gets its own
 * TABLE rather than rows in the domain one for the same reason 0029 is a separate migration: every
 * column of that table's row — the domain, the "ran for" scope — is a domain-shaped concept a
 * keyword-set run has no value for, and a union row with two dead columns per run is not a shared
 * shape, it is two tables drawn on top of each other.
 *
 * ── WHAT MAY HONESTLY BE SUBTRACTED FROM WHAT ───────────────────────────────────────────────
 *
 * A change is a SUBTRACTION, and subtracting two numbers that count different things manufactures
 * a measurement the panel never made. `lookup-history.ts` states the rule; the answer is different
 * here because the subject is a SET, so three things must match before two totals may be
 * subtracted, and each is a decision rather than caution:
 *
 *   THE KEYWORD SET, exactly. 0029's `keyword_set` is already normalized — de-duplicated, sorted,
 *   lowercased — so two runs of the same keywords in any order and any casing ARE the same
 *   subject. A 40-keyword list and its 39-keyword subset are NOT: the comparable number a
 *   set-shaped run carries is an aggregate, and subtracting the aggregate of 39 keywords from that
 *   of 40 would print "+2,400 searches a month" when the tenant merely added a keyword. That is
 *   the same defect compare_competitors is refused a change clause for, in a different shape.
 *
 *   THE LOCALE. Search volume is per market; ranked_keywords' own THIN_RESULT_ROWS warning is a
 *   measured case of the same thing on the other table. A run whose stored locale cannot be read
 *   is comparable with nothing, because guessing the missing half is how a delta between two
 *   different search markets gets printed as growth.
 *
 *   THE COVERAGE — `answered`, the number of keywords the vendor actually held metrics for. This
 *   is the one condition `lookup-history.ts` has no analogue of, and it is here because
 *   `report.total` is a SUM ACROSS THE ANSWERED ROWS: a keyword crossing from "no data" to "data"
 *   adds its whole volume to that sum, and reporting it as demand growth would be the panel
 *   asserting a measurement nobody made. Two runs of the same set that answered different numbers
 *   of keywords therefore get no change at all. That is deliberately conservative — it suppresses
 *   some real changes — and the direction is chosen: a missing clause is a gap, a wrong clause is
 *   a lie.
 *
 * WHAT A TRUNCATED WINDOW CANNOT SEE, AND HOW THE PAGE KNOWS. `lookup-history.ts`'s mechanism,
 * unchanged and for the same measured reason: the read asks for `limit + 1` and the extra row is a
 * PROBE whose existence is the whole measurement, because `rows.length >= limit` cannot tell "the
 * tenant has 201 runs" from "the tenant has exactly 200 and this page shows every one". The probe
 * is dropped after the sort (so what leaves is the OLDEST run) and before the change pass (so
 * every change on this page names a run that is ON this page).
 */

/**
 * How many runs one section shows. 200, matching the domain half: a row here is a handful of small
 * fields (no vendor payload — see the query's own comment), and there is no paging on this surface.
 * It is a CEILING, disclosed in the page copy the moment it bites.
 */
export const KEYWORD_RUN_HISTORY_LIMIT = 200;

/**
 * One `keyword_research_runs` row as the page reads it: two real columns plus the report
 * SUB-FIELDS the query aliases out of the jsonb. Everything from the jsonb is `unknown` — it is a
 * schemaless column whose contents derive from a THIRD PARTY's payload, so it is type-guarded here
 * rather than trusted (`lookups.ts`'s rule, same family).
 *
 * `requested` and `returned` are in the report and deliberately NOT read: the two facts a reader
 * needs are how many keywords the run is ABOUT (the column's own length) and how many the vendor
 * answered, and every extra sub-select is another field on a 200-row read that nothing renders.
 */
export interface KeywordRunHistoryRow {
  /** The run's subject: the normalized keyword set, straight out of the column. */
  readonly keyword_set: string[];
  readonly created_at: string;
  /** `report->total` — total monthly searches across the answered keywords. */
  readonly total: unknown;
  /** `report->answered` — how many keywords the vendor held metrics for. */
  readonly answered: unknown;
  /** `report->top` — the highest-volume answered keyword. Null when there was none. */
  readonly top: unknown;
  /** `report->locale` — the market the run asked in; half of the comparison key. */
  readonly locale: unknown;
}

/** The locale a run declared, once it has been read out of the report. */
export interface KeywordRunLocaleView {
  readonly languageCode: string;
  readonly locationCode: number;
}

/** A measured change against the run immediately before this one, in the same comparison group. */
export interface KeywordRunChange {
  readonly delta: number;
  readonly previousTotal: number;
  readonly previousCreatedAt: string;
}

/** One run as the page lists it. */
export interface KeywordRunHistoryEntry {
  /** The keywords the run is about, in the stored (sorted) order. Never re-ordered here. */
  readonly keywords: readonly string[];
  readonly createdAt: string;
  /** Total monthly searches, or null when the stored figure could not be read. */
  readonly total: number | null;
  /** How many of the keywords the vendor answered, or null when unreadable. */
  readonly answered: number | null;
  /** The headline keyword, already reduced to text, or null when there was none. */
  readonly headline: string | null;
  readonly locale: KeywordRunLocaleView | null;
  /** Null whenever a change would not be like-with-like — see the module header. */
  readonly change: KeywordRunChange | null;
}

/** The page's whole input: the runs it lists, plus what it measured beyond them. */
export interface KeywordRunHistory {
  /** At most `limit` runs, newest first. The probe row, if any, is not among them. */
  readonly entries: readonly KeywordRunHistoryEntry[];
  /**
   * True when a run OLDER than the last listed one was actually SEEN — the overflow probe came
   * back. Not "the read came back full", which could not tell 201 runs from exactly 200.
   */
  readonly windowFull: boolean;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * `report->locale`, type-guarded. BOTH fields or nothing: a half-read locale cannot say whether
 * two runs asked the same question, and guessing the missing half is how a delta between two
 * different search markets gets printed as growth.
 */
function readLocale(value: unknown): KeywordRunLocaleView | null {
  const record = asRecord(value);
  if (record === null) return null;
  const language = asText(record.language_code);
  const location = asFiniteNumber(record.location_code);
  if (language === null || location === null) return null;
  return { languageCode: language, locationCode: location };
}

/**
 * `report->top` as one clause, or null when it is absent or unreadable.
 *
 * A run whose `top` did not parse still shows its totals, which is the half the reader came for.
 * The VOLUME is printed only when the vendor gave one: `top` is chosen from the answered rows, so
 * a null there means the vendor held the keyword but not its volume, and printing 0 would be the
 * panel inventing a figure (`lookups.ts`'s null-is-not-zero rule, same family).
 */
function headlineOf(top: unknown): string | null {
  const record = asRecord(top);
  if (record === null) return null;
  const keyword = asText(record.keyword);
  if (keyword === null) return null;
  const volume = asFiniteNumber(record.search_volume);
  return volume === null ? `“${keyword}”` : `“${keyword}” (${formatNumber(volume)}/mo)`;
}

/** Sortable instant; unparseable stamps sort last rather than poisoning the order with NaN. */
function instantOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Newest first. Written as an explicit three-way rather than `b - a` because two unparseable
 * stamps are both `-Infinity`, and `-Infinity - -Infinity` is NaN — a comparator returning NaN
 * leaves the whole order unspecified.
 */
function newestFirst(left: KeywordRunHistoryRow, right: KeywordRunHistoryRow): number {
  const a = instantOf(left.created_at);
  const b = instantOf(right.created_at);
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

interface Draft {
  readonly row: KeywordRunHistoryRow;
  readonly locale: KeywordRunLocaleView | null;
  readonly total: number | null;
  readonly answered: number | null;
  readonly group: string | null;
  /** False when `created_at` did not parse: such a run cannot be placed in a sequence at all. */
  readonly ordered: boolean;
}

/**
 * The GROUP two runs must share before their totals may be subtracted, or null when this run's
 * total is comparable with nothing at all. Set + locale + coverage — the module header argues each.
 *
 * NUL-joined at every seam: a normalized keyword cannot contain one (0029's normalizer collapses
 * whitespace and the vendor's own keywords are plain text), so no two different groups can collide
 * into one key — the trap a comma or a space would walk straight into with ["a,b"] vs ["a","b"].
 */
function comparisonGroup(draft: {
  readonly keywords: readonly string[];
  readonly locale: KeywordRunLocaleView | null;
  readonly answered: number | null;
}): string | null {
  if (draft.keywords.length === 0) return null;
  if (draft.locale === null || draft.answered === null) return null;
  return [
    draft.keywords.join("\u0000"),
    draft.locale.languageCode,
    String(draft.locale.locationCode),
    String(draft.answered),
  ].join("\u0000\u0000");
}

/**
 * Build the history one section shows.
 *
 * NEWEST FIRST is re-decided here rather than merely trusted from the query, for the reason
 * `buildDomainLookupHistory` gives: the query's `.order(...)` is pinned by its own spec, but THIS
 * function is what the page is actually built from and is the only half a pure spec can execute.
 *
 * THE CHANGE PASS runs OLDEST to NEWEST and remembers, per comparison group, only the run
 * immediately before. "Since the previous run" therefore means exactly that — never "since the
 * last run whose numbers happened to be readable", which would silently skip a run and label the
 * result with the wrong interval. A run whose own total is unreadable, or whose timestamp did not
 * parse, breaks its group's chain.
 *
 * `rows` may carry ONE MORE than `limit` — the read's overflow probe. It is sorted with the rest
 * and then cut, so what leaves is the oldest run rather than whichever row arrived last, and it is
 * cut BEFORE the change pass so nothing on the page can be measured against a run the page does
 * not list.
 */
export function buildKeywordRunHistory(
  rows: readonly KeywordRunHistoryRow[],
  limit: number = KEYWORD_RUN_HISTORY_LIMIT,
): KeywordRunHistory {
  const ordered = [...rows].sort(newestFirst);
  const listed = ordered.slice(0, limit);
  const drafts: Draft[] = listed.map((row) => {
    const locale = readLocale(row.locale);
    const answered = asFiniteNumber(row.answered);
    const keywords = Array.isArray(row.keyword_set) ? row.keyword_set : [];
    return {
      row,
      locale,
      total: asFiniteNumber(row.total),
      answered,
      group: comparisonGroup({ keywords, locale, answered }),
      ordered: !Number.isNaN(Date.parse(row.created_at)),
    };
  });

  const changes = new Map<Draft, KeywordRunChange>();
  const previous = new Map<string, { readonly total: number | null; readonly createdAt: string }>();
  for (let index = drafts.length - 1; index >= 0; index -= 1) {
    const draft = drafts[index] as Draft;
    if (draft.group === null) continue;
    const prior = previous.get(draft.group);
    if (draft.ordered && draft.total !== null && prior !== undefined && prior.total !== null) {
      changes.set(draft, {
        delta: draft.total - prior.total,
        previousTotal: prior.total,
        previousCreatedAt: prior.createdAt,
      });
    }
    previous.set(draft.group, {
      total: draft.ordered ? draft.total : null,
      createdAt: draft.row.created_at,
    });
  }

  return {
    entries: drafts.map((draft) => ({
      keywords: Array.isArray(draft.row.keyword_set) ? draft.row.keyword_set : [],
      createdAt: draft.row.created_at,
      total: draft.total,
      answered: draft.answered,
      headline: headlineOf(draft.row.top),
      locale: draft.locale,
      change: changes.get(draft) ?? null,
    })),
    // The PROBE ANSWERED: a run older than the last listed one really was seen. Strictly greater,
    // because a read that came back with exactly `limit` rows saw no such run.
    windowFull: ordered.length > limit,
  };
}

/**
 * The one line of numbers a run shows, or null when nothing about it could be read.
 *
 * "N of M answered" is stated whenever the vendor answered for fewer keywords than the run asked
 * about, and it is NOT decoration: `total` is a sum over the answered rows, so a reader comparing
 * two runs by eye needs to see when the coverage moved. When every keyword was answered the clause
 * is omitted rather than padded with a reassuring "4 of 4".
 */
export function summarizeKeywordRun(entry: KeywordRunHistoryEntry): string | null {
  const count = entry.keywords.length;
  if (count === 0) return null;
  const subject = `${count} keyword${count === 1 ? "" : "s"}`;
  if (entry.total === null) return subject;
  const coverage =
    entry.answered !== null && entry.answered < count ? `, ${entry.answered} answered` : "";
  const headline = entry.headline === null ? "" : ` · biggest: ${entry.headline}`;
  return `${subject}${coverage} · ${formatNumber(entry.total)} searches/mo${headline}`;
}

/**
 * The change as one English clause. A ZERO delta is stated ("no change since …") rather than
 * printed as "+0": the two read identically to a skimming eye, and "no change" is the finding.
 */
export function describeKeywordRunChange(change: KeywordRunChange): string {
  const since = `since ${formatDate(change.previousCreatedAt)} (${formatNumber(change.previousTotal)})`;
  if (change.delta === 0) return `no change ${since}`;
  return `${change.delta > 0 ? "+" : ""}${formatNumber(change.delta)} ${since}`;
}
