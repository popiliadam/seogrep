import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockCompetitorsPort,
  disabledCompetitorsPort,
  EMPTY_ORGANIC_METRICS,
  parseCompetitorsDomainResponse,
  parseDomainRankOverviewResponse,
  WHOLE_DOMAIN_MEASUREMENT_NOTE,
  type CompetitorComparison,
  type DomainOrganicMetrics,
} from "../dfs/competitors.ts";
import { parseRankedKeywordsResponse } from "../dfs/ranked-keywords.ts";
import {
  formatCompetitorComparison,
  makeCompareCompetitorsTool,
  normalizeCompetitors,
} from "./compare-competitors.ts";
import { formatRankedKeywords } from "./ranked-keywords.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import competitorsFixture from "../dfs/fixtures/competitors-domain.json";
import rankOverviewFixture from "../dfs/fixtures/domain-rank-overview.json";
import rankedKeywordsFixture from "../dfs/fixtures/ranked-keywords.json";

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

/**
 * The DISCOVERY flow's shape as the real ports build it: the target is found in its OWN competitor
 * list, so both rows are read off the one competitors_domain response and both say so.
 * dfs/competitors.test.ts pins that the ports really do set this — transport log and all.
 */
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
      metrics_source: "competitors_domain",
      shared: null,
    },
    {
      domain: "rival-one.example",
      source: "discovered",
      intersections: 1840,
      avg_position: 14.2,
      metrics: RIVAL_METRICS,
      metrics_source: "competitors_domain",
      shared: RIVAL_SHARED_METRICS,
    },
  ],
};

/**
 * The SUPPLIED-rivals flow's shape as the real ports build it. No discovery request is sent on
 * this path at all, so EVERY row — the target included — is a separate domain_rank_overview
 * request: same table, same labels, a different DataForSEO measurement behind every number.
 */
const SUPPLIED: CompetitorComparison = {
  target: "example.com",
  discovered: false,
  discovered_total_count: null,
  rows: [
    { ...DISCOVERED.rows[0]!, metrics_source: "domain_rank_overview" },
    {
      domain: "chosen.example",
      source: "supplied",
      intersections: null,
      avg_position: null,
      metrics: RIVAL_METRICS,
      metrics_source: "domain_rank_overview",
      shared: null,
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
        "  Across the whole domain — every keyword it ranks for, from DataForSEO's " +
        "competitor-discovery data:\n" +
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
        "  Across the whole domain — every keyword it ranks for, from DataForSEO's " +
        "competitor-discovery data:\n" +
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
        "moved down: 139 · no longer found: 111\n\n" +
        "Target vs each competitor — the whole-domain figures above, side by side. The difference " +
        "is the competitor's figure minus the target's, so a plus means the competitor's figure " +
        "is the larger of the two.\n\n" +
        "• rival-one.example, both figures read from DataForSEO's competitor-discovery data:\n" +
        "  - Organic SERPs containing the domain: example.com (target) 1,788 · " +
        "rival-one.example 9,024 · difference +7,236\n" +
        "  - Estimated monthly organic traffic (ETV): example.com (target) 3,056 · " +
        "rival-one.example 28,111 · difference +25,055\n" +
        "  - Estimated monthly cost of the same traffic as paid ads: example.com (target) " +
        "$15,079 · rival-one.example $91,044 · difference +$75,965\n\n" +
        "Note: whole-domain totals name the DataForSEO data they were read from. DataForSEO " +
        "measures these separately, so a different total in another SeoGrep tool is a second " +
        "measurement, not a contradiction.",
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
    expect(text).toContain(
      "  Across the whole domain — every keyword it ranks for, from DataForSEO's competitor-discovery data:\n",
    );
    expect(text).toContain("  Across the keywords it shares with the target only:\n");
    // Both counts appear, each under its own heading, and they are not the same number.
    const whole = text.indexOf(
      "Across the whole domain — every keyword it ranks for, from DataForSEO's competitor-discovery data:\n  - Organic SERPs containing the domain: 9,024",
    );
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
    const text = formatCompetitorComparison(SUPPLIED, WHERE);
    expect(text).toContain("• chosen.example (supplied by you)\n");
    expect(text).toContain(
      "Across the whole domain — every keyword it ranks for, from DataForSEO's domain-overview data:",
    );
    expect(text).not.toContain("shares with the target only");
  });

  it("omits the shared section when DataForSEO returned nothing for that scope", () => {
    const text = formatCompetitorComparison(
      { ...DISCOVERED, rows: [{ ...DISCOVERED.rows[1]!, shared: EMPTY_METRICS }] },
      WHERE,
    );
    expect(text).toContain(
      "Across the whole domain — every keyword it ranks for, from DataForSEO's competitor-discovery data:",
    );
    // An all-null scope is dropped rather than printed as a block of n/a.
    expect(text).not.toContain("shares with the target only");
  });

  it("says plainly that a SUPPLIED rival came from the caller, with no discovery figures", () => {
    const text = formatCompetitorComparison(SUPPLIED, WHERE);
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

// =============================================================================================
// S4 — THE TARGET-VS-COMPETITOR DIFFERENCE SECTION.
//
// The measured defect: the tool's own description promised "side by side" and the output never
// put two figures beside each other. On the campaign's dentnotion table the reader had to
// subtract by eye to see the one thing the data actually said — 190 organic SERPs worth $347
// against rivals holding 59 and 25 SERPs worth $976 and $1,140.
//
// Printing that difference is easy; printing it HONESTLY is the whole task, and every refusal
// below is a spec of its own. This file spends most of its length keeping figures apart that must
// not be mixed — two scopes (whole-domain vs shared) and three vendor measurements that disagree
// by design — so a subtraction is exactly the operation that can silently undo that work.
// =============================================================================================

/** A comparison built from the DISCOVERED shape with a custom rival list — same target row. */
function withRivals(rivals: readonly CompetitorComparison["rows"][number][]): CompetitorComparison {
  return { ...DISCOVERED, rows: [DISCOVERED.rows[0]!, ...rivals] };
}

/** The one rival of DISCOVERED, patched. */
function rival(
  patch: Partial<CompetitorComparison["rows"][number]>,
): CompetitorComparison["rows"][number] {
  return { ...DISCOVERED.rows[1]!, ...patch };
}

/** The difference section only — everything from its heading on. */
function differenceSection(comparison: CompetitorComparison): string {
  const text = formatCompetitorComparison(comparison, WHERE);
  const from = text.indexOf("Target vs each competitor");
  return from === -1 ? "" : text.slice(from);
}

describe("S4 — compare_competitors states the target-vs-competitor difference", () => {
  it("prints both figures and the gap between them, on one line per measure", () => {
    const section = differenceSection(DISCOVERED);
    expect(section).toContain(
      "• rival-one.example, both figures read from DataForSEO's competitor-discovery data:",
    );
    expect(section).toContain(
      "  - Organic SERPs containing the domain: example.com (target) 1,788 · rival-one.example 9,024 · difference +7,236",
    );
    expect(section).toContain(
      "  - Estimated monthly organic traffic (ETV): example.com (target) 3,056 · rival-one.example 28,111 · difference +25,055",
    );
    expect(section).toContain(
      "  - Estimated monthly cost of the same traffic as paid ads: example.com (target) $15,079 · rival-one.example $91,044 · difference +$75,965",
    );
  });

  /**
   * THE SCOPE RULE. The rival's WHOLE-DOMAIN count is 9,024 and its shared-keyword count is 1,840;
   * the target's whole-domain count is 1,788. Subtracting the shared scope would give a plausible
   * +52 that means nothing — the two figures cover different keyword sets.
   *
   * Mutation proof: read `rival.shared` instead of `rival.metrics` in renderDifferenceLines and
   * this goes red on the printed figure AND on the difference.
   */
  it("compares whole-domain against whole-domain, never against the shared-keyword scope", () => {
    const section = differenceSection(DISCOVERED);
    expect(section).toContain("rival-one.example 9,024 · difference +7,236");
    // The shared scope's own numbers, and any difference taken from them, are absent.
    expect(section).not.toContain("rival-one.example 1,840");
    expect(section).not.toContain("difference +52");
    expect(section).not.toContain("6,120");
    expect(section).not.toContain("shares with the target");
  });

  /**
   * THE MEASUREMENT RULE — the sub-case a table-wide assumption gets wrong. DataForSEO sometimes
   * omits the target from its own competitor list; the target then carries domain-overview figures
   * while the rivals beside it carry competitor-discovery figures. Those two disagree by design
   * (5,312 vs 1,788 for the same domain in this repo's own fixtures), so most of any "difference"
   * would be the gap between the vendor's measurements, not between the two domains.
   */
  it("refuses to subtract figures read from two different DataForSEO measurements", () => {
    const mixed = differenceSection({
      ...DISCOVERED,
      rows: [
        { ...DISCOVERED.rows[0]!, metrics_source: "domain_rank_overview" },
        rival({ metrics_source: "competitors_domain" }),
      ],
    });
    expect(mixed).toContain(
      "• rival-one.example — not compared: its figures were read from DataForSEO's " +
        "competitor-discovery data and the target's from DataForSEO's domain-overview data.",
    );
    expect(mixed).not.toContain("difference +7,236");
    expect(mixed).not.toContain("difference -7,236");
  });

  it("refuses to compare when either row leaves its measurement unstated", () => {
    for (const mixed of [
      withRivals([rival({ metrics_source: undefined })]),
      { ...DISCOVERED, rows: [{ ...DISCOVERED.rows[0]!, metrics_source: undefined }, rival({})] },
    ]) {
      const section = differenceSection(mixed);
      expect(section).toContain(
        "• rival-one.example — not compared: at least one of the two rows does not state which " +
          "DataForSEO measurement its figures were read from",
      );
      expect(section).not.toContain("difference +7,236");
    }
  });

  /**
   * THE NULL RULE — the core promise of this whole revision round: an unreported figure is shown
   * as unreported, NEVER as a zero. Treating the target's missing ETV as 0 would manufacture the
   * largest gap in the table (+28,111) out of the vendor's silence.
   *
   * Mutation proof: replace the null guard in renderDifferenceValue with `?? 0` and this goes red.
   */
  it("never treats an unreported figure as a zero when taking the difference", () => {
    const section = differenceSection(
      withRivals([rival({ metrics: { ...RIVAL_METRICS, count: null } })]),
    );
    // The target's ETV is missing on one side, the rival's count on the other — neither is
    // subtracted, and each line still shows which side had nothing.
    expect(section).toContain(
      "  - Organic SERPs containing the domain: example.com (target) 1,788 · rival-one.example n/a · difference not reported",
    );
    expect(section).not.toContain("difference -1,788");
    expect(section).not.toContain("difference +0");

    const nullTarget = differenceSection({
      ...DISCOVERED,
      rows: [
        { ...DISCOVERED.rows[0]!, metrics: { ...TARGET_METRICS, etv: null } },
        rival({}),
      ],
    });
    expect(nullTarget).toContain(
      "  - Estimated monthly organic traffic (ETV): example.com (target) n/a · rival-one.example 28,111 · difference not reported",
    );
    expect(nullTarget).not.toContain("difference +28,111");
  });

  it("says 'no difference' rather than printing a signed zero", () => {
    const section = differenceSection(withRivals([rival({ metrics: TARGET_METRICS })]));
    expect(section).toContain(
      "  - Organic SERPs containing the domain: example.com (target) 1,788 · rival-one.example 1,788 · no difference",
    );
    expect(section).not.toContain("difference +0");
    expect(section).not.toContain("difference -0");
  });

  it("compares nothing against a rival DataForSEO holds no figures for", () => {
    const section = differenceSection(withRivals([rival({ metrics: EMPTY_METRICS })]));
    expect(section).toContain(
      "• rival-one.example — not compared: DataForSEO holds no whole-domain figures for it.",
    );
    expect(section).not.toContain("n/a · difference");
  });

  it("compares nothing when the TARGET has no figures to compare against", () => {
    const section = differenceSection({
      ...DISCOVERED,
      rows: [{ ...DISCOVERED.rows[0]!, metrics: EMPTY_METRICS }, rival({})],
    });
    expect(section).toContain(
      "Target vs each competitor — not compared: DataForSEO holds no whole-domain figures for " +
        "the target, so there is nothing to compare the competitors against.",
    );
    // Not one rival line, and above all no figure differenced against an absent target.
    expect(section).not.toContain("difference");
    expect(section).not.toContain("• rival-one.example");
  });

  it("prints no section at all when there is nothing to compare", () => {
    // No rivals…
    expect(differenceSection({ ...DISCOVERED, rows: [DISCOVERED.rows[0]!] })).toBe("");
    // …and no target row: a difference measured against a rival mistaken for the target would be
    // worse than no section.
    expect(differenceSection({ ...DISCOVERED, rows: [rival({}), rival({ domain: "two.example" })] })).toBe(
      "",
    );
  });

  it("says what it left out when the table outgrew the line-by-line cap", () => {
    const many = withRivals(
      ["a.example", "b.example", "c.example", "d.example"].map((domain) => rival({ domain })),
    );
    const section = differenceSection(many);
    expect(section).toContain("• a.example, both figures read from");
    expect(section).toContain("• c.example, both figures read from");
    expect(section).not.toContain("• d.example, both figures read from");
    expect(section).toContain(
      "Only the first 3 competitors are compared line by line; 1 more are not, and their own " +
        "blocks above carry the same whole-domain figures.",
    );
  });

  /**
   * Lesson 12: every spec above drives a hand-built comparison, which proves what the renderer
   * prints and nothing about what the PORT hands it. This one drives the real mock port, real
   * vendor parsers and real fixtures, so the figures being differenced are the ones a paying
   * caller would see. 5,312 is example.com's competitors_domain count; 9,024 / 3,711 / 1,402 are
   * the three rivals'.
   */
  it("differences the REAL port's figures on the discovery path", async () => {
    const section = differenceSection(
      await createMockCompetitorsPort(FIXTURES).fetchCompetitorComparison({
        target: "example.com",
        competitors: [],
        limit: 10,
        language_code: "en",
        location_code: 2840,
      }),
    );
    expect(section).toContain(
      "  - Organic SERPs containing the domain: example.com (target) 5,312 · rival-one.example 9,024 · difference +3,712",
    );
    // The rival that is SMALLER than the target reads as a minus, not as an absolute value.
    expect(section).toContain(
      "  - Organic SERPs containing the domain: example.com (target) 5,312 · rival-three.example 1,402 · difference -3,910",
    );
    // …and the paid-equivalent gap the whole section exists to make visible.
    expect(section).toContain("rival-one.example $91,044 · difference +$42,923");
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

// =============================================================================================
// S19 — WHICH DataForSEO MEASUREMENT EACH WHOLE-DOMAIN FIGURE WAS READ FROM.
//
// S1 above pinned the BLOCK the parser reads. It did not pin what the CUSTOMER is told, and that
// was the whole defect: this tool and ranked_keywords printed the identical heading "Across the
// whole domain — every keyword it ranks for:" over numbers read from different DataForSEO
// endpoints. The numbers are all correct and they legitimately disagree — the repo's own fixtures
// put one domain's `is_lost` at 320, 319 and 547 — so a customer comparing two outputs concluded
// the product contradicts itself. Making them agree was never an option: it would mean fabricating
// one of them. Naming the measurement is the fix.
//
// Every spec below drives the REAL port (real vendor parsers, real fixtures) into the REAL
// renderer. An expectation checked against a hand-built ComparisonRow would prove the renderer
// prints whatever it is handed, and nothing at all about which vendor block was read (lesson 12).
// =============================================================================================

const DISCOVERY_LABEL = "from DataForSEO's competitor-discovery data";
const RANK_OVERVIEW_LABEL = "from DataForSEO's domain-overview data";

/** Parse + compare + render exactly as the handler does, with no network and no database. */
async function renderedFromPort(
  competitors: readonly string[],
  target = "example.com",
): Promise<string> {
  const comparison = await createMockCompetitorsPort(FIXTURES).fetchCompetitorComparison({
    target,
    competitors,
    limit: 10,
    language_code: "en",
    location_code: 2840,
  });
  return formatCompetitorComparison(comparison, WHERE);
}

/** The whole-domain heading of the FIRST block — the target's — with its first metric line. */
function targetHeadingAndCount(text: string): string {
  const from = text.indexOf("  Across the whole domain");
  return text.slice(from, text.indexOf("\n", text.indexOf("\n", from) + 1));
}

describe("S19 — compare_competitors names the measurement behind every whole-domain figure", () => {
  /**
   * The DISCOVERY path. The target is found inside its own competitor list, so the entire table —
   * target included — is read off the one competitors_domain response and NO rank overview is
   * requested. 5,312 / 319 are that response's own numbers for example.com.
   *
   * Mutation proof: point buildDiscoveredRows' target at the rank-overview metrics and this goes
   * red on both the label AND the numbers.
   */
  it("labels the discovery path's figures, and prints the discovery response's own numbers", async () => {
    const text = await renderedFromPort([]);
    expect(targetHeadingAndCount(text)).toBe(
      `  Across the whole domain — every keyword it ranks for, ${DISCOVERY_LABEL}:\n` +
        "  - Organic SERPs containing the domain: 5,312",
    );
    expect(text).toContain("no longer found: 319");
    // The other endpoint's figures for the same domain are 1,788 / 547. Neither is present, and
    // neither is its name: nothing on this path came from a rank overview.
    expect(text).not.toContain(RANK_OVERVIEW_LABEL);
    expect(text).not.toContain("1,788");
    expect(text).not.toContain("no longer found: 547");
  });

  /**
   * The SUPPLIED-rivals path — the SECOND internal flow, and a genuinely different measurement.
   * A named rival is not a discovery result, so every row here is its own domain_rank_overview
   * request. Same table, same labels, different vendor numbers for the very same target.
   */
  it("labels the supplied path's figures, and prints the rank overview's own numbers", async () => {
    const text = await renderedFromPort(["chosen.org"]);
    expect(targetHeadingAndCount(text)).toBe(
      `  Across the whole domain — every keyword it ranks for, ${RANK_OVERVIEW_LABEL}:\n` +
        "  - Organic SERPs containing the domain: 1,788",
    );
    expect(text).toContain("no longer found: 547");
    expect(text).not.toContain(DISCOVERY_LABEL);
    expect(text).not.toContain("5,312");
    expect(text).not.toContain("no longer found: 319");
  });

  /**
   * THE CUSTOMER-VISIBLE POINT. One domain, two of this tool's own paths, two different answers to
   * "how many rankings did it lose" — and each output now says which measurement it is quoting.
   */
  it("gives the SAME domain two different totals across its two paths, each attributed", async () => {
    const [discovery, supplied] = await Promise.all([
      renderedFromPort([]),
      renderedFromPort(["chosen.org"]),
    ]);
    expect(discovery).toContain("no longer found: 319");
    expect(supplied).toContain("no longer found: 547");
    expect(discovery).toContain(DISCOVERY_LABEL);
    expect(supplied).toContain(RANK_OVERVIEW_LABEL);
  });

  /**
   * The sub-case a single table-wide label would get WRONG. DataForSEO sometimes omits the target
   * from its own competitor list; the target then costs one extra rank-overview request while the
   * rivals beside it still come from the discovery response. TWO measurements in ONE table.
   */
  it("labels a fallback target and its discovered rivals SEPARATELY in one table", async () => {
    const text = await renderedFromPort([], "absent-target.org");
    expect(targetHeadingAndCount(text)).toBe(
      `  Across the whole domain — every keyword it ranks for, ${RANK_OVERVIEW_LABEL}:\n` +
        "  - Organic SERPs containing the domain: 1,788",
    );
    // …while the rivals below it keep the discovery response they actually came from.
    expect(text).toContain(
      `  Across the whole domain — every keyword it ranks for, ${DISCOVERY_LABEL}:\n` +
        "  - Organic SERPs containing the domain: 5,312",
    );
  });

  it("prints the measurement note ONCE, after the figures rather than in front of them", async () => {
    const text = await renderedFromPort([]);
    expect(text.split(WHOLE_DOMAIN_MEASUREMENT_NOTE)).toHaveLength(2);
    expect(text.indexOf(WHOLE_DOMAIN_MEASUREMENT_NOTE)).toBeGreaterThan(
      text.indexOf("Organic SERPs containing the domain"),
    );
  });

  /**
   * A row whose source is not stated says NOTHING about its source — it does not guess one. A
   * wrong attribution is worse than a missing one; it is the exact failure being fixed.
   */
  it("prints no source clause and no note when the row does not state a measurement", () => {
    const text = formatCompetitorComparison(
      { ...DISCOVERED, rows: [{ ...DISCOVERED.rows[0]!, metrics_source: undefined }] },
      WHERE,
    );
    expect(text).toContain("  Across the whole domain — every keyword it ranks for:\n");
    expect(text).not.toContain("DataForSEO's competitor-discovery data");
    expect(text).not.toContain("DataForSEO's domain-overview data");
    expect(text).not.toContain(WHOLE_DOMAIN_MEASUREMENT_NOTE);
  });

  it("drops the note for a table with no whole-domain figures to explain", () => {
    const text = formatCompetitorComparison(
      { ...DISCOVERED, rows: [{ ...DISCOVERED.rows[0]!, metrics: EMPTY_METRICS }] },
      WHERE,
    );
    expect(text).toContain("No organic ranking data on record.");
    expect(text).not.toContain(WHOLE_DOMAIN_MEASUREMENT_NOTE);
  });
});

/**
 * THE REPORTED SYMPTOM, END TO END: the two paid tools, on one domain, minutes apart. Both print
 * "5,312 organic SERPs" and then disagree on how many rankings were lost — because they read two
 * different DataForSEO measurements. The spec pins that each output NAMES its own, so the reader
 * sees two measurements instead of one product contradicting itself.
 */
describe("S19 — ranked_keywords and compare_competitors no longer claim the same source", () => {
  it("names a DIFFERENT measurement in each tool for the same domain's whole-domain block", async () => {
    const comparison = await renderedFromPort([]);
    const ranked = formatRankedKeywords(parseRankedKeywordsResponse(rankedKeywordsFixture), WHERE);

    // Same domain, same heading, same 5,312 — and two different `no longer found` figures.
    expect(ranked).toContain("- Organic SERPs containing the domain: 5,312");
    expect(comparison).toContain("- Organic SERPs containing the domain: 5,312");
    expect(ranked).toContain("no longer found: 96");
    expect(comparison).toContain("no longer found: 319");

    // Each names its own measurement, and neither claims the other's.
    expect(ranked).toContain("from DataForSEO's ranked-keywords data");
    expect(ranked).not.toContain(DISCOVERY_LABEL);
    expect(comparison).toContain(DISCOVERY_LABEL);
    expect(comparison).not.toContain("from DataForSEO's ranked-keywords data");

    // …and both tell the reader what to make of the difference.
    expect(ranked).toContain(WHOLE_DOMAIN_MEASUREMENT_NOTE);
    expect(comparison).toContain(WHOLE_DOMAIN_MEASUREMENT_NOTE);
  });
});
