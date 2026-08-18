import { formatDate, formatNumber } from "../format";
import {
  DOMAIN_LOOKUP_TOOLS,
  summarizeDomainLookupRun,
  type DomainLookupTool,
} from "./lookups";

/**
 * THE TENANT'S DOMAIN LOOKUP HISTORY — every `domain_lookup_runs` row they own, newest first,
 * with a change-since-the-previous-run wherever two runs actually measured the same thing.
 * PURE — no I/O, no React, no Supabase client, so every decision below is unit-tested directly
 * (vitest has no RSC boundary; signed lesson 12).
 *
 * WHY THIS SURFACE EXISTS, and it is a hole rather than a nice-to-have. Until now the ONLY reader
 * of 0027's table was the project card (`lookups.ts` / `page.tsx`'s `latestDomainLookupRun`),
 * which filters `.eq("project_id", projectId)` and takes `.limit(1)`. Both halves of that leave
 * paid measurements unreadable:
 *
 *   - `project_id` is NULLABLE and 0027's header states that the BARE-TARGET call — looking up
 *     somebody else's domain — is the commonest paid call these three tools serve. Every one of
 *     those rows is invisible in the product: 65-90 credits spent, a row written, and no surface
 *     that shows it to the tenant who paid. This page is the first reader of them.
 *   - `.limit(1)` means only the newest run per tool per project is ever visible, so "what did
 *     this domain look like last month" — 0027's own stated motivation — could not be asked.
 *
 * COMPARING LIKE WITH LIKE, which is the only interesting decision in this module. A change is a
 * SUBTRACTION, and subtracting two numbers that count different things manufactures a measurement
 * the panel never made (constitution NEVER #7). So a change is shown only between two runs whose
 * `total` is derived from the same question. What each report's `total` actually is, read from the
 * write path rather than assumed:
 *
 *   - ranked_keywords — `RankedKeywordsRunReport.total` is DataForSEO's `total_count`, "the full
 *     ranked-keyword count before `limit` truncation" (apps/mcp/src/dfs/ranked-keywords.ts:226,
 *     stored by runs.ts). The vendor request carries `target`, `limit`, `order_by`, `item_types`
 *     and the LOCALE PAIR (`language_code` + `location_code`,
 *     apps/mcp/src/dfs/ranked-keywords.ts:517-534). `limit` truncates the rows and not the count;
 *     `order_by` only orders; `item_types` is a constant. The locale is the one caller-chosen
 *     parameter the count varies with — and the tool's own THIN_RESULT_ROWS warning is a measured
 *     case of exactly that (adstark.com.tr: 3 rows on the US default, a full set at tr/2792). So
 *     two ranked_keywords runs are comparable when they share the TARGET and the LOCALE, and a run
 *     whose stored locale cannot be read is comparable with nothing.
 *   - analyze_backlinks — `BacklinksRunReport.total` is `profile.summary.backlinks`, and the
 *     summary comes from `/v3/backlinks/summary/live` whose request body is `{ target }` alone
 *     (apps/mcp/src/dfs/backlinks.ts). `limit` reaches only the two lists beside it, and that
 *     endpoint takes no locale at all — which is why `BacklinksRunReport` deliberately carries no
 *     `locale` key. Two runs are therefore comparable on the TARGET alone.
 *   - compare_competitors — NO CHANGE IS EVER SHOWN, and this is the one rule here that is a
 *     refusal rather than a scoping. `CompetitorsRunReport.total` is documented as "our own count
 *     of the table's rows" (apps/mcp/src/dfs/runs.ts): 1 target plus the rivals, where the rivals
 *     are either the caller's own list or a discovery capped by the caller's `limit`. A delta on
 *     it would read as "you gained two competitors" when the caller merely typed a longer list.
 *     The number is honest; the SUBTRACTION would not be.
 *
 * WHY `project_id` IS NOT PART OF THE COMPARISON KEY. `target` is the resolved, normalized domain
 * the lookup RAN AGAINST, whichever input produced it (0027's column comment), so a project run
 * and a bare-target run of the same domain in the same locale measured the same thing and their
 * totals subtract honestly. `project_id` records WHERE THE REQUEST CAME FROM, not what was
 * measured, and keying on it would hide real comparisons behind a provenance label. It is still
 * shown on every row — see `scope` — because "this run was not run for any project of yours" is a
 * fact the reader needs, and it is never dressed up: nothing here joins to `projects` to invent a
 * name for a row that has no project.
 *
 * WHAT A TRUNCATED WINDOW CANNOT SEE. The read is bounded (`DOMAIN_LOOKUP_HISTORY_LIMIT`), so the
 * OLDEST rows in the window may well have earlier comparable runs that were left outside it. Such
 * a row gets no change, which is indistinguishable from "this is the first run of its kind" — so
 * `windowFull` is returned and the page says so out loud rather than letting the absence read as a
 * measurement.
 */

/**
 * How many runs one page shows.
 *
 * 200 rather than the reports list's 50: a row here is four small fields (no vendor payload — see
 * the query's own comment), and these three tools are the product's most expensive calls, so a
 * tenant reading their spend history wants more than a fortnight of it. It is a CEILING, not a
 * page size: there is no paging on this surface (the reports list's YAGNI, same reasoning), and
 * the ceiling is disclosed in the page copy the moment it bites.
 */
export const DOMAIN_LOOKUP_HISTORY_LIMIT = 200;

/**
 * One `domain_lookup_runs` row as the history page reads it: four real columns plus the report
 * SUB-FIELDS the query aliases out of the jsonb. Everything from the jsonb is `unknown` — it is a
 * schemaless column whose shape differs per tool AND whose contents derive from a THIRD PARTY's
 * payload, so it is type-guarded here rather than trusted (`lookups.ts`'s rule, same table).
 */
export interface DomainLookupHistoryRow {
  readonly tool: string;
  readonly target: string;
  /** NULL on a bare-target run — the commonest paid call these tools serve (0027). */
  readonly project_id: string | null;
  readonly created_at: string;
  /** `report->total` — the headline count the tool's own first sentence prints. */
  readonly total: unknown;
  /** `report->top` — the single headline row, shaped per tool. Null on an empty result. */
  readonly top: unknown;
  /** `report->locale` — present on two of the three reports; absent by design on backlinks. */
  readonly locale: unknown;
}

/** The locale a run declared, once it has been read out of the report. */
export interface DomainLookupLocaleView {
  readonly languageCode: string;
  readonly locationCode: number;
}

/** A measured change against the run immediately before this one, in the same comparison group. */
export interface DomainLookupChange {
  readonly delta: number;
  readonly previousTotal: number;
  readonly previousCreatedAt: string;
}

/** One run as the page lists it. */
export interface DomainLookupHistoryEntry {
  /** The raw `tool` value; not narrowed, so a row this build does not know about still shows. */
  readonly tool: string;
  readonly target: string;
  /** Where the request came from — never a claim about what was measured. */
  readonly scope: "project" | "bare-target";
  readonly createdAt: string;
  /** The run's one line of numbers, or null when the report could not be read. */
  readonly summary: string | null;
  readonly locale: DomainLookupLocaleView | null;
  /** Null whenever a change would not be like-with-like — see the module header. */
  readonly change: DomainLookupChange | null;
}

/** The page's whole input: the rows, plus whether the window it was read through was full. */
export interface DomainLookupHistory {
  readonly entries: readonly DomainLookupHistoryEntry[];
  /**
   * True when the read came back with as many rows as it asked for, i.e. older runs exist that
   * this page never saw — so the oldest entries' missing changes mean "not measured here", not
   * "first of its kind".
   */
  readonly windowFull: boolean;
}

/** The two tools whose `total` answers a question a later run can be subtracted from. */
const COMPARABLE_TOOLS: readonly DomainLookupTool[] = ["ranked_keywords", "analyze_backlinks"];

function isDomainLookupTool(tool: string): tool is DomainLookupTool {
  return (DOMAIN_LOOKUP_TOOLS as readonly string[]).includes(tool);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `report->locale`, type-guarded. BOTH fields or nothing: a half-read locale cannot say whether
 * two runs asked the same question, and guessing the missing half is how a delta between two
 * different search markets gets printed as growth.
 */
function readLocale(value: unknown): DomainLookupLocaleView | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const language = record.language_code;
  const location = asFiniteNumber(record.location_code);
  if (typeof language !== "string" || language.length === 0 || location === null) return null;
  return { languageCode: language, locationCode: location };
}

/**
 * The GROUP two runs must share before their totals may be subtracted, or null when this run's
 * total is comparable with nothing at all. See the module header for what each tool's `total`
 * varies with and where that was read from.
 */
function comparisonGroup(entry: {
  readonly tool: string;
  readonly target: string;
  readonly locale: DomainLookupLocaleView | null;
}): string | null {
  if (!isDomainLookupTool(entry.tool)) return null;
  if (!COMPARABLE_TOOLS.includes(entry.tool)) return null;
  // NUL-joined: a domain cannot contain one, so no two different groups can collide into one key.
  const head = `${entry.tool}\u0000${entry.target}`;
  if (entry.tool === "analyze_backlinks") return head;
  if (entry.locale === null) return null;
  return `${head}\u0000${entry.locale.languageCode}\u0000${entry.locale.locationCode}`;
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
function newestFirst(left: DomainLookupHistoryRow, right: DomainLookupHistoryRow): number {
  const a = instantOf(left.created_at);
  const b = instantOf(right.created_at);
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

interface Draft {
  readonly row: DomainLookupHistoryRow;
  readonly locale: DomainLookupLocaleView | null;
  readonly total: number | null;
  readonly group: string | null;
  /** False when `created_at` did not parse: such a run cannot be placed in a sequence at all. */
  readonly ordered: boolean;
}

/**
 * Build the history one page shows.
 *
 * NEWEST FIRST is re-decided here rather than merely trusted from the query, for the reason
 * `buildDomainLookupLines` gives: the query's `.order(...)` is pinned by its own spec, but THIS
 * function is what the page is actually built from and is the only half a pure spec can execute.
 *
 * THE CHANGE PASS runs OLDEST to NEWEST and remembers, per comparison group, only the run
 * immediately before. "Since the previous run" therefore means exactly that — never "since the
 * last run whose numbers happened to be readable", which would silently skip a run and label the
 * result with the wrong interval. A run whose own total is unreadable, or whose timestamp did not
 * parse, breaks its group's chain: the run after it gets no change rather than a change measured
 * across a gap this module cannot see into.
 */
export function buildDomainLookupHistory(
  rows: readonly DomainLookupHistoryRow[],
  limit: number = DOMAIN_LOOKUP_HISTORY_LIMIT,
): DomainLookupHistory {
  const drafts: Draft[] = [...rows].sort(newestFirst).map((row) => {
    const locale = readLocale(row.locale);
    return {
      row,
      locale,
      total: asFiniteNumber(row.total),
      group: comparisonGroup({ tool: row.tool, target: row.target, locale }),
      ordered: !Number.isNaN(Date.parse(row.created_at)),
    };
  });

  const changes = new Map<Draft, DomainLookupChange>();
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
      tool: draft.row.tool,
      target: draft.row.target,
      scope: draft.row.project_id === null ? "bare-target" : "project",
      createdAt: draft.row.created_at,
      summary: isDomainLookupTool(draft.row.tool)
        ? summarizeDomainLookupRun(draft.row.tool, draft.row)
        : null,
      locale: draft.locale,
      change: changes.get(draft) ?? null,
    })),
    windowFull: rows.length >= limit,
  };
}

/**
 * The change as one English clause. A ZERO delta is stated ("no change since …") rather than
 * printed as "+0": the two read identically to a skimming eye, and "no change" is the finding.
 */
export function describeLookupChange(change: DomainLookupChange): string {
  const since = `since ${formatDate(change.previousCreatedAt)} (${formatNumber(change.previousTotal)})`;
  if (change.delta === 0) return `no change ${since}`;
  return `${change.delta > 0 ? "+" : ""}${formatNumber(change.delta)} ${since}`;
}
