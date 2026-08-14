import { describe, expect, it } from "vitest";
import {
  clampField,
  contentHash,
  MAX_FIELD_CHARS,
  MAX_HREFLANGS,
  normalizeForHash,
  parseHtmlSignals,
} from "./page-signals.ts";

describe("parseHtmlSignals — heading counts", () => {
  it("counts h2 and h3 opening tags, attributes and all", () => {
    const html =
      "<body><h2>one</h2><h2 class='x'>two</h2><h3>a</h3><h3>b</h3><h3>c</h3></body>";
    const s = parseHtmlSignals(html);
    expect(s.h2Count).toBe(2);
    expect(s.h3Count).toBe(3);
  });

  it("reports 0 for a page with no h2/h3 (never undefined)", () => {
    const s = parseHtmlSignals("<body><h1>only an h1</h1><p>text</p></body>");
    expect(s.h2Count).toBe(0);
    expect(s.h3Count).toBe(0);
  });

  it("counts the TAG, not the text — an empty heading still counts", () => {
    // The signal is "how many h2s does this page declare", which is a structure question;
    // an empty <h2></h2> is a structure fact (and itself a finding).
    expect(parseHtmlSignals("<h2></h2><h2>  </h2>").h2Count).toBe(2);
  });

  it("does not confuse h2 with a longer tag name", () => {
    expect(parseHtmlSignals("<h2x>no</h2x><hgroup><h2>yes</h2></hgroup>").h2Count).toBe(1);
  });
});

describe("parseHtmlSignals — images and alt text", () => {
  it("counts images, and counts BOTH an absent alt and an EMPTY alt as missing", () => {
    const html =
      '<body>' +
      '<img src="/a.png" alt="a real description">' + // has alt      -> not missing
      '<img src="/b.png">' + //                          no alt       -> missing
      '<img src="/c.png" alt="">' + //                   empty alt    -> missing
      '<img src="/d.png" alt="   ">' + //                blank alt    -> missing
      "</body>";
    const s = parseHtmlSignals(html);
    expect(s.imgCount).toBe(4);
    // The documented decision: alt="" is correct markup for a decorative image, and it is
    // STILL counted here — the crawler cannot tell decorative from forgotten.
    expect(s.imgMissingAlt).toBe(3);
  });

  it("reports 0/0 on a page with no images", () => {
    const s = parseHtmlSignals("<body><p>no pictures here</p></body>");
    expect(s.imgCount).toBe(0);
    expect(s.imgMissingAlt).toBe(0);
  });

  it("counts an image whose alt is written with single quotes as present", () => {
    const s = parseHtmlSignals("<img src='/a.png' alt='described'>");
    expect(s.imgCount).toBe(1);
    expect(s.imgMissingAlt).toBe(0);
  });
});

describe("parseHtmlSignals — hreflang alternates", () => {
  it("collects lang/href pairs from rel=alternate links", () => {
    const html =
      '<link rel="alternate" hreflang="en" href="https://site.test/en">' +
      '<link rel="alternate" hreflang="tr" href="https://site.test/tr">' +
      '<link rel="canonical" href="https://site.test/">'; // not an alternate
    expect(parseHtmlSignals(html).hreflangs).toEqual([
      { lang: "en", href: "https://site.test/en" },
      { lang: "tr", href: "https://site.test/tr" },
    ]);
  });

  it("returns [] when the page declares no alternates", () => {
    expect(parseHtmlSignals("<head><title>x</title></head>").hreflangs).toEqual([]);
  });

  it("skips an alternate missing either half (a lang with no href is not an alternate)", () => {
    const html =
      '<link rel="alternate" hreflang="en">' +
      '<link rel="alternate" href="https://site.test/x">' +
      '<link rel="alternate" hreflang="de" href="https://site.test/de">';
    expect(parseHtmlSignals(html).hreflangs).toEqual([
      { lang: "de", href: "https://site.test/de" },
    ]);
  });

  it("caps the list at MAX_HREFLANGS (H-02: one page may not become unbounded)", () => {
    const many = Array.from(
      { length: MAX_HREFLANGS + 20 },
      (_, i) => `<link rel="alternate" hreflang="l-${i}" href="https://site.test/${i}">`,
    ).join("");
    const { hreflangs } = parseHtmlSignals(many);
    expect(hreflangs).toHaveLength(MAX_HREFLANGS);
    expect(hreflangs[0]).toEqual({ lang: "l-0", href: "https://site.test/0" });
  });

  it("clamps an over-long href to MAX_FIELD_CHARS", () => {
    const long = `https://site.test/${"x".repeat(MAX_FIELD_CHARS + 500)}`;
    const [first] = parseHtmlSignals(`<link rel="alternate" hreflang="en" href="${long}">`).hreflangs;
    expect(first?.href).toBe(clampField(long));
    expect(first?.href.length).toBe(MAX_FIELD_CHARS + 1); // + the ellipsis marking the cut
  });
});

describe("parseHtmlSignals — og / twitter / html lang", () => {
  it("returns the VALUES, not booleans, for og:* and twitter:card", () => {
    const html =
      '<meta property="og:title" content="OG Title">' +
      '<meta property="og:description" content="OG Description">' +
      '<meta property="og:image" content="/social.png">' +
      '<meta name="twitter:card" content="summary_large_image">';
    const s = parseHtmlSignals(html);
    expect(s.ogTitle).toBe("OG Title");
    expect(s.ogDescription).toBe("OG Description");
    // Stored AS WRITTEN — a relative og:image is not resolved (it is itself a finding).
    expect(s.ogImage).toBe("/social.png");
    expect(s.twitterCard).toBe("summary_large_image");
  });

  it("returns null for every absent tag, so a rule can say 'og missing'", () => {
    const s = parseHtmlSignals("<head><title>bare</title></head>");
    expect(s.ogTitle).toBeNull();
    expect(s.ogDescription).toBeNull();
    expect(s.ogImage).toBeNull();
    expect(s.twitterCard).toBeNull();
    expect(s.htmlLang).toBeNull();
  });

  it("treats a blank content attribute as absent (null, not an empty string)", () => {
    const s = parseHtmlSignals('<meta property="og:title" content="   ">');
    expect(s.ogTitle).toBeNull();
  });

  it("accepts og on name= and twitter on property= (real pages mix them up)", () => {
    const s = parseHtmlSignals(
      '<meta name="og:title" content="via name"><meta property="twitter:card" content="summary">',
    );
    expect(s.ogTitle).toBe("via name");
    expect(s.twitterCard).toBe("summary");
  });

  it("takes the FIRST value when a key is declared twice", () => {
    const s = parseHtmlSignals(
      '<meta property="og:title" content="first"><meta property="og:title" content="second">',
    );
    expect(s.ogTitle).toBe("first");
  });

  it("reads the lang attribute off the <html> tag", () => {
    expect(parseHtmlSignals('<!doctype html><html lang="tr-TR"><head></head>').htmlLang).toBe("tr-TR");
    // A lang on some other element is not the document language.
    expect(parseHtmlSignals('<html><body><p lang="fr">x</p></body></html>').htmlLang).toBeNull();
  });
});

describe("contentHash", () => {
  it("is deterministic: the same content hashes to the same digest", () => {
    const html = "<p>Hello world</p>";
    expect(contentHash(html)).toBe(contentHash(html));
    expect(contentHash(html)).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("differs when the text differs", () => {
    expect(contentHash("<p>Hello world</p>")).not.toBe(contentHash("<p>Goodbye world</p>"));
  });

  it("STRIPS TAGS: the same copy in a different wrapper is the same content", () => {
    // The duplicate-content case this signal exists for: identical copy, different markup.
    expect(contentHash("<div><p>Hello world</p></div>")).toBe(
      contentHash("<section><h1>Hello world</h1></section>"),
    );
  });

  it("collapses whitespace: reflowed markup is not new content", () => {
    expect(contentHash("<p>Hello   world</p>")).toBe(contentHash("<p>\n  Hello\tworld\n</p>"));
  });

  it("normalizes to tag-free, single-spaced, trimmed text", () => {
    expect(normalizeForHash("  <div>\n <b>a</b>   b\t</div> ")).toBe("a b");
  });
});
