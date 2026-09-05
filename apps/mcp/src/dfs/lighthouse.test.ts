import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_SAFETY_FACTOR,
  CORE_METRIC_AUDITS,
  CORE_VITAL_THRESHOLDS,
  DFS_LIGHTHOUSE_ENDPOINT,
  DFS_REQUEST_TIMEOUT_MS,
  LIGHTHOUSE_PAGE_USD,
  LIGHTHOUSE_REQUEST_TIMEOUT_MS,
  MAX_OPPORTUNITIES,
  MAX_SPEED_URLS,
  createLiveSpeedClient,
  createMockSpeedPort,
  disabledSpeedPort,
  estimateLighthouseUsd,
  extractLighthouseCostUsd,
  parseLighthouseResponse,
  rateCoreVital,
  resolveDefaultSpeedPort,
  type DfsTimedTransport,
} from "./lighthouse.ts";
import { createMemorySpendLedger, todaySpendUsd, type MemorySpendLedger } from "./budget.ts";
import fixtureResponse from "./fixtures/lighthouse.json";

/**
 * Unit proofs for the DataForSEO Lighthouse port. NO real HTTP call is ever made (constitution
 * NEVER #5): the live path is driven only through an injected fake transport, and the
 * env-resolution path through pinned env sources.
 *
 * The fixture mirrors the Lighthouse result DataForSEO passes through, and four of its details
 * are deliberate rather than incidental — each one exists so an honesty rule can be PROVEN on the
 * real fixture rather than only on a hand-built object:
 *   - `speed-index` is ABSENT, so "a metric the vendor did not send prints no line" is measurable.
 *   - `interactive` carries a numericValue but NO displayValue, so the numeric fallback is real.
 *   - `uses-long-cache-ttl` is an opportunity with `overallSavingsMs: 0`, and `viewport` is an
 *     audit whose details are not an opportunity at all.
 *   - the result's own keys are the vendor's REAL ones — `lighthouseVersion`, `requestedUrl`,
 *     `finalUrl`, `fetchTime` (B-1). They used to be snake_case, which DataForSEO does not send:
 *     the parser therefore read null for all four in production, the provenance line was never
 *     printed on any live call, and a redirect could never be detected — while this fixture kept
 *     the whole suite green. The camelCase shape is the documented one
 *     (https://docs.dataforseo.com/v3/on_page/lighthouse/live/json/, read 2026-09-02: the result
 *     carries "lighthouseVersion", "requestedUrl", "mainDocumentUrl", "finalDisplayedUrl",
 *     "finalUrl", "fetchTime"); only the REQUEST parameters are snake_case.
 */

const URL_UNDER_TEST = "https://slowshop.org/";

let ledger: MemorySpendLedger;
beforeEach(() => {
  ledger = createMemorySpendLedger();
});

describe("parseLighthouseResponse", () => {
  it("projects the page identity, the provenance and the performance score", () => {
    const page = parseLighthouseResponse(fixtureResponse, URL_UNDER_TEST);
    expect(page.requested_url).toBe("https://slowshop.org/");
    expect(page.final_url).toBe("https://www.slowshop.org/");
    expect(page.fetch_time).toBe("2026-08-17T09:12:44.831Z");
    expect(page.lighthouse_version).toBe("11.4.0");
    // Kept on Lighthouse's own 0–1 scale here; the 0–100 presentation is the renderer's job.
    expect(page.performance_score).toBe(0.41);
  });

  /**
   * B-1, the axis the fixture used to hide. The provenance fields are read from the keys the
   * vendor ACTUALLY sends, and this spec hands the parser an object carrying ONLY those keys —
   * so it cannot pass by way of a snake_case sibling the way the old fixture let it.
   */
  it("reads the provenance from the vendor's camelCase keys (B-1)", () => {
    const page = parseLighthouseResponse(
      {
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [
              {
                lighthouseVersion: "13.0.3",
                requestedUrl: "https://slowshop.org/",
                finalUrl: "https://www.slowshop.org/",
                fetchTime: "2026-03-25T13:27:53.339Z",
              },
            ],
          },
        ],
      },
      URL_UNDER_TEST,
    );
    expect(page.lighthouse_version).toBe("13.0.3");
    expect(page.fetch_time).toBe("2026-03-25T13:27:53.339Z");
    expect(page.requested_url).toBe("https://slowshop.org/");
    // The redirect axis, which was equally unreachable: a page measured at a DIFFERENT URL from
    // the one paid for must be attributable, and `finalUrl` is the only thing that says so.
    expect(page.final_url).toBe("https://www.slowshop.org/");
  });

  /**
   * The transition half of the same fix. Nothing observed sends snake_case here, but the aliases
   * cost one line each and the alternative is a paid measurement thrown away on the day a vendor
   * (or a proxy) hands back the other convention.
   */
  it("still accepts a snake_case body, so neither convention loses the provenance (B-1)", () => {
    const page = parseLighthouseResponse(
      {
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [
              {
                lighthouse_version: "11.4.0",
                requested_url: "https://slowshop.org/",
                final_url: "https://www.slowshop.org/",
                fetch_time: "2026-08-17T09:12:44.831Z",
              },
            ],
          },
        ],
      },
      URL_UNDER_TEST,
    );
    expect(page.lighthouse_version).toBe("11.4.0");
    expect(page.fetch_time).toBe("2026-08-17T09:12:44.831Z");
    expect(page.final_url).toBe("https://www.slowshop.org/");
  });

  it("carries the vendor's own formatted value for every metric that has one", () => {
    const page = parseLighthouseResponse(fixtureResponse, URL_UNDER_TEST);
    expect(page.metrics.map((metric) => [metric.id, metric.display])).toEqual([
      ["first-contentful-paint", "3.2 s"],
      ["largest-contentful-paint", "6.1 s"],
      ["total-blocking-time", "890 ms"],
      ["cumulative-layout-shift", "0.19"],
      ["interactive", null],
    ]);
  });

  /**
   * THE rule this tool exists under. A speed report is read as a scorecard, and a fabricated zero
   * on a speed axis reads as the BEST possible news — the one direction of lie a reader will not
   * question. So an unmeasured metric contributes no row at all, not a zero and not an "n/a".
   */
  it("omits a metric the vendor did not return — never a zero row", () => {
    const page = parseLighthouseResponse(fixtureResponse, URL_UNDER_TEST);
    expect(page.metrics.map((metric) => metric.id)).not.toContain("speed-index");
    // …and the omission is not the parser dropping everything: the rest is present.
    expect(page.metrics).toHaveLength(5);
  });

  /**
   * A DIFFERENT axis from the missing-audit case above, and the one that was measured to be
   * unprotected: Lighthouse LISTS an audit it could not run (`scoreDisplayMode: "notApplicable"`)
   * with neither a formatted nor a numeric value. Removing the value-less guard left every spec
   * green, and the renderer's obvious `?? 0` fallback would then have printed "Speed Index: 0 ms"
   * — a perfect score for a metric that was never measured.
   */
  it("drops a metric the vendor LISTED but put no value in", () => {
    const page = parseLighthouseResponse(
      {
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [
              {
                audits: {
                  "speed-index": { id: "speed-index", title: "Speed Index", score: null },
                },
              },
            ],
          },
        ],
      },
      URL_UNDER_TEST,
    );
    expect(page.metrics).toEqual([]);
  });

  /**
   * The same axis at the PARSER end, in its KEEP direction: an audit whose only value is 0 must
   * survive. `!display && !numeric` would satisfy the type checker and drop a Total Blocking Time
   * of 0 ms — the best result that metric can have — so the guard is written against null.
   */
  it("KEEPS a metric whose only value is a real zero", () => {
    const page = parseLighthouseResponse(
      {
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [
              {
                audits: {
                  "total-blocking-time": {
                    id: "total-blocking-time",
                    title: "Total Blocking Time",
                    numericValue: 0,
                  },
                },
              },
            ],
          },
        ],
      },
      URL_UNDER_TEST,
    );
    expect(page.metrics).toHaveLength(1);
    expect(page.metrics[0]?.numeric).toBe(0);
  });

  it("keeps a raw numeric value when the vendor sent no formatted string", () => {
    const page = parseLighthouseResponse(fixtureResponse, URL_UNDER_TEST);
    const tti = page.metrics.find((metric) => metric.id === "interactive");
    expect(tti?.numeric).toBe(9412.7);
    expect(tti?.display).toBeNull();
    expect(tti?.unit).toBe("ms");
  });

  it("reports metrics in the declared order, whatever order the vendor's object happens to be in", () => {
    const page = parseLighthouseResponse(fixtureResponse, URL_UNDER_TEST);
    const declared = CORE_METRIC_AUDITS.map((metric) => metric.id);
    const reported = page.metrics.map((metric) => metric.id);
    expect(reported).toEqual(declared.filter((id) => reported.includes(id)));
  });

  it("lists opportunities largest-saving first and drops zero-saving ones", () => {
    const page = parseLighthouseResponse(fixtureResponse, URL_UNDER_TEST);
    expect(page.opportunities).toEqual([
      {
        id: "render-blocking-resources",
        title: "Eliminate render-blocking resources",
        savings_ms: 1840,
      },
      { id: "unused-javascript", title: "Reduce unused JavaScript", savings_ms: 620 },
    ]);
  });

  /**
   * B-7 — the axis `savings <= 0` cannot see. Lighthouse keeps emitting an opportunity audit
   * after the page PASSES it: the score goes to 1, the title flips to the past tense, and the
   * saving stays positive. Measured live on 2026-09-02, where the second run of the same page
   * printed "Initial server response time was short — an estimated 180 ms saved" under a heading
   * reading "Biggest opportunities" — i.e. the report told the customer to fix something
   * Lighthouse had just told it was already done.
   *
   * `score` was parsed and then never read, so this needed no new field, only the missing filter.
   */
  it("drops an opportunity Lighthouse already PASSED, even with a positive saving (B-7)", () => {
    const page = parseLighthouseResponse(fixtureResponse, URL_UNDER_TEST);
    expect(page.opportunities.map((opportunity) => opportunity.id)).not.toContain(
      "server-response-time",
    );
  });

  /**
   * The other side of that filter, and the one a "score >= 0.9" reading would get wrong: an
   * opportunity the vendor scored NOT AT ALL is unjudged, not passed. Dropping it would hide a
   * real saving, which is the opposite failure and the more expensive one.
   */
  it("KEEPS an opportunity whose score the vendor omitted — unscored is not passed (B-7)", () => {
    const page = parseLighthouseResponse(
      {
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [
              {
                audits: {
                  "uses-responsive-images": {
                    id: "uses-responsive-images",
                    title: "Properly size images",
                    details: { type: "opportunity", overallSavingsMs: 300 },
                  },
                  "modern-image-formats": {
                    id: "modern-image-formats",
                    title: "Serve images in next-gen formats",
                    score: 0.99,
                    details: { type: "opportunity", overallSavingsMs: 120 },
                  },
                },
              },
            ],
          },
        ],
      },
      URL_UNDER_TEST,
    );
    // …and 0.99 is kept too: the boundary is "passed" (exactly 1), not "nearly passed".
    expect(page.opportunities.map((opportunity) => opportunity.id)).toEqual([
      "uses-responsive-images",
      "modern-image-formats",
    ]);
  });

  it("ignores audits that are not opportunities at all", () => {
    const page = parseLighthouseResponse(fixtureResponse, URL_UNDER_TEST);
    // `viewport` carries details of type "debugdata" and no saving estimate.
    expect(page.opportunities.map((opportunity) => opportunity.id)).not.toContain("viewport");
  });

  it(`caps the opportunity list at ${MAX_OPPORTUNITIES}, keeping the biggest`, () => {
    const audits = Object.fromEntries(
      Array.from({ length: MAX_OPPORTUNITIES + 3 }, (_, index) => [
        `opportunity-${index}`,
        {
          id: `opportunity-${index}`,
          title: `Opportunity ${index}`,
          details: { type: "opportunity", overallSavingsMs: (index + 1) * 100 },
        },
      ]),
    );
    const page = parseLighthouseResponse(
      { status_code: 20000, tasks: [{ status_code: 20000, result: [{ audits }] }] },
      URL_UNDER_TEST,
    );
    expect(page.opportunities).toHaveLength(MAX_OPPORTUNITIES);
    expect(page.opportunities[0]?.savings_ms).toBe((MAX_OPPORTUNITIES + 3) * 100);
  });

  /**
   * A page Lighthouse could not score is a real outcome (the category errors out). It must stay
   * null all the way to the renderer, which says so in words — a 0 here would print "0 / 100",
   * i.e. a measured catastrophe, for a page that was never measured.
   */
  it("keeps a missing performance score NULL rather than scoring the page zero", () => {
    const page = parseLighthouseResponse(
      {
        status_code: 20000,
        tasks: [{ status_code: 20000, result: [{ categories: { performance: { score: null } } }] }],
      },
      URL_UNDER_TEST,
    );
    expect(page.performance_score).toBeNull();
    expect(page.metrics).toEqual([]);
    expect(page.opportunities).toEqual([]);
  });

  it("falls back to the URL we asked for when the vendor echoes none", () => {
    const page = parseLighthouseResponse(
      { status_code: 20000, tasks: [{ status_code: 20000, result: [{}] }] },
      URL_UNDER_TEST,
    );
    expect(page.requested_url).toBe(URL_UNDER_TEST);
    expect(page.final_url).toBeNull();
  });

  it("throws on a failed top-level status rather than reporting an unmeasured page", () => {
    expect(() =>
      parseLighthouseResponse({ status_code: 40501, status_message: "Invalid Field" }, URL_UNDER_TEST),
    ).toThrow(/40501/);
  });

  it("throws on a failed TASK status — a paid-but-failed run is not 'no data'", () => {
    expect(() =>
      parseLighthouseResponse(
        { status_code: 20000, tasks: [{ status_code: 40401, status_message: "Not Found" }] },
        URL_UNDER_TEST,
      ),
    ).toThrow(/40401/);
  });

  it("throws when the task succeeded but carried no result", () => {
    expect(() =>
      parseLighthouseResponse({ status_code: 20000, tasks: [{ status_code: 20000, result: [] }] }, URL_UNDER_TEST),
    ).toThrow(/no Lighthouse result/i);
  });
});

/**
 * B-4 — the bands, and the ONE place their numbers live. Measured 2026-09-02: the code carried no
 * threshold at all, so LCP 2.9 s and LCP 2.4 s were printed in the same voice and the customer
 * could not tell from the output which of them crossed the line.
 *
 * Every boundary is pinned to a LITERAL rather than to the constant it came from. A spec written
 * against `CORE_VITAL_THRESHOLDS.…good` moves with any edit to the table and would report a
 * changed Google threshold as green — and these are SOURCED numbers (reference list R-1.1/R-1.3,
 * web.dev/articles/vitals, 2026-09-02), so they must fail loudly exactly the way the TOOL_COSTS
 * table does.
 */
describe("the Core Web Vitals bands (B-4)", () => {
  it("pins the sourced thresholds: LCP 2,500/4,000 ms (R-1.1), CLS 0.1/0.25 (R-1.3)", () => {
    expect(CORE_VITAL_THRESHOLDS["largest-contentful-paint"]).toEqual({
      good: 2500,
      needsImprovement: 4000,
    });
    expect(CORE_VITAL_THRESHOLDS["cumulative-layout-shift"]).toEqual({
      good: 0.1,
      needsImprovement: 0.25,
    });
    // D-1's 2.0 s is a blog claim the primary source contradicts; it must never reach the code.
    expect(CORE_VITAL_THRESHOLDS["largest-contentful-paint"]?.good).not.toBe(2000);
  });

  it.each([
    [2400, "good"],
    [2500, "good"],
    [2501, "needs improvement"],
    [2900, "needs improvement"],
    [4000, "needs improvement"],
    [4001, "poor"],
  ])("rates an LCP of %d ms as %s", (numeric, rating) => {
    expect(rateCoreVital("largest-contentful-paint", numeric)).toBe(rating);
  });

  it.each([
    [0, "good"],
    [0.1, "good"],
    [0.11, "needs improvement"],
    [0.25, "needs improvement"],
    [0.26, "poor"],
  ])("rates a CLS of %s as %s", (numeric, rating) => {
    expect(rateCoreVital("cumulative-layout-shift", numeric)).toBe(rating);
  });

  /**
   * The silences, and each one is a rule rather than an omission: a metric with no PUBLISHED
   * threshold gets no verdict, and neither does one the vendor sent no number for. Rating either
   * "good" by default would be the fabricated-good-news lie this whole tool is written against.
   *
   * INP is the case worth naming: R-1.2 does publish 200 ms for it, and it is still absent here
   * because Lighthouse is a LAB tool and produces no INP to rate.
   */
  it.each([
    ["interaction-to-next-paint", 150],
    ["first-contentful-paint", 1000],
    ["speed-index", 1600],
    ["total-blocking-time", 0],
    ["interactive", 2900],
  ])("gives %s no band — no published threshold applies to it here", (id, numeric) => {
    expect(rateCoreVital(id, numeric)).toBeNull();
  });

  it("gives no band when the vendor sent no raw number to compare", () => {
    expect(rateCoreVital("largest-contentful-paint", null)).toBeNull();
  });
});

describe("extractLighthouseCostUsd", () => {
  it("reads the real cost the vendor reported", () => {
    expect(extractLighthouseCostUsd(fixtureResponse)).toBe(0.005);
  });

  it("falls back to the task cost, then to null", () => {
    expect(extractLighthouseCostUsd({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.007 }] })).toBe(0.007);
    expect(extractLighthouseCostUsd("not a response")).toBeNull();
  });

  /**
   * The null-vs-0 axis on the MONEY side. A vendor cost of 0 is a real answer (a cached or
   * comped task), and `||` in place of either `??` here would silently promote it — first to the
   * task's cost, then to the per-page list price. The day's budget would then count spend that
   * did not happen, and refuse a later caller for it.
   */
  it("treats a real zero cost as ZERO, not as 'no cost reported'", () => {
    expect(
      extractLighthouseCostUsd({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, cost: 0.9 }] }),
    ).toBe(0);
  });
});

describe("estimateLighthouseUsd", () => {
  it("scales with the page count, because the vendor's price does", () => {
    expect(estimateLighthouseUsd(1)).toBeCloseTo(LIGHTHOUSE_PAGE_USD * BUDGET_SAFETY_FACTOR, 10);
    expect(estimateLighthouseUsd(5)).toBeCloseTo(5 * LIGHTHOUSE_PAGE_USD * BUDGET_SAFETY_FACTOR, 10);
    // The shape that matters: five pages must reserve five times one page, not once.
    expect(estimateLighthouseUsd(5)).toBeCloseTo(5 * estimateLighthouseUsd(1), 10);
  });

  it("always reserves at least the listed price (the gate errs toward blocking)", () => {
    for (let pages = 1; pages <= MAX_SPEED_URLS; pages += 1) {
      expect(estimateLighthouseUsd(pages)).toBeGreaterThan(pages * LIGHTHOUSE_PAGE_USD);
    }
  });
});

describe("the live client's deadline (the whole reason this port exists separately)", () => {
  const okResponse = { ok: true, status: 200, json: async () => fixtureResponse };

  it("passes its OWN deadline on every request, not the shared 30 s one", async () => {
    const deadlines: (number | undefined)[] = [];
    const transport: DfsTimedTransport = async (_url, _init, timeoutMs) => {
      deadlines.push(timeoutMs);
      return okResponse;
    };
    const port = createLiveSpeedClient({ login: "u", password: "p", transport, ledger });
    await port.fetchPageSpeed([URL_UNDER_TEST, "https://slowshop.org/pricing"]);
    expect(deadlines).toEqual([LIGHTHOUSE_REQUEST_TIMEOUT_MS, LIGHTHOUSE_REQUEST_TIMEOUT_MS]);
  });

  it("gives a Lighthouse run strictly more time than the shared DataForSEO deadline", () => {
    // Pinned as a RELATION, not a value, so the number can be retuned without a spec rewrite —
    // what must not silently regress is that a headless-Chrome page load inherited the deadline
    // sized for a database lookup.
    expect(LIGHTHOUSE_REQUEST_TIMEOUT_MS).toBeGreaterThan(DFS_REQUEST_TIMEOUT_MS);
  });

  /**
   * The arithmetic the module header justifies the number with. Sequential fan-out at this
   * deadline would run MAX_SPEED_URLS times longer than one request; concurrency is what makes it
   * affordable, so the two are pinned TOGETHER: raising the deadline past the envelope, or losing
   * the concurrency, each break this.
   */
  it("issues the whole fan-out concurrently, so the operation costs ONE deadline, not five", async () => {
    let inFlight = 0;
    let peak = 0;
    const transport: DfsTimedTransport = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return okResponse;
    };
    const port = createLiveSpeedClient({ login: "u", password: "p", transport, ledger });
    const urls = Array.from({ length: MAX_SPEED_URLS }, (_, index) => `https://slowshop.org/p${index}`);
    await port.fetchPageSpeed(urls);
    expect(peak).toBe(MAX_SPEED_URLS);
  });

  it("honours an injected deadline, so a hung request cannot hold the reserved call open", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    try {
      const port = createLiveSpeedClient({ login: "u", password: "p", ledger, timeoutMs: 10 });
      await expect(port.fetchPageSpeed([URL_UNDER_TEST])).rejects.toThrowError(/timeout|abort/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("createLiveSpeedClient (budget accounting)", () => {
  const okTransport: DfsTimedTransport = async () => ({
    ok: true,
    status: 200,
    json: async () => fixtureResponse,
  });

  it("reserves BEFORE the requests and settles with the real total afterwards", async () => {
    const port = createLiveSpeedClient({ login: "u", password: "p", transport: okTransport, ledger });
    await port.fetchPageSpeed([URL_UNDER_TEST, "https://slowshop.org/pricing"]);

    const rows = ledger.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint).toBe(DFS_LIGHTHOUSE_ENDPOINT);
    expect(rows[0]?.estimatedUsd).toBeCloseTo(estimateLighthouseUsd(2), 10);
    // Two responses, each reporting the vendor's real 0.005 — settled at their SUM, not the estimate.
    expect(rows[0]?.actualUsd).toBeCloseTo(0.01, 10);
    expect(rows[0]?.rowCount).toBe(2);
    expect(await todaySpendUsd(ledger)).toBeCloseTo(0.01, 10);
  });

  /**
   * …and the same zero, all the way through to the settlement. `extractLighthouseCostUsd(raw) ??
   * LIGHTHOUSE_PAGE_USD` must keep a reported 0; with `||` the day would be charged the list
   * price for a call the vendor did not bill, i.e. the budget would refuse a later caller over
   * money nobody spent.
   */
  it("settles a zero-cost response at ZERO, not at the per-page list price", async () => {
    const freeResponse = { ...fixtureResponse, cost: 0, tasks: [{ ...fixtureResponse.tasks[0], cost: 0 }] };
    const transport: DfsTimedTransport = async () => ({
      ok: true,
      status: 200,
      json: async () => freeResponse,
    });
    const port = createLiveSpeedClient({ login: "u", password: "p", transport, ledger });
    await port.fetchPageSpeed([URL_UNDER_TEST]);
    expect(ledger.rows()[0]?.actualUsd).toBe(0);
    expect(await todaySpendUsd(ledger)).toBe(0);
  });

  /**
   * The other half of that same `??`, and the fail-open direction: a response that omits `cost`
   * entirely still cost money, so booking it at $0.00 under-counts the day and the $3/day guard
   * then lets through spending it never saw. The zero-cost spec above cannot catch this — a
   * reported 0 is extracted as 0, so the fallback never runs — and replacing the fallback with
   * `?? 0` left all 35 specs in this file green (measured 2026-08-19).
   *
   * The fan-out makes the MIXED case reachable here too: one page priced, the other not. Because
   * the fallback is applied PER REQUEST inside `measure`, the unpriced page contributes its own
   * page price rather than disappearing into a sum that is already > 0.
   */
  it("falls back to the per-page list price for each response that omits its cost", async () => {
    const costless = structuredClone(fixtureResponse) as { cost?: number; tasks: { cost?: number }[] };
    delete costless.cost;
    for (const task of costless.tasks) delete task.cost;
    // The PRICED half reports a cost the list price cannot produce, and that is the whole point
    // of this spec rather than a detail of it. The fixture's own cost is $0.005 — the SAME number
    // as LIGHTHOUSE_PAGE_USD — so a mixed sum built on the fixture is 0.01 whether the code prices
    // each half correctly, prices BOTH at the fallback, or prices BOTH at the vendor cost. Against
    // equal halves the sum cannot tell them apart, so the assertion could not fail for the reason
    // it exists (measured 2026-08-24: both mutations left the fixture-based version GREEN).
    const VENDOR_COST_USD = 0.007;
    expect(VENDOR_COST_USD).not.toBe(LIGHTHOUSE_PAGE_USD); // the discrimination this spec rests on
    const priced = structuredClone(fixtureResponse) as { cost: number; tasks: { cost: number }[] };
    priced.cost = VENDOR_COST_USD;
    for (const task of priced.tasks) task.cost = VENDOR_COST_USD;
    const transport: DfsTimedTransport = async (_url, init) => ({
      ok: true,
      status: 200,
      json: async () => (init.body.includes("/pricing") ? costless : priced),
    });
    const port = createLiveSpeedClient({ login: "u", password: "p", transport, ledger });
    await port.fetchPageSpeed([URL_UNDER_TEST, "https://slowshop.org/pricing"]);

    // The priced page at its real cost + the unpriced page at LIGHTHOUSE_PAGE_USD — never at 0,
    // and reachable by NO other pairing: 2x the vendor cost is 0.014 and 2x the list price 0.010.
    expect(ledger.rows()[0]?.actualUsd).toBeCloseTo(VENDOR_COST_USD + LIGHTHOUSE_PAGE_USD, 10);
    expect(await todaySpendUsd(ledger)).toBeGreaterThan(VENDOR_COST_USD);

    // …and with BOTH pages unpriced, both are still booked.
    const bothLedger = createMemorySpendLedger();
    const allCostless: DfsTimedTransport = async () => ({
      ok: true,
      status: 200,
      json: async () => costless,
    });
    const bothPort = createLiveSpeedClient({
      login: "u",
      password: "p",
      transport: allCostless,
      ledger: bothLedger,
    });
    await bothPort.fetchPageSpeed([URL_UNDER_TEST, "https://slowshop.org/pricing"]);
    expect(bothLedger.rows()[0]?.actualUsd).toBeCloseTo(2 * LIGHTHOUSE_PAGE_USD, 10);
  });

  it("refuses the whole lookup at the daily cap, before any request goes out", async () => {
    let requests = 0;
    const counting: DfsTimedTransport = async () => {
      requests += 1;
      return { ok: true, status: 200, json: async () => fixtureResponse };
    };
    ledger.seed(2.999);
    const port = createLiveSpeedClient({ login: "u", password: "p", transport: counting, ledger });
    await expect(port.fetchPageSpeed([URL_UNDER_TEST])).rejects.toThrow(/daily budget exceeded/i);
    expect(requests).toBe(0);
  });

  /**
   * A failed page fails the whole lookup, and the reservation is SETTLED AT ITS OWN ESTIMATE
   * (DK-3, 2026-09-05) rather than left open to carry the same number. The reason for the number
   * is untouched and is why it is the estimate and not the responses that came back: a run that
   * timed out may still have been billed by the vendor, so settling at "the cost of the responses
   * that came back" would UNDER-count the day — the one direction the budget guard must never err
   * in. The two assertions that carry that argument are kept verbatim below; what changed is that
   * `status=open` stops doubling as a headstone.
   */
  it("fails the whole lookup when one page fails, settling the reservation at its estimate", async () => {
    const flaky: DfsTimedTransport = async (_url, init) =>
      init.body.includes("/broken")
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => fixtureResponse };
    const port = createLiveSpeedClient({ login: "u", password: "p", transport: flaky, ledger });

    await expect(
      port.fetchPageSpeed([URL_UNDER_TEST, "https://slowshop.org/broken"]),
    ).rejects.toThrow(/HTTP 500/);

    const rows = ledger.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actualUsd).toBeCloseTo(estimateLighthouseUsd(2), 10); // closed, at the estimate
    expect(rows[0]?.rowCount).toBe(0); // this call delivered no page to anybody
    expect(rows[0]?.estimatedUsd).toBeCloseTo(estimateLighthouseUsd(2), 10);
    // The settled reservation is never LESS than what could really have been spent.
    expect(rows[0]?.estimatedUsd).toBeGreaterThan(2 * LIGHTHOUSE_PAGE_USD);
    // ...and today's total is the identical number the open row already counted as (0014's
    // `coalesce(actual_usd, estimated_usd)`), which is the proof the $3 cap did not move.
    expect(await ledger.todayUsd()).toBeCloseTo(estimateLighthouseUsd(2), 10);
  });

  /**
   * EXACTLY ONE SETTLEMENT ON EITHER PATH. Settling the failure in a `finally` would reach the
   * healthy lookup too, after its real-cost settlement; `settleSpend` swallows the resulting
   * "already settled" rejection, so the row would live on carrying the estimate instead of the
   * real cost and nothing would go red. The memory ledger rejects a double settle, which is what
   * makes this assertion mean it.
   */
  it("settles a healthy lookup at its REAL cost, not at the failure estimate", async () => {
    const port = createLiveSpeedClient({
      login: "u",
      password: "p",
      transport: async () => ({ ok: true, status: 200, json: async () => fixtureResponse }),
      ledger,
    });
    await port.fetchPageSpeed([URL_UNDER_TEST]);
    const rows = ledger.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actualUsd).not.toBeCloseTo(estimateLighthouseUsd(1), 10);
    expect(rows[0]?.rowCount).toBe(1);
  });

  /** Every request body this port sent, parsed, for the two specs below. */
  async function recordedBodies(): Promise<readonly Record<string, unknown>[]> {
    const bodies: string[] = [];
    const recording: DfsTimedTransport = async (url, init) => {
      expect(url).toBe(DFS_LIGHTHOUSE_ENDPOINT);
      bodies.push(init.body);
      return { ok: true, status: 200, json: async () => fixtureResponse };
    };
    const port = createLiveSpeedClient({ login: "u", password: "p", transport: recording, ledger });
    await port.fetchPageSpeed([URL_UNDER_TEST, "https://slowshop.org/pricing"]);
    return bodies.map((body) => (JSON.parse(body) as Record<string, unknown>[])[0] ?? {});
  }

  it("sends one request per URL, each naming that URL and pinning both result flags", async () => {
    const bodies = await recordedBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual({
      url: URL_UNDER_TEST,
      enable_javascript: true,
      for_mobile: false,
    });
    expect(bodies[1]).toEqual({
      url: "https://slowshop.org/pricing",
      enable_javascript: true,
      for_mobile: false,
    });
  });

  /**
   * B-9, the half the copy alone could not carry. The heading tells the reader these are desktop
   * numbers; until this flag was sent, that sentence rested on the VENDOR'S DEFAULT rather than on
   * anything in our request — true as documented on 2026-09-02, and true only for as long as
   * DataForSEO keeps a default we do not control and never asserted.
   *
   * `for_mobile: false` is the documented desktop setting ("if set to `false`, the results will be
   * provided for desktop … default value: `false`" —
   * https://docs.dataforseo.com/v3/on_page/lighthouse/live/json/, read 2026-09-02). It buys nothing
   * extra: still one run per URL, so the price and MAX_SPEED_URLS are untouched (NEVER #6). Adding
   * the MOBILE axis would be the opposite — two runs per URL — and that is a price decision.
   *
   * PRESENT-AND-FALSE is asserted separately from the value, because presence is the actual claim.
   * The `toEqual` above happens to catch a missing key today, but only as a side effect of what
   * else is in the body; `Object.hasOwn` says out loud that the flag is STATED — the doctrine the
   * sibling `enable_javascript` comment has always named and, until now, only half-kept.
   */
  it("states the DESKTOP form factor explicitly instead of inheriting it (B-9)", async () => {
    for (const body of await recordedBodies()) {
      expect(Object.hasOwn(body, "for_mobile"), "for_mobile was left to the vendor default").toBe(
        true,
      );
      expect(body.for_mobile).toBe(false);
    }
  });

  it("sends Basic auth built from the injected credentials", async () => {
    const headers: Record<string, string>[] = [];
    const recording: DfsTimedTransport = async (_url, init) => {
      headers.push(init.headers);
      return { ok: true, status: 200, json: async () => fixtureResponse };
    };
    const port = createLiveSpeedClient({
      login: "user@x.test",
      password: "pw",
      transport: recording,
      ledger,
    });
    await port.fetchPageSpeed([URL_UNDER_TEST]);
    const expected = `Basic ${Buffer.from("user@x.test:pw").toString("base64")}`;
    expect(headers[0]?.Authorization).toBe(expected);
  });
});

describe("the port shapes", () => {
  it("the mock port answers from canned responses, keyed by URL with a default", async () => {
    const port = createMockSpeedPort({ default: fixtureResponse });
    const pages = await port.fetchPageSpeed([URL_UNDER_TEST, "https://slowshop.org/pricing"]);
    expect(port.enabled).toBe(true);
    expect(pages).toHaveLength(2);
    expect(pages[1]?.requested_url).toBe("https://slowshop.org/");
  });

  it("the disabled port is not enabled and fails loudly if anyone fetches anyway", async () => {
    const port = disabledSpeedPort();
    expect(port.enabled).toBe(false);
    await expect(port.fetchPageSpeed([URL_UNDER_TEST])).rejects.toThrow(/disabled/i);
  });
});

describe("resolveDefaultSpeedPort (production resolution)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is DISABLED when DFS_LIVE is not 1, even with credentials present", () => {
    const port = resolveDefaultSpeedPort({
      DATAFORSEO_LOGIN: "u",
      DATAFORSEO_PASSWORD: "p",
    } as NodeJS.ProcessEnv);
    expect(port.enabled).toBe(false);
  });

  it("fails CLOSED and loudly when live is on but a credential is missing", () => {
    expect(() =>
      resolveDefaultSpeedPort({ DFS_LIVE: "1", DATAFORSEO_LOGIN: "u" } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it("returns an enabled client only with DFS_LIVE=1 AND both credentials", () => {
    const port = resolveDefaultSpeedPort({
      DFS_LIVE: "1",
      DATAFORSEO_LOGIN: "u",
      DATAFORSEO_PASSWORD: "p",
    } as NodeJS.ProcessEnv);
    expect(port.enabled).toBe(true);
  });
});
