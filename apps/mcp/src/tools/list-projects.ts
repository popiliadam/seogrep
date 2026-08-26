import { z } from "zod";
import { forUser, getServiceClient } from "../db.ts";
import { defineTool, textResult } from "./registry.ts";

/**
 * list_projects — the tenant's tracked domains, plus what it has archived. 0 credits. Reads
 * through forUser so the query is tenant-scoped by construction (constitution NEVER #4); an empty
 * account returns actionable guidance rather than a bare empty list. Ordering is applied in memory
 * so the output is deterministic regardless of scan order.
 *
 * ## Two sections, two orders, and why archived rows are now shown
 *
 * The TRACKED section is unchanged: oldest first, one line per project, under the sentence it
 * always had. That is the answer to "what am I tracking?", and nothing archived belongs IN it.
 *
 * The ARCHIVE is now shown BELOW it, as its own section, most recently archived first. Until
 * 2026-08-25 archived rows were hidden entirely, on the reasoning that a list was asked "what am I
 * tracking?" and something the tenant stopped tracking is not part of that answer. That reasoning
 * still holds — it is why these are two sections rather than one merged list — but it left the
 * archive unreachable from MCP: `untrack_project` promises the project can be brought back, and
 * NOTHING listed what was in there, so coming back required remembering the domain EXACTLY. A
 * promise the customer cannot act on is not a promise. The operator signed this read-back on
 * 2026-08-25 (item 15). The by-id tools still REFUSE an archived project (project-target.ts's
 * ARCHIVED_PROJECT_MESSAGE); that is untouched, and unrelated — the caller there named one.
 *
 * The empty-account sentence is split for the same reason: the old one told a tenant whose only
 * project was archived that they had "No projects yet", which is untrue and points precisely the
 * customer this change is for at creating something new instead of at their own archive. An
 * account with nothing at all still gets exactly the sentence it always got.
 *
 * Restoring is not this tool's job and it does not do it: it names the two tools that do
 * (`setup_project` for the domain, `track_gsc_property` for the property), both of which route
 * through `openTrackedProject` and clear `archived_at` IN PLACE — same id, same crawls, same
 * reports, same property.
 */

/** A projects row as this tool reads it. `archived_at` null = actively tracked. */
export interface ProjectListRow {
  readonly id: string;
  readonly domain: string;
  readonly created_at: string;
  readonly archived_at: string | null;
}

/** The guidance an account with no projects AT ALL gets — unchanged wording. */
export const NO_PROJECTS_MESSAGE =
  'No projects yet. Add one with the setup_project tool, e.g. setup_project { "domain": "example.com" }.';

/**
 * What a tenant is told when every project they have is archived. It must NOT be the sentence
 * above: "No projects yet" is false for an account that has projects and put them away.
 */
export const NO_TRACKED_PROJECTS_MESSAGE = "You are not tracking any projects right now.";

/** The tracked section: oldest first, exactly as it has always rendered. */
function trackedSection(active: readonly ProjectListRow[]): string {
  const ordered = [...active].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lines = ordered.map((project) => `- ${project.domain} (project_id: ${project.id})`);
  return `You are tracking ${ordered.length} project(s):\n${lines.join("\n")}`;
}

/** The archive section: most recently archived first, and how to bring one back. */
function archiveSection(archived: readonly ProjectListRow[]): string {
  const ordered = [...archived].sort((a, b) =>
    String(b.archived_at).localeCompare(String(a.archived_at)),
  );
  const lines = ordered.map(
    (project) => `- ${project.domain} (project_id: ${project.id}, archived ${project.archived_at})`,
  );
  return (
    `Archived — ${ordered.length} project(s), most recently archived first:\n${lines.join("\n")}\n` +
    "Nothing was lost. Run setup_project with the same domain — or track_gsc_property for its " +
    "Search Console property — and the project comes back on the same id, with its crawls, " +
    "reports and connection intact."
  );
}

/**
 * Render the whole answer from the tenant's rows. Pure, so all four shapes (nothing at all /
 * tracked only / archive only / both) are pinned in the fast lane while the DB lane proves the
 * tenant-scoped read underneath it.
 */
export function formatProjectList(rows: readonly ProjectListRow[]): string {
  const active = rows.filter((row) => row.archived_at === null);
  const archived = rows.filter((row) => row.archived_at !== null);
  if (active.length === 0 && archived.length === 0) return NO_PROJECTS_MESSAGE;
  const head = active.length === 0 ? NO_TRACKED_PROJECTS_MESSAGE : trackedSection(active);
  if (archived.length === 0) return head;
  return `${head}\n\n${archiveSection(archived)}`;
}

export const listProjectsTool = defineTool({
  name: "list_projects",
  // The archive is named but NOT advertised as an action: "…and how to bring one back" would put
  // a restore verb in this sentence and start competing with setup_project / track_gsc_property,
  // which are the tools that actually restore. The routes back are in the ANSWER, where the model
  // reads them as the next step rather than as a reason to pick this tool.
  description:
    "List the website domains you are tracking (oldest first), plus any projects you have archived.",
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const { data, error } = await forUser(getServiceClient(), ctx.userId).selectOwn(
      "projects",
      // `archived_at` is PROJECTED rather than FILTERED on now: both sections come from one read.
      "id, domain, created_at, archived_at",
    );
    if (error) {
      throw new Error(`projects list failed: ${error.message}`);
    }
    // forUser.selectOwn takes a runtime column string, so supabase-js cannot infer the
    // row shape (it falls back to GenericStringError[]); assert the known projection.
    const rows = (data ?? []) as unknown as ProjectListRow[];
    return textResult(formatProjectList(rows));
  },
});
