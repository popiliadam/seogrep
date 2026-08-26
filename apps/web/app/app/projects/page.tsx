import { AUDIT_TOOLS, type AuditRunRow } from "../../../lib/projects/audits";
import {
  buildProjectCards,
  type ProjectCard,
  type ProjectCardInput,
  type ProjectRow,
} from "../../../lib/projects/card";
import { CRAWL_HISTORY_LIMIT, type JobHistoryRow } from "../../../lib/projects/history";
import { DISCOVERY_TOOLS, type DiscoveryRunRow } from "../../../lib/projects/insights";
import { DOMAIN_LOOKUP_TOOLS, type DomainLookupRunRow } from "../../../lib/projects/lookups";
import {
  tokenStatusFor,
  type ConnectionRow,
  type GscTokenStatus,
  type JobRow,
  type PullRow,
} from "../../../lib/projects/signals";
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
 * Every Google account the caller has connected, keyed by id, carrying ONLY its stored health.
 *
 * ONE query for the whole page, like `readConnections` above: a user has a handful of Google
 * accounts however many sites they track, so a per-project read would be N round trips for a table
 * with single-digit rows. The projects then look their own account up in this map — the join is
 * `gsc_connections.account_id -> gsc_accounts.id`, the same two hops whats_next makes per project.
 *
 * `id, token_status` AND NOTHING ELSE. `authenticated` holds a column-level SELECT grant on this
 * table that EXCLUDES `encrypted_refresh_token` (migration 0021), so a wider projection would not
 * leak the ciphertext — it would FAIL, and the panel would lose its health line to an error. The
 * narrow list is what keeps every credential column out of a Server Component's payload by
 * construction rather than by grant alone, and `query-and-nav.test.ts` pins it: a type cannot see
 * what a projection asks PostgREST for.
 *
 * A failure THROWS, like every other read here, rather than degrading to "all healthy". Overview's
 * count degrades to zero because inventing "your connection is dead" out of a query error would
 * send a user through an OAuth round for a database blip; here the opposite error is the one on
 * offer — swallowing it would route a project to `pull_gsc_data`, which is exactly the guaranteed
 * failure the reconnect rung exists to remove (whats-next.ts makes the same call).
 *
 * Caller's authenticated client, explicit user_id filter beside RLS (constitution NEVER #4).
 */
async function readAccountHealth(
  supabase: Supabase,
  userId: string,
): Promise<Map<string, GscTokenStatus>> {
  const { data, error } = await supabase
    .from("gsc_accounts")
    .select("id, token_status")
    .eq("user_id", userId);
  if (error) {
    throw new Error(`gsc_accounts lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { id: string; token_status: GscTokenStatus | null }[];
  return new Map(
    rows.flatMap((row) => (row.token_status === null ? [] : [[row.id, row.token_status] as const])),
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
 * exactly the one payload a card can show. The cost is one small indexed query per project, and N
 * is the number of sites one person tracks — the operator's own busiest account has nine.
 *
 * CRAWLS ONLY, since the pull read split off below. The crawl genuinely needs its whole `result`
 * — `summarizeCrawlResult` (in @pseo/core) reads across it — and it is bounded by the crawler's
 * 100-page cap. The pull's is not: two windows of Search Console rows, up to the 15,000-row cap
 * each, downloaded to print one date.
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
 * The newest SUCCEEDED `pull_gsc_data` job — WITHOUT its payload.
 *
 * A DIFFERENT READ from `latestSucceeded`, not a call of it, and the reason is a measured waste:
 * the card printed one date out of this row, and the projection that fetched it asked for `result`
 * — which for a pull is two windows of Search Console rows, up to 15,000 each. Megabytes over the
 * wire, per project, per render, for a date and now a range.
 *
 * SUB-FIELDS, NOT `result`. `days` and the current window's two dates are scalars; the two
 * `capped` flags are booleans. All five are O(1) in the pull's size, so this row stays the same
 * size whether the pull carried ten rows or the cap. `PullRow` has no field the whole payload
 * could land in, and `pull-query.test.ts` pins the projection itself — a type cannot see what a
 * query asks PostgREST for.
 *
 * `->>` for the dates (text out of jsonb) and `->` for `days` and the flags, so a number arrives
 * as a number and a boolean as a boolean rather than as the strings `"90"` and `"true"`, which the
 * `unknown` guards in card.ts would then reject and silently drop the line.
 *
 * Caller's authenticated client, explicit user_id filter beside RLS `jobs_select_own` (NEVER #4).
 */
async function latestPullSummary(
  supabase: Supabase,
  userId: string,
  projectId: string,
): Promise<PullRow | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "created_at, window_days:result->days, window_start:result->current->>start_date, " +
        "window_end:result->current->>end_date, window_capped:result->current->capped, " +
        "previous_capped:result->previous->capped",
    )
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("tool", "pull_gsc_data")
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`jobs lookup (pull_gsc_data) failed: ${error.message}`);
  }
  return (data as unknown as PullRow | null) ?? null;
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

/**
 * The project's LAST run of one audit (migration 0024) — the row behind one audit line.
 *
 * PER PROJECT AND PER TOOL with `.limit(1)`, for the reason `latestSucceeded` gives above and one
 * more of its own: "the newest run of each tool" has no single-query form in PostgREST, and the
 * alternative — fetching a project's whole audit history and keeping the newest of each in memory
 * — grows without bound for a tenant who audits weekly. Three indexed limit-1 reads answer
 * exactly what the card shows. Migration 0024's (user_id, project_id, created_at desc) index is
 * this shape, with `tool` as a cheap residual filter.
 *
 * SUB-FIELDS, NOT `report`. The report is the rule engine's whole structure and two of its fields
 * grow with the crawl (the per-page finding list, the URLs with no structured data), so the
 * projection names the individual numbers the lines print — each O(1) in crawl size — and the
 * whole jsonb is never downloaded. `AuditRunRow` has no `report` field to put one in.
 *
 * Caller's authenticated client, explicit user_id filter beside RLS `audit_runs_select_own`
 * (constitution NEVER #4).
 */
async function latestAuditRun(
  supabase: Supabase,
  userId: string,
  projectId: string,
  tool: string,
): Promise<AuditRunRow | null> {
  const { data, error } = await supabase
    .from("audit_runs")
    .select(
      "tool, created_at, page_count:report->pageCount, finding_counts:report->counts, " +
        "status:report->status, pages_with_schema:report->pagesWithSchema",
    )
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("tool", tool)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`audit_runs lookup (${tool}) failed: ${error.message}`);
  }
  return (data as unknown as AuditRunRow | null) ?? null;
}

/** The newest run of each audit for one project — one line's worth of data per tool. */
async function latestAuditRuns(
  supabase: Supabase,
  userId: string,
  projectId: string,
): Promise<AuditRunRow[]> {
  const runs = await Promise.all(
    AUDIT_TOOLS.map((tool) => latestAuditRun(supabase, userId, projectId, tool)),
  );
  return runs.filter((run): run is AuditRunRow => run !== null);
}

/**
 * The project's LAST run of one Search Console analysis (migration 0025) — the row behind one
 * insight line. The twin of `latestAuditRun`, one table over, and the same reasoning applies whole:
 * "the newest run of each tool" has no single-query form in PostgREST, and fetching a project's
 * whole analysis history to keep the newest of each in memory grows without bound. 0025's
 * (user_id, project_id, created_at desc) index is this shape, with `tool` as a residual filter.
 *
 * SUB-FIELDS, NOT `report`. The report carries the engine's whole finding list — every quick win,
 * every cannibalized group with its competing pages — and the two fields the lines print sit at
 * its top level precisely so this read is O(1) in the size of the pull. `DiscoveryRunRow` has no
 * `report` field to put one in.
 *
 * Caller's authenticated client, explicit user_id filter beside RLS
 * `gsc_discovery_runs_select_own` (constitution NEVER #4).
 */
async function latestDiscoveryRun(
  supabase: Supabase,
  userId: string,
  projectId: string,
  tool: string,
): Promise<DiscoveryRunRow | null> {
  const { data, error } = await supabase
    .from("gsc_discovery_runs")
    .select("tool, created_at, total:report->total, top:report->top")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("tool", tool)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`gsc_discovery_runs lookup (${tool}) failed: ${error.message}`);
  }
  return (data as unknown as DiscoveryRunRow | null) ?? null;
}

/** The newest run of each analysis for one project — one line's worth of data per tool. */
async function latestDiscoveryRuns(
  supabase: Supabase,
  userId: string,
  projectId: string,
): Promise<DiscoveryRunRow[]> {
  const runs = await Promise.all(
    DISCOVERY_TOOLS.map((tool) => latestDiscoveryRun(supabase, userId, projectId, tool)),
  );
  return runs.filter((run): run is DiscoveryRunRow => run !== null);
}

/**
 * The project's LAST run of one DFS domain lookup (migration 0027) — the row behind one lookup
 * line. The fourth of these reads, and the same reasoning applies whole: "the newest run of each
 * tool" has no single-query form in PostgREST, and fetching a project's whole lookup history to
 * keep the newest of each in memory grows without bound. 0027's
 * (user_id, project_id, created_at desc) index is exactly this shape, with `tool` as a residual
 * filter — the migration header says so in its own words.
 *
 * `.eq("project_id", projectId)` IS THE PRODUCT DECISION, not boilerplate. 0027's `project_id` is
 * NULLABLE and most rows will have it null: all three tools accept EITHER a bare `target` — any
 * public domain, typically a COMPETITOR's — OR a project_id, and the bare-target call is the
 * commonest paid call these tools serve. Those rows are lookups of a DIFFERENT domain, and a card
 * that showed them would attribute a rival's ranked-keyword count to the tenant's own site. The
 * equality filter never matches a null, which is precisely the behaviour wanted here; the card's
 * empty line says "not run FOR THIS DOMAIN" rather than "not run" for the same reason
 * (`lookups.ts`).
 *
 * SUB-FIELDS, NOT `report`. This table's report is the LARGEST in the family — up to MAX_RUN_ROWS
 * = 50 capped vendor rows plus a metrics block, where the siblings store measurements this system
 * had already capped on the way in. The two fields the lines print sit at its top level precisely
 * so this read is O(1) in the size of the lookup. `DomainLookupRunRow` has no `report` field to
 * put one in.
 *
 * Caller's authenticated client, explicit user_id filter beside RLS
 * `domain_lookup_runs_select_own` (constitution NEVER #4). On this table the user_id filter is
 * more than defence in depth: a project_id-null row has no parent in `public` at all, so `user_id`
 * is the ONLY tenant guarantee it carries (0027's composite-FK note says so out loud).
 */
async function latestDomainLookupRun(
  supabase: Supabase,
  userId: string,
  projectId: string,
  tool: string,
): Promise<DomainLookupRunRow | null> {
  const { data, error } = await supabase
    .from("domain_lookup_runs")
    .select("tool, created_at, total:report->total, top:report->top")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("tool", tool)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`domain_lookup_runs lookup (${tool}) failed: ${error.message}`);
  }
  return (data as unknown as DomainLookupRunRow | null) ?? null;
}

/** The newest run of each domain lookup for one project — one line's worth of data per tool. */
async function latestDomainLookupRuns(
  supabase: Supabase,
  userId: string,
  projectId: string,
): Promise<DomainLookupRunRow[]> {
  const runs = await Promise.all(
    DOMAIN_LOOKUP_TOOLS.map((tool) => latestDomainLookupRun(supabase, userId, projectId, tool)),
  );
  return runs.filter((run): run is DomainLookupRunRow => run !== null);
}

/** Gather every row one card is built from. */
async function cardInputFor(
  supabase: Supabase,
  userId: string,
  project: ProjectRow,
  connections: Map<string, ConnectionRow>,
  health: Map<string, GscTokenStatus>,
): Promise<ProjectCardInput> {
  const [crawl, pull, crawlHistory, auditRuns, discoveryRuns, lookupRuns] = await Promise.all([
    latestSucceeded(supabase, userId, project.id, "crawl_site"),
    latestPullSummary(supabase, userId, project.id),
    recentCrawlRuns(supabase, userId, project.id),
    latestAuditRuns(supabase, userId, project.id),
    latestDiscoveryRuns(supabase, userId, project.id),
    latestDomainLookupRuns(supabase, userId, project.id),
  ]);
  const connection = connections.get(project.id) ?? null;
  return {
    project,
    crawl,
    pull,
    crawlHistory,
    auditRuns,
    discoveryRuns,
    lookupRuns,
    connection,
    tokenStatus: tokenStatusFor(connection, health),
  };
}

/**
 * Every card this tenant has, oldest first — or just ONE of them when `onlyProjectId` names it.
 *
 * EXPORTED so `/app/projects/[id]` builds its card through the SAME reads, filters and card
 * assembly as the list. The detail route owning a second copy would mean a second place for the
 * tenant filters to be forgotten, and two surfaces that could disagree about one project.
 *
 * It stays IN THIS FILE rather than moving to lib/: six source-pin specs read `page.tsx` by path
 * and match the shortest distinctive fragment of a reader's body (signed lesson 11). Moving those
 * bodies would leave every one of them matching nothing — and a pin that matches nothing passes
 * vacuously, which is the exact failure query-pins.ts exists to design out. So the composition is
 * what became shared; the reads did not move an inch.
 */
export async function loadProjectCards(
  supabase: Supabase,
  userId: string,
  onlyProjectId?: string,
): Promise<ProjectCard[]> {
  const [projects, connections, health] = await Promise.all([
    listActiveProjects(supabase, userId),
    readConnections(supabase, userId),
    readAccountHealth(supabase, userId),
  ]);
  // Filtering HERE, after a tenant-scoped read, rather than by adding `.eq("id", …)` to that read:
  // an id that is not this tenant's simply matches nothing, so an unknown project and another
  // tenant's project are indistinguishable to the caller — the same property the by-id MCP tools
  // hold (project-target.ts).
  const wanted =
    onlyProjectId === undefined
      ? projects
      : projects.filter((project) => project.id === onlyProjectId);
  const inputs = await Promise.all(
    wanted.map((project) => cardInputFor(supabase, userId, project, connections, health)),
  );
  return buildProjectCards(inputs, new Date());
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

  const cards = await loadProjectCards(supabase, user.id);

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
