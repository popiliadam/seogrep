import { describe, expect, it } from "vitest";
import { detectCannibalization } from "./cannibalization.ts";
import { SAMPLE_PULL, gscRow, pullData } from "./fixtures.ts";
import type { GscRow } from "./types.ts";

/**
 * Cannibalization = one query with >= 2 of the site's pages each taking a meaningful share
 * of its impressions. The engine is pure, so the "meaningful share" floors and the grouping
 * are pinned exactly — a dominant page plus a negligible straggler must NOT be flagged.
 */

describe("detectCannibalization", () => {
  it("groups a query whose two pages each clear the impression + share floors", () => {
    const groups = detectCannibalization(SAMPLE_PULL);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.query).toBe("trail shoes");
    expect(groups[0]!.total_impressions).toBe(1000);
    expect(groups[0]!.pages.map((p) => p.page)).toEqual([
      "https://shop.test/trail", // 600 impressions, listed first
      "https://shop.test/trail-guide", // 400 impressions
    ]);
  });

  it("does NOT flag a dominant page with a negligible straggler (< 10% share)", () => {
    const pull = pullData(
      [
        gscRow({ query: "q", page: "https://x.test/main", impressions: 950 }),
        gscRow({ query: "q", page: "https://x.test/tiny", impressions: 50 }), // 5% share -> not a competitor
      ],
      [],
    );
    expect(detectCannibalization(pull)).toEqual([]);
  });

  it("does NOT flag a page below the absolute impression floor even at a high share", () => {
    const pull = pullData(
      [
        gscRow({ query: "q", page: "https://x.test/a", impressions: 9 }),
        gscRow({ query: "q", page: "https://x.test/b", impressions: 8 }),
      ],
      [],
    );
    // Both are ~50% share but each has < 10 impressions -> no meaningful competition.
    expect(detectCannibalization(pull)).toEqual([]);
  });

  it("does NOT flag a query served by a single page", () => {
    const pull = pullData([gscRow({ query: "solo", page: "https://x.test/solo", impressions: 500 })], []);
    expect(detectCannibalization(pull)).toEqual([]);
  });

  it("orders groups by total impressions, biggest query first", () => {
    const pull = pullData(
      [
        gscRow({ query: "small", page: "https://x.test/s1", impressions: 60 }),
        gscRow({ query: "small", page: "https://x.test/s2", impressions: 40 }),
        gscRow({ query: "big", page: "https://x.test/b1", impressions: 600 }),
        gscRow({ query: "big", page: "https://x.test/b2", impressions: 400 }),
      ],
      [],
    );
    expect(detectCannibalization(pull).map((g) => g.query)).toEqual(["big", "small"]);
  });
});

/**
 * Live product test, 2026-08-07. On a real site the tool produced exactly ONE result and it was
 * wrong: the query "adstark" — the company's own brand name. The shape was the textbook sitelink
 * signature, the homepage at 3.9 with inner pages pinned at exactly 1.0. That is healthy brand
 * SERP behaviour, not cannibalization; an SEO who sees it flagged stops trusting the tool, and a
 * user who acts on it de-optimises their own brand pages.
 *
 * Suppression needs BOTH signals — the brand name AND the sitelink shape. As a conjunction it can
 * only ever narrow what gets hidden, so it cannot introduce a false positive of its own.
 */
const sitelinkRows = (host: string, query: string): GscRow[] => [
  gscRow({ query, page: `https://${host}/`, impressions: 27, clicks: 9, position: 3.9 }),
  gscRow({ query, page: `https://${host}/hakkimizda`, impressions: 17, clicks: 0, position: 1 }),
  gscRow({ query, page: `https://${host}/iletisim`, impressions: 16, clicks: 1, position: 1 }),
];

const competitiveRows = (host: string, query: string): GscRow[] => [
  gscRow({ query, page: `https://${host}/a`, impressions: 300, clicks: 10, position: 6.4 }),
  gscRow({ query, page: `https://${host}/b`, impressions: 200, clicks: 4, position: 9.1 }),
];

const brandedOf = (rows: GscRow[], property?: string): boolean => {
  const groups = detectCannibalization(pullData(rows, [], 90, property));
  expect(groups).toHaveLength(1);
  return groups[0]!.branded;
};

describe("detectCannibalization — branded queries", () => {
  it("excludes the live case: the site's own brand name with pages pinned at 1", () => {
    expect(brandedOf(sitelinkRows("adstark.com.tr", "adstark"))).toBe(true);
  });

  it("keeps an ordinary query", () => {
    expect(detectCannibalization(SAMPLE_PULL)[0]!.branded).toBe(false);
  });

  it("excludes a brand mentioned inside a longer query when it LOOKS like sitelinks", () => {
    expect(brandedOf(sitelinkRows("adstark.com.tr", "adstark dijital pazarlama"))).toBe(true);
  });

  /**
   * The conjunction earning its place: a brand word on a genuinely contested query stays in the
   * list. Without the sitelink requirement, every "apple pie recipe" on apple.com would vanish.
   */
  it("KEEPS a branded query whose pages are actually competing, not pinned", () => {
    expect(brandedOf(competitiveRows("adstark.com.tr", "adstark dijital pazarlama"))).toBe(false);
  });

  /**
   * Referee catch. Taking the host's FIRST label made "blog" the brand on a blog.* property:
   * real findings containing the word "blog" were suppressed while the site's actual brand went
   * unrecognised — the exact inverse of this slice's purpose. Blogs are where cannibalization
   * mostly happens, so that shortcut suppressed what the tool exists to find.
   */
  it("reads the brand through a subdomain instead of making the subdomain the brand", () => {
    expect(brandedOf(sitelinkRows("blog.adstark.com.tr", "adstark"))).toBe(true);
    expect(brandedOf(sitelinkRows("blog.adstark.com.tr", "blog yazilim"))).toBe(false);
  });

  it("reads the brand through www", () => {
    expect(brandedOf(sitelinkRows("www.adstark.com.tr", "adstark"))).toBe(true);
  });

  it("prefers the verified property over the page hosts", () => {
    // Pages on a CDN host, property naming the real site: the property wins.
    expect(brandedOf(sitelinkRows("cdn.example.net", "adstark"), "sc-domain:adstark.com.tr")).toBe(true);
  });

  /**
   * Referee catch: the token was derived per query group from whichever row came first, so the
   * same data answered differently depending on Google's row order.
   */
  it("gives the same answer whatever order the rows arrive in", () => {
    const rows = sitelinkRows("adstark.com.tr", "adstark");
    expect(brandedOf(rows)).toBe(brandedOf([...rows].reverse()));
  });

  it("matches a hyphenated domain against the query spelled the same way", () => {
    expect(brandedOf(sitelinkRows("ads-tark.com", "ads-tark"))).toBe(true);
  });

  /**
   * A Turkish site whose customers type the accented spelling — the majority of this product's
   * measured user base — would otherwise never be recognised.
   */
  it("matches across accents in both directions", () => {
    expect(brandedOf(sitelinkRows("ciceksepeti.com", "çiçeksepeti"))).toBe(true);
  });

  it("does not treat a coincidental substring inside a longer word as the brand", () => {
    // "shop" IS a substring of "shopping" — the earlier fixture ("shop" vs "trail shoes") was
    // not a substring at all, so it proved nothing and survived a mutation to `includes`.
    expect(brandedOf(sitelinkRows("shop.test", "shopping bags"))).toBe(false);
  });

  it("finds no brand in an IP-literal host", () => {
    expect(brandedOf(sitelinkRows("192.168.1.10", "192 168"))).toBe(false);
  });

  /**
   * Referee catch, round 2. The sitelink test also demanded that some page NOT be pinned, which
   * generalised from the one live example where the homepage sat at 3.9 — the atypical part of
   * it. On your own brand query the homepage is normally at 1.0, so the most common brand shape
   * was exempted, and a two-page group could never be branded at all (two pages cannot both be
   * pinned AND include an unpinned one). Both survived mutation until now.
   */
  it("excludes a brand query whose pages are ALL pinned at 1", () => {
    const rows = [
      gscRow({ query: "adstark", page: "https://adstark.com.tr/", impressions: 27, clicks: 9, position: 1 }),
      gscRow({ query: "adstark", page: "https://adstark.com.tr/iletisim", impressions: 17, clicks: 0, position: 1 }),
      gscRow({ query: "adstark", page: "https://adstark.com.tr/hakkimizda", impressions: 16, clicks: 1, position: 1.2 }),
    ];
    expect(brandedOf(rows)).toBe(true);
  });

  it("excludes a TWO-page brand query, the commonest group shape", () => {
    const rows = [
      gscRow({ query: "adstark", page: "https://adstark.com.tr/", impressions: 27, clicks: 9, position: 1 }),
      gscRow({ query: "adstark", page: "https://adstark.com.tr/iletisim", impressions: 17, clicks: 0, position: 1.2 }),
    ];
    expect(brandedOf(rows)).toBe(true);
  });

  it("still keeps a two-page brand query that is genuinely contested", () => {
    expect(brandedOf(competitiveRows("adstark.com.tr", "adstark ajans"))).toBe(false);
  });

  it("needs TWO pinned pages, not one", () => {
    const rows = [
      gscRow({ query: "adstark", page: "https://adstark.com.tr/", impressions: 27, clicks: 9, position: 1 }),
      gscRow({ query: "adstark", page: "https://adstark.com.tr/x", impressions: 17, clicks: 0, position: 4 }),
    ];
    expect(brandedOf(rows)).toBe(false);
  });

  /**
   * Referee catch, round 2. An unlisted multi-part suffix lands one label too far right, and a
   * hosting platform's domain is not the site's brand. Both produced SHARED tokens that
   * suppressed real findings: a blog on wordpress.com writing about WordPress is the likeliest
   * content there is.
   */
  it("never brands a generic suffix label", () => {
    expect(brandedOf(sitelinkRows("adstark.com.pl", "com hizmeti"))).toBe(false);
    expect(brandedOf(sitelinkRows("adstark.org.au", "org nedir"))).toBe(false);
  });

  /**
   * Referee catch, round 3: the blacklist was position-insensitive, so it also ate the brand of
   * the platform's OWN site. 14 real companies measured — wordpress.com, github.com, web.com,
   * name.com and friends — got no brand at all, meaning the whole slice did nothing for them.
   * "wordpress" IS the brand on wordpress.com; it is only a suffix when something sits in front.
   */
  it("brands the platform's own site, which is not the same as sitting on the platform", () => {
    expect(brandedOf(sitelinkRows("wordpress.com", "wordpress"))).toBe(true);
    expect(brandedOf(sitelinkRows("github.com", "github"))).toBe(true);
    expect(brandedOf(sitelinkRows("web.com", "web"))).toBe(true);
  });

  it("never brands the hosting platform a site sits on", () => {
    expect(brandedOf(sitelinkRows("myblog.wordpress.com", "wordpress tema"))).toBe(false);
    expect(brandedOf(sitelinkRows("myproject.github.io", "github actions"))).toBe(false);
  });

  /**
   * Referee catch, round 2: a declared property that will not parse used to fall through to the
   * page hosts, letting an unrelated CDN name the brand. "No brand" is strictly safer.
   */
  it("does not guess from page hosts when a declared property is unusable", () => {
    expect(brandedOf(sitelinkRows("cdn.example.net", "example"), "not a url at all")).toBe(false);
    expect(brandedOf(sitelinkRows("cdn.example.net", "example"), "sc-domain:hm.com")).toBe(false);
  });

  it("fails closed on a declared property that normalises to nothing", () => {
    // "sc-domain:" with nothing after it is still a DECLARATION; it must not reopen the guess.
    expect(brandedOf(sitelinkRows("cdn.example.net", "example"), "sc-domain:")).toBe(false);
    expect(brandedOf(sitelinkRows("cdn.example.net", "example"), "   ")).toBe(false);
  });

  it("reads the property case-insensitively", () => {
    expect(brandedOf(sitelinkRows("cdn.example.net", "adstark"), "SC-DOMAIN:adstark.com.tr")).toBe(true);
  });

  /**
   * Referee catch, round 2: folding only on whitespace traded one class of miss for another —
   * "ads-tark" started matching but "adstark-ajans" and the canonical navigational query
   * "adstark.com.tr" stopped.
   */
  it("matches the brand however the separator falls", () => {
    expect(brandedOf(sitelinkRows("adstark.com.tr", "adstark.com.tr"))).toBe(true);
    expect(brandedOf(sitelinkRows("adstark.com.tr", "adstark-ajans"))).toBe(true);
    expect(brandedOf(sitelinkRows("ads-tark.com", "ads-tark"))).toBe(true);
  });

  it("ignores a domain label too short to be a safe brand token", () => {
    // A 2-character token would match half the language; "hm" must not brand "hm nedir".
    expect(brandedOf(sitelinkRows("hm.com", "hm"))).toBe(false);
  });
});
