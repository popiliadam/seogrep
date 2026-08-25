import { z } from "zod";
import { normalizeDomain, type NormalizedDomain } from "@pseo/core";
import {
  openTrackedProject as openTrackedProjectWith,
  restoreOwnProject as restoreOwnProjectWith,
  type ProjectOutcome,
  type ProjectResolution,
  type ProjectsClient,
  type TrackedProject,
} from "@pseo/db/projects";
import type { Database as GeneratedSchema } from "@pseo/db/types";
import { getServiceClient, type Database as GatewaySchema } from "../db.ts";
import {
  checkDomainReachable,
  reachabilityWarning,
  type CheckDomainFn,
} from "./domain-reachability.ts";
import { defineTool, errorResult, textResult, type RegisteredTool } from "./registry.ts";

/**
 * setup_project — register (or return) a tracked domain for the tenant. 0 credits.
 *
 * THE ROUTE ITSELF NO LONGER LIVES HERE. `openTrackedProject` moved to `@pseo/db/projects`
 * when /app/projects grew an "Add domain" form: two surfaces open projects, and the whole
 * point of one route is that the `normalizeDomain` gate inside it cannot be forgotten by a
 * caller. That module's header carries the invariants (idempotent by (user_id, domain),
 * race-safe upsert, archive restore, explicit tenant filters).
 *
 * What stays here is what is genuinely this tool's own: the service-role client it hands the
 * shared route, and setup_project's own wording for each outcome. Everything the previous
 * callers imported from this module — `openTrackedProject`, `restoreOwnProject`,
 * `normalizeDomain`, the three types, `setupProjectTool` — is still exported from here with
 * the same signatures, so `track-gsc-property.ts`, `project-target.ts` and
 * `compare-competitors.ts` are untouched.
 */

/**
 * The domain canonicalizer, re-exported from its home in @pseo/core (net/hostname).
 * `import` + a separate `export` rather than `export … from`, because a re-export creates no
 * local binding — the exact mistake Task 2 made and caught. It is re-exported (not merely
 * available from core) because this module's own specs and several callers import it here.
 */
export { normalizeDomain };
export type { NormalizedDomain, ProjectOutcome, ProjectResolution, TrackedProject };

/** `T`, but only while `A` and `B` are mutually assignable — otherwise `never`. */
type IfSameShape<A, B, T> = [A] extends [B] ? ([B] extends [A] ? T : never) : never;

/**
 * apps/mcp keeps its own hand-written `Database` slice (src/db.ts) while @pseo/db carries the
 * GENERATED one, so the two `SupabaseClient<…>` instantiations are different TYPES describing
 * the same rows of the same table, and handing one to the other needs a cast.
 *
 * The cast is confined to this one function and it is not taken on faith: the return type below
 * collapses to `never` the moment this app's `projects` slice and @pseo/db's stop being mutually
 * assignable, and a function that returns `never` cannot return a client — so the drift lands as
 * a typecheck failure (the gate's own step) rather than as a cast that has quietly become a lie.
 * Row AND Insert AND Update are compared, because the shared route reads, inserts and updates.
 */
type CheckedProjectsClient = IfSameShape<
  GatewaySchema["public"]["Tables"]["projects"]["Row"],
  GeneratedSchema["public"]["Tables"]["projects"]["Row"],
  IfSameShape<
    GatewaySchema["public"]["Tables"]["projects"]["Insert"],
    GeneratedSchema["public"]["Tables"]["projects"]["Insert"],
    IfSameShape<
      GatewaySchema["public"]["Tables"]["projects"]["Update"],
      GeneratedSchema["public"]["Tables"]["projects"]["Update"],
      ProjectsClient
    >
  >
>;

function projectsClient(): CheckedProjectsClient {
  return getServiceClient() as unknown as ProjectsClient;
}

/** setup_project's route, on this app's service-role client. Signature unchanged. */
export async function openTrackedProject(
  userId: string,
  rawDomain: string,
): Promise<ProjectResolution> {
  return await openTrackedProjectWith(projectsClient(), userId, rawDomain);
}

/** Clear `archived_at` on ONE of this tenant's projects. Signature unchanged. */
export async function restoreOwnProject(userId: string, projectId: string): Promise<boolean> {
  return await restoreOwnProjectWith(projectsClient(), userId, projectId);
}

/** setup_project's own wording for each outcome — unchanged, and its alone. */
function renderSetupOutcome(project: TrackedProject): string {
  if (project.outcome === "created") {
    return `Created project for "${project.domain}" (project_id: ${project.id}, created: true).`;
  }
  if (project.outcome === "restored") {
    return (
      `Restored "${project.domain}" from your archive — it is tracked again ` +
      `(project_id: ${project.id}, created: false).`
    );
  }
  return `Project already exists for "${project.domain}" (project_id: ${project.id}, created: false).`;
}

/** Dependencies — both ports exist so the fast lane can run this handler with no DB and no DNS. */
export interface SetupProjectDeps {
  /**
   * Reachability check (default: the real capped DNS lookup). A PORT because the design forbids
   * a spec touching a resolver: the case that matters is a name that does NOT exist, and asserting
   * that against the real internet is asserting something about DNS rather than about this tool.
   */
  readonly checkDomain?: CheckDomainFn;
  /**
   * The shared open-or-return route (default: the real one, on the service-role client). A PORT
   * for the reason audit-shared.ts states about `loadProject`: the default reaches
   * `getServiceClient`, which needs the full prod env, so without this seam the handler — and
   * therefore the warning's placement relative to the WRITE — has no fast-lane proof at all.
   */
  readonly openProject?: (userId: string, rawDomain: string) => Promise<ProjectResolution>;
}

export function makeSetupProjectTool(deps: SetupProjectDeps = {}): RegisteredTool {
  const checkDomain = deps.checkDomain ?? checkDomainReachable;
  const openProject = deps.openProject ?? openTrackedProject;
  return defineTool({
    name: "setup_project",
    description:
      "Register a website domain to track. Accepts a domain or URL; returns the project id. " +
      "Idempotent — calling it again for the same domain returns the existing project. " +
      "Warns (but still registers) when the domain does not resolve. Costs 0 credits.",
    inputSchema: z.object({
      domain: z
        .string()
        .min(1)
        .describe("The website to track, e.g. \"example.com\" or \"https://example.com\"."),
    }),
    handler: async (ctx, { domain }) => {
      const resolved = await openProject(ctx.userId, domain);
      if (!resolved.ok) return errorResult(resolved.error);
      // THE CHECK RUNS AFTER THE WRITE, and that ordering is the answer to "can it block
      // registration?". The row is committed before the first DNS packet leaves; a resolver that
      // hangs can only delay this reply, by at most DOMAIN_LOOKUP_TIMEOUT_MS, and cannot cost the
      // caller their project. It is also asked about `resolved.project.domain` — the CANONICAL
      // name, after the case / scheme / `www.` normalization — so the name checked is the name
      // the crawler will later fetch, not whatever the caller happened to paste.
      const reachability = await checkDomain(resolved.project.domain);
      return textResult(
        renderSetupOutcome(resolved.project) +
          reachabilityWarning(resolved.project.domain, reachability),
      );
    },
  });
}

/** The production setup_project tool (real DNS port). */
export const setupProjectTool = makeSetupProjectTool();
