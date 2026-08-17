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
// The pure functions below are exported and unit-tested (apps/web/lib/tool-docs-gen.test.ts); the
// registry is imported lazily inside main(), so importing this module for tests is side-effect free.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/** The single credit-cost line, derived from TOOL_COSTS[name]. Zero renders as free. */
export function renderCostLine(cost) {
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
export function renderToolPage(toolMeta, cost, prose) {
  const description = truncateAtWord(stripCostSentences(toolMeta.description), FRONTMATTER_DESCRIPTION_MAX);
  const frontmatter = [
    "---",
    `title: ${toolMeta.name}`,
    `description: ${yamlString(description)}`,
    "---",
  ].join("\n");

  const blocks = [frontmatter, renderCostLine(cost)];
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
 *
 * The same derivation format.ts makes for the tool-output caveat: prose is exactly where a changed
 * constant goes unnoticed, because nothing compiles against a sentence — and a wrong number here
 * tells the reader how much data they are missing with no way to check it.
 *
 * Fail-closed: a non-integer constant, or a token nobody substitutes, throws instead of rendering a
 * page that states a wrong (or literally "undefined") limit.
 */
export function substituteProseTokens(text, constants) {
  const { maxRowLimit, lagDays } = constants || {};
  const out = String(text)
    .replace(/\{\{MAX_GSC_ROWS\}\}/g, () =>
      groupThousands(positiveInteger(maxRowLimit, "{{MAX_GSC_ROWS}}", "maxRowLimit")),
    )
    .replace(/\{\{GSC_LAG_DAYS\}\}/g, () =>
      dayPhrase(positiveInteger(lagDays, "{{GSC_LAG_DAYS}}", "lagDays")),
    );
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

/** Pages allowed in tools-reference/meta.json that are not tools (none today; kept for future). */
export const NON_TOOL_ALLOWLIST = [];

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

/** Tool names that declare a reserved `confirm` field in their input schema (D17 — must be none). */
export function findConfirmFields(tools) {
  const offenders = [];
  for (const tool of tools) {
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

export const DOC_PROSE = {
  setup_project: {
    lead:
      "`setup_project` registers a domain so SeoGrep can crawl, audit, and report on it. It is " +
      "**idempotent** — running it again for the same domain (in any URL or host form) returns the " +
      "existing project instead of creating a duplicate.",
    whatItDoes:
      "Normalizes the input to a canonical domain, then creates the project under your account — or " +
      "returns the existing one if you already track that site.",
    example: "Ask your MCP client in plain language:\n\n> Set up example.com as a project.",
    returns:
      "The `project_id`, the canonical `domain`, and `created` (whether it was newly created).",
  },

  connect_gsc: {
    lead:
      "`connect_gsc` links a project to Google Search Console so the tools that need real " +
      "search-performance data — like `pull_gsc_data` and `analyze_content_decay` — can run. It is " +
      "**optional**: your first crawl and audit work without it, so connecting is the **second step, " +
      "never the first barrier**.",
    whatItDoes:
      "Given one of your projects, it returns a secure Google sign-in link. Opening the link takes you " +
      "to Google's consent screen, where SeoGrep requests **read-only** Search Console access — it " +
      "never asks for write access to your property. After you approve, SeoGrep stores an encrypted " +
      "token and matches your project's domain to a verified Search Console property.",
    preExampleSections: [
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
      "dashboard with the connection in place.",
    returns:
      "A Google sign-in link for the project, plus a reminder that the connection is optional and " +
      "read-only. If your account has no property matching the project's domain, the connection is " +
      "still saved — just without a matched property; you can reconnect to retry matching once the " +
      "property is verified in Search Console.",
  },

  list_projects: {
    lead:
      "`list_projects` returns the domains you're tracking, oldest first, each with its `project_id`. " +
      "If you have none yet, it points you to `setup_project`.",
    whatItDoes: "Reads your projects, scoped to your account, and returns them as a simple list.",
    example: "Ask your MCP client in plain language:\n\n> Which sites am I tracking?",
    returns:
      "One line per project (`domain` and `project_id`), or guidance to create your first project " +
      "when the list is empty.",
  },

  get_credit_balance: {
    lead:
      "`get_credit_balance` reports your available credits — the running total of your credit ledger.",
    whatItDoes:
      "Sums your credit ledger, scoped to your account, and returns the available balance. Paid tools " +
      "debit credits when they run; a balance of 0 blocks paid tools until you top up.",
    example: "Ask your MCP client in plain language:\n\n> How many credits do I have left?",
    returns: "Your available credit balance.",
  },

  crawl_site: {
    lead:
      "`crawl_site` crawls the website behind one of your projects — following its sitemap and " +
      "same-origin links, respecting `robots.txt` — and records the pages for later audits. It is " +
      "**asynchronous**: the call returns a `job_id` immediately instead of waiting for the crawl to " +
      "finish, so the MCP request never times out on a large site. The crawl is charged only when it " +
      "runs — a crawl that reaches no pages is not charged.",
    whatItDoes:
      "Queues a crawl for the project's domain and hands you a `job_id`. A background worker runs the " +
      "crawl and stores the result; you check progress with " +
      "[`get_job_status`](/docs/tools-reference/get-job-status).",
    preExampleSections: [
      {
        heading: "Large sites",
        body:
          "Each crawl covers up to **100 pages**. To crawl a bigger site, target a section with " +
          "`include_paths` — for example `[\"/blog\"]` — and run one focused crawl per section; this " +
          "keeps every crawl within the cap and spends predictably.\n\n" +
          "Before queuing, `crawl_site` runs a quick, **free** size check. If your site is very large, " +
          "it first returns a **confirmation** — nothing is charged — that states this run's flat cost " +
          "and, kept separate, an **informational projection** of what crawling the whole site would " +
          "take at the current rate. The projection is never what you are charged; it just means a big " +
          "site can't silently run up cost. Re-run with `\"confirm\": true` to proceed, or narrow the " +
          "scope with `include_paths`.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> Crawl my example.com project.\n\nThe tool replies " +
      "with a `job_id`. Poll it until the job is done:\n\n> What's the status of job `<job_id>`?",
    returns:
      "A `job_id`, a `status` of `queued`, and the `estimated_credits` the crawl will cost. Feed the " +
      "`job_id` to `get_job_status` to watch it finish and read the summary.",
  },

  get_job_status: {
    lead:
      "`get_job_status` reports on an asynchronous job — such as a " +
      "[`crawl_site`](/docs/tools-reference/crawl-site) run — by its `job_id`. It is how you follow an " +
      "async tool from `queued` to `succeeded` (or `failed`).",
    whatItDoes:
      "Looks up the job under your account and returns its current status, its lifecycle timestamps, " +
      "and — once it succeeds — a short summary of the result. A job that does not belong to you is " +
      "reported as not found, the same as an unknown id.",
    example:
      "After `crawl_site` gives you a `job_id`, ask your MCP client:\n\n> What's the status of job " +
      "`<job_id>`?\n\nRepeat until the status is `succeeded`. A finished crawl summarizes how many " +
      "pages were crawled, how many were skipped, and how many issues were found.",
    returns:
      "The job `status` (`queued`, `running`, `succeeded`, or `failed`), its created / started / " +
      "finished timestamps, and — on success — a result summary, or the error message on failure.",
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
      "pull.\n\nOnly a completed pull is charged: if the project has no Search Console connection, no " +
      "stored token, or no matched property — or if the Google call fails — you are **not** charged.",
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
      "first). Already-winning queries (position under 8) and near-zero-demand long-tail queries are " +
      "left out, so the list stays a focused shortlist rather than a dump.",
    example:
      "Ask your MCP client in plain language:\n\n> What are the quick wins for my example.com project?",
    returns:
      "A prioritized list of quick-win opportunities — each with its query, page, average position, " +
      "impressions, clicks, and CTR — best opportunity first. If nothing clears the bands, it says so " +
      "(and you are still charged for the delivered analysis).",
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
      "genuine competition. Groups are ordered by total impressions, biggest query first.",
    example:
      "Ask your MCP client in plain language:\n\n> Do I have any keyword cannibalization on example.com?",
    returns:
      "A list of cannibalized queries, each with its competing pages and their impressions, clicks, and " +
      "average position (main contender first). If no query is contested, it says so (and you are still " +
      "charged for the delivered analysis).",
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
      "Results are ordered by clicks lost, biggest bleed first.",
    example:
      "Ask your MCP client in plain language:\n\n> Which pages on example.com are losing traffic?",
    returns:
      "A list of decaying pages — each with its previous and current clicks, the clicks lost, and the " +
      "drop as a percentage — biggest loss first. If nothing is decaying, it says so (and you are still " +
      "charged for the delivered analysis).",
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
      "- **Titles** — missing, too long (over ~60 characters), too short, or duplicated across pages.\n" +
      "- **Meta descriptions** — missing, too long (over ~160 characters), too short, or duplicated.\n" +
      "- **Headings** — a missing `h1`, or more than one `h1`.\n" +
      "- **Canonicals** — missing, or pointing to a different URL than the page itself.\n" +
      "- **Thin content** — pages under ~200 words.\n\n" +
      "Thresholds are conservative \"worth a look\" signals, not hard rules.",
    example:
      "Ask your MCP client in plain language:\n\n> Run an on-page audit for my example.com project.",
    returns:
      "A summary of issue counts followed by a per-page list of findings. Pages with no issues are " +
      "counted but not listed.",
  },

  audit_tech: {
    lead:
      "`audit_tech` reviews the technical health of the pages captured by your project's most recent " +
      "[`crawl_site`](/docs/tools-reference/crawl-site) run. It is **synchronous** and returns its " +
      "findings immediately. Run `crawl_site` first — with no crawl on record the tool says so and " +
      "charges nothing.",
    whatItDoes:
      "Summarizes the crawl from a technical angle:\n\n" +
      "- **HTTP status spread** — how many pages returned 2xx / 3xx / 4xx / 5xx, with the 4xx and 5xx " +
      "page URLs listed.\n" +
      "- **Redirects** — the redirects the crawler surfaced (off-origin redirects, redirect loops, and " +
      "redirects onto an already-crawled URL).\n" +
      "- **Not crawled** — the URLs that were discovered but skipped, grouped by reason (blocked by " +
      "`robots.txt`, timed out, non-HTML, and so on).\n" +
      "- **Robots conflicts** — pages marked `noindex` that are still linked internally.\n\n" +
      "Because the crawler follows a successful redirect and records the destination page, redirects " +
      "appear here through the crawler's skip reasons rather than as duplicate pages.",
    example:
      "Ask your MCP client in plain language:\n\n> Run a technical audit for my example.com project.",
    returns:
      "The status distribution, the redirect and skipped-URL breakdowns, and any noindex-but-linked " +
      "conflicts.",
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
      "- **Gaps** — the URLs of pages with no structured data at all.\n\n" +
      "**Detection is JSON-LD only** — microdata and RDFa are not read — and only the `@type` names " +
      "are analyzed. The crawler never stores the JSON-LD body, so this is a coverage and type-spread " +
      "report, not per-field validation.",
    example:
      "Ask your MCP client in plain language:\n\n> Run a structured-data audit for my example.com " +
      "project.",
    returns:
      "The JSON-LD coverage counts, the site-wide `@type` spread, and the list of pages with no " +
      "structured data.",
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
      "printed with Lighthouse's own formatting.\n" +
      "- **The biggest opportunities** — the improvements Lighthouse estimates the largest " +
      "load-time saving for, largest first, with the estimated milliseconds saved.\n\n" +
      "**These are lab measurements.** Lighthouse loads the page once, on the vendor's machine, " +
      "under simulated throttling. That is a repeatable diagnostic, not a record of what your " +
      "visitors experienced — the field metrics Google reports from real Chrome users (including " +
      "Interaction to Next Paint) are a different measurement, and this tool does not claim " +
      "them.\n\n" +
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
          "it is not available on trial credits. Buy any credit pack and it unlocks straight " +
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
      "A heading naming how many pages were measured and that the figures are lab measurements; " +
      "then one block per page — the URL, when it was measured and by which Lighthouse version " +
      "(and where it redirected to, if it did), the performance score, the metric lines, and the " +
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
      "covers the query. Everything else has to be there.\n\n" +
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
      "One line per mismatching query — the query, the page ranking for it, its impressions and " +
      "clicks, the words that are missing, how many of the query's words the page does carry, " +
      "and the page's current title — biggest opportunity first. Then the coverage line, the " +
      "window the Search Console figures cover, when that data was pulled, and when the crawl " +
      "was taken. If nothing mismatches, it says so (and you are still charged for the " +
      "delivered analysis).",
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
      "Every one of these is printed only when the provider actually returns it — a metric it did " +
      "not send is left out rather than filled in with a placeholder.\n\n" +
      "It also prints a one-line summary with the total monthly search volume across the batch.",
    preExampleSections: [
      {
        heading: "Who can run it",
        body:
          "`research_keywords` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits — buy any credit pack and " +
          "it unlocks straight away. Your trial credits are untouched and keep working for crawls, " +
          "audits, reports and Search Console tools.\n\n" +
          "If live keyword data is unavailable on this deployment, the tool returns a clear " +
          "_\"keyword research is not yet enabled on this deployment\"_ message and **charges you " +
          "nothing** — no credits are reserved or spent. SeoGrep never returns sample or " +
          "placeholder figures dressed up as real data.",
      },
      {
        heading: "No data is not zero",
        body:
          "A keyword the provider holds **nothing** on comes back as _\"no data returned for this " +
          "keyword\"_, and the header says how many of your keywords that happened to. It is never " +
          "printed as `volume 0`, and it never contributes a silent zero to the batch total — " +
          "\"nobody has a figure for this\" and \"nobody searches this\" are different facts that " +
          "lead to different decisions. A genuine zero, when the provider does report one, is still " +
          "printed as `volume 0`.",
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
      "A table with one row per keyword — search volume, CPC, competition, and (when the provider " +
      "returns them) keyword difficulty, search intent and volume trend — plus a total-volume " +
      "summary line and the date the CPC figures were last refreshed. While live data is off, it " +
      "returns the \"not yet enabled\" message instead and charges nothing.",
  },

  ranked_keywords: {
    lead:
      "`ranked_keywords` lists the Google organic keywords a domain **already ranks for** — each " +
      "with its position, monthly search volume, and the exact URL that ranks — powered by " +
      "DataForSEO Labs. It works on **any public domain**, so it reads your own site or a " +
      "competitor's the same way. It is **synchronous**: the table comes back immediately, with " +
      "no background job to poll.",
    whatItDoes:
      "Name the site in **one of two ways** — pass a `target` domain (a bare host or a full URL — " +
      "it is canonicalized for you), or pass the `project_id` of one of your own projects and the " +
      "domain is taken from it. Exactly one of the two: passing both is rejected rather than " +
      "resolved by precedence, because the two can name different sites and guessing would bill " +
      "you for a lookup of the one you did not mean. Either way you get one row per ranked " +
      "keyword:\n\n" +
      "- **Keyword** — the query the domain ranks for.\n" +
      "- **Position** — where it ranks in the organic results.\n" +
      "- **Search volume** — average monthly Google searches for that keyword.\n" +
      "- **URL** — the page on the domain that holds the ranking.\n\n" +
      "Only **organic** results are counted — paid placements are excluded. The header line says " +
      "how many rows you got and, when the domain ranks for more than the `limit` you asked for, " +
      "how many it ranks for in total, so a truncated list never reads like the whole picture.",
    preExampleSections: [
      {
        heading: "Who can run it",
        body:
          "`ranked_keywords` needs a **paid credit balance**. It reads live data from a paid " +
          "third-party provider, so it is not available on trial credits — buy any credit pack and " +
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
      "Or narrow it down:\n\n> Show me the top 50 keywords example.com ranks for.",
    returns:
      "A table with one row per ranked keyword — keyword, position, search volume, and the ranking " +
      "URL — under a header saying how many of the domain's ranked keywords are shown; when you " +
      "looked the site up by `project_id`, the header names that project. A domain with no " +
      "organic rankings on record is reported as such.\n\nRankings are read for the United States " +
      "in English unless you pass `location_code` and `language_code`. When a lookup left on that " +
      "default comes back thin AND the domain carries a country-code TLD, the reply says so and " +
      "names the TLD — it does **not** guess the matching location code, because a wrong code " +
      "returns another country's rankings that look perfectly ordinary.\n\nAn input that is not a " +
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
      "- **Top referring domains** — the domains linking to the target, most backlinks first, each " +
      "with its own rank.\n" +
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
          "third-party provider, so it is not available on trial credits — buy any credit pack and " +
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
      "The profile summary, then the top referring domains (domain, backlink count, rank), then " +
      "the top anchors (anchor text, backlink count) — each list headed by how many of the total " +
      "are shown. A metric DataForSEO has no value for is shown as `n/a` rather than as a zero. " +
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
      "you. The side-by-side comparison is made on the whole-domain figures, because those are " +
      "measured the same way for every row — the shared figures cover a different keyword set for " +
      "each rival.\n\n" +
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
          "third-party provider, so it is not available on trial credits — buy any credit pack and " +
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
      "from; then one block per domain with its metric lines, the target first.\n\nAn input that " +
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
      "links, slow and heavy pages, redirect chains, `X-Robots-Tag` conflicts, deep and orphaned " +
      "pages, skipped-page categories, and the sitemap-vs-crawl comparison.\n" +
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
      "It reads the project's current state through the same tenant-scoped data the tools use (your " +
      "latest [`crawl_site`](/docs/tools-reference/crawl-site) and " +
      "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) runs, plus your Search Console " +
      "connection) and walks a simple ladder:\n\n" +
      "- **No project yet** → run [`setup_project`](/docs/tools-reference/setup-project).\n" +
      "- **No crawl yet** → run [`crawl_site`](/docs/tools-reference/crawl-site) (works without Search " +
      "Console).\n" +
      "- **Crawl ready** → run the audits: [`audit_onpage`](/docs/tools-reference/audit-onpage), " +
      "[`audit_tech`](/docs/tools-reference/audit-tech), " +
      "[`audit_schema`](/docs/tools-reference/audit-schema). Connecting Search Console with " +
      "[`connect_gsc`](/docs/tools-reference/connect-gsc) is **optional** and never a barrier.\n" +
      "- **Search Console connected, no data pulled** → run " +
      "[`pull_gsc_data`](/docs/tools-reference/pull-gsc-data).\n" +
      "- **Data pulled** → run the discovery tools: " +
      "[`find_quick_wins`](/docs/tools-reference/find-quick-wins), " +
      "[`detect_cannibalization`](/docs/tools-reference/detect-cannibalization), " +
      "[`analyze_content_decay`](/docs/tools-reference/analyze-content-decay).\n" +
      "- **Everything fresh** → you're all set: " +
      "[`generate_report`](/docs/tools-reference/generate-report) for a shareable summary, and the " +
      "`monthly-routine` prompt to keep it up to date.",
    example:
      "Ask your MCP client in plain language:\n\n> What should I do next with my example.com project?",
    returns:
      "One clear next step for the project, a short reason, and the next two or three steps — all in " +
      "plain language, naming the exact tools to run.",
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
      "Pass a property exactly as [`list_gsc_properties`](/docs/tools-reference/list-gsc-properties) " +
      "prints it. SeoGrep re-reads your Google accounts live and only accepts a property one of " +
      "them actually lists — what you type is never taken as proof it exists. If you already have " +
      "a project for that domain, it is reused rather than duplicated, so running this twice is " +
      "safe. If the same property sits on two of your connected accounts, SeoGrep asks which one " +
      "to read it through instead of guessing, and you re-run with `account_id`.",
    preExampleSections: [
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
      "\n\nRun [`list_gsc_properties`](/docs/tools-reference/list-gsc-properties) first if you are " +
      "not sure how a property is spelled.",
    returns:
      "The project the property was attached to — its domain and `project_id`, whether it was " +
      "created, already tracked or restored from your archive, which Google account it now reads " +
      "through, and the tools to run next.",
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
      "`project_id` that is not yours is reported exactly like an id that does not exist.",
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
  try {
    const tools = await import(toolsUrl);
    const costs = await import(costsUrl);
    const pull = await import(pullUrl);
    const windows = await import(windowsUrl);
    return {
      ALL_TOOLS: tools.ALL_TOOLS,
      TOOL_COSTS: costs.TOOL_COSTS,
      constants: { maxRowLimit: pull.MAX_ROW_LIMIT, lagDays: windows.GSC_FRESHNESS_LAG_DAYS },
    };
  } catch (error) {
    throw new Error(
      "Could not import the built MCP registry from apps/mcp/dist — build it first with " +
        `\`pnpm --filter @pseo/mcp build\`. (${error.message})`,
    );
  }
}

/** The frozen page for one tool (throws if its prose block is missing). */
function pageFor(tool, cost, constants) {
  const prose = DOC_PROSE[tool.name];
  if (!prose) throw new Error(`No DOC_PROSE entry for tool "${tool.name}" — add one before generating.`);
  return substituteProseTokens(renderToolPage(tool, cost, prose), constants);
}

/** The tools-reference meta.json content, derived from ALL_TOOLS order. */
function toolsMetaJson(allTools) {
  return `${JSON.stringify({ title: "Tools Reference", pages: allTools.map((t) => deriveSlug(t.name)) }, null, 2)}\n`;
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
function writeAll({ ALL_TOOLS, TOOL_COSTS, constants }) {
  for (const tool of ALL_TOOLS) {
    writeFileSync(new URL(`${deriveSlug(tool.name)}.mdx`, TOOLS_DIR), pageFor(tool, TOOL_COSTS[tool.name], constants));
  }
  writeFileSync(new URL("meta.json", TOOLS_DIR), toolsMetaJson(ALL_TOOLS));
  const navChanged = ensureParentNav();
  console.error(
    `gen-tool-docs: wrote ${ALL_TOOLS.length} tool pages + meta.json` +
      `${navChanged ? " + added tools-reference to parent nav" : ""}.`,
  );
}

/** Run the three --check gates. Returns a list of human-readable failures (empty = in sync). */
function collectCheckErrors({ ALL_TOOLS, TOOL_COSTS, constants }) {
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
    if (actual !== pageFor(tool, TOOL_COSTS[tool.name], constants)) {
      errors.push(`(i) ${slug}.mdx is out of sync — regenerate with \`node apps/web/scripts/gen-tool-docs.mjs\`.`);
    }
  }
  for (const file of readdirSync(fileURLToPath(TOOLS_DIR))) {
    if (file.endsWith(".mdx") && !expectedSlugs.includes(file.replace(/\.mdx$/, ""))) {
      errors.push(`(i) unexpected page tools-reference/${file} — no matching tool in ALL_TOOLS.`);
    }
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
    const length = frontmatterDescription(pageFor(tool, TOOL_COSTS[tool.name], constants)).length;
    if (length > FRONTMATTER_DESCRIPTION_MAX) {
      errors.push(
        `(iv) ${deriveSlug(tool.name)}.mdx frontmatter description is ${length} chars ` +
          `(max ${FRONTMATTER_DESCRIPTION_MAX}) — shorten the tool description or its truncation.`,
      );
    }
  }

  return errors;
}

async function main() {
  const registry = await loadRegistry();
  if (process.argv.includes("--check")) {
    const errors = collectCheckErrors(registry);
    if (errors.length > 0) {
      console.error("gen-tool-docs --check FAILED:");
      for (const error of errors) console.error(`  - ${error}`);
      process.exit(1);
    }
    console.error(
      `gen-tool-docs --check OK — ${registry.ALL_TOOLS.length} tool pages in sync, no confirm fields, ` +
        `meta + nav synced, all descriptions ≤${FRONTMATTER_DESCRIPTION_MAX} chars.`,
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
