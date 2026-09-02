import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { DEVICE_MEANS, type SerpDevice } from "../dfs/serp.ts";
import { checkLocationName } from "../dfs/locations.ts";
import { SERP_DEVICES, type TrackedDevice } from "./serp-devices.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { ARCHIVED_PROJECT_MESSAGE, projectNotFoundMessage, type ProjectRef } from "./project-target.ts";
import {
  MAX_TRACKED_KEYWORDS_PER_PROJECT,
  normalizeKeywordList,
  normalizeTrackedKeyword,
  type TrackedKeywordRow,
} from "./tracked-keywords-store.ts";
import {
  NO_KEYWORDS_MESSAGE,
  classify,
  makeTrackKeywordsTool,
} from "./track-keywords.ts";

/** The tenant this suite speaks as. */
const ctx: AuthContext = { userId: "user-1", keyId: "key-1" };

const project: ProjectRef = { id: "p-1", domain: "example.test", archivedAt: null };

/** The form a Turkish customer types. Measured 2026-08-25: registered free, then cost 13 credits. */
const ACCENTED_LOCATION = "Türkiye";

/** The pre-2022 English name, which is ASCII and still not what the vendor calls that country. */
const RENAMED_LOCATION = "Turkey";

interface Recorded {
  readonly identity: unknown;
  readonly keywords: readonly string[];
}

function makeTool(options: {
  readonly project?: ProjectRef | null;
  readonly known?: readonly TrackedKeywordRow[];
  readonly activeCount?: number;
  readonly written?: number;
  readonly stamped?: readonly string[];
} = {}) {
  const tracked: Recorded[] = [];
  const untracked: Recorded[] = [];
  const reads: Recorded[] = [];
  const counted: string[] = [];
  const tool = makeTrackKeywordsTool({
    loadProject: async (userId, projectId) => {
      expect(userId).toBe(ctx.userId);
      const resolved = options.project === undefined ? project : options.project;
      return resolved === null ? null : { ...resolved, id: projectId };
    },
    loadTracked: async (userId, identity, keywords) => {
      expect(userId).toBe(ctx.userId);
      reads.push({ identity, keywords });
      return options.known ?? [];
    },
    countActive: async (userId, projectId) => {
      expect(userId).toBe(ctx.userId);
      counted.push(projectId);
      return options.activeCount ?? 0;
    },
    track: async (userId, identity, keywords) => {
      expect(userId).toBe(ctx.userId);
      tracked.push({ identity, keywords });
      return options.written ?? keywords.length;
    },
    untrack: async (userId, identity, keywords) => {
      expect(userId).toBe(ctx.userId);
      untracked.push({ identity, keywords });
      return options.stamped ?? keywords;
    },
  });
  return { tool, tracked, untracked, reads, counted };
}

const ask = (over: Record<string, unknown> = {}) => ({
  project_id: "11111111-1111-4111-8111-111111111111",
  keywords: ["seo tools"],
  ...over,
});

const textOf = (result: { content: { text: string }[] }) => result.content[0]?.text ?? "";

describe("track_keywords is free and says so", () => {
  it("is priced at the SIGNED 0 and its description says so", () => {
    expect(TOOL_COSTS.track_keywords).toBe(0);
    const { tool } = makeTool();
    expect(tool.description).toMatch(/costs 0 credits/i);
  });

  it("promises no measurement — the confusion a free registration tool invites", async () => {
    const { tool } = makeTool();
    const result = await tool.run(ctx, ask());
    expect(textOf(result)).toMatch(/takes no measurement/i);
    expect(textOf(result)).toMatch(/No search engine was contacted/i);
  });
});

/**
 * THE DEVICE LIST IS BOUND TO THE PORT HERE, in a spec, and deliberately not by an import in the
 * shipped module: a VALUE import from dfs/serp.ts drags the rank-tracker surfaces into the
 * vendor-spend import graph (paid-balance.graph.test.ts refuses exactly that). A test file is
 * outside that scanner, so this is where the two are pinned equal.
 */
describe("the offered devices are the port's own", () => {
  it("offers exactly the devices the SERP port measures", () => {
    expect([...SERP_DEVICES].sort()).toEqual(Object.keys(DEVICE_MEANS).sort());
  });

  it("…and every offered device is a SerpDevice at the type level", () => {
    const devices = SERP_DEVICES satisfies readonly SerpDevice[];
    const asPortType: readonly SerpDevice[] = devices;
    const asLocalType: readonly TrackedDevice[] = devices;
    expect(asPortType).toEqual(asLocalType);
  });
});

describe("what a keyword becomes on the way in", () => {
  it("trims, collapses internal whitespace and folds case", () => {
    expect(normalizeTrackedKeyword("  SEO   Tools ")).toBe("seo tools");
    expect(normalizeTrackedKeyword("Seo\tTools")).toBe("seo tools");
  });

  it("folds duplicates, drops blanks and keeps the caller's order", () => {
    expect(normalizeKeywordList(["B", "  ", "a", "b", "", "A "])).toEqual(["b", "a"]);
  });

  it("classifies against storage: never seen / archived / already watched", () => {
    const known: TrackedKeywordRow[] = [
      { keyword: "b", untrackedAt: null },
      { keyword: "c", untrackedAt: "2026-08-01T00:00:00.000Z" },
    ];
    expect(classify(["a", "b", "c"], known)).toEqual({
      created: ["a"],
      revived: ["c"],
      unchanged: ["b"],
    });
  });
});

describe("track_keywords refuses before it writes", () => {
  it("answers an unknown project exactly as it answers another tenant's", async () => {
    const { tool, tracked } = makeTool({ project: null });
    const input = ask();
    const result = await tool.run(ctx, input);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(projectNotFoundMessage(input.project_id));
    expect(tracked).toHaveLength(0);
  });

  it("refuses an archived project with the ONE archived sentence", async () => {
    const { tool, tracked } = makeTool({
      project: { ...project, archivedAt: "2026-08-01T00:00:00.000Z" },
    });
    const result = await tool.run(ctx, ask());
    expect(textOf(result)).toBe(ARCHIVED_PROJECT_MESSAGE);
    expect(tracked).toHaveLength(0);
  });

  it("refuses a list that is blank once trimmed, without writing", async () => {
    const { tool, tracked } = makeTool();
    const result = await tool.run(ctx, ask({ keywords: [" ", "\t"] }));
    expect(textOf(result)).toBe(NO_KEYWORDS_MESSAGE);
    expect(tracked).toHaveLength(0);
  });
});

describe("registration is idempotent, and carries its locale and device", () => {
  it("passes the FULL identity to storage — not just the keyword", async () => {
    const { tool, tracked } = makeTool();
    const input = ask({
      keywords: ["SEO Tools"],
      location_name: "United Kingdom",
      language_code: "en",
      device: "mobile",
    });
    await tool.run(ctx, input);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toEqual({
      identity: {
        projectId: input.project_id,
        locationName: "United Kingdom",
        languageCode: "en",
        device: "mobile",
      },
      // Stored normalized: the caller typed "SEO Tools".
      keywords: ["seo tools"],
    });
  });

  it("reports an already-tracked keyword as a SUCCESS, not an error", async () => {
    const { tool } = makeTool({ known: [{ keyword: "seo tools", untrackedAt: null }] });
    const result = await tool.run(ctx, ask());
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toMatch(/Already tracked, unchanged: "seo tools"/);
    expect(textOf(result)).not.toMatch(/Newly tracked/);
  });

  it("names a re-tracked keyword as a revival rather than a new one", async () => {
    const { tool } = makeTool({
      known: [{ keyword: "seo tools", untrackedAt: "2026-08-01T00:00:00.000Z" }],
    });
    expect(textOf(await tool.run(ctx, ask()))).toMatch(/Tracked again .*"seo tools"/);
  });

  it("refuses to claim success when the write landed on fewer rows than it sent", async () => {
    const { tool } = makeTool({ written: 0 });
    const result = await tool.run(ctx, ask());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/landed on 0 rows/);
  });
});

describe("the per-project cap", () => {
  it("refuses when the request would push the project over it, and writes nothing", async () => {
    const { tool, tracked } = makeTool({ activeCount: MAX_TRACKED_KEYWORDS_PER_PROJECT });
    const result = await tool.run(ctx, ask({ keywords: ["a new one"] }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(String(MAX_TRACKED_KEYWORDS_PER_PROJECT));
    expect(textOf(result)).toMatch(/already tracking 100 keywords/);
    expect(tracked).toHaveLength(0);
  });

  /**
   * THE EDGE THE CAP MUST NOT GET WRONG. At the cap, re-running the SAME call adds nothing, so it
   * has to succeed — a cap weighed against the request's whole list instead of what it ADDS would
   * make a project stuck at 100 unable to re-run its own idempotent registration.
   */
  it("does NOT refuse a call at the cap that adds nothing new", async () => {
    const { tool, tracked, counted } = makeTool({
      activeCount: MAX_TRACKED_KEYWORDS_PER_PROJECT,
      known: [{ keyword: "seo tools", untrackedAt: null }],
    });
    const result = await tool.run(ctx, ask());
    expect(result.isError).toBeUndefined();
    expect(tracked).toHaveLength(1);
    // …and the count query is not even asked for, because nothing would be added.
    expect(counted).toHaveLength(0);
  });

  it("counts a REVIVED keyword as an addition — it becomes active again", async () => {
    const { tool, tracked } = makeTool({
      activeCount: MAX_TRACKED_KEYWORDS_PER_PROJECT,
      known: [{ keyword: "seo tools", untrackedAt: "2026-08-01T00:00:00.000Z" }],
    });
    const result = await tool.run(ctx, ask());
    expect(result.isError).toBe(true);
    expect(tracked).toHaveLength(0);
  });

  it("bounds one call at the same number as the project", () => {
    const { tool } = makeTool();
    const schema = tool.inputJsonSchema as {
      properties: { keywords: { maxItems: number } };
    };
    expect(schema.properties.keywords.maxItems).toBe(MAX_TRACKED_KEYWORDS_PER_PROJECT);
  });
});

describe("untracking", () => {
  it("stamps only what was active and reports the other two states apart", async () => {
    const { tool, untracked } = makeTool({
      known: [
        { keyword: "a", untrackedAt: null },
        { keyword: "b", untrackedAt: "2026-08-01T00:00:00.000Z" },
      ],
      stamped: ["a"],
    });
    const result = await tool.run(ctx, ask({ keywords: ["a", "b", "c"], action: "untrack" }));
    expect(untracked).toHaveLength(1);
    expect(textOf(result)).toMatch(/Stopped tracking 1 keyword .*"a"/);
    expect(textOf(result)).toMatch(/Already untracked.*"b"/);
    expect(textOf(result)).toMatch(/there was nothing to stop: "c"/);
  });

  it("promises that measurements survive it", async () => {
    const { tool } = makeTool({ known: [{ keyword: "seo tools", untrackedAt: null }] });
    const result = await tool.run(ctx, ask({ action: "untrack" }));
    expect(textOf(result)).toMatch(/every position already measured for it is kept/i);
  });

  it("never writes a registration when asked to untrack", async () => {
    const { tool, tracked } = makeTool();
    await tool.run(ctx, ask({ action: "untrack" }));
    expect(tracked).toHaveLength(0);
  });
});

/**
 * F-3 — MEASURED 2026-09-02: nothing on the MCP surface could READ what a project tracks.
 * `serp_snapshot` takes its keywords as an argument and `keyword_positions` reads the measurement
 * table, so `tracked_keywords` was written by this tool and read only by the web Rankings page.
 * The tool's own error text admitted it — "run track_keywords with the same list to see what is
 * actually tracked" offered a WRITE call as the way to read.
 *
 * The read lists the project's ACTIVE keywords across EVERY locale and device, not the ones
 * matching this call's defaults. Filtering by the defaults would answer "nothing is tracked" to a
 * tenant whose keywords all sit on `Turkiye · tr` — the confusion the feature exists to end,
 * returning as a new form of itself.
 */
describe('action: "list" reads what is tracked, and writes nothing', () => {
  const ASK_LIST = { project_id: "11111111-1111-4111-8111-111111111111", action: "list" };

  function listOf(
    rows: readonly {
      keyword: string;
      locationName: string;
      languageCode: string;
      device: TrackedDevice;
    }[] = [],
  ) {
    const listed: string[] = [];
    const tool = makeTrackKeywordsTool({
      loadProject: async () => project,
      listActive: async (userId, projectId) => {
        expect(userId).toBe(ctx.userId);
        listed.push(projectId);
        return rows;
      },
      // Every WRITE port throws: a listing that reached one of them fails loudly rather than
      // passing because the recorder happened to stay empty.
      track: async () => {
        throw new Error("fixture: listing must not write");
      },
      untrack: async () => {
        throw new Error("fixture: listing must not write");
      },
      loadTracked: async () => {
        throw new Error("fixture: listing reads the project, not one requested list");
      },
    });
    return { tool, listed };
  }

  it("offers list as a third action on the schema", () => {
    const { tool } = makeTool();
    const schema = tool.inputJsonSchema as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toContain("list");
  });

  it("takes no keywords — listing is not a request about a list", async () => {
    const { tool, listed } = listOf([
      { keyword: "adstark", locationName: "Turkiye", languageCode: "tr", device: "desktop" },
    ]);
    const result = await tool.run(ctx, ASK_LIST);
    expect(result.isError).toBeUndefined();
    expect(listed).toEqual([ASK_LIST.project_id]);
    expect(textOf(result)).toContain('"adstark"');
  });

  it("names every locale and device a keyword is watched on", async () => {
    const { tool } = listOf([
      { keyword: "seo tools", locationName: "United States", languageCode: "en", device: "mobile" },
      { keyword: "adstark", locationName: "Turkiye", languageCode: "tr", device: "desktop" },
    ]);
    const text = textOf(await tool.run(ctx, ASK_LIST));
    expect(text).toContain("Turkiye · language tr · desktop SERP");
    expect(text).toContain("United States · language en · mobile SERP");
  });

  it("lists keywords tracked on a locale this CALL did not name", async () => {
    const { tool } = listOf([
      { keyword: "adstark", locationName: "Turkiye", languageCode: "tr", device: "desktop" },
    ]);
    const text = textOf(
      await tool.run(ctx, {
        ...ASK_LIST,
        location_name: "United States",
        language_code: "en",
        device: "desktop",
      }),
    );
    expect(text).toContain('"adstark"');
  });

  it("answers a project that tracks nothing without pretending it failed", async () => {
    const { tool } = listOf([]);
    const result = await tool.run(ctx, ASK_LIST);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toMatch(/not tracking any keywords/i);
  });

  it("prints a stable order, whatever order the rows arrive in", async () => {
    const rows = [
      { keyword: "b", locationName: "United States", languageCode: "en", device: "desktop" as const },
      { keyword: "a", locationName: "United States", languageCode: "en", device: "desktop" as const },
      { keyword: "c", locationName: "Turkiye", languageCode: "tr", device: "mobile" as const },
    ];
    const forward = textOf(await listOf(rows).tool.run(ctx, ASK_LIST));
    const reversed = textOf(await listOf([...rows].reverse()).tool.run(ctx, ASK_LIST));
    expect(reversed).toBe(forward);
    expect(forward.indexOf('"a"')).toBeLessThan(forward.indexOf('"b"'));
  });

  it("still refuses an unknown project, and reads nothing", async () => {
    const listed: string[] = [];
    const tool = makeTrackKeywordsTool({
      loadProject: async () => null,
      listActive: async (_userId, projectId) => {
        listed.push(projectId);
        return [];
      },
    });
    const result = await tool.run(ctx, ASK_LIST);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(projectNotFoundMessage(ASK_LIST.project_id));
    expect(listed).toHaveLength(0);
  });

  it("still requires keywords for track and for untrack", async () => {
    const { tool, tracked, untracked } = makeTool();
    for (const action of ["track", "untrack"] as const) {
      const result = await tool.run(ctx, { project_id: ASK_LIST.project_id, action });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/invalid input/i);
    }
    expect(tracked).toHaveLength(0);
    expect(untracked).toHaveLength(0);
  });
});

describe("the tool touches no vendor and no ledger", () => {
  /**
   * BOTH PATHS, and the second one is the reason this test grew. Validating the location name
   * against DataForSEO's own list is the one fix here that COULD have been built as a vendor
   * lookup — and a lookup on every registration would end this tool's "no search engine was
   * contacted" promise while adding vendor latency to a free write. The refusal path is exercised
   * here so that a future "just ask the vendor" implementation turns this red instead of shipping.
   */
  it("makes no network call of any kind — on the success path or a refusal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tool } = makeTool();
    await tool.run(ctx, ask());
    await tool.run(ctx, ask({ location_name: ACCENTED_LOCATION }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  /**
   * 0 credits AND registry-owned settlement together are what make "nothing was charged" true:
   * the guard short-circuits a cost of 0 before it opens a reserve, so there is no ledger round
   * trip at all (credits/guard.ts). A price change or a move to self-settling would land here.
   */
  it("is a 0-credit surface tool, so the guard never opens a reserve", () => {
    const { tool } = makeTool();
    expect(TOOL_COSTS.track_keywords).toBe(0);
    expect(tool.charge).toBe("surface");
  });
});

describe("a location name DataForSEO does not know is refused at REGISTRATION", () => {
  it.each([ACCENTED_LOCATION, RENAMED_LOCATION])(
    "refuses %s without reading or writing anything",
    async (typed) => {
      const { tool, tracked, reads } = makeTool();
      const result = await tool.run(ctx, ask({ location_name: typed }));
      expect(result.isError).toBe(true);
      // Nothing was written, and storage was not even asked — the refusal is pure input.
      expect(tracked).toHaveLength(0);
      expect(reads).toHaveLength(0);
    },
  );

  /**
   * THE REFUSAL HAS TO CARRY THE FIX. Asserted as a property rather than against a copy of the
   * string in locations.ts: whatever name the module offers must be one it then ACCEPTS, and it
   * must not be the name that was just refused. A message that merely said "invalid" leaves the
   * customer with the same guess that cost them a paid call.
   */
  it.each([ACCENTED_LOCATION, RENAMED_LOCATION])(
    "hands back a spelling the tool accepts, for %s",
    async (typed) => {
      const suggestion = checkLocationName(typed)?.suggestion ?? "";
      expect(suggestion).not.toBe("");
      expect(suggestion).not.toBe(typed);
      expect(checkLocationName(suggestion)).toBeNull();
      const { tool } = makeTool();
      expect(textOf(await tool.run(ctx, ask({ location_name: typed })))).toContain(suggestion);
    },
  );

  it("accepts the name the refusal offered, and tracks under exactly that name", async () => {
    const suggestion = checkLocationName(ACCENTED_LOCATION)?.suggestion ?? "";
    const { tool, tracked } = makeTool();
    const result = await tool.run(ctx, ask({ location_name: suggestion }));
    expect(result.isError).toBeUndefined();
    expect(tracked[0]?.identity).toMatchObject({ locationName: suggestion });
    expect(textOf(result)).toContain(suggestion);
  });

  it("still accepts a location nobody has measured — this is not an allowlist", async () => {
    const { tool, tracked } = makeTool();
    const result = await tool.run(ctx, ask({ location_name: "United Kingdom" }));
    expect(result.isError).toBeUndefined();
    expect(tracked).toHaveLength(1);
  });
});
