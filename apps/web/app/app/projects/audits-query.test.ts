import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIT_TOOLS } from "../../../lib/projects/audits";

/**
 * What the AUDIT LINES read — the half no render spec can see.
 *
 * `page.tsx` is a Server Component talking to PostgREST, and nothing in the fast lane executes it:
 * `audit-lines.test.tsx` renders the lines from hand-built rows, so reversing the order, dropping
 * the tenant filter, or selecting the whole `report` jsonb leaves every render spec green. Same
 * mechanism and same rules as `history-query.test.ts`: strip the comments first, then match the
 * SHORTEST DISTINCTIVE FRAGMENT with `/i` (signed lesson 11).
 *
 * COMMENTS OUT FIRST is load-bearing here, not hygienic: this query's doc comment explains in
 * prose why the whole `report` must NOT be downloaded, and the negative pin below would fail on
 * the sentence forbidding the thing — or, worse, a `.select` pin could pass off a comment after
 * the code had changed.
 */

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Comments out, statements only — prose is not code. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `audit-runs query spec could not read ${path}. If the module moved, point this spec at its ` +
        "new home — do NOT delete it: nothing else in this suite executes the audit lines' query, " +
        "so a query that fetched whole audit reports would fail nothing.",
    );
  }
}

const PAGE = codeOf(read(resolve(HERE, "page.tsx")));

/**
 * The body of ONE top-level function, from its `function <name>` to the closing brace in column 0.
 *
 * Scoped by FUNCTION rather than by table, for `history-query.test.ts`'s reason: `page.tsx` now
 * makes four different reads, and a pin that searched the whole file would be satisfied — or
 * broken — by the wrong one.
 */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\` in page.tsx. If the audit lines' read was renamed, rename it here ` +
        "too; if it was deleted, the lines are being fed by something this spec does not check.",
    );
  }
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/**
 * The column list of the one `.select(...)` inside a function body. The list is written as two
 * concatenated string literals (it is long), so the pieces are joined back together — a reader
 * that only accepted a single literal would throw on formatting.
 */
function selectOf(body: string): string {
  const call = /\.select\(([\s\S]*?)\)\s*\n/.exec(body)?.[1];
  if (call === undefined) {
    throw new Error("the audit lines' read has no `.select(...)` — did it start selecting *?");
  }
  const pieces = [...call.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error("the audit lines' `.select(...)` holds no string literal — is it selecting *?");
  }
  return pieces.join("");
}

const READ = bodyOf(PAGE, "latestAuditRun");
const COLUMNS = selectOf(READ);

describe("the audit lines read the newest run of one tool", () => {
  /** The right table: audits live in their own table, not in `jobs` (migration 0024). */
  it("reads audit_runs", () => {
    expect(READ).toMatch(/\.from\(\s*["']audit_runs["']\s*\)/i);
  });

  /**
   * ONE TOOL per read. Without the filter the newest audit of ANY kind wins every line, so a card
   * would show the same run three times — dated correctly, labelled wrongly.
   */
  it("filters on the tool it was asked for", () => {
    expect(READ).toMatch(/\.eq\(\s*["']tool["']\s*,\s*tool\s*\)/i);
  });

  /** Scoped to the caller and the project, beside RLS `audit_runs_select_own` (NEVER #4). */
  it("scopes the read to the caller and the project", () => {
    expect(READ).toMatch(/\.eq\(\s*["']user_id["']/i);
    expect(READ).toMatch(/\.eq\(\s*["']project_id["']/i);
  });

  /**
   * NEWEST FIRST, and this is the ordering an in-memory pick cannot repair: `.limit(1)` truncates
   * at the DATABASE, so ascending hands back the FIRST audit a project ever ran and the card
   * reports last spring's numbers as today's.
   */
  it("orders the runs newest first", () => {
    expect(READ).toMatch(/\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*false\b/i);
  });

  it("takes exactly one row", () => {
    expect(READ).toMatch(/\.limit\(\s*1\s*\)/);
  });

  /** All three audits are asked for — a line missing from the query is a line missing from every card. */
  it("is driven once per audit tool", () => {
    const fanOut = bodyOf(PAGE, "latestAuditRuns");
    expect(fanOut).toMatch(/AUDIT_TOOLS\s*\.map\(/);
    expect(AUDIT_TOOLS).toEqual(["audit_onpage", "audit_tech", "audit_schema"]);
  });
});

describe("the audit lines do not download audit reports", () => {
  /**
   * NO BARE `report`. It is the rule engine's whole structure, and two of its fields grow with the
   * crawl — the per-page finding list and the URLs with no structured data. Every mention of the
   * column in the projection must therefore be a SUB-FIELD (`report->…`), each of which is O(1) in
   * crawl size.
   *
   * Asserted on the COLUMN LIST rather than the function body, so it cannot be satisfied by an
   * unrelated identifier and cannot be dodged by `.select("*")` — `selectOf` throws on anything
   * that is not a literal column list.
   */
  it("selects only sub-fields of report, never the column itself", () => {
    expect(COLUMNS).toMatch(/report->/);
    expect(COLUMNS).not.toMatch(/report(?!->)/);
    expect(COLUMNS).not.toMatch(/\*/);
  });

  /**
   * The exact sub-fields the lines print, and no O(pages) one among them. `report->pages` (the
   * per-page finding list) and `report->pagesWithout` (every URL with no structured data) are the
   * two that must never appear here; naming the whole set positively rules them out by
   * construction rather than by two negative pins that a third big field would slip past.
   */
  it("selects exactly the columns and sub-fields the lines render", () => {
    const columns = COLUMNS.split(",")
      .map((column) => column.trim())
      .sort();
    expect(columns).toEqual(
      [
        "tool",
        "created_at",
        "page_count:report->pageCount",
        "finding_counts:report->counts",
        "status:report->status",
        "pages_with_schema:report->pagesWithSchema",
      ].sort(),
    );
  });
});
