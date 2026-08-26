import { getServiceClient, type Database, type Json } from "../db.ts";
import type { CannibalGroup } from "./cannibalization.ts";
import type { PageDecay } from "./content-decay.ts";
import type { QuickWin, QuickWinsResult } from "./quick-wins.ts";
import type { PullData } from "./types.ts";

/**
 * The DISCOVERY RUN LEDGER (migration 0025): one row per discovery analysis that actually ran.
 *
 * The twin of `audit/runs.ts`, for the tools that read a Search Console PULL instead of a crawl.
 * The three of them were sync and left NO TRACE — the findings existed only in the reply the
 * caller happened to be reading, the panel could not show that an analysis had ever run, and "what
 * did quick wins say last month" was unanswerable for a tool the tenant had paid for. This module
 * is the write half; `apps/web/lib/projects/insights.ts` is the read half.
 *
 * WHAT IS STORED IS THE STRUCTURAL RESULT, not the rendered text. The text is prose for a human
 * and its wording is free to change; the numbers underneath are what a second surface can query.
 * Storing the text would force the panel to parse sentences to learn how many quick wins a run
 * found — and `formatGroupedQuickWins` already re-words itself for the singular case, so those
 * sentences are not even a stable grammar to parse.
 */

/**
 * What the analysis read, carried on every report.
 *
 * The row records the ANALYSIS, and an analysis is only interpretable against the window it ran
 * over: all three engines apply ABSOLUTE thresholds (>= 20 impressions for a quick win, >= 10 for
 * a cannibalization competitor, >= 5 lost clicks for decay), so "14 quick wins" over 7 days and
 * "14 quick wins" over 90 are different measurements. This is the same fact `renderAnalyzedWindow`
 * prints for the human, kept beside the numbers for the machine.
 *
 * It is copied rather than joined to `jobs.result`: the pull the run read can be superseded by a
 * newer pull for the same project, and a run whose window has to be looked up somewhere else is a
 * run whose window can change after the fact.
 */
export interface DiscoveryWindow {
  readonly days: number;
  readonly start_date: string;
  readonly end_date: string;
  readonly previous_start_date: string;
  readonly previous_end_date: string;
  /** Rows in the CURRENT window, as parsed — what the engines actually saw. */
  readonly rows: number;
  /** True when EITHER window hit the pull's row cap, i.e. the analysis may be partial. */
  readonly capped: boolean;
}

/**
 * The fields every report carries at its TOP level, so the panel can read a run's headline without
 * downloading the run.
 *
 * `total` and `top` are duplicated out of the list below them, and that duplication is the whole
 * point: `groups`/`wins`/`decays` grow with the site, and PostgREST can navigate into jsonb but
 * cannot count an array or take its first element. A summary that lived only inside the list would
 * cost a full report download per card per render — the trap `audits.ts` documents one table over.
 */
interface DiscoverySummary {
  readonly window: DiscoveryWindow;
  /** How many findings the tool HEADLINES — the same number its first sentence prints. */
  readonly total: number;
}

/** find_quick_wins: the prioritized shortlist, its pre-cap total, and the biggest opportunity. */
export interface QuickWinsReport extends DiscoverySummary {
  /**
   * The highest-impression win, or null when there are none. Duplicated out of `wins[0]` (the
   * shortlist is sorted impressions desc, position asc) for the reason `DiscoverySummary` gives.
   */
  readonly top: { readonly query: string; readonly page: string; readonly impressions: number } | null;
  /** The shortlist as returned, at most MAX_QUICK_WINS long. `total` is the PRE-cap count. */
  readonly wins: readonly QuickWin[];
}

/** detect_cannibalization: the groups, split the way the tool's own text splits them. */
export interface CannibalizationReport extends DiscoverySummary {
  /**
   * How many groups were excluded as BRANDED. Kept as its own number because `total` counts only
   * the actionable ones: several of your pages ranking for your own brand is sitelink behaviour,
   * and a report whose total silently included them would tell the panel to show work that the
   * tool's own text tells the user not to do.
   */
  readonly branded: number;
  /** The biggest actionable (non-branded) group, or null when there is none. */
  readonly top: { readonly query: string; readonly pages: number; readonly impressions: number } | null;
  /** EVERY detected group, branded ones included — each carries its own `branded` flag. */
  readonly groups: readonly CannibalGroup[];
}

/** analyze_content_decay: the decaying pages and the worst bleed. */
export interface ContentDecayReport extends DiscoverySummary {
  /** The biggest click loss, or null when nothing decayed. */
  readonly top: { readonly page: string; readonly clicks_lost: number } | null;
  readonly decays: readonly PageDecay[];
}

/** The three engines' outputs — the only three things `gsc_discovery_runs.report` ever holds. */
export type DiscoveryReport = QuickWinsReport | CannibalizationReport | ContentDecayReport;

/** The window meta for one pull (pure). */
export function discoveryWindowOf(pull: PullData): DiscoveryWindow {
  return {
    days: pull.days,
    start_date: pull.current.start_date,
    end_date: pull.current.end_date,
    previous_start_date: pull.previous.start_date,
    previous_end_date: pull.previous.end_date,
    rows: pull.current.rows.length,
    // An OR over both windows, matching renderRowCapCaveat: the previous window is the baseline
    // every decay number is measured against, so truncating IT inflates every loss the run stored.
    capped: pull.current.capped === true || pull.previous.capped === true,
  };
}

/**
 * Build each report from the engine result the FORMATTER is about to render (pure).
 *
 * The result is passed in rather than recomputed, for `AuditRendering`'s reason: a builder that
 * re-ran the engine would store a second measurement that merely resembles the one the caller was
 * shown, and the two would diverge the first time an engine grew any state at all.
 */
export function quickWinsReport(pull: PullData, result: QuickWinsResult): QuickWinsReport {
  const best = result.wins[0];
  return {
    window: discoveryWindowOf(pull),
    total: result.total,
    top: best === undefined ? null : { query: best.query, page: best.page, impressions: best.impressions },
    wins: result.wins,
  };
}

export function cannibalizationReport(
  pull: PullData,
  groups: readonly CannibalGroup[],
): CannibalizationReport {
  // The SAME split formatCannibalization makes, so the row's headline and the sentence the caller
  // read cannot disagree: branded groups leave the list but stay in the record.
  const actionable = groups.filter((group) => !group.branded);
  const best = actionable[0];
  return {
    window: discoveryWindowOf(pull),
    total: actionable.length,
    branded: groups.length - actionable.length,
    top:
      best === undefined
        ? null
        : { query: best.query, pages: best.pages.length, impressions: best.total_impressions },
    groups,
  };
}

export function contentDecayReport(
  pull: PullData,
  decays: readonly PageDecay[],
): ContentDecayReport {
  const worst = decays[0];
  return {
    window: discoveryWindowOf(pull),
    total: decays.length,
    top: worst === undefined ? null : { page: worst.page, clicks_lost: worst.clicks_lost },
    decays,
  };
}

/** Everything one `gsc_discovery_runs` row is keyed by. Every field but `tool` is a tenant key. */
export interface DiscoveryRunTarget {
  readonly userId: string;
  readonly projectId: string;
  /** The SUCCEEDED `pull_gsc_data` job the analysis read (NOT NULL in 0025). */
  readonly pullJobId: string;
  /** One of the three discovery tools — the CHECK constraint's vocabulary. */
  readonly tool: string;
}

/** The write itself — injectable so a spec can make it fail without breaking a database. */
export type DiscoveryRunWriter = (
  target: DiscoveryRunTarget,
  report: DiscoveryReport,
) => Promise<void>;

type DiscoveryRunInsert = Database["public"]["Tables"]["gsc_discovery_runs"]["Insert"];

/**
 * The report as a `jsonb` value.
 *
 * A round trip rather than a cast, and it does real work (auditReportToJson states the same case):
 * `Json` demands the implicit index signature a TS interface never has, so no amount of typing
 * makes `QuickWinsReport` assignable to it, and a bare `as unknown as Json` would ALSO accept a
 * report carrying a Date, a function or an `undefined` — values that either change shape or vanish
 * on the wire, silently. `JSON.stringify` is exactly the transformation PostgREST is about to
 * apply anyway, so what is type-checked here is what is stored.
 */
export function discoveryReportToJson(report: DiscoveryReport): Json {
  return JSON.parse(JSON.stringify(report)) as Json;
}

/**
 * Record one discovery run.
 *
 * FAIL-CLOSED, and that is the whole contract (audit/runs.ts's rule, applied to the GSC path): a
 * PostgREST error is re-thrown, never logged and swallowed. The caller runs inside `withCredits`,
 * which COMMITS a handler that returns and RELEASES one that throws — so throwing means the tenant
 * pays nothing for an analysis whose record was lost. Swallowing would produce the opposite and
 * worse shape: a charged tenant, a returned analysis, and a panel that will forever say the tool
 * never ran.
 */
export async function writeDiscoveryRun(
  target: DiscoveryRunTarget,
  report: DiscoveryReport,
): Promise<void> {
  const row: DiscoveryRunInsert = {
    user_id: target.userId,
    project_id: target.projectId,
    pull_job_id: target.pullJobId,
    tool: target.tool,
    report: discoveryReportToJson(report),
  };
  const { error } = await getServiceClient().from("gsc_discovery_runs").insert(row);
  if (error) {
    throw new Error(`${target.tool}: gsc_discovery_runs write failed (${error.message})`);
  }
}
