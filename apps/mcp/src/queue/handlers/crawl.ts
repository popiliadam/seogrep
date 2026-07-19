import { crawlSite, type CrawlResult } from "../../crawler/crawl.ts";
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
export type CrawlFn = (origin: string, opts: { maxUrls?: number }) => Promise<CrawlResult>;

/** Resolve the crawl origin for a job (default: the tenant's project domain). */
export type OriginResolver = (userId: string, job: JobRow) => Promise<string>;

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
 */
async function resolveProjectOrigin(userId: string, job: JobRow): Promise<string> {
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
    const maxUrls = typeof payload.maxUrls === "number" ? payload.maxUrls : undefined;

    const result = await crawl(origin, { maxUrls });

    // A crawl that fetched NOTHING (e.g. an unreachable robots.txt — RFC 9309
    // complete disallow) delivered no value. Throw so withCredits RELEASES the
    // reserve and the job settles `failed`, rather than committing a spend for an
    // empty result; the skip reasons make the failure legible in jobs.error.
    if (result.pages.length === 0) {
      const reasons = result.skipped.map((s) => s.reason).join("; ") || "no pages reachable";
      throw new Error(`crawl_site: no pages could be crawled for ${origin} (${reasons})`);
    }

    // CrawlResult is JSON-serializable end to end (only strings / numbers / null and
    // arrays thereof). The cast bridges the named interface to the structural Json
    // type: a named interface carries no implicit index signature, so it is not
    // assignable to Json's { [key: string]: Json } shape without it (the same reason
    // the db.ts row types are declared as `type`, not `interface`).
    return result as unknown as Json;
  };
}
