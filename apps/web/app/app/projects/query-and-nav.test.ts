import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the panel READS, and whether anyone can reach it — the two things no render spec sees.
 *
 * `page.tsx` is a Server Component that talks to PostgREST. vitest has no RSC boundary and
 * `project-list.test.tsx` renders the client half from hand-built cards, so the page's own query
 * is executed by nothing in this suite: reversing its sort, or dropping either filter, left all
 * 909 specs green. The same for the nav entry — deleting the `/app/projects` line makes the page
 * unreachable without failing a single assertion. A card layer that is perfectly tested and a
 * page that lists archived projects newest-first, behind no link, is the shape here.
 *
 * So these are SOURCE pins, the mechanism `lib/projects/parity.test.ts` already uses: read the
 * file, strip the comments, and match the SHORTEST DISTINCTIVE FRAGMENT with `/i` (signed lesson
 * 11). A regex that only matches a whole pasted line stops matching on the first reformat and
 * then reports a drift that did not happen.
 *
 * COMMENTS OUT FIRST, and here that is load-bearing rather than hygienic: `page.tsx`'s own doc
 * comment spells `.is("archived_at", null)` in prose to explain why it is not `.eq`. Matched
 * against the raw file, the archive pin would keep passing after the filter itself was deleted —
 * green off the sentence describing the code instead of the code. Measured, not assumed: without
 * the strip, the deletion mutation below stays green.
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
      `query/nav spec could not read ${path}. If the module moved, point this spec at its new ` +
        "home — do NOT delete the spec: nothing else in this suite executes the page's query or " +
        "notices that the panel has no link to it.",
    );
  }
}

const PAGE = codeOf(read(resolve(HERE, "page.tsx")));
const LAYOUT = codeOf(read(resolve(HERE, "../layout.tsx")));

/**
 * One chained PostgREST statement, from `.from("<table>")` to the `;` that ends it.
 *
 * Scoping matters: `page.tsx` sorts `projects` ascending and `jobs` descending, so a pin that
 * searched the whole file for `ascending: true` would be satisfied by the wrong query. Slicing
 * the statement also keeps the pins indifferent to the ORDER of the chained calls, which is
 * pure formatting.
 *
 * Not-found throws rather than returning "": a renamed table would otherwise make every pin
 * below pass vacuously against an empty string.
 */
function queryOn(source: string, table: string): string {
  const from = new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)`).exec(source);
  if (from === null) {
    throw new Error(`no \`.from("${table}")\` call in page.tsx — did the table or the page move?`);
  }
  const end = source.indexOf(";", from.index);
  return source.slice(from.index, end === -1 ? undefined : end);
}

describe("the projects panel reads the rows it says it reads", () => {
  /**
   * OLDEST FIRST, because `list_projects` lists them that way. Reversed, the panel and the tool
   * number the same sites differently and "the third one" means two different projects depending
   * on which surface the user is looking at.
   */
  it("orders projects oldest first, like list_projects", () => {
    expect(queryOn(PAGE, "projects")).toMatch(
      /\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*true\b/i,
    );
  });

  /**
   * Archived projects belong to /app/connection's archive and nowhere else. Without the filter
   * the panel silently resurrects every site the user archived, each with a next step urging
   * them to crawl it again.
   */
  it("excludes archived projects", () => {
    expect(queryOn(PAGE, "projects")).toMatch(/\.is\(\s*["']archived_at["']\s*,\s*null\s*\)/i);
  });

  /**
   * A crawl that FAILED must not date the card. Without this filter the newest row wins whatever
   * its status, so a failed crawl an hour ago presents as a fresh crawl — which also feeds the
   * ladder, moving the project off `crawl_site` on the strength of a crawl that never happened.
   */
  it("counts only succeeded jobs", () => {
    expect(queryOn(PAGE, "jobs")).toMatch(/\.eq\(\s*["']status["']\s*,\s*["']succeeded["']\s*\)/i);
  });
});

/**
 * WHAT THE HEALTH READ ASKS FOR — the pin `page.tsx`'s types cannot carry, because a TypeScript
 * shape describes what the code does with a row and says nothing about what PostgREST was asked to
 * send. `gsc_accounts` is the table holding every Google credential in the product, and the panel
 * needs exactly one boolean-ish word out of it.
 *
 * The ciphertext is held back by migration 0021's column-level grant, so a `select("*")` here
 * FAILS rather than leaks — which is the good case and also the invisible one: nothing in this
 * suite executes the query, so the panel would simply lose its health line to a thrown lookup and
 * every other spec would stay green. The projection is therefore pinned positively, to the exact
 * two columns the map is built from.
 *
 * Comments are stripped before matching (see `codeOf`), and here that is load-bearing: the read's
 * own doc comment names `encrypted_refresh_token` in prose to explain why the list is narrow, so
 * the negative pin below would fail on the sentence forbidding the thing.
 */
describe("the panel reads connection health without reaching for the credential", () => {
  const HEALTH = queryOn(PAGE, "gsc_accounts");

  /** The column list of the one `.select(...)` in that statement (literals joined back up). */
  const columns = (() => {
    const call = /\.select\(([\s\S]*?)\)/.exec(HEALTH)?.[1];
    if (call === undefined) {
      throw new Error("the health read has no `.select(...)` — did it start selecting *?");
    }
    return [...call.matchAll(/["']([^"']*)["']/g)]
      .map((match) => match[1])
      .join("")
      .split(",")
      .map((column) => column.trim())
      .sort();
  })();

  /**
   * EXACTLY the id and the stored word. Stated as an equality rather than as two negative pins,
   * because the set of columns that must not come back is open-ended — `encrypted_refresh_token`
   * today, whatever migration adds next tomorrow — and a positive list rules all of them out by
   * construction. `*` cannot satisfy it either.
   */
  it("selects only the account id and its stored token status", () => {
    expect(columns).toEqual(["id", "token_status"].sort());
  });

  /** …and the ciphertext column by name, so the failure NAMES the thing when it regresses. */
  it("never names the sealed refresh token", () => {
    expect(HEALTH).not.toMatch(/encrypted_refresh_token/i);
  });

  /**
   * Constitution NEVER #4 — an EXPRESSION, never a literal: `.eq("user_id", "")` would satisfy a
   * laxer pin while filtering on nothing, and this read decides whose connection the panel calls
   * dead.
   */
  it("filters on the caller's own user id", () => {
    expect(HEALTH).toMatch(/\.eq\(\s*["']user_id["']\s*,\s*[A-Za-z_$][\w$.]*\s*\)/);
  });

  /**
   * ONE query for the page, not one per project. Nothing else here would notice the read moving
   * inside `cardInputFor` — the cards would look identical and the panel would issue a round trip
   * per project against a table with single-digit rows.
   */
  it("reads every account once, outside the per-project fan-out", () => {
    expect(PAGE).toMatch(/readAccountHealth\(supabase,\s*user\.id\)/);
    expect(PAGE).not.toMatch(/readAccountHealth\([^)]*project/);
  });

  /**
   * …and the project -> account JOIN is the SHARED one, which `signals.test.ts` drives with a
   * two-account map. The behaviour pin is the real guard; this keeps the page attached to it,
   * because a page that re-derived the lookup inline would be back to the state where replacing it
   * with "the first account in the map" reddens nothing.
   */
  it("picks each project's account through the shared, tested join", () => {
    expect(PAGE).toMatch(
      /import\s*\{[^}]*\btokenStatusFor\b[^}]*\}\s*from\s*["'][^"']*projects\/signals["']/,
    );
    expect(PAGE).toMatch(/tokenStatus:\s*tokenStatusFor\(/);
    // No second, inline lookup beside it: the map is read only through that function.
    expect(PAGE).not.toMatch(/health\.get\(/);
  });
});

describe("the panel is reachable", () => {
  /**
   * The entry is matched inside the NAV_ITEMS array and by BOTH of its fields, taken from the
   * object rather than the file: an entry may be written `{ label, href }` or `{ href, label }`,
   * and either way an href without a label renders a nav item with nothing to click.
   */
  it("keeps a Projects entry in the /app nav", () => {
    const items = LAYOUT.match(/NAV_ITEMS\s*=\s*\[([\s\S]*?)\]/)?.[1];
    expect(items, "no NAV_ITEMS array in app/app/layout.tsx").toBeDefined();

    const entry = items?.match(/\{[^{}]*\/app\/projects[^{}]*\}/)?.[0];
    expect(
      entry,
      "no NAV_ITEMS entry points at /app/projects. The page still builds and every spec here " +
        "still passes; it is simply unreachable from the dashboard.",
    ).toBeDefined();
    expect(entry).toMatch(/href:\s*["']\/app\/projects["']/i);
    expect(entry).toMatch(/label:\s*["']Projects["']/i);
  });
});
