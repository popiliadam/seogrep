import { z } from "zod";
import type { ToolName } from "../credits/costs.ts";
import { loadLatestCrawl, type AuditCrawl, type LoadCrawlFn } from "../audit/index.ts";
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

/** Turn a loaded crawl into the tool's text output (rule engine + formatter). */
export type RenderAudit = (crawl: AuditCrawl) => string;

export interface AuditToolDeps {
  /** The crawl loader (default: the real tenant-scoped loadLatestCrawl). Injected in tests. */
  readonly loadCrawl?: LoadCrawlFn;
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
      return textResult(render(load.crawl));
    },
  });
}
