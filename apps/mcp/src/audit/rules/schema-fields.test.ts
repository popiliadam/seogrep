import { describe, expect, it } from "vitest";
import { auditSchema, REQUIRED_FIELDS } from "./schema.ts";
import type { AuditCrawl, AuditPage } from "../crawl-data.ts";

/**
 * REQUIRED-FIELD VALIDATION over the stored JSON-LD bodies (Faz 3b).
 *
 * The three axes each rule is asserted on:
 *  - POSITIVE: a type that declares its required fields incompletely is named, with the fields;
 *  - NEGATIVE: a complete node, and an UNKNOWN type, produce nothing (an unjudged type must not
 *    become a finding merely because this engine has never heard of it);
 *  - FIELD-ABSENT: a page with no `jsonLdBlocks` (every crawl stored before Faz 3) is silent —
 *    not "clean", silent: it is not even counted as validated.
 */

function page(p: Partial<AuditPage> & { url: string }): AuditPage {
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
    ...p,
  };
}

/** A page carrying bodies: `jsonLdTypes` is derived from them so the fixture stays coherent. */
function withBlocks(url: string, objects: unknown[], truncated = 0): AuditPage {
  const blocks = objects.map((o) => JSON.stringify(o));
  const types = objects.flatMap((o) => {
    const type = (o as Record<string, unknown>)["@type"];
    return typeof type === "string" ? [type] : [];
  });
  return page({ url, jsonLdTypes: types, jsonLdBlocks: blocks, jsonLdTruncated: truncated });
}

const crawl = (pages: AuditPage[]): AuditCrawl => ({
  pages,
  skipped: [],
  fetchedAt: "2026-08-14T00:00:00.000Z",
});

describe("required fields per type", () => {
  it("POSITIVE: a Product with no offers is named, with the field it lacks", () => {
    const report = auditSchema(crawl([withBlocks("https://e/p", [{ "@type": "Product", name: "Thing" }])]));
    expect(report.missingFields).toEqual([
      { url: "https://e/p", type: "Product", missing: ["offers"] },
    ]);
    expect(report.pagesValidated).toBe(1);
  });

  it("POSITIVE: every type in the table is checked on its own minimum", () => {
    const report = auditSchema(
      crawl([
        withBlocks("https://e/a", [{ "@type": "Article", headline: "H" }]),
        withBlocks("https://e/b", [{ "@type": "BlogPosting", datePublished: "2026-01-01" }]),
        withBlocks("https://e/d", [{ "@type": "BreadcrumbList" }]),
        withBlocks("https://e/e", [{ "@type": "Organization" }]),
        withBlocks("https://e/f", [{ "@type": "WebSite", name: "S" }]),
        withBlocks("https://e/g", [{ "@type": "LocalBusiness", name: "Shop" }]),
      ]),
    );
    expect(report.missingFields).toEqual([
      { url: "https://e/a", type: "Article", missing: ["datePublished"] },
      { url: "https://e/b", type: "BlogPosting", missing: ["headline"] },
      { url: "https://e/d", type: "BreadcrumbList", missing: ["itemListElement"] },
      { url: "https://e/e", type: "Organization", missing: ["name"] },
      { url: "https://e/f", type: "WebSite", missing: ["url"] },
      { url: "https://e/g", type: "LocalBusiness", missing: ["address"] },
    ]);
  });

  it("POSITIVE: an ARRAY of @type names is judged on each name it declares", () => {
    // `"@type": ["Product", "IndividualProduct"]` is standard JSON-LD and common in real
    // templates. Deleting the array branch of typesOf left the whole package green (3766/3766)
    // on 2026-09-02, and the failure it hid is the worst shape there is: the page still appears
    // under "Types across the site" — that count reads the crawler's own type names — so the
    // report says "you have a Product" while the missing `offers` is never mentioned.
    const report = auditSchema(
      crawl([withBlocks("https://e/p", [{ "@type": ["Product", "IndividualProduct"], name: "T" }])]),
    );
    expect(report.missingFields).toEqual([
      { url: "https://e/p", type: "Product", missing: ["offers"] },
    ]);
  });

  /** The table itself is pinned: a rule is only as honest as the minimum it enforces. */
  it("the required-field table is exactly the documented minimum", () => {
    expect(REQUIRED_FIELDS).toEqual({
      Product: ["name", "offers"],
      Article: ["headline", "datePublished"],
      BlogPosting: ["headline", "datePublished"],
      BreadcrumbList: ["itemListElement"],
      Organization: ["name"],
      WebSite: ["name", "url"],
      LocalBusiness: ["name", "address"],
    });
  });

  /**
   * NOTHING IS JUDGED THAT THE GALLERY DOES NOT BACK (R-2.1, measured 2026-09-02).
   *
   * `FAQPage` sat in the table for months after Google dropped it, and no gate said a word —
   * the only pin was the table's own copy of itself, which agrees with whatever the table says.
   * So the gallery is pinned HERE, as data, and every judged type must trace to a row in it or
   * to a NAMED rule that backs it instead. A type leaving the gallery now turns this red.
   */
  const R_2_1_GALLERY = [
    "Article", "Breadcrumb", "Carousel", "Course list", "Dataset", "Discussion forum",
    "Education Q&A", "Employer aggregate rating", "Event", "Image metadata", "Job posting",
    "Local business", "Math solver", "Movie", "Organization", "Product", "Profile page", "Q&A",
    "Recipe", "Review snippet", "Software app", "Speakable", "Subscription/paywalled content",
    "Vacation rental", "Video",
  ];

  /** Judged type -> the gallery row it is, or the reference rule that backs it instead. */
  const BACKED_BY: Record<string, string> = {
    Product: "Product",
    Article: "Article",
    // schema.org subtype of Article — the gallery names the parent.
    BlogPosting: "Article",
    BreadcrumbList: "Breadcrumb",
    Organization: "Organization",
    // NOT a gallery type: R-4.1 names `WebSite` structured data as a title-link source, which is
    // a documented Google use of its own.
    WebSite: "R-4.1",
    LocalBusiness: "Local business",
  };

  it("every judged type is backed by the R-2.1 gallery, or by a rule named here", () => {
    expect(R_2_1_GALLERY).toHaveLength(25);
    expect(Object.keys(REQUIRED_FIELDS).sort()).toEqual(Object.keys(BACKED_BY).sort());
    for (const backing of Object.values(BACKED_BY)) {
      if (backing.startsWith("R-")) continue;
      expect(R_2_1_GALLERY).toContain(backing);
    }
    // R-2.2 by name, because this is the entry that was wrong: neither retired type is judged.
    expect(REQUIRED_FIELDS).not.toHaveProperty("FAQPage");
    expect(REQUIRED_FIELDS).not.toHaveProperty("HowTo");
  });

  it("R-2.2: a retired type is NOT judged — it is named, once, with what it now means", () => {
    // A customer whose FAQPage markup lacks `mainEntity` used to be handed a repair job that buys
    // nothing: Google stopped showing the rich result. The markup is still reported as PRESENT,
    // because it is, and the reply says what it is now worth rather than pretending it is a defect.
    const report = auditSchema(crawl([withBlocks("https://e/faq", [{ "@type": "FAQPage" }])]));
    expect(report.missingFields).toEqual([]);
    expect(report.retiredTypes).toEqual(["FAQPage"]);
    expect(report.typeCoverage).toEqual([{ type: "FAQPage", pages: 1 }]);
  });

  it("R-2.2: HowTo is retired too, and a live type is never named as retired", () => {
    const report = auditSchema(
      crawl([
        withBlocks("https://e/h", [{ "@type": "HowTo" }]),
        withBlocks("https://e/p", [{ "@type": "Product", name: "T", offers: { price: "1" } }]),
      ]),
    );
    expect(report.retiredTypes).toEqual(["HowTo"]);
  });

  it("NEGATIVE: a complete node produces nothing, and neither does an UNKNOWN type", () => {
    const report = auditSchema(
      crawl([
        withBlocks("https://e/ok", [
          { "@type": "Product", name: "Thing", offers: { "@type": "Offer", price: "10" } },
        ]),
        withBlocks("https://e/unknown", [{ "@type": "SoftwareApplication", weird: true }]),
      ]),
    );
    expect(report.missingFields).toEqual([]);
    expect(report.pagesValidated).toBe(2);
  });

  it("NEGATIVE: an EMPTY value is not a declaration (empty string, empty array, null)", () => {
    const report = auditSchema(
      crawl([withBlocks("https://e/p", [{ "@type": "Product", name: "  ", offers: [] }])]),
    );
    expect(report.missingFields).toEqual([
      { url: "https://e/p", type: "Product", missing: ["name", "offers"] },
    ]);
  });

  it("reads @graph members, and a nested REFERENCE is not judged", () => {
    const report = auditSchema(
      crawl([
        withBlocks("https://e/g", [
          {
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "Organization", name: "Acme" },
              { "@type": "Article", headline: "H", publisher: { "@type": "Organization", "@id": "#org" } },
            ],
          },
        ]),
      ]),
    );
    // The Article's own minimum is enforced (no datePublished); the nested publisher REFERENCE is
    // not reported as an Organization with no name — it points at the node above, which has one.
    expect(report.missingFields).toEqual([
      { url: "https://e/g", type: "Article", missing: ["datePublished"] },
    ]);
  });

  it("one row per (page, type, missing set) — repeats collapse, different gaps do not", () => {
    const twoSame = auditSchema(
      crawl([
        withBlocks("https://e/p", [
          { "@type": "Product", name: "A" },
          { "@type": "Product", name: "B" },
        ]),
      ]),
    );
    expect(twoSame.missingFields).toEqual([
      { url: "https://e/p", type: "Product", missing: ["offers"] },
    ]);

    const twoDifferent = auditSchema(
      crawl([
        withBlocks("https://e/p", [
          { "@type": "Product", name: "A" },
          { "@type": "Product", offers: { price: "1" } },
        ]),
      ]),
    );
    expect(twoDifferent.missingFields).toEqual([
      { url: "https://e/p", type: "Product", missing: ["offers"] },
      { url: "https://e/p", type: "Product", missing: ["name"] },
    ]);
  });

  it("FIELD-ABSENT: a page with no stored bodies is SILENT and is not counted as validated", () => {
    const report = auditSchema(
      crawl([page({ url: "https://e/legacy", jsonLdTypes: ["Product", "Article"] })]),
    );
    expect(report.missingFields).toEqual([]);
    expect(report.invalidJson).toEqual([]);
    expect(report.truncatedPages).toEqual([]);
    expect(report.pagesValidated).toBe(0);
    // …while the coverage half, which reads type NAMES, still measures exactly what it did.
    expect(report.pagesWithSchema).toBe(1);
    expect(report.typeCoverage).toEqual([
      { type: "Article", pages: 1 },
      { type: "Product", pages: 1 },
    ]);
  });
});

describe("invalid_json", () => {
  it("POSITIVE: an unparseable block is REPORTED, counted per page", () => {
    const report = auditSchema(
      crawl([
        page({
          url: "https://e/bad",
          jsonLdTypes: [],
          jsonLdBlocks: ["{ this is not valid json }", "also not json", '{"@type":"Organization","name":"Ok"}'],
        }),
      ]),
    );
    expect(report.invalidJson).toEqual([{ url: "https://e/bad", blocks: 2 }]);
    // …and the VALID block on the same page is still validated (it is complete, so no finding).
    expect(report.missingFields).toEqual([]);
  });

  it("NEGATIVE: a page whose blocks all parse reports nothing", () => {
    const report = auditSchema(crawl([withBlocks("https://e/ok", [{ "@type": "Organization", name: "A" }])]));
    expect(report.invalidJson).toEqual([]);
  });

  it("FIELD-ABSENT: a crawl with no bodies cannot have unparseable ones", () => {
    expect(auditSchema(crawl([page({ url: "https://e/a" })])).invalidJson).toEqual([]);
  });
});

describe("partially stored schema", () => {
  it("POSITIVE: a page whose blocks were dropped says so, with the count", () => {
    const report = auditSchema(
      crawl([withBlocks("https://e/many", [{ "@type": "Organization", name: "A" }], 3)]),
    );
    expect(report.truncatedPages).toEqual([{ url: "https://e/many", dropped: 3 }]);
  });

  it("NEGATIVE / FIELD-ABSENT: nothing dropped, or nothing measured, reports nothing", () => {
    expect(
      auditSchema(crawl([withBlocks("https://e/a", [{ "@type": "Organization", name: "A" }])])).truncatedPages,
    ).toEqual([]);
    expect(auditSchema(crawl([page({ url: "https://e/b" })])).truncatedPages).toEqual([]);
  });
});
