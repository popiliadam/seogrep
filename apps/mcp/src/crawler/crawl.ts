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

import type { Dispatcher } from "undici";
import {
  clampField,
  contentHash,
  type Hreflang,
  type HtmlSignals,
  MAX_FIELD_CHARS,
  parseAttrs,
  parseHtmlSignals,
  textOf,
} from "./page-signals.ts";
import { pinnedDispatcherFor, withPin } from "./pinned-fetch.ts";
import { parseRobots, type RobotsRules } from "./robots.ts";
import { decodeEntities, parseSitemap } from "./sitemap.ts";
import {
  checkPublicHost,
  defaultLookup,
  type LookupFn,
  nonPublicHostnameReason,
} from "./ssrf.ts";

/**
 * Everything one crawled page contributes to jobs.result.
 *
 * The signal block below (fetchMs … inLinkCount) is deliberately FREE: every field comes out
 * of the response the crawler was already making — its headers, its redirect chain, its timing,
 * its already-downloaded HTML — or, for inLinkCount, out of one pass over the finished result.
 * Not one of them costs an extra request.
 */
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

  // --- Free signals (no extra request) -------------------------------------------
  /**
   * Wall-clock ms from the first request of this page's chain until its body was read,
   * rounded UP. A measured sub-millisecond fetch reports 1, never 0 — 0 would read as
   * "not measured". Redirect hops are INCLUDED: the number is what the tenant's visitor
   * would wait for, not what one hop cost.
   */
  readonly fetchMs: number;
  /**
   * DECOMPRESSED bytes read off the response body. A body over MAX_HTML_BYTES is never
   * stored — the crawler REFUSES it and records a skip (see the `too-large` outcome) — so a
   * stored record's htmlBytes is always a COMPLETE body, and no truncation flag is needed
   * here. Non-HTML and empty-redirect responses are not stored either.
   */
  readonly htmlBytes: number;
  /** `<h2>` / `<h3>` tag counts (counts, not text — see HtmlSignals). */
  readonly h2Count: number;
  readonly h3Count: number;
  /** `<img>` count, and how many of them have no usable alt (absent OR empty alt). */
  readonly imgCount: number;
  readonly imgMissingAlt: number;
  /** `<link rel="alternate" hreflang=…>` alternates, capped at MAX_HREFLANGS. */
  readonly hreflangs: Hreflang[];
  /** OpenGraph values as declared (clamped, null when absent) — not booleans: a rule engine
   * can derive "og missing" from a null, but it cannot derive the value from a `true`. */
  readonly ogTitle: string | null;
  readonly ogDescription: string | null;
  readonly ogImage: string | null;
  /** `twitter:card` content, clamped; null when absent. */
  readonly twitterCard: string | null;
  /** `<html lang="…">`, clamped; null when absent. */
  readonly htmlLang: string | null;
  /** The response's `X-Robots-Tag` header, clamped; null when the header is absent. */
  readonly xRobotsTag: string | null;
  /**
   * The URLs that REDIRECTED to this page, in hop order, excluding the final URL itself
   * ([] when the page was served directly). Bounded by MAX_REDIRECTS; each entry clamped.
   */
  readonly redirectChain: string[];
  /** SHA-256 (hex) of the page's normalized text — the duplicate-content fingerprint. */
  readonly contentHash: string;
  /** BFS depth: a seed (homepage / sitemap URL) is 0, a page discovered on it is 1, … */
  readonly depth: number;
  /**
   * How many DISTINCT pages in this same crawl link to this URL. Two links from one page
   * count once; a page that links to itself counts as one source (the count is over source
   * PAGES, and a self-referencing page is one of them). Computed in a single pass after the
   * crawl, so it only ever sees pages this crawl actually stored — it is not a site-wide
   * inbound-link count.
   */
  readonly inLinkCount: number;
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
   * Pause before the ONE automatic robots.txt retry, ms (default 2_000). A blip (a
   * restarting origin, a dropped connection) should not cost the tenant a whole crawl,
   * but the retry must not hammer a struggling site either. Test knob.
   */
  robotsRetryDelayMs?: number;
  /**
   * The sleep the robots retry waits on (default: the module's real timer sleep). Injected
   * so specs assert the delay seam is honored WITH ITS EXACT VALUE instead of measuring a
   * wall clock — no test ever really sleeps, and no assertion depends on timing. Test knob.
   */
  robotsRetrySleep?: (ms: number) => Promise<void>;
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
export interface ParsedHtml extends HtmlSignals {
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly h1s: string[];
  readonly canonical: string | null;
  readonly robotsMeta: string | null;
  /** Absolute, deduped href targets (non-http(s) schemes dropped), capped per page. */
  readonly links: string[];
  readonly wordCount: number;
  /** True when the page carried more links than MAX_LINKS_PER_PAGE (the rest were dropped). */
  readonly linksTruncated: boolean;
  /** Schema.org @type names from JSON-LD blocks ([] when none/malformed). */
  readonly jsonLdTypes: string[];
  /** SHA-256 (hex) of the page's normalized text (see page-signals.contentHash). */
  readonly contentHash: string;
}

/**
 * Per-RECORD ceilings (H-02). The 2 MB body ceiling bounds what we READ; these bound what
 * one page may become. Without them a bounded body still explodes downstream: 2 MB of
 * "<h1></h1>" is ~200k headings, one <title> may carry the whole 2 MB, and 100 such pages
 * are persisted verbatim into jobs.result. Every number here is far above any real page —
 * a document with >1000 links or >100 h1s is already pathological, and 2000 characters is
 * ~10x the longest useful title/description and above the practical URL length.
 */
const MAX_LINKS_PER_PAGE = 1_000;
const MAX_H1S_PER_PAGE = 100;
const MAX_JSONLD_TYPES = 100;
// MAX_FIELD_CHARS and clampField live in page-signals.ts — the parsers there clamp against the
// same ceiling, and one spelling of a ceiling is the only way it stays one ceiling.

/** Resolve `href` against `baseUrl`, keeping only http(s); null if invalid. */
function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** First capture group of `re` in `html`, entity-decoded and clamped; null if absent/blank. */
function firstGroup(re: RegExp, html: string): string | null {
  const match = re.exec(html);
  const group = match?.[1];
  if (group === undefined) return null;
  const value = decodeEntities(group).trim();
  return value ? clampField(value) : null;
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
    if (typeof value !== "string" || types.length >= MAX_JSONLD_TYPES) return;
    const name = clampField(value.trim());
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
    const value = a.content?.trim();
    if (name === "description" && metaDescription === null) metaDescription = value ? clampField(value) : null;
    if (name === "robots" && robotsMeta === null) robotsMeta = value ? clampField(value) : null;
  }

  let canonical: string | null = null;
  for (const m of content.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1] ?? "");
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && a.href) {
      // An over-long URL is DROPPED, never clamped: a truncated URL is not a shorter
      // answer, it is a wrong one.
      const resolved = resolveUrl(a.href, baseUrl);
      canonical = resolved !== null && resolved.length <= MAX_FIELD_CHARS ? resolved : null;
      break;
    }
  }

  const h1s: string[] = [];
  for (const m of content.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) {
    if (h1s.length >= MAX_H1S_PER_PAGE) break;
    const text = textOf(m[1] ?? "");
    if (text) h1s.push(clampField(text));
  }

  const links: string[] = [];
  const seen = new Set<string>();
  let linksTruncated = false;
  for (const m of content.matchAll(/<a\b([^>]*)>/gi)) {
    if (links.length >= MAX_LINKS_PER_PAGE) {
      // BREAK, do not filter afterwards: matchAll is lazy, so stopping here means the rest
      // of a link-flooded document is never scanned or turned into strings.
      linksTruncated = true;
      break;
    }
    const href = parseAttrs(m[1] ?? "").href;
    const abs = href ? resolveUrl(href, baseUrl) : null;
    // Normalize link targets (drop fragment / trailing slash) so same-page anchors
    // collapse and the field matches the crawler's dedupe key.
    const norm = abs ? normalizeUrl(abs) : null;
    if (norm && norm.length <= MAX_FIELD_CHARS && !seen.has(norm)) {
      seen.add(norm);
      links.push(norm);
    }
  }

  const words = textOf(content);
  const wordCount = words ? words.split(/\s+/).filter(Boolean).length : 0;

  // Read JSON-LD from the RAW html (parseJsonLdTypes scopes its own script blocks),
  // not the script-stripped `content` above.
  const jsonLdTypes = parseJsonLdTypes(html);

  // Free signals (headings, images, hreflang, og/twitter, html lang) off the SAME cleaned
  // view everything else above is parsed from, plus the duplicate-content fingerprint. The
  // hash is taken over `content` — script/style bodies excluded — so a rotating analytics
  // nonce or inline CSP token does not make the same copy look like a different page.
  const signals = parseHtmlSignals(content);

  return {
    title,
    metaDescription,
    h1s,
    canonical,
    robotsMeta,
    links,
    wordCount,
    linksTruncated,
    jsonLdTypes,
    contentHash: contentHash(content),
    ...signals,
  };
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
const DEFAULT_ROBOTS_RETRY_DELAY_MS = 2_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Ceilings on how much DECOMPRESSED body the crawler will hold for ONE response. The URL
 * count (100) and the wall clock (90 s) bound how MANY answers we take, not how big one may
 * be — and Content-Length cannot supply that bound: it describes WIRE bytes (a gzip bomb is
 * ~20 KB on the wire and 20 MB in memory) and a chunked response carries no length at all.
 * So the crawler counts bytes off the body reader and CANCELS the transfer at the ceiling.
 *
 * Sizing, against the 512 MB machine in apps/mcp/fly.toml: page fetches overlap up to
 * MAX_CONCURRENT_FETCHES, so at most that many bodies are in flight at once and the live
 * cost is those bodies (<= 4 x 2 MB) plus the accumulated result (bounded separately).
 * Sitemap/robots reads stay strictly sequential. 2 MB is ~20x a large real HTML document. 8 MB
 * lets a legitimately large sitemap through — it already carries ~150k <loc>s, far more than
 * either the 100-URL crawl or the 5000-URL estimate can consume, so the sitemaps.org 50 MB
 * file limit is deliberately NOT honoured on a shared 512 MB machine. robots.txt gets the
 * RFC 9309 §2.5 parse limit (a crawler MAY cap parsing at >= 500 KiB and ignore the rest).
 */
const MAX_HTML_BYTES = 2_000_000;
/** How many children of a <sitemapindex> are expanded. Unchanged value, named for the loop. */
const MAX_CHILD_SITEMAPS = 5;

const MAX_SITEMAP_BYTES = 8_000_000;
const MAX_ROBOTS_BYTES = 512 * 1024;

/**
 * Discovery ceilings (H-02). The BFS queue exists ONLY to choose the next <= maxUrls pages,
 * so 5000 candidates is already 50x more than the 100-page contract can ever consume — past
 * that it is ballast that grows with every link-flooded page. skipped[] needs its own bound
 * because the queue is DRAINED into it when a limit is hit: an unbounded queue meant an
 * unbounded skip list AND an unbounded jobs.result row. 500 entries is 5x the page cap, and
 * whatever exceeds it is reported as one honest summary line rather than dropped in silence.
 */
const MAX_QUEUE_URLS = 5_000;
const MAX_SKIPPED = 500;
/**
 * Room RESERVED inside MAX_SKIPPED for the ceiling notes the crawl appends at the end (skip
 * overflow, link flood, queue full). Reserving it here is what keeps those notes from being
 * the entries a later bound trims away — the whole point of them is that they survive.
 */
const MAX_CEILING_NOTES = 3;
const MAX_SKIPPED_LISTED = MAX_SKIPPED - MAX_CEILING_NOTES;
/** Hard ceiling on the pages a persisted result may carry (== the tool's own 100-URL cap). */
const MAX_PAGES_PERSISTED = 100;

/**
 * TOTAL byte ceiling on the pages one crawl accumulates (T8) — the ONE bound here that does
 * not multiply.
 *
 * Every ceiling above bounds ONE thing: one body (2 MB), one page's links (1000), one field
 * (2000 chars), one result's page COUNT (100). Their PRODUCT is invisible to all of them: a
 * page carrying 1000 links of 2000 characters is individually legal at ~2 MB, and 100 such
 * pages are ~200 MB of strings that JSON.stringify then roughly doubles at the moment of
 * persisting — on the 512 MB machine in apps/mcp/fly.toml that is the whole machine, and a
 * jobs.result row nobody can read back.
 *
 * 12 MB is ~2 orders of magnitude above any real 100-page crawl (a fat real page record is a
 * few KB) while leaving the adversarial case bounded. skipped[] is bounded separately and
 * independently (MAX_SKIPPED x the field ceilings, ~2 MB worst case), so a whole persisted
 * result stays under ~14 MB.
 */
const MAX_RESULT_BYTES = 12_000_000;

/** The one spelling of the skip-list overflow line, shared by the crawl and the bound. */
const skipOverflowReason = (dropped: number): string =>
  `skip list truncated at ${MAX_SKIPPED} entries; ${dropped} more URL(s) were skipped but not listed`;

/**
 * The tenant-visible reason a URL was not crawled because the result hit MAX_RESULT_BYTES.
 * Honest and actionable: it names the bound, says the page was NOT read, and says what to
 * change. Shared by the crawl (per URL, like the other two limit paths) and the bound.
 */
const RESULT_BUDGET_REASON =
  `result byte budget reached (${MAX_RESULT_BYTES} bytes of page data); this URL was not ` +
  "included — narrow the crawl with include_paths or a lower max_urls to cover it";

/** The bound's one-line summary when it had to DROP already-crawled pages to fit the budget. */
const resultBudgetDropReason = (dropped: number): string =>
  `result byte budget reached (${MAX_RESULT_BYTES} bytes of page data); ${dropped} crawled ` +
  "page(s) were dropped from the stored result — narrow the crawl with include_paths " +
  "or a lower max_urls to cover them";

/**
 * UTF-8 byte size of a value's JSON encoding — the exact unit the persisted jobs.result row
 * is measured in, so the budget bounds the real thing rather than a proxy for it.
 */
function jsonByteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

/**
 * One response header, trimmed and clamped; null when absent or blank. Repeated headers are
 * joined by the Headers object itself ("noindex, nofollow"), which is the form a rule engine
 * wants to read anyway.
 */
function headerOrNull(res: Response, name: string): string | null {
  const value = res.headers.get(name)?.trim();
  return value ? clampField(value) : null;
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
  /** Wall clock for the WHOLE chain (first request -> body read), ms, rounded up. */
  readonly fetchMs: number;
  /** Decompressed body bytes actually read (0 when the body was not read at all). */
  readonly htmlBytes: number;
  /** The final response's `X-Robots-Tag` header, clamped; null when absent. */
  readonly xRobotsTag: string | null;
  /** URLs that redirected to `finalUrl`, in hop order, excluding `finalUrl` itself. */
  readonly redirectChain: string[];
}
type FetchOutcome =
  | FetchOk
  | { readonly kind: "timeout" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "too-large"; readonly limitBytes: number }
  | { readonly kind: "too-many-redirects" }
  | { readonly kind: "off-origin-redirect"; readonly target: string };

/**
 * One URL claimed off the crawl queue, awaiting its commit. A `robots` slot was never
 * fetched (it costs no concurrency slot) but keeps its place so the skip list stays in
 * dequeue order; a `fetch` slot carries the in-flight request.
 */
type PendingSlot =
  | { readonly kind: "robots"; readonly url: string; readonly depth: number }
  | {
      readonly kind: "fetch";
      readonly url: string;
      readonly depth: number;
      readonly outcome: Promise<FetchOutcome>;
    };

/**
 * One URL waiting in the BFS queue, carrying the depth it was discovered at. The depth has to
 * travel WITH the URL: the wave architecture claims a batch off the queue head and commits it
 * later, so "the depth of whatever we are working on" is not a variable the loop can hold.
 * A seed (homepage or sitemap URL) is depth 0; a link found on a depth-N page is N+1.
 */
interface QueueItem {
  readonly url: string;
  readonly depth: number;
}

/**
 * How many page fetches may be in flight at once (per crawl — and, since a crawl never
 * leaves its origin, per origin).
 *
 * ONLY applies when robots.txt sets NO Crawl-delay. A Crawl-delay is a politeness contract
 * the site wrote down, so when one is present the crawl stays STRICTLY sequential (one fetch
 * in flight, the delay slept between fetches) and is byte-identical to the pre-parallel
 * crawler. Overlapping fetches while claiming to honor a spacing request would be a lie.
 *
 * WHY 4: the 90 s wall-clock budget, not maxUrls, is what actually ends real crawls — live on
 * three sites the dominant skip reason was "time budget exhausted" at ~25-40 pages. Overlap is
 * the only lever that moves that number without touching politeness. 4 keeps the worst-case
 * live bodies at 4 x MAX_HTML_BYTES (8 MB) on the 512 MB machine in apps/mcp/fly.toml, and is
 * gentle enough that an ordinary origin never sees more than four of our sockets at once.
 */
const MAX_CONCURRENT_FETCHES = 4;

/** Release the per-hop pinned dispatchers a chain opened (bodies are consumed by now). */
async function destroyAll(dispatchers: readonly Dispatcher[]): Promise<void> {
  await Promise.allSettled(dispatchers.map((d) => d.destroy()));
}

/** A body read that either completed or stopped at its ceiling. */
interface CappedBody {
  readonly text: string;
  /** True when `maxBytes` would have been exceeded and the rest was CANCELLED. */
  readonly truncated: boolean;
  /** DECOMPRESSED bytes counted off the reader — what actually landed in memory. */
  readonly bytes: number;
}

/**
 * Read a response body as text, counting DECOMPRESSED bytes and cancelling the transfer the
 * moment `maxBytes` would be exceeded. undici inflates Content-Encoding before this stream,
 * so what is counted here is exactly what would land in memory. Cancelling (rather than
 * abandoning) releases the socket instead of letting a hostile server keep pushing.
 *
 * Chunks are collected and joined ONCE — never `text += chunk` — so a body that runs to the
 * ceiling costs O(maxBytes), not O(maxBytes^2). A read that rejects (abort, socket reset)
 * propagates to the caller's existing failure path unchanged.
 */
async function readCappedText(res: Response, maxBytes: number): Promise<CappedBody> {
  if (!res.body) return { text: "", truncated: false, bytes: 0 };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || value === undefined) break;
    if (total + value.byteLength > maxBytes) {
      // The overflowing chunk is dropped whole rather than sliced: a partial chunk buys
      // nothing here and could end in a half-decoded multi-byte sequence.
      await reader.cancel().catch(() => undefined);
      return { text: chunks.join(""), truncated: true, bytes: total };
    }
    total += value.byteLength;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return { text: chunks.join("") + decoder.decode(), truncated: false, bytes: total };
}

/**
 * Fetch one page, following up to MAX_REDIRECTS same-origin redirects manually so
 * the whole chain shares a single timeout and off-origin hops can be rejected. Only
 * text/html bodies are read; other content types return with an empty body for the
 * caller to skip. AbortController bounds the entire chain to `timeoutMs`.
 *
 * Every hop — the first request included — is re-validated and PINNED to the address
 * that validation just approved (pinnedDispatcherFor). The chain is same-origin, so the
 * hostname never changes, but a hostile low-TTL answer can still flip that one name to an
 * internal address between hops; the origin gate validated once and cannot see that. A
 * refused hop emits NO request and reports through the existing fetch-failure path.
 */
async function fetchPage(
  url: string,
  origin: URL,
  timeoutMs: number,
  lookup: LookupFn,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatchers: Dispatcher[] = [];
  // The chain's own clock and hop trail. Both are free — the requests are happening anyway —
  // and both are measured across the WHOLE chain, because that is what a visitor experiences.
  const startedAt = performance.now();
  // Rounded UP: a measured sub-millisecond fetch must not report 0, which would be
  // indistinguishable from "never measured".
  const elapsedMs = (): number => Math.ceil(performance.now() - startedAt);
  const redirectChain: string[] = [];
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const pin = await pinnedDispatcherFor(current, lookup);
      if ("blocked" in pin) return { kind: "error", message: pin.blocked };
      dispatchers.push(pin.dispatcher);
      const res = await fetch(
        current,
        withPin(
          {
            redirect: "manual",
            signal: controller.signal,
            headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
          },
          pin.dispatcher,
        ),
      );
      const contentType = res.headers.get("content-type") ?? "";
      const xRobotsTag = headerOrNull(res, "x-robots-tag");
      if (REDIRECT_STATUS.has(res.status)) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) {
          return {
            kind: "ok",
            status: res.status,
            finalUrl: current,
            contentType,
            body: "",
            fetchMs: elapsedMs(),
            htmlBytes: 0,
            xRobotsTag,
            redirectChain,
          };
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { kind: "error", message: "invalid redirect location" };
        }
        if (!sameOrigin(next, origin)) return { kind: "off-origin-redirect", target: next.toString() };
        // The hop we are LEAVING is what belongs in the chain; the URL finally served is the
        // record's own `url` and would be a duplicate here.
        redirectChain.push(clampField(current));
        current = next.toString();
        continue;
      }
      if (!isHtml(contentType)) {
        await res.body?.cancel();
        return {
          kind: "ok",
          status: res.status,
          finalUrl: current,
          contentType,
          body: "",
          fetchMs: elapsedMs(),
          htmlBytes: 0,
          xRobotsTag,
          redirectChain,
        };
      }
      // A page over the ceiling is REFUSED, not truncated: half a document parses into
      // misleading signals (a "missing title" that is only missing because we stopped
      // reading). The caller records it as skipped with an honest reason instead.
      const capped = await readCappedText(res, MAX_HTML_BYTES);
      if (capped.truncated) return { kind: "too-large", limitBytes: MAX_HTML_BYTES };
      return {
        kind: "ok",
        status: res.status,
        finalUrl: current,
        contentType,
        body: capped.text,
        fetchMs: elapsedMs(),
        htmlBytes: capped.bytes,
        xRobotsTag,
        redirectChain,
      };
    }
    return { kind: "too-many-redirects" };
  } catch (error) {
    if (controller.signal.aborted) return { kind: "timeout" };
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    await destroyAll(dispatchers);
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
 * On top of that, every hop is PINNED to the address its own validation just approved
 * (pinnedDispatcherFor), so the socket cannot be steered elsewhere by a second resolution
 * — the DNS-rebinding close. Order per hop is validate -> pin -> emit; a hop whose host
 * fails resolution emits nothing and returns null like any other failure.
 *
 * CALLER CONTRACT: the INITIAL url's host is the caller's responsibility to validate —
 * crawlSite vets the crawl origin before any fetchText. fetchText validates cross-origin
 * REDIRECT hops only.
 *
 * `maxBytes` bounds the DECOMPRESSED body (see the ceilings above). Unlike a page, a text
 * resource over its ceiling is TRUNCATED rather than refused, because the prefix is still
 * the useful answer: RFC 9309 §2.5 prescribes exactly this for robots.txt, and a sitemap
 * prefix at 8 MB already carries far more <loc>s than any crawl or estimate can consume.
 */
async function fetchText(
  url: string,
  timeoutMs: number,
  lookup: LookupFn,
  maxBytes: number,
): Promise<{ status: number; body: string } | null> {
  let requestedOrigin: URL;
  try {
    requestedOrigin = new URL(url);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatchers: Dispatcher[] = [];
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const pin = await pinnedDispatcherFor(current, lookup);
      if ("blocked" in pin) return null;
      dispatchers.push(pin.dispatcher);
      const res = await fetch(
        current,
        withPin(
          { redirect: "manual", signal: controller.signal, headers: { "user-agent": USER_AGENT } },
          pin.dispatcher,
        ),
      );
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
      return { status: res.status, body: (await readCappedText(res, maxBytes)).text };
    }
    return null; // exceeded MAX_REDIRECTS -> unreachable
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    await destroyAll(dispatchers);
  }
}

/**
 * WHY the two unreachable causes are kept apart: they are different problems with
 * different fixes, and the tenant is the only one who can act on either. "The site
 * answered 5xx for robots.txt" is a bug on their server; "we could not reach it at
 * all" is a DNS/network/timeout problem. Collapsing both into one "unreachable" told
 * the user nothing they could act on.
 */
export type RobotsUnreachableCause = "server_error" | "network";

type RobotsLoad =
  | { readonly kind: "ok"; readonly rules: RobotsRules }
  | { readonly kind: "unreachable"; readonly cause: RobotsUnreachableCause };

/**
 * The tenant-visible skip reason per cause. These strings travel verbatim into the crawl
 * queue handler's "no pages could be crawled" error, which is what the user finally reads
 * via get_job_status — so each one names WHAT happened and WHAT to do next. They are
 * pinned by spec; keep them honest (never claim something the code does not guarantee)
 * and keep the phrase "robots" in them (audit's categorizeSkip buckets on it).
 */
const ROBOTS_UNREACHABLE_REASON: Record<RobotsUnreachableCause, string> = {
  server_error:
    "robots.txt returned a server error (5xx) on your site; we did not crawl to stay polite. " +
    "Fix robots.txt, then run crawl_site again.",
  network:
    "we could not reach robots.txt (network error or timeout); we did not crawl. " +
    "Check that the site is reachable, then run crawl_site again.",
};

/**
 * Load /robots.txt with RFC 9309 reachability semantics: 200 parses the rules;
 * a 4xx (file absent / client error) means no restrictions, so allow-all; a 5xx
 * or a network failure (timeout, refused, DNS) means the file is UNREACHABLE and
 * the crawler must assume complete disallow — the caller aborts the crawl. The two
 * unreachable shapes are distinguished (see RobotsUnreachableCause): an HTTP answer
 * of 5xx is `server_error`; a null fetchText (timeout, refused, DNS, refused redirect,
 * blocked pin) is `network`.
 */
async function loadRobots(origin: URL, timeoutMs: number, lookup: LookupFn): Promise<RobotsLoad> {
  const res = await fetchText(
    new URL("/robots.txt", origin).toString(),
    timeoutMs,
    lookup,
    MAX_ROBOTS_BYTES,
  );
  if (res === null) return { kind: "unreachable", cause: "network" };
  if (res.status >= 500) return { kind: "unreachable", cause: "server_error" };
  return { kind: "ok", rules: parseRobots(res.status === 200 ? res.body : "") };
}

/**
 * loadRobots plus ONE automatic retry after `retryDelayMs`. A transient blip (a restarting
 * origin, a dropped connection) otherwise costs the tenant an entire crawl, and a re-run
 * costs them credits. Exactly two attempts, never more — a struggling site must not be
 * hammered, and this is a politeness-first crawler.
 *
 * A REACHED robots.txt (200 or 4xx) is never re-fetched: only the unreachable shapes retry.
 * The reported cause is the SECOND attempt's, because that is the state the site was
 * actually left in.
 */
async function loadRobotsWithRetry(
  origin: URL,
  timeoutMs: number,
  lookup: LookupFn,
  retryDelayMs: number,
  retrySleep: (ms: number) => Promise<void>,
): Promise<RobotsLoad> {
  const first = await loadRobots(origin, timeoutMs, lookup);
  if (first.kind === "ok") return first;
  await retrySleep(retryDelayMs);
  return loadRobots(origin, timeoutMs, lookup);
}

/**
 * A TOTAL wall-clock budget shared by a SEQUENCE of fetches (M-19). Per-fetch timeouts bound
 * one hop; over a hop sequence they multiply, and the product is what a caller waits on. A
 * deadline is checked BEFORE each hop and clamps that hop's own timeout to what is left, so
 * the sequence can neither overrun the budget nor leave orphaned requests running past it
 * (which is exactly what a Promise.race around the whole thing would do).
 *
 * `null` means NO deadline — the crawl path, which already has its own whole-crawl
 * timeBudgetMs, passes null and is therefore byte-identical to before.
 */
type Deadline = { readonly remainingMs: () => number } | null;

/** Open a deadline `budgetMs` from now. */
function deadlineIn(budgetMs: number): Deadline {
  const endsAt = Date.now() + budgetMs;
  return { remainingMs: () => endsAt - Date.now() };
}

/**
 * The timeout ONE hop may spend: its own timeout, clamped to whatever the deadline leaves.
 * A return value <= 0 means the budget is spent and the hop must NOT be emitted.
 */
function hopTimeout(deadline: Deadline, timeoutMs: number): number {
  return deadline === null ? timeoutMs : Math.min(timeoutMs, deadline.remainingMs());
}

/**
 * Seed URLs from /sitemap.xml (one bounded level of index expansion); [] if none. When
 * `prefixes` is non-empty, only same-origin locs whose pathname is in scope are kept — an
 * empty `prefixes` (the default) filters nothing, so the crawl's existing behavior is
 * byte-identical. The guarded fetchText path (incl. its cross-origin redirect checks) is
 * unchanged; scoping is a pure post-fetch filter.
 *
 * `deadline` (default null = none) bounds the WHOLE root+children sequence rather than each
 * hop: an exhausted budget returns the seeds found so far, which is a FLOOR — honest for
 * every consumer here, since both callers already treat the count as approximate.
 */
async function loadSitemapSeeds(
  origin: URL,
  timeoutMs: number,
  limit: number,
  lookup: LookupFn,
  prefixes: readonly string[] = [],
  deadline: Deadline = null,
): Promise<string[]> {
  const seeds: string[] = [];
  const seen = new Set<string>();
  /**
   * Normalize ONE loc, or null when it is unusable: unparseable, off-origin, out of scope, or
   * already claimed. Claiming happens here, so a loc can only ever be counted once.
   *
   * Split out of `add` because a child sitemap's list has to be filtered BEFORE it is capped.
   * Capping the RAW list instead — which an earlier draft did — silently spends a budget slot on
   * every loc the filters would have rejected: measured, a child holding 8 blog locs ahead of 4
   * shop locs under include_paths:["/shop"] yielded ZERO shop pages with a budget of 8, where
   * the pre-interleave code yielded all four. That is the same disease this work came to cure.
   */
  const claim = (raw: string): string | null => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (!sameOrigin(u, origin)) return null;
    if (!matchesIncludePaths(u.pathname, prefixes)) return null;
    const norm = normalizeUrl(u.toString());
    if (seen.has(norm)) return null;
    seen.add(norm);
    return norm;
  };

  const add = (raw: string): void => {
    // Stop ACCUMULATING at the limit, rather than collecting everything and slicing at the
    // end: the slice bounded the answer, not the memory it took to produce it.
    if (seeds.length >= limit) return;
    const norm = claim(raw);
    if (norm !== null) seeds.push(norm);
  };

  const rootTimeout = hopTimeout(deadline, timeoutMs);
  if (rootTimeout <= 0) return seeds;
  const root = await fetchText(
    new URL("/sitemap.xml", origin).toString(),
    rootTimeout,
    lookup,
    MAX_SITEMAP_BYTES,
  );
  if (!root || root.status !== 200) return seeds;
  const parsed = parseSitemap(root.body);
  parsed.urls.forEach(add);
  // Each child's URLs are kept SEPARATE so they can be interleaved below. Concatenating them —
  // which is what this did — spends the whole budget on whichever child the index happens to
  // list first. Measured on adstark.com.tr: a Yoast index whose post sitemap (47 URLs) precedes
  // its page sitemap (17), so a 25-page crawl took 25 posts and not one commercial page.
  // Each list is capped at `limit` USABLE urls — see `claim` for why the cap cannot sit on the
  // raw locs.
  const childLists: string[][] = [];
  // No early exit across children, and none is possible: interleaving has to SEE every child
  // before it can take one URL from each. The old loop broke out once `seeds` hit the limit,
  // which did save fetches — that saving is genuinely gone, and it is the price of the fix.
  // A `seeds.length < limit` guard here would be dead code rather than a partial recovery:
  // parseSitemap returns either urls or sitemaps and never both, so whenever there ARE children
  // the root urlset is empty and seeds is still 0.
  for (const child of parsed.sitemaps.slice(0, MAX_CHILD_SITEMAPS)) {
    // Budget check BEFORE the hop: an exhausted deadline stops expansion here, so the
    // remaining children are never requested at all.
    const childTimeout = hopTimeout(deadline, timeoutMs);
    if (childTimeout <= 0) break;
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
    const res = await fetchText(child, childTimeout, lookup, MAX_SITEMAP_BYTES);
    if (!res || res.status !== 200) continue;
    // FILTER first, then cap: the cap must bound usable URLs, not raw locs (see `claim`).
    const usable: string[] = [];
    for (const loc of parseSitemap(res.body).urls) {
      if (usable.length >= limit) break;
      const norm = claim(loc);
      if (norm !== null) usable.push(norm);
    }
    childLists.push(usable);
  }

  // Round-robin: one URL from each child in turn. Semantic-free — nothing here guesses which
  // child matters — but under any budget every child is represented in proportion, so the
  // pages a site sells from cannot be starved by the size of its blog archive. Every URL here
  // has already passed the same-origin, scope and dedupe filters, so which URLs are ELIGIBLE is
  // unchanged from before — what changes is which of them a short budget spends itself on.
  const longest = childLists.reduce((max, list) => Math.max(max, list.length), 0);
  for (let index = 0; index < longest && seeds.length < limit; index++) {
    for (const list of childLists) {
      if (seeds.length >= limit) break;
      const url = list[index];
      // Already claimed and normalized by `claim`, so it goes straight in.
      if (url !== undefined) seeds.push(url);
    }
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
  const robotsRetryDelayMs = opts.robotsRetryDelayMs ?? DEFAULT_ROBOTS_RETRY_DELAY_MS;
  const robotsRetrySleep = opts.robotsRetrySleep ?? sleep;
  const lookup = opts.lookup ?? defaultLookup;
  const prefixes = normalizeIncludePaths(opts.includePaths);

  // SSRF origin gate (shared with estimateSiteSize via originGateReason). The origin is
  // tenant-controlled, so before any request goes out it must resolve to a public address;
  // a refused origin fetches nothing downstream (robots, sitemap, pages). This also catches a
  // PRE-EXISTING stored domain that would only now be judged non-public.
  const gateReason = await originGateReason(originUrl, lookup);
  if (gateReason !== null) return blockedOrigin(originUrl, gateReason, fetchedAt);

  // One automatic retry first — a blip must not cost a whole crawl (loadRobotsWithRetry).
  const robotsLoad = await loadRobotsWithRetry(
    originUrl,
    pageTimeoutMs,
    lookup,
    robotsRetryDelayMs,
    robotsRetrySleep,
  );
  if (robotsLoad.kind === "unreachable") {
    // RFC 9309: an unreachable robots.txt (5xx / network failure) = complete disallow.
    // Stop before fetching anything else — the sitemap included. The policy is UNCHANGED
    // by the retry; only the reason the user reads is now cause-specific and actionable.
    return {
      pages: [],
      skipped: [
        {
          url: normalizeUrl(originUrl.toString()),
          reason: ROBOTS_UNREACHABLE_REASON[robotsLoad.cause],
        },
      ],
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
  // The homepage goes FIRST, ahead of the sitemap, not merely as the fallback when there is no
  // sitemap. A sitemap is not ordered by importance: a Yoast <sitemapindex> lists the post
  // sitemap before the page one, so "/" can sit hundreds of entries deep and never survive the
  // ceilings. Measured live 2026-08-07 — a 20-credit crawl returned 24 blog posts and dropped
  // the homepage plus every commercial page as "time budget exhausted". Whatever the budget
  // buys, it buys the homepage first. Scope still wins: an out-of-scope root is not forced in
  // (with no prefixes matchesIncludePaths is always true, so the common case is unchanged), and
  // the Set below keeps a sitemap that ALSO lists "/" from queueing it twice.
  const rootInScope = matchesIncludePaths(new URL(rootSeed).pathname, prefixes);
  // Deduped at construction: a sitemap that ALSO lists "/" would otherwise leave a second root
  // entry in the array (the Set below only dedupes the SET, not the array). `visited` already
  // stops it being fetched twice — measured — but a ceiling that drains the queue would count
  // that dead entry as "skipped", inflating the very number this slice is making honest.
  // Seeds are depth 0 by definition: the homepage and every sitemap URL is an entry point,
  // not something discovered from another page.
  const seedUrls = [...new Set(rootInScope ? [rootSeed, ...seeds] : seeds)];
  const queue: QueueItem[] = seedUrls.map((url) => ({ url, depth: 0 }));
  const enqueued = new Set<string>(seedUrls);
  const visited = new Set<string>();
  const pages: PageRecord[] = [];
  const skipped: SkippedUrl[] = [];
  let fetches = 0;
  // H-02 counters: what the ceilings dropped, reported ONCE at the end instead of one
  // entry per casualty (which is how skipped[] became the memory problem in the first place).
  let skippedDropped = 0;
  let linkFloodedPages = 0;
  let queueFull = false;
  // T8: what the accumulated pages have cost so far, in the unit they will be PERSISTED in.
  let resultBytes = 0;

  /** Record a skip, bounded: past the listing ceiling only the DROP COUNT is kept. */
  const addSkip = (url: string, reason: string): void => {
    if (skipped.length >= MAX_SKIPPED_LISTED) {
      skippedDropped++;
      return;
    }
    skipped.push({ url, reason });
  };

  const enqueue = (link: string, depth: number): void => {
    // The queue only exists to choose the next <= maxUrls pages; beyond MAX_QUEUE_URLS
    // candidates it is pure ballast that can never be fetched.
    if (queue.length >= MAX_QUEUE_URLS) {
      queueFull = true;
      return;
    }
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
      // FIRST discovery wins the depth, which is what makes this a BFS depth: the queue is
      // FIFO, so the first page to link a URL is always the shallowest one that will.
      queue.push({ url: norm, depth });
    }
  };

  // Crawl-delay present => strictly sequential (see MAX_CONCURRENT_FETCHES): the politeness
  // contract the site wrote down is not negotiable, and concurrency 1 makes the whole loop
  // below behave exactly as the pre-parallel crawler did.
  const concurrency = crawlDelayMs > 0 ? 1 : MAX_CONCURRENT_FETCHES;
  // Set by the result-byte budget, the one limit that stops the crawl from INSIDE a batch.
  let stopped = false;

  while (queue.length > 0 && !stopped) {
    if (pages.length >= maxUrls) {
      for (const item of queue.splice(0)) addSkip(item.url, "max URL limit reached");
      break;
    }
    if (Date.now() - started >= timeBudgetMs) {
      for (const item of queue.splice(0)) addSkip(item.url, "time budget exhausted");
      break;
    }

    // --- Claim phase -------------------------------------------------------------
    // Take up to `room` FETCHABLE URLs off the queue head and launch them together.
    //
    // `room` counts the in-flight fetches against maxUrls, so the cap holds WITH requests
    // outstanding: each fetch can add at most one page, and pages.length + room <= maxUrls.
    //
    // The claim loop is synchronous apart from the Crawl-delay sleep (which only runs when
    // concurrency is 1), and `visited` is marked BEFORE a fetch is started — so no two slots
    // can ever claim the same URL, with or without overlap.
    const room = Math.min(concurrency, maxUrls - pages.length);
    const batch: PendingSlot[] = [];
    let claimed = 0;
    while (claimed < room && queue.length > 0) {
      const item = queue.shift();
      if (item === undefined || visited.has(item.url)) continue;
      const next = item.url;
      visited.add(next);

      const target = new URL(next);
      if (!robots.isAllowed(target.pathname + target.search)) {
        // Costs no slot: a robots-blocked URL is never fetched. It still takes its place in
        // the batch so its skip entry lands in dequeue order, exactly as before.
        batch.push({ kind: "robots", url: next, depth: item.depth });
        continue;
      }

      if (crawlDelayMs > 0 && fetches > 0) await sleep(crawlDelayMs);
      fetches++;
      claimed++;
      batch.push({
        kind: "fetch",
        url: next,
        depth: item.depth,
        outcome: fetchPage(next, originUrl, pageTimeoutMs, lookup),
      });
    }

    // --- Commit phase ------------------------------------------------------------
    // Results are applied in DEQUEUE order, never completion order, so pages[], skipped[] and
    // the BFS frontier do not depend on which fetch happened to finish first. The queue is
    // FIFO and discovered links are APPENDED, so taking N off the head at once yields exactly
    // the URLs, in exactly the order, the sequential crawler visited.
    const outcomes = await Promise.all(
      batch.map((slot) => (slot.kind === "fetch" ? slot.outcome : null)),
    );

    for (const [index, slot] of batch.entries()) {
      const url = slot.url;
      const outcome = outcomes[index];
      if (outcome === null || outcome === undefined) {
        addSkip(url, "blocked by robots.txt");
        continue;
      }
      if (outcome.kind === "timeout") {
        addSkip(url, "timeout");
        continue;
      }
      if (outcome.kind === "too-many-redirects") {
        addSkip(url, "too many redirects");
        continue;
      }
      if (outcome.kind === "off-origin-redirect") {
        addSkip(url, `off-origin redirect to ${outcome.target}`);
        continue;
      }
      if (outcome.kind === "too-large") {
        // Honest, actionable, and never silent: the tenant is told the page was too big and
        // by which bound, rather than seeing it vanish or come back half-parsed.
        addSkip(url, `response body exceeded the ${outcome.limitBytes}-byte limit (page not read)`);
        continue;
      }
      if (outcome.kind === "error") {
        addSkip(url, `fetch failed: ${outcome.message}`);
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
          addSkip(url, "redirects to already-crawled URL");
          continue;
        }
        visited.add(finalUrl);
        const finalTarget = new URL(finalUrl);
        if (!robots.isAllowed(finalTarget.pathname + finalTarget.search)) {
          addSkip(finalUrl, "blocked by robots.txt");
          continue;
        }
      }
      if (!isHtml(outcome.contentType)) {
        addSkip(finalUrl, `non-HTML (${outcome.contentType || "unknown"})`);
        continue;
      }

      // Belt-and-suspenders: parseHtml is written to never throw, but no future
      // parser bug may be allowed to reject the whole crawl — one bad page becomes
      // a skipped entry instead.
      let parsed: ParsedHtml;
      try {
        parsed = parseHtml(outcome.body, finalUrl);
      } catch (error) {
        addSkip(finalUrl, `parse failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const record: PageRecord = {
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
        fetchMs: outcome.fetchMs,
        htmlBytes: outcome.htmlBytes,
        h2Count: parsed.h2Count,
        h3Count: parsed.h3Count,
        imgCount: parsed.imgCount,
        imgMissingAlt: parsed.imgMissingAlt,
        hreflangs: parsed.hreflangs,
        ogTitle: parsed.ogTitle,
        ogDescription: parsed.ogDescription,
        ogImage: parsed.ogImage,
        twitterCard: parsed.twitterCard,
        htmlLang: parsed.htmlLang,
        xRobotsTag: outcome.xRobotsTag,
        redirectChain: outcome.redirectChain,
        contentHash: parsed.contentHash,
        // A page reached through a redirect keeps the depth of the URL that was CLAIMED —
        // the hop chain is not a level of the site.
        depth: slot.depth,
        // Filled in by attachInLinkCounts once the crawl is finished; it cannot be known
        // while pages are still arriving. See the byte-budget note there.
        inLinkCount: 0,
      };
      // T8: the total budget is checked at ACCUMULATION, not by trimming afterwards — the
      // point is never to hold the 200 MB in the first place. The page that does not fit is
      // recorded as skipped (never silently dropped) and the crawl stops here, draining the
      // queue exactly as the maxUrls and time-budget limits do.
      // Measured with inLinkCount still 0 (it is filled in after the crawl), so the budget
      // undercounts by the digits of one integer per page — <= 4 bytes against a 12 MB
      // budget, and boundCrawlResult re-measures the FINAL records before they are persisted.
      const recordBytes = jsonByteSize(record);
      if (resultBytes + recordBytes > MAX_RESULT_BYTES) {
        addSkip(finalUrl, RESULT_BUDGET_REASON);
        // The rest of THIS batch was already fetched but is not included either — it is
        // recorded under the same reason, ahead of the queue remnant, so the skip list stays
        // in dequeue order and no claimed URL vanishes unaccounted for.
        for (const rest of batch.slice(index + 1)) addSkip(rest.url, RESULT_BUDGET_REASON);
        for (const queued of queue.splice(0)) addSkip(queued.url, RESULT_BUDGET_REASON);
        stopped = true;
        break;
      }
      resultBytes += recordBytes;
      pages.push(record);
      if (parsed.linksTruncated) linkFloodedPages++;
      for (const link of parsed.links) enqueue(link, slot.depth + 1);
    }
  }

  // The ceilings report themselves ONCE, appended AFTER the (already capped) skip list so
  // they can never be the entries that get dropped. Nothing is trimmed silently.
  const notes: SkippedUrl[] = [];
  if (skippedDropped > 0) notes.push({ url: rootSeed, reason: skipOverflowReason(skippedDropped) });
  if (linkFloodedPages > 0) {
    notes.push({
      url: rootSeed,
      reason:
        `${linkFloodedPages} page(s) carried more than ${MAX_LINKS_PER_PAGE} links; ` +
        `only the first ${MAX_LINKS_PER_PAGE} of each were recorded and queued`,
    });
  }
  if (queueFull) {
    notes.push({
      url: rootSeed,
      reason:
        `link queue limit reached (${MAX_QUEUE_URLS} URLs); further discovered links were ` +
        "not queued — narrow the crawl with include_paths to cover them",
    });
  }
  return { pages: attachInLinkCounts(pages), skipped: [...skipped, ...notes], fetchedAt };
}

/**
 * Fill in every page's `inLinkCount` — how many DISTINCT crawled pages link to it — in ONE
 * pass over the finished result. Pure: returns new records, mutates nothing.
 *
 * WHY IT CANNOT BE COUNTED DURING THE CRAWL: a page's inbound links include links from pages
 * that have not been fetched yet, so the number is only knowable once the crawl is over.
 *
 * Counting is by SOURCE PAGE, not by link: two links from the same page to the same target are
 * one source. Both sides are re-normalized (trailing slash, fragment) so a nav that writes
 * `/about/` and a page stored as `/about` are the same target. A page that links to itself
 * counts as one source — it is one of the pages that link there.
 *
 * SCOPE, stated so the number is never over-read: it counts links among the pages THIS crawl
 * stored. A site-wide inbound count would need the whole site; a 25-page crawl of a 500-page
 * site sees 25 pages' worth of links and says so.
 */
export function attachInLinkCounts(pages: readonly PageRecord[]): PageRecord[] {
  /** target URL -> the distinct source pages that link to it. */
  const sources = new Map<string, Set<string>>();
  const norm = (raw: string): string | null => {
    try {
      return normalizeUrl(raw);
    } catch {
      return null;
    }
  };
  for (const page of pages) {
    const from = norm(page.url) ?? page.url;
    for (const link of page.links) {
      const target = norm(link);
      if (target === null) continue;
      const set = sources.get(target);
      if (set === undefined) sources.set(target, new Set([from]));
      else set.add(from);
    }
  }
  return pages.map((page) => ({
    ...page,
    inLinkCount: sources.get(norm(page.url) ?? page.url)?.size ?? 0,
  }));
}

/**
 * Bound a CrawlResult to what may be PERSISTED into jobs.result (H-02). crawlSite already
 * holds itself to these ceilings, so on the real crawler this is the identity — it exists
 * because the queue handler must not have to TRUST its (injectable) crawl function with the
 * size of a DB row. Pure: returns a new result, mutates nothing.
 */
export function boundCrawlResult(result: CrawlResult): CrawlResult {
  const skipped = result.skipped
    .slice(0, MAX_SKIPPED)
    .map((s) => (s.reason.length <= MAX_FIELD_CHARS ? s : { ...s, reason: clampField(s.reason) }));
  const dropped = result.skipped.length - skipped.length;

  // The page COUNT cap first, then the total BYTE budget (T8) — 100 pages is a count, and a
  // count cannot bound a size. Accumulate while under budget rather than measuring the whole
  // array, so an oversized page stops the walk instead of being measured into it.
  const capped = result.pages.slice(0, MAX_PAGES_PERSISTED);
  const pages: PageRecord[] = [];
  let bytes = 0;
  for (const page of capped) {
    const size = jsonByteSize(page);
    if (bytes + size > MAX_RESULT_BYTES) break;
    bytes += size;
    pages.push(page);
  }
  // Counted against `capped`, NOT result.pages: pages lost to the 100-page COUNT cap were not
  // lost to size, and folding them into this number would overstate what the budget did.
  const budgetDropped = capped.length - pages.length;

  const notes: SkippedUrl[] = [];
  if (dropped > 0) notes.push({ url: skipped[0]?.url ?? "", reason: skipOverflowReason(dropped) });
  // Only the BYTE budget is reported here: dropping past MAX_PAGES_PERSISTED is the crawler's
  // own contract (max_urls <= 100), so a note fires only when pages were actually lost to size.
  if (budgetDropped > 0) {
    notes.push({ url: capped[0]?.url ?? "", reason: resultBudgetDropReason(budgetDropped) });
  }
  return { pages, skipped: [...skipped, ...notes], fetchedAt: result.fetchedAt };
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

/**
 * The TOTAL wall-clock ceiling on pre-discovery (M-19), and the one number that decides how
 * long a crawl_site call can sit there before it hands back a job id.
 *
 * WHY it is needed on top of DEFAULT_ESTIMATE_TIMEOUT_MS: the per-fetch timeout bounds ONE
 * hop, and pre-discovery is a SEQUENCE of them — the root sitemap, up to 5 children, then the
 * homepage fallback. Seven hops x 5 s is ~35 s of a caller staring at nothing, because this
 * runs on the REQUEST path (the tool must decide whether to enqueue at all, so it cannot be
 * deferred to the worker without opening the worker's credit reserve for a crawl the caller
 * may still decline).
 *
 * Overrun is SAFE, never a money event: pre-discovery reads no ledger, and a budget-truncated
 * count is a FLOOR, so at worst a large site is not flagged and the caller is charged the same
 * flat TOOL_COSTS.crawl_site they would have paid after confirming. It can never overstate.
 *
 * HONEST LIMIT: this bounds the FETCH sequence. DNS resolution inside the SSRF origin gate is
 * the OS resolver's own timeout and is not covered here.
 */
export const PRE_DISCOVERY_BUDGET_MS = 8_000;

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
 *
 * It is also BOUNDED IN TOTAL by `budgetMs` (default PRE_DISCOVERY_BUDGET_MS) — see that
 * constant for why a per-fetch timeout is not enough on the request path. An exhausted budget
 * simply stops emitting hops, so the answer is whatever was discovered by then: a floor, never
 * an overstatement.
 */
export async function estimateSiteSize(
  origin: string,
  opts: {
    lookup?: LookupFn;
    timeoutMs?: number;
    includePaths?: string[];
    /** Total wall clock for the whole discovery sequence, ms. Test knob. */
    budgetMs?: number;
  } = {},
): Promise<SiteSizeEstimate> {
  const lookup = opts.lookup ?? defaultLookup;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ESTIMATE_TIMEOUT_MS;
  const prefixes = normalizeIncludePaths(opts.includePaths);
  const deadline = deadlineIn(opts.budgetMs ?? PRE_DISCOVERY_BUDGET_MS);

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

    // Guarded sitemap count (reuses loadSitemapSeeds' fetchText + bounded index expansion),
    // sharing THIS call's deadline so root + children cannot outspend the total budget.
    const sitemapSeeds = await loadSitemapSeeds(
      originUrl,
      timeoutMs,
      ESTIMATE_SITEMAP_LIMIT,
      lookup,
      prefixes,
      deadline,
    );
    if (sitemapSeeds.length > 0) {
      return { pages: sitemapSeeds.length, source: "sitemap" };
    }

    // No usable sitemap -> the homepage's in-scope same-origin links as a rough floor.
    // The homepage is HTML, so it gets the page ceiling. A body at the ceiling yields a
    // link count from the bounded prefix — which is exactly what this estimate claims to
    // be (a floor), so truncation never overstates the site's size.
    // This is the LAST hop, and it too runs only on what the budget still allows: a
    // sitemap sequence that spent the whole budget leaves nothing to discover with.
    const homeTimeout = hopTimeout(deadline, timeoutMs);
    if (homeTimeout <= 0) return { pages: null, source: "unknown" };
    const home = await fetchText(rootSeedOf(originUrl), homeTimeout, lookup, MAX_HTML_BYTES);
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
