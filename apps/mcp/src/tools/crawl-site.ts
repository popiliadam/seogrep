import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { withNoChargeNote } from "../credits/free-refusal.ts";
import { estimateSiteSize, type SiteSizeEstimate } from "../crawler/crawl.ts";
import { enqueueJob } from "../queue/boss.ts";
import {
  fetchRankingSeeds,
  SEED_CHARGE_CREDITS,
  type RankingSeedFetcher,
  type RankingSeedOutcome,
} from "./crawl-seeds.ts";
import {
  ARCHIVED_PROJECT_MESSAGE,
  loadOwnProject,
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

export interface CrawlSiteDeps {
  readonly enqueue?: EnqueueFn;
  readonly estimate?: EstimateFn;
  readonly resolveProject?: ProjectResolver;
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
 * NOT in this schema (so it never appears in tools/list).
 */
const inputSchema = z.object({
  project_id: z.uuid().describe("The project_id from setup_project / list_projects."),
  max_urls: z
    .number()
    .int()
    .min(1)
    .max(PAGE_CAP)
    .default(PAGE_CAP)
    .describe("Maximum pages to crawl (1–100, default 100)."),
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
  const base =
    `Crawl queued for ${domain}. job_id: ${jobId} · status: queued · ` +
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
  const fetchSeeds = deps.fetchSeeds ?? ((request) => fetchRankingSeeds(request));
  return defineTool({
    name: "crawl_site",
    description:
      "Crawl a project's website (async). Returns a job_id immediately; poll it with " +
      "get_job_status. Costs 20 credits, charged when the crawl runs.",
    inputSchema,
    charge: "worker",
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
        return errorResult(
          withNoChargeNote(
            `No project found with id ${project_id}. Create one with setup_project first.`,
          ),
        );
      }
      // AFTER the ownership gate, never before: an archived project of ANOTHER tenant must stay
      // indistinguishable from one that does not exist (see project-target.ts). Refusing here —
      // before enqueue — is also what makes it free: crawl_site's only charge belongs to the
      // worker, and no job is created.
      if (project.archivedAt !== null) {
        return errorResult(withNoChargeNote(ARCHIVED_PROJECT_MESSAGE));
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
