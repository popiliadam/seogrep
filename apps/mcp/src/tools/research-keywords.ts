import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  resolveDefaultPort,
  type KeywordResearchPort,
  type KeywordVolumeRow,
} from "../dfs/client.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * research_keywords — look up Google search volume / CPC / competition for up to 100
 * keywords via DataForSEO. Synchronous: it returns a table immediately (no background job).
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
  "Look up Google search volume, CPC, and competition for up to 100 keywords. Synchronous " +
  `— returns a table immediately. Costs ${TOOL_COSTS.research_keywords} credits. Live keyword ` +
  "data is off during beta; while it is off this tool returns a clear 'not yet enabled' " +
  "error and charges nothing.";

/** Group digits with commas without depending on ICU/locale data (deterministic). */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Render the keyword metrics as the plain-text tool output (pure — unit-tested directly). */
export function formatSearchVolume(
  rows: readonly KeywordVolumeRow[],
  input: { keywords: readonly string[]; language_code: string; location_code: number },
): string {
  if (rows.length === 0) {
    return `No search-volume data was returned for the ${input.keywords.length} keyword(s) requested.`;
  }
  const totalVolume = rows.reduce((sum, row) => sum + (row.search_volume ?? 0), 0);
  const lines = rows.map((row) => {
    const volume = row.search_volume === null ? "n/a" : thousands(row.search_volume);
    const cpc = row.cpc === null ? "n/a" : `$${row.cpc.toFixed(2)}`;
    const competition = row.competition ?? "n/a";
    return `• ${row.keyword} — volume ${volume}, CPC ${cpc}, competition ${competition}`;
  });
  return (
    `Search volume for ${rows.length} keyword${rows.length === 1 ? "" : "s"} ` +
    `(language ${input.language_code}, location ${input.location_code}), ` +
    `${thousands(totalVolume)} total monthly searches:\n${lines.join("\n")}`
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
        const rows = await port.fetchSearchVolume({
          keywords: input.keywords,
          language_code: input.language_code,
          location_code: input.location_code,
        });
        return textResult(formatSearchVolume(rows, input));
      });
    },
  });
}

/** The production research_keywords tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const researchKeywordsTool = makeResearchKeywordsTool();
