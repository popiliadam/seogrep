import {
  boundCrawlResult,
  crawlSite,
  type CrawlProgress,
  type CrawlResult,
} from "../../crawler/crawl.ts";
import { getServiceClient, type Json, type JobRow } from "../../db.ts";
import { writeCrawlPages, type CrawlPagesWriter } from "./crawl-pages.ts";
import { ARCHIVED_PROJECT_MESSAGE, loadOwnProject } from "../../tools/project-target.ts";
import { getJobForUser } from "../boss.ts";
import type { ToolHandler } from "../worker.ts";

/**
 * Queue handler for the crawl_site tool — the ledger's first money-spending tool
 * surface. It runs INSIDE the worker's credit guard (executeJob wraps every handler
 * in withCredits, so the 20-credit reserve/commit belongs to the worker, not this
 * function): the handler only resolves the crawl target, runs the crawl, and returns
 * the CrawlResult, which executeJob persists to jobs.result on success. Returning
 * (not throwing) settles the job `succeeded` and COMMITS the reserve; throwing
 * settles it `failed` and RELEASES the reserve.
 *
 * Testability seam (DI): the crawl function and the origin resolver are injectable.
 * In production the origin comes from the tenant's projects.domain (https://<domain>).
 * The DB-integration specs MUST inject the origin instead, pointing it at T6's local
 * loopback fixture site: projects.domain normalization rejects IP/localhost hosts, so
 * a fixture on 127.0.0.1:<port> can never be stored as a project domain — origin
 * injection is the only way to exercise the real crawl end to end. The production
 * path (domain -> origin) is unchanged and covered by resolveProjectOrigin's own spec.
 */

/** The crawl function the handler drives (default: the real fetch-based crawlSite). */
export type CrawlFn = (
  origin: string,
  opts: {
    maxUrls?: number;
    includePaths?: string[];
    onProgress?: (progress: CrawlProgress) => void;
  },
) => Promise<CrawlResult>;

/** Resolve the crawl origin for a job (default: the tenant's project domain). */
export type OriginResolver = (userId: string, job: JobRow) => Promise<string>;

/**
 * Clamp a queue-message max_urls into the crawler's 1..100 contract. The queue payload
 * is EXTERNAL input (a message that could be malformed or tampered), so a value the
 * surface schema would have rejected can still arrive here. A finite number is floored
 * and clamped to [1, 100]; anything else (undefined, NaN, ±Infinity, a non-number)
 * yields undefined so the crawler applies its own default — never an unbounded or NaN
 * cap. crawlSite also floors/min-guards, but Infinity survives Math.max/floor there, so
 * the isFinite gate here is the real bound.
 */
export function clampMaxUrls(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.min(100, Math.max(1, Math.floor(raw)));
}

/**
 * Coerce a queue-message include_paths into the crawler's contract. Like clampMaxUrls, the
 * queue payload is EXTERNAL input, so accept ONLY an array of non-empty strings; anything else
 * (a non-array, an array of the wrong element types, or one that filters down to empty) yields
 * undefined so the crawler applies NO scope filter. Normalization of the prefixes themselves
 * (leading slash, dedupe) is the crawler's job (normalizeIncludePaths).
 */
export function clampIncludePaths(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const paths = raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return paths.length > 0 ? paths : undefined;
}

// --- Live progress (what a poll of a RUNNING crawl can read) ------------------------------

/**
 * A crawl in flight, as `jobs.result` carries it while `status = "running"`.
 *
 * WHY jobs.result AND NOT A NEW COLUMN: `get_job_status` reads the job row and nothing else, and
 * a running row's `result` is otherwise NULL for its whole life — the column is free, needs no
 * migration, and is overwritten by the real CrawlResult the moment the run completes. The key
 * below is what keeps the two apart: a summarizer looking for `{pages[], skipped[]}` finds
 * neither here, so a progress snapshot can never be mistaken for a finished crawl.
 */
export interface CrawlProgressSnapshot {
  readonly pagesCrawled: number;
  readonly urlsSkipped: number;
  /** When the counts were taken (ISO-8601) — the half that proves a poll is not frozen. */
  readonly updatedAt: string;
}

/** The one key marking a jobs.result as an IN-FLIGHT snapshot rather than a finished result. */
const PROGRESS_KEY = "crawl_progress";

/** Serialize a snapshot into the stored jsonb. Pure — snake_case, like every stored shape. */
export function crawlProgressPayload(snapshot: CrawlProgressSnapshot): Json {
  return {
    [PROGRESS_KEY]: {
      pages_crawled: snapshot.pagesCrawled,
      urls_skipped: snapshot.urlsSkipped,
      updated_at: snapshot.updatedAt,
    },
  };
}

/**
 * Read a progress snapshot back out of a stored jobs.result, or null when the value is
 * anything else (a finished CrawlResult, another tool's result, a legacy row, garbage).
 * Defensive for the same reason parseCrawlResult is: this is jsonb of unknown shape, and the
 * status line must degrade to "no detail" rather than print a half-read number.
 */
export function readCrawlProgress(result: Json | null): CrawlProgressSnapshot | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const raw = result[PROGRESS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const pages = raw.pages_crawled;
  const skipped = raw.urls_skipped;
  const updatedAt = raw.updated_at;
  if (typeof pages !== "number" || !Number.isFinite(pages)) return null;
  if (typeof skipped !== "number" || !Number.isFinite(skipped)) return null;
  if (typeof updatedAt !== "string") return null;
  return { pagesCrawled: pages, urlsSkipped: skipped, updatedAt };
}

/** The job a progress write targets. Both columns are tenant keys (constitution NEVER #4). */
export interface ProgressTarget {
  readonly jobId: string;
  readonly userId: string;
}

/** The progress write itself — injectable, so the ticker is testable without a database. */
export type ProgressWriter = (
  target: ProgressTarget,
  snapshot: CrawlProgressSnapshot,
) => Promise<void>;

/**
 * Minimum gap between two progress writes for one job. A 100-page crawl commits ~25 batches in
 * up to 90 s; this bounds the extra writes at well under one per second while still moving the
 * number faster than any human polls.
 */
export const PROGRESS_WRITE_INTERVAL_MS = 2_000;

/**
 * Store one snapshot on a job that is STILL RUNNING.
 *
 * `status = "running"` is not decoration — it is what makes a late write harmless. `completeJob`
 * writes the finished CrawlResult into this same column, so a progress write that somehow
 * arrived afterwards would overwrite a delivered, charged result with a counter. Matching on
 * the running status means such a write updates ZERO rows instead. (The ticker also awaits its
 * in-flight write before the handler returns, so the race should never open in the first place;
 * this is the belt behind that.)
 *
 * NOT covered by the fast lane: the supabase call itself is exercised only where a database is
 * (the *.db.test.ts lane). The two halves that decide what is written — the payload and the
 * ticker's throttle — are pure and pinned in the fast lane.
 */
export const writeCrawlProgress: ProgressWriter = async (target, snapshot) => {
  const { error } = await getServiceClient()
    .from("jobs")
    .update({ result: crawlProgressPayload(snapshot) })
    .eq("id", target.jobId)
    .eq("user_id", target.userId)
    .eq("status", "running");
  if (error) {
    throw new Error(`crawl_site: progress write failed (${error.message})`);
  }
};

/**
 * Turn the crawler's synchronous progress ticks into throttled, NON-FATAL progress writes.
 *
 * Three rules, each with a reason:
 *  - THROTTLED: at most one write per PROGRESS_WRITE_INTERVAL_MS, and never two in flight at
 *    once — so writes cannot overtake each other and land out of order.
 *  - NON-FATAL: a failing write is swallowed AND disables further attempts. Progress is
 *    cosmetic; failing a 20-credit crawl because a counter could not be stored would be the
 *    tail wagging the dog, and retrying against a broken database every batch helps nobody.
 *  - SETTLED: `settle()` awaits whatever is in flight, so the handler cannot return (and
 *    executeJob cannot write the real result) while a progress write is still on its way.
 */
export function makeProgressTicker(
  target: ProgressTarget,
  write: ProgressWriter,
  now: () => number = Date.now,
): { onProgress: (progress: CrawlProgress) => void; settle: () => Promise<void> } {
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let disabled = false;

  const onProgress = (progress: CrawlProgress): void => {
    if (disabled || inFlight !== null) return;
    const at = now();
    if (at - lastWriteAt < PROGRESS_WRITE_INTERVAL_MS) return;
    lastWriteAt = at;
    inFlight = write(target, {
      pagesCrawled: progress.pagesCrawled,
      urlsSkipped: progress.urlsSkipped,
      updatedAt: new Date(at).toISOString(),
    })
      .catch(() => {
        disabled = true;
      })
      .finally(() => {
        inFlight = null;
      });
  };

  return { onProgress, settle: async () => { await inFlight; } };
}

export interface CrawlHandlerDeps {
  readonly crawl?: CrawlFn;
  readonly resolveOrigin?: OriginResolver;
  /** The crawl_pages dual write (default: the real batch insert). Injected to make it fail. */
  readonly writePages?: CrawlPagesWriter;
  /** The live-progress write (default: the real jobs.result update). Injected in specs. */
  readonly writeProgress?: ProgressWriter;
  /** The clock the progress throttle reads (default: Date.now). Test knob. */
  readonly now?: () => number;
}

/**
 * Default origin resolver: read the job's project TENANT-SCOPED (id = project_id AND
 * user_id = the run's owner) and build https://<domain>. The user_id filter is the
 * tenant guard on the RLS-bypassing service client (constitution NEVER #4); a project
 * that is missing or belongs to another tenant both resolve to "not found" and abort
 * the crawl before a single request is made.
 *
 * DEFENCE IN DEPTH, NOT REDUNDANCY. Migration 0017 made `jobs.(user_id, project_id)` a
 * composite FK onto `projects.(user_id, id)`, so the database now refuses a job row parented
 * to ANOTHER tenant's project (SQLSTATE 23503) — the cross-tenant state this guard was written
 * to catch can no longer be written. The guard stays and is still tested: the application layer
 * must not depend on a constraint that a future migration, a restore, or a differently-migrated
 * environment could be missing. `project_id` is also still nullable, so the no-project branch
 * remains live (0017 nulls it via ON DELETE SET NULL when a parent project is deleted, and
 * enqueueJob writes NULL for any tool called without a project).
 *
 * Exported for its DB spec: the cross-tenant branch can no longer be reached by seeding a row,
 * so the spec drives this function with the in-memory job row that state would have produced.
 */
export async function resolveProjectOrigin(userId: string, job: JobRow): Promise<string> {
  if (!job.project_id) {
    throw new Error("crawl_site: job has no project to crawl");
  }
  // The SHARED by-id resolver, not a read of this handler's own: a per-caller project read is a
  // per-caller place for the archive check below to be forgotten — which is precisely how this
  // path was missed when the surface got its gate. It carries the same tenant filter the
  // hand-written read had (selectOwnById -> .eq("user_id", …)), so the cross-tenant guarantee
  // above is unchanged; only the wording of a lookup FAILURE moved (it now names the table
  // rather than the tool, and get_job_status prints the tool beside it anyway).
  const project = await loadOwnProject(userId, job.project_id);
  if (!project) {
    throw new Error("crawl_site: project not found for this account");
  }
  // ARCHIVED AT PICKUP. The surface refuses an archived project before it ever enqueues, so a
  // job can only reach here archived by being queued while the project was still live and picked
  // up afterwards. Refusing it now costs the tenant nothing — the job has not started — which is
  // what separates it from cancelling a RUNNING crawl (that would be data loss, and is
  // deliberately not done).
  //
  // THROW, never return: executeJob wraps this in withCredits, where returning COMMITS the
  // 20-credit reserve and throwing RELEASES it. So this is the same shape as the empty-crawl
  // refusal below — a run that delivered nothing must cost nothing. The message is the shared
  // sentence verbatim (no "crawl_site:" prefix, unlike the operator diagnostics around it):
  // get_job_status renders jobs.error to the USER as written, and this is a refusal they can act
  // on, not a fault for an operator to read.
  if (project.archivedAt !== null) {
    throw new Error(ARCHIVED_PROJECT_MESSAGE);
  }
  return `https://${project.domain}`;
}

/**
 * Build the crawl_site queue handler. Registered once by the worker; its deps default
 * to the real crawler + project-domain resolver, and tests override them (see the seam
 * note above).
 */
export function createCrawlHandler(deps: CrawlHandlerDeps = {}): ToolHandler {
  const crawl = deps.crawl ?? crawlSite;
  const resolveOrigin = deps.resolveOrigin ?? resolveProjectOrigin;
  const writePages = deps.writePages ?? writeCrawlPages;
  const writeProgress = deps.writeProgress ?? writeCrawlProgress;
  const now = deps.now ?? Date.now;

  return async ({ jobId, userId, payload }): Promise<Json> => {
    // Re-read the job tenant-scoped to bind this run to its owner's project row.
    // executeJob already matched the queue-message userId to the row; this scoped
    // read is the handler's own belt on that identity before any crawl target is
    // resolved (constitution NEVER #4).
    const job = await getJobForUser(getServiceClient(), jobId, userId);
    if (!job) {
      throw new Error(`crawl_site: job ${jobId} not found for this account`);
    }

    const origin = await resolveOrigin(userId, job);
    // The tool surface is snake_case; internal module options are camelCase — mapped
    // here. The crawl_site queue payload carries `max_urls` / `include_paths`; the crawler's
    // CrawlOptions takes `maxUrls` / `includePaths`. This is the single point that bridges the
    // two conventions, and it re-clamps because a raw queue message is external input (see
    // clampMaxUrls / clampIncludePaths).
    const maxUrls = clampMaxUrls(payload.max_urls);
    const includePaths = clampIncludePaths(payload.include_paths);

    // LIVE PROGRESS. The crawl takes up to 90 s, and until now every poll of a running job read
    // the same byte-identical line — a customer could not tell "working" from "stuck". The
    // ticker turns the crawler's per-batch counts into a throttled jobs.result snapshot that
    // get_job_status renders. `settle()` runs on BOTH paths (return and throw), so no progress
    // write is ever still in flight when executeJob writes the real result.
    const progress = makeProgressTicker({ jobId, userId }, writeProgress, now);
    let result: CrawlResult;
    try {
      // H-02: what reaches jobs.result is BOUNDED here rather than trusted from the crawl
      // function (which is an injectable dep). On the real crawler this is the identity.
      result = boundCrawlResult(
        await crawl(origin, { maxUrls, includePaths, onProgress: progress.onProgress }),
      );
    } finally {
      await progress.settle();
    }

    // A crawl that fetched NOTHING (e.g. an unreachable robots.txt — RFC 9309
    // complete disallow) delivered no value. Throw so withCredits RELEASES the
    // reserve and the job settles `failed`, rather than committing a spend for an
    // empty result; the skip reasons make the failure legible in jobs.error.
    if (result.pages.length === 0) {
      // The first few reasons only, hard-capped: jobs.error is a DB column and a message a
      // human reads, not a dump of every skip a link-flooded crawl produced. The paths that
      // matter here (unreachable robots, blocked origin) carry ONE actionable reason.
      const reasons =
        result.skipped.slice(0, 5).map((s) => s.reason).join("; ") || "no pages reachable";
      throw new Error(
        `crawl_site: no pages could be crawled for ${origin} (${reasons.slice(0, 1_000)})`,
      );
    }

    // THE DUAL WRITE (migration 0023). The SAME result, also written one row per page into
    // crawl_pages. `jobs.result` is untouched — same value, same shape, same consumers; this
    // is an addition beside it, and nothing reads the rows yet (crawl-pages.ts explains why).
    //
    // WHY IT RUNS HERE AND NOT AFTER completeJob. The rows have to land where a failure can
    // still be refused: executeJob writes jobs.result only after the handler returns, and by
    // then the credit charge has COMMITTED — a throw at that point could no longer fail the
    // job without marking a charged, delivered run as failed. Inside the handler, the guard's
    // rules still apply: returning commits the reserve, throwing releases it. So a lost dual
    // write settles the job `failed` and costs the tenant nothing, which is the only honest
    // outcome for a run whose output was half-recorded. The cost of that ordering is that a
    // crawl which fails HERE leaves no jobs.result either — acceptable, because the run is
    // refunded and re-runnable, and the reverse (silently missing rows under a `succeeded`
    // job) is exactly the quiet degradation this house refuses.
    //
    // project_id is NOT NULL in 0023, so a job with no project cannot be attributed. The
    // production resolver already refuses such a job before any crawl happens (see
    // resolveProjectOrigin), so this branch is reachable only through an injected resolver —
    // and it fails closed rather than dropping the rows on the floor.
    if (!job.project_id) {
      throw new Error(`crawl_site: job ${jobId} has no project to attribute crawled pages to`);
    }
    await writePages({ jobId, userId, projectId: job.project_id }, result);

    // CrawlResult is JSON-serializable end to end (only strings / numbers / null and
    // arrays thereof). The cast bridges the named interface to the structural Json
    // type: a named interface carries no implicit index signature, so it is not
    // assignable to Json's { [key: string]: Json } shape without it (the same reason
    // the db.ts row types are declared as `type`, not `interface`).
    return result as unknown as Json;
  };
}
