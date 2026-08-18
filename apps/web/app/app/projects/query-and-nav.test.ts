import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  errorBranchOf,
  fanOutBindingsOf,
  filtersOf,
  paramsOf,
  returnPropsOf,
  singleRowTerminatorsOf,
} from "./query-pins";

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

/**
 * The body of ONE top-level function, from its `function <name>` to the closing brace in column 0 —
 * the same slice the five sibling query specs take, and needed here for the same reason: the pins
 * below ask what a read was HANDED, and a parameter list only exists inside a function.
 *
 * Not-found throws rather than returning "": a renamed read would otherwise make every pin below
 * pass vacuously against an empty string.
 */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\` in page.tsx. If the read was renamed, rename it here too; if it ` +
        "was deleted, the panel is being fed by something this spec does not check.",
    );
  }
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/**
 * The page component itself, from `function ProjectsPage` to the END OF THE FILE — and it has to be
 * written this way, which is worth stating because the reason is a live trap.
 *
 * `bodyOf` above ends a function at the first `\n}`, i.e. the first brace in column 0. Every helper
 * read here has a one-line signature, so that is their closing brace. `ProjectsPage`'s signature is
 * a MULTI-LINE destructured parameter, and its type annotation opens with `}: {` in column 0 four
 * lines in — so `bodyOf` would hand back a stub ending inside the signature, and every pin below
 * would then be measured against a string with no query in it. Measured, not assumed: it threw
 * here first, because `fanOutBindingsOf` refuses a body it cannot find the fan-out in.
 *
 * Slicing to the end of the file is safe for what is asked below — the page's own `Promise.all` is
 * the first one after this point — and it is deliberately not a general-purpose `bodyOf`.
 */
function pageComponent(source: string): string {
  const start = source.search(/function\s+ProjectsPage\b/);
  if (start === -1) {
    throw new Error(
      "no `function ProjectsPage` in page.tsx. If the component was renamed, rename it here too; " +
        "if it was deleted, /app/projects is being served by something this spec does not check.",
    );
  }
  return source.slice(start);
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

/**
 * THE FOUR READS NO SPEC FILE OF ITS OWN COVERS — and the VALUES they filter on.
 *
 * `audits-`, `insights-`, `lookups-`, `pull-` and `history-query.test.ts` each own one read. These
 * four are the remainder: the project list, the connections map, the account-health map and the
 * crawl summary. Two of them (`readConnections`, `listActiveProjects`) had no tenancy pin at all —
 * dropping `.eq("user_id", userId)` from either left the whole suite green, and the pin the health
 * read did carry asked only that the value be an EXPRESSION.
 *
 * Measured 2026-08-18, not supposed: re-pointing a `user_id` filter at another id in scope
 * typechecks and passes both gates. It is not a leak — RLS is the real tenant gate on every one of
 * these tables — it is a total silent degrade, a panel that reads successfully and shows nothing.
 *
 * So each filter is compared against the read's OWN PARAMETER, taken from its signature rather than
 * spelled here: renaming survives, re-pointing reddens. The convention it rests on is that the
 * caller is the SECOND parameter, in all four of these and in all five siblings — reordering the
 * parameters is the one legitimate change this shape cannot survive, and that is a deliberate trade.
 */
const READS = [
  { fn: "listActiveProjects", what: "the project list", params: 2, singleRow: false },
  { fn: "readConnections", what: "the connections map", params: 2, singleRow: false },
  { fn: "readAccountHealth", what: "the account-health map", params: 2, singleRow: false },
  { fn: "latestSucceeded", what: "the crawl summary", params: 4, singleRow: true },
] as const;

for (const { fn, what, params, singleRow } of READS) {
  describe(`${what} is scoped to the caller and fails visibly`, () => {
    const BODY = bodyOf(PAGE, fn);

    /** Distinct parameters — without this, a lost one would compare `undefined` to `undefined`. */
    it(`takes ${params} distinct parameters`, () => {
      expect(paramsOf(BODY, what)).toHaveLength(params);
      expect(new Set(paramsOf(BODY, what)).size).toBe(params);
    });

    it("filters user_id on the caller it was handed, not another id in scope", () => {
      expect(filtersOf(BODY, what).get("user_id")).toBe(paramsOf(BODY, what)[1]);
    });

    /**
     * THE ROW SHAPE. A single-row read that lost `.maybeSingle()` hands back an ARRAY, and a list
     * read that gained one hands back an OBJECT; both are swallowed whole by the
     * `as unknown as …` cast every read here ends with, and both render as "nothing to show" on a
     * query that succeeded. `.single()` cannot satisfy the first either — it ERRORS on zero rows,
     * which is the normal state of a project that has never been crawled.
     */
    it(`asks PostgREST for ${singleRow ? "the one row" : "the whole list"}`, () => {
      expect(singleRowTerminatorsOf(BODY)).toEqual(singleRow ? ["maybeSingle"] : []);
    });

    /**
     * A FAILED READ THROWS — the page's own doc comments say why in prose: a lookup that degrades
     * into an empty result reads as "you have no projects" / "your connection is fine", which is
     * the panel asserting something it never measured. Pinned by what the branch DOES (raises, does
     * not return, carries the driver's message), not by the presence of the word `throw`.
     */
    it("throws on failure and never degrades into an empty result", () => {
      const branch = errorBranchOf(BODY, what);
      expect(branch).toMatch(/throw\s+new\s+Error\(/);
      expect(branch).not.toMatch(/\breturn\b/);
      expect(branch).toMatch(/error\.message/);
    });
  });
}

describe("the crawl summary is filtered by the project and tool it was handed", () => {
  const CRAWL = bodyOf(PAGE, "latestSucceeded");

  /**
   * The read `cardInputFor` drives once per project with a literal tool. Its `status` filter is
   * already value-pinned above (`"succeeded"`, a literal the regex matches in full); these two are
   * the ones that take a value from the caller, and re-pointing either turns every card's crawl
   * fact into "never crawled" without failing anything else.
   */
  it("filters project_id and tool on what it was handed", () => {
    const filters = filtersOf(CRAWL, "the crawl summary");
    const params = paramsOf(CRAWL, "the crawl summary");
    expect(filters.get("project_id")).toBe(params[2]);
    expect(filters.get("tool")).toBe(params[3]);
  });
});

/**
 * …AND IT TAKES THE NEWEST ONE. Its four siblings each pin their own sort order and their own
 * `.limit(1)` in their own spec file; this read had NEITHER, and that is the whole reason this
 * block exists rather than being one more line above.
 */
describe("the crawl summary is the LAST crawl, not the first one the project ever ran", () => {
  const CRAWL = bodyOf(PAGE, "latestSucceeded");

  /**
   * NEWEST FIRST, and this is the ordering an in-memory pick cannot repair: `.limit(1)` truncates
   * at the DATABASE, so ascending hands back the FIRST crawl a project ever ran. The card then
   * prints last spring's page count and last spring's date as today's — and the SAME row feeds
   * `deriveProjectSignals`, so the ladder calls a year-old crawl fresh and moves the project off
   * `crawl_site` on the strength of it.
   *
   * Measured 2026-08-18, not supposed: flipping `ascending` to `true` here was green across the
   * entire web suite AND `tsc`. `insights-query.test.ts`'s header already described this exact
   * failure in words, for its own read — the sentence existed and the assertion did not.
   */
  it("orders the crawls newest first", () => {
    expect(CRAWL).toMatch(/\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*false\b/i);
  });

  /**
   * …and takes exactly ONE row, which is what makes the sort order decide anything at all: without
   * the limit the sort is free and `.maybeSingle()` — pinned above — would ERROR on the second row
   * instead, so the two pins guard opposite halves of the same sentence.
   */
  it("takes exactly one row", () => {
    expect(CRAWL).toMatch(/\.limit\(\s*1\s*\)/);
  });
});

describe("the project list excludes archived projects by value, not by column", () => {
  /**
   * `.is("archived_at", null)` — the pin above matches the whole call, so this adds only the value
   * read through the parser, which is what keeps the two statements about this filter in one place
   * when the next one is added. `.eq(…, null)` would be the classic PostgREST defect (it sends the
   * STRING "null"); `.is("archived_at", something)` would silently stop excluding anything.
   */
  it("compares archived_at against null itself", () => {
    expect(filtersOf(bodyOf(PAGE, "listActiveProjects"), "the project list").get("archived_at")).toBe(
      "null",
    );
  });
});

/**
 * …AND EVERY ROW THE PAGE READ REACHES A CARD.
 *
 * Two fan-outs, two places a paid-for row can be dropped on the floor. `cardInputFor` gathers six
 * reads and returns them on one object — `ProjectCardInput` makes four of those fields OPTIONAL, so
 * handing back `crawl: undefined` typechecks and leaves every spec in this directory green. The
 * page's own fan-out then reads three more and must pass both maps ON to `cardInputFor`; replacing
 * either argument with a fresh empty Map would blank every card's connection and health line while
 * the reads still ran.
 *
 * Pinned as relationships — the binding a call lands in must be the expression that reaches the
 * consumer — so renaming any binding costs nothing while dropping or swapping one reddens.
 *
 * WHAT THIS STILL CANNOT SEE: that the rows then render. vitest has no RSC boundary and nothing in
 * the fast lane executes this page (signed lesson 12); the card layer's own specs prove the other
 * half, and no spec in this suite joins the two.
 */
/**
 * What an object-literal property FINALLY holds, following ONE local `const` when it goes through
 * one. `connection,` is shorthand for a `const` declared four lines up; asserting on the shorthand
 * would only prove the name still exists, which is exactly what `connection: null` leaves intact.
 * A `let` is deliberately NOT followed — see the body.
 */
function resolved(body: string, held: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(held)) return held;
  // `const` ONLY, and that is the whole point of this line. Following a `let` would verify the
  // DECLARATION and say nothing about the value at the return site: a referee wrote
  // `let connection = connections.get(project.id) ?? null;` and then `connection = null;` on the
  // next line, and every card's connection went permanently null with 225 specs, 1318 web tests,
  // `tsc` and `eslint` all green — defect M6 itself, arriving from the position axis instead of
  // the tail axis this function was hardened for. Refusing `let` means a reassignment leaves the
  // raw identifier here, the anchored pin fails, and immutability past the declaration is then
  // enforced by the compiler legitimately rather than by a claim in a comment.
  const binding = new RegExp(`\\bconst\\s+${held}\\s*=\\s*([^;]+);`).exec(body);
  return binding === null ? held : (binding[1] as string).replace(/\s+/g, " ").trim();
}

describe("the rows the page reads reach the cards it builds", () => {
  const CARD_INPUT = bodyOf(PAGE, "cardInputFor");
  const PAGE_FN = pageComponent(PAGE);

  it("keeps the fetched crawl summary on the card input", () => {
    const binding = fanOutBindingsOf(CARD_INPUT, "cardInputFor").get("latestSucceeded");
    expect(binding, "cardInputFor no longer calls latestSucceeded at all").toBeDefined();
    expect(returnPropsOf(CARD_INPUT, "cardInputFor").get("crawl")).toBe(binding);
  });

  /**
   * THE CONNECTION ROW — the ONE field on this object that no spec consumed.
   *
   * It is not fetched by the fan-out above, so no `fanOutBindingsOf` pin can reach it: it is looked
   * up in the map the page handed down, which is why it was missed when the six fan-out bindings
   * were pinned. `ProjectCardInput.connection` accepts null, so `connection: null` typechecks, and
   * `tokenStatus` beside it stays correct — measured 2026-08-18: green across the whole web suite
   * AND `tsc`. In production every card's Search Console line reads "not connected" while its token
   * health line keeps reporting on the connection it just denied having. A card contradicting
   * itself, on a page whose next-step ladder then routes every project to `connect_gsc`.
   *
   * Pinned as the RELATIONSHIP, not the spelling: the property must hold a lookup in the map
   * parameter, keyed by the project parameter's id, with both names read out of the signature — so
   * renaming either survives, while `null`, a fresh empty Map, or keying on the caller reddens.
   * MATCHED WHOLE, not anchored at the start, and that distinction was measured rather than
   * reasoned: an earlier version of this pin anchored only `^…get(project.id)` and left the tail
   * free, so `connections.get(project.id) ? null : null` satisfied it — 224 specs green AND `tsc`
   * exit 0, with every card's connection permanently null, i.e. the exact defect this pin exists
   * for. The comment that version carried ("`tsc` is already the gate on the tail") was checkably
   * wrong: `tsc` rejects `undefined` reaching a `ConnectionRow | null` field, and an always-null
   * ternary is neither undefined nor a type error. The optional `?? null` is the ONLY tail the
   * source is allowed to carry, so it is spelled out and everything else reddens.
   */
  it("keeps the connection row it looked up on the card input", () => {
    const params = paramsOf(CARD_INPUT, "cardInputFor");
    const held = returnPropsOf(CARD_INPUT, "cardInputFor").get("connection");
    expect(held, "cardInputFor no longer returns a `connection` property at all").toBeDefined();
    expect(resolved(CARD_INPUT, held as string)).toMatch(
      new RegExp(`^${params[3]}\\.get\\(\\s*${params[2]}\\.id\\s*\\)(\\s*\\?\\?\\s*null)?$`),
    );
  });

  /**
   * …AND THE HEALTH LINE IS FED THE SAME ROW. `tokenStatusFor` is already pinned by name above;
   * its ARGUMENTS were not, and `tokenStatusFor(null, health)` typechecks — the mirror image of the
   * defect above, arriving at the same contradictory card from the other side. Compared as text
   * against what the `connection` property itself holds, so the two lines cannot be fed different
   * rows whatever either one is called.
   */
  it("derives the token status from that same connection row", () => {
    const params = paramsOf(CARD_INPUT, "cardInputFor");
    const props = returnPropsOf(CARD_INPUT, "cardInputFor");
    expect(props.get("tokenStatus")).toBe(`tokenStatusFor(${props.get("connection")}, ${params[4]})`);
  });

  it("maps over the projects it read and hands both maps on to the gatherer", () => {
    const reads = fanOutBindingsOf(PAGE_FN, "the page's own fan-out");
    const projects = reads.get("listActiveProjects");
    const connections = reads.get("readConnections");
    const health = reads.get("readAccountHealth");
    expect([projects, connections, health].filter((binding) => binding === undefined)).toEqual([]);

    expect(PAGE_FN).toMatch(new RegExp(`\\b${projects}\\s*\\.map\\(`));
    const args = /cardInputFor\(([^)]*)\)/
      .exec(PAGE_FN)?.[1]
      ?.split(",")
      .map((argument) => argument.trim());
    expect(args, "nothing calls cardInputFor any more").toBeDefined();
    expect(args).toContain(connections);
    expect(args).toContain(health);
  });
});
