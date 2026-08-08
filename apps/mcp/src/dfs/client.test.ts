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
// Additive M-14 import, on its own line so every existing line above stays byte-identical.
import { DFS_REQUEST_TIMEOUT_MS, defaultDfsTransport } from "./client.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import fixtureResponse from "./fixtures/search-volume.json";

/**
 * Unit proofs for the DataForSEO client. NO real HTTP call is ever made (constitution
 * NEVER #5): the live path is exercised only with an injected fake transport, and the
 * env-resolution path is exercised with pinned env sources. The fixture is the REAL
 * google_ads/search_volume/live response shape.
 */

// The budget counter is a port (migration 0014 in production), so the priced path is driven
// against an in-memory ledger here — no database, no network.
let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
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

  // Same class as the live analyze_backlinks crash (2026-08-07, ref 5ded2b4e): DFS sends null
  // where the fixture only ever showed a string. A keyword-less row names nothing, so it is
  // dropped — but it must not take the surrounding lookup down with it.
  it("drops a null-keyword row instead of failing the whole lookup", () => {
    expect(
      parseSearchVolumeResponse({
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [
              { keyword: "seo software", search_volume: 10, cpc: 1.5, competition: "LOW" },
              { keyword: null, search_volume: 5, cpc: null, competition: null },
            ],
          },
        ],
      }),
    ).toEqual([{ keyword: "seo software", search_volume: 10, cpc: 1.5, competition: "LOW" }]);
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
  it("posts to DFS, parses rows, and settles the reservation at the response cost", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });

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
    // The REAL cost (0.075 from the response) settled the reservation, not the estimate.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.075, 5);
    expect(ledger.rows()).toHaveLength(1);
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(0.075, 5);
  });

  it("refuses the call BEFORE any HTTP when today's budget is already at the cap", async () => {
    // Pre-seed today's spend at $2.95; the pre-call estimate would pass $3.00.
    ledger.seed(2.95);
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => fixtureResponse,
    }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createLiveClient({ login: "user@x.test", password: "pw", transport, ledger });

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

/**
 * M-14 — the DEFAULT transport's application deadline. Every live DataForSEO port
 * (search volume, ranked keywords, backlinks, competitors) reaches the network through
 * this ONE transport, and bare `fetch` has no default timeout: a provider holding the
 * socket open would keep a credit-RESERVED tool call waiting indefinitely, so the reserve
 * stays open and the request slot stays held. These specs drive the real transport with a
 * stubbed global fetch — still ZERO real DataForSEO traffic (constitution NEVER #5).
 */
describe("defaultDfsTransport request deadline (M-14)", () => {
  const INIT = { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arms an abort signal on every outbound DataForSEO request", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response("{}", { status: 200 });
    });
    await defaultDfsTransport("https://api.dataforseo.com/v3/x", INIT);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes the caller's method, headers and body through unchanged", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    });
    const res = await defaultDfsTransport("https://api.dataforseo.com/v3/x", INIT);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers).toEqual(INIT.headers);
    expect(calls[0]?.body).toBe("[]");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });
  });

  it("rejects a hung request rather than holding the reserved tool call open", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(
      defaultDfsTransport("https://api.dataforseo.com/v3/x", INIT, 10),
    ).rejects.toThrowError(/timeout|abort/i);
  });

  it("gives the paid data call a deadline well above the interactive 3s adapter default", async () => {
    // A DataForSEO live endpoint legitimately runs for seconds; copying the 3s analytics
    // deadline would abort healthy paid calls (and burn the budget for nothing). Pinned as
    // a bound, not an exact value, so the number can be retuned without a spec rewrite.
    expect(DFS_REQUEST_TIMEOUT_MS).toBeGreaterThan(3_000);
  });
});
