import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mentionsModule from "./llm-mentions.ts";
import {
  AGGREGATION_KEY_FIELD,
  AI_VISIBILITY_REQUESTS_PER_LOOKUP,
  BUDGET_SAFETY_FACTOR,
  DEFAULT_INTERNAL_LIST_ROWS,
  DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT,
  DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT,
  DFS_LLM_MENTIONS_REQUEST_USD,
  DFS_LLM_MENTIONS_ROW_USD,
  ESTIMATED_AI_VISIBILITY_CALL_USD,
  MAX_COMPARE_TARGETS,
  MAX_INTERNAL_LIST_ROWS,
  MIN_COMPARE_TARGETS,
  PLATFORM_MEANS,
  ROW_ORDER,
  VENDOR_MAX_INTERNAL_LIST_AGGREGATED,
  VENDOR_MAX_INTERNAL_LIST_CROSS,
  VENDOR_TIME_FIELD_CANDIDATES,
  buildAiVisibilityCompareRequestBody,
  buildAiVisibilityRequestBody,
  buildCostAccounting,
  clampInternalListLimit,
  collectVendorMetrics,
  createLiveAiVisibilityClient,
  createMockAiVisibilityPort,
  disabledAiVisibilityPort,
  estimateLlmMentionsUsd,
  extractEchoedPlatform,
  extractVendorRefusal,
  extractLlmMentionsCostUsd,
  extractVendorTime,
  isLlmMentionsVendorError,
  parseAiVisibilityCompareResponse,
  parseAiVisibilityResponse,
  resolveDefaultAiVisibilityPort,
  sumSettledCostUsd,
  toVendorTarget,
  validateCompareGroups,
  vendorInternalListLimit,
  type AiVisibilityCompareQuery,
  type AiVisibilityQuery,
  type CompareGroup,
  type LlmMentionsVendorError,
} from "./llm-mentions.ts";
import { createMemorySpendLedger, type MemorySpendLedger } from "./budget.ts";
import type { DfsTransport } from "./client.ts";
import aggregatedFixture from "./fixtures/llm-mentions-aggregated-metrics.json";
import crossFixture from "./fixtures/llm-mentions-cross-aggregated-metrics.json";

/**
 * Unit proofs for the DataForSEO **LLM Mentions** (AI visibility) client. NO real HTTP call is ever
 * made (constitution NEVER #5): the live path runs only against an injected fake transport, and the
 * env-resolution path only against pinned env sources.
 *
 * ŞERH ON THE FIXTURES, so nobody reads them as measurement (signed lessons 11/12). NEITHER fixture
 * is a captured vendor response — this repo has never captured an LLM-Mentions response. The
 * ENVELOPE (status_code / tasks / tasks[].data / tasks[].result / cost) is the verified DataForSEO
 * envelope every other fixture in this directory carries. The ITEM field names are ILLUSTRATIVE and
 * unverified, which is exactly why the port carries them VERBATIM instead of projecting them: the
 * specs below assert that the carried keys are the fixture's own keys, so a parser that started
 * renaming or inventing fields would turn RED even though nobody knows the real names yet.
 *
 * The REQUEST parameters, by contrast, come from the vendor's own published input schemas.
 */

// =============================================================================================
// THE SIGNED PRICE. Restated here, never in the module (the module must not carry a credit price).
// =============================================================================================
/** Signature package 2026-08-17, MADDE 2: 90 credits, and 90 PER TARGET for the compare tool. */
const SIGNED_CREDITS_PER_TARGET = 90;
/** The credit price the signature package prices margins at. */
const SIGNED_CREDIT_PRICE_USD = 0.0124;
/** The margin the signature records at the mandated cap. */
const SIGNED_MARGIN_AT_CAP = 5.6;
/** The band the signature package requires of every tool ("en kötü hâl >= 3x"). */
const SIGNED_MARGIN_BAND_FLOOR = 3;
const SIGNED_REVENUE_PER_TARGET_USD = SIGNED_CREDITS_PER_TARGET * SIGNED_CREDIT_PRICE_USD;

/** The vendor's published formula, WITHOUT the reservation safety factor. */
function vendorCostUsd(targets: number, rowsPerTarget: number): number {
  return DFS_LLM_MENTIONS_REQUEST_USD + targets * rowsPerTarget * DFS_LLM_MENTIONS_ROW_USD;
}

// =============================================================================================
// Helpers
// =============================================================================================
const DOMAIN_TARGET = { kind: "domain", domain: "example-fixture.test" } as const;
const KEYWORD_TARGET = { kind: "keyword", keyword: "seo software" } as const;

function visibilityQuery(over: Partial<AiVisibilityQuery> = {}): AiVisibilityQuery {
  return {
    platform: "chat_gpt",
    internal_list_limit: MAX_INTERNAL_LIST_ROWS,
    location_name: "United States",
    language_code: "en",
    target: DOMAIN_TARGET,
    ...over,
  };
}

function group(key: string, domain: string): CompareGroup {
  return { aggregation_key: key, target: { kind: "domain", domain } };
}

const THREE_GROUPS: readonly CompareGroup[] = [
  group("our-brand", "example-fixture.test"),
  group("rival-one", "rival-one-fixture.test"),
  group("rival-two", "rival-two-fixture.test"),
];

function compareQuery(over: Partial<AiVisibilityCompareQuery> = {}): AiVisibilityCompareQuery {
  return {
    platform: "chat_gpt",
    internal_list_limit: MAX_INTERNAL_LIST_ROWS,
    location_name: "United States",
    language_code: "en",
    groups: THREE_GROUPS,
    ...over,
  };
}

/** A transport that answers with the fixture matching whichever endpoint it was called on. */
function endpointTransport(override?: unknown) {
  return vi.fn<DfsTransport>(async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      override ??
      (url === DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT ? aggregatedFixture : crossFixture),
  }));
}

const liveClient = (transport: DfsTransport, spendLedger: MemorySpendLedger) =>
  createLiveAiVisibilityClient({
    login: "user@x.test",
    password: "pw",
    transport,
    ledger: spendLedger,
  });

/** The JSON body of the Nth transport call, decoded back to the object DFS receives. */
function sentBody(
  transport: ReturnType<typeof endpointTransport>,
  index = 0,
): Record<string, unknown> {
  const raw = transport.mock.calls[index]?.[1]?.body as string;
  return (JSON.parse(raw) as Record<string, unknown>[])[0] as Record<string, unknown>;
}

/** The same response with every `cost` field removed — the vendor declining to price a request. */
function withoutCost(fixture: unknown): unknown {
  const clone = structuredClone(fixture) as { cost?: number; tasks?: { cost?: number }[] };
  delete clone.cost;
  for (const task of clone.tasks ?? []) delete task.cost;
  return clone;
}

/** A minimal successful envelope around one result object. */
function envelope(result: unknown, data?: unknown): unknown {
  return { status_code: 20000, tasks: [{ status_code: 20000, data, result: [result] }] };
}

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

// =============================================================================================
// NEVER #5 — fail-closed, and no traffic that is not the injected transport's.
// =============================================================================================
describe("fail-closed live gate", () => {
  it("returns a DISABLED port when DFS_LIVE is unset", () => {
    expect(resolveDefaultAiVisibilityPort({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it("stays disabled when DFS_LIVE is anything other than exactly '1'", () => {
    for (const value of ["0", "true", "yes", "TRUE", " 1", "1 ", ""]) {
      const port = resolveDefaultAiVisibilityPort({
        DFS_LIVE: value,
        DATAFORSEO_LOGIN: "user@x.test",
        DATAFORSEO_PASSWORD: "pw",
      } as NodeJS.ProcessEnv);
      expect(port.enabled, `DFS_LIVE=${JSON.stringify(value)} must not enable live`).toBe(false);
    }
  });

  it("throws, naming BOTH prod env vars, when live is on but a credential is missing", () => {
    expect(() =>
      resolveDefaultAiVisibilityPort({
        DFS_LIVE: "1",
        DATAFORSEO_LOGIN: "user@x.test",
      } as NodeJS.ProcessEnv),
    ).toThrow(/DATAFORSEO_LOGIN[\s\S]*DATAFORSEO_PASSWORD/);
  });

  it("a disabled port never serves data — BOTH methods fail loudly if anyone calls them", async () => {
    const port = disabledAiVisibilityPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchAiVisibility(visibilityQuery())).rejects.toThrow(/disabled/i);
    await expect(port.fetchAiVisibilityCompare(compareQuery())).rejects.toThrow(/disabled/i);
  });

  it("resolves the LIVE client only when DFS_LIVE=1 and both credentials are present", () => {
    const port = resolveDefaultAiVisibilityPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "user@x.test",
      DATAFORSEO_PASSWORD: "pw",
    } as NodeJS.ProcessEnv);
    expect(port.enabled).toBe(true);
  });
});

// =============================================================================================
// THE OUTBOUND-TRANSPORT PIN PAIR (discover-keywords.ts's standard, copied deliberately).
// =============================================================================================
describe("every request goes to DataForSEO, through the injected transport", () => {
  it("talks to api.dataforseo.com and nothing else, on every request it makes", async () => {
    const transport = endpointTransport();
    const client = liveClient(transport, createMemorySpendLedger());
    await client.fetchAiVisibility(visibilityQuery());
    await client.fetchAiVisibilityCompare(compareQuery());
    expect(transport.mock.calls.length).toBe(2);
    for (const [url] of transport.mock.calls) {
      expect(url.startsWith("https://api.dataforseo.com/")).toBe(true);
    }
  });

  /**
   * The endpoint list is pinned as a SET, to LITERAL URLs rather than to the constants themselves:
   * comparing an exported constant to the same imported constant is a value-tautology that stays
   * GREEN when the constant is rewritten to point somewhere else entirely (measured on a sibling
   * module, referee round 2 / M5). A third endpoint has to change this line to land.
   */
  it("knows exactly two endpoints, both of them DataForSEO AI-Optimization reads", () => {
    const endpoints = Object.entries(mentionsModule)
      .filter(([key]) => key.startsWith("DFS_") && key.endsWith("_ENDPOINT"))
      .map(([, value]) => value as string);
    expect(endpoints.sort()).toEqual([
      "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/aggregated_metrics/live",
      "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/cross_aggregated_metrics/live",
    ]);
  });

  /**
   * SOURCE-SCAN HALF. An outbound call that reuses none of this module's exported constants changes
   * no constant, so the endpoint-set spec above cannot see it, and the wire pin cannot either — an
   * injected transport only ever sees the calls that go THROUGH it. On a sibling module a
   * `void fetch("https://searchconsole.googleapis.com/v1/notify")` inserted into the live path kept
   * every spec, `tsc --noEmit` and `eslint src` ALL GREEN (measured).
   */
  it("this module's own source contains no path out except DataForSEO", () => {
    const source = readFileSync(new URL("./llm-mentions.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/googleapis\.com/i);
    expect(source).not.toMatch(/openai\.com|anthropic\.com/i);
    expect(source).not.toMatch(/searchconsole|search-console/i);
    // Every request goes through the INJECTED transport. A bare fetch/XHR is by definition a call
    // that escaped it, whatever host it names.
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\brequest\s*\(\s*["'`]https?:/i);
    // Any http(s) literal that is not DataForSEO. The two endpoint constants are the only ones this
    // file is allowed to contain.
    expect(source).not.toMatch(/\bhttps?:\/\/(?!api\.dataforseo\.com)/i);
    expect(source).not.toMatch(/TODO[^\n]*(submit|upload|apply|send)/i);
  });

  /**
   * RUNTIME HALF, because a source scan only sees the shapes it was told to look for. A call written
   * through a variable (`const f = globalThis.fetch; f(url)`) or with a host assembled in a template
   * literal names no forbidden token and carries no URL literal — it reads past every regex above.
   * It cannot get past this.
   */
  it("never touches global fetch — every request goes through the injected transport", async () => {
    const escaped = vi.fn(() => {
      throw new Error("an outbound call escaped the injected transport");
    });
    vi.stubGlobal("fetch", escaped);
    try {
      const client = liveClient(endpointTransport(), createMemorySpendLedger());
      await client.fetchAiVisibility(visibilityQuery());
      await client.fetchAiVisibilityCompare(compareQuery());
    } finally {
      vi.unstubAllGlobals();
    }
    expect(escaped).not.toHaveBeenCalled();
  });
});

// =============================================================================================
// THE REQUEST BODY, PER ENDPOINT — and the four things the vendor's real schema contradicts.
// =============================================================================================
describe("the request body for aggregated_metrics (ai_visibility)", () => {
  it("sends the lookup to the aggregated_metrics endpoint and nowhere else", async () => {
    const transport = endpointTransport();
    await liveClient(transport, ledger).fetchAiVisibility(visibilityQuery());
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/aggregated_metrics/live",
    );
  });

  it("wraps the single target in the vendor's ARRAY, keyed `domain` XOR `keyword`", () => {
    expect(buildAiVisibilityRequestBody(visibilityQuery()).target).toEqual([
      { domain: "example-fixture.test" },
    ]);
    expect(
      buildAiVisibilityRequestBody(visibilityQuery({ target: KEYWORD_TARGET })).target,
    ).toEqual([{ keyword: "seo software" }]);
    // ...and never both, which is what the vendor's "either domain or keyword" rule forbids.
    expect(toVendorTarget(DOMAIN_TARGET)).toEqual({ domain: "example-fixture.test" });
    expect(Object.keys(toVendorTarget(KEYWORD_TARGET))).toEqual(["keyword"]);
  });

  /**
   * FOUR THINGS THE VENDOR'S PUBLISHED SCHEMA CONTRADICTS, all pinned in one place:
   *   1. the row cap on this family is `internal_list_limit`, not `limit`;
   *   2. this endpoint publishes NO `order_by`, so none is sent;
   *   3. the locale parameter is `location_name` (STRING), not the sibling `location_code` (NUMBER);
   *   4. no `filters` key at all — the filterable field names are published only by an endpoint this
   *      repo has not read, and a rejected filter path costs a PAID failure.
   */
  it("sends the parameters this endpoint publishes, and NOT the ones siblings use", () => {
    const body = buildAiVisibilityRequestBody(visibilityQuery());
    // WAS `MAX_INTERNAL_LIST_ROWS` (100) until 2026-08-25. The PREMISE was false, not the
    // assertion style: DataForSEO publishes "maximum value: `20`" for this endpoint's
    // `internal_list_limit`, so 100 was rejected at the TASK and this tool never worked in
    // production. The pricing basis keeps its own constant; the wire keeps the vendor's.
    expect(body.internal_list_limit).toBe(VENDOR_MAX_INTERNAL_LIST_AGGREGATED);
    expect(body.platform).toBe("chat_gpt");
    expect(body.location_name).toBe("United States");
    expect(body.language_code).toBe("en");
    expect(body).not.toHaveProperty("limit");
    expect(body).not.toHaveProperty("offset");
    expect(body).not.toHaveProperty("order_by");
    expect(body).not.toHaveProperty("filters");
    expect(body).not.toHaveProperty("location_code");
    expect(body).not.toHaveProperty("targets");
  });

  it("omits the locale keys entirely when the caller supplied none", () => {
    const body = buildAiVisibilityRequestBody({
      platform: "google",
      internal_list_limit: 10,
      target: DOMAIN_TARGET,
    });
    expect(body).not.toHaveProperty("location_name");
    expect(body).not.toHaveProperty("language_code");
    expect(body.platform).toBe("google");
  });
});

describe("the request body for cross_aggregated_metrics (ai_visibility_compare)", () => {
  it("sends the comparison to the cross endpoint, as ONE request", async () => {
    const transport = endpointTransport();
    await liveClient(transport, ledger).fetchAiVisibilityCompare(compareQuery());
    expect(transport.mock.calls.length).toBe(1);
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://api.dataforseo.com/v3/ai_optimization/llm_mentions/cross_aggregated_metrics/live",
    );
  });

  /**
   * THE SINGULAR/PLURAL ASYMMETRY IS THE VENDOR'S, and it is a trap: aggregated_metrics takes
   * `target`, cross_aggregated_metrics takes `targets`, and each cross GROUP nests its own `target`
   * ARRAY beside the caller's `aggregation_key`.
   */
  it("nests each compared target under its own aggregation_key, in the vendor's shape", () => {
    const body = buildAiVisibilityCompareRequestBody(compareQuery());
    expect(body).not.toHaveProperty("target");
    expect(body.targets).toEqual([
      { aggregation_key: "our-brand", target: [{ domain: "example-fixture.test" }] },
      { aggregation_key: "rival-one", target: [{ domain: "rival-one-fixture.test" }] },
      { aggregation_key: "rival-two", target: [{ domain: "rival-two-fixture.test" }] },
    ]);
    // WAS `MAX_INTERNAL_LIST_ROWS` (100). This endpoint's published ceiling is LOWER STILL than
    // its sibling's — "maximum value: `10`" — which is exactly why one shared constant could not
    // be right for both.
    expect(body.internal_list_limit).toBe(VENDOR_MAX_INTERNAL_LIST_CROSS);
    expect(body).not.toHaveProperty("filters");
    expect(body).not.toHaveProperty("order_by");
  });

  /** The vendor's own bound, "up to 10, but not less than 2" — and exactly the signed 2-10 range. */
  it("pins the vendor's 2..10 comparison bound", () => {
    expect(MIN_COMPARE_TARGETS).toBe(2);
    expect(MAX_COMPARE_TARGETS).toBe(10);
  });

  /**
   * THE ROW CAP IS CLAMPED (money); THE COMPARISON SET IS NOT (meaning). Trimming an eleventh target
   * would answer a different question than the one paid for, and padding a single one would present
   * a comparison that never happened — so both refuse instead.
   */
  it("refuses a comparison set the vendor would reject, instead of trimming or padding it", () => {
    expect(() => validateCompareGroups([group("only", "a-fixture.test")])).toThrow(/2 and 10/);
    const eleven = Array.from({ length: 11 }, (_, index) =>
      group(`brand-${index}`, `brand-${index}-fixture.test`),
    );
    expect(() => validateCompareGroups(eleven)).toThrow(/2 and 10/);
    expect(validateCompareGroups(THREE_GROUPS)).toHaveLength(3);
  });

  it("refuses duplicate aggregation keys — the vendor's echo is what rows are matched on", () => {
    expect(() =>
      validateCompareGroups([group("same", "a-fixture.test"), group("same", "b-fixture.test")]),
    ).toThrow(/Duplicate aggregation_key/);
    expect(() =>
      validateCompareGroups([group("  ", "a-fixture.test"), group("b", "b-fixture.test")]),
    ).toThrow(/non-empty aggregation_key/);
  });

  it("books NO money when the comparison set is refused — validation runs before the reservation", async () => {
    const transport = endpointTransport();
    await expect(
      liveClient(transport, ledger).fetchAiVisibilityCompare(
        compareQuery({ groups: [group("only", "a-fixture.test")] }),
      ),
    ).rejects.toThrow(/2 and 10/);
    expect(ledger.rows()).toHaveLength(0);
    expect(transport).not.toHaveBeenCalled();
  });
});

// =============================================================================================
// THE ROW CAP IS THE PRICE — on the wire, in the estimate, and against the signed floor.
// =============================================================================================
describe("the row cap", () => {
  it("clamps into 1..100 and falls back to the signed cap on an unusable value", () => {
    expect(clampInternalListLimit(5000)).toBe(MAX_INTERNAL_LIST_ROWS);
    expect(clampInternalListLimit(101)).toBe(100);
    expect(clampInternalListLimit(0)).toBe(1);
    expect(clampInternalListLimit(-7)).toBe(1);
    expect(clampInternalListLimit(12.9)).toBe(12);
    expect(clampInternalListLimit(Number.NaN)).toBe(DEFAULT_INTERNAL_LIST_ROWS);
    expect(DEFAULT_INTERNAL_LIST_ROWS).toBe(MAX_INTERNAL_LIST_ROWS);
    expect(MAX_INTERNAL_LIST_ROWS).toBe(100);
  });

  it("enforces the cap ON THE WIRE — an over-wide request is sent capped, on both endpoints", async () => {
    const transport = endpointTransport();
    const client = liveClient(transport, createMemorySpendLedger());
    await client.fetchAiVisibility(visibilityQuery({ internal_list_limit: 5000 }));
    await client.fetchAiVisibilityCompare(compareQuery({ internal_list_limit: 5000 }));
    // The cap on the wire is the VENDOR's, per endpoint — see "the vendor's own
    // internal_list_limit ceiling" below for the measurement and for why this used to say 100.
    expect(sentBody(transport, 0).internal_list_limit).toBe(VENDOR_MAX_INTERNAL_LIST_AGGREGATED);
    expect(sentBody(transport, 1).internal_list_limit).toBe(VENDOR_MAX_INTERNAL_LIST_CROSS);
  });

  it("enforces the cap IN THE ESTIMATE — asking for more rows cannot under-reserve", () => {
    expect(estimateLlmMentionsUsd(1, 5000)).toBe(estimateLlmMentionsUsd(1, MAX_INTERNAL_LIST_ROWS));
    expect(estimateLlmMentionsUsd(1, MAX_INTERNAL_LIST_ROWS)).toBe(ESTIMATED_AI_VISIBILITY_CALL_USD);
  });

  it("errs HIGH: the estimate is strictly above the vendor's own formula, in that DIRECTION", () => {
    expect(BUDGET_SAFETY_FACTOR).toBeGreaterThan(1);
    for (const targets of [1, 2, 10]) {
      expect(estimateLlmMentionsUsd(targets, MAX_INTERNAL_LIST_ROWS)).toBeGreaterThan(
        vendorCostUsd(targets, MAX_INTERNAL_LIST_ROWS),
      );
    }
    // ...and it GROWS with the number of compared targets, because the compare tool buys more rows.
    expect(estimateLlmMentionsUsd(10, 100)).toBeGreaterThan(estimateLlmMentionsUsd(2, 100));
  });

  /**
   * THE SIGNED FLOOR. At the mandated cap the margin is 5.6x; WITHOUT the cap the same tool at the
   * vendor's 1000 rows earns 1.01x and the product is giving the money away. This spec is what turns
   * a future widening RED instead of letting it quietly erase the margin (NEVER #6).
   */
  it("holds the signed 5.6x margin at the cap — and measures the collapse without it", () => {
    const atCap = vendorCostUsd(1, MAX_INTERNAL_LIST_ROWS);
    expect(atCap).toBeCloseTo(0.2, 10);
    const margin = SIGNED_REVENUE_PER_TARGET_USD / atCap;
    expect(Math.round(margin * 10) / 10).toBe(SIGNED_MARGIN_AT_CAP);
    expect(margin).toBeGreaterThanOrEqual(SIGNED_MARGIN_BAND_FLOOR);

    // The uncapped case the signature refused to ship: 1000 rows, one request.
    const uncapped = vendorCostUsd(1, 1000);
    expect(uncapped).toBeCloseTo(1.1, 10);
    expect(SIGNED_REVENUE_PER_TARGET_USD / uncapped).toBeLessThan(SIGNED_MARGIN_BAND_FLOOR);
  });

  /**
   * The compare tool is priced PER TARGET but buys all targets in ONE request, so its worst margin
   * is at the SMALLEST comparison (2 targets) — and even there it clears the single tool's floor.
   */
  it("holds the floor for the compare tool at its worst case, 2 targets at the cap", () => {
    for (const targets of [2, 5, 10]) {
      const revenue = SIGNED_REVENUE_PER_TARGET_USD * targets;
      const margin = revenue / vendorCostUsd(targets, MAX_INTERNAL_LIST_ROWS);
      expect(margin, `${targets} targets`).toBeGreaterThanOrEqual(SIGNED_MARGIN_BAND_FLOOR);
    }
    expect(
      (SIGNED_REVENUE_PER_TARGET_USD * MIN_COMPARE_TARGETS) /
        vendorCostUsd(MIN_COMPARE_TARGETS, MAX_INTERNAL_LIST_ROWS),
    ).toBeCloseTo(7.44, 2);
  });

  it("pins the LLM-Mentions tariff — this family is not priced like Labs or Backlinks", () => {
    expect(DFS_LLM_MENTIONS_REQUEST_USD).toBe(0.1);
    expect(DFS_LLM_MENTIONS_ROW_USD).toBe(0.001);
  });
});

// =============================================================================================
// THE MONEY — reservation before HTTP, settlement per request, per-target derivation.
// =============================================================================================
describe("budget accounting", () => {
  it("reserves BEFORE any HTTP and settles with the vendor's REAL cost", async () => {
    const transport = endpointTransport();
    await liveClient(transport, ledger).fetchAiVisibility(visibilityQuery());
    const rows = ledger.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint).toBe(DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT);
    expect(rows[0]?.estimatedUsd).toBe(ESTIMATED_AI_VISIBILITY_CALL_USD);
    expect(rows[0]?.actualUsd).toBeCloseTo(0.103, 10);
  });

  it("refuses the call when the reservation is refused — no request goes out at the cap", async () => {
    const transport = endpointTransport();
    ledger.seed(2.99);
    await expect(
      liveClient(transport, ledger).fetchAiVisibility(visibilityQuery()),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  /** A response that omits `cost` must settle at THIS request's own estimate — never at $0.00. */
  it("settles at our own estimate when the vendor declined to price the request", async () => {
    const transport = endpointTransport(withoutCost(aggregatedFixture));
    const result = await liveClient(transport, ledger).fetchAiVisibility(visibilityQuery());
    expect(ledger.rows()[0]?.actualUsd).toBe(ESTIMATED_AI_VISIBILITY_CALL_USD);
    expect(ledger.rows()[0]?.actualUsd).not.toBe(0);
    expect(result.cost.vendor_cost_usd_source).toBe("our_estimate");
    expect(result.cost.vendor_cost_usd).toBe(ESTIMATED_AI_VISIBILITY_CALL_USD);
  });

  /**
   * THE MIXED CASE. A priced request beside an unpriced one must NOT book the unpriced half as free
   * — that is the exact shape a sibling slice lost real money to. Both the total AND the reported
   * SOURCE have to say so.
   */
  it("folds cost PER REQUEST: a mixed priced/unpriced set never books the unpriced half at $0.00", () => {
    const priced = { raw: aggregatedFixture, estimateUsd: 9 };
    const unpriced = { raw: withoutCost(crossFixture), estimateUsd: 7 };

    const mixed = sumSettledCostUsd([priced, unpriced]);
    expect(mixed.totalUsd).toBeCloseTo(0.103 + 7, 10);
    // The fail-open shape this replaces would have booked 0.103 + 0.
    expect(mixed.totalUsd).not.toBeCloseTo(0.103, 6);
    expect(mixed.source).toBe("partial_estimate");

    expect(sumSettledCostUsd([priced]).source).toBe("vendor_reported");
    expect(sumSettledCostUsd([priced]).totalUsd).toBeCloseTo(0.103, 10);
    expect(sumSettledCostUsd([unpriced]).source).toBe("our_estimate");
    expect(sumSettledCostUsd([unpriced]).totalUsd).toBe(7);
  });

  it("reads the cost from the task when the envelope carries none, and null when neither does", () => {
    expect(extractLlmMentionsCostUsd(aggregatedFixture)).toBeCloseTo(0.103, 10);
    expect(
      extractLlmMentionsCostUsd({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.42 }] }),
    ).toBe(0.42);
    // A vendor-sent 0 is a real 0, not a missing price.
    expect(
      extractLlmMentionsCostUsd({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000 }] }),
    ).toBe(0);
    expect(extractLlmMentionsCostUsd(withoutCost(aggregatedFixture))).toBeNull();
    expect(extractLlmMentionsCostUsd("not a response")).toBeNull();
  });

  /**
   * THE PER-TARGET DERIVATION. The signed price is 90 credits PER TARGET while the vendor sells the
   * whole comparison in ONE request, so the answer has to show that the money and the targets line
   * up rather than leave a caller to assume it.
   */
  it("derives the per-target vendor cost, and says how many requests bought it", async () => {
    const compare = await liveClient(endpointTransport(), ledger).fetchAiVisibilityCompare(
      compareQuery(),
    );
    // ONE reservation, booked against the CROSS endpoint — not N reservations, not the single one.
    expect(ledger.rows()).toHaveLength(1);
    expect(ledger.rows()[0]?.endpoint).toBe(DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT);
    expect(compare.cost.compared_target_count).toBe(3);
    expect(compare.cost.vendor_requests_issued).toBe(1);
    expect(AI_VISIBILITY_REQUESTS_PER_LOOKUP).toBe(1);
    expect(compare.cost.vendor_cost_usd).toBeCloseTo(0.104, 10);
    expect(compare.cost.vendor_cost_usd_per_target).toBeCloseTo(0.104 / 3, 10);
    expect(
      compare.cost.vendor_cost_usd_per_target * compare.cost.compared_target_count,
    ).toBeCloseTo(compare.cost.vendor_cost_usd, 10);

    const single = await liveClient(endpointTransport(), createMemorySpendLedger()).fetchAiVisibility(
      visibilityQuery(),
    );
    expect(single.cost.compared_target_count).toBe(1);
    expect(single.cost.vendor_cost_usd_per_target).toBe(single.cost.vendor_cost_usd);
  });

  it("never divides by zero, and never reports a fallback as a vendor measurement", () => {
    const accounting = buildCostAccounting(0, { totalUsd: 0.5, source: "our_estimate" });
    expect(accounting.compared_target_count).toBe(1);
    expect(accounting.vendor_cost_usd_per_target).toBe(0.5);
    expect(accounting.vendor_cost_usd_source).toBe("our_estimate");
  });
});

// =============================================================================================
// NEVER #7 — nothing is renamed, nothing is invented, and a null is not a zero.
// =============================================================================================
describe("the vendor's own fields, carried verbatim", () => {
  it("carries exactly the fixture's own scalar keys — no renaming, no additions", async () => {
    const result = await createMockAiVisibilityPort({
      aggregated: aggregatedFixture,
      crossAggregated: crossFixture,
    }).fetchAiVisibility(visibilityQuery());
    const first = result.result_set.rows[0];
    expect(Object.keys(first?.vendor_metrics ?? {}).sort()).toEqual(
      [
        "first_seen",
        "last_seen",
        "mentions_count",
        "mentions_share",
        "sources_count",
        "target",
      ].sort(),
    );
    // The nested parts are NAMED rather than silently dropped.
    expect(first?.vendor_nested_fields_not_carried).toEqual(["mentions_by_intent", "top_sources"]);
  });

  /**
   * THREE DIFFERENT ANSWERS, kept apart. On this family the gap is the whole product: "zero
   * mentions" and "the vendor did not measure mentions" are different answers to a question the
   * caller paid 90 credits for.
   */
  it("keeps vendor null, vendor zero and vendor silence distinguishable", () => {
    const parsed = parseAiVisibilityResponse(aggregatedFixture, 100);
    const [, nulls, silent] = parsed.rows;

    // Explicit vendor null: PRESENT, and null — not 0.
    expect(nulls?.vendor_metrics).toHaveProperty("mentions_share");
    expect(nulls?.vendor_metrics.mentions_share).toBeNull();
    expect(nulls?.vendor_metrics.mentions_share).not.toBe(0);
    // Explicit vendor zero: a real measurement of zero.
    expect(nulls?.vendor_metrics.mentions_count).toBe(0);
    // Vendor silence: the key is not there at all — neither null nor 0.
    expect(silent?.vendor_metrics).not.toHaveProperty("mentions_count");
    expect(silent?.vendor_metrics).not.toHaveProperty("mentions_share");
    expect(silent?.vendor_metrics.target).toBe("third-fixture.test");
  });

  it("collectVendorMetrics carries scalars and null, and names what it did not carry", () => {
    const row = collectVendorMetrics({
      a: 0,
      b: null,
      c: "x",
      d: false,
      nested: { k: 1 },
      list: [1, 2],
    });
    expect(row?.vendor_metrics).toEqual({ a: 0, b: null, c: "x", d: false });
    expect(row?.vendor_nested_fields_not_carried).toEqual(["nested", "list"]);
    expect(collectVendorMetrics("string")).toBeNull();
    expect(collectVendorMetrics(null)).toBeNull();
    expect(collectVendorMetrics([1, 2])).toBeNull();
    expect(collectVendorMetrics({})).toBeNull();
  });

  it("computes no verdict of its own — no score, no share of voice, no ranking field", async () => {
    const result = await liveClient(endpointTransport(), ledger).fetchAiVisibility(
      visibilityQuery(),
    );
    expect(result).not.toHaveProperty("visibility_score");
    expect(result).not.toHaveProperty("share_of_voice");
    expect(result).not.toHaveProperty("sentiment");
    // A sibling port carries `ordered_by_vendor_field`; this family publishes no `order_by`, so
    // claiming one here would be an ordering of OURS wearing the vendor's clothes.
    expect(result).not.toHaveProperty("ordered_by_vendor_field");
    expect(result.row_order).toBe("vendor_response_order");
    expect(ROW_ORDER).toBe("vendor_response_order");
  });

  it("does not re-sort: rows stay in the order the vendor returned them", () => {
    const parsed = parseAiVisibilityResponse(
      envelope({
        items: [{ target: "quiet.test", mentions_count: 0 }, { target: "loud.test", mentions_count: 900 }],
      }),
      100,
    );
    // A "sort by mentions descending" would put 900 first. Nothing here sorts.
    expect(parsed.rows.map((row) => row.vendor_metrics.mentions_count)).toEqual([0, 900]);
  });

  it("refuses to report a paid lookup as 'no mentions' when the items became no rows", () => {
    expect(() => parseAiVisibilityResponse(envelope({ items: ["not an object", 7] }), 100)).toThrow(
      /Refusing to report a paid lookup/,
    );
    expect(() =>
      parseAiVisibilityCompareResponse(envelope({ items: [{ mentions_count: 3 }] }), 100, ["a"]),
    ).toThrow(/aggregation_key/);
  });

  it("throws rather than reporting a failed task as an empty answer", () => {
    expect(() => parseAiVisibilityResponse({ status_code: 40401 }, 100)).toThrow(/error status/);
    expect(() =>
      parseAiVisibilityResponse({ status_code: 20000, tasks: [{ status_code: 40501 }] }, 100),
    ).toThrow(/task failed/);
  });
});

// =============================================================================================
// PAGINATION IS A CLAIM — the window is ours, the total is the vendor's.
// =============================================================================================
describe("window versus total", () => {
  it("keeps our row count and the vendor's whole-set count in differently-named fields", () => {
    const parsed = parseAiVisibilityResponse(aggregatedFixture, 100);
    expect(parsed.window_internal_list_limit).toBe(100);
    expect(parsed.window_row_count).toBe(3);
    expect(parsed.vendor_total_count).toBe(412);
    expect(parsed.rows).toHaveLength(parsed.window_row_count);
  });

  it("NEVER back-fills the total from the rows in hand", () => {
    const parsed = parseAiVisibilityResponse(
      envelope({ items: [{ target: "a.test" }, { target: "b.test" }] }),
      50,
    );
    expect(parsed.window_row_count).toBe(2);
    expect(parsed.vendor_total_count).toBeNull();
    expect(parsed.vendor_total_count).not.toBe(2);
  });

  /** No `limit`/`offset` exists on this family, so no `window_offset` is invented to imply paging. */
  it("carries no offset — this endpoint family publishes no pagination at all", () => {
    const parsed = parseAiVisibilityResponse(aggregatedFixture, 100);
    expect(parsed).not.toHaveProperty("window_offset");
    expect(Object.keys(parsed).sort()).toEqual(
      ["rows", "vendor_total_count", "window_internal_list_limit", "window_row_count"].sort(),
    );
  });

  it("an empty result is an empty window, not a throw", () => {
    const parsed = parseAiVisibilityResponse(
      { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] },
      100,
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.vendor_total_count).toBeNull();
  });
});

// =============================================================================================
// MODEL AND TIME ARE CLAIMS TOO.
// =============================================================================================
describe("the measurement scope", () => {
  it("carries the platform asked for, what it means, and the platform the vendor echoed", async () => {
    const result = await liveClient(endpointTransport(), ledger).fetchAiVisibility(
      visibilityQuery(),
    );
    expect(result.scope.platform_requested).toBe("chat_gpt");
    expect(result.scope.vendor_echoed_platform).toBe("chat_gpt");
    expect(result.scope.platform_means).toBe(PLATFORM_MEANS.chat_gpt);
    expect(result.scope.location_name).toBe("United States");
    expect(result.scope.language_code).toBe("en");
  });

  /** A one-platform measurement must not read as a general statement about "what LLMs say". */
  it("each platform's meaning names ITS OWN platform and disclaims the others", () => {
    expect(PLATFORM_MEANS.chat_gpt).toMatch(/chatgpt/i);
    expect(PLATFORM_MEANS.chat_gpt).not.toMatch(/\bgoogle\b/i);
    expect(PLATFORM_MEANS.google).toMatch(/google/i);
    expect(PLATFORM_MEANS.google).not.toMatch(/chatgpt/i);
    for (const text of Object.values(PLATFORM_MEANS)) {
      expect(text).toMatch(/says nothing about any other assistant/i);
    }
  });

  it("reports WHICH vendor key the timestamp came from", async () => {
    const result = await liveClient(endpointTransport(), ledger).fetchAiVisibility(
      visibilityQuery(),
    );
    expect(result.scope.vendor_reported_time_field).toBe("datetime");
    expect(result.scope.vendor_reported_time_value).toBe("2026-08-18 09:00:00 +00:00");
    expect(VENDOR_TIME_FIELD_CANDIDATES).toContain("datetime");
  });

  /**
   * THE ABSENCE MUST STAY VISIBLE. The cross fixture reports neither a platform echo nor a
   * timestamp, and this port substitutes NOTHING — no clock reading, no "now", no request time.
   * "We do not know when the vendor measured this" and "the vendor measured this just now" are
   * different claims, and only one of them is true here.
   */
  it("leaves an unreported model or time NULL, and never substitutes a clock reading", async () => {
    const before = Date.now();
    const result = await liveClient(endpointTransport(), ledger).fetchAiVisibilityCompare(
      compareQuery(),
    );
    expect(result.scope.vendor_echoed_platform).toBeNull();
    expect(result.scope.vendor_reported_time_field).toBeNull();
    expect(result.scope.vendor_reported_time_value).toBeNull();
    // A substituted clock reading would land in the window this spec brackets.
    const scopeText = JSON.stringify(result.scope);
    expect(scopeText).not.toMatch(new RegExp(String(new Date(before).getFullYear()) + "-\\d\\d-"));
  });

  it("extractVendorTime prefers the first candidate present and stays null when none is", () => {
    expect(extractVendorTime({ date: "2026-01-01", datetime: "2026-02-02" })).toEqual({
      field: "datetime",
      value: "2026-02-02",
    });
    expect(extractVendorTime({ last_updated_time: "2026-03-03" })).toEqual({
      field: "last_updated_time",
      value: "2026-03-03",
    });
    expect(extractVendorTime({ datetime: "" })).toEqual({ field: null, value: null });
    expect(extractVendorTime({ nothing: 1 })).toEqual({ field: null, value: null });
    expect(extractVendorTime(null)).toEqual({ field: null, value: null });
  });

  it("extractEchoedPlatform reads the vendor's echo, not our own request", () => {
    expect(extractEchoedPlatform(aggregatedFixture)).toBe("chat_gpt");
    expect(extractEchoedPlatform(envelope({}, { platform: "google" }))).toBe("google");
    expect(extractEchoedPlatform(envelope({}))).toBeNull();
    expect(extractEchoedPlatform("junk")).toBeNull();
  });
});

// =============================================================================================
// THE COMPARISON — matched by the caller's key, never by position.
// =============================================================================================
describe("comparing 2-10 targets", () => {
  it("lifts the caller's key out of the vendor metrics and keys every row by it", async () => {
    const result = await liveClient(endpointTransport(), ledger).fetchAiVisibilityCompare(
      compareQuery(),
    );
    expect(result.result_set.rows.map((row) => row.aggregation_key)).toEqual([
      "our-brand",
      "rival-one",
    ]);
    for (const row of result.result_set.rows) {
      expect(row.vendor_metrics).not.toHaveProperty(AGGREGATION_KEY_FIELD);
    }
    expect(result.result_set.rows[1]?.vendor_metrics.mentions_count).toBe(0);
    expect(result.result_set.rows[1]?.vendor_metrics.mentions_share).toBeNull();
  });

  /**
   * A target the vendor did not answer for is NAMED, not zeroed. This is the compare tool's version
   * of the null-is-not-zero rule, and it is the difference between "this rival is never mentioned"
   * and "we have no measurement for this rival".
   */
  it("names the compared targets the vendor returned no row for", async () => {
    const result = await liveClient(endpointTransport(), ledger).fetchAiVisibilityCompare(
      compareQuery(),
    );
    expect(result.groups_without_vendor_row).toEqual(["rival-two"]);
    expect(result.groups.map((entry) => entry.aggregation_key)).toEqual([
      "our-brand",
      "rival-one",
      "rival-two",
    ]);
  });

  /**
   * MATCHED BY KEY, NEVER BY POSITION. A positional match turns a vendor reordering into one
   * competitor's numbers printed under another competitor's name.
   */
  it("matches rows by the echoed key even when the vendor reorders them", () => {
    const parsed = parseAiVisibilityCompareResponse(
      envelope({
        items: [
          { aggregation_key: "rival-two", mentions_count: 5 },
          { aggregation_key: "our-brand", mentions_count: 9 },
        ],
      }),
      100,
      ["our-brand", "rival-one", "rival-two"],
    );
    // Positional logic would have called the missing one "rival-two".
    expect(parsed.groupsWithoutVendorRow).toEqual(["rival-one"]);
    expect(
      parsed.resultSet.rows.find((row) => row.aggregation_key === "our-brand")?.vendor_metrics
        .mentions_count,
    ).toBe(9);
  });

  it("reports every asked-for key as unanswered when the vendor returned no result at all", () => {
    const parsed = parseAiVisibilityCompareResponse(
      { status_code: 20000, tasks: [{ status_code: 20000, result: [] }] },
      100,
      ["a", "b"],
    );
    expect(parsed.groupsWithoutVendorRow).toEqual(["a", "b"]);
    expect(parsed.resultSet.rows).toEqual([]);
    expect(parsed.resultSet.vendor_total_count).toBeNull();
  });
});

// =============================================================================================
// The mock port — TEST-ONLY, and honest about where its cost figure came from.
// =============================================================================================
describe("the mock port", () => {
  it("serves both tools from fixtures without any transport at all", async () => {
    const port = createMockAiVisibilityPort({
      aggregated: aggregatedFixture,
      crossAggregated: crossFixture,
    });
    expect(port.enabled).toBe(true);
    const single = await port.fetchAiVisibility(visibilityQuery());
    expect(single.result_set.window_row_count).toBe(3);
    expect(single.subject).toEqual(DOMAIN_TARGET);
    const compare = await port.fetchAiVisibilityCompare(compareQuery());
    expect(compare.result_set.rows).toHaveLength(2);
    expect(compare.cost.compared_target_count).toBe(3);
  });

  it("applies the same comparison-set refusal as the live client", async () => {
    const port = createMockAiVisibilityPort({
      aggregated: aggregatedFixture,
      crossAggregated: crossFixture,
    });
    await expect(
      port.fetchAiVisibilityCompare(compareQuery({ groups: [group("one", "a-fixture.test")] })),
    ).rejects.toThrow(/2 and 10/);
  });
});

// =============================================================================================
// THE VENDOR'S OWN `internal_list_limit` CEILING — the 2026-08-25 production outage.
//
// MEASURED, not derived (signed lesson 11). DataForSEO's published request documentation for the
// two endpoints this port calls states DIFFERENT ceilings for the same field name, and neither is
// 100:
//
//   aggregated_metrics/live       "minimum value: 1  maximum value: 20  default value: 10"
//   cross_aggregated_metrics/live "minimum value: 1  maximum value: 10  default value: 5"
//
// and the field is NOT a row cap at all — the vendor's own words are "maximum number of elements
// within internal arrays ... `sources_domain` `search_results_domain`". This port sent 100 on every
// call, the vendor rejected the TASK, unwrapFirstResult threw, and the throw escaped both tools as
// "failed unexpectedly … reference <id>" while the reservation stayed open at its full estimate.
//
// These two specs are the whole outage, in the two places it has to be stopped: the number on the
// wire, and the number the surface schema advertises.
// =============================================================================================
describe("the vendor's own internal_list_limit ceiling", () => {
  it("never sends a value above the ceiling DataForSEO publishes for EACH endpoint", async () => {
    const transport = endpointTransport();
    const client = liveClient(transport, createMemorySpendLedger());
    await client.fetchAiVisibility(visibilityQuery({ internal_list_limit: 5000 }));
    await client.fetchAiVisibilityCompare(compareQuery({ internal_list_limit: 5000 }));
    expect(sentBody(transport, 0).internal_list_limit).toBeLessThanOrEqual(20);
    expect(sentBody(transport, 1).internal_list_limit).toBeLessThanOrEqual(10);
  });

  it("pins BOTH published ceilings, and pins that they are NOT the same number", () => {
    expect(VENDOR_MAX_INTERNAL_LIST_AGGREGATED).toBe(20);
    expect(VENDOR_MAX_INTERNAL_LIST_CROSS).toBe(10);
    expect(VENDOR_MAX_INTERNAL_LIST_AGGREGATED).not.toBe(VENDOR_MAX_INTERNAL_LIST_CROSS);
    // ...and that neither of them is the PRICING basis, which is what got sent for a year.
    expect(MAX_INTERNAL_LIST_ROWS).toBeGreaterThan(VENDOR_MAX_INTERNAL_LIST_AGGREGATED);
  });

  it("still lets a caller ask for FEWER than the ceiling, and never for zero or a fraction", () => {
    expect(vendorInternalListLimit(5, VENDOR_MAX_INTERNAL_LIST_AGGREGATED)).toBe(5);
    expect(vendorInternalListLimit(0, VENDOR_MAX_INTERNAL_LIST_CROSS)).toBe(1);
    expect(vendorInternalListLimit(-3, VENDOR_MAX_INTERNAL_LIST_CROSS)).toBe(1);
    expect(vendorInternalListLimit(7.9, VENDOR_MAX_INTERNAL_LIST_AGGREGATED)).toBe(7);
    expect(vendorInternalListLimit(Number.NaN, VENDOR_MAX_INTERNAL_LIST_CROSS)).toBe(
      VENDOR_MAX_INTERNAL_LIST_CROSS,
    );
  });

  /**
   * THE RESERVATION DID NOT MOVE. The wire number changed; the money did not (NEVER #6). A lookup
   * still books the signed basis, and still books it BEFORE any HTTP.
   */
  it("books the SAME estimate as before the ceiling fix — the price basis is untouched", async () => {
    const spend = createMemorySpendLedger();
    const transport = endpointTransport();
    await liveClient(transport, spend).fetchAiVisibility(visibilityQuery());
    expect(spend.rows()[0]?.estimatedUsd).toBeCloseTo(0.3, 10);
    expect(spend.rows()[0]?.estimatedUsd).toBe(ESTIMATED_AI_VISIBILITY_CALL_USD);
  });

  it("sends the vendor's ceiling even when the caller asks for the signed pricing basis", async () => {
    const transport = endpointTransport();
    const client = liveClient(transport, createMemorySpendLedger());
    await client.fetchAiVisibility(visibilityQuery({ internal_list_limit: MAX_INTERNAL_LIST_ROWS }));
    expect(sentBody(transport, 0).internal_list_limit).toBeLessThanOrEqual(20);
  });
});

// =============================================================================================
// A VENDOR THAT REFUSED IS NOT A CRASH — and a refused call must not eat the shared daily cap.
//
// Both halves of the 2026-08-25 damage report live here. The tools' half (the sentence the user
// reads) is in tools/ai-visibility.test.ts; this is the port's half: what is THROWN, and what is
// BOOKED, when DataForSEO says no.
// =============================================================================================
describe("a vendor refusal is typed, and settled at what the vendor charged", () => {
  /** The shape DataForSEO answers with when it rejects the REQUEST: HTTP 200, task status != 20000. */
  function refusedTask(cost: number | null): unknown {
    return {
      status_code: 20000,
      status_message: "Ok.",
      ...(cost === null ? {} : { cost }),
      tasks: [
        {
          status_code: 40501,
          status_message: "Invalid Field: 'internal_list_limit'.",
          ...(cost === null ? {} : { cost }),
          result: null,
        },
      ],
    };
  }

  const refusing = (body: unknown) =>
    vi.fn<DfsTransport>(async () => ({ ok: true, status: 200, json: async () => body }));

  it("throws the TYPED refusal carrying the vendor's OWN code and words, on both tools", async () => {
    const spend = createMemorySpendLedger();
    const client = liveClient(refusing(refusedTask(0)), spend);
    for (const call of [
      () => client.fetchAiVisibility(visibilityQuery()),
      () => client.fetchAiVisibilityCompare(compareQuery()),
    ]) {
      const error = await call().then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect(isLlmMentionsVendorError(error)).toBe(true);
      const typed = error as LlmMentionsVendorError;
      expect(typed.kind).toBe("vendor_status");
      expect(typed.vendorStatusCode).toBe(40501);
      expect(typed.vendorStatusMessage).toMatch(/internal_list_limit/);
    }
  });

  /**
   * THE DRAIN, CLOSED. The daily cap is $3.00, fleet-global and FAIL-CLOSED, so a reservation left
   * open at its $0.30 estimate for a call the vendor refused at $0.00 is spend that never happened
   * blocking tools that work. Ten of them filled the cap; that is how one broken tool took the
   * whole paid surface down for a day.
   */
  it("settles a refused call at the vendor's own price, so ten refusals cannot fill the cap", async () => {
    const spend = createMemorySpendLedger();
    const client = liveClient(refusing(refusedTask(0)), spend);
    for (let i = 0; i < 10; i += 1) {
      await client.fetchAiVisibility(visibilityQuery()).catch(() => undefined);
    }
    expect(spend.rows()).toHaveLength(10);
    for (const row of spend.rows()) expect(row.actualUsd).toBe(0);
    expect(await spend.todayUsd()).toBe(0);
    // ...and the cap is still open for a call that would work.
    await expect(spend.reserve(0.3, "next")).resolves.toBeTruthy();
  });

  /** A vendor that DID charge for its refusal is settled at THAT, not at $0.00 and not at estimate. */
  it("settles at the vendor's figure when the refusal carried one", async () => {
    const spend = createMemorySpendLedger();
    await liveClient(refusing(refusedTask(0.07)), spend)
      .fetchAiVisibility(visibilityQuery())
      .catch(() => undefined);
    expect(spend.rows()[0]?.actualUsd).toBeCloseTo(0.07, 10);
  });

  /**
   * THE CONSERVATIVE DIRECTION IS UNCHANGED where it has to be. A response nobody could read
   * prices nothing, so the reservation stays OPEN at its estimate rather than being settled at a
   * number nobody measured — erring toward refusing the next call, which is the direction the
   * budget guard must never get wrong.
   */
  it("leaves the reservation OPEN at its estimate when nothing priced the failure", async () => {
    const spend = createMemorySpendLedger();
    const noPrice = vi.fn<DfsTransport>(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    const error = await liveClient(noPrice, spend)
      .fetchAiVisibility(visibilityQuery())
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );
    expect(isLlmMentionsVendorError(error)).toBe(true);
    expect((error as LlmMentionsVendorError).kind).toBe("transport");
    expect((error as LlmMentionsVendorError).vendorStatusCode).toBeNull();
    expect(spend.rows()[0]?.actualUsd).toBeNull();
    expect(await spend.todayUsd()).toBeCloseTo(ESTIMATED_AI_VISIBILITY_CALL_USD, 10);
  });

  /** A 20000 envelope whose body this port cannot read is its OWN state — never "no mentions". */
  it("separates an unreadable body from a vendor refusal", async () => {
    const spend = createMemorySpendLedger();
    const unreadable = refusing({
      status_code: 20000,
      cost: 0.1,
      tasks: [{ status_code: 20000, result: [{ items: [{}] }] }],
    });
    const error = await liveClient(unreadable, spend)
      .fetchAiVisibility(visibilityQuery())
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );
    expect(isLlmMentionsVendorError(error)).toBe(true);
    expect((error as LlmMentionsVendorError).kind).toBe("unreadable_response");
    expect((error as LlmMentionsVendorError).detail).toMatch(/no mentions found/i);
  });

  it("extractVendorRefusal reads the TASK's verdict first, and stays silent on a good response", () => {
    expect(extractVendorRefusal(refusedTask(0))).toEqual({
      code: 40501,
      message: "Invalid Field: 'internal_list_limit'.",
    });
    expect(extractVendorRefusal({ status_code: 40401, status_message: "Not Found." })).toEqual({
      code: 40401,
      message: "Not Found.",
    });
    expect(extractVendorRefusal(aggregatedFixture)).toEqual({ code: null, message: null });
  });
});
