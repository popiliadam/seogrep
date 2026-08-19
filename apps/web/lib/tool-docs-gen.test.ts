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
  findConfirmFields,
  frontmatterDescription,
  groupThousands,
  mdxEscapeInline,
  renderCostLine,
  renderFieldType,
  renderInputTable,
  renderToolPage,
  stripCostSentences,
  substituteProseTokens,
  truncateAtWord,
} from "../scripts/gen-tool-docs.mjs";

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
