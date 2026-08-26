import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  DEFAULT_RELEVANT_PAGES_ROWS,
  MAX_RELEVANT_PAGES_ROWS,
  RELEVANT_PAGE_ITEM_TYPES,
  resolveDefaultRelevantPagesPort,
  type RelevantPageItemType,
  type RelevantPageMetrics,
  type RelevantPageRow,
  type RelevantPagesPort,
  type RelevantPagesResult,
} from "../dfs/relevant-pages.ts";
import {
  estimatedMonthlyCostUsd,
  estimatedVisitsPerMonth,
  exactCount,
} from "../format/quantities.ts";
import {
  CRAWL_PAGE_READ_CAP,
  joinPages,
  loadCrawlSide,
  type CrawlSide,
  type CrawledPage,
  type LoadCrawlSideFn,
  type MatchedPage,
  type PageJoin,
} from "./my-pages-crawl.ts";
import {
  myPagesRunReport,
  writeDomainLookupRun,
  type DomainLookupRunWriter,
  type MyPagesCrawlView,
} from "../dfs/runs.ts";
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
 * my_pages — which pages of a domain DataForSEO Labs reports ranking figures for, joined against
 * the pages OUR OWN crawler actually fetched. One paid Labs request per call (dfs/relevant-pages.ts,
 * Part A) plus one tenant-scoped read of `crawl_pages` (my-pages-crawl.ts).
 *
 * =====================================================================================
 * WHAT THIS ANSWERS — AND THE SENTENCE IT MUST NOT SAY
 * =====================================================================================
 * The gap map sells this endpoint as "which of my pages rank, AND FOR WHAT". The second half is
 * FALSE and is not repeated anywhere in this file, its output or its docs page: the vendor returns
 * NO KEYWORDS from this endpoint at all. One row is ONE PAGE carrying a POSITION HISTOGRAM
 * (`pos_1` … `pos_91_100`) plus `etv` / `count` / `estimated_paid_traffic_cost` / `is_new|up|down|
 * lost`, per SERP item type. The keywords behind a single page are a DIFFERENT endpoint —
 * `ranked_keywords`, which takes a page URL as its target — and the output points there by name
 * rather than implying this tool answers it.
 *
 * =====================================================================================
 * THE JOIN IS THE PRODUCT, AND ITS HONESTY IS THE HARD PART
 * =====================================================================================
 * Three populations come out of the join and all three are legible in the output. Two of them are
 * CLAIMS, and both are easy to overstate, so each is printed with the sentence that bounds it:
 *
 *   - "not found in that crawl" is not "the page does not exist". Our crawl is one run, on one
 *     day, from one starting point, under its own depth / budget / robots limits — so the output
 *     names the crawl, says WHEN it ran and HOW MANY pages it fetched, right beside the list.
 *   - "not named in this window" is not "the page does not rank". The vendor half is a WINDOW
 *     (offset/limit) over a larger list, scoped to the item types and locale that were asked for —
 *     so the output names the window's own bounds and the item types beside that list too.
 *
 * NEVER #7: there is no coverage score, no health percentage and no composite of any kind here.
 * The one count printed is a count of what THIS window matched against THAT crawl, and the
 * sentence carrying it says exactly that.
 *
 * The join key is IMPORTED from the vendor adapter and applied to both sides — see the header of
 * my-pages-crawl.ts for why a second normaliser would be the quietest possible wrong answer.
 *
 * Same two hard product rules as every DataForSEO sibling:
 *   1. Live DataForSEO data is OFF by default. While off the tool returns a clear English error
 *      and NEVER serves sample pages as if they were real (NEVER #7).
 *   2. That refusal — and every invalid-input rejection, and the project-ownership refusal — is
 *      returned BEFORE any credit reserve, so the ledger is touched ZERO times (NEVER #2).
 *
 * charge:"handler": a SYNCHRONOUS tool that must run logic BEFORE the reserve. It settles via
 * withCredits WITHOUT a jobId (reserve -> commit, no jobs row). One lookup is charged ONCE; if the
 * vendor request fails, withCredits releases and nothing is billed.
 */

/** United States — the DataForSEO default location_code (the same default as every sibling). */
const DEFAULT_LOCATION_CODE = 2840;

const NOT_ENABLED_MESSAGE =
  "Page-level ranking data is not yet enabled on this deployment. Live DataForSEO data is turned " +
  "off, and SeoGrep never returns sample or placeholder pages as if they were real. This tool " +
  "will start returning data once live DataForSEO access is switched on — you were not charged.";

const inputSchema = z.object({
  target: targetField("list the ranking pages of"),
  project_id: projectIdField,
  // WHOSE PRICE. This field used to say "DataForSEO bills per returned row, so this is the price
  // control, not a display preference". Half of that is true and the half a CUSTOMER reads is not:
  // the call costs a flat 40 credits at `limit` 1 and at `limit` 1,000, so a caller narrowing the
  // window to save money pays the same and receives less.
  //
  // The other half IS true here, and it is true differently from the Backlinks family. Computed
  // from the Labs tariff this repo already declares (dfs/relevant-pages.ts: $0.012 per request +
  // $0.00012 per row, one request per lookup): $0.01212 at 1 row, $0.024 at 100, $0.132 at 1,000 —
  // the per-row half EQUALS the per-request half at exactly 100 rows ($0.012 / $0.00012) and is
  // ten times it at the 1,000-row ceiling, where it is 91% of the bill. Backlinks bills
  // $0.024 + $0.000036 a row, which is why 19x the rows there cost 13% more and the same sentence
  // was withdrawn outright on backlink_details.
  //
  // So the row count is a control on the VENDOR's bill, and what it justifies is the CEILING —
  // not a saving the caller can make. The 100 and the ten-times below come from the tariff, not
  // from our caps; if MAX_RELEVANT_PAGES_ROWS ever moves, the "ten times" has to be recomputed
  // (and moving it is a price change either way — NEVER #6).
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_RELEVANT_PAGES_ROWS)
    .default(DEFAULT_RELEVANT_PAGES_ROWS)
    .describe(
      `How many pages to return (1-${MAX_RELEVANT_PAGES_ROWS}, default ` +
        `${DEFAULT_RELEVANT_PAGES_ROWS}). It does not change what YOU pay: this call costs ` +
        `${TOOL_COSTS.my_pages} credits whether you ask for one page or ` +
        `${MAX_RELEVANT_PAGES_ROWS}, and asking for fewer rows costs the same. It does move ` +
        "DataForSEO's own bill, unlike SeoGrep's backlink tools where the row count barely " +
        "shifts it: the Labs tariff is a flat fee per request plus a fee per row, and the " +
        "per-row half catches the flat half at 100 rows and is ten times it at " +
        `${MAX_RELEVANT_PAGES_ROWS}. That is what fixes the ceiling — the flat credit price was ` +
        "signed against a full-width request — and it is not a reason to ask for less than you " +
        "need.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "How many pages to skip before this window starts (default 0). Page through a large site " +
        "by advancing it; the output always states the offset and limit the rows came back under.",
    ),
  item_types: z
    .array(z.enum(RELEVANT_PAGE_ITEM_TYPES))
    .min(1)
    .max(RELEVANT_PAGE_ITEM_TYPES.length)
    .optional()
    .describe(
      `Which SERP result types to report figures for (default "organic"). One or more of: ` +
        `${RELEVANT_PAGE_ITEM_TYPES.join(", ")}. Sent to DataForSEO explicitly either way, so the ` +
        "answer never depends on a vendor default that could move. A type DataForSEO reports " +
        "nothing for is left out of that page's figures rather than shown as zero.",
    ),
  min_organic_etv: z
    .number()
    .min(0)
    .optional()
    .describe(
      "OPTIONAL vendor filter: keep only pages whose DataForSEO `metrics.organic.etv` is at least " +
        "this. Omitted by default — no filter is sent at all, so nothing is dropped on your " +
        "behalf. Filtering happens at DataForSEO, so it changes which rows you are billed for.",
    ),
  min_organic_count: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "OPTIONAL vendor filter: keep only pages whose DataForSEO `metrics.organic.count` — how " +
        "many search results of that type contain the page — is at least this. Omitted by " +
        "default. The cut-off is YOURS; DataForSEO publishes the count but no threshold.",
    ),
  language_code: z.string().min(2).default("en").describe("Language code (default 'en')."),
  location_code: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_LOCATION_CODE)
    .describe(`DataForSEO location code (default ${DEFAULT_LOCATION_CODE} = United States).`),
});

type MyPagesInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "List the pages of a domain that DataForSEO Labs reports ranking figures for, and compare them " +
  "against the pages your own last crawl fetched. Each page carries DataForSEO's position " +
  "histogram (pos_1 through pos_91_100), etv, count and estimated_paid_traffic_cost per result " +
  "type — it does NOT carry the keywords a page ranks for, which this endpoint does not return; " +
  "use ranked_keywords with a page URL for that. Pass project_id to also see which of those pages " +
  "your crawl fetched, which it did not, and which pages it fetched that this window of " +
  "DataForSEO's list did not name — each stated as a fact about that window and that crawl, not " +
  "as a verdict about your site. SeoGrep ranks nothing and scores nothing. Synchronous — " +
  `everything comes back immediately. Costs ${TOOL_COSTS.my_pages} credits. Needs a paid credit ` +
  "balance: it is not available on trial credits. If live DataForSEO access is unavailable on " +
  "this deployment, the tool says so and charges nothing.";

/**
 * A COUNTED vendor field under the vendor's OWN name, with a silence spelled out in WORDS, never
 * as 0. Its digits are grouped and nothing else is done to them: `count` and the four `is_*`
 * fields are things DataForSEO counted, so every digit is real (format/quantities.ts, class 1).
 */
function vendorValue(field: string, value: number | null): string {
  return value === null
    ? `${field} not reported by DataForSEO`
    : `${field} ${exactCount(value)}`;
}

/**
 * An ESTIMATED vendor field, printed under a CUSTOMER WORD with the vendor's field name beside it.
 *
 * Both halves are load-bearing. The customer word is what the reader is actually asking about
 * ("est. traffic"), and `etv` answers that question for nobody who has not read DataForSEO's
 * docs. The vendor key stays because this whole file's promise is that every figure is traceable
 * to a named vendor field — dropping it would leave a number the reader cannot check.
 *
 * `render` carries the precision rule (format/quantities.ts states it per quantity); this
 * function chooses no rounding of its own.
 */
function vendorEstimate(
  label: string,
  field: string,
  value: number | null,
  render: (value: number) => string,
): string {
  return value === null
    ? `${label} not reported by DataForSEO (${field})`
    : `${label} ${render(value)} (DataForSEO ${field})`;
}

/** The twelve position buckets, in the vendor's own order. */
const POSITION_BUCKETS = [
  "pos_1",
  "pos_2_3",
  "pos_4_10",
  "pos_11_20",
  "pos_21_30",
  "pos_31_40",
  "pos_41_50",
  "pos_51_60",
  "pos_61_70",
  "pos_71_80",
  "pos_81_90",
  "pos_91_100",
] as const satisfies readonly (keyof RelevantPageMetrics)[];

/**
 * The position histogram for ONE item type. Only the buckets the vendor actually sent are named
 * with a number; the ones it did not are COUNTED in a trailing clause rather than dropped in
 * silence. Dropping them would let a reader take an omission for a zero, and printing eleven
 * "not reported" legs beside one measurement would dress silence up as data (NEVER #7). A bucket
 * the vendor sent as 0 is an answer and prints as 0.
 */
export function renderPositions(metrics: RelevantPageMetrics): string {
  const legs = POSITION_BUCKETS.flatMap((bucket) => {
    const occupancy = metrics[bucket];
    return occupancy === null ? [] : [`${bucket} ${exactCount(occupancy)}`];
  });
  const missing = POSITION_BUCKETS.length - legs.length;
  if (legs.length === 0) {
    return `positions: none of the ${POSITION_BUCKETS.length} position buckets were reported by DataForSEO`;
  }
  const tail =
    missing === 0
      ? ""
      : ` (${missing} of the ${POSITION_BUCKETS.length} position buckets were not reported by DataForSEO)`;
  return `positions: ${legs.join(", ")}${tail}`;
}

/**
 * One item type's figures for one page. Every field carries DataForSEO's own name; the two that
 * are MODEL OUTPUT rather than counts also carry a customer word and are rounded to the unit they
 * actually resolve to — a whole visit and a whole dollar (format/quantities.ts, classes 2 and 3).
 * Printing `etv` at its raw float width claimed a precision the vendor's model does not have.
 */
export function renderItemType(type: RelevantPageItemType, metrics: RelevantPageMetrics): string {
  return (
    `  ${type}: ${vendorValue("count", metrics.count)} · ` +
    `${vendorEstimate("est. traffic", "etv", metrics.etv, estimatedVisitsPerMonth)} · ` +
    `${vendorEstimate(
      "est. cost to buy that traffic",
      "estimated_paid_traffic_cost",
      metrics.estimated_paid_traffic_cost,
      estimatedMonthlyCostUsd,
    )} · ` +
    `${vendorValue("is_new", metrics.is_new)} · ${vendorValue("is_up", metrics.is_up)} · ` +
    `${vendorValue("is_down", metrics.is_down)} · ${vendorValue("is_lost", metrics.is_lost)}\n` +
    `  ${type} ${renderPositions(metrics)}`
  );
}

/**
 * ONE vendor page. `page_address` is printed VERBATIM — it is what DataForSEO said, and the key we
 * joined on is ours. An item type the vendor reported nothing for is ABSENT from the row and is
 * therefore absent here too; a page with no figures at all says so rather than printing zeros.
 */
export function renderVendorPage(row: RelevantPageRow): string {
  const blocks = RELEVANT_PAGE_ITEM_TYPES.flatMap((type) => {
    const metrics = row.metrics[type];
    return metrics ? [renderItemType(type, metrics)] : [];
  });
  const body =
    blocks.length === 0
      ? "  DataForSEO reported no figures for this page in the result types that were asked for"
      : blocks.join("\n");
  return `• ${row.page_address}\n${body}`;
}

/** How our crawl saw one page: its own stored URL and the status it recorded. */
export function renderCrawledPage(page: CrawledPage): string {
  const status =
    page.status === null ? "no HTTP status recorded" : `HTTP status ${page.status}`;
  return `${page.url} (${status})`;
}

/** A matched page: the vendor's row, then the crawled URL(s) that keyed to the same page. */
function renderMatchedPage(match: MatchedPage): string {
  const also = match.crawled.map(renderCrawledPage).join("; ");
  return `${renderVendorPage(match.vendor)}\n  your crawl fetched: ${also}`;
}

/** The heading: what was asked, and against which crawl (or against nothing, said plainly). */
export function renderHeading(
  result: RelevantPagesResult,
  crawl: CrawlSide,
  project?: ProjectRef | null,
): string {
  const subject = subjectLabel(result.target, project);
  const against =
    crawl.kind === "crawl"
      ? `, compared against the crawl of it recorded ${crawl.ranAt.slice(0, 10)}`
      : "";
  return (
    `Pages of ${subject} that DataForSEO Labs relevant_pages reports ranking figures for` +
    `${against}.`
  );
}

/**
 * WHAT THIS DATA IS — printed on every answer, because "my pages" reads as "the pages I rank
 * with, and what for", and the second half is a promise this endpoint cannot keep.
 */
export const WHAT_THE_VENDOR_RETURNS =
  "What DataForSEO returns here: one row is ONE PAGE, carrying that page's position histogram " +
  "(pos_1 through pos_91_100) and its traffic estimates, per result type. It does NOT carry the " +
  "keywords a page ranks for — this endpoint returns none. To see the keywords behind a single " +
  "page, run ranked_keywords with that page's URL as the target.";

/** The request facts: item types, locale, the vendor's ordering field, and the filters sent. */
export function renderCriteria(result: RelevantPagesResult, input: LookupLocale): string {
  const filters =
    result.vendor_filters_applied.length === 0
      ? "No vendor filter was applied, so nothing was dropped before you saw it."
      : "DataForSEO filtered the set, in the vendor's own grammar: " +
        `${JSON.stringify(result.vendor_filters_applied)} — bounds you chose, not ones SeoGrep or ` +
        "DataForSEO recommends.";
  return (
    `Asked for result types ${result.item_types_requested.join(", ")}, in language ` +
    `${input.language_code}, location ${input.location_code}. The rows are in DataForSEO's own ` +
    `order, by ${result.ordered_by_vendor_field}, highest first — SeoGrep does not re-order them ` +
    `and computes no score of its own. ${filters} Clickstream data was not purchased, so no ` +
    "clickstream figures appear below."
  );
}

/** The locale echoed back into the criteria line — the caller's own two request facts. */
export interface LookupLocale {
  readonly language_code: string;
  readonly location_code: number;
}

/** The window caption: the rows in hand under their bounds, kept apart from the whole-set count. */
export function renderWindowCaption(result: RelevantPagesResult): string {
  const { window_row_count: rows, window_offset: offset, window_limit: limit } = result.window;
  const shown =
    `${exactCount(rows)} ${rows === 1 ? "page" : "pages"} in this window (offset ` +
    `${exactCount(offset)}, limit ${exactCount(limit)})`;
  // `null` is the vendor DECLINING TO SAY. It is not 0 and it is not rows.length: either
  // substitution would publish a measurement of the whole set that nobody made.
  const whole =
    result.window.vendor_total_count === null
      ? "DataForSEO did not say how many pages this lookup matches in total"
      : `DataForSEO counts ${exactCount(result.window.vendor_total_count)} pages matching this ` +
        "lookup in total";
  return `${shown}. ${whole} — this window is a slice of that set, not a count of it.`;
}

/**
 * THE SENTENCE THAT BOUNDS "we did not crawl it". It names the crawl, the day it ran and how many
 * pages it fetched, so an absence cannot be read as a fact about the site.
 */
function crawlLimitsNote(crawl: Extract<CrawlSide, { kind: "crawl" }>): string {
  // A THRESHOLD IS PRINTED WITH ITS VALUE. "Only the first pages were compared" names a limit
  // without saying where it falls, which leaves the reader unable to tell a crawl that was barely
  // clipped from one that was mostly discarded — the number is the whole content of the warning.
  const truncation = crawl.truncated
    ? ` Only the first ${exactCount(CRAWL_PAGE_READ_CAP)} pages of that crawl were compared, so ` +
      "this list may be incomplete."
    : "";
  return (
    `That crawl fetched ${exactCount(crawl.pages.length)} ` +
    `${crawl.pages.length === 1 ? "page" : "pages"} on ${crawl.ranAt.slice(0, 10)}, following ` +
    "links from the site's own start URL under its depth, page-count and robots limits. " +
    '"Not found in that crawl" therefore means exactly that — it is not a statement that the ' +
    `page does not exist, is not on your site, or cannot be crawled.${truncation}`
  );
}

/** THE SENTENCE THAT BOUNDS "the vendor did not name it" — the window's own bounds and scope. */
function windowLimitsNote(result: RelevantPagesResult): string {
  const { window_offset: offset, window_row_count: rows } = result.window;
  const span = rows === 0 ? "no rows" : `rows ${exactCount(offset + 1)}-${exactCount(offset + rows)}`;
  return (
    `This window covered ${span} of DataForSEO's list for result types ` +
    `${result.item_types_requested.join(", ")}. A page missing from it is a page DataForSEO did ` +
    "not report IN THIS WINDOW, under THOSE result types and that locale — it is not a statement " +
    "that the page does not rank. Advance `offset` to read further into the list."
  );
}

/** One titled section, or nothing when the population is empty. Empty parts are dropped. */
function section(title: string, count: number, ...parts: string[]): string | null {
  if (count === 0) return null;
  return [`${title} (${exactCount(count)}):`, ...parts].filter(Boolean).join("\n\n");
}

/**
 * =====================================================================================
 * THE OUTPUT BUDGET — measured 2026-08-26, and the reason it exists
 * =====================================================================================
 * Two defects, and they had to be fixed TOGETHER because each one doubled the other's damage.
 *
 * ONE — EVERY VENDOR PAGE WAS PRINTED TWICE. `formatMyPages` printed the whole window as a flat
 * list AND then `renderComparison` printed the SAME rows again, partitioned into "fetched by that
 * crawl" / "not found in that crawl". Measured on 1,000 organic-only rows: 404,171 characters with
 * no project named, 880,080 with a project whose crawl matched every page — **+118%** for a reply
 * that carried no extra fact. A single page address occurred THREE times in one answer.
 *
 * TWO — NOTHING BOUNDED THE LENGTH. 404,171 characters is roughly 200,000 tokens. The client that
 * refused `backlink_details` this same round refused 62,729 characters as "exceeds maximum allowed
 * tokens"; this reply is six times that before the duplication and fourteen times it after. The
 * 40 credits and DataForSEO's own $0.132 were spent either way and the caller saw NOTHING.
 *
 * THE DUPLICATION IS FIXED BY DELETING THE FLAT LIST WHEN — AND ONLY WHEN — A COMPARISON WAS MADE.
 * The comparison is a PARTITION of the same window: matched + vendorOnly + vendorUnkeyed is every
 * row, in the vendor's own order, so printing the flat list beside it added a second copy and no
 * second fact. With no project named there is no partition, so the flat list IS the answer and
 * stays. Nothing is lost: the unkeyed group now carries each row's full figures, which the flat
 * list used to be the only place to read them.
 *
 * THE LENGTH IS FIXED THE WAY `backlink_details` fixed it — bound the RENDERED TEXT, not the
 * schema. Lowering `limit`'s maximum would turn an oversized call into a free validation error,
 * but 1,000 is derived from the SIGNED 40-credit price (dfs/relevant-pages.ts) and moving it is a
 * price change a human owns (NEVER #6). It would also contradict this tool's own `limit`
 * description, which now tells the caller plainly that a narrower window does not cost less: the
 * answer to "too big to read" cannot be "buy a smaller one".
 *
 * THE NUMBER is the sibling's, for the sibling's measured reason: the refusal was in TOKENS, and
 * URL-dense ASCII bottoms out near 2 characters per token, so 28,000 characters is at most ~14,000
 * tokens — inside the 25,000-token default that rejected 62,729 characters, with room for a client
 * configured lower. The sub-budgets below sum under it with the fixed prose (~3,000 characters
 * measured) still to pay for, and `my-pages.test.ts` asserts the whole rendered answer against
 * MAX_RENDERED_OUTPUT_CHARS on a worst-case window rather than trusting this arithmetic.
 *
 * WHAT IS NOT LOST: the run row written to `domain_lookup_runs` records the WHOLE window and the
 * whole join (myPagesCrawlView), and every section heading counts every row it has. The budget
 * bounds what is PRINTED, never what was measured or counted.
 */
export const MAX_RENDERED_OUTPUT_CHARS = 28_000;

/**
 * The vendor half's share, and it is the SAME ceiling in both arrangements: 18,000 characters for
 * the flat list when no comparison was made, or 9,000 + 9,000 when the partition replaced it.
 *
 * The split is EVEN on purpose. A running budget spent matched-first would let one full group
 * starve the other outright, and "not found in that crawl" is the half a reader most often came
 * for; an even split means each group prints what it can and says what it could not.
 *
 * WHAT 9,000 BUYS, MEASURED rather than assumed: a my_pages row is FAT next to a backlink row —
 * 12 position buckets and 7 counters per item type, so ~400 characters for an organic-only page
 * and ~760 when the vendor also reports `paid`. That is ~22 and ~11 pages per group. It is a small
 * number and it is said out loud in the note, which is the whole difference from what it replaces:
 * before this, the same call printed all 1,000 rows TWICE and the client refused the reply, so the
 * caller read ZERO of them and paid for all of them. Widening the budget instead would only move
 * the refusal, not remove it.
 */
const VENDOR_LIST_CHAR_BUDGET = 18_000;
const MATCHED_CHAR_BUDGET = 9_000;
const VENDOR_ONLY_CHAR_BUDGET = 9_000;

/** The uncomparable group — small by nature, bounded anyway because nothing else bounds it. */
const UNKEYED_CHAR_BUDGET = 2_000;

/**
 * The crawl-side group is bounded TWICE, and both bounds are load-bearing.
 *
 * {@link MAX_CRAWL_ONLY_LISTED} is a ROW cap and predates this budget; it stays because 50 rows is
 * the length a reader was promised. The character bound is added beside it because a row cap is
 * not a size bound: fifty 500-character URLs are 25,000 characters and would blow the whole reply
 * open on their own. Whichever binds first, the same honest note fires.
 */
const CRAWL_ONLY_CHAR_BUDGET = 3_500;

/** One list, rendered until either bound is reached. A row is taken ONLY if it fits WHOLE. */
function renderWithinBudget<Row>(
  rows: readonly Row[],
  render: (row: Row) => string,
  budget: number,
  maxRows = Number.POSITIVE_INFINITY,
): { readonly block: string; readonly printed: number; readonly omitted: number } {
  const taken: string[] = [];
  let used = 0;
  for (const row of rows) {
    if (taken.length >= maxRows) break;
    const line = render(row);
    const cost = line.length + 1; // + the newline that joins it to the block
    if (used + cost > budget) break;
    taken.push(line);
    used += cost;
  }
  return { block: taken.join("\n"), printed: taken.length, omitted: rows.length - taken.length };
}

/**
 * What the reader is told when VENDOR rows were fetched and not printed. It says outright that the
 * omitted rows were charged for, because they were: the flat 40 credits and DataForSEO's per-row
 * fee were both spent on the whole window. It never says "N of M" — that phrasing reads as a
 * fraction of the vendor's whole-set total, which is a different set entirely.
 */
export function renderVendorLimitNote(printed: number, omitted: number): string {
  return (
    `Output limit reached — ${exactCount(printed)} ${printed === 1 ? "page" : "pages"} printed ` +
    `above, ${exactCount(omitted)} more fetched in this same group but not printed: one reply ` +
    "cannot hold them, and they were charged for either way. Move the window with `offset`, or " +
    `ask for a smaller \`limit\` — each call is a separate ${TOOL_COSTS.my_pages}-credit lookup ` +
    "and asking for fewer rows does not cost less, so this is about what one reply can hold, not " +
    "about price."
  );
}

/** One vendor-side list under its heading, bounded, with the note when rows did not fit. */
function budgetedVendorSection<Row>(
  title: string,
  rows: readonly Row[],
  render: (row: Row) => string,
  budget: number,
  ...notes: string[]
): string | null {
  const shown = renderWithinBudget(rows, render, budget);
  return section(
    title,
    rows.length,
    shown.block,
    shown.omitted > 0 ? renderVendorLimitNote(shown.printed, shown.omitted) : "",
    ...notes,
  );
}

/**
 * THE ONLY LIST HERE NOBODY CHOSE THE LENGTH OF. Measured 2026-08-25: 93 rows, no bound at all.
 *
 * The two vendor-side sections are as long as the caller's own `limit` made them. This one is
 * not: it is every page of the crawl that this window did not name, so its length is set by the
 * SITE, and the read cap above it (CRAWL_PAGE_READ_CAP, 1,000) is the only thing that ever
 * stopped it. A caller asking for ten vendor rows against a thousand-page crawl was handed
 * roughly a thousand lines they did not ask for and could not shorten.
 *
 * FIFTY. A row here is one line — a URL and a status — so fifty is a screen or two, and the
 * paid half of the same reply (up to 1,000 vendor pages, several lines each) is what the reader
 * came for. The rows are in the crawl's own fetch order, which is discovery order and NOT an
 * importance ranking, so the note says that too rather than letting "the first fifty" read as
 * "the top fifty".
 *
 * NOTHING IS DROPPED IN SILENCE, and nothing extra was billed for what is dropped: these rows are
 * the tenant's own stored crawl, not a DataForSEO purchase. That is the difference from
 * backlink_details' output-limit note, which has to say the omitted rows WERE paid for.
 *
 * A ROW CAP IS NOT A SIZE BOUND, so it is not the only bound on this list any more: fifty
 * 500-character URLs are 25,000 characters. {@link CRAWL_ONLY_CHAR_BUDGET} bounds the same list in
 * characters, whichever binds first, and the note below fires either way.
 */
export const MAX_CRAWL_ONLY_LISTED = 50;

/** What the reader is told when crawl-side rows exist but are not printed. */
export function renderCrawlOnlyLimitNote(printed: number, omitted: number): string {
  return (
    `Output limit reached — ${exactCount(printed)} ${printed === 1 ? "page" : "pages"} printed ` +
    `above, ${exactCount(omitted)} more in this same group but not printed: one reply cannot ` +
    "hold them. They are pages of your own crawl rather than rows bought from DataForSEO, so " +
    "nothing was charged for the ones left out, and they are listed in the order that crawl " +
    "fetched them — that is discovery order, not an order of importance. Advance `offset` to " +
    "read further into DataForSEO's list: a page this window did not name may be named by the next."
  );
}

/** The third section — bounded, because its length is the site's and not the caller's. */
function crawlOnlySection(join: PageJoin, result: RelevantPagesResult): string | null {
  const shown = renderWithinBudget(
    join.crawlOnly,
    (page) => `• ${renderCrawledPage(page)}`,
    CRAWL_ONLY_CHAR_BUDGET,
    MAX_CRAWL_ONLY_LISTED,
  );
  return section(
    "Fetched by that crawl, not named in this window",
    join.crawlOnly.length,
    shown.block,
    shown.omitted > 0 ? renderCrawlOnlyLimitNote(shown.printed, shown.omitted) : "",
    windowLimitsNote(result),
  );
}

/**
 * THE ONE COUNT THIS TOOL PRINTS — and the sentence saying what it counts. It is a count of what
 * THIS window matched against THAT crawl, never a coverage score, a percentage or a grade
 * (NEVER #7). Rows whose address could not be keyed are excluded from the denominator rather than
 * counted as misses, because they could never have matched either way.
 */
export function renderMatchCount(join: PageJoin, crawl: Extract<CrawlSide, { kind: "crawl" }>): string {
  const keyed = join.matched.length + join.vendorOnly.length;
  return (
    `Of the ${exactCount(keyed)} ${keyed === 1 ? "page" : "pages"} in this window whose address ` +
    `could be keyed, ${exactCount(join.matched.length)} also appear in the crawl recorded ` +
    `${crawl.ranAt.slice(0, 10)}. That is a count of THIS window against THAT crawl — not a ` +
    "measure of how much of your site ranks, and not a score of any kind."
  );
}

/** The comparison half, in the three states it really has. */
export function renderComparison(result: RelevantPagesResult, crawl: CrawlSide): string {
  if (crawl.kind === "not_requested") {
    return (
      "No project was named, so nothing was compared against your own crawl. Pass `project_id` " +
      "instead of `target` to also see which of these pages your last crawl fetched, which it " +
      "did not, and which pages it fetched that this window did not name."
    );
  }
  if (crawl.kind === "none") {
    return (
      "That project has no completed crawl to compare against, so only DataForSEO's half of this " +
      "answer is above. Run crawl_site for the project and run this tool again — nothing about " +
      "the list above changes, and no page below is missing because of it."
    );
  }
  const join = joinPages(result.window.rows, crawl.pages);
  const unkeyed = [
    // The vendor's uncomparable rows carry their FULL figures here. They used to be one bare
    // address line, which was survivable only because the flat window list above printed every
    // vendor row a second time; now that the duplicate list is gone, this is the ONLY place these
    // rows appear, and an answer that dropped their figures would be losing paid data.
    ...join.vendorUnkeyed.map(
      (row) => `${renderVendorPage(row)}\n  (from DataForSEO — this address could not be keyed)`,
    ),
    ...join.crawlUnkeyed.map((page) => `• ${page.url} (from your crawl)`),
  ];
  const unkeyedShown = renderWithinBudget(unkeyed, (line) => line, UNKEYED_CHAR_BUDGET);
  const sections = [
    budgetedVendorSection(
      "Reported by DataForSEO, and fetched by that crawl",
      join.matched,
      renderMatchedPage,
      MATCHED_CHAR_BUDGET,
    ),
    budgetedVendorSection(
      "Reported by DataForSEO, not found in that crawl",
      join.vendorOnly,
      renderVendorPage,
      VENDOR_ONLY_CHAR_BUDGET,
      crawlLimitsNote(crawl),
    ),
    crawlOnlySection(join, result),
    section(
      "Addresses that could not be keyed, and so could not be compared either way",
      unkeyed.length,
      unkeyedShown.block,
      unkeyedShown.omitted > 0
        ? renderVendorLimitNote(unkeyedShown.printed, unkeyedShown.omitted)
        : "",
      "These addresses did not parse as URLs, so they are held out of the three groups above " +
        "rather than counted as misses on either side.",
    ),
  ].filter((part): part is string => part !== null);
  return [renderMatchCount(join, crawl), PARTITION_NOTE, ...sections].join("\n\n");
}

/**
 * WHY THERE IS NO SEPARATE LIST OF THE WINDOW ABOVE THIS. Said in the answer rather than only in
 * a comment, because a reader who knows the old shape would otherwise look for the missing list
 * and wonder which rows were dropped from it. None were: the groups below are a partition.
 */
export const PARTITION_NOTE =
  "The groups below hold every page this window returned — each one appears exactly once, in " +
  "DataForSEO's own order, under the group it fell into. There is no separate list of the window " +
  "above them, because it would be the same pages a second time.";

/**
 * Whose numbers these are, and what this tool does NOT claim. Printed on every answer (NEVER #7).
 */
export const VENDOR_JUDGEMENT_NOTE =
  "Every figure above is a DataForSEO field, with DataForSEO's own name for it printed alongside. " +
  "`etv` and `estimated_paid_traffic_cost` are DataForSEO's OWN ESTIMATES of monthly traffic and " +
  "of what that traffic would cost to buy — they are not measurements of your traffic, and " +
  "SeoGrep does not predict traffic, revenue or ranking success. Both are shown to the nearest " +
  "whole visit and whole dollar: they come out of a model, and the further decimal places that " +
  "model emits are not precision it has. The position buckets are a histogram of how " +
  "many results of that type hold the page at each position band; they are not averaged into a " +
  '"position", because DataForSEO did not send one. A field DataForSEO did not report is shown ' +
  "as unreported, never as a zero. Pages are matched to your crawl by a normalised URL that " +
  "ignores the scheme, a leading `www.` and one trailing slash, but keeps the query string in " +
  "its original order, path capitalisation and subdomains — so two addresses differing only in " +
  "query-parameter order are treated as two pages rather than merged into one.";

/** The "nothing came back" answer — a real, delivered result rather than an error. */
function renderNoPages(
  result: RelevantPagesResult,
  input: LookupLocale,
  crawl: CrawlSide,
  project?: ProjectRef | null,
): string {
  return [
    `No pages for ${subjectLabel(result.target, project)} — DataForSEO Labs relevant_pages.`,
    WHAT_THE_VENDOR_RETURNS,
    renderCriteria(result, input),
    `DataForSEO returned no page for this lookup in the window that was asked for (offset ` +
      `${exactCount(result.window.window_offset)}, limit ` +
      `${exactCount(result.window.window_limit)}). That is an answer about this window, these ` +
      "result types and these filters — it is not a statement that the domain has no ranking " +
      "pages.",
    renderComparison(result, crawl),
  ].join("\n\n");
}

/**
 * The window as ONE flat list — printed only when no comparison was made, because when one WAS
 * made the comparison is a partition of these very rows and this list would be the second copy.
 * See the budget header: printing both measured +118% for no extra fact.
 */
function vendorWindowList(rows: readonly RelevantPageRow[]): readonly string[] {
  const shown = renderWithinBudget(rows, renderVendorPage, VENDOR_LIST_CHAR_BUDGET);
  return [
    shown.block,
    shown.omitted > 0 ? renderVendorLimitNote(shown.printed, shown.omitted) : "",
  ].filter(Boolean);
}

/** Render one lookup as the plain-text tool output (pure — unit-tested directly). */
export function formatMyPages(
  result: RelevantPagesResult,
  input: LookupLocale,
  crawl: CrawlSide,
  project?: ProjectRef | null,
): string {
  if (result.window.rows.length === 0) {
    return renderNoPages(result, input, crawl, project);
  }
  return [
    renderHeading(result, crawl, project),
    WHAT_THE_VENDOR_RETURNS,
    renderCriteria(result, input),
    renderWindowCaption(result),
    ...(crawl.kind === "crawl" ? [] : vendorWindowList(result.window.rows)),
    renderComparison(result, crawl),
    VENDOR_JUDGEMENT_NOTE,
  ].join("\n\n");
}

/**
 * The crawl side of the RUN ROW (migration 0031): the three `CrawlSide` states kept apart, plus
 * the join's three population counts. Pure, and exported so a spec executes it directly.
 *
 * THE THREE STATES ARE NOT COLLAPSED, for `CrawlSide`'s own reason: "no project was named, so no
 * crawl was looked for" and "a project was named and has no crawl" are different sentences, and a
 * row that stored either as "0 pages compared" would be a claim nobody measured.
 *
 * THE JOIN IS RECOMPUTED here rather than lifted out of the formatter, and that is safe for
 * exactly one reason: `joinPages` is PURE and both callers hand it the SAME two lists, so this is
 * one measurement computed twice and not a second measurement that merely resembles it. The rule
 * that forbids a second computation is about the PAID vendor call (dfs/runs.ts says so); nothing
 * here reaches DataForSEO.
 *
 * WHAT IS STORED IS COUNTS, NEVER THE CRAWLED URLS. The crawl side can carry up to
 * CRAWL_PAGE_READ_CAP pages, they are the tenant's own data already stored in `crawl_pages`, and
 * `domain_lookup_runs` is a SUMMARY table (0027's payload rule).
 */
export function myPagesCrawlView(
  crawl: CrawlSide,
  vendorRows: readonly RelevantPageRow[],
): MyPagesCrawlView {
  if (crawl.kind !== "crawl") {
    return {
      kind: crawl.kind,
      job_id: null,
      ran_at: null,
      pages_compared: null,
      truncated: null,
      matched: null,
      vendor_only: null,
      crawl_only: null,
    };
  }
  const join = joinPages(vendorRows, crawl.pages);
  return {
    kind: "crawl",
    job_id: crawl.jobId,
    ran_at: crawl.ranAt,
    pages_compared: crawl.pages.length,
    truncated: crawl.truncated,
    matched: join.matched.length,
    vendor_only: join.vendorOnly.length,
    crawl_only: join.crawlOnly.length,
  };
}

/** Dependencies — every outward reach is injectable so the fast lane runs offline and DB-less. */
export interface MyPagesDeps {
  /**
   * The relevant-pages port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port.
   */
  readonly port?: RelevantPagesPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /** The tenant-scoped crawl-side loader (default: the real one). Injected likewise. */
  readonly loadCrawl?: LoadCrawlSideFn;
  /**
   * The run recorder (default: the real `writeDomainLookupRun`, migration 0031). A PORT for the
   * reason every other writer in this family is one: a spec can make it FAIL without breaking a
   * database, which is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeRun?: DomainLookupRunWriter;
}

export function makeMyPagesTool(deps: MyPagesDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeDomainLookupRun;
  return defineTool<MyPagesInput>({
    name: "my_pages",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — exactly one of target/project_id, ownership, and the archive
      // check, all through the shared resolver so this tool cannot grow a second wording for a
      // refusal the rest of the surface already has one for.
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      const port = deps.port ?? resolveDefaultRelevantPagesPort();
      // Free pre-reserve gate 2 — refuse rather than reserve credits or serve mock rows.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // The crawl side is read BEFORE the reserve as well. It is free (our own stored data), and
      // reading it first means a database problem cannot strand an open reservation. A caller who
      // passed a bare `target` named no project, so nothing is looked for — and the output says
      // that rather than implying an empty comparison.
      const crawl: CrawlSide =
        subject.project === null
          ? { kind: "not_requested" }
          : await (deps.loadCrawl ?? loadCrawlSide)(ctx.userId, subject.project.id);
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch -> commit
      // as one chain. The vendor request failing throws, so withCredits releases.
      return withCredits({ userId: ctx.userId }, { tool: "my_pages" }, async () => {
        const result = await port.fetchRelevantPages({
          target: subject.domain,
          limit: input.limit,
          offset: input.offset,
          language_code: input.language_code,
          location_code: input.location_code,
          item_types: input.item_types,
          min_organic_etv: input.min_organic_etv,
          min_organic_count: input.min_organic_count,
        });
        const text = formatMyPages(result, input, crawl, subject.project);
        // THE RUN IS RECORDED BEFORE THE REPLY IS RETURNED, and the write is NOT guarded
        // (migration 0031; dfs/runs.ts states the same contract from the other side). withCredits
        // COMMITS a handler that returns and RELEASES one that throws, so an error escaping here
        // costs the tenant nothing. Caught and logged instead, the shape would be the house's
        // worst: a charged caller, a delivered table, and a panel that says forever that the
        // lookup never ran.
        //
        // `projectId` is null on a bare-target call. `target` is the RESOLVED domain, never the
        // caller's raw input: it is what was actually looked up, and for a project run it is what
        // the project's domain was AT THE TIME.
        await writeRun(
          {
            userId: ctx.userId,
            projectId: subject.project?.id ?? null,
            tool: "my_pages",
            target: subject.domain,
          },
          myPagesRunReport(result, myPagesCrawlView(crawl, result.window.rows), {
            limit: input.limit,
            offset: input.offset,
            language_code: input.language_code,
            location_code: input.location_code,
          }),
        );
        return textResult(text);
      });
    },
  });
}

/** The production my_pages tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const myPagesTool = makeMyPagesTool();
