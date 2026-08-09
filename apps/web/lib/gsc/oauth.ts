import { GSC_READONLY_SCOPE, type GscSite } from "@pseo/core";

/**
 * Pure helpers for the GSC OAuth redirect + property resolution. Kept out of the route
 * handlers so both are unit-testable without a request. No secrets live here — the
 * consent URL carries only the PUBLIC client_id, the redirect, and the signed state.
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Build the Google OAuth 2.0 consent URL. `access_type=offline` + `prompt=consent` are
 * what make Google return a refresh token (and re-issue one even if the user consented
 * before) — without them there is nothing to seal at rest. Scope is exactly the read-only
 * Search Console scope and nothing else: SeoGrep never requests write access, and we
 * deliberately do NOT set `include_granted_scopes` — incremental authorization would let
 * an unrelated previously-granted scope ride along on this token, blurring the one-scope
 * discipline this consent is meant to hold.
 *
 * `codeChallenge` is REQUIRED, not optional (L-10): PKCE that a caller can forget is PKCE
 * that eventually is forgotten, and the digest is safe to publish — it is the verifier behind
 * it, held in an httpOnly cookie (lib/gsc/pkce), that must never appear in a URL. Committing
 * to a challenge here is what lets Google refuse a code redeemed by anyone else.
 */
export function buildConsentUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: GSC_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`;
}

type HostPair = { readonly host: string; readonly apex: string; readonly counterpart: string };

/**
 * The hosts a project domain may legitimately be verified under: the domain as stored, its
 * apex form (ONE leading `www.` label dropped, NOTHING else — see the refusal note on
 * `gscPropertyCandidates`), and the counterpart of the stored host.
 *
 * Because the counterpart is derived by dropping OR adding `www.` — never both — a
 * `www.www.` host is not constructible. The previous list built exactly that for a `www.`
 * input by prepending unconditionally (measured live 2026-08-09 on www.noraninsaat.com).
 *
 * Returns null for an empty or `www.`-only input rather than emitting `sc-domain:` with
 * nothing after it: an unmatched connection is recoverable, a wrong match is not.
 */
function hostPair(domain: string): HostPair | null {
  // `projects.domain` is already a bare lowercased host (setup_project's normalizeDomain
  // parses it through URL and drops scheme/path/trailing dot), so trim+lowercase is the
  // whole normalisation this needs — it is defence for hand-inserted rows, not parsing.
  const host = domain.trim().toLowerCase();
  if (host.length === 0) return null;
  const apex = host.startsWith("www.") ? host.slice(4) : host;
  if (apex.length === 0) return null;
  return { host, apex, counterpart: host === apex ? `www.${host}` : apex };
}

/**
 * The verified-property strings we will accept for a project domain, in preference order:
 *   1. `sc-domain:<apex>` — a domain property carries the most data (every subdomain, both
 *      schemes), and the apex one covers the `www.` host too;
 *   2. `sc-domain:<www host>` — only when the project itself was stored with `www.`;
 *   3. url-prefix variants: https before http, stored host before its counterpart, with the
 *      trailing slash GSC reports.
 * All lowercase, de-duplicated, so an apex project yields exactly the five candidates this
 * list has always produced.
 *
 * WHY ONLY `www.` IS STRIPPED. `www.example.com` and `example.com` are the same registrable
 * domain and a domain property provably covers both. `blog.example.com` is not: subdomains
 * can belong to different people, so reducing one to its parent would let a project bind to
 * another party's property and pull THEIR Search Console data into this tenant. Google's end
 * does treat `sc-domain:example.com` as covering `blog.example.com`; we still refuse it,
 * because a property list cannot tell us whether whoever verified the apex meant to hand us
 * the subdomain's data. The refusal costs a missed match; the other direction costs someone
 * else's data. Pinned by the `blog.example.com` spec in oauth.test.ts.
 *
 * Exported for that pin — the candidate list is the part that has to be inspectable.
 */
export function gscPropertyCandidates(domain: string): readonly string[] {
  const pair = hostPair(domain);
  if (pair === null) return [];
  const { host, apex, counterpart } = pair;
  return [
    ...new Set([
      `sc-domain:${apex}`,
      `sc-domain:${host}`,
      `https://${host}/`,
      `https://${counterpart}/`,
      `http://${host}/`,
      `http://${counterpart}/`,
    ]),
  ];
}

/**
 * Map a project domain to one of the account's verified Search Console properties.
 * Host comparison is case-insensitive. Returns the property's exact `siteUrl` (as GSC
 * reports it) to store in `gsc_property`, or null when the account has none for it —
 * that string is written to `gsc_property` and replayed verbatim to Google later.
 */
export function matchGscProperty(domain: string, sites: readonly GscSite[]): string | null {
  for (const candidate of gscPropertyCandidates(domain)) {
    const match = sites.find((site) => site.siteUrl.toLowerCase() === candidate);
    if (match) {
      return match.siteUrl;
    }
  }
  return null;
}
