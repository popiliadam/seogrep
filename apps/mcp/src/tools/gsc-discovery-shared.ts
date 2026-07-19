import { z } from "zod";
import type { ToolName } from "../credits/costs.ts";
import { loadLatestPull, type LoadPullFn, type PullData } from "../gsc-data/index.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";

/**
 * Shared builder for the three discovery tools (find_quick_wins / detect_cannibalization /
 * analyze_content_decay). Each is a defineTool with the DEFAULT "surface" charge: it reserves
 * at call time, runs its pure analysis over the latest STORED pull, and commits. All three
 * take the same input (project_id) and differ only in which engine + formatter they run —
 * the exact shape of the audit slice's makeAuditTool.
 *
 * Money-safety subtlety (identical to the audits): the reserve opens BEFORE the handler runs
 * and withCredits COMMITS a handler that RETURNS. So "no pull to analyze" must THROW, not
 * return an error result — otherwise the caller would be charged for being told to run
 * pull_gsc_data first. A pull that exists but yields zero findings is a delivered analysis
 * and DOES commit.
 */

/** Turn a loaded pull into the tool's text output (engine + formatter). */
export type RenderDiscovery = (pull: PullData) => string;

export interface DiscoveryToolDeps {
  /** The pull loader (default: the real tenant-scoped loadLatestPull). Injected in tests. */
  readonly loadPull?: LoadPullFn;
}

const inputSchema = z.object({
  project_id: z.uuid().describe("The project to analyze (must have run pull_gsc_data first)."),
});

export function makeDiscoveryTool(
  name: ToolName,
  description: string,
  render: RenderDiscovery,
  deps: DiscoveryToolDeps = {},
): RegisteredTool {
  const loadPull = deps.loadPull ?? loadLatestPull;
  return defineTool({
    name,
    description,
    inputSchema,
    // charge defaults to "surface": reserve -> handler -> commit / release.
    handler: async (ctx, { project_id }) => {
      const load = await loadPull(ctx.userId, project_id);
      if (!load.ok) {
        // THROW so withCredits RELEASES the reserve — no charge when there is nothing to
        // analyze. The registry turns this into an actionable isError result for the client.
        throw new Error(load.error);
      }
      return textResult(render(load.pull));
    },
  });
}
