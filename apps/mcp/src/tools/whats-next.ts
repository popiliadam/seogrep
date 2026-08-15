import { z } from "zod";
import {
  decideProjectNextStep,
  FRESHNESS_WINDOW_DAYS,
  type NextStep,
  type ProjectSignals,
} from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import { forUser, getServiceClient, type ServiceClient } from "../db.ts";
import { loadGscTokenStatus } from "../gsc-data/index.ts";
import { getLatestSucceededResult } from "../queue/boss.ts";
import {
  ARCHIVED_PROJECT_MESSAGE,
  loadOwnProject,
  type LoadProjectFn,
} from "./project-target.ts";
import { defineTool, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * whats_next — the "guide for non-experts" router (spec §2.1). It reads where a project stands
 * through the SAME tenant-scoped ports the real tools use (getLatestSucceededResult for crawl /
 * pull, the gsc_connections row for the Search Console link, loadGscTokenStatus for whether the
 * account behind that link is still alive) and returns ONE clear next step, a
 * short reason, and the two or three steps that follow. It runs NO engine and spends NO credits
 * (0 in TOOL_COSTS, so withCredits short-circuits — the ledger is never touched).
 *
 * The DECISION itself — the signals, the recommendation shape, the freshness window and the
 * ladder — moved to @pseo/core (`guide/next-step`) so apps/web can show the SAME next step; see
 * that module's header for why the ladder keys on data milestones. What stays here is the I/O
 * half: the tenant-scoped signal reads, the state loader, the renderers and the tool definition.
 */

/**
 * The ladder and its vocabulary, re-exported from their new home in @pseo/core. `import` + a
 * separate `export` rather than `export … from`, because `renderWhatsNext` CALLS
 * `decideProjectNextStep` and `isFresh` reads `FRESHNESS_WINDOW_DAYS`, and `export … from`
 * creates no local binding (the emsal: setup-project.ts's `normalizeDomain`).
 */
export { decideProjectNextStep, FRESHNESS_WINDOW_DAYS };
export type { NextStep, ProjectSignals };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A tracked project, projected to what the ROUTER shows — id and domain, nothing else.
 *
 * NOT `project-target.ts`'s `ProjectRef`, which additionally carries `archivedAt`. Both were
 * exported under the one name, and nothing collided only because no module imported both: a
 * reader who greps `ProjectRef` lands on whichever the editor opens first and reasons about
 * the wrong shape — which for a type whose missing field IS the archive gate is a bad way to
 * find out. The archive-bearing one keeps the general name; this local projection is named for
 * what it is and where it is used.
 */
export interface ProjectChoice {
  readonly id: string;
  readonly domain: string;
}

/**
 * The resolved routing state — no projects, pick-a-project, unknown id, an ARCHIVED project, or
 * a project to route. `project_archived` is its own state rather than a flavour of
 * `project_not_found`: the caller owns the project and can bring it back, and a router that
 * answered "no such project" would send them to setup_project to create a duplicate.
 */
export type WhatsNextState =
  | { readonly kind: "no_projects" }
  | { readonly kind: "choose_project"; readonly projects: readonly ProjectChoice[] }
  | { readonly kind: "project_not_found"; readonly projectId: string }
  | { readonly kind: "project_archived" }
  | { readonly kind: "project"; readonly domain: string; readonly signals: ProjectSignals };

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
    case "project_archived":
      return ARCHIVED_PROJECT_MESSAGE;
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
 * with a non-null account_id (migration 0021 — the web OAuth callback sets it once a token is
 * stored on gsc_accounts). Scoped to the tenant by an explicit user_id filter (constitution
 * NEVER #4) AND project_id — the literal table gives the specific row type, so the project_id
 * filter type-checks (forUser's selectOwn narrows filters to the columns common to ALL tenant
 * tables, which excludes project_id). Same reader shape as pull_gsc_data's loadConnection. A
 * missing / another tenant's connection / a null account_id all read as not-connected — this
 * read needs only the boolean, never the token itself, so it stops at gsc_connections.
 *
 * "Connected" is deliberately NOT "usable": the account behind this row can be dead. That is a
 * SEPARATE signal, read by loadGscTokenStatus in readProjectSignals below — kept separate because
 * a dead connection is still a connection, and collapsing the two would make a project whose
 * credential expired look like one that never connected (which would route it to
 * "connect_gsc (optional)" beside the audits, hiding that its Search Console data is frozen).
 */
async function readGscConnected(
  client: ServiceClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("gsc_connections")
    .select("account_id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    throw new Error(`whats_next: gsc_connections read failed: ${error.message}`);
  }
  return data?.account_id != null;
}

/**
 * Read the observable signals for a project (all tenant-scoped, in parallel).
 *
 * `loadGscTokenStatus` is the SAME reader the discovery tools use for their reauth warning —
 * gsc_connections.account_id -> gsc_accounts.token_status, both filtered by user_id. It is
 * imported, not re-implemented: a second copy of a two-hop tenant-scoped read is a second place
 * for the user_id filter to be forgotten. It costs one extra round trip over `readGscConnected`
 * (both read gsc_connections), which is the price of not owning a duplicate of the boundary.
 *
 * NOT best-effort — a failing health read THROWS, unlike in gsc-discovery-shared.ts where it is
 * swallowed. The two situations invert: there the warning decorates an analysis the user has
 * ALREADY been charged for and losing it beats crashing a delivered result; here the health IS
 * the answer. Swallowing it would answer "active", which is exactly the wrong recommendation
 * this rung exists to remove — and a whats_next that fails costs 0 credits and can be re-run.
 */
async function readProjectSignals(
  client: ServiceClient,
  userId: string,
  projectId: string,
  now: Date,
): Promise<ProjectSignals> {
  const [crawl, pull, gscConnected, tokenStatus] = await Promise.all([
    getLatestSucceededResult(client, { projectId, userId, tool: "crawl_site" }),
    getLatestSucceededResult(client, { projectId, userId, tool: "pull_gsc_data" }),
    readGscConnected(client, userId, projectId),
    loadGscTokenStatus(userId, projectId),
  ]);
  return {
    hasCrawl: crawl !== null,
    crawlFresh: crawl !== null && isFresh(crawl.createdAt, now),
    gscConnected,
    hasPull: pull !== null,
    pullFresh: pull !== null && isFresh(pull.createdAt, now),
    // Only a stored 'invalid' is a death. A null status (no connection, no linked account) is
    // "nothing known to be wrong", which the ladder must treat as the pre-signal case.
    gscTokenInvalid: tokenStatus === "invalid",
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
  loadProject: LoadProjectFn,
): Promise<WhatsNextState> {
  if (input.projectId) {
    // The SHARED resolver, not a project read of its own — a per-tool read is a per-tool place
    // for the archive check to be forgotten.
    const project = await loadProject(userId, input.projectId);
    if (!project) return { kind: "project_not_found", projectId: input.projectId };
    // AFTER the ownership gate, never before: an archived project of ANOTHER tenant must stay
    // indistinguishable from one that does not exist (see project-target.ts). Returning here
    // also means no signal read runs for a project that is not being tracked.
    if (project.archivedAt !== null) return { kind: "project_archived" };
    const signals = await readProjectSignals(getServiceClient(), userId, input.projectId, now);
    return { kind: "project", domain: project.domain, signals };
  }

  const client = getServiceClient();
  // Archived projects are left OUT of the routing list rather than refused: without a
  // project_id the caller named nothing to refuse, and a project they stopped tracking must
  // not become the "next step" — nor pad a choose_project list. Active rows only (migration
  // 0022); `.is(…, null)` is the PostgREST null filter (`.eq(…, null)` matches nothing).
  const { data, error } = await forUser(client, userId)
    .selectOwn("projects", "id, domain, created_at")
    .is("archived_at", null);
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
  /**
   * Tenant-scoped project resolver (default: the shared loadOwnProject). Injected so the
   * project_id branch — ownership, then archive — is exercisable without a DB. Ignored when
   * `loadState` is injected, which replaces the whole loader.
   */
  readonly loadProject?: LoadProjectFn;
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
  const loadProject = deps.loadProject ?? loadOwnProject;
  const loadState =
    deps.loadState ?? ((userId, input) => loadWhatsNextState(userId, input, now(), loadProject));
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
