import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { AVERAGE_POSITION_NOTE, findQuickWins, STALE_PULL_DAYS } from "../gsc-data/index.ts";
import type { GscRow, LoadTokenStatusFn, PullData } from "../gsc-data/index.ts";
import { gscRow, pullData, SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import { formatGroupedQuickWins, renderQuickWins } from "./find-quick-wins.ts";
import { makeDiscoveryTool } from "./gsc-discovery-shared.ts";

/**
 * Fast-lane spec for find_quick_wins' provenance line. The charge/refusal behavior is the
 * shared builder's (gsc-discovery.db.test.ts, precondition.test.ts); this pins the ONE thing
 * specific to a loaded pull's rendering: the tool dates the data it just charged the caller
 * for, via the shared gsc-discovery-shared.ts call site (gsc-data/load.ts renderPullProvenance).
 *
 * Built through makeDiscoveryTool directly under a 0-CREDIT name ("get_job_status"), the same
 * trick precondition.test.ts uses, so withCredits short-circuits before opening a DB client —
 * this is a DB-less unit test by construction. The paid "find_quick_wins" name is exercised for
 * real in gsc-discovery.db.test.ts.
 *
 * IT DRIVES THE TOOL'S OWN `renderQuickWins`, and that is a correction rather than a detail: this
 * file used to REBUILD the render from its parts — the engine's rows handed to a FLAT renderer
 * that lived in gsc-data/format.ts, since deleted — while claiming in this very comment to be
 * exercising the real one. A spec that reassembles the
 * expression under test pins its own arithmetic — the tool could have changed renderers under it
 * without a single red line, which is exactly what happened when the grouping defect was fixed.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";
const PULL_JOB_ID = "11112222-3333-4444-5555-666677778888";

/** The web base URL the reconnect link is built from (gscConnectUrl reads it fail-closed). */
const WEB_BASE_URL = "https://app.test.seogrep.example";
let priorWebBaseUrl: string | undefined;

/**
 * THE CLOCK IS FROZEN FOR THIS WHOLE FILE, and that is a correctness fix rather than tidiness.
 *
 * Every fixture here dates its pull at a FIXED instant, but the provenance line the tool prints
 * is computed against `new Date()` — `renderPullProvenance`'s default (gsc-data/load.ts). So the
 * distance between the fixture and the assertion grew by one day every real day, and on
 * 2026-09-05 it crossed STALE_PULL_DAYS: the product correctly began appending its staleness
 * sentence, and the end-anchored footer assertion below went red on a docs-only PR that had
 * touched no code at all. The test was wrong, not the tool — a fixture pinned to the calendar
 * measuring a function that reads the wall clock.
 *
 * Frozen four days after the pull, matching load.test.ts's own NOW, so the file's shared
 * PULLED_AT stays FRESH forever and every spec below keeps the meaning it was written with.
 * Date only (`toFake`), never the timer queue: the tool's path is promises, and faking
 * setTimeout would hang anything that awaited one.
 */
const PULLED_AT = "2026-08-06T09:00:00.000Z";
const FROZEN_NOW = new Date("2026-08-10T09:00:00.000Z");

/** A pull `days` whole days before the frozen now, in the shape `loadPull` hands back. */
function pulledDaysAgo(days: number): string {
  return new Date(FROZEN_NOW.getTime() - days * 86_400_000).toISOString();
}

beforeAll(() => {
  priorWebBaseUrl = process.env.WEB_BASE_URL;
  process.env.WEB_BASE_URL = WEB_BASE_URL;
  vi.useFakeTimers({ now: FROZEN_NOW, toFake: ["Date"] });
});

afterAll(() => {
  vi.useRealTimers();
  if (priorWebBaseUrl === undefined) delete process.env.WEB_BASE_URL;
  else process.env.WEB_BASE_URL = priorWebBaseUrl;
});

function buildFindQuickWins(
  pulledAt: string,
  loadTokenStatus: LoadTokenStatusFn = async () => "active",
  pull: PullData = SAMPLE_PULL,
) {
  return makeDiscoveryTool(
    "get_job_status",
    "d",
    // The REAL render — engine, formatter and stored report, exactly as the paid tool builds it.
    renderQuickWins,
    {
      // The job id is REQUIRED now, and its absence is itself evidence: the real render returns
      // a report, the shared builder fails closed when it has nowhere to point the row, and the
      // rebuilt render this file used to pass never reached that branch at all.
      loadPull: async () => ({ ok: true, pull, pulledAt, jobId: PULL_JOB_ID }),
      // The recorder is on this path for the same reason — stubbed here to keep the lane
      // DB-less. The row itself is measured against a live stack in gsc-discovery-runs.db.test.ts.
      writeRun: async () => undefined,
      loadTokenStatus,
      // The archive gate's project port, stubbed to "this id did not resolve" so this lane stays
      // DB-less (the real reader opens a service client). The gate itself is measured over the
      // real reader, per tool and on the ledger, in gsc-discovery.db.test.ts.
      loadProject: async () => null,
    },
  );
}

describe("find_quick_wins provenance", () => {
  /** The footer's last three lines, which is the shape all of these specs assert on. */
  async function footerOf(pulledAt: string): Promise<string[]> {
    const result = await buildFindQuickWins(pulledAt).run(CTX, { project_id: PROJECT_ID });
    expect(result.isError).toBeUndefined();
    return (result.content[0]?.text ?? "").trimEnd().split("\n");
  }

  it("dates the data it just charged for", async () => {
    const lines = await footerOf(PULLED_AT);

    expect(lines.join("\n")).toContain("Search Console data pulled 2026-08-06");
  });

  /**
   * BOTH SIDES OF THE STALENESS THRESHOLD, and the threshold itself IMPORTED rather than typed
   * out: a spec that spells `30` cannot tell a changed threshold from a changed sentence, and it
   * is the threshold that has already moved once (STALE_PULL_DAYS is an alias now, load.ts).
   * The pair is what makes the position claim load-bearing — the staleness sentence is appended
   * to this same line, so a one-directional assertion pins the footer's shape only in whichever
   * half of the calendar the suite happens to be run in.
   */
  it("ends the footer with the bare dated line while the pull is inside the freshness window", async () => {
    const fresh = pulledDaysAgo(STALE_PULL_DAYS - 1);
    const lines = await footerOf(fresh);

    // Whole-line equality, not a `.+` tail: the absence of the staleness sentence IS the claim.
    expect(lines.at(-1)).toBe(
      `Search Console data pulled ${fresh.slice(0, 10)} (${STALE_PULL_DAYS - 1} days ago).`,
    );
    expect(lines.at(-2)).toMatch(/^Analyzed window: /);
    expect(lines.at(-3)).toBe("");
  });

  it("keeps the line last — now carrying the staleness sentence — once the pull reaches the threshold", async () => {
    const stale = pulledDaysAgo(STALE_PULL_DAYS);
    const lines = await footerOf(stale);

    expect(lines.at(-1)).toBe(
      `Search Console data pulled ${stale.slice(0, 10)} (${STALE_PULL_DAYS} days ago).` +
        " This data is stale — run pull_gsc_data again for current numbers.",
    );
    // The footer's SHAPE is unchanged by the extra sentence: it rides on the provenance line
    // rather than becoming a line of its own, so the window line and the blank line hold.
    expect(lines.at(-2)).toMatch(/^Analyzed window: /);
    expect(lines.at(-3)).toBe("");
  });
});

/**
 * Step 4 of the task: an analysis whose connection is DEAD must say so. Without this line the
 * provenance line above it is worse than silent — "pulled 12 days ago" invites the user to run
 * pull_gsc_data, which is the one thing that cannot work until they re-approve.
 */
describe("find_quick_wins staleness warning", () => {
  it("warns, with the reconnect link, when the stored connection is invalid", async () => {
    const tool = buildFindQuickWins(PULLED_AT, async () => "invalid");

    const result = await tool.run(CTX, { project_id: PROJECT_ID });

    const text = result.content[0]?.text ?? "";
    // The brief's client-visible claim: the dated line AND the warning, both present.
    expect(text).toContain("Search Console data pulled");
    expect(text).toMatch(/connection expired.*cannot be refreshed/i);
    expect(text).toContain(`${WEB_BASE_URL}/api/gsc/connect?project_id=${PROJECT_ID}`);
    // …the findings themselves are still delivered (this is a warning, not a refusal).
    expect(result.isError).toBeUndefined();
    expect(text).toContain("running shoes");
  });

  it("puts the warning AFTER the provenance line, on its own last line", async () => {
    const tool = buildFindQuickWins(PULLED_AT, async () => "invalid");

    const result = await tool.run(CTX, { project_id: PROJECT_ID });

    const lines = (result.content[0]?.text ?? "").trimEnd().split("\n");
    expect(lines.at(-1)).toMatch(/^⚠ Your Google connection expired/);
    expect(lines.at(-2)).toMatch(/^Search Console data pulled/);
  });

  it("stays silent for a live connection and for a project with no connection at all", async () => {
    for (const status of ["active", null] as const) {
      const tool = buildFindQuickWins(PULLED_AT, async () => status);
      const text = (await tool.run(CTX, { project_id: PROJECT_ID })).content[0]?.text ?? "";
      expect(text).not.toMatch(/connection expired/i);
    }
  });

  /**
   * The env-shape half of the same guarantee. With no WEB_BASE_URL there is no honest link, but
   * the user must still learn that the data under their nose cannot be refreshed — losing the
   * whole warning to a deploy variable would delete a fact about their own data (controller
   * ruling; same reasoning as the typed refusal in registry.test.ts).
   */
  it("keeps warning when WEB_BASE_URL is unset — the link goes, the warning stays", async () => {
    const saved = process.env.WEB_BASE_URL;
    delete process.env.WEB_BASE_URL;
    try {
      const tool = buildFindQuickWins(PULLED_AT, async () => "invalid");

      const result = await tool.run(CTX, { project_id: PROJECT_ID });

      const text = result.content[0]?.text ?? "";
      expect(result.isError).toBeUndefined();
      expect(text).toMatch(/connection expired.*cannot be refreshed/i);
      expect(text).toContain("Reconnect it from the Connection page");
      expect(text).not.toContain("undefined/api/gsc/connect");
      expect(text).toContain("running shoes"); // the analysis is untouched
    } finally {
      // Delete-on-undefined, the shape this file's own afterAll and pull-gsc-data.db.test.ts
      // already use. A bare assignment writes the literal string "undefined" when `saved` is
      // undefined — harmless only because beforeAll happens to set the variable, which is a
      // property of the harness, not of this restore.
      if (saved === undefined) delete process.env.WEB_BASE_URL;
      else process.env.WEB_BASE_URL = saved;
    }
  });

  /**
   * The analysis is already complete and about to be charged when the health read runs, so a
   * failure there must cost the caller the WARNING, never the findings they paid for. Throwing
   * would release the reserve and answer a working analysis with "failed unexpectedly" — the
   * exact defect this task removes.
   */
  it("still delivers the analysis when the health read fails — the warning is best-effort", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const tool = buildFindQuickWins(PULLED_AT, async () => {
        throw new Error("gsc connection health lookup failed: connection refused");
      });

      const result = await tool.run(CTX, { project_id: PROJECT_ID });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain("running shoes");
      expect(result.content[0]?.text).not.toMatch(/connection expired/i);
      // Swallowed, but never silent: the operator gets the reason.
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.join(" ")).toContain(PROJECT_ID);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

/**
 * S10b — FIFTY ROWS, SIXTEEN PAGES.
 *
 * Measured on dentnotion.com 2026-08-25. The data is genuinely valuable; the presentation made
 * the customer group it by hand before it meant anything, because the unit of the list was a ROW
 * while the unit of the work is a PAGE — one on-page push serves every query under it.
 */
describe("the quick-win list is grouped by page", () => {
  const CROWDED = "https://shop.test/zirkonyum";
  const SINGLE = "https://shop.test/porselen";
  const WORDS = ["alfa", "beta", "gama", "delta", "epsilon", "zeta", "eta"];

  /**
   * The crowded page's rows are individually SMALLER than the other page's single row (100 down
   * to 94, against 500) and sum to far more (679), so page-total ordering disagrees with
   * biggest-row ordering. Without that disagreement the fixture would pass under either rule.
   */
  const ROWS: GscRow[] = [
    ...WORDS.map((word, index) =>
      gscRow({
        query: `zirkonyum ${word}`,
        page: CROWDED,
        clicks: 1,
        impressions: 100 - index,
        ctr: 0.01,
        position: 12,
      }),
    ),
    gscRow({
      query: "porselen kaplama",
      page: SINGLE,
      clicks: 5,
      impressions: 500,
      ctr: 0.01,
      position: 9,
    }),
  ];

  const CROWDED_PULL: PullData = pullData(ROWS, []);

  async function groupedText(): Promise<string> {
    const tool = buildFindQuickWins(PULLED_AT, async () => "active", CROWDED_PULL);
    const result = await tool.run(CTX, { project_id: PROJECT_ID });
    expect(result.isError).toBeUndefined();
    return result.content[0]?.text ?? "";
  }

  it("prints each page ONCE, not once per query", async () => {
    const text = await groupedText();
    expect(text.split(CROWDED).length - 1).toBe(1);
    expect(text.split(SINGLE).length - 1).toBe(1);
  });

  it("says how many quick wins the page carries and puts them under it", async () => {
    const text = await groupedText();
    expect(text).toMatch(new RegExp(`^• ${CROWDED} — 7 quick-win queries,`, "m"));
    expect(text.match(/^\s+- "zirkonyum /gm)).toHaveLength(5);
  });

  it("counts the queries it did not print instead of printing them", async () => {
    expect(await groupedText()).toMatch(/…and 2 more of this page's queries/);
  });

  /**
   * The page worth opening first is the one carrying the most nearly-won demand IN TOTAL. A
   * row-ordered list would have put /porselen (500 in one row) above /zirkonyum (679 over seven).
   */
  it("orders pages by the demand the PAGE carries, not by its biggest single row", async () => {
    const text = await groupedText();
    expect(text.indexOf(CROWDED)).toBeLessThan(text.indexOf(SINGLE));
  });

  it("headlines the count of PAGES, the unit the reader acts on", async () => {
    expect(await groupedText()).toMatch(/^2 pages with quick-win queries/m);
  });

  /** Every row still carries what a push needs: how close it is, and how much demand is on it. */
  it("keeps position, impressions, clicks and CTR on each query", async () => {
    expect(await groupedText()).toMatch(
      /^\s+- "zirkonyum alfa" — position 12\.0, 100 impressions, 1 clicks, CTR 1\.0%$/m,
    );
  });

  /**
   * THE TWO CAPS ABOVE THE PAGE BLOCKS, both untested until a fresh-context referee said so
   * (2026-08-26): the only "cleared the bands" pins in the repo sat on the flat renderer this
   * tool no longer uses, and the 12-page cap had no pin at all on this side.
   *
   * ONE fixture reaches both, because the engine's own 50-row cap and the renderer's page cap
   * stack: 52 qualifying rows on 52 distinct pages become 50 wins (2 cut by the engine) on 50
   * pages (38 cut by the renderer). Every row that does not reach the reader is counted in one
   * of the two sentences, which is the whole rule.
   */
  it("counts what BOTH caps left out — the pages, and the rows the engine cut", async () => {
    const many: GscRow[] = Array.from({ length: 52 }, (_unused, index) =>
      gscRow({
        query: `zirkonyum ${index}`,
        page: `https://shop.test/p-${index}`,
        clicks: 1,
        impressions: 100 - index,
        ctr: 0.01,
        position: 10,
      }),
    );
    const tool = buildFindQuickWins(
      PULLED_AT,
      async () => "active",
      pullData(many, []),
    );
    const text = (await tool.run(CTX, { project_id: PROJECT_ID })).content[0]?.text ?? "";

    expect(text).toMatch(/^50 pages with quick-win queries/m);
    expect(text.match(/^• https/gm)).toHaveLength(12);
    expect(text).toMatch(/…and 38 more pages with quick wins\./);
    expect(text).toMatch(/…and 2 more cleared the bands\./);
  });

  /** The remainder is never claimed when nothing was cut — a shortlist that IS the answer. */
  it("claims no remainder when neither cap bit", async () => {
    const text = await groupedText();
    expect(text).not.toMatch(/cleared the bands/);
    expect(text).not.toMatch(/more pages with quick wins/);
  });

  it("still says so when there is nothing to report", async () => {
    const empty = pullData([gscRow({ query: "x", page: "https://shop.test/x", position: 2 })], []);
    const tool = buildFindQuickWins(PULLED_AT, async () => "active", empty);
    const result = await tool.run(CTX, { project_id: PROJECT_ID });
    expect(result.content[0]?.text).toContain("No quick wins found");
  });
});

/**
 * THE FLAT RENDERER'S PINS, MOVED ONTO THE LIVE ONE.
 *
 * These six assertions used to sit in gsc-data/format.test.ts on `formatQuickWins`, the flat
 * renderer find_quick_wins stopped calling when it moved to page grouping. That function has now
 * been deleted; the guarantees it carried have not, so they are re-asserted here against
 * `formatGroupedQuickWins` — the renderer `renderQuickWins` actually passes to the tool.
 *
 * FIVE OF THE SIX STILL DISCRIMINATE HERE. The sixth does not, and naming it is the only way this
 * note stays true: "carries the query, its page and its position" pinned the FLAT renderer, where
 * the query line was the only line there was. The grouped renderer prints those same three strings
 * in the page HEADING and again in the recommendation, so the assertion survives the loss of every
 * per-query row — measured 2026-08-26 by emptying `...rows` in `renderQuickWinPage`: it stayed
 * GREEN while exactly two specs went red, both in the block above. Those two are the guarantee's
 * real keepers, and they are named here so nobody has to re-derive them: "keeps position,
 * impressions, clicks and CTR on each query" and "says how many quick wins the page carries and
 * puts them under it". The sixth is kept for what it does still pin — that the three facts reach
 * the reader AT ALL — and it is not evidence about the rows.
 *
 * READ DIRECTLY rather than through the tool, unlike everything else in this file, and
 * deliberately so: `total` is the PRE-CAP count the ENGINE computes, so reaching a remainder of
 * 4,000 through the tool would mean fabricating 4,002 qualifying rows to assert one thousands
 * separator. What makes that acceptable here and not before is the thing that changed — this
 * renderer is production code, so pinning it directly pins what ships. The tool-level half of
 * the same rule ("counts what BOTH caps left out") is above, and it is the half that proves the
 * tool reaches this renderer at all.
 */
describe("the flat renderer's pins, moved onto the live one", () => {
  const wins = findQuickWins(SAMPLE_PULL); // two rows

  it("says so, actionably, when there is nothing to report", () => {
    expect(formatGroupedQuickWins([])).toMatch(/no quick wins/i);
  });

  // Passes on the heading and the recommendation alone — see the block note. The per-query rows
  // are pinned by the two specs it names, not by this one.
  it("carries the query, its page and its position", () => {
    const text = formatGroupedQuickWins(wins);
    expect(text).toContain('"running shoes"');
    expect(text).toContain("https://shop.test/running");
    expect(text).toContain("position 11.2");
  });

  it("names the remaining count when more cleared the bands than were listed", () => {
    expect(formatGroupedQuickWins(wins, 402)).toContain("…and 400 more cleared the bands.");
  });

  it("thousands-separates the remainder rather than printing a bare digit run", () => {
    expect(formatGroupedQuickWins(wins, 4002)).toContain("…and 4,000 more");
  });

  it("says nothing when the list IS the whole answer", () => {
    expect(formatGroupedQuickWins(wins, wins.length)).not.toMatch(/cleared the bands/i);
    expect(formatGroupedQuickWins(wins)).not.toMatch(/cleared the bands/i);
  });

  /** A total SMALLER than the list is a caller bug, not a negative remainder to print. */
  it("prints no remainder when the total is below the list length", () => {
    expect(formatGroupedQuickWins(wins, 1)).not.toMatch(/cleared the bands/i);
  });
});

/**
 * THE RECOMMENDATION LAYER, through the TOOL.
 *
 * This block lives here rather than beside the other formatters because for a while there were
 * TWO quick-win renderers: the page-grouping one the tool prints through, and a flat stand-in in
 * gsc-data/format.ts that nothing in production called. Advice asserted against the stand-in
 * would have been a green suite proving a customer-facing line that never shipped, so it was
 * written against the tool from the start; the stand-in has since been deleted outright. These
 * drive `renderQuickWins`, the real render `makeFindQuickWinsTool` passes, so what is asserted
 * here is what a caller reads.
 *
 * The gap being closed (measured 2026-08-25): the list told the reader which queries were nearly
 * won and never once said what to do about any of them.
 */
describe("each quick-win page carries what to do about it", () => {
  const CROWDED = "https://shop.test/zirkonyum";
  const SINGLE = "https://shop.test/porselen";

  /**
   * The grouping fixture rebuilt locally: one page carrying SEVEN quick wins beside one carrying
   * a single query, so both halves of the widen/tighten split are reachable from one render. The
   * crowded page's rows are individually smaller and collectively larger, which is also what puts
   * it first in the list.
   */
  const MIXED_PULL: PullData = pullData(
    [
      ...["alfa", "beta", "gama", "delta", "epsilon", "zeta", "eta"].map((word, index) =>
        gscRow({
          query: `zirkonyum ${word}`,
          page: CROWDED,
          clicks: 1,
          impressions: 100 - index,
          ctr: 0.01,
          position: 12,
        }),
      ),
      gscRow({
        query: "porselen kaplama",
        page: SINGLE,
        clicks: 5,
        impressions: 500,
        ctr: 0.01,
        position: 9,
      }),
    ],
    [],
  );

  /**
   * The two axes DISAGREE on this page on purpose: its biggest-demand query sits at 19 while its
   * best-positioned one sits at 8. An advice line built from the group's `bestPosition` would
   * name the top-5 band for a query on page two; one that anchored on the closest query instead
   * of the biggest would name the wrong query entirely. Neither is visible on a fixture where
   * every row shares a position.
   */
  const SPLIT = "https://shop.test/split";
  const SPLIT_PULL: PullData = pullData(
    [
      gscRow({ query: "big demand", page: SPLIT, clicks: 4, impressions: 900, ctr: 0.004, position: 19 }),
      gscRow({ query: "close one", page: SPLIT, clicks: 3, impressions: 100, ctr: 0.03, position: 8 }),
    ],
    [],
  );

  async function textFor(pull: PullData): Promise<string> {
    const tool = buildFindQuickWins(PULLED_AT, async () => "active", pull);
    const result = await tool.run(CTX, { project_id: PROJECT_ID });
    expect(result.isError).toBeUndefined();
    return result.content[0]?.text ?? "";
  }

  it("names the page's BIGGEST-DEMAND query, with its own position and impressions", async () => {
    const text = await textFor(SPLIT_PULL);
    expect(text).toContain('→ Push "big demand" (position 19.0, 900 impressions)');
    expect(text).not.toContain('→ Push "close one"');
  });

  /** The band comes from THAT query's position — a page-two query is told to reach page one. */
  it("aims a page-two query at the top 10, not the top 5", async () => {
    expect(await textFor(SPLIT_PULL)).toContain('"big demand" (position 19.0, 900 impressions) into the top 10');
  });

  it("aims a query already on page one at the top 5", async () => {
    const text = await textFor(SAMPLE_PULL);
    // SAMPLE_PULL's only quick win sits at 11.2 — page two.
    expect(text).toContain("into the top 10");

    const onPageOne = pullData(
      [gscRow({ query: "porselen kaplama", page: SINGLE, clicks: 5, impressions: 500, ctr: 0.01, position: 9 })],
      [],
    );
    expect(await textFor(onPageOne)).toContain('"porselen kaplama" (position 9.0, 500 impressions) into the top 5');
  });

  /**
   * A page holding seven near-miss queries and a page holding one are opposite jobs — widen
   * versus tighten — and the query count is the only thing in the data that tells them apart. One
   * sentence serving both would be the boilerplate this layer is not allowed to be.
   */
  it("tells a multi-query page to widen, naming how many queries one pass serves", async () => {
    const text = await textFor(MIXED_PULL);
    expect(text).toMatch(/one on-page pass serves all 7 of this page's quick-win queries/);
    expect(text).toMatch(/widen it/);
  });

  it("tells a single-query page to tighten around that phrase instead", async () => {
    const text = await textFor(MIXED_PULL);
    expect(text).toMatch(/it is this page's only quick-win query, so tighten the page around that phrase/);
    expect(text).not.toMatch(/one on-page pass serves all 1 /);
  });

  /** One recommendation per page printed — not one for the list, and not one per query row. */
  it("gives every printed page exactly one recommendation", async () => {
    const text = await textFor(MIXED_PULL);
    expect(text.match(/^• https/gm)).toHaveLength(2);
    expect(text.match(/^ {4}→ Push /gm)).toHaveLength(2);
  });

  /** It sits UNDER the page's evidence, below even the "…and N more" line. */
  it("puts the recommendation last in the page's block", async () => {
    const lines = (await textFor(MIXED_PULL)).split("\n");
    const moreLine = lines.findIndex((line) => line.includes("more of this page's queries"));
    expect(moreLine).toBeGreaterThan(-1);
    expect(lines[moreLine + 1]).toMatch(/^ {4}→ Push /);
  });

  it("recommends nothing when there is nothing to recommend", async () => {
    const empty = pullData([gscRow({ query: "x", page: "https://shop.test/x", position: 2 })], []);
    const text = await textFor(empty);
    expect(text).toContain("No quick wins found");
    expect(text).not.toContain("→ Push");
  });

  /**
   * B-1a — THE SENTENCE PRINTS A CTR IT NEVER READ. Measured live 2026-09-03: the top
   * recommendation was a page at position 10.6 with 24,864 impressions and 28 clicks (CTR 0.1%),
   * and the tool said "push it into the top 10" in exactly the same words it used for a page in
   * the same band earning five times the click-through. R-7.12 names why those are not the same
   * job: AI Overview impressions are INSIDE these counts while their clicks are not, so a query
   * that is being SHOWN and not clicked may have lost the click on the results page, and moving
   * up two ranks is not what fixes that.
   *
   * THE COMPARISON IS TO THIS REPLY'S OWN DATA, not to a benchmark. No CTR-by-position table
   * exists in the signed reference list (`find_quick_wins` audit §5), so nothing here claims what
   * a position "usually earns"; the sentence names the shortlist's own click-through rate and the
   * page's, and lets the reader see the gap.
   *
   * ORDERING IS UNTOUCHED — B-1b is an unsigned decision. The low-CTR page is still first here,
   * which the last assertion pins so a later reordering cannot be smuggled in through this fix.
   */
  const SHOWN_NOT_CLICKED = "https://shop.test/shown-not-clicked";
  const EARNING = "https://shop.test/earning";
  const CTR_PULL: PullData = pullData(
    [
      gscRow({ query: "big shown", page: SHOWN_NOT_CLICKED, clicks: 28, impressions: 24864, ctr: 28 / 24864, position: 10.6 }),
      gscRow({ query: "small earned", page: EARNING, clicks: 50, impressions: 1000, ctr: 0.05, position: 9 }),
    ],
    [],
  );

  it("tells a page that is being shown and not clicked to look at the results page first", async () => {
    const text = await textFor(CTR_PULL);
    const advice = text.split("\n").filter((line) => line.includes("→ Push "));
    const shown = advice.find((line) => line.includes('"big shown"'));
    expect(shown).toBeDefined();
    expect(shown).toMatch(/CTR 0\.1%/);
    // The comparison figure is the shortlist's own: (28 + 50) / (24,864 + 1,000) = 0.3%.
    expect(shown).toMatch(/0\.3%/);
    expect(shown).toMatch(/results page/i);
  });

  it("says nothing of the kind for a page already earning above the shortlist's rate", async () => {
    const text = await textFor(CTR_PULL);
    const earning = text
      .split("\n")
      .find((line) => line.includes("→ Push ") && line.includes('"small earned"'));
    expect(earning).toBeDefined();
    expect(earning).not.toMatch(/results page/i);
    expect(earning).toMatch(/tighten the page around that phrase/);
  });

  it("leaves the ORDER exactly where it was — this fix changes the sentence, not the ranking", async () => {
    const pages = (await textFor(CTR_PULL)).match(/^• (\S+)/gm);
    expect(pages).toEqual([`• ${SHOWN_NOT_CLICKED}`, `• ${EARNING}`]);
  });

  /**
   * R-7.11 (B-2) — every one of those "position 10.6" figures is an AVERAGE over the pull's whole
   * window, and the band (8–20) is applied to it as though it were a rank. A page that sat 5th for
   * half the window and 16th for the other half reports the same 10.5 as one that never moved, and
   * "push it into the top 10" reads as though half the job were already done.
   *
   * The SAME constant analyze_content_decay prints, deliberately: two tools explaining one number
   * in two hand-written sentences is how the two explanations end up disagreeing.
   */
  it("tells the reader that `position` is a window average", async () => {
    expect(await textFor(SPLIT_PULL)).toContain(AVERAGE_POSITION_NOTE);
  });

  it("says nothing about position when there are no positions to explain", async () => {
    const empty = pullData([gscRow({ query: "x", page: "https://shop.test/x", position: 2 })], []);
    expect(await textFor(empty)).not.toContain(AVERAGE_POSITION_NOTE);
  });
});
