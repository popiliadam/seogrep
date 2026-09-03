// gen-tool-docs.mjs — generate the Tools Reference docs from the BUILT MCP registry (design D11).
//
// A tool is declared once in apps/mcp as a zod schema + handler + a TOOL_COSTS row. This generator
// reads the BUILD OUTPUT (apps/mcp/dist) and derives each tool's docs page from it, so the three
// drift-prone facts can never silently disagree with the code:
//   • the credit cost line comes from TOOL_COSTS (apps/mcp/src/credits/costs.ts → dist) — never a
//     hand-typed number in any MDX (closes the 15/16-pages-hardcode finding);
//   • the "### Input" table comes from the tool's zod-derived JSON Schema (tool.inputJsonSchema);
//   • the page's existence, title (= tool name), and nav order come from ALL_TOOLS.
//
// The human-facing behavior prose (thresholds, "How it stays safe", examples, "Returns", limits)
// is NOT derivable from the schema, so it lives here as a per-tool static block (DOC_PROSE) — the
// generator-template option sanctioned by the task, keeping the MCP tool `description` (the terse
// LLM-facing tools/list surface) lean and unchanged. That prose is authored credit-number-free:
// wherever the amount matters the wording is qualitative and the only number is the derived cost.
//
// Usage:
//   node apps/web/scripts/gen-tool-docs.mjs            # (re)write all pages + meta + parent nav
//   node apps/web/scripts/gen-tool-docs.mjs --check     # verify in-sync (exit 1 on any drift)
//
// BOTH modes first verify that `apps/mcp/dist` is still a build of `apps/mcp/src` and refuse to run
// otherwise (dist-freshness.mjs). Reading a stale dist made `--check` compare today's MDX with
// yesterday's registry and print "N tool pages in sync" — a green measuring nothing (MEASURED
// 2026-08-26 with a tool description edited in src and deliberately not rebuilt: exit 0). The repo
// gate was safe only because verify.sh happens to run this after `build`; the meaningless green went
// to every path with NO build step in front of it — this package's own `docs:tools:check` script,
// a developer running the CLI by hand, any CI job that skips the build, and worst of all
// `docs:tools`, whose write mode would have put yesterday's pages back on disk. (`make goals` was
// never exposed: the docs-schema-sync predicate builds @pseo/mcp first — MEASURED on the merge-base
// and on HEAD, after this comment first named it as a victim.)
//
// The pure functions below are exported and unit-tested (apps/web/lib/tool-docs-gen.test.ts); the
// registry is imported lazily inside main(), so importing this module for tests is side-effect free.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// The gate's own input has to be verified before it is read: this check derives everything from
// apps/mcp/dist, so a stale dist turns every assertion below into a comparison against old code.
import { assertDistFresh } from "./dist-freshness.mjs";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** snake_case tool name → hyphenated docs page slug (setup_project → setup-project). */
export function deriveSlug(toolName) {
  return toolName.replace(/_/g, "-");
}

/**
 * Strip any cost sentence from a tool description so the ONLY credit number on a page is the
 * TOOL_COSTS-derived cost line. Removes "Costs N credits[, …clause]." and "Free (0 credits)."
 * wherever they sit, then collapses the seam. The remaining prose (e.g. "Run connect_gsc first")
 * is preserved.
 */
export function stripCostSentences(description) {
  return description
    .replace(/\s+Costs?\s+\d+\s+credits?(,[^.]*)?\.(?=\s|$)/gi, "")
    .replace(/\s+Free\s*\(0\s+credits?\)\.(?=\s|$)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Max length of a generated frontmatter `description` (the page's `<meta>` description). */
export const FRONTMATTER_DESCRIPTION_MAX = 155;

/**
 * Truncate `text` to at most `max` characters at a WORD boundary, ending with a single-character
 * ellipsis (`…`). Strings already within the limit are returned unchanged. Used to keep a tool's
 * frontmatter `description` — which becomes the page's meta description — short enough that search
 * engines don't truncate it; the full behavior prose still lives in the page body, so nothing is
 * lost. Guarantees `result.length <= max`.
 */
export function truncateAtWord(text, max = FRONTMATTER_DESCRIPTION_MAX) {
  const str = String(text ?? "");
  if (str.length <= max) return str;
  const ellipsis = "…";
  const budget = max - ellipsis.length; // leave room for the ellipsis
  let cut = str.slice(0, budget);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 0) cut = cut.slice(0, lastSpace); // don't split the final word
  cut = cut.replace(/[\s–—,.;:!?-]+$/u, ""); // drop a dangling separator/punctuation
  return `${cut}${ellipsis}`;
}

/**
 * The frontmatter `description` string of a rendered MDX page (decoded from its YAML double-quoted
 * scalar), or "" if the page has none. Lets the --check gate measure the ACTUAL emitted meta
 * description length, so a regression that bypasses truncation is caught at the rendered output.
 */
export function frontmatterDescription(pageText) {
  const match = String(pageText).match(/^description:\s*"((?:[^"\\]|\\.)*)"/m);
  if (!match) return "";
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * The single credit-cost line, derived from TOOL_COSTS[name]. Zero renders as free.
 *
 * `unitRule` is the CREDIT_UNITS entry for a tool whose price is PER UNIT rather than per call
 * (today: ai_visibility_compare, at 90 credits per compared target over 2-10 targets). When one is
 * given, the line renders the unit price AND the range one call can really cost — because "90
 * credits" on the page of a tool no call of which ever costs 90 is a wrong number, not a short one.
 * Omitted for every other tool, which keeps the flat line byte-identical to what it always was.
 *
 * A rule may also carry a `base`: credits charged ONCE per call whatever the count (costs.ts
 * PerUnitPriceRule). `serp_snapshot` is signed at 5 + 8 per keyword over 1-10 keywords, and with the
 * base ignored this line published "8 to 80 credits" for a call that really costs 13 to 85 —
 * understating its own signed price at every count (MEASURED before this branch existed).
 *
 * BOTH halves are rendered, and neither alone is enough for the reader the page is for. The range
 * alone (13 to 85) is true but leaves a caller who wants three keywords doing arithmetic against a
 * formula the page never gave them; the formula alone (5 + 8 per keyword) makes every reader compute
 * the number they actually came for. So the line names the fixed part, the per-unit part, the count
 * range, and the credits those bounds really cost — every number DERIVED from the rule, none typed
 * into prose.
 *
 * An absent base and a base of 0 mean the same thing and render identically: the per-call clause is
 * dropped entirely, which is what keeps `ai_visibility_compare`'s line byte-identical to what it was
 * before the base term existed.
 */
export function renderCostLine(cost, unitRule) {
  if (unitRule) {
    const { unit, min_units: min, max_units: max } = unitRule;
    const base = unitRule.base ?? 0;
    const perCall = base > 0 ? `${base} credits per call plus ` : "";
    return (
      `**Cost:** ${perCall}${cost} credits per ${unit} — ${min} to ${max} ${unit}s per call, ` +
      `so ${base + cost * min} to ${base + cost * max} credits.`
    );
  }
  if (cost === 0) return "**Cost:** Free (0 credits).";
  if (cost === 1) return "**Cost:** 1 credit.";
  return `**Cost:** ${cost} credits.`;
}

/**
 * Escape schema-derived text for safe inline placement in MDX: angle brackets would be parsed as
 * JSX (e.g. a field default of '<domain>'), and a bare pipe would break a table cell.
 */
export function mdxEscapeInline(text) {
  return String(text ?? "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|");
}

/** A human type label for one JSON-Schema property (string (uuid), integer, string[], …). */
export function renderFieldType(prop) {
  if (prop.type === "array") {
    const item = prop.items && prop.items.type ? scalarType(prop.items) : "value";
    return `${item}[]`;
  }
  return scalarType(prop);
}

function scalarType(prop) {
  if (prop.type === "string" && prop.format === "uuid") return "string (uuid)";
  return prop.type || "value";
}

/** The "### Input" body: a derived Field/Type/Required/Description table, or "No parameters.". */
export function renderInputTable(inputJsonSchema) {
  const props = (inputJsonSchema && inputJsonSchema.properties) || {};
  const names = Object.keys(props);
  if (names.length === 0) return "No parameters.";
  const required = new Set((inputJsonSchema && inputJsonSchema.required) || []);
  const rows = names.map((name) => {
    const prop = props[name];
    const type = renderFieldType(prop);
    const req = required.has(name) ? "Yes" : "No";
    const desc = mdxEscapeInline(prop.description);
    return `| \`${name}\` | ${type} | ${req} | ${desc} |`;
  });
  return ["| Field | Type | Required | Description |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

/** Wrap a string as a double-quoted YAML scalar (escaping backslash + quote). */
export function yamlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Render one tool's MDX page (pure). Derived from the registry: `title` (tool name), the frontmatter
 * `description` (tool description with its cost sentence stripped), the cost line (from `cost`), and
 * the "### Input" table (from `toolMeta.inputJsonSchema`). Editorial prose comes from `prose`.
 */
export function renderToolPage(toolMeta, cost, prose, unitRule) {
  const description = truncateAtWord(stripCostSentences(toolMeta.description), FRONTMATTER_DESCRIPTION_MAX);
  const frontmatter = [
    "---",
    `title: ${toolMeta.name}`,
    `description: ${yamlString(description)}`,
    "---",
  ].join("\n");

  const blocks = [frontmatter, renderCostLine(cost, unitRule)];
  if (prose.lead) blocks.push(prose.lead.trim());
  blocks.push(`## What it does\n\n${prose.whatItDoes.trim()}`);
  for (const section of prose.preExampleSections || []) {
    blocks.push(`## ${section.heading}\n\n${section.body.trim()}`);
  }
  blocks.push(`## Example\n\n${prose.example.trim()}`);
  blocks.push(`### Input\n\n${renderInputTable(toolMeta.inputJsonSchema)}`);
  blocks.push(`### Returns\n\n${prose.returns.trim()}`);
  for (const section of prose.postReturnsSections || []) {
    blocks.push(`### ${section.heading}\n\n${section.body.trim()}`);
  }
  return `${blocks.join("\n\n")}\n`;
}

/** Thousands-separate an integer for prose (15000 → "15,000") — mirrors `grouped` in format.ts. */
export function groupThousands(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Require a positive integer for a token's constant, or throw naming the token that needs it. */
function positiveInteger(value, token, key) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${token} needs a positive integer ${key}, got ${value}.`);
  }
  return value;
}

/** "3 days" / "1 day" — a phrase, not a bare number, so a lag of 1 can't render as "1 days". */
export function dayPhrase(days) {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Substitute the `{{TOKEN}}` placeholders a DOC_PROSE block may carry with values DERIVED from the
 * built MCP code, so a limit quoted in prose can never disagree with the constant that enforces it:
 *
 *   • `{{MAX_GSC_ROWS}}` = MAX_ROW_LIMIT       (apps/mcp/src/gsc-data/pull.ts)
 *   • `{{GSC_LAG_DAYS}}` = GSC_FRESHNESS_LAG_DAYS, rendered as a phrase (apps/mcp/.../windows.ts)
 *   • `{{MAX_TRACKED_KEYWORDS}}` = MAX_TRACKED_KEYWORDS_PER_PROJECT (apps/mcp/.../tracked-keywords-store.ts)
 *
 * The same derivation format.ts makes for the tool-output caveat: prose is exactly where a changed
 * constant goes unnoticed, because nothing compiles against a sentence — and a wrong number here
 * tells the reader how much data they are missing with no way to check it.
 *
 * Fail-closed: a non-integer constant, or a token nobody substitutes, throws instead of rendering a
 * page that states a wrong (or literally "undefined") limit.
 */
/**
 * The tools that accept a bare `target` domain INSTEAD of a `project_id`, as doc links, derived
 * from the registry rather than typed out.
 *
 * A hand-written list here would be a second place for the answer to live, and it would go stale
 * the first time a tool gained or lost the parameter — which is exactly how a customer ends up
 * believing they need a uuid for a call that never wanted one (finding G1, 2026-08-26).
 *
 * Fail-closed: an empty list throws rather than rendering a sentence promising tools it cannot
 * name, which is what a renamed `target` property would otherwise produce.
 */
export function domainAddressableTools(allTools) {
  const names = (allTools || [])
    .filter((tool) => tool?.inputJsonSchema?.properties?.target !== undefined)
    .map((tool) => tool.name)
    .sort();
  if (names.length === 0) {
    throw new Error(
      "{{DOMAIN_TOOLS}}: no tool in the registry declares a `target` property — either the " +
        "parameter was renamed or the registry did not load.",
    );
  }
  return names.map((name) => `[\`${name}\`](/docs/tools-reference/${deriveSlug(name)})`).join(", ");
}

export function substituteProseTokens(text, constants) {
  const {
    maxRowLimit,
    lagDays,
    maxTrackedKeywords,
    maxSerpKeywords,
    crawlTimeBudgetSeconds,
    domainTools,
  } = constants || {};
  const out = String(text)
    .replace(/\{\{MAX_GSC_ROWS\}\}/g, () =>
      groupThousands(positiveInteger(maxRowLimit, "{{MAX_GSC_ROWS}}", "maxRowLimit")),
    )
    .replace(/\{\{GSC_LAG_DAYS\}\}/g, () =>
      dayPhrase(positiveInteger(lagDays, "{{GSC_LAG_DAYS}}", "lagDays")),
    )
    .replace(/\{\{MAX_TRACKED_KEYWORDS\}\}/g, () =>
      groupThousands(
        positiveInteger(maxTrackedKeywords, "{{MAX_TRACKED_KEYWORDS}}", "maxTrackedKeywords"),
      ),
    )
    // The SERP-snapshot keyword cap. It is a PRICE decision (apps/mcp credits/costs.ts explains
    // why it is what holds the signed worst-case margin up), so a page that retyped it could
    // publish a bound the code no longer charges for.
    .replace(/\{\{MAX_SERP_KEYWORDS\}\}/g, () =>
      groupThousands(positiveInteger(maxSerpKeywords, "{{MAX_SERP_KEYWORDS}}", "maxSerpKeywords")),
    )
    // The crawl's WALL-CLOCK ceiling in seconds. MEASURED LIVE 2026-09-02: a whole-site crawl
    // returned 51 of a possible 100 pages because this budget ran out first, and the page cap was
    // the only bound the page named — so the reader was set up to expect twice what the same flat
    // price delivers. It comes from the crawler's own constant for the usual reason: a retyped
    // bound can outlive the one being enforced.
    .replace(/\{\{CRAWL_TIME_BUDGET\}\}/g, () =>
      String(
        positiveInteger(crawlTimeBudgetSeconds, "{{CRAWL_TIME_BUDGET}}", "crawlTimeBudgetSeconds"),
      ),
    )
    .replace(/\{\{DOMAIN_TOOLS\}\}/g, () => {
      if (typeof domainTools !== "string" || domainTools === "") {
        throw new Error("{{DOMAIN_TOOLS}} needs the derived tool list, got nothing.");
      }
      return domainTools;
    });
  // The leftover guard matches ANY `{{…}}`, not just the SCREAMING_CASE shape the two live tokens
  // happen to use: a typo is exactly the case this must catch, and a typo does not respect the
  // convention. The narrow `[A-Z0-9_]+` version this replaces let four near-misses — `{{max_rows}}`,
  // `{{ MAX_GSC_ROWS }}`, `{{Max_Rows}}`, `{{MAX-ROWS}}` — render straight onto the page, i.e. the
  // guard was green precisely when it was needed. Nothing legitimate can trip it: a rendered page
  // is MDX, where a bare `{` already opens a JSX expression.
  const leftover = out.match(/\{\{[^}]*\}\}/);
  if (leftover) throw new Error(`Unknown prose token ${leftover[0]} — add a substitution for it.`);
  return out;
}

/**
 * The SHORT cost label for one row of the hub table. The per-unit tools cannot be summarised as a
 * single number — `serp_snapshot` at "5 + 8 / keyword" costs 13 to 85 credits — so the formula is
 * printed rather than a number that is wrong at every count. Derived from the same TOOL_COSTS /
 * CREDIT_UNITS pair renderCostLine reads, so a hub row and a tool page can never disagree.
 */
export function renderIndexCost(cost, unitRule) {
  if (unitRule) {
    const base = unitRule.base ?? 0;
    const perUnit = `${cost} / ${unitRule.unit}`;
    return base > 0 ? `${base} + ${perUnit}` : perUnit;
  }
  if (cost === 0) return "Free";
  return cost === 1 ? "1 credit" : `${cost} credits`;
}

/**
 * The tools-reference hub page (pure). Every cell is derived:
 *   • the row set and its order come from ALL_TOOLS — no typed tool count anywhere on the page;
 *   • the cost column comes from TOOL_COSTS / CREDIT_UNITS;
 *   • the "Paid balance" column comes from requiresPaidBalance(), the SAME predicate the credit
 *     guard calls at runtime (apps/mcp/src/credits/paid-balance.ts). This is the column
 *     billing-and-credits.mdx promises its reader, and deriving it is what makes that promise true
 *     rather than a claim maintained by hand;
 *   • the one-line summary is the tool's own description with its cost sentence stripped, the same
 *     text that becomes each page's meta description.
 *
 * Free and paid tools are split because that is the first question a reader arrives with, and the
 * split is computed from the cost, not from a curated list.
 */
export function renderIndexPage(allTools, toolCosts, creditUnits, needsPaidBalance) {
  const rows = allTools.map((tool) => {
    const cost = toolCosts[tool.name];
    return {
      name: tool.name,
      slug: deriveSlug(tool.name),
      cost,
      label: renderIndexCost(cost, creditUnits[tool.name]),
      paid: needsPaidBalance(tool.name),
      summary: truncateAtWord(stripCostSentences(tool.description), INDEX_SUMMARY_MAX),
    };
  });
  const free = rows.filter((row) => row.cost === 0);
  const charged = rows.filter((row) => row.cost !== 0);

  const table = (list, withPaidColumn) => {
    const header = withPaidColumn
      ? ["| Tool | Cost | Paid balance | What it does |", "| --- | --- | --- | --- |"]
      : ["| Tool | Cost | What it does |", "| --- | --- | --- |"];
    const body = list.map((row) => {
      const link = `[\`${row.name}\`](/docs/tools-reference/${row.slug})`;
      const cells = withPaidColumn
        ? [link, row.label, row.paid ? "Required" : "—", mdxEscapeInline(row.summary)]
        : [link, row.label, mdxEscapeInline(row.summary)];
      return `| ${cells.join(" | ")} |`;
    });
    return [...header, ...body].join("\n");
  };

  const frontmatter = [
    "---",
    "title: Tools Reference",
    `description: ${yamlString(
      "Every SeoGrep MCP tool, what it costs in credits, and whether it needs a paid balance.",
    )}`,
    "---",
  ].join("\n");

  return [
    frontmatter,
    "One page per tool, generated from the same code the MCP server runs — so the credit cost " +
      "and the paid-balance rule below are the ones the guard actually enforces, not a copy of " +
      "them.",
    "## Free tools\n\nThese spend no credits. Use them to set up, connect, and check state.\n\n" +
      table(free, false),
    "## Tools that spend credits\n\nCredits are reserved before the call and settled after it; a " +
      "call that fails without delivering a result is refunded. **Paid balance: Required** marks a " +
      "tool that a trial account cannot reach at any price — buy any credit pack and it opens.\n\n" +
      table(charged, true),
    "See [Billing and credits](/docs/billing-and-credits) for how credits are reserved, settled " +
      "and refunded, and [Getting started](/docs/getting-started) to connect a client.",
  ].join("\n\n") + "\n";
}

/** Row summaries are one table cell, so they are cut shorter than a page meta description. */
export const INDEX_SUMMARY_MAX = 110;

/**
 * Pages allowed in tools-reference/meta.json that are not tools. `index` is the section hub — the
 * one page here that is ABOUT the set rather than about a member of it.
 *
 * It exists because the section did not have one. tools-reference held 38 generated tool pages and
 * a meta.json and no index.mdx, while all three sibling sections (core-concepts, getting-started,
 * recipes) had one — so `/docs/tools-reference` was a 404, and billing-and-credits.mdx linked
 * straight at it while telling the reader "that is the list to trust" for which tools need a paid
 * balance (M-07, audit 2026-08-26). The hub is GENERATED rather than hand-written for the reason
 * this whole file exists: a hand-written index would carry a typed tool count and typed credit
 * numbers, which is exactly the drift the 15/16-pages finding closed.
 */
export const NON_TOOL_ALLOWLIST = ["index"];

/**
 * Verify the tools-reference meta.json `pages` match ALL_TOOLS by name AND order (the tool-surface
 * pin — derived from the registry, so it carries no hardcoded tool count). Non-tool pages on the
 * allowlist are ignored. Returns { ok, errors }.
 */
export function checkToolsMetaSync(toolNames, metaPages) {
  const expected = toolNames.map(deriveSlug);
  const actual = (metaPages || []).filter((page) => !NON_TOOL_ALLOWLIST.includes(page));
  const errors = [];
  if (actual.length !== expected.length) {
    errors.push(`meta.json lists ${actual.length} tool pages, expected ${expected.length}.`);
  }
  const n = Math.max(actual.length, expected.length);
  for (let i = 0; i < n; i++) {
    if (actual[i] !== expected[i]) {
      errors.push(`meta.json page[${i}] = ${actual[i] ?? "(missing)"}, expected ${expected[i] ?? "(extra)"}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Tool names that WRONGLY carry a reserved `confirm` field in their input schema (D17).
 *
 * The rule it enforces is unchanged: `confirm` is the REGISTRY's parameter and may never become
 * a tool's — no zod schema declares it. What changed is that the advertised JSON Schema is no
 * longer a pure view of one tool's zod schema: since 2026-09-02 the registry INJECTS `confirm`
 * into the schema of a tool whose worst-case price can trip the D17 gate, because the schemas now
 * refuse unknown keys and a bare `additionalProperties: false` would have forbidden the very
 * retry the confirmation prompt asks for.
 *
 * A registry-injected advertisement and a tool that declared the field look identical in the JSON
 * Schema, so the two are told apart by `confirmable` — derived in the registry from the signed
 * price table (registry.ts canRequireConfirmation). A tool the gate can never fire for still
 * offends, which is the case this gate was written for.
 */
export function findConfirmFields(tools) {
  const offenders = [];
  for (const tool of tools) {
    if (tool.confirmable === true) continue;
    const props = (tool.inputJsonSchema && tool.inputJsonSchema.properties) || {};
    if (Object.prototype.hasOwnProperty.call(props, "confirm")) offenders.push(tool.name);
  }
  return offenders;
}

// ---------------------------------------------------------------------------
// Per-tool editorial prose (the schema-underivable behavior docs). Authored credit-number-free.
// ---------------------------------------------------------------------------

// The three discovery tools read a stored `pull_gsc_data` result, so the pull's two limits are
// theirs as well — and a reader who lands on a discovery page never sees the pull page's
// "Limitations (v0)". These two fragments carry the inherited half of that: the row cap and the
// freshness offset. NEITHER number is typed here — both come from the {{…}} tokens above, i.e. from
// MAX_ROW_LIMIT and GSC_FRESHNESS_LAG_DAYS in the built MCP code, so `--check` turns red on this
// page the moment either constant moves (mutation-proved, both directions).
// Each tool appends its OWN consequence to the intro, because truncation distorts each differently.
//
// Three limits are KNOWN and ACCEPTED here (reviewed, deliberately not fixed):
//   1. The tokens carry the number, not the grammar around it. `dayPhrase` keeps "1 day" correct,
//      but the pull page's "the newest {{GSC_LAG_DAYS}} ARE not analyzed" would still read wrong at
//      a lag of 1 — a constant that is not going to 1, and a sentence rewrite is the fix if it does.
//   2. "BOTH windows also end …" is exact for analyze_content_decay and slightly over-broad for the
//      other two, which only read the current window; the offset is the same for both windows, so
//      the reader is not misled, and one shared fragment beats three near-identical ones.
//   3. Nothing stops a future author typing a raw number instead of a token. The gate catches a
//      constant that MOVES away from the prose, not prose that was born detached from a constant.
const INHERITED_LIMITS_INTRO =
  "This analysis sees only what [`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) brought " +
  "back. A pull fetches at most **{{MAX_GSC_ROWS}}** `(query, page)` rows per window, ";

const INHERITED_LIMITS_FRESHNESS =
  "Both windows also end **{{GSC_LAG_DAYS}} before today** rather than running up to it, so the " +
  "newest days are not analyzed yet. See " +
  "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) for both limits in full.";

/**
 * THE REPEAT WARNING, for the three audits that keep an `audit_runs` row per (crawl, tool). Not on
 * `audit_content`: it records into its own table and the note is not wired there.
 */
const AUDIT_REPEAT_LINE =
  "\n\nIf this tool has already audited this same crawl, the reply says so and when. The report " +
  "is deterministic, so a second run over an unchanged crawl returns the same findings — the note " +
  "is there so that is a choice rather than a surprise. **The price is unchanged either way.**";

/**
 * THE SCOPE SENTENCE the four audits open with. One constant because it describes ONE mechanism —
 * `audit/load.ts` picks the crawl and prints which one it picked — and four copies of a sentence
 * about a shared mechanism drift the moment one of them is edited.
 */
const AUDIT_SCOPE_LINE =
  "\n\n**The reply opens by naming the crawl it judged** — a short job id, the date it was taken, " +
  "how many pages it covered and how many URLs it skipped. If you did not pass `job_id`, it also " +
  "says so and tells you how to choose a different crawl. That line exists because the newest " +
  "crawl is not always the widest one: a narrow re-crawl of one section becomes the newest, and " +
  "an audit that silently judged it would charge full price for a fraction of your site.";

export const DOC_PROSE = {
  setup_project: {
    lead:
      "`setup_project` registers a domain so SeoGrep can crawl, audit, and report on it. It is " +
      "**idempotent** — running it again for the same domain (in any URL or host form) returns the " +
      "existing project instead of creating a duplicate.",
    whatItDoes:
      "Normalizes the input to a canonical domain — a leading `www.` label is dropped, so " +
      "`www.example.com` and `example.com` are the same site and never open two projects — then " +
      "creates the project under your account, or returns the existing one if you already track " +
      "that site.",
    preExampleSections: [
      {
        heading: "A domain that does not resolve is registered anyway",
        body:
          "After the project is written, SeoGrep asks DNS whether the name exists. If DNS answers " +
          "**no such name**, the reply still confirms the project and adds a warning saying a " +
          "crawl would have nothing to fetch until the domain is live. It does **not** refuse: a " +
          "site registered before launch is a legitimate project, and blocking it would be wrong " +
          "more often than right.\n\n" +
          "The warning is raised only on that positive finding. A lookup that times out or whose " +
          "resolver could not be reached is **not** a missing domain and says nothing — telling a " +
          "customer their domain does not exist because of a DNS blip is a worse answer than " +
          "silence. The check runs after the write and is capped, so a slow resolver can delay " +
          "the reply and can never delay or prevent the registration.",
      },
    ],
    example: "Ask your MCP client in plain language:\n\n> Set up example.com as a project.",
    returns:
      "One sentence of plain text — not a structured object — naming the canonical `domain` and " +
      "carrying `project_id` and `created` inside it, as in `(project_id: …, created: false)`. " +
      "It comes in one of **three** wordings, not two: the project was created, it already " +
      "existed, or it was **restored from your archive** and is tracked again on its original " +
      "id. The resolution warning above follows when DNS says the name does not exist.",
  },

  connect_gsc: {
    lead:
      "`connect_gsc` links a project to Google Search Console so the tools that need real " +
      "search-performance data — like `pull_gsc_data` and `analyze_content_decay` — can run. It is " +
      "**optional**: your first crawl and audit work without it, so connecting is the **second step, " +
      "never the first barrier**.",
    whatItDoes:
      "Given one of your projects, it returns a secure Google sign-in link. Opening the link takes " +
      "you to Google's consent screen, where SeoGrep requests **read-only** Search Console access " +
      "— it never asks for write access to your property. Approving stores an encrypted token for " +
      "the **Google account**; which property the project reads is a separate, later choice.",
    preExampleSections: [
      {
        heading: "Approving connects an account, not a property",
        body:
          "The consent screen grants SeoGrep access to a Google account and nothing more. It does " +
          "not decide which of that account's Search Console properties your project reads — you " +
          "pick that afterwards, on the **Connection page** in your dashboard, or in one call " +
          "with [`track_gsc_property`](/docs/tools-reference/track-gsc-property).\n\n" +
          "This is worth stating plainly because the obvious repair is the wrong one: **approving " +
          "again does not change which property a project reads.** A fresh consent re-grants the " +
          "account, which is the right move only when access was withdrawn on Google's side. If " +
          "the project is reading the wrong property — or none — the consent round trip cannot " +
          "fix it, and the answers this tool gives say which route can.",
      },
      {
        heading: "What it says on a project that is already connected",
        body:
          "It does not hand out a fresh consent link and pretend nothing happened. A project that " +
          "already reads a property is told which one, and pointed at " +
          "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data).\n\n" +
          "A project whose account connected but whose domain matched **no** verified property is " +
          "the case that used to look identical to success. It now says outright that nothing was " +
          "stored and that the Search Console tools cannot run yet, then names what to verify in " +
          "Search Console — a URL-prefix property or a domain property for that domain. A domain " +
          "property named for a **parent** domain is not used: SeoGrep drops a leading `www.` " +
          "label and no other subdomain label, because a subdomain can belong to someone else.",
      },
      {
        heading: "How it stays safe",
        body:
          "- The access SeoGrep requests is **read-only** (`webmasters.readonly`).\n" +
          "- Your Google **refresh token is encrypted at rest** (AES-256-GCM); the plaintext is never " +
          "written to the database or logs.\n" +
          "- You can revoke access any time from your Google Account's third-party access settings.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Connect Search Console for my example.com project.\n\n" +
      "The tool replies with a link. Open it, approve read-only access, and you land back on your " +
      "dashboard with the Google account connected — then choose the property for this project on " +
      "the Connection page, or with " +
      "[`track_gsc_property`](/docs/tools-reference/track-gsc-property).",
    returns:
      "For a project with no connection yet: a Google sign-in link, plus a reminder that the " +
      "connection is optional and read-only. For a project that is already connected: the " +
      "property it reads (or a plain statement that none matched), where to change it, and the " +
      "re-approval link for the one case that needs it. An archived project is refused rather " +
      "than handed a link, and a `project_id` that is not yours is reported exactly like an id " +
      "that does not exist.",
  },

  list_projects: {
    lead:
      "`list_projects` returns the domains you're tracking, oldest first, each with its `project_id`, " +
      "its Search Console state and its last background job — and, below them, anything you have " +
      "**archived**. If you have neither yet, it points you to `setup_project`.",
    whatItDoes:
      "Reads your projects, scoped to your account, and returns them as two lists: the ones you are " +
      "tracking, and the ones you archived with " +
      "[`untrack_project`](/docs/tools-reference/untrack-project).",
    preExampleSections: [
      {
        heading: "What each tracked line tells you",
        body:
          "Beside the domain and its `project_id`, every tracked line carries two facts, because a " +
          "list of fifteen identical-looking domains answers neither question a customer actually " +
          "has: can Search Console be read for this one, and has anything ever run against it.\n\n" +
          "**Search Console** is reported in three states, never as a tick:\n\n" +
          "- `not connected` — no Google account is linked to this project.\n" +
          "- `connected, no property selected` — an account is linked but no property has been " +
          "matched to it. Nothing can be pulled yet. This state is named rather than folded into " +
          "\"connected\" precisely because it looks like a working connection and is not.\n" +
          "- the property itself (for example `sc-domain:example.com`) — the mapping that pulls " +
          "will use. If the stored credential behind it has died, `(reconnect needed)` is appended: " +
          "the property is still right, the credential is not.\n\n" +
          "**Last job** names the tool that ran and the day it ran. A *job* is a background run — " +
          "[`crawl_site`](/docs/tools-reference/crawl-site) or " +
          "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data). Audits, keyword and backlink " +
          "lookups run synchronously and are not jobs, so a project can read `none yet` and still " +
          "have been analysed — the reply says so, under the list, rather than leaving the line to " +
          "be read as \"nothing has ever happened here\".\n\n" +
          "**If two tracked projects are mapped to the same Search Console property**, the reply " +
          "names that property and both projects underneath the list. Each pull fetches one set " +
          "of rows and is billed once per project, so the pair costs credits twice for the same " +
          "data. Nothing is deduplicated for you — which of the two to keep is a decision only " +
          "you can make.\n\n" +
          "**If two tracked projects are the same site** — an apex and its `www.` twin, say — " +
          "the reply names them together as well. This is a different warning and it fires " +
          "independently: a pair with no Google account at all still has it, because each of the " +
          "two is crawled, audited and billed on its own. New projects can no longer split this " +
          "way, so a pair you see is left over from before that changed; " +
          "[`untrack_project`](/docs/tools-reference/untrack-project) archives the one you do " +
          "not want, and nothing it holds is deleted.",
      },
      {
        heading: "You do not always need the project_id",
        body:
          "The `project_id` is what most tools use to know which of your sites they are working " +
          "on, and this is where you get it. But a large part of the surface will also take a " +
          "plain domain instead, passed as `target` — including a competitor's, which is the " +
          "point: those tools answer questions about any public site, not only your own.\n\n" +
          "Pass `target` OR `project_id`, never both. These tools accept either: " +
          "{{DOMAIN_TOOLS}}.\n\n" +
          "Everything else needs the `project_id`, because it reads data stored against YOUR " +
          "project — your crawls, your audits, your Search Console pulls — and a domain does not " +
          "identify those.",
      },
      {
        heading: "The archive",
        body:
          "Archived projects are listed separately, most recently archived first, each with its " +
          "`project_id` and the date it was archived. They are **not** counted as tracked and never " +
          "appear in the tracked list — but they are visible, which is what makes them recoverable: " +
          "you do not have to remember the exact domain to bring one back.\n\n" +
          "Either route restores the original project in place, on the same `project_id`, with its " +
          "crawls, reports and Search Console connection intact: " +
          "[`setup_project`](/docs/tools-reference/setup-project) with the same domain, or " +
          "[`track_gsc_property`](/docs/tools-reference/track-gsc-property) for its property.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Which sites am I tracking?\n\nor\n\n" +
      "> What did I archive?",
    returns:
      "One line per tracked project (`domain`, `project_id`, Search Console state, last job), " +
      "oldest first, followed by one line saying what counts as a job; then an archive section, " +
      "most recently archived first, with each archived project's `domain`, `project_id`, archive " +
      "date, and how to restore it. Guidance to create your first project when you have nothing " +
      "at all.",
  },

  list_jobs: {
    lead:
      "`list_jobs` lists your recent background jobs — the crawls and Search Console pulls that run " +
      "in the background — newest first, each with its `job_id`. It is the tool to reach for when " +
      "you **do not have a `job_id` to hand**. The reply says how many jobs you have in total and " +
      "how many it did not show, so a cut list never reads as your whole history.",
    whatItDoes:
      "Reads your own jobs, scoped to your account, and returns one line each: which tool ran, what " +
      "state it is in, when it was created and finished, which of your sites it ran against, and " +
      "the `job_id` to ask about. The site is named by DOMAIN; a job with no project scope says " +
      "so, and a project you have since removed falls back to the id it was recorded with.\n\n" +
      "A job whose stored stamps contradict each other — a `finished` earlier than its `created` — " +
      "is marked **timestamps out of order** rather than printed as an ordinary timeline. Both " +
      "stamps are still shown, because both are real: some rows were written with `created_at` " +
      "stamped at insert time, after the work they record. No duration is derived from such a " +
      "pair; a contradiction does not describe a short run, it describes an unknown one, and " +
      "[`get_job_status`](/docs/tools-reference/get-job-status) makes the same refusal.",
    preExampleSections: [
      {
        heading: "What the list shows, and what needs a second call",
        body:
          "The list deliberately carries **no results**. A finished crawl or Search Console pull can " +
          "store a very large result — one measured pull held close to a megabyte — so printing even " +
          "a few of them would bury the answer you asked for.\n\n" +
          "Take a `job_id` from the list and pass it to " +
          "[`get_job_status`](/docs/tools-reference/get-job-status) for that one job's detail: its " +
          "crawl summary, how far a running job has got, or why it failed.",
      },
      {
        heading: "Narrowing the list, and reading past the first page",
        body:
          "Pass `status` to see only the jobs in one state — `queued`, `running`, `succeeded` or " +
          "`failed` — and `project_id` to see only the ones that ran against a single site. The " +
          "two combine, so \"the failed crawls for this domain\" is one call. A `status` the jobs " +
          "table cannot hold is **refused** rather than quietly ignored.\n\n" +
          "**A narrowed reply says so.** The heading names the filter it applied — *your 3 most " +
          "recent failed job(s) of 3 for example.com* — and the count is of the filtered set " +
          "rather than of your whole history, so a short list is never read as \"this is " +
          "everything\". When nothing matches, the reply names what you asked for (*No failed " +
          "job(s) for example.com found*) and points at the call that drops the filter, instead " +
          "of telling you that you have never run a job.\n\n" +
          "The list is capped, and the reply says how many jobs it did **not** show along with " +
          "the `before_id` to pass for the next page. Each page names the next value, so a busy " +
          "account can be read all the way down; page two calls itself a continuation and counts " +
          "what remains past the cursor. A `before_id` that names no job of yours is refused " +
          "outright — never treated as \"start from the top\" — while reaching your oldest job " +
          "says the history **ends** there.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> How is the crawl I started doing?\n\n" +
      "The tool replies with your recent jobs; pick the one you mean and ask " +
      "[`get_job_status`](/docs/tools-reference/get-job-status) about its `job_id`.",
    returns:
      "One line per job — tool, status, timestamps, which of your sites it ran against, and " +
      "`job_id` — newest first, followed by a pointer to `get_job_status` for the full result, " +
      "and the `before_id` for the next page when the list was cut. When `status` or " +
      "`project_id` narrowed the list, the heading names the filter and the count is of the " +
      "filtered set; when nothing matched, the reply names the filter rather than reporting an " +
      "empty account. Guidance to the two tools that create jobs when you have run none.",
  },

  list_credit_activity: {
    lead:
      "`list_credit_activity` shows your most recent credit ledger entries, newest first — what was " +
      "granted, what you bought, and which tool charged what.",
    whatItDoes:
      "Reads your own credit ledger, scoped to your account, and returns one line per entry: when it " +
      "happened, the signed number of credits, what kind of entry it is, and the tool behind it.",
    preExampleSections: [
      {
        heading: "What counts as an entry",
        body:
          "Only entries that **moved your balance** are listed. A tool run is recorded internally as " +
          "a charge and a matching settlement marker worth zero credits; the marker is bookkeeping " +
          "and is left out, because a `0 credits` line next to the real charge for the same tool " +
          "reads as an error rather than as a record.\n\n" +
          "A run that was refunded therefore shows **twice** — once as the charge and once as the " +
          "refund — rather than disappearing. That is what keeps the numbers you see equal to the " +
          "movements behind your balance.\n\n" +
          "For the running total itself, use " +
          "[`get_credit_balance`](/docs/tools-reference/get-credit-balance). For charts and a full " +
          "history, use the Usage page in your dashboard.",
      },
      {
        heading: "Where the credits went, and how to read past the first page",
        body:
          "Every reply ends with one **Spent so far** line: your net spend, how many tools it " +
          "covers, and the five that took the most, with the tail collapsed into a single " +
          "number. *Net*, not gross — a run that was refunded cost nothing, so a tool whose " +
          "every call was released is left out rather than printed as a zero. If your ledger is " +
          "larger than one summary can read, the line says how many entries it covered: a " +
          "partial total that calls itself complete is worse than no total at all.\n\n" +
          "The list is capped, and the reply says how many entries it did **not** show along " +
          "with the `before_id` to pass for the next page. Each page names the next value, so an " +
          "account with hundreds of entries can be read all the way down. Page two calls itself " +
          "a continuation rather than \"your most recent\", and counts what remains past the " +
          "cursor rather than the size of the whole ledger.\n\n" +
          "The two ways of running out are told apart, and neither is reported as an empty " +
          "ledger: a `before_id` that names no entry of yours is refused outright rather than " +
          "quietly restarting from the top, while reaching your oldest entry says the history " +
          "**ends** there.\n\n" +
          "Pass `project_id` to see what one site cost you. The ledger only began storing which " +
          "project a spend was for partway through, and it is append-only, so entries older than " +
          "that carry no project and can never match the filter — they are marked **project not " +
          "recorded** in the list, and the scoped reply says so, rather than letting an empty " +
          "answer read as \"this site cost nothing\".",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> What have I spent credits on lately?",
    returns:
      "One line per ledger entry — timestamp, signed credits, kind, the tool where there is one, " +
      "and which project the spend was for — newest first, with a pointer to " +
      "`get_credit_balance` for your current total, the `before_id` for the next page when the " +
      "list was cut, and a closing **Spent so far** line. Guidance when nothing has moved your " +
      "balance yet, when a cursor names no entry of yours, and when the history ends.",
  },

  get_credit_balance: {
    lead:
      "`get_credit_balance` reports your available credits — the running total of your credit ledger.",
    whatItDoes:
      "Sums your credit ledger, scoped to your account, and returns the available balance. Paid " +
      "tools debit credits when they run, and a balance of 0 blocks them until you top up.",
    preExampleSections: [
      {
        heading: "Having credits is not always enough",
        body:
          "The tools that read live data from a paid third-party SEO provider need a **paid** " +
          "balance: they are refused on an account that has never bought anything, however many " +
          "trial credits are left. The reply says so, because the balance alone reads as " +
          "permission — a trial account seeing a healthy number concluded \"mine is not zero, so " +
          "it works\", and it did not.\n\n" +
          "Buying any credit pack clears it, and **the reply says which side of the rule your " +
          "own account is on**: an account that has bought credits is told the vendor tools are " +
          "unlocked, one that has not is told what unlocks them. Both wordings name the rule, so " +
          "it stays knowable either way. Which tools are gated is on each tool's own page and in " +
          "[Billing & Credits](/docs/billing-and-credits).",
      },
    ],
    example: "Ask your MCP client in plain language:\n\n> How many credits do I have left?",
    returns:
      "Your available credit balance, followed by the paid-balance rule above, worded for the " +
      "side of it your account is on.",
  },

  crawl_site: {
    lead:
      "`crawl_site` crawls the website behind one of your projects — following its sitemap and " +
      "its own links, respecting `robots.txt` — and records the pages for later audits. It is " +
      "**asynchronous**: the call returns a `job_id` immediately instead of waiting for the crawl to " +
      "finish, so the MCP request never times out on a large site. The crawl is charged only when it " +
      "runs — a crawl that reaches no pages is not charged.",
    whatItDoes:
      "Queues a crawl for the project's domain and hands you a `job_id`. A background worker runs the " +
      "crawl and stores the result; you check progress with " +
      "[`get_job_status`](/docs/tools-reference/get-job-status).",
    preExampleSections: [
      {
        heading: "What counts as the site",
        body:
          "A site's apex and its `www.` twin are **one scope**, not two. `example.com` and " +
          "`www.example.com` are the same site to the crawler, in the sitemap and in every link " +
          "it follows. Strict same-origin was the old rule, and on a www-canonical site it " +
          "produced a crawl of **zero pages**: the seed redirected off-origin on the first hop. " +
          "Only the leading `www.` label is folded — `blog.example.com` is a different site and " +
          "is not crawled.\n\n" +
          "Infrastructure paths are left out: `/cdn-cgi/` and `/.well-known/` are the CDN's and " +
          "the protocol's plumbing, not the customer's pages, and counting them would inflate " +
          "both the crawl and the page count quoted before it. They are excluded from the " +
          "sitemap, from link following, and from the free size check alike.",
      },
      {
        heading: "Large sites, and why the page count is a floor",
        body:
          "Each crawl covers up to **100 pages** — and stops at a **{{CRAWL_TIME_BUDGET}}-second " +
          "time budget**, whichever comes first. On a slow or large site the clock is usually what " +
          "runs out: one measured whole-site crawl returned 51 pages and stopped on TIME, not at " +
          "the page limit, for the same flat price. Coverage therefore varies between runs of the " +
          "same site, and the finish summary says which ceiling stopped that run. To crawl a " +
          "bigger site — or to cover a section fully rather than partly — target it with " +
          "`include_paths` — for example `[\"/blog\"]` — and run one focused crawl per section; " +
          "this keeps every crawl within both ceilings and spends predictably.\n\n" +
          "Before queuing, `crawl_site` runs a quick, **free** size check, and any page count it " +
          "quotes is a **lower bound** — \"at least N pages\", never \"~N\". Both ways of sizing " +
          "a site are floors by construction: reading the sitemap is bounded by how much of it " +
          "is read, and the fallback counts only the links on your homepage. On one measured " +
          "site the check said 28 and the crawl's own queue found at least 222. A \"~\" reads as " +
          "\"approximately\", i.e. as likely-high as likely-low, and it never is — so the " +
          "wording says which direction it can be wrong in. Where the floor came from is named " +
          "too, and the homepage-only case says outright that the real site is very likely " +
          "larger.\n\n" +
          "If your site is large, the call first returns a **confirmation** — nothing is charged " +
          "— stating this run's flat cost and, kept separate, an **informational projection** of " +
          "what crawling the whole site would take at the current rate. The projection is never " +
          "what you are charged; it just means a big site can't silently run up cost. Re-run " +
          "with `\"confirm\": true` to proceed, or narrow the scope with `include_paths`.",
      },
      {
        heading: "Starting the crawl from the pages that already rank",
        body:
          "A crawl seeds from your sitemap and your homepage, and stops at the page cap — and a " +
          "sitemap is not ordered by importance. On one measured site that combination meant the " +
          "single **highest-traffic page never entered the crawl at all**: it sat too deep in the " +
          "sitemap to survive the cap, on every run.\n\n" +
          "`seed_from_ranking_pages: true` starts the crawl from the pages DataForSEO reports as " +
          "ranking for your domain, so they are fetched first — right after the homepage and " +
          "ahead of the sitemap.\n\n" +
          "**It is off by default, and it is a separate charge.** The ranking list is a paid " +
          "DataForSEO lookup — the same one [`my_pages`](/docs/tools-reference/my-pages) makes — " +
          "so it is billed at that tool's price, on its own line in your credit history, under " +
          "the name `my_pages`. The crawl itself is unchanged: `crawl_site` costs what it has " +
          "always cost, whether you seed or not. Like `my_pages`, seeding needs a paid credit " +
          "balance.\n\n" +
          "**If it produces nothing, you pay nothing.** A lookup that names no page this crawl " +
          "can use — because it returned nothing, because the pages it named are on another host, " +
          "or because they all fall outside your `include_paths` — is not charged, and the crawl " +
          "is queued without the seeds. The same holds if the lookup cannot run at all. The reply " +
          "always says which of those happened, how many pages were used as seeds, and how many " +
          "were left out and why.\n\n" +
          "Seeds buy no privileges. Each one is still checked against your `include_paths`, " +
          "against `robots.txt` and against the same-site rule, and each counts towards the page " +
          "cap like any other URL — a seed is a page the crawl starts from, not a page it may " +
          "break its own rules for. The lookup runs with the same defaults as `my_pages` (United " +
          "States, English); for another market, run `my_pages` yourself.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Crawl my example.com project.\n\nThe tool replies " +
      "with a `job_id`. Poll it until the job is done:\n\n> What's the status of job `<job_id>`?",
    returns:
      "A `job_id`, a `status` of `queued or already running`, and the `estimated_credits` the " +
      "crawl will cost — plus, when the free size check sized the site, how many pages it found " +
      "**at least** and how many of them this one crawl covers. The status says both because a " +
      "worker usually claims the job within a second: the row is created `queued`, and by the " +
      "time the `job_id` reaches you it is normally already `running`.\n\n" +
      "If a crawl of this project is **already in flight**, the call returns that job's `job_id` " +
      "instead of starting a second one — nothing is queued and nothing is charged. A second " +
      "crawl of the same project is a second full charge for the same pages, so it is never " +
      "started on your behalf without you asking again after the first one finishes.\n\n" +
      "Feed the `job_id` to " +
      "[`get_job_status`](/docs/tools-reference/get-job-status): while the crawl runs it reports " +
      "the pages crawled and skipped so far, so a job that is working and a job that is stuck no " +
      "longer look alike, and when it finishes it carries the summary.",
  },

  get_job_status: {
    lead:
      "`get_job_status` reports on an asynchronous job — such as a " +
      "[`crawl_site`](/docs/tools-reference/crawl-site) run — by its `job_id`. It is how you follow an " +
      "async tool from `queued` to `succeeded` (or `failed`).",
    whatItDoes:
      "Looks up the job under your account and returns its current status, its lifecycle " +
      "timestamps, how long it has taken, and — once it succeeds — a short summary of the result. " +
      "A job that does not belong to you is reported as not found, the same as an unknown id. It " +
      "is not crawl-only: a [`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) job is " +
      "summarized here too, and which summary you get is decided by the **shape of the stored " +
      "result**, not by the tool's name.",
    preExampleSections: [
      {
        heading: "A running job says how far it has got",
        body:
          "While a crawl is running, each poll reports the pages crawled and skipped **so far**, " +
          "with the moment that count was taken. Before this, every poll of a 90-second job " +
          "returned the same string, so a job that was working and a job that was stuck looked " +
          "exactly alike — and the only way to tell them apart was to wait and find out.\n\n" +
          "Every status line also carries a duration. When a job's stored timestamps contradict " +
          "each other, the line says **timing unavailable** rather than printing a figure; a " +
          "negative or impossible duration is not a measurement, and rows written before that was " +
          "fixed still exist.",
      },
      {
        heading: "Which site, and what to do next",
        body:
          "Every reply names the project the job ran against — by DOMAIN, in the same clause and " +
          "the same words [`list_jobs`](/docs/tools-reference/list-jobs) uses, so the list you " +
          "came from and the detail you asked for cannot describe one job two ways. A job with " +
          "no project scope says so, and a project you have since removed falls back to the id " +
          "it was recorded with.\n\n" +
          "A finished job ends with the step that follows it: a crawl points at the audits that " +
          "read it, a Search Console pull at the tools that read a pull. A failed job says how " +
          "to retry and where to go if it keeps failing. A job whose tool has no follow-up " +
          "routed for it says nothing rather than guessing one — a suggestion that cannot read " +
          "the result is worse than none.",
      },
    ],
    example:
      "After `crawl_site` gives you a `job_id`, ask your MCP client:\n\n> What's the status of job " +
      "`<job_id>`?\n\nRepeat until the status is `succeeded`. A finished crawl summarizes how many " +
      "pages were crawled, how many were skipped, and how many issues were found.",
    returns:
      "The job `status` (`queued`, `running`, `succeeded`, or `failed`), its created / started / " +
      "finished timestamps and elapsed time, **which of your sites it ran against**, a live page " +
      "count while a crawl runs, and — on success — a result summary, or the error message on " +
      "failure. A crawl summary also names the **dominant reason** pages were skipped, and says " +
      "outright when the **homepage** was among them: \"0 issues found\" must not be readable as " +
      "\"clean\" while the homepage never got fetched. A finished or failed job also ends with " +
      "the step that follows it. A job you cannot reach — an unknown `job_id` or somebody " +
      "else's — comes back as an **error**, not as an empty answer.",
  },

  pull_gsc_data: {
    lead:
      "`pull_gsc_data` fetches your project's Google Search Console performance for **two adjacent " +
      "windows** — the most recent `days`-day period and the `days`-day period right before it — and " +
      "stores them so the discovery tools ([`find_quick_wins`](/docs/tools-reference/find-quick-wins), " +
      "[`detect_cannibalization`](/docs/tools-reference/detect-cannibalization), " +
      "[`analyze_content_decay`](/docs/tools-reference/analyze-content-decay)) can read them without " +
      "calling Google again. [Connect Search Console](/docs/tools-reference/connect-gsc) first.",
    whatItDoes:
      "Using your project's encrypted refresh token, it mints a short-lived Google access token and " +
      "runs `searchAnalytics.query` for both windows, broken down by **query and page**. The two " +
      "windows are equal length and adjacent, so the discovery tools can compare \"now\" against " +
      "\"before\". The result is stored against your project; the discovery tools read the most recent " +
      "pull.\n\nOnly a completed pull is charged, and every refusal below happens before anything " +
      "is spent — you are **not** charged, and each one says so:\n\n" +
      "- the project is **archived**;\n" +
      "- the project has **no Search Console connection** — no Google account is attached yet;\n" +
      "- the connection has **no matched property**, so there is nothing to query;\n" +
      "- Google **refuses the property** (403). The answer names the property and the two things " +
      "that clear it: have an owner grant this account access, or connect an account that " +
      "already has it;\n" +
      "- the Google **credential is dead** (access revoked or expired). The answer names the " +
      "account and hands you the re-approval link — and SeoGrep also records that the account " +
      "needs reconnecting, which is why " +
      "[`list_gsc_properties`](/docs/tools-reference/list-gsc-properties) and " +
      "[`whats_next`](/docs/tools-reference/whats-next) start saying so straight afterwards;\n" +
      "- the Google call fails for any other reason.",
    example:
      "Ask your MCP client in plain language:\n\n> Pull the last 90 days of Search Console data for my " +
      "example.com project.\n\nThen run a discovery tool over it:\n\n> Find quick wins for example.com.",
    returns:
      "A summary of the pull: the two window date ranges, how many `(query, page)` rows each holds, and " +
      "a `job_id` for the stored result. Feed the project into a discovery tool next.",
    postReturnsSections: [
      {
        heading: "Limitations (v0)",
        // Every number below that the CODE decides is a token, DERIVED at render time from the
        // built MCP constants — the offset from GSC_FRESHNESS_LAG_DAYS (gsc-data/windows.ts) and
        // the cap from MAX_ROW_LIMIT (gsc-data/pull.ts). The two figures left as literals are NOT
        // ours to derive: the "~2–3 day" delay is what Google documents, and the "5 days" is the
        // worst lag the guard was measured against (content-decay.test.ts) — neither moves when a
        // constant does.
        body:
          "- Search Console finalizes a day's data with a ~2–3 day delay, and reports a day it has " +
          "not finalized as **zero** rather than as missing. Both windows therefore end " +
          "**{{GSC_LAG_DAYS}} before today** instead of running up to it, which clears the delay " +
          "Google documents with margin to spare: measured against lags of up to 5 days, no " +
          "unfinalized day is read as a traffic collapse. It is a bounded guard, not an absolute " +
          "one — if Search Console ever falls further behind than that, unfinalized days re-enter " +
          "the window and a run of zeros can still look like a drop. The trade-off: the newest " +
          "{{GSC_LAG_DAYS}} are not analyzed, so a genuine drop surfaces here up to " +
          "{{GSC_LAG_DAYS}} after it begins.\n" +
          "- A single page of up to {{MAX_GSC_ROWS}} `(query, page)` rows is fetched per window; a " +
          "very large property is truncated to the top rows Google returns, and the pull says so " +
          "when it happens.",
      },
    ],
  },

  find_quick_wins: {
    lead:
      "`find_quick_wins` reads your latest [`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) and " +
      "surfaces the **quick wins**: `(query, page)` pairs that already rank just off the top of page " +
      "one and already draw impressions, where a small on-page push can convert that demand into " +
      "clicks. Run `pull_gsc_data` first.",
    whatItDoes:
      "From the pull's current window, it selects queries where your page ranks in **positions 8–20** " +
      "with **at least 20 impressions**, then prioritizes them by impressions (biggest opportunity " +
      "first, ties broken by the better position). Already-winning queries (position under 8) and " +
      "near-zero-demand long-tail queries are left out, so the list stays a focused shortlist " +
      "rather than a dump.\n\n" +
      "A \"page\" here is a **document**: rows that differ only by a `#fragment` are added " +
      "together before the bands are read. That changes outcomes in both directions — two " +
      "anchor rows below the impression floor can clear it as one page, and no `#anchor` URL is " +
      "ever printed as the page to go and fix.",
    example:
      "Ask your MCP client in plain language:\n\n> What are the quick wins for my example.com project?",
    returns:
      "A prioritized list of quick-win opportunities, **grouped by page** — each page with its " +
      "queries, their average positions, impressions, clicks, and CTR — best opportunity first. " +
      "The list is capped; past the cap the reply says how many more pairs cleared the bands, so a " +
      "shortlist is never mistaken for the whole set. If nothing clears the bands, it says so (and " +
      "you are still charged for the delivered analysis).\n\nEach page also carries **one recommended " +
      "next move**, derived from that page's own rows: which of its queries to push, from its current " +
      "position into the nearest band above it, and whether to widen the page to cover all the " +
      "near-miss queries riding on it or tighten it around the single one.\n\nEvery reply ends with the same footer: the window that was analyzed against " +
      "the one before it, a caveat when either window hit the row cap, when the pull was taken " +
      "plus a sentence once that is old, and — when your Search Console credential has stopped " +
      "working — a warning to reconnect.",
    postReturnsSections: [
      {
        heading: "Inherited limits",
        body: INHERITED_LIMITS_INTRO +
          "so on a large property a quick win outside the top rows Google returned is not visible " +
          "here — the analysis prints a caveat when the pull hit that cap.\n\n" +
          INHERITED_LIMITS_FRESHNESS,
      },
    ],
  },

  detect_cannibalization: {
    lead:
      "`detect_cannibalization` reads your latest " +
      "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) and finds **keyword cannibalization**: " +
      "queries where two or more of your own pages each pull a meaningful share of the impressions, " +
      "splitting the ranking signal. Consolidating or clearly differentiating those pages usually " +
      "lifts the query. Run `pull_gsc_data` first.",
    whatItDoes:
      "From the pull's current window, it groups rows by query and flags a query when **two or more of " +
      "its pages** each clear both floors: at least **10 impressions** and at least a **10% share** of " +
      "that query's impressions. A dominant page plus a negligible straggler is not flagged — only " +
      "genuine competition. Groups are ordered by total impressions, biggest query first.\n\n" +
      "Rows for the same page that differ only by a `#fragment` are folded into one page " +
      "**before** any of that is read, so a page competing with its own section anchors is not " +
      "a group.",
    preExampleSections: [
      {
        heading: "Queries for your own brand are excluded, and counted",
        body:
          "Several of your pages ranking for your own brand name is **normal** — it is what " +
          "Google's sitelinks look like in this data — and consolidating those pages would be " +
          "self-harm. So branded queries are taken out of the list.\n\n" +
          "They are not taken out silently. The reply names how many were excluded and which " +
          "queries they were, because your biggest query disappearing without explanation is " +
          "its own problem. **This matters most when the list ends up empty**: \"no " +
          "cannibalization found\" can mean nothing was contested, or that everything contested " +
          "was branded — the exclusion line under it is what tells you which, so read it before " +
          "concluding the site is clean.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Do I have any keyword cannibalization on example.com?",
    returns:
      "A list of cannibalized queries, each with its competing pages and their impressions, clicks, and " +
      "average position (main contender first), followed by the branded-query exclusion line when " +
      "there was one. If no query is contested, it says so (and you are still charged for the " +
      "delivered analysis).\n\nWhere the data supports it, a query also carries a **consolidation " +
      "recommendation**: which URL to keep and which to canonicalize or merge into it, with the " +
      "positions and impressions that decision was read from. It is deliberately **omitted** when the " +
      "competing pages are within about half a SERP page of each other, or when a lower-ranking page " +
      "is earning more clicks than the better-ranked one — naming a keeper there would be a guess, and " +
      "the wrong keeper means consolidating away the page that was working.\n\nYour **home page is " +
      "never the page it tells you to fold**. A home page ranks for many queries at once, so " +
      "canonicalizing it into one of them trades away every other query it holds — and `rel=canonical` " +
      "is a strong signal to Google rather than a setting you can cheaply take back. When your home " +
      "page is one of the competitors it is named and explicitly left out of the decision; when it is " +
      "the only page behind the leader there is no recommendation at all. It can still be the page you " +
      "are told to **keep**.\n\nEvery reply ends with the same four-line footer the other two " +
      "discovery tools carry: the window that was analyzed against the one before it, a caveat " +
      "when either window hit the row cap, when the pull was taken plus a sentence once that is " +
      "old, and — when your Search Console credential has stopped working — a warning to " +
      "reconnect.",
    postReturnsSections: [
      {
        heading: "Inherited limits",
        body: INHERITED_LIMITS_INTRO +
          "and a truncated pull also truncates the denominator each impression **share** is measured " +
          "against, so on a large property a page's share can read higher than it is — the analysis " +
          "prints a caveat when the pull hit that cap.\n\n" +
          INHERITED_LIMITS_FRESHNESS,
      },
    ],
  },

  analyze_content_decay: {
    lead:
      "`analyze_content_decay` compares the two windows in your latest " +
      "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) and flags **decaying pages**: pages whose " +
      "clicks fell by a meaningful amount and a meaningful proportion between the previous window and " +
      "the current one. These are the pages most worth a refresh, re-optimization, or internal-link " +
      "boost before the slide continues. Run `pull_gsc_data` first.",
    whatItDoes:
      "It sums each page's clicks across both windows (a page can rank for many queries) and flags a " +
      "page when it lost **at least 5 clicks** AND **at least 30%** of its previous clicks. Both " +
      "thresholds must be met, so a tiny wobble or a large-but-proportionally-small dip is left out. " +
      "Results are ordered by clicks lost, biggest bleed first.\n\n" +
      "Two rules sit alongside those thresholds. A page with **no clicks at all** in the previous " +
      "window is skipped outright — with no baseline there is nothing that could have decayed, " +
      "whatever the arithmetic says. And a \"page\" is a **document**: rows differing only by a " +
      "`#fragment` are summed together in **both** windows first, because Google routinely moves " +
      "an article's clicks between its bare URL and its anchors, and reading those as two pages " +
      "manufactures a decay on one and a rise on the other.",
    example:
      "Ask your MCP client in plain language:\n\n> Which pages on example.com are losing traffic?",
    returns:
      "A list of decaying pages — each with its previous and current clicks, the clicks lost, and the " +
      "drop as a percentage — biggest loss first, and not capped. If nothing is decaying, it says so " +
      "(and you are still charged for the delivered analysis).\n\nEach page carries **what to do about " +
      "it**, and which of three instructions you get depends on how the page fell. A page down to no " +
      "clicks at all is told to verify it is still indexed, reachable and not redirected **before** " +
      "rewriting anything — that is also the shape a truncated pull manufactures. A page that lost " +
      "most of its clicks but not all is told to re-target rather than tweak. A page in the middle " +
      "still ranks and still earns, so that one gets the refresh-and-internal-links advice.\n\nEvery reply ends with the same footer: the window that was analyzed against " +
      "the one before it, a caveat when either window hit the row cap, when the pull was taken " +
      "plus a sentence once that is old, and — when your Search Console credential has stopped " +
      "working — a warning to reconnect.",
    postReturnsSections: [
      {
        heading: "Inherited limits",
        body: INHERITED_LIMITS_INTRO +
          "and a page that fell out of a truncated window's top rows is read as having lost those " +
          "clicks, so a large property can show a decay that never happened — the analysis prints a " +
          "caveat when either window hit the cap.\n\n" +
          INHERITED_LIMITS_FRESHNESS,
      },
    ],
  },

  audit_onpage: {
    lead:
      "`audit_onpage` reviews the on-page SEO of the pages captured by your project's most recent " +
      "[`crawl_site`](/docs/tools-reference/crawl-site) run. It is **synchronous**: it returns the " +
      "findings immediately. Run `crawl_site` first — if the project has never been crawled, the tool " +
      "tells you so and charges nothing.",
    whatItDoes:
      "Runs a rule engine over every crawled page and reports, per page, issues such as:\n\n" +
      "- **Titles** — missing, very short (under ~10 characters), or duplicated across pages.\n" +
      "- **Meta descriptions** — missing, very short (under ~50 characters), or duplicated.\n" +
      "- **Headings** — a missing `h1`, or more than one `h1`.\n" +
      "- **Canonicals** — missing, or pointing to a different URL than the page itself. The " +
      "canonical is read from the HTML as served and never after JavaScript, which is also where " +
      "Google asks you to declare it.\n" +
      "- **Thin content** — pages under ~200 words.\n"  +
      "- **Images with no alt text** — how many of the images on the page have none.\n" +
      "- **A title that merely repeats the h1** — the search snippet spent on words the visitor " +
      "is about to read anyway. Only checked when the page has exactly one `h1`.\n" +
      "- **No OpenGraph title or description** — the page has no share preview at all. Both " +
      "missing is one finding; declaring one and not the other is a style choice, not a gap.\n" +
      "- **A missing `html lang`** attribute.\n" +
      "- **A heading hierarchy gap** — `h3`s under an `h1` with no `h2` between them.\n\n" +
      "**There is no maximum length for a title or a meta description, and this tool does not " +
      "invent one.** Google publishes no character limit for either: a title link is shortened to " +
      "the width of the device when it is shortened at all, and a snippet is generated mostly from " +
      "the page's own content, with the meta description used only sometimes. Earlier versions of " +
      "this tool reported \"title too long (over 60 characters)\" as if 60 were a published rule. " +
      "It is not, and that finding has been removed rather than re-tuned. The remaining length " +
      "signals are the short ones, and they are claims about the page, not about Google.\n\n" +
      "Thresholds are conservative \"worth a look\" signals, not hard rules. A rule whose input " +
      "an older crawl never recorded produces **no finding** for those pages rather than a " +
      "false one — not-measured and not-present are kept apart.\n\n" +
      "Alongside the per-page findings it reports **duplicate content**: groups of pages that " +
      "share one text fingerprint. That is a site-level finding, so it is deliberately not part " +
      "of the per-page issue counts and cannot be inferred from them.",
    example:
      "Ask your MCP client in plain language:\n\n> Run an on-page audit for my example.com project.",
    returns:
      "A summary of issue counts, then the duplicate-content groups with their member URLs, then " +
      "a per-page list of findings. Pages with no issues are counted but not listed. The per-page " +
      "list is capped, and past the cap the reply says how many further pages had findings — a " +
      "short list never reads as a short audit." + AUDIT_SCOPE_LINE + AUDIT_REPEAT_LINE,
  },

  audit_tech: {
    lead:
      "`audit_tech` reviews the technical health of the pages captured by your project's most recent " +
      "[`crawl_site`](/docs/tools-reference/crawl-site) run. It is **synchronous** and returns its " +
      "findings immediately. Run `crawl_site` first — with no crawl on record the tool says so and " +
      "charges nothing.",
    whatItDoes:
      "Summarizes the crawl from a technical angle. Fifteen sections, each named below by the " +
      "exact heading it carries in the reply, so what you read here is what you can search for " +
      "in the output:\n\n" +
      "- **HTTP status** — how many pages returned 2xx / 3xx / 4xx / 5xx, with the 4xx and 5xx " +
      "page URLs listed. A page whose stored status is missing or unreadable belongs to none " +
      "of those four, and where there is one the section says how many and names them — so " +
      "the four counts and the page total in the heading are never quietly different " +
      "numbers.\n" +
      "- **Redirects surfaced** — the redirects the crawler surfaced (off-origin redirects, " +
      "redirect loops, and redirects onto an already-crawled URL).\n" +
      "- **Not crawled** — the URLs that were discovered but skipped, grouped by reason (blocked " +
      "by `robots.txt`, timed out, non-HTML, and so on).\n" +
      "- **Robots conflicts** — pages marked `noindex` that are still linked internally. " +
      "`none` counts as `noindex` here, because that is what Google reads it as.\n" +
      "- **Slow pages** — a fetch that took over three seconds, redirect hops included, because " +
      "that is what a visitor actually waits for.\n" +
      "- **Heavy pages** — an HTML document over a megabyte and a half. The markup alone; images " +
      "are never counted here.\n" +
      "- **Redirect chains** — two or more hops to reach the destination, printed as the whole " +
      "trail.\n" +
      "- **X-Robots-Tag conflicts** — the response header says `noindex` while the page's own " +
      "meta tag does not, which is the half of the disagreement you cannot see in the HTML.\n" +
      "- **Deep pages** — four or more clicks from a crawl seed.\n" +
      "- **No internal links found** — the orphan signal: no page in this crawl links there.\n" +
      "- **Sitemap vs crawl** — what is in the sitemap and was never crawled, and what was " +
      "crawled and is absent from the sitemap.\n" +
      "- **Broken internal links** — a link whose target the crawl fetched and got a 4xx or 5xx " +
      "from.\n" +
      "- **Hreflang codes not valid** — an alternate whose language code cannot work: a region " +
      "given where a language belongs (`hreflang=\"us\"`), a three-letter code, or a reserved " +
      "region like `EU`. Google needs an ISO 639-1 language, optionally with an ISO 3166-1 " +
      "region.\n" +
      "- **Hreflang sets with no x-default** — a page offering several languages and no " +
      "fallback for a visitor whose language is not among them. x-default is **recommended, " +
      "not required**, and the heading says so.\n" +
      "- **Hreflang not reciprocated** — this page names that one as its alternate and gets no " +
      "return link, so Google ignores the pair. Only alternates whose target THIS crawl also " +
      "fetched can be checked, and the section says how many pointed elsewhere; only the HTML " +
      "channel is read, so a return link served in a header or a sitemap is not seen.\n\n" +
      "Redirects appear in three places, on purpose, and only one of the three is a repeat. The " +
      "crawler follows a successful redirect and records the destination, so a redirect never " +
      "becomes a duplicate page — it surfaces as a **skip reason**. **Redirects surfaced** is " +
      "that one skip category promoted to a section of its own, which is the repeat: the same " +
      "URL is printed there with its reason, and again under **Not crawled** inside the full " +
      "skip ledger, whose per-reason grouping is what lets the skip counts reconcile. The " +
      "third is different data rather than a repeat — a page's own hop trail, read back as a " +
      "**chain** when it took more than one hop.\n\n" +
      "Four of the fifteen print on every run, at zero as readily as at fifty — **HTTP status**, " +
      "**Redirects surfaced**, **Not crawled** and **Robots conflicts** — because each is a " +
      "count this engine always takes, so a zero there is a measurement rather than a silence. " +
      "Every section after them prints only when it has rows, and that too is deliberate: on a " +
      "crawl stored before a signal existed the list is empty because nobody looked, and a " +
      "heading reading \"Slow pages: 0\" would report a measurement that never happened.\n\n" +
      "Two sections are exceptions in the other direction, and both print at zero because a zero " +
      "there is a measurement rather than a silence. The **sitemap comparison** prints even at " +
      "zero and zero, because a diff that exists means the sitemap **was read**, and a measured " +
      "agreement is worth stating where an empty list elsewhere would only mean an unmeasured " +
      "axis. **Hreflang not reciprocated** prints at zero whenever an alternate pointed at a page " +
      "this crawl did not fetch, and says how many: those alternates were not checked, and a " +
      "reader told nothing would read the silence as \"they all point back\".\n\n" +
      "The orphan list carries its own caveat: the crawl is bounded, so a page whose only " +
      "linking page was never fetched lands there too.",
    example:
      "Ask your MCP client in plain language:\n\n> Run a technical audit for my example.com project.",
    returns:
      "Always the four guaranteed sections — the status distribution, the redirects surfaced, " +
      "the skipped URLs by reason, and the noindex-but-internally-linked conflicts — each at " +
      "its own count, zero included. Then whichever of the remaining sections this crawl gave " +
      "rows for, plus the sitemap comparison whenever a sitemap was read. So a short reply is a " +
      "clean crawl, not a shallow audit. Every list is capped, and past the cap says how many " +
      "more there were." + AUDIT_SCOPE_LINE + AUDIT_REPEAT_LINE,
  },

  audit_schema: {
    lead:
      "`audit_schema` reviews the structured data on the pages captured by your project's most recent " +
      "[`crawl_site`](/docs/tools-reference/crawl-site) run. It is **synchronous** and returns its " +
      "findings immediately. Run `crawl_site` first — with no crawl on record the tool says so and " +
      "charges nothing.",
    whatItDoes:
      "Reports on the JSON-LD found across the site:\n\n" +
      "- **Coverage** — how many pages carry JSON-LD structured data and how many have none.\n" +
      "- **Type spread** — a site-wide count of the schema.org `@type` names in use (`Organization`, " +
      "`WebSite`, `Article`, `Product`, and so on).\n" +
      "- **Gaps** — the URLs of pages with no structured data at all.\n" +
      "- **Types that no longer produce a Google rich result** — printed only when the site " +
      "declares one. `FAQPage` and `HowTo` are no longer in Google's rich-result gallery, so " +
      "the markup is reported as present and left alone: it is not checked for missing fields, " +
      "because repairing it would buy nothing.\n\n" +
      "**Detection is JSON-LD only** — microdata and RDFa are not read at all, so a page marked " +
      "up that way counts here as having no structured data.\n\n" +
      "Coverage is what this tool is for, and coverage is what it always reports. On a crawl " +
      "that stored the JSON-LD **bodies**, it additionally checks the required fields of the " +
      "types it knows — see below. On an older crawl that stored only the type names, it checks " +
      "nothing of the sort and says so. **The closing note of every reply tells you which of the " +
      "two you just got**, and names how many pages were checked; a reader should trust that " +
      "line over any general statement, here or in the tool list.",
    preExampleSections: [
      {
        heading: "What it checks in a stored JSON-LD body",
        body:
          "For a short, fixed list of schema.org types — each one backed by a type Google's own " +
          "gallery documents — it checks that the fields without which " +
          "the markup says nothing are declared — a `Product` with no `offers`, an `Article` " +
          "with no `datePublished`, a `BreadcrumbList` with no trail, a `LocalBusiness` with no " +
          "address. A type **not** on that list is **not judged at all**: schema.org has " +
          "hundreds of types, and inventing requirements for the ones nobody considered would " +
          "produce findings you could not trust.\n\n" +
          "A block that is not valid JSON is **reported, not skipped**. A parser that cannot " +
          "read it is a stand-in for a search engine that cannot read it either, and it is " +
          "invisible in the rendered page — nobody finds it by looking.\n\n" +
          "**This is not full structured-data validation.** It is a required-field check over a " +
          "handful of types, on the blocks that were stored. Only the first few blocks of a " +
          "page are kept, and each is kept only up to a length cap, so a page whose markup was " +
          "partly stored is listed as such and the reply says the fields were checked on the " +
          "stored blocks only. Absence of a finding is not a clean bill of health.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Run a structured-data audit for my example.com " +
      "project.",
    returns:
      "The JSON-LD coverage counts, the site-wide `@type` spread, and the list of pages with no " +
      "structured data. Where bodies were stored, it also lists the pages missing a required " +
      "field (naming the type and the fields), the pages whose JSON-LD could not be parsed, and " +
      "the pages whose blocks were only partly stored. Each of those three sections is printed " +
      "only when it has rows, so a crawl carrying no bodies returns exactly the coverage report " +
      "it always did — an absent section is never a clean result." + AUDIT_SCOPE_LINE + AUDIT_REPEAT_LINE,
  },

  audit_speed: {
    lead:
      "`audit_speed` measures how fast your pages actually load, using **Google Lighthouse** run " +
      "by DataForSEO. Unlike the other audits it does **not** read a crawl — you name the page " +
      "URLs and each one gets its own measurement — so no `crawl_site` run is needed first. It is " +
      "**synchronous**: the table comes back immediately, with no background job to poll.",
    whatItDoes:
      "Pass between one and five page URLs. Each is measured on its own, and each page block " +
      "reports:\n\n" +
      "- **Performance score** — Lighthouse's own 0–100 score for the page.\n" +
      "- **Lab Core Web Vitals and friends** — First Contentful Paint, Largest Contentful Paint, " +
      "Speed Index, Total Blocking Time, Cumulative Layout Shift, and Time to Interactive, each " +
      "printed with Lighthouse's own formatting. Largest Contentful Paint and Cumulative Layout " +
      "Shift also carry Google's band — **good**, **needs improvement** or **poor** — with the " +
      "\"good\" boundary named beside it (2,500 ms and 0.1). The other four are diagnostics with " +
      "no published threshold, so they are printed without a verdict rather than given an " +
      "invented one.\n" +
      "- **The biggest opportunities** — the improvements Lighthouse estimates the largest " +
      "load-time saving for, largest first, with the estimated milliseconds saved. A short " +
      "list, not the full audit: only the handful with the largest savings are printed, an " +
      "audit Lighthouse estimates no saving for is dropped rather than listed at zero, and an " +
      "audit your page already **passes** is dropped even when Lighthouse still attaches a " +
      "saving to it — a completed item does not belong on a to-do list.\n\n" +
      "**These are lab measurements, on a desktop run.** Lighthouse loads the page once, on the " +
      "vendor's machine, under simulated throttling, emulating a desktop browser — mobile is not " +
      "measured. That is a repeatable diagnostic, not a record of what your visitors experienced " +
      "— the field metrics Google reports from real Chrome users (including Interaction to Next " +
      "Paint) are a different measurement, and this tool does not claim them.\n\n" +
      "**One run is a sample, not a verdict.** A lab run varies: the same page measured twice, " +
      "minutes apart, can come back tens of points and a second of Largest Contentful Paint " +
      "apart. Read a single run as a signal, and re-run before acting on a number sitting near a " +
      "band boundary. What Google actually ranks on is field data at the 75th percentile of real " +
      "visits, which this tool does not read.\n\n" +
      "A metric Lighthouse did not produce for a page gets **no line at all**, and a page it could " +
      "not score says so in words. Nothing is filled in with a zero: on a speed report a " +
      "fabricated zero would read as the best possible news.\n\n" +
      "URLs are canonicalized before anything is charged. A bare domain is read as its https home " +
      "page, the same page named twice is measured once, and an address that is not a public " +
      "http(s) page — `localhost`, an internal hostname, a `file:` or `javascript:` URL — is " +
      "refused for free.",
    preExampleSections: [
      {
        heading: "Who can run it",
        body:
          "`audit_speed` needs a **paid credit balance**. Despite sitting in the audit family it " +
          "reads live data from a paid third-party provider — one real browser run per page — so " +
          "it is not available on trial credits — the refusal arrives before anything is " +
          "reserved and says outright that you were not charged. Buy any credit pack and it unlocks straight " +
          "away; your existing credits keep working for crawls, the other audits, reports and " +
          "Search Console tools.\n\n" +
          "If live DataForSEO access is unavailable on this deployment, the tool returns a clear " +
          "_\"page speed measurements are not yet enabled on this deployment\"_ message and " +
          "**charges you nothing** — no credits are reserved or spent. SeoGrep never returns " +
          "sample or placeholder figures dressed up as a real measurement.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> How fast is example.com's home page and " +
      "pricing page?\n\nThen hand a finding straight back to your assistant:\n\n> What would it " +
      "take to fix the biggest opportunity on the pricing page?",
    returns:
      "A heading naming how many pages were measured, that the run was a desktop one, that the " +
      "figures are lab measurements and that a single run varies; then one block per page — the " +
      "URL, when it was measured and by which Lighthouse version (and where it redirected to, if " +
      "it did), the performance score, the metric lines with their bands, and the " +
      "opportunity list.\n\nAn empty list, more than five URLs, and any address that is not a " +
      "public web page are all rejected before anything is charged; while live data is off you " +
      "get the \"not yet enabled\" message instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One call is one **flat price**, charged **once**, whether you measure one page or " +
          "five. Behind it, each page is its own Lighthouse run; if any of them fails, the whole " +
          "call fails and **you are not charged** — a partial table is never billed.",
      },
      {
        heading: "Limitations",
        body:
          "Results are **not stored**. Each call returns its measurement to the conversation and " +
          "nothing else keeps it, so there is no speed history in the dashboard yet and no " +
          "\"compared with last week\" — run it again to get a fresh measurement.\n\n" +
          "The five-URL cap per call is deliberate: a Lighthouse run is a real browser loading a " +
          "real page, which is why this is measured per page rather than across a whole site.",
      },
    ],
  },

  audit_content: {
    lead:
      "`audit_content` is the bridge between your Search Console data and your crawl. It takes " +
      "the queries your site already earns impressions for, finds the page Google shows for " +
      "each one, and reports the queries whose words appear **nowhere in that page's title or " +
      "h1**. It is **synchronous** and returns its findings immediately. Run both " +
      "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) and " +
      "[`crawl_site`](/docs/tools-reference/crawl-site) first — with either one missing the " +
      "tool says which to run and charges nothing.",
    whatItDoes:
      "It joins two things you have already paid for and calls no outside service. From your " +
      "latest pull it takes each `(query, page)` row; from your latest crawl it takes each " +
      "page's title and h1s. A query counts as **said** when every one of its meaningful words " +
      "appears somewhere in the title *or* an h1 of that page, matched case- and " +
      "accent-insensitively, and anywhere inside a word (so \"shoe\" is found in \"shoes\").\n\n" +
      "A short bilingual list of filler words (`the`, `and`, `for`, `ve`, `ile`, `bir`, and a " +
      "few more) is ignored — their presence in a title says nothing about whether the page " +
      "covers the query.\n\n" +
      "**Your own brand words are ignored too.** A query whose only missing words are your " +
      "site's own name is dropped from the list entirely, and a query missing your brand *and* " +
      "something else keeps only the something else. The reply says how many were dropped that " +
      "way. This is not a courtesy: reporting a firm to itself for not repeating its own name " +
      "in its titles is a finding nobody can act on, and a list of those crowds out the ones " +
      "you can. Everything else has to be there.\n\n" +
      "Both the title **and** the h1s are read, deliberately. A title trimmed to fit the search " +
      "result routinely drops a qualifier the heading keeps, and reading the title alone would " +
      "report every such page as a problem — a list of findings you cannot act on is worse than " +
      "no list. Results are ordered by impressions, biggest missed opportunity first.",
    preExampleSections: [
      {
        heading: "How much it could check",
        body:
          "The answer always states how many of your query/page pairs it was able to check and " +
          "across how many crawled pages, because this tool joins two measurements with " +
          "different reach. A crawl that covered 30 pages of a 300-page site produces a clean " +
          "report that means very little — and \"no mismatches found\" would read exactly like " +
          "a site whose titles are all correct. When queries point at pages your crawl never " +
          "reached, the reply says how many and points you back at " +
          "[`crawl_site`](/docs/tools-reference/crawl-site).",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Which pages on example.com rank for things " +
      "their titles don't mention?\n\nThen hand a finding straight back to your assistant:\n\n" +
      "> Rewrite that page's title so it covers the missing words.",
    returns:
      "**The coverage line comes first**, above the findings, together with the window the " +
      "Search Console figures cover, when that data was pulled, when the crawl was taken, and " +
      "how many queries were dropped as brand-only. A ratio that changes how you read the list " +
      "has to arrive before the list, not under it.\n\n" +
      "Then one line per mismatching query — the query, the page ranking for it, its " +
      "impressions and clicks, the words that are missing, how many of the query's words the " +
      "page does carry, and the page's current title — biggest opportunity first. The list is " +
      "capped; past the cap the reply says how many more pairs mismatch. If nothing mismatches, " +
      "it says so (and you are still charged for the delivered analysis)." + AUDIT_SCOPE_LINE,
    postReturnsSections: [
      {
        heading: "Inherited limits",
        body:
          "This audit sees only what its two inputs brought back. A pull fetches at most " +
          "**{{MAX_GSC_ROWS}}** `(query, page)` rows per window, so on a large property a " +
          "mismatch outside the top rows Google returned is not visible here — the analysis " +
          "prints a caveat when the pull hit that cap. The window also ends " +
          "**{{GSC_LAG_DAYS}} before today** rather than running up to it. On the crawl side, " +
          "only pages your last crawl actually reached can be checked, which is what the " +
          "coverage line above is for.\n\nA mismatch is a statement about the page **as " +
          "crawled**: a title you fixed after that crawl still shows up until you crawl again, " +
          "which is why the crawl's own date is printed with the findings.",
      },
    ],
  },

  research_keywords: {
    lead:
      "`research_keywords` looks up Google **search volume**, **CPC**, **competition**, **keyword " +
      "difficulty**, **search intent** and **search-volume trend** for up to 100 keywords at once, " +
      "powered by DataForSEO Labs. It is **synchronous** — it returns a table immediately, with no " +
      "background job to poll.",
    whatItDoes:
      "Given a list of keywords (plus an optional language and location), it returns one row per " +
      "keyword with:\n\n" +
      "- **Search volume** — average monthly Google searches.\n" +
      "- **CPC** — the average cost-per-click advertisers pay.\n" +
      "- **Competition** — the advertiser competition band (`HIGH` / `MEDIUM` / `LOW`).\n" +
      "- **Keyword difficulty** — how hard the keyword is to rank for, on a 0–100 scale.\n" +
      "- **Search intent** — the dominant intent behind the query (informational, commercial, " +
      "navigational or transactional), plus any secondary intents it also carries.\n" +
      "- **Search-volume trend** — how the volume moved month-over-month, quarter-over-quarter and " +
      "year-over-year, as signed percentages.\n\n" +
      "The first three are **always stated**, as `n/a` when the provider sent no figure: they are " +
      "the line's spine, and a row that quietly lost its volume column would read as a shorter " +
      "row rather than as a missing measurement. `n/a` there means \"nobody has a number for " +
      "this\", never \"nobody searches this\". The last three — difficulty, intent and trend — " +
      "are **left out** when the provider did not send them, so a row with nothing extra to say " +
      "stays short.\n\n" +
      "It also prints a one-line summary with the total monthly search volume across the batch.",
    preExampleSections: [
      {
        heading: "Who can run it",
        body:
          "`research_keywords` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits; the refusal arrives before " +
          "anything is reserved and says outright that you were not charged. Buy any credit pack and " +
          "it unlocks straight away. Your trial credits are untouched and keep working for crawls, " +
          "audits, reports and Search Console tools.\n\n" +
          "If live keyword data is unavailable on this deployment, the tool returns a clear " +
          "_\"keyword research is not yet enabled on this deployment\"_ message and **charges you " +
          "nothing** — no credits are reserved or spent. SeoGrep never returns sample or " +
          "placeholder figures dressed up as real data.\n\n" +
          "**You are also not charged for a lookup that comes back completely empty.** If the " +
          "provider returns no figure for a single one of your keywords, there is no table to hand " +
          "you, so the tool refuses the lookup with a message saying so and the credits are " +
          "returned to your balance. This tends to happen with keywords outside the provider's " +
          "Google Ads coverage — often non-English markets, or very rare terms — and the message " +
          "suggests trying a broader or more common phrasing for the same market. As soon as " +
          "**one** keyword in the batch comes back with something, the lookup is served and " +
          "charged normally.",
      },
      {
        heading: "No data is not zero",
        body:
          "A keyword the provider holds **nothing** on comes back as _\"no data returned for this " +
          "keyword\"_. It is never printed as `volume 0` — \"nobody has a figure for this\" and " +
          "\"nobody searches this\" are different facts that lead to different decisions — and a " +
          "genuine zero, when the provider does report one, is still printed as `volume 0`.\n\n" +
          "It adds **nothing** to the batch total, and it is worth being exact about how: no row " +
          "is filtered out of the sum, a missing volume simply counts as nothing. The arithmetic " +
          "is the same either way, but there is no filter to find if you go looking for one. " +
          "What makes such a keyword visible is the count in the header, not the total.\n\n" +
          "The same rule applies **field by field**, not just row by row. A keyword can come back " +
          "with a difficulty and an intent but no search volume — common in markets the provider's " +
          "advertising data covers thinly — and you get the figures it does hold, with the missing " +
          "ones marked `n/a` rather than the whole row being written off as empty.",
      },
      {
        heading: "Every keyword you asked about is answered for",
        body:
          "Your keyword list is accounted for in full. Alongside the two cases above there is a " +
          "third, and it gets its own sentence because it is a different fact:\n\n" +
          "- _\"no data returned for this keyword\"_ — the provider **sent a row** for it, and that " +
          "row holds no metrics.\n" +
          "- _\"DataForSEO returned no row for this keyword\"_ — **no row arrived at all**. That is " +
          "all we can honestly tell you: it is not a claim that nobody searches the term, nor that " +
          "the provider holds nothing on it.\n\n" +
          "Either way the keyword is named in the output, so it can never quietly vanish between " +
          "what you asked and what you read. The header's count covers **both** cases under one " +
          "figure — it answers \"how many of my keywords came back without data\", not which of " +
          "the two reasons applied; the lines themselves say that.\n\n" +
          "A keyword list that is empty or all whitespace is refused before anything is " +
          "reserved, and the refusal says you were not charged.",
      },
      {
        heading: "How fresh the CPC is",
        body:
          "Under the table you get the date the provider last refreshed its **CPC and competition** " +
          "figures — the oldest date in your batch, because a table is only as fresh as its stalest " +
          "row. Past 30 days the line says so in a sentence and tells you to treat those two " +
          "columns as indicative rather than current.\n\n" +
          "This matters because CPC is an **estimate of an auction**, not a measurement of your " +
          "account: the same keyword can be quoted meaningfully differently by different providers " +
          "and on different days. Search volume is the number this tool is bought for, and it is " +
          "not affected by that — but a bid figure deserves a date next to it.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> What's the search volume for \"seo software\" and " +
      "\"rank tracker\"?",
    returns:
      "A table with one line per keyword you asked about — search volume, CPC, competition, and " +
      "(when the provider returns them) keyword difficulty, search intent and volume trend — plus " +
      "a total-volume summary line and the date the CPC figures were last refreshed. Keywords the " +
      "provider answered with nothing, and keywords it sent no row for, are named on their own " +
      "lines and counted in the summary. While live data is off, it returns the \"not yet " +
      "enabled\" message instead and charges nothing; a lookup that comes back with no figures at " +
      "all is likewise refused and not charged.",
  },

  discover_keywords: {
    lead:
      "`discover_keywords` asks DataForSEO Labs to **produce keywords you do not have yet** — from " +
      "one seed keyword, a list of seeds, or a domain. It answers the question that comes *before* " +
      "[`research_keywords`](/docs/tools-reference/research-keywords), which prices a list you " +
      "already wrote: this one hands you rows you did not type. It is **synchronous** — everything " +
      "comes back immediately, with no background job to poll.",
    whatItDoes:
      "Pick a **mode**. It is required and has no default, because the four modes ask DataForSEO " +
      "four different questions — and take four different inputs:\n\n" +
      "| `mode` | What comes back | What you pass |\n" +
      "| --- | --- | --- |\n" +
      "| `ideas` | Keywords from the same product/service categories as your seeds | `seeds` — a " +
      "list of keywords |\n" +
      "| `suggestions` | Longer search queries that **contain** your seed | `seed` — exactly one " +
      "keyword |\n" +
      "| `related` | The keywords Google lists under **\"searches related to\"** your seed | `seed`, " +
      "plus optional `depth` |\n" +
      "| `for_site` | Keywords DataForSEO considers **relevant to a domain** — no seed involved | " +
      "`target` or `project_id` |\n\n" +
      "Each row carries DataForSEO's own `search_volume`, `cpc`, `competition`, " +
      "`competition_level`, `keyword_difficulty`, search intent, search-volume trend and the date " +
      "the vendor last refreshed the row.\n\n" +
      "Three filters — `min_volume`, `max_volume` and `max_difficulty` — are applied **at " +
      "DataForSEO** rather than after the fact. `min_volume` and `max_difficulty` are never sent " +
      "unless you ask for them. `max_volume` is the one exception: on `for_site` and `ideas` it " +
      "has a **default ceiling**, for the reason in the next section, and every answer says which " +
      "ceiling it used.",
    preExampleSections: [
      {
        heading: "`for_site` and `ideas` leave relevance to DataForSEO — and it measured poorly",
        body:
          "Two of the four modes do **not** start from a keyword you typed. `for_site` asks " +
          "DataForSEO which keywords belong to a domain; `ideas` asks which belong to a category. " +
          "Both answers are the vendor's judgement alone, and on a live walkthrough both came " +
          "back off-subject: `for_site` returned **none of its first 15 keywords about the site** " +
          "— national general-purpose queries (weather, translation, government services) of the " +
          "kind any domain in that country is handed — and `ideas` returned unrelated products " +
          "and topics at ordinary search volume.\n\n" +
          "So those two modes carry a **warning** above their results, and a **default " +
          "search-volume ceiling**. The answer always names the ceiling it applied; pass " +
          "`max_volume` to move it, or `max_volume: 0` to remove it and see the unfiltered set.\n\n" +
          "**What that ceiling is, and is not.** It is a bound SeoGrep chose — **not a measured " +
          "relevance threshold**. What the walkthrough measured was that the whole first window, " +
          "ordered by search volume, was off-subject; **the volume of those rows was never " +
          "captured**, so no number here is derived from them. The bound is set where it is on the " +
          "reasoning that a single site rarely owns a keyword above it, and it drops whatever sits " +
          "above it regardless of what that keyword is about.\n\n" +
          "It is therefore a **partial** remedy and is described as one: a volume bound cannot " +
          "remove an off-subject keyword of ordinary volume, which is exactly what `ideas` " +
          "returned. SeoGrep does not read meaning and will not filter rows by it.\n\n" +
          "The ceiling also **stands down** when it would contradict you: give `for_site` or " +
          "`ideas` a `min_volume` at or above it and the default is dropped rather than sent " +
          "alongside your floor, because the two together match nothing and you would have paid " +
          "the flat price for an empty list. The answer says the ceiling withdrew. Two bounds of " +
          "**your own** that contradict each other (`min_volume` above `max_volume`) are refused " +
          "outright, before anything is charged — there SeoGrep has no default of its own to give " +
          "up, and picking one of your bounds to ignore would run a lookup you did not ask for.\n\n" +
          "`suggestions` and `related` are **left alone** — no warning, no ceiling. They stay " +
          "anchored to a seed keyword you choose (the first returns queries that contain it, the " +
          "second what Google itself lists beside it), and both measured clean on the same " +
          "walkthrough. If a `for_site` or `ideas` answer reads as noise, those two are the " +
          "narrower question.",
      },
      {
        heading: "How long a seed may be",
        body:
          "A seed keyword is capped at **200 characters** — `seed` on `suggestions` and `related`, " +
          "and every entry of `seeds` on `ideas`. That is **SeoGrep's bound, not DataForSEO's**: " +
          "the vendor publishes none we have read, and the longest keyword we have ever seen come " +
          "back from it is 29 characters.\n\n" +
          "It exists because the answer **quotes your seeds back** in its heading, and one " +
          "enormous seed would crowd out the keywords you paid for: measured, a 60,000-character " +
          "seed produced a reply too large for any client to show, carrying **zero keywords**. " +
          "Two hundred characters is about thirty ordinary words — far more than a real search " +
          "query — and a longer one is refused **before anything is charged**.\n\n" +
          "A long seed **list** is handled differently, because there the cap would lose " +
          "information: `ideas` takes up to 200 seeds and the heading quotes as many as it can, " +
          "then says how many more you sent. The count is always exact.",
      },
      {
        heading: "A field from another mode is rejected, not ignored",
        body:
          "Pass `seed` with `mode: \"for_site\"` and the call is **refused** — it is not quietly " +
          "dropped. That is deliberate: `for_site` looks up a domain, so a silently ignored seed " +
          "would run a different lookup than the one you asked for, and bill you for it. The " +
          "error names the field and says what the mode does take, so it is a one-step fix.\n\n" +
          "The same rule runs in both directions: `ideas` will not accept a domain, `depth` " +
          "belongs to `related` alone, and `include_subdomains` to `for_site` alone.",
      },
      {
        heading: "Whose numbers these are",
        body:
          "Every value in the output is a **DataForSEO field printed under DataForSEO's own " +
          "name**. The vendor publishes **two different competition measurements** and they stay " +
          "apart: `competition` is a 0–1 float, `competition_level` is an advertiser band " +
          "(`LOW` / `MEDIUM` / `HIGH`). SeoGrep does not merge them, derive one from the other, or " +
          "rename either into something friendlier.\n\n" +
          "A field the vendor **did not report** is printed as unreported, never as `0` — \"nobody " +
          "has a figure for this\" and \"nobody searches this\" are different facts. A genuine zero " +
          "the vendor did send is printed as `0`. Secondary intent is the one exception in the " +
          "other direction: an empty list cannot be told apart from a field the vendor never sent, " +
          "so an empty one is printed as nothing at all rather than as \"no secondary intent\".",
      },
      {
        heading: "What it does not tell you",
        body:
          "There is **no opportunity score** here, no \"easy win\" label and no ordering of ours: " +
          "the rows come back in the one vendor order the tool asks for — by DataForSEO's own " +
          "`keyword_info.search_volume`, highest first — and the output names that field so you " +
          "know what \"first\" means.\n\n" +
          "`keyword_difficulty` is **DataForSEO's own 0–100 estimate about the search results** for " +
          "a keyword. It is not a forecast of where your site would rank, not a promise that a low " +
          "number is winnable, and neither DataForSEO nor SeoGrep can tell you what traffic any of " +
          "these keywords would bring you. Which of them to target is your decision; this tool " +
          "brings you the vendor's rows and says whose they are.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Find longer search queries containing \"seo " +
      "software\".\n\nOr start from a domain instead of a keyword:\n\n> What keywords does " +
      "DataForSEO consider relevant to example.com? Skip anything under 500 monthly searches.",
    returns:
      "A heading naming **which mode ran** and the DataForSEO Labs function behind it, then — on " +
      "`for_site` and `ideas` only — the relevance warning, then what that mode means in the " +
      "vendor's own terms, then the locale, the vendor field the rows are ordered by, the filters " +
      "that were actually sent (printed in DataForSEO's own `[field, operator, value]` grammar, " +
      "so what you read is what the vendor received) and a plain sentence naming **which " +
      "search-volume ceiling applied** — a default one, your own, or none — and the argument that " +
      "changes it.\n\n" +
      "The keyword list is captioned as a **window**: the rows you got, the `offset` and `limit` " +
      "they were fetched under, and DataForSEO's whole-set count attributed to the vendor by name, " +
      "followed by the sentence that stops the arithmetic — _this window is a slice of that set, " +
      "not a count of it_. When the vendor gave no total, the caption says that instead of " +
      "back-filling one from the rows in hand.\n\n" +
      "A lookup that matched nothing says so plainly, naming the window and the filters it asked " +
      "for, and you are still charged for the delivered lookup — \"nothing here matched\" is a " +
      "real answer, not an error. A missing or foreign mode field, a `limit` or `depth` outside " +
      "the allowed range, a `for_site` call naming neither `target` nor `project_id` (or both), " +
      "and a `project_id` that is not yours are all rejected before anything is charged; while " +
      "live data is off you get a \"not yet enabled\" message instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One call is one **flat price**, charged **once**, and behind it is **one** DataForSEO " +
          "request. If it fails, the whole call fails and **you are not charged**.\n\n" +
          "`discover_keywords` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits; the refusal arrives before " +
          "anything is reserved and says outright that you were not charged. Buy any credit pack and " +
          "it unlocks straight away; your existing credits are untouched and keep working for " +
          "crawls, audits, reports and Search Console tools.\n\n" +
          "The `limit` ceiling is **part of the price** rather than a display preference: " +
          "DataForSEO bills **per returned row**, and that cap is what holds the flat price inside " +
          "the margin it was signed against. Asking for fewer rows costs the same; asking for more " +
          "than the ceiling is refused before anything is charged.\n\n" +
          "**A wide reply is bounded, and it says so when it is.** A keyword row costs about 300 " +
          "characters, so a full-width 1,000-row lookup would render close to **300,000 " +
          "characters** — several times the size a calling client refuses outright, and a " +
          "refused reply means the credits are spent and you see an error instead of an " +
          "answer. So the reply has a size budget.\n\n" +
          "**The default window is not affected.** Ask for no `limit` at all and every one of " +
          "the 100 keywords prints — the budget is set above the widest default answer on " +
          "purpose, because a call you did not tune should return a whole answer. A wider " +
          "window is where the budget bites: a 1,000-row lookup prints roughly **120–130** " +
          "keywords. When rows are cut, the reply says how many keywords were shown and how " +
          "many more were fetched in the same window but not printed, and states plainly that " +
          "those were charged for either way. Raising `limit` past what one reply carries buys " +
          "rows nobody can show you: advance `offset` to read the next stretch — a separate " +
          "call at the same flat price — or narrow the set with `min_volume`, `max_volume` or " +
          "`max_difficulty` so the keywords you want arrive inside the window that prints.",
      },
      {
        heading: "Limitations",
        body:
          "Every delivered lookup is **recorded**: SeoGrep keeps a row saying what was " +
          "looked up, when, under which settings, and a capped summary of what came back. " +
          "The **Lookups** page of your dashboard lists them, so a lookup you paid for an " +
          "hour ago is still something you can point at.\n\n" +
          "That record is history, not a live surface. No call here reads a previous run, nothing " +
          "is refreshed for you, and there is no \"new since last time\" — so to see the current " +
          "picture, run it again.\n\n" +
          "The keywords are **the vendor's, not yours**: none of your seeds is guaranteed to " +
          "appear in the answer, and a set of many thousands is normal — read the window caption " +
          "for how far your slice sits from DataForSEO's whole-set count, and page through it with " +
          "`offset`.\n\n" +
          "`for_site` is DataForSEO's own judgement about which keywords are **relevant to a " +
          "domain**. It is not a list of what that site currently ranks for — that is " +
          "[`ranked_keywords`](/docs/tools-reference/ranked-keywords) — and the two will not " +
          "agree. `related` follows \"searches related to\" outward from your seed, so a deeper " +
          "`depth` drifts further from it.",
      },
    ],
  },

  my_pages: {
    lead:
      "`my_pages` lists the pages of a domain that **DataForSEO Labs reports ranking figures for**, " +
      "and compares them against the pages **your own last crawl fetched**. It is the PAGE axis of " +
      "the question [`ranked_keywords`](/docs/tools-reference/ranked-keywords) answers on the " +
      "keyword axis. It is **synchronous** — everything comes back immediately, with no background " +
      "job to poll.",
    whatItDoes:
      "Each row is **one page**. What it carries is DataForSEO's **position histogram** for that " +
      "page — how many search results of a given type hold it at positions 1, 2–3, 4–10 and so on " +
      "through 91–100 — plus `etv`, `count`, `estimated_paid_traffic_cost` and the vendor's " +
      "`is_new` / `is_up` / `is_down` / `is_lost` counters, per result type.\n\n" +
      "**It does not return the keywords a page ranks for.** This DataForSEO endpoint returns none, " +
      "so neither does SeoGrep. For the keywords behind one particular page, run " +
      "[`ranked_keywords`](/docs/tools-reference/ranked-keywords) with that page's URL as the " +
      "target.\n\n" +
      "Pass `project_id` instead of `target` and the answer also splits into three groups:\n\n" +
      "| Group | What it means |\n" +
      "| --- | --- |\n" +
      "| Reported by DataForSEO, and fetched by that crawl | Both sides know the page |\n" +
      "| Reported by DataForSEO, not found in that crawl | The page is in this window of the " +
      "vendor's list, and not among the pages your last crawl fetched |\n" +
      "| Fetched by that crawl, not named in this window | Your crawl fetched it and this window " +
      "of the vendor's list did not mention it |\n\n" +
      "Two optional filters, `min_organic_etv` and `min_organic_count`, are applied **at " +
      "DataForSEO** rather than after the fact. Neither is sent unless you ask for it, so by " +
      "default nothing is dropped before you see it.",
    preExampleSections: [
      {
        heading: "How the two sides are matched",
        body:
          "A page from DataForSEO and a page from your crawl are the same page when their " +
          "**normalised addresses are equal**. The normalisation ignores the scheme (`http` vs " +
          "`https`), the capitalisation of the host, a leading `www.`, the `#fragment`, one " +
          "trailing slash and a default port.\n\n" +
          "It deliberately **keeps** three things, because collapsing any of them would merge two " +
          "real pages into one row: the **query string** in full and in its original order, the " +
          "**capitalisation of the path** (`/Blog` and `/blog` are different resources on a " +
          "case-sensitive server), and **subdomains** (`blog.example.com/x` is not " +
          "`example.com/x`).\n\n" +
          "One residual limit follows from that and is worth knowing: two addresses that differ " +
          "only in the ORDER of their query parameters are treated as two pages and will not " +
          "match. That errs toward showing you two rows, which you can see, rather than merging " +
          "two pages' figures into one, which you could not. An address that does not parse as a " +
          "URL at all is reported in its own group and is not counted as a miss on either side.",
      },
      {
        heading: "What an absence does and does not mean",
        body:
          "Both comparison groups are **claims about two specific things** — this window of " +
          "DataForSEO's list, and that one crawl — and the output says so beside each of them " +
          "rather than leaving you to infer it.\n\n" +
          "**\"Not found in that crawl\" is not \"the page does not exist\".** Your crawl is one " +
          "run, on one day, starting from the site's own start URL and following links under its " +
          "depth, page-count and robots limits. The answer names the crawl's date and how many " +
          "pages it fetched, right beside the list.\n\n" +
          "**\"Not named in this window\" is not \"the page does not rank\".** The vendor half is a " +
          "window (`offset` / `limit`) over a longer list, scoped to the result types and locale " +
          "you asked for. The answer names the rows the window covered and the result types it " +
          "asked about, right beside that list too. Advance `offset` to read further.",
      },
      {
        heading: "Whose numbers these are",
        body:
          "Every figure is a **DataForSEO field printed under DataForSEO's own name**. `etv` and " +
          "`estimated_paid_traffic_cost` are **DataForSEO's own estimates** of monthly traffic and " +
          "of what that traffic would cost to buy — they are not measurements of your traffic, and " +
          "neither DataForSEO nor SeoGrep can tell you what a page will earn.\n\n" +
          "The position buckets are **a histogram, not a position**: they are never averaged into " +
          "one number, because the vendor did not send one. A bucket DataForSEO did not report is " +
          "shown as unreported and the count of unreported buckets is stated — never rendered as a " +
          "zero. A result type the vendor reported nothing for is **left out of that page " +
          "entirely** rather than shown as a row of zeros.\n\n" +
          "There is **no coverage score, no health percentage and no grade** here. The one count " +
          "the tool prints is a count of what this window matched against that crawl, and the " +
          "sentence carrying it says exactly that.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Which pages of my project rank, and which of " +
      "them did my last crawl miss?\n\nOr look at a domain you have never crawled:\n\n> Show me the " +
      "pages DataForSEO reports ranking figures for on example.com, organic results only.",
    returns:
      "A heading naming the domain and, when a project was named, **the crawl it was compared " +
      "against and the day that crawl ran**. Then a paragraph saying what this endpoint does and " +
      "does not return, the result types and locale that were asked for, the vendor field the rows " +
      "are ordered by, and the filters that were actually sent — printed in DataForSEO's own " +
      "`[field, operator, value]` grammar, so what you read is what the vendor received.\n\n" +
      "What comes next is captioned as a **window**: the rows you got, the `offset` and `limit` " +
      "they were fetched under, and DataForSEO's whole-set count attributed to the vendor by name, " +
      "followed by the sentence that stops the arithmetic — _this window is a slice of that set, " +
      "not a count of it_. When the vendor gave no total, the caption says that instead of " +
      "back-filling one from the rows in hand.\n\n" +
      "Then the pages themselves, in whichever of two shapes applies — and **every page appears " +
      "exactly once either way**, in DataForSEO's own order. With a bare `target`, or with a " +
      "project that has no crawl yet, you get one flat list of the window. With a project whose " +
      "crawl could be compared, that flat list is **replaced** by the three groups above: they are " +
      "a partition of the same window, so printing both would be the same pages a second time. The " +
      "answer says which shape you are reading rather than leaving you to notice.\n\n" +
      "The comparison half states which of its three states applies: the three groups when a " +
      "project with a crawl was named; a plain sentence saying **no comparison was made** when you " +
      "passed a bare `target`; and a plain sentence saying **the project has no completed crawl " +
      "yet** when it does not — in which case DataForSEO's half is delivered in full and nothing " +
      "in it is missing because of it.\n\n" +
      "**One reply has a size limit, and reaching it is said out loud.** A wide window can produce " +
      "more text than a single MCP reply can carry, so each list is printed up to a fixed budget " +
      "and then stops with a line naming **how many pages were printed and how many were not** — " +
      "never a silent cut, and never a zero. Vendor rows that were fetched and not printed **were " +
      "charged for either way**, and the note says so; move the window with `offset`, or ask for a " +
      "smaller `limit`, to read the rest. Group headings keep counting **every** row, and the " +
      "record kept on the Lookups page covers the whole window — the budget bounds what is " +
      "printed, never what was measured.\n\n" +
      "A lookup that matched nothing says so plainly, naming the window and the filters it asked " +
      "for, and you are still charged for the delivered lookup — \"nothing here matched\" is a real " +
      "answer, not an error. A `limit` or `offset` outside the allowed range, a call naming " +
      "neither `target` nor `project_id` (or both), an archived project and a `project_id` that is " +
      "not yours are all rejected before anything is charged; while live data is off you get a " +
      "\"not yet enabled\" message instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One call is one **flat price**, charged **once**, and behind it is **one** DataForSEO " +
          "request. If it fails, the whole call fails and **you are not charged**. Reading your own " +
          "crawl costs nothing extra — it is data you have already paid for.\n\n" +
          "`my_pages` needs a **paid credit balance**. It reads live data from a paid third-party " +
          "provider, so it is not available on trial credits; the refusal arrives before anything is " +
          "reserved and says outright that you were not charged. Buy any credit pack and it unlocks " +
          "straight away; your existing credits are untouched and keep working for crawls, audits, " +
          "reports and Search Console tools.\n\n" +
          "The `limit` ceiling is **part of the price** rather than a display preference: " +
          "DataForSEO bills **per returned row**, and that cap is what holds the flat price inside " +
          "the margin it was signed against. Asking for fewer rows costs the same; asking for more " +
          "than the ceiling is refused before anything is charged.",
      },
      {
        heading: "Limitations",
        body:
          "**No keywords.** Worth repeating, because the name invites the assumption: this endpoint " +
          "reports how a page is distributed across result positions, not which searches put it " +
          "there. Use [`ranked_keywords`](/docs/tools-reference/ranked-keywords) with a page URL " +
          "for that.\n\n" +
          "Every delivered lookup is **recorded**: SeoGrep keeps a row saying what was " +
          "looked up, when, under which settings, and a capped summary of what came back. " +
          "The **Lookups** page of your dashboard lists them, so a lookup you paid for an " +
          "hour ago is still something you can point at.\n\n" +
          "That record is history, not a live surface. No call here reads a previous run, nothing " +
          "is refreshed for you, and there is no \"new since last time\" — so to see the current " +
          "picture, run it again.\n\n" +
          "**The crawl side is one crawl, and a bounded read of it.** The comparison uses your " +
          "project's most recent completed `crawl_site` run and only the pages that run actually " +
          "fetched — URLs it skipped are not counted as crawled. It also reads only the first " +
          "pages of that crawl, up to a fixed ceiling; past it the answer says the crawl side " +
          "was truncated and the list may be incomplete. So \"reported by DataForSEO, not found " +
          "in that crawl\" is bounded twice over — by what the crawl fetched, and by how much " +
          "of it was read.\n\n" +
          "A project with no completed crawl gets DataForSEO's half and a sentence saying so; a " +
          "bare `target` gets no comparison at all, because there is no project to compare it " +
          "against.\n\n" +
          "**Clickstream data is not bought.** DataForSEO offers a clickstream option on this " +
          "endpoint that doubles the cost of the request; SeoGrep does not enable it, and every " +
          "answer states that rather than leaving you to wonder why no clickstream figures appear.",
      },
    ],
  },

  ranked_keywords: {
    lead:
      "`ranked_keywords` lists the Google organic keywords a domain **already ranks for** — each " +
      "with its position, monthly search volume, CPC, competition, estimated traffic, the exact " +
      "URL that ranks and that page's SERP title — under a one-screen summary of the whole " +
      "domain's organic footprint. It is powered by DataForSEO Labs and works on **any public " +
      "domain**, so it reads your own site or a competitor's the same way. It is **synchronous**: " +
      "the table comes back immediately, with no background job to poll.",
    whatItDoes:
      "Name the site in **one of two ways** — pass a `target` domain (a bare host or a full URL — " +
      "it is canonicalized for you), or pass the `project_id` of one of your own projects and the " +
      "domain is taken from it. Exactly one of the two: passing both is rejected rather than " +
      "resolved by precedence, because the two can name different sites and guessing would bill " +
      "you for a lookup of the one you did not mean.\n\n" +
      "You get a **domain summary first**, before any keyword rows: how many organic results the " +
      "domain appears in, how those are spread across all twelve position bands from #1 to #100, " +
      "its estimated monthly organic traffic, what the same traffic would cost as ads, and how " +
      "many rankings are new, up, down or gone since DataForSEO last checked. It answers \"how is " +
      "this domain doing\" without reading a single row.\n\nThen one row per ranked keyword:\n\n" +
      "- **Keyword** — the query the domain ranks for.\n" +
      "- **Position** — its rank among the **organic** results. When a SERP feature (a featured " +
      "snippet, an answer box, an ad block) sits above it, the reply also gives the rank on the " +
      "page — `position #3 organic (#4 on the page)`. Those are two different numbers in the same " +
      "response: the first is what stays comparable over time, the second is how far a reader " +
      "actually scrolls. When they agree, only one is printed.\n" +
      "- **Search volume** — average monthly Google searches for that keyword.\n" +
      "- **CPC** and **competition** — the advertiser bid and the HIGH/MEDIUM/LOW band. They come " +
      "with this lookup, so you do not need a separate `research_keywords` call to get them for a " +
      "keyword you already rank for.\n" +
      "- **Difficulty** and **intent** — how hard the keyword is to rank for (0–100) and what " +
      "searchers want from it. The same two figures `research_keywords` reports, in the same " +
      "words, without a second call.\n" +
      "- **Estimated traffic** — DataForSEO's estimate of the monthly visits *this ranking* " +
      "earns. Usually a sharper priority signal than position and volume read separately.\n" +
      "- **URL** and **title** — the page that holds the ranking, and the title it shows in the " +
      "SERP.\n\n" +
      "When there is more to say about the result page, a second indented line follows the row:\n\n" +
      "- **Movement** — whether the ranking is new, moved up or moved down since DataForSEO's " +
      "previous check, and where it was. This is what makes the tool a change report rather than " +
      "a snapshot: run it on a schedule and the movement lines are the story.\n" +
      "- **What else is on that SERP** — the other element types Google showed, `ai_overview` " +
      "included. It is the direct explanation of the organic/on-page position gap above, naming " +
      "what sits between your result and the top of the page.\n" +
      "- **A verify link** — Google, at the exact locale DataForSEO measured. You cannot rebuild " +
      "it from the keyword alone, and the locale is usually what a surprising result turns on.\n\n" +
      "**Position**, **search volume** and the **URL** are always stated, as `n/a` when the "  +
      "vendor sent nothing — they are the row's spine, and a row that quietly lost its "  +
      "position would read as a shorter row rather than as a missing measurement. Everything "  +
      "else above is **omitted** when DataForSEO did not send it, so a row with nothing extra "  +
      "to say stays a single line. A dated line under the table says when the vendor last "  +
      "refreshed the CPC and competition figures, and says so in a sentence once that is over "  +
      "a month old.\n\n" +
      "Only **organic** results are counted — paid placements are excluded. The header line says " +
      "how many rows you got, which ordering you got them in, and — when the domain ranks for " +
      "more than the `limit` you asked for — how many it ranks for in total, so a truncated list " +
      "never reads like the whole picture.",
    preExampleSections: [
      {
        heading: "Who can run it",
        body:
          "`ranked_keywords` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits; the refusal arrives before " +
          "anything is reserved and says outright that you were not charged. Buy any credit pack and " +
          "it unlocks straight away. Your trial credits are untouched and keep working for crawls, " +
          "audits, reports and Search Console tools.\n\n" +
          "If live DataForSEO access is unavailable on this deployment, the tool returns a clear " +
          "_\"ranked-keyword lookups are not yet enabled on this deployment\"_ message and " +
          "**charges you nothing** — no credits are reserved or spent. SeoGrep never returns " +
          "sample or placeholder figures dressed up as real data.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> What keywords does competitor.com rank for?\n\n" +
      "Or narrow it down:\n\n> Show me the top 50 keywords example.com ranks for.\n\n" +
      "\"Top\" is a real instruction here: DataForSEO orders the domain's **whole** keyword set " +
      "before returning the first `limit` of them. By default that ordering is highest search " +
      "volume first; pass `sort` to get `traffic` (highest estimated traffic first) or `position` " +
      "(best ranking first) instead.\n\n> Which of example.com's rankings bring the most traffic?",
    returns:
      "A summary of the domain's organic footprint — organic results it appears in, all twelve " +
      "position bands from #1 to #100, estimated monthly organic traffic, the paid-equivalent " +
      "traffic cost, and how many rankings are new, up, down or gone since DataForSEO's previous " +
      "check — followed by one row per ranked keyword: keyword, organic position (and the " +
      "on-page position when a SERP feature outranks it), search volume, CPC, competition, " +
      "difficulty, intent, estimated traffic, the ranking URL and its SERP title, plus a second " +
      "line carrying how the ranking moved, which other element types share that SERP " +
      "(`ai_overview` among them) and a link to check Google yourself. Position, volume and the " +
      "URL are stated as `n/a` when the vendor sent none; the added fields are left out.\n\n" +
      "The whole-domain summary **names the DataForSEO measurement it was read from**, and " +
      "carries a note saying that DataForSEO measures these separately — so a different total " +
      "for the same domain in another SeoGrep tool is a second measurement, not a " +
      "contradiction.\n\nThe header says how many of the domain's ranked " +
      "keywords are shown, in which ordering, and out of how many in total — and how many " +
      "returned rows carried no keyword at all and were dropped, so a short table is never " +
      "mistaken for a complete one; when you looked the " +
      "site up by `project_id`, it names that project. A dated line under the table says when the " +
      "vendor last refreshed the CPC and competition figures. A domain with no organic rankings " +
      "on record is reported as such — with the summary still shown, because \"no rows came back\" " +
      "and \"this domain ranks for nothing\" are different findings.\n\n`limit` defaults to 100, " +
      "not the 1,000-row maximum: DataForSEO charges per row, and a thousand bullet lines costs " +
      "you more and reads worse. The header always names the domain's full ranked-keyword count, " +
      "so you can see when raising it is worth it.\n\nRankings are read for the United States " +
      "in English unless you pass `location_code` and `language_code`. When a lookup left on that " +
      "default comes back thin AND the domain carries a country-code TLD, the reply says so and " +
      "names the TLD — it does **not** guess the matching location code, because a wrong code " +
      "returns another country's rankings that look perfectly ordinary. Two-letter TLDs that are " +
      "delegated to a country but sold worldwide (`.io`, `.ai`, `.co`, `.me`, `.tv` and the like) " +
      "are deliberately **not** called country-code TLDs, because for almost every site using one " +
      "that would be advice about the wrong country.\n\nAn input that is not a " +
      "public domain, a call naming neither `target` nor `project_id` (or both), and a " +
      "`project_id` that is not yours are all rejected before anything is charged; while live " +
      "data is off you get the \"not yet enabled\" message instead — also free.",
  },

  analyze_backlinks: {
    lead:
      "`analyze_backlinks` reports a domain's **backlink profile** — how many links point at it, " +
      "which domains send them, and what anchor text those links use — powered by the DataForSEO " +
      "Backlinks database. It works on **any public domain**, so it reads your own site or a " +
      "competitor's the same way. It is **synchronous**: the report comes back immediately, with " +
      "no background job to poll.",
    whatItDoes:
      "Name the site in **one of two ways** — pass a `target` domain (a bare host or a full URL — " +
      "it is canonicalized for you), or pass the `project_id` of one of your own projects and the " +
      "domain is taken from it. Exactly one of the two: passing both is rejected rather than " +
      "resolved by precedence, because the two can name different sites and guessing would bill " +
      "you for a lookup of the one you did not mean. Either way you get three sections:\n\n" +
      "- **Profile summary** — total backlinks, referring domains (with the share that link " +
      "**exclusively with dofollow** links), referring main domains, broken backlinks, the " +
      "aggregate backlink spam score, and the domain's rank on DataForSEO's 0–1,000 scale.\n" +
      "- **Top referring domains** — the domains linking to the target, most backlinks first, " +
      "each with its own rank **and DataForSEO's spam score for that domain**. A domain the " +
      "vendor did not score says so in words rather than showing a number, because an " +
      "unscored domain and a domain scored clean are different findings.\n" +
      "- **Top anchors** — the anchor texts those links use, most backlinks first. Links that carry " +
      "no anchor text (image links) are labelled as such rather than hidden.\n\n" +
      "Only **live** backlinks are counted — links that have since been lost are excluded. Each " +
      "list header says how many rows you got and, when there are more than the `limit` you asked " +
      "for, how many exist in total, so a truncated list never reads like the whole picture.",
    preExampleSections: [
      {
        heading: "Who can run it",
        body:
          "`analyze_backlinks` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits; the refusal arrives before " +
          "anything is reserved and says outright that you were not charged. Buy any credit pack and " +
          "it unlocks straight away. Your trial credits are untouched and keep working for crawls, " +
          "audits, reports and Search Console tools.\n\n" +
          "If live DataForSEO access is unavailable on this deployment, the tool returns a clear " +
          "_\"backlink lookups are not yet enabled on this deployment\"_ message and **charges " +
          "you nothing** — no credits are reserved or spent. SeoGrep never returns sample or " +
          "placeholder figures dressed up as real data.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Analyze the backlink profile of competitor.com." +
      "\n\nOr keep it short:\n\n> Show me the top 25 referring domains and anchors for example.com.",
    returns:
      "The profile summary, then the top referring domains (domain, backlink count, rank, spam " +
      "score), then the top anchors (anchor text, backlink count) — each list headed by how " +
      "many of the total are shown. A summary metric or a count DataForSEO has no value for is " +
      "shown as `n/a` rather than as a zero; an unreported referring-domain spam score is " +
      "stated in words instead, naming the vendor field it would have come from. " +
      "When you looked the site up by `project_id`, the heading names that project.\n\nAn input " +
      "that is not a public domain, a call naming neither `target` nor `project_id` (or both), " +
      "and a `project_id` that is not yours are all rejected before anything is charged; while " +
      "live data is off you get the \"not yet enabled\" message instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One lookup reads three DataForSEO endpoints (summary, referring domains, anchors) and " +
          "is charged **once**, as a single tool call. If any of the three fails, the whole call " +
          "fails and **you are not charged** — a partial profile is never billed.",
      },
    ],
  },

  compare_competitors: {
    lead:
      "`compare_competitors` puts a domain side by side with its rivals on Google organic search — " +
      "how many organic result pages each one appears in, where those appearances sit, and what " +
      "that traffic is worth — powered by DataForSEO Labs. It works on **any public domain**, so it " +
      "reads your own site or a competitor's the same way. It is **synchronous**: the table comes " +
      "back immediately, with no background job to poll.",
    whatItDoes:
      "Name the site being compared in **one of two ways** — pass a `target` domain, or pass the " +
      "`project_id` of one of your own projects and the domain is taken from it. Exactly one of " +
      "the two: passing both is rejected rather than resolved by precedence, because the two can " +
      "name different sites and guessing would bill you for a comparison of the one you did not " +
      "mean. The competitors are always plain domains — a rival is not one of your projects.\n\n" +
      "**Name up to three competitors yourself** — that is the mode that gives a useful " +
      "comparison. You can instead omit them and let DataForSEO pick the rivals it sees sharing " +
      "the most organic result pages with your target, which works well for a domain with a broad " +
      "keyword footprint. On a small or niche site it can pick general-purpose giants such as " +
      "`youtube.com` or `wikipedia.org`: they genuinely share those result pages, but they are " +
      "not competitors in any sense you can act on. The reply says which of the two happened, and " +
      "every row is labelled with where it came from — `target`, `found by DataForSEO`, or " +
      "`supplied by you` — so a discovered rival is never mistaken for one you chose.\n\n" +
      "Every domain in the table gets the same lines, under the heading **Across the whole " +
      "domain** — every keyword that domain ranks for:\n\n" +
      "- **Organic SERPs containing the domain** — how many organic result pages the domain appears " +
      "in. It counts result pages, not keywords.\n" +
      "- **Organic SERPs by position** — how those appearances distribute across all twelve bands " +
      "DataForSEO reports, printed on two lines: #1 through #11-20, then #21-30 through #91-100. " +
      "That is the complete range, so you see a domain's whole ranked presence and not just the " +
      "part of it near the top.\n" +
      "- **Estimated monthly organic traffic (ETV)** — DataForSEO's estimate of monthly visits, " +
      "calculated from click-through rate and search volume. It is an estimate, not measured " +
      "traffic.\n" +
      "- **Estimated monthly cost of the same traffic as paid ads** — what buying that organic " +
      "traffic through ads would be estimated to cost per month.\n" +
      "- **Since DataForSEO's previous check** — how many rankings are newly ranking, moved up, " +
      "moved down, or were no longer found. This is the line that says whether a rival is gaining " +
      "or losing ground, rather than only how big it is today.\n\n" +
      "A rival **found by DataForSEO** carries two more things. First, its overlap with your " +
      "target: how many **intersecting keywords** the two share, and the average position it holds " +
      "*on those shared keywords* — not across its whole keyword set. Second, the same metric lines " +
      "again under **Across the keywords it shares with the target only**.\n\n" +
      "Those two blocks are **different numbers for the same rival**, which is why each one is " +
      "printed under its own heading. The whole-domain block is how big the rival is everywhere; " +
      "the shared block is how it does on the ground you actually compete on. A large rival can " +
      "appear in tens of thousands of result pages while sharing only a few thousand of them with " +
      "you. The side-by-side comparison is made on the whole-domain figures, because the shared " +
      "figures cover a different keyword set for each rival.\n\n" +
      "**The answer ends with the difference**, so you do not have to subtract by eye. Under " +
      "**Target vs each competitor**, every rival gets one line per measure — organic result " +
      "pages, estimated monthly traffic, and what that traffic would cost as ads — showing your " +
      "figure, theirs, and the gap between them. The gap is the competitor's figure minus yours, " +
      "so a plus means theirs is the larger number. This is where a site that ranks for *more* " +
      "keywords than a rival while pulling *less* valuable traffic shows up as what it is: a " +
      "minus on one line and a plus on the next.\n\n" +
      "Two things are deliberately **not** differenced. A figure DataForSEO did not report is " +
      "never treated as a zero — the line says the difference is not reported rather than " +
      "inventing the largest gap in the table out of a missing value. And two figures read from " +
      "**different DataForSEO measurements** are not subtracted from each other at all; the line " +
      "says so and names both measurements, because most of that gap would be the distance " +
      "between the vendor's own methods rather than between the two domains.\n\n" +
      "**Read the whole-domain rows with their source in view.** Each block names the " +
      "DataForSEO measurement it was read from, and in one table they are not always the same " +
      "one: on the discovery flow, rivals DataForSEO found carry its competitor-discovery " +
      "figures while your target may carry its domain-overview figures instead. The two " +
      "disagree routinely — the same domain's lost-ranking count read 319 under one and 547 " +
      "under the other. Neither is wrong; they are two measurements, and the source line on " +
      "each block is what lets you see which you are comparing. Every answer also carries one " +
      "note saying the same thing about SeoGrep's other tools: a different total elsewhere is " +
      "a second measurement, not a contradiction.\n\n" +
      "A competitor **you supplied** carries neither, because no discovery request is made for " +
      "it.\n\n" +
      "Only **organic** results are counted; paid placements are excluded. A metric DataForSEO has " +
      "no value for is shown as `n/a` rather than as a zero, and a domain it holds no organic data " +
      "for says so plainly.",
    preExampleSections: [
      {
        heading: "Who can run it",
        body:
          "`compare_competitors` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits; the refusal arrives before " +
          "anything is reserved and says outright that you were not charged. Buy any credit pack and " +
          "it unlocks straight away. Your trial credits are untouched and keep working for crawls, " +
          "audits, reports and Search Console tools.\n\n" +
          "If live DataForSEO access is unavailable on this deployment, the tool returns a clear " +
          "_\"competitor comparisons are not yet enabled on this deployment\"_ message and " +
          "**charges you nothing** — no credits are reserved or spent. SeoGrep never returns " +
          "sample or placeholder figures dressed up as real data.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> How does example.com compare with its " +
      "competitors?\n\nOr name the rivals yourself:\n\n> Compare example.com against " +
      "first-rival.com and second-rival.com.",
    returns:
      "A heading naming the target — or, when you passed a `project_id`, the project it came from " +
      "— the language and location the figures were read for, and where the compared rivals came " +
      "from; then one block per domain with its metric lines, the target first; then a " +
      "**Target vs each competitor** section putting your organic result pages, estimated " +
      "traffic and paid-equivalent cost beside each rival's, with the gap between them stated " +
      "(or the reason there is none).\n\nAn input that " +
      "is not a public domain (the target, or any competitor you named), a call naming neither " +
      "`target` nor `project_id` (or both), and a `project_id` that is not yours are all rejected " +
      "before anything is charged; while live data is off you get the \"not yet enabled\" message " +
      "instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "How many times one comparison reads DataForSEO depends on which mode you used. Letting " +
          "DataForSEO **discover** the rivals normally takes a **single** request — that one " +
          "response already carries every listed domain's own metrics — while **naming** the " +
          "competitors yourself takes one rank-overview request per compared domain, because a " +
          "rival you chose is not part of any discovery result.\n\n" +
          "You pay the same either way: it is a **flat price**, charged **once**, as a single tool " +
          "call. If any of those requests fails, the whole call fails and **you are not charged** " +
          "— a partial comparison is never billed.",
      },
    ],
  },

  keyword_gap: {
    lead:
      "`keyword_gap` lists the Google organic keywords a **competitor ranks for and you do not** — " +
      "each with its monthly search volume, the position the competitor holds, and the page " +
      "holding it — powered by DataForSEO Labs. It works on **any public domain**, so you can run " +
      "it for your own site or for one competitor against another. It is **synchronous**: the " +
      "list comes back immediately, with no background job to poll.",
    whatItDoes:
      "Name your side in **one of two ways** — pass a `target` domain (a bare host or a full URL " +
      "— it is canonicalized for you), or pass the `project_id` of one of your own projects and " +
      "the domain is taken from it. Exactly one of the two: passing both is rejected rather than " +
      "resolved by precedence, because the two can name different sites and guessing would bill " +
      "you for a lookup of the one you did not mean. Then name **one `competitor`** — the rival " +
      "to mine. Naming the target as its own competitor is rejected before anything is charged: " +
      "a domain has no gap against itself.\n\n" +
      "Each row carries:\n\n" +
      "- **Keyword** — the query the competitor ranks for.\n" +
      "- **Search volume** — average monthly Google searches, and the order the list is sorted " +
      "in, biggest opportunity first.\n" +
      "- **The competitor's position** — where the rival ranks in the organic results.\n" +
      "- **Keyword difficulty** — how hard the keyword is to rank for, on a 0–100 scale.\n" +
      "- **CPC and competition band** — what advertisers pay for the same query, when DataForSEO " +
      "has a figure.\n" +
      "- **The ranking page** — the competitor URL that holds the position, and DataForSEO's " +
      "estimate of the monthly visits it earns.\n\n" +
      "Only **organic** results are counted; paid placements are excluded. A metric DataForSEO " +
      "has no value for is left out of the row rather than printed as a zero — with **one " +
      "exception**: search volume, the axis the list is ordered by, is always stated, and shows " +
      "`n/a` when the vendor holds no figure. Dropping it would silently move a row up or down " +
      "an ordering the reader is trusting, and \"nobody has a number for this\" is not \"nobody " +
      "searches this\".",
    preExampleSections: [
      {
        heading: "There is no \"your position\" column, and there cannot be",
        body:
          "A keyword appears in this list precisely **because your domain does not rank for it**, " +
          "so DataForSEO returns no ranking of yours to print. That absence is the result, not a " +
          "missing measurement — which is why the tool does not render an empty column that would " +
          "read as \"we could not find your position\". If you want the keywords you and a rival " +
          "**both** rank for, that is a different question and a different tool: " +
          "[`compare_competitors`](/docs/tools-reference/compare-competitors) for the side-by-side " +
          "picture, [`ranked_keywords`](/docs/tools-reference/ranked-keywords) for everything one " +
          "domain ranks for.",
      },
      {
        heading: "Who can run it",
        body:
          "`keyword_gap` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits; the refusal arrives before " +
          "anything is reserved and says outright that you were not charged. Buy any credit pack " +
          "and it unlocks straight away. Your trial credits are untouched and keep working for " +
          "crawls, audits, reports and Search Console tools.\n\n" +
          "If live DataForSEO access is unavailable on this deployment, the tool returns a clear " +
          "_\"keyword gap analysis is not yet enabled on this deployment\"_ message and " +
          "**charges you nothing** — no credits are reserved or spent. SeoGrep never returns " +
          "sample or placeholder figures dressed up as real data.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> What does competitor.com rank for that " +
      "example.com doesn't?\n\nOr keep it short:\n\n> Show me the top 25 keyword gaps between my " +
      "project and rival.com.",
    returns:
      "A header naming your side — or, when you passed a `project_id`, the project it came from " +
      "— the competitor, the language and location the rankings were read for, and how many of " +
      "the total gap keywords are shown; then one block per keyword. A rival you already match on " +
      "every keyword is reported as no gap found, plainly, and you are still charged for the " +
      "delivered analysis.\n\nAn input that is not a public domain (the target or the " +
      "competitor), a call naming neither `target` nor `project_id` (or both), a competitor equal " +
      "to the target, and a `project_id` that is not yours are all rejected before anything is " +
      "charged; while live data is off you get the \"not yet enabled\" message instead — also " +
      "free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One gap is **one** DataForSEO request, charged **once**, as a single tool call. If it " +
          "fails, the whole call fails and **you are not charged** — a half-built list is never " +
          "billed. Rankings are read for the United States in English unless you pass " +
          "`location_code` and `language_code`.",
      },
    ],
  },

  link_gap: {
    lead:
      "`link_gap` lists the domains that **link to a competitor and not to you** — the outreach " +
      "shortlist — powered by the DataForSEO Backlinks database. It works on **any public " +
      "domain**, so you can run it for your own site or between two rivals. It is " +
      "**synchronous**: the list comes back immediately, with no background job to poll.",
    whatItDoes:
      "Name your side in **one of two ways** — pass a `target` domain, or pass the `project_id` " +
      "of one of your own projects and the domain is taken from it. Exactly one of the two: " +
      "passing both is rejected rather than resolved by precedence, because the two can name " +
      "different sites and guessing would bill you for a lookup of the one you did not mean. Then " +
      "name **one `competitor`**. Naming the target as its own competitor is rejected before " +
      "anything is charged.\n\n" +
      "Each row carries:\n\n" +
      "- **The referring domain** — the site that links to your competitor.\n" +
      "- **Rank** — DataForSEO's authority measure for that domain on a 0–1,000 scale, and the " +
      "order the list is sorted in, strongest first.\n" +
      "- **Live backlinks** — how many links it currently sends the competitor.\n" +
      "- **Referring pages** — how many of its own pages point there.\n" +
      "- **Backlink spam score** — the average spam score of those links, so a prospect worth " +
      "avoiding is visible before you spend a morning on it.\n" +
      "- **First seen** — when DataForSEO's crawler first found a link from that domain.\n\n" +
      "Rank is the only one of those that is always there. Each of the other four is printed " +
      "**only when DataForSEO returned a value for it**, and left out entirely otherwise — so " +
      "a row with no spam column is a domain the vendor did not score, not a domain it scored " +
      "clean. That distinction is the whole reason the clause is dropped rather than zeroed, " +
      "and it is worth reading rows accordingly.\n\n" +
      "Only **live** backlinks are counted — links that have since been lost are excluded.",
    preExampleSections: [
      {
        heading: "What the list does and does not claim",
        body:
          "These are the domains that link to your competitor and have **no link to you today**. " +
          "That is a fact about the link graph, not a prediction: a site that covered your rival " +
          "is a plausible place to be covered, but nothing here says it would link to you, and " +
          "the spam-score column is printed precisely because some of them are places you should " +
          "not want a link from.\n\n" +
          "**It names no example linking page, and says so rather than inventing one.** The " +
          "DataForSEO endpoint behind this tool reports these prospects at **domain level " +
          "only** — it returns no page URL at all — so any URL printed here would be one " +
          "SeoGrep made up. Every non-empty answer ends with that sentence and points at the " +
          "tool that does have linking pages: run " +
          "[`backlink_details`](/docs/tools-reference/backlink-details) on the competitor to " +
          "see which of their pages carry the links, with the anchor text and the page linked " +
          "to. That is a separate, separately-priced lookup.\n\n" +
          "One competitor per call, deliberately. Running it against each rival in turn gives you " +
          "the same picture and keeps every list traceable to the domain it came from.",
      },
      {
        heading: "Who can run it",
        body:
          "`link_gap` needs a **paid credit balance**. It reads live data from a paid third-party " +
          "provider, so it is not available on trial credits; the refusal arrives before anything is " +
          "reserved and says outright that you were not charged. Buy any credit pack and it unlocks " +
          "straight away. Your trial credits are untouched and keep working for crawls, audits, " +
          "reports and Search Console tools.\n\n" +
          "If live DataForSEO access is unavailable on this deployment, the tool returns a clear " +
          "_\"link gap analysis is not yet enabled on this deployment\"_ message and **charges " +
          "you nothing** — no credits are reserved or spent. SeoGrep never returns sample or " +
          "placeholder figures dressed up as real data.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Who links to competitor.com but not to " +
      "example.com?\n\nOr keep it short:\n\n> Show me the top 25 link-gap prospects for my " +
      "project against rival.com.",
    returns:
      "A header naming your side — or, when you passed a `project_id`, the project it came from " +
      "— the competitor, and how many of the total referring domains are shown; then one block " +
      "per domain. A competitor with no referring domain you lack is reported as no gap found, " +
      "plainly, and you are still charged for the delivered analysis.\n\nAn input that is not a " +
      "public domain (the target or the competitor), a call naming neither `target` nor " +
      "`project_id` (or both), a competitor equal to the target, and a `project_id` that is not " +
      "yours are all rejected before anything is charged; while live data is off you get the " +
      "\"not yet enabled\" message instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One gap is **one** DataForSEO request, charged **once**, as a single tool call. If it " +
          "fails, the whole call fails and **you are not charged** — a half-built list is never " +
          "billed.",
      },
    ],
  },

  backlink_changes: {
    lead:
      "`backlink_changes` shows what happened to a site's backlink profile **over time** — how " +
      "many backlinks and referring domains arrived and disappeared in each period, and what the " +
      "profile itself looked like at each of those points. It works on **any public domain**, so " +
      "you can run it for your own site or for a rival. It is **synchronous**: both series come " +
      "back immediately, with no background job to poll.",
    whatItDoes:
      "Name the site in **one of two ways** — pass a `target` domain, or pass the `project_id` of " +
      "one of your own projects and the domain is taken from it. Exactly one of the two: passing " +
      "both is rejected rather than resolved by precedence, because the two can name different " +
      "sites and guessing would bill you for the history of the one you did not mean. Then choose " +
      "how the history is bucketed with `group_range` (`day`, `week`, `month` or `year`) and how " +
      "far back to go with `periods`.\n\n" +
      "You get **two series**, both straight from DataForSEO:\n\n" +
      "- **New and lost** — per bucket, how many backlinks and how many referring domains were " +
      "gained and lost. DataForSEO's own definition applies: a link counts as **new** when it " +
      "appeared in its index after the window opened, and **lost** when it was present before the " +
      "window and was not found after it.\n" +
      "- **The profile at each bucket** — per bucket, the total backlinks, the total referring " +
      "domains, and DataForSEO's rank for the domain on a 0–1,000 scale.\n\n" +
      "Subdomains are **included**, pinned explicitly rather than left to a default that could " +
      "move. A figure DataForSEO did not return is printed as `n/a`, never as a zero.",
    preExampleSections: [
      {
        heading: "The two series do not add up to each other — on purpose",
        body:
          "This is the one thing to know before reading the output. The two numbers come from two " +
          "different DataForSEO measurements counted against two different definitions: one " +
          "counts arrivals and departures, the other is a snapshot of the totals. They do **not** " +
          "reconcile, and DataForSEO's own published examples show it — for the same domain and " +
          "the same months, its new-and-lost figures net to +90 and +31 referring domains while " +
          "its profile totals move by +62 and +44.\n\n" +
          "Neither figure is wrong; they answer different questions. So SeoGrep prints **both** " +
          "and derives **nothing** from them: there is no \"net change\" column and no churn " +
          "percentage, because building one would mean publishing a reconciliation the vendor " +
          "never made. The output says so in a line of its own, so the number is never quietly " +
          "read as the other one's explanation.",
      },
      {
        heading: "What a bucket is, exactly",
        body:
          "DataForSEO rounds the window **out to whole periods** and labels each bucket with the " +
          "last day of the period it covers — ask for months from the 23rd and you get whole " +
          "months, which is why you can receive one bucket more than you asked for. The header " +
          "prints the window **DataForSEO says it answered for**, not the one that was requested.\n\n" +
          "A bucket DataForSEO has no data for comes back as **0**, not as a gap. That is the " +
          "vendor's own behaviour and it means a printed zero can mean either \"nothing " +
          "happened\" or \"nothing recorded\" — the two are not distinguishable in this data, and " +
          "SeoGrep does not guess which one you are looking at. Only a field the vendor omits " +
          "entirely is printed as `n/a`.\n\n" +
          "History starts at **2019-01-30**, DataForSEO's own earliest date. A longer window " +
          "simply begins there.",
      },
      {
        heading: "Who can run it",
        body:
          "`backlink_changes` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider — two requests per call — so it is not available on trial " +
          "credits; the refusal arrives before anything is reserved and says outright that you " +
          "were not charged. Buy any credit pack and it unlocks straight away; your existing credits are " +
          "untouched and keep working for crawls, audits, reports and Search Console tools.\n\n" +
          "If live DataForSEO access is unavailable on this deployment, the tool returns a clear " +
          "_\"backlink change history is not yet enabled on this deployment\"_ message and " +
          "**charges you nothing** — no credits are reserved or spent. SeoGrep never returns " +
          "sample or placeholder figures dressed up as real data.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> How has example.com's backlink profile changed " +
      "over the last year?\n\nOr narrow the window:\n\n> Show me weekly new and lost backlinks for " +
      "my project over the last 8 weeks.",
    returns:
      "A header naming the site — or, when you passed a `project_id`, the project it came from — " +
      "the grouping, and the window DataForSEO answered for; then the new-and-lost series, then " +
      "the profile series, then the line explaining why the two are not each other's arithmetic. " +
      "**Each series states its own bucket count**, because the two are answered separately and " +
      "can come back with different numbers of buckets — one figure covering both would be a " +
      "claim about one series taken from the other. A domain DataForSEO holds no history for is " +
      "reported plainly as no history " +
      "found, and you are still charged for the delivered lookup.\n\nA target that is not a public " +
      "domain, a call naming neither `target` nor `project_id` (or both), a `periods` value " +
      "outside the allowed range, and a `project_id` that is not yours are all rejected before " +
      "anything is charged; while live data is off you get the \"not yet enabled\" message " +
      "instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One call is one **flat price**, charged **once**. Behind it are **two** DataForSEO " +
          "requests — the new-and-lost series and the profile series — and if either one fails " +
          "the whole call fails and **you are not charged**. A half-built history is never billed." +
          "\n\nThe `periods` ceiling is part of the price rather than a stylistic limit: " +
          "DataForSEO bills per returned row, and the window is what decides how many rows come " +
          "back.",
      },
      {
        heading: "Limitations",
        body:
          "Every delivered lookup is **recorded**: SeoGrep keeps a row saying what was " +
          "looked up, when, under which settings, and a capped summary of what came back. " +
          "The **Lookups** page of your dashboard lists them, so a lookup you paid for an " +
          "hour ago is still something you can point at.\n\n" +
          "That record is history, not a live surface. No call here reads a previous run, nothing " +
          "is refreshed for you, and there is no \"compared with last month\" — so to see the current " +
          "picture, run it again.\n\n" +
          "Two fields DataForSEO returns are deliberately **not** printed: the new and lost " +
          "counts for *referring main domains*. They are a second, different definition of " +
          "\"domain\", and showing them beside the referring-domain counts would invite you to " +
          "read the difference as a signal the vendor never described.",
      },
    ],
  },

  backlink_details: {
    lead:
      "`backlink_details` lists a site's **individual backlinks** — who links, from which page, " +
      "to **which page of the site**, and with what anchor — alongside the site's own pages " +
      "ranked by the links they earned. Where [`analyze_backlinks`](/docs/tools-reference/analyze-backlinks) " +
      "gives you the profile and [`backlink_changes`](/docs/tools-reference/backlink-changes) " +
      "gives you its history, this one gives you the rows underneath both. It works on **any " +
      "public domain**, and it is **synchronous**: both lists come back immediately, with no " +
      "background job to poll.",
    whatItDoes:
      "Name the site in **one of two ways** — pass a `target` domain, or pass the `project_id` of " +
      "one of your own projects and the domain is taken from it. Exactly one of the two: passing " +
      "both is rejected rather than resolved by precedence, because the two can name different " +
      "sites and guessing would bill you for a lookup of the one you did not mean. Then choose " +
      "how much to fetch with `limit` (individual backlinks, strongest first), `offset` (how far " +
      "into the list to start) and `page_limit` (the site's own pages, most-linked first).\n\n" +
      "You get **two lists**, both straight from DataForSEO:\n\n" +
      "- **Individual backlinks** — the linking domain and page, the page of yours it points at, " +
      "the anchor text (or why there is none), whether it is followed, DataForSEO's rank for the " +
      "link on a 0–1,000 scale, the vendor's spam score for it, the status code of the linked " +
      "page, and when the link was first and last seen.\n" +
      "- **Pages of the site that earn the links** — per page, its backlinks, referring domains " +
      "(and how many of those are nofollow), broken backlinks, rank, the vendor's spam score for " +
      "the page, and when it was first seen.\n\n" +
      "Only **live** backlinks are counted, subdomains are **included**, and both settings are " +
      "pinned explicitly rather than left to a default that could move. A figure DataForSEO did " +
      "not return is printed as `n/a`, never as a zero.",
    preExampleSections: [
      {
        heading: "You are reading a window, and the output says so",
        body:
          "This is the one thing to know before reading the output. Both lists are **slices** of " +
          "far larger sets, and the gap can be enormous: in DataForSEO's own published example " +
          "the same response carries a handful of fetched rows and a whole-set count of " +
          "**42,671,699** backlinks.\n\n" +
          "So every count in the output **names the set it counts**. The rows you were sent are " +
          "described as _\"N backlinks in this window\"_, printed together with the **offset and " +
          "limit** they were fetched under, so you can always tell which slice you are holding. " +
          "The vendor's whole-set figure is attributed to **DataForSEO by name** and followed by " +
          "the sentence that stops the arithmetic: _this window is a slice of that set, not a " +
          "count of it_. The two numbers are never joined into a single \"N of M\" claim, because " +
          "the moment `offset` is anything but 0 your rows are not the head of that set.\n\n" +
          "If DataForSEO does not report a whole-set total, the output says it **did not say** — " +
          "not `0`, and not the number of rows in your hand.",
      },
      {
        heading: "The spam scores are the vendor's, not ours",
        body:
          "Two spam scores appear, and both are DataForSEO's own fields under DataForSEO's own " +
          "names: `backlink_spam_score` for one link, `backlinks_spam_score` for one page. The " +
          "vendor really does spell them differently, and they are two different measurements on " +
          "two different objects — so SeoGrep prints them under the vendor's names rather than " +
          "tidying them into one column that would imply they are comparable.\n\n" +
          "SeoGrep adds **no link-quality verdict of its own**. Nothing here is labelled toxic or " +
          "bad, and nothing tells you to disavow anything: that is a judgement about your site " +
          "that only you can make, and dressing a vendor number up as our recommendation would " +
          "be inventing a signal.",
      },
      {
        heading: "Who can run it",
        body:
          "`backlink_details` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider — two requests per call — so it is not available on trial " +
          "credits; the refusal arrives before anything is reserved and says outright that you " +
          "were not charged. Buy any credit pack and it unlocks straight away; your existing credits are " +
          "untouched and keep working for crawls, audits, reports and Search Console tools.\n\n" +
          "If live DataForSEO access is unavailable on this deployment, the tool returns a clear " +
          "_\"backlink details are not yet enabled on this deployment\"_ message and **charges " +
          "you nothing** — no credits are reserved or spent. SeoGrep never returns sample or " +
          "placeholder rows dressed up as real data.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Show me who links to example.com and which of " +
      "its pages they point at.\n\nOr page further into a big profile:\n\n> Give me the next 100 " +
      "backlinks for my project, starting from number 200.",
    returns:
      "A header naming the site — or, when you passed a `project_id`, the project it came from — " +
      "then the backlink list, then the site's own pages, each list under its own caption stating " +
      "**that list's** row count, offset and limit, and the vendor's whole-set total for it. A " +
      "window that came back empty is reported plainly as no backlinks found **for the window " +
      "that was asked for**, with the offset and limit named, and you are still charged for the " +
      "delivered lookup — running off the end of a list is a real answer, not an error.\n\nA " +
      "target that is not a public domain, a call naming neither `target` nor `project_id` (or " +
      "both), a `limit`, `offset` or `page_limit` outside the allowed range, and a `project_id` " +
      "that is not yours are all rejected before anything is charged; while live data is off you " +
      "get the \"not yet enabled\" message instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One call is one **flat price**, charged **once**. Behind it are **two** DataForSEO " +
          "requests — the backlink list and the site's own pages — and if either one fails the " +
          "whole call fails and **you are not charged**. A half-built list is never billed.\n\n" +
          "**`limit` and `page_limit` are display controls, not price controls.** This call " +
          "costs the same whatever you ask for, and asking for fewer rows saves you nothing: " +
          "DataForSEO's own bill for this endpoint is nearly all a flat per-request fee — " +
          "measured on one profile, nineteen times the rows cost thirteen per cent more. What " +
          "the two **ceilings** do is hold the worst case inside the margin the flat price was " +
          "signed against; asking for more than a ceiling is refused before anything is " +
          "charged. Set them for the reply you want to read.\n\n" +
          "**A reply can be bounded, and it says so when it is.** The two lists have their own " +
          "size budgets, because one oversized answer is an answer a client will not display " +
          "at all. When rows are cut, the reply prints how many were shown and how many more " +
          "were fetched in the same window but not printed — and states plainly that those " +
          "were charged for either way. Ask for a smaller `limit`, or page through with " +
          "`offset`, to read them.",
      },
      {
        heading: "Limitations",
        body:
          "Every delivered lookup is **recorded**: SeoGrep keeps a row saying what was " +
          "looked up, when, under which settings, and a capped summary of what came back. " +
          "The **Lookups** page of your dashboard lists them, so a lookup you paid for an " +
          "hour ago is still something you can point at.\n\n" +
          "That record is history, not a live surface. No call here reads a previous run, nothing " +
          "is refreshed for you, and there is no \"new since last time\" — so to see the current " +
          "picture, run it again.\n\n" +
          "Paging stops at an `offset` of **20,000**, DataForSEO's own documented ceiling for " +
          "this endpoint. Going deeper needs a continuation token this tool does not use, so on a " +
          "very large profile you are reading the strongest links rather than every link.\n\n" +
          "The page list is always the **first** page of the site's own pages, most-linked first: " +
          "`offset` moves through the backlink list only. And a link is only marked broken when " +
          "DataForSEO flags it as broken — an unmarked link is one the vendor did not flag, which " +
          "is not the same as one it checked and found healthy.",
      },
    ],
  },

  disavow_candidates: {
    lead:
      "`disavow_candidates` finds the referring domains behind a site's worst-scoring live " +
      "backlinks and hands you the **text of a Google disavow file** built from them. It is a " +
      "**proposal you review** — SeoGrep does not submit disavow files to Google, and sends " +
      "nothing anywhere. It works on **any public domain** and is **synchronous**: everything " +
      "comes back immediately, with no background job to poll.",
    whatItDoes:
      "Name the site in **one of two ways** — pass a `target` domain, or pass the `project_id` of " +
      "one of your own projects and the domain is taken from it. Exactly one of the two: passing " +
      "both is rejected rather than resolved by precedence, because the two can name different " +
      "sites. Then set `min_backlink_spam_score` — see the next section, it has no default and " +
      "the tool will not run without it — and optionally narrow to followed links with " +
      "`dofollow_only`.\n\n" +
      "Behind one call are **three** DataForSEO Backlinks requests:\n\n" +
      "- the site's **live backlinks, filtered by DataForSEO** on its own `backlink_spam_score` " +
      "at the threshold you set, worst first — that window is what everything else is derived " +
      "from;\n" +
      "- DataForSEO's **per-domain `spam_score`** for the linking domains that window named " +
      "(its `bulk_spam_score` endpoint). This is a **different field on a different endpoint** " +
      "from the per-link score above, and the output keeps them apart;\n" +
      "- the site's **referring networks** — the IP subnets its links sit in, a separate axis on " +
      "which a link network shows up.\n\n" +
      "The candidate list is ordered by that per-domain `spam_score`, highest first. A domain " +
      "DataForSEO returned **no** score for sorts **last** and is printed as unreported — never " +
      "as a zero, because a silence is not a clean bill of health. Ties break on the domain name.",
    preExampleSections: [
      {
        heading: "It proposes. It never submits.",
        body:
          "This is the one thing to know before you use the output. The disavow text is returned " +
          "to your conversation **as text**. There is no submission path in SeoGrep — no Search " +
          "Console call, no upload, no \"apply\" button, not behind a flag. Uploading a disavow " +
          "file is a decision with consequences for a site's link profile, so it stays with the " +
          "human: if you decide to go ahead, **you** upload it yourself in Google Search " +
          "Console.\n\n" +
          "The refusal is printed in the output **and** carried in the file's own first lines, so " +
          "it does not get separated from the file when you copy it out.",
      },
      {
        heading: "The threshold is yours, and it is required",
        body:
          "`min_backlink_spam_score` has **no default**, and the call is rejected without it.\n\n" +
          "That is deliberate. DataForSEO publishes a 0–100 spam score for a link but publishes " +
          "**no cut-off** — there is no vendor-recommended \"spammy above this\" line, and " +
          "Google publishes none either. Any number SeoGrep filled in for you would be our " +
          "opinion about what counts as spam, arriving with the authority of a product default, " +
          "on a page whose output is a list of other people's domains. So the tool asks you for " +
          "the number instead, and **repeats the one you chose** in the output, next to the " +
          "count of rows it examined.\n\n" +
          "A threshold of **0** means no threshold at all: every live backlink enters the window.",
      },
      {
        heading: "Whose numbers these are",
        body:
          "Every score in the output is a **DataForSEO field printed under DataForSEO's own " +
          "name**, and the vendor really does spell it three different ways because it measures " +
          "three different things: `backlink_spam_score` for one **link**, `spam_score` for one " +
          "**referring domain**, `backlinks_spam_score` for one **network**. SeoGrep does not " +
          "merge them into a score of its own, and there is no \"toxicity\", no risk level and " +
          "no ranking of our making anywhere in the output.\n\n" +
          "**\"Candidate\" means one thing only**: DataForSEO's score met the threshold you " +
          "set. It is not a finding that these links are hurting the site, and neither " +
          "DataForSEO nor SeoGrep can tell you what Google makes of any of them. Disavowing " +
          "links that were fine costs you whatever value they were passing — which is why the " +
          "output tells you to read every line, and why nothing here is applied for you.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Find disavow candidates for example.com, " +
      "counting links DataForSEO scores 60 or worse.\n\nOr narrow it to followed links on one " +
      "of your projects:\n\n> For my project, list disavow candidates from dofollow links " +
      "scoring 75 and above.",
    returns:
      "A header naming the site — or, when you passed a `project_id`, the project it came from — " +
      "then the refusal, then a plain statement of **how the list was built**: the threshold you " +
      "chose, whether nofollowed links were kept, and which vendor field ordered which list. " +
      "After that the **filtered backlinks** you were billed for, each with its own vendor " +
      "score; the **candidate referring domains**; the **referring networks**; the **disavow " +
      "file text**; and the note naming all three vendor fields.\n\n" +
      "Every candidate carries **both** vendor scores, each labelled with the level it " +
      "describes: DataForSEO's per-**domain** score, and the worst per-**link** score in this " +
      "window. They are not blended into one number, because they are two measurements from two " +
      "endpoints and they disagree routinely — real rows scored 0 and 1 per domain beside " +
      "domains whose worst link scored 60, and the printed number was the wrong one for the " +
      "decision on that line. The row also names how many links in this window it accounted " +
      "for, how many of those DataForSEO marked **dofollow**, and one example `from → to` pair.\n\n" +
      "A candidate whose links are **none of them marked dofollow** is **marked, never " +
      "removed**: the line says so, because Google does not count a nofollowed link and " +
      "disavowing that domain may change nothing. It stays in the list because which links are " +
      "worth naming is your judgement, and dropping rows would hide candidates you paid to see. " +
      "The wording is careful: \"none is marked dofollow\" is what was measured — a link the " +
      "vendor never marked either way is not a link the vendor called nofollow. Both score " +
      "levels and this marking are repeated as comment lines above each entry **inside the file " +
      "itself**, so they survive the file leaving this conversation.\n\n" +
      "Both vendor lists are captioned as **windows** — the rows you got, the offset and limit " +
      "they were fetched under, and DataForSEO's whole-set count attributed to the vendor by " +
      "name, followed by the sentence that stops the arithmetic: _this window is a slice of that " +
      "set, not a count of it_. The candidate list is **derived** from those rows rather than " +
      "fetched, so it carries no vendor total at all — only a count of the window and the cap it " +
      "was built under.\n\n" +
      "A lookup that matched nothing says so plainly, naming **the window and the threshold it " +
      "asked for**, and you are still charged for the delivered lookup — \"nothing above your " +
      "cut-off in these rows\" is a real answer, not an error. A target that is not a public " +
      "domain, a call naming neither `target` nor `project_id` (or both), a missing or " +
      "out-of-range `min_backlink_spam_score`, a `limit` or `network_limit` outside the allowed " +
      "range, and a `project_id` that is not yours are all rejected before anything is charged; " +
      "while live data is off you get a \"not yet enabled\" message instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One call is one **flat price**, charged **once**. Behind it are **three** DataForSEO " +
          "requests, and if any of them fails the whole call fails and **you are not charged** — " +
          "a half-built candidate list is never billed. When the filtered window names no domain " +
          "at all, the second request is not sent: there would be nothing to ask it about.\n\n" +
          "`disavow_candidates` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits, and the refusal says " +
          "outright that you were not charged. Buy any credit pack and it unlocks straight away; " +
          "your existing credits are untouched and keep working for crawls, audits, reports and " +
          "Search Console tools.\n\n" +
          "The `limit` and `network_limit` ceilings, and the cap on how many candidate domains " +
          "are scored, are **part of the price** rather than stylistic limits: DataForSEO bills " +
          "**per returned row**, and these caps are what hold the flat price inside the margin " +
          "it was signed against. Asking for fewer rows costs the same; asking for more than a " +
          "ceiling is refused before anything is charged.",
      },
      {
        heading: "Limitations",
        body:
          "Every delivered lookup is **recorded**: SeoGrep keeps a row saying what was looked " +
          "up, when, under which criteria, and a capped summary of the candidates. The " +
          "**Lookups** page of your dashboard lists them. The **file text itself is " +
          "deliberately not kept** — everything it is derived from is, so it can be rebuilt, " +
          "but a saved disavow file is a document that would go stale in place while still " +
          "looking authoritative.\n\n" +
          "That record is history, not a live surface. No call here reads a previous run, " +
          "nothing is refreshed for you, and there is no \"new since last time\" — so to see " +
          "the current picture, run it again.\n\n" +
          "The candidate domains come from **the filtered window you paid for**, not from the " +
          "whole link profile: raise `limit` to examine more rows, and read the window caption " +
          "for how far the slice sits from DataForSEO's whole-set count. Only **live** links are " +
          "counted and subdomains are included, both pinned explicitly rather than left to a " +
          "vendor default that could move.\n\n" +
          "The file lists **whole domains** (`domain:` entries), never individual URLs: this " +
          "tool answers at the referring-domain level, and emitting a bare URL would claim a " +
          "page-level judgement it never made. And the referring-network list is a fact about " +
          "**IP addresses**, not a verdict — domains share a subnet for ordinary hosting reasons " +
          "as well as for link-network ones.",
      },
    ],
  },

  ai_visibility: {
    lead:
      "`ai_visibility` measures how a **domain or a keyword is mentioned in one AI assistant's " +
      "answers**, using DataForSEO's LLM Mentions data. It answers a question no other SeoGrep " +
      "tool touches: not what a search engine ranked, but what a language model said. It is " +
      "**synchronous** — everything comes back immediately, with no background job to poll.",
    whatItDoes:
      "Pick a **subject** and a **platform**. The subject is required and has no default, because " +
      "the two ask different questions and take different inputs:\n\n" +
      "| `subject` | What it measures | What you pass |\n" +
      "| --- | --- | --- |\n" +
      "| `domain` | How a site is mentioned | `target` or `project_id` |\n" +
      "| `keyword` | How a search phrase is mentioned | `keyword` |\n\n" +
      "The platform is `chat_gpt` or `google`, and it is required too — there is no \"all " +
      "assistants\" option, because no such measurement exists here.\n\n" +
      "Each row comes back with **DataForSEO's own fields under DataForSEO's own names**, in the " +
      "order DataForSEO sent them. No field is renamed and none is computed.",
    preExampleSections: [
      {
        heading: "What this answer is scoped to",
        body:
          "Every answer states its own limits, in full, on every run:\n\n" +
          "- **One assistant.** A `chat_gpt` measurement says nothing about Google's AI answers, " +
          "and neither says anything about an assistant DataForSEO was not asked about.\n" +
          "- **One locale.** The location and language you asked under are named; if you passed " +
          "neither, the answer says so rather than naming a default nobody chose.\n" +
          "- **One moment.** The timestamp is DataForSEO's own, printed with the vendor key it " +
          "came from. When the vendor reports no time, the answer says that — SeoGrep does not " +
          "put its own clock in place of a missing vendor timestamp.\n" +
          "- **No period.** This DataForSEO endpoint takes **no date range**, so there is none to " +
          "ask for and none to state. The answer says so rather than leaving \"now\" to be assumed.",
      },
      {
        heading: "Whose numbers these are",
        body:
          "SeoGrep computes **no visibility score, no share of voice and no sentiment**, ranks " +
          "nothing by a formula of its own, and re-orders nothing: this endpoint publishes no " +
          "ordering field, so the rows arrive in the vendor's order and stay in it.\n\n" +
          "A field DataForSEO **did not report** is printed as unreported, never as `0` — \"the " +
          "vendor reported no mentions\" and \"the vendor did not measure mentions\" are " +
          "different answers, and only the first one is about your brand. A genuine zero the " +
          "vendor did send is printed as `0`.\n\n" +
          "Where DataForSEO sends a **nested object or list**, it is not folded into the row; the " +
          "answer names those fields instead, so you know there is more in the vendor's response " +
          "than what you are reading.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Does example.com come up in ChatGPT answers?\n\n" +
      "Or ask about a phrase rather than a site:\n\n> How is \"project management software\" " +
      "mentioned in Google's AI answers, in the United States?",
    returns:
      "A heading naming **what was looked up** and the DataForSEO LLM Mentions function behind " +
      "it, then the scope paragraph above — platform, locale, the vendor's own timestamp, and the " +
      "absence of any date range.\n\n" +
      "Then the rows, captioned with the row cap they came back under and DataForSEO's own " +
      "whole-set count kept separate from them. This endpoint offers **no paging**: there is no " +
      "offset to advance, so a wider set is a wider request rather than a next page. When the " +
      "vendor gave no total, the caption says that instead of back-filling one from the rows in " +
      "hand.\n\n" +
      "A lookup that matched nothing says so plainly and you are still charged for the delivered " +
      "lookup — and it is stated as an answer about **this platform, this locale and this " +
      "moment**, not as a claim that nobody ever mentions you. A missing or foreign subject " +
      "field, a row cap above the ceiling, a call naming neither `target` nor `project_id` (or " +
      "both), and a `project_id` that is not yours are all rejected before anything is charged; " +
      "while live data is off you get a \"not yet enabled\" message instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "One call is one **flat price**, charged **once**, and behind it is **one** DataForSEO " +
          "request. If it fails, the whole call fails and **you are not charged**.\n\n" +
          "A failed lookup is not a lookup that found nothing, and the refusal keeps the two " +
          "apart: it quotes DataForSEO's own status code and message rather than reporting an " +
          "empty result. It also says the half that \"you were not charged\" leaves out — the " +
          "attempt did go out to DataForSEO and used part of SeoGrep's own daily third-party " +
          "data allowance. That is our cost, not yours, and saying only the first half read as " +
          "the whole truth.\n\n" +
          "`ai_visibility` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits; the refusal arrives before " +
          "anything is reserved and says outright that you were not charged. Buy any credit pack and " +
          "it unlocks straight away; your existing credits are untouched and keep working for " +
          "crawls, audits, reports and Search Console tools.\n\n" +
          "**`internal_list_limit` is not a price control.** It is the vendor's own field, and " +
          "the vendor's own words for it are \"maximum number of elements within internal " +
          "arrays\" — it caps two nested arrays inside the aggregate, not the rows returned and " +
          "not the rows billed. An earlier version of this page called it the price control; " +
          "that claim is withdrawn rather than restated. What was always true is kept: asking " +
          "for fewer entries costs the same, and asking for more than the vendor's published " +
          "ceiling is refused before anything is charged.",
      },
      {
        heading: "Limitations",
        body:
          "Every delivered lookup is **recorded**: SeoGrep keeps a row saying what was " +
          "looked up, when, under which settings, and a capped summary of what came back. " +
          "The **Lookups** page of your dashboard lists them, so a lookup you paid for an " +
          "hour ago is still something you can point at.\n\n" +
          "That record is history, not a live surface. No call here reads a previous run, nothing " +
          "is refreshed for you, and there is no \"changed since last time\" — so to see the current " +
          "picture, run it again.\n\n" +
          "This is a measurement, **not a prediction**. It does not tell you what an assistant " +
          "will say next, why it said what it said, or what to change to be mentioned more — and " +
          "a measurement on one platform does not carry over to another.\n\n" +
          "The location is a **name** (`location_name`), not the numeric location code the other " +
          "SeoGrep tools take: this DataForSEO family publishes no code.",
      },
    ],
  },

  ai_visibility_compare: {
    lead:
      "`ai_visibility_compare` asks the same question as " +
      "[`ai_visibility`](/docs/tools-reference/ai-visibility) about **several targets side by " +
      "side** — your site and its rivals, or a set of keywords — in a single DataForSEO request. " +
      "It is **synchronous** — everything comes back immediately, with no background job to poll.",
    whatItDoes:
      "Pass **2 to 10 targets** (DataForSEO's own bound for this endpoint) and a platform. Each " +
      "target is one of three things, and exactly one:\n\n" +
      "| Field | What it compares |\n" +
      "| --- | --- |\n" +
      "| `domain` | Any public domain, including a competitor's |\n" +
      "| `keyword` | A search phrase rather than a site |\n" +
      "| `project_id` | One of your own projects — its domain is used |\n\n" +
      "An optional `label` names the target in the answer; it defaults to the domain or keyword " +
      "itself. Two targets may not share a label — DataForSEO echoes the label back and it is " +
      "what rows are matched on, so a collision is refused rather than guessed at.\n\n" +
      "All the targets are bought in **one** DataForSEO request, not one request per target.",
    preExampleSections: [
      {
        heading: "It ranks nothing",
        body:
          "A side-by-side view is read top-down as a leaderboard unless it says otherwise, so " +
          "this one says otherwise. **The targets appear in the order you listed them.** " +
          "DataForSEO publishes no ordering field for this endpoint, so there is nothing to sort " +
          "by and SeoGrep sorts nothing: position in the answer means only what you typed.\n\n" +
          "There is no visibility score, no share of voice and no winner. Every figure is a " +
          "DataForSEO field under DataForSEO's own name.",
      },
      {
        heading: "\"No row\" is not \"zero\"",
        body:
          "A compared target DataForSEO returned **no row for** is named as unanswered, and the " +
          "answer says plainly that this is not a zero. The two are different facts — the vendor " +
          "did not report on that target at all — and only one of them is about the target.\n\n" +
          "The same rule runs inside a row: a field the vendor did not report prints as " +
          "unreported, while a genuine zero the vendor did send prints as `0`.",
      },
      {
        heading: "What this answer is scoped to",
        body:
          "The same four limits [`ai_visibility`](/docs/tools-reference/ai-visibility) states, and " +
          "for the same reason: **one assistant**, **one locale**, **one moment** (DataForSEO's " +
          "own timestamp, under the vendor key it came from), and **no date range at all** — this " +
          "endpoint takes none, so there is no period to ask for.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Compare how example.com, rival-one.com and " +
      "rival-two.com are mentioned in ChatGPT answers.\n\nThe client will ask you to confirm " +
      "before a wide comparison runs — see Billing.",
    returns:
      "A heading naming how many targets were compared and the DataForSEO function behind them, " +
      "then the scope paragraph, then the note that the order is yours.\n\n" +
      "Then one block per target, **in your order**, each naming what its label stands for — your " +
      "project, a domain or a keyword — followed by that target's rows under DataForSEO's own " +
      "field names, or the sentence that says the vendor returned no row for it. Targets the " +
      "vendor did not answer are also listed together at the end, so a long comparison does not " +
      "hide them.\n\n" +
      "A comparison set outside 2-10, a target naming none (or several) of `domain` / `keyword` / " +
      "`project_id`, two targets sharing a label, and a `project_id` that is not yours are all " +
      "rejected before anything is charged; while live data is off you get a \"not yet enabled\" " +
      "message instead — also free.",
    postReturnsSections: [
      {
        heading: "Billing",
        body:
          "**The price is per compared target**, not per call — this is the one tool in SeoGrep " +
          "priced that way. Comparing ten targets costs ten targets' worth of credits and " +
          "comparing two costs two, and the cost line above states both ends of that range. The " +
          "reservation is opened before the DataForSEO request and is sized from the targets you " +
          "actually passed; if the request fails, the whole reservation is released and **you are " +
          "not charged**.\n\n" +
          "A comparison above SeoGrep's safety threshold **asks you first**: the call returns an " +
          "estimate and charges nothing until you run it again with `\"confirm\": true`. This is " +
          "not a rare corner — it is the **usual** case. At the price above, only the two-target " +
          "minimum runs straight through; **three targets and up cross the threshold and prompt**. " +
          "Plan for the prompt rather than being surprised by it.\n\n" +
          "A failed lookup is not a lookup that found nothing. The refusal quotes DataForSEO's " +
          "own status code and message, and says the half that \"you were not charged\" leaves " +
          "out: the attempt did go out to DataForSEO and used part of SeoGrep's own daily " +
          "third-party data allowance. That is our cost, not yours.\n\n" +
          "`ai_visibility_compare` needs a **paid credit balance**. It reads live data from a " +
          "paid third-party provider, so it is not available on trial credits; the refusal arrives " +
          "before anything is reserved and says outright that you were not charged. Buy any credit " +
          "pack and it unlocks straight away; your existing credits are untouched and keep " +
          "working for crawls, audits, reports and Search Console tools.\n\n" +
          "**`internal_list_limit` is not a price control** here either. The vendor's own words " +
          "for it are \"maximum number of elements within internal arrays\": it caps two nested " +
          "arrays inside each aggregate, not the rows returned and not the rows billed. An " +
          "earlier version of this page called it part of the price; that claim is withdrawn. " +
          "Asking for fewer entries costs the same, and asking for more than the vendor's " +
          "published ceiling is refused before anything is charged.",
      },
      {
        heading: "Limitations",
        body:
          "Every delivered lookup is **recorded**: SeoGrep keeps a row saying what was " +
          "looked up, when, under which settings, and a capped summary of what came back. " +
          "The **Lookups** page of your dashboard lists them, so a lookup you paid for an " +
          "hour ago is still something you can point at.\n\n" +
          "That record is history, not a live surface. No call here reads a previous run, nothing " +
          "is refreshed for you, and there is no \"changed since last time\" — so to see the current " +
          "picture, run it again.\n\n" +
          "This is a measurement, **not a prediction** and not a verdict: it does not say which " +
          "target is doing better, why an assistant mentioned one and not another, or what to " +
          "change. A measurement on one platform does not carry over to another.\n\n" +
          "The location is a **name** (`location_name`), not the numeric location code the other " +
          "SeoGrep tools take: this DataForSEO family publishes no code.",
      },
    ],
  },

  generate_report: {
    lead:
      "`generate_report` rolls up a project's latest [`crawl_site`](/docs/tools-reference/crawl-site) " +
      "and [`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) results into a single, self-contained " +
      "**HTML report** and returns a **public link** you can share with clients or teammates. Run " +
      "`crawl_site` and/or `pull_gsc_data` first.",
    whatItDoes:
      "It reads the most recent successful crawl and Search Console pull for the project (whichever " +
      "exist) and re-runs the analysis engines over them — the **same** engines the audit and " +
      "discovery tools use, over the **same** stored data, so no new crawl, no new pull, and no " +
      "extra charge:\n\n" +
      "- **Site crawl** — pages crawled and skipped, dated, with a warning when the crawl is old.\n" +
      "- **On-page issues** — the full finding breakdown from `audit_onpage`, plus duplicate-content " +
      "groups.\n" +
      "- **Technical health** — the HTTP status split and the pages behind it, plus broken internal " +
      "links, redirect chains, `X-Robots-Tag` conflicts, deep and orphaned pages, skipped-page " +
      "categories, and the sitemap-vs-crawl comparison.\n" +
      "- **Page speed** — slow and heavy pages, from how long **our crawler's** fetch of each page " +
      "took and how large the HTML it returned was. These are **not** lab Core Web Vitals and " +
      "**not** field data from real visitors — no browser renders the page, so nothing here " +
      "measures LCP, INP or CLS. Use [`audit_speed`](/docs/tools-reference/audit-speed) for Core " +
      "Web Vitals. A crawl stored before SeoGrep recorded these signals says so, instead of " +
      "reporting an unmeasured site as a fast one.\n" +
      "- **Structured data** — coverage and declared types, plus missing required fields, " +
      "unparseable JSON-LD, and partly-stored blocks.\n" +
      "- **Search performance** — the current window's total clicks and impressions, plus your top " +
      "queries and top pages.\n" +
      "- **Opportunities** — quick wins, cannibalized queries (branded queries excluded and " +
      "counted), and decaying pages.\n\n" +
      "Sections appear only when there is something to report. A signal your stored crawl is too " +
      "old to carry is **left out rather than reported as zero**, so silence never reads as a " +
      "clean bill of health.\n\n" +
      "It is still a **summary**: the lists are capped and always say how many rows they left out, " +
      "and each section points you at the deep tool — `audit_onpage`, `audit_tech`, `audit_schema`, " +
      "`audit_content`, `find_quick_wins`, `detect_cannibalization`, `analyze_content_decay` — for " +
      "the full per-page breakdown. Every report carries a small \"powered by SeoGrep\" footer.\n\n" +
      "If the project has **neither** a crawl nor a Search Console pull yet, the tool tells you to " +
      "run `crawl_site` or `pull_gsc_data` first — and you are **not** charged.",
    example:
      "Ask your MCP client in plain language:\n\n> Generate a shareable SEO report for my example.com " +
      "project.",
    returns:
      "The report's title, its `report_id`, and a **public URL** (`/r/<slug>`) that anyone with the " +
      "link can open — no sign-in required. The link uses an unguessable 64-bit slug, and you can see " +
      "all your reports on the **Reports** page of your dashboard, where you can also **revoke** a " +
      "link. Revoking stops future access; it does not delete the report, and it cannot un-share " +
      "what someone has already read. The report itself repeats this notice, so whoever you send " +
      "it to sees it too.",
  },

  whats_next: {
    lead:
      "`whats_next` is the guide for non-experts. It looks at where a project stands — whether it has " +
      "been crawled, whether Google Search Console is connected, whether you have pulled performance " +
      "data — and tells you the **single best next step**, a short reason, and the two or three steps " +
      "that come after.",
    whatItDoes:
      "Pass a `project_id` to route that project; omit it and it routes your **only** project, or " +
      "lists them and asks which one if you track several. It reads the project's state through " +
      "the same tenant-scoped data the tools use — your latest " +
      "[`crawl_site`](/docs/tools-reference/crawl-site) and " +
      "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) runs, whether Search Console is " +
      "connected, **whether that connection is still alive**, and whether the domain resolves — " +
      "then walks a ladder, taking the first rung that applies:\n\n" +
      "- **No project yet** → run [`setup_project`](/docs/tools-reference/setup-project).\n" +
      "- **The domain does not resolve** → nothing to measure yet. This rung names no paid tool " +
      "at all, because every recommendation below it would be work against a host that is not " +
      "there.\n" +
      "- **No crawl yet** → run [`crawl_site`](/docs/tools-reference/crawl-site) (works without " +
      "Search Console).\n" +
      "- **Crawl ready, Search Console never used** → run the audits: " +
      "[`audit_onpage`](/docs/tools-reference/audit-onpage), " +
      "[`audit_tech`](/docs/tools-reference/audit-tech), " +
      "[`audit_schema`](/docs/tools-reference/audit-schema). Connecting Search Console with " +
      "[`connect_gsc`](/docs/tools-reference/connect-gsc) is **optional** and never a barrier.\n" +
      "- **Old Search Console data but no live connection** → " +
      "[`connect_gsc`](/docs/tools-reference/connect-gsc), which is free. Frozen rows cannot be " +
      "refreshed, so nothing that reads them is offered.\n" +
      "- **Connected, but the credential is dead** → " +
      "[`connect_gsc`](/docs/tools-reference/connect-gsc) again, and the discovery tools are " +
      "deliberately withheld: they read a pull this project cannot take.\n" +
      "- **Connected, but no property is mapped** → " +
      "[`list_gsc_properties`](/docs/tools-reference/list-gsc-properties), then " +
      "[`track_gsc_property`](/docs/tools-reference/track-gsc-property). Both are free. The " +
      "Google account works, so this rung does **not** send you round another OAuth loop — what " +
      "is missing is the mapping, and until it exists a Search Console pull cannot run.\n" +
      "- **Connected, nothing pulled** → run " +
      "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data).\n" +
      "- **A pull or a crawl has gone stale** → refresh that one first, so the numbers describe " +
      "the site as it is now.\n" +
      "- **Everything fresh, but nothing analysed yet** → " +
      "[`find_quick_wins`](/docs/tools-reference/find-quick-wins) first: it reads the Search " +
      "Console data you already pulled and names the pages closest to moving up. A report is " +
      "worth generating once there are findings to put in it.\n" +
      "- **Everything fresh** → you're all set: " +
      "[`generate_report`](/docs/tools-reference/generate-report) for a shareable summary, and the " +
      "`monthly-routine` prompt to keep it up to date.",
    preExampleSections: [
      {
        heading: "\"Rows were pulled once\" is not \"the link is live\"",
        body:
          "The two used to be the same signal, and the difference is what the middle of that " +
          "ladder is for. A succeeded pull is a fact about the past: it outlives a disconnect, an " +
          "unmapped property and a deleted Google account. A project holding one such pull and no " +
          "connection was told it was **all set** and pointed at a paid report — while the free " +
          "reconnection that was the real next step went unmentioned.\n\n" +
          "So liveness is now read separately, and a project that cannot refresh its Search " +
          "Console data is never called all set, however fresh the frozen rows look.",
      },
      {
        heading: "Every step says what it costs",
        body:
          "The primary step and each line of what follows carry their own price — free, or the " +
          "credits that tool charges. This tool is for the reader who does not already know the " +
          "price list, and a list that named a free step and a paid one in the same breath left " +
          "them nothing to choose with.\n\n" +
          "The figures are read from the same signed cost table the tools charge from, never " +
          "restated here, and a tool priced per unit shows the **range** a call can really cost " +
          "rather than a unit price no call ever pays. A step that is not a priced tool — a " +
          "prompt, or a note about coming back later — shows no price rather than a guessed one.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> What should I do next with my example.com project?",
    returns:
      "One clear next step for the project, a short reason, and the next two or three steps — all " +
      "in plain language, naming the exact tools to run and what each one costs. An archived " +
      "project is refused rather than routed, and a `project_id` that is not yours is reported " +
      "exactly like an id that does not exist.",
  },

  list_gsc_properties: {
    lead:
      "`list_gsc_properties` shows every Search Console property on the Google accounts you have " +
      "connected — each one's permission level, whether SeoGrep can read its performance data, and " +
      "which project reads it. It is the tool to reach for when a property you can see in Search " +
      "Console does not seem to be available here.",
    whatItDoes:
      "For each connected Google account it asks Google for that account's property list, then lines " +
      "each property up against your projects. A property your account cannot query is **still " +
      "listed**, marked `NOT QUERYABLE` with its permission level, so a property is never silently " +
      "missing. Nothing is cached: the list is read live, every time.",
    preExampleSections: [
      {
        heading: "It names the project a property plainly belongs to",
        body:
          "A property no project reads is not left as a bare \"not used by any project\". If one " +
          "of your projects names the **same site** and reads no property yet, the line names " +
          "that project and tells you to run " +
          "[`track_gsc_property`](/docs/tools-reference/track-gsc-property) to link them. Both " +
          "sides used to be printed with nothing to say they belonged together, which left one " +
          "free call undone for as long as nobody noticed.\n\n" +
          "The match ignores a leading `www.` on either side and **nothing else**. A subdomain is " +
          "a different site and is never offered: `blog.example.com` is not `example.com`. And " +
          "only a project that reads **no** property qualifies — a project already bound to a " +
          "different property is in a deliberate state, and offering to link it would really be " +
          "offering to repoint it.\n\n" +
          "A project that still holds a property but lost the Google account behind it is named " +
          "on that property's line too, with " +
          "[`connect_gsc`](/docs/tools-reference/connect-gsc) as the repair. Disconnecting an " +
          "account leaves the mapping in place and clears the account, and such a project used " +
          "to appear in neither hint — it was printed as \"not used by any project\" while " +
          "[`list_projects`](/docs/tools-reference/list-projects) said of the very same project " +
          "that it was still mapped. It is not offered `track_gsc_property`: the mapping is " +
          "already there, and it is the account that has to come back.",
      },
      {
        heading: "The order is fixed",
        body:
          "For one account, the properties are always listed in the same order, so two reads of " +
          "the same inventory line up against each other. Google's own listing carries no " +
          "ordering promise, and printing it as it arrived returned the same 27 properties in " +
          "two different orders on two calls a second apart.",
      },
      {
        heading: "When an account cannot be read",
        body:
          "If Google refuses — an expired connection, an outage — that account is reported as **could " +
          "not be read**, never as an account with no properties. An absence we did not observe is " +
          "not an absence, and the difference is what tells you to reconnect rather than to go and " +
          "verify a property that was there all along. The other accounts are still listed.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Which Search Console properties can SeoGrep see?" +
      "\n\nThen map one to a project on the Connection page, or with " +
      "[`connect_gsc`](/docs/tools-reference/connect-gsc) if the account is not connected yet.",
    returns:
      "One block per connected Google account: its email and `account_id`, then one line per " +
      "property with its permission level, the projects reading it through that account, and — where " +
      "it applies — why SeoGrep cannot query it.",
  },

  track_gsc_property: {
    lead:
      "`track_gsc_property` turns a Search Console property into a tracked project in one call. " +
      "It works out the site's domain from the property, opens the project for it — or brings it " +
      "back from your archive — and links the property to it, ready for " +
      "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data).",
    whatItDoes:
      "Pass a property as [`list_gsc_properties`](/docs/tools-reference/list-gsc-properties) " +
      "prints it — or just the site's host, `example.com`. SeoGrep re-reads your Google accounts " +
      "live and only accepts a property one of them actually lists; what you type is never taken " +
      "as proof it exists. If you already have a project for that site, it is reused rather than " +
      "duplicated — running this twice with the **same** property changes nothing. If the same " +
      "property sits on two of your connected accounts, SeoGrep asks which one to read it " +
      "through instead of guessing, and you re-run with `account_id`.\n\n" +
      "Running it with a **different** property for a site you already track is not a no-op: it " +
      "**repoints** the project at the new property, and the old link is gone. That is a " +
      "supported call, not an accident, but it is a change of data source rather than a repeat " +
      "of the last one.",
    preExampleSections: [
      {
        heading: "A bare host is resolved — unless it is ambiguous",
        body:
          "`example.com` is the form people type from memory; `sc-domain:example.com` and " +
          "`https://example.com/` are the forms Search Console prints. A bare host is matched " +
          "against the properties your accounts really list, ignoring a leading `www.` on either " +
          "side, and is accepted when **exactly one** property names that site.\n\n" +
          "When more than one does, the tool **offers the choice and stops**. " +
          "`sc-domain:example.com` and `https://example.com/` are two different properties with " +
          "different data and different permissions, so the answer lists the candidates and asks " +
          "you to re-run with the one you want, spelled as it is printed. Picking one for you " +
          "would bind the project to a source you did not choose, and a wrong binding only shows " +
          "up much later, when the data stops making sense.\n\n" +
          "The same `www.` blindness applies to the project side: a property for " +
          "`example.com` finds a project stored as `www.example.com` rather than opening a " +
          "second project beside it. Only the leading `www.` label is ignored — a subdomain is a " +
          "different site.",
      },
      {
        heading: "Domain properties and disavow",
        body:
          "When the property you bind is a **Domain** property (`sc-domain:example.com`), the " +
          "answer carries one extra note: Google's disavow links tool does not support Domain " +
          "properties, so a disavow file for that site has to be submitted through a URL-prefix " +
          "property instead. It is said here because this is where the kind of property is " +
          "known — [`disavow_candidates`](/docs/tools-reference/disavow-candidates) is where you " +
          "would otherwise find out. A URL-prefix property gets no such note; the limitation " +
          "does not apply to it.",
      },
      {
        heading: "When it refuses",
        body:
          "A property your account cannot query is refused **before** any project is created — a " +
          "project that looks tracked but can answer nothing is worse than no project, so the " +
          "answer names the permission level and what to do about it. A property no connected " +
          "account lists is refused the same way. And if Google could not be reached at all, you " +
          "are told the account could not be read, never that the property is missing: an absence " +
          "we did not observe is not an absence.\n\n" +
          "The same rule applies when only **some** of your accounts answer. If the property is " +
          "listed on an account that answered while another account could not be read, SeoGrep " +
          "refuses rather than binding: the silent account might list it too, and a passing " +
          "outage must not decide which Google account a project reads through. Re-run with " +
          "`account_id` to settle it yourself, or try again once the other account is readable.",
      },
      {
        heading: "Archived projects",
        body:
          "If you archived the project for this domain earlier, this brings back the **same " +
          "project** — its id, its crawls and its reports are all still there. Nothing is started " +
          "from scratch and no second project is created for the same site.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Track sc-domain:example.com in SeoGrep." +
      "\n\nOr just name the site — > Track example.com in SeoGrep. — and run " +
      "[`list_gsc_properties`](/docs/tools-reference/list-gsc-properties) if the answer comes " +
      "back asking which of several properties you meant.",
    returns:
      "The project the property was attached to — its domain and `project_id`, whether it was " +
      "created, already tracked or restored from your archive, which Google account it now reads " +
      "through, and the tools to run next.",
  },

  track_keywords: {
    lead:
      "`track_keywords` chooses which keywords a project's ranking is watched for — on one " +
      "location, one language and one device. It is **registration only**: it records what to " +
      "watch and takes no measurement, contacts no search engine, and costs nothing.",
    whatItDoes:
      "Pass a `project_id` and the keywords you want watched. They are stored trimmed and " +
      "lower-cased, so two spellings that differ only in case or spacing are one tracked " +
      "keyword. Running it again for the same keyword is safe — nothing is duplicated and " +
      "nothing is re-dated. Set `action` to `untrack` to stop watching one, or to `list` to read " +
      "back everything the project already tracks.",
    preExampleSections: [
      {
        heading: "Reading back what a project tracks",
        body:
          "`action: \"list\"` answers with every keyword the project is tracking right now, " +
          "grouped by the location, language and device each one is watched on. It takes no " +
          "`keywords` — it is a question about the project, not about a list you supply — and it " +
          "writes nothing.\n\n" +
          "It is **not** filtered by the `location_name`, `language_code` and `device` of the " +
          "call: those fields have defaults, and answering only about the defaults would tell a " +
          "project whose keywords all sit on another locale that it tracks nothing. Archived " +
          "(untracked) keywords are left out — they are kept, and `keyword_positions` still " +
          "reads what was measured for them, but the project is no longer watching them.",
      },
      {
        heading: "The location and the device are part of what is tracked",
        body:
          "Google returns different results, and a different layout, on desktop and on mobile — " +
          "and different results again in another country. So a tracked keyword is not just a " +
          "word: it is a word **plus** where and how it is measured. Tracking `seo tools` on the " +
          "US desktop SERP and on the UK mobile SERP is two tracked keywords, and their positions " +
          "are never mixed into one series, because a desktop ranking says nothing about a mobile " +
          "one.\n\nThat also means each combination counts separately against the limit below.",
      },
      {
        heading: "How many a project may track",
        body:
          "A project may track up to **{{MAX_TRACKED_KEYWORDS}}** keywords at once (counting each " +
          "location and device separately). The limit is about what measuring the whole set " +
          "costs and how much of it can be measured in a day — not about storage of the list " +
          "itself, which is free. If you hit it, untrack what you no longer watch: the answer " +
          "tells you how many are tracked and how many the request would have added.",
      },
      {
        heading: "Untracking keeps everything",
        body:
          "`action: \"untrack\"` archives the keyword rather than deleting it. Every position " +
          "already measured for it stays exactly where it is and " +
          "[`keyword_positions`](/docs/tools-reference/keyword-positions) still reads it. " +
          "Tracking it again brings back the same record, including the date you first started " +
          "watching it — and untracking something twice does not change that date either.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Track \"seo tools\" and \"rank tracker\" for " +
      "my example.com project on mobile.\n\nRun " +
      "[`list_projects`](/docs/tools-reference/list-projects) first if you need the `project_id`.",
    returns:
      "What is tracked now for that project on that location, language and device — split into " +
      "newly tracked, tracked again, and already tracked — together with a reminder that " +
      "tracking records what to watch and measures nothing. `action: \"list\"` instead returns " +
      "every keyword the project currently tracks, grouped by location, language and device.",
  },

  serp_snapshot: {
    lead:
      "`serp_snapshot` measures where a domain appears in Google's organic results for each of " +
      "your keywords — on one location, one language and one device — and **stores every " +
      "reading**, so [`keyword_positions`](/docs/tools-reference/keyword-positions) can show the " +
      "series later. It is the only part of the rank tracker that contacts a search engine.",
    whatItDoes:
      "Pass a `project_id` (or any `target` domain) and up to **{{MAX_SERP_KEYWORDS}}** keywords. " +
      "Each keyword is a **separate live search**, so the list is what the call costs — that is " +
      "why the price has a per-keyword part. Duplicates are refused rather than quietly removed, " +
      "and the list is never trimmed to fit: a shorter answer to a longer question is not the " +
      "answer you asked for.",
    preExampleSections: [
      {
        heading: "Who can run it",
        body:
          "`serp_snapshot` needs a **paid credit balance**. Each keyword is a separate live " +
          "search bought from a paid third-party provider, so it is not available on trial " +
          "credits, however many are left; the refusal arrives before anything is reserved and " +
          "says outright that you were not charged. Buy any credit pack and it unlocks straight " +
          "away — your existing credits are untouched and keep working for crawls, audits, " +
          "reports and Search Console tools.\n\n" +
          "This is the one part of the rank tracker that is **gated**, and gating is a separate " +
          "question from price. " +
          "[`track_keywords`](/docs/tools-reference/track-keywords) is free; " +
          "[`keyword_positions`](/docs/tools-reference/keyword-positions) charges for the " +
          "analysis but contacts no search engine. Neither is gated — both run on a trial " +
          "account, and each page states its own cost.\n\n" +
          "If live DataForSEO access is unavailable on this deployment, the tool says so and " +
          "**charges you nothing** — no credits are reserved or spent. SeoGrep never returns " +
          "sample or placeholder positions as if a search engine had really returned them.",
      },
      {
        heading: "Three answers, and none of them is a number you can misread",
        body:
          "A keyword comes back as exactly one of three things, and they are never collapsed:\n\n" +
          "- **Found** — with DataForSEO's own `rank_group` (its rank among organic results) and " +
          "`rank_absolute` (its rank among every element on the page, including featured snippets " +
          "and ad blocks). Both are reported where the vendor sent them, because they disagree " +
          "whenever a SERP feature sits above the result and that gap is itself the finding; " +
          "either one the vendor left out is stated as not reported rather than filled in.\n" +
          "- **Searched for and not found** — together with **how many organic results were " +
          "actually examined**. That is the scope of the claim: it is not position 0, and it says " +
          "nothing about results beyond the ones counted.\n" +
          "- **Not measured** — the request or the response failed, so the position is unknown. " +
          "Nothing was examined, so this is not a statement that the domain is absent.\n\n" +
          "SeoGrep computes no visibility score, no share of voice and no ranking of its own.",
      },
      {
        heading: "What a reading is scoped to",
        body:
          "A position is a measurement at a moment, not a property of a site. Every reading is " +
          "taken on **one** search engine, **one** location, **one** language, **one** device and " +
          "to one fixed depth, and the answer states all of them — Google returns different " +
          "results and a different layout on desktop and on mobile, so a desktop reading says " +
          "nothing about a mobile one.\n\nA result counts as yours only when its host matches " +
          "yours exactly, after lower-casing and removing a leading `www.`. A subdomain does " +
          "**not** count: `blog.example.com` is not `example.com`, because \"our blog ranks\" and " +
          "\"our site ranks\" are different findings and only you know which one you asked about.",
      },
      {
        heading: "It measures on demand, and only on demand",
        body:
          "Nothing here runs on a schedule. A snapshot happens because you asked for one, so no " +
          "credits are ever spent while you are not looking. " +
          "[`track_keywords`](/docs/tools-reference/track-keywords) records which keywords you " +
          "want watched — that is free and takes no measurement — and this tool is what turns a " +
          "watched keyword into a reading.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Take a SERP snapshot for \"seo tools\" and " +
      "\"rank tracker\" on my example.com project, on mobile.\n\nRun " +
      "[`list_projects`](/docs/tools-reference/list-projects) first if you need the `project_id`.",
    returns:
      "One block per keyword, in the order you passed them, each carrying its own answer of the " +
      "three above — and, where the domain was found, every placement it was found at with " +
      "DataForSEO's own ranks and URLs. The reply states what the snapshot was measured under " +
      "(search engine, location, language, device, depth requested and how a domain was matched), " +
      "separates DataForSEO's own account of when it measured from SeoGrep's clock, and confirms " +
      "how many readings were stored.",
  },

  keyword_positions: {
    lead:
      "`keyword_positions` reads the SERP positions SeoGrep has already measured and stored for a " +
      "domain's keywords: each reading with its own date, location, language and device. It " +
      "**measures nothing** — no search engine is contacted and no new position is read.",
    whatItDoes:
      "Pass a `project_id` (or any `target` domain) and it returns the stored readings, newest " +
      "first, grouped into series. A series is everything a reading was taken **under** — not " +
      "just the keyword, location, language and device you chose, but the search engine, the " +
      "depth that was requested, and the rule used to decide a result was yours. Those last " +
      "three fork a series too, and must: \"not found in the 10 results examined\" and \"not " +
      "found in the 100 results examined\" answer different questions, and putting them on one " +
      "line would turn a change of depth into an apparent movement. Narrow it with " +
      "`keyword`, `location_name`, `language_code` or `device`, and bound the answer with " +
      "`limit` — the reply always states how many readings match your filter in total, " +
      "separately from how many are in the window.",
    preExampleSections: [
      {
        heading: "A gap is not a decline",
        body:
          "Two readings a month apart are two observations, not a trend, and SeoGrep will not " +
          "draw a line through the days nobody measured. Every comparison between two readings " +
          "says how far apart they were, and an interval longer than a day says outright that " +
          "nothing was measured in between. No answer here claims a direction of travel: a " +
          "movement is printed as `#7 → #4`, never as a rise or a fall.",
      },
      {
        heading: "\"Not found\" and \"not measured\" are different answers",
        body:
          "A reading that searched and found nothing reports the absence **and how many results " +
          "were examined** — it is not position 0, and it says nothing about results beyond " +
          "those examined. A reading that never happened says so instead: the position is " +
          "unknown, and nothing was examined at all.\n\nA position is never compared across " +
          "either of them, because there is no second position to compare with.\n\nA reading " +
          "where the domain was **found** but the vendor reported no rank is a third case, and " +
          "it is really two, kept apart. DataForSEO has two rank scales — the organic-only one " +
          "and the one counting every element on the page — and it may withhold either. A row " +
          "with neither says so; a row where it gave the all-elements rank and withheld the " +
          "organic one says exactly that, and prints the number it did send. One sentence for " +
          "both would have printed \"DataForSEO reported no rank\" over a row on which " +
          "DataForSEO had reported one.",
      },
      {
        heading: "If nothing has been measured yet",
        body:
          "The tool says so and **charges nothing** — that refusal is returned before any " +
          "credits are reserved. It is the **only** free answer this tool gives: a read that " +
          "delivers stored readings is charged at the cost above, whether it returns one " +
          "reading or hundreds.\n\n" +
          "Positions appear here once a SERP snapshot has been taken for a domain's keywords. " +
          "[`track_keywords`](/docs/tools-reference/track-keywords) chooses which keywords to " +
          "watch — a separate step, and that one is free; " +
          "[`serp_snapshot`](/docs/tools-reference/serp-snapshot) is what takes the readings, " +
          "and it is priced per keyword.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Show me the stored positions for \"seo tools\" " +
      "on my example.com project.",
    returns:
      "One block per series — keyword, location, language, device, search engine, depth " +
      "requested and domain-match rule — with what each reading was measured under, each " +
      "reading's own date, and " +
      "the elapsed time between them. Ranks are DataForSEO's own `rank_group` and " +
      "`rank_absolute`; SeoGrep adds no score of its own.",
  },

  untrack_project: {
    lead:
      "`untrack_project` stops tracking one of your projects by moving it to your **archive**. " +
      "Nothing is deleted: the project, its crawls and reports, and its Search Console link stay " +
      "exactly as they are, and " +
      "[`track_gsc_property`](/docs/tools-reference/track-gsc-property) brings the same project " +
      "back unchanged.",
    whatItDoes:
      "Pass the `project_id` of a project you no longer want on your dashboard — " +
      "[`list_projects`](/docs/tools-reference/list-projects) prints the ids. SeoGrep marks it " +
      "archived and stops treating it as tracked. Running it again on a project that is already " +
      "archived is a **success, not an error**, and it does not change the date you archived it.",
    preExampleSections: [
      {
        heading: "Why it archives instead of deleting",
        body:
          "Archiving is what makes coming back free. Everything that hangs off the project — its " +
          "crawl history, its reports, and the Search Console property it reads through — stays " +
          "attached to the **same project id**, so restoring it is not a rebuild. Deleting would " +
          "throw that away and a re-added site would start from nothing.\n\n" +
          "To bring a project back, track its property again with " +
          "[`track_gsc_property`](/docs/tools-reference/track-gsc-property), or set the same " +
          "domain up again with [`setup_project`](/docs/tools-reference/setup-project) — either " +
          "one restores the original project in place.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Stop tracking my old-site.com project.\n\n" +
      "Run [`list_projects`](/docs/tools-reference/list-projects) first if you need the " +
      "`project_id`.",
    returns:
      "Confirmation that the project was archived — its domain and `project_id` — together with " +
      "how to bring it back. A project that is already archived says so and nothing changes. A " +
      "`project_id` that is not yours is reported exactly like an id that does not exist.\n\n" +
      "There is a fourth answer, and it is the one that must not be silent: if the archive write " +
      "matches no row — the project changed while the call was running — you are told **nothing " +
      "was changed** and that the project is still tracked. Reporting \"stopped tracking\" for a " +
      "write that changed nothing would be the worst of the four.",
  },
};

// ---------------------------------------------------------------------------
// I/O + CLI (not unit-tested — the registry is loaded lazily here)
// ---------------------------------------------------------------------------

const TOOLS_DIR = new URL("../content/docs/tools-reference/", import.meta.url);
const PARENT_META = new URL("../content/docs/meta.json", import.meta.url);

/**
 * Import ALL_TOOLS + TOOL_COSTS + the prose constants from the BUILT MCP registry (apps/mcp/dist).
 * `constants` carries the values DOC_PROSE quotes through tokens, so the docs follow the code.
 */
async function loadRegistry() {
  const toolsUrl = new URL("../../mcp/dist/tools/index.js", import.meta.url);
  const costsUrl = new URL("../../mcp/dist/credits/costs.js", import.meta.url);
  const pullUrl = new URL("../../mcp/dist/gsc-data/pull.js", import.meta.url);
  const windowsUrl = new URL("../../mcp/dist/gsc-data/windows.js", import.meta.url);
  const trackedUrl = new URL("../../mcp/dist/tools/tracked-keywords-store.js", import.meta.url);
  // The crawler's own wall-clock budget — the ceiling that usually stops a crawl before its page
  // cap does. The crawl_site page quotes it through {{CRAWL_TIME_BUDGET}}.
  const crawlerUrl = new URL("../../mcp/dist/crawler/crawl.js", import.meta.url);
  // The SAME predicate the credit guard calls before every charged tool (credits/guard.ts). The hub
  // page publishes its answer, so a tool moving in or out of the trial gate re-renders the docs and
  // turns --check red — instead of a hand-kept list quietly disagreeing with the runtime.
  const paidBalanceUrl = new URL("../../mcp/dist/credits/paid-balance.js", import.meta.url);
  try {
    const tools = await import(toolsUrl);
    const costs = await import(costsUrl);
    const pull = await import(pullUrl);
    const windows = await import(windowsUrl);
    const tracked = await import(trackedUrl);
    const crawler = await import(crawlerUrl);
    const paidBalance = await import(paidBalanceUrl);
    return {
      ALL_TOOLS: tools.ALL_TOOLS,
      TOOL_COSTS: costs.TOOL_COSTS,
      CREDIT_UNITS: costs.CREDIT_UNITS,
      requiresPaidBalance: paidBalance.requiresPaidBalance,
      constants: {
        maxRowLimit: pull.MAX_ROW_LIMIT,
        lagDays: windows.GSC_FRESHNESS_LAG_DAYS,
        maxTrackedKeywords: tracked.MAX_TRACKED_KEYWORDS_PER_PROJECT,
        // The SERP keyword cap, taken from the PRICE TABLE rather than from dfs/serp.ts. It is
        // the same number by construction (costs.test.ts pins CREDIT_UNITS.serp_snapshot.max_units
        // EQUAL to the port's MAX_SERP_KEYWORDS), and reading it here keeps this generator's
        // imports to the two modules it already loads — the registry and the prices.
        maxSerpKeywords: costs.CREDIT_UNITS.serp_snapshot.max_units,
        crawlTimeBudgetSeconds: Math.round(crawler.DEFAULT_TIME_BUDGET_MS / 1000),
        // Derived from the registry itself — see domainAddressableTools for why it is not a list.
        domainTools: domainAddressableTools(tools.ALL_TOOLS),
      },
    };
  } catch (error) {
    throw new Error(
      "Could not import the built MCP registry from apps/mcp/dist — build it first with " +
        `\`pnpm --filter @pseo/mcp build\`. (${error.message})`,
    );
  }
}

/** The frozen page for one tool (throws if its prose block is missing). */
function pageFor(tool, cost, constants, unitRule) {
  const prose = DOC_PROSE[tool.name];
  if (!prose) throw new Error(`No DOC_PROSE entry for tool "${tool.name}" — add one before generating.`);
  return substituteProseTokens(renderToolPage(tool, cost, prose, unitRule), constants);
}

/** The tools-reference meta.json content, derived from ALL_TOOLS order. */
function toolsMetaJson(allTools) {
  // `index` leads, so fumadocs renders the hub as the section's landing page and the tools follow in
  // registry order. checkToolsMetaSync filters it out via NON_TOOL_ALLOWLIST, so the tool-order pin
  // is unchanged by its presence.
  const pages = ["index", ...allTools.map((t) => deriveSlug(t.name))];
  return `${JSON.stringify({ title: "Tools Reference", pages }, null, 2)}\n`;
}

/** Ensure the parent docs nav lists tools-reference (inserted after core-concepts). Idempotent. */
function ensureParentNav() {
  const meta = JSON.parse(readFileSync(PARENT_META, "utf8"));
  const pages = meta.pages || [];
  if (pages.includes("tools-reference")) return false;
  const anchor = pages.indexOf("core-concepts");
  const at = anchor >= 0 ? anchor + 1 : pages.length;
  const next = [...pages.slice(0, at), "tools-reference", ...pages.slice(at)];
  writeFileSync(PARENT_META, `${JSON.stringify({ ...meta, pages: next }, null, 2)}\n`);
  return true;
}

/** Write all tool pages + tools-reference meta.json + parent nav. */
function writeAll({ ALL_TOOLS, TOOL_COSTS, CREDIT_UNITS, constants, requiresPaidBalance }) {
  for (const tool of ALL_TOOLS) {
    writeFileSync(
      new URL(`${deriveSlug(tool.name)}.mdx`, TOOLS_DIR),
      pageFor(tool, TOOL_COSTS[tool.name], constants, CREDIT_UNITS[tool.name]),
    );
  }
  writeFileSync(
    new URL("index.mdx", TOOLS_DIR),
    renderIndexPage(ALL_TOOLS, TOOL_COSTS, CREDIT_UNITS, requiresPaidBalance),
  );
  writeFileSync(new URL("meta.json", TOOLS_DIR), toolsMetaJson(ALL_TOOLS));
  const navChanged = ensureParentNav();
  console.error(
    `gen-tool-docs: wrote ${ALL_TOOLS.length} tool pages + index.mdx + meta.json` +
      `${navChanged ? " + added tools-reference to parent nav" : ""}.`,
  );
}

/** Run the three --check gates. Returns a list of human-readable failures (empty = in sync). */
function collectCheckErrors({ ALL_TOOLS, TOOL_COSTS, CREDIT_UNITS, constants, requiresPaidBalance }) {
  const errors = [];
  const expectedSlugs = ALL_TOOLS.map((t) => deriveSlug(t.name));

  // (i) Every tool page on disk is byte-identical to a fresh render, and no stray tool pages exist.
  for (const tool of ALL_TOOLS) {
    const slug = deriveSlug(tool.name);
    let actual;
    try {
      actual = readFileSync(new URL(`${slug}.mdx`, TOOLS_DIR), "utf8");
    } catch {
      errors.push(`(i) missing page ${slug}.mdx — run \`node apps/web/scripts/gen-tool-docs.mjs\`.`);
      continue;
    }
    if (actual !== pageFor(tool, TOOL_COSTS[tool.name], constants, CREDIT_UNITS[tool.name])) {
      errors.push(`(i) ${slug}.mdx is out of sync — regenerate with \`node apps/web/scripts/gen-tool-docs.mjs\`.`);
    }
  }
  for (const file of readdirSync(fileURLToPath(TOOLS_DIR))) {
    const slug = file.replace(/\.mdx$/, "");
    if (file.endsWith(".mdx") && !expectedSlugs.includes(slug) && !NON_TOOL_ALLOWLIST.includes(slug)) {
      errors.push(`(i) unexpected page tools-reference/${file} — no matching tool in ALL_TOOLS.`);
    }
  }

  // (i-b) The section hub, byte-compared like every tool page. Without this line index.mdx would be
  // merely PERMITTED by the allowlist rather than CHECKED — a page that stops matching the registry
  // and never turns anything red, which is the shape of finding this section was created to close.
  let indexActual;
  try {
    indexActual = readFileSync(new URL("index.mdx", TOOLS_DIR), "utf8");
  } catch {
    errors.push("(i) missing tools-reference/index.mdx — run `node apps/web/scripts/gen-tool-docs.mjs`.");
  }
  if (
    indexActual !== undefined &&
    indexActual !== renderIndexPage(ALL_TOOLS, TOOL_COSTS, CREDIT_UNITS, requiresPaidBalance)
  ) {
    errors.push(
      "(i) tools-reference/index.mdx is out of sync — regenerate with " +
        "`node apps/web/scripts/gen-tool-docs.mjs`.",
    );
  }

  // (ii) No tool input schema may declare a reserved `confirm` field (D17).
  for (const name of findConfirmFields(ALL_TOOLS)) {
    errors.push(`(ii) tool "${name}" declares a reserved 'confirm' field in its input schema (D17).`);
  }

  // (iii) tools-reference meta.json matches ALL_TOOLS (name + order); parent nav lists it.
  let metaPages = [];
  try {
    metaPages = JSON.parse(readFileSync(new URL("meta.json", TOOLS_DIR), "utf8")).pages || [];
  } catch {
    errors.push("(iii) could not read tools-reference/meta.json.");
  }
  for (const message of checkToolsMetaSync(ALL_TOOLS.map((t) => t.name), metaPages).errors) {
    errors.push(`(iii) ${message}`);
  }
  try {
    const parent = JSON.parse(readFileSync(PARENT_META, "utf8"));
    if (!(parent.pages || []).includes("tools-reference")) {
      errors.push("(iii) parent docs/meta.json nav is missing 'tools-reference'.");
    }
  } catch {
    errors.push("(iii) could not read parent docs/meta.json.");
  }

  // (iv) Every generated frontmatter description is within the meta-description budget, so a future
  // long tool description can't silently regress a page's <meta name="description">. Measured on the
  // ACTUAL rendered page, so a regression that bypasses truncation is caught here.
  for (const tool of ALL_TOOLS) {
    const length = frontmatterDescription(
      pageFor(tool, TOOL_COSTS[tool.name], constants, CREDIT_UNITS[tool.name]),
    ).length;
    if (length > FRONTMATTER_DESCRIPTION_MAX) {
      errors.push(
        `(iv) ${deriveSlug(tool.name)}.mdx frontmatter description is ${length} chars ` +
          `(max ${FRONTMATTER_DESCRIPTION_MAX}) — shorten the tool description or its truncation.`,
      );
    }
  }

  return errors;
}

/**
 * Refuse to read a `dist` that no longer matches `apps/mcp/src`. Without this, BOTH modes lie in
 * the same direction: `--check` compares today's MDX with yesterday's registry and prints a green
 * that measured nothing (MEASURED: a description edited in src and not rebuilt still gave
 * "38 tool pages in sync", exit 0), and a generating run would WRITE those yesterday pages back.
 * This is a detector, not a compiler — see dist-freshness.mjs for the criterion and its blind spots.
 */
function assertRegistryFresh() {
  return assertDistFresh({
    srcDir: fileURLToPath(new URL("../../mcp/src/", import.meta.url)),
    distDir: fileURLToPath(new URL("../../mcp/dist/", import.meta.url)),
    srcLabel: "apps/mcp/src",
    distLabel: "apps/mcp/dist",
  });
}

async function main() {
  const freshness = assertRegistryFresh();
  const registry = await loadRegistry();
  if (process.argv.includes("--check")) {
    const errors = collectCheckErrors(registry);
    if (errors.length > 0) {
      console.error("gen-tool-docs --check FAILED:");
      for (const error of errors) console.error(`  - ${error}`);
      process.exit(1);
    }
    console.error(
      `gen-tool-docs --check OK — ${registry.ALL_TOOLS.length} tool pages in sync, confirm declared ` +
        `by no tool schema (advertised by the registry on ` +
        `${registry.ALL_TOOLS.filter((tool) => tool.confirmable).length}), ` +
        `meta + nav synced, all descriptions ≤${FRONTMATTER_DESCRIPTION_MAX} chars; ` +
        `apps/mcp/dist verified fresh (${freshness.measured}` +
        `${freshness.rescued ? ", timestamps forgiven by an identical source fingerprint" : ""}).`,
    );
    return;
  }
  writeAll(registry);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
