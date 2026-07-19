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
  const description = stripCostSentences(toolMeta.description);
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

/** Pages allowed in tools-reference/meta.json that are not tools (none today; kept for future). */
export const NON_TOOL_ALLOWLIST = [];

/**
 * Verify the tools-reference meta.json `pages` match ALL_TOOLS by name AND order (16-tool surface
 * pin). Non-tool pages on the allowlist are ignored. Returns { ok, errors }.
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
        body:
          "- Search Console finalizes data with a ~2–3 day delay, so the most recent day or two of the " +
          "current window can be partial.\n" +
          "- A single page of up to 5,000 `(query, page)` rows is fetched per window; a very large " +
          "property is truncated to the top rows Google returns.",
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

  research_keywords: {
    lead:
      "`research_keywords` looks up Google Ads **search volume**, **CPC**, and **competition** for up " +
      "to 100 keywords at once, powered by DataForSEO. It is **synchronous** — it returns a table " +
      "immediately, with no background job to poll.",
    whatItDoes:
      "Given a list of keywords (plus an optional language and location), it returns one row per " +
      "keyword with:\n\n" +
      "- **Search volume** — average monthly Google searches.\n" +
      "- **CPC** — the average cost-per-click advertisers pay.\n" +
      "- **Competition** — the advertiser competition band (`HIGH` / `MEDIUM` / `LOW`).\n\n" +
      "It also prints a one-line summary with the total monthly search volume across the batch.",
    preExampleSections: [
      {
        heading: "Availability during beta",
        body:
          "Live keyword data is **off during the beta**. While it is off, `research_keywords` returns a " +
          "clear _\"keyword research is not yet enabled on this deployment\"_ message and **charges you " +
          "nothing** — no credits are reserved or spent. SeoGrep never returns sample or placeholder " +
          "figures dressed up as real data. Once live keyword research is switched on, the same call " +
          "starts returning real numbers.",
      },
    ],
    example:
      "Ask your MCP client in plain language:\n\n> What's the search volume for \"seo software\" and " +
      "\"rank tracker\"?",
    returns:
      "A table with one row per keyword — search volume, CPC, and competition — plus a total-volume " +
      "summary line. While live data is off, it returns the \"not yet enabled\" message instead and " +
      "charges nothing.",
  },

  generate_report: {
    lead:
      "`generate_report` rolls up a project's latest [`crawl_site`](/docs/tools-reference/crawl-site) " +
      "and [`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) results into a single, self-contained " +
      "**HTML report** and returns a **public link** you can share with clients or teammates. Run " +
      "`crawl_site` and/or `pull_gsc_data` first.",
    whatItDoes:
      "It reads the most recent successful crawl and Search Console pull for the project (whichever " +
      "exist) and renders a light, readable summary:\n\n" +
      "- **Site crawl** — pages crawled, pages skipped, and basic on-page issues (missing titles, meta " +
      "descriptions, or H1s, and error responses).\n" +
      "- **Search performance** — the current window's total clicks and impressions, plus your top " +
      "queries and top pages.\n\n" +
      "The report is deliberately a **summary**, not a re-run of the analysis engines — it points you " +
      "back to `audit_onpage`, `audit_tech`, `audit_schema`, `find_quick_wins`, " +
      "`detect_cannibalization`, and `analyze_content_decay` for the deep breakdowns. Every report " +
      "carries a small \"powered by SeoGrep\" footer.\n\nIf the project has **neither** a crawl nor a " +
      "Search Console pull yet, the tool tells you to run `crawl_site` or `pull_gsc_data` first — and " +
      "you are **not** charged.",
    example:
      "Ask your MCP client in plain language:\n\n> Generate a shareable SEO report for my example.com " +
      "project.",
    returns:
      "The report's title, its `report_id`, and a **public URL** (`/r/<slug>`) that anyone with the " +
      "link can open — no sign-in required. The link uses an unguessable 64-bit slug, and you can see " +
      "all your reports on the **Reports** page of your dashboard.",
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
};

// ---------------------------------------------------------------------------
// I/O + CLI (not unit-tested — the registry is loaded lazily here)
// ---------------------------------------------------------------------------

const TOOLS_DIR = new URL("../content/docs/tools-reference/", import.meta.url);
const PARENT_META = new URL("../content/docs/meta.json", import.meta.url);

/** Import ALL_TOOLS + TOOL_COSTS from the BUILT MCP registry (apps/mcp/dist). */
async function loadRegistry() {
  const toolsUrl = new URL("../../mcp/dist/tools/index.js", import.meta.url);
  const costsUrl = new URL("../../mcp/dist/credits/costs.js", import.meta.url);
  try {
    const tools = await import(toolsUrl);
    const costs = await import(costsUrl);
    return { ALL_TOOLS: tools.ALL_TOOLS, TOOL_COSTS: costs.TOOL_COSTS };
  } catch (error) {
    throw new Error(
      "Could not import the built MCP registry from apps/mcp/dist — build it first with " +
        `\`pnpm --filter @pseo/mcp build\`. (${error.message})`,
    );
  }
}

/** The frozen page for one tool (throws if its prose block is missing). */
function pageFor(tool, cost) {
  const prose = DOC_PROSE[tool.name];
  if (!prose) throw new Error(`No DOC_PROSE entry for tool "${tool.name}" — add one before generating.`);
  return renderToolPage(tool, cost, prose);
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
function writeAll({ ALL_TOOLS, TOOL_COSTS }) {
  for (const tool of ALL_TOOLS) {
    writeFileSync(new URL(`${deriveSlug(tool.name)}.mdx`, TOOLS_DIR), pageFor(tool, TOOL_COSTS[tool.name]));
  }
  writeFileSync(new URL("meta.json", TOOLS_DIR), toolsMetaJson(ALL_TOOLS));
  const navChanged = ensureParentNav();
  console.error(
    `gen-tool-docs: wrote ${ALL_TOOLS.length} tool pages + meta.json` +
      `${navChanged ? " + added tools-reference to parent nav" : ""}.`,
  );
}

/** Run the three --check gates. Returns a list of human-readable failures (empty = in sync). */
function collectCheckErrors({ ALL_TOOLS, TOOL_COSTS }) {
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
    if (actual !== pageFor(tool, TOOL_COSTS[tool.name])) {
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
      `gen-tool-docs --check OK — ${registry.ALL_TOOLS.length} tool pages in sync, no confirm fields, meta + nav synced.`,
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
