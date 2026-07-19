import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ESTIMATED_SEARCH_VOLUME_CALL_USD,
  createLiveClient,
  createMockResearchPort,
  disabledPort,
  extractResponseCostUsd,
  parseSearchVolumeResponse,
  resolveDefaultPort,
  type DfsTransport,
} from "./client.ts";
import { readTodaySpendUsd } from "./budget.ts";
import fixtureResponse from "./fixtures/search-volume.json";

/**
 * Unit proofs for the DataForSEO client. NO real HTTP call is ever made (constitution
 * NEVER #5): the live path is exercised only with an injected fake transport, and the
 * env-resolution path is exercised with pinned env sources. The fixture is the REAL
 * google_ads/search_volume/live response shape.
 */

const FIXED_NOW = new Date("2026-07-19T12:00:00.000Z");
const now = (): Date => FIXED_NOW;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dfs-client-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseSearchVolumeResponse", () => {
  it("maps the DFS result rows to {keyword, search_volume, cpc, competition}", () => {
    const rows = parseSearchVolumeResponse(fixtureResponse);
    expect(rows).toEqual([
      { keyword: "seo software", search_volume: 22200, cpc: 9.87, competition: "HIGH" },
      { keyword: "keyword research tool", search_volume: 12100, cpc: 6.42, competition: "MEDIUM" },
      { keyword: "rank tracker", search_volume: 8100, cpc: 4.1, competition: "LOW" },
    ]);
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseSearchVolumeResponse({ status_code: 40200, status_message: "Payment Required.", tasks: [] }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the task status is an error", () => {
    expect(() =>
      parseSearchVolumeResponse({
        status_code: 20000,
        tasks: [{ status_code: 40400, status_message: "Not Found.", result: null }],
      }),
    ).toThrow(/DataForSEO/);
  });
});

describe("extractResponseCostUsd", () => {
  it("reads the top-level cost from a DFS response", () => {
    expect(extractResponseCostUsd(fixtureResponse)).toBe(0.075);
  });

  it("returns null when no cost field is present", () => {
    expect(extractResponseCostUsd({ status_code: 20000, tasks: [] })).toBeNull();
  });
});

describe("createMockResearchPort", () => {
  it("is enabled and returns the fixture rows deterministically", async () => {
    const port = createMockResearchPort(fixtureResponse);
    expect(port.enabled).toBe(true);
    const rows = await port.fetchSearchVolume({
      keywords: ["seo software"],
      language_code: "en",
      location_code: 2840,
    });
    expect(rows.map((r) => r.keyword)).toEqual([
      "seo software",
      "keyword research tool",
      "rank tracker",
    ]);
  });
});

describe("disabledPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledPort();
    expect(port.enabled).toBe(false);
    await expect(
      port.fetchSearchVolume({ keywords: ["x"], language_code: "en", location_code: 2840 }),
    ).rejects.toThrow();
  });
});

describe("resolveDefaultPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultPort({}).enabled).toBe(false);
    expect(resolveDefaultPort({ DFS_LIVE: "0" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    // The live-path negative case: DFS_LIVE=1 but no login/password -> loud fail-closed.
    expect(() => resolveDefaultPort({ DFS_LIVE: "1" })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    });
    expect(port.enabled).toBe(true);
  });
});

describe("createLiveClient (fake transport — never real HTTP)", () => {
  it("posts to DFS, parses rows, and records the response cost to the budget file", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const client = createLiveClient({
      login: "user@x.test",
      password: "pw",
      transport,
      now,
      spendDir: dir,
    });

    const rows = await client.fetchSearchVolume({
      keywords: ["seo software", "keyword research tool", "rank tracker"],
      language_code: "en",
      location_code: 2840,
    });

    expect(rows).toHaveLength(3);
    // Basic auth header + JSON body of the right shape.
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toContain("/keywords_data/google_ads/search_volume/live");
    expect(init?.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init?.body ?? "[]")).toEqual([
      {
        keywords: ["seo software", "keyword research tool", "rank tracker"],
        language_code: "en",
        location_code: 2840,
      },
    ]);
    // The REAL cost (0.075 from the response) was recorded, not the estimate.
    expect(readTodaySpendUsd({ now, dir })).toBeCloseTo(0.075, 5);
  });

  it("refuses the call BEFORE any HTTP when today's budget is already at the cap", async () => {
    // Pre-seed today's spend at $2.95; the pre-call estimate would pass $3.00.
    writeFileSync(
      path.join(dir, "2026-07-19.jsonl"),
      JSON.stringify({ ts: "x", cost_usd: 2.95, endpoint: "e", count: 1 }) + "\n",
    );
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createLiveClient({
      login: "user@x.test",
      password: "pw",
      transport,
      now,
      spendDir: dir,
    });

    try {
      await expect(
        client.fetchSearchVolume({ keywords: ["x"], language_code: "en", location_code: 2840 }),
      ).rejects.toThrow(/budget exceeded/i);
      // The gate is PRE-call: the transport must never have been invoked.
      expect(transport).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("exposes a small conservative per-call estimate for the pre-call gate", () => {
    expect(ESTIMATED_SEARCH_VOLUME_CALL_USD).toBeGreaterThan(0);
    expect(ESTIMATED_SEARCH_VOLUME_CALL_USD).toBeLessThanOrEqual(0.5);
  });
});
