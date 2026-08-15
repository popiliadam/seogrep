/**
 * Search Console property string ↔ domain. PURE: no I/O, no React, no runtime dependency.
 *
 * WHY IN CORE — `apps/web` and `apps/mcp` both need this rule. `canQuerySearchAnalytics`
 * lived only in the web app until 2026-08-13 and MCP had no way to reach it; two copies
 * mean two truths.
 *
 * THERE IS NO SSRF GATE HERE, and that is not an omission. `nonPublicHostnameReason`
 * (./net/hostname.ts) exists for a domain the USER typed. The string arriving here comes from
 * Google's own `sites.list` response. The real defence still stands at crawl time: the origin
 * gate refuses even a STORED domain (see the note in ./net/hostname.ts). All that happens here
 * is a SHAPE check — the same one `normalizeDomain` uses — so that web and MCP behave
 * identically.
 */

import { DOMAIN_RE } from "../net/hostname.js";

const SC_DOMAIN_PREFIX = "sc-domain:";



/**
 * The host a property string refers to, or null when the string is not a form we recognise.
 *
 * `www.` is KEPT. Existing projects are stored with the `www.` host they were registered
 * under (measured live 2026-08-13), so stripping it would produce a domain that matches no
 * project — and creating a second project for the same site is worse than not matching.
 */
export function propertyToDomain(property: string): string | null {
  const raw = property.trim();
  if (raw.length === 0) return null;

  const host = raw.startsWith(SC_DOMAIN_PREFIX)
    ? raw.slice(SC_DOMAIN_PREFIX.length)
    : urlHost(raw);
  if (host === null) return null;

  const domain = host.toLowerCase().replace(/\.+$/, "");
  return DOMAIN_RE.test(domain) ? domain : null;
}

function urlHost(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Google only ever issues http/https url-prefix properties. Another scheme is a form we
  // do not recognise, and we do not guess at what we do not recognise.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.hostname;
}

/**
 * The `sites.list` permission levels under which Google will actually answer a
 * `searchAnalytics.query` for the property. VERIFIED from Google's own pages, not recalled:
 *
 *   · developers.google.com/webmaster-tools/v1/sites — `permissionLevel` has exactly four
 *     acceptable values: "siteFullUser", "siteOwner", "siteRestrictedUser",
 *     "siteUnverifiedUser".
 *   · developers.google.com/webmaster-tools/v1/prereqs — "in order to run
 *     searchAnalytics.query you need read permissions on that property".
 *   · support.google.com/webmasters/answer/7687615 (the article Google's own 403 links to)
 *     — in its permission table the `Performance` row is ticked for ALL THREE of Owner,
 *     Full user and Restricted user. The same table leaves a cell blank where a role lacks
 *     the feature (`Add / remove property owners` is ticked for Owner alone), so a tick is a
 *     positive statement rather than a missing one. Performance IS the Search Analytics data.
 *
 * A RESTRICTED user is therefore INCLUDED. That contradicts the initial reading of the live
 * 403s ("restricted can see but not query"); on the documentation the level that cannot query
 * is `siteUnverifiedUser` — an account holding the property in its list WITHOUT having
 * verified it — which is also the one level the permission table above does not cover at all.
 * Excluding restricted would have refused connections Google would have served.
 *
 * Anything not on this list is UNUSABLE: `siteUnverifiedUser`, a level Google adds later, an
 * empty string from a malformed entry. Fail closed on purpose — refusing a property that
 * would have worked costs one re-approve, while binding one that cannot be queried costs
 * every later call AND tells the user they are connected when they are not (measured live
 * 2026-08-09 on bayder.com.tr and rkturizm.com).
 */
const QUERYABLE_PERMISSION_LEVELS: ReadonlySet<string> = new Set([
  "siteOwner",
  "siteFullUser",
  "siteRestrictedUser",
]);

/**
 * Whether `sites.list` reported a level documented as able to read Search Analytics. Matched
 * against Google's literal enum spelling — an unrecognised casing is an undocumented value and
 * fails closed like any other. Exported so the allowlist is inspectable by its pin.
 */
export function canQuerySearchAnalytics(permissionLevel: string): boolean {
  return QUERYABLE_PERMISSION_LEVELS.has(permissionLevel);
}

/**
 * Byte-order string comparison, used to break a tie between equally good suggestions. Explicit
 * rather than a bare `.sort()` so the ordering is a stated decision, and NOT `localeCompare`,
 * whose answer depends on the runtime's locale — which would make a refusal sentence differ
 * between a developer's machine and the server.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A property string reduced to the differences that CANNOT change which site it names: letter
 * case, and a trailing slash on a URL-prefix property. Nothing else.
 *
 * Deliberately not a similarity measure. `sc-domain:example.com` and `https://example.com/` are
 * two DIFFERENT Search Console properties for the same site with different data and different
 * permissions, so they must not collapse together here — and neither must a sibling host or a
 * near-miss spelling. Note what is NOT done: the `sc-domain:` prefix and the URL scheme are
 * both KEPT in the key, and that is the whole of what keeps those two forms apart.
 *
 * Exported so the rule is inspectable by its pin, the way `canQuerySearchAnalytics` is.
 */
export function cosmeticPropertyKey(property: string): string {
  return property.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * The listed property the caller almost certainly meant, or null.
 *
 * ONLY a cosmetic difference qualifies — a case mismatch, or a trailing slash they typed or left
 * off. Anything cleverer is worse than nothing here: this suggestion is one copy-paste away from
 * becoming the property a project BINDS to, and a plausible-looking wrong suggestion is a worse
 * outcome than no suggestion, because a wrong binding is only discovered when the data stops
 * making sense. So there is no edit distance, no prefix match, no "did you mean the other host".
 *
 * Ties are broken by sort order rather than by input order, so the sentence a user sees does not
 * depend on the order the accounts (or the listings) came back in.
 *
 * WHY IN CORE — both surfaces refuse the same request and may not disagree about it. This rule
 * lived only in `apps/mcp/src/tools/track-gsc-property.ts` until 2026-08-15, and the /app/connection
 * refusals carried no suggestion at all; a second copy of the rule would be a second truth about
 * which two property strings name the same site.
 */
export function cosmeticPropertyMatch(
  property: string,
  listed: readonly string[],
): string | null {
  const wanted = cosmeticPropertyKey(property);
  const near = listed.filter(
    (candidate) => candidate !== property && cosmeticPropertyKey(candidate) === wanted,
  );
  return [...near].sort(compareStrings)[0] ?? null;
}
