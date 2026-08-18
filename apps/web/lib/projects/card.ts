import { decideProjectNextStep, summarizeCrawlResult, type NextStep } from "@pseo/core";
import { buildAuditLines, type AuditLine, type AuditRunRow } from "./audits";
import {
  buildCrawlHistory,
  type CrawlHistoryEntry,
  type JobHistoryRow,
} from "./history";
import { buildInsightLines, type DiscoveryRunRow, type InsightLine } from "./insights";
import {
  buildDomainLookupLines,
  type DomainLookupLine,
  type DomainLookupRunRow,
} from "./lookups";
import {
  deriveProjectSignals,
  isGscConnected,
  type ConnectionRow,
  type GscTokenStatus,
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
   * The stored health of the Google account behind that connection — `null` when there is no
   * account to have one, ABSENT when the caller does not measure it (see `signals.ts`). Optional
   * for the same reason `crawlHistory` is: a strictly additive read. A caller that omits it gets a
   * card whose Search Console line carries no expiry marker and whose next step is decided by the
   * pre-reconnect ladder — which is what every caller got before the health read existed.
   */
  readonly tokenStatus?: GscTokenStatus | null;
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
  /**
   * The project's recent `domain_lookup_runs` rows (migration 0027). Optional for the same reason
   * `discoveryRuns` is: a strictly additive read, and a caller that does not ask for it gets a card
   * whose three lookup lines all read "not run for this domain" — which is what a project with no
   * lookups has. These rows carry only the report SUB-FIELDS the lines need (see `lookups.ts`).
   *
   * ONLY ROWS WHOSE `project_id` IS THIS PROJECT belong here. 0027's `project_id` is nullable and
   * most rows will have it null (a bare-target lookup of somebody else's domain has no project at
   * all), and those rows are about a DIFFERENT domain — putting one on this card would attribute
   * a competitor's numbers to the tenant's own site. The page's query filters on `project_id`;
   * this comment is the contract a second caller has to honour.
   */
  readonly lookupRuns?: readonly DomainLookupRunRow[];
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
  /**
   * One line per DFS domain lookup, always all three, each carrying its newest run FOR THIS
   * PROJECT or null. The panel SHOWS lookups; it never starts one — a line with no run names the
   * tool to ask the assistant for, and says "for this domain" because a run against a competitor
   * never lands here (see `lookups.ts`).
   */
  readonly lookups: readonly DomainLookupLine[];
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
  /**
   * True only when this project HAS a live account link whose stored `token_status` is `invalid` —
   * the connection exists and the credential behind it is dead, so every Search Console pull will
   * fail until the user re-approves.
   *
   * BESIDE `gsc`, not folded into it, for the reason `pullWindow` sits beside `pullAt`: the three
   * `GscStatus` states are the fact every caller already reads, and widening the `connected`
   * variant would make every existing reader of it re-derive a shape it did not ask for. It is
   * also a different KIND of fact — `gsc` says what the mapping is, this says whether it works.
   *
   * False for an unconnected project, whatever health was read: a project with no account link
   * cannot have an expired one, and saying so would put a reconnect warning on a card whose
   * Search Console line reads "Not connected".
   */
  readonly gscExpired: boolean;
  /** The ladder's answer for this project — core's, so it matches whats_next word for word. */
  readonly nextStep: NextStep;
}

/** Build one project's card. `now` is injected so freshness is deterministic in tests. */
export function buildProjectCard(input: ProjectCardInput, now: Date): ProjectCard {
  const {
    project,
    crawl,
    pull,
    connection,
    tokenStatus,
    crawlHistory,
    auditRuns,
    discoveryRuns,
    lookupRuns,
  } = input;
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
    lookups: buildDomainLookupLines(lookupRuns ?? []),
    pullAt: pull?.created_at ?? null,
    pullWindow: pull === null ? null : summarizePullWindow(pull),
    gsc: isGscConnected(connection)
      ? { kind: "connected", property: connection?.gsc_property ?? null }
      : { kind: "not_connected" },
    gscExpired: isGscConnected(connection) && tokenStatus === "invalid",
    nextStep: decideProjectNextStep(
      deriveProjectSignals({ crawl, pull, connection, tokenStatus }, now),
    ),
  };
}

/** Build every card, in the order the caller already put the projects in (oldest first). */
export function buildProjectCards(
  inputs: readonly ProjectCardInput[],
  now: Date,
): ProjectCard[] {
  return inputs.map((input) => buildProjectCard(input, now));
}
