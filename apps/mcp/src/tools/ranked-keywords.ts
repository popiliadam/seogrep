import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  RANKED_KEYWORDS_MAX_LIMIT,
  resolveDefaultRankedKeywordsPort,
  type RankedKeywordsPort,
  type RankedKeywordsResult,
} from "../dfs/ranked-keywords.ts";
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
    .default(RANKED_KEYWORDS_MAX_LIMIT)
    .describe(`How many ranked keywords to return (1–${RANKED_KEYWORDS_MAX_LIMIT}, default ${RANKED_KEYWORDS_MAX_LIMIT}).`),
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
  "List the Google organic keywords a domain already ranks for — keyword, position, monthly " +
  "search volume, and the ranking URL. Pass a target domain (any public domain, including a " +
  "competitor's) or a project_id to look up one of your own sites. " +
  `Synchronous — returns a table immediately. Costs ${TOOL_COSTS.ranked_keywords} credits. Needs ` +
  "a paid credit balance: it is not available on trial credits. If live DataForSEO access is " +
  "unavailable on this deployment, the tool says so and charges nothing.";

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
 * This tool takes a bare `target` rather than a project_id, so it cannot infer the country;
 * the honest move is to name the assumption exactly when it looks wrong.
 */
const THIN_RESULT_ROWS = 5;

/**
 * How the output names what was looked up. `project` is present only when the caller passed a
 * project_id, so a bare-target call renders exactly as it always did.
 */
export interface RankedKeywordsRenderInput {
  readonly language_code: string;
  readonly location_code: number;
  readonly project?: ProjectRef | null;
}

/** Render the ranked keywords as the plain-text tool output (pure — unit-tested directly). */
export function formatRankedKeywords(
  result: RankedKeywordsResult,
  input: RankedKeywordsRenderInput,
): string {
  const where = `(language ${input.language_code}, location ${input.location_code})`;
  const subject = subjectLabel(result.target, input.project);
  if (result.rows.length === 0) {
    // Zero is the thinnest result there is, so it gets the caveat too — it used to be the ONE
    // path that skipped it, and it is precisely the case this hint exists for.
    return (
      `No Google organic rankings on record for ${subject} ${where}.` +
      localeHint(result.target, 0, input)
    );
  }
  const lines = result.rows.map((row) => {
    const position = row.position === null ? "n/a" : `#${row.position}`;
    const volume = row.search_volume === null ? "n/a" : thousands(row.search_volume);
    const url = row.url ?? "n/a";
    return `• ${row.keyword} — position ${position}, volume ${volume}, ${url}`;
  });
  const shown = `${result.rows.length} ranked keyword${result.rows.length === 1 ? "" : "s"}`;
  // total_count is the domain's FULL ranked-keyword count, so the header is honest about the
  // request having been truncated by `limit` rather than implying these are all of them.
  const scope =
    result.total_count === null || result.total_count <= result.rows.length
      ? shown
      : `${shown} of ${thousands(result.total_count)}`;
  const table = `Ranked keywords for ${subject} ${where} — ${scope}:\n${lines.join("\n")}`;
  // total_count, NOT rows.length: a 2-row page of a 5,312-keyword domain is TRUNCATED, not thin,
  // and its locale is obviously fine. Only the domain's real ranking count can say otherwise.
  return table + localeHint(result.target, result.total_count ?? result.rows.length, input);
}

/**
 * The domain's TLD when it is two letters, otherwise null.
 *
 * Two letters is the whole test, and it is the whole claim the hint makes: IANA delegates
 * country-code TLDs as two-letter labels. What this deliberately does NOT do is map that label
 * to a DataForSEO location_code. Exactly two codes have been measured here (US 2840, TR 2792) —
 * that is a pair of data points, not a table — and a guessed code does not fail loudly: it
 * returns another country's rankings, which read as perfectly ordinary data.
 */
function twoLetterTld(domain: string): string | null {
  const tld = domain.slice(domain.lastIndexOf(".") + 1).toLowerCase();
  return /^[a-z]{2}$/.test(tld) ? tld : null;
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
}

export function makeRankedKeywordsTool(deps: RankedKeywordsDeps = {}): RegisteredTool {
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
      return withCredits({ userId: ctx.userId }, { tool: "ranked_keywords" }, async () => {
        const result = await port.fetchRankedKeywords({
          target: subject.domain,
          limit: input.limit,
          language_code: input.language_code,
          location_code: input.location_code,
        });
        return textResult(
          formatRankedKeywords(result, {
            language_code: input.language_code,
            location_code: input.location_code,
            project: subject.project,
          }),
        );
      });
    },
  });
}

/** The production ranked_keywords tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const rankedKeywordsTool = makeRankedKeywordsTool();
