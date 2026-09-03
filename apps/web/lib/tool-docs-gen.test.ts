import { describe, expect, it } from "vitest";

// The generator lives as a standalone Node script (run with `node`); its pure functions are
// exported so this unit test can pin the template render + the --check sync logic without the
// built MCP registry (the CLI loads that lazily, so importing the module here is side-effect free).
import {
  DOC_PROSE,
  FRONTMATTER_DESCRIPTION_MAX,
  checkToolsMetaSync,
  dayPhrase,
  deriveSlug,
  domainAddressableTools,
  findConfirmFields,
  frontmatterDescription,
  groupThousands,
  mdxEscapeInline,
  renderCostLine,
  renderFieldType,
  renderIndexCost,
  renderIndexPage,
  renderInputTable,
  renderToolPage,
  stripCostSentences,
  substituteProseTokens,
  truncateAtWord,
} from "../scripts/gen-tool-docs.mjs";

// The PRICE TABLE itself, imported the same way apps/web's pricing spec imports it. This file is the
// only place the renderer and the table meet, which is what makes the guarantee below measurable:
// what a docs page SAYS one call costs, checked against what `creditsForUnits` really charges for it.
import {
  CREDIT_UNITS,
  TOOL_COSTS,
  creditsForUnits,
  type PerUnitPriceRule,
} from "../../mcp/src/credits/costs";

describe("deriveSlug", () => {
  it("turns a snake_case tool name into a hyphenated page slug", () => {
    expect(deriveSlug("setup_project")).toBe("setup-project");
    expect(deriveSlug("whats_next")).toBe("whats-next");
    expect(deriveSlug("analyze_content_decay")).toBe("analyze-content-decay");
  });
});

describe("stripCostSentences", () => {
  it("removes a trailing 'Costs N credits' sentence (with any charge clause)", () => {
    expect(
      stripCostSentences(
        "Crawl a project's website (async). Returns a job_id immediately. Costs 20 credits, charged when the crawl runs.",
      ),
    ).toBe("Crawl a project's website (async). Returns a job_id immediately.");
  });

  it("removes a mid-string cost sentence and keeps the following sentence", () => {
    expect(
      stripCostSentences("Find quick wins, prioritized. Costs 10 credits. Run pull_gsc_data first."),
    ).toBe("Find quick wins, prioritized. Run pull_gsc_data first.");
  });

  it("removes a 'Free (0 credits)' sentence", () => {
    expect(stripCostSentences("Route to the next step. Free (0 credits). Optionally pass a project_id.")).toBe(
      "Route to the next step. Optionally pass a project_id.",
    );
  });

  it("leaves a description with no cost sentence untouched", () => {
    expect(stripCostSentences("List the website domains you are tracking (oldest first).")).toBe(
      "List the website domains you are tracking (oldest first).",
    );
  });
});

describe("truncateAtWord", () => {
  it("leaves a string within the limit unchanged", () => {
    const short = "Register a website domain to track.";
    expect(truncateAtWord(short, 155)).toBe(short);
  });

  it("leaves a string exactly at the limit unchanged", () => {
    const exact = "x".repeat(155);
    expect(truncateAtWord(exact, 155)).toBe(exact);
    expect(truncateAtWord(exact, 155).length).toBe(155);
  });

  it("truncates a long string to the limit at a word boundary with an ellipsis", () => {
    const long =
      "Find quick-win keyword opportunities from your latest Search Console pull: queries ranking in " +
      "positions 8 to 20 with enough impressions to be worth a push, prioritized. Run pull_gsc_data first.";
    const result = truncateAtWord(long, 155);
    expect(result.length).toBeLessThanOrEqual(155);
    expect(result.endsWith("…")).toBe(true);
    // Cut at a word boundary: the text before the ellipsis is a prefix of the original, whole-word.
    const body = result.slice(0, -1);
    expect(long.startsWith(body)).toBe(true);
    expect(long[body.length]).toBe(" "); // the next original char is a space → no split word
  });

  it("hard-cuts a single over-long word (no space to break on) and still fits", () => {
    const oneWord = "a".repeat(300);
    const result = truncateAtWord(oneWord, 155);
    expect(result.length).toBeLessThanOrEqual(155);
    expect(result.endsWith("…")).toBe(true);
  });

  it("drops a dangling separator before the ellipsis", () => {
    // Force the boundary to land right after an em dash.
    const text = `${"word ".repeat(30)}— tail that overflows the budget by a wide margin here now`;
    const result = truncateAtWord(text, 155);
    expect(result.endsWith("—…")).toBe(false);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("frontmatterDescription", () => {
  it("extracts and decodes the description scalar from a rendered page", () => {
    const page = renderToolPage(
      { name: "demo_tool", description: 'He said "hi". Costs 3 credits.', inputJsonSchema: { properties: {} } },
      3,
      { whatItDoes: "It does.", example: "> Do it.", returns: "A result." },
    );
    expect(frontmatterDescription(page)).toBe('He said "hi".');
  });

  it("returns empty string when there is no description", () => {
    expect(frontmatterDescription("---\ntitle: x\n---\n\nbody\n")).toBe("");
  });

  it("flags a hand-built page whose description exceeds the budget (the --check invariant)", () => {
    const tooLong = "y".repeat(200);
    const page = `---\ntitle: t\ndescription: "${tooLong}"\n---\n\nbody\n`;
    expect(frontmatterDescription(page).length).toBe(200);
    expect(frontmatterDescription(page).length).toBeGreaterThan(FRONTMATTER_DESCRIPTION_MAX);
  });

  it("keeps every rendered tool page within the budget after truncation", () => {
    const raw =
      "Not sure what to do next? whats_next looks at where your project stands — crawl, audits, Search " +
      "Console, reports — and tells you the single best next step, with a short reason and what comes after.";
    const page = renderToolPage(
      { name: "whats_next", description: raw, inputJsonSchema: { properties: {} } },
      0,
      { whatItDoes: "It routes.", example: "> Next?", returns: "A step." },
    );
    expect(frontmatterDescription(page).length).toBeLessThanOrEqual(FRONTMATTER_DESCRIPTION_MAX);
  });
});

describe("renderCostLine", () => {
  it("renders zero cost as free", () => {
    expect(renderCostLine(0)).toBe("**Cost:** Free (0 credits).");
  });
  it("renders a singular credit", () => {
    expect(renderCostLine(1)).toBe("**Cost:** 1 credit.");
  });
  it("renders a plural credit cost", () => {
    expect(renderCostLine(20)).toBe("**Cost:** 20 credits.");
  });

  /**
   * THE PER-UNIT LINE. `ai_visibility_compare` is priced per COMPARED TARGET, so no call of it
   * ever costs the bare number in TOOL_COSTS: two targets cost 180 and ten cost 900. A page that
   * printed "90 credits" would state a price nobody is charged, so the line renders the unit AND
   * the range — and the range is computed from the rule, never typed into prose.
   */
  it("renders a per-unit cost with the range one call can really cost", () => {
    expect(renderCostLine(90, { unit: "compared target", min_units: 2, max_units: 10 })).toBe(
      "**Cost:** 90 credits per compared target — 2 to 10 compared targets per call, so 180 to 900 credits.",
    );
  });

  it("leaves the flat line untouched when no unit rule is given", () => {
    expect(renderCostLine(90, undefined)).toBe("**Cost:** 90 credits.");
  });

  /**
   * THE BASE TERM. `serp_snapshot` is signed at 5 credits + 8 per keyword over 1-10 keywords
   * (signature package 2026-08-17, MADDE 1 row #4). Before this branch existed the renderer knew
   * nothing about `base` and this exact rule MEASURABLY produced
   *   "**Cost:** 8 credits per keyword — 1 to 10 keywords per call, so 8 to 80 credits."
   * — understating the signed price by the whole base at every count, on the tool's own docs page.
   *
   * Asserted as a WHOLE STRING with LITERAL 13 and 85, never as `base + cost * n`: a formula
   * restating the renderer stays green when the renderer stops adding the base, which is the exact
   * regression this spec exists for.
   */
  it("renders a rule that carries a BASE: the fixed part, the unit part, and the true range", () => {
    expect(renderCostLine(8, { unit: "keyword", base: 5, min_units: 1, max_units: 10 })).toBe(
      "**Cost:** 5 credits per call plus 8 credits per keyword — 1 to 10 keywords per call, " +
        "so 13 to 85 credits.",
    );
  });

  /**
   * The base is charged ONCE per call, not once per unit — the distinction the field exists for.
   * Folding it into the unit price (13 per keyword) would publish 130 at the cap instead of 85.
   */
  it("adds the base ONCE, never once per unit", () => {
    const line = renderCostLine(8, { unit: "keyword", base: 5, min_units: 1, max_units: 10 });
    expect(line).toContain("13 to 85 credits");
    expect(line).not.toContain("130");
  });

  /** An ABSENT base and an explicit 0 are the same price, and must render indistinguishably. */
  it("treats an absent base as 0 — the baseless line is byte-identical either way", () => {
    const absent = renderCostLine(90, { unit: "compared target", min_units: 2, max_units: 10 });
    const zero = renderCostLine(90, { unit: "compared target", base: 0, min_units: 2, max_units: 10 });
    expect(zero).toBe(absent);
    // …and that line is the one this page has always carried, word for word.
    expect(absent).toBe(
      "**Cost:** 90 credits per compared target — 2 to 10 compared targets per call, so 180 to 900 credits.",
    );
    expect(absent).not.toContain("per call plus");
  });
});

/**
 * THE GUARANTEE: a per-unit tool cannot publish a price it does not charge.
 *
 * This REPLACES a narrower gate that lived in apps/mcp/src/credits/costs.test.ts, which asserted that
 * NO rule in CREDIT_UNITS carries a `base` at all, with a failure message telling the next author to
 * teach `renderCostLine` about bases before shipping one. That gate bought its guarantee by
 * forbidding the feature, and it could only ever fire on the base axis: a renderer that mis-rendered
 * a BASELESS rule satisfied it completely.
 *
 * What is asserted instead is the thing that gate was protecting, one level up and for every rule the
 * table will ever hold: the credits a page STATES for the cheapest and dearest call it describes are
 * the credits `creditsForUnits` really charges for those calls. The numbers are read back OUT of the
 * rendered line rather than recomputed alongside it, so a renderer that drops a term, folds the base
 * into the unit price, or stops printing the range at all goes red here — with or without a base.
 */
describe("every priced rule renders the price it is really charged (NEVER #6)", () => {
  const RANGE = /so (\d+) to (\d+) credits\.$/;

  it("states, for each CREDIT_UNITS rule, the true cost of a floor call and a ceiling call", () => {
    const rules = Object.entries(CREDIT_UNITS) as [keyof typeof TOOL_COSTS, PerUnitPriceRule][];
    expect(rules.length).toBeGreaterThan(0); // an empty table must not vacuously pass this

    for (const [tool, rule] of rules) {
      const unitCredits = TOOL_COSTS[tool];
      const line = renderCostLine(unitCredits, rule);

      const match = line.match(RANGE);
      expect(match, `${tool}: the cost line states no credit range at all: ${line}`).not.toBeNull();
      const [statedFloor, statedCeiling] = [Number(match![1]), Number(match![2])];

      expect(statedFloor, `${tool}: docs page understates/overstates its cheapest call`).toBe(
        creditsForUnits(tool, rule, unitCredits, rule.min_units),
      );
      expect(statedCeiling, `${tool}: docs page understates/overstates its dearest call`).toBe(
        creditsForUnits(tool, rule, unitCredits, rule.max_units),
      );

      // The fixed part must be VISIBLE, not merely folded into the totals: a reader pricing a count
      // between the bounds has only the line's own words to work from.
      if ((rule.base ?? 0) > 0) {
        expect(line, `${tool}: carries a base the line never names`).toContain(
          `${rule.base} credits per call plus `,
        );
      }
    }
  });
});

describe("mdxEscapeInline", () => {
  it("escapes angle brackets so MDX does not parse them as JSX", () => {
    expect(mdxEscapeInline("Defaults to 'SEO Report — <domain> — <date>'.")).toBe(
      "Defaults to 'SEO Report — &lt;domain&gt; — &lt;date&gt;'.",
    );
  });
  it("escapes a pipe so it does not break a table cell", () => {
    expect(mdxEscapeInline("a | b")).toBe("a \\| b");
  });
});

describe("renderFieldType", () => {
  it("labels a uuid string", () => {
    expect(renderFieldType({ type: "string", format: "uuid" })).toBe("string (uuid)");
  });
  it("labels a plain string and an integer", () => {
    expect(renderFieldType({ type: "string" })).toBe("string");
    expect(renderFieldType({ type: "integer" })).toBe("integer");
  });
  it("labels an array by its item type", () => {
    expect(renderFieldType({ type: "array", items: { type: "string" } })).toBe("string[]");
  });
});

describe("renderInputTable", () => {
  it("returns 'No parameters.' when the schema has no properties", () => {
    expect(renderInputTable({ type: "object", properties: {} })).toBe("No parameters.");
  });

  it("renders a required/optional table with mdx-escaped descriptions", () => {
    const table = renderInputTable({
      type: "object",
      properties: {
        project_id: { type: "string", format: "uuid", description: "The project id." },
        max_urls: { type: "integer", default: 100, description: "Max pages (default 100)." },
        title: { type: "string", description: "Defaults to '<domain>'." },
      },
      required: ["project_id"],
    });
    expect(table).toBe(
      [
        "| Field | Type | Required | Description |",
        "| --- | --- | --- | --- |",
        "| `project_id` | string (uuid) | Yes | The project id. |",
        "| `max_urls` | integer | No | Max pages (default 100). |",
        "| `title` | string | No | Defaults to '&lt;domain&gt;'. |",
      ].join("\n"),
    );
  });
});

describe("renderToolPage", () => {
  it("renders the canonical page: derived frontmatter, cost line, and Input from the schema", () => {
    const page = renderToolPage(
      {
        name: "demo_tool",
        description: "Does a thing. Costs 3 credits.",
        inputJsonSchema: { type: "object", properties: {} },
      },
      3,
      {
        lead: "Lead line.",
        whatItDoes: "It does.",
        example: "> Do it.",
        returns: "A result.",
      },
    );
    expect(page).toBe(
      `---
title: demo_tool
description: "Does a thing."
---

**Cost:** 3 credits.

Lead line.

## What it does

It does.

## Example

> Do it.

### Input

No parameters.

### Returns

A result.
`,
    );
  });

  it("includes pre-example and post-returns sections and a derived input table", () => {
    const page = renderToolPage(
      {
        name: "demo_tool",
        description: "Route to the next step. Free (0 credits).",
        inputJsonSchema: {
          type: "object",
          properties: { project_id: { type: "string", format: "uuid", description: "The id." } },
          required: ["project_id"],
        },
      },
      0,
      {
        whatItDoes: "Body.",
        preExampleSections: [{ heading: "How it stays safe", body: "Read-only." }],
        example: "> Go.",
        returns: "Done.",
        postReturnsSections: [{ heading: "Limitations (v0)", body: "Small." }],
      },
    );
    expect(page).toContain("## How it stays safe\n\nRead-only.");
    expect(page).toContain("### Limitations (v0)\n\nSmall.");
    expect(page).toContain("| `project_id` | string (uuid) | Yes | The id. |");
    expect(page).toContain("**Cost:** Free (0 credits).");
    // No hand-written credit number leaks in from the description (cost sentence stripped).
    expect(page).toContain('description: "Route to the next step."');
  });
});

describe("checkToolsMetaSync", () => {
  const names = ["setup_project", "connect_gsc", "list_projects"];

  it("passes when meta pages match the tool order exactly", () => {
    const result = checkToolsMetaSync(names, ["setup-project", "connect-gsc", "list-projects"]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when order differs", () => {
    const result = checkToolsMetaSync(names, ["connect-gsc", "setup-project", "list-projects"]);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("fails when a page is missing", () => {
    const result = checkToolsMetaSync(names, ["setup-project", "connect-gsc"]);
    expect(result.ok).toBe(false);
  });
});

describe("findConfirmFields", () => {
  it("returns nothing when no tool declares a confirm field", () => {
    const tools = [
      { name: "a", inputJsonSchema: { properties: { project_id: {} } } },
      { name: "b", inputJsonSchema: { properties: {} } },
    ];
    expect(findConfirmFields(tools)).toEqual([]);
  });

  it("flags a tool whose input schema declares a reserved confirm field", () => {
    const tools = [
      { name: "a", inputJsonSchema: { properties: { project_id: {} } } },
      { name: "bad", inputJsonSchema: { properties: { confirm: { type: "boolean" } } } },
    ];
    expect(findConfirmFields(tools)).toEqual(["bad"]);
  });

  /**
   * The gate's intent is that `confirm` stays the REGISTRY's parameter and never becomes a TOOL's
   * — it must not appear in anyone's zod schema. Since 2026-09-02 the registry INJECTS it into
   * the advertised JSON Schema of a tool the D17 gate can fire for, which the JSON Schema alone
   * cannot tell apart from a tool that declared it. `confirmable` — derived in the registry from
   * the signed price table — is what separates them, so the gate reads that rather than widening
   * to "confirm is fine now".
   */
  it("does NOT flag the registry-injected confirm on a confirmable tool", () => {
    const tools = [
      { name: "ok", confirmable: true, inputJsonSchema: { properties: { confirm: { type: "boolean" } } } },
    ];
    expect(findConfirmFields(tools)).toEqual([]);
  });

  it("still flags confirm on a tool the D17 gate can never fire for", () => {
    const tools = [
      { name: "bad", confirmable: false, inputJsonSchema: { properties: { confirm: { type: "boolean" } } } },
    ];
    expect(findConfirmFields(tools)).toEqual(["bad"]);
  });
});

describe("groupThousands", () => {
  it("thousands-separates the way the tool output's caveat does", () => {
    expect(groupThousands(15000)).toBe("15,000");
    expect(groupThousands(999)).toBe("999");
    expect(groupThousands(1234567)).toBe("1,234,567");
  });
});

describe("substituteProseTokens", () => {
  it("renders {{MAX_GSC_ROWS}} from the constant, not from a hand-typed number", () => {
    // The point of the token: change the constant and the sentence follows. A docs page that keeps
    // saying 15,000 after MAX_ROW_LIMIT moved tells the reader how much data they are missing, and
    // they have no way to check it.
    expect(substituteProseTokens("at most {{MAX_GSC_ROWS}} rows", { maxRowLimit: 15000, lagDays: 3 })).toBe(
      "at most 15,000 rows",
    );
    expect(substituteProseTokens("at most {{MAX_GSC_ROWS}} rows", { maxRowLimit: 25000, lagDays: 3 })).toBe(
      "at most 25,000 rows",
    );
  });

  it("substitutes every occurrence", () => {
    expect(substituteProseTokens("{{MAX_GSC_ROWS}} and {{MAX_GSC_ROWS}}", { maxRowLimit: 15000, lagDays: 3 })).toBe(
      "15,000 and 15,000",
    );
  });

  it("leaves token-free prose untouched", () => {
    expect(substituteProseTokens("nothing to substitute here.", {})).toBe("nothing to substitute here.");
  });

  it("throws instead of rendering a page that states a missing or bogus limit", () => {
    expect(() => substituteProseTokens("{{MAX_GSC_ROWS}}", {})).toThrow(/MAX_GSC_ROWS/);
    expect(() => substituteProseTokens("{{MAX_GSC_ROWS}}", { maxRowLimit: undefined })).toThrow();
    expect(() => substituteProseTokens("{{MAX_GSC_ROWS}}", { maxRowLimit: 0 })).toThrow();
    expect(() => substituteProseTokens("{{MAX_GSC_ROWS}}", { maxRowLimit: "15000" })).toThrow();
  });

  it("throws on a token nobody substitutes, rather than shipping it to the reader", () => {
    expect(() => substituteProseTokens("cap is {{MAX_CRAWL_PAGES}}", { maxRowLimit: 15000, lagDays: 3 })).toThrow(
      /MAX_CRAWL_PAGES/,
    );
  });
});

describe("dayPhrase", () => {
  it("renders a phrase, so a lag of 1 never prints as '1 days'", () => {
    expect(dayPhrase(3)).toBe("3 days");
    expect(dayPhrase(1)).toBe("1 day");
    expect(dayPhrase(7)).toBe("7 days");
  });
});

describe("substituteProseTokens — {{GSC_LAG_DAYS}}", () => {
  it("renders the freshness offset from the constant, not from a hand-typed number", () => {
    // Same reason as the row cap: the offset is what the reader is told they cannot see yet, and
    // GSC_FRESHNESS_LAG_DAYS moving without the sentence moving is a silently wrong doc.
    expect(substituteProseTokens("windows end {{GSC_LAG_DAYS}} before today", { lagDays: 3 })).toBe(
      "windows end 3 days before today",
    );
    expect(substituteProseTokens("windows end {{GSC_LAG_DAYS}} before today", { lagDays: 7 })).toBe(
      "windows end 7 days before today",
    );
  });

  it("substitutes every occurrence (the pull page states the offset three times)", () => {
    expect(
      substituteProseTokens("{{GSC_LAG_DAYS}} / {{GSC_LAG_DAYS}} / {{GSC_LAG_DAYS}}", { lagDays: 3 }),
    ).toBe("3 days / 3 days / 3 days");
  });

  it("substitutes both tokens in one pass", () => {
    expect(
      substituteProseTokens("{{MAX_GSC_ROWS}} rows, ending {{GSC_LAG_DAYS}} back", {
        maxRowLimit: 15000,
        lagDays: 3,
      }),
    ).toBe("15,000 rows, ending 3 days back");
  });

  it("throws instead of rendering a page that states a missing or bogus offset", () => {
    expect(() => substituteProseTokens("{{GSC_LAG_DAYS}}", {})).toThrow(/GSC_LAG_DAYS/);
    expect(() => substituteProseTokens("{{GSC_LAG_DAYS}}", { lagDays: 0 })).toThrow();
    expect(() => substituteProseTokens("{{GSC_LAG_DAYS}}", { lagDays: 2.5 })).toThrow();
    expect(() => substituteProseTokens("{{GSC_LAG_DAYS}}", { lagDays: "3" })).toThrow();
  });
});

describe("substituteProseTokens — {{CRAWL_TIME_BUDGET}}", () => {
  /**
   * The crawl's WALL-CLOCK ceiling. MEASURED LIVE 2026-09-02: a whole-site crawl returned 51 of a
   * possible 100 pages because the time budget ran out first, while the page cap was the only
   * bound the docs named. A page that retyped the seconds could go on promising a bound the
   * crawler no longer enforces, so it comes from the crawler's own constant.
   */
  it("renders the wall-clock budget from the constant, not from a hand-typed number", () => {
    expect(
      substituteProseTokens("stops after {{CRAWL_TIME_BUDGET}} seconds", {
        crawlTimeBudgetSeconds: 90,
      }),
    ).toBe("stops after 90 seconds");
    expect(
      substituteProseTokens("stops after {{CRAWL_TIME_BUDGET}} seconds", {
        crawlTimeBudgetSeconds: 120,
      }),
    ).toBe("stops after 120 seconds");
  });

  it("throws instead of rendering a page that states a missing or bogus budget", () => {
    expect(() => substituteProseTokens("{{CRAWL_TIME_BUDGET}}", {})).toThrow(/CRAWL_TIME_BUDGET/);
    expect(() =>
      substituteProseTokens("{{CRAWL_TIME_BUDGET}}", { crawlTimeBudgetSeconds: 0 }),
    ).toThrow();
    expect(() =>
      substituteProseTokens("{{CRAWL_TIME_BUDGET}}", { crawlTimeBudgetSeconds: 90.5 }),
    ).toThrow();
    expect(() =>
      substituteProseTokens("{{CRAWL_TIME_BUDGET}}", { crawlTimeBudgetSeconds: "90" }),
    ).toThrow();
  });
});

describe("substituteProseTokens — the leftover-token guard", () => {
  const constants = { maxRowLimit: 15000, lagDays: 3 };

  // A typo does not respect the SCREAMING_CASE convention — that is what makes it a typo. The
  // guard's earlier `[A-Z0-9_]+` shape let each of these render onto a published page verbatim,
  // i.e. it was green in exactly the cases it exists to catch. One case per near-miss axis:
  // lowercase, inner padding, mixed case, and a hyphen instead of an underscore.
  it.each([
    ["lowercase", "cap is {{max_rows}}"],
    ["padded with spaces", "cap is {{ MAX_GSC_ROWS }}"],
    ["mixed case", "cap is {{Max_Rows}}"],
    ["hyphenated", "cap is {{MAX-ROWS}}"],
  ])("throws on a %s near-miss instead of printing it to the reader", (_label, text) => {
    expect(() => substituteProseTokens(text, constants)).toThrow(/Unknown prose token/);
  });

  it("names the offending token in the error, so the fix is obvious", () => {
    expect(() => substituteProseTokens("cap is {{ MAX_GSC_ROWS }}", constants)).toThrow(
      /\{\{ MAX_GSC_ROWS \}\}/,
    );
  });

  it("still lets a fully substituted page through", () => {
    expect(substituteProseTokens("{{MAX_GSC_ROWS}} rows, {{GSC_LAG_DAYS}} back", constants)).toBe(
      "15,000 rows, 3 days back",
    );
  });
});

/**
 * NEVER #7, ON THE ONE SURFACE THAT REACHES A CUSTOMER.
 *
 * disavow_candidates' Billing section shipped the sentence "three requests per call, the most of
 * any SeoGrep tool". It is FALSE: audit_speed fans out one Lighthouse request per URL, up to
 * MAX_SPEED_URLS (five) per call, so the claim is wrong on any audit_speed call with four or more
 * URLs. It reached a published page because nothing here could check it — DOC_PROSE is prose, and
 * neither the tool registry nor TOOL_COSTS carries a per-call vendor-request count for anything to
 * check a ranking AGAINST. A superlative nothing can verify is not a claim, it is a guess with
 * confident punctuation, and the lineage is documented: the same wording sat in two paid-balance.ts
 * comments first (one of them false from the day it was written) before it was copied outward.
 *
 * So the SHAPE is forbidden rather than corrected. If a future page really needs to rank tools by
 * vendor round trips, the number has to exist in the registry first; then the assertion can be
 * derived rather than typed, and this spec can be replaced by one that checks it.
 */
describe("DOC_PROSE ranks nothing it has no number for (NEVER #7)", () => {
  const UNCHECKABLE = [
    /the most of any/i,
    /more than any other/i,
    /(?:the )?heaviest\b/i,
    /(?:the )?most (?:requests|round.?trips|calls)/i,
    /(?:the )?(?:largest|biggest|highest) number of (?:requests|round.?trips|calls)/i,
    /than any other (?:tool|seogrep)/i,
  ];

  it.each(Object.entries(DOC_PROSE))("%s claims no vendor-request superlative", (tool, prose) => {
    const text = JSON.stringify(prose);
    for (const pattern of UNCHECKABLE) {
      expect(text, `${tool}: uncheckable superlative matching ${pattern}`).not.toMatch(pattern);
    }
  });
});


/**
 * G1 — the docs claim about which tools take a bare domain is DERIVED from the registry, because
 * a hand-typed list is a second home for the answer and goes stale the first time a tool gains or
 * loses `target`. That is how a customer comes to believe a uuid is required for a call that
 * never wanted one.
 */
describe("the domain-addressable tool list", () => {
  const tool = (name: string, props: Record<string, unknown>) => ({
    name,
    inputJsonSchema: { properties: props },
  });

  it("names exactly the tools that declare a target parameter", () => {
    const rendered = domainAddressableTools([
      tool("ranked_keywords", { target: { type: "string" }, project_id: { type: "string" } }),
      tool("crawl_site", { project_id: { type: "string" } }),
      tool("my_pages", { target: { type: "string" } }),
    ]);
    expect(rendered).toContain("ranked_keywords");
    expect(rendered).toContain("my_pages");
    expect(rendered).not.toContain("crawl_site");
  });

  it("renders each as a link to its own page", () => {
    expect(domainAddressableTools([tool("keyword_gap", { target: {} })])).toBe(
      "[`keyword_gap`](/docs/tools-reference/keyword-gap)",
    );
  });

  /**
   * FAIL-CLOSED, like every other prose token here. If `target` were renamed, an empty list would
   * otherwise render a sentence that promises tools it cannot name.
   */
  it("throws rather than promising a list it cannot produce", () => {
    expect(() => domainAddressableTools([tool("crawl_site", { project_id: {} })])).toThrow(
      /target/i,
    );
    expect(() => domainAddressableTools([])).toThrow();
  });

  it("refuses to substitute the token without the derived list", () => {
    expect(() => substituteProseTokens("x {{DOMAIN_TOOLS}} y", {})).toThrow(/DOMAIN_TOOLS/);
    expect(substituteProseTokens("x {{DOMAIN_TOOLS}} y", { domainTools: "A, B" })).toBe("x A, B y");
  });
});

// ---------------------------------------------------------------------------
// The section hub (M-07). /docs/tools-reference was a 404 while billing-and-credits.mdx linked at
// it calling it "the list to trust" for paid-balance rules. These pin the two properties that make
// the hub trustworthy rather than merely present: every number is DERIVED, and the paid-balance
// column is the RUNTIME predicate rather than a copy of it.
// ---------------------------------------------------------------------------

// ORDER IS PART OF THE FIXTURE. The free tools are deliberately NOT a prefix of the list: with a
// free tool first, `free = rows.slice(0, 1)` renders the identical page and the split test stays
// green against a generator that no longer looks at the cost at all (MEASURED — that exact mutation
// passed before this fixture was reordered). Interleaving is what makes the assertion discriminate.
const HUB_TOOLS = [
  { name: "crawl_site", description: "Crawl a site. Costs 20 credits." },
  { name: "list_projects", description: "List your projects. Free (0 credits)." },
  { name: "serp_snapshot", description: "Take a SERP snapshot. Costs 5 credits plus 8 per keyword." },
  { name: "get_credit_balance", description: "Show your balance. Free (0 credits)." },
];
const HUB_COSTS = { crawl_site: 20, list_projects: 0, serp_snapshot: 8, get_credit_balance: 0 };
const HUB_UNITS = { serp_snapshot: { unit: "keyword", min_units: 1, max_units: 10, base: 5 } };
// Annotated rather than inferred: TypeScript narrows the default to a `name is "serp_snapshot"`
// type predicate, which then rejects the `() => false` the paid-balance test needs.
const hubPage = (needsPaid: (name: string) => boolean = (name) => name === "serp_snapshot") =>
  renderIndexPage(HUB_TOOLS, HUB_COSTS, HUB_UNITS, needsPaid);

describe("renderIndexCost", () => {
  it("labels a zero cost Free and a flat cost in credits", () => {
    expect(renderIndexCost(0, undefined)).toBe("Free");
    expect(renderIndexCost(1, undefined)).toBe("1 credit");
    expect(renderIndexCost(20, undefined)).toBe("20 credits");
  });

  // A per-unit tool has no single number: serp_snapshot really costs 13 to 85 credits, so printing
  // its per-unit price alone ("8 credits") would be wrong at every possible count.
  it("prints the FORMULA for a per-unit tool, base included", () => {
    expect(renderIndexCost(8, HUB_UNITS.serp_snapshot)).toBe("5 + 8 / keyword");
    expect(renderIndexCost(90, { unit: "target", min_units: 2, max_units: 10 })).toBe("90 / target");
  });
});

describe("renderIndexPage", () => {
  it("splits on the COST, not on a curated list", () => {
    const page = hubPage();
    const free = page.slice(page.indexOf("## Free tools"), page.indexOf("## Tools that spend"));
    const paid = page.slice(page.indexOf("## Tools that spend"));
    expect(free).toContain("list_projects");
    // The LAST tool is free and the FIRST is not: only a cost-driven split puts them here.
    expect(free).toContain("get_credit_balance");
    expect(free).not.toContain("crawl_site");
    expect(free).not.toContain("serp_snapshot");
    expect(paid).toContain("crawl_site");
    expect(paid).toContain("serp_snapshot");
    expect(paid).not.toContain("get_credit_balance");
  });

  it("carries no typed tool count — the row set IS the registry", () => {
    // The 15/16-pages finding: a hand-written hub grows a number that stops matching the surface.
    // One row per tool and no total anywhere is what makes that impossible here.
    const page = hubPage();
    for (const tool of HUB_TOOLS) expect(page).toContain(`/docs/tools-reference/${deriveSlug(tool.name)}`);
    expect(page).not.toMatch(/\b3 tools\b/);
    expect(page.split("\n").filter((line) => line.startsWith("| [`")).length).toBe(HUB_TOOLS.length);
  });

  /**
   * The load-bearing one. This column is what billing-and-credits.mdx sends the reader here for, so
   * it must follow the predicate the credit guard calls — not a list maintained beside it. Flipping
   * the predicate must move the cell; a page that renders identically either way would be a hub
   * that LOOKS authoritative and is not.
   */
  it("reads the paid-balance column from the injected runtime predicate", () => {
    const gated = hubPage((name) => name === "serp_snapshot");
    const ungated = hubPage(() => false);
    expect(gated).toMatch(/serp_snapshot.*\| Required \|/);
    expect(ungated).not.toContain("| Required |");
    expect(gated).not.toBe(ungated);
  });

  it("keeps the hub's own meta description inside the page budget", () => {
    expect(frontmatterDescription(hubPage()).length).toBeLessThanOrEqual(FRONTMATTER_DESCRIPTION_MAX);
  });

  it("escapes summary text so a pipe cannot break a table row", () => {
    const page = renderIndexPage(
      [{ name: "t_one", description: "A | B and <tag>." }],
      { t_one: 0 },
      {},
      () => false,
    );
    expect(page).toContain("A \\| B and &lt;tag&gt;.");
  });
});

describe("checkToolsMetaSync with the hub present", () => {
  it("ignores the allowlisted index page and still pins tool ORDER", () => {
    expect(checkToolsMetaSync(["setup_project", "crawl_site"], ["index", "setup-project", "crawl-site"]).ok).toBe(true);
    // Order is still the assertion: swapping two tools is a failure even with index in front.
    expect(checkToolsMetaSync(["setup_project", "crawl_site"], ["index", "crawl-site", "setup-project"]).ok).toBe(false);
    // And a MISSING tool is still a failure — the allowlist must not become a hole.
    expect(checkToolsMetaSync(["setup_project", "crawl_site"], ["index", "setup-project"]).ok).toBe(false);
  });
});
