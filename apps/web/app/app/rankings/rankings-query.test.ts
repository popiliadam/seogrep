import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RANKING_HISTORY_LIMIT,
  TRACKED_KEYWORD_LIMIT,
} from "../../../lib/projects/ranking-history";
import { errorBranchOf, filtersOf, paramsOf, singleRowTerminatorsOf } from "../projects/query-pins";

/**
 * What /app/rankings READS, and whether anyone can reach it — the two halves no render spec sees.
 *
 * The read modules talk to PostgREST and the list specs render from rows built in memory, so
 * reversing the sort, losing the tiebreaker, dropping the tenant filter, unbounding the read or
 * selecting the whole `report` jsonb leaves every render spec green. Same mechanism and same rules
 * as `lookups/lookup-history-query.test.ts`: strip the comments first, then match the SHORTEST
 * DISTINCTIVE FRAGMENT with `/i` (signed lesson 11).
 *
 * COMMENTS OUT FIRST is load-bearing rather than hygienic: both reads spell out in prose why there
 * is no `project_id` filter, why there is no `untracked_at` filter and why the whole `report` must
 * not be downloaded, so a pin matched against the raw file could pass off the sentence describing
 * the rule after the code stopped obeying it.
 *
 * The shared parsers come from `../projects/query-pins` — IMPORTED, never forked, for the reason
 * that file's own header gives. Its documented limit is that it reads TEXT and cannot resolve
 * scope, which is exactly why the DB lane (`lib/projects/ranking-history.db.test.ts`) executes
 * these same functions for real.
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
      `the rankings query spec could not read ${path}. If the module moved, point this spec at ` +
        "its new home — do NOT delete it: nothing else in the fast lane looks at these reads, so " +
        "a query that downloaded whole vendor payloads, lost its deterministic order, or silently " +
        "re-scoped itself would fail nothing.",
    );
  }
}

const MEASUREMENTS = codeOf(read(resolve(HERE, "read-measurements.ts")));
const TRACKED = codeOf(read(resolve(HERE, "read-tracked-keywords.ts")));
const PAGE = codeOf(read(resolve(HERE, "page.tsx")));
const LAYOUT = codeOf(read(resolve(HERE, "../layout.tsx")));

/** The body of ONE top-level function, from `function <name>` to the closing brace in column 0. */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\`. If the read was renamed, rename it here too; if it was deleted, ` +
        "the page is being fed by something this spec does not check.",
    );
  }
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/**
 * The column list of the one `.select(...)` in a body. Written as concatenated string literals in
 * one of the two reads, so the pieces are joined back up — a reader that accepted only a single
 * literal would throw on formatting rather than on a defect.
 */
function selectOf(body: string, what: string): string {
  const call = /\.select\(([\s\S]*?)\)\s*\n/.exec(body)?.[1];
  if (call === undefined) {
    throw new Error(`${what} has no \`.select(...)\` — did it start selecting *?`);
  }
  const pieces = [...call.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error(`${what}'s \`.select(...)\` holds no string literal — selecting *?`);
  }
  return pieces.join("");
}

const MEASUREMENT_WHAT = "the rank measurement read";
const MEASUREMENT_READ = bodyOf(MEASUREMENTS, "listKeywordPositionMeasurements");
const MEASUREMENT_COLUMNS = selectOf(MEASUREMENT_READ, MEASUREMENT_WHAT);

const TRACKED_WHAT = "the tracked keyword read";
const TRACKED_READ = bodyOf(TRACKED, "listTrackedKeywords");
const TRACKED_COLUMNS = selectOf(TRACKED_READ, TRACKED_WHAT);

describe("the rank measurement read is scoped to the caller", () => {
  it("reads keyword_position_measurements", () => {
    expect(MEASUREMENT_READ).toMatch(/\.from\(\s*["']keyword_position_measurements["']\s*\)/i);
  });

  /**
   * BESIDE RLS `keyword_position_measurements_select_own` (NEVER #4), and on this table that is
   * more than defence in depth: `project_id` is nullable and 0030's composite FK SKIPS its check
   * entirely on a null, so on the ad-hoc snapshots `user_id` is the only tenant guarantee the row
   * carries at all.
   */
  it("scopes the read to the caller", () => {
    expect(MEASUREMENT_READ).toMatch(/\.eq\(\s*["']user_id["']/i);
  });

  /**
   * …AGAINST THE CALLER IT WAS HANDED, not another id in scope. `.eq("user_id", somethingElse)`
   * satisfies the pin above word for word, typechecks, passes both gates, and silently returns
   * nothing. Compared against the function's OWN parameter, so renaming survives and re-pointing
   * reddens (the convention it rests on: the caller is the SECOND parameter, as in all five
   * siblings).
   */
  it("takes a client and a caller, and filters on that caller", () => {
    const params = paramsOf(MEASUREMENT_READ, MEASUREMENT_WHAT);
    expect(params).toHaveLength(2);
    expect(new Set(params).size).toBe(2);
    expect(filtersOf(MEASUREMENT_READ, MEASUREMENT_WHAT).get("user_id")).toBe(params[1]);
  });

  /**
   * NO PROJECT FILTER — and its absence is a silent LOSS of data rather than a visible break. 0030
   * keys a series on the DOMAIN and calls `project_id` provenance: the same keyword measured for
   * one domain through a project and ad hoc are two readings of ONE series, so filtering here
   * would hide half a tenant's own paid history from them and the page would render perfectly
   * without it. THE VERB AXIS IS VARIED for the reason the sibling records as measured: a narrow
   * pin missed `.not("project_id", "is", null)`, the most natural way anyone would write the
   * regression (signed lesson 14).
   */
  it("never re-scopes itself to a single project", () => {
    expect(filtersOf(MEASUREMENT_READ, MEASUREMENT_WHAT).has("project_id")).toBe(false);
    expect(MEASUREMENT_READ).not.toMatch(
      /\.(eq|neq|is|not|in|filter|match|or)\(\s*["'][^"']*project_id/i,
    );
  });
});

describe("the rank measurement read has a TOTAL order", () => {
  /** `fetched_at`, never `created_at`: 0030's three clocks — `created_at` re-dates a replayed write. */
  it("orders the readings by the moment they were measured, newest first", () => {
    expect(MEASUREMENT_READ).toMatch(
      /\.order\(\s*["']fetched_at["']\s*,\s*\{\s*ascending:\s*false\b/i,
    );
    expect(MEASUREMENT_READ).not.toMatch(/\.order\(\s*["']created_at["']/i);
  });

  /**
   * THE TIEBREAKER, and it is not cosmetic. One snapshot writes a row PER KEYWORD, so two rows can
   * share a `fetched_at` exactly, and `order by fetched_at desc` ALONE leaves their relative order
   * undefined in Postgres — the defect both sibling readers on this app still carry. On this page
   * that order decides which reading an interval clause is attached to, so an undefined order is
   * an undefined sentence. `id` is the primary key, so the order it completes is total.
   */
  it("breaks a fetched_at tie on the primary key", () => {
    expect(MEASUREMENT_READ).toMatch(/\.order\(\s*["']id["']\s*,\s*\{\s*ascending:\s*false\b/i);
    const ordered = [...MEASUREMENT_READ.matchAll(/\.order\(\s*["']([a-z_]+)["']/gi)].map(
      (match) => match[1],
    );
    // The tiebreaker must come AFTER the axis it breaks ties on, or it IS the sort.
    expect(ordered).toEqual(["fetched_at", "id"]);
  });
});

describe("the rank measurement read is bounded, and probes past its bound", () => {
  /**
   * BOUNDED BY THE SHARED CONSTANT, PLUS THE OVERFLOW PROBE. A literal here would drift from the
   * ceiling the page discloses. THE `+ 1` IS NOT SLACK, IT IS THE MEASUREMENT: fetching exactly
   * the ceiling leaves "the read came back full" as the only signal, and that cannot tell a tenant
   * with LIMIT + 1 readings from one whose LIMIT are all on the page — so the second tenant would
   * be told that paid readings exist which do not.
   */
  it("fetches one row past the ceiling — the probe the truncation claim rests on", () => {
    expect(MEASUREMENT_READ).toMatch(/\.limit\(\s*RANKING_HISTORY_LIMIT\s*\+\s*1\s*\)/);
    expect(MEASUREMENTS).toMatch(
      /import\s*\{[^}]*\bRANKING_HISTORY_LIMIT\b[^}]*\}\s*from\s*["'][^"']*ranking-history["']/,
    );
    expect(RANKING_HISTORY_LIMIT).toBeGreaterThan(0);
  });

  /**
   * THE ROWS THE DATABASE RETURNED ARE THE ROWS THAT LEAVE. Trimming the result in here — a
   * `.slice(0, RANKING_HISTORY_LIMIT)` before the return — would throw the probe row away at the
   * one point where its absence is indistinguishable from a short table, and the page would
   * silently stop disclosing its own ceiling. The builder is what cuts the list, AFTER sorting.
   */
  it("hands back what came back, and trims nothing on the way out", () => {
    expect(MEASUREMENT_READ).not.toMatch(/\.(slice|splice|filter|pop|shift)\(/);
  });

  /** A LIST, not a row: `.maybeSingle()` here would hand back one reading and call it a history. */
  it("asks PostgREST for the whole list", () => {
    expect(singleRowTerminatorsOf(MEASUREMENT_READ)).toEqual([]);
  });
});

describe("the rank measurement read does not download vendor payloads", () => {
  /**
   * NO `report`, ANYWHERE IN THE PROJECTION. That column is `jsonb not null` and holds the capped
   * placement list with each placement's verbatim vendor metrics — the biggest payload on this
   * table — while this page reads up to RANKING_HISTORY_LIMIT rows at once. 0030 lifted `status`,
   * the two ranks and the examined count out of the report into COLUMNS precisely so a series
   * could be read without opening a jsonb document per row.
   */
  it("never selects the report column, whole or in part", () => {
    // Column by column rather than by a bare /report/ over the whole list: three legitimate
    // columns on this table are spelled `vendor_REPORTed_time_*`, and a substring pin would go red
    // on those instead of on the payload — a pin that fires for the wrong reason teaches the next
    // reader to edit it.
    const columns = MEASUREMENT_COLUMNS.split(",").map((column) => column.trim());
    expect(columns.filter((column) => /^report(->|$)/.test(column))).toEqual([]);
    expect(MEASUREMENT_COLUMNS).not.toMatch(/\*/);
  });

  /**
   * The exact set, stated positively: naming the whole allowed projection rules out `report` — and
   * whatever the next migration adds to this table — by construction rather than by one negative
   * pin. Every field here is O(1) in the size of the measurement and every one is rendered.
   */
  it("selects exactly the scalars the page renders", () => {
    expect(MEASUREMENT_COLUMNS.split(",").map((column) => column.trim()).sort()).toEqual(
      [
        "id",
        "project_id",
        "keyword",
        "target_domain",
        "location_name",
        "language_code",
        "device",
        "search_engine",
        "depth_requested",
        "domain_match_rule",
        "status",
        "best_rank_group",
        "best_rank_absolute",
        "organic_items_examined",
        "not_measured_reason",
        "vendor_reported_time_field",
        "vendor_reported_time_value",
        "fetched_at",
      ].sort(),
    );
  });
});

describe("the tracked keyword read", () => {
  it("reads tracked_keywords, scoped to the caller it was handed", () => {
    expect(TRACKED_READ).toMatch(/\.from\(\s*["']tracked_keywords["']\s*\)/i);
    const params = paramsOf(TRACKED_READ, TRACKED_WHAT);
    expect(params).toHaveLength(2);
    expect(filtersOf(TRACKED_READ, TRACKED_WHAT).get("user_id")).toBe(params[1]);
  });

  /**
   * NO `untracked_at` FILTER, and that is the page's untracking decision expressed as a query.
   * Untracking is an ARCHIVE STAMP, not a delete: the panel needs both states for two different
   * sentences — a series whose subscription ended is labelled and keeps every reading, while the
   * "no reading yet" list is narrowed to the ACTIVE ones in the builder, where the choice is
   * unit-testable. Filtering here would make an untracked series indistinguishable from one that
   * was never tracked at all. Verb axis varied, as above.
   */
  it("reads the archived subscriptions too", () => {
    expect(filtersOf(TRACKED_READ, TRACKED_WHAT).has("untracked_at")).toBe(false);
    expect(TRACKED_READ).not.toMatch(
      /\.(eq|neq|is|not|in|filter|match|or)\(\s*["'][^"']*untracked_at/i,
    );
  });

  /**
   * A TOTAL ORDER HERE TOO, and on this table the tie is the NORMAL case rather than an edge one:
   * `track_keywords` registers a whole set in one call, so subscriptions sharing a `created_at` to
   * the microsecond are what the table is full of.
   */
  it("orders newest first and breaks the tie on the primary key", () => {
    const ordered = [...TRACKED_READ.matchAll(/\.order\(\s*["']([a-z_]+)["']/gi)].map(
      (match) => match[1],
    );
    expect(ordered).toEqual(["created_at", "id"]);
    expect(TRACKED_READ).toMatch(/\.order\(\s*["']id["']\s*,\s*\{\s*ascending:\s*false\b/i);
  });

  it("fetches one row past its own ceiling, and trims nothing on the way out", () => {
    expect(TRACKED_READ).toMatch(/\.limit\(\s*TRACKED_KEYWORD_LIMIT\s*\+\s*1\s*\)/);
    expect(TRACKED).toMatch(
      /import\s*\{[^}]*\bTRACKED_KEYWORD_LIMIT\b[^}]*\}\s*from\s*["'][^"']*ranking-history["']/,
    );
    expect(TRACKED_KEYWORD_LIMIT).toBeGreaterThan(0);
    expect(TRACKED_READ).not.toMatch(/\.(slice|splice|filter|pop|shift)\(/);
    expect(singleRowTerminatorsOf(TRACKED_READ)).toEqual([]);
  });

  it("selects exactly the join key and the two stamps", () => {
    expect(TRACKED_COLUMNS.split(",").map((column) => column.trim()).sort()).toEqual(
      [
        "id",
        "project_id",
        "keyword",
        "location_name",
        "language_code",
        "device",
        "created_at",
        "untracked_at",
      ].sort(),
    );
  });
});

describe("both reads fail visibly rather than emptying the page", () => {
  /**
   * A FAILED READ THROWS. Degrading to `[]` would render "No rank readings recorded yet" — the
   * page telling a tenant who paid one vendor request per keyword that nothing was ever measured,
   * because the database blipped. Pinned by what the branch DOES, not by the word `throw`
   * appearing somewhere in the body.
   */
  it.each([
    [MEASUREMENT_WHAT, MEASUREMENT_READ],
    [TRACKED_WHAT, TRACKED_READ],
  ])("%s throws and never returns a degraded list", (what, body) => {
    const branch = errorBranchOf(body, what);
    expect(branch).toMatch(/throw\s+new\s+Error\(/);
    expect(branch).not.toMatch(/\breturn\b/);
    expect(branch).toMatch(/error\.message/);
  });
});

describe("the rankings surface is read-only and never bypasses RLS", () => {
  /**
   * THE CALLER'S CLIENT, never the service one. The service role bypasses RLS by design, and on
   * this page it would remove the only tenant gate the ad-hoc measurements have.
   */
  it("never reaches for the service client", () => {
    for (const source of [MEASUREMENTS, TRACKED, PAGE]) {
      expect(source).not.toMatch(/createServiceClient|getServiceClient|SERVICE_ROLE/i);
    }
  });

  /**
   * READ-ONLY. `serp_snapshot` bills one paid vendor request PER KEYWORD; a write appearing on
   * this surface would be a panel path into spending, which is the assistant's job and nobody
   * else's. Nothing here starts a snapshot, tracks a keyword or spends a credit.
   */
  it("never writes", () => {
    for (const source of [MEASUREMENTS, TRACKED, PAGE]) {
      expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/i);
    }
  });
});

describe("the rows the reads fetched reach the page", () => {
  /**
   * The page must actually CALL both reads and hand their rows to the builder. Nothing else in
   * this suite joins the three: vitest has no RSC boundary, so a page that fetched the readings
   * and then rendered `buildRankingHistory([], [])` would typecheck, render an empty state, and
   * leave every spec here and next door green.
   */
  it("builds the history from the rows both reads return", () => {
    expect(PAGE).toMatch(/listKeywordPositionMeasurements\(\s*supabase\s*,\s*user\.id\s*\)/);
    expect(PAGE).toMatch(/listTrackedKeywords\(\s*supabase\s*,\s*user\.id\s*\)/);
    expect(PAGE).toMatch(/buildRankingHistory\(\s*measurements\s*,\s*tracked\s*\)/);
  });
});

describe("the rankings page is reachable", () => {
  /**
   * A page with no nav entry still builds and still passes every spec above; it is simply
   * unreachable from the dashboard. Matched inside the NAV_ITEMS array and by BOTH fields, taken
   * from the entry object rather than the file, so either field order passes and an href with no
   * label — a nav item with nothing to click — does not.
   */
  it("keeps a Rankings entry in the /app nav", () => {
    const items = LAYOUT.match(/NAV_ITEMS\s*=\s*\[([\s\S]*?)\]/)?.[1];
    expect(items, "no NAV_ITEMS array in app/app/layout.tsx").toBeDefined();

    const entry = items?.match(/\{[^{}]*\/app\/rankings[^{}]*\}/)?.[0];
    expect(
      entry,
      "no NAV_ITEMS entry points at /app/rankings. The page still builds and every spec here " +
        "still passes; it is simply unreachable from the dashboard.",
    ).toBeDefined();
    expect(entry).toMatch(/href:\s*["']\/app\/rankings["']/i);
    expect(entry).toMatch(/label:\s*["']Rankings["']/i);
  });
});
