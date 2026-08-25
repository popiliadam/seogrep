import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  COMPETITORS_DISCOVERY_MAX_LIMIT,
  DEFAULT_COMPETITORS_DISCOVERY_LIMIT,
  MAX_COMPETITORS,
  resolveDefaultCompetitorsPort,
  WHOLE_DOMAIN_MEASUREMENT_NOTE,
  WHOLE_DOMAIN_SOURCE_LABEL,
  type ComparedDomainSource,
  type ComparisonRow,
  type CompetitorComparison,
  type CompetitorsPort,
  type DomainOrganicMetrics,
  type PositionBandKey,
} from "../dfs/competitors.ts";
import {
  competitorsRunReport,
  writeDomainLookupRun,
  type DomainLookupRunWriter,
} from "../dfs/runs.ts";
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
 * compare_competitors — a domain side by side with its rivals on Google organic search, from the
 * DataForSEO Labs competitors_domain + domain_rank_overview endpoints. Synchronous: it returns the
 * table immediately (no background job). It takes EITHER a bare `target` (any public domain) OR a
 * `project_id`, whose stored domain becomes the target. The competitors are always bare domains —
 * a rival is by definition not one of your projects.
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
 * One comparison is ONE paid DataForSEO request on the discovery path (see dfs/competitors.ts —
 * the discovery response already carries every compared domain's whole-domain metrics), and up to
 * MAX_COMPARED_DOMAINS when the caller names the competitors, because a named rival is not a
 * discovery result and needs its own rank overview. The port throws unless ALL of them succeed, so
 * a partial table is never billed: withCredits releases the reserve and the caller's balance ends
 * where it started, whichever request failed.
 */

/** United States — the DataForSEO default location_code (same default as ranked_keywords). */
const DEFAULT_LOCATION_CODE = 2840;

const NOT_ENABLED_MESSAGE =
  "Competitor comparisons are not yet enabled on this deployment. Live DataForSEO data is turned " +
  "off, and SeoGrep never returns sample or placeholder figures as if they were real. This tool " +
  "will start returning data once live DataForSEO access is switched on — you were not charged.";

const inputSchema = z.object({
  target: targetField("compare"),
  project_id: projectIdField,
  competitors: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_COMPETITORS)
    .optional()
    .describe(
      `Up to ${MAX_COMPETITORS} competitor domains to compare the target against — naming them ` +
        "gives the most useful comparison. Omit this to let DataForSEO pick, which works well " +
        "for domains with a broad keyword footprint but on a small or niche site can return " +
        "general-purpose giants (youtube.com, wikipedia.org) that share a SERP without being " +
        "real rivals.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(COMPETITORS_DISCOVERY_MAX_LIMIT)
    .default(DEFAULT_COMPETITORS_DISCOVERY_LIMIT)
    .describe(
      `How many rows the competitor-discovery request may return ` +
        `(1–${COMPETITORS_DISCOVERY_MAX_LIMIT}, default ${DEFAULT_COMPETITORS_DISCOVERY_LIMIT}). ` +
        `Only the top ${MAX_COMPETITORS} rivals are compared, so raising this widens the pool the ` +
        "ranking is drawn from without adding rows to the table. Unused when you pass " +
        '"competitors": that skips the discovery request entirely.',
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
  "Compare a domain with its competitors on Google organic search — organic SERP counts, all " +
  "twelve position bands (#1 to #100), estimated monthly organic traffic, the paid-equivalent " +
  "traffic cost, and whether each domain is gaining or losing rankings, side " +
  `by side. NAME the competitors you care about (up to ${MAX_COMPETITORS}) for a useful ` +
  "comparison; automatic discovery only works well for domains with a broad keyword footprint. " +
  "Pass a target domain (any public domain) or a project_id to compare one of your own sites. " +
  "Synchronous — returns a table immediately. Costs " +
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
 * The twelve bands DataForSEO reports, with the label each one is printed under. They are split
 * across two lines only so neither line runs past readable width; together they cover positions
 * #1-#100, which is the complete range the vendor bands.
 */
const TOP_20_BANDS: readonly (readonly [PositionBandKey, string])[] = [
  ["pos_1", "#1"],
  ["pos_2_3", "#2-3"],
  ["pos_4_10", "#4-10"],
  ["pos_11_20", "#11-20"],
];
const DEEPER_BANDS: readonly (readonly [PositionBandKey, string])[] = [
  ["pos_21_30", "#21-30"],
  ["pos_31_40", "#31-40"],
  ["pos_41_50", "#41-50"],
  ["pos_51_60", "#51-60"],
  ["pos_61_70", "#61-70"],
  ["pos_71_80", "#71-80"],
  ["pos_81_90", "#81-90"],
  ["pos_91_100", "#91-100"],
];

/** "#1: 11 · #2-3: 28 · …" for one group of bands. */
function renderBands(
  metrics: DomainOrganicMetrics,
  bands: readonly (readonly [PositionBandKey, string])[],
): string {
  return bands.map(([key, label]) => `${label}: ${metric(metrics[key])}`).join(" · ");
}

/** True when DataForSEO returned nothing at all for this scope. */
function isEmpty(metrics: DomainOrganicMetrics): boolean {
  return Object.values(metrics).every((value) => value === null);
}

/**
 * One scope's metric lines. Every label restates DataForSEO's own definition and nothing
 * stronger: `count` is the "total count of organic SERPs that contain the domain" (SERPs, not
 * keywords); each `pos_*` band is the "number of organic SERPs where the domain ranks #N"; `etv`
 * is "estimated organic monthly traffic ... calculated as the product of CTR and search volume
 * values" (an estimate, so it is labelled as one); `estimated_paid_traffic_cost` is the "estimated
 * cost of converting organic search traffic into paid ... estimated monthly cost USD"; and the
 * movement line quotes `is_new` / `is_up` / `is_down` / `is_lost` — "how many new ranked elements
 * were found", "went up", "went down", and "were previously presented in SERPs, but weren't found
 * during the last check". Nothing here says WHICH scope the numbers belong to; the caller prints
 * that heading, because the whole-domain and shared-keyword figures are different numbers and an
 * unlabelled block would let one pass for the other.
 */
function renderMetricLines(metrics: DomainOrganicMetrics): readonly string[] {
  return [
    `  - Organic SERPs containing the domain: ${metric(metrics.count)}`,
    `  - Organic SERPs by position, #1-20 — ${renderBands(metrics, TOP_20_BANDS)}`,
    `  - Organic SERPs by position, #21-100 — ${renderBands(metrics, DEEPER_BANDS)}`,
    `  - Estimated monthly organic traffic (ETV): ${metric(metrics.etv)}`,
    `  - Estimated monthly cost of the same traffic as paid ads: ${money(metrics.estimated_paid_traffic_cost)}`,
    `  - Since DataForSEO's previous check — newly ranking: ${metric(metrics.is_new)}` +
      ` · moved up: ${metric(metrics.is_up)} · moved down: ${metric(metrics.is_down)}` +
      ` · no longer found: ${metric(metrics.is_lost)}`,
  ];
}

/**
 * The whole-domain heading, naming the DataForSEO measurement behind the numbers.
 *
 * The clause is SHORT and it is the whole fix: this tool's whole-domain figures come from
 * competitors_domain on the discovery flow and from domain_rank_overview on the supplied-rivals
 * flow, ranked_keywords' come from a third endpoint, and all three used to print the identical
 * "Across the whole domain — every keyword it ranks for:". Two honest measurements under one name
 * read as one measurement contradicting itself. A row whose source is unknown keeps the old
 * heading rather than guessing (see ComparisonRow.metrics_source).
 */
function wholeDomainHeading(row: ComparisonRow): string {
  const base = "  Across the whole domain — every keyword it ranks for";
  if (row.metrics_source === undefined) return `${base}:`;
  return `${base}, from ${WHOLE_DOMAIN_SOURCE_LABEL[row.metrics_source]}:`;
}

/**
 * A row's metric body: the whole-domain scope every row is compared on, plus — for a rival
 * DataForSEO discovered — the SAME rival restricted to the keywords it shares with the target.
 *
 * The two scope headings are not decoration. DataForSEO documents `full_domain_metrics` as
 * covering "all keywords that the provided domain is ranking for" and `metrics` as covering only
 * "the keywords that the provided domain shares with the target domain", and the two differ by
 * an order of magnitude on a large rival. Printing either one unlabelled would state a number the
 * reader would reasonably take for the other.
 *
 * The shared-keyword heading names no source of ITS own: that scope exists only on the discovery
 * flow and only on a discovered rival, whose whole-domain heading one line above already names
 * the same competitors_domain response both scopes were read from.
 */
function renderMetrics(row: ComparisonRow): string {
  const whole = isEmpty(row.metrics)
    ? ["  - No organic ranking data on record."]
    : [wholeDomainHeading(row), ...renderMetricLines(row.metrics)];
  if (!row.shared || isEmpty(row.shared)) {
    return whole.join("\n");
  }
  return [
    ...whole,
    "  Across the keywords it shares with the target only:",
    ...renderMetricLines(row.shared),
  ].join("\n");
}

/**
 * The heading — the one line that states WHERE the compared rivals came from, so a discovered set
 * is never mistaken for the caller's own and vice versa.
 */
function renderHeading(
  comparison: CompetitorComparison,
  input: CompetitorComparisonRenderInput,
): string {
  const where = `(language ${input.language_code}, location ${input.location_code})`;
  const lead = `Competitor comparison for ${subjectLabel(comparison.target, input.project)} ${where} — `;
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

/**
 * How the output names what was compared. `project` is present only when the caller passed a
 * project_id, so a bare-target call renders exactly as it always did.
 */
export interface CompetitorComparisonRenderInput {
  readonly language_code: string;
  readonly location_code: number;
  readonly project?: ProjectRef | null;
}

/**
 * Render the comparison as the plain-text tool output (pure — unit-tested directly).
 *
 * The measurement note is appended ONCE, and only when a sourced whole-domain block was actually
 * printed: a table of "No organic ranking data on record" has no total for the note to be about,
 * and a footnote explaining a number nobody was shown is just length.
 */
export function formatCompetitorComparison(
  comparison: CompetitorComparison,
  input: CompetitorComparisonRenderInput,
): string {
  const blocks = comparison.rows.map(
    (row) => `• ${row.domain} (${SOURCE_LABEL[row.source]})${renderOverlap(row)}\n${renderMetrics(row)}`,
  );
  const sourced = comparison.rows.some(
    (row) => row.metrics_source !== undefined && !isEmpty(row.metrics),
  );
  const note = sourced ? [WHOLE_DOMAIN_MEASUREMENT_NOTE] : [];
  return [renderHeading(comparison, input), ...blocks, ...note].join("\n\n");
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
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /**
   * The run recorder (default: the real `writeDomainLookupRun`). A PORT for the reason every
   * other writer in this family is one: a spec can make it FAIL without breaking a database, which
   * is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeRun?: DomainLookupRunWriter;
}

export function makeCompareCompetitorsTool(deps: CompareCompetitorsDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeDomainLookupRun;
  return defineTool<CompareCompetitorsInput>({
    name: "compare_competitors",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — resolve WHAT to compare: exactly one of project_id / target,
      // the project read tenant-scoped, the domain canonicalized by the shared normalizer. Every
      // rejection it returns costs nothing (see project-target.ts).
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      // Free pre-reserve gate 2 — same treatment for every competitor the caller named. They are
      // matched against the RESOLVED target, so naming your own project's domain as its own rival
      // is dropped exactly as it is on the bare-target path.
      const rivals = input.competitors
        ? normalizeCompetitors(subject.domain, input.competitors)
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
          target: subject.domain,
          competitors: rivals.competitors,
          limit: input.limit,
          language_code: input.language_code,
          location_code: input.location_code,
        });
        // THE RUN IS RECORDED BEFORE THE REPLY IS RETURNED, and the write is NOT guarded
        // (migration 0027; dfs/runs.ts states the same contract from the other side). withCredits
        // commits a handler that RETURNS and releases one that THROWS, so an error escaping here
        // costs the tenant nothing. Caught and logged instead, the shape would be the house's
        // worst at 90 credits a call: a charged caller, a delivered table, and a panel that says
        // forever that the comparison never ran.
        //
        // `projectId` is null on a bare-target call — the commonest PAID call this tool serves,
        // and the one 0027 made project_id nullable to record. `target` is the RESOLVED domain,
        // never the caller's raw input.
        await writeRun(
          {
            userId: ctx.userId,
            projectId: subject.project?.id ?? null,
            tool: "compare_competitors",
            target: subject.domain,
          },
          competitorsRunReport(comparison, {
            limit: input.limit,
            language_code: input.language_code,
            location_code: input.location_code,
          }),
        );
        return textResult(
          formatCompetitorComparison(comparison, {
            language_code: input.language_code,
            location_code: input.location_code,
            project: subject.project,
          }),
        );
      });
    },
  });
}

/** The production compare_competitors tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const compareCompetitorsTool = makeCompareCompetitorsTool();
