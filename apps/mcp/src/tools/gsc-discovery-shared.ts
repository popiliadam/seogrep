import { z } from "zod";
import type { ToolName } from "../credits/costs.ts";
import {
  loadGscTokenStatus,
  loadLatestPull,
  renderPullProvenance,
  renderReauthWarning,
  type LoadPullFn,
  type LoadTokenStatusFn,
  type PullData,
} from "../gsc-data/index.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";
import { gscConnectUrl } from "./connect-gsc.ts";
import { PreconditionNotMetError } from "./precondition.ts";

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
  /** The connection-health reader (default: the real tenant-scoped loadGscTokenStatus). */
  readonly loadTokenStatus?: LoadTokenStatusFn;
}

/**
 * The staleness warning, or null when there is nothing to warn about.
 *
 * BEST-EFFORT ON PURPOSE. By the time this runs the analysis is complete and about to be
 * charged, so every failure here — a health read that errors, an unset WEB_BASE_URL — is
 * swallowed and logged rather than thrown. Throwing would release the reserve and answer a
 * WORKING analysis with "failed unexpectedly", which is a strictly worse outcome than an
 * un-warned one and the very failure mode this task exists to remove. The warning is an
 * adornment on delivered data; the delivered data always wins.
 *
 * It reads STORED state, unlike pull_gsc_data's own reauth error, which is derived from the
 * refresh failure it just saw. That split is the point: these three tools never call Google, so
 * stored state is the only evidence available to them — and it is trustworthy precisely because
 * the path that DOES call Google now writes it.
 */
async function reauthWarning(
  userId: string,
  projectId: string,
  loadTokenStatus: LoadTokenStatusFn,
): Promise<string | null> {
  try {
    const status = await loadTokenStatus(userId, projectId);
    return status === "invalid" ? renderReauthWarning(gscConnectUrl(projectId)) : null;
  } catch (error) {
    console.error(
      `discovery: connection-health warning skipped for project ${projectId}`,
      error,
    );
    return null;
  }
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
  const loadTokenStatus = deps.loadTokenStatus ?? loadGscTokenStatus;
  return defineTool({
    name,
    description,
    inputSchema,
    // charge defaults to "surface": reserve -> handler -> commit / release.
    handler: async (ctx, { project_id }) => {
      const load = await loadPull(ctx.userId, project_id);
      if (!load.ok) {
        // THROW so withCredits RELEASES the reserve — no charge when there is nothing to
        // analyze. TYPED for the same reason as the audits: the registry's catch matches
        // PreconditionNotMetError and returns load.error verbatim, where a raw Error is
        // swallowed by the generic "failed unexpectedly, quote reference X" branch (what
        // 8 live calls got on 2026-08-09).
        //
        // load.error is deliberately the same sentence for a missing project, another
        // tenant's project and a project never pulled (gsc-data/load.ts). Now that it
        // reaches the user, that uniformity is what keeps project existence unobservable.
        throw new PreconditionNotMetError(load.error);
      }
      // ONE call site for all three tools, so the provenance line can't drift into three
      // slightly different sentences (gsc-data/load.ts renderPullProvenance). The staleness
      // warning follows it for the same reason and in that order: the date is the claim, the
      // warning is what turns "pull again for fresher numbers" — which is what a bare date
      // invites — into the action that would actually work.
      const body = `${render(load.pull)}\n\n${renderPullProvenance(load.pulledAt)}`;
      const warning = await reauthWarning(ctx.userId, project_id, loadTokenStatus);
      return textResult(warning ? `${body}\n${warning}` : body);
    },
  });
}
