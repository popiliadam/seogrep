import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DOC_PROSE,
  FRONTMATTER_DESCRIPTION_MAX,
  deriveSlug,
  frontmatterDescription,
  stripCostSentences,
  truncateAtWord,
} from "../scripts/gen-tool-docs.mjs";
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

  // The attributive binder's OTHER opening delimiter. Nothing pinned it before 2026-08-26: the
  // `—`/`–` half of its character class could be deleted outright and every spec in this file
  // stayed green — so the false-positive fix below could have been "fixed" by blinding the branch
  // instead of narrowing it, and no test would have said a word.
  // Each of the three opening characters gets its own case, on BOTH sides. A green-side case alone
  // pins nothing: removing a character from the class leaves every green case green, so `–` would
  // still have been deletable in silence with only the em dash covered here.
  it.each([
    ["em dash", "—"],
    ["en dash", "–"],
    ["bracket", "("],
  ])("catches the attributive form when a %s opens the list", (_label, open) => {
    const close = open === "(" ? ")" : "";
    const violations = findPriceClaimViolations(
      `…and the two free halves of the rank tracker ${open} \`track_keywords\` and \`keyword_positions\`${close}.`,
    );
    expect(violations.map((v) => v.tool)).toContain("keyword_positions");
  });

  /**
   * THE OTHER HALF OF THE BINDER — the shapes only `listIsClosed` catches, pinned after a mutation
   * measured 2026-08-26: with the enumeration test added and nothing here, `closed = false` left all
   * 133 specs green. The closure test had quietly become dead weight, and deleting it would have
   * dropped these three without a word — the same "one unpinned half" the em-dash class was in a
   * round earlier. A closed list needs neither two tools nor a head noun to be a list.
   */
  it.each([
    ["closed bracket, one tool", "…the free half of the rank tracker (`keyword_positions`)."],
    ["closed dash, one tool", "…the free half of the rank tracker — `keyword_positions`."],
    ["closed bracket, no head noun", "Both halves are free (`track_keywords` and `keyword_positions`)."],
  ])("binds a list that closes where it stops: %s", (_label, text) => {
    expect(findPriceClaimViolations(text).map((v) => v.tool)).toContain("keyword_positions");
  });

  /**
   * THE FIVE SHAPES A CLOSURE-ONLY FIX LOST, each measured by a judge on 2026-08-26 as
   * `base RED → GREEN` and each now bound again by the enumeration test. The first is measured
   * defect #2 with one relative clause added, which is the whole reason closure alone was not
   * enough: a guard that reddens a shipped sentence but not that sentence plus ", which both run on
   * any account" is a guard that a rewrite walks straight past.
   *
   * They are pinned by SHAPE, not by allowlist: the bracket variants differ from the dash variants
   * in the delimiter, the run's tail (relative clause / predicate / apposition / "plus …"), and the
   * head-noun length, so a binder that recovers only one of them turns the rest red.
   */
  it.each([
    ["bracket, tail is a relative clause", "…the two free halves of the rank tracker (`track_keywords` and `keyword_positions`, which both run on any account)."],
    ["bracket, tail is a predicate", "SeoGrep ships a free pair (`track_keywords` and `keyword_positions` are both ungated)."],
    ["bracket, tail is a dashed apposition", "…the two free halves of the rank tracker (`track_keywords` and `keyword_positions` — registration and read-back)."],
    ["em dash, tail adds a non-tool item", "…the free halves — `track_keywords` and `keyword_positions`, plus the panel."],
    ["em dash, tail is a relative clause", "…the two free halves of the rank tracker — `track_keywords` and `keyword_positions`, which both run on any account."],
  ])("binds an enumeration whose list runs on: %s", (_label, text) => {
    const violations = findPriceClaimViolations(text);
    expect(violations.map((v) => v.tool)).toContain("keyword_positions");
    // …and still not the tool that really is 0 credits.
    expect(violations.map((v) => v.tool)).not.toContain("track_keywords");
  });

  /**
   * THE BEARING VERBS — the escape a judge measured on 2026-08-26, when both of these passed.
   *
   * The claim used to start at "no", so the backward walk's first token was "carries" or "at",
   * neither of them BINDING_FILLER, and it stopped one word short of the tool. Nothing else in the
   * guard was wrong; the claim was simply cut too short to reach its own subject. Each shape is
   * pinned on BOTH sides — red on a priced tool, silent on the 0-credit one — because a pattern
   * widened until it fires on everything is not a stronger guard, and `track_keywords` sitting in
   * the same sentence is what says so.
   */
  it.each([
    ["carries no charge", "`keyword_positions` carries no charge."],
    ["carries no cost", "`keyword_positions` carries no cost."],
    ["comes at no charge", "The read-back `keyword_positions` comes at no charge."],
    ["comes at no cost", "The read-back `keyword_positions` comes at no cost."],
    ["carry, plural subject", "`track_keywords` and `keyword_positions` carry no charge."],
  ])("catches a claim reached through a bearing verb: %s", (_label, text) => {
    const violations = findPriceClaimViolations(text);
    expect(violations.map((v) => v.tool)).toContain("keyword_positions");
    expect(violations.map((v) => v.tool)).not.toContain("track_keywords");
  });

  /**
   * THE FORFEIT THE WIDENING DID NOT BUY BACK, kept visible on purpose. An ordinary adjective
   * between the tool and the claim still stops `bindBackward` dead — measured green 2026-08-26.
   * That is the conservative direction this file's header commits to, and pinning it here makes
   * the miss a documented choice rather than something the next reader discovers.
   */
  it("still forfeits a claim held off from its tool by an ordinary word", () => {
    expect(findPriceClaimViolations("`keyword_positions` is available at no cost.")).toEqual([]);
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
    // THE LATENT FALSE POSITIVE, measured 2026-08-26. A dash can introduce a contrast as easily as
    // an enumeration, and this sentence is TRUE — the free thing is the refusal, not the tool. The
    // guard reported `research_keywords` at 25 credits for it. No page is written this way today,
    // which is the only reason it never fired; a guard is not safe because nobody has yet phrased
    // a true sentence in the shape it punishes.
    ["em-dash contrast, not enumeration", "The refusal is free — `research_keywords` charges only when it delivers."],
    // The same shape with the other delimiter: a `(` that opens a predicate rather than a list.
    ["parenthetical that continues into prose", "The size check is free (`crawl_site` charges only once the crawl is queued)."],
    // …and with an en dash, the third character in the opening class.
    ["en-dash contrast", "The dry run is free – `serp_snapshot` bills per keyword once it searches."],
    // THE DELIBERATE FORFEIT, pinned so the trade-off is visible instead of discovered. A SINGLE
    // tool after an unclosed delimiter reads as a remark far more often than as a one-item list,
    // so the enumeration test requires two. Tightening this to one turns these two green cases red
    // — which is the point: the cost of catching them is named here, not hidden.
    ["one tool, unclosed dash, attributive claim", "The free tier — `research_keywords` is excluded from it."],
    ["one tool, unclosed bracket, attributive claim", "The free tier (`research_keywords` is excluded) covers everything else."],
    // The OTHER half of the enumeration test: two tools, but the claim is the sentence's own
    // predicate, so there is no head noun for the list to identify. Without this case the head-noun
    // condition could be deleted and nothing here would notice.
    ["two tools, unclosed, predicative claim", "The trial is free — `track_keywords` and `keyword_positions` are metered separately."],
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
 * THE LIVE CORPUS. Every half of what a customer reads:
 *
 *   • every DOC_PROSE block (the generated tool pages' prose — checked at the SOURCE, so a
 *     violation is caught before regeneration and the message names the block to edit);
 *   • every hand-written docs page. `tools-reference/` is excluded because it is generated output
 *     byte-identical to DOC_PROSE (`gen-tool-docs.mjs --check` enforces that), so scanning it would
 *     report each violation twice and point at a file nobody may hand-edit;
 *   • every tool `description` — added 2026-08-26, see the last describe in this file. It was the
 *     surface this guard could not see, and it had two false claims in it this round.
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

/**
 * THE THIRD SURFACE — tool descriptions, which this guard did not look at until 2026-08-26.
 *
 * A description is not just code. It is rendered into the page's frontmatter `description` (the
 * `<meta>` tag and the search-result snippet, via `renderToolPage`), and it is the text an assistant
 * reads when it decides which tool to call. Both defects this guard was built for were qualitative
 * price claims in PROSE; the same sentence written one file over, in a description, reached a
 * customer-facing page and passed everything — the docs pipeline's two price defences both operate
 * on NUMBERS, and `stripCostSentences` removes "Costs 10 credits." while leaving "is free"
 * untouched. Two false claims were in fact living here this round and were corrected by hand.
 *
 * WHY THE FULL DESCRIPTION AND NOT THE RENDERED FRONTMATTER. The frontmatter is truncated to
 * FRONTMATTER_DESCRIPTION_MAX, and 30-odd of these descriptions are several times that long — a
 * scan of the rendered pages would read the first sentence of each and report a clean bill of
 * health for the other 80%. Reading the registry covers the whole text and both surfaces it feeds.
 *
 * WHY `dist`, WHEN THE HEADER OF THE GUARD ITSELF PREFERS SOURCE. It was tried from source first
 * and MEASURED: `import { ALL_TOOLS } from "../../mcp/src/tools/index"` type-checks, lints and runs
 * green under vitest, and then reddens `next build`, because it drags MCP's `.ts`-suffixed imports
 * into the web app's TypeScript program. Only the build says so — exactly the failure mode signed
 * lesson 15 names. So the registry is loaded the way the `--check` CLI loads it, through a computed
 * URL that the web build's type graph does not follow. The cost of that choice is a `dist` that
 * could lag `src`, and the test below is what makes the lag visible instead of green.
 */
const ALL_TOOLS = await loadBuiltRegistry();

async function loadBuiltRegistry(): Promise<readonly { name: string; description: string }[]> {
  const url = pathToFileURL(join(findRepoRoot(), "apps/mcp/dist/tools/index.js")).href;
  const registry = (await import(/* @vite-ignore */ url)) as {
    ALL_TOOLS: readonly { name: string; description: string }[];
  };
  return registry.ALL_TOOLS;
}

describe("no tool description calls a priced tool free", () => {
  it("sees the whole registry (a guard over an empty list is not a guard)", () => {
    expect(ALL_TOOLS.length).toBe(Object.keys(DOC_PROSE).length);
    expect(ALL_TOOLS.map((tool) => tool.name)).toContain("keyword_positions");
  });

  it("reads the full description, not the truncated frontmatter it is rendered into", () => {
    // If this lane is ever re-pointed at the generated pages, most of the text it claims to cover
    // silently disappears. This is what says so.
    const longer = ALL_TOOLS.filter((tool) => tool.description.length > FRONTMATTER_DESCRIPTION_MAX);
    expect(longer.length).toBeGreaterThan(20);
  });

  it("reads the descriptions that actually shipped — a stale `dist` reddens here", () => {
    // Every committed page's frontmatter description was rendered from a description by exactly
    // this pipeline. If the built registry no longer produces it, the text scanned above is not the
    // text a customer reads, and this lane's green would be about a build from yesterday.
    const pages = join(findRepoRoot(), "apps/web/content/docs/tools-reference");
    const drifted = ALL_TOOLS.filter((tool) => {
      const page = readFileSync(join(pages, `${deriveSlug(tool.name)}.mdx`), "utf8");
      const rendered = truncateAtWord(
        stripCostSentences(tool.description),
        FRONTMATTER_DESCRIPTION_MAX,
      );
      return frontmatterDescription(page) !== rendered;
    });
    expect(drifted.map((tool) => tool.name)).toEqual([]);
  });

  it.each(ALL_TOOLS.map((tool) => [tool.name, tool.description]))("%s", (name, description) => {
    const violations = findPriceClaimViolations(description);
    expect(violations.map((v) => describeViolation(`${name}.description`, v)).join("\n")).toBe("");
  });
});
