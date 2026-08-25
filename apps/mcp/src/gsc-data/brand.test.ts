import { describe, expect, it } from "vitest";
import { brandTokenOf, isDecisiveBrandMatch, matchBrand, type BrandMatchKind } from "./brand.ts";
import { gscRow, pullData } from "./fixtures.ts";

/**
 * The shared brand matcher, tested WITHOUT any surface around it.
 *
 * Every surface used to answer "is this the customer's own name?" on its own, and the answer
 * measured on dentnotion.com 2026-08-25 was: `detect_cannibalization` excluded two exact strings
 * and then printed EIGHT branded rows, `audit_content` reported the brand itself as a missing
 * keyword, and the shared public report carried both. The rule now lives here, so it is pinned
 * here — including the side these tests exist to guard, which is the FALSE-POSITIVE side: a
 * generic query that merely shares a word with the domain must survive.
 */

/** The kind of brand match `query` gets against `host`'s brand, or null. */
function kindOf(host: string, query: string): BrandMatchKind | null {
  const token = brandTokenOf(pullData([], [], 90, `sc-domain:${host}`));
  return matchBrand(query, token)?.kind ?? null;
}

/** Is the match strong enough for a surface to act on without further evidence? */
const decisive = (host: string, query: string): boolean => {
  const token = brandTokenOf(pullData([], [], 90, `sc-domain:${host}`));
  return isDecisiveBrandMatch(matchBrand(query, token));
};

describe("brandTokenOf", () => {
  it("derives the token from the domain ROOT, through subdomains and multi-part suffixes", () => {
    const of = (property: string): string | null => brandTokenOf(pullData([], [], 90, property));
    expect(of("sc-domain:dentnotion.com")).toBe("dentnotion");
    expect(of("https://www.dentnotion.com/")).toBe("dentnotion");
    expect(of("sc-domain:blog.adstark.com.tr")).toBe("adstark");
    expect(of("sc-domain:ads-tark.com")).toBe("adstark");
  });

  it("falls back to page hosts ONLY when no property was stored at all", () => {
    const rows = [gscRow({ query: "q", page: "https://dentnotion.com/x" })];
    expect(brandTokenOf(pullData(rows, []))).toBe("dentnotion");
    // A declared-but-unusable property fails closed rather than letting a CDN name the brand.
    expect(brandTokenOf(pullData(rows, [], 90, "sc-domain:"))).toBeNull();
  });

  it("has no brand for a label too short, an IP literal, or a hosting platform", () => {
    const of = (host: string): string | null =>
      brandTokenOf(pullData([], [], 90, `sc-domain:${host}`));
    expect(of("hm.com")).toBeNull();
    expect(of("192.168.1.10")).toBeNull();
    expect(of("myblog.wordpress.com")).toBeNull();
    // ...but the platform's OWN site keeps its brand.
    expect(of("wordpress.com")).toBe("wordpress");
  });
});

/**
 * THE EIGHT ROWS MEASURED LIVE on dentnotion.com, 2026-08-25. Every one of them was printed to
 * the customer as one of their own site's problems, directly beneath a footnote claiming branded
 * queries had been excluded. Impressions are carried in the names so the cost of missing one is
 * legible: the first row was the largest in the entire list.
 */
describe("matchBrand — the eight measured branded rows", () => {
  const rows: readonly [string, string][] = [
    ["dent notion menderes", "1130 impressions — was the FIRST row of the list"],
    ["menderes dent notion", "457 — the brand is not at the start"],
    ["dent nation", "444 — misspelling"],
    ["dent notion ı menderes diş polikliniği yorumlar", "407"],
    ["dent notion ı menderes diş polikliniği yorumları", "171"],
    ["dent notion yorumları", "139"],
    ["dent notion fotoğraflar", "138"],
    ["dentmotion", "73 — misspelling, typed as one word"],
  ];

  for (const [query, note] of rows) {
    it(`treats "${query}" as decisively branded (${note})`, () => {
      expect(decisive("dentnotion.com", query)).toBe(true);
    });
  }
});

describe("matchBrand — the tiers", () => {
  it("calls the brand typed ALONE brand-only, however it is spelled or spaced", () => {
    expect(kindOf("dentnotion.com", "dentnotion")).toBe("brand-only");
    expect(kindOf("dentnotion.com", "dent notion")).toBe("brand-only");
    expect(kindOf("dentnotion.com", "dent-notion")).toBe("brand-only");
    expect(kindOf("dentnotion.com", "Dent Notion")).toBe("brand-only");
  });

  it("calls an adjacent multi-word join inside a longer query a compound-run", () => {
    expect(kindOf("dentnotion.com", "dent notion menderes")).toBe("compound-run");
    expect(kindOf("dentnotion.com", "menderes dent notion")).toBe("compound-run");
  });

  /**
   * The WEAK tier, and the whole reason the tiers exist. One atom of a longer query equalling the
   * brand is the shape a generic-word domain produces constantly, so it settles nothing on its
   * own and the surface has to corroborate it.
   */
  it("calls one shared word in a longer query a brand-word, and NOT decisive", () => {
    expect(kindOf("apple.com", "apple pie recipe")).toBe("brand-word");
    expect(decisive("apple.com", "apple pie recipe")).toBe(false);
    expect(kindOf("dental.com", "dental implants")).toBe("brand-word");
    expect(decisive("dental.com", "dental implants")).toBe(false);
  });
});

/**
 * THE FALSE-POSITIVE SIDE. Fuzzy brand matching is a machine for suppressing real findings, so
 * each of these is a query that must come back with NO match at all — not a weak one.
 */
describe("matchBrand — what it must NOT brand", () => {
  it("does not brand a query that merely shares ONE word with a compound domain", () => {
    // The done_when case: "dent" alone is half the brand and half is not enough.
    expect(kindOf("dentnotion.com", "dis beyazlatma dent")).toBeNull();
    expect(kindOf("dentnotion.com", "dent implant fiyatlari")).toBeNull();
  });

  it("does not brand an ordinary query on a branded site", () => {
    expect(kindOf("dentnotion.com", "izmir dis beyazlatma")).toBeNull();
  });

  it("requires EQUALITY of the joined run, never containment", () => {
    expect(kindOf("carpet.com", "car petrol")).toBeNull();
    expect(kindOf("dentnotion.com", "student dent notionally")).toBeNull();
    expect(kindOf("shop.test", "shopping bags")).toBeNull();
  });

  it("requires the run to be ADJACENT and in the domain's order", () => {
    expect(kindOf("dentnotion.com", "dent and notion")).toBeNull();
    expect(kindOf("dentnotion.com", "notion dent")).toBeNull();
  });

  /**
   * A COMMON-WORD DOMAIN, which is where a careless matcher does the most damage: dental.com's
   * real queries are all about dentistry, and a rule that branded them would empty the tool.
   * Only the bare word itself reaches a decisive tier — everything the site actually sells does
   * not, and the two-word probe is the one a near-spelling rule would have swallowed.
   */
  it("degrades safely on a domain root that is an ordinary word", () => {
    expect(decisive("dental.com", "dental implants")).toBe(false);
    expect(decisive("dental.com", "dental clinic prices")).toBe(false);
    expect(kindOf("dental.com", "dentist near me")).toBeNull();
    expect(kindOf("dental.com", "dentals")).toBeNull();
  });
});

/**
 * NEAR-SPELLINGS: exactly one substitution or one adjacent transposition, at equal length, on a
 * token of at least 8 characters. It is deliberately NOT edit distance — the excluded halves are
 * what keep Turkish inflection and short ordinary words out.
 */
describe("matchBrand — near-spellings", () => {
  it("matches one substituted letter and one transposed pair", () => {
    expect(kindOf("dentnotion.com", "dentmotion")).toBe("brand-only");
    expect(kindOf("dentnotion.com", "dent nation")).toBe("brand-only");
    expect(kindOf("dentnotion.com", "dnetnotion")).toBe("brand-only");
  });

  it("does NOT match a suffixed or truncated form — insertions and deletions are excluded", () => {
    // Turkish agglutinates: "yıldızı" is "yıldız" plus a suffix and a different query. Allowing
    // insertions would suppress the inflected forms of a brand word, which are a large share of
    // real queries. (yildiz is under the length floor too — pinned again below at 8+.)
    expect(kindOf("yildiz.com", "yıldızı")).toBeNull();
    expect(kindOf("dentnotion.com", "dentnotions")).toBeNull();
    expect(kindOf("dentnotion.com", "dentnotio")).toBeNull();
  });

  it("does NOT fuzzy-match a token below the 8-character floor", () => {
    // "mental" is one substitution from "dental" and "bira" one from "bura" — ordinary words a
    // shorter floor would hand to the wrong brand.
    expect(kindOf("dental.com", "mental")).toBeNull();
    expect(kindOf("bura.com", "bira")).toBeNull();
    expect(kindOf("adstark.com.tr", "adstarl")).toBeNull();
  });

  it("does NOT fuzzy-match inside a longer query, only against the whole of it", () => {
    expect(kindOf("dentnotion.com", "dent nation menderes")).toBeNull();
    expect(kindOf("dentnotion.com", "dentmotion menderes")).toBeNull();
  });

  it("needs the differing letters to be ADJACENT for the transposition rule", () => {
    // "dnetnotoin" differs from "dentnotion" in two SEPARATED places: not one typo.
    expect(kindOf("dentnotion.com", "dnetnotion")).toBe("brand-only");
    expect(kindOf("dentnotion.com", "netdnotion")).toBeNull();
  });
});

describe("matchBrand — folding", () => {
  it("folds accents and Turkish dotless ı on both sides", () => {
    expect(kindOf("ciceksepeti.com", "çiçeksepeti")).toBe("brand-only");
    expect(kindOf("yildiz.com", "yıldız")).toBe("brand-only");
    expect(kindOf("arikovani.com", "arı kovanı")).toBe("brand-only");
  });

  it("folds ONLY dotless ı — no other vowel is merged into i", () => {
    expect(kindOf("bura.com", "bira")).toBeNull();
    expect(kindOf("bira.com", "bura")).toBeNull();
  });

  it("has no match at all when the pull has no usable brand", () => {
    expect(matchBrand("anything at all", null)).toBeNull();
    expect(isDecisiveBrandMatch(null)).toBe(false);
  });

  it("carries the atoms the brand consumed, so a caller can treat them as its own words", () => {
    const token = brandTokenOf(pullData([], [], 90, "sc-domain:dentnotion.com"));
    expect(matchBrand("dent notion menderes", token)?.brandAtoms).toEqual(["dent", "notion"]);
    expect(matchBrand("dent notion", token)?.brandAtoms).toEqual(["dent", "notion"]);
    expect(matchBrand("dentmotion", token)?.brandAtoms).toEqual(["dentmotion"]);
  });
});
