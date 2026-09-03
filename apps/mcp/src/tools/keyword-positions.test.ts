import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { PAID_BALANCE_TOOLS } from "../credits/paid-balance.ts";
import {
  AMBIGUOUS_SUBJECT_MESSAGE,
  NO_SUBJECT_MESSAGE,
  projectNotFoundMessage,
  type ProjectRef,
} from "./project-target.ts";
import type {
  MeasurementFilter,
  StoredMeasurement,
  StoredReportSummary,
} from "./keyword-positions-store.ts";
import {
  GAP_SENTENCE,
  MAX_CONTIGUOUS_GAP_HOURS,
  formatKeywordPositions,
  groupIntoSeries,
  renderInterval,
} from "./keyword-positions-format.ts";
import { makeKeywordPositionsTool, normalizeKeywordFilter } from "./keyword-positions.ts";
import { AI_FAN_OUT_NOTE } from "./serp-features.ts";

const ctx: AuthContext = { userId: "user-1", keyId: "key-1" };
const project: ProjectRef = { id: "p-1", domain: "example.com", archivedAt: null };

/** Words that assert a PATH between two observations. None may appear in any answer. */
const TREND_WORDS =
  /\b(trend|trending|decline|declined|declining|drop|dropped|dropping|fell|falling|rose|rising|improv\w*|worsen\w*|gain\w*|loss|losing|slipp\w*|climb\w*)\b/i;

function reading(over: Partial<StoredMeasurement> = {}): StoredMeasurement {
  return {
    keyword: "seo tools",
    targetDomain: "example.com",
    locationName: "United States",
    languageCode: "en",
    device: "desktop",
    searchEngine: "google",
    depthRequested: 100,
    domainMatchRule: "exact_host_www_stripped",
    status: "ranked",
    bestRankGroup: 4,
    bestRankAbsolute: 6,
    organicItemsExamined: 100,
    notMeasuredReason: null,
    vendorReportedTimeField: "datetime",
    vendorReportedTimeValue: "2026-08-20 04:00:00 +00:00",
    fetchedAt: "2026-08-20T04:00:00.000Z",
    // DEFAULTED TO "NOT RECORDED" RATHER THAN OMITTED. A missing key would be silently allowed
    // here — spreading a `Partial<T>` relaxes TypeScript's completeness check — and every spec
    // below would then run against a row shape the reader never produces (signed lesson 12: a
    // double more permissive than the runtime turns a missing case into a passing test).
    report: null,
    ...over,
  };
}

/** A `report` in the shape `readStoredReport` hands back for a row `serp_snapshot` wrote. */
function report(url: string | null, itemTypes: readonly string[]): StoredReportSummary {
  return { rankedUrl: url, itemTypes };
}

function makeTool(options: {
  readonly project?: ProjectRef | null;
  readonly stored?: number;
  readonly rows?: readonly StoredMeasurement[];
} = {}) {
  const counts: MeasurementFilter[] = [];
  const loads: { filter: MeasurementFilter; limit: number }[] = [];
  const tool = makeKeywordPositionsTool({
    loadProject: async (userId, projectId) => {
      expect(userId).toBe(ctx.userId);
      const resolved = options.project === undefined ? project : options.project;
      return resolved === null ? null : { ...resolved, id: projectId };
    },
    countMeasurements: async (userId, filter) => {
      expect(userId).toBe(ctx.userId);
      counts.push(filter);
      return options.stored ?? (options.rows?.length ?? 0);
    },
    loadMeasurements: async (userId, filter, limit) => {
      expect(userId).toBe(ctx.userId);
      loads.push({ filter, limit });
      return options.rows ?? [];
    },
  });
  return { tool, counts, loads };
}

const ask = (over: Record<string, unknown> = {}) => ({
  project_id: "11111111-1111-4111-8111-111111111111",
  ...over,
});

const textOf = (result: { content: { text: string }[] }) => result.content[0]?.text ?? "";

describe("keyword_positions is priced for the analysis, not for a vendor call", () => {
  it("is the SIGNED 10 credits", () => {
    expect(TOOL_COSTS.keyword_positions).toBe(10);
  });

  /**
   * It reads STORED rows and spends nothing, so it must NOT sit on the paid-balance gate — that
   * list is the vendor-spend surface, and putting a spend-free tool on it would deny trial users a
   * tool for a risk it does not carry. paid-balance.graph.test.ts derives the other direction (a
   * tool that CAN spend and is missing); this pins the direction that spec cannot see.
   */
  it("is NOT behind the paid-balance gate, because it cannot spend", () => {
    expect(PAID_BALANCE_TOOLS.has("keyword_positions")).toBe(false);
    expect(PAID_BALANCE_TOOLS.has("track_keywords")).toBe(false);
  });

  it("settles itself so a refusal is free (charge is the handler's, not the registry's)", () => {
    const { tool } = makeTool();
    expect(tool.charge).toBe("handler");
  });
});

describe("refusals cost nothing and read nothing", () => {
  it("refuses when nothing has been measured — WITHOUT reading a single row", async () => {
    const { tool, counts, loads } = makeTool({ stored: 0 });
    const result = await tool.run(ctx, ask());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/you were not charged/i);
    expect(counts).toHaveLength(1);
    // The count is the gate. If the window were read first, the "free" claim would be a claim
    // about work already done.
    expect(loads).toHaveLength(0);
  });

  /**
   * F-3 — THE REFUSAL HAS TO NAME THE STEP THAT IS ACTUALLY MISSING. Until 2026-09-03 it named
   * only `track_keywords`, and the live audit walked the loop that produces: keywords were
   * registered, the read was run again, and it refused in exactly the same words. The step that
   * fills this store is `serp_snapshot`, and it is PRICED — a refusal that sends a caller to a
   * free tool which changes nothing is worse than one that names no tool at all.
   */
  it("names serp_snapshot as the missing step, and says it is the priced one", async () => {
    const { tool } = makeTool({ stored: 0 });
    const text = textOf(await tool.run(ctx, ask()));
    expect(text).toMatch(/serp_snapshot is what takes the readings, priced per keyword/i);
    // track_keywords keeps its place — as the SEPARATE, free step it is, not as the fix.
    expect(text).toMatch(/track_keywords records which keywords to watch — a separate step, and free/i);
    // The three tools, in the order a caller has to run them.
    const order = ["track_keywords", "serp_snapshot", "keyword_positions"].map((tool) =>
      text.indexOf(tool),
    );
    expect(order.every((at) => at >= 0), text).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("says which filter the emptiness is about when one was applied", async () => {
    const { tool } = makeTool({ stored: 0 });
    const plain = textOf(await tool.run(ctx, ask()));
    const filtered = textOf(await tool.run(ctx, ask({ device: "mobile" })));
    expect(plain).not.toMatch(/you filtered on/);
    expect(filtered).toMatch(/measurements may exist for this domain under a different one/);
  });

  it("refuses an unknown project exactly as it refuses another tenant's", async () => {
    const { tool, counts } = makeTool({ project: null });
    const input = ask();
    expect(textOf(await tool.run(ctx, input))).toBe(projectNotFoundMessage(input.project_id));
    expect(counts).toHaveLength(0);
  });

  it("refuses naming both or neither subject", async () => {
    const { tool } = makeTool();
    expect(textOf(await tool.run(ctx, { target: "a.test", project_id: ask().project_id }))).toBe(
      AMBIGUOUS_SUBJECT_MESSAGE,
    );
    expect(textOf(await tool.run(ctx, {}))).toBe(NO_SUBJECT_MESSAGE);
  });
});

describe("the read is tenant-scoped and asks for what the caller asked for", () => {
  it("normalizes the keyword filter the same way storage stores it", () => {
    expect(normalizeKeywordFilter("  SEO   Tools ")).toBe("seo tools");
  });

  /**
   * Asserted on the COUNT query, which is the one that runs BEFORE the credit reserve — the fast
   * lane cannot reach the priced read without a ledger (keyword-positions.db.test.ts drives that
   * half against a real stack). The two queries take the SAME filter object, and the DB lane
   * checks the rows that come back from it.
   */
  it("passes the resolved domain and the normalized filter to the pre-reserve query", async () => {
    const { tool, counts } = makeTool({ stored: 0 });
    await tool.run(ctx, ask({ keyword: "SEO Tools", device: "desktop", limit: 7 }));
    expect(counts[0]).toEqual({
      targetDomain: "example.com",
      keyword: "seo tools",
      locationName: undefined,
      languageCode: undefined,
      device: "desktop",
    });
  });

  it("makes no network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tool } = makeTool({ stored: 0 });
    await tool.run(ctx, ask());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("the window and the whole set are two different numbers", () => {
  /**
   * The total comes from its own COUNT query and is NEVER rows.length. Fed three rows and a stored
   * count of 57, the answer must print both — a spec that fed a matching pair would pass equally
   * well against an implementation that had thrown the count away.
   */
  it("prints the window count and the stored count separately", () => {
    const text = formatKeywordPositions("x", "", {
      windowLimit: 3,
      windowRowCount: 3,
      storedMeasurementCount: 57,
      rows: [
        reading({ fetchedAt: "2026-08-20T04:00:00.000Z" }),
        reading({ fetchedAt: "2026-08-19T04:00:00.000Z", bestRankGroup: 5 }),
        reading({ fetchedAt: "2026-08-18T04:00:00.000Z", bestRankGroup: 6 }),
      ],
    });
    expect(text).toMatch(/3 readings in this window \(limit 3, newest first\)/);
    expect(text).toMatch(/57 readings match this filter in total/);
    expect(text).toMatch(/this window is the newest slice of that set/);
  });

  it("does not call the window a slice when it holds everything stored", () => {
    const text = formatKeywordPositions("x", "", {
      windowLimit: 50,
      windowRowCount: 1,
      storedMeasurementCount: 1,
      rows: [reading()],
    });
    expect(text).toMatch(/1 reading match this filter in total/);
    expect(text).not.toMatch(/newest slice of that set/);
  });
});

describe("the three outcomes stay three, all the way to the page", () => {
  const window = {
    windowLimit: 10,
    windowRowCount: 3,
    storedMeasurementCount: 3,
    rows: [
      reading({ fetchedAt: "2026-08-20T04:00:00.000Z" }),
      reading({
        fetchedAt: "2026-08-19T04:00:00.000Z",
        status: "absent_from_examined_results",
        bestRankGroup: null,
        bestRankAbsolute: null,
        organicItemsExamined: 87,
      }),
      reading({
        fetchedAt: "2026-08-18T04:00:00.000Z",
        status: "not_measured",
        bestRankGroup: null,
        bestRankAbsolute: null,
        organicItemsExamined: null,
        notMeasuredReason: "DataForSEO task failed",
      }),
    ],
  };

  it("prints a rank, an absence and a non-measurement as three different sentences", () => {
    const text = formatKeywordPositions("your project \"example.com\"", "", window);
    expect(text).toMatch(/rank_group #4 \(rank_absolute 6\), of 100 organic result\(s\) examined/);
    expect(text).toMatch(/not found among the 87 organic result\(s\) examined/);
    expect(text).toMatch(/NOT MEASURED: DataForSEO task failed/);
    // The absence names its scope and refuses to be read as position 0.
    expect(text).toMatch(/not position 0/);
    // The non-measurement refuses to be read as an absence.
    expect(text).toMatch(/not a statement that the domain is absent/);
  });

  it("prints 'found, rank not reported' for a ranked reading the vendor gave no rank", () => {
    const text = formatKeywordPositions("x", "", {
      ...window,
      windowRowCount: 1,
      storedMeasurementCount: 1,
      rows: [reading({ bestRankGroup: null, bestRankAbsolute: null })],
    });
    expect(text).toMatch(/found, but DataForSEO reported no rank/);
    expect(text).not.toMatch(/#null|#0\b/);
  });

  /**
   * THE TWO VENDOR SCALES ARE NOT ONE FACT. `rank_group` (organic-only) and `rank_absolute` (all
   * SERP elements) are independent vendor fields and either may be absent — migration 0030 says in
   * its own words why no CHECK can refuse the pair (group null, absolute set) and why the honesty
   * of that row is therefore the RENDERER's duty. Before this branch existed, this row printed
   * "DataForSEO reported no rank for the placement" over a rank DataForSEO had in fact reported.
   */
  it("names the scale the vendor DID report when only rank_group is missing", () => {
    const text = formatKeywordPositions("x", "", {
      ...window,
      windowRowCount: 1,
      storedMeasurementCount: 1,
      rows: [reading({ bestRankGroup: null, bestRankAbsolute: 7 })],
    });
    expect(text).toMatch(/reported rank_absolute 7 \(its rank among ALL SERP elements\) but no rank_group/);
    // The false sentence this branch replaced, pinned as ABSENT on exactly the row that used to
    // print it.
    expect(text).not.toMatch(/reported no rank/);
    // …and the absolute is REPORTED, never promoted into an organic position.
    expect(text).toMatch(/ORGANIC position is not stated/);
    expect(text).not.toMatch(/#7|rank_group #/);
  });

  it("says NEITHER scale was reported only when neither was", () => {
    const text = formatKeywordPositions("x", "", {
      ...window,
      windowRowCount: 1,
      storedMeasurementCount: 1,
      rows: [reading({ bestRankGroup: null, bestRankAbsolute: null })],
    });
    expect(text).toMatch(/on either of its two scales/);
    expect(text).toMatch(/no rank_group \(organic-only\) and no rank_absolute \(all SERP elements\)/);
    // No number is invented for a row that carries none.
    expect(text).not.toMatch(/rank_absolute \d/);
  });

  it("keeps the vendor's clock and ours apart on every reading", () => {
    const text = formatKeywordPositions("x", "", window);
    expect(text).toMatch(/DataForSEO reported datetime "2026-08-20 04:00:00 \+00:00"/);
    expect(text).toMatch(/the time above is SeoGrep's own clock/);
    const silent = formatKeywordPositions("x", "", {
      ...window,
      windowRowCount: 1,
      storedMeasurementCount: 1,
      rows: [reading({ vendorReportedTimeField: null, vendorReportedTimeValue: null })],
    });
    expect(silent).toMatch(/DataForSEO did not report when it measured/);
  });
});

describe("a gap in the series is not a decline", () => {
  const older = reading({ fetchedAt: "2026-07-20T04:00:00.000Z", bestRankGroup: 7 });
  const newer = reading({ fetchedAt: "2026-08-20T04:00:00.000Z", bestRankGroup: 4 });

  it("states the gap in words when two readings are far apart", () => {
    const line = renderInterval(newer, older);
    expect(line).toContain("31 days apart");
    expect(line).toContain(GAP_SENTENCE);
    expect(line).toMatch(/#7 → #4/);
  });

  it("…and the whole answer never claims a direction of travel", () => {
    const text = formatKeywordPositions("x", "", {
      windowLimit: 10,
      windowRowCount: 2,
      storedMeasurementCount: 2,
      rows: [newer, older],
    });
    expect(text).toContain(GAP_SENTENCE);
    // The gap sentence is the ONE place the word "trend" may appear, and it appears there to
    // DENY one. Removing it before the scan is what makes this assertion about the rest of the
    // answer rather than about its own disclaimer.
    expect(text.split(GAP_SENTENCE).join(" ")).not.toMatch(TREND_WORDS);
  });

  it("does not cry gap for two readings inside the contiguous window", () => {
    const close = reading({
      fetchedAt: "2026-08-20T00:00:00.000Z",
      bestRankGroup: 5,
    });
    const line = renderInterval(newer, close);
    expect(line).toContain("4 hours apart");
    expect(line).not.toContain(GAP_SENTENCE);
    expect(MAX_CONTIGUOUS_GAP_HOURS).toBe(24);
  });

  it("never subtracts across a reading that has no position", () => {
    const absent = reading({
      fetchedAt: "2026-08-19T04:00:00.000Z",
      status: "absent_from_examined_results",
      bestRankGroup: null,
      bestRankAbsolute: null,
      organicItemsExamined: 87,
    });
    const line = renderInterval(newer, absent);
    expect(line).toMatch(/No position change can be stated/);
    expect(line).not.toMatch(/→/);
  });

  it("never compares across a reading that was never taken", () => {
    const unmeasured = reading({
      fetchedAt: "2026-08-19T04:00:00.000Z",
      status: "not_measured",
      bestRankGroup: null,
      bestRankAbsolute: null,
      organicItemsExamined: null,
      notMeasuredReason: "timeout",
    });
    const line = renderInterval(newer, unmeasured);
    expect(line).toMatch(/nothing to compare across it/);
    expect(line).not.toMatch(/→/);
  });

  it("does not compare two ranked readings when one carries no vendor rank", () => {
    const line = renderInterval(newer, reading({ bestRankGroup: null }));
    expect(line).toMatch(/no pair of positions to compare/);
    expect(line).not.toMatch(/→/);
  });

  /**
   * The same false sentence, on the interval line: a reading with a rank_absolute and no
   * rank_group does not "carry no vendor rank". What is missing is the SCALE the comparison runs
   * on, and the other scale is still not substituted — subtracting a rank_absolute from a
   * rank_group would invent a movement on a scale neither reading was measured against.
   */
  it("names rank_group as the missing scale rather than claiming no rank was reported", () => {
    const line = renderInterval(newer, reading({ bestRankGroup: null, bestRankAbsolute: 7 }));
    expect(line).toMatch(/carries no rank_group/);
    expect(line).toMatch(/rank_absolute is a different scale, never subtracted from a rank_group/);
    expect(line).not.toMatch(/carries no vendor rank/);
    expect(line).not.toMatch(/→/);
    expect(line).not.toMatch(/#7/);
  });

  it("always says how far apart two readings are, even a comparable pair", () => {
    expect(renderInterval(newer, reading({ fetchedAt: "2026-08-20T02:00:00.000Z" }))).toMatch(
      /2 hours apart/,
    );
  });
});

describe("two readings are the same series only if everything they were measured under matches", () => {
  it("splits by keyword, locale, device — and by DEPTH, which the caller never chose", () => {
    const rows = [
      reading(),
      reading({ device: "mobile" }),
      reading({ locationName: "United Kingdom" }),
      reading({ languageCode: "de" }),
      reading({ keyword: "seo software" }),
      // A re-priced depth forks the series: "not in the 10 examined" and "not in the 100
      // examined" are answers to different questions, and one line through both would read a
      // pricing change as a movement.
      reading({ depthRequested: 10 }),
      reading({ searchEngine: "bing" }),
      reading({ domainMatchRule: "host_or_subdomain" }),
    ];
    expect(groupIntoSeries(rows)).toHaveLength(8);
  });

  /**
   * THE SEPARATOR IS LOAD-BEARING. Two of the key's parts can contain spaces, so a space-joined
   * key merges these two DIFFERENT identities into one series — and the merge is invisible: they
   * would be printed under one heading with a movement between them that was never measured.
   */
  it("does not let a keyword with spaces forge a series boundary", () => {
    const rows = [
      reading({ keyword: "seo tools United", locationName: "States" }),
      reading({ keyword: "seo tools", locationName: "United States" }),
    ];
    expect(groupIntoSeries(rows)).toHaveLength(2);
  });

  it("keeps one identity's readings together, newest first", () => {
    const rows = [
      reading({ fetchedAt: "2026-08-20T04:00:00.000Z" }),
      reading({ fetchedAt: "2026-08-19T04:00:00.000Z" }),
    ];
    const series = groupIntoSeries(rows);
    expect(series).toHaveLength(1);
    expect(series[0]?.rows.map((row) => row.fetchedAt)).toEqual([
      "2026-08-20T04:00:00.000Z",
      "2026-08-19T04:00:00.000Z",
    ]);
  });

  it("prints what each series was measured under, on its own heading", () => {
    const text = formatKeywordPositions("x", "", {
      windowLimit: 10,
      windowRowCount: 1,
      storedMeasurementCount: 1,
      rows: [reading()],
    });
    expect(text).toMatch(
      /"seo tools" on example\.com — United States · language en · desktop SERP · google · depth 100 · matched by exact_host_www_stripped/,
    );
  });

  /**
   * F-4 / R-7.11 — TWO DIFFERENT "POSITIONS" IN ONE PRODUCT, and until 2026-09-03 no surface said
   * so. This tool prints a SERP rank from one moment (`rank_group #4`, an integer); find_quick_wins
   * prints Search Console's average over the reporting window (`position 12.3`, a decimal). Neither
   * mentioned the other, so the two numbers could be read side by side as a movement that nobody
   * measured. The distinction is stated where the numbers are — in the answer itself and in the
   * description an LLM reads before choosing the tool.
   */
  it("says these ranks are not Search Console's average position", () => {
    const text = formatKeywordPositions("x", "", {
      windowLimit: 10,
      windowRowCount: 1,
      storedMeasurementCount: 1,
      rows: [reading()],
    });
    expect(text).toMatch(/SERP ranks from a snapshot/i);
    expect(text).toMatch(/rank #4 = the fourth organic result/i);
    expect(text).toMatch(/not Search Console's average position/i);
  });

  it("draws the same distinction in the description, where the tool is chosen", () => {
    const { tool } = makeTool();
    expect(tool.description).toMatch(/not Search Console's average position/i);
    expect(tool.description).toMatch(/SERP ranks? (from|at) one moment/i);
  });

  it("says plainly that nothing was measured for this answer", () => {
    const text = formatKeywordPositions("x", "", {
      windowLimit: 10,
      windowRowCount: 1,
      storedMeasurementCount: 1,
      rows: [reading()],
    });
    expect(text).toMatch(/no search engine was contacted for this answer/i);
    expect(text).toMatch(/SeoGrep computes no score/i);
  });
});

/**
 * S-1 (inherited as `keyword_positions` F-5) — THE PAID READ CAN NOW SAY WHICH PAGE RANKED.
 *
 * `serp_snapshot` bought the ranking URL and DataForSEO's page-level `item_types`, wrote both into
 * the row's `report` jsonb, and this reader did not project the column. So a 10-credit read said
 * `rank_group #4` without saying #4 of WHAT, and the AI Overview flag the product had paid for was
 * visible on no surface at all (R-5.5 / R-8.4 / R-8.5).
 */
describe("what the stored report adds to a reading (S-1)", () => {
  const windowOf = (rows: readonly StoredMeasurement[]) =>
    formatKeywordPositions("x", "", {
      windowLimit: 10,
      windowRowCount: rows.length,
      storedMeasurementCount: rows.length,
      rows,
    });

  it("prints the URL that ranked, beside the rank it belongs to", () => {
    const text = windowOf([
      reading({ report: report("https://example.com/tools", ["organic"]) }),
    ]);
    expect(text).toContain("https://example.com/tools");
  });

  /**
   * The phrase is chosen so the negative branch cannot satisfy it: "AI Overview" on its own is a
   * substring of "No AI Overview reported" too, and asserting on it would pass over a reading
   * this tool said had none (signed lesson 11).
   */
  it("reports an AI Overview the snapshot recorded on that page", () => {
    const text = windowOf([
      reading({ report: report("https://example.com/tools", ["organic", "ai_overview"]) }),
    ]);
    expect(text).toMatch(/AI Overview PRESENT/);
  });

  it("says no AI Overview was reported when the page carried none", () => {
    const text = windowOf([
      reading({ report: report("https://example.com/tools", ["organic", "featured_snippet"]) }),
    ]);
    expect(text).toMatch(/No AI Overview reported/);
    expect(text).not.toMatch(/AI Overview PRESENT/);
    expect(text).toContain("featured_snippet");
  });

  /**
   * THE DONE-WHEN FOR OLD ROWS. Rows written before the URL and the feature list were readable —
   * or whose jsonb this reader cannot parse — say NOT RECORDED. That is not the same claim as
   * "there was no URL and no feature on that page", and the difference is the whole reason the
   * reader returns `null` instead of an empty summary.
   */
  it("says a reading's URL and features were not recorded, rather than inventing an absence", () => {
    const text = windowOf([reading({ report: null })]);
    expect(text).toMatch(/not recorded/i);
    expect(text).not.toMatch(/No AI Overview reported/);
    expect(text).not.toMatch(/SERP features besides organic/);
  });

  /**
   * A NON-MEASUREMENT HAS NO PAGE. Printing a feature summary there would be the collapse the
   * three answers exist to prevent — an absence of knowledge rendered as knowledge of an absence.
   */
  it("adds nothing to a reading that was never taken", () => {
    const text = windowOf([
      reading({
        status: "not_measured",
        notMeasuredReason: "the vendor returned no result",
        bestRankGroup: null,
        bestRankAbsolute: null,
        organicItemsExamined: null,
      }),
    ]);
    expect(text).toContain("NOT MEASURED");
    expect(text).not.toMatch(/SERP features besides organic/);
    expect(text).not.toMatch(/not recorded/i);
  });

  /**
   * An absence still had a PAGE, and what was on it is often the explanation: a SERP where an AI
   * Overview and a featured snippet occupy the top is a different finding from an empty one. So
   * the feature line survives an `absent_from_examined_results` reading; only the URL, which
   * belongs to a placement that does not exist, does not.
   */
  it("keeps the page's features on a reading that found no placement", () => {
    const text = windowOf([
      reading({
        status: "absent_from_examined_results",
        bestRankGroup: null,
        bestRankAbsolute: null,
        report: report(null, ["organic", "ai_overview_table_element"]),
      }),
    ]);
    expect(text).toContain("ai_overview_table_element");
    expect(text).toMatch(/AI Overview PRESENT/);
  });

  /** R-5.5 — the caveat rides with the claim, and appears only where there is one to qualify. */
  it("qualifies an AI Overview claim with the query fan-out it cannot see", () => {
    const withAi = windowOf([reading({ report: report(null, ["organic", "ai_overview"]) })]);
    expect(withAi).toContain(AI_FAN_OUT_NOTE);
    const withoutAi = windowOf([reading({ report: report(null, ["organic"]) })]);
    expect(withoutAi).not.toContain(AI_FAN_OUT_NOTE);
  });
});
