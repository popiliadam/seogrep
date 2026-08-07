import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKLINKS_MAX_LIMIT,
  ESTIMATED_BACKLINKS_REQUEST_USD,
  ESTIMATED_BACKLINK_PROFILE_CALL_USD,
  createLiveBacklinksClient,
  createMockBacklinksPort,
  disabledBacklinksPort,
  extractBacklinksCostUsd,
  parseAnchorsResponse,
  parseBacklinksSummaryResponse,
  parseReferringDomainsResponse,
  resolveDefaultBacklinksPort,
} from "./backlinks.ts";
import type { DfsTransport } from "./client.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import summaryFixture from "./fixtures/backlinks-summary.json";
import referringDomainsFixture from "./fixtures/backlinks-referring-domains.json";
import anchorsFixture from "./fixtures/backlinks-anchors.json";

/**
 * Unit proofs for the DataForSEO Backlinks client. NO real HTTP call is ever made (constitution
 * NEVER #5): the live path is exercised only with an injected fake transport, and the
 * env-resolution path only with pinned env sources. The three fixtures mirror the documented
 * /v3/backlinks/{summary,referring_domains,anchors}/live response shapes.
 */

const QUERY = { target: "example.com", limit: BACKLINKS_MAX_LIMIT } as const;

const FIXTURES = {
  summary: summaryFixture,
  referringDomains: referringDomainsFixture,
  anchors: anchorsFixture,
};

/** The three fixture responses in the order the live client requests them. */
function fixtureTransport(): ReturnType<typeof vi.fn<DfsTransport>> {
  const byEndpoint: Record<string, unknown> = {
    summary: summaryFixture,
    referring_domains: referringDomainsFixture,
    anchors: anchorsFixture,
  };
  return vi.fn<DfsTransport>(async (url) => {
    const key = Object.keys(byEndpoint).find((name) => url.includes(`/backlinks/${name}/live`));
    if (!key) throw new Error(`unexpected endpoint in test: ${url}`);
    return { ok: true, status: 200, json: async () => byEndpoint[key] };
  });
}

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

describe("parseBacklinksSummaryResponse", () => {
  it("projects the documented summary fields down to the rendered subset", () => {
    expect(parseBacklinksSummaryResponse(summaryFixture)).toEqual({
      target: "example.com",
      summary: {
        rank: 371,
        backlinks: 41245,
        backlinks_spam_score: 8,
        referring_domains: 12372,
        referring_domains_nofollow: 1458,
        referring_main_domains: 11004,
        broken_backlinks: 118,
      },
    });
  });

  it("falls back to the requested target and all-null metrics when the result is empty", () => {
    const parsed = parseBacklinksSummaryResponse(
      { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] },
      "example.com",
    );
    expect(parsed.target).toBe("example.com");
    expect(parsed.summary.backlinks).toBeNull();
    expect(parsed.summary.referring_domains).toBeNull();
  });

  it("throws a clear error when the top-level DFS status is not 20000", () => {
    expect(() =>
      parseBacklinksSummaryResponse({
        status_code: 40200,
        status_message: "Payment Required.",
        tasks: [],
      }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the task status is an error (a paid failure is never an empty profile)", () => {
    expect(() =>
      parseBacklinksSummaryResponse({
        status_code: 20000,
        tasks: [{ status_code: 40400, status_message: "Not Found.", result: null }],
      }),
    ).toThrow(/DataForSEO/);
  });

  it("throws when the response is not shaped like a DFS envelope at all", () => {
    expect(() => parseBacklinksSummaryResponse({ nope: true })).toThrow(/expected shape/i);
  });
});

describe("parseReferringDomainsResponse", () => {
  it("projects items to {domain, backlinks, rank} and carries total_count", () => {
    expect(parseReferringDomainsResponse(referringDomainsFixture)).toEqual({
      total_count: 12372,
      rows: [
        { domain: "seoblog.example", backlinks: 9864, rank: 302 },
        { domain: "news.example", backlinks: 1204, rank: 218 },
        // A null rank and an ABSENT backlinks field both degrade to null — the row stays.
        { domain: "forum.example", backlinks: null, rank: null },
      ],
    });
  });

  it("treats an empty successful result as zero rows (a domain with no backlinks)", () => {
    expect(
      parseReferringDomainsResponse({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: [{ total_count: 0, items_count: 0, items: [] }] }],
      }),
    ).toEqual({ total_count: 0, rows: [] });
  });

  // Live regression (2026-08-07 product test): DFS sends `null` for text fields the fixtures
  // only ever showed as strings. A null DOMAIN carries no usable information, so the row is
  // dropped — but it must never take the whole report down with it.
  it("drops a null-domain row instead of failing the whole parse", () => {
    expect(
      parseReferringDomainsResponse({
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [
              {
                total_count: 2,
                items: [
                  { domain: "news.example", backlinks: 5, rank: 10 },
                  { domain: null, backlinks: 3, rank: 4 },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({ total_count: 2, rows: [{ domain: "news.example", backlinks: 5, rank: 10 }] });
  });
});

describe("parseAnchorsResponse", () => {
  it("projects items to {anchor, backlinks} and carries total_count", () => {
    expect(parseAnchorsResponse(anchorsFixture)).toEqual({
      total_count: 83736,
      rows: [
        { anchor: "example", backlinks: 4186 },
        { anchor: "seo software", backlinks: 902 },
        // An empty anchor is real data (image links) and is preserved, not dropped.
        { anchor: "", backlinks: null },
      ],
    });
  });

  it("treats an empty successful result as zero rows", () => {
    expect(
      parseAnchorsResponse({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: [{ total_count: 0, items_count: 0, items: [] }] }],
      }),
    ).toEqual({ total_count: 0, rows: [] });
  });

  // THE live crash (2026-08-07 product test, ref 5ded2b4e): analyze_backlinks died on
  // `expected string, received null → at items[1].anchor`. An anchorless link is exactly what
  // this file's own comment predicted ("image links carry no anchor text") — DFS just encodes
  // it as null, not "". Null and "" must therefore mean the SAME thing, and neither may throw.
  it("reads a null anchor as an empty anchor instead of failing the whole parse", () => {
    expect(
      parseAnchorsResponse({
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [
              {
                total_count: 2,
                items: [
                  { anchor: "example", backlinks: 7 },
                  { anchor: null, backlinks: 2 },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      total_count: 2,
      rows: [
        { anchor: "example", backlinks: 7 },
        { anchor: "", backlinks: 2 },
      ],
    });
  });
});

describe("extractBacklinksCostUsd", () => {
  it("reads the top-level cost from each of the three DFS responses", () => {
    expect(extractBacklinksCostUsd(summaryFixture)).toBe(0.02003);
    expect(extractBacklinksCostUsd(referringDomainsFixture)).toBe(0.06015);
    expect(extractBacklinksCostUsd(anchorsFixture)).toBe(0.06012);
  });

  it("returns null when no cost field is present", () => {
    expect(extractBacklinksCostUsd({ status_code: 20000, tasks: [] })).toBeNull();
  });
});

describe("createMockBacklinksPort", () => {
  it("is enabled and returns the three fixture sections deterministically", async () => {
    const port = createMockBacklinksPort(FIXTURES);
    expect(port.enabled).toBe(true);
    const profile = await port.fetchBacklinkProfile(QUERY);
    expect(profile.target).toBe("example.com");
    expect(profile.summary.backlinks).toBe(41245);
    expect(profile.top_referring_domains.rows.map((row) => row.domain)).toEqual([
      "seoblog.example",
      "news.example",
      "forum.example",
    ]);
    expect(profile.top_anchors.rows.map((row) => row.anchor)).toEqual([
      "example",
      "seo software",
      "",
    ]);
  });

  it("honours the requested limit on BOTH lists (a narrow request is not over-served)", async () => {
    const port = createMockBacklinksPort(FIXTURES);
    const profile = await port.fetchBacklinkProfile({ ...QUERY, limit: 1 });
    expect(profile.top_referring_domains.rows).toHaveLength(1);
    expect(profile.top_anchors.rows).toHaveLength(1);
    // The totals still describe the whole profile, so truncation stays visible.
    expect(profile.top_referring_domains.total_count).toBe(12372);
    expect(profile.top_anchors.total_count).toBe(83736);
  });
});

describe("disabledBacklinksPort", () => {
  it("is not enabled and throws if its fetch is ever called", async () => {
    const port = disabledBacklinksPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchBacklinkProfile(QUERY)).rejects.toThrow();
  });
});

describe("resolveDefaultBacklinksPort", () => {
  it("returns a DISABLED port when DFS_LIVE is not '1' (paid path off by default)", () => {
    expect(resolveDefaultBacklinksPort({}).enabled).toBe(false);
    expect(resolveDefaultBacklinksPort({ DFS_LIVE: "0" }).enabled).toBe(false);
  });

  it("throws a clear env-absence error when live is on but credentials are missing", () => {
    expect(() => resolveDefaultBacklinksPort({ DFS_LIVE: "1" })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
  });

  it("returns an ENABLED live port when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultBacklinksPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    });
    expect(port.enabled).toBe(true);
  });
});

describe("createLiveBacklinksClient (fake transport — never real HTTP)", () => {
  it("posts all THREE endpoints with the documented bodies and assembles one profile", async () => {
    const transport = fixtureTransport();
    const client = createLiveBacklinksClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });

    const profile = await client.fetchBacklinkProfile({ target: "example.com", limit: 1000 });

    expect(transport).toHaveBeenCalledTimes(3);
    const [summaryCall, domainsCall, anchorsCall] = transport.mock.calls;

    // (1) summary — no limit (it is a single-row endpoint), rank scale pinned.
    expect(summaryCall?.[0]).toContain("/backlinks/summary/live");
    expect(summaryCall?.[1]?.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(summaryCall?.[1]?.body ?? "[]")).toEqual([
      { target: "example.com", backlinks_status_type: "live", rank_scale: "one_thousand" },
    ]);

    // (2) referring domains — limited, sorted by backlinks so "top" means what it says.
    expect(domainsCall?.[0]).toContain("/backlinks/referring_domains/live");
    expect(JSON.parse(domainsCall?.[1]?.body ?? "[]")).toEqual([
      {
        target: "example.com",
        limit: 1000,
        backlinks_status_type: "live",
        rank_scale: "one_thousand",
        order_by: ["backlinks,desc"],
      },
    ]);

    // (3) anchors — limited and sorted the same way (no rank is rendered for anchors).
    expect(anchorsCall?.[0]).toContain("/backlinks/anchors/live");
    expect(JSON.parse(anchorsCall?.[1]?.body ?? "[]")).toEqual([
      {
        target: "example.com",
        limit: 1000,
        backlinks_status_type: "live",
        order_by: ["backlinks,desc"],
      },
    ]);

    expect(profile.summary.backlinks).toBe(41245);
    expect(profile.top_referring_domains.rows).toHaveLength(3);
    expect(profile.top_anchors.rows).toHaveLength(3);
  });

  it("settles the reservation with the REAL cost of all three requests (not the estimate)", async () => {
    const client = createLiveBacklinksClient({
      login: "user@x.test",
      password: "pw",
      transport: fixtureTransport(),
      ledger,
    });
    await client.fetchBacklinkProfile(QUERY);
    // 0.02003 + 0.06015 + 0.06012 — the three response `cost` fields, summed.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.1403, 5);
  });

  it("throws on a non-OK HTTP response instead of reporting an empty profile", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 402,
      json: async () => ({}),
    }));
    const client = createLiveBacklinksClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });
    await expect(client.fetchBacklinkProfile(QUERY)).rejects.toThrow(/HTTP 402/);
    // A failed lookup leaves its reservation OPEN, so today keeps paying the FULL
    // whole-operation estimate — never less than what the fleet may actually have spent.
    expect(await todaySpendUsd(ledger)).toBeCloseTo(ESTIMATED_BACKLINK_PROFILE_CALL_USD, 5);
  });

  it("stops at the FIRST failure — a dead summary never pays for the other two requests", async () => {
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const client = createLiveBacklinksClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });
    await expect(client.fetchBacklinkProfile(QUERY)).rejects.toThrow(/HTTP 500/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("propagates a MID-SEQUENCE failure, keeping only the already-spent request on the books", async () => {
    // Summary succeeds (and is charged); referring_domains fails. The whole lookup throws, so the
    // tool's credit guard releases — the customer pays nothing for a partial profile.
    const transport = vi.fn<DfsTransport>(async (url) => {
      if (url.includes("/backlinks/summary/live")) {
        return { ok: true, status: 200, json: async () => summaryFixture };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });
    const client = createLiveBacklinksClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });
    await expect(client.fetchBacklinkProfile(QUERY)).rejects.toThrow(/HTTP 500/);
    expect(transport).toHaveBeenCalledTimes(2); // never reached anchors
    // DFS charged for the summary ($0.02003). The reservation is never settled, so the day is
    // charged the full $0.30 estimate instead: MORE than the true partial spend, which is the
    // safe direction. (The pre-fix file ledger booked exactly $0.02003 and then handed the rest
    // of the allowance back — cheaper on paper, but it under-counted a fleet that had already
    // committed to the operation.)
    expect(await todaySpendUsd(ledger)).toBeCloseTo(ESTIMATED_BACKLINK_PROFILE_CALL_USD, 5);
    expect(await todaySpendUsd(ledger)).toBeGreaterThan(0.02003);
    expect(ledger.rows()[0]?.actualUsd).toBeNull(); // still open
  });

  it("falls back to the per-request estimate when a response omits its cost", async () => {
    // A well-formed but cost-less envelope from every endpoint.
    const costless = {
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ total_count: 0, items: [] }] }],
    };
    const transport = vi.fn<DfsTransport>(async () => ({
      ok: true,
      status: 200,
      json: async () => costless,
    }));
    const client = createLiveBacklinksClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });
    await client.fetchBacklinkProfile(QUERY);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(ESTIMATED_BACKLINKS_REQUEST_USD * 3, 5);
  });

  it("refuses the WHOLE lookup BEFORE any HTTP when today's budget is already at the cap", async () => {
    // Pre-seed today's spend at $2.95; the pre-call whole-operation estimate would pass $3.00.
    ledger.seed(2.95);
    const transport = fixtureTransport();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createLiveBacklinksClient({
      login: "user@x.test",
      password: "pw",
      transport,
      ledger,
    });

    try {
      await expect(client.fetchBacklinkProfile(QUERY)).rejects.toThrow(/budget exceeded/i);
      // The gate is PRE-call: not one of the three requests may have been sent.
      expect(transport).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("exposes a conservative whole-operation estimate that OVER-states the real ~$0.14", async () => {
    const client = createLiveBacklinksClient({
      login: "user@x.test",
      password: "pw",
      transport: fixtureTransport(),
      ledger,
    });
    await client.fetchBacklinkProfile(QUERY);
    expect(ESTIMATED_BACKLINK_PROFILE_CALL_USD).toBeGreaterThan(await todaySpendUsd(ledger));
    expect(ESTIMATED_BACKLINK_PROFILE_CALL_USD).toBeLessThanOrEqual(0.5);
  });
});
