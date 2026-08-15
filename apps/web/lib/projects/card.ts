import { decideProjectNextStep, summarizeCrawlResult, type NextStep } from "@pseo/core";
import { buildAuditLines, type AuditLine, type AuditRunRow } from "./audits";
import {
  buildCrawlHistory,
  type CrawlHistoryEntry,
  type JobHistoryRow,
} from "./history";
import { buildInsightLines, type DiscoveryRunRow, type InsightLine } from "./insights";
import {
  deriveProjectSignals,
  isGscConnected,
  type ConnectionRow,
  type JobRow,
  type PullRow,
} from "./signals";

/**
 * One project card's DATA — everything /app/projects renders for a project, decided here so the
 * page component holds no logic at all. PURE: no I/O, no React, no Supabase client.
 *
 * `decideProjectNextStep` and `summarizeCrawlResult` are IMPORTED FROM @pseo/core, never
 * reimplemented. That is the whole point of them living in core: the MCP `whats_next` tool and
 * this panel must name the same next step, and `get_job_status` and this panel must describe the
 * same crawl in the same words. A local copy here would be a second implementation to drift.
 */

/** What the panel says about Search Console for one project. */
export type GscStatus =
  | { readonly kind: "not_connected" }
  /** A live account link. `property` is null while no property has been matched to it yet. */
  | { readonly kind: "connected"; readonly property: string | null };

/** One project row as the page reads it out of `projects` (real column names, deliberately). */
export interface ProjectRow {
  readonly id: string;
  readonly domain: string;
  readonly created_at: string;
}

/** Everything one card is built from. */
export interface ProjectCardInput {
  readonly project: ProjectRow;
  /** Newest SUCCEEDED `crawl_site` job, or null. */
  readonly crawl: JobRow | null;
  /** Newest SUCCEEDED `pull_gsc_data` job, or null. Carries no `result` payload (see signals.ts). */
  readonly pull: PullRow | null;
  /** The project's `gsc_connections` row, or null when it has none. */
  readonly connection: ConnectionRow | null;
  /**
   * The project's recent `crawl_site` rows in EVERY state, for the card's crawl trail. Optional
   * because it is a strictly additive read: a caller that does not ask for the trail gets a card
   * with an empty one, which renders no trail section at all — the same thing a project with no
   * crawls yet gets. These rows carry no `result` (see `history.ts`).
   */
  readonly crawlHistory?: readonly JobHistoryRow[];
  /**
   * The project's recent `audit_runs` rows (migration 0024). Optional for the same reason
   * `crawlHistory` is: a strictly additive read, and a caller that does not ask for it gets a card
   * whose three audit lines all read "never run" — which is what a project with no audits has.
   * These rows carry only the report SUB-FIELDS the lines need, never the whole report
   * (see `audits.ts`).
   */
  readonly auditRuns?: readonly AuditRunRow[];
  /**
   * The project's recent `gsc_discovery_runs` rows (migration 0025). Optional for the same reason
   * `auditRuns` is: a strictly additive read, and a caller that does not ask for it gets a card
   * whose three insight lines all read "never run" — which is what a project with no analyses has.
   * These rows carry only the report SUB-FIELDS the lines need (see `insights.ts`).
   */
  readonly discoveryRuns?: readonly DiscoveryRunRow[];
}

/**
 * What the last Search Console pull COVERED, beside the date it ran.
 *
 * The date alone was the whole of it, and it is the weaker half: two pulls a day apart can cover a
 * 7-day and a 90-day window, and every number a discovery analysis prints off them means something
 * different — the engines apply ABSOLUTE thresholds. The MCP tools have said this in their footer
 * since the window line landed (`renderAnalyzedWindow`); the panel said nothing.
 */
export interface PullWindow {
  /** `2026-04-19..2026-07-17 (90 days)` — the same two facts the tools' window line prints. */
  readonly range: string;
  /**
   * True when EITHER stored window hit the pull's row cap, so the data behind every analysis of
   * this pull may be partial. An OR, matching `renderRowCapCaveat`: the previous window is the
   * baseline decay is measured against, so truncating IT inflates every loss the tools report.
   */
  readonly capped: boolean;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The pull's window line, or null when the stored sub-fields are not readable — a pull stored
 * before `pullResultToJson` carried these fields, or a corrupt result. The card then shows the
 * date alone, which is exactly what it showed before this line existed; inventing a range would be
 * worse than saying nothing, because a reader cannot check it.
 */
export function summarizePullWindow(pull: PullRow): PullWindow | null {
  const days = asFiniteNumber(pull.window_days);
  const start = asText(pull.window_start);
  const end = asText(pull.window_end);
  if (days === null || start === null || end === null) return null;
  return {
    range: `${start}..${end} (${days} ${days === 1 ? "day" : "days"})`,
    capped: pull.window_capped === true || pull.previous_capped === true,
  };
}

/** Everything one card renders. */
export interface ProjectCard {
  readonly projectId: string;
  readonly domain: string;
  readonly createdAt: string;
  /**
   * The last SUCCEEDED crawl: when it ran, and core's summary of its stored result. `summary`
   * is null when the jsonb is not shaped like a crawl result — the caller then shows the date
   * with no summary line, exactly as `get_job_status` reports success with no detail line.
   */
  readonly crawl: { readonly createdAt: string; readonly summary: string | null } | null;
  /**
   * The last few crawl RUNS, newest first, whatever they did — the trail beside the summary
   * above. Empty when the project has never been crawled, and the card then shows no trail.
   */
  readonly recentCrawls: readonly CrawlHistoryEntry[];
  /**
   * One line per audit, always all three, each carrying its newest run or null. The panel SHOWS
   * audits; it never starts one — a line with no run names the tool to ask the assistant for.
   */
  readonly audits: readonly AuditLine[];
  /**
   * One line per Search Console analysis, always all three, each carrying its newest run or null.
   * The panel SHOWS analyses; it never starts one — a line with no run names the tool to ask the
   * assistant for.
   */
  readonly insights: readonly InsightLine[];
  /** When the last SUCCEEDED `pull_gsc_data` ran, or null when none has. */
  readonly pullAt: string | null;
  /**
   * What that pull covered — the window and whether it was truncated. Null when there is no pull,
   * or when the stored sub-fields could not be read (`summarizePullWindow`). Kept beside `pullAt`
   * rather than folded into it because the date is the fact that has always been there and every
   * caller reads it; this is the detail underneath.
   */
  readonly pullWindow: PullWindow | null;
  readonly gsc: GscStatus;
  /** The ladder's answer for this project — core's, so it matches whats_next word for word. */
  readonly nextStep: NextStep;
}

/** Build one project's card. `now` is injected so freshness is deterministic in tests. */
export function buildProjectCard(input: ProjectCardInput, now: Date): ProjectCard {
  const { project, crawl, pull, connection, crawlHistory, auditRuns, discoveryRuns } = input;
  return {
    projectId: project.id,
    domain: project.domain,
    createdAt: project.created_at,
    crawl:
      crawl === null
        ? null
        : { createdAt: crawl.created_at, summary: summarizeCrawlResult(crawl.result) },
    recentCrawls: buildCrawlHistory(crawlHistory ?? []),
    audits: buildAuditLines(auditRuns ?? []),
    insights: buildInsightLines(discoveryRuns ?? []),
    pullAt: pull?.created_at ?? null,
    pullWindow: pull === null ? null : summarizePullWindow(pull),
    gsc: isGscConnected(connection)
      ? { kind: "connected", property: connection?.gsc_property ?? null }
      : { kind: "not_connected" },
    nextStep: decideProjectNextStep(deriveProjectSignals({ crawl, pull, connection }, now)),
  };
}

/** Build every card, in the order the caller already put the projects in (oldest first). */
export function buildProjectCards(
  inputs: readonly ProjectCardInput[],
  now: Date,
): ProjectCard[] {
  return inputs.map((input) => buildProjectCard(input, now));
}
