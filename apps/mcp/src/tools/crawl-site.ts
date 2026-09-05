import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { withNoChargeNote } from "../credits/free-refusal.ts";
import {
  DEFAULT_TIME_BUDGET_MS,
  estimateSiteSize,
  type SiteSizeEstimate,
} from "../crawler/crawl.ts";
import { getServiceClient } from "../db.ts";
import { enqueueJob, findActiveJobForProject, type ActiveJob } from "../queue/boss.ts";
import {
  fetchRankingSeeds,
  SEED_CHARGE_CREDITS,
  type RankingSeedFetcher,
  type RankingSeedOutcome,
} from "./crawl-seeds.ts";
import {
  ARCHIVED_PROJECT_MESSAGE,
  loadOwnProject,
  projectNotFoundMessage,
  type ProjectRef,
} from "./project-target.ts";
import {
  CONFIRMATION_THRESHOLD_CREDITS,
  defineTool,
  errorResult,
  evaluateConfirmation,
  readConfirmFlag,
  textResult,
  type RegisteredTool,
  type ToolResult,
} from "./registry.ts";

/**
 * crawl_site — the first credit-spending tool, and an ASYNC one: it enqueues a crawl
 * job and returns a job_id immediately (the MCP call never leans on the crawl's wall
 * clock), then get_job_status polls it to completion.
 *
 * It is a defineTool with charge mode "worker": the handler validates, enqueues, and
 * returns an ESTIMATE — the guard does NOT wrap it, so the surface NEVER touches the
 * ledger. The one real 20-credit reserve/commit chain belongs to the WORKER, settled
 * against the real jobs.id (queue/worker.ts + credits/guard.ts). Charging at the surface
 * too would double-spend. Schema validation still runs BEFORE the enqueue (defineTool
 * parses first), so a malformed call opens no job and reaches no credit machinery.
 *
 * Because the handler runs DIRECTLY (no reserve), a FREE pre-discovery step runs inside it
 * before the enqueue: estimateSiteSize sizes the site (guarded, degrading, no ledger). If a
 * whole-site crawl PROJECTS to more than the D17 threshold, the tool returns an honest
 * confirmation (see confirmationResult) instead of enqueuing — so a large site can never
 * silently run up cost. The projection is informational and never the amount charged: any
 * single crawl is and stays a flat TOOL_COSTS.crawl_site.
 */

/**
 * The crawl_site hard page cap. max_urls is bounded 1..PAGE_CAP, and the full-site projection
 * reasons in PAGE_CAP-sized runs. A single source so the schema bound and the projection cannot
 * drift apart.
 */
const PAGE_CAP = 100;

/**
 * The crawl's OTHER ceiling, in whole seconds, derived from the crawler's own wall-clock budget.
 * Both bounds are quoted to the caller because — measured live 2026-09-02 — this is the one that
 * usually binds first: a whole-site run returned 51 pages of a possible 100, "the crawl stopped on
 * TIME". Naming only the page cap sets an expectation the same flat price often does not meet.
 */
const TIME_BUDGET_SECONDS = Math.round(DEFAULT_TIME_BUDGET_MS / 1000);

/** The enqueue port (default: the real enqueueJob) — injected so the surface is testable without pg-boss. */
export type EnqueueFn = (
  ctx: { userId: string },
  input: { tool: string; projectId?: string; payload?: Record<string, unknown> },
) => Promise<{ jobId: string }>;

/**
 * The pre-discovery port (default: the real estimateSiteSize) — injected so the surface's
 * projection/confirmation logic is testable without any network.
 */
export type EstimateFn = (
  origin: string,
  opts: { includePaths?: string[] },
) => Promise<SiteSizeEstimate>;

/**
 * The tenant-owned project resolver (default: the tenant-scoped DB read). Injected so the
 * pre-discovery/confirmation branches are exercisable in the fast (DB-less) lane; production
 * and the DB specs use the default, which is the real ownership gate.
 */
export type ProjectResolver = (ctx: AuthContext, projectId: string) => Promise<ProjectRef | null>;

/**
 * The in-flight-crawl port (default: the tenant-scoped jobs read). Answers "does this caller
 * already have a crawl_site job queued or running for this project?" — see the guard in the
 * handler. Injected so the fast lane can prove the guard's decisions with no database.
 */
export type ActiveCrawlFinder = (
  ctx: AuthContext,
  projectId: string,
) => Promise<ActiveJob | null>;

export interface CrawlSiteDeps {
  readonly enqueue?: EnqueueFn;
  readonly estimate?: EstimateFn;
  readonly resolveProject?: ProjectResolver;
  readonly findActiveCrawl?: ActiveCrawlFinder;
  /**
   * The OPT-IN ranking-page seeding step (default: the real, env-resolved, credit-charging one).
   * Injected so the fast lane can prove the surface's seeding behavior — including that it is
   * NEVER reached without the flag — with no vendor, no ledger and no database.
   */
  readonly fetchSeeds?: RankingSeedFetcher;
}

/**
 * Input contract. project_id + max_urls + include_paths are exposed — the crawler's test-timing
 * knobs (pageTimeoutMs / timeBudgetMs / crawlDelayCapMs on CrawlOptions) are NEVER surfaced to
 * tenants. max_urls is bounded 1..PAGE_CAP and defaults to PAGE_CAP. The surface is fully
 * snake_case; the crawler module's internal CrawlOptions stays camelCase and is mapped in the
 * queue handler. `confirm` is a RESERVED registry param read from the raw input — deliberately
 * NOT in this schema. It IS advertised in this tool's tools/list entry, injected there by
 * defineTool because the spec declares `confirmsInHandler` (the large-site prompt below); no zod
 * schema anywhere declares it.
 */
const inputSchema = z.object({
  project_id: z.uuid().describe("The project_id from setup_project / list_projects."),
  max_urls: z
    .number()
    .int()
    .min(1)
    .max(PAGE_CAP)
    .default(PAGE_CAP)
    .describe(
      `Maximum pages to crawl (1–100, default 100). A crawl also stops at a ` +
        `${TIME_BUDGET_SECONDS}-second time budget, whichever comes first — on a slow or large ` +
        `site that budget usually binds before the page cap does, so fewer pages than max_urls ` +
        `are crawled for the same price. Narrow the crawl with include_paths to cover a section ` +
        `fully.`,
    ),
  include_paths: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Limit the crawl to URL paths starting with these prefixes, e.g. ["/blog"]. Omit to crawl the whole site (up to the page cap).',
    ),
  seed_from_ranking_pages: z
    .boolean()
    .default(false)
    .describe(
      "OPT-IN, off by default: start the crawl from the pages DataForSEO reports as ranking for " +
        `this domain, so they are fetched before the ${PAGE_CAP}-page cap is reached. This is a ` +
        `paid DataForSEO lookup and is charged SEPARATELY at the my_pages price (${SEED_CHARGE_CREDITS} ` +
        `credits, its own ledger line); the crawl itself still costs ${TOOL_COSTS.crawl_site}. If the ` +
        "lookup returns nothing this crawl can use, or cannot run at all, the crawl runs without " +
        "the seeds and the seeding is not charged. The lookup uses the same defaults as my_pages " +
        "(United States, English) — for another market, run my_pages yourself.",
    ),
});

/**
 * The tenant-scoped ownership read: a missing project and another tenant's both resolve to null.
 * It is the SHARED loadOwnProject rather than a second read of its own — a per-tool project read
 * is a per-tool place for the archive check to be forgotten.
 */
const defaultResolveProject: ProjectResolver = (ctx, projectId) =>
  loadOwnProject(ctx.userId, projectId);

/**
 * The tenant-scoped in-flight read. It is deliberately NOT wrapped in a try/catch: it runs on the
 * same service client that just answered the ownership read a line earlier, so a throw here means
 * the database is unreachable — in which case the enqueue this guard protects would fail anyway,
 * and failing before a job exists is the cheaper of the two failures.
 */
const defaultFindActiveCrawl: ActiveCrawlFinder = (ctx, projectId) =>
  findActiveJobForProject(getServiceClient(), {
    userId: ctx.userId,
    projectId,
    tool: "crawl_site",
  });

/**
 * A full-crawl PROJECTION at the FROZEN rate — it invents no price. `credits` is simply the
 * number of PAGE_CAP-sized runs the whole site would take times the existing per-run cost
 * (TOOL_COSTS.crawl_site). null when pre-discovery could not size the site.
 */
interface FullCrawlProjection {
  /**
   * A LOWER BOUND on the site's page count — never an estimate of it. Both discovery branches
   * are floors by construction: the sitemap count is bounded (5 000 locs, 5 child sitemaps, an
   * 8-second total budget), and the homepage branch counts only the links ON the homepage.
   * MEASURED 2026-08-25: pre-discovery said 28 and the crawl's own queue found at least 222 —
   * the number the customer approved 20 credits against was ~8x low, and was printed with a
   * "~", which reads as "approximately", i.e. as likely-high as likely-low. It never is.
   */
  readonly pages: number;
  readonly runs: number;
  readonly credits: number;
  /** Where the floor came from — the sitemap, or homepage links. Changes what we can claim. */
  readonly source: SiteSizeEstimate["source"];
}

/**
 * Run the FREE pre-discovery and turn a known page count into a full-crawl projection. Purely
 * best-effort: a null estimate OR a throwing estimator both yield null so the crawl is never
 * blocked. Reads no ledger (the worker-mode handler holds no reserve here).
 */
async function projectFullCrawl(
  estimate: EstimateFn,
  domain: string,
  scopedPaths: string[] | undefined,
): Promise<FullCrawlProjection | null> {
  let sized: SiteSizeEstimate;
  try {
    sized = await estimate(`https://${domain}`, { includePaths: scopedPaths });
  } catch {
    return null; // pre-discovery is best-effort — a throwing estimator must never block a crawl
  }
  const pages = sized.pages;
  if (pages === null || !Number.isFinite(pages) || pages <= 0) return null;
  const runs = Math.ceil(pages / PAGE_CAP);
  return { pages, runs, credits: runs * TOOL_COSTS.crawl_site, source: sized.source };
}

/**
 * How the floor was reached, in one clause the customer can weigh. The homepage branch gets the
 * stronger warning on purpose: it is the branch that measured 28 against a site of 222+, and it
 * fires exactly when there is no sitemap to read — the case where a floor is furthest from the
 * truth.
 */
function sourceClause(source: SiteSizeEstimate["source"]): string {
  if (source === "sitemap") return "counted from your sitemap";
  if (source === "homepage")
    return "counted from links on the homepage only (no usable sitemap was found), so the real site is very likely larger";
  return "from a partial discovery";
}

/** Group an integer with commas (12345 -> "12,345"). Pure, locale-independent (no ICU needed). */
function groupThousands(n: number): string {
  return Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The HONEST large-site confirmation. The ONLY charge is THIS single run's flat cost
 * (TOOL_COSTS.crawl_site); the full-site figure is a clearly-labeled PROJECTION at the current
 * rate, NEVER a charge. The structured fields keep the two apart (`run_cost_credits` vs.
 * `full_site_projection`) so a client cannot conflate them, and the prose says so in words. No
 * credits are charged and NO job is enqueued when this is returned.
 */
function confirmationResult(
  domain: string,
  projection: FullCrawlProjection,
  scopedPaths: string[] | undefined,
): ToolResult {
  const runCost = TOOL_COSTS.crawl_site;
  const pagesText = groupThousands(projection.pages);
  const projCreditsText = groupThousands(projection.credits);
  const runsText = groupThousands(projection.runs);
  const scopeClause = scopedPaths ? " in the paths you scoped to" : "";
  const message =
    `Your site looks large — at least ${pagesText} pages found${scopeClause} ` +
    `(a lower bound, ${sourceClause(projection.source)}). ` +
    `This one crawl of ${domain} costs a flat ${runCost} credits (one crawl covers up to ${PAGE_CAP} pages) — ` +
    `that ${runCost} credits is the only charge. ` +
    `Crawling the WHOLE site at the current rate (${runCost} credits per ${PAGE_CAP} pages) would take about ` +
    `${runsText} separate crawls and roughly ${projCreditsText} credits in total — that ${projCreditsText} is an ` +
    `informational projection, NOT a charge, and no credits have been charged. ` +
    `To crawl just part of the site, re-run with include_paths (for example ["/blog"]) to target a section ` +
    `and stay within the ${PAGE_CAP}-page cap. ` +
    `To queue this single ${runCost}-credit crawl now, re-run with "confirm": true.`;
  return textResult(
    JSON.stringify({
      requires_confirmation: true,
      run_cost_credits: runCost,
      pages_per_crawl: PAGE_CAP,
      // The key is unchanged (clients read it), but the two fields beside it say what it IS:
      // a floor from a bounded, best-effort discovery — never a two-sided estimate.
      site_pages_estimate: projection.pages,
      site_pages_is_lower_bound: true,
      site_pages_source: projection.source,
      full_site_projection: {
        credits: projection.credits,
        runs: projection.runs,
        note: `Informational only — NOT charged. What crawling every page would cost at the current ${runCost}-credits-per-${PAGE_CAP}-pages rate.`,
      },
      message,
    }),
  );
}

/**
 * The answer to "crawl this project" when this project is ALREADY being crawled: the job that is
 * already doing it, in the same machine-readable shape a fresh queue returns (`job_id: … · status:
 * …`), so a client that parsed one can parse the other.
 *
 * It is NOT an error. The caller asked for a crawl of this site and there is one; handing back its
 * id is the answer to the question they asked. What would be wrong is doing it silently a second
 * time — the worker binds a fresh {@link TOOL_COSTS.crawl_site}-credit reserve per job, so a
 * duplicate is a duplicate CHARGE for the same pages.
 *
 * "IN FLIGHT", never "running" (referee, 2026-09-02). The lead sentence used to say "is already
 * running" and the clause right after it then printed `status: queued` — one line contradicting
 * itself, on exactly the state B-2 already showed is the hard one to reason about. One phrase now
 * covers both non-terminal statuses, and the precise one is reported ONCE, in the field built to
 * carry it.
 */
function alreadyInFlightResult(domain: string, active: ActiveJob): ToolResult {
  return textResult(
    `A crawl of ${domain} is already in flight — poll it with get_job_status ` +
      `{ "job_id": "${active.jobId}" }. job_id: ${active.jobId} · status: ${active.status}. ` +
      `No second crawl was queued and you were not charged: a second crawl of the same project ` +
      `costs another ${TOOL_COSTS.crawl_site} credits to fetch the same pages. ` +
      `Wait for this one to finish, then re-run — with include_paths if you want a different ` +
      `section of the site.`,
  );
}

/** The queued-crawl message: the unchanged core plus an honest one-liner when the site was sized. */
function queuedResult(
  domain: string,
  jobId: string,
  projection: FullCrawlProjection | null,
  maxUrls: number,
  seeding: RankingSeedOutcome | null,
): ToolResult {
  // estimated_credits reads from the human-approved price table — never a literal. It is the
  // CRAWL's cost and stays that: any seeding charge is a separate line under its own tool name,
  // reported in its own sentence rather than folded into this number.
  // "queued OR ALREADY RUNNING", and the second half is the honest one (B-2). MEASURED LIVE
  // 2026-09-02: the row is INSERTed `queued` and a worker claimed it 562 ms later, while this call
  // returned the job_id after 851 ms — 9 032 ms on the unconfirmed path. By the time the caller
  // holds the id, the job is already `running`, so a flat "status: queued" promised a state
  // get_job_status would then contradict. `queued` is still what the row IS at insert; what was
  // wrong was implying the caller would ever see it.
  const base =
    `Crawl queued for ${domain}. job_id: ${jobId} · status: queued or already running · ` +
    `estimated_credits: ${TOOL_COSTS.crawl_site}. ` +
    `Track it with get_job_status { "job_id": "${jobId}" }.`;
  // The seeding sentence is APPENDED, never merged: it states its own fee outcome (including
  // "you were not charged" on every branch that spent nothing), and how many of the vendor's
  // pages this crawl could and could not use.
  const seedNote = seeding === null ? "" : ` ${seeding.note}`;
  if (!projection) return textResult(`${base}${seedNote}`);
  // "at least N", never "~N". The number is a floor (see FullCrawlProjection.pages), and "~"
  // told the customer it could fall either way while they approved the spend.
  return textResult(
    `${base} At least ${groupThousands(projection.pages)} pages discovered ` +
      `(${sourceClause(projection.source)}); this crawl covers up to ` +
      `${maxUrls} of them (${TOOL_COSTS.crawl_site} credits).${seedNote}`,
  );
}

/**
 * Build the crawl_site tool. The ports default to the real enqueueJob / estimateSiteSize /
 * tenant-scoped project read; tests inject fakes to assert the surface's behavior (enqueue,
 * projection, confirmation) without pg-boss, network, or a DB. The MCP inputSchema comes from
 * defineTool's single toInputJsonSchema deriver — this file carries no copy.
 */
export function makeCrawlSiteTool(deps: CrawlSiteDeps = {}): RegisteredTool {
  const enqueue = deps.enqueue ?? enqueueJob;
  const estimate = deps.estimate ?? estimateSiteSize;
  const resolveProject = deps.resolveProject ?? defaultResolveProject;
  const findActiveCrawl = deps.findActiveCrawl ?? defaultFindActiveCrawl;
  const fetchSeeds = deps.fetchSeeds ?? ((request) => fetchRankingSeeds(request));
  return defineTool({
    name: "crawl_site",
    description:
      "Crawl a project's website (async). Returns a job_id immediately; poll it with " +
      "get_job_status. Costs 20 credits, charged when the crawl runs.",
    inputSchema,
    charge: "worker",
    // The large-site prompt below is this handler's own, not the registry's D17 gate (a flat 20
    // credits can never trip that threshold). Declaring it is what puts `confirm` in the
    // advertised schema, so the "Re-run with confirm: true" the prompt asks for is a call the
    // schema permits.
    confirmsInHandler: true,
    handler: async (
      ctx: AuthContext,
      { project_id, max_urls, include_paths, seed_from_ranking_pages },
      rawInput,
    ): Promise<ToolResult> => {
      // Tenant-scoped project fetch is the ownership gate: fail fast with a clear error rather
      // than enqueue a job that could never run. Missing or another tenant's project both -> null.
      const project = await resolveProject(ctx, project_id);
      if (!project) {
        // Free, and it says so: both refusals below return BEFORE the enqueue, so no jobs row
        // exists and the worker's 20-credit reserve is never opened. The registry's refundAssurance
        // cannot make that promise for a charge:"worker" tool — it cannot see whether a job was
        // created — but this branch can, because it is the code that decided not to create one.
        //
        // THE SHARED SENTENCE (S6/GR-8 — the second of the two tools still writing their own;
        // connect_gsc closed the first in #203). withNoChargeNote is KEPT rather than dropped: it
        // is the one append rule for this family, and it is a no-op on a message that already
        // states no charge, which projectNotFoundMessage does.
        return errorResult(withNoChargeNote(projectNotFoundMessage(project_id)));
      }
      // AFTER the ownership gate, never before: an archived project of ANOTHER tenant must stay
      // indistinguishable from one that does not exist (see project-target.ts). Refusing here —
      // before enqueue — is also what makes it free: crawl_site's only charge belongs to the
      // worker, and no job is created.
      if (project.archivedAt !== null) {
        return errorResult(withNoChargeNote(ARCHIVED_PROJECT_MESSAGE));
      }

      // ONE CRAWL PER PROJECT AT A TIME (B-1), and this is the FIRST thing asked after ownership.
      // Everything below it either costs money (the ranking-seed lookup is a separate charge) or
      // costs the caller eight silent seconds (pre-discovery), and the enqueue at the bottom is
      // what the worker's second 20-credit reserve would hang off. Placing the check here — behind
      // the ownership and archive gates, ahead of all three — is what makes the duplicate free.
      const active = await findActiveCrawl(ctx, project_id);
      if (active) {
        return alreadyInFlightResult(project.domain, active);
      }

      // Empty/absent include_paths = whole-site (no scope); only a non-empty array scopes.
      const scopedPaths =
        Array.isArray(include_paths) && include_paths.length > 0 ? include_paths : undefined;

      // `confirm` is a reserved raw-input param. Read it BEFORE pre-discovery so a confirmed call
      // SKIPS the free size check entirely — the caller has already seen the projection and opted
      // in; re-sizing the site would only add latency. include_paths still flows to the enqueue
      // below (it is independent of the estimate).
      // An UNCONFIRMED call still pays for pre-discovery on this request path, so that cost is
      // bounded IN TOTAL by crawler PRE_DISCOVERY_BUDGET_MS (M-19) — not merely per fetch, which
      // multiplied over the hop sequence into ~35 s of a caller waiting without a job id.
      const confirmed = readConfirmFlag(rawInput);

      // FREE pre-discovery (worker-mode handler runs directly — no reserve, no ledger touch).
      // Skipped once confirmed; degrades to null and never blocks the crawl.
      const projection = confirmed
        ? null
        : await projectFullCrawl(estimate, project.domain, scopedPaths);

      // Large-site confirmation: fire on the PROJECTION (not the flat 20), reusing the D17
      // primitive with the DYNAMIC estimate. Over the threshold + unconfirmed -> the HONEST
      // confirmation, with NO enqueue and NO charge. The registry's own auto-gate keys off the
      // flat TOOL_COSTS.crawl_site (20 < 200) so it never fires here; this is crawl_site's own
      // dynamic gate layered on top.
      if (projection && projection.credits > CONFIRMATION_THRESHOLD_CREDITS) {
        const decision = evaluateConfirmation(projection.credits, confirmed);
        if (decision.requiresConfirmation) {
          return confirmationResult(project.domain, projection, scopedPaths);
        }
      }

      // RANKING-PAGE SEEDING — after BOTH free gates and after the confirmation branch, never
      // before. A call that returns the confirmation above enqueues nothing, so it must also buy
      // nothing: seeding only ever happens on a request that is actually going to be queued.
      // It never throws (fetchRankingSeeds turns every failure into an outcome), so an optional
      // enrichment cannot take down a crawl the tenant asked for.
      const seeding = seed_from_ranking_pages
        ? await fetchSeeds({
            userId: ctx.userId,
            domain: project.domain,
            maxUrls: max_urls,
            includePaths: scopedPaths,
          })
        : null;
      // Only a NON-EMPTY seed list travels: an absent key keeps the payload byte-identical to a
      // crawl that never asked for seeding.
      const seedUrls = seeding && seeding.seeds.length > 0 ? [...seeding.seeds] : undefined;

      const { jobId } = await enqueue(
        { userId: ctx.userId },
        {
          tool: "crawl_site",
          projectId: project_id,
          payload: {
            max_urls,
            ...(scopedPaths ? { include_paths: scopedPaths } : {}),
            ...(seedUrls ? { seed_urls: seedUrls } : {}),
          },
        },
      );

      return queuedResult(project.domain, jobId, projection, max_urls, seeding);
    },
  });
}

/** The production crawl_site tool (real enqueue / estimate / project read). */
export const crawlSiteTool = makeCrawlSiteTool();
