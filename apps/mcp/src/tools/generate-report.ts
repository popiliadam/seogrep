import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { z } from "zod";
import { base58Encode } from "@pseo/core";
import { forUser, getServiceClient, type ServiceClient } from "../db.ts";
import { requireWebBaseUrl } from "../env.ts";
import { loadLatestCrawl, type LoadCrawlFn } from "../audit/index.ts";
import { loadLatestPull, type LoadPullFn } from "../gsc-data/index.ts";
import { buildReportModel, renderReportHtml, resolveReportTitle } from "../report/index.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";

/**
 * generate_report — 15 credits, SYNC (surface charge). Turns a project's latest crawl and/or
 * Search Console pull into a self-contained, shareable HTML report and returns a public link
 * (design D16). It runs NO engine: the crawl + pull are read through the SAME
 * getLatestSucceededResult port the audits/discovery tools use (via their loaders), and the
 * report is a LIGHT roll-up (see report/model.ts) that points the reader at the deep tools.
 *
 * Money-safety (identical to the audits/discovery tools): the reserve opens BEFORE the handler
 * runs and withCredits COMMITS a handler that RETURNS. So every "nothing to report" path THROWS
 * — a missing web base URL, an unknown project, no crawl AND no pull, or a failed insert all
 * RELEASE the reserve (net 0) and, because the DB insert is the LAST step before the return, a
 * released run never leaves a persisted report behind.
 *
 * The public_slug is 8 bytes of CSPRNG entropy (~64 bits) base58-encoded (unprefixed — the
 * `/r/` lives in the route). The reports table has a UNIQUE constraint on public_slug; the
 * astronomically-unlikely collision is retried ONCE with fresh entropy before failing.
 */

/** Bytes of entropy behind a public slug. 8 -> ~64 bits, base58 ~11 chars — unguessable. */
const SLUG_ENTROPY_BYTES = 8;
/** Postgres unique_violation SQLSTATE — the only insert error worth retrying with a new slug. */
const PG_UNIQUE_VIOLATION = "23505";
/** The insert is attempted at most twice: the first slug, then one fresh-entropy retry. */
const MAX_SLUG_ATTEMPTS = 2;

export interface GenerateReportDeps {
  /** Crawl loader (default: the real tenant-scoped loadLatestCrawl). Injected in tests. */
  readonly loadCrawl?: LoadCrawlFn;
  /** Pull loader (default: the real tenant-scoped loadLatestPull). Injected in tests. */
  readonly loadPull?: LoadPullFn;
  /** CSPRNG for the public slug (default: node:crypto). Injected to force a collision in tests. */
  readonly randomBytes?: (size: number) => Uint8Array;
  /** Clock for the generated-at timestamp (default: real). Injected for deterministic tests. */
  readonly now?: () => Date;
  /** Web base URL resolver (default: requireWebBaseUrl over the real WEB_BASE_URL env). */
  readonly resolveWebBaseUrl?: () => string;
}

const inputSchema = z.object({
  project_id: z
    .uuid()
    .describe("The project to report on (from setup_project / list_projects)."),
  title: z
    .string()
    .max(120)
    .optional()
    .describe("Optional report title. Defaults to 'SEO Report — <domain> — <date>'."),
});

/**
 * Insert the rendered report, minting a fresh unguessable slug per attempt. Returns the new
 * report id + its slug. A UNIQUE collision on public_slug is retried once; any other error (or a
 * second collision) throws — the caller's withCredits then releases the reserve (no charge).
 */
async function insertReport(
  client: ServiceClient,
  row: { userId: string; title: string; html: string },
  randomBytes: (size: number) => Uint8Array,
): Promise<{ reportId: string; slug: string }> {
  let lastError = "no row returned";
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = base58Encode(randomBytes(SLUG_ENTROPY_BYTES));
    const { data, error } = await client
      .from("reports")
      .insert({
        user_id: row.userId,
        tool: "generate_report",
        title: row.title,
        html: row.html,
        public_slug: slug,
      })
      .select("id")
      .single();
    if (!error && data) return { reportId: data.id, slug };
    lastError = error?.message ?? "no row returned";
    // Only a slug collision is worth retrying; anything else is a real failure.
    if (error?.code !== PG_UNIQUE_VIOLATION) break;
  }
  throw new Error(`generate_report: reports insert failed: ${lastError}`);
}

export function makeGenerateReportTool(deps: GenerateReportDeps = {}): RegisteredTool {
  const loadCrawl = deps.loadCrawl ?? loadLatestCrawl;
  const loadPull = deps.loadPull ?? loadLatestPull;
  const randomBytes = deps.randomBytes ?? ((size: number) => cryptoRandomBytes(size));
  const now = deps.now ?? (() => new Date());
  const resolveWebBaseUrl = deps.resolveWebBaseUrl ?? requireWebBaseUrl;

  return defineTool({
    name: "generate_report",
    description:
      "Generate a shareable HTML SEO report for a project from its latest crawl and Search " +
      "Console data, and get a public link to share with clients or teammates. Run crawl_site " +
      "and/or pull_gsc_data first. Costs 15 credits.",
    inputSchema,
    // charge defaults to "surface": reserve -> handler -> commit / release.
    handler: async (ctx, { project_id, title }) => {
      // Fail-closed BEFORE any work so a deploy misconfig releases the reserve (no charge) and
      // writes no report row: a report is worthless without the public base URL for its link.
      const webBaseUrl = resolveWebBaseUrl();

      // Tenant-scoped ownership gate: an unknown project and another tenant's project are
      // indistinguishable here (read filtered to ctx.userId), so nothing leaks. THROW (release).
      const client = getServiceClient();
      const project = await forUser(client, ctx.userId).selectOwnById<{ domain: string }>(
        "projects",
        project_id,
        "domain",
      );
      if (!project) {
        throw new Error(`No project found with id ${project_id}. Create one with setup_project first.`);
      }

      // Read the latest crawl AND pull through the shared ports. Both may be absent; a not-ok
      // load is simply "no data of that kind", not a hard error.
      const [crawlLoad, pullLoad] = await Promise.all([
        loadCrawl(ctx.userId, project_id),
        loadPull(ctx.userId, project_id),
      ]);
      const crawl = crawlLoad.ok ? crawlLoad.crawl : null;
      const pull = pullLoad.ok ? pullLoad.pull : null;
      if (!crawl && !pull) {
        // Nothing to report on -> THROW so withCredits RELEASES the reserve (no charge). The
        // registry turns this into an actionable isError result for the client.
        throw new Error(
          "No crawl or Search Console data found for this project. " +
            "Run crawl_site or pull_gsc_data first.",
        );
      }

      const generatedAt = now().toISOString();
      const reportTitle = resolveReportTitle(title, project.domain, generatedAt);
      const html = renderReportHtml(
        buildReportModel({ domain: project.domain, title: reportTitle, generatedAt, crawl, pull }),
      );

      // LAST step before the return: on success withCredits commits the 15-credit spend; any
      // throw above released it, so a charge always corresponds to a persisted report.
      const { reportId, slug } = await insertReport(
        client,
        { userId: ctx.userId, title: reportTitle, html },
        randomBytes,
      );
      const publicUrl = `${webBaseUrl}/r/${slug}`;
      return textResult(
        `Report generated: "${reportTitle}"\n` +
          `Public link (anyone with the URL can view it): ${publicUrl}\n` +
          `report_id: ${reportId}`,
      );
    },
  });
}

export const generateReportTool = makeGenerateReportTool();
