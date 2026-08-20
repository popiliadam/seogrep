import { z } from "zod";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { SerpDevice } from "../dfs/serp.ts";
import { SERP_DEVICES } from "./track-keywords.ts";
import {
  loadOwnProject,
  projectIdField,
  resolveTarget,
  subjectLabel,
  targetField,
  type LoadProjectFn,
  type ProjectRef,
} from "./project-target.ts";
import {
  countStoredMeasurements,
  loadStoredMeasurements,
  type CountMeasurementsFn,
  type LoadMeasurementsFn,
  type MeasurementFilter,
} from "./keyword-positions-store.ts";
import { formatKeywordPositions } from "./keyword-positions-format.ts";
import { defineTool, errorResult, textResult, type RegisteredTool } from "./registry.ts";

/**
 * keyword_positions — the READ half of the rank tracker: what SeoGrep already measured for a
 * domain's keywords, when, and under which locale and device.
 *
 * IT MEASURES NOTHING. No search engine is contacted, no DataForSEO request is made, and no vendor
 * money is spent — which is why it is not on the paid-balance gate (credits/paid-balance.ts lists
 * the tools that can spend, and this one cannot reach `reserveSpend` at all; the import-graph spec
 * derives that rather than trusting this sentence). The price is the analysis over measurements the
 * tenant already paid to take.
 *
 * =====================================================================================
 * WHAT 10 CREDITS HAVE TO BUY, GIVEN THE VENDOR COST IS ZERO
 * =====================================================================================
 * An answer worth paying for here is one that says exactly what was measured and refuses to say
 * anything that was not. Three rules follow, and each is pinned:
 *
 *   1. A GAP IS NOT A DECLINE. Two readings a month apart are two observations; the month between
 *      them is unmeasured and no line is drawn through it. Every comparison carries the elapsed
 *      span, an interval over a day says so in words, and nothing in the output claims a direction
 *      of travel (keyword-positions-format.ts owns those sentences).
 *   2. "NOT FOUND" AND "NOT MEASURED" STAY APART, all the way from the SERP port through storage
 *      (migration 0029's `status` column and its four CHECK constraints) to the three different
 *      sentences printed here. A position is never compared across a reading that does not have
 *      one.
 *   3. NOTHING STORED IS A FREE ANSWER. Charging 10 credits to be told that a store is empty would
 *      be charging for nothing at all, so the count runs BEFORE the reserve and an empty result
 *      refuses with zero ledger rows — the same pre-reserve honesty gate the DataForSEO tools use
 *      for a disabled vendor. (Contrast discover_keywords, where an empty answer IS charged: there
 *      a paid vendor request really happened.)
 *
 * charge:"handler": a synchronous tool that must run logic BEFORE the reserve. It settles through
 * withCredits WITHOUT a jobId (reserve -> commit, no jobs row), and every refusal below returns
 * before that call, so the ledger is untouched (NEVER #2). Every read is tenant-scoped (NEVER #4).
 */

/** The default window: enough readings to see a series, small enough to stay readable. */
export const DEFAULT_POSITION_WINDOW = 50;

/** The ceiling on one window. A bound on the ANSWER's size, not on what is stored. */
export const MAX_POSITION_WINDOW = 200;

const inputSchema = z.object({
  target: targetField("read stored positions for"),
  project_id: projectIdField,
  keyword: z
    .string()
    .min(1)
    .optional()
    .describe(
      "One keyword's series. Omit to read every keyword measured for this domain. Matched as " +
        "stored — trimmed and lower-cased, the same way track_keywords stores it.",
    ),
  location_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Only readings measured in this location. Omit to read every location — the readings are " +
        "grouped by location either way, and never mixed into one series.",
    ),
  language_code: z
    .string()
    .min(2)
    .optional()
    .describe("Only readings measured in this search language. Omit to read every language."),
  device: z
    .enum(SERP_DEVICES)
    .optional()
    .describe(
      "Only readings measured on this device. Omit to read both — desktop and mobile are " +
        "different SERPs and are never folded into one series.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_POSITION_WINDOW)
    .default(DEFAULT_POSITION_WINDOW)
    .describe(
      `How many readings this answer may hold (1-${MAX_POSITION_WINDOW}, default ` +
        `${DEFAULT_POSITION_WINDOW}), newest first. It bounds the ANSWER, not the store: the ` +
        "output always states how many readings match the filter in total, separately.",
    ),
});

type KeywordPositionsInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Read the SERP positions already measured and stored for a domain's keywords — each reading " +
  "with its own date, location, language and device. It measures nothing and contacts no search " +
  "engine: it reports what was stored, keeps 'not found' and 'not measured' apart, and never " +
  `draws a trend through days nobody measured. Costs ${TOOL_COSTS.keyword_positions} credits. If ` +
  "nothing has been measured yet, it says so and charges nothing.";

/** The "nothing has been measured" answer — a refusal, and free. */
export function nothingStoredMessage(subject: string, filtered: boolean): string {
  return (
    `No stored SERP measurement matches this request for ${subject}, so there is nothing to ` +
    "read and you were not charged. Positions appear here once a SERP snapshot has been taken " +
    "for these keywords; track_keywords records which keywords to watch, which is a separate " +
    "step and also free." +
    (filtered
      ? " This answer is about the keyword, location, language and device you filtered on — " +
        "measurements may exist for this domain under a different one."
      : "")
  );
}

/** What the caller narrowed to, in words, so the answer is never read as the whole store. */
export function describeFilter(input: KeywordPositionsInput): string {
  const parts: string[] = [];
  if (input.keyword !== undefined) parts.push(`keyword "${input.keyword}"`);
  if (input.location_name !== undefined) parts.push(`location "${input.location_name}"`);
  if (input.language_code !== undefined) parts.push(`language "${input.language_code}"`);
  if (input.device !== undefined) parts.push(`device "${input.device}"`);
  return parts.length === 0
    ? "No filter was applied, so every keyword, location, language and device measured for this " +
        "domain is in scope."
    : `Filtered to ${parts.join(", ")} — readings measured under anything else are not in scope.`;
}

/**
 * The keyword as STORAGE holds it. The same fold `track_keywords` applies on the way in, applied
 * here on the way out: a caller typing "SEO Tools" must reach the series they registered, and a
 * read that matched case-sensitively would answer "nothing stored" about a keyword that is.
 */
export function normalizeKeywordFilter(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface KeywordPositionsDeps {
  readonly loadProject?: LoadProjectFn;
  readonly countMeasurements?: CountMeasurementsFn;
  readonly loadMeasurements?: LoadMeasurementsFn;
}

export function makeKeywordPositionsTool(deps: KeywordPositionsDeps = {}): RegisteredTool {
  const countMeasurements = deps.countMeasurements ?? countStoredMeasurements;
  const loadMeasurements = deps.loadMeasurements ?? loadStoredMeasurements;
  return defineTool<KeywordPositionsInput>({
    name: "keyword_positions",
    description: DESCRIPTION,
    inputSchema,
    charge: "handler",
    handler: async (ctx, input) => {
      // Free pre-reserve gate 1 — exactly one of target / project_id, the project read
      // tenant-scoped, and an unknown id indistinguishable from another tenant's.
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      const project: ProjectRef | null = subject.project;
      const filter: MeasurementFilter = {
        targetDomain: subject.domain,
        keyword: input.keyword === undefined ? undefined : normalizeKeywordFilter(input.keyword),
        locationName: input.location_name,
        languageCode: input.language_code,
        device: input.device as SerpDevice | undefined,
      };
      // Free pre-reserve gate 2 — the whole-set COUNT, which is both the honesty gate and the
      // number the caption prints. It is a head-only query, so the free path costs one count and
      // never reads a row.
      const storedMeasurementCount = await countMeasurements(ctx.userId, filter);
      if (storedMeasurementCount === 0) {
        return errorResult(
          nothingStoredMessage(
            subjectLabel(subject.domain, project),
            input.keyword !== undefined ||
              input.location_name !== undefined ||
              input.language_code !== undefined ||
              input.device !== undefined,
          ),
        );
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> read -> commit
      // as one chain. A read that throws releases the reserve, so a failure costs nothing.
      return withCredits({ userId: ctx.userId }, { tool: "keyword_positions" }, async () => {
        const rows = await loadMeasurements(ctx.userId, filter, input.limit);
        return textResult(
          formatKeywordPositions(subjectLabel(subject.domain, project), describeFilter(input), {
            rows,
            windowLimit: input.limit,
            windowRowCount: rows.length,
            // NEVER derived from `rows`: it is the count query's answer about the whole matching
            // set, taken before the window was read.
            storedMeasurementCount,
          }),
        );
      });
    },
  });
}

/** The production keyword_positions tool (real DB). */
export const keywordPositionsTool = makeKeywordPositionsTool();
