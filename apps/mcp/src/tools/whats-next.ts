import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { forUser, getServiceClient, type ServiceClient } from "../db.ts";
import { getLatestSucceededResult } from "../queue/boss.ts";
import { defineTool, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * whats_next — the "guide for non-experts" router (spec §2.1). It reads where a project stands
 * through the SAME tenant-scoped ports the real tools use (getLatestSucceededResult for crawl /
 * pull, the gsc_connections row for the Search Console link) and returns ONE clear next step, a
 * short reason, and the two or three steps that follow. It runs NO engine and spends NO credits
 * (0 in TOOL_COSTS, so withCredits short-circuits — the ledger is never touched).
 *
 * The router is a HEURISTIC guide, not a precise tracker: audits and the discovery tools leave no
 * job trace (they are synchronous and return directly), so the ladder advances on the observable
 * DATA milestones — a project exists, a crawl succeeded, Search Console is connected, a pull
 * succeeded — and always surfaces the matching analysis trio as the recommended follow-up. Google
 * Search Console is framed as OPTIONAL at every rung (design D15: the first aha is crawl + audit
 * with no GSC; connecting it is never a barrier).
 */

/** Crawl / pull data newer than this many days counts as "fresh" for the all-set / refresh rungs. */
export const FRESHNESS_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The observable, tenant-scoped signals the ladder decides from. */
export interface ProjectSignals {
  readonly hasCrawl: boolean;
  readonly crawlFresh: boolean;
  readonly gscConnected: boolean;
  readonly hasPull: boolean;
  readonly pullFresh: boolean;
}

/** A single next-step recommendation: the primary action, why, and what follows. */
export interface NextStep {
  /** The one recommended tool (or, at the all-set rung, the report payoff). */
  readonly primary: string;
  /** A short plain-English reason for the recommendation. */
  readonly reason: string;
  /** The two or three steps that come after (tool names, with optional/prompt hints). */
  readonly upcoming: readonly string[];
  /** True only when every applicable data source is present and fresh. */
  readonly allSet: boolean;
}

/** A tracked project, projected to what the router shows. */
export interface ProjectRef {
  readonly id: string;
  readonly domain: string;
}

/** The resolved routing state — one of: no projects, pick-a-project, unknown id, or a project. */
export type WhatsNextState =
  | { readonly kind: "no_projects" }
  | { readonly kind: "choose_project"; readonly projects: readonly ProjectRef[] }
  | { readonly kind: "project_not_found"; readonly projectId: string }
  | { readonly kind: "project"; readonly domain: string; readonly signals: ProjectSignals };

/**
 * The pure decision ladder for a RESOLVED project (first match wins). Kept free of I/O so every
 * rung is unit-tested directly. See the module header for why the ladder keys on data milestones.
 */
export function decideProjectNextStep(s: ProjectSignals): NextStep {
  // Rung 1 — no crawl: the GSC-less foundation (works without Search Console).
  if (!s.hasCrawl) {
    return {
      primary: "crawl_site",
      reason:
        "This project has no crawl yet. A crawl is the foundation of every audit, and it works " +
        "without connecting Google Search Console.",
      upcoming: ["audit_onpage", "audit_tech", "audit_schema", "connect_gsc (optional)"],
      allSet: false,
    };
  }
  // Rung 2 — crawl present, Search Console not connected, nothing pulled: audit the crawl now;
  // connecting GSC stays OPTIONAL (design D15 — never a barrier).
  if (!s.gscConnected && !s.hasPull) {
    return {
      primary: "audit_onpage",
      reason:
        "Your latest crawl is ready to analyze. Run the on-page audit first, then the technical " +
        "and schema audits. Connecting Google Search Console is optional and unlocks deeper, " +
        "query-level analysis.",
      upcoming: ["audit_tech", "audit_schema", "connect_gsc (optional)", "generate_report"],
      allSet: false,
    };
  }
  // Rung 3 — Search Console connected but nothing pulled yet: pull to unlock the discovery tools.
  if (s.gscConnected && !s.hasPull) {
    return {
      primary: "pull_gsc_data",
      reason:
        "Google Search Console is connected. Pull your latest performance data to unlock quick " +
        "wins, cannibalization, and content-decay analysis.",
      upcoming: [
        "find_quick_wins",
        "detect_cannibalization",
        "analyze_content_decay",
        "generate_report",
      ],
      allSet: false,
    };
  }
  // A pull exists (past the two rungs above implies hasPull here). If a present source is stale,
  // refresh it before acting so the numbers reflect the current picture.
  if (!s.pullFresh) {
    return {
      primary: "pull_gsc_data",
      reason:
        `Your Search Console data is more than ${FRESHNESS_WINDOW_DAYS} days old. Refresh it before ` +
        "acting on quick wins so the numbers reflect the current picture.",
      upcoming: [
        "find_quick_wins",
        "detect_cannibalization",
        "analyze_content_decay",
        "generate_report",
      ],
      allSet: false,
    };
  }
  if (!s.crawlFresh) {
    return {
      primary: "crawl_site",
      reason:
        `Your crawl is more than ${FRESHNESS_WINDOW_DAYS} days old. Re-crawl so the audits reflect ` +
        "the current state of the site.",
      upcoming: ["audit_onpage", "audit_tech", "audit_schema", "generate_report"],
      allSet: false,
    };
  }
  // All-set — every applicable source is present and fresh. Point at the report payoff and the
  // monthly-routine prompt that keeps the data current.
  return {
    primary: "generate_report",
    reason:
      "You have a fresh crawl and fresh Search Console data — you're all set. Generate a shareable " +
      "report, and use the monthly-routine prompt to keep everything up to date.",
    upcoming: [
      "find_quick_wins",
      "detect_cannibalization",
      "analyze_content_decay",
      "monthly-routine (prompt)",
    ],
    allSet: true,
  };
}

/** Render a resolved project's next step as the tool's plain-text output (pure). */
export function formatNextStep(domain: string, step: NextStep): string {
  const header = step.allSet
    ? `You're all set for ${domain} — recommended next: run ${step.primary}.`
    : `Next step for ${domain}: run ${step.primary}.`;
  const then = step.upcoming.map((item) => `- ${item}`).join("\n");
  return `${header}\n\nWhy: ${step.reason}\n\nThen:\n${then}`;
}

/** Render any resolved routing state as the tool's plain-text output (pure). */
export function renderWhatsNext(state: WhatsNextState): string {
  switch (state.kind) {
    case "no_projects":
      return (
        "You have no projects yet. Next step: run setup_project with your website domain, e.g. " +
        'setup_project { "domain": "example.com" }.\n\n' +
        "Then:\n" +
        "- crawl_site — crawl the site (works without Google Search Console)\n" +
        "- audit_onpage, audit_tech, audit_schema — analyze the crawl\n" +
        "- generate_report — produce a shareable report"
      );
    case "choose_project": {
      const list = state.projects.map((p) => `- ${p.domain} (project_id: ${p.id})`).join("\n");
      return (
        "You are tracking more than one project. Tell me which one to look at by calling whats_next " +
        'with a project_id, e.g. whats_next { "project_id": "..." }.\n\n' +
        `Your projects:\n${list}`
      );
    }
    case "project_not_found":
      return (
        `No project found with id ${state.projectId}. Run list_projects to see your projects, or ` +
        "setup_project to add a new one."
      );
    case "project":
      return formatNextStep(state.domain, decideProjectNextStep(state.signals));
  }
}

/** Is `createdAt` within the freshness window relative to `now`? */
function isFresh(createdAt: string, now: Date): boolean {
  return now.getTime() - new Date(createdAt).getTime() <= FRESHNESS_WINDOW_DAYS * MS_PER_DAY;
}

/**
 * Is Search Console connected for (userId, projectId)? Connected = a gsc_connections row exists
 * with a non-null sealed refresh token (the web OAuth callback wrote it). Scoped to the tenant by
 * an explicit user_id filter (constitution NEVER #4) AND project_id — the literal table gives the
 * specific row type, so the project_id filter type-checks (forUser's selectOwn narrows filters to
 * the columns common to ALL tenant tables, which excludes project_id). Same reader shape as
 * pull_gsc_data's loadConnection. A missing / another tenant's connection both read as not-connected.
 */
async function readGscConnected(
  client: ServiceClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("gsc_connections")
    .select("encrypted_refresh_token")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    throw new Error(`whats_next: gsc_connections read failed: ${error.message}`);
  }
  return data?.encrypted_refresh_token != null;
}

/** Read the four observable signals for a project (all tenant-scoped, in parallel). */
async function readProjectSignals(
  client: ServiceClient,
  userId: string,
  projectId: string,
  now: Date,
): Promise<ProjectSignals> {
  const [crawl, pull, gscConnected] = await Promise.all([
    getLatestSucceededResult(client, { projectId, userId, tool: "crawl_site" }),
    getLatestSucceededResult(client, { projectId, userId, tool: "pull_gsc_data" }),
    readGscConnected(client, userId, projectId),
  ]);
  return {
    hasCrawl: crawl !== null,
    crawlFresh: crawl !== null && isFresh(crawl.createdAt, now),
    gscConnected,
    hasPull: pull !== null,
    pullFresh: pull !== null && isFresh(pull.createdAt, now),
  };
}

/**
 * Resolve the routing state from the tenant's data. With a project_id: a tenant-scoped read (an
 * unknown or another tenant's id both yield project_not_found — no cross-tenant leak). Without one:
 * route from the project list — none -> no_projects, exactly one -> auto-select it, many ->
 * choose_project (oldest first, deterministic).
 */
async function loadWhatsNextState(
  userId: string,
  input: { projectId?: string },
  now: Date,
): Promise<WhatsNextState> {
  const client = getServiceClient();
  const tenant = forUser(client, userId);

  if (input.projectId) {
    const project = await tenant.selectOwnById<{ domain: string }>(
      "projects",
      input.projectId,
      "domain",
    );
    if (!project) return { kind: "project_not_found", projectId: input.projectId };
    const signals = await readProjectSignals(client, userId, input.projectId, now);
    return { kind: "project", domain: project.domain, signals };
  }

  const { data, error } = await tenant.selectOwn("projects", "id, domain, created_at");
  if (error) {
    throw new Error(`whats_next: projects list failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { id: string; domain: string; created_at: string }[];
  if (rows.length === 0) return { kind: "no_projects" };

  const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const only = ordered[0];
  if (ordered.length === 1 && only) {
    const signals = await readProjectSignals(client, userId, only.id, now);
    return { kind: "project", domain: only.domain, signals };
  }
  return { kind: "choose_project", projects: ordered.map((r) => ({ id: r.id, domain: r.domain })) };
}

/** Dependencies — the state loader + clock are injectable so unit tests run offline / deterministic. */
export interface WhatsNextDeps {
  /** Resolve the routing state (default: the real tenant-scoped reads). Injected in unit tests. */
  readonly loadState?: (userId: string, input: { projectId?: string }) => Promise<WhatsNextState>;
  /** Clock for freshness (default: real). Injected so the default loader is deterministic in tests. */
  readonly now?: () => Date;
}

const inputSchema = z.object({
  project_id: z
    .uuid()
    .optional()
    .describe(
      "Optional project to route from (from setup_project / list_projects). Omit it to route from " +
        "your project list.",
    ),
});

type WhatsNextInput = z.infer<typeof inputSchema>;

export function makeWhatsNextTool(deps: WhatsNextDeps = {}): RegisteredTool {
  const now = deps.now ?? (() => new Date());
  const loadState = deps.loadState ?? ((userId, input) => loadWhatsNextState(userId, input, now()));
  return defineTool<WhatsNextInput>({
    name: "whats_next",
    description:
      "Not sure what to do next? whats_next looks at where your project stands — crawl, audits, " +
      "Search Console, reports — and tells you the single best next step, with a short reason and " +
      "what comes after. Free (0 credits). Optionally pass a project_id; omit it to route from your " +
      "project list.",
    inputSchema,
    // charge defaults to "surface"; whats_next is 0 credits, so withCredits short-circuits (no ledger).
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      const state = await loadState(ctx.userId, { projectId: input.project_id });
      return textResult(renderWhatsNext(state));
    },
  });
}

/** The production whats_next tool (real tenant-scoped state reads, real clock). */
export const whatsNextTool = makeWhatsNextTool();
