import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ESTIMATED_RANKED_KEYWORDS_CALL_USD,
  RANKED_KEYWORDS_MAX_LIMIT,
  createLiveRankedKeywordsClient,
  createMockRankedKeywordsPort,
  disabledRankedKeywordsPort,
  extractRankedKeywordsCostUsd,
  parseRankedKeywordsResponse,
  resolveDefaultRankedKeywordsPort,
} from "./ranked-keywords.ts";
import type { DfsTransport } from "./client.ts";
import { readTodaySpendUsd } from "./budget.ts";
import fixtureResponse from "./fixtures/ranked-keywords.json";

/**
 * Unit proofs for the DataForSEO Labs ranked-keywords client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path is exercised only with an injected fake transport,
 * and the env-resolution path only with pinned env sources. The fixture mirrors the documented
 * dataforseo_labs/google/ranked_keywords/live response shape.
 */

const FIXED_NOW = new Date("2026-07-28T12:00:00.000Z");
const now = (): Date => FIXED_NOW;

const QUERY = {
  target: "example.com",
  limit: RANKED_KEYWORDS_MAX_LIMIT,
  language_code: "en",
  location_code: 2840,
} as const;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dfs-ranked-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseRankedKeywordsResponse", () => {
  it("projects items to {keyword, position, search_volume, url} and carries total_count", () => {
    const result = parseRankedKeywordsResponse(fixtureResponse);
    expect(result.target).toBe("example.com");
    expect(result.total_count).toBe(5312);
    expect(result.rows).toEqual([
      {
        keyword: "seo software",
        position: 3,
        search_volume: 22200,
        url: "https://example.com/seo-software",
      },
      {
        keyword: "keyword research tool",
        position: 7,
        search_volume: 12100,
        url: "https://example.com/keyword-research",
      },
      // Missing volume / url degrade to null rather than dropping the row.
      { keyword: "rank tracker", position: 18, search_volume: null, url: null },
    ]);
  });

  it("treats an empty successful result as zero rows (a domain with no rankings)", () => {
    const result = parseRankedKeywordsResponse(
      {
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [{ target: "nowhere.example", total_count: 0, items_count: 0, items: [] }],
          },
        ],
      },
      "nowhere.example",
    );
    expect(result).toEqual({ target: "nowhere.example", total_count: 0, rows: [] });
  });

  it("falls back to the requested target when the response omits it", () => {
    const result = parseRankedKeywordsResponse(
      { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] },
      "example.com",
    );
    expect(result).toEqual({ target: "example.com", total_count: null, rows: [] });
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseRankedKeywordsResponse({ status_code: 40200, status_message: "Payment Required.", tasks: [] }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the task status is an error (a paid failure is never empty data)", () => {
    expect(() =>
      parseRankedKeywordsResponse({
        status_code: 20000,
        tasks: [{ status_code: 40400, status_message: "Not Found.", result: null }],
      }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the response is not shaped like a DFS envelope at all", () => {
    expect(() => parseRankedKeywordsResponse({ nope: true })).toThrow(/expected shape/i);
  });
});

describe("extractRankedKeywordsCostUsd", () => {
  it("reads the top-level cost from a DFS response", () => {
    expect(extractRankedKeywordsCostUsd(fixtureResponse)).toBe(0.132);
  });

  it("returns null when no cost field is present", () => {
    expect(extractRankedKeywordsCostUsd({ status_code: 20000, tasks: [] })).toBeNull();
  });
});

describe("createMockRankedKeywordsPort", () => {
  it("is enabled and returns the fixture rows deterministically", async () => {
    const port = createMockRankedKeywordsPort(fixtureResponse);
    expect(port.enabled).toBe(true);
    const result = await port.fetchRankedKeywords(QUERY);
    expect(result.rows.map((row) => row.keyword)).toEqual([
      "seo software",
      "keyword research tool",
      "rank tracker",
    ]);
  });

  it("honours the requested limit (a narrow request is not over-served)", async () => {
    const port = createMockRankedKeywordsPort(fixtureResponse);
    const result = await port.fetchRankedKeywords({ ...QUERY, limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.total_count).toBe(5312);
  });
});

describe("disabledRankedKeywordsPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledRankedKeywordsPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchRankedKeywords(QUERY)).rejects.toThrow();
  });
});

describe("resolveDefaultRankedKeywordsPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultRankedKeywordsPort({}).enabled).toBe(false);
    expect(resolveDefaultRankedKeywordsPort({ DFS_LIVE: "0" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultRankedKeywordsPort({ DFS_LIVE: "1" })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultRankedKeywordsPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    });
    expect(port.enabled).toBe(true);
  });
});

describe("createLiveRankedKeywordsClient (fake transport — never real HTTP)", () => {
  it("posts the Labs query, parses rows, and records the response cost to the budget file", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      now,
      spendDir: dir,
    });

    const result = await client.fetchRankedKeywords({ ...QUERY, limit: 1000 });

    expect(result.rows).toHaveLength(3);
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toContain("/dataforseo_labs/google/ranked_keywords/live");
    expect(init?.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init?.body ?? "[]")).toEqual([
      {
        target: "example.com",
        limit: 1000,
        language_code: "en",
        location_code: 2840,
        item_types: ["organic"],
      },
    ]);
    // The REAL cost (0.132 from the response) was recorded, not the estimate.
    expect(readTodaySpendUsd({ now, dir })).toBeCloseTo(0.132, 5);
  });

  it("throws on a non-OK HTTP response instead of reporting empty rankings", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 402,
      json: async () => ({}),
    }));
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      now,
      spendDir: dir,
    });
    await expect(client.fetchRankedKeywords(QUERY)).rejects.toThrow(/HTTP 402/);
    // A failed call records no spend.
    expect(readTodaySpendUsd({ now, dir })).toBe(0);
  });

  it("refuses the call BEFORE any HTTP when today's budget is already at the cap", async () => {
    // Pre-seed today's spend at $2.95; the pre-call estimate would pass $3.00.
    writeFileSync(
      path.join(dir, "2026-07-28.jsonl"),
      JSON.stringify({ ts: "x", cost_usd: 2.95, endpoint: "e", count: 1 }) + "\n",
    );
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createLiveRankedKeywordsClient({
      login: "user@x.test",
      password: "pw",
      transport,
      now,
      spendDir: dir,
    });

    try {
      await expect(client.fetchRankedKeywords(QUERY)).rejects.toThrow(/budget exceeded/i);
      // The gate is PRE-call: the transport must never have been invoked.
      expect(transport).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("exposes a small conservative per-call estimate for the pre-call gate", () => {
    expect(ESTIMATED_RANKED_KEYWORDS_CALL_USD).toBeGreaterThan(0);
    expect(ESTIMATED_RANKED_KEYWORDS_CALL_USD).toBeLessThanOrEqual(0.5);
  });
});
