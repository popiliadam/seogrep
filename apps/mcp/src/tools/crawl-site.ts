import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { forUser, getServiceClient } from "../db.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { enqueueJob } from "../queue/boss.ts";
import { errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * crawl_site — the first credit-spending tool, and an ASYNC one: it enqueues a crawl
 * job and returns a job_id immediately (the MCP call never leans on the crawl's wall
 * clock), then get_job_status polls it to completion.
 *
 * Why this tool is hand-built instead of using defineTool: defineTool wraps its handler
 * in withCredits keyed by the tool NAME, so a crawl_site built that way would reserve
 * AND commit its 20 credits AT THE SURFACE (enqueue time) — and then the worker would
 * reserve+commit 20 AGAIN when the crawl actually runs (executeJob wraps every handler
 * in withCredits too). That is a double charge. The one real 20-credit reserve/commit
 * chain belongs to the WORKER, settled against the real jobs.id (queue/worker.ts +
 * credits/guard.ts). So this surface NEVER touches the ledger: it validates, enqueues,
 * and returns an ESTIMATE. Schema validation still runs BEFORE the enqueue, so a
 * malformed call opens no job and reaches no credit machinery.
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
 * Input contract. ONLY project_id + maxUrls are exposed — the crawler's test-timing
 * knobs (pageTimeoutMs / timeBudgetMs / crawlDelayCapMs on CrawlOptions) are NEVER
 * surfaced to tenants. maxUrls is bounded 1..100 and defaults to 100.
 */
const inputSchema = z.object({
  project_id: z.uuid().describe("The project_id from setup_project / list_projects."),
  maxUrls: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(100)
    .describe("Maximum pages to crawl (1–100, default 100)."),
});

/**
 * Derive the MCP inputSchema (a bare JSON Schema object) from the zod schema, dropping
 * the JSON Schema dialect marker. `io: "input"` so a defaulted field (maxUrls) is
 * advertised OPTIONAL rather than required. Mirrors registry.ts's private helper —
 * crawl_site cannot use defineTool (see the file header), so it derives its own schema.
 */
function toInputJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(json).filter(([key]) => key !== "$schema"));
}

/**
 * Build the crawl_site tool. The enqueue port defaults to the real enqueueJob; tests
 * inject a fake to assert the surface enqueues (and charges nothing) without pg-boss.
 */
export function makeCrawlSiteTool(deps: CrawlSiteDeps = {}): RegisteredTool {
  const enqueue = deps.enqueue ?? enqueueJob;
  const inputJsonSchema = toInputJsonSchema(inputSchema);
  return {
    name: "crawl_site",
    description:
      "Crawl a project's website (async). Returns a job_id immediately; poll it with " +
      "get_job_status. Costs 20 credits, charged when the crawl runs.",
    inputJsonSchema,
    async run(ctx: AuthContext, rawInput: unknown): Promise<ToolResult> {
      const parsed = inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return errorResult(`Invalid input for "crawl_site": ${z.prettifyError(parsed.error)}`);
      }
      const { project_id, maxUrls } = parsed.data;

      // Tenant-scoped project fetch (forUser -> .eq user_id) is the ownership gate:
      // fail fast with a clear error rather than enqueue a job that could never run.
      const { data, error } = await forUser(getServiceClient(), ctx.userId)
        .selectOwn("projects", "id, domain")
        .eq("id", project_id)
        .maybeSingle();
      if (error) {
        throw new Error(`crawl_site: project lookup failed: ${error.message}`);
      }
      if (!data) {
        // Missing or another tenant's project — indistinguishable (tenant-scoped read).
        return errorResult(
          `No project found with id ${project_id}. Create one with setup_project first.`,
        );
      }
      const { domain } = data as unknown as { domain: string };

      const { jobId } = await enqueue(
        { userId: ctx.userId },
        { tool: "crawl_site", projectId: project_id, payload: { maxUrls } },
      );

      // estimated_credits reads from the human-approved price table — never a literal.
      return textResult(
        `Crawl queued for ${domain}. job_id: ${jobId} · status: queued · ` +
          `estimated_credits: ${TOOL_COSTS.crawl_site}. ` +
          `Track it with get_job_status { "job_id": "${jobId}" }.`,
      );
    },
  };
}

/** The production crawl_site tool (real enqueue). */
export const crawlSiteTool = makeCrawlSiteTool();
