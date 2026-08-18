import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CRAWL_HISTORY_LIMIT } from "../../../lib/projects/history";
import {
  errorBranchOf,
  fanOutBindingsOf,
  filtersOf,
  paramsOf,
  returnPropsOf,
  singleRowTerminatorsOf,
} from "./query-pins";

/**
 * What the CRAWL TRAIL reads — the half no render spec can see.
 *
 * `page.tsx` is a Server Component talking to PostgREST, and nothing in the fast lane executes it:
 * `crawl-history.test.tsx` renders the trail from hand-built job rows, so dropping the tool filter,
 * reversing the order, or adding the `result` column leaves every render spec green. Same mechanism
 * and same rules as `query-and-nav.test.ts`: strip the comments first, then match the SHORTEST
 * DISTINCTIVE FRAGMENT with `/i` (signed lesson 11).
 *
 * COMMENTS OUT FIRST is load-bearing here, not hygienic: `page.tsx`'s doc comment for this query
 * explains in prose why it must NOT download `result`. Matched against the raw file, the negative
 * pin below would fail on the sentence forbidding the thing — and, worse, a `.select` pin could
 * pass off a comment after the column had been dropped from the code.
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
      `crawl-history query spec could not read ${path}. If the module moved, point this spec at ` +
        "its new home — do NOT delete it: nothing else in this suite executes the trail's query, " +
        "so a query that fetches megabytes of crawl payloads would fail nothing.",
    );
  }
}

const PAGE = codeOf(read(resolve(HERE, "page.tsx")));

/**
 * The body of ONE top-level function, from its `function <name>` to the closing brace in column 0.
 *
 * Scoping by FUNCTION rather than by table, because `page.tsx` now reads `jobs` twice with
 * deliberately opposite shapes: `latestSucceeded` wants the newest succeeded row WITH its `result`,
 * this one wants recent rows in every state WITHOUT it. A pin that searched the whole file for
 * `result` — or for `.from("jobs")` — would be satisfied, or broken, by the wrong query.
 *
 * Not-found throws rather than returning "": a renamed function would otherwise make every pin
 * below pass vacuously against an empty string.
 */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\` in page.tsx. If the crawl trail's read was renamed, rename it here ` +
        "too; if it was deleted, the trail is being fed by something this spec does not check.",
    );
  }
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/** The column list of the one `.select(...)` inside a function body. */
function selectOf(body: string): string {
  const columns = /\.select\(\s*["']([^"']*)["']\s*\)/.exec(body)?.[1];
  if (columns === undefined) {
    throw new Error("the crawl trail's read has no string `.select(...)` — did it start selecting *?");
  }
  return columns;
}

const TRAIL = bodyOf(PAGE, "recentCrawlRuns");

/** What the read was HANDED and what it does with it — see the describes at the bottom. */
const WHAT = "the crawl trail's read";
const PARAMS = paramsOf(TRAIL, WHAT);
const FILTERS = filtersOf(TRAIL, WHAT);
const CARD_INPUT = bodyOf(PAGE, "cardInputFor");

describe("the crawl trail reads crawl runs, and only crawl runs", () => {
  /**
   * `crawl_site` ONLY. Without the filter the trail lists whatever ran last for the project, so a
   * `pull_gsc_data` failure appears under "Recent crawls" and sends the user to debug a crawl that
   * never happened — and the five slots fill with other tools' rows, hiding the crawls entirely.
   */
  it("filters on the crawl_site tool", () => {
    expect(TRAIL).toMatch(/\.eq\(\s*["']tool["']\s*,\s*["']crawl_site["']\s*\)/i);
  });

  /** Scoped to the caller and the project, beside RLS `jobs_select_own` (constitution NEVER #4). */
  it("scopes the read to the caller and the project", () => {
    expect(TRAIL).toMatch(/\.eq\(\s*["']user_id["']/i);
    expect(TRAIL).toMatch(/\.eq\(\s*["']project_id["']/i);
  });

  /**
   * NEWEST FIRST, and this is the one ordering an in-memory sort cannot repair: `.limit()`
   * truncates at the DATABASE, so ascending would hand back the five OLDEST crawls of a project
   * crawled weekly for a year and the trail would show last spring, sorted perfectly.
   */
  it("orders the runs newest first", () => {
    expect(TRAIL).toMatch(/\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*false\b/i);
  });

  /**
   * Five, via the SAME constant the builder caps with — one number, not two that agree today. The
   * value itself is asserted in `lib/projects/history.test.ts` against the export, not by grepping
   * for a digit.
   */
  it("limits the read to the shared history limit", () => {
    expect(TRAIL).toMatch(/\.limit\(\s*CRAWL_HISTORY_LIMIT\s*\)/);
    expect(CRAWL_HISTORY_LIMIT).toBe(5);
  });

  /**
   * Every status. The fact line above already shows the newest SUCCEEDED crawl; a trail that
   * re-applied that filter would be a second copy of the same sentence and would hide exactly the
   * two states the user needs — the run still queued and the run that failed.
   */
  it("does not filter by status", () => {
    expect(TRAIL).not.toMatch(/\.eq\(\s*["']status["']/i);
  });
});

describe("the crawl trail does not download crawl payloads", () => {
  /**
   * NO `result`. It is the crawl's whole stored jsonb — megabytes per project for a site crawled
   * weekly for a year, fetched to render five status words. The card shows ONE summary and gets it
   * from `latestSucceeded`'s single row; this read must stay payload-free.
   *
   * Asserted on the COLUMN LIST rather than the function body, so it cannot be satisfied by an
   * unrelated identifier, and cannot be dodged by `.select("*")` — `selectOf` throws on anything
   * that is not a literal column list.
   */
  it("selects no result column", () => {
    expect(selectOf(TRAIL)).not.toMatch(/result/i);
  });

  /**
   * The columns the trail actually renders. `tool` is among them ON PURPOSE: `buildCrawlHistory`
   * re-applies the tool filter, so a projection that omitted the column would hand it `undefined`
   * for every row and silently empty every trail on the page — green everywhere, blank in
   * production.
   */
  it("selects exactly the lifecycle columns the trail renders", () => {
    const columns = selectOf(TRAIL)
      .split(",")
      .map((column) => column.trim())
      .sort();
    expect(columns).toEqual(
      ["created_at", "error", "finished_at", "id", "started_at", "status", "tool"].sort(),
    );
  });
});

/**
 * THE VALUES, not only the column names. `.eq("user_id", userId)` rewritten to
 * `.eq("user_id", projectId)` satisfies the tenancy pin above word for word, typechecks, and passes
 * both gates — measured 2026-08-18. Not a leak (RLS still refuses another tenant's rows), a total
 * silent degrade: the filter matches nothing and "Recent crawls" is empty on every card of a
 * project that has been crawled weekly for a year.
 *
 * `tool` is NOT pinned here again: it is compared against the literal `"crawl_site"`, which the
 * regex at the top of this file already matches in full. The parameter-relationship shape used for
 * the other two would be wrong for a literal — there is no parameter for it to be the same as.
 */
describe("the crawl trail compares each column against the value it was handed", () => {
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

describe("the crawl trail keeps its rows and fails visibly", () => {
  /**
   * NO SINGLE-ROW TERMINATOR — the mirror image of the pin its four siblings carry. This read wants
   * a LIST, and `.maybeSingle()` appended to it does not fail: PostgREST returns the one row (or
   * errors on several), the `as unknown as JobHistoryRow[]` cast swallows the shape change whole,
   * and `buildCrawlHistory` iterates an object into an empty trail. Green everywhere, blank in
   * production — the same shape as the projection defect the block above exists for.
   */
  it("takes the whole list, with no single-row terminator truncating it", () => {
    expect(singleRowTerminatorsOf(TRAIL)).toEqual([]);
  });

  /**
   * A FAILED READ THROWS — this page's stated choice over degrading. A trail that silently returned
   * `[]` on a database error is indistinguishable from a project that has never been crawled, which
   * is the one thing the trail exists to tell apart. Pinned by what the branch DOES (raises, does
   * not return, carries the driver's message), not by the presence of the word `throw`.
   */
  it("throws on a failed lookup and never returns an empty trail", () => {
    const branch = errorBranchOf(TRAIL, WHAT);
    expect(branch).toMatch(/throw\s+new\s+Error\(/);
    expect(branch).not.toMatch(/\breturn\b/);
    expect(branch).toMatch(/error\.message/);
  });

  /**
   * …AND THE ROWS REACH THE CARD. `ProjectCardInput.crawlHistory` is OPTIONAL — deliberately, so
   * the builder's own specs can omit it — which is exactly why `cardInputFor` can fetch the trail,
   * pay for the round trip, and hand back `crawlHistory: undefined` with `tsc` and every spec here
   * green. Pinned as a relationship (the binding `recentCrawlRuns` lands in must be what the
   * `crawlHistory` property holds), so renaming the binding costs nothing and swapping it with a
   * sibling reddens.
   */
  it("keeps the fetched trail on the card input", () => {
    const binding = fanOutBindingsOf(CARD_INPUT, "cardInputFor").get("recentCrawlRuns");
    expect(binding, "cardInputFor no longer calls recentCrawlRuns at all").toBeDefined();
    expect(returnPropsOf(CARD_INPUT, "cardInputFor").get("crawlHistory")).toBe(binding);
  });
});
