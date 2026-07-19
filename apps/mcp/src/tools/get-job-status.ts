import { z } from "zod";
import { getServiceClient, type Json, type JobRow } from "../db.ts";
import { getJobForUser } from "../queue/boss.ts";
import { defineTool, errorResult, textResult } from "./registry.ts";

/**
 * get_job_status — check an async job (e.g. a crawl_site run). 0 credits. Reads the
 * job TENANT-SCOPED via getJobForUser (the ONLY job read a tool surface may use): an
 * unknown id and another tenant's job are indistinguishable, so there is no
 * cross-tenant existence leak. Never wire the id-only getJob here.
 */

/**
 * Summarize a crawl_site result for the status line: pages crawled, pages skipped, and
 * total issues found. Defensive — jobs.result is stored jsonb of unknown shape (other
 * tools will land later), so anything that is not a { pages[], skipped[] } object
 * yields null and the caller reports success without a detail line.
 */
function summarizeCrawlResult(result: Json | null): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const { pages, skipped } = result;
  if (!Array.isArray(pages) || !Array.isArray(skipped)) return null;
  const issueCount = pages.reduce<number>((total, page) => {
    if (page && typeof page === "object" && !Array.isArray(page)) {
      const issues = page.issues;
      if (Array.isArray(issues)) return total + issues.length;
    }
    return total;
  }, 0);
  return `Crawled ${pages.length} page(s), skipped ${skipped.length}, ${issueCount} issue(s) found`;
}

/** Join the non-null lifecycle stamps into a compact ` · `-separated trail. */
function stampsOf(job: JobRow): string {
  return [
    `created ${job.created_at}`,
    job.started_at ? `started ${job.started_at}` : null,
    job.finished_at ? `finished ${job.finished_at}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * Render a human-readable status line for a job. Pure (no I/O) so the fast lane can
 * pin the wording of every status; the tenant-scoped read is proven in the db spec.
 */
export function formatJobStatus(job: JobRow): string {
  const head = `Job ${job.id} (${job.tool})`;
  const stamps = stampsOf(job);
  switch (job.status) {
    case "queued":
      return `${head} is queued. ${stamps}.`;
    case "running":
      return `${head} is running. ${stamps}.`;
    case "succeeded": {
      const summary = summarizeCrawlResult(job.result);
      return `${head} succeeded. ${stamps}.${summary ? ` ${summary}.` : ""}`;
    }
    case "failed":
      return `${head} failed: ${job.error ?? "unknown error"}. ${stamps}.`;
  }
}

export const getJobStatusTool = defineTool({
  name: "get_job_status",
  description:
    "Check the status and result summary of an async job (e.g. a crawl_site run), by its job_id.",
  inputSchema: z.object({
    job_id: z.uuid().describe("The job_id returned by an async tool such as crawl_site."),
  }),
  handler: async (ctx, { job_id }) => {
    const job = await getJobForUser(getServiceClient(), job_id, ctx.userId);
    if (!job) {
      // Unknown id and another tenant's job both land here (see getJobForUser) — one
      // message, no cross-tenant existence leak.
      return errorResult(`No job found with id ${job_id}.`);
    }
    return textResult(formatJobStatus(job));
  },
});
