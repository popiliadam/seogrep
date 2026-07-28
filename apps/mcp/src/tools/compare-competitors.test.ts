import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockCompetitorsPort,
  disabledCompetitorsPort,
  type CompetitorComparison,
  type DomainOrganicMetrics,
} from "../dfs/competitors.ts";
import {
  formatCompetitorComparison,
  makeCompareCompetitorsTool,
  normalizeCompetitors,
} from "./compare-competitors.ts";
import competitorsFixture from "../dfs/fixtures/competitors-domain.json";
import rankOverviewFixture from "../dfs/fixtures/domain-rank-overview.json";

/**
 * Fast-lane (DB-less) proofs for compare_competitors. The credit LEDGER behaviour (mock ->
 * reserve+commit at 90; disabled / DFS-error -> no charge) is proven against the real stack in
 * compare-competitors.db.test.ts. Here we prove: the pure formatter (whose every label must carry
 * DataForSEO's DOCUMENTED meaning and nothing stronger), the competitor-list normalizer, the tool
 * metadata, and — critically — that ALL THREE free pre-reserve gates return without touching
 * credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const FIXTURES = {
  competitorsDomain: competitorsFixture,
  rankOverviews: { default: rankOverviewFixture },
};

const WHERE = { language_code: "en", location_code: 2840 };

const TARGET_METRICS: DomainOrganicMetrics = {
  pos_1: 11,
  pos_2_3: 28,
  pos_4_10: 100,
  pos_11_20: 135,
  etv: 3055.741419672966,
  count: 1788,
  estimated_paid_traffic_cost: 15078.99657046888,
};

const RIVAL_METRICS: DomainOrganicMetrics = {
  pos_1: 9,
  pos_2_3: 24,
  pos_4_10: 140,
  pos_11_20: 388,
  etv: 28110.9,
  count: 9024,
  estimated_paid_traffic_cost: 91044.2,
};

const EMPTY_METRICS: DomainOrganicMetrics = {
  pos_1: null,
  pos_2_3: null,
  pos_4_10: null,
  pos_11_20: null,
  etv: null,
  count: null,
  estimated_paid_traffic_cost: null,
};

const DISCOVERED: CompetitorComparison = {
  target: "example.com",
  discovered: true,
  discovered_total_count: 47,
  rows: [
    {
      domain: "example.com",
      source: "target",
      intersections: null,
      avg_position: null,
      metrics: TARGET_METRICS,
    },
    {
      domain: "rival-one.example",
      source: "discovered",
      intersections: 1840,
      avg_position: 14.2,
      metrics: RIVAL_METRICS,
    },
  ],
};

describe("formatCompetitorComparison", () => {
  it("renders a discovered comparison: sourced heading, then one block per domain", () => {
    expect(formatCompetitorComparison(DISCOVERED, WHERE)).toBe(
      'Competitor comparison for "example.com" (language en, location 2840) — the target against ' +
        "the top 1 of 47 competitors DataForSEO found, ranked by how many organic SERPs each one " +
        "shares with the target:\n\n" +
        "• example.com (target)\n" +
        "  - Organic SERPs containing the domain: 1,788\n" +
        "  - Organic SERPs by position (top 20) — #1: 11 · #2-3: 28 · #4-10: 100 · #11-20: 135\n" +
        "  - Estimated monthly organic traffic (ETV): 3,056\n" +
        "  - Estimated monthly cost of the same traffic as paid ads: $15,079\n\n" +
        "• rival-one.example (found by DataForSEO) — 1,840 intersecting keywords, average " +
        "position 14.2 on them\n" +
        "  - Organic SERPs containing the domain: 9,024\n" +
        "  - Organic SERPs by position (top 20) — #1: 9 · #2-3: 24 · #4-10: 140 · #11-20: 388\n" +
        "  - Estimated monthly organic traffic (ETV): 28,111\n" +
        "  - Estimated monthly cost of the same traffic as paid ads: $91,044",
    );
  });

  it("says plainly that a SUPPLIED rival came from the caller, with no discovery figures", () => {
    const text = formatCompetitorComparison(
      {
        ...DISCOVERED,
        discovered: false,
        discovered_total_count: null,
        rows: [
          DISCOVERED.rows[0]!,
          {
            domain: "chosen.example",
            source: "supplied",
            intersections: null,
            avg_position: null,
            metrics: RIVAL_METRICS,
          },
        ],
      },
      WHERE,
    );
    expect(text).toContain("the target against 1 competitor you supplied:");
    expect(text).toContain("• chosen.example (supplied by you)\n");
    // No overlap clause is invented for a rival DataForSEO was never asked about.
    expect(text).not.toContain("intersecting keywords");
    expect(text).not.toContain("DataForSEO found");
  });

  it("drops the 'of N' clause when the discovered rivals are the whole pool", () => {
    const text = formatCompetitorComparison({ ...DISCOVERED, discovered_total_count: 1 }, WHERE);
    expect(text).toContain("the target against the 1 competitor DataForSEO found");
    expect(text).not.toContain(" of 47 ");
  });

  it("says so plainly when discovery found no rivals at all", () => {
    const text = formatCompetitorComparison(
      { ...DISCOVERED, discovered_total_count: 0, rows: [DISCOVERED.rows[0]!] },
      WHERE,
    );
    expect(text).toContain("DataForSEO has no competitors on record for this domain");
    expect(text).toContain("• example.com (target)");
  });

  it("renders n/a per metric rather than inventing a number", () => {
    const text = formatCompetitorComparison(
      {
        ...DISCOVERED,
        rows: [
          {
            ...DISCOVERED.rows[0]!,
            metrics: { ...TARGET_METRICS, etv: null, estimated_paid_traffic_cost: null, pos_1: null },
          },
        ],
      },
      WHERE,
    );
    expect(text).toContain("  - Estimated monthly organic traffic (ETV): n/a");
    expect(text).toContain("  - Estimated monthly cost of the same traffic as paid ads: n/a");
    expect(text).toContain("#1: n/a · #2-3: 28");
  });

  it("says a domain has no data on record instead of printing a wall of n/a", () => {
    const text = formatCompetitorComparison(
      { ...DISCOVERED, rows: [{ ...DISCOVERED.rows[0]!, metrics: EMPTY_METRICS }] },
      WHERE,
    );
    expect(text).toContain("• example.com (target)\n  - No organic ranking data on record.");
    expect(text).not.toContain("n/a");
  });

  it("keeps the overlap clause honest when only one of the two discovery figures exists", () => {
    const only = (patch: Partial<(typeof DISCOVERED)["rows"][number]>): string =>
      formatCompetitorComparison(
        { ...DISCOVERED, rows: [{ ...DISCOVERED.rows[1]!, ...patch }] },
        WHERE,
      );
    expect(only({ avg_position: null })).toContain("— 1,840 intersecting keywords\n");
    expect(only({ intersections: null })).toContain(
      "— average position 14.2 on the intersecting keywords\n",
    );
  });

  it("echoes the language and location the numbers were read for", () => {
    const text = formatCompetitorComparison(DISCOVERED, { language_code: "de", location_code: 2276 });
    expect(text).toContain("(language de, location 2276)");
  });
});

describe("normalizeCompetitors", () => {
  it("canonicalizes every entry with the shared domain normalizer", () => {
    expect(normalizeCompetitors("example.com", ["https://Rival.COM/pricing", "second.net"])).toEqual({
      ok: true,
      competitors: ["rival.com", "second.net"],
    });
  });

  it("rejects the whole list on the FIRST invalid domain", () => {
    const result = normalizeCompetitors("example.com", ["rival.com", "not a domain"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not a valid domain/i);
  });

  it("rejects a reserved or internal competitor name, exactly as every other domain tool does", () => {
    const result = normalizeCompetitors("example.com", ["rival.internal"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not a public domain/i);
  });

  it("drops the target itself and repeated entries", () => {
    expect(
      normalizeCompetitors("example.com", ["example.com", "rival.com", "https://rival.com/x"]),
    ).toEqual({ ok: true, competitors: ["rival.com"] });
  });

  it("rejects a list that leaves nothing to compare against", () => {
    const result = normalizeCompetitors("example.com", ["https://example.com/pricing"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/no domain to compare against/i);
  });
});

describe("compare_competitors metadata", () => {
  const tool = makeCompareCompetitorsTool();

  it("advertises its name, the 90-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("compare_competitors");
    expect(tool.description).toContain("Costs 90 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { maximum?: number; minimum?: number; maxItems?: number; minItems?: number }>;
    };
    // target is required; every defaulted / optional field is advertised OPTIONAL (io:"input").
    expect(schema.required).toEqual(["target"]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "competitors",
      "language_code",
      "limit",
      "location_code",
      "target",
    ]);
    // The competitor list is capped at the number the priced flow actually compares.
    expect(schema.properties.competitors?.minItems).toBe(1);
    expect(schema.properties.competitors?.maxItems).toBe(3);
    // limit is bounded by what DataForSEO will return for one discovery request.
    expect(schema.properties.limit?.minimum).toBe(1);
    expect(schema.properties.limit?.maximum).toBe(1000);
  });

  it("tells the caller that limit only applies to the discovery request", () => {
    const schema = tool.inputJsonSchema as { properties: Record<string, { description?: string }> };
    expect(schema.properties.limit?.description).toMatch(/skips the discovery request/i);
  });

  it("rejects invalid input before any handler work", async () => {
    const result = await tool.run(CTX, {
      target: "example.com",
      competitors: ["a.com", "b.com", "c.com", "d.com"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });
});

describe("compare_competitors free pre-reserve gates (no credit machinery)", () => {
  // Strip every SUPABASE var: if the tool tried to reserve, getServiceClient -> loadEnv
  // would throw the env error. A clean gate result therefore proves the short-circuit
  // happens BEFORE withCredits (zero ledger rows, NEVER #2).
  const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // A serving port is injected on purpose in the input gates: they must fire FIRST, so even the
  // priced path never opens a reserve for input we could not look up.
  const serving = (): ReturnType<typeof makeCompareCompetitorsTool> =>
    makeCompareCompetitorsTool({ port: createMockCompetitorsPort(FIXTURES) });

  it("rejects a non-public target without reaching the ledger", async () => {
    const result = await serving().run(CTX, { target: "not a domain" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("rejects an invalid COMPETITOR domain without reaching the ledger", async () => {
    const result = await serving().run(CTX, {
      target: "example.com",
      competitors: ["rival.com", "not a domain"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("rejects a competitor list that names only the target, without reaching the ledger", async () => {
    const result = await serving().run(CTX, {
      target: "example.com",
      competitors: ["https://example.com"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no domain to compare against/i);
  });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeCompareCompetitorsTool({ port: disabledCompetitorsPort() });
    const result = await tool.run(CTX, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    // The error is the honesty gate, NOT a leaked env/DB failure.
    expect(result.content[0]?.text).not.toMatch(/environment|supabase/i);
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    // Complement of the gate proofs: with valid input and a serving port, run() must reach
    // withCredits -> reserve -> getServiceClient -> loadEnv, which throws because SUPABASE_*
    // are stripped. That is the seam where the 90 credits are settled.
    await expect(serving().run(CTX, { target: "https://example.com/pricing" })).rejects.toThrow(
      /environment configuration/i,
    );
  });
});
