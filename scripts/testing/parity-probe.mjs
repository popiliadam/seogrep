// Faz C — competitor parity. "If SeoGrep ran check X, how many cases would it find in this
// portfolio?" Answered by fetching the customer sites DIRECTLY, never through the product.
//
// WHY NOT THROUGH THE PRODUCT. The campaign already learned this on H1/H2: hypotheses about the
// SITES are answered by reading the sites, and 290 pages cost 0 credits that way. K1's 70
// credits/site only buys the different question — "does the product surface what is there".
// Running parity checks through the product would also make the answer circular: the product
// cannot report a rule it does not have.
//
// WHAT THIS PRODUCES. Case COUNTS per check per site (PLAN.md Faz C: "kural değil, sayı"), so a
// human can decide from a number. It writes no rule, ships no rule, and touches no price
// (NEVER #6). Raw per-page records go OUTSIDE the repo — they carry customer URLs.
//
// SAMPLING IS STRATIFIED, and that is not decoration. The 1st session's first H2 sample drew
// only from post-sitemap and was therefore STRUCTURALLY BLIND to a defect that lived in
// page-sitemap; it would have produced a confident, wrong "no such defect". So the sampler takes
// a proportional slice of EVERY sub-sitemap, and the report prints the per-sitemap draw.
//
// POLITENESS. These are real customer sites. Sequential per host with a small delay, a
// self-identifying UA, and a hard page cap. Nothing here is a load test.
//
// Node floor >= 22. Exit 0 on success, 1 on refusal/failure.
//   node scripts/testing/parity-probe.mjs --self-test
//   node scripts/testing/parity-probe.mjs --out=/tmp/parity --per-site=40
import {
  bodyFingerprint, hreflangFindings, imagesMissingAlt, internalLinks, normalizeForCompare,
  openGraphGaps, renderBlockingProxy, schemaFieldGaps, titleH1Mismatch, textOf,
} from "./seo-checks.mjs";
import { assertOutsideRepo } from "./runner.mjs";
import { SITES } from "./plan.mjs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UA = "SeoGrepParityProbe/1.0 (+https://seogrep.com; measurement, not a crawler)";
const DELAY_MS = 350;
const FETCH_TIMEOUT_MS = 20000;
const MAX_REDIRECT_HOPS = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One fetch, redirects NOT followed by the runtime, so the chain is observable (check 9). */
export async function fetchChain(url, fetchImpl = fetch) {
  const chain = [];
  let current = url;
  const seen = new Set();
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    if (seen.has(normalizeForCompare(current))) {
      return { chain, loop: true, final: null, status: null, html: null, error: null };
    }
    seen.add(normalizeForCompare(current));
    const startedAt = Date.now();
    let res;
    try {
      res = await fetchImpl(current, {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "text/html,*/*" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      return { chain, loop: false, final: current, status: null, html: null, error: String(error?.message ?? error) };
    }
    const ttfbMs = Date.now() - startedAt;
    chain.push({ url: current, status: res.status, ttfbMs });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { chain, loop: false, final: current, status: res.status, html: null, error: "3xx without Location" };
      current = new URL(loc, current).toString();
      continue;
    }
    const html = res.ok ? await res.text() : null;
    return { chain, loop: false, final: current, status: res.status, html, error: null };
  }
  return { chain, loop: true, final: current, status: null, html: null, error: "redirect hop limit" };
}

/** robots.txt -> declared sitemaps; falls back to the two conventional paths. */
export async function discoverSitemaps(origin, fetchImpl = fetch) {
  const found = [];
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok) {
      const body = await res.text();
      for (const m of body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) found.push(m[1].trim());
    }
  } catch { /* robots is optional; the fallbacks below cover it */ }
  if (found.length === 0) found.push(`${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`);
  return [...new Set(found)];
}

export function parseSitemapXml(xml) {
  const locs = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  const isIndex = /<sitemapindex/i.test(xml);
  return { isIndex, locs };
}

/** Expand a sitemap (index or urlset) into { [subSitemapUrl]: [pageUrl, ...] }. */
export async function expandSitemaps(roots, fetchImpl = fetch) {
  const groups = new Map();
  const queue = [...roots];
  const visited = new Set();
  while (queue.length > 0 && visited.size < 40) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    let xml;
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) continue;
      xml = await res.text();
    } catch { continue; }
    const { isIndex, locs } = parseSitemapXml(xml);
    if (isIndex) queue.push(...locs);
    else if (locs.length > 0) groups.set(url, locs);
    await sleep(DELAY_MS);
  }
  return groups;
}

/**
 * Proportional draw from every group, largest-remainder so small sitemaps are never rounded to
 * zero. A group of 3 pages contributes at least 1 — being small is not a reason to be invisible,
 * and the 1st session's blind sample is exactly what happens when a group contributes none.
 */
export function stratifiedSample(groups, budget) {
  const entries = [...groups.entries()].filter(([, urls]) => urls.length > 0);
  if (entries.length === 0) return { picked: [], perGroup: {} };

  // TWO PASSES, and the first one is the whole point. The single-pass proportional version this
  // replaces DID round small groups to zero — a 100-page sitemap took the entire budget of 20 and
  // the 2-page sitemap next to it drew nothing, while the comment above it claimed the opposite.
  // That is the blind sample of the 1st session, rebuilt by accident. Pass 1 seats every group
  // first; pass 2 distributes what is left in proportion to the REMAINING capacity.
  const take = new Map(entries.map(([name]) => [name, 0]));
  let remaining = budget;
  for (const [name] of entries) {
    if (remaining <= 0) break;
    take.set(name, 1);
    remaining -= 1;
  }
  const leftover = remaining;
  const capacityTotal = entries.reduce((n, [name, urls]) => n + Math.max(0, urls.length - take.get(name)), 0);
  if (leftover > 0 && capacityTotal > 0) {
    for (const [name, urls] of entries) {
      if (remaining <= 0) break;
      const capacity = urls.length - take.get(name);
      if (capacity <= 0) continue;
      const extra = Math.min(capacity, remaining, Math.round((capacity / capacityTotal) * leftover));
      take.set(name, take.get(name) + extra);
      remaining -= extra;
    }
  }

  const perGroup = {};
  const picked = [];
  for (const [name, urls] of entries) {
    const want = take.get(name);
    const step = Math.max(1, Math.floor(urls.length / Math.max(1, want)));
    const chosen = [];
    for (let i = 0; i < urls.length && chosen.length < want; i += step) chosen.push(urls[i]);
    perGroup[name] = { available: urls.length, drawn: chosen.length };
    picked.push(...chosen);
  }
  return { picked, perGroup };
}

/** Run every pure check over one fetched page. */
export function checkPage(html, pageUrl, host) {
  return {
    alt: imagesMissingAlt(html),
    titleH1: titleH1Mismatch(html),
    og: openGraphGaps(html),
    hreflang: hreflangFindings(html, pageUrl),
    schema: schemaFieldGaps(html),
    speed: renderBlockingProxy(html),
    links: internalLinks(html, pageUrl, host),
    title: textOf(html, "title"),
    fingerprint: bodyFingerprint(html).slice(0, 4000),
  };
}

export async function probeSite(site, opts, fetchImpl = fetch) {
  const origin = `https://${site.domain}`;
  const host = site.domain;
  const roots = await discoverSitemaps(origin, fetchImpl);
  const groups = await expandSitemaps(roots, fetchImpl);
  const { picked, perGroup } = stratifiedSample(groups, opts.perSite);
  const pages = [];
  for (const url of picked) {
    const r = await fetchChain(url, fetchImpl);
    pages.push({ url, ...r, checks: r.html ? checkPage(r.html, r.final ?? url, host) : null });
    await sleep(DELAY_MS);
  }
  return { site: site.key, domain: site.domain, sitemapGroups: perGroup, sitemapTotal: [...groups.values()].reduce((n, u) => n + u.length, 0), pages };
}

// --- self-test: every predicate against a fixture wrong in the way it must notice --------------
async function selfTest() {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: Boolean(cond) });

  const imgHtml = `<img src=a.png alt="ok"><img src=b.png><img src=c.png alt=""><img src=d.png aria-hidden="true">`;
  const alt = imagesMissingAlt(imgHtml);
  check(`alt: 4 imgs, exactly 1 missing (alt="" and aria-hidden are NOT findings) -> ${alt.missing}`, alt.total === 4 && alt.missing === 1);
  check("alt: a commented-out <img> is not counted", imagesMissingAlt(`<!-- <img src=x> -->`).total === 0);

  check("titleH1: matching pair is not a mismatch", titleH1Mismatch(`<title>SEO Audit Tool | Acme</title><h1>SEO Audit Tool</h1>`).mismatch === false);
  check("titleH1: unrelated pair IS a mismatch", titleH1Mismatch(`<title>Kurumsal Hakkimizda Sayfasi</title><h1>Bahis Casino Bonus Siteleri</h1>`).mismatch === true);
  check("titleH1: page with no h1 is not applicable (audit_onpage already owns it)", titleH1Mismatch(`<title>x y z</title>`).applicable === false);

  check("og: all three present -> no gap", openGraphGaps(`<meta property="og:title" content="a"><meta property="og:description" content="b"><meta property="og:image" content="c">`).missing.length === 0);
  check("og: empty content counts as missing", openGraphGaps(`<meta property="og:title" content="">`).missing.length === 3);

  const hlOk = hreflangFindings(`<link rel="alternate" hreflang="tr" href="https://x.com/a"><link rel="alternate" hreflang="en" href="https://x.com/en/a">`, "https://x.com/a");
  check("hreflang: self-referential cluster is clean", hlOk.declared === true && hlOk.findings.length === 0);
  const hlBad = hreflangFindings(`<link rel="alternate" hreflang="tr" href="https://x.com/other">`, "https://x.com/a");
  check("hreflang: cluster that never names itself IS a finding", hlBad.findings.some((f) => f.kind === "hreflang_missing_self_reference"));
  check("hreflang: absence is NOT a finding", hreflangFindings(`<html></html>`, "https://x.com/a").findings.length === 0);

  const sOk = schemaFieldGaps(`<script type="application/ld+json">{"@type":"BlogPosting","headline":"h","datePublished":"2026-01-01","author":{"@type":"Person","name":"n"}}</script>`);
  check("schema: complete BlogPosting -> no gap", sOk.gaps.length === 0 && sOk.typedNodes === 1);
  const sBad = schemaFieldGaps(`<script type="application/ld+json">{"@graph":[{"@type":"BlogPosting","headline":"h"}]}</script>`);
  check("schema: @graph is walked and the missing fields are named", sBad.gaps.length === 1 && sBad.gaps[0].missing.includes("datePublished"));

  const rb = renderBlockingProxy(`<head><script src="a.js"></script><script src="b.js" defer></script><link rel="stylesheet" href="s.css"></head><body><script src="c.js"></script></body>`);
  check(`speed proxy: only head, only non-deferred -> 1 blocking, 1 sheet (got ${rb.blockingScripts}/${rb.stylesheets})`, rb.blockingScripts === 1 && rb.stylesheets === 1);

  const links = internalLinks(`<a href="/a">1</a><a href="#x">2</a><a href="mailto:a@b.c">3</a><a href="https://other.com/z">4</a><a href="https://www.x.com/b#frag">5</a>`, "https://x.com/p", "x.com");
  check(`links: fragments/mailto/cross-host dropped, www folded, hash stripped -> ${links.length}`, links.length === 2 && links.some((l) => l.endsWith("/b")));

  const s = stratifiedSample(new Map([["big", Array.from({ length: 100 }, (_, i) => `u${i}`)], ["tiny", ["a", "b"]]]), 20);
  check(`stratified: the 2-page sitemap is never rounded to zero (drawn ${s.perGroup.tiny.drawn})`, s.perGroup.tiny.drawn >= 1 && s.picked.length <= 22);

  const sm = parseSitemapXml(`<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap></sitemapindex>`);
  check("sitemap: an index is recognised as an index, not as pages", sm.isIndex === true && sm.locs.length === 1);

  let hops = 0;
  const fakeFetch = async (u) => {
    hops += 1;
    if (hops <= 2) return { status: 301, ok: false, headers: new Map([["location", `https://x.com/step${hops}`]]) };
    return { status: 200, ok: true, headers: new Map(), text: async () => "<html>ok</html>" };
  };
  const chained = await fetchChain("https://x.com/start", async (u, o) => { const r = await fakeFetch(u, o); return { ...r, headers: { get: (k) => r.headers.get(k) } }; });
  check(`redirect chain: 2 hops recorded before the 200 (got ${chained.chain.length})`, chained.chain.length === 3 && chained.status === 200);

  const loopFetch = async (u) => ({ status: 301, ok: false, headers: { get: () => "https://x.com/a" } });
  const looped = await fetchChain("https://x.com/a", loopFetch);
  check("redirect loop: detected, not followed forever", looped.loop === true);

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  console.log(`\nself-test: ${results.length - failed.length}/${results.length} PASS.`);
  console.log("NOT MEASURED by this file: Core Web Vitals (LCP/INP/CLS need rendering or CrUX — the speed check is an HTML-only PROXY and the report must say so), JS-rendered DOM, and anything behind auth.");
  return failed.length === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit((await selfTest()) ? 0 : 1);
  const get = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const out = get("out", null);
  if (!out) throw new Error("--out=<dir outside the repo> is required: raw records carry customer URLs");
  assertOutsideRepo(out);
  const perSite = Number(get("per-site", "40"));
  const keys = (get("site", "") || "").split(",").filter(Boolean);
  const sites = SITES.filter((s) => s.active && s.crawl && (keys.length === 0 || keys.includes(s.key)));
  await mkdir(out, { recursive: true });
  const file = path.join(out, "parity.jsonl");
  await writeFile(file, "");
  for (const site of sites) {
    process.stdout.write(`probing ${site.domain} ... `);
    const record = await probeSite(site, { perSite });
    await appendFile(file, `${JSON.stringify(record)}\n`);
    const okPages = record.pages.filter((p) => p.status === 200).length;
    console.log(`${okPages}/${record.pages.length} pages HTTP 200 (sitemap declared ${record.sitemapTotal})`);
  }
  console.log(`\nRaw records: ${file}`);
}

// MEASURED, not assumed: the naive `file://${process.argv[1]}` guard SILENTLY does nothing in
// this repo, because the working directory contains a space and import.meta.url percent-encodes
// it. The script then exits 0 having run no checks at all — a green result that measured nothing,
// which is the exact failure mode this campaign keeps writing down. pathToFileURL applies the
// same encoding to both sides.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(String(error?.message ?? error)); process.exit(1); });
}
