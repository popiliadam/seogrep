// The ten competitor-parity checks, as PURE functions over already-fetched HTML.
//
// WHY THIS FILE IS SEPARATE FROM THE FETCHER. Faz C asks "if SeoGrep ran check X, how many cases
// would it find across the portfolio?" The answer is a COUNT, and a count is exactly the kind of
// claim that is impossible to eyeball: an off-by-one in a predicate produces a number that looks
// as plausible as the right one. So every predicate here is pure — HTML string in, findings out,
// no socket, no clock — and `--self-test` in parity-probe.mjs pins each one against a fixture
// that is wrong in the specific way the predicate is supposed to notice.
//
// WHAT THIS IS NOT. It is not a proposal to ship any of these rules (PLAN.md Faz C: "hiçbiri
// kural olarak yazılmadı"), and it touches no price (NEVER #6). It measures the portfolio, so a
// human can decide from a number instead of an intuition.
//
// PARSING. Deliberately a small tolerant extractor rather than a new dependency: contract.md
// puts a new dependency behind a judge + a licence check, which is a lot of ceremony for a
// measurement script. The cost of that choice is that the extractor can be wrong, so it is the
// most heavily fixture-pinned part of the file. It is NOT a general HTML parser and must never
// be used as one.

/** Strip comments and CDATA so a commented-out <img> never counts as a finding. */
export function stripComments(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g, "");
}

/** The <head> region, or "" when the document has no head. Used by the render-blocking proxy. */
export function headOf(html) {
  const m = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  return m ? m[1] : "";
}

/** Every tag of a given name with its raw attribute string: [{ raw, attrs }]. */
export function tags(html, name) {
  const re = new RegExp(`<${name}(\\s[^>]*)?/?>`, "gi");
  const out = [];
  for (const m of html.matchAll(re)) out.push({ raw: m[0], attrs: m[1] ?? "" });
  return out;
}

/** One attribute's value, single/double/unquoted. Returns null when absent, "" when empty. */
export function attr(attrString, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(attrString ?? "");
  if (m) return m[1] ?? m[2] ?? m[3] ?? "";
  // A bare boolean attribute (`<img alt>`, `<script defer>`) is PRESENT with an empty value.
  // The `|$` is load-bearing and was missing: tags() hands over the attribute slice WITHOUT the
  // closing `>`, so a boolean attribute written last — `<script src="b.js" defer>`, the ordinary
  // way people write it — ended at the end of the string and matched nothing. The self-test
  // caught it as "2 blocking scripts" where the fixture has 1: a deferred script was being
  // counted as render-blocking, which would have inflated every speed-proxy number in Faz C.
  return new RegExp(`(?:^|\\s)${name}(?=[\\s>/]|$)`, "i").test(attrString ?? "") ? "" : null;
}

export function textOf(html, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(html);
  return m ? decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : null;
}

export function allTextOf(html, tag) {
  const out = [];
  for (const m of html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))) {
    out.push(decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
  }
  return out;
}

function decode(s) {
  return String(s)
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'");
}

/** meta by name= or property= (Open Graph uses property, Twitter uses name). */
export function metaContent(html, key) {
  for (const t of tags(html, "meta")) {
    const k = (attr(t.attrs, "property") ?? attr(t.attrs, "name") ?? "").toLowerCase();
    if (k === key.toLowerCase()) return attr(t.attrs, "content");
  }
  return null;
}

// ---------------------------------------------------------------------------
// CHECK 1 — images with no alt attribute at all.
// alt="" is NOT a finding: it is the standards-blessed way to mark an image decorative, and
// counting it would turn correct markup into a defect. Same for aria-hidden and role=presentation.
// ---------------------------------------------------------------------------
export function imagesMissingAlt(html) {
  const clean = stripComments(html);
  let total = 0;
  let missing = 0;
  for (const t of tags(clean, "img")) {
    total += 1;
    const hidden = (attr(t.attrs, "aria-hidden") ?? "") === "true"
      || (attr(t.attrs, "role") ?? "").toLowerCase() === "presentation";
    if (hidden) continue;
    if (attr(t.attrs, "alt") === null) missing += 1;
  }
  return { total, missing };
}

// ---------------------------------------------------------------------------
// CHECK 4 — title and h1 say different things.
// Compared as TOKEN OVERLAP, not equality: "SEO Audit Tool | Acme" vs "SEO Audit Tool" is a match
// and must not be a finding. The brand suffix and stopwords are dropped before comparing, and a
// page with no h1 is NOT counted here — that is audit_onpage's existing missing_h1 rule, and
// double-counting it would inflate this number with cases the product already reports.
// ---------------------------------------------------------------------------
const STOP = new Set(["ve", "ile", "the", "a", "an", "of", "for", "and", "or", "in", "on", "de", "da"]);

export function tokenize(s) {
  return String(s ?? "").toLowerCase()
    .replace(/[|–—\-·:•,.!?()"'“”]/g, " ")
    .split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

export function titleH1Mismatch(html) {
  const title = textOf(html, "title");
  const h1s = allTextOf(html, "h1");
  if (!title || h1s.length !== 1 || !h1s[0]) return { applicable: false, mismatch: false };
  const a = new Set(tokenize(title));
  const b = tokenize(h1s[0]);
  if (a.size === 0 || b.length === 0) return { applicable: false, mismatch: false };
  const shared = b.filter((w) => a.has(w)).length;
  // Jaccard-ish: share of the h1's own words that the title also carries. Below a third means
  // the two elements are describing different things, which is the case a human would flag.
  return { applicable: true, mismatch: shared / b.length < 0.34, overlap: shared / b.length };
}

// ---------------------------------------------------------------------------
// CHECK 5 — Open Graph. Missing og:title/og:description/og:image is what makes a shared link
// render as a bare URL. Counted per MISSING PROPERTY as well as per page, because "3 pages have
// no OG at all" and "300 pages are each missing og:image" are different products decisions.
// ---------------------------------------------------------------------------
export const OG_KEYS = ["og:title", "og:description", "og:image"];

export function openGraphGaps(html) {
  const missing = OG_KEYS.filter((k) => {
    const v = metaContent(html, k);
    return v === null || v.trim() === "";
  });
  return { missing, none: missing.length === OG_KEYS.length };
}

// ---------------------------------------------------------------------------
// CHECK 6 — hreflang. Two distinct facts: whether the page declares any alternates at all, and
// whether the set is self-referential (a valid cluster names itself). A single-language site
// legitimately has none, so ABSENCE IS NOT A DEFECT — it is reported as coverage, and only the
// malformed cases are counted as findings.
// ---------------------------------------------------------------------------
export function hreflangFindings(html, pageUrl) {
  const entries = [];
  for (const t of tags(html, "link")) {
    if ((attr(t.attrs, "rel") ?? "").toLowerCase() !== "alternate") continue;
    const lang = attr(t.attrs, "hreflang");
    if (lang === null) continue;
    entries.push({ lang, href: attr(t.attrs, "href") });
  }
  if (entries.length === 0) return { declared: false, findings: [] };
  const findings = [];
  const valid = /^(x-default|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/;
  for (const e of entries) {
    if (!valid.test(e.lang)) findings.push({ kind: "invalid_hreflang_code", detail: e.lang });
    if (!e.href) findings.push({ kind: "hreflang_without_href", detail: e.lang });
  }
  const selfRef = entries.some((e) => normalizeForCompare(e.href) === normalizeForCompare(pageUrl));
  if (!selfRef) findings.push({ kind: "hreflang_missing_self_reference", detail: pageUrl });
  return { declared: true, findings };
}

export function normalizeForCompare(u) {
  if (!u) return "";
  try {
    const url = new URL(u);
    return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch { return String(u).toLowerCase(); }
}

// ---------------------------------------------------------------------------
// CHECK 8 — required structured-data fields. audit_schema deliberately reads only @type names
// and SAYS SO, which the notebook rates as its best quality (finding #11). This check measures
// what the honest gap costs: how many pages carry a type whose Rich Results eligibility depends
// on fields that are absent.
// ---------------------------------------------------------------------------
export const REQUIRED_FIELDS = {
  Article: ["headline", "datePublished", "author"],
  BlogPosting: ["headline", "datePublished", "author"],
  NewsArticle: ["headline", "datePublished", "author"],
  Product: ["name", "offers"],
  LocalBusiness: ["name", "address"],
  Organization: ["name"],
  FAQPage: ["mainEntity"],
  BreadcrumbList: ["itemListElement"],
};

export function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try { out.push(JSON.parse(m[1].trim())); } catch { out.push({ __unparseable: true }); }
  }
  return out;
}

/** Flatten @graph and arrays into the list of typed nodes a validator would actually look at. */
export function schemaNodes(blocks) {
  const nodes = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v["@graph"])) v["@graph"].forEach(walk);
    if (v["@type"]) nodes.push(v);
  };
  blocks.forEach(walk);
  return nodes;
}

export function schemaFieldGaps(html) {
  const nodes = schemaNodes(jsonLdBlocks(html));
  const gaps = [];
  for (const node of nodes) {
    const types = [].concat(node["@type"]).filter((t) => typeof t === "string");
    for (const type of types) {
      const required = REQUIRED_FIELDS[type];
      if (!required) continue;
      const missing = required.filter((f) => node[f] === undefined || node[f] === null || node[f] === "");
      if (missing.length > 0) gaps.push({ type, missing });
    }
  }
  return { typedNodes: nodes.length, gaps, unparseable: jsonLdBlocks(html).some((b) => b.__unparseable) };
}

// ---------------------------------------------------------------------------
// CHECK 7 (PROXY ONLY) — page speed.
// Core Web Vitals CANNOT be measured by fetching HTML: LCP/INP/CLS are rendering and interaction
// facts, and the field versions come from CrUX. Reporting a number here and calling it CWV would
// be exactly the "ölçülmemiş mutlak iddia" the campaign keeps catching. So this counts the two
// things HTML really does determine — render-blocking resources in <head>, and document weight —
// and the report must label them a proxy and name CWV as NOT MEASURED.
// ---------------------------------------------------------------------------
export function renderBlockingProxy(html) {
  const head = stripComments(headOf(html));
  const blockingScripts = tags(head, "script").filter((t) => {
    if (attr(t.attrs, "src") === null) return false;
    return attr(t.attrs, "async") === null && attr(t.attrs, "defer") === null
      && (attr(t.attrs, "type") ?? "").toLowerCase() !== "module";
  }).length;
  const stylesheets = tags(head, "link")
    .filter((t) => (attr(t.attrs, "rel") ?? "").toLowerCase() === "stylesheet").length;
  return { blockingScripts, stylesheets, htmlBytes: Buffer.byteLength(html, "utf8") };
}

// ---------------------------------------------------------------------------
// CHECK 2/3 support — internal links, for broken-link and orphan-page counting.
// Fragments, mailto:, tel:, javascript: and cross-host links are excluded: none of them is an
// internal link, and counting them would make every site look like it has hundreds.
// ---------------------------------------------------------------------------
export function internalLinks(html, pageUrl, siteHost) {
  const clean = stripComments(html);
  const out = new Set();
  const bare = String(siteHost).replace(/^www\./, "").toLowerCase();
  for (const t of tags(clean, "a")) {
    const href = attr(t.attrs, "href");
    if (!href || /^(mailto:|tel:|javascript:|#|data:)/i.test(href)) continue;
    let abs;
    try { abs = new URL(href, pageUrl); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (abs.host.replace(/^www\./, "").toLowerCase() !== bare) continue;
    abs.hash = "";
    out.add(abs.toString());
  }
  return [...out];
}

/** CHECK 10 support — a stable fingerprint of the visible body text. */
export function bodyFingerprint(html) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const src = body ? body[1] : html;
  return src
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
