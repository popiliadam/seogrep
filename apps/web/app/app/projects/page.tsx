import { buildProjectCards, type ProjectCardInput, type ProjectRow } from "../../../lib/projects/card";
import { CRAWL_HISTORY_LIMIT, type JobHistoryRow } from "../../../lib/projects/history";
import type { ConnectionRow, JobRow } from "../../../lib/projects/signals";
import { createClient } from "../../../lib/supabase/server";
import { AddDomainBanner } from "./add-domain-banner";
import { AddDomainForm } from "./add-domain-form";
import { ProjectList } from "./project-list";

/** A repeated query param (?added=a&added=b) arrives as an array; only the first value counts. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

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
 * exactly the two payloads a card can show. The cost is 2N small indexed queries (3N with the
 * payload-free crawl trail below), and N is the number of sites one person tracks — the
 * operator's own busiest account has nine.
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

/**
 * The project's last few `crawl_site` runs in EVERY state — the trail beside the summary above.
 *
 * A DIFFERENT READ from `latestSucceeded`, not a widening of it, because the two want opposite
 * things. That one wants the newest SUCCEEDED row WITH its `result`, to summarize; this one wants
 * the newest rows whatever they did and must NOT download `result` — five historical crawl
 * payloads per project is megabytes fetched to render five status words. So the select lists the
 * lifecycle columns and nothing else, and `JobHistoryRow` has no `result` field to put one in.
 *
 * `tool` is selected as well as filtered on: `buildCrawlHistory` re-applies the filter, and a
 * projection that omitted the column would hand it `undefined` for every row and quietly empty
 * every trail. Newest first with `.limit()` — reversed, the limit would truncate at the DATABASE
 * and hand back the five OLDEST crawls, which no in-memory sort could repair.
 *
 * Caller's authenticated client, explicit user_id filter beside RLS `jobs_select_own`, and
 * (user_id, created_at desc) from migration 0009 is exactly this shape.
 */
async function recentCrawlRuns(
  supabase: Supabase,
  userId: string,
  projectId: string,
): Promise<JobHistoryRow[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, tool, status, created_at, started_at, finished_at, error")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("tool", "crawl_site")
    .order("created_at", { ascending: false })
    .limit(CRAWL_HISTORY_LIMIT);
  if (error) {
    throw new Error(`jobs history lookup failed: ${error.message}`);
  }
  return (data ?? []) as unknown as JobHistoryRow[];
}

/** Gather every row one card is built from. */
async function cardInputFor(
  supabase: Supabase,
  userId: string,
  project: ProjectRow,
  connections: Map<string, ConnectionRow>,
): Promise<ProjectCardInput> {
  const [crawl, pull, crawlHistory] = await Promise.all([
    latestSucceeded(supabase, userId, project.id, "crawl_site"),
    latestSucceeded(supabase, userId, project.id, "pull_gsc_data"),
    recentCrawlRuns(supabase, userId, project.id),
  ]);
  return {
    project,
    crawl,
    pull,
    crawlHistory,
    connection: connections.get(project.id) ?? null,
  };
}

/**
 * /app/projects — every site you track: what has been crawled, what Search Console reads, and
 * the one next step. It reads, and it does exactly ONE thing: add a domain. That single write
 * goes through `openTrackedProject` (@pseo/db/projects), the same route `setup_project` calls —
 * the panel owns no second way to create a project. Everything else (crawls, audits, Search
 * Console pulls) still runs through the assistant.
 *
 * The form answers by redirecting back here with a status in the query string, which is what
 * `searchParams` (a promise in Next 16) carries into AddDomainBanner.
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
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
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
    <section>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-8 animate-[rise_0.5s_ease-out_both]">
        <header>
          <p className="m-0 mb-2.5 font-mono text-[11px] tracking-[0.14em] text-accent">DASHBOARD</p>
          <h1 className="m-0 mb-2 font-serif text-[34px] font-medium tracking-[-0.01em]">Projects</h1>
          <p className="m-0 max-w-[64ch] font-serif text-[15px] leading-[1.6] text-muted">
            Every site you track, oldest first. Add a domain here; crawls, audits and Search Console
            pulls all run through your assistant, and the next step below is the same one the
            whats_next tool gives.
          </p>
        </header>
        <AddDomainForm />
      </div>

      <div className="mb-6 empty:mb-0">
        <AddDomainBanner
          added={firstValue(params.added)}
          domain={firstValue(params.domain)}
          error={firstValue(params.error)}
        />
      </div>

      <div className="animate-[rise_0.5s_ease-out_0.08s_both]">
        <ProjectList cards={cards} />
      </div>

      <p className="m-0 mt-10 border border-dashed border-hairline-mid px-7 py-6 font-mono text-[12.5px] leading-[1.8] text-faint animate-[rise_0.5s_ease-out_0.14s_both]">
        <span className="text-accent">tip</span> · run a crawl from your assistant:{" "}
        <span className="text-body">“crawl example.com”</span> — results land here and in your chat.
      </p>
    </section>
  );
}
