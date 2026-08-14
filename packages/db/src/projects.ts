import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDomain } from "@pseo/core";
import type { Database } from "./types.js";

/**
 * THE project-opening route — one implementation, two surfaces.
 *
 * It was born inside `apps/mcp/src/tools/setup-project.ts` and moved here the moment a SECOND
 * surface needed to open a project: /app/projects grew an "Add domain" form. A form that wrote
 * its own insert would have been a second creation route, and the thing that makes a second
 * route dangerous is not the duplicated upsert — it is the GATE that only one of them runs.
 * `normalizeDomain` (@pseo/core) refuses internal / reserved names (`foo.internal`, `x.local`,
 * `a.test`) that a shape check accepts; a route that skips it writes those rows straight past a
 * gate the other route enforces. That exact disagreement has already happened once on this
 * codebase (the web's `trackProperty` opened projects for `sc-domain:foo.internal` while the MCP
 * tools refused them), which is why the gate lives INSIDE `openTrackedProject` rather than at
 * each caller: a caller cannot forget what it does not perform.
 *
 * The client is a PARAMETER — this module builds none. apps/mcp hands it its own lazy
 * service-role singleton, apps/web hands it `createServiceClient()`; neither surface's env
 * wiring is imported by the other, and nothing here can pick up a client by accident.
 *
 * Idempotent by (user_id, domain): a second call for the same site returns the existing project
 * rather than creating a duplicate. A tenant-scoped read-first serves the common repeat call,
 * and the residual race of two truly-simultaneous first calls is closed at the DB level — the
 * (user_id, domain) unique constraint (migration 0010) plus an ON CONFLICT DO NOTHING upsert:
 * the loser's insert is a no-op and it reads back the winner's row, so two concurrent first
 * calls still produce ONE row with consistent created: true/false flags.
 *
 * Idempotency covers the ARCHIVE too: a domain the tenant had archived comes back on its
 * original id (archived_at cleared) instead of being registered a second time — see
 * resolveExisting.
 *
 * Every read and every write carries an explicit user_id filter: these clients are service-role
 * and bypass RLS, so that filter is the tenant boundary (constitution NEVER #4). Nothing here
 * touches `credit_ledger` — opening a project is free.
 */

/** The service-role client this module borrows. It is never constructed here. */
export type ProjectsClient = SupabaseClient<Database>;

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
 * Normalize the domain, then create the project, return the existing one, or restore it from
 * the archive — the whole invariant described in this module's header, in one function.
 *
 * The normalization is the FIRST thing it does and it is not optional for anyone: both
 * `track_gsc_property` (which derives a domain from a Search Console property with
 * `propertyToDomain`, a SHAPE check) and the panel form (which takes whatever the user typed)
 * arrive here with a string that has passed no host gate at all.
 */
export async function openTrackedProject(
  client: ProjectsClient,
  userId: string,
  rawDomain: string,
): Promise<ProjectResolution> {
  const normalized = normalizeDomain(rawDomain);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  const { domain } = normalized;

  const existing = await readProject(client, userId, domain);
  if (existing) {
    return await resolveExisting(client, userId, domain, existing);
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
  return await resolveExisting(client, userId, domain, winner);
}

/** An existing project row as this module needs it: its id and whether it sits in the archive. */
type ProjectRow = { readonly id: string; readonly archived_at: string | null };

/**
 * Tenant-scoped read of a project by (user_id, domain); null when absent. Deliberately
 * unfiltered on archived_at: an archived row still OCCUPIES the (user_id, domain) unique
 * slot (migration 0010), so hiding it here would only send the insert into a conflict it
 * cannot resolve.
 */
async function readProject(
  client: ProjectsClient,
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
  client: ProjectsClient,
  userId: string,
  domain: string,
  row: ProjectRow,
): Promise<ProjectResolution> {
  if (row.archived_at === null) {
    return { ok: true, project: { id: row.id, domain, outcome: "existing" } };
  }
  if (!(await restoreOwnProject(client, userId, row.id))) {
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
export async function restoreOwnProject(
  client: ProjectsClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await client
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
