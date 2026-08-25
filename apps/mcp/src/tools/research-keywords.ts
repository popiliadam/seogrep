import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  resolveDefaultPort,
  type KeywordOverviewRow,
  type KeywordResearchPort,
} from "../dfs/client.ts";
import {
  keywordResearchRunReport,
  normalizeKeywordSet,
  writeKeywordResearchRun,
  type KeywordResearchRunWriter,
} from "../dfs/keyword-runs.ts";
import { STALE_PULL_DAYS } from "../gsc-data/load.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * research_keywords — look up Google keyword metrics for up to 100 keywords via the
 * DataForSEO Labs keyword_overview endpoint. Synchronous: it returns a table immediately
 * (no background job).
 *
 * Three hard product rules shape the credit path:
 *   1. Live keyword data is OFF by default (beta). While off, the tool returns a clear
 *      English error and NEVER serves sample/placeholder figures as if they were real
 *      (constitution NEVER #7). The mock fixture exists only for tests.
 *   2. That live-disabled error is returned BEFORE any credit reserve, so the ledger is
 *      touched ZERO times and the user is not charged (constitution NEVER #2).
 *   3. A lookup that comes back with NO figure for any keyword is not charged either
 *      (operator decision 2026-08-25). That one cannot be gated before the reserve — only the
 *      vendor's answer reveals it — so it is raised as a throw from inside withCredits, which
 *      releases. See NO_DATA_MESSAGE and serveKeywordOverview.
 *
 * WHAT WAS WRONG FOR TURKISH KEYWORDS, AND WHAT WAS NOT (measured 2026-08-25). A production call
 * for `diş beyazlatma` in the Turkish market returned "no data returned for this keyword" for 25
 * credits while `discover_keywords` returned real figures for the same market. The obvious
 * hypothesis — that this tool was still on the retired `keywords_data/google_ads/search_volume`
 * endpoint, which the operator measured returning metric-less items for Turkey — IS FALSE: the
 * move to Labs `keyword_overview` landed on 2026-08-17 (dfs/client.ts) and is what production
 * runs. The defect was one layer in: the projection decided "has data" from three GOOGLE-ADS-
 * sourced fields only, so a Labs row whose Ads half is empty but whose Labs half (difficulty,
 * intent, competition, trend) is populated was stamped no-data and printed as one sentence, with
 * everything the vendor DID report thrown away. dfs/client.ts hasMetrics() carries the argument.
 *
 * Why charge:"handler" for a SYNCHRONOUS tool: this is NOT an async job — it settles its
 * OWN credits, synchronously. defineTool's charge:"surface" reserves BEFORE the handler
 * runs, which cannot express rule 2's pre-reserve honesty gate. "handler" mode is the one
 * where the HANDLER owns settlement and defineTool does NOT auto-wrap, so the handler gates
 * enablement first and, only on the serving path, settles via withCredits WITHOUT a jobId —
 * the exact SURFACE ledger shape (reserve -> handler -> commit, a traceability uuid, no jobs
 * row). ("worker" mode, by contrast, is for a handler that ENQUEUES and lets the async worker
 * settle against the real jobs.id — crawl_site; using it here would misdescribe this tool.)
 *
 * PRICE IS UNCHANGED at 25 credits (NEVER #6 — operator signature 2026-08-17). The vendor
 * switch made this tool CHEAPER to serve and richer to read; neither is a reason to move a
 * number a human signed.
 */

/** United States — the DataForSEO default location_code. */
const DEFAULT_LOCATION_CODE = 2840;

/**
 * The all-blank rejection — free, BEFORE the reserve, exactly like NOT_ENABLED_MESSAGE.
 *
 * `z.string().min(1)` accepts "   ", so a caller can pass a schema-valid list that names no
 * keyword at all. Such a call has no subject: 0029's identity column would be the empty array and
 * its CHECK would refuse the row — AFTER the vendor had been paid and the caller served. Refusing
 * here costs nothing and keeps that CHECK what it should be, a database invariant rather than an
 * app error path.
 */
const NO_KEYWORDS_MESSAGE =
  "No keywords were given. Every keyword in the list was empty or whitespace, so there is " +
  "nothing to look up — you were not charged.";

/**
 * The vendor answered, but with no metric for ANY keyword — refused free of charge.
 *
 * OPERATOR DECISION 2026-08-25: a lookup that returns no numbers at all is not charged. The 25
 * credits buy figures; a table of "no data" lines is not a smaller answer, it is no answer. The
 * refusal is raised as a THROW from inside the guarded region, because that is what makes it free:
 * withCredits commits a handler that RETURNS and releases one that THROWS (credits/guard.ts, and
 * that release is pinned against the real ledger in credits/guard.db.test.ts).
 *
 * WHAT IT COSTS US ANYWAY, said out loud: DataForSEO is still paid for the call, and dfs/budget.ts
 * has already reserved and settled that spend inside the port before this check runs. The customer
 * is held harmless; the house is not. That is the direction the operator signed.
 */
const NO_DATA_MESSAGE =
  "DataForSEO returned no search-volume data for any of the keywords requested — not one of " +
  "them came back with a figure. Rather than charge for an empty table, this lookup was refused: " +
  "you were not charged. Keywords outside the vendor's Google Ads coverage (often non-English " +
  "markets, or very rare terms) do this; try a broader or more common phrasing for the same market.";

const NOT_ENABLED_MESSAGE =
  "Keyword research is not yet enabled on this deployment. Live search-volume data " +
  "(DataForSEO) is turned off, and SeoGrep never returns sample or placeholder figures " +
  "as if they were real. This tool will start returning data once live keyword research " +
  "is switched on — you were not charged.";

const inputSchema = z.object({
  keywords: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .describe("Keywords to look up (1–100)."),
  language_code: z.string().min(2).default("en").describe("Language code (default 'en')."),
  location_code: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_LOCATION_CODE)
    .describe("DataForSEO location code (default 2840 = United States)."),
});

type ResearchKeywordsInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Look up Google search volume, CPC, competition, keyword difficulty, search intent and " +
  "search-volume trend for up to 100 keywords. Synchronous — returns a table immediately. " +
  `Costs ${TOOL_COSTS.research_keywords} credits. Needs a paid ` +
  "credit balance: it is not available on trial credits. If live keyword data is unavailable " +
  "on this deployment, the tool says so and charges nothing.";

/** Group digits with commas without depending on ICU/locale data (deterministic). */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A signed percentage, so a reader never has to work out which way a trend points. */
function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
}

/**
 * DataForSEO timestamps look like `2026-06-14 08:12:33 +00:00`, which is NOT an ISO-8601
 * string. Anything unrecognized returns null — an unparseable vendor date must drop the
 * FRESHNESS LINE, never print "NaN days ago". THAT part is pinned by a spec.
 *
 * The normalization to ISO is deliberately NOT pinned, and cannot be: V8 accepts the raw DFS
 * form too, so removing these two `replace` calls changes no observable behaviour on Node
 * (measured — the mutation stayed green). It is kept as portability insurance against an
 * engine that follows the spec more strictly, and is recorded here as unproven rather than
 * left to look like tested code.
 */
export function parseDfsTimestamp(raw: string): number | null {
  const normalized = raw.trim().replace(" ", "T").replace(/\s+/, "");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The CPC/competition freshness line.
 *
 * The operator A/B (2026-08-17) measured Labs CPC running up to 53% away from the Google Ads
 * figure for the same keyword, and its monthly series a month behind. A bid figure with no
 * date attached invites the reader to treat it as today's auction. Labs answers this itself —
 * every keyword carries `keyword_info.last_updated_time` — so the tool prints it, and past
 * STALE_PULL_DAYS says so in a SENTENCE.
 *
 * STALE_PULL_DAYS is IMPORTED from gsc-data/load.ts rather than re-declared: this product has
 * one answer to "how old is too old", and two copies of a threshold is how they drift apart.
 *
 * The OLDEST timestamp in the batch is the one reported — a table is only as fresh as its
 * stalest row, and quoting the freshest would flatter the batch.
 *
 * Rows the vendor has NO metrics for still count toward that oldest timestamp, deliberately.
 * DFS stamps them anyway (measured: "backlink checker" came back with a `last_updated_time`
 * and nothing else), and that stamp says when the vendor last looked — which is exactly the
 * claim this line makes. Excluding them could only ever make the batch look FRESHER than the
 * vendor's own oldest look at it, which is the wrong direction for an honesty line.
 */
export function renderVendorFreshness(
  rows: readonly KeywordOverviewRow[],
  now: Date = new Date(),
): string | null {
  const stamps = rows
    .map((row) => (row.last_updated_time === null ? null : parseDfsTimestamp(row.last_updated_time)))
    .filter((ms): ms is number => ms !== null);
  if (stamps.length === 0) return null;
  const oldest = Math.min(...stamps);
  const days = Math.floor((now.getTime() - oldest) / 86_400_000);
  const day = new Date(oldest).toISOString().slice(0, 10);
  const age = days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  const staleness =
    days >= STALE_PULL_DAYS
      ? " This vendor data is stale — treat CPC and competition as indicative, not current."
      : "";
  return `CPC and competition were last refreshed by DataForSEO on ${day} (${age}).${staleness}`;
}

/** The per-keyword line. Optional metrics are OMITTED rather than padded with n/a noise. */
function renderRow(row: KeywordOverviewRow): string {
  if (!row.has_data) {
    // Distinct from "volume 0" on purpose: the vendor holds nothing for this keyword, which is
    // not the same claim as "nobody searches it" and must not be read as one.
    return `• ${row.keyword} — no data returned for this keyword`;
  }
  const parts = [
    `volume ${row.search_volume === null ? "n/a" : thousands(row.search_volume)}`,
    `CPC ${row.cpc === null ? "n/a" : `$${row.cpc.toFixed(2)}`}`,
    `competition ${row.competition_level ?? "n/a"}`,
  ];
  if (row.keyword_difficulty !== null) {
    parts.push(`difficulty ${row.keyword_difficulty}/100`);
  }
  if (row.main_intent !== null) {
    const also = row.foreign_intent.length > 0 ? ` (also ${row.foreign_intent.join(", ")})` : "";
    parts.push(`intent ${row.main_intent}${also}`);
  }
  const trend = row.search_volume_trend;
  if (trend) {
    const legs = [
      trend.monthly === null ? null : `${signedPercent(trend.monthly)} MoM`,
      trend.quarterly === null ? null : `${signedPercent(trend.quarterly)} QoQ`,
      trend.yearly === null ? null : `${signedPercent(trend.yearly)} YoY`,
    ].filter((leg): leg is string => leg !== null);
    if (legs.length > 0) parts.push(`trend ${legs.join(", ")}`);
  }
  return `• ${row.keyword} — ${parts.join(", ")}`;
}

/**
 * Keywords the CALLER asked about that no returned row corresponds to — in the caller's own
 * wording, in the order they typed them.
 *
 * THE DEFECT THIS CLOSES (measured 2026-08-25). Two production calls each came back with N−1 of N
 * keywords and said nothing about the one that vanished: `["diş beyazlatma","implant
 * fiyatları","zirkonyum kaplama"]` lost `implant fiyatları`, and `["implant","ortodonti"]` lost
 * `implant`. The vendor holds all of them. Nothing here is a vendor bug that needs guessing at:
 * the answer is built from the rows that ARRIVE, so a keyword the vendor omits — or one whose item
 * carries `keyword: null` and is dropped by the projection (dfs/client.ts) — simply never reaches
 * the page. The tool already states in words when it has NO DATA for a keyword, so the reader has
 * every reason to believe a keyword's absence means something, and cannot tell "we hold nothing
 * for this" from "we lost it".
 *
 * MATCHING USES normalizeKeywordSet's OWN NORMALIZATION, one keyword at a time, rather than a
 * second lowercase/trim written here: DataForSEO echoes keywords lowercased (measured on the
 * repo's captured response), so the comparison has to be case- and whitespace-insensitive, and two
 * copies of that rule are how they drift apart. Blank entries normalize away to nothing and are
 * not "missing" — they were never a keyword (see NO_KEYWORDS_MESSAGE).
 */
/**
 * The key both sides of that comparison are reduced to: normalizeKeywordSet's OWN rule (trim,
 * collapse whitespace, lowercase — reused, not re-typed, so the two cannot drift), plus ONE extra
 * fold. `undefined` for a string that is no keyword at all.
 *
 * THE EXTRA FOLD, and why it is here and NOT in 0029's identity. `"FİYAT".toLowerCase()` is not
 * `"fiyat"`: ECMAScript's locale-independent lowercase maps the Turkish dotted capital İ to `i`
 * followed by COMBINING DOT ABOVE (U+0307), so a caller who typed their Turkish keyword in capitals
 * would be told, beside the row that actually answers it, that no row for it arrived — a brand-new
 * false sentence introduced by the very reconciliation meant to stop false silences. Measured here,
 * not assumed: the spec that found it is in research-keywords.test.ts.
 *
 * Dropping U+0307 is the narrowest fold that fixes it — it merges nothing except a lowercased İ
 * with an i, and no keyword is distinguished by a free-standing combining dot. It deliberately does
 * NOT strip marks in general: `ş` and `s` are different letters in the market this tool just failed
 * in, and folding them would make a genuinely absent keyword look answered.
 *
 * It stays OUT of normalizeKeywordSet because that function is migration 0029's IDENTITY column:
 * widening it merges two run subjects into one retroactively, which is a signed decision and not
 * this fix's to take. Here it only decides whether to print a line.
 */
function matchKey(raw: string): string | undefined {
  return normalizeKeywordSet([raw])[0]?.replace(/\u0307/g, "");
}

export function missingKeywords(
  rows: readonly KeywordOverviewRow[],
  keywords: readonly string[],
): string[] {
  const answered = new Set(rows.map((row) => matchKey(row.keyword)));
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const raw of keywords) {
    const key = matchKey(raw);
    if (key === undefined || answered.has(key) || seen.has(key)) continue;
    seen.add(key);
    missing.push(raw.trim());
  }
  return missing;
}

/**
 * A keyword the vendor did not answer for AT ALL — a different fact from a row that came back
 * empty, and worded differently on purpose. "No data returned for this keyword" says DataForSEO
 * looked and holds nothing; this one says no row for it arrived, which is all we honestly know.
 */
function renderMissing(keyword: string): string {
  return `• ${keyword} — DataForSEO returned no row for this keyword`;
}

/** Render the keyword metrics as the plain-text tool output (pure — unit-tested directly). */
export function formatKeywordOverview(
  rows: readonly KeywordOverviewRow[],
  input: { keywords: readonly string[]; language_code: string; location_code: number },
  now: Date = new Date(),
): string {
  if (rows.length === 0) {
    return `No search-volume data was returned for the ${input.keywords.length} keyword(s) requested.`;
  }
  // A no-data keyword adds NOTHING to the total — but note exactly HOW, because the two
  // readings differ: nothing is filtered out here. Such a row's `search_volume` is null and
  // `?? 0` adds a zero. The arithmetic is identical either way, and saying which one is
  // actually written matters: a reader who believes there is a filter would go looking for one
  // that does not exist, and would not notice if a future no-data row arrived carrying a
  // non-null volume. What makes a no-data keyword VISIBLE is the header count below, not the sum.
  const totalVolume = rows.reduce((sum, row) => sum + (row.search_volume ?? 0), 0);
  // Every keyword the caller named is accounted for: the vendor's rows first, in the vendor's own
  // order, then the ones no row came back for. Appended rather than interleaved so that the rows
  // the vendor DID send keep the order and the duplicate-passthrough this file already pins.
  const absent = missingKeywords(rows, input.keywords);
  const unanswered = rows.filter((row) => !row.has_data).length + absent.length;
  const missingNote =
    unanswered === 0 ? "" : ` (${unanswered} keyword${unanswered === 1 ? "" : "s"} returned no data)`;
  const lines = [...rows.map(renderRow), ...absent.map(renderMissing)];
  const freshness = renderVendorFreshness(rows, now);
  return (
    `Search volume for ${lines.length} keyword${lines.length === 1 ? "" : "s"} ` +
    `(language ${input.language_code}, location ${input.location_code}), ` +
    `${thousands(totalVolume)} total monthly searches${missingNote}:\n${lines.join("\n")}` +
    (freshness === null ? "" : `\n${freshness}`)
  );
}

/**
 * The vendor answered for nothing — not one returned row carries a metric.
 *
 * TYPED, and thrown rather than returned, for DfsBudgetExhaustedError's two reasons: a throw out
 * of the guarded region is what RELEASES the reserve, and a type (not a text match) is what lets
 * the handler tell this designed refusal apart from a genuine failure. It never escapes this
 * module — the handler catches it immediately outside withCredits and turns it into the sentence.
 */
export class EmptyKeywordLookupError extends Error {
  constructor() {
    super("DataForSEO returned no metrics for any requested keyword");
    this.name = "EmptyKeywordLookupError";
  }
}

/** Narrow to the empty-lookup refusal (name fallback: a duplicated module instance breaks `instanceof`). */
export function isEmptyKeywordLookup(error: unknown): error is EmptyKeywordLookupError {
  return (
    error instanceof EmptyKeywordLookupError ||
    (error instanceof Error && error.name === "EmptyKeywordLookupError")
  );
}

/**
 * Did this lookup measure anything at all? False when the vendor sent no rows, and false when it
 * sent rows that all came back empty — the two ways a caller ends up with a page of nothing.
 *
 * ONE ROW WITH ONE METRIC IS ENOUGH to charge. The operator's words were "no numbers at all", and
 * this is implemented as "no METRIC at all", which differs in exactly one place: a row carrying
 * only `main_intent` (a word, not a number) counts as answered and is charged. That is deliberate
 * — intent is a Labs metric this tool's description sells — but it is a judgement, so it is
 * written down rather than left for a reader to discover.
 */
export function isUnansweredLookup(rows: readonly KeywordOverviewRow[]): boolean {
  return !rows.some((row) => row.has_data);
}

/** Dependencies — the keyword-research port is injectable so tests run offline (mock/disabled). */
export interface ResearchKeywordsDeps {
  /**
   * The keyword-research port. Defaults to the env-resolved port each call: a live client
   * when DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a
   * mock (to exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: KeywordResearchPort;
  /**
   * The run recorder (default: the real `writeKeywordResearchRun`). A PORT for the reason every
   * other writer in this family is one: a spec can make it FAIL without breaking a database, which
   * is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeRun?: KeywordResearchRunWriter;
}

/**
 * The PAID body — everything that runs inside withCredits, extracted so the fast lane can drive it
 * with a real parser and a real formatter and watch it THROW rather than return.
 *
 * That distinction is the whole money contract and it is not observable from outside the guard: a
 * refusal that RETURNS is a refusal that charges. Exported for that reason, and for that reason
 * only — the tool's own handler is its single production caller.
 */
export async function serveKeywordOverview(
  deps: { readonly port: KeywordResearchPort; readonly writeRun: KeywordResearchRunWriter },
  ctx: AuthContext,
  input: ResearchKeywordsInput,
  keywordSet: readonly string[],
): Promise<ToolResult> {
  const rows = await deps.port.fetchKeywordOverview({
    keywords: input.keywords,
    language_code: input.language_code,
    location_code: input.location_code,
  });
  // Nothing measured -> nothing charged (operator, 2026-08-25). BEFORE the run write: a run row is
  // the record of a lookup that DELIVERED, and this one delivered no figure and took no credit.
  if (isUnansweredLookup(rows)) {
    throw new EmptyKeywordLookupError();
  }
  const text = formatKeywordOverview(rows, input);
  // THE RUN IS RECORDED BEFORE THE REPLY IS RETURNED, and the write is NOT guarded
  // (migration 0029; dfs/keyword-runs.ts states the same contract from the other side).
  // withCredits commits a handler that RETURNS and releases one that THROWS, so an error
  // escaping here costs the tenant nothing. Caught and logged instead, the shape would be
  // the house's worst: a charged caller, a delivered table, and a panel that says forever
  // that the lookup never ran.
  await deps.writeRun(
    { userId: ctx.userId, keywordSet },
    keywordResearchRunReport(rows, {
      keywords: input.keywords,
      keywordSet,
      language_code: input.language_code,
      location_code: input.location_code,
    }),
  );
  return textResult(text);
}

export function makeResearchKeywordsTool(deps: ResearchKeywordsDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeKeywordResearchRun;
  return defineTool<ResearchKeywordsInput>({
    name: "research_keywords",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      const port = deps.port ?? resolveDefaultPort();
      if (!port.enabled) {
        // Pre-reserve honesty gate: refuse rather than reserve credits or serve mock data.
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // The SUBJECT of the run (migration 0029), resolved before the reserve because a call with
      // no subject is refused free of charge. The vendor still receives the caller's RAW list —
      // normalization decides what the row is ABOUT, it does not rewrite the request.
      const keywordSet = normalizeKeywordSet(input.keywords);
      if (keywordSet.length === 0) {
        return errorResult(NO_KEYWORDS_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch ->
      // commit as one chain. A fetch failure throws, so withCredits releases (no charge), and so
      // does the empty-lookup refusal, which is caught HERE — outside the guard, where the reserve
      // is already released — and turned into its sentence.
      try {
        return await withCredits({ userId: ctx.userId }, { tool: "research_keywords" }, () =>
          serveKeywordOverview({ port, writeRun }, ctx, input, keywordSet),
        );
      } catch (error) {
        if (isEmptyKeywordLookup(error)) return errorResult(NO_DATA_MESSAGE);
        throw error;
      }
    },
  });
}

/** The production research_keywords tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const researchKeywordsTool = makeResearchKeywordsTool();
