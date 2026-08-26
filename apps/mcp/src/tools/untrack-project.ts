import { z } from "zod";
import { getServiceClient } from "../db.ts";
import {
  loadOwnProject,
  projectNotFoundMessage,
  type LoadProjectFn,
  type ProjectRef,
} from "./project-target.ts";
import { defineTool, errorResult, textResult, type RegisteredTool } from "./registry.ts";

/**
 * untrack_project — stop tracking a project by ARCHIVING it. 0 credits: it calls no paid API
 * and never touches the ledger (NEVER #2).
 *
 * IT ARCHIVES, IT NEVER DELETES, and that is the whole design rather than a soft-delete habit.
 * A DELETE would cascade `gsc_connections` away and orphan every job (`jobs.project_id` is
 * `on delete set null`), so a domain added again later could never re-attach its own past.
 * Stamping `archived_at` keeps the row, its history AND its Search Console mapping exactly as
 * they were — which is what makes coming back free: `track_gsc_property` (and `setup_project`)
 * route through `openTrackedProject`, which clears `archived_at` IN PLACE and hands back the
 * same id, the same crawls, the same reports, the same property.
 *
 * Three properties this file is responsible for:
 *
 *   1. TENANT-SCOPED ON BOTH SIDES. The ownership check is `loadOwnProject` — the single by-id
 *      project resolver — so a missing project and another tenant's project are indistinguishable
 *      (the same sentence, byte for byte). The WRITE carries its own `.eq("user_id", …)` as well:
 *      this client is service-role and bypasses RLS, so NEVER #4 binds the write, not only the
 *      read that preceded it.
 *
 *   2. THE WRITE PROVES IT MATCHED A ROW. PostgREST answers an UPDATE that matched ZERO rows with
 *      no error at all, so `error === null` says nothing was WRONG — never that anything was
 *      WRITTEN. The write therefore asks for the row back (`.select("id").maybeSingle()`) and an
 *      empty answer is reported as a failure. Reporting "stopped tracking" for a write that
 *      changed nothing is the exact defect Task 4's referee found in setup_project's twin write.
 *
 *   3. IDEMPOTENT, AND WITHOUT RE-STAMPING. An already-archived project is a success, not an
 *      error — and no write runs, so the date the tenant actually put the project away survives
 *      a second call.
 */

/** Stamp `archived_at` for one of this tenant's projects. True = a row was really written. */
export type ArchiveProjectFn = (userId: string, projectId: string) => Promise<boolean>;

export interface UntrackProjectDeps {
  readonly loadProject?: LoadProjectFn;
  readonly archiveProject?: ArchiveProjectFn;
}

/**
 * The production archive write, exported so the DB lane can drive it DIRECTLY. That matters:
 * at the tool level the ownership gate refuses a foreign project before this ever runs, so a
 * tool-level spec cannot tell whether the `.eq("user_id", …)` below is load-bearing. Called
 * head-on with a mismatched (userId, projectId) pair against real rows, it can — and must
 * match nothing.
 *
 * Returns false when the UPDATE matched no row (see property 2 in the header); throws only on a
 * real query error.
 */
export async function archiveOwnProject(userId: string, projectId: string): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", projectId)
    // The tenant filter on the WRITE (NEVER #4) — not a duplicate of the read that found the
    // row: this client bypasses RLS, so this `.eq` is the only thing standing between a stray
    // project id and another tenant's row.
    .eq("user_id", userId)
    // …and the row back, because a zero-row UPDATE is not an error in PostgREST.
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`projects archive failed: ${error.message}`);
  }
  return data !== null;
}

function archivedMessage(project: ProjectRef): string {
  return (
    `Stopped tracking "${project.domain}" (project_id: ${project.id}). It moved to your archive, ` +
    "which keeps everything: the project itself, its crawls and reports, and its Search Console " +
    "link are all untouched. Run track_gsc_property for the same property — or setup_project for " +
    "the same domain — and this same project comes back exactly as it is now."
  );
}

/**
 * The idempotent answer — and it must offer the SAME two ways back that archivedMessage does.
 *
 * Measured 2026-08-25 (tool review card 9): it named only `track_gsc_property`. That tool restores
 * a project through its Search Console PROPERTY, so for a project that has none — every project
 * created by `setup_project` and never connected — the single route on offer does not work, and
 * the caller is pointed at a tool that cannot help them. `setup_project` for the same domain goes
 * through the same `openTrackedProject`, clearing `archived_at` in place, so it restores exactly
 * what the first message promises: the same id, the same crawls, reports and property.
 */
function alreadyArchivedMessage(project: ProjectRef): string {
  return (
    `"${project.domain}" (project_id: ${project.id}) is already in your archive, so nothing was ` +
    "changed. Its history and its Search Console link are still kept. Run track_gsc_property for " +
    "the same property — or setup_project for the same domain, which works whether or not this " +
    "project has a Search Console property — and it comes back unchanged."
  );
}

/**
 * The write matched no row although the read a moment earlier found one. Rare by construction,
 * and deliberately NOT reported as success: the caller asked for the project to stop being
 * tracked and it still is.
 */
function notArchivedMessage(project: ProjectRef): string {
  return (
    `Nothing was changed: "${project.domain}" (project_id: ${project.id}) is still being tracked ` +
    "— the update matched no row, so the project changed while this ran. Run list_projects to " +
    "see where it stands, then run this again."
  );
}

/** Build the tool. Both ports are injectable, so the fast lane drives it with no database. */
export function makeUntrackProjectTool(deps: UntrackProjectDeps = {}): RegisteredTool {
  const loadProject = deps.loadProject ?? loadOwnProject;
  const archiveProject = deps.archiveProject ?? archiveOwnProject;
  return defineTool({
    name: "untrack_project",
    description:
      "Stop tracking a project. It moves to the archive — its history and Search Console link " +
      "are kept, and track_gsc_property brings it back unchanged. Costs 0 credits.",
    inputSchema: z.object({
      project_id: z.uuid().describe("The project to stop tracking, from list_projects."),
    }),
    handler: async (ctx, { project_id: projectId }) => {
      const project = await loadProject(ctx.userId, projectId);
      if (project === null) {
        // Missing and another tenant's leave through the SAME sentence, so this cannot be used
        // to learn which project ids exist.
        return errorResult(projectNotFoundMessage(projectId));
      }
      if (project.archivedAt !== null) {
        return textResult(alreadyArchivedMessage(project));
      }
      const archived = await archiveProject(ctx.userId, projectId);
      if (!archived) {
        return errorResult(notArchivedMessage(project));
      }
      return textResult(archivedMessage(project));
    },
  });
}

/** The production untrack_project tool (real DB). */
export const untrackProjectTool = makeUntrackProjectTool();
