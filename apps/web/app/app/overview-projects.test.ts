import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WHAT OVERVIEW COUNTS, and whether the line it draws from that count leads anywhere.
 *
 * `page.tsx` is a Server Component that talks to PostgREST, and vitest has no RSC boundary
 * (signed lesson 12), so nothing in this suite executes its query: dropping the archive filter,
 * or the tenant filter, or the link, leaves every other spec green. `lib/projects/count-line`
 * owns the copy and is executed by its own spec; these are SOURCE pins for the parts that are
 * only ever run by Next — the same mechanism projects/query-and-nav.test.ts uses.
 */

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Comments out, statements only — prose is not code. Load-bearing here: the doc comment above
 * `countActiveProjects` spells `.is("archived_at", null)` out in prose to explain why it is not
 * `.eq`, so an unstripped match would keep passing after the filter itself was deleted. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const PAGE = codeOf(readFileSync(resolve(HERE, "page.tsx"), "utf8"));

/** One chained PostgREST statement, from `.from("<table>")` to the `;` that ends it. */
function queryOn(table: string): string {
  const from = new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)`).exec(PAGE);
  if (from === null) {
    throw new Error(`no \`.from("${table}")\` call in app/app/page.tsx — did the query move?`);
  }
  const end = PAGE.indexOf(";", from.index);
  return PAGE.slice(from.index, end === -1 ? undefined : end);
}

describe("Overview counts the projects the projects page lists", () => {
  /**
   * A COUNT, not a fetch: Overview names a number and links onward, so downloading the rows
   * (and, worse, growing into a second project list) is work the page has no use for.
   */
  it("asks for a head-only exact count", () => {
    const query = queryOn("projects");
    expect(query).toMatch(/count:\s*["']exact["']/i);
    expect(query).toMatch(/head:\s*true/i);
  });

  /**
   * The SAME archive rule as /app/projects and `list_projects`. Without it Overview reports a
   * bigger number than the page it links to, on the strength of sites the user archived.
   */
  it("excludes archived projects", () => {
    expect(queryOn("projects")).toMatch(/\.is\(\s*["']archived_at["']\s*,\s*null\s*\)/i);
  });

  /**
   * Constitution NEVER #4 — no tenant table is queried unfiltered, even behind RLS.
   */
  it("filters on the caller's own user id", () => {
    // The second argument must be an EXPRESSION (the id the page derived), never a literal —
    // `.eq("user_id", "")` would satisfy a laxer pin while filtering on nothing.
    expect(queryOn("projects")).toMatch(/\.eq\(\s*["']user_id["']\s*,\s*[A-Za-z_$][\w$.]*\s*\)/);
  });
});

/**
 * The SECOND count Overview reads, under the same rule as the first: vitest has no RSC boundary,
 * so a dropped filter here reddens nothing that executes. The stakes are not symmetrical, though
 * — the projects count leaking across tenants shows a wrong NUMBER, while this one would tell a
 * stranger their Google connection is dead and send them through an OAuth round for it.
 */
describe("Overview counts the Google accounts that need reconnecting", () => {
  it("asks for a head-only exact count", () => {
    const query = queryOn("gsc_accounts");
    expect(query).toMatch(/count:\s*["']exact["']/i);
    expect(query).toMatch(/head:\s*true/i);
  });

  it("filters on the caller's own user id", () => {
    // An EXPRESSION, never a literal — `.eq("user_id", "")` would satisfy a laxer pin while
    // filtering on nothing (constitution NEVER #4).
    expect(queryOn("gsc_accounts")).toMatch(
      /\.eq\(\s*["']user_id["']\s*,\s*[A-Za-z_$][\w$.]*\s*\)/,
    );
  });

  /**
   * Counts the DEAD ones only. Without this filter every connected account is counted and the
   * line fires for a healthy user — which is worse than not having the line: it teaches people
   * that the reconnection warning means nothing.
   */
  it("counts only accounts marked invalid", () => {
    expect(queryOn("gsc_accounts")).toMatch(
      /\.eq\(\s*["']token_status["']\s*,\s*["']invalid["']\s*\)/,
    );
  });

  it("the warning leads to the page that fixes it", () => {
    expect(PAGE).toMatch(/href=\{?\s*["']\/app\/connection["']/);
  });
});

describe("the count leads somewhere", () => {
  it("renders the shared copy rather than a second wording", () => {
    expect(PAGE).toMatch(/\bprojectCountLine\s*\(/);
    expect(PAGE).toMatch(
      /import\s*\{[^}]*\bprojectCountLine\b[^}]*\}\s*from\s*["'][^"']*projects\/count-line["']/,
    );
  });

  /**
   * A number with no way through to the list is a dead end: the line exists to send people to
   * /app/projects, and nothing else on Overview does.
   */
  it("links to /app/projects", () => {
    expect(PAGE).toMatch(/href=\{?\s*["']\/app\/projects["']/);
  });
});
