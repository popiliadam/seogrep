import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditTechTool, renderTechAudit } from "./audit-tech.ts";
import type { AuditCrawl, AuditPage } from "../audit/index.ts";

/**
 * WHAT 15 CREDITS ACTUALLY BUY — asserted against a real render, never against a second
 * hand-written list.
 *
 * The defect these specs close (measured 2026-08-26): the tool description named FOUR sections
 * and the formatter printed TWELVE. Both halves of the honesty gap were reachable only by
 * rendering, because the eight missing sections are conditional — a fixture that never carries a
 * slow page never prints "Slow pages", so a spec built on one crawl can agree with a description
 * that omits it.
 *
 * SO THE SECTION LISTS ARE DERIVED, from two renders at the two ends of the axis:
 *
 *   • EMPTY_CRAWL   — one ordinary page, no skips, no signals, no sitemap. What it prints is the
 *                     GUARANTEED set: the sections that appear even when there is nothing to say.
 *   • LOADED_CRAWL  — one page per signal the engine knows. What it prints is EVERYTHING, so the
 *                     difference between the two renders is exactly the conditional set.
 *
 * Two hand-written lists can agree with each other while both disagree with the code (signed
 * lesson 11), so nothing below retypes a section name: the labels come out of the rendered text,
 * the description is PARSED into its two clauses, and the comparison is set equality in both
 * directions — a section dropped from the description fails, and a section invented for the
 * description that no render produces fails too.
 *
 * THE DOCS PAGE IS CHECKED THE SAME WAY, from the same derived labels. Half a fix is what the
 * defect report warned about: the page's frontmatter description comes from the tool description
 * and its body comes from DOC_PROSE (apps/web/scripts/gen-tool-docs.mjs), so correcting one and
 * not the other leaves a page arguing with its own `<meta>` tag.
 */

const DESCRIPTION = auditTechTool.description;

/** The generated docs page — the artifact where the two prose sources meet on one screen. */
const DOCS_PAGE = readFileSync(
  new URL("../../../web/content/docs/tools-reference/audit-tech.mdx", import.meta.url),
  "utf8",
);

// --- fixtures ---------------------------------------------------------------------

function page(over: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    status: 200,
    title: "A page",
    metaDescription: null,
    h1s: ["A page"],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 300,
    jsonLdTypes: [],
    ...over,
  };
}

/**
 * The floor: a crawl with nothing wrong and nothing measured beyond the four base fields. Written
 * the way an OLD crawl was written — by LEAVING the optional signals out — so no conditional
 * section can fire and what remains is the guaranteed set.
 */
const EMPTY_CRAWL: AuditCrawl = {
  pages: [page({ url: "https://empty.test/" })],
  skipped: [],
  fetchedAt: "2026-08-26T00:00:00.000Z",
};

/** The ceiling: at least one row for every section the engine can produce, sitemap included. */
const LOADED_CRAWL: AuditCrawl = {
  fetchedAt: "2026-08-26T00:00:00.000Z",
  sitemapUrls: ["https://loaded.test/", "https://loaded.test/never-crawled"],
  skipped: [
    { url: "https://loaded.test/private", reason: "blocked by robots.txt" },
    { url: "https://loaded.test/away", reason: "off-origin redirect to https://other.test/" },
  ],
  pages: [
    page({
      url: "https://loaded.test/",
      links: ["https://loaded.test/noindex", "https://loaded.test/gone"],
      depth: 0,
      inLinkCount: 0,
    }),
    page({ url: "https://loaded.test/noindex", robotsMeta: "noindex", depth: 1, inLinkCount: 1 }),
    page({ url: "https://loaded.test/gone", status: 404, depth: 1, inLinkCount: 1 }),
    page({ url: "https://loaded.test/boom", status: 503, depth: 1, inLinkCount: 0 }),
    page({
      url: "https://loaded.test/buried",
      depth: 6,
      inLinkCount: 0,
      fetchMs: 12_000,
      htmlBytes: 4_000_000,
      redirectChain: ["https://loaded.test/old", "https://loaded.test/older"],
      xRobotsTag: "noindex",
    }),
  ],
};

// --- deriving the section list from the rendered text ------------------------------

/**
 * The section headings the formatter actually emitted, as LABELS.
 *
 * A heading is a non-indented line preceded by a blank one — the shape every `lines.push("", …)`
 * in formatTechReport produces, and one no body line can imitate, because every body line the
 * renderer emits is indented. The opening provenance line is excluded by the same rule: it is the
 * first line, so nothing precedes it.
 *
 * The label is the heading up to its first `(` or `:` — dropping the count and the parenthetical
 * that names the threshold, both of which are data rather than identity ("Slow pages (fetch over
 * 3000 ms): 1" is the Slow pages section however many there are and wherever the constant moves).
 */
function sectionLabels(text: string): string[] {
  const lines = text.split("\n");
  return lines.flatMap((line, index) => {
    if (index === 0 || lines[index - 1] !== "" || line === "" || line.startsWith(" ")) return [];
    return [line.split(/[(:]/)[0].trim()];
  });
}

const ALWAYS_PRINTED = sectionLabels(renderTechAudit(EMPTY_CRAWL).text);
const EVERY_SECTION = sectionLabels(renderTechAudit(LOADED_CRAWL).text);
const ONLY_WHEN_PRESENT = EVERY_SECTION.filter((label) => !ALWAYS_PRINTED.includes(label));

// --- parsing the description back into the two lists it claims ---------------------

/** Split a prose enumeration on its commas, ignoring commas inside a parenthetical gloss. */
function splitEnumeration(clause: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of clause) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current);
  return items.map((item) => item.replace(/\s*\([^)]*\)\s*$/u, "").trim()).filter(Boolean);
}

/** The two enumerations the description promises, keyed by the clause that introduces them. */
function describedSections(): { always: string[]; conditional: string[] } {
  const match = DESCRIPTION.match(
    /Always reported:\s*(.+?)\.\s*Reported only when the crawl has them:\s*(.+?)\.\s*Costs/s,
  );
  if (match === null) {
    throw new Error("The description no longer carries its two labelled section lists.");
  }
  return { always: splitEnumeration(match[1]), conditional: splitEnumeration(match[2]) };
}

// --- the docs page, parsed the same way --------------------------------------------

/** The leading bold name of every `- **Name** — …` bullet under "## What it does". */
function docsBulletLabels(): string[] {
  const body = DOCS_PAGE.split("## What it does")[1] ?? "";
  return body
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^- \*\*(.+?)\*\*\s+—/u);
      return match ? [match[1].trim()] : [];
    });
}

/** The bold names inside the page's "these print on every run" sentence. */
function docsGuaranteedLabels(): string[] {
  const match = DOCS_PAGE.match(/print on every run(.+?)because each is a count/s);
  if (match === null) {
    throw new Error("The docs page no longer says which sections print on every run.");
  }
  return [...match[1].matchAll(/\*\*(.+?)\*\*/gu)].map((bold) => bold[1].trim());
}

describe("audit_tech — the ground truth the prose has to match", () => {
  it("prints twelve sections, four of which appear on every run", () => {
    // Pinned so a formatter that GAINS or LOSES a section is visible as itself, not only as a
    // knock-on failure of the prose specs below. The counts are the 2026-08-26 measurement.
    expect(ALWAYS_PRINTED).toHaveLength(4);
    expect(EVERY_SECTION).toHaveLength(12);
    expect(ONLY_WHEN_PRESENT).toHaveLength(8);
  });

  it("prints every guaranteed section on the loaded crawl too", () => {
    // The two renders are compared as sets below, which is only meaningful if the guaranteed
    // sections really are a subset of the full render rather than a different vocabulary.
    for (const label of ALWAYS_PRINTED) expect(EVERY_SECTION).toContain(label);
  });
});

describe("audit_tech — the tool description", () => {
  it("promises exactly the sections that print on every run", () => {
    expect(new Set(describedSections().always)).toEqual(new Set(ALWAYS_PRINTED));
  });

  it("promises exactly the sections that print only when the crawl has them", () => {
    expect(new Set(describedSections().conditional)).toEqual(new Set(ONLY_WHEN_PRESENT));
  });

  it("names no section the formatter never prints", () => {
    // The fabrication direction, stated on its own so a failure reads as "this section does not
    // exist" rather than as a set mismatch (NEVER#7).
    const { always, conditional } = describedSections();
    for (const label of [...always, ...conditional]) expect(EVERY_SECTION).toContain(label);
  });

  it("still carries its price and its precondition", () => {
    expect(DESCRIPTION).toMatch(/costs 15 credits/i);
    expect(DESCRIPTION).toMatch(/run crawl_site first/i);
  });
});

describe("audit_tech — the generated docs page", () => {
  it("lists every section the formatter prints, and only those", () => {
    expect(new Set(docsBulletLabels())).toEqual(new Set(EVERY_SECTION));
  });

  it("names exactly the four sections that print at zero", () => {
    expect(new Set(docsGuaranteedLabels())).toEqual(new Set(ALWAYS_PRINTED));
  });

  it("does not contradict its own frontmatter description", () => {
    // The frontmatter is the tool description with the cost sentence stripped and truncated to
    // the meta-description budget (155 chars) — far inside the first clause, so whatever survives
    // is a literal prefix of the shipped description. A page rendered from a stale description
    // fails here, which is the "half a fix" case this spec exists for.
    const frontmatter = DOCS_PAGE.match(/^description:\s*"((?:[^"\\]|\\.)*)"/m)?.[1] ?? "";
    expect(frontmatter.length).toBeGreaterThan(0);
    expect(DESCRIPTION.startsWith(frontmatter.replace(/…$/u, ""))).toBe(true);
  });
});
