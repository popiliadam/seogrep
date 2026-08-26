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

/**
 * What Search Console is for ONE project. THREE states, never a boolean — the shape is lifted
 * from the panel's own model (apps/web/lib/projects/card.ts), which already refused to collapse
 * them, and `expired` rides along beside the mapping for the reason that file gives: the mapping
 * says WHAT is connected, health says whether it WORKS.
 *
 * The middle state is the one this exists for. A live measurement on 2026-08-26 found a project
 * holding a gsc_connections row whose `gsc_property` was NULL: connected to an account, mapped to
 * nothing. A two-state rendering prints a tick there and the customer learns it was a lie only
 * when pull_gsc_data fails. `expired` is meaningless without a connection and is therefore not
 * expressible on the `not_connected` variant.
 */
export type ProjectGscState =
  | { readonly kind: "not_connected" }
  | { readonly kind: "connected"; readonly property: string | null; readonly expired: boolean };

/** The most recent background run for a project — the tool that ran, and when. */
export interface ProjectLastJob {
  readonly tool: string;
  readonly at: string;
}

/** A projects row as this tool reads it. `archived_at` null = actively tracked. */
export interface ProjectListRow {
  readonly id: string;
  readonly domain: string;
  readonly created_at: string;
  readonly archived_at: string | null;
  /** Search Console for this project. Defaults to not_connected when nothing was read. */
  readonly gsc: ProjectGscState;
  /** The newest `jobs` row for this project, or null when nothing has ever run. */
  readonly lastJob: ProjectLastJob | null;
}

/** The guidance an account with no projects AT ALL gets — unchanged wording. */
export const NO_PROJECTS_MESSAGE =
  'No projects yet. Add one with the setup_project tool, e.g. setup_project { "domain": "example.com" }.';

/**
 * What a tenant is told when every project they have is archived. It must NOT be the sentence
 * above: "No projects yet" is false for an account that has projects and put them away.
 */
export const NO_TRACKED_PROJECTS_MESSAGE = "You are not tracking any projects right now.";

/**
 * WHAT "last job" MEANS, said once under the list rather than on every line.
 *
 * `jobs` holds BACKGROUND runs, and measurement on 2026-08-26 pinned which: its `tool` column
 * carried exactly `crawl_site` and `pull_gsc_data`. A project audited ten times and never crawled
 * therefore reads "none yet" — true of jobs, false of activity. Naming the scope is what keeps the
 * line from being read as "nothing has ever happened here", which is the whole failure mode a
 * silent proxy metric produces.
 */
export const JOB_SCOPE_NOTE =
  'A "job" is a background run — crawl_site or pull_gsc_data. Audits, keyword and backlink ' +
  "lookups run synchronously and are not jobs, so a project can read \"none yet\" and still have " +
  "been analysed.";

/** The Search Console half of a tracked line. */
function renderGsc(gsc: ProjectGscState): string {
  if (gsc.kind === "not_connected") return "Search Console: not connected";
  if (gsc.property === null) {
    // Connected to a Google account, mapped to no property. Saying "connected" alone here is the
    // lie this branch exists to prevent — nothing can be pulled until a property is chosen.
    return "Search Console: connected, no property selected";
  }
  const health = gsc.expired ? " (reconnect needed)" : "";
  return `Search Console: ${gsc.property}${health}`;
}

/**
 * The last-job half. The DAY, not the instant: a timestamp to the millisecond invites a precision
 * the fact does not have, and "when did anything last run here" is a day-scale question.
 */
function renderLastJob(lastJob: ProjectLastJob | null): string {
  if (lastJob === null) return "last job: none yet";
  return `last job: ${lastJob.tool} ${lastJob.at.slice(0, 10)}`;
}

/** The tracked section: oldest first, each line carrying its Search Console state and last job. */
function trackedSection(active: readonly ProjectListRow[]): string {
  const ordered = [...active].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lines = ordered.map(
    (project) =>
      `- ${project.domain} (project_id: ${project.id}) — ${renderGsc(project.gsc)} · ` +
      renderLastJob(project.lastJob),
  );
  return `You are tracking ${ordered.length} project(s):\n${lines.join("\n")}\n${JOB_SCOPE_NOTE}`;
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

/** The `projects` projection this tool reads, before the two per-project facts are folded in. */
type ProjectBaseRow = Omit<ProjectListRow, "gsc" | "lastJob">;

/** The tenant-scoped query surface this module reads through (the object forUser returns). */
type Scoped = ReturnType<typeof forUser>;

/**
 * Every project's Search Console state, keyed by project id. TWO queries for the whole answer,
 * never one per project: a tenant has one gsc_connections row per connected project and a handful
 * of Google accounts however many sites they track, so a per-project read would be N round trips
 * over single-digit tables — the same shape the panel settled on.
 *
 * `gsc_accounts` is projected to `id, token_status` AND NOTHING ELSE. `encrypted_refresh_token`
 * lives in that table, and a wider projection would put a credential column in a code path that
 * has no business holding one. Reading two columns is the guarantee; the grant is the backstop.
 *
 * A missing / null `token_status` is NOT read as expired: unknown health is not dead health, and
 * printing "reconnect needed" on a working connection sends a customer through an OAuth round for
 * a fact nobody measured.
 */
async function readGscStates(scoped: Scoped): Promise<Map<string, ProjectGscState>> {
  const [connections, accounts] = await Promise.all([
    scoped.selectOwn("gsc_connections", "project_id, account_id, gsc_property"),
    scoped.selectOwn("gsc_accounts", "id, token_status"),
  ]);
  if (connections.error) {
    throw new Error(`gsc_connections list failed: ${connections.error.message}`);
  }
  if (accounts.error) {
    throw new Error(`gsc_accounts list failed: ${accounts.error.message}`);
  }
  const health = new Map(
    ((accounts.data ?? []) as unknown as { id: string; token_status: string | null }[]).map(
      (row) => [row.id, row.token_status],
    ),
  );
  const rows = (connections.data ?? []) as unknown as {
    project_id: string;
    account_id: string | null;
    gsc_property: string | null;
  }[];
  return new Map(
    rows.map((row) => [
      row.project_id,
      {
        kind: "connected" as const,
        property: row.gsc_property,
        expired: row.account_id !== null && health.get(row.account_id) === "invalid",
      },
    ]),
  );
}

/**
 * The newest `jobs` row per project, keyed by project id.
 *
 * NO ROW CAP, DELIBERATELY. A `.limit(n)` here would silently drop the only job of a project
 * whose last run is older than the n most recent ones, and that project would then render
 * "last job: none yet" — a FALSE statement produced to save a read, which is precisely the
 * failure this whole slice exists to remove. The table is bounded by what a tenant has actually
 * run (57 rows across the whole deployment when this was written) and is projected to three
 * columns; if it ever grows enough to matter, the fix is an index or a per-project aggregate,
 * not a cap that lies.
 *
 * Ordered newest-first so the FIRST row seen for a project is its latest; `Map.set` is therefore
 * guarded rather than overwriting.
 */
async function readLastJobs(scoped: Scoped): Promise<Map<string, ProjectLastJob>> {
  const { data, error } = await scoped
    .selectOwn("jobs", "project_id, tool, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`jobs list failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as {
    project_id: string | null;
    tool: string | null;
    created_at: string;
  }[];
  const latest = new Map<string, ProjectLastJob>();
  for (const row of rows) {
    // `jobs.project_id` is `on delete set null`, so an orphaned job belongs to no project.
    if (row.project_id === null || latest.has(row.project_id)) continue;
    latest.set(row.project_id, { tool: row.tool ?? "job", at: row.created_at });
  }
  return latest;
}

export const listProjectsTool = defineTool({
  name: "list_projects",
  // The archive is named but NOT advertised as an action: "…and how to bring one back" would put
  // a restore verb in this sentence and start competing with setup_project / track_gsc_property,
  // which are the tools that actually restore. The routes back are in the ANSWER, where the model
  // reads them as the next step rather than as a reason to pick this tool.
  // Length matters here and is not cosmetic: gen-tool-docs strips the cost sentence and then
  // truncates what is left at 155 chars for the page's <meta> description. A longer sentence
  // ships an ellipsis to search engines, so the two new facts are named in the fewest words
  // that still say WHICH facts they are.
  description:
    "List the website domains you are tracking (oldest first), each with its Search Console " +
    "state and last job, plus any projects you have archived. Costs 0 credits.",
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const scoped = forUser(getServiceClient(), ctx.userId);
    const { data, error } = await scoped.selectOwn(
      "projects",
      // `archived_at` is PROJECTED rather than FILTERED on now: both sections come from one read.
      "id, domain, created_at, archived_at",
    );
    if (error) {
      throw new Error(`projects list failed: ${error.message}`);
    }
    // forUser.selectOwn takes a runtime column string, so supabase-js cannot infer the
    // row shape (it falls back to GenericStringError[]); assert the known projection.
    const bare = (data ?? []) as unknown as ProjectBaseRow[];
    const [gsc, lastJobs] = await Promise.all([
      readGscStates(scoped),
      readLastJobs(scoped),
    ]);
    const rows: ProjectListRow[] = bare.map((row) => ({
      ...row,
      gsc: gsc.get(row.id) ?? { kind: "not_connected" },
      lastJob: lastJobs.get(row.id) ?? null,
    }));
    return textResult(formatProjectList(rows));
  },
});
