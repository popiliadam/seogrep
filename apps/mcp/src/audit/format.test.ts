import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatOnpageReport, formatTechReport, formatSchemaReport, ONPAGE_ORDER } from "./format.ts";
import { auditOnpage } from "./rules/onpage.ts";
import { auditTech } from "./rules/tech.ts";
import { auditSchema } from "./rules/schema.ts";
import type { AuditCrawl, AuditPage } from "./crawl-data.ts";

/** Smoke tests: the renderers turn a report into text carrying the crawl provenance and
 *  the key numbers. The rule engines' correctness is proven on structured data elsewhere. */

function page(p: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    url: p.url,
    status: p.status ?? 200,
    title: p.title ?? null,
    metaDescription: p.metaDescription ?? null,
    h1s: p.h1s ?? [],
    canonical: p.canonical ?? null,
    robotsMeta: p.robotsMeta ?? null,
    links: p.links ?? [],
    wordCount: p.wordCount ?? 0,
    jsonLdTypes: p.jsonLdTypes ?? [],
  };
}

const AT = "2026-07-19T00:00:00.000Z";
const crawl = (pages: AuditPage[]): AuditCrawl => ({ pages, skipped: [], fetchedAt: AT });

describe("audit formatters", () => {
  it("on-page report names the crawl and the page count", () => {
    const text = formatOnpageReport(auditOnpage(crawl([page({ url: "https://e/a" })])), AT);
    expect(text).toContain("On-page audit — 1 page(s) analyzed");
    expect(text).toContain(`crawl from ${AT}`);
  });

  it("tech report renders the status line", () => {
    const text = formatTechReport(auditTech(crawl([page({ url: "https://e/a", status: 404 })])), AT);
    expect(text).toContain("Technical audit — 1 page(s)");
    expect(text).toContain("client error (4xx)");
  });

  it("schema report renders coverage and the JSON-LD-only note", () => {
    const text = formatSchemaReport(auditSchema(crawl([page({ url: "https://e/a", jsonLdTypes: ["Article"] })])), AT);
    expect(text).toContain("Coverage: 1 of 1 page(s) have JSON-LD");
    expect(text).toContain("JSON-LD only");
  });

  it("handles a null fetchedAt gracefully", () => {
    const text = formatOnpageReport(auditOnpage(crawl([page({ url: "https://e/a" })])), null);
    expect(text).toContain("crawl timestamp unavailable");
  });
});

// =====================================================================================
// THE SKIPPED LIST SAYS THE REASON ONCE, NOT ONCE PER ROW.
//
// Measured 2026-08-25 on a live audit: 50 rows of skipped URLs, every one carrying the SAME
// reason string. What a reader needs there is how many were skipped for each reason; the URLs are
// examples. Both caps below are asserted through the REAL renderer, and both print what they
// withheld — a silent truncation would be worse than the long list it replaces.
// =====================================================================================

function skippedCrawl(skipped: { url: string; reason: string }[]): AuditCrawl {
  return { pages: [page({ url: "https://e/" })], skipped, fetchedAt: AT };
}

describe("the skipped list groups by reason and bounds what it prints", () => {
  /** Sixty URLs, ONE reason — the shape the live audit produced, at the size that hides it. */
  const oneReason = Array.from({ length: 60 }, (_, i) => ({
    url: `https://e/private/${i}`,
    reason: "blocked by robots.txt",
  }));

  it("prints one reason line with its own count, not one reason per URL", () => {
    const text = formatTechReport(auditTech(skippedCrawl(oneReason)), AT);
    expect(text).toContain("blocked by robots.txt — 60 URL(s):");
    // The reason appears ONCE: as the group header, never again as a per-row suffix.
    expect(text.match(/blocked by robots\.txt/g)).toHaveLength(1);
  });

  it("lists ten example URLs and says how many more share that reason", () => {
    const text = formatTechReport(auditTech(skippedCrawl(oneReason)), AT);
    expect(text).toContain("      · https://e/private/9");
    expect(text).not.toContain("https://e/private/10");
    expect(text).toMatch(/… and 50 more URL\(s\) with this reason, not listed/);
    // …and the header still counts every one of them, so the totals reconcile.
    expect(text).toContain("Not crawled (skipped): 60");
  });

  /**
   * THE OPPOSITE FAILURE, and the one grouping ALONE would have made worse: `fetch failed: X`
   * embeds a variable, so many skips can carry many DISTINCT reasons. Ordered biggest-first, only
   * the first five groups print, and the tail names both what it left out and how big it was.
   */
  const manyReasons = [
    ...Array.from({ length: 4 }, (_, i) => ({ url: `https://e/a${i}`, reason: "fetch failed: ECONNRESET" })),
    ...Array.from({ length: 3 }, (_, i) => ({ url: `https://e/b${i}`, reason: "fetch failed: ETIMEDOUT" })),
    { url: "https://e/c", reason: "fetch failed: EHOSTUNREACH" },
    { url: "https://e/d", reason: "fetch failed: ECONNREFUSED" },
    { url: "https://e/e", reason: "fetch failed: EAI_AGAIN" },
    { url: "https://e/f", reason: "fetch failed: EPROTO" },
    { url: "https://e/g", reason: "fetch failed: socket hang up" },
  ];

  it("orders the reasons biggest-first so the one explaining most of the damage is printed", () => {
    const text = formatTechReport(auditTech(skippedCrawl(manyReasons)), AT);
    const order = [...text.matchAll(/fetch failed: (\S+) — (\d+) URL\(s\):/g)].map((m) => m[2]);
    expect(order).toEqual(["4", "3", "1", "1", "1"]);
  });

  it("counts the reasons it did not print, and the URLs they cover", () => {
    const text = formatTechReport(auditTech(skippedCrawl(manyReasons)), AT);
    expect(text).toMatch(/… and 2 more reason\(s\) here, covering 2 URL\(s\), not listed/);
    expect(text).toContain("Not crawled (skipped): 12");
  });
});

// =====================================================================================
// THE SUMMARY LINE MUST AGREE WITH THE BULLETS UNDER IT.
//
// `formatOnpageReport` builds its summary by walking ONPAGE_ORDER — the key order of
// ONPAGE_LABELS — and DROPS any finding type that map does not name. So a rule can ship, count
// correctly, print its bullet, and still be summarised as "no on-page issues found": the report
// then contradicts itself on the same screen. That is what `title_stray_chars` and
// `meta_stray_chars` did until they were named.
//
// These specs drive the REAL engine and the REAL renderer. Removing either key from ONPAGE_LABELS
// turns them red.
//
// GENERALISING PAST THESE TWO TYPES TAKES A DIFFERENT KIND OF SPEC, and no fixture-driven one can
// do it: `report.counts` holds only the types the fixture pages actually FIRED, so walking its keys
// can never notice a type no fixture exercises — which is precisely how an unnamed type ships. The
// source-derived spec at the end of this block closes that by reading the rule engine's own text.
// =====================================================================================

/** A page clean on every other rule, whose title opens with a backtick a human never typed. */
const STRAY_TITLE = "`Teeth Whitening Prices in Izmir";
/** …and one whose meta description ends with a pipe severed off a template. */
const STRAY_META =
  "Teeth whitening prices in Izmir, what a session costs and how to choose a clinic |";

function strayPage(url: string, over: Partial<AuditPage>): AuditPage {
  return page({
    url,
    title: STRAY_TITLE,
    metaDescription: "A meta description well clear of the fifty character floor and the ceiling.",
    h1s: ["Whitening prices"],
    canonical: url,
    wordCount: 400,
    ...over,
  });
}

describe("a stray-edge finding is named in the summary, not summarised away", () => {
  const titleOnly = strayPage("https://e/title", {});
  const metaOnly = strayPage("https://e/meta", {
    title: "Whitening Prices in Izmir",
    metaDescription: STRAY_META,
  });

  /**
   * THE FIXTURE GUARD, and it is not ceremony: a title one character too long, or a meta one
   * character under the floor, would fire a SECOND finding — one that IS named — and every
   * assertion below would pass while proving nothing about the stray rule. Asserting the exact
   * finding list is what makes the rest of this block mean what it says.
   */
  it("fires exactly one finding on each fixture page, and it is the stray one", () => {
    const report = auditOnpage(crawl([titleOnly, metaOnly]));
    expect(report.pages.map((p) => p.findings.map((f) => f.type))).toEqual([
      ["title_stray_chars"],
      ["meta_stray_chars"],
    ]);
  });

  it("does not print 'no on-page issues found' above a page that has one", () => {
    const text = formatOnpageReport(auditOnpage(crawl([titleOnly])), AT);
    expect(text).toMatch(/1 page\(s\) with findings/);
    expect(text).not.toMatch(/no on-page issues found/i);
  });

  it("summarises both stray types by name, beside the bullets that report them", () => {
    const text = formatOnpageReport(auditOnpage(crawl([titleOnly, metaOnly])), AT);
    const summary = text.split("\n").find((line) => line.startsWith("Summary:")) ?? "";
    expect(summary).toMatch(/1 title has stray markup/i);
    expect(summary).toMatch(/1 meta description has stray markup/i);
    expect(text).toMatch(/· title starts with .*stray markup or template character/);
    expect(text).toMatch(/· meta description ends with .*stray markup or template character/);
  });

  /**
   * The two fixtures above, read from the count side: what the engine counted, the renderer can
   * name. SCOPED TO WHAT THEY FIRE — `report.counts` never holds an unobserved type — which is why
   * the source-derived spec below exists rather than this one standing in for it.
   */
  it("names every finding type these fixture pages fire", () => {
    const report = auditOnpage(crawl([titleOnly, metaOnly]));
    expect(Object.keys(report.counts).length).toBeGreaterThan(0);
    for (const type of Object.keys(report.counts)) {
      expect(ONPAGE_ORDER).toContain(type);
    }
  });

  /**
   * THE SUMMARY'S ORDER IS THE MAP'S KEY ORDER, and until this spec that rule lived only in a
   * comment. Measured: moving both stray keys to the HEAD of ONPAGE_LABELS left the whole audit +
   * report suite green — 266/266 — because no fixture anywhere held an older-type finding and a
   * stray finding at the same time, so nothing rendered the two in sequence. These two pages do,
   * and the whole Summary line is asserted, so any reordering of either key shows up as text.
   *
   * The fixture guard is the same one the block above needs, for the same reason: a stray page that
   * also tripped `missing_h1` or `thin_content` would inject a third label into the line and the
   * equality below would be pinning an accident.
   */
  const longAndStray = strayPage("https://e/long-title", {
    title: "`Teeth Whitening Prices in Izmir — Clinic Costs, Sessions and How to Choose",
  });
  const metaLongAndStray = strayPage("https://e/long-meta", {
    title: "Whitening Costs in Izmir",
    metaDescription:
      "Teeth whitening prices in Izmir explained in full: what a single session costs, how many " +
      "sessions a typical course runs to, which clinics quote per tooth, and what to ask before " +
      "you book anything at all |",
  });

  it("fires exactly the intended two findings on each ordering fixture", () => {
    const report = auditOnpage(crawl([longAndStray, metaLongAndStray]));
    expect(report.pages.map((p) => p.findings.map((f) => f.type))).toEqual([
      ["title_too_long", "title_stray_chars"],
      ["meta_too_long", "meta_stray_chars"],
    ]);
  });

  it("summarises the stray types AFTER the older types, in ONPAGE_LABELS key order", () => {
    const text = formatOnpageReport(auditOnpage(crawl([longAndStray, metaLongAndStray])), AT);
    const summary = text.split("\n").find((line) => line.startsWith("Summary:")) ?? "";
    expect(summary).toBe(
      "Summary: 1 title too long, 1 meta description too long, 1 title has stray markup, " +
        "1 meta description has stray markup.",
    );
  });

  /**
   * THE SAME RULE STATED STRUCTURALLY, over EVERY key rather than the two above — because varying
   * the position axis by GROUP showed the stray keys were not the only ones adrift. Measured on
   * this file with the spec above already in place:
   *
   *   · move an EXISTING key the legacy fixture fires (`thin_content`) to the head → red, caught
   *     by the two byte-for-byte legacy snapshots (format-signals, format-graph).
   *   · move all five Faz 1 signal keys (`img_missing_alt` … `heading_gap`) to the head → GREEN.
   *     The legacy fixture predates those rules and cannot fire them, so no snapshot renders them,
   *     and they sat exactly as unpinned as the stray keys did.
   *
   * A frozen prefix closes all three groups at once and still lets a genuine new rule APPEND: only
   * the keys that have shipped are named, and anything after them is unconstrained. Retiring or
   * reordering one of these is a change to a line customers already receive, so it should cost a
   * deliberate edit here.
   */
  const SHIPPED_ORDER = [
    "missing_title", "title_too_long", "title_too_short", "duplicate_title",
    "missing_meta", "meta_too_long", "meta_too_short", "duplicate_meta",
    "missing_h1", "multiple_h1", "missing_canonical", "canonical_elsewhere", "thin_content",
    "img_missing_alt", "title_equals_h1", "og_missing", "lang_missing", "heading_gap",
    "title_stray_chars", "meta_stray_chars",
  ];

  it("freezes the shipped key order — a new rule appends, it never interleaves", () => {
    expect(ONPAGE_ORDER.slice(0, SHIPPED_ORDER.length)).toEqual(SHIPPED_ORDER);
  });
});

// =====================================================================================
// EVERY DOUBLE-QUOTED snake_case LITERAL IN THE RULE ENGINE IS A NAMED FINDING TYPE — read off the
// engine's SOURCE rather than off a fixture, because a fixture only proves the types it happens to
// fire, and an unnamed type is by definition one nobody wrote a fixture for. That is the general
// form of the defect above; this spec reaches as much of it as one regex can, and the heading names
// WHICH PART rather than claiming the whole.
//
// THE REGEX IS THE MEASUREMENT, AND THE OBVIOUS ONE IS WRONG. `type:\s*"…"` finds 18 of the 20
// types and misses `title_stray_chars` and `meta_stray_chars` — the two this whole file is about —
// because `strayFinding` returns `{ type, text }` with the literal supplied by its CALLER. So the
// match is on any snake_case string literal in the file, which is discriminating enough here: in a
// pure rule engine over camelCase fields, every underscore-bearing literal is a finding type.
//
// BOTH ERROR AXES, NAMED — because a heading that claims more than it measures is worse than a
// narrow one: nobody re-checks it.
//
//   FALSE POSITIVE: a future snake_case literal that is NOT a finding type turns this red for the
//   wrong reason. Loud, and a one-line fix; that trade is taken deliberately.
//   FALSE NEGATIVE: the match sees DOUBLE-QUOTED literals only, so a type written as a template
//   literal or in single quotes is outside this measurement. Both shapes were measured on this
//   file and shipped unnamed with every gate green. Widening the regex is not obviously right — a
//   template literal can be assembled at runtime and read nothing like the value it emits — so the
//   limit is stated here rather than papered over by a heading that implies otherwise.
// =====================================================================================

const ONPAGE_RULES_SOURCE = readFileSync(new URL("./rules/onpage.ts", import.meta.url), "utf8");

describe("the label map names every double-quoted snake_case type literal in the engine", () => {
  const emitted = [
    ...new Set(
      (ONPAGE_RULES_SOURCE.match(/"[a-z][a-z0-9]*(?:_[a-z0-9]+)+"/g) ?? []).map((lit) =>
        lit.slice(1, -1),
      ),
    ),
  ];

  /** Without this the ⊆ assertion below passes on an empty set — green, and measuring nothing. */
  it("actually finds the types, including the shape the naive regex misses", () => {
    expect(emitted).toContain("missing_title");
    expect(emitted).toContain("title_stray_chars");
    expect(emitted).toContain("meta_stray_chars");
    expect(emitted.length).toBeGreaterThanOrEqual(20);
  });

  it("leaves none of them unnamed", () => {
    expect(emitted.filter((type) => !ONPAGE_ORDER.includes(type))).toEqual([]);
  });
});
