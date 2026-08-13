import { listSites, type GscSite } from "@pseo/core";
import { createServiceClient } from "@pseo/db/server";
import { accessTokenFor } from "../../../lib/gsc/accounts";
import { createClient } from "../../../lib/supabase/server";

/**
 * What /app/connection's server actions SHARE — and the reason it is a module of its own.
 *
 * A `"use server"` file may export nothing but async functions. Next refuses to build one that
 * exports a constant, so the moment the actions were split across two `"use server"` modules
 * (`./actions` and `./tracking-actions`, Task 8.5) their shared constants, types and synchronous
 * helpers had nowhere to live except here. This file carries NO directive: it is imported by
 * server modules only, and nothing in it is an action.
 *
 * It is also not a client module, deliberately. `./choice` is the file for values that cross the
 * RSC boundary; everything here touches the service-role client or the session, so it must never
 * be imported from a `"use client"` module (a TYPE import is erased and therefore fine — that is
 * how `property-picker.tsx` reaches `SavePropertyResult`).
 *
 * WHY THE TYPES LIVE HERE AND NOT BESIDE THEIR ACTIONS, measured rather than assumed: a
 * `"use server"` module may not RE-EXPORT them either. `export type { SavePropertyResult }` from
 * `./actions` compiles under tsc and then fails the Turbopack build —
 * "Export SavePropertyResult doesn't exist in target module" — because the server-actions
 * transform enumerates a `"use server"` module's exports before the types are erased and tries to
 * mint an action id for each. An INLINE `export type X = …` declaration is fine (that is how
 * `GeneratedKeyResult` still lives in ./actions); a re-export of an imported name is not.
 */

/** The path every mutation revalidates: the connection page renders all of this state. */
export const CONNECTION_PATH = "/app/connection";

/** Client-supplied ids are checked for shape before they reach a query. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The session user, or a throw. Every action re-derives the user from the validated session —
 * NEVER from a client-supplied value — and touches only that user's rows.
 */
export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user.id;
}

/** What a caller gets back: a success, or one sentence it may show the user verbatim. */
export type SavePropertyResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * The sentence every action owes a request aimed at an ARCHIVED project. It names the way back
 * rather than the refusal alone, because the project is not gone — /app/connection lists it in
 * the archive with a Restore button, and that is the one click this asks for.
 *
 * It is the web wording of the MCP tools' `ARCHIVED_PROJECT_MESSAGE` (project-target.ts): same
 * verdict, surface-appropriate route back.
 */
export const ARCHIVED_PROJECT =
  "That project is in the archive, so it is not being tracked right now. Restore it first.";

/** A project this tenant owns, and whether it currently sits in the archive. */
export interface OwnedProject {
  readonly id: string;
  readonly archivedAt: string | null;
}

/**
 * Tenant-scoped read of one project by id; null for missing AND for another tenant's.
 *
 * BOTH filters ride on the SELECT (constitution NEVER #4): this client is service-role and
 * bypasses RLS, so the `.eq("user_id", …)` is the only thing standing between a stray project
 * id and another tenant's row. Missing and foreign are indistinguishable on purpose, so no
 * caller can turn this into a probe for which project ids exist.
 *
 * It lives here rather than beside any one action because THREE actions across two
 * `"use server"` modules ask the same question — `saveProjectProperty` and `unmapProject`
 * (./actions), `untrackProject` and `restoreProject` (./tracking-actions) — and a second answer
 * to one question is a second truth.
 */
export async function readOwnProject(
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
 * The one outward call these actions make, injectable so tests reach zero live requests
 * (constitution NEVER #5).
 *
 * It is a parameter of an exported SERVER ACTION, so a caller can in principle supply it.
 * That buys them nothing: a function is not serializable across the action boundary, and even
 * a listing they somehow controlled would only let them store a property string against THEIR
 * OWN project — the account is still opened with `accessTokenFor`'s tenant-filtered read, so
 * every later Search Console call still runs on their own token and simply 403s. Nothing
 * crosses a tenant, and nothing is read that they could not already read.
 */
export interface SavePropertyDeps {
  readonly listSites?: (accessToken: string) => Promise<GscSite[]>;
}

/** One account's live Search Console listing, or the sentence explaining why we have none. */
export type AccountListing =
  | { readonly ok: true; readonly sites: readonly GscSite[] }
  | { readonly ok: false; readonly error: string };

/**
 * Read ONE connected account's `sites.list` LIVE, for the actions that must VERIFY a property
 * rather than trust what a browser sent. Shared by `saveProjectProperty` (./actions) and
 * `trackProperty` (./tracking-actions) because they ask Google the same question, and a second
 * answer to one question is a second truth.
 *
 * Nothing is cached, here or on the page: a property can be removed (or an account demoted)
 * between the render and the click, and re-reading is the only way the answer describes the
 * account as it is NOW.
 *
 * A dead credential, a retired encryption key, a foreign account id and a Google outage all
 * land in the same refusal — they are not distinguished for the USER, because every one of them
 * is answered by reconnecting the account — while the log keeps the diagnosis. Nothing from
 * `caught` is returned: its message can carry Google's own text, and this string reaches a
 * browser.
 */
export async function readAccountSites(
  service: ServiceClient,
  accountId: string,
  userId: string,
  label: string,
  deps: SavePropertyDeps,
): Promise<AccountListing> {
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error(`${label}: TOKEN_ENCRYPTION_KEY is not configured`);
    return { ok: false, error: "Search Console is not configured. Please try again later." };
  }
  try {
    const accessToken = await accessTokenFor(service, accountId, userId, encryptionKey);
    return { ok: true, sites: await (deps.listSites ?? listSites)(accessToken) };
  } catch (caught) {
    console.error(`${label}: could not read sites.list for account ${accountId}:`, caught);
    return {
      ok: false,
      error:
        "Could not read this Google account's properties. Reconnect the account and try again.",
    };
  }
}
