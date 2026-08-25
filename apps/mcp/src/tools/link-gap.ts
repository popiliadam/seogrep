import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { withNoChargeNote } from "../credits/free-refusal.ts";
import {
  DEFAULT_LINK_GAP_LIMIT,
  LINK_GAP_MAX_LIMIT,
  LINK_GAP_RANK_MAX,
  resolveDefaultLinkGapPort,
  type LinkGapPort,
  type LinkGapResult,
  type LinkGapRow,
} from "../dfs/link-gap.ts";
import { normalizeDomain } from "./setup-project.ts";
import {
  loadOwnProject,
  projectIdField,
  resolveTarget,
  subjectLabel,
  targetField,
  type LoadProjectFn,
  type ProjectRef,
} from "./project-target.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * link_gap — the domains that link to a RIVAL and not to the caller's own site, from the
 * DataForSEO Backlinks domain_intersection endpoint (see dfs/link-gap.ts, which explains how the
 * gap is expressed and why exactly one rival is taken per call). Synchronous: it returns the
 * prospect list immediately (no background job). It takes EITHER a bare `target` (any public
 * domain) OR a `project_id`, whose stored domain becomes the target, plus one `competitor`.
 *
 * The sibling of keyword_gap: the same question — "what does my rival have that I do not?" — on
 * the LINK axis instead of the keyword one, and therefore the same credit path and the same two
 * hard product rules:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear English
 *      error and NEVER serves sample/placeholder figures as if they were real (NEVER #7).
 *   2. That live-disabled error — and every invalid-input rejection — is returned BEFORE any credit
 *      reserve, so the ledger is touched ZERO times (NEVER #2).
 *
 * charge:"handler": a SYNCHRONOUS tool that must run logic BEFORE the reserve, which
 * charge:"surface" (reserve-then-handler) cannot express. It settles via withCredits WITHOUT a
 * jobId — the exact SURFACE ledger shape (reserve -> commit, a traceability uuid, no jobs row).
 * One gap is ONE paid request; if it fails, withCredits releases and nothing is billed.
 */

const NOT_ENABLED_MESSAGE =
  "Link gap analysis is not yet enabled on this deployment. Live DataForSEO data is turned off, " +
  "and SeoGrep never returns sample or placeholder figures as if they were real. This tool will " +
  "start returning data once live DataForSEO access is switched on — you were not charged.";

const inputSchema = z.object({
  target: targetField("analyse for link gaps"),
  project_id: projectIdField,
  competitor: z
    .string()
    .min(1)
    .describe(
      'The rival whose backlinks are mined, e.g. "competitor.com" — the domains linking to it ' +
        "and not to you. One competitor per call.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LINK_GAP_MAX_LIMIT)
    .default(DEFAULT_LINK_GAP_LIMIT)
    .describe(
      `How many referring domains to return (1–${LINK_GAP_MAX_LIMIT}, default ` +
        `${DEFAULT_LINK_GAP_LIMIT}), strongest first by DataForSEO rank. The header always says ` +
        "how many exist in total, so a shorter list never reads like the whole picture.",
    ),
});

type LinkGapInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Find the domains that link to a competitor but not to you — the outreach shortlist — each " +
  "with its DataForSEO rank, how many live backlinks it sends the competitor, how many of its " +
  "pages point there, its backlink spam score and when the link was first seen. Pass a target " +
  "domain (any public domain) or a project_id, plus one competitor. Synchronous — returns the " +
  `list immediately. Costs ${TOOL_COSTS.link_gap} credits. Needs a paid credit balance: it is ` +
  "not available on trial credits. If live DataForSEO access is unavailable on this deployment, " +
  "the tool says so and charges nothing.";

/** Group digits with commas without depending on ICU/locale data (deterministic). */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A metric value: a grouped number, or an honest "n/a" when DataForSEO had none. */
function metric(value: number | null): string {
  return value === null ? "n/a" : thousands(value);
}

/**
 * The header for the prospect list — honest about how much of the total is shown, and about WHAT
 * the list is. The wording restates `exclude_targets`' documented effect ("referring domains that
 * link to targets but don't link to exclude_targets") and claims nothing beyond it: these domains
 * link to the rival and not to the caller, which is not the same as "they would link to you".
 */
export function renderLinkGapHeader(gap: LinkGapResult, project?: ProjectRef | null): string {
  const subject = subjectLabel(gap.target, project);
  const shown = gap.rows.length;
  const total = gap.total_count;
  const scope =
    total !== null && total > shown
      ? `${thousands(shown)} of ${thousands(total)} domains`
      : `${thousands(shown)} domain${shown === 1 ? "" : "s"}`;
  return (
    `Link gap for ${subject} against ${gap.competitor} — ${scope} that link to ` +
    `${gap.competitor} and not to ${subject}, strongest first:`
  );
}

/**
 * One prospect row. Every clause is printed only when DataForSEO returned the value behind it, so
 * an absent metric is left OUT rather than rendered as a zero. `rank` is always stated (as "n/a"
 * when absent) because it is the axis the list is ordered by, and the "of 1,000" suffix names the
 * scale the port pinned rather than leaving a bare number to be read on any scale.
 */
export function renderLinkGapRow(row: LinkGapRow, competitor: string): string {
  const parts = [`rank ${metric(row.rank)} of ${thousands(LINK_GAP_RANK_MAX)}`];
  if (row.backlinks !== null) {
    parts.push(`${metric(row.backlinks)} live backlink${row.backlinks === 1 ? "" : "s"} to ${competitor}`);
  }
  if (row.referring_pages !== null) {
    parts.push(`from ${metric(row.referring_pages)} of its pages`);
  }
  if (row.backlinks_spam_score !== null) {
    parts.push(`spam score ${row.backlinks_spam_score}`);
  }
  const lines = [`• ${row.domain} — ${parts.join(" · ")}`];
  if (row.first_seen !== null) {
    // DataForSEO's own definition, carried verbatim: "when our crawler found the backlink from
    // this target for the first time" — the date the LINK was first seen, not the date the domain
    // was first crawled, and not a claim about the link still being fresh.
    lines.push(`  first backlink seen ${row.first_seen}`);
  }
  return lines.join("\n");
}

/**
 * =====================================================================================
 * THE MISSING EXAMPLE URL — said out loud, because it cannot be supplied
 * =====================================================================================
 * The 2026-08-25 review asked for "one example source URL per candidate, the sibling tools
 * already have it". The sibling tools have it because they read a DIFFERENT endpoint:
 * disavow_candidates and backlink_details both go through /backlinks/backlinks, whose rows are
 * individual LINKS and carry `url_from` / `url_to`. This tool's one paid request is
 * /backlinks/domain_intersection, whose entry carries `target`, `rank`, `backlinks`,
 * `first_seen`, `lost_date`, `backlinks_spam_score`, the broken/referring counters and the
 * `referring_links_*` breakdowns — and NO page URL of any kind. Checked against the vendor's
 * documented field list and against the parser in dfs/link-gap.ts, which throws nothing away.
 *
 * So there are exactly three ways to put a URL on a row, and two of them are forbidden:
 *   • synthesise one from the domain ("https://<domain>") — a claim about a page nobody fetched,
 *     which is the fabricated-measurement rule this product exists to keep (NEVER #7);
 *   • buy a second vendor request per lookup — that moves what the signed 45 credits pay for,
 *     which is a human's decision, not a renderer's (NEVER #6);
 *   • say plainly that the endpoint does not name pages, and name the tool that does.
 * The third is what the footer below does. It is not the example URL that was asked for, and it
 * does not pretend to be one.
 */
export function renderNoExampleUrlNote(competitor: string): string {
  return (
    "No example linking page is shown above: the DataForSEO endpoint behind this tool " +
    "(domain_intersection) reports these prospects at DOMAIN level and names no page URL at all, " +
    "so any URL here would be one SeoGrep made up. To see which pages of these domains link to " +
    `${competitor}, with the anchor text and the page linked to, run backlink_details on ` +
    `${competitor} — a separate ${TOOL_COSTS.backlink_details}-credit lookup.`
  );
}

/** The "nothing found" answer — a real result, not an error, and still charged for. */
function renderNoLinkGap(gap: LinkGapResult, project?: ProjectRef | null): string {
  const subject = subjectLabel(gap.target, project);
  return (
    `No link gap found for ${subject} against ${gap.competitor}: DataForSEO holds no domain ` +
    `with a live backlink to ${gap.competitor} that does not also link to ${subject}.`
  );
}

/** Render the link gap as the plain-text tool output (pure — unit-tested directly). */
export function formatLinkGap(gap: LinkGapResult, project?: ProjectRef | null): string {
  if (gap.rows.length === 0) {
    return renderNoLinkGap(gap, project);
  }
  return [
    renderLinkGapHeader(gap, project),
    ...gap.rows.map((row) => renderLinkGapRow(row, gap.competitor)),
    renderNoExampleUrlNote(gap.competitor),
  ].join("\n\n");
}

/** Dependencies — the gap port is injectable so tests run offline (mock/disabled). */
export interface LinkGapDeps {
  /**
   * The link-gap port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: LinkGapPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
}

/** The rejection a caller gets for naming their own domain as its own rival. */
export const SELF_COMPETITOR_MESSAGE =
  "The competitor is the same domain as the target — a domain has no link gap against itself. " +
  "Name a different domain. You were not charged.";

export function makeLinkGapTool(deps: LinkGapDeps = {}): RegisteredTool {
  return defineTool<LinkGapInput>({
    name: "link_gap",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — resolve WHOSE gap this is: exactly one of project_id / target,
      // the project read tenant-scoped, the domain canonicalized by the shared normalizer.
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      // Free pre-reserve gate 2 — the competitor goes through the SAME normalizer, matched
      // against the RESOLVED target so a project's own domain is caught too.
      const competitor = normalizeDomain(input.competitor);
      if (!competitor.ok) {
        // Free and pre-reserve like every gate around it, so it says so. normalizeDomain's
        // wording is shared with 0-credit tools and is not edited at its source in packages/core.
        return errorResult(withNoChargeNote(competitor.error));
      }
      if (competitor.domain === subject.domain) {
        return errorResult(SELF_COMPETITOR_MESSAGE);
      }
      const port = deps.port ?? resolveDefaultLinkGapPort();
      // Free pre-reserve gate 3 — refuse rather than reserve credits or serve mock data.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch ->
      // commit as one chain. The DataForSEO request failing throws, so withCredits releases.
      return withCredits({ userId: ctx.userId }, { tool: "link_gap" }, async () => {
        const gap = await port.fetchLinkGap({
          target: subject.domain,
          competitor: competitor.domain,
          limit: input.limit,
        });
        return textResult(formatLinkGap(gap, subject.project));
      });
    },
  });
}

/** The production link_gap tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const linkGapTool = makeLinkGapTool();
