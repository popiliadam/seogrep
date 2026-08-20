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
import type { MeasurementFilter, StoredMeasurement } from "./keyword-positions-store.ts";
import {
  GAP_SENTENCE,
  MAX_CONTIGUOUS_GAP_HOURS,
  formatKeywordPositions,
  groupIntoSeries,
  renderInterval,
} from "./keyword-positions-format.ts";
import { makeKeywordPositionsTool, normalizeKeywordFilter } from "./keyword-positions.ts";

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
    ...over,
  };
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
