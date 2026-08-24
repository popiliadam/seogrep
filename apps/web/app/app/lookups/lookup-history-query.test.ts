import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOMAIN_LOOKUP_HISTORY_LIMIT } from "../../../lib/projects/lookup-history";
import {
  errorBranchOf,
  filtersOf,
  paramsOf,
  singleRowTerminatorsOf,
} from "../projects/query-pins";

/**
 * What /app/lookups READS, and whether anyone can reach it — the two halves no render spec sees.
 *
 * `read-lookup-runs.ts` talks to PostgREST and `lookup-history-list.test.tsx` renders from
 * hand-built rows, so reversing the sort, dropping the tenant filter, unbounding the read or
 * selecting the whole `report` jsonb leaves every render spec green. Same mechanism and same rules
 * as `projects/lookups-query.test.ts`: strip the comments first, then match the SHORTEST
 * DISTINCTIVE FRAGMENT with `/i` (signed lesson 11).
 *
 * COMMENTS OUT FIRST is load-bearing rather than hygienic here: the read's own doc comment spells
 * out in prose why there is NO `project_id` filter and why the whole `report` must not be
 * downloaded, so a pin matched against the raw file could pass off the sentence describing the
 * rule after the code stopped obeying it.
 *
 * The shared parsers come from `../projects/query-pins` — IMPORTED, never forked, for the reason
 * that file's own header gives: a subtly wrong private copy matches nothing and passes vacuously.
 * Its documented limit is that it reads TEXT and cannot resolve scope, so what it proves is what
 * the source says, not what a value finally holds at runtime — which is exactly why the DB lane
 * (`lib/projects/lookup-history.db.test.ts`) executes this same function for real.
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
      `the lookup history query spec could not read ${path}. If the module moved, point this spec ` +
        "at its new home — do NOT delete it: nothing else in the fast lane looks at this read, so " +
        "a query that downloaded whole vendor payloads, or that silently re-scoped itself to one " +
        "project, would fail nothing.",
    );
  }
}

const SOURCE = codeOf(read(resolve(HERE, "read-lookup-runs.ts")));
const PAGE = codeOf(read(resolve(HERE, "page.tsx")));
const LAYOUT = codeOf(read(resolve(HERE, "../layout.tsx")));

/** The body of ONE top-level function, from `function <name>` to the closing brace in column 0. */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\`. If the history read was renamed, rename it here too; if it was ` +
        "deleted, the page is being fed by something this spec does not check.",
    );
  }
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/**
 * The column list of the one `.select(...)` in a body. Written as concatenated string literals, so
 * the pieces are joined back up — a reader that accepted only a single literal would throw on
 * formatting rather than on a defect.
 */
function selectOf(body: string): string {
  const call = /\.select\(([\s\S]*?)\)\s*\n/.exec(body)?.[1];
  if (call === undefined) {
    throw new Error("the lookup history read has no `.select(...)` — did it start selecting *?");
  }
  const pieces = [...call.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error("the lookup history `.select(...)` holds no string literal — selecting *?");
  }
  return pieces.join("");
}

const WHAT = "the lookup history read";
const READ = bodyOf(SOURCE, "listDomainLookupRuns");
const COLUMNS = selectOf(READ);
const PARAMS = paramsOf(READ, WHAT);
const FILTERS = filtersOf(READ, WHAT);

describe("the lookup history reads every run the caller owns", () => {
  /** The right table: 0027's own, not one of its three siblings. */
  it("reads domain_lookup_runs", () => {
    expect(READ).toMatch(/\.from\(\s*["']domain_lookup_runs["']\s*\)/i);
  });

  /**
   * SCOPED TO THE CALLER, beside RLS `domain_lookup_runs_select_own` (NEVER #4). On this table it
   * is more than defence in depth: a `project_id`-null row has no parent in `public` at all, so
   * `user_id` is the only tenant guarantee it carries — 0027's composite FK skips its check
   * entirely on exactly those rows, which are the rows this page exists to show.
   */
  it("scopes the read to the caller", () => {
    expect(READ).toMatch(/\.eq\(\s*["']user_id["']/i);
  });

  /**
   * …AGAINST THE CALLER IT WAS HANDED, not another id in scope. Measured on the sibling read and
   * recorded there: `.eq("user_id", somethingElse)` satisfies the pin above word for word,
   * typechecks, passes both gates, and silently returns nothing at all. Compared against the
   * function's OWN parameter so renaming survives and re-pointing reddens.
   */
  it("takes a client and a caller, and filters on that caller", () => {
    expect(PARAMS).toHaveLength(2);
    expect(new Set(PARAMS).size).toBe(2);
    expect(FILTERS.get("user_id")).toBe(PARAMS[1]);
  });

  /**
   * NO PROJECT FILTER — the pin this whole slice exists for, and the only one here whose failure
   * is a silent LOSS of data rather than a visible break. The project card filters
   * `.eq("project_id", projectId)` and is right to; adding the same filter here would drop every
   * bare-target run — 0027's own header calls that the commonest paid call these three tools
   * serve — and the page would keep rendering perfectly, just without the rows nothing else in the
   * product can show.
   *
   * THE VERB AXIS IS VARIED, and it was varied because the narrow version was MEASURED GREEN
   * (2026-08-18): `filtersOf` only reads `.eq` / `.is` / `.filter`, so `.not("project_id", "is",
   * null)` — the most natural way anyone would actually write this regression — passed the whole
   * fast lane. Only the DB lane caught it. Signed lesson 14: the axis a pin does not vary is the
   * axis the defect arrives on, so every PostgREST verb that can name this column is listed here.
   */
  it("never re-scopes itself to a single project", () => {
    expect(FILTERS.has("project_id")).toBe(false);
    expect(READ).not.toMatch(/\.(eq|neq|is|not|in|filter|match|or)\(\s*["'][^"']*project_id/i);
  });

  /** NEWEST FIRST, because the page is a history and a bounded read decides WHICH rows survive. */
  it("orders the runs newest first", () => {
    expect(READ).toMatch(/\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*false\b/i);
  });

  /**
   * …AND THAT ORDER IS TOTAL. `created_at` is `timestamptz default now()` and `now()` is the
   * TRANSACTION clock, so two runs can share a stamp to the microsecond, and `order by created_at
   * desc` ALONE leaves their relative order UNDEFINED in Postgres. That is a correctness defect
   * rather than untidiness on this page: `buildDomainLookupHistory` WALKS the row order to decide
   * which run "change since the previous run" names — its own sort is on `created_at` too and is
   * stable, so tied rows keep the order PostgREST handed over — so an undefined order makes the
   * IDENTITY of "previous" undefined, and two identical page loads can print a different delta and
   * a different date to the same tenant with nothing changed in the database.
   *
   * PINNED AS THE ORDERED PAIR, not as "an `id` order exists somewhere". A tiebreaker written
   * BEFORE the axis it breaks ties on is not a tiebreaker at all — it IS the sort, and the page
   * would be ordered by a random uuid while every other pin here stayed green.
   *
   * PINNED WITH ITS DIRECTION for the same reason the primary key's is: an order that is
   * deterministic per query but flips on a one-word edit is still a page whose "previous run" moves
   * under the reader between two builds.
   */
  it("breaks a created_at tie on the primary key, after the stamp and in the same direction", () => {
    expect(READ).toMatch(/\.order\(\s*["']id["']\s*,\s*\{\s*ascending:\s*false\b/i);
    const ordered = [...READ.matchAll(/\.order\(\s*["']([a-z_]+)["']/gi)].map((match) => match[1]);
    expect(ordered).toEqual(["created_at", "id"]);
  });

  /**
   * BOUNDED BY THE SHARED CONSTANT, PLUS THE OVERFLOW PROBE. A literal here would drift from the
   * ceiling the page discloses (`windowFull`), and the disclosure would then be off by however far
   * the two drifted.
   *
   * THE `+ 1` IS NOT SLACK, IT IS THE MEASUREMENT. Fetching exactly the ceiling leaves "the read
   * came back full" as the only available signal, and that signal cannot tell a tenant with
   * LIMIT + 1 runs from one whose LIMIT runs are all on the page — so the page would tell the
   * second tenant that older paid runs exist which do not. Drop the `+ 1` and it starts making
   * that false claim again, silently and only past the ceiling, where no fixture will meet it.
   * This is the fast lane's half of stopping that; `lookup-history.test.ts` owns the other half,
   * the flag's own boundary.
   */
  it("fetches one row past the ceiling — the probe the page's truncation claim rests on", () => {
    expect(READ).toMatch(/\.limit\(\s*DOMAIN_LOOKUP_HISTORY_LIMIT\s*\+\s*1\s*\)/);
    expect(SOURCE).toMatch(
      /import\s*\{[^}]*\bDOMAIN_LOOKUP_HISTORY_LIMIT\b[^}]*\}\s*from\s*["'][^"']*lookup-history["']/,
    );
    expect(DOMAIN_LOOKUP_HISTORY_LIMIT).toBeGreaterThan(0);
  });

  /** A LIST, not a row: `.maybeSingle()` here would hand back one run and call it a history. */
  it("asks PostgREST for the whole list", () => {
    expect(singleRowTerminatorsOf(READ)).toEqual([]);
  });

  /**
   * THE ROWS THE DATABASE RETURNED ARE THE ROWS THAT LEAVE — the other half of the pin above, and
   * the half nothing measured. A `.slice(0, DOMAIN_LOOKUP_HISTORY_LIMIT)` dropped in between the
   * `.limit()` and the `return` passes every lane in this repo today: it typechecks, it leaves the
   * `+ 1` above untouched so the probe pin stays green, and every render spec renders from rows it
   * never sees. What it actually does is throw the PROBE ROW away at the one point where its
   * absence is indistinguishable from a short table — so `windowFull` goes permanently false, the
   * page silently stops disclosing its own ceiling, and the oldest rows' missing changes go back to
   * reading as "first run of its kind". The builder is what cuts the list, AFTER sorting, and it is
   * unit-tested doing so.
   *
   * BOTH DIRECTIONS ARE ASSERTED: no trimmer on the way out, and the returned expression still
   * derives straight from `data`. Either one alone is escapable — a trim written as
   * `data?.splice(...)` or a return rebuilt out of a local would satisfy the other.
   *
   * `.filter(` is matched only where it is NOT followed by a quote: PostgREST's own
   * `.filter("col", "eq", value)` is a legitimate longhand on this chain (`filtersOf` reads it),
   * while a JS array filter never opens with a string literal. A pin that reddened on the
   * legitimate spelling would be teaching the next reader to edit the spec.
   */
  it("hands back what came back, and trims nothing on the way out", () => {
    expect(READ).not.toMatch(/\.(slice|splice|pop|shift)\(/);
    expect(READ).not.toMatch(/\.filter\(\s*(?!["'])/);
    expect(READ).toMatch(/return\s*\(?\s*data\s*\?\?\s*\[\]/);
  });

  /**
   * THE CALLER'S CLIENT, never the service one. The service role bypasses RLS by design, and on
   * this page it would remove the only tenant gate the bare-target rows have.
   */
  it("never reaches for the service client", () => {
    expect(READ).toMatch(/\bsupabase\b/);
    expect(SOURCE).not.toMatch(/createServiceClient|getServiceClient|SERVICE_ROLE/i);
    expect(PAGE).not.toMatch(/createServiceClient|getServiceClient|SERVICE_ROLE/i);
  });

  /**
   * READ-ONLY. This surface starts no lookup and spends no credit; a write appearing on it would
   * be a panel path into a 65-90 credit vendor call, which is the assistant's job and nobody
   * else's.
   */
  it("never writes", () => {
    expect(SOURCE).not.toMatch(/\.(insert|update|upsert|delete)\(/i);
    expect(PAGE).not.toMatch(/\.(insert|update|upsert|delete)\(/i);
  });
});

describe("the lookup history does not download vendor payloads", () => {
  /**
   * NO BARE `report`. This table's report is the largest in the run family — up to MAX_RUN_ROWS =
   * 50 capped vendor rows plus a metrics block — and this page reads up to
   * DOMAIN_LOOKUP_HISTORY_LIMIT rows at once, where the card reads one. Every mention of the
   * column in the projection must be a SUB-FIELD, each O(1) in the size of the lookup.
   */
  it("selects only sub-fields of report, never the column itself", () => {
    expect(COLUMNS).toMatch(/report->/);
    expect(COLUMNS).not.toMatch(/report(?!->)/);
    expect(COLUMNS).not.toMatch(/\*/);
  });

  /**
   * The exact set, stated positively: `report->rows`, `report->metrics`, `report->summary`,
   * `report->referring_domains` and `report->anchors` are all O(rows) or O(fields) blocks on this
   * table, and naming the whole allowed set rules them — and whatever the next migration adds —
   * out by construction rather than by five negative pins.
   */
  it("selects exactly the columns and sub-fields the page renders", () => {
    const columns = COLUMNS.split(",")
      .map((column) => column.trim())
      .sort();
    expect(columns).toEqual(
      [
        "tool",
        "target",
        "project_id",
        "created_at",
        "total:report->total",
        "top:report->top",
        "locale:report->locale",
      ].sort(),
    );
  });
});

describe("the lookup history fails visibly rather than emptying the page", () => {
  /**
   * A FAILED READ THROWS. Degrading to `[]` here would render "No domain lookups yet" — the page
   * telling a tenant who paid 65-90 credits a call that they never ran one, because the database
   * blipped. Pinned by what the branch DOES (raises, does not return, carries the driver's own
   * message), not by the word `throw` appearing somewhere in the body.
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
   * rendered `buildDomainLookupHistory([])` would typecheck, render an empty state, and leave
   * every spec here and next door green.
   */
  it("builds the history from the rows the read returns", () => {
    expect(PAGE).toMatch(/buildDomainLookupHistory\(\s*await\s+listDomainLookupRuns\(/);
    expect(PAGE).toMatch(/listDomainLookupRuns\(\s*supabase\s*,\s*user\.id\s*\)/);
  });

  /**
   * …AND UNDER THE BOUND THE READ WAS WRITTEN FOR. `buildDomainLookupHistory` takes an OPTIONAL
   * second argument — `limit`, defaulting to `DOMAIN_LOOKUP_HISTORY_LIMIT` — which exists so the
   * builder's own specs can drive the ceiling with four rows instead of two hundred and one. The
   * page has no business passing it, and until this pin nothing said so: `buildDomainLookupHistory(
   * rows, 50)` matched the open-ended pin above word for word, typechecked, and passed the whole
   * fast lane.
   *
   * WHAT THAT COSTS is a page that lists 50 of the 201 runs it fetched and paid 65-90 credits each
   * for, while the footer beside it goes on naming DOMAIN_LOOKUP_HISTORY_LIMIT — the constant is
   * what the sentence interpolates, not the bound that was applied — so 150 real runs vanish under
   * a sentence claiming the page shows 200. The read's `.limit()` and the builder's cut are two
   * halves of ONE ceiling and they are kept equal by there being exactly one number: the constant.
   *
   * MATCHED AS THE WHOLE CALL, closing paren included, because arity is the thing being pinned. A
   * fragment ending at the read's own `(` cannot see what follows it — that is exactly how the
   * argument got in.
   */
  it("applies the module's own ceiling — no second bound of the page's own", () => {
    expect(PAGE).toMatch(
      /buildDomainLookupHistory\(\s*await\s+listDomainLookupRuns\(\s*supabase\s*,\s*user\.id\s*\)\s*\)/,
    );
  });
});

describe("the lookups page is reachable", () => {
  /**
   * A page with no nav entry still builds and still passes every spec above; it is simply
   * unreachable from the dashboard. Matched inside the NAV_ITEMS array and by BOTH fields, taken
   * from the entry object rather than the file, so either field order passes and an href with no
   * label — a nav item with nothing to click — does not.
   */
  it("keeps a Lookups entry in the /app nav", () => {
    const items = LAYOUT.match(/NAV_ITEMS\s*=\s*\[([\s\S]*?)\]/)?.[1];
    expect(items, "no NAV_ITEMS array in app/app/layout.tsx").toBeDefined();

    const entry = items?.match(/\{[^{}]*\/app\/lookups[^{}]*\}/)?.[0];
    expect(
      entry,
      "no NAV_ITEMS entry points at /app/lookups. The page still builds and every spec here " +
        "still passes; it is simply unreachable from the dashboard.",
    ).toBeDefined();
    expect(entry).toMatch(/href:\s*["']\/app\/lookups["']/i);
    expect(entry).toMatch(/label:\s*["']Lookups["']/i);
  });
});
