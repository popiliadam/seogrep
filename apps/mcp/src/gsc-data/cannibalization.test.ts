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

  /**
   * Live campaign, 2026-08-09. www.bigcattr.com, query "british kedi cinsleri": 8 "competing
   * pages", three of which were ONE article — the bare URL at 2.2 plus #nasil-bir-kedi and
   * #renkler both at 9.8. Google shows jump-links into an article's sections; counting them as
   * rivals of the article inflates the page count and invents a conflict to fix.
   */
  it("counts rows differing only by #fragment as ONE page, so a self-only query is no finding", () => {
    const article = "https://www.bigcattr.com/blog/icerik/british-shorthair-kedi-cinsi";
    const pull = pullData(
      [
        gscRow({ query: "british kedi cinsleri", page: article, impressions: 500, position: 2.2 }),
        gscRow({ query: "british kedi cinsleri", page: `${article}#nasil-bir-kedi`, impressions: 300, position: 9.8 }),
        gscRow({ query: "british kedi cinsleri", page: `${article}#renkler`, impressions: 200, position: 9.8 }),
      ],
      [],
    );
    expect(detectCannibalization(pull)).toEqual([]);
  });

  /**
   * The aggregation rule, pinned as a number rather than left implicit. Impressions and clicks
   * are summed (they count separate events, and the sum keeps the group's totals and therefore
   * both floors exactly where they were); position is the IMPRESSION-WEIGHTED mean, which is the
   * same kind of average Google's own position already is. The alternatives are visibly
   * different here: best-position would say 2.0, an unweighted mean 6.0.
   */
  it("sums a merged page's impressions and clicks and weights its position by impressions", () => {
    const pull = pullData(
      [
        gscRow({ query: "q", page: "https://x.test/a", impressions: 100, clicks: 10, position: 2 }),
        gscRow({ query: "q", page: "https://x.test/a#section", impressions: 300, clicks: 5, position: 10 }),
        gscRow({ query: "q", page: "https://x.test/b", impressions: 200, clicks: 4, position: 7 }),
      ],
      [],
    );
    const groups = detectCannibalization(pull);
    expect(groups).toHaveLength(1);
    // Three rows, two documents: the merge happened before the competitor filter counted pages.
    expect(groups[0]!.pages).toHaveLength(2);
    // Both group totals survive the merge untouched — that is what keeps the share denominator
    // and both floors exactly where they were.
    expect(groups[0]!.total_impressions).toBe(600);
    expect(groups[0]!.total_clicks).toBe(19);
    expect(groups[0]!.pages[0]).toEqual({
      query: "q",
      page: "https://x.test/a", // the document, with no fragment left on it
      impressions: 400, // 100 + 300
      clicks: 15, // 10 + 5, not the bare row's 10
      position: 8, // (2×100 + 10×300) / 400
      ctr: 0.0375, // 15/400, recomputed rather than carried from a row
    });
  });

  /**
   * A section row can be the ONLY row Google returns for a document. It still names the article,
   * so the page the user is told to look at must not carry a fragment it cannot act on.
   */
  it("strips the fragment even from a lone anchor row", () => {
    const pull = pullData(
      [
        gscRow({ query: "q", page: "https://x.test/a#section", impressions: 300, clicks: 5, position: 9 }),
        gscRow({ query: "q", page: "https://x.test/b", impressions: 200, clicks: 4, position: 7 }),
      ],
      [],
    );
    expect(detectCannibalization(pull)[0]!.pages.map((p) => p.page)).toEqual([
      "https://x.test/a",
      "https://x.test/b",
    ]);
  });

  /**
   * The collapse must stop at the fragment. A trailing slash or a query string CAN address a
   * different document, so merging on those would hide real rivals — the opposite failure.
   */
  it("does NOT merge pages differing by trailing slash or query string", () => {
    const slash = pullData(
      [
        gscRow({ query: "q", page: "https://x.test/guide", impressions: 300 }),
        gscRow({ query: "q", page: "https://x.test/guide/", impressions: 200 }),
      ],
      [],
    );
    expect(detectCannibalization(slash)[0]!.pages).toHaveLength(2);

    const queryString = pullData(
      [
        gscRow({ query: "q", page: "https://x.test/guide", impressions: 300 }),
        gscRow({ query: "q", page: "https://x.test/guide?page=2", impressions: 200 }),
      ],
      [],
    );
    expect(detectCannibalization(queryString)[0]!.pages).toHaveLength(2);
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

  /**
   * The query here USED to be the bare "adstark". It had to move to a brand-plus-word query when
   * the brand-only path landed (see "excludes a brand-only query whose brand SERP has NO pinned
   * sitelinks"): a query that IS the brand no longer consults the sitelink count at all, so the
   * old fixture would have measured nothing whatever number this rule required. The claim is
   * unchanged and still mutation-detected — it is now asserted over the queries the rule still
   * governs, which is every query carrying a word beyond the brand.
   */
  it("needs TWO pinned pages, not one", () => {
    const rows = [
      gscRow({ query: "adstark ajans", page: "https://adstark.com.tr/", impressions: 27, clicks: 9, position: 1 }),
      gscRow({ query: "adstark ajans", page: "https://adstark.com.tr/x", impressions: 17, clicks: 0, position: 4 }),
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

  /**
   * Live campaign, 2026-08-09. dentnotion.com produced 107 "cannibalized" queries and the FIRST
   * was "dent notion" — the company's own name typed with a space, homepage at 2.0 plus five
   * inner pages. Matching word by word could not see it: neither "dent" nor "notion" is
   * "dentnotion". People type a compound brand as separate words, so adjacent words have to be
   * allowed to join.
   */
  it("matches a compound brand the user typed as separate words", () => {
    expect(brandedOf(sitelinkRows("dentnotion.com", "dent notion"))).toBe(true);
    expect(brandedOf(sitelinkRows("dentnotion.com", "dent notion dis klinigi"))).toBe(true);
  });

  /**
   * Live campaign, 2026-08-09, dentnotion.com again — the half of that case the compound-brand
   * join could not reach. "dent notion" matched the brand and was STILL the site's number-one
   * "cannibalized" query, because the other half of the conjunction wanted sitelinks and Google
   * was drawing none: the homepage at 2.0 and five corporate pages between 2.7 and 4.2, nothing
   * at <= 1.5. The measured positions are used verbatim so the pin carries the real case. (The
   * live group printed 4233 impressions; the six pages here are the ones that cleared both
   * floors, summing to 3614 — the rest were tail pages below the 10% share.)
   */
  it("excludes a brand-only query whose brand SERP has NO pinned sitelinks", () => {
    const host = "dentnotion.com";
    const rows = [
      gscRow({ query: "dent notion", page: `https://${host}/`, impressions: 719, clicks: 88, position: 2.0 }),
      gscRow({ query: "dent notion", page: `https://${host}/our-doctors/`, impressions: 713, clicks: 3, position: 3.1 }),
      gscRow({ query: "dent notion", page: `https://${host}/iletisim/`, impressions: 704, clicks: 5, position: 4.1 }),
      gscRow({ query: "dent notion", page: `https://${host}/cocuk-dis-hekimligi/`, impressions: 525, clicks: 2, position: 4.2 }),
      gscRow({ query: "dent notion", page: `https://${host}/doctor/dt-gurkan-zeybek-3/`, impressions: 503, clicks: 3, position: 3.3 }),
      gscRow({ query: "dent notion", page: `https://${host}/doktorlarimiz/`, impressions: 450, clicks: 15, position: 2.7 }),
    ];
    // No page is anywhere near the pinned band — that is the whole point of the fixture.
    expect(rows.filter((r) => r.position <= 1.5)).toHaveLength(0);
    expect(brandedOf(rows)).toBe(true);
  });

  /**
   * The pin that stops the relaxation becoming a general loosening, and the reason it is scoped to
   * "exactly the brand": one word beyond the brand and the brand can be incidental to the intent —
   * "apple pie recipe" is a recipe query that happens to start with a company name — so unpinned
   * pages stay a reportable finding exactly as before.
   */
  it("KEEPS a brand-PLUS-words query whose pages are NOT pinned", () => {
    const rows = [
      gscRow({ query: "apple pie recipe", page: "https://apple.com/a", impressions: 300, clicks: 10, position: 3 }),
      gscRow({ query: "apple pie recipe", page: "https://apple.com/b", impressions: 200, clicks: 4, position: 4 }),
    ];
    expect(brandedOf(rows)).toBe(false);
  });

  /** The same query pinned at 1 is suppressed, as it already was. Behaviour must not have moved. */
  it("still excludes a brand-PLUS-words query whose pages ARE pinned", () => {
    const rows = [
      gscRow({ query: "apple pie recipe", page: "https://apple.com/a", impressions: 300, clicks: 10, position: 1 }),
      gscRow({ query: "apple pie recipe", page: "https://apple.com/b", impressions: 200, clicks: 4, position: 1.2 }),
    ];
    expect(brandedOf(rows)).toBe(true);
  });

  /**
   * What the brand-only path COSTS, pinned rather than left as prose: on apple.com the bare query
   * "apple" is now suppressed whatever its pages do. That is the generic-word limit on
   * isBrandedQuery paid in full for one query shape, and it is the deliberate trade — of the two
   * errors, telling a user to de-optimise the pages ranking for their own name is the one that
   * loses their trust. If this ever needs revisiting, revisit it here.
   */
  it("suppresses the bare brand word even on generically-named sites, pages unpinned", () => {
    const rows = [
      gscRow({ query: "apple", page: "https://apple.com/a", impressions: 300, clicks: 10, position: 3 }),
      gscRow({ query: "apple", page: "https://apple.com/b", impressions: 200, clicks: 4, position: 4 }),
    ];
    expect(brandedOf(rows)).toBe(true);
  });

  /**
   * THE BRAND-ONLY PATH FOLDS. Both assertions below were green under a referee mutation that gave
   * this path its own space-split, unfolded tokenization — the whole suite could not tell the
   * shipped design apart from the alternative that was considered and rejected. They pin it now.
   *
   * First: the reason the fold is on this path at all. A Turkish brand carrying `ı` registers the
   * ASCII domain (Yıldız -> yildiz.com) and the customer types the `ı`, so without the fold the
   * bare brand word on an unpinned brand SERP is exactly the false positive this slice exists to
   * remove — for the measured-majority case, not an edge one.
   *
   * Second: the PRICE of that, asserted rather than merely described in a comment. `ı` and `i` are
   * different letters in Turkish, so the fold merges minimal pairs: tıp (medicine) / tip (type).
   * A site on tip.com therefore suppresses the lone query `tıp`, whatever its pages do. That is a
   * real cost accepted deliberately — the collision needs the site to be the ASCII twin of an
   * unrelated word AND that word to be the entire query. Pinned so that a future design which can
   * separate them has to change this line on purpose, in daylight, rather than drift past a green
   * suite.
   */
  it("folds on the brand-only path too — and pins the minimal-pair price of doing so", () => {
    expect(brandedOf(competitiveRows("yildiz.com", "yıldız"))).toBe(true);
    expect(brandedOf(competitiveRows("tip.com", "tıp"))).toBe(true);
  });

  /**
   * The change must not leak outside the brand path: a genuine conflict on a non-brand query, on
   * the very site whose brand query is now suppressed, is still reported in full.
   */
  it("still reports a real conflict on a non-brand query on the same branded site", () => {
    const rows = competitiveRows("dentnotion.com", "dis beyazlatma fiyatlari");
    const groups = detectCannibalization(pullData(rows, [], 90));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.branded).toBe(false);
    expect(groups[0]!.pages).toHaveLength(2);
  });

  /**
   * The guard against over-correcting. Each of these would be branded by the obvious shortcut —
   * fold the WHOLE query and ask whether it contains the token — and each is a query the tool
   * must keep reporting. Joining runs of adjacent atoms and testing EQUALITY is what separates
   * them: "car petrol" joins to "carpetrol", never to "carpet".
   */
  it("does not brand words that merely contain the token once the query is folded", () => {
    expect(brandedOf(sitelinkRows("carpet.com", "car petrol"))).toBe(false);
    expect(brandedOf(sitelinkRows("dentnotion.com", "student dent notionally"))).toBe(false);
  });

  /**
   * Adjacency and order are part of the rule, not an accident of it: a brand is the words next
   * to each other in the domain's order. Without this, joining would creep toward "these words
   * appear somewhere in the query", which is the containment failure one step removed.
   */
  it("does not brand the same words when they are separated or reversed", () => {
    expect(brandedOf(sitelinkRows("dentnotion.com", "dent and notion"))).toBe(false);
    expect(brandedOf(sitelinkRows("dentnotion.com", "notion dent"))).toBe(false);
  });

  /**
   * Accents are removed BEFORE the query is cut into words, not after. Cut first and a combining
   * mark becomes a word boundary, so "araçkiralama" — one typed word, generic Turkish for car
   * rental — would split into "arac" + "kiralama" and hand kiralama.com its own brand. That is
   * the "shopping" is not "shop" failure coming back in through an accent, on the language most
   * of this product's measured users search in.
   */
  it("does not let an accent inside a word turn the rest of it into the brand", () => {
    expect(brandedOf(sitelinkRows("kiralama.com", "araçkiralama"))).toBe(false);
    // The same two words genuinely written apart ARE the brand plus a word.
    expect(brandedOf(sitelinkRows("kiralama.com", "araç kiralama"))).toBe(true);
  });

  /**
   * Referee catch. Turkish dotless ı (U+0131) has no decomposition and is not a diacritic, so it
   * survived folding as itself while its ASCII twin folded to "i". Measured 2026-08-09: "yıldız"
   * did not match yildiz.com, "kıralama" did not match kiralama.com. That is the ordinary shape,
   * not a corner case — a Turkish brand whose name carries ı registers the ASCII domain and its
   * customers type the ı — so it is the compound-brand failure arriving through a letter.
   */
  it("folds Turkish dotless ı to i so an ASCII domain matches the query as typed", () => {
    expect(brandedOf(sitelinkRows("yildiz.com", "yıldız"))).toBe(true);
    expect(brandedOf(sitelinkRows("kiralama.com", "kıralama"))).toBe(true);
    // ...and it composes with the adjacent-atom join, which is how compound brands arrive.
    expect(brandedOf(sitelinkRows("arikovani.com", "arı kovanı"))).toBe(true);
  });

  /**
   * The near misses this fold CREATES. Widening a fold widens what can be suppressed, which is the
   * direction that hides real cannibalization, so each of these is a query that only comes near
   * the brand once ı folds and must still be reported:
   *   - "kırmızı" (red) folds to "kirmizi", which now starts with kir.com's whole token. Equality
   *     of atoms is what saves it; containment would suppress every red-related query on the site.
   *   - "yıldızı" is "yıldız" with a possessive suffix, and Turkish agglutinates constantly, so
   *     the inflected forms of a brand word are a large share of real queries. Treating them as
   *     the brand would suppress far more than the brand.
   */
  it("does not brand a longer Turkish word that merely starts with the token once ı folds", () => {
    expect(brandedOf(sitelinkRows("kir.com", "kırmızı"))).toBe(false);
  });

  it("does not brand an inflected form of the brand word", () => {
    expect(brandedOf(sitelinkRows("yildiz.com", "yıldızı"))).toBe(false);
  });

  /**
   * FOLD EXCLUSIVITY. The two tests above prove that `ı` folds and that near misses survive;
   * neither proves that ONLY `ı` folds. A referee measured the gap: widening the replacement to
   * `/[ıu]/` — folding an unrelated vowel "while in the area" — passed the entire suite green,
   * in the more-suppression direction, which is the one the user cannot see.
   *
   * `bira` (beer) and `bura` (this place) are ordinary Turkish words that differ only in that
   * vowel, so a domain label of one must never brand a query of the other. Any character added
   * to the fold class that is not a Turkish-specific undecomposable letter fails here.
   */
  it("folds ONLY dotless ı — no other vowel is merged into i", () => {
    expect(brandedOf(sitelinkRows("bura.com", "bira"))).toBe(false);
    expect(brandedOf(sitelinkRows("bira.com", "bura"))).toBe(false);
  });

  /**
   * What bounds the widened fold, and it is a SMALLER bound than it was. This test asserted the
   * bare "yıldız" until the brand-only path landed; a query that folds onto the brand and is
   * nothing else is now suppressed on its own, so the honest statement of the bound is that it
   * covers every query carrying a word beyond the brand. There `branded` still needs
   * looksLikeSitelinks, so an ı-folded brand word on genuinely competing pages stays in the list
   * — the fold widens one half of a conjunction, never the answer. A reader worried about the
   * ı → i collisions (tıp/tip, kır/kir) should read this test AND the note on foldChars, which
   * names what the brand-only path costs: the lone query "tıp" on tip.com is suppressed whatever
   * its pages do.
   */
  it("KEEPS a Turkish ı-folded brand word plus a word when the pages are competing", () => {
    expect(brandedOf(competitiveRows("yildiz.com", "yıldız markası"))).toBe(false);
  });

  it("ignores a domain label too short to be a safe brand token", () => {
    // A 2-character token would match half the language; "hm" must not brand "hm nedir".
    expect(brandedOf(sitelinkRows("hm.com", "hm"))).toBe(false);
  });
});

/**
 * THE LIVE DEFECT, 2026-08-25, dentnotion.com. The tool printed
 *   `Excluded 2 branded queries ("dent notion", "dentnotion")`
 * and then listed `"dent notion menderes"` — 7 competing pages, 1130 impressions, the LARGEST
 * row in the list — as the site's number one problem, with seven more branded rows beneath it.
 * Its own stated principle should have removed at least eight of the sixty results.
 *
 * `competitiveRows` is used throughout ON PURPOSE: none of these SERPs was pinned, which is
 * exactly why the old conjunction let them through. If the shared matcher stops calling these
 * decisive, every one of these goes red.
 */
describe("detectCannibalization — the eight rows measured on dentnotion.com", () => {
  const branded = (query: string): boolean => brandedOf(competitiveRows("dentnotion.com", query));

  it("excludes the brand followed by another word — the row that led the list", () => {
    expect(branded("dent notion menderes")).toBe(true);
  });

  it("excludes the brand when it is NOT at the start of the query", () => {
    expect(branded("menderes dent notion")).toBe(true);
  });

  it("excludes the long descriptive brand queries", () => {
    expect(branded("dent notion ı menderes diş polikliniği yorumlar")).toBe(true);
    expect(branded("dent notion ı menderes diş polikliniği yorumları")).toBe(true);
    expect(branded("dent notion yorumları")).toBe(true);
    expect(branded("dent notion fotoğraflar")).toBe(true);
  });

  it("excludes the two misspellings of the brand", () => {
    expect(branded("dent nation")).toBe(true);
    expect(branded("dentmotion")).toBe(true);
  });

  /**
   * The other side, on the SAME site: a query sharing one word with the compound brand is a real
   * finding and stays in the list. Half a brand is not a brand — otherwise a dental clinic's
   * every "dent…" query would vanish, which is the tool doing the opposite of its job.
   */
  it("still reports a query that shares only ONE word with the compound brand", () => {
    expect(branded("dis beyazlatma dent")).toBe(false);
    expect(branded("izmir diş beyazlatma")).toBe(false);
  });

  /**
   * The safe-degradation case for a domain root that is an ordinary word. dental.com's real
   * queries must not be branded on sight; only the bare word is, and that cost is already pinned
   * by "suppresses the bare brand word even on generically-named sites".
   */
  it("does not brand a common-word domain's ordinary queries", () => {
    expect(brandedOf(competitiveRows("dental.com", "dental implants"))).toBe(false);
    expect(brandedOf(competitiveRows("dental.com", "dental clinic prices"))).toBe(false);
  });
});
