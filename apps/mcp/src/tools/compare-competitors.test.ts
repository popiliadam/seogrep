import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockCompetitorsPort,
  disabledCompetitorsPort,
  EMPTY_ORGANIC_METRICS,
  parseCompetitorsDomainResponse,
  parseDomainRankOverviewResponse,
  type CompetitorComparison,
  type DomainOrganicMetrics,
} from "../dfs/competitors.ts";
import {
  formatCompetitorComparison,
  makeCompareCompetitorsTool,
  normalizeCompetitors,
} from "./compare-competitors.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
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

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

/** Models the real loader: rows are keyed by (userId, projectId), so nobody sees another tenant's. */
const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const FIXTURES = {
  competitorsDomain: competitorsFixture,
  rankOverviews: { default: rankOverviewFixture },
};

const WHERE = { language_code: "en", location_code: 2840 };

/** All nineteen documented organic fields, built from twelve bands + the four scalars + movement. */
function metrics(
  bands: readonly [number, number, number, number, number, number, number, number, number, number, number, number],
  scalars: { etv: number; count: number; cost: number },
  movement: readonly [number, number, number, number],
): DomainOrganicMetrics {
  const [pos_1, pos_2_3, pos_4_10, pos_11_20, pos_21_30, pos_31_40, pos_41_50, pos_51_60, pos_61_70, pos_71_80, pos_81_90, pos_91_100] = bands;
  const [is_new, is_up, is_down, is_lost] = movement;
  return {
    pos_1,
    pos_2_3,
    pos_4_10,
    pos_11_20,
    pos_21_30,
    pos_31_40,
    pos_41_50,
    pos_51_60,
    pos_61_70,
    pos_71_80,
    pos_81_90,
    pos_91_100,
    etv: scalars.etv,
    count: scalars.count,
    estimated_paid_traffic_cost: scalars.cost,
    is_new,
    is_up,
    is_down,
    is_lost,
  };
}

const TARGET_METRICS = metrics(
  [11, 28, 100, 135, 157, 174, 203, 220, 232, 202, 200, 126],
  { etv: 3055.741419672966, count: 1788, cost: 15078.99657046888 },
  [661, 757, 418, 547],
);

/** A rival's WHOLE-DOMAIN scope — every keyword it ranks for. */
const RIVAL_METRICS = metrics(
  [9, 24, 140, 388, 1110, 1038, 984, 911, 848, 758, 641, 1173],
  { etv: 28110.9, count: 9024, cost: 91044.2 },
  [722, 993, 677, 541],
);

/** The SAME rival, restricted to the keywords it shares with the target — different numbers. */
const RIVAL_SHARED_METRICS = metrics(
  [29, 53, 144, 239, 226, 212, 201, 186, 173, 155, 131, 91],
  { etv: 6120.4, count: 1840, cost: 18220.6 },
  [148, 203, 139, 111],
);

const EMPTY_METRICS: DomainOrganicMetrics = EMPTY_ORGANIC_METRICS;

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
      shared: null,
    },
    {
      domain: "rival-one.example",
      source: "discovered",
      intersections: 1840,
      avg_position: 14.2,
      metrics: RIVAL_METRICS,
      shared: RIVAL_SHARED_METRICS,
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
        "  Across the whole domain — every keyword it ranks for:\n" +
        "  - Organic SERPs containing the domain: 1,788\n" +
        "  - Organic SERPs by position, #1-20 — #1: 11 · #2-3: 28 · #4-10: 100 · #11-20: 135\n" +
        "  - Organic SERPs by position, #21-100 — #21-30: 157 · #31-40: 174 · #41-50: 203 · " +
        "#51-60: 220 · #61-70: 232 · #71-80: 202 · #81-90: 200 · #91-100: 126\n" +
        "  - Estimated monthly organic traffic (ETV): 3,056\n" +
        "  - Estimated monthly cost of the same traffic as paid ads: $15,079\n" +
        "  - Since DataForSEO's previous check — newly ranking: 661 · moved up: 757 · " +
        "moved down: 418 · no longer found: 547\n\n" +
        "• rival-one.example (found by DataForSEO) — 1,840 intersecting keywords, average " +
        "position 14.2 on them\n" +
        "  Across the whole domain — every keyword it ranks for:\n" +
        "  - Organic SERPs containing the domain: 9,024\n" +
        "  - Organic SERPs by position, #1-20 — #1: 9 · #2-3: 24 · #4-10: 140 · #11-20: 388\n" +
        "  - Organic SERPs by position, #21-100 — #21-30: 1,110 · #31-40: 1,038 · #41-50: 984 · " +
        "#51-60: 911 · #61-70: 848 · #71-80: 758 · #81-90: 641 · #91-100: 1,173\n" +
        "  - Estimated monthly organic traffic (ETV): 28,111\n" +
        "  - Estimated monthly cost of the same traffic as paid ads: $91,044\n" +
        "  - Since DataForSEO's previous check — newly ranking: 722 · moved up: 993 · " +
        "moved down: 677 · no longer found: 541\n" +
        "  Across the keywords it shares with the target only:\n" +
        "  - Organic SERPs containing the domain: 1,840\n" +
        "  - Organic SERPs by position, #1-20 — #1: 29 · #2-3: 53 · #4-10: 144 · #11-20: 239\n" +
        "  - Organic SERPs by position, #21-100 — #21-30: 226 · #31-40: 212 · #41-50: 201 · " +
        "#51-60: 186 · #61-70: 173 · #71-80: 155 · #81-90: 131 · #91-100: 91\n" +
        "  - Estimated monthly organic traffic (ETV): 6,120\n" +
        "  - Estimated monthly cost of the same traffic as paid ads: $18,221\n" +
        "  - Since DataForSEO's previous check — newly ranking: 148 · moved up: 203 · " +
        "moved down: 139 · no longer found: 111",
    );
  });

  /**
   * The distinction the pre-2026-08-17 fixture made invisible. `full_domain_metrics` and `metrics`
   * are DIFFERENT numbers for the same rival, and a reader must be able to tell which one they are
   * looking at. Mutation proof: drop either scope heading, or render `shared` under the whole-domain
   * heading, and this fails.
   */
  it("labels the whole-domain and shared-keyword scopes so neither can pass for the other", () => {
    const text = formatCompetitorComparison(DISCOVERED, WHERE);
    expect(text).toContain("  Across the whole domain — every keyword it ranks for:\n");
    expect(text).toContain("  Across the keywords it shares with the target only:\n");
    // Both counts appear, each under its own heading, and they are not the same number.
    const whole = text.indexOf("Across the whole domain — every keyword it ranks for:\n  - Organic SERPs containing the domain: 9,024");
    const shared = text.indexOf("Across the keywords it shares with the target only:\n  - Organic SERPs containing the domain: 1,840");
    expect(whole).toBeGreaterThan(-1);
    expect(shared).toBeGreaterThan(whole);
  });

  it("prints ALL TWELVE position bands, not the top four", () => {
    const text = formatCompetitorComparison(DISCOVERED, WHERE);
    for (const label of [
      "#1:",
      "#2-3:",
      "#4-10:",
      "#11-20:",
      "#21-30:",
      "#31-40:",
      "#41-50:",
      "#51-60:",
      "#61-70:",
      "#71-80:",
      "#81-90:",
      "#91-100:",
    ]) {
      expect(text).toContain(label);
    }
    // The old "(top 20)" hedge existed because eight bands were thrown away. They no longer are.
    expect(text).not.toContain("(top 20)");
  });

  it("reports whether each domain is gaining or losing rankings", () => {
    const text = formatCompetitorComparison(DISCOVERED, WHERE);
    expect(text).toContain(
      "Since DataForSEO's previous check — newly ranking: 722 · moved up: 993 · moved down: 677 · no longer found: 541",
    );
  });

  it("gives a SUPPLIED rival no shared-keyword section, because none was ever fetched", () => {
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
            shared: null,
          },
        ],
      },
      WHERE,
    );
    expect(text).toContain("• chosen.example (supplied by you)\n");
    expect(text).toContain("Across the whole domain — every keyword it ranks for:");
    expect(text).not.toContain("shares with the target only");
  });

  it("omits the shared section when DataForSEO returned nothing for that scope", () => {
    const text = formatCompetitorComparison(
      { ...DISCOVERED, rows: [{ ...DISCOVERED.rows[1]!, shared: EMPTY_METRICS }] },
      WHERE,
    );
    expect(text).toContain("Across the whole domain — every keyword it ranks for:");
    // An all-null scope is dropped rather than printed as a block of n/a.
    expect(text).not.toContain("shares with the target only");
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
            shared: null,
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

  it("names the resolved PROJECT in the heading when the target came from one", () => {
    const text = formatCompetitorComparison(DISCOVERED, { ...WHERE, project: PROJECT });
    expect(text.startsWith('Competitor comparison for your project "example.com" (language en')).toBe(
      true,
    );
    // The rest of the heading — where the rivals came from — is untouched by the project.
    expect(text).toContain("the top 1 of 47 competitors DataForSEO found");
  });

  it("does NOT invent a project for a bare-target comparison", () => {
    expect(formatCompetitorComparison(DISCOVERED, WHERE)).not.toContain("your project");
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
      properties: Record<
        string,
        { maximum?: number; minimum?: number; maxItems?: number; minItems?: number; format?: string }
      >;
    };
    // NOTHING is required at the JSON-Schema level: the real rule is "exactly one of
    // project_id / target", which JSON Schema's `required` cannot express, so it is enforced
    // at runtime instead (see the free pre-reserve gates below, which pin BOTH directions).
    // Marking `target` required again would reject every project_id-only call in tools/list.
    expect(schema.required).toBeUndefined();
    expect(Object.keys(schema.properties).sort()).toEqual([
      "competitors",
      "language_code",
      "limit",
      "location_code",
      "project_id",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
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

  /**
   * W1-d: the default is the number of rows DataForSEO is actually BILLED for on a discovery
   * request, and only MAX_COMPETITORS of them are ever compared. Asking for the vendor maximum by
   * default cost ten times as much for an identical table.
   */
  it("defaults `limit` to a number the tool can use, not to the vendor maximum", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { default?: number; maximum?: number }>;
    };
    expect(schema.properties.limit?.default).toBe(10);
    expect(schema.properties.limit?.default).toBeLessThan(schema.properties.limit?.maximum ?? 0);
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

  /** The same serving port, plus the injected tenant-scoped project loader. */
  const withProjects = (): ReturnType<typeof makeCompareCompetitorsTool> =>
    makeCompareCompetitorsTool({ port: createMockCompetitorsPort(FIXTURES), loadProject });

  it("rejects a call naming NEITHER project_id nor target, without reaching the ledger", async () => {
    const result = await withProjects().run(CTX, { competitors: ["rival.com"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/nothing to look up/i);
    expect(result.content[0]?.text).toMatch(/not charged/i);
  });

  it("rejects a call naming BOTH, without reaching the ledger", async () => {
    const result = await withProjects().run(CTX, {
      project_id: PROJECT_ID,
      target: "competitor.example",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not both/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const unknownId = "99999999-9999-4999-8999-999999999999";
    const theirs = await withProjects().run(CTX, { project_id: OTHER_PROJECT_ID });
    const unknown = await withProjects().run(CTX, { project_id: unknownId });
    expect(theirs.isError).toBe(true);
    expect(unknown.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
    // Same sentence up to the id the caller themselves supplied — no existence leak. Both came
    // back with SUPABASE_* stripped, which is the proof that neither reserved a credit.
    expect(theirs.content[0]?.text?.replace(OTHER_PROJECT_ID, "<id>")).toBe(
      unknown.content[0]?.text?.replace(unknownId, "<id>"),
    );
  });

  it("drops the project's OWN domain from a competitor list, free and pre-reserve", async () => {
    // The competitor normalizer runs against the RESOLVED target, so "compare my project with
    // itself" is still the empty-list rejection rather than a one-row table someone paid for.
    const result = await withProjects().run(CTX, {
      project_id: PROJECT_ID,
      competitors: ["https://example.com/pricing"],
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

  it("a RESOLVED project_id also reaches the credit guard — the gates are not a dead end", async () => {
    // The complement of the rejections above: a project the caller owns passes every gate and
    // lands on the same priced path a bare target does. The ledger shape of that path is proven
    // against the real stack in compare-competitors.db.test.ts.
    await expect(withProjects().run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /environment configuration/i,
    );
  });
});

// =============================================================================================
// S1 — ABSENT IS NOT ZERO, PROVEN FROM THE VENDOR BODY, AND WHERE THE TARGET'S NUMBERS COME FROM.
//
// Every spec above builds a DomainOrganicMetrics directly, so `projectOrganic` in
// dfs/competitors.ts — the one place a zero could be invented — was never under test from this
// side (signed lesson 12).
//
// The second spec pair matters for a separate reason. On 2026-08-25 this tool and ranked_keywords
// printed DIFFERENT `no longer found` figures for the same domain minutes apart, and the review
// attributed this tool's figure to domain_rank_overview. In the DISCOVERY flow it does not come
// from there: the live client finds the target in its OWN competitor list and reads
// `full_domain_metrics.organic` off that competitors_domain row, sending no rank-overview request
// at all (dfs/competitors.ts — findTargetRow / buildDiscoveredRows). Those are two different
// vendor blocks from two different endpoints, each with its own is_lost; the spec below pins WHICH
// block the printed number is, so a future disagreement is attributable instead of mysterious.
// =============================================================================================

/** A domain_rank_overview envelope carrying one organic block verbatim. */
function rankOverviewEnvelope(organic: Record<string, unknown>): unknown {
  return {
    status_code: 20000,
    tasks: [{ status_code: 20000, result: [{ items: [{ metrics: { organic } }] }] }],
  };
}

/** A competitors_domain envelope whose first item IS the target — the discovery flow's own path. */
function competitorsDomainEnvelope(fullDomainOrganic: Record<string, unknown>): unknown {
  return {
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        result: [
          {
            total_count: 1,
            items: [
              {
                domain: "dentnotion.com",
                avg_position: 12,
                intersections: 480,
                full_domain_metrics: { organic: fullDomainOrganic },
                metrics: { organic: { count: 480, is_lost: 7 } },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** The three movement counters that WERE reported, minus the one key each spec is about. */
const MOVEMENT_WITHOUT_IS_LOST = { count: 6, is_new: 89, is_up: 57, is_down: 41 };

/** Render a one-row comparison whose target metrics came out of the given parser call. */
function renderedTargetRow(metrics: DomainOrganicMetrics): string {
  return formatCompetitorComparison(
    {
      target: "dentnotion.com",
      discovered: false,
      discovered_total_count: null,
      rows: [
        { domain: "dentnotion.com", source: "target", intersections: null, avg_position: null, metrics, shared: null },
      ],
    },
    { language_code: "tr", location_code: 2792 },
  );
}

describe("S1 — a movement counter absent from the vendor body never becomes a 0", () => {
  it("prints 'no longer found: n/a' when the organic block carries no is_lost key", () => {
    const text = renderedTargetRow(
      parseDomainRankOverviewResponse(rankOverviewEnvelope(MOVEMENT_WITHOUT_IS_LOST)),
    );
    expect(text).toContain(
      "newly ranking: 89 · moved up: 57 · moved down: 41 · no longer found: n/a",
    );
  });

  it("prints 'no longer found: 0' when DataForSEO reports is_lost AS 0", () => {
    const text = renderedTargetRow(
      parseDomainRankOverviewResponse(
        rankOverviewEnvelope({ ...MOVEMENT_WITHOUT_IS_LOST, is_lost: 0 }),
      ),
    );
    expect(text).toContain(
      "newly ranking: 89 · moved up: 57 · moved down: 41 · no longer found: 0",
    );
  });

  it("reads the DISCOVERED target's figures from full_domain_metrics, not from a rank overview", () => {
    const discovery = parseCompetitorsDomainResponse(
      competitorsDomainEnvelope({ ...MOVEMENT_WITHOUT_IS_LOST, is_lost: 104 }),
    );
    const target = discovery.rows.find((candidate) => candidate.domain === "dentnotion.com");
    // 104 is the WHOLE-DOMAIN block's own number; the shared-keyword scope beside it says 7, and a
    // rank-overview request would be a third figure again. Naming the source is the only way a
    // disagreement with another tool can be diagnosed rather than assumed to be a bug here.
    expect(target?.full.is_lost).toBe(104);
    expect(target?.shared.is_lost).toBe(7);
    expect(renderedTargetRow(target?.full ?? EMPTY_ORGANIC_METRICS)).toContain(
      "no longer found: 104",
    );
  });
});
