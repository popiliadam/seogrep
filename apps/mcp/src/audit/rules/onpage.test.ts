import { describe, expect, it } from "vitest";
import { auditOnpage } from "./onpage.ts";
import type { AuditCrawl, AuditPage } from "../crawl-data.ts";

/**
 * Fixture-crawl determinism for the on-page rules: each rule gets a positive case (the
 * finding appears) and the shared clean baseline is the negative (it does not). The
 * `page` factory defaults to a fully clean page (distinct in-range title/meta, one h1,
 * self canonical, 500 words), so any finding a test sees is caused by the field it set.
 */

function page(p: Partial<AuditPage> & { url: string }): AuditPage {
  const has = (k: keyof AuditPage): boolean => Object.prototype.hasOwnProperty.call(p, k);
  return {
    url: p.url,
    status: p.status ?? 200,
    title: has("title") ? (p.title ?? null) : `A reasonable title for ${p.url}`,
    metaDescription: has("metaDescription")
      ? (p.metaDescription ?? null)
      : `A reasonable meta description for ${p.url} within the length range.`,
    h1s: p.h1s ?? ["One heading"],
    canonical: has("canonical") ? (p.canonical ?? null) : p.url,
    robotsMeta: has("robotsMeta") ? (p.robotsMeta ?? null) : null,
    links: p.links ?? [],
    wordCount: p.wordCount ?? 500,
    jsonLdTypes: p.jsonLdTypes ?? [],
  };
}

const crawl = (pages: AuditPage[]): AuditCrawl => ({ pages, skipped: [], fetchedAt: "2026-07-19T00:00:00.000Z" });

/** Finding types for the page whose url is `url` (empty if the page is clean). */
function typesFor(report: ReturnType<typeof auditOnpage>, url: string): string[] {
  return report.pages.find((p) => p.url === url)?.findings.map((f) => f.type) ?? [];
}

describe("auditOnpage — clean baseline (negative)", () => {
  it("a fully clean page produces no findings and is omitted from pages", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a" })]));
    expect(report.pages).toEqual([]);
    expect(report.counts).toEqual({});
    expect(report.pageCount).toBe(1);
  });
});

describe("auditOnpage — title rules", () => {
  it("flags a missing title", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", title: null })]));
    expect(typesFor(report, "https://e/a")).toContain("missing_title");
  });
  it("flags a title over 60 chars, and a clean-length title does not", () => {
    const long = "x".repeat(61);
    const report = auditOnpage(crawl([page({ url: "https://e/a", title: long })]));
    expect(typesFor(report, "https://e/a")).toContain("title_too_long");
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/b" })])), "https://e/b")).not.toContain("title_too_long");
  });
  it("flags a title under 10 chars", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", title: "Hi" })]));
    expect(typesFor(report, "https://e/a")).toContain("title_too_short");
  });
  it("flags duplicate titles shared across pages", () => {
    const report = auditOnpage(
      crawl([page({ url: "https://e/a", title: "Same Title Here" }), page({ url: "https://e/b", title: "Same Title Here" })]),
    );
    expect(typesFor(report, "https://e/a")).toContain("duplicate_title");
    expect(typesFor(report, "https://e/b")).toContain("duplicate_title");
    expect(report.counts.duplicate_title).toBe(2);
  });
});

describe("auditOnpage — meta description rules", () => {
  it("flags a missing meta description", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", metaDescription: null })]));
    expect(typesFor(report, "https://e/a")).toContain("missing_meta");
  });
  it("flags a meta over 160 and under 50 chars", () => {
    const longRep = auditOnpage(crawl([page({ url: "https://e/a", metaDescription: "y".repeat(161) })]));
    expect(typesFor(longRep, "https://e/a")).toContain("meta_too_long");
    const shortRep = auditOnpage(crawl([page({ url: "https://e/b", metaDescription: "too short" })]));
    expect(typesFor(shortRep, "https://e/b")).toContain("meta_too_short");
  });
  it("flags duplicate meta descriptions", () => {
    const dup = "This exact meta description is shared by two different pages on the site.";
    const report = auditOnpage(
      crawl([page({ url: "https://e/a", metaDescription: dup }), page({ url: "https://e/b", metaDescription: dup })]),
    );
    expect(typesFor(report, "https://e/a")).toContain("duplicate_meta");
    expect(typesFor(report, "https://e/b")).toContain("duplicate_meta");
  });
});

describe("auditOnpage — heading, canonical, thin-content rules", () => {
  it("flags missing and multiple h1", () => {
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/a", h1s: [] })])), "https://e/a")).toContain("missing_h1");
    const multi = auditOnpage(crawl([page({ url: "https://e/b", h1s: ["one", "two"] })]));
    expect(typesFor(multi, "https://e/b")).toContain("multiple_h1");
  });
  it("flags a missing canonical and a canonical pointing elsewhere (self-canonical is clean)", () => {
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/a", canonical: null })])), "https://e/a")).toContain("missing_canonical");
    const elsewhere = auditOnpage(crawl([page({ url: "https://e/b", canonical: "https://e/other" })]));
    expect(typesFor(elsewhere, "https://e/b")).toContain("canonical_elsewhere");
    // A trailing-slash-only difference is NOT a conflict (self-canonical tolerance).
    const selfSlash = auditOnpage(crawl([page({ url: "https://e/c", canonical: "https://e/c/" })]));
    expect(typesFor(selfSlash, "https://e/c")).not.toContain("canonical_elsewhere");
  });
  it("flags thin content under 200 words", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", wordCount: 120 })]));
    expect(typesFor(report, "https://e/a")).toContain("thin_content");
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/b", wordCount: 200 })])), "https://e/b")).not.toContain("thin_content");
  });
});

/** The text of the finding of `type` on `url` — "" when the rule did not fire at all. */
function textFor(report: ReturnType<typeof auditOnpage>, url: string, type: string): string {
  return report.pages.find((p) => p.url === url)?.findings.find((f) => f.type === type)?.text ?? "";
}

/**
 * EVERY THRESHOLD-BASED FINDING NAMES ITS THRESHOLD.
 *
 * The measured complaint: `title too long (62 chars)` told a customer they broke a rule without
 * saying which, so 2-over and 30-over read identically. Each row below therefore asserts TWO
 * numbers on one finding — what was measured, and the bound it broke — as regexes over the prose
 * rather than by comparing the whole string to a source literal, which would pass no matter what
 * the sentence said. Deleting the bound from any one message turns that row red on its second
 * expectation, and only that one.
 *
 * The bounds are LITERALS here on purpose: 60/10/160/50/200 are the product's numbers, not the
 * module's, so importing them back out of the module under test would let a silent change to a
 * constant carry its own test along with it.
 */
describe("auditOnpage — every threshold finding states its threshold", () => {
  const cases: { rule: string; type: string; measured: number; bound: number; fields: Partial<AuditPage> }[] = [
    { rule: "title too long", type: "title_too_long", measured: 62, bound: 60, fields: { title: "x".repeat(62) } },
    { rule: "title too short", type: "title_too_short", measured: 7, bound: 10, fields: { title: "Dentist" } },
    { rule: "meta too long", type: "meta_too_long", measured: 161, bound: 160, fields: { metaDescription: "y".repeat(161) } },
    { rule: "meta too short", type: "meta_too_short", measured: 9, bound: 50, fields: { metaDescription: "too short" } },
    { rule: "thin content", type: "thin_content", measured: 42, bound: 200, fields: { wordCount: 42 } },
  ];

  it.each(cases)("$rule reports the measured value AND the bound it broke", ({ type, measured, bound, fields }) => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", ...fields })]));
    const text = textFor(report, "https://e/a", type);
    expect(text, `${type} did not fire`).not.toBe("");
    expect(text, "the measured value is missing").toMatch(new RegExp(String.raw`\b${measured}\b`));
    expect(text, "the threshold the value broke is missing").toMatch(new RegExp(String.raw`\b${bound}\b`));
  });
});

/**
 * STRAY EDGE CHARACTERS — and the false-positive side carries MORE specs than the true-positive
 * side, deliberately. A rule that flagged `10 Ways to Whiten Teeth` would be worse than the gap it
 * closes, so the clean cases below are real title shapes: quotes, a leading digit, brackets,
 * parentheses, an em dash, an ellipsis, a trailing `?`, a hashtag, an emoji, and Turkish, Greek,
 * Arabic and CJK text — the measured page was Turkish, so ASCII is never the test.
 */
describe("auditOnpage — stray markup at a title/description edge", () => {
  /** The MEASURED page: a code-fence backtick survived into a live title, and nothing flagged it. */
  const MEASURED = "`İzmirde Diş Beyazlatma Merkezleri 2026";

  it("flags the measured backtick title, and names the character it found", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", title: MEASURED })]));
    expect(typesFor(report, "https://e/a")).toContain("title_stray_chars");
    const text = textFor(report, "https://e/a", "title_stray_chars");
    expect(text).toMatch(/title/i);
    expect(text).toContain("`");
    expect(text).toMatch(/start/i);
  });

  const dirty: [string, string][] = [
    ["a trailing dangling separator", "Diş Beyazlatma Fiyatları |"],
    ["a trailing dangling dash", "Teeth Whitening in Izmir -"],
    ["a trailing em dash", "Teeth Whitening in Izmir —"],
    ["a leaked opening HTML tag", "<p>Teeth Whitening in Izmir"],
    ["a leaked closing HTML tag", "Teeth Whitening in Izmir</p>"],
    ["an unrendered template placeholder", "{{page_title}} Dental Clinic"],
    ["a Markdown heading marker", "## Teeth Whitening in Izmir"],
    ["a Markdown list bullet", "- Teeth Whitening in Izmir"],
    ["a Markdown emphasis marker", "*Teeth Whitening in Izmir*"],
    ["a dangling ampersand", "Teeth Whitening in Izmir &"],
    ["a leading comma", ", Teeth Whitening in Izmir"],
  ];
  it.each(dirty)("flags %s", (_why, title) => {
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/a", title })])), "https://e/a")).toContain(
      "title_stray_chars",
    );
  });

  const clean: [string, string][] = [
    ["quotes around a word", 'The "Best" Dentist in Izmir'],
    // BOTH EDGES are quotes here, which is the shape a naive "strip the punctuation" rule
    // flags first — and it is a perfectly ordinary title.
    ["a title wrapped in straight quotes", '"The Best Dentist in Izmir"'],
    ["a title wrapped in curly quotes", "“The Best Dentist in Izmir”"],
    ["a title wrapped in parentheses", "(Updated for 2026) Teeth Whitening"],
    ["curly quotes", "The “Best” Dentist in Izmir"],
    ["a leading digit", "10 Ways to Whiten Teeth"],
    ["leading brackets", "[2026] Guide to Dental Implants"],
    ["trailing parentheses", "Teeth Whitening Costs (2026)"],
    ["an em dash between clauses", "Diş Beyazlatma — Fiyatlar ve Süreç"],
    ["a trailing question mark", "Is Teeth Whitening Safe?"],
    ["a trailing exclamation", "Whiten Your Teeth Today!"],
    ["a trailing ellipsis", "What Nobody Tells You About Whitening…"],
    ["a hashtag, which is not a Markdown heading", "#DisBeyazlatma Hakkinda Her Sey"],
    ["an ampersand and a colon between words", "Zahnärzte in München: Preise & Ablauf"],
    ["a slash between words", "Dentist 24/7 Emergency Care in Izmir"],
    ["a leading emoji", "😀 Smile Brighter Every Single Day"],
    ["Greek text", "Παιδοδοντίατρος στην Αθήνα σήμερα"],
    ["Arabic text", "العناية بالأسنان في دبي اليوم"],
    ["CJK text", "牙齿美白指南与价格以及注意事项"],
    ["a trailing percent", "Whitening Results Improved 40%"],
    ["an apostrophe", "Izmir's Most Trusted Dental Clinic"],
  ];
  it.each(clean)("leaves %s alone", (_why, title) => {
    expect(typesFor(auditOnpage(crawl([page({ url: "https://e/a", title })])), "https://e/a")).not.toContain(
      "title_stray_chars",
    );
  });

  it("applies to the meta description too, and a clean description stays clean", () => {
    const bad = auditOnpage(
      crawl([page({ url: "https://e/a", metaDescription: "`A meta description long enough to clear the fifty character floor." })]),
    );
    expect(typesFor(bad, "https://e/a")).toContain("meta_stray_chars");
    expect(textFor(bad, "https://e/a", "meta_stray_chars")).toMatch(/meta description/i);

    const good = auditOnpage(
      crawl([page({ url: "https://e/b", metaDescription: "İzmir'de diş beyazlatma: fiyatlar, süreç ve sık sorulan sorular (2026)." })]),
    );
    expect(typesFor(good, "https://e/b")).not.toContain("meta_stray_chars");
  });

  it("a title that is one stray character reports one problem, not two", () => {
    const report = auditOnpage(crawl([page({ url: "https://e/a", title: "`" })]));
    const text = textFor(report, "https://e/a", "title_stray_chars");
    expect(text).toMatch(/start/i);
    expect(text).not.toMatch(/end/i);
  });
});
