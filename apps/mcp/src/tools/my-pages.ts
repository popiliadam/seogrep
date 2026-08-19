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
  joinPages,
  loadCrawlSide,
  type CrawlSide,
  type CrawledPage,
  type LoadCrawlSideFn,
  type MatchedPage,
  type PageJoin,
} from "./my-pages-crawl.ts";
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
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_RELEVANT_PAGES_ROWS)
    .default(DEFAULT_RELEVANT_PAGES_ROWS)
    .describe(
      `How many pages to return (1-${MAX_RELEVANT_PAGES_ROWS}, default ` +
        `${DEFAULT_RELEVANT_PAGES_ROWS}). DataForSEO bills per returned row, so this is the price ` +
        "control, not a display preference — the flat price was signed against this ceiling.",
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

/** Group digits with commas without depending on ICU/locale data (deterministic). */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A vendor field under the vendor's OWN name, with a silence spelled out in WORDS, never as 0. */
function vendorValue(field: string, value: number | null): string {
  return value === null ? `${field} not reported by DataForSEO` : `${field} ${value}`;
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
  const reported = POSITION_BUCKETS.filter((bucket) => metrics[bucket] !== null);
  const missing = POSITION_BUCKETS.length - reported.length;
  if (reported.length === 0) {
    return `positions: none of the ${POSITION_BUCKETS.length} position buckets were reported by DataForSEO`;
  }
  const legs = reported.map((bucket) => `${bucket} ${metrics[bucket]}`).join(", ");
  const tail =
    missing === 0
      ? ""
      : ` (${missing} of the ${POSITION_BUCKETS.length} position buckets were not reported by DataForSEO)`;
  return `positions: ${legs}${tail}`;
}

/** One item type's figures for one page, every field under DataForSEO's own name. */
export function renderItemType(type: RelevantPageItemType, metrics: RelevantPageMetrics): string {
  return (
    `  ${type}: ${vendorValue("count", metrics.count)} · ${vendorValue("etv", metrics.etv)} · ` +
    `${vendorValue("estimated_paid_traffic_cost", metrics.estimated_paid_traffic_cost)} · ` +
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
    `${thousands(rows)} ${rows === 1 ? "page" : "pages"} in this window (offset ` +
    `${thousands(offset)}, limit ${thousands(limit)})`;
  // `null` is the vendor DECLINING TO SAY. It is not 0 and it is not rows.length: either
  // substitution would publish a measurement of the whole set that nobody made.
  const whole =
    result.window.vendor_total_count === null
      ? "DataForSEO did not say how many pages this lookup matches in total"
      : `DataForSEO counts ${thousands(result.window.vendor_total_count)} pages matching this ` +
        "lookup in total";
  return `${shown}. ${whole} — this window is a slice of that set, not a count of it.`;
}

/**
 * THE SENTENCE THAT BOUNDS "we did not crawl it". It names the crawl, the day it ran and how many
 * pages it fetched, so an absence cannot be read as a fact about the site.
 */
function crawlLimitsNote(crawl: Extract<CrawlSide, { kind: "crawl" }>): string {
  const truncation = crawl.truncated
    ? " Only the first pages of that crawl were compared, so this list may be incomplete."
    : "";
  return (
    `That crawl fetched ${thousands(crawl.pages.length)} ` +
    `${crawl.pages.length === 1 ? "page" : "pages"} on ${crawl.ranAt.slice(0, 10)}, following ` +
    "links from the site's own start URL under its depth, page-count and robots limits. " +
    '"Not found in that crawl" therefore means exactly that — it is not a statement that the ' +
    `page does not exist, is not on your site, or cannot be crawled.${truncation}`
  );
}

/** THE SENTENCE THAT BOUNDS "the vendor did not name it" — the window's own bounds and scope. */
function windowLimitsNote(result: RelevantPagesResult): string {
  const { window_offset: offset, window_row_count: rows } = result.window;
  const span = rows === 0 ? "no rows" : `rows ${thousands(offset + 1)}-${thousands(offset + rows)}`;
  return (
    `This window covered ${span} of DataForSEO's list for result types ` +
    `${result.item_types_requested.join(", ")}. A page missing from it is a page DataForSEO did ` +
    "not report IN THIS WINDOW, under THOSE result types and that locale — it is not a statement " +
    "that the page does not rank. Advance `offset` to read further into the list."
  );
}

/** One titled section, or nothing when the population is empty. */
function section(title: string, count: number, body: string[], note: string): string | null {
  if (count === 0) return null;
  return [`${title} (${thousands(count)}):`, body.join("\n"), note].filter(Boolean).join("\n\n");
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
    `Of the ${thousands(keyed)} ${keyed === 1 ? "page" : "pages"} in this window whose address ` +
    `could be keyed, ${thousands(join.matched.length)} also appear in the crawl recorded ` +
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
  const sections = [
    section(
      "Reported by DataForSEO, and fetched by that crawl",
      join.matched.length,
      join.matched.map(renderMatchedPage),
      "",
    ),
    section(
      "Reported by DataForSEO, not found in that crawl",
      join.vendorOnly.length,
      join.vendorOnly.map(renderVendorPage),
      crawlLimitsNote(crawl),
    ),
    section(
      "Fetched by that crawl, not named in this window",
      join.crawlOnly.length,
      join.crawlOnly.map((page) => `• ${renderCrawledPage(page)}`),
      windowLimitsNote(result),
    ),
    section(
      "Addresses that could not be keyed, and so could not be compared either way",
      join.vendorUnkeyed.length + join.crawlUnkeyed.length,
      [
        ...join.vendorUnkeyed.map((row) => `• ${row.page_address} (from DataForSEO)`),
        ...join.crawlUnkeyed.map((page) => `• ${page.url} (from your crawl)`),
      ],
      "These addresses did not parse as URLs, so they are held out of the three groups above " +
        "rather than counted as misses on either side.",
    ),
  ].filter((part): part is string => part !== null);
  return [renderMatchCount(join, crawl), ...sections].join("\n\n");
}

/**
 * Whose numbers these are, and what this tool does NOT claim. Printed on every answer (NEVER #7).
 */
export const VENDOR_JUDGEMENT_NOTE =
  "Every figure above is a DataForSEO field, printed under DataForSEO's own name. `etv` and " +
  "`estimated_paid_traffic_cost` are DataForSEO's OWN ESTIMATES of monthly traffic and of what " +
  "that traffic would cost to buy — they are not measurements of your traffic, and SeoGrep does " +
  "not predict traffic, revenue or ranking success. The position buckets are a histogram of how " +
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
      `${thousands(result.window.window_offset)}, limit ` +
      `${thousands(result.window.window_limit)}). That is an answer about this window, these ` +
      "result types and these filters — it is not a statement that the domain has no ranking " +
      "pages.",
    renderComparison(result, crawl),
  ].join("\n\n");
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
    result.window.rows.map(renderVendorPage).join("\n"),
    renderComparison(result, crawl),
    VENDOR_JUDGEMENT_NOTE,
  ].join("\n\n");
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
}

export function makeMyPagesTool(deps: MyPagesDeps = {}): RegisteredTool {
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
        return textResult(formatMyPages(result, input, crawl, subject.project));
      });
    },
  });
}

/** The production my_pages tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const myPagesTool = makeMyPagesTool();
