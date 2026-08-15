import { z } from "zod";
import type { ToolName } from "../credits/costs.ts";
import {
  loadGscTokenStatus,
  loadLatestPull,
  renderAnalyzedWindow,
  renderPullProvenance,
  renderReauthWarning,
  renderRowCapCaveat,
  writeDiscoveryRun,
  type DiscoveryReport,
  type DiscoveryRunWriter,
  type LoadPullFn,
  type LoadTokenStatusFn,
  type PullData,
} from "../gsc-data/index.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";
import { optionalGscConnectUrl } from "./connect-gsc.ts";
import { PreconditionNotMetError } from "./precondition.ts";
import {
  ARCHIVED_PROJECT_MESSAGE,
  loadOwnProject,
  type LoadProjectFn,
} from "./project-target.ts";

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

/**
 * What one analysis produced: the engine's STRUCTURAL result, and the text the tool returns.
 *
 * Both halves come out of ONE engine call so the row and the reply can never describe different
 * runs — a builder that re-ran the engine to get something to store would be storing a second
 * measurement that merely resembles the one the caller was shown (AuditRendering, verbatim).
 */
export interface DiscoveryRendering {
  readonly report: DiscoveryReport;
  readonly text: string;
}

/**
 * Turn a loaded pull into the tool's output (engine + formatter).
 *
 * The three priced tools return a `DiscoveryRendering`, and returning one is what puts a row in
 * `gsc_discovery_runs`. A bare string stays legal — the fast-lane specs build tools through this
 * factory with no engine behind them, and such a tool writes no row, which is exactly what "there
 * is nothing structural here to store" should mean. The three that DO produce a report are pinned
 * individually (gsc-discovery-runs.db.test.ts), because a check inside a shared function proves
 * nothing about which callers reach it.
 */
export type RenderDiscovery = (pull: PullData) => string | DiscoveryRendering;

export interface DiscoveryToolDeps {
  /** The pull loader (default: the real tenant-scoped loadLatestPull). Injected in tests. */
  readonly loadPull?: LoadPullFn;
  /**
   * The discovery-run recorder (default: the real `writeDiscoveryRun`). A PORT for the same reason
   * loadPull is one — and so a spec can make the write fail without breaking a database.
   */
  readonly writeRun?: DiscoveryRunWriter;
  /** The connection-health reader (default: the real tenant-scoped loadGscTokenStatus). */
  readonly loadTokenStatus?: LoadTokenStatusFn;
  /**
   * The tenant-scoped project reader the archive gate uses (default: the real loadOwnProject).
   * A PORT like loadPull, because this lane's fast specs are DB-less by construction — the
   * default reaches getServiceClient, which requires the full prod env.
   */
  readonly loadProject?: LoadProjectFn;
}

/**
 * The staleness warning, or null when there is nothing to warn about.
 *
 * BEST-EFFORT ON PURPOSE. By the time this runs the analysis is complete and about to be
 * charged, so a failing health read is swallowed and logged rather than thrown. Throwing would
 * release the reserve and answer a WORKING analysis with "failed unexpectedly", which is a
 * strictly worse outcome than an un-warned one and the very failure mode this task exists to
 * remove. The warning is an adornment on delivered data; the delivered data always wins.
 *
 * An unset WEB_BASE_URL is deliberately NOT one of those swallowed failures any more: the link is
 * read softly, so the warning still prints and only loses its link (controller ruling). The
 * catch stays for the health read, which is the failure that genuinely has no sentence to fall
 * back on.
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
    return status === "invalid" ? renderReauthWarning(optionalGscConnectUrl(projectId)) : null;
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
  const loadProject = deps.loadProject ?? loadOwnProject;
  const writeRun = deps.writeRun ?? writeDiscoveryRun;
  return defineTool({
    name,
    description,
    inputSchema,
    // charge defaults to "surface": reserve -> handler -> commit / release.
    handler: async (ctx, { project_id }) => {
      // THE ARCHIVE GATE, first — before the pull read, because an archived project has nothing
      // to analyze whatever pull is stored against it, and "run pull_gsc_data first" would be the
      // wrong instruction for a site the tenant removed (pull_gsc_data refuses it too).
      //
      // It needs its OWN project read: everything below resolves through the succeeded pull JOB
      // by project_id and never touches `projects`, which is why the shared by-id resolver — the
      // one place this sentence lives — did not reach these three tools. loadOwnProject IS that
      // resolver, not a second one. Same shape, same reasoning, same ordering as the audit
      // slice's makeAuditTool.
      //
      // A project that does not resolve (unknown id, or another tenant's) is deliberately NOT
      // refused here: it falls through to the pull read exactly as before, so another tenant's
      // ARCHIVED project answers NO_PULL_MESSAGE like any other id that is not yours. Answering
      // "that project is archived" would say the row EXISTS — the existence oracle
      // project-target.ts's ordering rule exists to prevent.
      //
      // THROW, and TYPED: withCredits COMMITS a handler that RETURNS, so an errorResult here
      // would charge 10 credits for a refusal, and the registry keys on the ERROR TYPE to render
      // a designed refusal's sentence verbatim instead of the generic crash sentence.
      const project = await loadProject(ctx.userId, project_id);
      if (project !== null && project.archivedAt !== null) {
        throw new PreconditionNotMetError(ARCHIVED_PROJECT_MESSAGE);
      }

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

      // THE RUN IS RECORDED BEFORE THE REPLY IS BUILT, and the write is not guarded. withCredits
      // commits a handler that RETURNS and releases one that THROWS, so an error that escapes here
      // costs the tenant nothing (gsc-data/runs.ts states the same contract from the other side).
      // Caught and logged instead, the shape would be the house's worst: a charged caller, a
      // delivered analysis, and a panel that says the tool never ran.
      //
      // The findings text is taken from the SAME rendering that is stored, so the row and the
      // reply cannot describe different runs; the footer below is appended to it unchanged, which
      // is what keeps every existing pin on this output byte-identical.
      const rendered = render(load.pull);
      const findings = typeof rendered === "string" ? rendered : rendered.text;
      if (typeof rendered !== "string") {
        // The job id is required rather than optional-and-skipped: `PullLoad.jobId` is optional
        // only so DB-less fakes keep compiling, and a report with nowhere to point would otherwise
        // become a SILENTLY unrecorded run — the one failure mode this whole write exists to
        // remove. Fail closed, before the reply is built (makeAuditTool's rule, verbatim).
        if (load.jobId === undefined) {
          throw new Error(
            `${name}: pull load carried no job id — the discovery run cannot be recorded`,
          );
        }
        await writeRun(
          { userId: ctx.userId, projectId: project_id, pullJobId: load.jobId, tool: name },
          rendered.report,
        );
      }

      // THE FOOTER — ONE call site for all three tools, so these lines can't drift into three
      // slightly different sentences. Every line here is a statement about the DATA rather than
      // a finding, and each answers a question the findings alone leave open:
      //
      //   1. the window (renderAnalyzedWindow) — all three engines apply ABSOLUTE thresholds, so
      //      "20 impressions" means something ~13x stricter over 7 days than over 90, and the
      //      previous window a decay number is measured against was invisible entirely;
      //   2. the row cap (renderRowCapCaveat), only when a window was truncated — pull_gsc_data
      //      warns at pull time, which is a different conversation days or weeks earlier, and a
      //      truncated window makes decay report ghost collapses and cannibalization compute
      //      shares against a short denominator;
      //   3. the date, and past a month the staleness sentence (renderPullProvenance);
      //   4. the reauth warning last, because it is the only line that is about the CONNECTION
      //      rather than the data: it turns "pull again for fresher numbers" — which is what a
      //      bare date invites — into the action that would actually work.
      //
      // Order is fixed and the optional lines are OMITTED, never blanked, so a tool's output has
      // no empty gaps where a caveat did not apply.
      const footer = [
        renderAnalyzedWindow(load.pull),
        renderRowCapCaveat(load.pull),
        renderPullProvenance(load.pulledAt),
        await reauthWarning(ctx.userId, project_id, loadTokenStatus),
      ].filter((line): line is string => line !== null);
      return textResult(`${findings}\n\n${footer.join("\n")}`);
    },
  });
}
