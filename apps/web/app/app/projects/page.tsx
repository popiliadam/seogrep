import { buildProjectCards, type ProjectCardInput, type ProjectRow } from "../../../lib/projects/card";
import type { ConnectionRow, JobRow } from "../../../lib/projects/signals";
import { createClient } from "../../../lib/supabase/server";
import { ProjectList } from "./project-list";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The caller's TRACKED projects, oldest first — the same order and the same archive filter
 * `list_projects` uses, so the panel and the tool list the same sites in the same order.
 *
 * `.is("archived_at", null)`, never `.eq(…, null)`: PostgREST turns the latter into the STRING
 * "null" and it matches nothing at all. Archived projects belong to /app/connection's archive,
 * which is the one surface that shows them.
 *
 * The read goes through the CALLER'S authenticated client (RLS `projects_select_own` is the real
 * gate) and still carries an explicit user_id filter as defence in depth — no tenant table is
 * queried unfiltered (constitution NEVER #4). A failure throws rather than degrading into an
 * empty list that would read as "you have no projects".
 */
async function listActiveProjects(supabase: Supabase, userId: string): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, domain, created_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`projects lookup failed: ${error.message}`);
  }
  return (data ?? []) as unknown as ProjectRow[];
}

/**
 * Every project's `gsc_connections` row, keyed by project. ONE query for the whole page — the
 * rows are tiny and there is at most one per project, so there is nothing to gain from asking
 * per project.
 */
async function readConnections(
  supabase: Supabase,
  userId: string,
): Promise<Map<string, ConnectionRow>> {
  const { data, error } = await supabase
    .from("gsc_connections")
    .select("project_id, account_id, gsc_property")
    .eq("user_id", userId);
  if (error) {
    throw new Error(`gsc_connections lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as {
    project_id: string;
    account_id: string | null;
    gsc_property: string | null;
  }[];
  return new Map(
    rows.map((row) => [
      row.project_id,
      { account_id: row.account_id, gsc_property: row.gsc_property },
    ]),
  );
}

/**
 * The newest SUCCEEDED job of one tool for one project — the same read `getLatestSucceededResult`
 * makes in apps/mcp, through the caller's own client instead of the service one.
 *
 * PER PROJECT AND PER TOOL, deliberately, rather than one bulk query grouped in memory. `result`
 * is the crawl's whole stored jsonb: a bulk `select id, tool, result, created_at` would download
 * EVERY historical crawl payload for the tenant just to keep the newest of each pair, which for a
 * project crawled weekly for a year is megabytes thrown away per page view. `.limit(1)` fetches
 * exactly the two payloads a card can show. The cost is 2N small indexed queries, and N is the
 * number of sites one person tracks — the operator's own busiest account has nine.
 */
async function latestSucceeded(
  supabase: Supabase,
  userId: string,
  projectId: string,
  tool: string,
): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("created_at, result")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("tool", tool)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`jobs lookup (${tool}) failed: ${error.message}`);
  }
  return (data as unknown as JobRow | null) ?? null;
}

/** Gather every row one card is built from. */
async function cardInputFor(
  supabase: Supabase,
  userId: string,
  project: ProjectRow,
  connections: Map<string, ConnectionRow>,
): Promise<ProjectCardInput> {
  const [crawl, pull] = await Promise.all([
    latestSucceeded(supabase, userId, project.id, "crawl_site"),
    latestSucceeded(supabase, userId, project.id, "pull_gsc_data"),
  ]);
  return { project, crawl, pull, connection: connections.get(project.id) ?? null };
}

/**
 * /app/projects — a READ-ONLY view of every site you track: what has been crawled, what Search
 * Console reads, and the one next step. Nothing here mutates anything; every action still lives
 * in the MCP tools, which is why the empty state names `setup_project` rather than offering a
 * button.
 *
 * The /app layout already guards the session. Every read here goes through the caller's
 * AUTHENTICATED client, so RLS is the real tenant gate — this page never touches the service
 * role, which bypasses RLS by design and has no business on a page that only reads the caller's
 * own rows.
 *
 * The page itself decides nothing: `lib/projects/card.ts` turns these rows into cards using
 * @pseo/core's ladder and crawl summary, so the panel says exactly what `whats_next` and
 * `get_job_status` say. That layer is where the specs are — vitest has no RSC boundary, so a
 * spec that rendered this function would be more permissive than the runtime (signed lesson 12).
 */
export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Projects</h1>
        <p className="text-sm text-neutral-600">Sign in to view your projects.</p>
      </section>
    );
  }

  const [projects, connections] = await Promise.all([
    listActiveProjects(supabase, user.id),
    readConnections(supabase, user.id),
  ]);
  const inputs = await Promise.all(
    projects.map((project) => cardInputFor(supabase, user.id, project, connections)),
  );
  const cards = buildProjectCards(inputs, new Date());

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Projects</h1>
        <p className="text-sm text-neutral-600">
          Every site you track, oldest first. This page only reads — crawls, audits and Search
          Console pulls all run through your assistant, and the next step below is the same one
          the whats_next tool gives.
        </p>
      </header>
      <ProjectList cards={cards} />
    </section>
  );
}
