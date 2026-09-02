import { describe, expect, it } from "vitest";
import { auditHreflang } from "./hreflang.ts";
import type { AuditPage } from "../crawl-data.ts";

/**
 * THE HREFLANG RULES (R-4.10 reciprocity, R-4.11 code format).
 *
 * The data was already there and nobody read it: `AuditPage.hreflangs` has been parsed since the
 * signals shipped, and `grep -rn hreflang apps/mcp/src/audit/rules/` returned NOTHING until
 * 2026-09-02. So a 15-credit technical audit was silent on the one international-SEO defect a
 * single crawl CAN prove — an alternate that is not returned.
 *
 * The three axes, and the same absence doctrine every rule in this engine follows:
 *  - POSITIVE: a real defect is named, with both ends of it;
 *  - NEGATIVE: correct markup produces nothing, and neither does a shape this check cannot judge;
 *  - ABSENT: a crawl that never stored hreflangs yields `null` — not an empty report, which would
 *    read as "we looked and your hreflang is fine".
 */

function page(over: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    status: 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 0,
    jsonLdTypes: [],
    ...over,
  };
}

/** A page declaring alternates, written the way the crawler stores them. */
function withAlternates(url: string, pairs: [string, string][]): AuditPage {
  return page({ url, hreflangs: pairs.map(([lang, href]) => ({ lang, href })) });
}

describe("hreflang: the crawl either measured this or it did not", () => {
  it("ABSENT: a crawl that never stored hreflangs reports NOTHING — not an empty report", () => {
    expect(auditHreflang([page({ url: "https://e/" })])).toBeNull();
  });

  it("MEASURED AND EMPTY: a page with no alternates is a measurement, and it is clean", () => {
    const report = auditHreflang([page({ url: "https://e/", hreflangs: [] })]);
    expect(report).not.toBeNull();
    expect(report).toEqual({
      invalidCodes: [],
      missingXDefault: [],
      notReciprocated: [],
      unmeasuredTargets: 0,
    });
  });
});

describe("hreflang code format (R-4.11)", () => {
  const codes = (values: string[]) =>
    auditHreflang([withAlternates("https://e/", values.map((v) => [v, "https://e/x"]))])
      ?.invalidCodes ?? [];

  it("POSITIVE: a region on its own is not a language, and the reason says so", () => {
    const found = codes(["us"]);
    expect(found).toHaveLength(1);
    expect(found[0]?.url).toBe("https://e/");
    expect(found[0]?.lang).toBe("us");
    expect(found[0]?.reason).toMatch(/ISO 639-1/i);
  });

  it("POSITIVE: a three-letter language is not ISO 639-1, however real the language is", () => {
    // `fil` (Filipino) exists in ISO 639-2 and is a common hreflang mistake for exactly that
    // reason: the code is real, and Google still ignores the tag.
    expect(codes(["fil"])).toHaveLength(1);
  });

  it("POSITIVE: the reserved regions EU and UN have no effect, and are named as reserved", () => {
    const found = codes(["en-eu", "en-un"]);
    expect(found).toHaveLength(2);
    expect(found[0]?.reason).toMatch(/reserved/i);
  });

  it("POSITIVE: a malformed value is reported once, with the value the page declared", () => {
    expect(codes(["en_GB"])).toHaveLength(1);
    expect(codes(["en-GB-x"])).toHaveLength(1);
    expect(codes([""])).toHaveLength(1);
  });

  it("NEGATIVE: the shapes Google documents are accepted, x-default included", () => {
    expect(codes(["en", "en-GB", "pt-BR", "zh-Hant", "zh-Hant-TW", "x-default", "X-Default"])).toEqual([]);
  });

  it("NEGATIVE: the check reads the CODE, so a code that is a real language passes", () => {
    // `uk` is Ukrainian. A site that meant the United Kingdom has written a working tag for the
    // wrong audience, and no code-shaped check can see that — stated here so a later reader does
    // not mistake silence for a verdict.
    expect(codes(["uk"])).toEqual([]);
  });
});

describe("hreflang x-default (R-4.11)", () => {
  it("POSITIVE: a page offering several languages and no x-default is named", () => {
    const report = auditHreflang([
      withAlternates("https://e/", [
        ["en", "https://e/"],
        ["de", "https://e/de"],
      ]),
    ]);
    expect(report?.missingXDefault).toEqual(["https://e/"]);
  });

  it("NEGATIVE: an x-default present, and a single alternate, are both clean", () => {
    const withDefault = auditHreflang([
      withAlternates("https://e/", [
        ["en", "https://e/"],
        ["de", "https://e/de"],
        ["x-default", "https://e/"],
      ]),
    ]);
    expect(withDefault?.missingXDefault).toEqual([]);
    const single = auditHreflang([withAlternates("https://e/", [["en", "https://e/"]])]);
    expect(single?.missingXDefault).toEqual([]);
  });
});

describe("hreflang reciprocity (R-4.10)", () => {
  it("POSITIVE: A points at B, B does not point back — the pair is ignored, so it is reported", () => {
    const report = auditHreflang([
      withAlternates("https://e/en", [
        ["en", "https://e/en"],
        ["de", "https://e/de"],
      ]),
      withAlternates("https://e/de", [["de", "https://e/de"]]),
    ]);
    expect(report?.notReciprocated).toEqual([
      { from: "https://e/en", to: "https://e/de", lang: "de" },
    ]);
  });

  it("NEGATIVE: a mutual pair is clean, and a trailing slash is not a different page", () => {
    const report = auditHreflang([
      withAlternates("https://e/en", [
        ["en", "https://e/en"],
        ["de", "https://e/de/"],
      ]),
      withAlternates("https://e/de", [
        ["de", "https://e/de"],
        ["en", "https://e/en"],
      ]),
    ]);
    expect(report?.notReciprocated).toEqual([]);
  });

  it("NEGATIVE: a page pointing at ITSELF is not an unreturned pair", () => {
    const report = auditHreflang([withAlternates("https://e/en", [["en", "https://e/en"]])]);
    expect(report?.notReciprocated).toEqual([]);
  });

  it("UNMEASURED: a target this crawl did not fetch is COUNTED, never accused", () => {
    const report = auditHreflang([
      withAlternates("https://e/en", [
        ["en", "https://e/en"],
        ["fr", "https://other.test/fr"],
      ]),
    ]);
    expect(report?.notReciprocated).toEqual([]);
    expect(report?.unmeasuredTargets).toBe(1);
    // A page inside the crawl whose OWN hreflangs were never stored is unmeasured too: it cannot
    // point back, and calling that a defect would report the crawl's own bounds as the site's.
    const legacyTarget = auditHreflang([
      withAlternates("https://e/en", [
        ["en", "https://e/en"],
        ["de", "https://e/de"],
      ]),
      page({ url: "https://e/de" }),
    ]);
    expect(legacyTarget?.notReciprocated).toEqual([]);
    expect(legacyTarget?.unmeasuredTargets).toBe(1);
  });
});
