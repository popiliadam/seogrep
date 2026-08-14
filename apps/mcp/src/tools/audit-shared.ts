import { z } from "zod";
import type { ToolName } from "../credits/costs.ts";
import {
  loadLatestCrawl,
  writeAuditRun,
  type AuditCrawl,
  type AuditReport,
  type AuditRunWriter,
  type LoadCrawlFn,
} from "../audit/index.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";
import { PreconditionNotMetError } from "./precondition.ts";
import {
  ARCHIVED_PROJECT_MESSAGE,
  loadOwnProject,
  type LoadProjectFn,
} from "./project-target.ts";

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

/**
 * What one audit produced: the rule engine's STRUCTURAL report, and the text the tool returns.
 *
 * Both halves come out of ONE call so the row and the reply can never describe different runs —
 * a builder that re-ran the engine to get something to store would be storing a second
 * measurement that merely resembles the one the caller was shown.
 */
export interface AuditRendering {
  readonly report: AuditReport;
  readonly text: string;
}

/**
 * Turn a loaded crawl into the tool's output (rule engine + formatter).
 *
 * The three priced audits return an `AuditRendering`, and returning one is what puts a run in
 * `audit_runs`. A bare string stays legal — some callers of this builder have no rule engine and
 * therefore no structural report to record — and such a tool writes no row, which is exactly what
 * "there is nothing structural here to store" should mean. The three that DO produce a report are
 * pinned individually (audit-runs.db.test.ts), because a check inside a shared function proves
 * nothing about which callers reach it.
 */
export type RenderAudit = (crawl: AuditCrawl) => string | AuditRendering;

export interface AuditToolDeps {
  /** The crawl loader (default: the real tenant-scoped loadLatestCrawl). Injected in tests. */
  readonly loadCrawl?: LoadCrawlFn;
  /**
   * The audit-run recorder (default: the real `writeAuditRun`). A PORT for the same reason
   * loadCrawl is one — and so a spec can make the write fail without breaking a database.
   */
  readonly writeRun?: AuditRunWriter;
  /**
   * The tenant-scoped project reader the archive gate uses (default: the real loadOwnProject).
   * A PORT like loadCrawl, because this lane's fast specs are DB-less by construction — the
   * default reaches getServiceClient, which requires the full prod env.
   */
  readonly loadProject?: LoadProjectFn;
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
  const loadProject = deps.loadProject ?? loadOwnProject;
  const writeRun = deps.writeRun ?? writeAuditRun;
  return defineTool({
    name,
    description,
    inputSchema,
    // charge defaults to "surface": reserve -> handler -> commit / release.
    handler: async (ctx, { project_id }) => {
      // THE ARCHIVE GATE, first — before the crawl read, because an archived project has nothing
      // to audit whatever crawl is stored against it, and "run crawl_site first" would be the
      // wrong instruction for a site the tenant removed (crawl_site refuses it too).
      //
      // It needs its OWN project read: everything below resolves through the succeeded crawl JOB
      // by project_id and never touches `projects`, which is why the shared by-id resolver — the
      // one place this sentence lives — did not reach these three tools. loadOwnProject IS that
      // resolver, not a second one.
      //
      // A project that does not resolve (unknown id, or another tenant's) is deliberately NOT
      // refused here: it falls through to the crawl read exactly as before, so another tenant's
      // ARCHIVED project answers NO_CRAWL_MESSAGE like any other id that is not yours. Answering
      // "that project is archived" would say the row EXISTS — the existence oracle
      // project-target.ts's ordering rule exists to prevent.
      //
      // THROW, and TYPED: withCredits COMMITS a handler that RETURNS, so an errorResult here
      // would charge 30/15/5 credits for a refusal, and the registry keys on the ERROR TYPE to
      // render a designed refusal's sentence verbatim instead of the generic crash sentence.
      const project = await loadProject(ctx.userId, project_id);
      if (project !== null && project.archivedAt !== null) {
        throw new PreconditionNotMetError(ARCHIVED_PROJECT_MESSAGE);
      }

      const load = await loadCrawl(ctx.userId, project_id);
      if (!load.ok) {
        // THROW so withCredits RELEASES the reserve — no charge when there is nothing to
        // audit. TYPED, because the registry's catch cannot otherwise tell this designed
        // refusal from a crash: it matches PreconditionNotMetError and returns load.error
        // verbatim, where a raw Error is swallowed by the generic "failed unexpectedly,
        // quote reference X" branch (which is what 18 live calls got on 2026-08-09).
        //
        // load.error is deliberately the same sentence for a missing project, another
        // tenant's project and a project never crawled (audit/load.ts). Now that it reaches
        // the user, that uniformity is what keeps project existence unobservable.
        throw new PreconditionNotMetError(load.error);
      }

      const rendered = render(load.crawl);
      if (typeof rendered === "string") return textResult(rendered);

      // THE RUN IS RECORDED BEFORE THE REPORT IS HANDED OVER, and the write is not guarded.
      // withCredits commits a handler that RETURNS and releases one that THROWS, so an error
      // that escapes here costs the tenant nothing (audit/runs.ts states the same contract from
      // the other side). Caught and logged instead, the shape would be the house's worst: a
      // charged caller, a delivered report, and a panel that says the audit never ran.
      //
      // The job id is required rather than optional-and-skipped: `CrawlLoad.jobId` is optional
      // only so DB-less fakes keep compiling, and a report with nowhere to point would otherwise
      // become a SILENTLY unrecorded run — the one failure mode this whole write exists to
      // remove. Fail closed, before the reply is built.
      if (load.jobId === undefined) {
        throw new Error(`${name}: crawl load carried no job id — the audit run cannot be recorded`);
      }
      await writeRun(
        { userId: ctx.userId, projectId: project_id, crawlJobId: load.jobId, tool: name },
        rendered.report,
      );
      return textResult(rendered.text);
    },
  });
}
