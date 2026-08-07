import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  COMPETITORS_DISCOVERY_MAX_LIMIT,
  MAX_COMPETITORS,
  resolveDefaultCompetitorsPort,
  type ComparedDomainSource,
  type ComparisonRow,
  type CompetitorComparison,
  type CompetitorsPort,
  type DomainOrganicMetrics,
} from "../dfs/competitors.ts";
import { normalizeDomain } from "./setup-project.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * compare_competitors — a domain side by side with its rivals on Google organic search, from the
 * DataForSEO Labs competitors_domain + domain_rank_overview endpoints. Synchronous: it returns the
 * table immediately (no background job). It needs no project: any public domain can be compared.
 *
 * It is built to the analyze_backlinks pattern, and the same two hard product rules shape its
 * credit path:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear English
 *      error and NEVER serves sample/placeholder figures as if they were real (NEVER #7). The mock
 *      fixtures exist only for tests.
 *   2. That live-disabled error — and every invalid-input rejection — is returned BEFORE any credit
 *      reserve, so the ledger is touched ZERO times (NEVER #2).
 *
 * charge:"handler" for the same reason analyze_backlinks uses it: this is a SYNCHRONOUS tool that
 * must run logic BEFORE the reserve, which charge:"surface" (reserve-then-handler) cannot express.
 * On the serving path it settles via withCredits WITHOUT a jobId — the exact SURFACE ledger shape
 * (reserve -> commit, a traceability uuid, no jobs row).
 *
 * One comparison is up to five paid DataForSEO requests (see dfs/competitors.ts), and fewer when
 * the caller names the competitors. The port throws unless ALL of them succeed, so a partial table
 * is never billed: withCredits releases the reserve and the caller's balance ends where it started,
 * whichever request failed.
 */

/** United States — the DataForSEO default location_code (same default as ranked_keywords). */
const DEFAULT_LOCATION_CODE = 2840;

const NOT_ENABLED_MESSAGE =
  "Competitor comparisons are not yet enabled on this deployment. Live DataForSEO data is turned " +
  "off, and SeoGrep never returns sample or placeholder figures as if they were real. This tool " +
  "will start returning data once live DataForSEO access is switched on — you were not charged.";

const inputSchema = z.object({
  target: z
    .string()
    .min(1)
    .describe("The domain to compare, e.g. \"example.com\" or \"https://example.com\"."),
  competitors: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_COMPETITORS)
    .optional()
    .describe(
      `Up to ${MAX_COMPETITORS} competitor domains to compare the target against. Omit this to ` +
        "let DataForSEO pick the competitors for you.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(COMPETITORS_DISCOVERY_MAX_LIMIT)
    .default(COMPETITORS_DISCOVERY_MAX_LIMIT)
    .describe(
      `How many rows the competitor-discovery request may return ` +
        `(1–${COMPETITORS_DISCOVERY_MAX_LIMIT}, default ${COMPETITORS_DISCOVERY_MAX_LIMIT}). ` +
        "Unused when you pass \"competitors\": that skips the discovery request entirely.",
    ),
  language_code: z.string().min(2).default("en").describe("Language code (default 'en')."),
  location_code: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_LOCATION_CODE)
    .describe("DataForSEO location code (default 2840 = United States)."),
});

type CompareCompetitorsInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Compare a domain with its competitors on Google organic search — organic SERP counts, " +
  "position bands, estimated monthly organic traffic, and the paid-equivalent traffic cost, side " +
  `by side. Name up to ${MAX_COMPETITORS} competitors or let DataForSEO pick them. Works on any ` +
  "public domain. Synchronous — returns a table immediately. Costs " +
  `${TOOL_COSTS.compare_competitors} credits. Needs a paid credit balance: it is not available ` +
  "on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says " +
  "so and charges nothing.";

/**
 * Group digits with commas without depending on ICU/locale data (deterministic). Kept local on
 * purpose: sharing it would mean editing ranked_keywords / analyze_backlinks, whose behaviour is
 * pinned.
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

/** A USD metric value. */
function money(value: number | null): string {
  return value === null ? "n/a" : `$${thousands(value)}`;
}

/** An average SERP position — one decimal, because DataForSEO reports it as a float. */
function averagePosition(value: number): string {
  return value.toFixed(1);
}

/** How each row of the table got there — printed on every row, so the source is never implied. */
const SOURCE_LABEL: Record<ComparedDomainSource, string> = {
  target: "target",
  discovered: "found by DataForSEO",
  supplied: "supplied by you",
};

/**
 * The overlap clause for a rival, or "" when there is none (the target, and every caller-supplied
 * rival, have no discovery figures).
 *
 * Both numbers keep DataForSEO's documented scope. `intersections` is "number of intersecting
 * keywords" — hence the literal wording — and `avg_position` is "average position of the domain in
 * SERP" computed over THOSE intersected keywords only, never over the rival's whole keyword set,
 * so the clause says "on them" rather than presenting it as the rival's overall position.
 */
function renderOverlap(row: ComparisonRow): string {
  const { intersections, avg_position: avgPosition } = row;
  if (intersections !== null && avgPosition !== null) {
    return ` — ${thousands(intersections)} intersecting keywords, average position ${averagePosition(avgPosition)} on them`;
  }
  if (intersections !== null) return ` — ${thousands(intersections)} intersecting keywords`;
  if (avgPosition !== null) {
    return ` — average position ${averagePosition(avgPosition)} on the intersecting keywords`;
  }
  return "";
}

/**
 * One domain's metric lines. Every label restates DataForSEO's own definition and nothing
 * stronger: `count` is the "total count of organic SERPs that contain the domain" (SERPs, not
 * keywords); each `pos_*` band is the "number of organic SERPs where the domain ranks #N"; `etv`
 * is "estimated organic monthly traffic ... calculated as the product of CTR and search volume
 * values" (an estimate, so it is labelled as one); `estimated_paid_traffic_cost` is the "estimated
 * cost of converting organic search traffic into paid ... estimated monthly cost USD".
 *
 * The band line is labelled "(top 20)" because it is NOT a partition of `count`: DataForSEO bands
 * positions all the way to #91-100, and only the first four bands are rendered, so the four
 * numbers do not add up to the total above them.
 */
function renderMetrics(metrics: DomainOrganicMetrics): string {
  if (Object.values(metrics).every((value) => value === null)) {
    return "  - No organic ranking data on record.";
  }
  return [
    `  - Organic SERPs containing the domain: ${metric(metrics.count)}`,
    `  - Organic SERPs by position (top 20) — #1: ${metric(metrics.pos_1)}` +
      ` · #2-3: ${metric(metrics.pos_2_3)}` +
      ` · #4-10: ${metric(metrics.pos_4_10)} · #11-20: ${metric(metrics.pos_11_20)}`,
    `  - Estimated monthly organic traffic (ETV): ${metric(metrics.etv)}`,
    `  - Estimated monthly cost of the same traffic as paid ads: ${money(metrics.estimated_paid_traffic_cost)}`,
  ].join("\n");
}

/**
 * The heading — the one line that states WHERE the compared rivals came from, so a discovered set
 * is never mistaken for the caller's own and vice versa.
 */
function renderHeading(
  comparison: CompetitorComparison,
  input: { language_code: string; location_code: number },
): string {
  const where = `(language ${input.language_code}, location ${input.location_code})`;
  const lead = `Competitor comparison for "${comparison.target}" ${where} — `;
  const rivals = comparison.rows.length - 1;
  const plural = rivals === 1 ? "" : "s";
  if (!comparison.discovered) {
    return `${lead}the target against ${rivals} competitor${plural} you supplied:`;
  }
  if (rivals === 0) {
    return `${lead}DataForSEO has no competitors on record for this domain, so only the target's own numbers are shown:`;
  }
  const ranking = ", ranked by how many organic SERPs each one shares with the target:";
  const total = comparison.discovered_total_count;
  if (total !== null && total > rivals) {
    return `${lead}the target against the top ${rivals} of ${thousands(total)} competitors DataForSEO found${ranking}`;
  }
  return `${lead}the target against the ${rivals} competitor${plural} DataForSEO found${ranking}`;
}

/** Render the comparison as the plain-text tool output (pure — unit-tested directly). */
export function formatCompetitorComparison(
  comparison: CompetitorComparison,
  input: { language_code: string; location_code: number },
): string {
  const blocks = comparison.rows.map(
    (row) =>
      `• ${row.domain} (${SOURCE_LABEL[row.source]})${renderOverlap(row)}\n${renderMetrics(row.metrics)}`,
  );
  return [renderHeading(comparison, input), ...blocks].join("\n\n");
}

/** A normalized competitor list, or the first rejection reason. */
export type NormalizedCompetitors =
  | { readonly ok: true; readonly competitors: readonly string[] }
  | { readonly ok: false; readonly error: string };

/**
 * Canonicalize the caller's competitor list with the same normalizer every domain-taking tool
 * uses. The first invalid domain rejects the whole call (free, pre-reserve). The target itself and
 * repeats are dropped — a domain is not its own rival, and naming one twice does not buy two
 * comparisons — and a list left with nothing to compare against is rejected rather than silently
 * turned into a one-row table the caller would still pay for.
 */
export function normalizeCompetitors(
  target: string,
  raw: readonly string[],
): NormalizedCompetitors {
  let competitors: readonly string[] = [];
  for (const entry of raw) {
    const normalized = normalizeDomain(entry);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    if (normalized.domain === target || competitors.includes(normalized.domain)) continue;
    competitors = [...competitors, normalized.domain];
  }
  if (competitors.length === 0) {
    return {
      ok: false,
      error:
        'The "competitors" list contains no domain to compare against — it must name at least ' +
        "one domain other than the target. Omit it to let DataForSEO pick competitors for you.",
    };
  }
  return { ok: true, competitors };
}

/** Dependencies — the competitors port is injectable so tests run offline (mock/disabled). */
export interface CompareCompetitorsDeps {
  /**
   * The competitors port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: CompetitorsPort;
}

export function makeCompareCompetitorsTool(deps: CompareCompetitorsDeps = {}): RegisteredTool {
  return defineTool<CompareCompetitorsInput>({
    name: "compare_competitors",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — a domain we could never look up is rejected outright.
      const normalized = normalizeDomain(input.target);
      if (!normalized.ok) {
        return errorResult(normalized.error);
      }
      // Free pre-reserve gate 2 — same treatment for every competitor the caller named.
      const rivals = input.competitors
        ? normalizeCompetitors(normalized.domain, input.competitors)
        : ({ ok: true, competitors: [] } as const);
      if (!rivals.ok) {
        return errorResult(rivals.error);
      }
      const port = deps.port ?? resolveDefaultCompetitorsPort();
      // Free pre-reserve gate 3 — refuse rather than reserve credits or serve mock data.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch ->
      // commit as one chain. Any DataForSEO request failing throws, so withCredits releases and
      // a partial comparison is never billed.
      return withCredits({ userId: ctx.userId }, { tool: "compare_competitors" }, async () => {
        const comparison = await port.fetchCompetitorComparison({
          target: normalized.domain,
          competitors: rivals.competitors,
          limit: input.limit,
          language_code: input.language_code,
          location_code: input.location_code,
        });
        return textResult(formatCompetitorComparison(comparison, input));
      });
    },
  });
}

/** The production compare_competitors tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const compareCompetitorsTool = makeCompareCompetitorsTool();
