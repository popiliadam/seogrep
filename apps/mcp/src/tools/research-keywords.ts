import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  resolveDefaultPort,
  type KeywordOverviewRow,
  type KeywordResearchPort,
} from "../dfs/client.ts";
import { STALE_PULL_DAYS } from "../gsc-data/load.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * research_keywords — look up Google keyword metrics for up to 100 keywords via the
 * DataForSEO Labs keyword_overview endpoint. Synchronous: it returns a table immediately
 * (no background job).
 *
 * Two hard product rules shape the credit path:
 *   1. Live keyword data is OFF by default (beta). While off, the tool returns a clear
 *      English error and NEVER serves sample/placeholder figures as if they were real
 *      (constitution NEVER #7). The mock fixture exists only for tests.
 *   2. That live-disabled error is returned BEFORE any credit reserve, so the ledger is
 *      touched ZERO times and the user is not charged (constitution NEVER #2).
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

/** Render the keyword metrics as the plain-text tool output (pure — unit-tested directly). */
export function formatKeywordOverview(
  rows: readonly KeywordOverviewRow[],
  input: { keywords: readonly string[]; language_code: string; location_code: number },
  now: Date = new Date(),
): string {
  if (rows.length === 0) {
    return `No search-volume data was returned for the ${input.keywords.length} keyword(s) requested.`;
  }
  // Only keywords the vendor HAS data for feed the total; a keyword it knows nothing about
  // contributes nothing rather than a silent zero, and is counted out loud instead.
  const totalVolume = rows.reduce((sum, row) => sum + (row.search_volume ?? 0), 0);
  const missing = rows.filter((row) => !row.has_data).length;
  const missingNote =
    missing === 0 ? "" : ` (${missing} keyword${missing === 1 ? "" : "s"} returned no data)`;
  const lines = rows.map(renderRow);
  const freshness = renderVendorFreshness(rows, now);
  return (
    `Search volume for ${rows.length} keyword${rows.length === 1 ? "" : "s"} ` +
    `(language ${input.language_code}, location ${input.location_code}), ` +
    `${thousands(totalVolume)} total monthly searches${missingNote}:\n${lines.join("\n")}` +
    (freshness === null ? "" : `\n${freshness}`)
  );
}

/** Dependencies — the keyword-research port is injectable so tests run offline (mock/disabled). */
export interface ResearchKeywordsDeps {
  /**
   * The keyword-research port. Defaults to the env-resolved port each call: a live client
   * when DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a
   * mock (to exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: KeywordResearchPort;
}

export function makeResearchKeywordsTool(deps: ResearchKeywordsDeps = {}): RegisteredTool {
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
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch ->
      // commit as one chain. A fetch failure throws, so withCredits releases (no charge).
      return withCredits({ userId: ctx.userId }, { tool: "research_keywords" }, async () => {
        const rows = await port.fetchKeywordOverview({
          keywords: input.keywords,
          language_code: input.language_code,
          location_code: input.location_code,
        });
        return textResult(formatKeywordOverview(rows, input));
      });
    },
  });
}

/** The production research_keywords tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const researchKeywordsTool = makeResearchKeywordsTool();
