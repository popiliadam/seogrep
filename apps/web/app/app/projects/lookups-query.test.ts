import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOMAIN_LOOKUP_TOOLS } from "../../../lib/projects/lookups";
import {
  errorBranchOf,
  fanOutBindingsOf,
  filtersOf,
  paramsOf,
  returnPropsOf,
  singleRowTerminatorsOf,
} from "./query-pins";

/**
 * What the DOMAIN LOOKUP LINES read — the half no render spec can see.
 *
 * `page.tsx` is a Server Component talking to PostgREST, and nothing in the fast lane executes it:
 * `lookup-lines.test.tsx` renders the lines from hand-built rows, so reversing the order, dropping
 * the tenant filter, dropping the PROJECT filter, or selecting the whole `report` jsonb leaves
 * every render spec green. Same mechanism and same rules as `insights-query.test.ts`: strip the
 * comments first, then match the SHORTEST DISTINCTIVE FRAGMENT with `/i` (signed lesson 11).
 *
 * COMMENTS OUT FIRST is load-bearing here, not hygienic: this query's doc comment explains in prose
 * why the whole `report` must NOT be downloaded and why the project filter is a product decision,
 * so the negative pin below would fail on the sentence forbidding the thing — or, worse, a
 * `.select` pin could pass off a comment after the code had changed.
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
      `domain-lookup-runs query spec could not read ${path}. If the module moved, point this spec ` +
        "at its new home — do NOT delete it: nothing else in this suite executes the lookup lines' " +
        "query, so a query that fetched whole vendor payloads would fail nothing.",
    );
  }
}

const PAGE = codeOf(read(resolve(HERE, "page.tsx")));

/**
 * The body of ONE top-level function, from its `function <name>` to the closing brace in column 0.
 *
 * Scoped by FUNCTION rather than by table, for `insights-query.test.ts`'s reason: `page.tsx` now
 * makes seven different reads, and a pin that searched the whole file would be satisfied — or
 * broken — by the wrong one.
 */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\b`));
  if (start === -1) {
    throw new Error(
      `no \`function ${name}\` in page.tsx. If the lookup lines' read was renamed, rename it here ` +
        "too; if it was deleted, the lines are being fed by something this spec does not check.",
    );
  }
  const end = source.indexOf("\n}", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/**
 * The column list of the one `.select(...)` inside a function body. Written as one or several
 * concatenated string literals, so the pieces are joined back together — a reader that only
 * accepted a single literal would throw on formatting.
 */
function selectOf(body: string): string {
  const call = /\.select\(([\s\S]*?)\)\s*\n/.exec(body)?.[1];
  if (call === undefined) {
    throw new Error("the lookup lines' read has no `.select(...)` — did it start selecting *?");
  }
  const pieces = [...call.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]);
  if (pieces.length === 0) {
    throw new Error("the lookup lines' `.select(...)` holds no string literal — is it selecting *?");
  }
  return pieces.join("");
}

const READ = bodyOf(PAGE, "latestDomainLookupRun");
const COLUMNS = selectOf(READ);

/** What the read was HANDED and what it does with it — see the two describes at the bottom. */
const WHAT = "the lookup lines' read";
const PARAMS = paramsOf(READ, WHAT);
const FILTERS = filtersOf(READ, WHAT);
const CARD_INPUT = bodyOf(PAGE, "cardInputFor");

describe("the lookup lines read the newest run of one domain lookup", () => {
  /** The right table: 0027 is a FOURTH sibling, not a row in audit_runs or gsc_discovery_runs. */
  it("reads domain_lookup_runs", () => {
    expect(READ).toMatch(/\.from\(\s*["']domain_lookup_runs["']\s*\)/i);
  });

  /**
   * ONE TOOL per read. Without the filter the newest lookup of ANY kind wins every line, so a card
   * would show the same run three times — dated correctly, labelled wrongly, and with the wrong
   * report shape underneath it (these three reports share no field but `total` and `top`).
   */
  it("filters on the tool it was asked for", () => {
    expect(READ).toMatch(/\.eq\(\s*["']tool["']\s*,\s*tool\s*\)/i);
  });

  /**
   * SCOPED TO THE CALLER, beside RLS `domain_lookup_runs_select_own` (NEVER #4) — and on this
   * table the filter is more than defence in depth: a `project_id`-null row has no parent in
   * `public`, so `user_id` is the only tenant guarantee it carries.
   */
  it("scopes the read to the caller", () => {
    expect(READ).toMatch(/\.eq\(\s*["']user_id["']/i);
  });

  /**
   * SCOPED TO THE PROJECT, and this one is a PRODUCT decision rather than a tenancy one. 0027's
   * `project_id` is nullable and the commonest paid call to these tools is a bare target — a
   * COMPETITOR's domain, no project at all. Without this filter the newest such run would land on
   * the card of a site it says nothing about: a rival's ranked-keyword count printed under the
   * tenant's own domain. `.eq` never matches a null, which is exactly the behaviour wanted.
   */
  it("scopes the read to the project, so a bare-target lookup never lands on a card", () => {
    expect(READ).toMatch(/\.eq\(\s*["']project_id["']\s*,\s*projectId\s*\)/i);
  });

  /**
   * NEWEST FIRST, and this is the ordering an in-memory pick cannot repair: `.limit(1)` truncates
   * at the DATABASE, so ascending hands back the FIRST lookup a project ever ran and the card
   * reports last spring's numbers as today's.
   */
  it("orders the runs newest first", () => {
    expect(READ).toMatch(/\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*false\b/i);
  });

  it("takes exactly one row", () => {
    expect(READ).toMatch(/\.limit\(\s*1\s*\)/);
  });

  /** All three are asked for — a line missing from the query is a line missing from every card. */
  it("is driven once per domain lookup tool", () => {
    const fanOut = bodyOf(PAGE, "latestDomainLookupRuns");
    expect(fanOut).toMatch(/DOMAIN_LOOKUP_TOOLS\s*\.map\(/);
    expect(DOMAIN_LOOKUP_TOOLS).toEqual([
      "ranked_keywords",
      "analyze_backlinks",
      "compare_competitors",
    ]);
  });

  /**
   * THE CALLER'S CLIENT, never the service one. This page reads only the caller's own rows and the
   * service role bypasses RLS by design, so its appearance anywhere on this path would silently
   * remove the real tenant gate from a table whose weakest rows are guarded by `user_id` alone.
   */
  it("never reaches for the service client", () => {
    expect(READ).toMatch(/\bsupabase\b/);
    expect(PAGE).not.toMatch(/createServiceClient|getServiceClient|SERVICE_ROLE/i);
  });
});

describe("the lookup lines do not download vendor payloads", () => {
  /**
   * NO BARE `report`. This table's report is the LARGEST in the run family — up to MAX_RUN_ROWS =
   * 50 capped vendor rows plus a metrics block, where 0024/0025/0026 store measurements this
   * system had already capped on the way in. Every mention of the column in the projection must
   * therefore be a SUB-FIELD (`report->…`), each of which is O(1) in the size of the lookup.
   *
   * Asserted on the COLUMN LIST rather than the function body, so it cannot be satisfied by an
   * unrelated identifier and cannot be dodged by `.select("*")` — `selectOf` throws on anything
   * that is not a literal column list.
   */
  it("selects only sub-fields of report, never the column itself", () => {
    expect(COLUMNS).toMatch(/report->/);
    expect(COLUMNS).not.toMatch(/report(?!->)/);
    expect(COLUMNS).not.toMatch(/\*/);
  });

  /**
   * The exact sub-fields the lines print, and no O(rows) one among them. `report->rows`,
   * `report->metrics`, `report->referring_domains` and `report->anchors` are the ones that must
   * never appear here; naming the whole set positively rules them out by construction rather than
   * by four negative pins that a fifth big field would slip past.
   */
  it("selects exactly the columns and sub-fields the lines render", () => {
    const columns = COLUMNS.split(",")
      .map((column) => column.trim())
      .sort();
    expect(columns).toEqual(
      ["tool", "created_at", "total:report->total", "top:report->top"].sort(),
    );
  });
});

/**
 * THE VALUES, not only the column names — the hole every pin above leaves open.
 *
 * Measured on 2026-08-18, not supposed: `.eq("user_id", userId)` rewritten to
 * `.eq("user_id", projectId)` satisfies the tenancy pin above word for word, typechecks, and passes
 * BOTH gates. It is not a leak — RLS still refuses another tenant's rows — it is a total silent
 * degrade: the filter matches nothing, so every lookup line on every card reads "not run for this
 * domain" while the query returns successfully.
 *
 * So each filter is compared against the read's OWN PARAMETER, taken from its signature instead of
 * spelled here. That makes the pin a RELATIONSHIP: renaming `userId` renames both sides at once and
 * this stays green, while pointing the filter at another id in scope reddens it. The one legitimate
 * change it cannot survive is REORDERING the parameters — caller second, project third, tool
 * fourth, here and in all three siblings — and that is a deliberate trade rather than an oversight:
 * a read whose (user, project, tool) order moved deserves a human's eye either way.
 */
describe("the lookup lines compare each column against the value it was handed", () => {
  /**
   * The positions the pins below rest on, asserted once and by SHAPE rather than by name: four
   * parameters, all distinct. Without this, a read that lost a parameter would compare
   * `undefined` against `undefined` and every value pin would pass on nothing at all.
   */
  it("is handed the client, the caller, the project and the tool", () => {
    expect(PARAMS).toHaveLength(4);
    expect(new Set(PARAMS).size).toBe(4);
  });

  it("filters user_id on the caller it was handed, not another id in scope", () => {
    expect(FILTERS.get("user_id")).toBe(PARAMS[1]);
  });

  it("filters project_id on the project it was handed", () => {
    expect(FILTERS.get("project_id")).toBe(PARAMS[2]);
  });

  it("filters tool on the tool it was handed", () => {
    expect(FILTERS.get("tool")).toBe(PARAMS[3]);
  });
});

describe("the lookup lines' read fails visibly rather than emptying the card", () => {
  /**
   * `.maybeSingle()`, and EXACTLY it. Dropped, `data` comes back as an ARRAY and the
   * `as unknown as DomainLookupRunRow | null` cast swallows the difference whole: truthy object,
   * every field `undefined`, and the line falls back to its never-run copy on a project whose row
   * was fetched successfully. `.single()` is the other wrong answer — it ERRORS on zero rows, and
   * zero rows is the NORMAL state here (0027's commonest call is a bare competitor target), so it
   * would turn "this tool has not run for this domain" into a thrown page.
   */
  it("asks for one row with the forgiving single-row terminator", () => {
    expect(singleRowTerminatorsOf(READ)).toEqual(["maybeSingle"]);
  });

  /**
   * A FAILED READ THROWS — the repo's deliberate choice over degrading, stated in `page.tsx`'s own
   * doc comments and in `lookups.ts`: a card that silently prints "not run" because the database
   * blipped is worse than a visible failure, because the user acts on it. Swapping the throw for
   * `return null` is invisible to every other spec in this suite, so the branch is pinned by what
   * it DOES — it raises, it does not return, and it carries the driver's own message so the failure
   * can be diagnosed — rather than by matching the word `throw` somewhere in the body.
   */
  it("throws on a failed lookup and never returns a degraded row", () => {
    const branch = errorBranchOf(READ, WHAT);
    expect(branch).toMatch(/throw\s+new\s+Error\(/);
    expect(branch).not.toMatch(/\breturn\b/);
    expect(branch).toMatch(/error\.message/);
  });
});

/**
 * …AND THE ROWS REACH THE CARD. `ProjectCardInput.lookupRuns` is OPTIONAL — deliberately, so the
 * card builder's own specs can omit it — which is exactly why `cardInputFor` can fetch all three
 * lookups, pay for the round trips, and hand back `lookupRuns: undefined` with `tsc` and every
 * spec here still green. The fan-out pin above watches the fan-out's OWN body; this watches its
 * CALLER consuming it.
 *
 * Pinned as a relationship — the binding the `latestDomainLookupRuns` call lands in must be the
 * expression the `lookupRuns` property holds — so renaming the binding costs nothing, while
 * dropping it, or swapping it with the discovery binding beside it, reddens. The property KEY is
 * spelled, because it is the contract with `ProjectCardInput` rather than a local choice.
 *
 * WHAT THIS STILL CANNOT SEE: that the rows then render. vitest has no RSC boundary, so nothing
 * executes this page (signed lesson 12); `lookup-lines.test.tsx` proves the builder and the lines
 * given rows, this proves the page gathers them, and no spec in the fast lane joins the two.
 */
describe("the lookup runs reach the card the page builds", () => {
  it("keeps the fetched lookup runs on the card input", () => {
    const binding = fanOutBindingsOf(CARD_INPUT, "cardInputFor").get("latestDomainLookupRuns");
    expect(binding, "cardInputFor no longer calls latestDomainLookupRuns at all").toBeDefined();
    expect(returnPropsOf(CARD_INPUT, "cardInputFor").get("lookupRuns")).toBe(binding);
  });
});
