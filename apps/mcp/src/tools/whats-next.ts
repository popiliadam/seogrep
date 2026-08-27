import { z } from "zod";
import {
  dataAgeInDays,
  decideProjectNextStep,
  displayDomain,
  FRESHNESS_WINDOW_DAYS,
  type NextStep,
  type ProjectSignals,
} from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import {
  CREDIT_UNITS,
  TOOL_COSTS,
  creditCostFor,
  isPerUnitTool,
  type ToolName,
} from "../credits/costs.ts";
import { forUser, getServiceClient, type ServiceClient } from "../db.ts";
import { loadGscTokenStatus, type LoadTokenStatusFn } from "../gsc-data/index.ts";
import { getLatestSucceededResult } from "../queue/boss.ts";
import { checkDomainReachable, type CheckDomainFn } from "./domain-reachability.ts";
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

/**
 * What one recommendation costs, in words — "free", "30 credits", or "" for anything that is not
 * a priced tool ("monthly-routine (prompt)", "whats_next (once the domain is live)").
 *
 * WHY IT EXISTS. The router printed eight recommendations and not one credit cost (defect card 5,
 * 2026-08-25): the same list named `generate_report` at 15 credits and `audit_onpage` at 30 with
 * nothing to tell them apart, and a non-expert — the exact audience this tool is for — had to
 * leave the router and go read the docs to find out what "next step" would charge them.
 *
 * IT READS TOOL_COSTS, IT NEVER RESTATES ONE. NEVER #6 forbids changing a price; SHOWING one is
 * outside it. But a second literal would be a second price, so every number here comes from the
 * signed table through `creditCostFor`, and a per-unit tool renders its real RANGE rather than a
 * unit price no call ever costs (the reason CREDIT_UNITS exists at all). None of the ladder's
 * current recommendations is per-unit; the branch is here so that adding one cannot quietly print
 * "8 credits" for a call that bills 13 to 85.
 *
 * The name is taken as the FIRST token, because the ladder decorates some entries
 * ("connect_gsc (optional)"). An unrecognised token yields "", never "free" — guessing that an
 * unknown step is free is the one wrong answer this function could give.
 */
export function priceLabel(recommendation: string): string {
  const name = recommendation.split(" ")[0] ?? "";
  if (!(name in TOOL_COSTS)) return "";
  const tool = name as ToolName;
  if (isPerUnitTool(tool)) {
    const rule = CREDIT_UNITS[tool];
    const low = creditCostFor(tool, rule.min_units);
    const high = creditCostFor(tool, rule.max_units);
    return `${low}-${high} credits per call`;
  }
  return TOOL_COSTS[tool] === 0 ? "free" : `${TOOL_COSTS[tool]} credits`;
}

/** `item`, with its price appended when it has one. */
function withPrice(item: string): string {
  const label = priceLabel(item);
  return label === "" ? item : `${item} — ${label}`;
}

/**
 * Render a resolved project's next step as the tool's plain-text output (pure).
 *
 * THE DOMAIN GOES THROUGH `displayDomain`. Projects are STORED as A-labels, so an IDN project
 * read as `xn--smoke-dalga2-rnek-c0b.com` here while `list_projects` — the tool the caller got
 * the project_id from, one line earlier in the same session — printed `smoke-dalga2-örnek.com`.
 * Two free tools, one project, two names (measured live 2026-08-27). Display only: nothing
 * stored, compared or sent anywhere changes, exactly as in list-projects.ts.
 */
export function formatNextStep(domain: string, step: NextStep): string {
  const price = priceLabel(step.primary);
  const primary = price === "" ? step.primary : `${step.primary} (${price})`;
  const shown = displayDomain(domain);
  const header = step.allSet
    ? `You're all set for ${shown} — recommended next: run ${primary}.`
    : `Next step for ${shown}: run ${primary}.`;
  const then = step.upcoming.map((item) => `- ${withPrice(item)}`).join("\n");
  return `${header}\n\nWhy: ${step.reason}\n\nThen:\n${then}`;
}

/** Render any resolved routing state as the tool's plain-text output (pure). */
export function renderWhatsNext(state: WhatsNextState): string {
  switch (state.kind) {
    case "no_projects":
      return (
        `You have no projects yet. Next step: run setup_project (${priceLabel("setup_project")}) ` +
        'with your website domain, e.g. setup_project { "domain": "example.com" }.\n\n' +
        "Then:\n" +
        `- crawl_site (${priceLabel("crawl_site")}) — crawl the site (works without Google ` +
        "Search Console)\n" +
        `- audit_onpage (${priceLabel("audit_onpage")}), audit_tech (${priceLabel("audit_tech")}), ` +
        `audit_schema (${priceLabel("audit_schema")}) — analyze the crawl\n` +
        `- generate_report (${priceLabel("generate_report")}) — produce a shareable report`
      );
    case "choose_project": {
      // `displayDomain` for the same reason formatNextStep uses it, and this is the surface where
      // the mismatch is loudest: this list exists to be read beside list_projects' list.
      const list = state.projects
        .map((p) => `- ${displayDomain(p.domain)} (project_id: ${p.id})`)
        .join("\n");
      // WHY THIS ANSWERS INSTEAD OF ROUTING. The schema used to promise it would "route from your
      // project list"; measured on an account with 15 projects it printed the same rows
      // list_projects prints (defect card 5). Two honest options existed, and this is the one
      // taken: routing N projects means running every project's signal reads — four tenant-scoped
      // queries and a DNS lookup EACH — for a 0-credit tool, and then still picking one "next
      // step" out of fifteen unrelated sites, which is a guess dressed as a recommendation. The
      // description now says what this does. What changed here is that the answer states the RULE
      // (one project routes itself; several need naming) rather than reading as a list that
      // failed to become advice.
      return (
        `You are tracking ${state.projects.length} projects, so there is no single next step — ` +
        "each site is at its own stage. Name one and whats_next will route it (still " +
        `${priceLabel("whats_next")}): whats_next { "project_id": "..." }. With exactly one ` +
        "project, whats_next routes it without being asked.\n\n" +
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
 * What Search Console link does (userId, projectId) have? Connected = a gsc_connections row exists
 * with a non-null account_id (migration 0021 — the web OAuth callback sets it once a token is
 * stored on gsc_accounts). Scoped to the tenant by an explicit user_id filter (constitution
 * NEVER #4) AND project_id — the literal table gives the specific row type, so the project_id
 * filter type-checks (forUser's selectOwn narrows filters to the columns common to ALL tenant
 * tables, which excludes project_id). Same reader shape as pull_gsc_data's loadConnection. A
 * missing / another tenant's connection / a null account_id all read as not-connected — this
 * read needs no token itself, so it stops at gsc_connections.
 *
 * IT RETURNS TWO FACTS, NOT ONE, since 2026-08-26. `gsc_property` can be NULL on a row whose
 * account_id is set — an account linked, no property mapped — and the old boolean reported that
 * project as plainly "connected", which routed it to pull_gsc_data: a pull that cannot succeed.
 * `list_projects` names this state on its own line, so a boolean here would also make the two
 * tools disagree about the same project. The column was already one `select` away.
 *
 * "Connected" is deliberately NOT "usable": the account behind this row can be dead. That is a
 * SEPARATE signal, read by loadGscTokenStatus in readProjectSignals below — kept separate because
 * a dead connection is still a connection, and collapsing the two would make a project whose
 * credential expired look like one that never connected (which would route it to
 * "connect_gsc (optional)" beside the audits, hiding that its Search Console data is frozen).
 */
async function readGscLink(
  client: ServiceClient,
  userId: string,
  projectId: string,
): Promise<{ connected: boolean; propertyMissing: boolean }> {
  const { data, error } = await client
    .from("gsc_connections")
    .select("account_id, gsc_property")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    throw new Error(`whats_next: gsc_connections read failed: ${error.message}`);
  }
  const connected = data?.account_id != null;
  // `propertyMissing` is only meaningful WITH a connection: an unconnected project has no
  // mapping to be missing, and reporting one would put the pick-a-property rung on a card whose
  // answer is connect_gsc.
  return { connected, propertyMissing: connected && data?.gsc_property == null };
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
  domain: string,
  now: Date,
  loadTokenStatus: LoadTokenStatusFn,
  checkDomain: CheckDomainFn,
): Promise<ProjectSignals> {
  const [crawl, pull, gscLink, tokenStatus, reachability] = await Promise.all([
    getLatestSucceededResult(client, { projectId, userId, tool: "crawl_site" }),
    getLatestSucceededResult(client, { projectId, userId, tool: "pull_gsc_data" }),
    readGscLink(client, userId, projectId),
    loadTokenStatus(userId, projectId),
    // BEST-EFFORT, and unlike the health read above that is not an inconsistency — it is this
    // port's whole contract. "Unknown" is one of its three legitimate answers (see
    // domain-reachability.ts), so a rejection collapsing to "unknown" says exactly what a
    // timeout says: nobody found out. The health read throws because there "active" would be a
    // FABRICATED answer; here there is a real value for "did not find out".
    checkDomain(domain).catch(() => "unknown" as const),
  ]);
  return {
    hasCrawl: crawl !== null,
    crawlFresh: crawl !== null && isFresh(crawl.createdAt, now),
    // The AGE, not just the verdict — measured through @pseo/core's `dataAgeInDays`, the same
    // function generate_report's own age line goes through, so the router can no longer call a
    // crawl "fresh" while the report calls it "16 days ago" and neither says what the other means.
    crawlAgeDays: crawl === null ? null : dataAgeInDays(crawl.createdAt, now),
    gscConnected: gscLink.connected,
    // A live account with no property mapped to it. Reported so the ladder can send the user to
    // pick one instead of to a pull that cannot run (rung 4b).
    gscPropertyMissing: gscLink.propertyMissing,
    hasPull: pull !== null,
    pullFresh: pull !== null && isFresh(pull.createdAt, now),
    pullAgeDays: pull === null ? null : dataAgeInDays(pull.createdAt, now),
    // Only a stored 'invalid' is a death. A null status (no connection, no linked account) is
    // "nothing known to be wrong", which the ladder must treat as the pre-signal case.
    gscTokenInvalid: tokenStatus === "invalid",
    // ONLY a positive "no such name" — never a check that failed to run. See the port.
    domainUnreachable: reachability === "no_such_domain",
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
  loadTokenStatus: LoadTokenStatusFn,
  checkDomain: CheckDomainFn,
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
    const signals = await readProjectSignals(
      getServiceClient(),
      userId,
      input.projectId,
      project.domain,
      now,
      loadTokenStatus,
      checkDomain,
    );
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
    const signals = await readProjectSignals(
      client,
      userId,
      only.id,
      only.domain,
      now,
      loadTokenStatus,
      checkDomain,
    );
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
  /**
   * Connection-health reader (default: the real tenant-scoped loadGscTokenStatus). A PORT for
   * the same reason `loadProject` is one, plus a sharper one: this reader's FAILURE mode is a
   * deliberate decision — it throws where gsc-discovery-shared.ts swallows — and a decision with
   * no seam has no test. Ignored when `loadState` is injected, which replaces the whole loader.
   */
  readonly loadTokenStatus?: LoadTokenStatusFn;
  /**
   * DNS reachability for the project's domain (default: the real capped lookup). A PORT because
   * the DESIGN forbids a spec touching a resolver: a test that made a real lookup would be slow,
   * flaky, and — for the case that matters, a name that does not exist — would be asserting
   * something about the internet rather than about this code. Ignored when `loadState` is
   * injected, which replaces the whole loader.
   */
  readonly checkDomain?: CheckDomainFn;
}

const inputSchema = z.object({
  project_id: z
    .uuid()
    .optional()
    .describe(
      "Optional project to route from (from setup_project / list_projects). Omit it and whats_next " +
        "routes your only project; if you track several, it lists them and asks which one.",
    ),
});

type WhatsNextInput = z.infer<typeof inputSchema>;

export function makeWhatsNextTool(deps: WhatsNextDeps = {}): RegisteredTool {
  const now = deps.now ?? (() => new Date());
  const loadProject = deps.loadProject ?? loadOwnProject;
  const loadTokenStatus = deps.loadTokenStatus ?? loadGscTokenStatus;
  const checkDomain = deps.checkDomain ?? checkDomainReachable;
  const loadState =
    deps.loadState ??
    ((userId, input) =>
      loadWhatsNextState(userId, input, now(), loadProject, loadTokenStatus, checkDomain));
  return defineTool<WhatsNextInput>({
    name: "whats_next",
    description:
      "Not sure what to do next? whats_next looks at where your project stands — crawl, audits, " +
      "Search Console, reports — and tells you the single best next step, with a short reason, " +
      "what each step costs, and what comes after. Free (0 credits). Pass a project_id to route " +
      "that project; omit it and it routes your only project, or lists them and asks which one " +
      "if you track several.",
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
