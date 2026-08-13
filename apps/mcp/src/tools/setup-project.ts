import { z } from "zod";
import { normalizeDomain, type NormalizedDomain } from "@pseo/core";
import { getServiceClient } from "../db.ts";
import { defineTool, errorResult, textResult } from "./registry.ts";

/**
 * setup_project — register (or return) a tracked domain for the tenant. 0 credits.
 * Idempotent by (user_id, domain): a second call for the same site returns the existing
 * project rather than creating a duplicate. A tenant-scoped read-first serves the common
 * repeat call, and the residual race of two truly-simultaneous first calls is closed at the
 * DB level — the (user_id, domain) unique constraint (migration 0010) plus an ON CONFLICT
 * DO NOTHING upsert: the loser's insert is a no-op and it reads back the winner's row, so two
 * concurrent first calls still produce ONE row with consistent created: true/false flags.
 *
 * Idempotency covers the ARCHIVE too: a domain the tenant had archived comes back on its
 * original id (archived_at cleared) instead of being registered a second time — see
 * resolveExisting.
 */

/**
 * The domain canonicalizer, re-exported from its new home in @pseo/core (net/hostname).
 * `import` + a separate `export` rather than `export … from`, because `openTrackedProject`
 * below CALLS it and `export … from` creates no local binding (the exact mistake Task 2 made
 * and caught).
 *
 * It moved because apps/web needs the SAME gate: the web's `trackProperty` was opening
 * projects for `sc-domain:foo.internal` that this tool refuses, and copying the reserved-TLD
 * list into apps/web would have been a second copy of a security list. Every caller here
 * (project-target.ts, compare-competitors.ts) and every pin is unchanged.
 */
export { normalizeDomain };
export type { NormalizedDomain };

/** What happened to the project row: it was inserted, it was already active, or it came back. */
export type ProjectOutcome = "created" | "existing" | "restored";

/** The project a tracking request landed on, and how it got there. */
export interface TrackedProject {
  readonly id: string;
  readonly domain: string;
  readonly outcome: ProjectOutcome;
}

/** A project request that resolved, or the one sentence explaining why it could not. */
export type ProjectResolution =
  | { readonly ok: true; readonly project: TrackedProject }
  | { readonly ok: false; readonly error: string };

/**
 * THE project-opening route: normalize the domain, then create the project, return the
 * existing one, or restore it from the archive — the whole invariant described in this
 * module's header, in one function.
 *
 * It is a function rather than inline handler code because setup_project is no longer its
 * only caller: track_gsc_property opens a project from a Search Console property string and
 * routes through HERE. That matters beyond tidiness. `propertyToDomain` (packages/core) only
 * checks a domain's SHAPE, so it accepts hosts `normalizeDomain` refuses — `foo.internal`,
 * `x.local`, `a.test`. A second creation route would write those rows straight past a gate
 * this one enforces; there is one route, so there is one gate.
 */
export async function openTrackedProject(
  userId: string,
  rawDomain: string,
): Promise<ProjectResolution> {
  const normalized = normalizeDomain(rawDomain);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  const { domain } = normalized;
  const client = getServiceClient();

  const existing = await readProject(client, userId, domain);
  if (existing) {
    return await resolveExisting(userId, domain, existing);
  }

  // Race-safe insert: ON CONFLICT (user_id, domain) DO NOTHING (ignoreDuplicates). A row is
  // returned ONLY when THIS call inserted it (created: true); an empty result means a
  // concurrent first call won the row between our read and this write, so we read it back
  // and report created: false — one row, consistent flags, no unique-violation surfaced.
  const upserted = await client
    .from("projects")
    .upsert({ user_id: userId, domain }, {
      onConflict: "user_id,domain",
      ignoreDuplicates: true,
    })
    .select("id");
  if (upserted.error) {
    throw new Error(`projects upsert failed: ${upserted.error.message}`);
  }
  const insertedId = upserted.data?.[0]?.id;
  if (insertedId) {
    return { ok: true, project: { id: insertedId, domain, outcome: "created" } };
  }

  const winner = await readProject(client, userId, domain);
  if (!winner) {
    throw new Error("projects upsert reported a conflict but no existing row was found");
  }
  return await resolveExisting(userId, domain, winner);
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

export const setupProjectTool = defineTool({
  name: "setup_project",
  description:
    "Register a website domain to track. Accepts a domain or URL; returns the project id. " +
    "Idempotent — calling it again for the same domain returns the existing project.",
  inputSchema: z.object({
    domain: z
      .string()
      .min(1)
      .describe("The website to track, e.g. \"example.com\" or \"https://example.com\"."),
  }),
  handler: async (ctx, { domain }) => {
    const resolved = await openTrackedProject(ctx.userId, domain);
    return resolved.ok
      ? textResult(renderSetupOutcome(resolved.project))
      : errorResult(resolved.error);
  },
});

/** An existing project row as this tool needs it: its id and whether it sits in the archive. */
type ProjectRow = { readonly id: string; readonly archived_at: string | null };

/**
 * Tenant-scoped read of a project by (user_id, domain); null when absent. Deliberately
 * unfiltered on archived_at: an archived row still OCCUPIES the (user_id, domain) unique
 * slot (migration 0010), so hiding it here would only send the insert into a conflict it
 * cannot resolve.
 */
async function readProject(
  client: ReturnType<typeof getServiceClient>,
  userId: string,
  domain: string,
): Promise<ProjectRow | null> {
  const { data, error } = await client
    .from("projects")
    .select("id, archived_at")
    .eq("user_id", userId)
    .eq("domain", domain)
    .maybeSingle();
  if (error) {
    throw new Error(`projects lookup failed: ${error.message}`);
  }
  return data;
}

/**
 * Report the row that already holds this domain — restoring it first when the tenant had
 * archived it. Restoring is the only correct answer there: a second row is impossible
 * (unique (user_id, domain), migration 0010), and would in any case orphan the crawls,
 * reports and Search Console link that hang off the original id. So setting a domain up
 * again picks the same project back up rather than starting an empty one.
 */
async function resolveExisting(
  userId: string,
  domain: string,
  row: ProjectRow,
): Promise<ProjectResolution> {
  if (row.archived_at === null) {
    return { ok: true, project: { id: row.id, domain, outcome: "existing" } };
  }
  if (!(await restoreOwnProject(userId, row.id))) {
    return { ok: false, error: notRestoredMessage(domain, row.id) };
  }
  return { ok: true, project: { id: row.id, domain, outcome: "restored" } };
}

/**
 * Clear `archived_at` on ONE of this tenant's projects; false when the write matched no row.
 *
 * BOTH filters ride on the UPDATE (constitution NEVER #4). That is not a duplicate of the read
 * that found the row: this client is service-role and bypasses RLS, so this `.eq` is the only
 * thing standing between a stray project id and another tenant's row.
 *
 * …and the row comes back, because a zero-row UPDATE is not an error in PostgREST. Without
 * `.select().maybeSingle()` this function could only report "nothing was WRONG", never that
 * anything was WRITTEN — and setup_project said "Restored …" on the strength of that. Its twin
 * `archiveOwnProject` (untrack-project.ts) has always asked for the row back; these two write
 * the same column on the same table and may not disagree about what success means.
 *
 * EXPORTED so the tenant filter is measurable. Through the tool, `readProject` refuses a
 * stranger before this runs, so mutating the filter away leaves every tool-level spec green;
 * the DB lane drives this function head-on with a mismatched (userId, projectId) pair instead.
 */
export async function restoreOwnProject(userId: string, projectId: string): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("projects")
    .update({ archived_at: null })
    .eq("id", projectId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`projects restore failed: ${error.message}`);
  }
  return data !== null;
}

/**
 * The restore matched no row although the read a moment earlier found one. Rare by
 * construction, and deliberately NOT reported as success: the caller asked for the domain to
 * be tracked again and it is still in the archive.
 */
function notRestoredMessage(domain: string, projectId: string): string {
  return (
    `Nothing was changed: "${domain}" (project_id: ${projectId}) is still in your archive — ` +
    "the update matched no row, so the project changed while this ran. Run list_projects to " +
    "see where it stands, then run setup_project again."
  );
}
