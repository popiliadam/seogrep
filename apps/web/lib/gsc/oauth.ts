import {
  canQuerySearchAnalytics,
  GSC_IDENTITY_SCOPES,
  GSC_READONLY_SCOPE,
  type GscSite,
} from "@pseo/core";

/**
 * Pure helpers for the GSC OAuth redirect + property resolution. Kept out of the route
 * handlers so both are unit-testable without a request. No secrets live here — the
 * consent URL carries only the PUBLIC client_id, the redirect, and the signed state.
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Build the Google OAuth 2.0 consent URL. `access_type=offline` + `prompt=consent` are
 * what make Google return a refresh token (and re-issue one even if the user consented
 * before) — without them there is nothing to seal at rest.
 *
 * Scope is the read-only Search Console scope plus the two IDENTITY scopes (`openid`,
 * `email`). The identity pair grants no additional data access; it is what makes Google
 * return an `id_token` naming the account that consented, which since migration 0021 is
 * the axis the credential is stored on. Still no write access is ever requested, and we
 * deliberately still do NOT set `include_granted_scopes` — incremental authorization would
 * let an unrelated previously-granted scope ride along on this token, blurring the
 * discipline this consent is meant to hold. Asking for a scope by NAME here and inheriting
 * one silently are different things; only the first is happening.
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
    scope: [GSC_READONLY_SCOPE, ...GSC_IDENTITY_SCOPES].join(" "),
    access_type: "offline",
    prompt: "consent",
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`;
}

/**
 * Read `sub` (the stable Google account id) and `email` out of an `id_token`'s payload.
 *
 * THE SIGNATURE IS NOT VERIFIED, deliberately. This token is not accepted as a credential
 * from a caller: it is a field of the JSON body Google's own token endpoint just returned
 * over TLS, in the response to a request authenticated with our `client_secret`. Its origin
 * is established by that exchange, so a JWKS fetch here would re-prove — at the cost of a
 * network call and a key cache on the interactive callback path — something already proven.
 * What this function does instead is treat the token's SHAPE as untrusted: anything that is
 * not a JWT-looking string with both claims present as strings returns null, and the caller
 * refuses the connection rather than inventing an identity for it.
 *
 * `sub`, not `email`, is the account key (`gsc_accounts.google_account_sub`): an email can
 * be reassigned to a different person, a sub cannot. An EMPTY string is refused like a
 * missing claim — `(user_id, google_account_sub)` is a unique key, so one blank sub would
 * collapse two of a user's Google accounts onto a single row and hand the second consent
 * the first one's identity.
 */
export function parseIdTokenClaims(idToken: string): { sub: string; email: string } | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof json !== "object" || json === null) return null;
    const { sub, email } = json as { sub?: unknown; email?: unknown };
    if (typeof sub !== "string" || sub.length === 0) return null;
    if (typeof email !== "string" || email.length === 0) return null;
    return { sub, email };
  } catch {
    return null;
  }
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

// The allowlist and its body moved to packages/core/src/gsc/property.ts — apps/mcp needs
// the SAME rule and could not reach it here, and two copies of a fail-closed rule are two
// rules. The re-export is DELIBERATE: every existing importer of this path, and the pins in
// oauth.test.ts, keep working untouched. It is imported at the top rather than re-exported
// with `export … from` because `resolveGscProperty` below calls it by name.
export { canQuerySearchAnalytics };

/**
 * The outcome of resolving a project domain against the account's properties. Three states,
 * because two of them are NOT the same thing to a user: "your account has no property for
 * this domain" and "your account lists a property for this domain but cannot read it" have
 * different next actions, and until now both were reported as the first one.
 */
export type GscPropertyMatch =
  | { readonly kind: "matched"; readonly property: string }
  | { readonly kind: "unusable_permission"; readonly site: GscSite }
  | { readonly kind: "none" };

/**
 * Resolve a project domain to a property the connected account can actually QUERY.
 *
 * The candidate list — and therefore which HOSTS may match — is untouched: this walks
 * `gscPropertyCandidates` in its existing preference order and only narrows what may satisfy
 * each step. A host that was never a candidate cannot become one here, including in the
 * `unusable_permission` report, which can only ever name a site whose URL equalled a
 * candidate. The `blog.example.com` security pin runs through this function unchanged.
 *
 * An unusable candidate is SKIPPED, not fatal — the walk continues down the same order. That
 * is the live shape of the two failing projects (measured 2026-08-09): the account holds both
 * `sc-domain:bayder.com.tr`, which 403s, and `https://bayder.com.tr/`, which is the one the
 * operator actually owns. Aborting at the first unusable candidate would leave those projects
 * unmatched when a working property sits one step further down the list.
 *
 * The first unusable host-match is remembered only to explain a subsequent "none" — it never
 * competes with a usable one, at any position.
 */
export function resolveGscProperty(domain: string, sites: readonly GscSite[]): GscPropertyMatch {
  let unusable: GscSite | null = null;
  for (const candidate of gscPropertyCandidates(domain)) {
    const hits = sites.filter((site) => site.siteUrl.toLowerCase() === candidate);
    const usable = hits.find((site) => canQuerySearchAnalytics(site.permissionLevel));
    if (usable) {
      return { kind: "matched", property: usable.siteUrl };
    }
    if (unusable === null && hits.length > 0) {
      unusable = hits[0]!;
    }
  }
  return unusable === null ? { kind: "none" } : { kind: "unusable_permission", site: unusable };
}

/**
 * Map a project domain to one of the account's verified Search Console properties.
 * Host comparison is case-insensitive. Returns the property's exact `siteUrl` (as GSC
 * reports it) to store in `gsc_property`, or null when the account has none it can query —
 * that string is written to `gsc_property` and replayed verbatim to Google later.
 *
 * Null now covers two states; a caller that must tell them apart calls `resolveGscProperty`.
 */
export function matchGscProperty(domain: string, sites: readonly GscSite[]): string | null {
  const outcome = resolveGscProperty(domain, sites);
  return outcome.kind === "matched" ? outcome.property : null;
}
