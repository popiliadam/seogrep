import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { forUser, getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { enqueueJob } from "../queue/boss.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * crawl_site — the first credit-spending tool, and an ASYNC one: it enqueues a crawl
 * job and returns a job_id immediately (the MCP call never leans on the crawl's wall
 * clock), then get_job_status polls it to completion.
 *
 * It is a defineTool with charge mode "worker": the handler validates, enqueues, and
 * returns an ESTIMATE — the guard does NOT wrap it, so the surface NEVER touches the
 * ledger. The one real 20-credit reserve/commit chain belongs to the WORKER, settled
 * against the real jobs.id (queue/worker.ts + credits/guard.ts). Charging at the surface
 * too would double-spend. Schema validation still runs BEFORE the enqueue (defineTool
 * parses first), so a malformed call opens no job and reaches no credit machinery.
 */

/** The enqueue port (default: the real enqueueJob) — injected so the surface is testable without pg-boss. */
export type EnqueueFn = (
  ctx: { userId: string },
  input: { tool: string; projectId?: string; payload?: Record<string, unknown> },
) => Promise<{ jobId: string }>;

export interface CrawlSiteDeps {
  readonly enqueue?: EnqueueFn;
}

/**
 * Input contract. ONLY project_id + max_urls are exposed — the crawler's test-timing
 * knobs (pageTimeoutMs / timeBudgetMs / crawlDelayCapMs on CrawlOptions) are NEVER
 * surfaced to tenants. max_urls is bounded 1..100 and defaults to 100. The five-tool
 * surface is fully snake_case; the crawler module's internal CrawlOptions.maxUrls stays
 * camelCase and is mapped in the queue handler.
 */
const inputSchema = z.object({
  project_id: z.uuid().describe("The project_id from setup_project / list_projects."),
  max_urls: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(100)
    .describe("Maximum pages to crawl (1–100, default 100)."),
});

/**
 * Build the crawl_site tool. The enqueue port defaults to the real enqueueJob; tests
 * inject a fake to assert the surface enqueues (and charges nothing) without pg-boss.
 * The MCP inputSchema (and its "max_urls is optional" advertising) comes from defineTool's
 * single toInputJsonSchema deriver — this file no longer carries its own copy.
 */
export function makeCrawlSiteTool(deps: CrawlSiteDeps = {}): RegisteredTool {
  const enqueue = deps.enqueue ?? enqueueJob;
  return defineTool({
    name: "crawl_site",
    description:
      "Crawl a project's website (async). Returns a job_id immediately; poll it with " +
      "get_job_status. Costs 20 credits, charged when the crawl runs.",
    inputSchema,
    charge: "worker",
    handler: async (ctx: AuthContext, { project_id, max_urls }): Promise<ToolResult> => {
      // Tenant-scoped project fetch (forUser -> .eq user_id) is the ownership gate:
      // fail fast with a clear error rather than enqueue a job that could never run.
      const project = await forUser(getServiceClient(), ctx.userId).selectOwnById<{
        id: string;
        domain: string;
      }>("projects", project_id, "id, domain");
      if (!project) {
        // Missing or another tenant's project — indistinguishable (tenant-scoped read).
        return errorResult(
          `No project found with id ${project_id}. Create one with setup_project first.`,
        );
      }

      const { jobId } = await enqueue(
        { userId: ctx.userId },
        { tool: "crawl_site", projectId: project_id, payload: { max_urls } },
      );

      // estimated_credits reads from the human-approved price table — never a literal.
      return textResult(
        `Crawl queued for ${project.domain}. job_id: ${jobId} · status: queued · ` +
          `estimated_credits: ${TOOL_COSTS.crawl_site}. ` +
          `Track it with get_job_status { "job_id": "${jobId}" }.`,
      );
    },
  });
}

/** The production crawl_site tool (real enqueue). */
export const crawlSiteTool = makeCrawlSiteTool();
