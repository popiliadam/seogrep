import { decideProjectNextStep, summarizeCrawlResult, type NextStep } from "@pseo/core";
import {
  buildCrawlHistory,
  type CrawlHistoryEntry,
  type JobHistoryRow,
} from "./history";
import {
  deriveProjectSignals,
  isGscConnected,
  type ConnectionRow,
  type JobRow,
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
  /** Newest SUCCEEDED `pull_gsc_data` job, or null. */
  readonly pull: JobRow | null;
  /** The project's `gsc_connections` row, or null when it has none. */
  readonly connection: ConnectionRow | null;
  /**
   * The project's recent `crawl_site` rows in EVERY state, for the card's crawl trail. Optional
   * because it is a strictly additive read: a caller that does not ask for the trail gets a card
   * with an empty one, which renders no trail section at all — the same thing a project with no
   * crawls yet gets. These rows carry no `result` (see `history.ts`).
   */
  readonly crawlHistory?: readonly JobHistoryRow[];
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
  /** When the last SUCCEEDED `pull_gsc_data` ran, or null when none has. */
  readonly pullAt: string | null;
  readonly gsc: GscStatus;
  /** The ladder's answer for this project — core's, so it matches whats_next word for word. */
  readonly nextStep: NextStep;
}

/** Build one project's card. `now` is injected so freshness is deterministic in tests. */
export function buildProjectCard(input: ProjectCardInput, now: Date): ProjectCard {
  const { project, crawl, pull, connection, crawlHistory } = input;
  return {
    projectId: project.id,
    domain: project.domain,
    createdAt: project.created_at,
    crawl:
      crawl === null
        ? null
        : { createdAt: crawl.created_at, summary: summarizeCrawlResult(crawl.result) },
    recentCrawls: buildCrawlHistory(crawlHistory ?? []),
    pullAt: pull?.created_at ?? null,
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
