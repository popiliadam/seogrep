/**
 * Hostname admissibility + domain canonicalization. PURE: no I/O, no DNS, no runtime
 * dependency.
 *
 * WHY IN CORE — BOTH runtimes have to answer "may this host be tracked?" with the SAME
 * word, and until 2026-08-13 they could not. `nonPublicHostnameReason` lived in
 * `apps/mcp/src/crawler/ssrf.ts` and `normalizeDomain` in `apps/mcp/src/tools/setup-project.ts`,
 * so `apps/web` had no way to reach either: the web's `trackProperty` OPENED a project for
 * `sc-domain:foo.internal` while the MCP `track_gsc_property` and `setup_project` REFUSED it.
 * The alternative — a second copy of the reserved-TLD list inside apps/web — would have been
 * a second copy of a SECURITY list, which is worse than the gap it closes. So the list moved
 * here and both surfaces import it.
 *
 * Both original homes re-export what moved, so their existing callers and pins are unchanged:
 * `crawler/ssrf.ts` still exports `nonPublicHostnameReason`, `tools/setup-project.ts` still
 * exports `normalizeDomain`.
 *
 * THIS IS A NAME CHECK, NOT THE SSRF DEFENCE. A *public* hostname can resolve to an internal
 * address, so the decisive crawl-time check is on the RESOLVED IP (`isBlockedIp` /
 * `checkPublicHost`, which stay in the crawler where the DNS is). What lives here is the cheap
 * string gate that runs first.
 */

/** Hostnames whose last label marks a non-public / reserved / internal namespace. */
const NON_PUBLIC_TLDS: ReadonlySet<string> = new Set([
  "localhost",
  "local",
  "internal",
  "test",
  "invalid",
  "example",
  "onion",
  "lan",
  "home",
  "corp",
  "intranet",
  "private",
]);

/**
 * Short English reason when `hostname` is a non-public name, else null. Pure. Lowercases
 * and strips a trailing dot first. Non-public when: it is a single label (no dot); its last
 * label is a reserved/internal pseudo-TLD; or it is `home.arpa` / `*.home.arpa`. IP literals
 * are NOT this function's concern — callers vet those with isBlockedIp.
 */
export function nonPublicHostnameReason(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (!host.includes(".")) return "single-label (non-public) hostname";
  if (host === "home.arpa" || host.endsWith(".home.arpa")) return "reserved home.arpa name";
  const lastLabel = host.slice(host.lastIndexOf(".") + 1);
  if (NON_PUBLIC_TLDS.has(lastLabel)) return `non-public TLD ".${lastLabel}"`;
  return null;
}

/**
 * The public-domain SHAPE: at least two labels, valid characters, TLD 2-63 chars, 253 max.
 *
 * EXPORTED, because `../gsc/property.ts` needs the same rule and used to carry its own copy of
 * this literal — inside the SAME package, where an import costs one line. Two copies of one
 * regex is two answers to "what is a domain": let them drift and `propertyToDomain` starts
 * accepting shapes `normalizeDomain` refuses, which is exactly the one-gate story both
 * functions exist to tell.
 *
 * It is a shape check only. Whether a well-shaped name may be TRACKED is
 * `nonPublicHostnameReason`'s question, and both callers ask it separately.
 */
export const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type NormalizedDomain = { readonly ok: true; readonly domain: string } | {
  readonly ok: false;
  readonly error: string;
};

/**
 * Canonicalize a domain input. Accepts a bare host or a full URL; extracts the host,
 * lowercases it, drops any trailing dot (FQDN) — the scheme/path/port/query fall away
 * with the URL parse. Returns a descriptive English error for anything that is not a
 * valid public domain (no host, single label, illegal characters, or an internal /
 * reserved name such as foo.internal / x.local).
 */
export function normalizeDomain(raw: string): NormalizedDomain {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: "Domain is required (received an empty value)." };
  }
  let host: string;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
    host = new URL(hasScheme ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return { ok: false, error: `"${raw}" is not a valid domain or URL.` };
  }
  const domain = host.toLowerCase().replace(/\.+$/, "");
  if (!DOMAIN_RE.test(domain)) {
    return {
      ok: false,
      error: `"${raw}" is not a valid domain — expected a host like "example.com".`,
    };
  }
  // Reject internal / reserved names that pass DOMAIN_RE but must never be tracked or
  // crawled (foo.internal, metadata.google.internal, x.local, a.test, ...). The crawl-time
  // origin gate (apps/mcp/src/crawler/ssrf.ts) additionally refuses any PRE-EXISTING stored
  // domain that would only now be judged non-public.
  if (nonPublicHostnameReason(domain) !== null) {
    return {
      ok: false,
      error: `"${raw}" is not a public domain — internal or reserved names cannot be tracked.`,
    };
  }
  return { ok: true, domain };
}
