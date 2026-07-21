/**
 * Fetch-based site crawler that produces the PageRecords audits (T8) consume.
 *
 * This module is pure infrastructure: it does not touch the DB, queue, or credit
 * ledger, and it opens no tools/ surface (the crawl_site MCP tool is T7's job).
 *
 * HTML is parsed with small, well-scoped regexes rather than a DOM library (no new
 * dependency). That is deliberate and has known limits: it assumes reasonably
 * well-formed markup, does not execute scripts, ignores content injected by JS,
 * and is not a spec-complete HTML parser. It is sufficient for head metadata,
 * headings, and anchor extraction — the signals a first-pass on-page audit needs.
 */

import { parseRobots, type RobotsRules } from "./robots.ts";
import { decodeEntities, parseSitemap } from "./sitemap.ts";
import {
  checkPublicHost,
  defaultLookup,
  type LookupFn,
  nonPublicHostnameReason,
} from "./ssrf.ts";

export interface PageRecord {
  readonly url: string;
  readonly status: number;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly h1s: string[];
  readonly canonical: string | null;
  readonly robotsMeta: string | null;
  readonly links: string[];
  readonly wordCount: number;
  /** Schema.org @type names declared in the page's JSON-LD blocks ([] when none). */
  readonly jsonLdTypes: string[];
  readonly issues: string[];
}

export interface SkippedUrl {
  readonly url: string;
  readonly reason: string;
}

export interface CrawlResult {
  readonly pages: PageRecord[];
  readonly skipped: SkippedUrl[];
  /** ISO-8601 timestamp of when the crawl started. */
  readonly fetchedAt: string;
}

export interface CrawlOptions {
  /** Hard cap on pages fetched (default 100). The public knob T7 passes. */
  maxUrls?: number;
  /** Per-request timeout incl. its redirect chain, ms (default 10_000). Test knob. */
  pageTimeoutMs?: number;
  /** Whole-crawl wall-clock budget, ms (default 90_000). Test knob. */
  timeBudgetMs?: number;
  /** Upper bound applied to robots Crawl-delay, ms (default 1_000). Test knob. */
  crawlDelayCapMs?: number;
  /**
   * DNS resolver the SSRF guard uses (origin gate + cross-origin redirect checks).
   * Defaults to node:dns/promises; injected in tests so DNS is never real. Test knob.
   */
  lookup?: LookupFn;
  /**
   * Restrict the crawl to URLs whose pathname starts with one of these prefixes (a prefix
   * match on the pathname; a bare `blog` is normalized to `/blog`). Applied to BOTH the
   * sitemap seeds and every BFS-discovered link — a link outside the prefixes is skipped, not
   * fetched. Empty / absent means no restriction (the whole-site default). The public knob the
   * crawl_site tool exposes as `include_paths`. NOTE: with no usable sitemap, discovery seeds
   * only the homepage; if the homepage itself is out of scope, nothing in scope is reachable.
   */
  includePaths?: string[];
}

/** Parsed page signals, before url/status/issues are attached. */
export interface ParsedHtml {
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly h1s: string[];
  readonly canonical: string | null;
  readonly robotsMeta: string | null;
  /** Absolute, deduped href targets (non-http(s) schemes dropped). */
  readonly links: string[];
  readonly wordCount: number;
  /** Schema.org @type names from JSON-LD blocks ([] when none/malformed). */
  readonly jsonLdTypes: string[];
}

/** Resolve `href` against `baseUrl`, keeping only http(s); null if invalid. */
function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Collapse tags to spaces, decode entities, and squeeze whitespace to plain text. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** First capture group of `re` in `html`, entity-decoded; null if absent or blank. */
function firstGroup(re: RegExp, html: string): string | null {
  const match = re.exec(html);
  const group = match?.[1];
  if (group === undefined) return null;
  return decodeEntities(group).trim() || null;
}

/** Parse a tag's attribute string into a lower-cased name -> value map (first wins). */
function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-z][a-z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const name = (m[1] ?? "").toLowerCase();
    if (name && !(name in out)) out[name] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

/**
 * Extract the schema.org `@type` names declared in a page's JSON-LD blocks
 * (`<script type="application/ld+json">`). Runs on the RAW html, BEFORE parseHtml
 * strips scripts, since JSON-LD lives inside a script tag.
 *
 * Regex-scoped like the rest of this parser (no JSON-LD / DOM dependency): each script
 * body is JSON.parsed and every `@type` collected, recursing through nested objects and
 * arrays (so `@graph` containers and embedded nodes contribute their types too). Types
 * are returned de-duplicated, first-seen order.
 *
 * KNOWN LIMITS (deliberate for a first-pass audit signal):
 *  - only JSON-LD is read; microdata / RDFa are ignored;
 *  - a block that is not valid JSON is skipped SILENTLY — a malformed <script> must
 *    never reject the crawl (the T6 Critical lesson: one bad page is skipped, not fatal);
 *  - only the TYPE names are kept; the raw JSON-LD body is never stored.
 */
export function parseJsonLdTypes(html: string): string[] {
  const types: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    const name = value.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      types.push(name);
    }
  };
  // Walk a parsed node: collect its @type (string or array of strings), then recurse
  // into every object/array value so nested entities (@graph, author, publisher, …)
  // contribute their types as well.
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    if (Array.isArray(type)) type.forEach(add);
    else add(type);
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") walk(value);
    }
  };
  const blocks = html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of blocks) {
    const body = match[1];
    if (!body || !body.trim()) continue;
    try {
      walk(JSON.parse(body));
    } catch {
      // Malformed JSON-LD block — skip silently; the crawl must not die on it.
    }
  }
  return types;
}

/**
 * Extract head metadata, headings, and links from an HTML string. `baseUrl` is the
 * document's final URL, used to resolve relative hrefs and the canonical link.
 */
export function parseHtml(html: string, baseUrl: string): ParsedHtml {
  // Strip script/style first so their string bodies cannot leak into any extraction
  // (headings, links, or the word count). Everything below parses this cleaned view.
  const content = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const title = firstGroup(/<title[^>]*>([\s\S]*?)<\/title>/i, content);

  let metaDescription: string | null = null;
  let robotsMeta: string | null = null;
  for (const m of content.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1] ?? "");
    const name = (a.name ?? a.property ?? "").toLowerCase();
    if (name === "description" && metaDescription === null) metaDescription = a.content?.trim() || null;
    if (name === "robots" && robotsMeta === null) robotsMeta = a.content?.trim() || null;
  }

  let canonical: string | null = null;
  for (const m of content.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1] ?? "");
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && a.href) {
      canonical = resolveUrl(a.href, baseUrl);
      break;
    }
  }

  const h1s: string[] = [];
  for (const m of content.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) {
    const text = textOf(m[1] ?? "");
    if (text) h1s.push(text);
  }

  const links: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(/<a\b([^>]*)>/gi)) {
    const href = parseAttrs(m[1] ?? "").href;
    const abs = href ? resolveUrl(href, baseUrl) : null;
    // Normalize link targets (drop fragment / trailing slash) so same-page anchors
    // collapse and the field matches the crawler's dedupe key.
    const norm = abs ? normalizeUrl(abs) : null;
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      links.push(norm);
    }
  }

  const words = textOf(content);
  const wordCount = words ? words.split(/\s+/).filter(Boolean).length : 0;

  // Read JSON-LD from the RAW html (parseJsonLdTypes scopes its own script blocks),
  // not the script-stripped `content` above.
  const jsonLdTypes = parseJsonLdTypes(html);

  return { title, metaDescription, h1s, canonical, robotsMeta, links, wordCount, jsonLdTypes };
}

/**
 * Normalize a URL for dedupe: drop the fragment and a trailing slash (except root),
 * keep the query. The host is lower-cased by the URL parser; path case is preserved.
 */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

/**
 * Normalize include-path prefixes: trim, ensure a single leading slash (`blog` -> `/blog`),
 * drop blanks, and dedupe (first-seen order). An absent or all-blank list yields `[]`, which
 * every consumer treats as "no restriction" (the whole-site default). Pure — the single
 * normalizer the crawl seeds, the BFS enqueue, and the estimator share.
 */
export function normalizeIncludePaths(includePaths?: readonly string[]): string[] {
  if (!includePaths || includePaths.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of includePaths) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const prefix = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    if (!seen.has(prefix)) {
      seen.add(prefix);
      out.push(prefix);
    }
  }
  return out;
}

/**
 * True when `pathname` is in scope for the given ALREADY-normalized prefixes: an empty list
 * means "no restriction" (always true); otherwise the pathname must START WITH one of the
 * prefixes. This is a raw prefix match, so `/blog` matches `/blog`, `/blog/x`, and — by
 * design, kept simple and predictable — also `/blogxyz`. Pure; the single scoping predicate.
 */
export function matchesIncludePaths(pathname: string, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) return true;
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Page-level issue flags. Deliberately shallow — the four cheap on-page signals the
 * crawler owns; deep on-page/tech/schema analysis is T8's job, not this module's.
 */
export function computeIssues(
  page: Pick<PageRecord, "title" | "metaDescription" | "h1s" | "robotsMeta">,
): string[] {
  const issues: string[] = [];
  if (!page.title?.trim()) issues.push("missing title");
  if (!page.metaDescription?.trim()) issues.push("missing meta description");
  if (page.h1s.length > 1) issues.push("multiple h1");
  if (page.robotsMeta && /\bnoindex\b/i.test(page.robotsMeta)) issues.push("noindex");
  return issues;
}

// --- Crawl orchestration --------------------------------------------------------

/** Sent on every request so operators can identify (and rate-limit) the crawler. */
export const USER_AGENT = "SeoGrepBot/1.0 (+https://seogrep.com/docs)";

const DEFAULT_MAX_URLS = 100;
const DEFAULT_PAGE_TIMEOUT_MS = 10_000;
const DEFAULT_TIME_BUDGET_MS = 90_000;
const DEFAULT_CRAWL_DELAY_CAP_MS = 1_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

function isHtml(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return type.includes("text/html") || type.includes("application/xhtml+xml");
}

interface FetchOk {
  readonly kind: "ok";
  readonly status: number;
  readonly finalUrl: string;
  readonly contentType: string;
  readonly body: string;
}
type FetchOutcome =
  | FetchOk
  | { readonly kind: "timeout" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "too-many-redirects" }
  | { readonly kind: "off-origin-redirect"; readonly target: string };

/**
 * Fetch one page, following up to MAX_REDIRECTS same-origin redirects manually so
 * the whole chain shares a single timeout and off-origin hops can be rejected. Only
 * text/html bodies are read; other content types return with an empty body for the
 * caller to skip. AbortController bounds the entire chain to `timeoutMs`.
 */
async function fetchPage(
  url: string,
  origin: URL,
  timeoutMs: number,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (REDIRECT_STATUS.has(res.status)) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) return { kind: "ok", status: res.status, finalUrl: current, contentType, body: "" };
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { kind: "error", message: "invalid redirect location" };
        }
        if (!sameOrigin(next, origin)) return { kind: "off-origin-redirect", target: next.toString() };
        current = next.toString();
        continue;
      }
      if (!isHtml(contentType)) {
        await res.body?.cancel();
        return { kind: "ok", status: res.status, finalUrl: current, contentType, body: "" };
      }
      return { kind: "ok", status: res.status, finalUrl: current, contentType, body: await res.text() };
    }
    return { kind: "too-many-redirects" };
  } catch (error) {
    if (controller.signal.aborted) return { kind: "timeout" };
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** IPv4 dotted-quad or bracketed IPv6 literal (URL.hostname keeps IPv6 in brackets). */
function isIpLiteralHost(hostname: string): boolean {
  if (hostname.startsWith("[")) return true; // [::1], [fd00::1], ... (IPv6 literal)
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname); // 127.0.0.1, 169.254.169.254, ...
}

/** The loopback IP literals the crawl-origin local-test seam permits: 127.0.0.0/8 or [::1]. */
function isLoopbackLiteral(hostname: string): boolean {
  if (hostname.startsWith("[")) return hostname === "[::1]";
  const m = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  return m !== null && m[1] === "127";
}

/**
 * Validate a CROSS-ORIGIN redirect target BEFORE its request is emitted (the pre-emission
 * SSRF fix). Unlike the crawl-origin seam, a redirect to ANY IP literal is refused —
 * loopback included — since a legitimate site never needs to redirect its robots/sitemap
 * to a bare IP. Otherwise: http(s) scheme only, the name must not be reserved/internal
 * (nonPublicHostnameReason), and every resolved address must be public (checkPublicHost,
 * with the plumbed lookup). Returns true only when every check passes.
 */
async function validateRedirectTarget(target: URL, lookup: LookupFn): Promise<boolean> {
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;
  if (isIpLiteralHost(target.hostname)) return false;
  if (nonPublicHostnameReason(target.hostname) !== null) return false;
  return (await checkPublicHost(target.hostname, lookup)).ok;
}

/**
 * GET a text resource (robots/sitemap), following up to MAX_REDIRECTS redirects MANUALLY so
 * each cross-origin hop is validated BEFORE its request is emitted (the pre-emission SSRF
 * fix — a blind redirect at an internal endpoint never leaves the process). One
 * AbortController bounds the whole chain to `timeoutMs`, mirroring fetchPage.
 *
 * Same-origin hops (a relative Location on the originally requested origin) emit freely.
 * A cross-origin hop must pass validateRedirectTarget; legitimate apex->www hops on a
 * publicly-resolving host validate-then-emit and keep working. Returns null on any failure
 * (robots -> RFC 9309 complete disallow; sitemap seed -> skipped).
 *
 * CALLER CONTRACT: the INITIAL url's host is the caller's responsibility to validate —
 * crawlSite vets the crawl origin before any fetchText. fetchText validates cross-origin
 * REDIRECT hops only.
 */
async function fetchText(
  url: string,
  timeoutMs: number,
  lookup: LookupFn,
): Promise<{ status: number; body: string } | null> {
  let requestedOrigin: URL;
  try {
    requestedOrigin = new URL(url);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT },
      });
      if (REDIRECT_STATUS.has(res.status)) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) return null; // redirect with no target -> unreachable
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return null;
        }
        // Cross-origin hop: validate BEFORE emitting the next request (pre-emission guard).
        if (!sameOrigin(next, requestedOrigin) && !(await validateRedirectTarget(next, lookup))) {
          return null;
        }
        current = next.toString();
        continue;
      }
      return { status: res.status, body: await res.text() };
    }
    return null; // exceeded MAX_REDIRECTS -> unreachable
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type RobotsLoad =
  | { readonly kind: "ok"; readonly rules: RobotsRules }
  | { readonly kind: "unreachable" };

/**
 * Load /robots.txt with RFC 9309 reachability semantics: 200 parses the rules;
 * a 4xx (file absent / client error) means no restrictions, so allow-all; a 5xx
 * or a network failure (timeout, refused, DNS) means the file is UNREACHABLE and
 * the crawler must assume complete disallow — the caller aborts the crawl.
 */
async function loadRobots(origin: URL, timeoutMs: number, lookup: LookupFn): Promise<RobotsLoad> {
  const res = await fetchText(new URL("/robots.txt", origin).toString(), timeoutMs, lookup);
  if (res === null || res.status >= 500) return { kind: "unreachable" };
  return { kind: "ok", rules: parseRobots(res.status === 200 ? res.body : "") };
}

/**
 * Seed URLs from /sitemap.xml (one bounded level of index expansion); [] if none. When
 * `prefixes` is non-empty, only same-origin locs whose pathname is in scope are kept — an
 * empty `prefixes` (the default) filters nothing, so the crawl's existing behavior is
 * byte-identical. The guarded fetchText path (incl. its cross-origin redirect checks) is
 * unchanged; scoping is a pure post-fetch filter.
 */
async function loadSitemapSeeds(
  origin: URL,
  timeoutMs: number,
  limit: number,
  lookup: LookupFn,
  prefixes: readonly string[] = [],
): Promise<string[]> {
  const seeds: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return;
    }
    if (!sameOrigin(u, origin)) return;
    if (!matchesIncludePaths(u.pathname, prefixes)) return;
    const norm = normalizeUrl(u.toString());
    if (!seen.has(norm)) {
      seen.add(norm);
      seeds.push(norm);
    }
  };

  const root = await fetchText(new URL("/sitemap.xml", origin).toString(), timeoutMs, lookup);
  if (!root || root.status !== 200) return seeds;
  const parsed = parseSitemap(root.body);
  parsed.urls.forEach(add);
  for (const child of parsed.sitemaps.slice(0, 5)) {
    if (seeds.length >= limit) break;
    // SSRF guard: child-sitemap locs are tenant-controlled input on a hosted
    // service — never let them point our fetcher off the crawl origin (e.g. at
    // cloud metadata endpoints). Off-origin or unparsable children are skipped.
    let childUrl: URL;
    try {
      childUrl = new URL(child);
    } catch {
      continue;
    }
    if (!sameOrigin(childUrl, origin)) continue;
    const res = await fetchText(child, timeoutMs, lookup);
    if (res && res.status === 200) parseSitemap(res.body).urls.forEach(add);
  }
  return seeds.slice(0, limit);
}

/**
 * The crawl-origin SSRF gate as a pure decision: null when `originUrl` is allowed to be
 * fetched, otherwise a short English reason. IP-literal origins are refused EXCEPT loopback
 * (the documented local-test seam: the crawler's own fixtures bind loopback servers and seed
 * http://127.0.0.1:<port>, while production origins come from setup_project's normalizeDomain,
 * which structurally cannot emit an IP literal); every other host must resolve public
 * (checkPublicHost, with the plumbed lookup). crawlSite and estimateSiteSize share this ONE
 * gate so there is a single guarded path — no second SSRF policy to drift.
 */
async function originGateReason(originUrl: URL, lookup: LookupFn): Promise<string | null> {
  if (isIpLiteralHost(originUrl.hostname)) {
    return isLoopbackLiteral(originUrl.hostname) ? null : "non-loopback IP literal";
  }
  const check = await checkPublicHost(originUrl.hostname, lookup);
  return check.ok ? null : check.reason;
}

/** Early-return shape for an origin the SSRF guard refused (nothing is ever fetched). */
function blockedOrigin(origin: URL, reason: string, fetchedAt: string): CrawlResult {
  return {
    pages: [],
    skipped: [{ url: normalizeUrl(origin.toString()), reason: `origin blocked (SSRF guard): ${reason}` }],
    fetchedAt,
  };
}

/**
 * Crawl a site starting from `origin`, robots-respectfully and bounded by maxUrls
 * and a wall-clock budget. Seeds come from /sitemap.xml when present, otherwise from
 * same-origin link-following (BFS). Produces the PageRecords audits (T8) consume; it
 * touches no DB/queue/credits and follows only same-origin http(s) links.
 */
export async function crawlSite(origin: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const started = Date.now();
  const fetchedAt = new Date(started).toISOString();

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new Error(`crawlSite: invalid origin URL "${origin}"`);
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    throw new Error(`crawlSite: origin must be http(s), got "${originUrl.protocol}"`);
  }

  const maxUrls = Math.max(1, Math.floor(opts.maxUrls ?? DEFAULT_MAX_URLS));
  const pageTimeoutMs = opts.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const crawlDelayCapMs = opts.crawlDelayCapMs ?? DEFAULT_CRAWL_DELAY_CAP_MS;
  const lookup = opts.lookup ?? defaultLookup;
  const prefixes = normalizeIncludePaths(opts.includePaths);

  // SSRF origin gate (shared with estimateSiteSize via originGateReason). The origin is
  // tenant-controlled, so before any request goes out it must resolve to a public address;
  // a refused origin fetches nothing downstream (robots, sitemap, pages). This also catches a
  // PRE-EXISTING stored domain that would only now be judged non-public.
  const gateReason = await originGateReason(originUrl, lookup);
  if (gateReason !== null) return blockedOrigin(originUrl, gateReason, fetchedAt);

  const robotsLoad = await loadRobots(originUrl, pageTimeoutMs, lookup);
  if (robotsLoad.kind === "unreachable") {
    // RFC 9309: an unreachable robots.txt (5xx / network failure) = complete
    // disallow. Stop before fetching anything else — the sitemap included.
    return {
      pages: [],
      skipped: [{ url: normalizeUrl(originUrl.toString()), reason: "robots.txt unreachable" }],
      fetchedAt,
    };
  }
  const robots = robotsLoad.rules;
  const crawlDelayMs = Math.min(robots.crawlDelayMs, crawlDelayCapMs);

  const seeds = await loadSitemapSeeds(originUrl, pageTimeoutMs, maxUrls, lookup, prefixes);
  // Fallback seed (no usable sitemap) is the homepage — but honor the scope filter: if the
  // homepage itself is out of scope, there is no in-scope entry point (an empty queue -> 0
  // pages). With no prefixes, matchesIncludePaths is always true, so this is byte-identical
  // to the previous `[root]` fallback.
  const rootSeed = normalizeUrl(originUrl.toString());
  const queue: string[] =
    seeds.length > 0
      ? [...seeds]
      : matchesIncludePaths(new URL(rootSeed).pathname, prefixes)
        ? [rootSeed]
        : [];
  const enqueued = new Set<string>(queue);
  const visited = new Set<string>();
  const pages: PageRecord[] = [];
  const skipped: SkippedUrl[] = [];
  let fetches = 0;

  const enqueue = (link: string): void => {
    let u: URL;
    try {
      u = new URL(link);
    } catch {
      return;
    }
    if (!sameOrigin(u, originUrl)) return;
    // Out-of-scope links are skipped, not fetched (with no prefixes this is a no-op).
    if (!matchesIncludePaths(u.pathname, prefixes)) return;
    const norm = normalizeUrl(link);
    if (!visited.has(norm) && !enqueued.has(norm)) {
      enqueued.add(norm);
      queue.push(norm);
    }
  };

  while (queue.length > 0) {
    if (pages.length >= maxUrls) {
      for (const url of queue.splice(0)) skipped.push({ url, reason: "max URL limit reached" });
      break;
    }
    if (Date.now() - started >= timeBudgetMs) {
      for (const url of queue.splice(0)) skipped.push({ url, reason: "time budget exhausted" });
      break;
    }

    const url = queue.shift();
    if (url === undefined || visited.has(url)) continue;
    visited.add(url);

    const target = new URL(url);
    if (!robots.isAllowed(target.pathname + target.search)) {
      skipped.push({ url, reason: "blocked by robots.txt" });
      continue;
    }

    if (crawlDelayMs > 0 && fetches > 0) await sleep(crawlDelayMs);
    fetches++;

    const outcome = await fetchPage(url, originUrl, pageTimeoutMs);
    if (outcome.kind === "timeout") {
      skipped.push({ url, reason: "timeout" });
      continue;
    }
    if (outcome.kind === "too-many-redirects") {
      skipped.push({ url, reason: "too many redirects" });
      continue;
    }
    if (outcome.kind === "off-origin-redirect") {
      skipped.push({ url, reason: `off-origin redirect to ${outcome.target}` });
      continue;
    }
    if (outcome.kind === "error") {
      skipped.push({ url, reason: `fetch failed: ${outcome.message}` });
      continue;
    }

    const finalUrl = normalizeUrl(outcome.finalUrl);
    if (finalUrl !== url) {
      if (visited.has(finalUrl)) {
        // Redirected onto an already-crawled page: the CONTENT is already covered under
        // finalUrl, but record this URL as skipped so it is accounted for rather than
        // vanishing. audit_tech's skipped/coverage analysis consumes this (T6 finding h):
        // without it, a sitemap URL that redirects to a crawled page reads as a coverage
        // gap. Benign — the reason string marks it as a redirect, not a failure.
        skipped.push({ url, reason: "redirects to already-crawled URL" });
        continue;
      }
      visited.add(finalUrl);
      const finalTarget = new URL(finalUrl);
      if (!robots.isAllowed(finalTarget.pathname + finalTarget.search)) {
        skipped.push({ url: finalUrl, reason: "blocked by robots.txt" });
        continue;
      }
    }
    if (!isHtml(outcome.contentType)) {
      skipped.push({ url: finalUrl, reason: `non-HTML (${outcome.contentType || "unknown"})` });
      continue;
    }

    // Belt-and-suspenders: parseHtml is written to never throw, but no future
    // parser bug may be allowed to reject the whole crawl — one bad page becomes
    // a skipped entry instead.
    let parsed: ParsedHtml;
    try {
      parsed = parseHtml(outcome.body, finalUrl);
    } catch (error) {
      skipped.push({
        url: finalUrl,
        reason: `parse failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    pages.push({
      url: finalUrl,
      status: outcome.status,
      title: parsed.title,
      metaDescription: parsed.metaDescription,
      h1s: parsed.h1s,
      canonical: parsed.canonical,
      robotsMeta: parsed.robotsMeta,
      links: parsed.links,
      wordCount: parsed.wordCount,
      jsonLdTypes: parsed.jsonLdTypes,
      issues: computeIssues(parsed),
    });
    parsed.links.forEach(enqueue);
  }

  return { pages, skipped, fetchedAt };
}

// --- Free pre-discovery (site-size estimate) ------------------------------------

export interface SiteSizeEstimate {
  /** Best-effort discovered page count, or null when discovery could not run / degraded. */
  readonly pages: number | null;
  /** Where the count came from: the sitemap, a homepage-link floor, or nothing usable. */
  readonly source: "sitemap" | "homepage" | "unknown";
}

/** Bounded ceiling on the sitemap URLs the estimator counts — enough to flag a >1000-page site. */
const ESTIMATE_SITEMAP_LIMIT = 5_000;
/** Default wall-clock budget for each fetch in the free pre-discovery, ms. */
const DEFAULT_ESTIMATE_TIMEOUT_MS = 5_000;

/** Count distinct same-origin, in-scope links in `html` (a homepage-size floor). Pure. */
function countInScopeLinks(html: string, originUrl: URL, prefixes: readonly string[]): number {
  const { links } = parseHtml(html, normalizeUrl(originUrl.toString()));
  const seen = new Set<string>();
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link);
    } catch {
      continue;
    }
    if (!sameOrigin(u, originUrl)) continue;
    if (!matchesIncludePaths(u.pathname, prefixes)) continue;
    seen.add(normalizeUrl(link));
  }
  return seen.size;
}

/**
 * FREE, guarded, best-effort pre-discovery of a site's size — the input to crawl_site's
 * large-site confirmation. It NEVER throws and NEVER charges (it opens no ledger): any
 * failure, timeout, or blocked origin degrades to `{ pages: null, source: "unknown" }`, so it
 * can never block a crawl. It reuses the SAME SSRF-guarded path crawlSite uses — the origin
 * gate (originGateReason) and the guarded fetchText / bounded sitemap expansion
 * (loadSitemapSeeds) — so there is ONE guarded fetcher, not a second with different rules.
 *
 *  - a blocked / non-public / invalid origin returns null WITHOUT any fetch;
 *  - /sitemap.xml (one bounded level of index expansion) -> count same-origin, in-scope
 *    `<loc>`s -> source "sitemap";
 *  - otherwise the homepage's same-origin, in-scope links as a rough floor -> source "homepage";
 *  - `includePaths` scopes the count exactly as it scopes the crawl.
 */
export async function estimateSiteSize(
  origin: string,
  opts: { lookup?: LookupFn; timeoutMs?: number; includePaths?: string[] } = {},
): Promise<SiteSizeEstimate> {
  const lookup = opts.lookup ?? defaultLookup;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ESTIMATE_TIMEOUT_MS;
  const prefixes = normalizeIncludePaths(opts.includePaths);

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return { pages: null, source: "unknown" };
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    return { pages: null, source: "unknown" };
  }

  try {
    // The SAME origin gate crawlSite applies — a blocked origin is never fetched.
    if ((await originGateReason(originUrl, lookup)) !== null) {
      return { pages: null, source: "unknown" };
    }

    // Guarded sitemap count (reuses loadSitemapSeeds' fetchText + bounded index expansion).
    const sitemapSeeds = await loadSitemapSeeds(
      originUrl,
      timeoutMs,
      ESTIMATE_SITEMAP_LIMIT,
      lookup,
      prefixes,
    );
    if (sitemapSeeds.length > 0) {
      return { pages: sitemapSeeds.length, source: "sitemap" };
    }

    // No usable sitemap -> the homepage's in-scope same-origin links as a rough floor.
    const home = await fetchText(rootSeedOf(originUrl), timeoutMs, lookup);
    if (!home || home.status !== 200 || !home.body) {
      return { pages: null, source: "unknown" };
    }
    const links = countInScopeLinks(home.body, originUrl, prefixes);
    return links > 0 ? { pages: links, source: "homepage" } : { pages: null, source: "unknown" };
  } catch {
    // Best-effort: pre-discovery must NEVER throw — any surprise degrades to unknown.
    return { pages: null, source: "unknown" };
  }
}

/** The normalized homepage URL for an origin (shared spelling with the crawl's root seed). */
function rootSeedOf(originUrl: URL): string {
  return normalizeUrl(originUrl.toString());
}
