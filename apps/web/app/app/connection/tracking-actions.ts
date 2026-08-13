"use server";

import { revalidatePath } from "next/cache";
import { normalizeDomain, propertyToDomain } from "@pseo/core";
import { createServiceClient } from "@pseo/db/server";
import { canQuerySearchAnalytics } from "../../../lib/gsc/oauth";
import {
  CONNECTION_PATH,
  readAccountSites,
  requireUserId,
  UUID_RE,
  type SavePropertyDeps,
  type SavePropertyResult,
  type ServiceClient,
} from "./action-support";

/**
 * TRACK · UNTRACK · RESTORE — /app/connection's half of the three verbs the MCP tools
 * `track_gsc_property` and `untrack_project` already answer.
 *
 * THE TWO SURFACES MAY NOT DISAGREE ABOUT THE SAME ACTION, so nothing below is re-decided;
 * every ruling is carried over:
 *
 *   1. VALIDATION ORDER IS PART OF THE CONTRACT — listed → queryable → recognisable domain →
 *      project → mapping. Steps 2 and 3 refuse BEFORE any project row exists, because a
 *      project SeoGrep cannot answer for is worse than no project: it reads as tracked and
 *      returns nothing (measured live 2026-08-09 on bayder.com.tr and rkturizm.com).
 *   2. NOTHING ARRIVING FROM THE BROWSER IS EVIDENCE. The property is accepted only because a
 *      live `sites.list` on the named account returned it — the picker greys out the rest, but
 *      a disabled `<option>` is a courtesy and this is the control.
 *   3. FAIL CLOSED ON A LISTING WE NEVER GOT BACK. An absence we did not observe is not an
 *      absence, so an unreadable account tracks nothing at all. This is the single-account
 *      shape of `track_gsc_property`'s undecidable refusal (controller ruling, 2026-08-13):
 *      the web action always NAMES its account, so no second account is ever consulted and the
 *      "one answered, another did not" state cannot arise on this surface.
 *   4. SILENT RE-POINTING STAYS (controller ruling, 2026-08-13). A project already mapped to a
 *      different property is re-pointed with no warning — `saveProjectProperty` (./actions), the
 *      picker's Save, does the byte-identical upsert on the same table.
 *   5. ARCHIVE, NEVER DELETE. A DELETE would cascade `gsc_connections` away and orphan every
 *      job (`jobs.project_id` is `on delete set null`); stamping `archived_at` keeps the row,
 *      its history AND its Search Console mapping, which is what makes coming back free.
 *   6. EVERY UPDATE PROVES IT MATCHED A ROW. PostgREST answers a zero-row UPDATE with no error
 *      at all, so `error === null` says nothing was WRONG, never that anything was WRITTEN.
 *
 *   7. THE HOST GATE IS SHARED, not re-decided. `track_gsc_property` refuses internal /
 *      reserved names (`foo.internal`, `x.local`) that `propertyToDomain` accepts on shape
 *      alone, and until Task 8.5 this surface did not — it OPENED a project for
 *      `sc-domain:foo.internal`, measured, which is exactly the disagreement rule 1 forbids.
 *      The cause was structural rather than a decision: the gate lived in the MCP crawler and
 *      apps/web could not import it, and copying its reserved-TLD list here would have been a
 *      SECOND copy of a security list. `normalizeDomain` now lives in @pseo/core and BOTH
 *      surfaces call it — one list, one verdict.
 *
 * Refusals are RETURNED, not thrown, because every one of them is something the user can act
 * on and the caller shows the sentence as-is. Only a missing session throws (there is no user
 * to address) and only a failed READ throws (`saveProjectProperty`'s existing split).
 */

/** A project this tenant owns, and whether it currently sits in the archive. */
interface OwnedProject {
  readonly id: string;
  readonly archivedAt: string | null;
}

/** A project request that resolved, or the one sentence explaining why it could not. */
type OpenedProject =
  | { readonly ok: true; readonly projectId: string }
  | { readonly ok: false; readonly error: string };

/** The same opaque sentence for a malformed id, a missing project and another tenant's. */
const PROJECT_NOT_FOUND = "That project was not found.";
const ACCOUNT_NOT_FOUND = "That Google account was not found.";
const NOT_LISTED = "That property is not listed on this Google account.";
const COULD_NOT_TRACK = "Could not start tracking that property. Please try again.";

/**
 * What an `archived_at` write actually did. Three outcomes rather than a boolean because the
 * caller owes the user a different sentence for each: the write landed, the write was fine but
 * matched NO row (property 6 above — the project changed under us), or the statement failed.
 */
type ArchiveWrite = "written" | "no_row" | "failed";

/**
 * Stamp or clear `archived_at` on ONE of this tenant's projects.
 *
 * BOTH filters ride on the UPDATE (constitution NEVER #4). That is not a duplicate of the read
 * that found the row: this client is service-role and bypasses RLS, so this `.eq` is the only
 * thing standing between a stray project id and another tenant's row.
 *
 * …and the row comes back, because a zero-row UPDATE is not an error in PostgREST.
 */
async function writeArchivedAt(
  service: ServiceClient,
  userId: string,
  projectId: string,
  archivedAt: string | null,
  label: string,
): Promise<ArchiveWrite> {
  const { data, error } = await service
    .from("projects")
    .update({ archived_at: archivedAt })
    .eq("id", projectId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error(`${label}: projects archived_at write failed:`, error.message);
    return "failed";
  }
  return data === null ? "no_row" : "written";
}

/** Tenant-scoped read of one project by id; null for missing AND for another tenant's. */
async function readOwnProjectById(
  service: ServiceClient,
  userId: string,
  projectId: string,
): Promise<OwnedProject | null> {
  const { data, error } = await service
    .from("projects")
    .select("id, archived_at")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`projects lookup failed: ${error.message}`);
  }
  return data ? { id: data.id, archivedAt: data.archived_at } : null;
}

/**
 * Tenant-scoped read of one project by domain. Deliberately UNFILTERED on `archived_at`: an
 * archived row still occupies the (user_id, domain) unique slot (migration 0010), so hiding it
 * here would only send the insert into a conflict it cannot resolve.
 */
async function readOwnProjectByDomain(
  service: ServiceClient,
  userId: string,
  domain: string,
): Promise<OwnedProject | null> {
  const { data, error } = await service
    .from("projects")
    .select("id, archived_at")
    .eq("user_id", userId)
    .eq("domain", domain)
    .maybeSingle();
  if (error) {
    throw new Error(`projects lookup failed: ${error.message}`);
  }
  return data ? { id: data.id, archivedAt: data.archived_at } : null;
}

/** Report the row that already holds this domain — bringing it back first when it is archived. */
async function resolveExistingProject(
  service: ServiceClient,
  userId: string,
  row: OwnedProject,
): Promise<OpenedProject> {
  if (row.archivedAt === null) {
    return { ok: true, projectId: row.id };
  }
  const written = await writeArchivedAt(service, userId, row.id, null, "trackProperty");
  if (written === "written") {
    return { ok: true, projectId: row.id };
  }
  return {
    ok: false,
    error:
      written === "no_row"
        ? "That project changed while this was running, so nothing was tracked. Please try again."
        : COULD_NOT_TRACK,
  };
}

/**
 * Open the project for a domain: return the active one, bring the archived one back on its own
 * id, or create it. Restoring is the only correct answer for an archived row — a second row is
 * impossible (unique (user_id, domain), migration 0010) and would in any case orphan the
 * crawls, reports and Search Console link hanging off the original id.
 *
 * The insert is race-safe: ON CONFLICT (user_id, domain) DO NOTHING (`ignoreDuplicates`). A row
 * comes back ONLY when THIS call inserted it; an empty answer means a concurrent first call won
 * the slot between our read and this write, so we read the winner back instead.
 */
async function openProjectForDomain(
  service: ServiceClient,
  userId: string,
  domain: string,
): Promise<OpenedProject> {
  const existing = await readOwnProjectByDomain(service, userId, domain);
  if (existing) {
    return resolveExistingProject(service, userId, existing);
  }

  const upserted = await service
    .from("projects")
    .upsert({ user_id: userId, domain }, { onConflict: "user_id,domain", ignoreDuplicates: true })
    .select("id");
  if (upserted.error) {
    console.error("trackProperty: projects upsert failed:", upserted.error.message);
    return { ok: false, error: COULD_NOT_TRACK };
  }
  const insertedId = upserted.data?.[0]?.id;
  if (insertedId) {
    return { ok: true, projectId: insertedId };
  }

  const winner = await readOwnProjectByDomain(service, userId, domain);
  if (!winner) {
    console.error("trackProperty: projects upsert reported a conflict but no row was found");
    return { ok: false, error: COULD_NOT_TRACK };
  }
  return resolveExistingProject(service, userId, winner);
}

/**
 * Start tracking ONE Search Console property: open its project (or bring it back from the
 * archive) and map the property to it. The header above states every rule this obeys; the
 * numbered steps below are the order those rules are applied in, and the order IS the contract.
 */
export async function trackProperty(
  accountId: string,
  property: string,
  deps: SavePropertyDeps = {},
): Promise<SavePropertyResult> {
  const userId = await requireUserId();
  if (!UUID_RE.test(accountId)) {
    return { ok: false, error: ACCOUNT_NOT_FOUND };
  }
  // An empty choice can never be listed — refuse it before spending a Google round trip on a
  // foregone answer.
  if (property.length === 0) {
    return { ok: false, error: NOT_LISTED };
  }

  const service = createServiceClient();

  // STEP 1 — is it actually listed? Asked LIVE, of the account the caller named.
  const listing = await readAccountSites(service, accountId, userId, "trackProperty", deps);
  if (!listing.ok) {
    return listing;
  }
  const hit = listing.sites.find((site) => site.siteUrl === property);
  if (!hit) {
    return { ok: false, error: NOT_LISTED };
  }

  // STEP 2 — queryable? Refuse BEFORE opening a project.
  if (!canQuerySearchAnalytics(hit.permissionLevel)) {
    return {
      ok: false,
      error:
        `This account cannot query that property (${hit.permissionLevel}) — ask its owner for ` +
        "full access. No project was opened for it.",
    };
  }

  // STEP 3 — does the property name a website at all? (android-app:// ones do not.)
  const domain = propertyToDomain(property);
  if (domain === null) {
    return {
      ok: false,
      error:
        `SeoGrep does not recognise "${property}" as a Search Console property for a website, ` +
        "so there is nothing to track. Domain properties (sc-domain:example.com) and URL-prefix " +
        "properties (https://example.com/) are supported.",
    };
  }

  // STEP 4 — may that host be tracked AT ALL? `propertyToDomain` only checks a domain's
  // SHAPE, so it accepts internal / reserved names (`foo.internal`, `x.local`, `a.test`) that
  // `normalizeDomain` refuses. This is the SAME gate `openTrackedProject` (apps/mcp) applies —
  // one implementation in @pseo/core since Task 8.5, not a second copy — so both surfaces now
  // answer the same verb the same way. The server's own sentence is what the user sees; it
  // names the reason without echoing anything the browser sent.
  const normalized = normalizeDomain(domain);
  if (!normalized.ok) {
    return { ok: false, error: `${normalized.error} No project was opened for it.` };
  }

  // STEP 5 — the project.
  const opened = await openProjectForDomain(service, userId, normalized.domain);
  if (!opened.ok) {
    return opened;
  }

  // STEP 6 — the mapping. Same write as saveProjectProperty, including the silent re-point:
  // the tenant id rides BOTH as a column and inside the conflict target, so the row can only
  // ever land on this tenant's (user_id, project_id) slot (NEVER #4).
  const { error } = await service.from("gsc_connections").upsert(
    {
      user_id: userId,
      project_id: opened.projectId,
      account_id: accountId,
      gsc_property: property,
    },
    { onConflict: "user_id,project_id" },
  );
  if (error) {
    console.error("trackProperty: gsc_connections upsert failed:", error.message);
    return { ok: false, error: "Could not save that property. Please try again." };
  }
  revalidatePath(CONNECTION_PATH);
  return { ok: true };
}

/**
 * Stop tracking one project by ARCHIVING it. `gsc_connections` is left completely alone — the
 * surviving mapping is exactly what makes {@link restoreProject} (and `track_gsc_property`)
 * free, so this action never touches it. It never touches `credit_ledger` either (NEVER #2).
 *
 * Idempotent, and WITHOUT re-stamping: an already-archived project is a success and no write
 * runs, so the date the tenant actually put the project away survives a second call.
 */
export async function untrackProject(projectId: string): Promise<SavePropertyResult> {
  const userId = await requireUserId();
  if (!UUID_RE.test(projectId)) {
    return { ok: false, error: PROJECT_NOT_FOUND };
  }
  const service = createServiceClient();
  const project = await readOwnProjectById(service, userId, projectId);
  if (!project) {
    // A missing project and another tenant's leave through the SAME sentence, so this cannot
    // be used to learn which project ids exist.
    return { ok: false, error: PROJECT_NOT_FOUND };
  }
  if (project.archivedAt !== null) {
    // Nothing to write — but the page that offered this button believed the project was
    // tracked, and it is not. Revalidating is how that stale view converges on the truth;
    // without it the row keeps offering an Untrack that appears to do nothing.
    revalidatePath(CONNECTION_PATH);
    return { ok: true };
  }
  const written = await writeArchivedAt(
    service,
    userId,
    projectId,
    new Date().toISOString(),
    "untrackProject",
  );
  if (written === "no_row") {
    return {
      ok: false,
      error:
        "That project changed while this was running, so nothing was archived. Please try again.",
    };
  }
  if (written === "failed") {
    return { ok: false, error: "Could not stop tracking that project. Please try again." };
  }
  revalidatePath(CONNECTION_PATH);
  return { ok: true };
}

/**
 * Bring one archived project back. It returns on its own id with its crawls, its reports and
 * its Search Console mapping exactly as they were, which is the whole reason untracking
 * archives instead of deleting.
 *
 * Idempotent in the other direction: restoring a project that is already tracked is a success
 * and writes nothing.
 */
export async function restoreProject(projectId: string): Promise<SavePropertyResult> {
  const userId = await requireUserId();
  if (!UUID_RE.test(projectId)) {
    return { ok: false, error: PROJECT_NOT_FOUND };
  }
  const service = createServiceClient();
  const project = await readOwnProjectById(service, userId, projectId);
  if (!project) {
    return { ok: false, error: PROJECT_NOT_FOUND };
  }
  if (project.archivedAt === null) {
    // Same reason as untrackProject's twin: nothing was written, but the view that offered
    // Restore was wrong about where this project stood, and only a revalidate corrects it.
    revalidatePath(CONNECTION_PATH);
    return { ok: true };
  }
  const written = await writeArchivedAt(service, userId, projectId, null, "restoreProject");
  if (written === "no_row") {
    return {
      ok: false,
      error:
        "That project changed while this was running, so nothing was restored. Please try again.",
    };
  }
  if (written === "failed") {
    return { ok: false, error: "Could not restore that project. Please try again." };
  }
  revalidatePath(CONNECTION_PATH);
  return { ok: true };
}
