import { formatNumber } from "../format";

/**
 * THE TENANT'S DISCOVERY AND AI-VISIBILITY HISTORY — every `subject_lookup_runs` row they own
 * (migration 0032), newest first. PURE — no I/O, no React, no Supabase client, so every decision
 * below is unit-tested directly (vitest has no RSC boundary; signed lesson 12). The third of the
 * three history modules behind /app/lookups, beside `lookup-history.ts` and `keyword-history.ts`.
 *
 * ── WHERE THIS SURFACE LIVES, AND WHY IT IS A THIRD SECTION RATHER THAN A THIRD PAGE ────────
 *
 * /app/lookups already argues its own shape twice, and this section is decided against both
 * arguments rather than by taste:
 *
 *   IT IS ON THAT PAGE, because the page exists for one question — "what have I spent DataForSEO
 *   credits on" — and these three tools are DataForSEO lookups charged 40 to 900 credits a call.
 *   /app/rankings was given a page of its own on the opposite ground: a SERIES is not a RUN LOG,
 *   and a rank tracker's whole subject is a line over time. These rows are a run log, the same
 *   kind of thing the two sections already there are.
 *
 *   IT IS ITS OWN SECTION, because the page's own header states when a union row is "two tables
 *   drawn on top of each other": when the shared table's columns would be dead on the new rows.
 *   They would be, in both directions. The domain table's `Domain` column is blank on every
 *   keyword and seed-set row, and its `Lookup` column carries a tool vocabulary that does not
 *   overlap with this one; the keyword table's `Keywords` column is blank on every domain row and
 *   it has no column for a platform or a mode. What this table needs and neither has is the pair
 *   that IS 0032's identity — the KIND of subject beside the subject itself.
 *
 * ── WHY NO RUN HERE GETS A CHANGE CLAUSE, AND WHY THAT IS AN ANSWER RATHER THAN A GAP ───────
 *
 * `lookup-history.ts` states the rule: a change is a SUBTRACTION, and subtracting two numbers that
 * count different things manufactures a measurement the panel never made (NEVER #7). It refuses
 * `compare_competitors` a change clause on that ground, and this week refused three more —
 * `backlink_changes`, `disavow_candidates` and `my_pages` — each for a stated reason. All three
 * tools here are refused too, and the reasons are DIFFERENT from each other, which is why there is
 * no `change` field on the entry at all rather than one that is null on every row (0026's rule:
 * a field with one value on every row states nothing).
 *
 *   discover_keywords — REFUSED, for `my_pages`' reason at greater strength. Its `total` is
 *   DataForSEO's count of "keywords matching THIS LOOKUP", and what "this lookup" means moves with
 *   FIVE caller-chosen dimensions beyond the subject: the mode, the two optional vendor filters
 *   (`min_volume`, `max_difficulty`), `related`'s depth and `for_site`'s `include_subdomains`.
 *   Every one of them changes what is counted, and this read fetches none of them into a
 *   comparison key. There is a second and worse reason, which applies even when all five match: on
 *   three of the four modes the count is of keywords the VENDOR generated — ideas, suggestions,
 *   related terms — so a delta on it says "DataForSEO's index moved", and printing that as
 *   "+400 keywords" beside a tenant's own domain would read as something they did.
 *
 *   ai_visibility — REFUSED, and this is the strongest refusal of the three because it is about
 *   not knowing what the numbers MEAN. No response from the LLM Mentions family has ever been
 *   captured in this repo; the port carries each row as `vendor_metrics`, an open bag of scalars
 *   under the vendor's own keys, precisely because nobody here can name them. `total` is the
 *   vendor's count of rows whose meaning is unestablished. Subtracting two numbers whose meaning
 *   is unestablished is the purest form of the manufactured measurement the rule exists to stop —
 *   and unlike the others it could not even be repaired by fetching a richer key.
 *
 *   ai_visibility_compare — REFUSED, and its rows carry no `total` at all to subtract. The
 *   vendor's whole-set count on a comparison spans EVERY compared target, so the writer
 *   deliberately does not store it per subject (dfs/subject-runs.ts). What a compare row does
 *   carry is `answered`, which is a FACT about that target and not a difference between two runs;
 *   it is shown as such.
 *
 * A change clause becomes possible the day a response from that vendor family is captured and its
 * fields are named, or the day this read fetches discover_keywords' full criteria. Both are left
 * undone deliberately and are recorded here rather than pretended away — `lookup-history.ts` says
 * the same about `disavow_candidates`.
 *
 * ── WHAT A TRUNCATED WINDOW CANNOT SEE ──────────────────────────────────────────────────────
 *
 * The read is bounded, and it asks for `limit + 1` so the section can say out loud when older runs
 * exist — the two siblings' mechanism, kept for the same measured reason: `rows.length >= limit`
 * cannot tell "the tenant has 201 runs" from "the tenant has exactly 200 and this page shows every
 * one of them". The extra row is a PROBE, dropped after the sort so what leaves is the OLDEST run.
 * It carries less weight here than next door, since no change is computed from it either way, but
 * the CEILING itself still has to be honest: one ai_visibility_compare call writes up to TEN rows,
 * so this section reaches its ceiling far faster than a section counting calls would.
 */

/**
 * How many runs one section shows. 200, matching both siblings — a row here is a handful of small
 * fields (no vendor payload; see the query's own comment) and there is no paging on this surface.
 */
export const SUBJECT_RUN_HISTORY_LIMIT = 200;

/**
 * One `subject_lookup_runs` row as the page reads it: four real columns plus the report SUB-FIELDS
 * the query aliases out of the jsonb. Everything from the jsonb is `unknown` — it is a schemaless
 * column whose shape differs per tool AND whose contents derive from a THIRD PARTY's payload, so
 * it is type-guarded here rather than trusted (`lookups.ts`'s rule, same family).
 *
 * Several of these are null on rows of the other tools, BY DESIGN and not by accident: `mode` is
 * discover_keywords' alone, `platform` belongs to the two AI tools, `answered` and
 * `compared_target_count` to the comparison only. That is what a per-tool report means, and it is
 * why every reader below narrows on `tool` first.
 */
export interface SubjectRunHistoryRow {
  readonly tool: string;
  readonly subject_kind: string;
  readonly subject: string[];
  /** NULL on every row whose subject named no project — the COMMON case here (0032). */
  readonly project_id: string | null;
  readonly created_at: string;
  /** `report->mode` — discover_keywords only: WHICH question was asked about the subject. */
  readonly mode: unknown;
  /** `report->platform` — the two AI tools only: WHICH assistant the answer is scoped to. */
  readonly platform: unknown;
  /** `report->total` — the vendor's whole-set count. Absent on a compare row, by design. */
  readonly total: unknown;
  /** `report->shown` — rows this run carried, before the writer's cap. */
  readonly shown: unknown;
  /** `report->answered` — compare only: did the vendor report on THIS target at all. */
  readonly answered: unknown;
  /** `report->top` — discover_keywords' headline keyword. Null on an empty window. */
  readonly top: unknown;
  /** `report->locale` — two different shapes, one per vendor family. See `readMarket`. */
  readonly locale: unknown;
  /** `report->compared_target_count` — compare only: how many targets that one call covered. */
  readonly compared_target_count: unknown;
}

/** One run as the page lists it. There is deliberately no `change` — see the module header. */
export interface SubjectRunHistoryEntry {
  /** The raw `tool` value; not narrowed, so a row this build does not know about still shows. */
  readonly tool: string;
  /** The raw `subject_kind`; same rule. Read TOGETHER with `subject` — that pair is the identity. */
  readonly subjectKind: string;
  readonly subject: readonly string[];
  /** Where the request came from — never a claim about what was measured. */
  readonly scope: "project" | "bare-subject";
  readonly createdAt: string;
  /** WHAT WAS ASKED about the subject: the mode, or the assistant. Null when unreadable. */
  readonly question: string | null;
  /** The run's one line of numbers, or null when the report could not be read. */
  readonly summary: string | null;
  /** The market the run asked in, already reduced to text. Null when unreadable or not carried. */
  readonly market: string | null;
}

/** The page's whole input: the runs it lists, plus what it measured beyond them. */
export interface SubjectRunHistory {
  /** At most `limit` runs, newest first. The probe row, if any, is not among them. */
  readonly entries: readonly SubjectRunHistoryEntry[];
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
 * `report->locale`, in EITHER of the two shapes this table carries — and that is the vendor's
 * doing, not a slip. The Labs family (discover_keywords) takes a numeric `location_code`; the LLM
 * Mentions family takes a string `location_name`, and both of its fields are optional on the wire.
 * 0032's header is why the two live in the report rather than in one column with two meanings.
 *
 * BOTH HALVES OR NOTHING within a shape: a half-read locale names no market, and filling in the
 * missing half is how one market's figures get shown under another's name.
 */
export function readMarket(value: unknown): string | null {
  const record = asRecord(value);
  if (record === null) return null;
  const language = asText(record.language_code);
  const code = asFiniteNumber(record.location_code);
  if (code !== null) return language === null ? null : `${language} · ${code}`;
  const name = asText(record.location_name);
  if (name === null && language === null) return null;
  // The mentions locale is optional on BOTH halves, so one alone is a real, complete answer here —
  // "asked in English, no location given" is what the request actually was.
  return name === null ? `${language}` : language === null ? name : `${language} · ${name}`;
}

/**
 * WHAT WAS ASKED about the subject, narrowed on the TOOL. discover_keywords' four modes and the
 * two assistants are different vocabularies, and neither is recoverable from `subject_kind`:
 * "suggestions" and "related" both produce a keyword subject.
 */
export function questionOf(row: SubjectRunHistoryRow): string | null {
  if (row.tool === "discover_keywords") return asText(row.mode);
  return asText(row.platform);
}

/** The vendor's whole-set count as one clause, or the honest silence. Never a substituted zero. */
function totalClause(total: unknown): string {
  const value = asFiniteNumber(total);
  return value === null
    ? "DataForSEO did not say how many match in total"
    : `${formatNumber(value)} matching in total`;
}

/** discover_keywords' headline keyword, or null. A missing volume prints no volume, never a 0. */
function headlineOf(top: unknown): string | null {
  const record = asRecord(top);
  if (record === null) return null;
  const keyword = asText(record.keyword);
  if (keyword === null) return null;
  const volume = asFiniteNumber(record.search_volume);
  return volume === null ? `“${keyword}”` : `“${keyword}” (${formatNumber(volume)}/mo)`;
}

/**
 * The one line of numbers a run shows, narrowed on the TOOL — or null when nothing about it could
 * be read.
 *
 * A row whose report is unreadable shows its subject and NO numbers. The stored counters are the
 * vendor's answer projected once; a missing one means "not readable", which is not the same claim
 * as "nothing was found".
 */
export function summarizeSubjectRun(row: SubjectRunHistoryRow): string | null {
  const shown = asFiniteNumber(row.shown);
  if (row.tool === "ai_visibility_compare") {
    const count = asFiniteNumber(row.compared_target_count);
    const others = count === null ? null : count - 1;
    const scope =
      others === null
        ? "compared side by side"
        : `compared with ${formatNumber(others)} other target${others === 1 ? "" : "s"}`;
    // ANSWERED IS A FACT ABOUT THIS TARGET, not a difference between two runs — and the one thing
    // the tenant paid 90 credits to learn that a missing row could not tell them.
    if (row.answered === false) {
      return `${scope} · DataForSEO reported nothing for this one — unanswered, not zero`;
    }
    if (row.answered !== true || shown === null) return scope;
    return `${scope} · ${formatNumber(shown)} row${shown === 1 ? "" : "s"} from DataForSEO`;
  }
  if (shown === null) return null;
  if (row.tool === "ai_visibility") {
    return `${formatNumber(shown)} row${shown === 1 ? "" : "s"} · ${totalClause(row.total)}`;
  }
  if (row.tool === "discover_keywords") {
    const headline = headlineOf(row.top);
    const head = `${formatNumber(shown)} keyword${shown === 1 ? "" : "s"} in this window · ${totalClause(row.total)}`;
    return headline === null ? head : `${head} · biggest: ${headline}`;
  }
  // A tool this build does not know about still lists, with the one figure every report carries.
  return `${formatNumber(shown)} rows`;
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
function newestFirst(left: SubjectRunHistoryRow, right: SubjectRunHistoryRow): number {
  const a = instantOf(left.created_at);
  const b = instantOf(right.created_at);
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/**
 * Build the history one section shows.
 *
 * NEWEST FIRST is re-decided here rather than merely trusted from the query, for the reason both
 * siblings give: the query's `.order(...)` is pinned by its own spec, but THIS function is what
 * the page is actually built from and is the only half a pure spec can execute.
 *
 * `rows` may carry ONE MORE than `limit` — the read's overflow probe. It is sorted with the rest
 * and then cut, so what leaves is the OLDEST run rather than whichever row arrived last.
 */
export function buildSubjectRunHistory(
  rows: readonly SubjectRunHistoryRow[],
  limit: number = SUBJECT_RUN_HISTORY_LIMIT,
): SubjectRunHistory {
  const ordered = [...rows].sort(newestFirst);
  return {
    entries: ordered.slice(0, limit).map((row) => ({
      tool: row.tool,
      subjectKind: row.subject_kind,
      subject: Array.isArray(row.subject) ? row.subject : [],
      // WHERE THE REQUEST CAME FROM. "bare-subject" rather than the domain table's "bare-target",
      // because a row here may be about a keyword or a seed set and calling those a target would
      // name something the run never had.
      scope: row.project_id === null ? "bare-subject" : "project",
      createdAt: row.created_at,
      question: questionOf(row),
      summary: summarizeSubjectRun(row),
      market: readMarket(row.locale),
    })),
    // The PROBE ANSWERED: a run older than the last listed one really was seen. Strictly greater,
    // because a read that came back with exactly `limit` rows saw no such run.
    windowFull: ordered.length > limit,
  };
}

/**
 * How a subject_kind reads to somebody who never saw the schema. The KIND is half the identity —
 * "seo tools" as a keyword and "seo tools" as a seed for an ideas lookup are different subjects —
 * so it is printed rather than left for the reader to infer from the tool.
 */
export function describeSubjectKind(kind: string, count: number): string {
  if (kind === "domain") return "domain";
  if (kind === "keyword") return "keyword";
  if (kind === "keyword_set") return `${count} seed keyword${count === 1 ? "" : "s"}`;
  // An unknown kind prints ITSELF rather than a guess: a row this build does not understand is
  // still a row the tenant paid for, and inventing a label for it would be the panel asserting
  // something it did not read.
  return kind;
}
