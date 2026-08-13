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

const SC_DOMAIN_PREFIX = "sc-domain:";

/**
 * The same shape `normalizeDomain` (./net/hostname.ts) enforces, copied from it rather than
 * recalled: at least two labels, valid characters, TLD 2-63 chars.
 */
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

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
