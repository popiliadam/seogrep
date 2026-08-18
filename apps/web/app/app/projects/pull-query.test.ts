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
 * What the SEARCH CONSOLE PULL LINE reads — the half no render spec can see, and the one where the
 * waste actually lived.
 *
 * Until this read split off, the card's pull line came from `latestSucceeded(…, "pull_gsc_data")`,
 * whose projection is `created_at, result` — and a pull's `result` is TWO windows of Search Console
 * rows, up to 15,000 each. The card printed one date out of it. Megabytes over the wire, per
 * project, per render, and nothing in the suite could see it: `insight-lines.test.tsx` renders the
 * line from hand-built rows, so the projection is executed by nothing at all.
 *
 * So this is a SOURCE pin, the mechanism `history-query.test.ts` and `audits-query.test.ts` use:
 * read the file, strip the comments, and match the SHORTEST DISTINCTIVE FRAGMENT with `/i` (signed
 * lesson 11).
 *
 * COMMENTS OUT FIRST is load-bearing rather than hygienic: this query's doc comment spells out in
 * prose why `result` must not be selected, so the negative pin below would fail on the sentence
 * forbidding the thing — and, worse, could pass off a comment after the column came back.
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
      `pull-summary query spec could not read ${path}. If the module moved, point this spec at ` +
        "its new home — do NOT delete it: nothing else in this suite executes the pull line's " +
        "query, so a query that fetched whole Search Console payloads would fail nothing.",
    );
  }
}

const PAGE = codeOf(read(resolve(HERE, "page.tsx")));

/** The body of ONE top-level function, from its `function <name>` to the brace in column 0. */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\` in page.tsx. If the pull line's read was renamed, rename it here ` +
        "too; if it was deleted, the line is being fed by something this spec does not check — " +
        "most likely by the crawl read, which fetches the whole payload.",
    );
  }
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/** The column list of the one `.select(...)` inside a function body (literals joined back up). */
function selectOf(body: string): string {
  const call = /\.select\(([\s\S]*?)\)\s*\n/.exec(body)?.[1];
  if (call === undefined) {
    throw new Error("the pull line's read has no `.select(...)` — did it start selecting *?");
  }
  const pieces = [...call.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error("the pull line's `.select(...)` holds no string literal — is it selecting *?");
  }
  return pieces.join("");
}

const READ = bodyOf(PAGE, "latestPullSummary");
const COLUMNS = selectOf(READ);

/** What the read was HANDED and what it does with it — see the describes at the bottom. */
const WHAT = "the pull line's read";
const PARAMS = paramsOf(READ, WHAT);
const FILTERS = filtersOf(READ, WHAT);
const CARD_INPUT = bodyOf(PAGE, "cardInputFor");

describe("the pull line reads the newest succeeded pull", () => {
  it("reads jobs, filtered to pull_gsc_data", () => {
    expect(READ).toMatch(/\.from\(\s*["']jobs["']\s*\)/i);
    expect(READ).toMatch(/\.eq\(\s*["']tool["']\s*,\s*["']pull_gsc_data["']\s*\)/i);
  });

  /**
   * SUCCEEDED only. Without the filter the newest row wins whatever it did, so a pull that FAILED
   * an hour ago dates the card as a fresh pull — and the window printed under it would be whatever
   * partial jsonb the failure left behind.
   */
  it("counts only succeeded pulls", () => {
    expect(READ).toMatch(/\.eq\(\s*["']status["']\s*,\s*["']succeeded["']\s*\)/i);
  });

  /** Scoped to the caller and the project, beside RLS `jobs_select_own` (NEVER #4). */
  it("scopes the read to the caller and the project", () => {
    expect(READ).toMatch(/\.eq\(\s*["']user_id["']/i);
    expect(READ).toMatch(/\.eq\(\s*["']project_id["']/i);
  });

  /** Newest first with `.limit(1)`: reversed, the limit truncates at the DATABASE. */
  it("orders newest first and takes one row", () => {
    expect(READ).toMatch(/\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*false\b/i);
    expect(READ).toMatch(/\.limit\(\s*1\s*\)/);
  });
});

describe("the pull line does not download Search Console payloads", () => {
  /**
   * NO BARE `result`. Every mention of the column in the projection must be a SUB-FIELD
   * (`result->…` / `result->>…`), each O(1) in the pull's size. Asserted on the COLUMN LIST rather
   * than the function body, so it cannot be satisfied by an unrelated identifier and cannot be
   * dodged by `.select("*")` — `selectOf` throws on anything that is not a literal column list.
   */
  it("selects only sub-fields of result, never the column itself", () => {
    expect(COLUMNS).toMatch(/result->/);
    expect(COLUMNS).not.toMatch(/result(?!->)/);
    expect(COLUMNS).not.toMatch(/\*/);
  });

  /**
   * The exact fields the line renders. `result->current->rows` and `result->previous->rows` are the
   * two that must never appear — they ARE the payload — and naming the whole set positively rules
   * them out by construction rather than by two negative pins a third big field would slip past.
   *
   * NOT IN THIS LIST, and deliberately: the number of rows the pull fetched. PostgREST can navigate
   * into jsonb but cannot take an array's length, so the only ways to print it are to download
   * `result->current->rows` — the very thing this spec forbids — or to store a count at pull time,
   * which is a change to what `pull_gsc_data` WRITES and belongs to that slice. The window and the
   * cap flag are the facts available at O(1), so they are the facts the card states.
   */
  it("selects exactly the columns and sub-fields the line renders", () => {
    const columns = COLUMNS.split(",")
      .map((column) => column.trim())
      .sort();
    expect(columns).toEqual(
      [
        "created_at",
        "window_days:result->days",
        "window_start:result->current->>start_date",
        "window_end:result->current->>end_date",
        "window_capped:result->current->capped",
        "previous_capped:result->previous->capped",
      ].sort(),
    );
  });

  /**
   * …and the pull is no longer fetched through the CRAWL read, which does download `result` whole.
   * Without this, deleting `latestPullSummary` and calling `latestSucceeded(…, "pull_gsc_data")`
   * again would restore the waste while every pin above simply stopped running.
   */
  it("is not routed back through the payload-fetching crawl read", () => {
    expect(bodyOf(PAGE, "cardInputFor")).toMatch(/latestPullSummary\(/);
    expect(bodyOf(PAGE, "cardInputFor")).not.toMatch(/latestSucceeded\([^)]*pull_gsc_data/);
  });
});

/**
 * THE VALUES, not only the column names. `.eq("user_id", userId)` rewritten to
 * `.eq("user_id", projectId)` satisfies the tenancy pin above word for word, typechecks, and passes
 * both gates — measured 2026-08-18. Not a leak (RLS still refuses another tenant's rows), a total
 * silent degrade: the filter matches nothing and every card's pull line falls back to "not pulled".
 *
 * TWO OF THIS READ'S FOUR FILTERS ARE ALREADY VALUE-PINNED and deliberately not repeated here:
 * `tool` and `status` are compared against LITERALS (`"pull_gsc_data"`, `"succeeded"`), which the
 * regexes above already match in full. The parameter-relationship shape used for the other two
 * would be wrong for a literal — there is no parameter for it to be the same as.
 */
describe("the pull line compares each column against the value it was handed", () => {
  /** Three distinct parameters — without this, a lost one would compare `undefined` to `undefined`. */
  it("is handed the client, the caller and the project", () => {
    expect(PARAMS).toHaveLength(3);
    expect(new Set(PARAMS).size).toBe(3);
  });

  it("filters user_id on the caller it was handed, not another id in scope", () => {
    expect(FILTERS.get("user_id")).toBe(PARAMS[1]);
  });

  it("filters project_id on the project it was handed", () => {
    expect(FILTERS.get("project_id")).toBe(PARAMS[2]);
  });
});

describe("the pull line's read fails visibly rather than emptying the card", () => {
  /**
   * `.maybeSingle()`, and EXACTLY it. Dropped, `data` arrives as an ARRAY and the
   * `as unknown as PullRow | null` cast swallows it: truthy object, every window field `undefined`,
   * and the card says the project has never been pulled while the row sits in the response.
   * `.single()` is the other wrong answer — it ERRORS on zero rows, which is the normal state of a
   * project that has connected Search Console but not pulled yet.
   */
  it("asks for one row with the forgiving single-row terminator", () => {
    expect(singleRowTerminatorsOf(READ)).toEqual(["maybeSingle"]);
  });

  /**
   * A FAILED READ THROWS — this page's stated choice over degrading. A pull line that says "not
   * pulled" because the database blipped sends the user to re-run a pull that already succeeded.
   * Pinned by what the branch DOES, not by the presence of the word `throw`.
   */
  it("throws on a failed lookup and never returns a degraded row", () => {
    const branch = errorBranchOf(READ, WHAT);
    expect(branch).toMatch(/throw\s+new\s+Error\(/);
    expect(branch).not.toMatch(/\breturn\b/);
    expect(branch).toMatch(/error\.message/);
  });

  /**
   * …AND THE ROW REACHES THE CARD. The pin above proves the CALL survived; this proves its RESULT
   * did. `ProjectCardInput.pull` accepts null, so `pull: undefined` — the row fetched, the round
   * trip paid for, the value dropped — typechecks and leaves every other spec here green. Pinned as
   * a relationship (the binding `latestPullSummary` lands in must be what the `pull` property
   * holds), so renaming the binding costs nothing and swapping it with `crawl` reddens.
   */
  it("keeps the fetched pull summary on the card input", () => {
    const binding = fanOutBindingsOf(CARD_INPUT, "cardInputFor").get("latestPullSummary");
    expect(binding, "cardInputFor no longer calls latestPullSummary at all").toBeDefined();
    expect(returnPropsOf(CARD_INPUT, "cardInputFor").get("pull")).toBe(binding);
  });
});
