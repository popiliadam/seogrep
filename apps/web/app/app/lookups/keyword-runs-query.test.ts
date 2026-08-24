import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEYWORD_RUN_HISTORY_LIMIT } from "../../../lib/projects/keyword-history";
import {
  errorBranchOf,
  filtersOf,
  paramsOf,
  singleRowTerminatorsOf,
} from "../projects/query-pins";

/**
 * What /app/lookups' KEYWORD section reads, and whether anyone can reach it — the two halves no
 * render spec sees. The twin of `lookup-history-query.test.ts`, one table over.
 *
 * `read-keyword-runs.ts` talks to PostgREST and `keyword-run-list.test.tsx` renders from hand-built
 * rows, so reversing the sort, dropping the tenant filter, unbounding the read or selecting the
 * whole `report` jsonb leaves every render spec green. Same rules as the sibling: strip the
 * comments first, then match the SHORTEST DISTINCTIVE FRAGMENT with `/i` (signed lesson 11).
 *
 * COMMENTS OUT FIRST is load-bearing rather than hygienic: the read's doc comment spells out in
 * prose why the whole `report` must not be downloaded and why `user_id` is the only tenant column
 * this table has, so a pin matched against the raw file could pass off the sentence describing the
 * rule after the code stopped obeying it.
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
      `the keyword run query spec could not read ${path}. If the module moved, point this spec at ` +
        "its new home — do NOT delete it: nothing else in the fast lane looks at this read, so a " +
        "query that downloaded whole vendor payloads, or that lost its tenant filter, would fail " +
        "nothing.",
    );
  }
}

const SOURCE = codeOf(read(resolve(HERE, "read-keyword-runs.ts")));
const PAGE = codeOf(read(resolve(HERE, "page.tsx")));

/** The body of ONE top-level function, from `function <name>` to the closing brace in column 0. */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\`. If the keyword history read was renamed, rename it here too; if ` +
        "it was deleted, the page is being fed by something this spec does not check.",
    );
  }
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/** The column list of the one `.select(...)` in a body, with concatenated literals rejoined. */
function selectOf(body: string): string {
  const call = /\.select\(([\s\S]*?)\)\s*\n/.exec(body)?.[1];
  if (call === undefined) {
    throw new Error("the keyword history read has no `.select(...)` — did it start selecting *?");
  }
  const pieces = [...call.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error("the keyword history `.select(...)` holds no string literal — selecting *?");
  }
  return pieces.join("");
}

const WHAT = "the keyword run history read";
const READ = bodyOf(SOURCE, "listKeywordResearchRuns");
const COLUMNS = selectOf(READ);
const PARAMS = paramsOf(READ, WHAT);
const FILTERS = filtersOf(READ, WHAT);

describe("the keyword history reads every run the caller owns", () => {
  /** The right table: 0029's own, not the domain one beside it on the same page. */
  it("reads keyword_research_runs", () => {
    expect(READ).toMatch(/\.from\(\s*["']keyword_research_runs["']\s*\)/i);
  });

  /**
   * SCOPED TO THE CALLER, beside RLS `keyword_research_runs_select_own` (NEVER #4). On this table
   * that is not merely defence in depth: there is no project column at all, so `user_id` is the
   * only tenant column the row carries and the only thing either layer can scope on.
   */
  it("scopes the read to the caller", () => {
    expect(READ).toMatch(/\.eq\(\s*["']user_id["']/i);
  });

  /**
   * …AGAINST THE CALLER IT WAS HANDED, not another id in scope. Measured on the sibling read and
   * recorded there: `.eq("user_id", somethingElse)` satisfies the pin above word for word,
   * typechecks, passes both gates, and silently returns nothing at all.
   */
  it("takes a client and a caller, and filters on that caller", () => {
    expect(PARAMS).toHaveLength(2);
    expect(new Set(PARAMS).size).toBe(2);
    expect(FILTERS.get("user_id")).toBe(PARAMS[1]);
  });

  /** NEWEST FIRST, because the page is a history and a bounded read decides WHICH rows survive. */
  it("orders the runs newest first", () => {
    expect(READ).toMatch(/\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*false\b/i);
  });

  /**
   * …AND THAT ORDER IS TOTAL — the domain read's rule beside it, and on THIS table the tie is
   * nearer the normal case than an edge one: one keyword set is commonly researched twice in a row
   * for two locales. `created_at` is `timestamptz default now()` and `now()` is the TRANSACTION
   * clock, so two runs can share a stamp to the microsecond, and `order by created_at desc` ALONE
   * leaves their relative order UNDEFINED in Postgres. `buildKeywordRunHistory` WALKS that order to
   * decide which run "since the previous run" names — its own sort is on `created_at` too and is
   * stable, so tied rows keep the order PostgREST handed over — so an undefined order makes the
   * IDENTITY of "previous" undefined and two identical page loads can print a different delta and a
   * different date to the same tenant with nothing changed in the database.
   *
   * PINNED AS THE ORDERED PAIR: an `id` order written BEFORE the stamp is not a tiebreaker, it IS
   * the sort, and the section would be ordered by a random uuid with every other pin here green.
   * PINNED WITH ITS DIRECTION: an order that flips on a one-word edit still moves "previous".
   */
  it("breaks a created_at tie on the primary key, after the stamp and in the same direction", () => {
    expect(READ).toMatch(/\.order\(\s*["']id["']\s*,\s*\{\s*ascending:\s*false\b/i);
    const ordered = [...READ.matchAll(/\.order\(\s*["']([a-z_]+)["']/gi)].map((match) => match[1]);
    expect(ordered).toEqual(["created_at", "id"]);
  });

  /**
   * BOUNDED BY THE SHARED CONSTANT, PLUS THE OVERFLOW PROBE. A literal here would drift from the
   * ceiling the section discloses (`windowFull`), and the disclosure would then be off by however
   * far the two drifted.
   *
   * THE `+ 1` IS NOT SLACK, IT IS THE MEASUREMENT. Fetching exactly the ceiling leaves "the read
   * came back full" as the only available signal, and that signal cannot tell a tenant with
   * LIMIT + 1 runs from one whose LIMIT runs are all on the page — so the page would tell the
   * second tenant that older paid runs exist which do not.
   */
  it("fetches one row past the ceiling — the probe the truncation claim rests on", () => {
    expect(READ).toMatch(/\.limit\(\s*KEYWORD_RUN_HISTORY_LIMIT\s*\+\s*1\s*\)/);
    expect(SOURCE).toMatch(
      /import\s*\{[^}]*\bKEYWORD_RUN_HISTORY_LIMIT\b[^}]*\}\s*from\s*["'][^"']*keyword-history["']/,
    );
    expect(KEYWORD_RUN_HISTORY_LIMIT).toBeGreaterThan(0);
  });

  /** A LIST, not a row: `.maybeSingle()` here would hand back one run and call it a history. */
  it("asks PostgREST for the whole list", () => {
    expect(singleRowTerminatorsOf(READ)).toEqual([]);
  });

  /**
   * THE ROWS THE DATABASE RETURNED ARE THE ROWS THAT LEAVE — the other half of the probe pin above,
   * and the half nothing measured. A `.slice(0, KEYWORD_RUN_HISTORY_LIMIT)` dropped in between the
   * `.limit()` and the `return` passes every lane in this repo today: it typechecks, it leaves the
   * `+ 1` untouched so the probe pin stays green, and every render spec renders from rows it never
   * sees. What it does is throw the PROBE ROW away at the one point where its absence cannot be
   * told from a short table — `windowFull` goes permanently false, the section stops disclosing its
   * own ceiling, and the oldest rows' missing changes read as "first run of its kind" again. The
   * builder is what cuts the list, AFTER sorting, and it is unit-tested doing so.
   *
   * BOTH DIRECTIONS: no trimmer on the way out, and the returned expression still derives straight
   * from `data`. Either alone is escapable — a trim written as `data?.splice(...)`, or a return
   * rebuilt out of a local, satisfies the other. `.filter(` is matched only where NOT followed by a
   * quote, so PostgREST's legitimate `.filter("col", "eq", value)` longhand does not redden a pin
   * meant for a JS array filter.
   */
  it("hands back what came back, and trims nothing on the way out", () => {
    expect(READ).not.toMatch(/\.(slice|splice|pop|shift)\(/);
    expect(READ).not.toMatch(/\.filter\(\s*(?!["'])/);
    expect(READ).toMatch(/return\s*\(?\s*data\s*\?\?\s*\[\]/);
  });

  /**
   * THE CALLER'S CLIENT, never the service one. The service role bypasses RLS by design, and on
   * this table that would remove the ONLY tenant gate its rows have.
   */
  it("never reaches for the service client", () => {
    expect(READ).toMatch(/\bsupabase\b/);
    expect(SOURCE).not.toMatch(/createServiceClient|getServiceClient|SERVICE_ROLE/i);
  });

  /**
   * READ-ONLY. This surface starts no lookup and spends no credit; a write appearing on it would
   * be a panel path into a paid vendor call, which is the assistant's job and nobody else's.
   */
  it("never writes", () => {
    expect(SOURCE).not.toMatch(/\.(insert|update|upsert|delete)\(/i);
  });
});

describe("the keyword history does not download vendor payloads", () => {
  /**
   * NO BARE `report`. A report here carries up to MAX_KEYWORD_RUN_ROWS = 100 vendor rows with
   * their trends and intents, and this page reads up to KEYWORD_RUN_HISTORY_LIMIT rows at once —
   * so `report` in the projection would download the tenant's entire keyword-research archive to
   * print one line each. Every mention must be a SUB-FIELD, each O(1) in the size of the run.
   */
  it("selects only sub-fields of report, never the column itself", () => {
    expect(COLUMNS).toMatch(/report->/);
    expect(COLUMNS).not.toMatch(/report(?!->)/);
    expect(COLUMNS).not.toMatch(/\*/);
  });

  /**
   * The exact set, stated positively: `report->rows` is the O(rows) block on this table, and
   * naming the whole allowed set rules it — and whatever a later migration adds — out by
   * construction rather than by one negative pin. `keyword_set` is a real COLUMN and the row's
   * subject, so it is here and is not a jsonb sub-field.
   */
  it("selects exactly the columns and sub-fields the page renders", () => {
    const columns = COLUMNS.split(",")
      .map((column) => column.trim())
      .sort();
    expect(columns).toEqual(
      [
        "keyword_set",
        "created_at",
        "total:report->total",
        "answered:report->answered",
        "top:report->top",
        "locale:report->locale",
      ].sort(),
    );
  });
});

describe("the keyword history fails visibly rather than emptying the section", () => {
  /**
   * A FAILED READ THROWS. Degrading to `[]` here would render "No keyword research recorded yet" —
   * the page telling a tenant who paid 25 credits a call that nothing was ever recorded, because
   * the database blipped. Pinned by what the branch DOES, not by the word `throw` appearing
   * somewhere in the body.
   */
  it("throws on a failed read and never returns a degraded list", () => {
    const branch = errorBranchOf(READ, WHAT);
    expect(branch).toMatch(/throw\s+new\s+Error\(/);
    expect(branch).not.toMatch(/\breturn\b/);
    expect(branch).toMatch(/error\.message/);
  });
});

describe("the rows the read fetched reach the page", () => {
  /**
   * The page must actually CALL the read and hand its rows to the builder. Nothing else in this
   * suite joins the two: vitest has no RSC boundary, so a page that fetched the runs and then
   * rendered `buildKeywordRunHistory([])` would typecheck, render an empty state, and leave every
   * spec here and next door green.
   */
  it("builds the keyword history from the rows the read returns", () => {
    expect(PAGE).toMatch(/buildKeywordRunHistory\(\s*await\s+listKeywordResearchRuns\(/);
    expect(PAGE).toMatch(/listKeywordResearchRuns\(\s*supabase\s*,\s*user\.id\s*\)/);
  });

  /**
   * …AND UNDER THE BOUND THE READ WAS WRITTEN FOR. `buildKeywordRunHistory` takes an OPTIONAL
   * second argument — `limit`, defaulting to `KEYWORD_RUN_HISTORY_LIMIT` — which exists so the
   * builder's own specs can drive the ceiling with four rows instead of two hundred and one. The
   * page has no business passing it, and until this pin nothing said so: `buildKeywordRunHistory(
   * rows, 50)` matched the open-ended pin above word for word, typechecked, and passed the whole
   * fast lane.
   *
   * WHAT THAT COSTS is a section listing 50 of the 201 runs it fetched and paid for, under a footer
   * that goes on naming KEYWORD_RUN_HISTORY_LIMIT — the constant is what the sentence interpolates,
   * not the bound that was applied — so 150 real runs vanish beneath a sentence claiming 200. The
   * read's `.limit()` and the builder's cut are two halves of ONE ceiling, kept equal by there
   * being exactly one number: the constant.
   *
   * MATCHED AS THE WHOLE CALL, closing paren included, because ARITY is the thing being pinned. A
   * fragment ending at the read's own `(` cannot see what follows it — which is how it got in.
   */
  it("applies the module's own ceiling — no second bound of the page's own", () => {
    expect(PAGE).toMatch(
      /buildKeywordRunHistory\(\s*await\s+listKeywordResearchRuns\(\s*supabase\s*,\s*user\.id\s*\)\s*\)/,
    );
  });

  /**
   * …AND THE DOMAIN SECTION IS STILL THERE. This slice ADDS a section to a page that already had
   * one, and the cheapest way to break the page it was added to is to hand both lists the same
   * history, or to drop the older read while wiring the new one. Both halves are named here
   * because no other spec reads this page for both.
   */
  it("keeps rendering the domain lookups beside the keyword runs", () => {
    expect(PAGE).toMatch(/buildDomainLookupHistory\(\s*await\s+listDomainLookupRuns\(/);
    expect(PAGE).toMatch(/<LookupHistoryList\s+history=\{domainHistory\}/);
    expect(PAGE).toMatch(/<KeywordRunList\s+history=\{keywordHistory\}/);
  });
});
