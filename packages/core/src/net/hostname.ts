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
 * `host`, lower-cased, trailing dot gone, and its LEADING `www.` label dropped.
 *
 * WHY IT EXISTS. `www.seogrep.com` and `seogrep.com` are the same customer site, and until
 * 2026-08-25 nothing here said so: `setup_project` stripped the scheme, the path and the query
 * but kept `www.`, so a customer who pasted the URL out of their address bar got a SECOND
 * project for a site they were already tracking. Six such rows exist in one live account and
 * five of them predate the review; the split sends the crawl history to one project and the
 * Search Console data to the other, and every tool that joins the two then reads half the data
 * whichever project it is called from.
 *
 * ONLY THE LEADING `www.` LABEL, and that is the whole rule. `blog.example.com` is a genuinely
 * different site and stays one; `api.www.example.com` keeps its mid-host `www`; and it strips
 * ONCE rather than in a loop, so `www.www.example.com` becomes `www.example.com` instead of
 * collapsing an arbitrary number of labels. Two modules already draw the line in exactly this
 * place — `dfs/serp.ts`'s DOMAIN_MATCH_RULE ("exact_host_www_stripped") and
 * `dfs/relevant-pages.ts`'s pageJoinKey, whose header already asserted "our own domain
 * normalizer drops it" while this one did not. This is the third statement of one rule, not a
 * fourth answer.
 *
 * The `rest.includes(".")` guard is not decoration: `www.com` is a real registrable domain, and
 * stripping it would leave the single label `com`, which no gate below would accept.
 */
export function stripWwwLabel(host: string): string {
  const lower = host.trim().toLowerCase().replace(/\.+$/, "");
  if (!lower.startsWith("www.")) return lower;
  const rest = lower.slice("www.".length);
  return rest.includes(".") ? rest : lower;
}

/**
 * Every STORED form that means the same site as `domain`: the canonical host and its `www.`
 * twin, in that order.
 *
 * A forward-only fix does not reach rows that already exist. The six `www.` projects measured on
 * 2026-08-25 keep their stored domain, so a lookup asking for the canonical host alone would
 * miss them and open a seventh — the very failure this change exists to stop. Callers that look
 * a project up by domain ask for both forms and prefer the canonical one; the ORDER of this
 * array is that preference, and callers depend on it.
 */
export function sameSiteDomains(domain: string): readonly string[] {
  const bare = stripWwwLabel(domain);
  return [bare, `www.${bare}`];
}

/**
 * Turkish dotted capital `İ` (U+0130), folded to a plain `i` BEFORE anything else sees it.
 *
 * WHY THIS FUNCTION EXISTS (measured live 2026-08-26, Turkish market). JavaScript's
 * locale-independent lowercasing maps U+0130 to TWO code points — `i` + U+0307 COMBINING DOT
 * ABOVE — and that combining dot is not ASCII, so the URL parser's IDNA step punycodes the
 * whole label. The result is that CASE ALONE forks one site into two:
 *
 *     "sigorta.com.tr"  ->  sigorta.com.tr                 (correct)
 *     "SİGORTA.COM.TR"  ->  xn--sigorta-7he.com.tr         (a name that does not exist)
 *
 * The second one is not a spelling of the first: it is registered as a separate project, it
 * does not resolve, and every crawl and audit aimed at it fetches nothing. A domain typed in
 * capitals is not an exotic input in this market — it is how domains appear on signage, on
 * business cards and in logos, and the panel's own hint invites it ("A domain or a URL").
 *
 * THE FOLD IS SAFE, and that is a claim about IDNA rather than about taste: U+0130 is
 * DISALLOWED in domain names by UTS-46, so no registrable name contains it and nothing that
 * resolves today can be reached by this replacement. `ı` (U+0131, dotless i) is deliberately
 * NOT touched — it is a permitted IDN character, and `ıspanak.com` is a real name whose owner
 * means exactly that letter.
 *
 * THE DECOMPOSED SEQUENCE NEEDS ITS OWN REPLACEMENT, and that is a correction of this
 * function's first draft rather than a flourish: the draft normalized to NFC and assumed a
 * pasted `i` + U+0307 would compose back into U+0130. IT DOES NOT — measured, red test —
 * because U+0130 is a composition exclusion, so NFC leaves the pair exactly as it found it.
 * The same lowercasing that produced the pair is the one the whole bug is made of, so the pair
 * is folded head-on. NFC still runs first, for the accented letters around it (`ç`, `ö`) where
 * it IS the normal form UTS-46 expects.
 */
export function foldDottedCapitalI(raw: string): string {
  return raw.normalize("NFC").replace(/İ/g, "i").replace(/i̇/gi, "i");
}

/**
 * Canonicalize a domain input. Accepts a bare host or a full URL; extracts the host,
 * lowercases it, drops any trailing dot (FQDN) and a leading `www.` label — the
 * scheme/path/port/query fall away with the URL parse. Returns a descriptive English error for
 * anything that is not a valid public domain (no host, single label, illegal characters, or an
 * internal / reserved name such as foo.internal / x.local).
 *
 * The `www.` strip is what makes `setup_project`'s idempotency claim true for the form a
 * customer actually pastes; see {@link stripWwwLabel} for the rule and its limits.
 */
export function normalizeDomain(raw: string): NormalizedDomain {
  // The dotted-`İ` fold runs BEFORE the URL parse, because the parse is where the damage was
  // done: by the time `new URL()` has returned a hostname, the combining dot is already inside
  // a punycode label and no lowercasing afterwards can undo it. See {@link foldDottedCapitalI}.
  const trimmed = foldDottedCapitalI(raw).trim();
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
  const domain = stripWwwLabel(host);
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
