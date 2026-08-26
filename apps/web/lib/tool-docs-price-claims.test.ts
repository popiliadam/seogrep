import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DOC_PROSE } from "../scripts/gen-tool-docs.mjs";
import { TOOL_COSTS } from "../../mcp/src/credits/costs";
import {
  describeViolation,
  findPriceClaimViolations,
  markToolReferences,
  toClauses,
} from "./tool-docs-price-claims";

/**
 * THE TWO SENTENCES THIS GUARD EXISTS FOR — quoted verbatim from the commits that shipped them.
 *
 * They are pinned as fixtures rather than described, for the reason lesson 12 states: a guard is
 * evidence only where it has been MEASURED going red. Both of these were live, customer-facing and
 * false, and neither was caught by anything. If a future refactor of the binder stops reddening
 * them, these two specs are what says so.
 */
const DEFECT_1_SERP_SNAPSHOT =
  "This is the one part of the rank tracker that is gated. " +
  "[`track_keywords`](/docs/tools-reference/track-keywords) and " +
  "[`keyword_positions`](/docs/tools-reference/keyword-positions) are free and run on " +
  "any account, because neither contacts a search engine.";

// Hard-wrapped exactly as it stood in billing-and-credits.mdx — the wrap fell between "free" and
// the parenthetical that identifies the tools, which is why toClauses joins soft wraps.
const DEFECT_2_BILLING =
  "Trial credits run the crawler, the audits that read what the crawl already\n" +
  "stored (`audit_onpage`, `audit_tech`, `audit_schema`, `audit_content`),\n" +
  "reports, the quick-win finders, the Search Console tools, and the two free\n" +
  "halves of the rank tracker (`track_keywords` and `keyword_positions`).";

describe("the guard reddens on both measured defects", () => {
  it("catches the predicative form: '`a` and `b` are free' where b is priced", () => {
    const violations = findPriceClaimViolations(DEFECT_1_SERP_SNAPSHOT);
    expect(violations.map((v) => v.tool)).toContain("keyword_positions");
    expect(violations.find((v) => v.tool === "keyword_positions")?.cost).toBe(
      TOOL_COSTS.keyword_positions,
    );
  });

  it("catches the attributive form: 'the two free halves … (`a` and `b`)'", () => {
    const violations = findPriceClaimViolations(DEFECT_2_BILLING);
    expect(violations.map((v) => v.tool)).toContain("keyword_positions");
  });

  it("does not blame the tool that really is free", () => {
    // track_keywords is 0 credits and appears in BOTH defects. A guard that reported it too would
    // teach the reader that its findings need triage, which is how a finding list stops being read.
    for (const text of [DEFECT_1_SERP_SNAPSHOT, DEFECT_2_BILLING]) {
      expect(findPriceClaimViolations(text).map((v) => v.tool)).not.toContain("track_keywords");
    }
  });

  it("names the tool, its real price and the fix in the failure message", () => {
    const [violation] = findPriceClaimViolations(DEFECT_1_SERP_SNAPSHOT);
    expect(violation).toBeDefined();
    const message = describeViolation("serp_snapshot", violation!);
    expect(message).toContain("keyword_positions");
    expect(message).toContain(`${TOOL_COSTS.keyword_positions} credits`);
    expect(message).toMatch(/ungated is not the same as being free/i);
  });
});

/**
 * THE CLEAN SIDE — the shapes that must NEVER redden.
 *
 * This half matters more than the half above. A guard that catches both defects and also fires on
 * a true sentence gets deleted by the next person in a hurry, and then catches nothing at all. Each
 * case here is a real sentence from the live corpus, kept as a fixture so the binder cannot be
 * "improved" into a false-positive machine without turning something red first.
 */
describe("the guard stays silent on true claims", () => {
  it.each([
    // The page's own prerequisite refusal. Names a 20-credit tool beside "charges nothing", but the
    // claim's subject is "the tool" — the audit, not the crawl. Four pages say this.
    ["audit prerequisite refusal", "Run `crawl_site` first — with no crawl on record the tool says so and charges nothing."],
    ["two-prerequisite variant", "Run both `pull_gsc_data` and `crawl_site` first — with either one missing the tool says which to run and charges nothing."],
    // Genuinely free tools, called free.
    ["connect_gsc is 0 credits", "Old Search Console data but no live connection → `connect_gsc`, which is free."],
    ["track_keywords is 0 credits", "`track_keywords` records which keywords you want watched — that is free and takes no measurement."],
    // Availability, not price — the distinction defect #2 collapsed.
    ["covered by trial credits", "Trial credits run the crawler, the audits, reports and `keyword_positions`."],
    // The corrected sentence: two tools contrasted in one clause, one free and one not.
    ["contrast in one clause", "`track_keywords` is free; `keyword_positions` charges for the analysis but contacts no search engine."],
    ["corrected billing sentence", "…the two non-vendor halves of the rank tracker — `track_keywords`, which is free, and `keyword_positions`, which charges for the analysis but contacts no search engine."],
    // "included" in its innocent, non-price sense.
    ["subdomains are included", "Only **live** backlinks are counted, subdomains are **included**, and both settings are pinned explicitly."],
    // A free sub-step of a priced tool.
    ["free pre-discovery step", "Before queuing, `crawl_site` runs a quick, **free** size check."],
    // A refusal branch of a priced tool. "not charged" is deliberately outside the vocabulary.
    ["free refusal on a priced tool", "`research_keywords` is not available on trial credits; the refusal arrives before anything is reserved and says outright that you were not charged."],
  ])("stays green on: %s", (_label, text) => {
    expect(findPriceClaimViolations(text)).toEqual([]);
  });
});

describe("the parts the binder is built from", () => {
  it("marks a tool whether it is backticked, linked or bare", () => {
    expect(markToolReferences("`crawl_site`")).toBe("§crawl_site§");
    expect(markToolReferences("[`crawl_site`](/docs/tools-reference/crawl-site)")).toBe("§crawl_site§");
    expect(markToolReferences("run crawl_site first")).toBe("run §crawl_site§ first");
  });

  it("prefers the longest tool name, so one tool is never read as another plus noise", () => {
    expect(markToolReferences("`ai_visibility_compare`")).toBe("§ai_visibility_compare§");
  });

  it("joins a markdown soft wrap but breaks on a bullet", () => {
    expect(toClauses("the two free\nhalves of it")).toEqual(["the two free halves of it"]);
    expect(toClauses("- `a` is free\n- `b` costs money")).toEqual(["- `a` is free", "- `b` costs money"]);
  });

  it("does not fragment a sentence at a dot inside a hostname", () => {
    expect(toClauses("Crawl example.com now.")).toEqual(["Crawl example.com now."]);
  });
});

/**
 * THE LIVE CORPUS. Both halves of what a customer reads:
 *
 *   • every DOC_PROSE block (the generated tool pages' prose — checked at the SOURCE, so a
 *     violation is caught before regeneration and the message names the block to edit);
 *   • every hand-written docs page. `tools-reference/` is excluded because it is generated output
 *     byte-identical to DOC_PROSE (`gen-tool-docs.mjs --check` enforces that), so scanning it would
 *     report each violation twice and point at a file nobody may hand-edit.
 *
 * KNOWN LIMIT, stated rather than hidden: a tool's `description` reaches the page's frontmatter and
 * is NOT scanned here. Descriptions are code, changing them changes tool selection, and they carry
 * their own review — but a false free-claim written there would reach a page past this guard.
 */
/** Walk up from the runner's cwd to the workspace root, as node-floor.test.ts does. */
function findRepoRoot(): string {
  let directory = resolve(process.cwd());
  while (!existsSync(join(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error("workspace root not found above " + process.cwd());
    directory = parent;
  }
  return directory;
}

function handWrittenDocPages(): { path: string; text: string }[] {
  const root = join(findRepoRoot(), "apps/web/content/docs");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".mdx") && !entry.includes("tools-reference"))
    .map((entry) => ({ path: entry, text: readFileSync(join(root, entry), "utf8") }));
}

describe("no live docs page calls a priced tool free", () => {
  it.each(Object.entries(DOC_PROSE))("DOC_PROSE.%s", (tool, prose) => {
    const violations = findPriceClaimViolations(JSON.stringify(prose));
    expect(violations.map((v) => describeViolation(`DOC_PROSE.${tool}`, v)).join("\n")).toBe("");
  });

  const pages = handWrittenDocPages();

  it("finds the hand-written pages at all (a guard over an empty list is not a guard)", () => {
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.map((p) => p.path)).toContain("billing-and-credits.mdx");
  });

  it.each(pages.map((p) => [p.path, p.text]))("%s", (path, text) => {
    const violations = findPriceClaimViolations(text);
    expect(violations.map((v) => describeViolation(String(path), v)).join("\n")).toBe("");
  });
});
