import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  BACKLINKS_MAX_LIMIT,
  BACKLINK_RANK_MAX,
  resolveDefaultBacklinksPort,
  type AnchorRow,
  type BacklinkList,
  type BacklinkProfile,
  type BacklinkSummary,
  type BacklinksPort,
  type ReferringDomainRow,
} from "../dfs/backlinks.ts";
import {
  backlinksRunReport,
  writeDomainLookupRun,
  type DomainLookupRunWriter,
} from "../dfs/runs.ts";
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
 * analyze_backlinks — a domain's backlink profile from the DataForSEO Backlinks API: the
 * profile-level summary, the top referring domains, and the top anchor texts. Synchronous: it
 * returns the report immediately (no background job). It takes EITHER a bare `target` (any
 * public domain, yours or a competitor's) OR a `project_id`, whose stored domain becomes the
 * target.
 *
 * It is built to the ranked_keywords pattern, and the same two hard product rules shape its
 * credit path:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear
 *      English error and NEVER serves sample/placeholder figures as if they were real
 *      (constitution NEVER #7). The mock fixtures exist only for tests.
 *   2. That live-disabled error — and an invalid-domain rejection — are returned BEFORE any
 *      credit reserve, so the ledger is touched ZERO times (constitution NEVER #2).
 *
 * charge:"handler" for the same reason ranked_keywords uses it: this is a SYNCHRONOUS tool that
 * must run logic BEFORE the reserve, which charge:"surface" (reserve-then-handler) cannot
 * express. On the serving path it settles via withCredits WITHOUT a jobId — the exact SURFACE
 * ledger shape (reserve -> commit, a traceability uuid, no jobs row).
 *
 * One lookup is three paid DataForSEO requests (see dfs/backlinks.ts). The port throws unless
 * ALL THREE succeed, so a partial profile is never billed: withCredits releases the reserve and
 * the caller's balance ends where it started, whichever of the three failed.
 */

const NOT_ENABLED_MESSAGE =
  "Backlink lookups are not yet enabled on this deployment. Live DataForSEO data is turned " +
  "off, and SeoGrep never returns sample or placeholder figures as if they were real. This " +
  "tool will start returning data once live DataForSEO access is switched on — you were not " +
  "charged.";

const inputSchema = z.object({
  target: targetField("look up"),
  project_id: projectIdField,
  limit: z
    .number()
    .int()
    .min(1)
    .max(BACKLINKS_MAX_LIMIT)
    .default(BACKLINKS_MAX_LIMIT)
    .describe(
      `How many rows to return in EACH list — referring domains and anchors ` +
        `(1–${BACKLINKS_MAX_LIMIT}, default ${BACKLINKS_MAX_LIMIT}).`,
    ),
});

type AnalyzeBacklinksInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Analyze a domain's backlink profile — total backlinks, referring domains, dofollow-only " +
  "share, spam score, plus the top referring domains and anchor texts. Pass a target domain " +
  "(any public domain, including a competitor's) or a project_id to look up one of your own " +
  `sites. Synchronous — returns a report immediately. Costs ` +
  `${TOOL_COSTS.analyze_backlinks} credits. Needs a paid credit balance: it is not available on ` +
  "trial credits. If live DataForSEO access is unavailable on this deployment, the tool says " +
  "so and charges nothing.";

/**
 * Group digits with commas without depending on ICU/locale data (deterministic). Kept local on
 * purpose: sharing it would mean editing ranked_keywords, whose behaviour is pinned.
 */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A metric line value: a grouped number, or an honest "n/a" when DataForSEO had none. */
function metric(value: number | null): string {
  return value === null ? "n/a" : thousands(value);
}

/**
 * "12,372 — 10,914 dofollow-only (88%)". The clause is added ONLY when both counts are present
 * and the total is positive; otherwise the bare count is shown rather than a made-up ratio.
 *
 * The label is deliberately "dofollow-only", not "dofollow". DataForSEO documents
 * `referring_domains_nofollow` as the domains pointing AT LEAST ONE nofollow link at the target
 * — NOT the domains that link exclusively with nofollow. Subtracting it therefore yields the
 * domains carrying NO nofollow link at all, which is a STRICTER set than "passes at least one
 * dofollow link": a domain that links twice, once dofollow and once nofollow, is excluded here.
 * Calling that number "dofollow" would overstate it, so the renderer names exactly what it is.
 */
function renderReferringDomainsMetric(summary: BacklinkSummary): string {
  const { referring_domains: total, referring_domains_nofollow: nofollow } = summary;
  if (total === null) return "n/a";
  if (nofollow === null || total <= 0 || nofollow > total) return thousands(total);
  const dofollowOnly = total - nofollow;
  const share = Math.round((dofollowOnly / total) * 100);
  return `${thousands(total)} — ${thousands(dofollowOnly)} dofollow-only (${share}%)`;
}

/** The header for a truncatable list — honest about how much of the total is shown. */
function listHeader(label: string, list: BacklinkList<unknown>): string {
  const shown = list.rows.length;
  const truncated = list.total_count !== null && list.total_count > shown;
  return truncated ? `${label} (${shown} of ${thousands(list.total_count ?? 0)}):` : `${label} (${shown}):`;
}

function renderSummary(profile: BacklinkProfile, project: ProjectRef | null | undefined): string {
  const { summary } = profile;
  return [
    `Backlink profile for ${subjectLabel(profile.target, project)}:`,
    `• Backlinks: ${metric(summary.backlinks)}`,
    `• Referring domains: ${renderReferringDomainsMetric(summary)}`,
    `• Referring main domains: ${metric(summary.referring_main_domains)}`,
    `• Broken backlinks: ${metric(summary.broken_backlinks)}`,
    `• Backlink spam score: ${metric(summary.backlinks_spam_score)}`,
    `• Domain rank: ${metric(summary.rank)} of ${thousands(BACKLINK_RANK_MAX)}`,
  ].join("\n");
}

function renderReferringDomains(list: BacklinkList<ReferringDomainRow>): string {
  if (list.rows.length === 0) return "Top referring domains: none on record.";
  const lines = list.rows.map(
    (row) => `• ${row.domain} — ${metric(row.backlinks)} backlinks, rank ${metric(row.rank)}`,
  );
  return `${listHeader("Top referring domains", list)}\n${lines.join("\n")}`;
}

function renderAnchors(list: BacklinkList<AnchorRow>): string {
  if (list.rows.length === 0) return "Top anchors: none on record.";
  const lines = list.rows.map((row) => {
    // An empty anchor is real data (image links carry no anchor text) — label it, don't hide it.
    const anchor = row.anchor === "" ? "(no anchor text)" : `"${row.anchor}"`;
    return `• ${anchor} — ${metric(row.backlinks)} backlinks`;
  });
  return `${listHeader("Top anchors", list)}\n${lines.join("\n")}`;
}

/**
 * Render the backlink profile as the plain-text tool output (pure — unit-tested directly).
 * `project` is passed only when the caller resolved the target from a project_id; a bare-target
 * call renders exactly as it always did.
 */
export function formatBacklinkProfile(
  profile: BacklinkProfile,
  project?: ProjectRef | null,
): string {
  return [
    renderSummary(profile, project),
    renderReferringDomains(profile.top_referring_domains),
    renderAnchors(profile.top_anchors),
  ].join("\n\n");
}

/** Dependencies — the backlinks port is injectable so tests run offline (mock/disabled). */
export interface AnalyzeBacklinksDeps {
  /**
   * The backlinks port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: BacklinksPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /**
   * The run recorder (default: the real `writeDomainLookupRun`). A PORT for the reason every
   * other writer in this family is one: a spec can make it FAIL without breaking a database, which
   * is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeRun?: DomainLookupRunWriter;
}

export function makeAnalyzeBacklinksTool(deps: AnalyzeBacklinksDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeDomainLookupRun;
  return defineTool<AnalyzeBacklinksInput>({
    name: "analyze_backlinks",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — resolve WHAT to look up: exactly one of project_id / target,
      // the project read tenant-scoped, the domain canonicalized by the shared normalizer. Every
      // rejection it returns costs nothing (see project-target.ts).
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      const port = deps.port ?? resolveDefaultBacklinksPort();
      // Free pre-reserve gate 2 — refuse rather than reserve credits or serve mock data.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch ->
      // commit as one chain. Any of the three DataForSEO requests failing throws, so withCredits
      // releases and a partial profile is never billed.
      return withCredits({ userId: ctx.userId }, { tool: "analyze_backlinks" }, async () => {
        const profile = await port.fetchBacklinkProfile({
          target: subject.domain,
          limit: input.limit,
        });
        // THE RUN IS RECORDED BEFORE THE REPLY IS RETURNED, and the write is NOT guarded
        // (migration 0027; dfs/runs.ts states the same contract from the other side). withCredits
        // commits a handler that RETURNS and releases one that THROWS, so an error escaping here
        // costs the tenant nothing. Caught and logged instead, the shape would be the house's
        // worst at 70 credits a call: a charged caller, a delivered profile, and a panel that says
        // forever that the lookup never ran.
        //
        // `projectId` is null on a bare-target call — the commonest PAID call this tool serves,
        // and the one 0027 made project_id nullable to record. `target` is the RESOLVED domain,
        // never the caller's raw input.
        await writeRun(
          {
            userId: ctx.userId,
            projectId: subject.project?.id ?? null,
            tool: "analyze_backlinks",
            target: subject.domain,
          },
          backlinksRunReport(profile, { limit: input.limit }),
        );
        return textResult(formatBacklinkProfile(profile, subject.project));
      });
    },
  });
}

/** The production analyze_backlinks tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const analyzeBacklinksTool = makeAnalyzeBacklinksTool();
