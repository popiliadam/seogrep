import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { withNoChargeNote } from "../credits/free-refusal.ts";
import {
  DEFAULT_KEYWORD_GAP_LIMIT,
  KEYWORD_GAP_MAX_LIMIT,
  resolveDefaultKeywordGapPort,
  type KeywordGapPort,
  type KeywordGapResult,
  type KeywordGapRow,
} from "../dfs/keyword-gap.ts";
import { normalizeDomain } from "./setup-project.ts";
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
 * keyword_gap — the Google organic keywords a RIVAL ranks for and the caller's own domain does
 * not, from the DataForSEO Labs domain_intersection endpoint run in its non-intersecting mode
 * (see dfs/keyword-gap.ts). Synchronous: it returns the list immediately (no background job). It
 * takes EITHER a bare `target` (any public domain) OR a `project_id`, whose stored domain becomes
 * the target, plus exactly one `competitor` — a rival is by definition not one of your projects.
 *
 * It is built to the compare_competitors pattern, and the same two hard product rules shape its
 * credit path:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear English
 *      error and NEVER serves sample/placeholder figures as if they were real (NEVER #7). The mock
 *      fixtures exist only for tests.
 *   2. That live-disabled error — and every invalid-input rejection — is returned BEFORE any credit
 *      reserve, so the ledger is touched ZERO times (NEVER #2).
 *
 * charge:"handler" for the same reason compare_competitors uses it: this is a SYNCHRONOUS tool
 * that must run logic BEFORE the reserve, which charge:"surface" (reserve-then-handler) cannot
 * express. On the serving path it settles via withCredits WITHOUT a jobId — the exact SURFACE
 * ledger shape (reserve -> commit, a traceability uuid, no jobs row).
 *
 * One gap is ONE paid DataForSEO request. If it fails, withCredits releases the reserve and the
 * caller's balance ends where it started — a half-built list is never billed.
 */

/** United States — the DataForSEO default location_code (same default as ranked_keywords). */
const DEFAULT_LOCATION_CODE = 2840;

const NOT_ENABLED_MESSAGE =
  "Keyword gap analysis is not yet enabled on this deployment. Live DataForSEO data is turned " +
  "off, and SeoGrep never returns sample or placeholder figures as if they were real. This tool " +
  "will start returning data once live DataForSEO access is switched on — you were not charged.";

const inputSchema = z.object({
  target: targetField("analyse for keyword gaps"),
  project_id: projectIdField,
  competitor: z
    .string()
    .min(1)
    .describe(
      'The rival to mine for gaps, e.g. "competitor.com" — the keywords it ranks for and your ' +
        "domain does not. One competitor per call.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(KEYWORD_GAP_MAX_LIMIT)
    .default(DEFAULT_KEYWORD_GAP_LIMIT)
    .describe(
      `How many gap keywords to return (1–${KEYWORD_GAP_MAX_LIMIT}, default ` +
        `${DEFAULT_KEYWORD_GAP_LIMIT}), highest search volume first. Whenever DataForSEO sends a ` +
        "count of the whole set, the header states it — as \"N of M\", or as a note that this " +
        "list is all of them — and when the vendor sends no count the header says that too, so a " +
        "shorter list never reads like the whole picture.",
    ),
  language_code: z.string().min(2).default("en").describe("Language code (default 'en')."),
  location_code: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_LOCATION_CODE)
    .describe("DataForSEO location code (default 2840 = United States)."),
});

type KeywordGapInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Find the Google organic keywords a competitor ranks for and your domain does not — each with " +
  "its monthly search volume, the competitor's position, the page holding that ranking, keyword " +
  "difficulty and CPC. Pass a target domain (any public domain) or a project_id, plus one " +
  "competitor. Synchronous — returns the list immediately. Costs " +
  `${TOOL_COSTS.keyword_gap} credits. Needs a paid credit balance: it is not available on trial ` +
  "credits. If live DataForSEO access is unavailable on this deployment, the tool says so and " +
  "charges nothing.";

/**
 * Group digits with commas without depending on ICU/locale data (deterministic). Kept local on
 * purpose: sharing it would mean editing ranked_keywords / analyze_backlinks / compare_competitors,
 * whose behaviour is pinned.
 */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A metric value: a grouped number, or an honest "n/a" when DataForSEO had none. */
function metric(value: number | null): string {
  return value === null ? "n/a" : thousands(value);
}

/**
 * WHAT THE WHOLE SET IS — stated on EVERY answer, including the two cases the "N of M" phrasing
 * cannot cover.
 *
 * The schema used to promise "the header always says how many gaps exist in total". It did not:
 * the total appeared ONLY when the vendor sent one AND it exceeded the window, which leaves the
 * exact case the promise exists for — a short list that IS the whole picture — reading like a
 * truncation, and a vendor that sent no count at all reading like a complete answer. Both are now
 * said out loud.
 *
 * The vendor silence is stated rather than papered over: `rows.length` is OUR count of what came
 * back, never DataForSEO's count of what exists, and printing it as a total would be a
 * measurement nobody made (NEVER #7). So the promise cannot be "always names a number" — it is
 * "always says what is known about the whole set", which is a promise the code can keep.
 */
export function renderGapTotalNote(total: number | null, shown: number): string {
  if (total === null) {
    return (
      "DataForSEO sent no count of the whole set for this request, so this list may not be all " +
      "of them"
    );
  }
  if (total > shown) return "";
  if (total === shown) {
    return `DataForSEO reports ${thousands(total)} in total, so this list is all of them`;
  }
  return (
    `DataForSEO reports ${thousands(total)} in total, fewer than the ${thousands(shown)} rows it ` +
    "returned"
  );
}

/**
 * The header for the gap list — honest about how much of the total is shown, and about WHAT the
 * list is. "ranks for and X does not" is the endpoint's own non-intersecting semantics restated;
 * nothing here claims the rival outranks the caller, because on these keywords the caller has no
 * ranking to be outranked on.
 */
export function renderGapHeader(gap: KeywordGapResult, input: KeywordGapRenderInput): string {
  const where = `(language ${input.language_code}, location ${input.location_code})`;
  const subject = subjectLabel(gap.target, input.project);
  const shown = gap.rows.length;
  const total = gap.total_count;
  const scope =
    total !== null && total > shown
      ? `${thousands(shown)} of ${thousands(total)} keywords`
      : `${thousands(shown)} keyword${shown === 1 ? "" : "s"}`;
  const lead =
    `Keyword gap for ${subject} against ${gap.competitor} ${where} — ${scope} ` +
    `${gap.competitor} ranks for and ${subject} does not, highest search volume first`;
  const note = renderGapTotalNote(total, shown);
  return note === "" ? `${lead}:` : `${lead}. ${note}:`;
}

/**
 * One gap row. Every clause is printed only when DataForSEO actually returned the value behind
 * it; an absent metric is left OUT rather than rendered as a zero or an "n/a" that would read as
 * a measurement. The one exception is search volume, which is the axis the list is ordered by and
 * therefore always stated — as "n/a" when the vendor holds no figure, because "nobody has a
 * number for this" and "nobody searches this" are different facts (the research_keywords rule).
 */
export function renderGapRow(row: KeywordGapRow, competitor: string): string {
  const head = [`"${row.keyword}" — ${metric(row.search_volume)} searches/mo`];
  if (row.competitor_position !== null) {
    head.push(`${competitor} ranks #${row.competitor_position}`);
  }
  if (row.keyword_difficulty !== null) {
    head.push(`difficulty ${row.keyword_difficulty} of 100`);
  }
  if (row.cpc !== null) {
    const band = row.competition_level === null ? "" : ` (${row.competition_level} competition)`;
    head.push(`CPC $${row.cpc.toFixed(2)}${band}`);
  } else if (row.competition_level !== null) {
    head.push(`${row.competition_level} competition`);
  }
  const lines = [`• ${head.join(" · ")}`];
  if (row.competitor_url !== null) {
    // The ETV clause keeps DataForSEO's own scope: "estimated traffic volume" for THAT ranking,
    // an estimate of monthly visits and not measured traffic, so it is labelled as one.
    const etv =
      row.competitor_etv === null
        ? ""
        : ` — an estimated ${metric(row.competitor_etv)} visits/mo`;
    lines.push(`  ${row.competitor_url}${etv}`);
  }
  return lines.join("\n");
}

/**
 * How the output names what was looked up. `project` is present only when the caller passed a
 * project_id, so a bare-target call renders as a quoted domain.
 */
export interface KeywordGapRenderInput {
  readonly language_code: string;
  readonly location_code: number;
  readonly project?: ProjectRef | null;
}

/** The "nothing found" answer — a real result, not an error, and still charged for. */
function renderNoGap(gap: KeywordGapResult, input: KeywordGapRenderInput): string {
  return (
    `No keyword gap found for ${subjectLabel(gap.target, input.project)} against ` +
    `${gap.competitor} (language ${input.language_code}, location ${input.location_code}): ` +
    `DataForSEO holds no organic keyword that ${gap.competitor} ranks for and ` +
    `${subjectLabel(gap.target, input.project)} does not.`
  );
}

/** Render the gap as the plain-text tool output (pure — unit-tested directly). */
export function formatKeywordGap(gap: KeywordGapResult, input: KeywordGapRenderInput): string {
  if (gap.rows.length === 0) {
    return renderNoGap(gap, input);
  }
  return [
    renderGapHeader(gap, input),
    ...gap.rows.map((row) => renderGapRow(row, gap.competitor)),
  ].join("\n\n");
}

/** Dependencies — the gap port is injectable so tests run offline (mock/disabled). */
export interface KeywordGapDeps {
  /**
   * The keyword-gap port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: KeywordGapPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
}

/** The rejection a caller gets for naming their own domain as its own rival. */
export const SELF_COMPETITOR_MESSAGE =
  "The competitor is the same domain as the target — a domain has no keyword gap against " +
  "itself. Name a different domain. You were not charged.";

export function makeKeywordGapTool(deps: KeywordGapDeps = {}): RegisteredTool {
  return defineTool<KeywordGapInput>({
    name: "keyword_gap",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — resolve WHOSE gap this is: exactly one of project_id / target,
      // the project read tenant-scoped, the domain canonicalized by the shared normalizer. Every
      // rejection it returns costs nothing (see project-target.ts).
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      // Free pre-reserve gate 2 — the competitor goes through the SAME normalizer, and is matched
      // against the RESOLVED target, so naming your own project's domain as its own rival is
      // rejected exactly as it is on the bare-target path.
      const competitor = normalizeDomain(input.competitor);
      if (!competitor.ok) {
        // Free and pre-reserve like every gate around it, so it says so. normalizeDomain's
        // wording is shared with 0-credit tools and is not edited at its source in packages/core.
        return errorResult(withNoChargeNote(competitor.error));
      }
      if (competitor.domain === subject.domain) {
        return errorResult(SELF_COMPETITOR_MESSAGE);
      }
      const port = deps.port ?? resolveDefaultKeywordGapPort();
      // Free pre-reserve gate 3 — refuse rather than reserve credits or serve mock data.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch ->
      // commit as one chain. The DataForSEO request failing throws, so withCredits releases and
      // a failed lookup is never billed.
      // WHICH PROJECT THE SPEND IS FOR, on the ledger row itself (migration 0033) — the
      // ownership-gated project resolved above. charge:"handler" settles its own credits, so
      // nothing upstream can supply this; undefined on a bare-target call is a REAL answer
      // ("no project scope"), never a gap (credits/guard.ts).
      const meta = { tool: "keyword_gap", projectId: subject.project?.id } as const;
      return withCredits({ userId: ctx.userId }, meta, async () => {
        const gap = await port.fetchKeywordGap({
          target: subject.domain,
          competitor: competitor.domain,
          limit: input.limit,
          language_code: input.language_code,
          location_code: input.location_code,
        });
        return textResult(
          formatKeywordGap(gap, {
            language_code: input.language_code,
            location_code: input.location_code,
            project: subject.project,
          }),
        );
      });
    },
  });
}

/** The production keyword_gap tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const keywordGapTool = makeKeywordGapTool();
