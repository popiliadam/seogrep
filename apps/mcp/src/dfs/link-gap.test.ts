import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_SAFETY_FACTOR,
  DEFAULT_LINK_GAP_LIMIT,
  DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT,
  DFS_BACKLINKS_REQUEST_USD,
  DFS_BACKLINKS_ROW_USD,
  ESTIMATED_LINK_GAP_CALL_USD,
  LINK_GAP_MAX_LIMIT,
  createLiveLinkGapClient,
  createMockLinkGapPort,
  disabledLinkGapPort,
  estimateLinkGapUsd,
  extractLinkGapCostUsd,
  parseLinkGapResponse,
  resolveDefaultLinkGapPort,
} from "./link-gap.ts";
import type { DfsTransport } from "./client.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import linkGapFixture from "./fixtures/backlinks-domain-intersection.json";

/**
 * Unit proofs for the DataForSEO Backlinks link-gap client. NO real HTTP call is ever made
 * (constitution NEVER #5): the live path is exercised only with an injected fake transport, and
 * the env-resolution path only with pinned env sources. The fixture mirrors the
 * /v3/backlinks/domain_intersection/live response shape as documented, including a row carrying
 * only the fields DataForSEO happened to have and a row with no referring domain at all.
 */

const QUERY = {
  target: "example.com",
  competitor: "rival.com",
  limit: DEFAULT_LINK_GAP_LIMIT,
} as const;

/** The fixture's real per-request cost, so no spec re-states the number by hand. */
const FIXTURE_COST = linkGapFixture.cost;

function fixtureTransport(): ReturnType<typeof vi.fn<DfsTransport>> {
  return vi.fn<DfsTransport>(async () => ({
    ok: true,
    status: 200,
    json: async () => linkGapFixture,
  }));
}

const liveClient = (transport: DfsTransport, spendLedger: MemorySpendLedger) =>
  createLiveLinkGapClient({ login: "user@x.test", password: "pw", transport, ledger: spendLedger });

/** The JSON body of the first transport call, decoded back to the object DFS receives. */
function sentBody(transport: ReturnType<typeof fixtureTransport>): Record<string, unknown> {
  const raw = transport.mock.calls[0]?.[1]?.body as string;
  return (JSON.parse(raw) as Record<string, unknown>[])[0] as Record<string, unknown>;
}

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

describe("parseLinkGapResponse", () => {
  it("projects items to prospect rows and carries total_count", () => {
    const parsed = parseLinkGapResponse(linkGapFixture);
    expect(parsed.total_count).toBe(612);
    expect(parsed.rows[0]).toEqual({
      domain: "searchengineweekly.test",
      rank: 612,
      backlinks: 41,
      referring_pages: 27,
      backlinks_spam_score: 4,
      first_seen: "2023-04-11 08:22:17 +00:00",
    });
  });

  /**
   * `domain_intersection.<n>.target` is the REFERRING domain, not the domain we asked about —
   * DataForSEO's field name reads the other way round. Reading our own POST target back out of
   * the response would produce a list of identical rows that all looked plausible.
   */
  it("reads the REFERRING domain out of the entry, never the POST target", () => {
    const parsed = parseLinkGapResponse(linkGapFixture);
    expect(parsed.rows.map((row) => row.domain)).toEqual([
      "searchengineweekly.test",
      "devtoolsdigest.test",
      "marketingroundup.test",
    ]);
    expect(parsed.rows.some((row) => row.domain === "rival.com")).toBe(false);
  });

  it("degrades MISSING metrics to null rather than to a fabricated zero", () => {
    const parsed = parseLinkGapResponse(linkGapFixture);
    const thin = parsed.rows.find((row) => row.domain === "marketingroundup.test");
    expect(thin?.rank).toBeNull();
    expect(thin?.backlinks).toBeNull();
    expect(thin?.referring_pages).toBeNull();
    expect(thin?.backlinks_spam_score).toBeNull();
    // ...but the field it DID carry survives.
    expect(thin?.first_seen).toBe("2025-06-19 03:15:41 +00:00");
  });

  it("drops an entry with no referring domain instead of failing the whole parse", () => {
    const parsed = parseLinkGapResponse(linkGapFixture);
    expect(linkGapFixture.tasks[0].result[0].items).toHaveLength(4);
    expect(parsed.rows).toHaveLength(3);
  });

  it("treats an empty successful result as zero rows (a rival with no link gap)", () => {
    const parsed = parseLinkGapResponse({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [] }],
    });
    expect(parsed).toEqual({ total_count: null, rows: [] });
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseLinkGapResponse({ status_code: 40100, status_message: "Auth error", tasks: [] }),
    ).toThrow(/error status 40100/);
  });

  it("throws when the task status is an error (a paid failure is never an empty gap)", () => {
    expect(() =>
      parseLinkGapResponse({
        status_code: 20000,
        tasks: [{ status_code: 40501, status_message: "Invalid Field" }],
      }),
    ).toThrow(/task failed \(status 40501\)/);
  });

  it("throws when the response is not shaped like a DFS envelope at all", () => {
    expect(() => parseLinkGapResponse({ nope: true })).toThrow(/not in the expected shape/);
  });
});

describe("extractLinkGapCostUsd", () => {
  it("reads the top-level cost", () => {
    expect(extractLinkGapCostUsd(linkGapFixture)).toBe(FIXTURE_COST);
  });

  it("falls back to the task cost, then to null", () => {
    expect(extractLinkGapCostUsd({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.5 }] })).toBe(0.5);
    expect(extractLinkGapCostUsd({ status_code: 20000, tasks: [{ status_code: 20000 }] })).toBeNull();
  });
});

describe("estimateLinkGapUsd", () => {
  it("prices one request by the published per-request + per-row formula", () => {
    expect(estimateLinkGapUsd(100)).toBeCloseTo(
      (DFS_BACKLINKS_REQUEST_USD + 100 * DFS_BACKLINKS_ROW_USD) * BUDGET_SAFETY_FACTOR,
      10,
    );
  });

  it("SCALES with the requested limit — the row charge is real, not decorative", () => {
    expect(estimateLinkGapUsd(1000)).toBeGreaterThan(estimateLinkGapUsd(100));
    const rowDelta = estimateLinkGapUsd(200) - estimateLinkGapUsd(100);
    expect(rowDelta).toBeCloseTo(100 * DFS_BACKLINKS_ROW_USD * BUDGET_SAFETY_FACTOR, 10);
  });

  it("uses the BACKLINKS tariff, which is not the Labs one", () => {
    // $0.024/request against Labs' $0.012 — a copy-paste of the sibling adapter's constants would
    // under-reserve every link gap by half a request.
    expect(DFS_BACKLINKS_REQUEST_USD).toBe(0.024);
    expect(DFS_BACKLINKS_ROW_USD).toBe(0.000036);
  });

  it("is bounded above by the full-call constant, at the vendor's own row cap", () => {
    expect(estimateLinkGapUsd(LINK_GAP_MAX_LIMIT)).toBeCloseTo(ESTIMATED_LINK_GAP_CALL_USD, 10);
    expect(estimateLinkGapUsd(DEFAULT_LINK_GAP_LIMIT)).toBeLessThan(ESTIMATED_LINK_GAP_CALL_USD);
  });

  /** The margin the signed 45-credit price rests on — see the sibling spec in keyword-gap.test.ts. */
  it("keeps at least a 3x margin on the signed price even at the vendor row cap", () => {
    const revenueUsd = 45 * 0.0124;
    const worstCostUsd = DFS_BACKLINKS_REQUEST_USD + LINK_GAP_MAX_LIMIT * DFS_BACKLINKS_ROW_USD;
    expect(revenueUsd / worstCostUsd).toBeGreaterThanOrEqual(3);
  });
});

describe("createMockLinkGapPort", () => {
  it("is enabled and returns the fixture's rows, competitor and target echoed back", async () => {
    const result = await createMockLinkGapPort(linkGapFixture).fetchLinkGap(QUERY);
    expect(result.target).toBe("example.com");
    expect(result.competitor).toBe("rival.com");
    expect(result.total_count).toBe(612);
    expect(result.rows).toHaveLength(3);
  });

  it("honours the requested limit (a narrow request is not over-served)", async () => {
    const result = await createMockLinkGapPort(linkGapFixture).fetchLinkGap({ ...QUERY, limit: 1 });
    expect(result.rows).toHaveLength(1);
    expect(result.total_count).toBe(612);
  });
});

describe("disabledLinkGapPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledLinkGapPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchLinkGap(QUERY)).rejects.toThrow(/disabled/i);
  });
});

describe("resolveDefaultLinkGapPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultLinkGapPort({}).enabled).toBe(false);
    expect(resolveDefaultLinkGapPort({ DFS_LIVE: "true" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultLinkGapPort({ DFS_LIVE: "1" })).toThrow(/DATAFORSEO_LOGIN/);
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultLinkGapPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    });
    expect(port.enabled).toBe(true);
  });
});

describe("createLiveLinkGapClient (fake transport — never real HTTP)", () => {
  it("sends exactly ONE request, to the backlinks domain_intersection endpoint", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchLinkGap(QUERY);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe(DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT);
  });

  /**
   * The load-bearing assertion of this whole adapter. DataForSEO returns "the referring domains
   * that link to `targets` but don't link to `exclude_targets`", so the RIVAL must be the target
   * and the caller's own domain must be excluded. Swapping them answers the opposite question —
   * who links to you and not to them — at the same price, and every other spec would stay green.
   */
  it("puts the COMPETITOR in targets and the caller's domain in exclude_targets", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchLinkGap(QUERY);
    const body = sentBody(transport);
    expect(body.targets).toEqual({ "1": "rival.com" });
    expect(body.exclude_targets).toEqual(["example.com"]);
  });

  it("pins live links, the 0-1,000 rank scale, the requested limit and the rank ordering", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchLinkGap({ ...QUERY, limit: 25 });
    const body = sentBody(transport);
    expect(body.backlinks_status_type).toBe("live");
    expect(body.rank_scale).toBe("one_thousand");
    expect(body.limit).toBe(25);
    expect(body.order_by).toEqual(["1.rank,desc"]);
  });

  it("sends Basic auth built from the injected credentials", async () => {
    const transport = fixtureTransport();
    await liveClient(transport, ledger).fetchLinkGap(QUERY);
    const headers = transport.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("user@x.test:pw").toString("base64")}`);
  });

  it("RESERVES before any HTTP — a near-cap day never reaches the vendor", async () => {
    const transport = fixtureTransport();
    ledger.seed(2.999);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(liveClient(transport, ledger).fetchLinkGap({ ...QUERY, limit: 1000 })).rejects.toThrow(
        /daily budget exceeded/i,
      );
    } finally {
      errorSpy.mockRestore();
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("settles the reservation with the REAL cost of the request (not the estimate)", async () => {
    await liveClient(fixtureTransport(), ledger).fetchLinkGap(QUERY);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(FIXTURE_COST, 10);
    expect(ledger.rows()).toHaveLength(1);
    expect(ledger.rows()[0]?.endpoint).toBe(DFS_BACKLINKS_DOMAIN_INTERSECTION_ENDPOINT);
    expect(ledger.rows()[0]?.rowCount).toBe(3);
  });

  it("throws on a non-OK HTTP response instead of reporting an empty gap", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(liveClient(transport, ledger).fetchLinkGap(QUERY)).rejects.toThrow(/HTTP 500/);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(estimateLinkGapUsd(QUERY.limit), 10);
  });
});
