import { describe, expect, it } from "vitest";
import { parseCrawlResult } from "./crawl-data.ts";
import type { Json } from "../db.ts";

/**
 * The parser is where "absent" is either preserved or destroyed, and no rule can recover a
 * distinction it loses here. So the three states are asserted on the parser itself:
 *
 *   ABSENT  -> undefined  (this crawl predates the field)
 *   NULL    -> null       (measured; the page declares nothing)
 *   VALUE   -> the value  (measured)
 *
 * The pre-Faz-1 fields keep their defaulting readers unchanged — a legacy page still gets
 * `h1s: []`, `wordCount: 0`, `jsonLdTypes: []` — and that is asserted too, because widening the
 * parser is exactly the change that could have altered them.
 */

const BASE = {
  url: "https://e/a",
  status: 200,
  title: "T",
  metaDescription: "M",
  h1s: ["h"],
  canonical: "https://e/a",
  robotsMeta: null,
  links: [],
  wordCount: 300,
  jsonLdTypes: [],
};

function parseOne(page: Record<string, Json>) {
  const crawl = parseCrawlResult({ pages: [page], skipped: [], fetchedAt: null });
  const parsed = crawl?.pages[0];
  if (!parsed) throw new Error("fixture did not parse");
  return parsed;
}

describe("parseCrawlResult — the newer signals keep their absence", () => {
  it("a legacy page reads UNDEFINED for every new field", () => {
    const page = parseOne(BASE);
    expect(page.fetchMs).toBeUndefined();
    expect(page.htmlBytes).toBeUndefined();
    expect(page.h2Count).toBeUndefined();
    expect(page.h3Count).toBeUndefined();
    expect(page.imgCount).toBeUndefined();
    expect(page.imgMissingAlt).toBeUndefined();
    expect(page.hreflangs).toBeUndefined();
    expect(page.ogTitle).toBeUndefined();
    expect(page.ogDescription).toBeUndefined();
    expect(page.ogImage).toBeUndefined();
    expect(page.twitterCard).toBeUndefined();
    expect(page.htmlLang).toBeUndefined();
    expect(page.xRobotsTag).toBeUndefined();
    expect(page.redirectChain).toBeUndefined();
    expect(page.contentHash).toBeUndefined();
    expect(page.depth).toBeUndefined();
    expect(page.inLinkCount).toBeUndefined();
  });

  it("a NULL text field is preserved as null — measured, and the page declares nothing", () => {
    const page = parseOne({ ...BASE, ogTitle: null, ogDescription: null, htmlLang: null, xRobotsTag: null });
    expect(page.ogTitle).toBeNull();
    expect(page.ogDescription).toBeNull();
    expect(page.htmlLang).toBeNull();
    expect(page.xRobotsTag).toBeNull();
    // …which is a DIFFERENT answer from the absent case above.
    expect(page.ogTitle).not.toBeUndefined();
  });

  it("a modern page reads every value back", () => {
    const page = parseOne({
      ...BASE,
      fetchMs: 1234,
      htmlBytes: 45_678,
      h2Count: 4,
      h3Count: 7,
      imgCount: 12,
      imgMissingAlt: 3,
      hreflangs: [{ lang: "en", href: "https://e/en" }, { lang: "tr", href: "https://e/tr" }],
      ogTitle: "OG",
      ogDescription: "OGD",
      ogImage: "/cover.png",
      twitterCard: "summary",
      htmlLang: "en-GB",
      xRobotsTag: "noindex",
      redirectChain: ["https://e/one", "https://e/two"],
      contentHash: "deadbeef",
      depth: 3,
      inLinkCount: 0,
    });
    expect(page.fetchMs).toBe(1234);
    expect(page.htmlBytes).toBe(45_678);
    expect(page.h2Count).toBe(4);
    expect(page.h3Count).toBe(7);
    expect(page.imgCount).toBe(12);
    expect(page.imgMissingAlt).toBe(3);
    expect(page.hreflangs).toEqual([{ lang: "en", href: "https://e/en" }, { lang: "tr", href: "https://e/tr" }]);
    expect(page.ogTitle).toBe("OG");
    expect(page.ogDescription).toBe("OGD");
    expect(page.ogImage).toBe("/cover.png");
    expect(page.twitterCard).toBe("summary");
    expect(page.htmlLang).toBe("en-GB");
    expect(page.xRobotsTag).toBe("noindex");
    expect(page.redirectChain).toEqual(["https://e/one", "https://e/two"]);
    expect(page.contentHash).toBe("deadbeef");
    expect(page.depth).toBe(3);
    // 0 is a VALUE, not an absence — the orphan signal depends on telling them apart.
    expect(page.inLinkCount).toBe(0);
  });

  it("junk in a new field degrades, it does not throw", () => {
    const page = parseOne({
      ...BASE,
      fetchMs: "fast",
      htmlBytes: null,
      imgCount: [1, 2],
      hreflangs: [{ lang: "en" }, "nope", { lang: "tr", href: "https://e/tr" }],
      redirectChain: ["ok", 7, null],
      contentHash: 12,
      depth: Number.NaN,
    });
    expect(page.fetchMs).toBeUndefined();
    expect(page.htmlBytes).toBeUndefined();
    expect(page.imgCount).toBeUndefined();
    expect(page.hreflangs).toEqual([{ lang: "tr", href: "https://e/tr" }]);
    expect(page.redirectChain).toEqual(["ok"]);
    expect(page.contentHash).toBeUndefined();
    expect(page.depth).toBeUndefined();
  });

  it("the pre-Faz-1 readers are unchanged — a legacy page still defaults exactly as before", () => {
    const page = parseOne({ url: "https://e/a", status: 200, wordCount: 100 });
    expect(page.h1s).toEqual([]);
    expect(page.links).toEqual([]);
    expect(page.jsonLdTypes).toEqual([]);
    expect(page.wordCount).toBe(100);
    expect(page.title).toBeNull();
    expect(page.canonical).toBeNull();
  });
});
