import type { FetchLike } from "@pseo/core";

/**
 * Google-side revocation for the ACCOUNT-level disconnect. Deleting the `gsc_accounts` row
 * drops OUR copy of the sealed refresh token; only this call makes GOOGLE forget the grant,
 * so the entry also disappears from the user's myaccount.google.com/permissions list. Both
 * halves are needed for "Disconnect" to mean what a user thinks it means.
 *
 * Since migration 0021 the credential is per-ACCOUNT, so this is reached from exactly one
 * place: `disconnectAccount` in apps/web/app/app/connection/actions.ts. The project MAPPINGS
 * are not part of either half — `gsc_connections.account_id` is `on delete set null`, so the
 * rows survive the deletion with their properties intact. The per-project `unmapProject`
 * clears those columns and NEVER comes here: the grant it would revoke is shared by every
 * project on the account, and revoking it from a per-project button is finding #63.
 *
 * The endpoint takes an injectable `fetch` (the @pseo/core Google-client convention), so
 * tests exercise it with zero real requests to Google (constitution NEVER #5).
 */

const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/**
 * Ask Google to revoke ONE refresh token. Revoking a refresh token invalidates the whole
 * grant — every access token derived from it — which is exactly what Disconnect promises.
 *
 * BEST-EFFORT by contract: this never throws and never logs.
 *   - never throws, so a Google-side failure can NEVER block the local deletion that
 *     follows it — the part we actually control is the part we must guarantee;
 *   - never logs, because failure here is routine and unactionable: a token Google already
 *     considers dead answers 400 `invalid_token`, and a transient network error says
 *     nothing an operator could act on. A log line would be pure noise on a path that is
 *     EXPECTED to fail for already-revoked grants.
 * The token is never logged, returned, or embedded in an error — the boolean says only
 * whether Google acknowledged, for callers (and tests) that care.
 */
export async function revokeGoogleToken(
  refreshToken: string,
  deps: { readonly fetch?: FetchLike } = {},
): Promise<boolean> {
  const doFetch = deps.fetch ?? fetch;
  try {
    const response = await doFetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}
