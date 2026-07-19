import { z } from "zod";
import type { ToolName } from "../credits/costs.ts";
import { loadLatestCrawl, type AuditCrawl, type LoadCrawlFn } from "../audit/index.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";

/**
 * Shared builder for the three sync audit tools (audit_onpage / audit_tech / audit_schema).
 * Each is a defineTool with the DEFAULT "surface" charge: it reserves at call time, runs
 * the rule engine over the latest crawl, and commits. All three take the same input
 * (project_id) and differ only in which rule engine + formatter they run.
 *
 * Money-safety subtlety: on the "surface" charge path the reserve is opened BEFORE the
 * handler runs, and withCredits COMMITS a handler that RETURNS (only a THROW releases). So
 * "no crawl to audit" must THROW, not return an error result — otherwise the caller would
 * be charged for being told to run crawl_site first. A crawl that exists but yields zero
 * findings is a delivered audit and DOES commit.
 */

/** Turn a loaded crawl into the tool's text output (rule engine + formatter). */
export type RenderAudit = (crawl: AuditCrawl) => string;

export interface AuditToolDeps {
  /** The crawl loader (default: the real tenant-scoped loadLatestCrawl). Injected in tests. */
  readonly loadCrawl?: LoadCrawlFn;
}

const inputSchema = z.object({
  project_id: z.uuid().describe("The project to audit (from setup_project / list_projects)."),
});

export function makeAuditTool(
  name: ToolName,
  description: string,
  render: RenderAudit,
  deps: AuditToolDeps = {},
): RegisteredTool {
  const loadCrawl = deps.loadCrawl ?? loadLatestCrawl;
  return defineTool({
    name,
    description,
    inputSchema,
    // charge defaults to "surface": reserve -> handler -> commit / release.
    handler: async (ctx, { project_id }) => {
      const load = await loadCrawl(ctx.userId, project_id);
      if (!load.ok) {
        // THROW so withCredits RELEASES the reserve — no charge when there is nothing to
        // audit. The registry turns this into an actionable isError result for the client.
        throw new Error(load.error);
      }
      return textResult(render(load.crawl));
    },
  });
}
