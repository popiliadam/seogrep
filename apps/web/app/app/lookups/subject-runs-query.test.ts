import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUBJECT_RUN_HISTORY_LIMIT } from "../../../lib/projects/subject-history";
import {
  errorBranchOf,
  filtersOf,
  paramsOf,
  singleRowTerminatorsOf,
} from "../projects/query-pins";

/**
 * What /app/lookups' THIRD section reads, and whether anyone can reach it — the two halves no
 * render spec sees. The twin of `lookup-history-query.test.ts` and `keyword-runs-query.test.ts`,
 * one table over.
 *
 * `read-subject-runs.ts` talks to PostgREST and `subject-run-list.test.tsx` renders from hand-built
 * rows, so reversing the sort, dropping the tenant filter, unbounding the read or selecting the
 * whole `report` jsonb leaves every render spec green. Same rules as the siblings: strip the
 * comments first, then match the SHORTEST DISTINCTIVE FRAGMENT with `/i` (signed lesson 11).
 *
 * COMMENTS OUT FIRST is load-bearing rather than hygienic: the read's doc comment spells out in
 * prose why the whole `report` must not be downloaded and why `user_id` is the only tenant column
 * most of these rows have, so a pin matched against the raw file could pass off the sentence
 * describing the rule after the code stopped obeying it.
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
      `the subject run query spec could not read ${path}. If the module moved, point this spec at ` +
        "its new home — do NOT delete it: nothing else in the fast lane looks at this read, so a " +
        "query that downloaded whole vendor payloads, or that lost its tenant filter, would fail " +
        "nothing.",
    );
  }
}

const SOURCE = codeOf(read(resolve(HERE, "read-subject-runs.ts")));
const PAGE = codeOf(read(resolve(HERE, "page.tsx")));

/** The body of ONE top-level function, from `function <name>` to the closing brace in column 0. */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\`. If the subject history read was renamed, rename it here too; if ` +
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
    throw new Error("the subject history read has no `.select(...)` — did it start selecting *?");
  }
  const pieces = [...call.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error("the subject history `.select(...)` holds no string literal — selecting *?");
  }
  return pieces.join("");
}

const WHAT = "the subject run history read";
const READ = bodyOf(SOURCE, "listSubjectLookupRuns");
const COLUMNS = selectOf(READ);
const PARAMS = paramsOf(READ, WHAT);
const FILTERS = filtersOf(READ, WHAT);

describe("the subject history reads every run the caller owns", () => {
  /** The right table: 0032's own, not either of the two beside it on the same page. */
  it("reads subject_lookup_runs", () => {
    expect(READ).toMatch(/\.from\(\s*["']subject_lookup_runs["']\s*\)/i);
  });

  /**
   * SCOPED TO THE CALLER, beside RLS `subject_lookup_runs_select_own` (NEVER #4). On this table
   * that is not merely defence in depth: `project_id` is nullable and null is the COMMON case, and
   * 0032's composite FK explicitly guarantees NOTHING on a row where it is null (MATCH SIMPLE
   * skips the check), so `user_id` is the whole tenant guarantee on most rows here.
   */
  it("scopes the read to the caller", () => {
    expect(READ).toMatch(/\.eq\(\s*["']user_id["']/i);
  });

  /**
   * …AGAINST THE CALLER IT WAS HANDED, not another id in scope. Measured on a sibling read and
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
   * …AND THAT ORDER IS TOTAL, which on THIS table is not an edge case at all. ONE
   * ai_visibility_compare call writes up to TEN rows in a single transaction, and `created_at`
   * defaults to `now()` — the TRANSACTION clock — so those ten rows share the stamp to the
   * microsecond BY CONSTRUCTION, not by coincidence. `order by created_at desc` ALONE leaves their
   * relative order UNDEFINED in Postgres, so two identical page loads could list one comparison's
   * targets in two different orders, and the list's React keys (which include the position) would
   * move with them. `id` is the PRIMARY KEY (0032), so the order it completes is TOTAL.
   *
   * PINNED AS THE ORDERED PAIR: an `id` order written BEFORE the stamp is not a tiebreaker, it IS
   * the sort, and the section would be ordered by a random uuid with every other pin here green.
   * PINNED WITH ITS DIRECTION: an order that flips on a one-word edit still reshuffles the page.
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
   * came back full" as the only available signal, and that cannot tell a tenant with LIMIT + 1
   * runs from one whose LIMIT runs are all on the page.
   */
  it("fetches one row past the ceiling — the probe the truncation claim rests on", () => {
    expect(READ).toMatch(/\.limit\(\s*SUBJECT_RUN_HISTORY_LIMIT\s*\+\s*1\s*\)/);
    expect(SOURCE).toMatch(
      /import\s*\{[^}]*\bSUBJECT_RUN_HISTORY_LIMIT\b[^}]*\}\s*from\s*["'][^"']*subject-history["']/,
    );
    expect(SUBJECT_RUN_HISTORY_LIMIT).toBeGreaterThan(0);
  });

  /** A LIST, not a row: `.maybeSingle()` here would hand back one run and call it a history. */
  it("asks PostgREST for the whole list", () => {
    expect(singleRowTerminatorsOf(READ)).toEqual([]);
  });

  /**
   * THE ROWS THE DATABASE RETURNED ARE THE ROWS THAT LEAVE — the other half of the probe pin, and
   * the half nothing else measures. A `.slice(0, SUBJECT_RUN_HISTORY_LIMIT)` dropped between the
   * `.limit()` and the `return` typechecks, leaves the `+ 1` untouched so the probe pin stays
   * green, and throws the PROBE ROW away at the one point where its absence cannot be told from a
   * short table — `windowFull` goes permanently false and the section stops disclosing its ceiling.
   *
   * BOTH DIRECTIONS: no trimmer on the way out, and the returned expression still derives straight
   * from `data`. `.filter(` is matched only where NOT followed by a quote, so PostgREST's
   * legitimate `.filter("col", "eq", value)` longhand does not redden a pin meant for an array one.
   */
  it("hands back what came back, and trims nothing on the way out", () => {
    expect(READ).not.toMatch(/\.(slice|splice|pop|shift)\(/);
    expect(READ).not.toMatch(/\.filter\(\s*(?!["'])/);
    expect(READ).toMatch(/return\s*\(?\s*data\s*\?\?\s*\[\]/);
  });

  /**
   * THE CALLER'S CLIENT, never the service one. The service role bypasses RLS by design, and on a
   * project-less row — most of this table — that would remove the only tenant gate there is.
   */
  it("never reaches for the service client", () => {
    expect(READ).toMatch(/\bsupabase\b/);
    expect(SOURCE).not.toMatch(/createServiceClient|getServiceClient|SERVICE_ROLE/i);
  });

  /**
   * READ-ONLY. This surface starts no lookup and spends no credit; a write appearing on it would
   * be a panel path into a paid vendor call — at up to 900 credits, the most expensive one here.
   */
  it("never writes", () => {
    expect(SOURCE).not.toMatch(/\.(insert|update|upsert|delete)\(/i);
  });
});

describe("the subject history does not download vendor payloads", () => {
  /**
   * NO BARE `report`. A report here carries up to MAX_SUBJECT_RUN_ROWS = 50 vendor rows whose field
   * set is, for two of the three tools, whatever DataForSEO sent — and this page reads up to
   * SUBJECT_RUN_HISTORY_LIMIT rows at once, so `report` in the projection would download the
   * tenant's entire discovery archive to print one line each.
   */
  it("selects only sub-fields of report, never the column itself", () => {
    expect(COLUMNS).toMatch(/report->/);
    expect(COLUMNS).not.toMatch(/report(?!->)/);
    expect(COLUMNS).not.toMatch(/\*/);
  });

  /**
   * THE EXACT SET, STATED POSITIVELY. `report->rows` is the O(rows) block on this table, and
   * `report->compared_with` is an O(targets) one; naming the whole allowed set rules both — and
   * whatever a later migration adds — out by construction rather than by one negative pin.
   * `subject` and `subject_kind` are real COLUMNS and together they ARE the row's subject, so they
   * are here and are not jsonb sub-fields.
   */
  it("selects exactly the columns and sub-fields the page renders", () => {
    const columns = COLUMNS.split(",")
      .map((column) => column.trim())
      .sort();
    expect(columns).toEqual(
      [
        "tool",
        "subject_kind",
        "subject",
        "project_id",
        "created_at",
        "mode:report->mode",
        "platform:report->platform",
        "total:report->total",
        "shown:report->shown",
        "answered:report->answered",
        "top:report->top",
        "locale:report->locale",
        "compared_target_count:report->compared_target_count",
      ].sort(),
    );
  });
});

describe("the subject history fails visibly rather than emptying the section", () => {
  /**
   * A FAILED READ THROWS. Degrading to `[]` here would render "No discovery or AI visibility runs
   * recorded yet" — the page telling a tenant who paid up to 900 credits a call that nothing was
   * ever recorded, because the database blipped. Pinned by what the branch DOES, not by the word
   * `throw` appearing somewhere in the body.
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
   * rendered `buildSubjectRunHistory([])` would typecheck, render an empty state, and leave every
   * spec here and next door green.
   */
  it("builds the subject history from the rows the read returns", () => {
    expect(PAGE).toMatch(/buildSubjectRunHistory\(\s*await\s+listSubjectLookupRuns\(/);
    expect(PAGE).toMatch(/listSubjectLookupRuns\(\s*supabase\s*,\s*user\.id\s*\)/);
  });

  /**
   * …AND UNDER THE BOUND THE READ WAS WRITTEN FOR. `buildSubjectRunHistory` takes an OPTIONAL
   * second argument so its own specs can drive the ceiling with four rows instead of two hundred
   * and one. The page has no business passing it: a second bound would list N of the rows it
   * fetched under a footer that goes on naming SUBJECT_RUN_HISTORY_LIMIT.
   *
   * MATCHED AS THE WHOLE CALL, closing paren included, because ARITY is what is being pinned.
   */
  it("applies the module's own ceiling — no second bound of the page's own", () => {
    expect(PAGE).toMatch(
      /buildSubjectRunHistory\(\s*await\s+listSubjectLookupRuns\(\s*supabase\s*,\s*user\.id\s*\)\s*\)/,
    );
  });

  /**
   * …AND THE TWO OLDER SECTIONS ARE STILL THERE. This slice ADDS a section to a page that already
   * had two, and the cheapest way to break it is to hand two lists the same history, or to drop an
   * older read while wiring the new one. All three are named here because no other spec reads this
   * page for all three.
   */
  it("keeps rendering the domain and keyword sections beside the new one", () => {
    expect(PAGE).toMatch(/buildDomainLookupHistory\(\s*await\s+listDomainLookupRuns\(/);
    expect(PAGE).toMatch(/buildKeywordRunHistory\(\s*await\s+listKeywordResearchRuns\(/);
    expect(PAGE).toMatch(/<LookupHistoryList\s+history=\{domainHistory\}/);
    expect(PAGE).toMatch(/<KeywordRunList\s+history=\{keywordHistory\}/);
    expect(PAGE).toMatch(/<SubjectRunList\s+history=\{subjectHistory\}/);
  });
});
