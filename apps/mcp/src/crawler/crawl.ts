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

  return { title, metaDescription, h1s, canonical, robotsMeta, links, wordCount };
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

/** GET a text resource (robots/sitemap), following redirects; null on any failure. */
async function fetchText(url: string, timeoutMs: number): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": USER_AGENT },
    });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

/** Load and parse /robots.txt; a missing/non-200 file yields an allow-all ruleset. */
async function loadRobots(origin: URL, timeoutMs: number): Promise<RobotsRules> {
  const res = await fetchText(new URL("/robots.txt", origin).toString(), timeoutMs);
  return parseRobots(res && res.status === 200 ? res.body : "");
}

/** Seed URLs from /sitemap.xml (one bounded level of index expansion); [] if none. */
async function loadSitemapSeeds(origin: URL, timeoutMs: number, limit: number): Promise<string[]> {
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
    const norm = normalizeUrl(u.toString());
    if (!seen.has(norm)) {
      seen.add(norm);
      seeds.push(norm);
    }
  };

  const root = await fetchText(new URL("/sitemap.xml", origin).toString(), timeoutMs);
  if (!root || root.status !== 200) return seeds;
  const parsed = parseSitemap(root.body);
  parsed.urls.forEach(add);
  for (const child of parsed.sitemaps.slice(0, 5)) {
    if (seeds.length >= limit) break;
    const res = await fetchText(child, timeoutMs);
    if (res && res.status === 200) parseSitemap(res.body).urls.forEach(add);
  }
  return seeds.slice(0, limit);
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

  const robots = await loadRobots(originUrl, pageTimeoutMs);
  const crawlDelayMs = Math.min(robots.crawlDelayMs, crawlDelayCapMs);

  const seeds = await loadSitemapSeeds(originUrl, pageTimeoutMs, maxUrls);
  const queue: string[] = seeds.length > 0 ? [...seeds] : [normalizeUrl(originUrl.toString())];
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
      if (visited.has(finalUrl)) continue; // redirected onto an already-seen page
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
      issues: computeIssues(parsed),
    });
    parsed.links.forEach(enqueue);
  }

  return { pages, skipped, fetchedAt };
}
