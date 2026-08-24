import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { DEVICE_MEANS, type SerpDevice } from "../dfs/serp.ts";
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

describe("the tool touches no vendor and no ledger", () => {
  it("makes no network call of any kind", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { tool } = makeTool();
    await tool.run(ctx, ask());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
