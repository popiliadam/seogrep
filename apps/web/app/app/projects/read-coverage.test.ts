import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { paramsOf, returnPropsOf } from "./query-pins";

/**
 * THE COVERAGE MATRIX for /app/projects' nine reads — and the census that keeps it honest.
 *
 * Two production defects were found here on 2026-08-18, both green across the whole web suite and
 * `tsc`: `cardInputFor` could hand back `connection: null` (every card's Search Console line reads
 * "not connected" while its token-health line, fed by the same row, keeps reporting on the
 * connection just denied), and `latestSucceeded` could sort `ascending: true` (`.limit(1)` then
 * takes the OLDEST succeeded crawl, so every card is dated from the first crawl the project ever
 * ran). Two independent holes of the same class is not two mistakes — it is the ENUMERATION
 * missing. Six spec files each pinned their own read thoroughly and nobody owned the question
 * "which reads, and which of their properties, has nobody pinned at all?".
 *
 * So this file is that question, written down and then made executable. The table is the whole
 * survey, COVERED CELLS INCLUDED — a survey that lists only what is broken cannot be checked.
 *
 * ── THE NINE READS ────────────────────────────────────────────────────────────────────────────
 * Columns: table · filter columns · filter VALUES · sort · row limit · single-row terminator ·
 * error path · column projection · consumed by the caller.  Q&N = query-and-nav.test.ts,
 * HERE = this file, and a bare file name is that read's own spec.  `#n` is the nth `.order(` call
 * in page.tsx, source order; there are seven and every one is accounted for below.
 *
 *  R1 listActiveProjects — projects — sort #1, the ONE ascending read
 *     table HERE · cols Q&N · values Q&N (user_id→param, archived_at→null) · sort Q&N ·
 *     limit HERE (there must be NONE) · single-row Q&N ([]) · error Q&N · projection HERE ·
 *     consumed Q&N (`.map`) + HERE (the mapped element is the one handed on)
 *
 *  R2 readConnections — gsc_connections — no sort
 *     table HERE · cols Q&N · values Q&N · sort n/a (collapses into a Map keyed by project_id, so
 *     row order is unobservable) · limit HERE · single-row Q&N · error Q&N · projection HERE ·
 *     consumed Q&N (handed to cardInputFor) then Q&N's `connection` pin
 *
 *  R3 readAccountHealth — gsc_accounts — no sort
 *     table Q&N · cols Q&N · values Q&N · sort n/a (Map keyed by account id) · limit HERE ·
 *     single-row Q&N · error Q&N · projection Q&N (exactly id+token_status, plus the negative pin
 *     naming the ciphertext column) · consumed Q&N (once per page, and through `tokenStatusFor`)
 *
 *  R4 latestSucceeded — jobs — sort #2
 *     table HERE · cols Q&N · values Q&N (user/project/tool→params) + HERE (status→"succeeded",
 *     body-scoped) · sort Q&N · limit Q&N · single-row Q&N · error Q&N · projection HERE (the one
 *     read that MUST take `result` whole — its four siblings are pinned never to) · consumed Q&N
 *
 *  R5 latestPullSummary — jobs — sort #3 ....... every cell: pull-query.test.ts
 *  R6 recentCrawlRuns — jobs — sort #4 ......... every cell: history-query.test.ts, except
 *                                                table HERE
 *  R7 latestAuditRun — audit_runs — sort #5 .... every cell: audits-query.test.ts
 *  R8 latestDiscoveryRun — gsc_discovery_runs — sort #6 ..... every cell: insights-query.test.ts
 *  R9 latestDomainLookupRun — domain_lookup_runs — sort #7 .. every cell: lookups-query.test.ts
 *
 * ── WHAT `cardInputFor` RETURNS ───────────────────────────────────────────────────────────────
 *  project HERE · crawl Q&N · pull pull-query · crawlHistory history-query · auditRuns
 *  audits-query · discoveryRuns insights-query · lookupRuns lookups-query · connection Q&N ·
 *  tokenStatus Q&N (the name, and now its arguments)
 *
 * ── CELLS NO SPEC IN THIS LANE CAN FILL, stated rather than left blank ────────────────────────
 *  1. THAT ANY OF IT RENDERS. vitest has no RSC boundary and nothing in the fast lane executes
 *     this Server Component (signed lesson 12). The card layer's specs prove the other half and
 *     no spec joins the two.
 *  2. THAT THE TABLES AND COLUMNS EXIST, and that `authenticated` may read them. These pins read
 *     text; `guardrails/check-grants.sh` and the `verify-db.sh` lane own the schema, and a
 *     projection naming a dropped column is green here and throws in production.
 *  3. THE ROW-LIMIT CELL FOR R1/R2/R3 IS "no `.limit()` in the source", NOT "the whole list
 *     arrives". PostgREST truncates at its own `db-max-rows` and no source pin can see server
 *     configuration.
 *  4. WHICH ROW WINS a duplicate key in R2/R3's maps. That is a uniqueness constraint, a database
 *     fact, not a source fact — which is also why their sort cells are n/a rather than unpinned.
 *  5. THAT `user.id` IS THE SIGNED-IN USER. It comes from `supabase.auth.getUser()` behind the
 *     /app layout's session guard, and neither is executed here.
 *
 * TWO OF THE NINE HAVE A BEHAVIOURAL TWIN, and it is not a substitute. `lib/projects/audits.db`
 * and `lookups.db` drive R7 and R9 against a real PostgREST in the `verify-db.sh` lane — including
 * "takes the newest run of the tool, not the first one ever", which is M8's defect proven by
 * execution rather than by text. But they drive a COPY of the query, re-typed inside the spec
 * file, because a Server Component's private helpers cannot be imported: editing `page.tsx` does
 * not redden them. So they prove the SHAPE works and say nothing about the page still using it,
 * and the other seven reads have no behavioural lane at all.
 *
 * THREE census tests below are what stop this table going stale: a tenth read reddens this file
 * whether it is written as a declaration or as an arrow — the `fromCall` count catches the shape
 * the name list cannot see — and so does a tenth property on the card input. The recogniser's
 * reach is exactly what its regex spells; see the census below for what that does and does not
 * promise.
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
      `read-coverage spec could not read ${path}. If the page moved, point this spec at its new ` +
        "home — do NOT delete it: it is the only place that asks which of the page's reads has a " +
        "spec at all, and deleting it takes the question with it.",
    );
  }
}

const PAGE = codeOf(read(resolve(HERE, "page.tsx")));

/** The body of ONE top-level function, from its `function <name>` to the closing brace in column 0. */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\` in page.tsx. If the read was renamed, rename it here AND in the ` +
        "matrix at the top of this file; if it was deleted, delete its row rather than this spec.",
    );
  }
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/** Every top-level `function <name>` in the file, in source order. */
function functionNames(source: string): readonly string[] {
  return [...source.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*[(<]/g)].map((m) => m[1] as string);
}

/** …of those, the ones that actually talk to PostgREST. This is the census the matrix rests on. */
/**
 * How a PostgREST call is recognised, in ONE place because two copies drifted once already: a
 * referee's arrow read spelled `.from ("x")` — one space, valid TS, valid supabase-js — slipped a
 * `.includes(".from(")` filter AND a `/\.from\(/g` count on the same pass, green across 225 specs,
 * 1318 web tests, `tsc` and `eslint`. `[(<]` also admits the generic form `.from<Row>(`.
 */
const FROM_CALL_SOURCE = String.raw`\.from\s*[(<]`;

/**
 * A FRESH RegExp per use, from one shared source string. Not a single `/…/g` constant: `test()` on
 * a global regex advances `lastIndex`, so one shared instance would return alternating answers
 * across the reads it filters — a recogniser that silently sees only every other read is worse
 * than no recogniser, and it would have made the recogniser see only 7 of the 9 reads. On THIS page that fails the
 * name-equality census loudly (7 names against 9) rather than passing quietly — but the
 * loudness is a property of today's page, not of the bug, which is why the shape is fixed
 * rather than tolerated.
 */
const fromCall = (flags = ""): RegExp => new RegExp(FROM_CALL_SOURCE, flags);

const READS = functionNames(PAGE).filter((name) => fromCall().test(bodyOf(PAGE, name)));

/** The nine rows the matrix above carries, in the order it carries them. */
const MATRIX_ROWS = [
  "listActiveProjects",
  "readConnections",
  "readAccountHealth",
  "latestSucceeded",
  "latestPullSummary",
  "recentCrawlRuns",
  "latestAuditRun",
  "latestDiscoveryRun",
  "latestDomainLookupRun",
] as const;

const CARD_INPUT = bodyOf(PAGE, "cardInputFor");

describe("every read this page makes has a row in the matrix above", () => {
  /**
   * THE CENSUS, and the reason this file exists at all. Every other spec here starts by NAMING the
   * read it covers, so a tenth read added tomorrow is covered by nothing and fails nothing — which
   * is exactly how `connection` and `latestSucceeded`'s sort order came to be green. This asks the
   * opposite question: which reads exist, and does the survey know about them?
   *
   * An EQUALITY, in source order, not a subset: a read that is deleted must lose its matrix row
   * too, or the table starts describing a page that no longer exists.
   */
  it("reads exactly the nine tables the matrix names, in that order", () => {
    expect(READS).toEqual([...MATRIX_ROWS]);
  });

  /**
   * SEVEN `.order(` calls, all of them inside a read that the matrix gives a `#n` to. The count is
   * asserted against the reads rather than typed as a number, so the pin says what it means: no
   * sort exists on this page outside a row of the table above. SEVEN of the nine reads sort — the
   * assertion below lists all seven — and the two that do not are R2 and R3, which build maps
   * keyed by id where row order is unobservable. R4 is in the list precisely because it was the
   * one whose sort nobody had pinned.
   */
  it("sorts only inside reads the matrix accounts for", () => {
    const sorting = MATRIX_ROWS.filter((name) => bodyOf(PAGE, name).includes(".order("));
    const total = [...PAGE.matchAll(/\.order\(/g)].length;
    expect(sorting).toEqual([
      "listActiveProjects",
      "latestSucceeded",
      "latestPullSummary",
      "recentCrawlRuns",
      "latestAuditRun",
      "latestDiscoveryRun",
      "latestDomainLookupRun",
    ]);
    expect(total).toBe(sorting.length);
  });

  /**
   * NINE `.from(` calls, one per row of the matrix — the census `READS` cannot perform on its own.
   * `functionNames` reads `function <name>(` declarations, so a read written as an arrow
   * (`const extraRead = async (supabase) => supabase.from(...)`) is INVISIBLE to it: measured
   * 2026-08-18 by a referee, a tenth read in that shape left all 224 specs in this directory green,
   * which made the staleness contract this file's header claims FALSE for that shape. Counting the
   * calls file-wide and pinning the total to the census closes the arrow shape.
   *
   * WHAT "HOWEVER IT IS WRITTEN" IS WORTH, stated narrowly because the wider claim was measured
   * false once: this counts `fromCall`, which admits `.from(`, `.from (` and `.from<Row>(`. A
   * second referee escaped an earlier version of this pin with the single-space spelling while
   * every lane stayed green, so the guarantee here is the one that regex actually spells and no
   * more. A spelling it does not cover would slip the census again — and that is why the recogniser
   * is a single named constant shared with `READS` rather than two literals that can drift apart.
   *
   * KNOWN ESCAPE, measured and left open on purpose: `s["from"]("projects")` is invisible here,
   * green across every lane. The spelling axis is unbounded — bracket access, an alias, a bound
   * method — so a regex closes whichever spelling was last tried and no more. Three referees
   * escaped three different versions of this pin, one per round. The decision recorded is REVISE:
   * the replacement resolves actual CALL TARGETS through the TypeScript AST (the repo already
   * ships `typescript`), which is spelling-independent by construction, and that is its own slice.
   * This census stays meanwhile because it catches the shapes a person writes by accident.
   *
   * Note the direction it fails in when it is wrong: a `.from(` inside a STRING LITERAL counts,
   * so innocent code can force a spurious red and a matrix row. That is noisy but safe, and it is
   * not to be "fixed" by loosening the count — a census that fails open is not a census.
   *
   * It closes a second gap in passing, and that one is why this is a count rather than a lint: the
   * per-row table pin below asserts a body CONTAINS its table, so a body holding TWO reads would
   * satisfy it while quietly serving the wrong one. Here the total would be ten against nine.
   */
  it("talks to PostgREST only inside reads the matrix accounts for", () => {
    expect([...PAGE.matchAll(fromCall("g"))].length).toBe(READS.length);
  });

  /**
   * …and every read names its OWN table, inside its OWN body. Five of the nine were pinned this
   * way already; the other four were reached through a file-wide `.from("jobs")` search that finds
   * the FIRST matching statement, so re-pointing `latestSucceeded` at another table left the pin
   * measuring `latestPullSummary` instead and stayed green.
   */
  it.each([
    ["listActiveProjects", "projects"],
    ["readConnections", "gsc_connections"],
    ["readAccountHealth", "gsc_accounts"],
    ["latestSucceeded", "jobs"],
    ["latestPullSummary", "jobs"],
    ["recentCrawlRuns", "jobs"],
    ["latestAuditRun", "audit_runs"],
    ["latestDiscoveryRun", "gsc_discovery_runs"],
    ["latestDomainLookupRun", "domain_lookup_runs"],
  ])("%s reads %s", (fn, table) => {
    expect(bodyOf(PAGE, fn)).toMatch(new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)`));
  });
});

describe("every field the card input carries has a row in the matrix above", () => {
  /**
   * The second census. `ProjectCardInput` makes five of these fields OPTIONAL, so a tenth field
   * added to the type and forgotten in the object literal typechecks and renders as "never run";
   * a tenth field added HERE and consumed by nobody is the `connection` defect again. Both are
   * caught by asking for the exact set.
   */
  it("returns exactly the nine properties the matrix names", () => {
    expect([...returnPropsOf(CARD_INPUT, "cardInputFor").keys()].sort()).toEqual(
      [
        "project",
        "crawl",
        "pull",
        "crawlHistory",
        "auditRuns",
        "discoveryRuns",
        "lookupRuns",
        "connection",
        "tokenStatus",
      ].sort(),
    );
  });

  /**
   * `project` is the one property that is not fetched — it is the row the page already had — and
   * so the one no fan-out pin can reach. `ProjectCardInput.project` is required, so `undefined`
   * is caught by `tsc`; what is NOT caught is handing every card the same project, which is what
   * `projects[0]` in the caller would do. Pinned against the parameter, so a rename survives.
   */
  it("hands on the project it was given, not one it chose", () => {
    const params = paramsOf(CARD_INPUT, "cardInputFor");
    expect(returnPropsOf(CARD_INPUT, "cardInputFor").get("project")).toBe(params[2]);
  });
});

/**
 * The column list of the one `.select(...)` inside a function body, written as one or several
 * concatenated string literals (the five sibling specs each carry their own copy of this, and it
 * stays copied deliberately — see `query-pins.ts`'s header on why the file-IO half is not shared).
 *
 * Throws on anything that is not a literal list, which is what makes `.select("*")` and
 * `.select(columns)` fail here rather than silently matching nothing.
 */
function columnsOf(body: string, what: string): readonly string[] {
  const call = /\.select\(([\s\S]*?)\)\s*\n/.exec(body)?.[1];
  if (call === undefined) {
    throw new Error(`${what} has no \`.select(...)\` — did it start selecting *?`);
  }
  const pieces = [...call.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error(`${what}'s \`.select(...)\` holds no string literal — is it selecting *?`);
  }
  return pieces
    .join("")
    .split(",")
    .map((column) => column.trim())
    .sort();
}

/**
 * THE PROJECTION CELLS THE MATRIX FOUND EMPTY.
 *
 * Six of the nine reads pin their column list; three did not, and a projection is exactly the kind
 * of thing no type can see — every one of these reads ends in `as unknown as Row`, so a column
 * dropped from the `.select` string arrives as `undefined` on a row the query fetched successfully
 * and the card renders its empty state. Green everywhere, blank in production.
 */
describe("the three unpinned projections ask for what their rows declare", () => {
  /**
   * `domain` is the load-bearing one: `ProjectRow.domain` is what every card is TITLED with, and a
   * projection that lost it would render a page of cards headed `undefined` while the ladder,
   * which never reads it, kept working perfectly.
   */
  it("the project list selects the id, the domain and the date", () => {
    expect(columnsOf(bodyOf(PAGE, "listActiveProjects"), "the project list")).toEqual(
      ["id", "domain", "created_at"].sort(),
    );
  });

  /**
   * `account_id` is the load-bearing one here: `isGscConnected` reads it and NOT the row's
   * existence (defect #52), so a projection that fetched only `project_id, gsc_property` would
   * hand every card a connection row whose `account_id` is `undefined` — "not connected" on every
   * project that IS connected, which is the same production symptom as the `connection: null`
   * defect one file over, reached from the database side.
   */
  it("the connections map selects the project key, the account link and the property", () => {
    expect(columnsOf(bodyOf(PAGE, "readConnections"), "the connections map")).toEqual(
      ["project_id", "account_id", "gsc_property"].sort(),
    );
  });

  /**
   * THE INVERSE PIN. Its four siblings are each pinned NEVER to select the payload column; this
   * read is the one that must, because `summarizeCrawlResult` reads across the whole crawl jsonb
   * and the crawler's 100-page cap is what bounds it. Dropping `result` here leaves the date and
   * loses every number under it — a card that says a crawl happened and can say nothing about it —
   * and adding anything else re-opens the waste the pull read was split off to end.
   */
  it("the crawl summary selects the date and the payload it summarizes, and nothing else", () => {
    expect(columnsOf(bodyOf(PAGE, "latestSucceeded"), "the crawl summary")).toEqual(
      ["created_at", "result"].sort(),
    );
  });
});

describe("the three list reads take the whole list", () => {
  /**
   * NO `.limit()`, and this is the mirror of the `.limit(1)` pin the six single-row reads carry.
   * A limit here truncates at the DATABASE with no sort to make the truncation meaningful: on
   * `projects` the user simply stops seeing sites they track, and on the two maps the cards that
   * lost their row read "not connected" while the projects themselves render fine. Nothing else in
   * this suite executes the query, so all three are invisible.
   *
   * WHAT THIS DOES NOT SAY: that the whole list arrives. PostgREST truncates at its own
   * `db-max-rows` and no source pin can see server configuration — see cell 3 of the matrix.
   */
  it.each(["listActiveProjects", "readConnections", "readAccountHealth"])(
    "%s truncates nothing at the database",
    (fn) => {
      const body = bodyOf(PAGE, fn);
      // The only NEGATIVE pin in this file, so it says what it is measured against first: an empty
      // string satisfies `.not.toMatch` forever, and `bodyOf` throwing rather than returning "" is
      // the whole reason it cannot be one (signed lesson 12).
      expect(body).toMatch(/\.from\(/);
      expect(body).not.toMatch(/\.limit\(/);
    },
  );
});

describe("the crawl summary counts only crawls that succeeded", () => {
  /**
   * Already pinned in `query-and-nav.test.ts` — but through a file-wide search for the FIRST
   * `.from("jobs")` statement, and `page.tsx` now reads `jobs` three times. Re-pinned body-scoped
   * here so the assertion keeps measuring the read it names. The scenario that justifies it is a
   * RE-POINT, not a deletion — measured both ways: re-pointing `latestSucceeded` at another
   * table leaves the old file-wide pin GREEN, because it then finds `latestPullSummary`'s
   * identical filter, while deleting the filter outright reddens the old pin too (this read is
   * the first `.from("jobs")` in the file).
   *
   * A failed crawl must not date the card, and the reason is not cosmetic: the same row feeds
   * `deriveProjectSignals`, so a crawl that died an hour ago would move the project off the
   * `crawl_site` rung of the ladder.
   */
  it("filters status against the succeeded literal, in its own body", () => {
    expect(bodyOf(PAGE, "latestSucceeded")).toMatch(
      /\.eq\(\s*["']status["']\s*,\s*["']succeeded["']\s*\)/i,
    );
  });
});

/**
 * THE CHAIN OF CUSTODY. Every `user_id` filter on this page is pinned against its own function's
 * SECOND PARAMETER — which proves the reads are consistent with each other and says nothing about
 * what the page put in that parameter in the first place. Same for the project: `cardInputFor` is
 * pinned to hand on the project it was given, and the caller is pinned to `.map` over the list it
 * read, but nothing said the mapped element is what it passes. `projects[0]` satisfies both halves
 * and renders the first project's crawl, audits and lookups on every card on the page.
 */
describe("the page hands the reads the caller and the project it actually read", () => {
  const PAGE_FN = PAGE.slice(PAGE.search(/function\s+ProjectsPage\b/));

  /** The identifier `supabase.auth.getUser()` was destructured into — read, never spelled. */
  const AUTH_USER = (() => {
    const found = /data:\s*\{\s*([A-Za-z_$][\w$]*)\s*\}\s*,?\s*\}\s*=\s*await\s+supabase\.auth\.getUser\(\)/.exec(
      PAGE_FN,
    );
    if (found === null) {
      throw new Error(
        "the page no longer destructures a user out of `supabase.auth.getUser()`. Whatever it " +
          "filters its reads on now, this spec cannot tell you it is the signed-in caller.",
      );
    }
    return found[1] as string;
  })();

  /**
   * All three page-level reads get the SAME authenticated id. One of them was pinned this way
   * (the health read, and only to prove it runs once per page rather than per project); the other
   * two were pinned only against their own parameter, so handing `listActiveProjects` some other
   * id in scope typechecks and returns nothing at all — a panel that reads successfully and shows
   * you no projects.
   */
  it.each(["listActiveProjects", "readConnections", "readAccountHealth"])(
    "hands %s the authenticated caller",
    (fn) => {
      expect(PAGE_FN).toMatch(new RegExp(`${fn}\\(\\s*supabase\\s*,\\s*${AUTH_USER}\\.id\\s*\\)`));
    },
  );

  /**
   * …and `cardInputFor` gets that same caller and the project the `.map` is CURRENTLY on. Both are
   * read out of the source rather than spelled, so renaming the map's parameter or the user
   * binding survives and passing a different element does not.
   */
  it("hands the gatherer the caller and the project being mapped", () => {
    const mapped = /\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*cardInputFor\(/.exec(PAGE_FN);
    expect(
      mapped,
      "nothing maps a project straight into cardInputFor any more — what builds the cards now?",
    ).not.toBeNull();

    const args = /cardInputFor\(([^)]*)\)/
      .exec(PAGE_FN)?.[1]
      ?.split(",")
      .map((argument) => argument.trim());
    expect(args, "nothing calls cardInputFor any more").toBeDefined();
    expect(args?.[1]).toBe(`${AUTH_USER}.id`);
    expect(args?.[2]).toBe((mapped as RegExpExecArray)[1]);
  });
});
