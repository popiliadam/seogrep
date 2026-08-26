import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  DEFAULT_RELEVANT_PAGES_ROWS,
  MAX_RELEVANT_PAGES_ROWS,
  RELEVANT_PAGE_ITEM_TYPES,
  createMockRelevantPagesPort,
  disabledRelevantPagesPort,
  pageJoinKey,
  type RelevantPageMetrics,
  type RelevantPageRow,
  type RelevantPagesResult,
} from "../dfs/relevant-pages.ts";
import {
  MAX_CRAWL_ONLY_LISTED,
  MAX_RENDERED_OUTPUT_CHARS,
  PARTITION_NOTE,
  VENDOR_JUDGEMENT_NOTE,
  WHAT_THE_VENDOR_RETURNS,
  formatMyPages,
  makeMyPagesTool,
  myPagesCrawlView,
  renderCrawledPage,
  renderPositions,
  renderVendorPage,
} from "./my-pages.ts";
import {
  CRAWL_PAGE_READ_CAP,
  joinPages,
  toCrawledPage,
  type CrawlSide,
  type CrawledPage,
  type LoadCrawlSideFn,
} from "./my-pages-crawl.ts";
import {
  AMBIGUOUS_SUBJECT_MESSAGE,
  NO_SUBJECT_MESSAGE,
  projectNotFoundMessage,
  type LoadProjectFn,
  type ProjectRef,
} from "./project-target.ts";
import { exactCount } from "../format/quantities.ts";
import fixture from "../dfs/fixtures/labs-relevant-pages.json";

/**
 * Fast-lane (DB-less) proofs for my_pages. The credit LEDGER behaviour (net -40, release on vendor
 * failure, zero rows on a free refusal, the tenant directions) is proven against the real stack in
 * my-pages.db.test.ts. Here we prove the three things this surface is FOR:
 *
 *   1. THE JOIN — and specifically that BOTH SIDES use the SAME normaliser. The pin is DERIVED
 *      rather than enumerated: for a matrix of vendor/crawl address pairs, membership of the
 *      matched set must agree with `pageJoinKey(a) === pageJoinKey(b)` on every pair. A second
 *      normaliser on our side would disagree on at least one and turn this red — which is the
 *      whole point, because a join whose sides normalise differently reports "this page does not
 *      rank" about pages that do, and an empty match set looks exactly like an honest one.
 *   2. THE HONESTY OF THE THREE POPULATIONS — two of them are CLAIMS, and each must be printed
 *      with the sentence that bounds it. An absence must never read as a finding.
 *   3. NEVER #7 / #9 — every printed figure under the vendor's own name, a vendor silence in
 *      words rather than 0, an ABSENT item type absent rather than zeroed, no score of any kind,
 *      and no promise of keywords this endpoint does not return.
 *
 * The price controls are asserted AGAINST the port's own caps, because the caps ARE the signed 40.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };
const LOCALE = { language_code: "en", location_code: 2840 } as const;

const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const mockPort = () => createMockRelevantPagesPort(fixture);

/** The four keyed fixture rows, as the port produces them. */
async function fixtureResult(
  overrides: { limit?: number; offset?: number } = {},
): Promise<RelevantPagesResult> {
  return mockPort().fetchRelevantPages({
    target: "example.com",
    limit: overrides.limit ?? DEFAULT_RELEVANT_PAGES_ROWS,
    offset: overrides.offset ?? 0,
    ...LOCALE,
  });
}

/** Crawled pages from bare URLs, all fetched with HTTP 200. */
function crawledPages(urls: readonly string[]): CrawledPage[] {
  return urls.map((url) => toCrawledPage(url, 200));
}

/** A crawl side built from bare URLs, all fetched with HTTP 200. */
function crawlOf(urls: readonly string[], ranAt = "2026-08-18T09:00:00.000Z"): CrawlSide {
  return {
    kind: "crawl",
    jobId: "job-1",
    ranAt,
    truncated: false,
    pages: crawledPages(urls),
  };
}

const NO_METRICS: RelevantPageRow = {
  page_address: "https://example.com/silent",
  our_join_key: "example.com/silent",
  metrics: {},
};

/** The vendor answered about ONE bucket and said nothing else. Its rendering is the sharpest edge. */
const THIN_METRICS: RelevantPageMetrics = {
  pos_1: null,
  pos_2_3: null,
  pos_4_10: null,
  pos_11_20: 6,
  pos_21_30: null,
  pos_31_40: null,
  pos_41_50: null,
  pos_51_60: null,
  pos_61_70: null,
  pos_71_80: null,
  pos_81_90: 0,
  pos_91_100: null,
  etv: null,
  count: 6,
  estimated_paid_traffic_cost: null,
  is_new: null,
  is_up: null,
  is_down: null,
  is_lost: 1,
};

function resultWith(rows: readonly RelevantPageRow[]): RelevantPagesResult {
  return {
    target: "example.com",
    item_types_requested: ["organic"],
    ordered_by_vendor_field: "metrics.organic.count",
    vendor_filters_applied: [],
    clickstream_purchased: false,
    window: {
      window_offset: 0,
      window_limit: DEFAULT_RELEVANT_PAGES_ROWS,
      window_row_count: rows.length,
      vendor_total_count: 3271,
      rows,
    },
  };
}

/**
 * THE ENV THIS FILE MEASURES AGAINST — the sibling's device, and it was measured to matter there:
 * a "reaches the credit guard" assertion reads a MISSING Supabase env as its signal, so with a
 * developer's local stack exported the same spec passes for the wrong reason. Cleared per test.
 */
const SUPABASE_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;

function withoutSupabaseEnv(): void {
  let saved: Partial<Record<(typeof SUPABASE_ENV_KEYS)[number], string | undefined>> = {};
  beforeEach(() => {
    saved = {};
    for (const key of SUPABASE_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of SUPABASE_ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// =====================================================================================
// 1. THE JOIN — one normaliser, applied to both sides
// =====================================================================================

describe("the join uses ONE normaliser, and it is the vendor adapter's", () => {
  /**
   * The addresses this join has to survive, drawn from the axes pageJoinKey documents as COLLAPSED
   * and the axes it documents as KEPT. Each pair is (vendor address, our crawl's URL).
   */
  const PAIRS: readonly (readonly [string, string])[] = [
    // collapsed: one trailing slash — the fixture's own first row against a crawler-stored URL.
    ["https://example.com/pricing/", "https://example.com/pricing"],
    // collapsed: leading www. and the scheme, together — the fixture's second row.
    ["https://www.example.com/Blog/seo-guide", "http://example.com/Blog/seo-guide"],
    // collapsed: host case and a default port.
    ["https://EXAMPLE.com/a", "http://example.com:80/a"],
    // KEPT: path case. Two resources on any case-sensitive server.
    ["https://example.com/Blog/seo-guide", "https://example.com/blog/seo-guide"],
    // KEPT: the query string, in full.
    ["https://example.com/posts?page=2", "https://example.com/posts"],
    // KEPT: parameter ORDER — the documented residual limit, erring toward "two pages".
    ["https://example.com/p?a=1&b=2", "https://example.com/p?b=2&a=1"],
    // KEPT: the subdomain.
    ["https://blog.example.com/x", "https://example.com/x"],
    // unkeyable on the vendor side: it can match nothing, including another unkeyable row.
    ["::::", "::::"],
  ];

  /**
   * DERIVED, not enumerated (signed lesson 14 — the axis is named: COLLAPSED × KEPT × UNKEYABLE).
   * The expectation is computed from pageJoinKey itself, so this spec asserts the IDENTITY of the
   * two sides' normalisation rather than a list of outcomes someone typed out. A second
   * normaliser on our side that agreed on seven pairs and differed on one turns this red.
   */
  it.each(PAIRS)("vendor %s vs crawl %s: matched exactly when the two keys are equal", (vendorAddress, crawlUrl) => {
    const vendorKey = pageJoinKey(vendorAddress);
    const crawlKey = pageJoinKey(crawlUrl);
    const row: RelevantPageRow = {
      page_address: vendorAddress,
      our_join_key: vendorKey,
      metrics: {},
    };
    const join = joinPages([row], [toCrawledPage(crawlUrl, 200)]);
    const shouldMatch = vendorKey !== null && crawlKey !== null && vendorKey === crawlKey;
    expect(join.matched).toHaveLength(shouldMatch ? 1 : 0);
  });

  it("keys OUR side with the vendor adapter's own function, value for value", () => {
    for (const [vendorAddress, crawlUrl] of PAIRS) {
      expect(toCrawledPage(crawlUrl, null).joinKey).toBe(pageJoinKey(crawlUrl));
      expect(toCrawledPage(vendorAddress, null).joinKey).toBe(pageJoinKey(vendorAddress));
    }
  });

  /**
   * No SECOND normaliser, checked structurally as well as behaviourally. The behavioural pin above
   * catches a normaliser that DISAGREES on one of the eight axes; this one catches a hand-rolled
   * copy that happens to agree today and drifts tomorrow. Matched on the shortest distinguishing
   * fragments (signed lesson 11), not on any source literal.
   */
  it("contains no URL-normalising code of its own", () => {
    const source = readFileSync(new URL("./my-pages-crawl.ts", import.meta.url), "utf8");
    expect(source).toMatch(/pageJoinKey/);
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/new URL\(/);
    expect(code).not.toMatch(/www\\?\./);
    expect(code).not.toMatch(/toLowerCase|endsWith\(["']\/["']\)/);
  });

  it("holds unkeyable addresses OUT of both claim populations", () => {
    const unkeyed: RelevantPageRow = { page_address: "::::", our_join_key: null, metrics: {} };
    const join = joinPages([unkeyed], [toCrawledPage("::::", 200)]);
    expect(join.matched).toHaveLength(0);
    expect(join.vendorOnly).toHaveLength(0);
    expect(join.crawlOnly).toHaveLength(0);
    expect(join.vendorUnkeyed).toHaveLength(1);
    expect(join.crawlUnkeyed).toHaveLength(1);
  });

  it("keeps the vendor's own row order in both vendor-side populations", async () => {
    const result = await fixtureResult();
    const join = joinPages(result.window.rows, crawledPages(["https://example.com/pricing"]));
    expect(join.matched.map((m) => m.vendor.page_address)).toEqual([
      "https://example.com/pricing/",
    ]);
    expect(join.vendorOnly.map((row) => row.page_address)).toEqual([
      "https://www.example.com/Blog/seo-guide",
      "https://example.com/posts?page=2",
      "https://example.com/thin-page",
    ]);
  });

  it("reports every crawled URL that keyed to the same page, rather than hiding the extras", () => {
    const row: RelevantPageRow = {
      page_address: "https://example.com/pricing/",
      our_join_key: "example.com/pricing",
      metrics: {},
    };
    const join = joinPages(
      [row],
      [
        toCrawledPage("https://example.com/pricing", 200),
        toCrawledPage("http://example.com/pricing/", 301),
      ],
    );
    expect(join.matched[0]?.crawled.map((page) => page.url)).toEqual([
      "https://example.com/pricing",
      "http://example.com/pricing/",
    ]);
    expect(join.crawlOnly).toHaveLength(0);
  });
});

// =====================================================================================
// 2. THE THREE POPULATIONS — and the sentence that bounds each claim
// =====================================================================================

describe("the three populations are legible, and neither absence reads as a finding", () => {
  async function answer(crawl: CrawlSide): Promise<string> {
    return formatMyPages(await fixtureResult(), LOCALE, crawl, PROJECT);
  }

  it("names all three groups when all three are non-empty", async () => {
    const text = await answer(
      crawlOf(["https://example.com/pricing", "https://example.com/about"]),
    );
    expect(text).toContain("Reported by DataForSEO, and fetched by that crawl (1)");
    expect(text).toContain("Reported by DataForSEO, not found in that crawl (3)");
    expect(text).toContain("Fetched by that crawl, not named in this window (1)");
    expect(text).toContain("https://example.com/about (HTTP status 200)");
  });

  /**
   * "We did not crawl it" is NOT "it does not exist". The bounding sentence must name the crawl,
   * WHEN it ran and HOW MANY pages it fetched — an unqualified list under that heading is the
   * overstatement this tool exists to avoid.
   */
  it("bounds 'not found in that crawl' with the crawl's own date, size and limits", async () => {
    const text = await answer(crawlOf(["https://example.com/pricing"], "2026-08-18T09:00:00.000Z"));
    expect(text).toMatch(/that crawl fetched 1 page on 2026-08-18/i);
    expect(text).toMatch(/depth, page-count and robots limits/i);
    expect(text).toMatch(/not a statement that the page does not exist/i);
  });

  /**
   * "The vendor did not name it" is NOT "it does not rank". The bounding sentence must name the
   * window's own bounds and the result types it was scoped to.
   */
  it("bounds 'not named in this window' with the window's rows and result types", async () => {
    const text = await answer(crawlOf(["https://example.com/about"]));
    expect(text).toMatch(/this window covered rows 1-4 of DataForSEO's list for result types organic/i);
    expect(text).toMatch(/not a statement that the page does not rank/i);
    expect(text).toMatch(/advance `offset`/i);
  });

  /**
   * THE ONE LIST NOBODY CHOSE THE LENGTH OF — measured at 93 rows with no bound at all. The two
   * vendor-side groups are as long as the caller's own `limit` made them; this one is as long as
   * the SITE is, up to the crawl read cap, so a caller asking for a handful of vendor rows was
   * handed hundreds of lines they could not shorten.
   *
   * 93 is the measured size, kept deliberately: it exercises the cap (50 printed) and the
   * remainder (43) at once.
   */
  it("bounds the crawl-side list, and says how many it did not print and in what order", async () => {
    const many = Array.from({ length: 93 }, (_, i) => `https://example.com/blog/post-${i}`);
    const text = await answer(crawlOf(many));

    // The HEADING still counts every row — the cap bounds what is printed, never what is counted.
    expect(text).toContain("Fetched by that crawl, not named in this window (93)");
    const listed = [...text.matchAll(/• https:\/\/example\.com\/blog\/post-\d+ \(HTTP status 200\)/g)];
    expect(listed).toHaveLength(50);
    expect(text).toContain("• https://example.com/blog/post-49 (HTTP status 200)");
    expect(text).not.toContain("post-50 (HTTP status 200)");

    expect(text).toMatch(/50 pages printed above, 43 more in this same group but not printed/);
    // Not a purchase, and not a ranking — both stated, because both are easy to assume.
    expect(text).toMatch(/nothing was charged for the ones left out/i);
    expect(text).toMatch(/discovery order, not an order of importance/i);
    // …and the sentence that bounds the whole group is still under it.
    expect(text).toMatch(/not a statement that the page does not rank/i);
  });

  it("says nothing about an output limit when every crawl-side row fits", async () => {
    const text = await answer(crawlOf(["https://example.com/about", "https://example.com/team"]));
    expect(text).toContain("Fetched by that crawl, not named in this window (2)");
    expect(text).not.toMatch(/output limit reached/i);
    expect(text).not.toMatch(/but not printed/i);
  });

  it("prints ONE count, and says it counts this window against that crawl", async () => {
    const text = await answer(crawlOf(["https://example.com/pricing"]));
    expect(text).toContain(
      "Of the 4 pages in this window whose address could be keyed, 1 also appear in the crawl " +
        "recorded 2026-08-18",
    );
    expect(text).toMatch(/not a measure of how much of your site ranks, and not a score of any kind/i);
  });

  it("says NOTHING WAS COMPARED when no project was named — not that the comparison was empty", async () => {
    const text = formatMyPages(await fixtureResult(), LOCALE, { kind: "not_requested" }, null);
    expect(text).toMatch(/No project was named, so nothing was compared against your own crawl/i);
    expect(text).toContain("Pass `project_id`");
    // None of the three population headings may appear: none of them was measured.
    expect(text).not.toMatch(/not found in that crawl/i);
    expect(text).not.toMatch(/not named in this window/i);
    expect(text).not.toMatch(/could be keyed/i);
  });

  it("says a project has no crawl YET, and still delivers the vendor half", async () => {
    const text = formatMyPages(await fixtureResult(), LOCALE, { kind: "none" }, PROJECT);
    expect(text).toMatch(/no completed crawl to compare against/i);
    expect(text).toMatch(/Run crawl_site/);
    expect(text).toMatch(/no page below is missing because of it/i);
    // The vendor half is intact: every fixture page is still printed.
    expect(text).toContain("https://example.com/pricing/");
    expect(text).toContain("https://example.com/thin-page");
    expect(text).not.toMatch(/not found in that crawl/i);
  });

  /**
   * A THRESHOLD IS PRINTED WITH ITS VALUE. The sentence used to read "Only the first pages of that
   * crawl were compared", which names a limit without saying where it falls: a reader cannot tell
   * a crawl that was clipped by one page from one that was mostly discarded, and the number is the
   * entire content of the warning.
   *
   * The expected figure is DERIVED from the constant rather than typed in, so the spec follows the
   * cap if the cap ever moves; the negative pin below is what actually catches the sentence going
   * back to naming no number at all.
   */
  it("names the read cap BY VALUE when the crawl side hit it", async () => {
    const crawl: CrawlSide = {
      kind: "crawl",
      jobId: "job-1",
      ranAt: "2026-08-18T09:00:00.000Z",
      truncated: true,
      pages: [toCrawledPage("https://example.com/about", 200)],
    };
    const text = await answer(crawl);
    expect(CRAWL_PAGE_READ_CAP).toBeGreaterThan(0);
    expect(text).toMatch(
      new RegExp(
        `only the first ${exactCount(CRAWL_PAGE_READ_CAP)} pages of that crawl were compared`,
        "i",
      ),
    );
    expect(text).not.toMatch(/only the first pages of that crawl/i);
  });

  /** ...and a crawl that was NOT truncated makes no claim about a cap at all. */
  it("says nothing about a read cap when the crawl side did not hit it", async () => {
    const crawl: CrawlSide = {
      kind: "crawl",
      jobId: "job-1",
      ranAt: "2026-08-18T09:00:00.000Z",
      truncated: false,
      pages: [toCrawledPage("https://example.com/about", 200)],
    };
    expect(await answer(crawl)).not.toMatch(/only the first/i);
  });

  it("holds unkeyable addresses in their own group, named as uncomparable rather than missed", () => {
    const text = formatMyPages(
      resultWith([{ page_address: "::::", our_join_key: null, metrics: {} }]),
      LOCALE,
      crawlOf(["::::"]),
      PROJECT,
    );
    expect(text).toMatch(/could not be keyed, and so could not be compared either way \(2\)/i);
    expect(text).toMatch(/rather than counted as misses on either side/i);
  });
});

// =====================================================================================
// 3. NEVER #7 / #9 — whose numbers these are, and what is not claimed
// =====================================================================================

describe("every printed figure is a named vendor field, and a silence is not a zero", () => {
  it("prints a vendor null in WORDS, never as 0", () => {
    const rendered = renderVendorPage({
      page_address: "https://example.com/posts?page=2",
      our_join_key: "example.com/posts?page=2",
      metrics: { organic: THIN_METRICS },
    });
    // The two ESTIMATES are silent under their customer word AND their vendor key — the silence
    // must survive the relabelling, or a reader could take "est. traffic" for a missing zero.
    expect(rendered).toMatch(/est\. traffic not reported by DataForSEO \(etv\)/i);
    expect(rendered).toMatch(
      /est\. cost to buy that traffic not reported by DataForSEO \(estimated_paid_traffic_cost\)/i,
    );
    expect(rendered).toContain("is_new not reported by DataForSEO");
    // ...and a vendor ZERO is an answer, printed as 0.
    expect(rendered).toContain("pos_81_90 0");
    expect(rendered).not.toMatch(/etv 0\b/);
    expect(rendered).not.toMatch(/est\. traffic 0\b/);
  });

  /**
   * THE MEASURED DEFECT (2026-08-25): live output read `etv 86.03599891066551`. Fourteen decimal
   * places of a MODEL's opinion about one page's monthly traffic is a precision claim nobody can
   * support, and it was printed under a vendor key no reader outside DataForSEO's docs can decode.
   *
   * Driven through the REAL renderer on a row shaped like the live one — a spec asserting against
   * a string it assembled itself would prove nothing about what the tool prints.
   */
  it("prints a modelled estimate to a whole unit, not at raw float width", () => {
    const rendered = renderVendorPage({
      page_address: "https://example.com/blog",
      our_join_key: "example.com/blog",
      metrics: {
        organic: {
          ...THIN_METRICS,
          etv: 86.03599891066551,
          estimated_paid_traffic_cost: 5120.75,
        },
      },
    });
    // Not one decimal fraction survives anywhere in the row.
    expect(rendered).not.toMatch(/\d\.\d/);
    expect(rendered).toMatch(/est\. traffic 86\/mo \(DataForSEO etv\)/);
    expect(rendered).toMatch(
      /est\. cost to buy that traffic \$5,121\/mo \(DataForSEO estimated_paid_traffic_cost\)/,
    );
  });

  /**
   * THE REFERENCE this rounding was written against: `ranked_keywords` renders the vendor's `etv`
   * of 116.64 as "est. traffic 117/mo" and is correct. One product, one answer for one quantity.
   */
  it("rounds an estimate the way ranked_keywords already rounds it: 116.64 becomes 117", () => {
    const rendered = renderVendorPage({
      page_address: "https://example.com/blog",
      our_join_key: "example.com/blog",
      metrics: { organic: { ...THIN_METRICS, etv: 116.64 } },
    });
    expect(rendered).toMatch(/est\. traffic 117\/mo/);
  });

  /**
   * A COUNT LOSES NOTHING. `count` is SERPs DataForSEO counted, so every digit is real and the
   * only transformation is grouping — the opposite decision from the two estimates above, made
   * deliberately and pinned so a later sweep cannot round it "for consistency".
   */
  it("groups a counted field's digits and drops none of them", () => {
    const rendered = renderVendorPage({
      page_address: "https://example.com/blog",
      our_join_key: "example.com/blog",
      metrics: { organic: { ...THIN_METRICS, count: 5312, pos_11_20: 1204 } },
    });
    expect(rendered).toContain("organic: count 5,312");
    expect(rendered).toContain("pos_11_20 1,204");
  });

  /** The precision rule is not only in the module: the answer itself says what was rounded away. */
  it("tells the reader that the estimates are shown to a whole unit, and why", () => {
    expect(VENDOR_JUDGEMENT_NOTE).toMatch(/nearest whole visit and whole dollar/i);
    expect(VENDOR_JUDGEMENT_NOTE).toMatch(/not precision it has/i);
  });

  it("counts the unreported position buckets instead of dropping or zeroing them", () => {
    const line = renderPositions(THIN_METRICS);
    expect(line).toContain("pos_11_20 6");
    expect(line).toContain("pos_81_90 0");
    expect(line).toContain("10 of the 12 position buckets were not reported by DataForSEO");
    expect(line).not.toMatch(/pos_1 0\b/);
  });

  it("says so plainly when the vendor reported no position bucket at all", () => {
    const silent: RelevantPageMetrics = { ...THIN_METRICS, pos_11_20: null, pos_81_90: null };
    expect(renderPositions(silent)).toMatch(
      /none of the 12 position buckets were reported by DataForSEO/i,
    );
  });

  /**
   * AN ITEM TYPE THE VENDOR DID NOT REPORT IS ABSENT, NOT ZERO. The fixture's second row carries
   * `organic` only; rendering a `paid` block of zeros beside it would invent a measurement — the
   * exact shape NEVER #7 forbids, and the one a "complete the table" refactor produces.
   */
  it("leaves an unreported result type out of the page entirely", async () => {
    const result = await fixtureResult();
    const blog = result.window.rows.find((row) => row.page_address.includes("seo-guide"));
    const pricing = result.window.rows.find((row) => row.page_address.includes("pricing"));
    expect(renderVendorPage(pricing as RelevantPageRow)).toContain("paid: count 3");
    const rendered = renderVendorPage(blog as RelevantPageRow);
    expect(rendered).toContain("organic: count 54");
    expect(rendered).not.toMatch(/\bpaid\b/);
    expect(rendered).not.toMatch(/featured_snippet|local_pack/);
  });

  it("says a page carries no figures rather than printing zeros for it", () => {
    expect(renderVendorPage(NO_METRICS)).toMatch(
      /DataForSEO reported no figures for this page in the result types that were asked for/i,
    );
  });

  /**
   * THE HEADLINE PROMISE THAT IS FALSE. The gap map sells this as "which of my pages rank AND FOR
   * WHAT". This endpoint returns NO keywords, so the output must neither say nor imply otherwise —
   * and must point at the tool that does answer it.
   */
  it("never implies it returns the keywords a page ranks for, and names the tool that does", async () => {
    const text = formatMyPages(await fixtureResult(), LOCALE, { kind: "not_requested" }, null);
    expect(text).toMatch(/It does NOT carry the keywords a page ranks for/i);
    expect(text).toContain("ranked_keywords");
    expect(text).not.toMatch(/and for what/i);
    expect(text).not.toMatch(/which keywords (this|the|each) page/i);
    // No keyword-bearing vocabulary at all: this answer is about PAGES.
    expect(text).not.toMatch(/search_volume|keyword_difficulty/);
  });

  it("labels etv and estimated_paid_traffic_cost as DataForSEO's estimates, and predicts nothing", () => {
    expect(VENDOR_JUDGEMENT_NOTE).toMatch(/DataForSEO's OWN ESTIMATES/);
    expect(VENDOR_JUDGEMENT_NOTE).toMatch(
      /SeoGrep does not predict traffic, revenue or ranking success/i,
    );
    expect(VENDOR_JUDGEMENT_NOTE).toMatch(/never as a zero/i);
    // The join key's residual limits travel with the answer rather than living only in a comment.
    expect(VENDOR_JUDGEMENT_NOTE).toMatch(/query-parameter order are treated as two pages/i);
  });

  it("carries no score, grade, percentage or superlative anywhere in a full answer", async () => {
    const text = formatMyPages(
      await fixtureResult(),
      LOCALE,
      crawlOf(["https://example.com/pricing", "https://example.com/about"]),
      PROJECT,
    );
    // "score" survives only inside the two sentences that REFUSE to compute one.
    expect(text).not.toMatch(/\bscored?\b(?! of (any kind|its own))/i);
    expect(text).not.toMatch(/coverage|health|grade|%/i);
    expect(text).not.toMatch(/\b(best|worst|top|strongest|weakest|winning|easy win)\b/i);
    expect(text).not.toMatch(/\b(most powerful|industry-leading|comprehensive|unmatched)\b/i);
    // ...and it says the order is the vendor's, not ours.
    expect(text).toMatch(/SeoGrep does not re-order them and computes no score of its own/);
  });

  it("keeps the whole-set count apart from the rows in hand", async () => {
    const text = formatMyPages(await fixtureResult(), LOCALE, { kind: "not_requested" }, null);
    expect(text).toContain("4 pages in this window (offset 0, limit 100)");
    expect(text).toContain("DataForSEO counts 3,271 pages matching this lookup in total");
    expect(text).toMatch(/this window is a slice of that set, not a count of it/);
  });

  it("says the vendor gave no total rather than back-filling one from the rows in hand", () => {
    const result = resultWith([NO_METRICS]);
    const text = formatMyPages(
      { ...result, window: { ...result.window, vendor_total_count: null } },
      LOCALE,
      { kind: "not_requested" },
      null,
    );
    expect(text).toMatch(/DataForSEO did not say how many pages this lookup matches in total/i);
    expect(text).not.toMatch(/counts 1 pages/);
  });

  it("states that clickstream data was not purchased", async () => {
    const text = formatMyPages(await fixtureResult(), LOCALE, { kind: "not_requested" }, null);
    expect(text).toMatch(/Clickstream data was not purchased/i);
  });

  it("answers an empty window as a delivered result, not as 'this domain has no ranking pages'", () => {
    const text = formatMyPages(resultWith([]), LOCALE, { kind: "none" }, PROJECT);
    expect(text).toContain("No pages for your project");
    expect(text).toMatch(/it is not a statement that the domain has no ranking pages/i);
    expect(text).toContain(WHAT_THE_VENDOR_RETURNS);
  });

  it("prints a crawl page's missing status as unrecorded rather than as 0", () => {
    expect(renderCrawledPage(toCrawledPage("https://example.com/a", null))).toContain(
      "no HTTP status recorded",
    );
    expect(renderCrawledPage(toCrawledPage("https://example.com/a", 404))).toContain(
      "HTTP status 404",
    );
  });
});

// =====================================================================================
// 4. THE PRICE CONTROLS AND THE FREE GATES
// =====================================================================================

describe("the schema's maxima are the port's caps — the caps ARE the signed 40", () => {
  withoutSupabaseEnv();
  const tool = makeMyPagesTool({ port: mockPort(), loadProject });

  function schema(): {
    properties: Record<string, { maximum?: number; minimum?: number; default?: unknown }>;
  } {
    return tool.inputJsonSchema as never;
  }

  it("caps `limit` at the port's own MAX_RELEVANT_PAGES_ROWS, and defaults to its default", () => {
    expect(schema().properties.limit?.maximum).toBe(MAX_RELEVANT_PAGES_ROWS);
    expect(schema().properties.limit?.minimum).toBe(1);
    expect(schema().properties.limit?.default).toBe(DEFAULT_RELEVANT_PAGES_ROWS);
  });

  it("rejects a limit one past the cap BEFORE anything is charged", async () => {
    const rejected = await tool.run(CTX, {
      project_id: PROJECT_ID,
      limit: MAX_RELEVANT_PAGES_ROWS + 1,
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toMatch(/invalid input/i);
    expect(rejected.content[0]?.text).toContain("limit");
  });

  it("rejects a negative offset, and offers only the vendor's four result types", async () => {
    const rejected = await tool.run(CTX, { project_id: PROJECT_ID, offset: -1 });
    expect(rejected.isError).toBe(true);
    const types = (tool.inputJsonSchema as { properties: Record<string, { items?: { enum?: string[] } }> })
      .properties.item_types?.items?.enum;
    expect(types).toEqual([...RELEVANT_PAGE_ITEM_TYPES]);
  });

  it("declares no clickstream field at all — buying it would halve the signed margin", () => {
    expect(Object.keys(schema().properties)).not.toContain("include_clickstream_data");
    expect(Object.keys(schema().properties)).not.toContain("include_subdomains");
    expect(Object.keys(schema().properties)).not.toContain("exclude_top_domains");
  });
});

describe("every refusal is FREE — returned before any credit reserve", () => {
  withoutSupabaseEnv();

  it("refuses a live-disabled deployment without serving sample pages", async () => {
    const tool = makeMyPagesTool({ port: disabledRelevantPagesPort(), loadProject });
    const refused = await tool.run(CTX, { project_id: PROJECT_ID });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/not yet enabled/i);
    expect(refused.content[0]?.text).toMatch(/you were not charged/i);
    // The "turned off" clause is legal HERE and only here: this sentence is returned when the
    // port really IS disabled, so it reports the state rather than claiming to know it in advance.
    // The static tools/list description is where that claim is pinned shut (see the block below).
  });

  it("refuses another tenant's project with the sentence that says nothing about existence", async () => {
    const tool = makeMyPagesTool({ port: mockPort(), loadProject });
    const refused = await tool.run(CTX, { project_id: OTHER_PROJECT_ID });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
  });

  it("refuses naming both target and project_id, and naming neither", async () => {
    const tool = makeMyPagesTool({ port: mockPort(), loadProject });
    const both = await tool.run(CTX, { target: "example.com", project_id: PROJECT_ID });
    expect(both.content[0]?.text).toBe(AMBIGUOUS_SUBJECT_MESSAGE);
    const neither = await tool.run(CTX, {});
    expect(neither.content[0]?.text).toBe(NO_SUBJECT_MESSAGE);
  });

  /**
   * THE OTHER DIRECTION, and it is not decorative: a tool that refused EVERY input would satisfy
   * every refusal spec above perfectly. A valid call must get PAST the free gates and reach the
   * credit guard — which, with no Supabase env, is where it fails and names it.
   */
  it("lets a valid call through to the credit guard", async () => {
    const tool = makeMyPagesTool({ port: mockPort(), loadProject });
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(/SUPABASE/i);
  });

  /**
   * A bare `target` reads NO crawl at all. The loader is injected as a throwing fake so this is
   * measured rather than asserted: a handler that consulted the crawl side for a project-less call
   * would be reading a table with no project to scope it to.
   */
  it("reads no crawl at all when no project was named", async () => {
    const exploding: LoadCrawlSideFn = async () => {
      throw new Error("the crawl side must not be read without a project");
    };
    const tool = makeMyPagesTool({ port: mockPort(), loadProject, loadCrawl: exploding });
    await expect(tool.run(CTX, { target: "example.com" })).rejects.toThrow(/SUPABASE/i);
  });

  it("reads the crawl side for the RESOLVED project, and for the calling tenant only", async () => {
    const seen: { userId: string; projectId: string }[] = [];
    const recording: LoadCrawlSideFn = async (userId, projectId) => {
      seen.push({ userId, projectId });
      return { kind: "none" };
    };
    const tool = makeMyPagesTool({ port: mockPort(), loadProject, loadCrawl: recording });
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(/SUPABASE/i);
    expect(seen).toEqual([{ userId: CTX.userId, projectId: PROJECT_ID }]);
  });
});

describe("the tools/list description keeps its promises", () => {
  const tool = makeMyPagesTool();

  it("states the paid balance, the free refusal, and no deployment state", () => {
    expect(tool.description).toMatch(/paid credit balance/i);
    expect(tool.description).toMatch(/charges nothing/i);
    expect(tool.description).not.toMatch(/off during (the )?beta/i);
    expect(tool.description).not.toMatch(/is (currently )?(turned )?off\b/i);
  });

  it("does not promise keywords, and points at the tool that does", () => {
    expect(tool.description).toMatch(/does NOT carry the keywords a page ranks for/i);
    expect(tool.description).toContain("ranked_keywords");
  });
});

describe("the crawl card stored on the run row (migration 0031)", () => {
  /**
   * THE THREE STATES STAY THREE. "No project was named, so no crawl was looked for" and "a project
   * was named and has no succeeded crawl" are different sentences — `CrawlSide` keeps them apart
   * for that reason and the stored card must too, because a row that recorded either as
   * "0 pages compared" would carry a claim nobody measured.
   */
  it("keeps not_requested and none distinguishable, and both distinct from a comparison", async () => {
    const result = await fixtureResult();
    const rows = result.window.rows;

    expect(myPagesCrawlView({ kind: "not_requested" }, rows)).toEqual({
      kind: "not_requested",
      job_id: null,
      ran_at: null,
      pages_compared: null,
      truncated: null,
      matched: null,
      vendor_only: null,
      crawl_only: null,
    });
    expect(myPagesCrawlView({ kind: "none" }, rows).kind).toBe("none");
    expect(myPagesCrawlView({ kind: "none" }, rows).pages_compared).toBeNull();
  });

  /**
   * THE COUNTS ARE THE JOIN'S OWN, recomputed rather than re-derived: the card is asserted against
   * `joinPages` run independently here, so a card that counted something else — say `rows.length`
   * minus the matches — fails rather than merely looking plausible.
   */
  it("carries the join's three populations, and the crawl's identity beside them", async () => {
    const result = await fixtureResult();
    const rows = result.window.rows;
    // One vendor page the crawl also fetched, and one page only the crawl has.
    const crawledUrls = [rows[0]?.page_address as string, "https://example.com/only-crawled"];
    const expected = joinPages(rows, crawledPages(crawledUrls));

    const card = myPagesCrawlView(crawlOf(crawledUrls), rows);
    expect(card.kind).toBe("crawl");
    expect(card.job_id).toBe("job-1");
    expect(card.ran_at).toBe("2026-08-18T09:00:00.000Z");
    expect(card.pages_compared).toBe(2);
    expect(card.truncated).toBe(false);
    expect(card.matched).toBe(expected.matched.length);
    expect(card.vendor_only).toBe(expected.vendorOnly.length);
    expect(card.crawl_only).toBe(expected.crawlOnly.length);
    // …and the join really was non-trivial: one match and one crawl-only page.
    expect(card.matched).toBe(1);
    expect(card.crawl_only).toBe(1);
  });

  /** COUNTS ONLY — no crawled URL and no vendor address leaves through this card. */
  it("stores no URL at all", async () => {
    const result = await fixtureResult();
    const card = myPagesCrawlView(crawlOf(["https://example.com/only-crawled"]), result.window.rows);
    expect(JSON.stringify(card)).not.toContain("only-crawled");
    expect(JSON.stringify(card)).not.toContain("http");
  });
});


// =============================================================================================
// 5. THE DOUBLE PRINT, AND THE SIZE OF THE REPLY
//
// MEASURED on the real renderer, 2026-08-26, 1,000 organic-only rows:
//   • no project named ............................... 404,171 characters
//   • project named, crawl matched every page ........ 880,080 characters  (+118%)
// A single page address occurred THREE times in one answer. The client that refused
// `backlink_details` this same round refused 62,729 characters as "exceeds maximum allowed
// tokens" — so BOTH of those replies were unreadable, and both cost the caller 40 credits and
// DataForSEO $0.132 either way.
//
// AXES VARIED BELOW (signed lesson 14 — the list is written, not assumed):
//   crawl state      × not_requested / none / crawl
//   join population  × matched-only / vendorOnly-only / mixed / crawl-only / unkeyed on BOTH sides
//   bound that binds × character budget / row cap / neither
//   row width        × organic-only / organic+paid / no metrics at all
//   window size      × 1 row / 100 rows / 1,000 rows (the schema's own ceiling)
// =============================================================================================

describe("no page is printed twice, and no reply is too big to read", () => {
  const WIDE_METRICS: RelevantPageMetrics = {
    pos_1: 3,
    pos_2_3: 7,
    pos_4_10: 21,
    pos_11_20: 34,
    pos_21_30: 18,
    pos_31_40: 11,
    pos_41_50: 6,
    pos_51_60: 4,
    pos_61_70: 2,
    pos_71_80: 1,
    pos_81_90: 0,
    pos_91_100: 0,
    etv: 1842.5,
    count: 107,
    estimated_paid_traffic_cost: 5120.75,
    is_new: 9,
    is_up: 21,
    is_down: 14,
    is_lost: 5,
  };

  /** `n` vendor rows at the width DataForSEO really sends — both item types, every bucket filled. */
  function wideRows(n: number, prefix = "https://example.com/blog/post-"): RelevantPageRow[] {
    return Array.from({ length: n }, (_, i) => ({
      page_address: `${prefix}${i}`,
      our_join_key: pageJoinKey(`${prefix}${i}`),
      metrics: { organic: WIDE_METRICS, paid: WIDE_METRICS },
    }));
  }

  function windowOf(rows: readonly RelevantPageRow[], limit = MAX_RELEVANT_PAGES_ROWS) {
    const base = resultWith(rows);
    return { ...base, window: { ...base.window, window_limit: limit } };
  }

  /** How many times a given page's OWN bullet line appears in the answer. */
  function bulletCount(text: string, address: string): number {
    return [...text.matchAll(new RegExp(`^• ${address.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&")}$`, "gm"))]
      .length;
  }

  /**
   * The row numbers of the vendor pages PRINTED in a block, **in the order they were printed**.
   * Only a page's own bullet line matches: `renderMatchedPage`'s "your crawl fetched:" line is
   * indented, so a crawled URL cannot be mistaken for a second printed page.
   */
  function printedRowNumbers(block: string): number[] {
    return [...block.matchAll(/^• https:\/\/example\.com\/blog\/post-(\d+)$/gm)].map((m) =>
      Number(m[1]),
    );
  }

  /** The matched group's block, and everything from the vendor-only heading onward. */
  function vendorBlocks(text: string): { readonly matched: string; readonly missed: string } {
    const afterMatched = text.split("Reported by DataForSEO, and fetched by that crawl")[1] ?? "";
    const [matched = "", missed = ""] = afterMatched.split(
      "Reported by DataForSEO, not found in that crawl",
    );
    return { matched, missed };
  }

  /**
   * THE DEFECT ITSELF. Every vendor row used to be printed once in a flat list of the window and
   * again inside the comparison. Asserted per ROW rather than on the total length, because a
   * length assertion alone would also go green if the duplicate survived and the budget merely cut
   * it off — the two failures this slice fixes are separate and are pinned separately.
   */
  it("prints each vendor page ONCE when a comparison was made, across all three populations", () => {
    const rows = wideRows(6);
    // rows 0-2 matched, rows 3-5 vendor-only, plus one page only the crawl has.
    const text = formatMyPages(
      windowOf(rows),
      LOCALE,
      crawlOf([...rows.slice(0, 3).map((r) => r.page_address), "https://example.com/only-crawled"]),
      PROJECT,
    );
    expect(text).toContain("Reported by DataForSEO, and fetched by that crawl (3)");
    expect(text).toContain("Reported by DataForSEO, not found in that crawl (3)");
    for (const row of rows) {
      expect(bulletCount(text, row.page_address)).toBe(1);
    }
    // …and the answer says why there is no separate list of the window above the groups.
    expect(text).toContain(PARTITION_NOTE);
    expect(text).toMatch(/each one appears exactly once, in DataForSEO's own order/i);
  });

  /**
   * THE OTHER DIRECTION, and it is the one that keeps the fix from being a deletion: with NO
   * comparison there is no partition, so the flat list IS the answer and every row's FIGURES must
   * still be there. A fix that dropped the list unconditionally would pass the spec above.
   */
  it.each(["not_requested", "none"] as const)(
    "still prints the window with its figures when the crawl side is %s",
    (kind) => {
      const rows = wideRows(6);
      const text = formatMyPages(windowOf(rows), LOCALE, { kind }, PROJECT);
      for (const row of rows) {
        expect(bulletCount(text, row.page_address)).toBe(1);
      }
      expect(text).toContain("organic: count 107");
      expect(text).toContain("paid: count 107");
      expect(text).not.toContain(PARTITION_NOTE);
    },
  );

  /**
   * THE SIZE BOUND, on the worst window the schema permits: the ceiling `limit`, rows at full
   * width, the join split across BOTH vendor populations, a long crawl-only tail, and an unkeyable
   * address on each side. Every sub-budget is loaded at once — this is the assertion that catches
   * a later section being added with no bound of its own.
   */
  it("never renders more than MAX_RENDERED_OUTPUT_CHARS on the widest window the schema allows", () => {
    const rows = wideRows(MAX_RELEVANT_PAGES_ROWS);
    const unkeyableVendor: RelevantPageRow = { page_address: "::::", our_join_key: null, metrics: {} };
    const crawled = [
      // half the window matched…
      ...rows.slice(0, MAX_RELEVANT_PAGES_ROWS / 2).map((r) => r.page_address),
      // …a crawl-only tail longer than both of its bounds…
      ...Array.from({ length: 400 }, (_, i) => `https://example.com/docs/section/${i}`),
      // …and an address our own crawl could not key either.
      "::::",
    ];
    const text = formatMyPages(
      windowOf([...rows, unkeyableVendor], MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      crawlOf(crawled),
      PROJECT,
    );
    expect(text.length).toBeLessThanOrEqual(MAX_RENDERED_OUTPUT_CHARS);
    // …and it is not small because it went silent: all four groups are present and counted.
    expect(text).toContain("Reported by DataForSEO, and fetched by that crawl (500)");
    expect(text).toContain("Reported by DataForSEO, not found in that crawl (500)");
    expect(text).toContain("Fetched by that crawl, not named in this window (400)");
    expect(text).toMatch(/could not be keyed, and so could not be compared either way \(2\)/i);
  });

  it("never renders more than MAX_RENDERED_OUTPUT_CHARS with no comparison either", () => {
    const text = formatMyPages(
      windowOf(wideRows(MAX_RELEVANT_PAGES_ROWS), MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      { kind: "not_requested" },
      null,
    );
    expect(text.length).toBeLessThanOrEqual(MAX_RENDERED_OUTPUT_CHARS);
  });

  /**
   * ==========================================================================================
   * WHICH ROWS SURVIVE THE CUT — pinned ON THE RENDER SURFACE, which is the hole the judge found.
   * ==========================================================================================
   * `joinPages` preserves DataForSEO's order and one spec above pins that on its ARRAYS. That is
   * not the same claim: reversing or sorting the rows at the two VENDOR CALL SITES
   * (`budgetedVendorSection`, `vendorWindowList`) left all seventy specs green, because none of
   * them read the order out of the PRINTED text.
   *
   * What that regression would ship, at 40 credits a call: of a 1,000-row window the caller is
   * handed the ~11-23 rows DataForSEO ranked LAST, while `PARTITION_NOTE` and the docs page both
   * say "in DataForSEO's own order". A truncated list is only honest if the part that survives is
   * the FRONT of the order the answer claims to be in.
   *
   * So the assertion is a STRICT PREFIX of the vendor's own row numbering, read back out of the
   * rendered string: rows 0..k-1 in that order, never a suffix, never a permutation, never a gap.
   * Asserted on all three vendor surfaces, because they are three separate call sites.
   */
  it("prints the FRONT of DataForSEO's order in the flat list when it has to truncate", () => {
    const text = formatMyPages(
      windowOf(wideRows(MAX_RELEVANT_PAGES_ROWS), MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      { kind: "not_requested" },
      null,
    );
    const printed = printedRowNumbers(text);
    expect(printed.length).toBeGreaterThan(0);
    // The cut really happened — otherwise "the survivors are the front" is a vacuous claim.
    expect(printed.length).toBeLessThan(MAX_RELEVANT_PAGES_ROWS);
    expect(printed).toEqual(Array.from({ length: printed.length }, (_, i) => i));
  });

  it("prints the FRONT of DataForSEO's order in BOTH comparison groups when it has to truncate", () => {
    const rows = wideRows(MAX_RELEVANT_PAGES_ROWS);
    // Interleaved on purpose: the two groups then carry INTERLEAVED row numbers, so a spec that
    // merely checked "ascending" would pass on a block holding the wrong half of the window.
    const evenRowNumbers = rows.map((_, i) => i).filter((i) => i % 2 === 0);
    const oddRowNumbers = rows.map((_, i) => i).filter((i) => i % 2 === 1);
    const text = formatMyPages(
      windowOf(rows, MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      crawlOf(evenRowNumbers.map((i) => rows[i]!.page_address)),
      PROJECT,
    );

    const { matched, missed } = vendorBlocks(text);
    const printedMatched = printedRowNumbers(matched);
    const printedMissed = printedRowNumbers(missed);

    expect(printedMatched.length).toBeGreaterThan(0);
    expect(printedMissed.length).toBeGreaterThan(0);
    expect(printedMatched.length).toBeLessThan(evenRowNumbers.length);
    expect(printedMissed.length).toBeLessThan(oddRowNumbers.length);

    expect(printedMatched).toEqual(evenRowNumbers.slice(0, printedMatched.length));
    expect(printedMissed).toEqual(oddRowNumbers.slice(0, printedMissed.length));
  });

  /**
   * A list that FITS must be in the vendor's order too, whole and unpermuted. The prefix specs
   * above only look at truncated lists, so a reordering that happened after the cut — or one that
   * only ever showed up on short windows — would slip past them.
   */
  it("prints the whole window in DataForSEO's order when nothing is cut", () => {
    const rows = wideRows(6);
    const all = rows.map((_, i) => i);
    expect(printedRowNumbers(formatMyPages(windowOf(rows), LOCALE, { kind: "not_requested" }, null)))
      .toEqual(all);

    const text = formatMyPages(
      windowOf(rows),
      LOCALE,
      crawlOf([rows[0]!.page_address, rows[2]!.page_address, rows[4]!.page_address]),
      PROJECT,
    );
    expect(text).not.toMatch(/output limit reached/i);
    const { matched, missed } = vendorBlocks(text);
    expect(printedRowNumbers(matched)).toEqual([0, 2, 4]);
    expect(printedRowNumbers(missed)).toEqual([1, 3, 5]);
  });

  /**
   * AN EMPTY GROUP DOES NOT BURN ITS SHARE. Measured before this was fixed: with `matched` empty,
   * its 9,000 characters evaporated and `vendorOnly` printed 11 rows of a window whose FLAT list
   * printed 23 — so naming a project HALVED what the same 40 credits bought, with half the vendor
   * budget unspent.
   *
   * The expectation is DERIVED from the flat list rather than typed, so it follows the constants:
   * the same rows through the same renderer must reach the same depth whether or not a comparison
   * was made. It is not a claim that the two answers are equal — the comparison carries its own
   * groups and notes — only that the caller is not charged rows for using the feature.
   */
  it("hands an empty group's share to its filled sibling, so a comparison prints no fewer rows", () => {
    const rows = wideRows(MAX_RELEVANT_PAGES_ROWS);
    const flat = formatMyPages(
      windowOf(rows, MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      { kind: "not_requested" },
      null,
    );
    // A crawl that fetched NOTHING this window names: `matched` is empty, `vendorOnly` is all of it.
    const compared = formatMyPages(
      windowOf(rows, MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      crawlOf(["https://example.com/only-crawled"]),
      PROJECT,
    );
    expect(compared).not.toContain("Reported by DataForSEO, and fetched by that crawl");
    expect(compared).toContain(
      `Reported by DataForSEO, not found in that crawl (${exactCount(MAX_RELEVANT_PAGES_ROWS)}):`,
    );

    const flatPrinted = printedRowNumbers(flat);
    const comparedPrinted = printedRowNumbers(compared);
    expect(flatPrinted.length).toBeGreaterThan(0);
    expect(comparedPrinted).toEqual(flatPrinted);
    // …and the carried-over share still cannot push the reply past the ceiling.
    expect(compared.length).toBeLessThanOrEqual(MAX_RENDERED_OUTPUT_CHARS);
  });

  /** The mirror case: `vendorOnly` empty hands ITS share to `matched`. */
  it("hands the share the other way when every page of the window was crawled", () => {
    const rows = wideRows(MAX_RELEVANT_PAGES_ROWS);
    const compared = formatMyPages(
      windowOf(rows, MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      crawlOf(rows.map((r) => r.page_address)),
      PROJECT,
    );
    expect(compared).not.toContain("Reported by DataForSEO, not found in that crawl");
    const printed = printedRowNumbers(compared);
    // A matched row costs MORE than a flat one (it carries the crawled URL too), so this is not
    // asserted against the flat list — only that the whole 18,000 was available to it.
    expect(printed).toEqual(Array.from({ length: printed.length }, (_, i) => i));
    expect(printed.length).toBeGreaterThan(
      printedRowNumbers(
        formatMyPages(
          windowOf(rows, MAX_RELEVANT_PAGES_ROWS),
          LOCALE,
          crawlOf(rows.slice(0, MAX_RELEVANT_PAGES_ROWS / 2).map((r) => r.page_address)),
          PROJECT,
        ).split("Reported by DataForSEO, not found in that crawl")[0] ?? "",
      ).length,
    );
    expect(compared.length).toBeLessThanOrEqual(MAX_RENDERED_OUTPUT_CHARS);
  });

  /**
   * TRUNCATION IS NEVER SILENT, and it never reads as a zero. The heading counts every row the
   * window returned; the note says how many were printed, how many were not, that the omitted ones
   * were CHARGED FOR (they were — the vendor billed the whole window), and what to do next.
   */
  it("says how many vendor rows it did not print, and that they were paid for", () => {
    const rows = wideRows(MAX_RELEVANT_PAGES_ROWS);
    const text = formatMyPages(
      windowOf(rows, MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      { kind: "not_requested" },
      null,
    );
    const printed = [...text.matchAll(/^• https:\/\/example\.com\/blog\/post-\d+$/gm)].length;
    expect(printed).toBeGreaterThan(0);
    expect(printed).toBeLessThan(MAX_RELEVANT_PAGES_ROWS);
    expect(text).toContain(
      `${exactCount(printed)} pages printed above, ` +
        `${exactCount(MAX_RELEVANT_PAGES_ROWS - printed)} more fetched in this same group but ` +
        "not printed",
    );
    expect(text).toMatch(/they were charged for either way/i);
    expect(text).toMatch(/asking for fewer rows does not cost less/i);
    // The WINDOW caption still reports every row that came back — the budget bounds the print,
    // never the measurement.
    expect(text).toContain(`${exactCount(MAX_RELEVANT_PAGES_ROWS)} pages in this window`);
  });

  it("says nothing about an output limit when the whole window fits", () => {
    const text = formatMyPages(windowOf(wideRows(4)), LOCALE, { kind: "not_requested" }, null);
    expect(text).not.toMatch(/output limit reached/i);
    expect(text).not.toMatch(/but not printed/i);
  });

  /**
   * BOTH vendor populations are bounded, and NEITHER starves the other. A single running budget
   * spent matched-first would print 1,000 matches and zero misses; the even split means each group
   * prints what it can and says what it could not.
   */
  it("bounds each vendor population separately, so one cannot starve the other", () => {
    const rows = wideRows(MAX_RELEVANT_PAGES_ROWS);
    const text = formatMyPages(
      windowOf(rows, MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      crawlOf(rows.slice(0, MAX_RELEVANT_PAGES_ROWS / 2).map((r) => r.page_address)),
      PROJECT,
    );
    const [matchedBlock = "", missedBlock = ""] = [
      text.split("Reported by DataForSEO, and fetched by that crawl")[1]?.split(
        "Reported by DataForSEO, not found in that crawl",
      )[0],
      text.split("Reported by DataForSEO, not found in that crawl")[1],
    ];
    const matchedPrinted = [...matchedBlock.matchAll(/^• https:/gm)].length;
    const missedPrinted = [...missedBlock.matchAll(/^• https:/gm)].length;
    expect(matchedPrinted).toBeGreaterThan(0);
    expect(missedPrinted).toBeGreaterThan(0);
    // …and both said so when they stopped.
    expect([...text.matchAll(/output limit reached/gi)].length).toBeGreaterThanOrEqual(2);

    /**
     * A HEADING COUNTS WHAT CAME BACK, NEVER WHAT FITTED. A heading that reported the printed
     * number instead would make the truncation invisible — the reply would look complete and be
     * short, which is the shape this whole slice exists to prevent.
     */
    const half = MAX_RELEVANT_PAGES_ROWS / 2;
    expect(matchedPrinted).toBeLessThan(half);
    expect(missedPrinted).toBeLessThan(half);
    expect(text).toContain(
      `Reported by DataForSEO, and fetched by that crawl (${exactCount(half)}):`,
    );
    expect(text).toContain(
      `Reported by DataForSEO, not found in that crawl (${exactCount(half)}):`,
    );
  });

  /**
   * THE ROW CAP AND THE CHARACTER BOUND ARE BOTH REAL. 50 short rows fit the crawl-only character
   * budget, so the ROW cap binds and the pinned 50/43 behaviour above is unchanged; long URLs
   * exhaust the characters first and the same honest note fires on fewer rows.
   */
  it("bounds the crawl-side list by characters as well as by rows", () => {
    const longUrls = Array.from(
      { length: 60 },
      (_, i) => `https://example.com/${"segment/".repeat(40)}${i}`,
    );
    const text = formatMyPages(
      windowOf(wideRows(1)),
      LOCALE,
      crawlOf(longUrls),
      PROJECT,
    );
    const listed = [...text.matchAll(/^• https:\/\/example\.com\/segment/gm)].length;
    expect(listed).toBeGreaterThan(0);
    expect(listed).toBeLessThan(MAX_CRAWL_ONLY_LISTED);
    expect(text).toContain("Fetched by that crawl, not named in this window (60)");
    expect(text).toMatch(/nothing was charged for the ones left out/i);
  });

  /**
   * NOTHING IS LOST BY DELETING THE FLAT LIST. The uncomparable vendor rows used to be one bare
   * address line each — survivable only because the flat list printed their figures a second time.
   * With the duplicate gone this is the ONLY place they appear, so it carries the figures.
   */
  it("prints the figures of a vendor row that could not be keyed", () => {
    const unkeyable: RelevantPageRow = {
      page_address: "::::",
      our_join_key: null,
      metrics: { organic: { ...WIDE_METRICS, count: 4242 } },
    };
    const text = formatMyPages(
      windowOf([...wideRows(1), unkeyable]),
      LOCALE,
      crawlOf(["https://example.com/only-crawled"]),
      PROJECT,
    );
    expect(text).toContain("organic: count 4,242");
    expect(text).toMatch(/from DataForSEO — this address could not be keyed/);
    expect(text).toMatch(/rather than counted as misses on either side/i);
  });

  /**
   * THE STORED ROW MEASURES THE WHOLE WINDOW, NOT THE PRINTED PART. `domain_lookup_runs` is the
   * record the panel reads; a budget that silently shrank its counts would make the truncation
   * retroactive and unmeasurable.
   */
  it("records the whole join on the run row even when the text was truncated", () => {
    const rows = wideRows(MAX_RELEVANT_PAGES_ROWS);
    const crawledUrls = rows.slice(0, MAX_RELEVANT_PAGES_ROWS / 2).map((r) => r.page_address);
    const text = formatMyPages(
      windowOf(rows, MAX_RELEVANT_PAGES_ROWS),
      LOCALE,
      crawlOf(crawledUrls),
      PROJECT,
    );
    expect(text).toMatch(/output limit reached/i);
    const card = myPagesCrawlView(crawlOf(crawledUrls), rows);
    expect(card.matched).toBe(MAX_RELEVANT_PAGES_ROWS / 2);
    expect(card.vendor_only).toBe(MAX_RELEVANT_PAGES_ROWS / 2);
    expect(card.pages_compared).toBe(MAX_RELEVANT_PAGES_ROWS / 2);
  });
});

// =============================================================================================
// S10d item 3 — THE PRICE SENTENCE, PINNED BY MEANING.
//
// The schema used to say "DataForSEO bills per returned row, so this is the price control, not a
// display preference — the flat price was signed against this ceiling." Half of that is true and
// the half a CUSTOMER reads is not: my_pages costs a flat 40 credits at `limit` 1 and at `limit`
// 1,000, so narrowing the window to save money pays the same and receives less.
//
// The vendor half IS true here, unlike on the Backlinks family where the identical sentence was
// withdrawn outright this round. COMPUTED from the Labs tariff this repo declares (one request,
// $0.012 + $0.00012 a row): $0.01212 at 1 row, $0.024 at 100, $0.132 at 1,000 — the per-row half
// equals the per-request half at exactly 100 rows and is ten times it at the ceiling, where it is
// 91% of the bill. So the row count controls the VENDOR's bill, which is what justifies the CAP,
// and never the caller's.
//
// These specs read the description off the PUBLISHED JSON schema — what the customer's client is
// handed — and assert the CLAIM with regexes rather than a copy of the source string.
// =============================================================================================

describe("S10d — my_pages' limit description states measured Labs behaviour", () => {
  const schema = makeMyPagesTool().inputJsonSchema as {
    properties: Record<string, { description?: string }>;
  };
  const limit = schema.properties.limit?.description ?? "";

  it("no longer tells the caller the row count is their price control", () => {
    expect(limit).not.toMatch(/\bthe price control\b/i);
    expect(limit).not.toMatch(/bills? per returned row,? so this is/i);
  });

  it("names the flat credit price the caller pays whatever they ask for", () => {
    expect(limit).toMatch(/40 credits/);
    expect(limit).toMatch(/fewer rows costs? the same/i);
  });

  /** The half that IS true on Labs, and the reason the ceiling exists at all. */
  it("says the row count moves the VENDOR's bill, and how much", () => {
    expect(limit).toMatch(/dataforseo'?s own bill/i);
    expect(limit).toMatch(/ten times it at 1000/i);
  });
});
