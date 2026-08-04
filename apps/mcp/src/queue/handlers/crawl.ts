import { boundCrawlResult, crawlSite, type CrawlResult } from "../../crawler/crawl.ts";
import { forUser, getServiceClient, type Json, type JobRow } from "../../db.ts";
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
  opts: { maxUrls?: number; includePaths?: string[] },
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

export interface CrawlHandlerDeps {
  readonly crawl?: CrawlFn;
  readonly resolveOrigin?: OriginResolver;
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
  const { data, error } = await forUser(getServiceClient(), userId)
    .selectOwn("projects", "id, domain")
    .eq("id", job.project_id)
    .maybeSingle();
  if (error) {
    throw new Error(`crawl_site: project lookup failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("crawl_site: project not found for this account");
  }
  const { domain } = data as unknown as { domain: string };
  return `https://${domain}`;
}

/**
 * Build the crawl_site queue handler. Registered once by the worker; its deps default
 * to the real crawler + project-domain resolver, and tests override them (see the seam
 * note above).
 */
export function createCrawlHandler(deps: CrawlHandlerDeps = {}): ToolHandler {
  const crawl = deps.crawl ?? crawlSite;
  const resolveOrigin = deps.resolveOrigin ?? resolveProjectOrigin;

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

    // H-02: what reaches jobs.result is BOUNDED here rather than trusted from the crawl
    // function (which is an injectable dep). On the real crawler this is the identity.
    const result = boundCrawlResult(await crawl(origin, { maxUrls, includePaths }));

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

    // CrawlResult is JSON-serializable end to end (only strings / numbers / null and
    // arrays thereof). The cast bridges the named interface to the structural Json
    // type: a named interface carries no implicit index signature, so it is not
    // assignable to Json's { [key: string]: Json } shape without it (the same reason
    // the db.ts row types are declared as `type`, not `interface`).
    return result as unknown as Json;
  };
}
