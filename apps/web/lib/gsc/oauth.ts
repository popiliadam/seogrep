import { GSC_READONLY_SCOPE, type GscSite } from "@pseo/mcp/src/gsc/client";

/**
 * Pure helpers for the GSC OAuth redirect + property resolution. Kept out of the route
 * handlers so both are unit-testable without a request. No secrets live here — the
 * consent URL carries only the PUBLIC client_id, the redirect, and the signed state.
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Build the Google OAuth 2.0 consent URL. `access_type=offline` + `prompt=consent` are
 * what make Google return a refresh token (and re-issue one even if the user consented
 * before) — without them there is nothing to seal at rest. Scope is read-only Search
 * Console: SeoGrep never requests write access to a property.
 */
export function buildConsentUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: GSC_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: params.state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`;
}

/**
 * Map a project domain to one of the account's verified Search Console properties.
 * Preference order (most complete data first):
 *   1. the domain property  `sc-domain:<domain>`  (covers every subdomain + scheme);
 *   2. url-prefix variants  https/http, apex + www, with the trailing slash GSC uses.
 * Host comparison is case-insensitive. Returns the property's exact `siteUrl` (as GSC
 * reports it) to store in `gsc_property`, or null when the account has none for it.
 */
export function matchGscProperty(domain: string, sites: readonly GscSite[]): string | null {
  const candidates = [
    `sc-domain:${domain}`,
    `https://${domain}/`,
    `https://www.${domain}/`,
    `http://${domain}/`,
    `http://www.${domain}/`,
  ].map((candidate) => candidate.toLowerCase());

  for (const candidate of candidates) {
    const match = sites.find((site) => site.siteUrl.toLowerCase() === candidate);
    if (match) {
      return match.siteUrl;
    }
  }
  return null;
}
