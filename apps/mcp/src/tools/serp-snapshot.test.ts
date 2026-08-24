import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { CREDIT_UNITS, TOOL_COSTS, creditCostFor } from "../credits/costs.ts";
import { PAID_BALANCE_TOOLS } from "../credits/paid-balance.ts";
import {
  DEVICE_MEANS,
  MAX_SERP_KEYWORDS,
  MIN_SERP_KEYWORDS,
  NOT_MEASURED_MEANS,
  SERP_DEPTH,
  createMockSerpSnapshotPort,
  disabledSerpSnapshotPort,
  type SerpKeywordRow,
  type SerpSnapshotQuery,
  type SerpSnapshotResult,
} from "../dfs/serp.ts";
import fixture from "../dfs/fixtures/serp-organic-live-advanced.json";
import { CONFIRMATION_THRESHOLD_CREDITS, evaluateConfirmation } from "./registry.ts";
import {
  NOT_ENABLED_MESSAGE,
  makeSerpSnapshotTool,
  serpKeywordCount,
  serpSnapshotCredits,
} from "./serp-snapshot.ts";
import { formatSerpSnapshot } from "./serp-snapshot-format.ts";
import {
  MAX_STORED_PLACEMENTS,
  bestPlacement,
  measurementReport,
  measurementRow,
} from "./serp-snapshot-store.ts";

/**
 * The DB-free half of serp_snapshot. Everything here runs with NO Supabase env at all, which is
 * itself an assertion: `withCredits` opens a client, so a branch that returns an errorResult in
 * this file provably never reached a reserve (NEVER #2). The money paths against a real ledger,
 * and the round trip with `keyword_positions`, are serp-snapshot.db.test.ts; what the RESERVE CALL
 * SITE hands the guard is serp-snapshot.reserve.test.ts, because the paid-balance gate runs before
 * the cost lookup and hides that half from this lane entirely.
 *
 * THE FIXTURE'S OWN SHAPE IS USED ON PURPOSE, and it is worth naming because it looks like a bug
 * at first reading. `serp-organic-live-advanced.json` carries FOUR items, of which TWO are organic
 * (`rank_group` 1 and 3) — it is an abridged capture, so the organic result at rank_group 2 is not
 * in it. That makes it two different fixtures depending on which domain you look for:
 *
 *   rival-one-fixture.test  -> ranked at rank_group 1 of 2 examined. A storable row.
 *   example-fixture.test    -> ranked at rank_group 3 of 2 examined. A row migration 0030's
 *                              `rank_group_within_examined` CHECK REFUSES, and rightly: a rank
 *                              above the number of results examined is a placement drawn from
 *                              outside the set the row claims to have counted.
 *
 * The second is not worked around here or anywhere: nothing clamps a rank to make a row storable,
 * and the DB spec drives that rejection deliberately to prove it surfaces instead of being
 * swallowed.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const CLOCK = () => "2026-08-24T09:00:00.000Z";

/** The port's own answer for one query, with the clock pinned so `fetched_at` is not a race. */
async function snapshotOf(query: Partial<SerpSnapshotQuery> = {}): Promise<SerpSnapshotResult> {
  const port = createMockSerpSnapshotPort(fixture, CLOCK);
  return port.fetchSerpSnapshot({
    target_domain: "rival-one-fixture.test",
    keywords: ["seo software"],
    location_name: "United States",
    language_code: "en",
    device: "desktop",
    ...query,
  });
}

function rowOf(snapshot: SerpSnapshotResult): SerpKeywordRow {
  const [row] = snapshot.rows;
  if (row === undefined) throw new Error("the snapshot returned no rows");
  return row;
}

/** A vendor envelope that PARSED but carried no result — the port's `not_measured` path. */
const NO_RESULT_ENVELOPE = {
  status_code: 20000,
  status_message: "Ok.",
  cost: 0.02,
  tasks: [{ status_code: 20000, status_message: "Ok.", cost: 0.02, result: [] }],
};

describe("serp_snapshot — the price, and the cap that is part of it", () => {
  /**
   * The SIGNED arithmetic, as literals a human can check against MADDE 1 row #4: 13 at one keyword
   * and 85 at ten. Not `5 + 8 * n`, which would restate the implementation and stay green if the
   * implementation stopped adding the base.
   */
  it("charges the signed 5 + 8 per keyword: 13 at one keyword, 85 at ten", () => {
    expect(creditCostFor("serp_snapshot", 1)).toBe(13);
    expect(creditCostFor("serp_snapshot", 2)).toBe(21);
    expect(creditCostFor("serp_snapshot", 10)).toBe(85);
    expect(serpSnapshotCredits(1)).toBe(13);
    expect(serpSnapshotCredits(10)).toBe(85);
  });

  /** The base is charged ONCE per call. Folded into the unit it would bill 130 at ten keywords. */
  it("charges the fixed part once per call, never once per keyword", () => {
    expect(serpSnapshotCredits(10)).not.toBe(13 * 10);
    expect(serpSnapshotCredits(10) - serpSnapshotCredits(9)).toBe(TOOL_COSTS.serp_snapshot);
    expect(serpSnapshotCredits(1) - TOOL_COSTS.serp_snapshot).toBe(
      CREDIT_UNITS.serp_snapshot.base,
    );
  });

  /**
   * THE ZOD MAXIMUM AND THE PORT'S CAP ARE ONE NUMBER. The cap is part of the signed price (it is
   * the count at which the signature's own 5.3x worst case is still true), so a schema carrying its
   * own copy could widen the price without touching the module that documents it. Asserted through
   * the ADVERTISED JSON Schema — the surface a client reads — rather than through the zod object.
   */
  it("advertises exactly the port's keyword bounds, not a second copy of them", () => {
    const tool = makeSerpSnapshotTool({ port: disabledSerpSnapshotPort() });
    const properties = tool.inputJsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties.keywords?.maxItems).toBe(MAX_SERP_KEYWORDS);
    expect(properties.keywords?.minItems).toBe(MIN_SERP_KEYWORDS);
    expect(CREDIT_UNITS.serp_snapshot.max_units).toBe(MAX_SERP_KEYWORDS);
    expect(CREDIT_UNITS.serp_snapshot.min_units).toBe(MIN_SERP_KEYWORDS);
  });

  /** Depth and search engine are PINNED prices, so neither may become a caller knob. */
  it("takes no depth and no search-engine parameter", () => {
    const tool = makeSerpSnapshotTool({ port: disabledSerpSnapshotPort() });
    const properties = tool.inputJsonSchema.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([
      "device",
      "keywords",
      "language_code",
      "location_name",
      "project_id",
      "target",
    ]);
  });

  /**
   * D17: the dearest call the signature allows is 85 credits, under the 200-credit threshold, so
   * this tool never asks for confirmation. Measured rather than assumed — the base is exactly the
   * kind of term that can push a call over a STRICT `>` comparison.
   */
  it("weighs the whole CALL for D17, and the dearest one stays under the threshold", () => {
    expect(serpKeywordCount({ keywords: Array.from({ length: 10 }, (_, i) => `k${i}`) })).toBe(10);
    expect(serpSnapshotCredits(MAX_SERP_KEYWORDS)).toBeLessThan(CONFIRMATION_THRESHOLD_CREDITS);
    expect(
      evaluateConfirmation(creditCostFor("serp_snapshot", MAX_SERP_KEYWORDS), false)
        .requiresConfirmation,
    ).toBe(false);
  });

  /**
   * …and the same thing END TO END, through the registry's real gate: a ten-keyword call reaches
   * the handler's own pre-reserve refusal rather than a confirmation prompt. A gate that DID fire
   * would return the `requires_confirmation` JSON instead, and this assertion would see it.
   */
  it("returns no confirmation prompt for a full ten-keyword call", async () => {
    const tool = makeSerpSnapshotTool({ port: disabledSerpSnapshotPort() });
    const result = await tool.run(CTX, {
      target: "example.com",
      keywords: Array.from({ length: MAX_SERP_KEYWORDS }, (_, i) => `keyword ${i}`),
    });
    expect(result.content[0]?.text).not.toContain("requires_confirmation");
    expect(result.content[0]?.text).toBe(NOT_ENABLED_MESSAGE);
  });

  it("is on the vendor-money gate and says so in its description", () => {
    const tool = makeSerpSnapshotTool({ port: disabledSerpSnapshotPort() });
    expect(PAID_BALANCE_TOOLS.has("serp_snapshot")).toBe(true);
    expect(tool.description).toMatch(/paid credit balance/i);
    expect(tool.description).toMatch(/charges nothing/i);
    // The price, both halves, as the caller reads it before spending.
    expect(tool.description).toContain("8 credits, charged per keyword, plus a fixed 5 credits");
    expect(tool.description).toContain("one keyword costs 13 and 10 cost 85");
    // Never a claim about which side of the operator's switch this deployment is on.
    expect(tool.description).not.toMatch(/is (currently )?(turned )?off\b/i);
  });
});

describe("serp_snapshot — the free pre-reserve gates", () => {
  const tool = makeSerpSnapshotTool({ port: disabledSerpSnapshotPort() });

  it("refuses a call that names neither a target nor a project", async () => {
    const result = await tool.run(CTX, { keywords: ["seo tools"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/you were not charged/i);
  });

  it("refuses a call that names BOTH, rather than guessing which domain was meant", async () => {
    const result = await tool.run(CTX, {
      target: "example.com",
      project_id: "11111111-1111-4111-8111-111111111111",
      keywords: ["seo tools"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not both/i);
  });

  /**
   * A DUPLICATE IS REFUSED, NOT DE-DUPLICATED. Two rows sharing one measurement identity make that
   * identity ambiguous, and the caller would be billed twice for one answer. The refusal is free:
   * with no Supabase env a reserve would throw, so an errorResult here proves none was opened.
   */
  it("refuses a duplicated keyword, free of charge", async () => {
    const result = await tool.run(CTX, {
      target: "example.com",
      keywords: ["seo tools", "SEO Tools"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/duplicate keyword/i);
    expect(result.content[0]?.text).toMatch(/you were not charged/i);
  });

  /** `z.string().min(1)` accepts "   ", so the port's blank refusal is a real path, not a formality. */
  it("refuses a whitespace-only keyword, free of charge", async () => {
    const result = await tool.run(CTX, { target: "example.com", keywords: ["   "] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/cannot measure an empty keyword/i);
  });

  it("refuses when live access is unavailable, and never serves the fixture as real data", async () => {
    const result = await tool.run(CTX, { target: "example.com", keywords: ["seo software"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(NOT_ENABLED_MESSAGE);
    expect(result.content[0]?.text).not.toContain("rank_group");
  });

  /** An over-cap list is a schema refusal, and it happens before anything else can charge for it. */
  it("refuses an over-cap keyword list at the schema", async () => {
    const result = await tool.run(CTX, {
      target: "example.com",
      keywords: Array.from({ length: MAX_SERP_KEYWORDS + 1 }, (_, i) => `k${i}`),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input for "serp_snapshot"/i);
  });
});

describe("the three outcomes reach the right stored row", () => {
  it("RANKED stores the status, the best placement's two ranks, and the counted scope", async () => {
    const row = rowOf(await snapshotOf());
    expect(row.outcome.status).toBe("ranked");
    const stored = measurementRow({ userId: "u", projectId: null }, row);
    expect(stored.status).toBe("ranked");
    expect(stored.best_rank_group).toBe(1);
    expect(stored.best_rank_absolute).toBe(2);
    expect(stored.organic_items_examined).toBe(2);
    expect(stored.not_measured_reason).toBeNull();
    // The invariants 0030 asserts, restated as arithmetic over the row that is about to be sent.
    expect(stored.best_rank_group as number).toBeLessThanOrEqual(
      stored.organic_items_examined as number,
    );
    expect(stored.organic_items_examined as number).toBeGreaterThanOrEqual(1);
  });

  /**
   * ABSENT keeps its COUNT and loses its ranks. The count is the scope of the claim, and 0030's
   * first CHECK is an EQUIVALENCE: an absent row without one would be a claim about an unknown set.
   */
  it("ABSENT stores the counted scope with NO rank and NO reason", async () => {
    const row = rowOf(await snapshotOf({ target_domain: "nobody-here-fixture.test" }));
    expect(row.outcome.status).toBe("absent_from_examined_results");
    const stored = measurementRow({ userId: "u", projectId: null }, row);
    expect(stored.status).toBe("absent_from_examined_results");
    expect(stored.organic_items_examined).toBe(2);
    expect(stored.best_rank_group).toBeNull();
    expect(stored.best_rank_absolute).toBeNull();
    expect(stored.not_measured_reason).toBeNull();
  });

  /** NOT MEASURED is the mirror: no count at all, and a reason that is REQUIRED there. */
  it("NOT MEASURED stores a reason and NO count — the mirror of the two above", async () => {
    const port = createMockSerpSnapshotPort(NO_RESULT_ENVELOPE, CLOCK);
    const snapshot = await port.fetchSerpSnapshot({
      target_domain: "rival-one-fixture.test",
      keywords: ["seo software"],
      location_name: "United States",
      language_code: "en",
      device: "desktop",
    });
    const row = rowOf(snapshot);
    expect(row.outcome.status).toBe("not_measured");
    const stored = measurementRow({ userId: "u", projectId: null }, row);
    expect(stored.status).toBe("not_measured");
    expect(stored.organic_items_examined).toBeNull();
    expect(stored.best_rank_group).toBeNull();
    expect(stored.best_rank_absolute).toBeNull();
    expect(stored.not_measured_reason).toMatch(/no result object/i);
  });

  /**
   * THE PINNED FACTS ARE STORED, not inherited by the reader. A row measured at depth 100 on
   * Google keeps saying so after either pin is re-signed (0030's argument for these columns).
   */
  it("stores the pinned engine, depth and match rule on the row itself", async () => {
    const stored = measurementRow({ userId: "u", projectId: null }, rowOf(await snapshotOf()));
    expect(stored.search_engine).toBe("google");
    expect(stored.depth_requested).toBe(SERP_DEPTH);
    expect(stored.domain_match_rule).toBe("exact_host_www_stripped");
    expect(stored.device).toBe("desktop");
    expect(stored.location_name).toBe("United States");
    expect(stored.language_code).toBe("en");
  });

  /**
   * THE VENDOR CLOCK IS BOTH OR NEITHER, and OUR clock is a separate field. 0030 refuses an
   * unpaired row, and the port sets the pair together — this asserts the writer carries the pair
   * across rather than reconstructing half of it.
   */
  it("carries the vendor time pair across whole, and keeps our clock separate", async () => {
    const measured = measurementRow({ userId: "u", projectId: null }, rowOf(await snapshotOf()));
    expect(measured.vendor_reported_time_field).toBe("datetime");
    expect(measured.vendor_reported_time_value).toBe("2026-08-19 09:14:22 +00:00");
    expect(measured.fetched_at).toBe("2026-08-24T09:00:00.000Z");
    expect(measured.fetched_at).not.toBe(measured.vendor_reported_time_value);

    const unmeasured = measurementRow(
      { userId: "u", projectId: null },
      rowOf(
        await createMockSerpSnapshotPort(NO_RESULT_ENVELOPE, CLOCK).fetchSerpSnapshot({
          target_domain: "x.test",
          keywords: ["k"],
          location_name: "United States",
          language_code: "en",
          device: "desktop",
        }),
      ),
    );
    // Neither half, rather than a lone key naming nothing.
    expect(unmeasured.vendor_reported_time_field).toBeNull();
    expect(unmeasured.vendor_reported_time_value).toBeNull();
    expect(unmeasured.fetched_at).toBe("2026-08-24T09:00:00.000Z");
  });

  /** The tenant column travels; a bare-target snapshot legitimately has no project at all. */
  it("stores project_id when a project resolved it and NULL when a bare target did", async () => {
    const row = rowOf(await snapshotOf());
    expect(measurementRow({ userId: "u", projectId: "p-1" }, row).project_id).toBe("p-1");
    expect(measurementRow({ userId: "u", projectId: null }, row).project_id).toBeNull();
    expect(measurementRow({ userId: "u", projectId: null }, row).user_id).toBe("u");
  });
});

describe("the stored report", () => {
  it("counts the placements found BEFORE the cap and says how many it kept", async () => {
    const report = measurementReport(rowOf(await snapshotOf()));
    expect(report.placements_found).toBe(1);
    expect(report.placements_stored).toBe(1);
    expect(report.placements).toHaveLength(1);
    expect(report.vendor_page.check_url).toContain("google.com/search");
    expect(report.vendor_page.se_results_count).toBe(428000000);
    expect(report.vendor_page.item_types).toContain("featured_snippet");
    expect(report.vendor_page.echoed_keyword).toBe("seo software");
  });

  /**
   * THE CAP BITES AND THE COUNTER DOES NOT MOVE. `placements_found` is the claim about the SERP;
   * truncating the list must never change it, or a capped row would under-report what was found.
   */
  it("caps the stored list without touching the found count", async () => {
    const row = rowOf(await snapshotOf());
    if (row.outcome.status !== "ranked") throw new Error("expected a ranked row");
    const many = {
      ...row,
      outcome: {
        ...row.outcome,
        placements: Array.from({ length: MAX_STORED_PLACEMENTS + 7 }, () => row.outcome.placements[0]),
      },
    } as SerpKeywordRow;
    const report = measurementReport(many);
    expect(report.placements_found).toBe(MAX_STORED_PLACEMENTS + 7);
    expect(report.placements_stored).toBe(MAX_STORED_PLACEMENTS);
    expect(report.placements).toHaveLength(MAX_STORED_PLACEMENTS);
  });

  /** A non-ranked row still gets a report, and it claims nothing about placements. */
  it("reports zero placements for an absence", async () => {
    const report = measurementReport(
      rowOf(await snapshotOf({ target_domain: "nobody-here-fixture.test" })),
    );
    expect(report.placements_found).toBe(0);
    expect(report.placements_stored).toBe(0);
    expect(report.placements).toEqual([]);
  });
});

describe("bestPlacement — one placement supplies BOTH columns", () => {
  const placement = (group: number | null, absolute: number | null) => ({
    rank_group: group,
    rank_absolute: absolute,
    domain: "example.test",
    url: null,
    vendor_metrics: {},
    vendor_nested_fields_not_carried: [],
  });

  it("picks the LOWEST rank_group, and takes that placement's absolute rank with it", () => {
    const best = bestPlacement([placement(7, 9), placement(3, 40), placement(5, 6)]);
    expect(best?.rank_group).toBe(3);
    // 40, not 6: the two columns come from ONE placement, never from two different bests.
    expect(best?.rank_absolute).toBe(40);
  });

  /** The vendor may withhold the organic scale entirely — 0030 stores that shape on purpose. */
  it("falls back to the lowest rank_absolute when no placement carries a rank_group", () => {
    const best = bestPlacement([placement(null, 12), placement(null, 4)]);
    expect(best?.rank_group).toBeNull();
    expect(best?.rank_absolute).toBe(4);
  });

  it("falls back to the first placement when the vendor gave neither scale", () => {
    const first = placement(null, null);
    expect(bestPlacement([first, placement(null, null)])).toBe(first);
  });

  it("has no best placement to pick when there are none", () => {
    expect(bestPlacement([])).toBeNull();
  });
});

describe("what the answer says (NEVER #7)", () => {
  it("scopes every snapshot to one engine, locale, device and depth", async () => {
    const text = formatSerpSnapshot('"rival-one-fixture.test"', await snapshotOf());
    expect(text).toContain("google organic results");
    expect(text).toContain("United States · language en · desktop SERP");
    expect(text).toContain(`depth ${SERP_DEPTH} requested`);
    expect(text).toContain(DEVICE_MEANS.desktop);
    expect(text).toMatch(/subdomains do not count/i);
  });

  /**
   * AN ABSENCE IS SCOPED TO WHAT WAS COUNTED, never to the depth that was asked for. The fixture
   * examines TWO organic results at a requested depth of 100, so the two numbers are far apart and
   * a renderer that substituted one for the other would be visible here.
   */
  it("scopes an absence to the COUNTED results, not to the depth asked for", async () => {
    const text = formatSerpSnapshot(
      '"nobody-here-fixture.test"',
      await snapshotOf({ target_domain: "nobody-here-fixture.test" }),
    );
    expect(text).toContain("not found among the 2 organic result(s) examined");
    expect(text).not.toMatch(/not found among the 100 organic/);
    expect(text).toMatch(/not position 0/i);
  });

  it("keeps 'not measured' apart from 'not found', in words", async () => {
    const port = createMockSerpSnapshotPort(NO_RESULT_ENVELOPE, CLOCK);
    const text = formatSerpSnapshot(
      '"x.test"',
      await port.fetchSerpSnapshot({
        target_domain: "x.test",
        keywords: ["k"],
        location_name: "United States",
        language_code: "en",
        device: "desktop",
      }),
    );
    expect(text).toContain("NOT MEASURED");
    expect(text).toContain(NOT_MEASURED_MEANS);
    expect(text).not.toMatch(/not found among/);
    // A non-measurement must never be printed as a zero or as a position.
    expect(text).not.toMatch(/rank_group #/);
  });

  it("prints the vendor's ranks under the vendor's own names and invents no score", async () => {
    const text = formatSerpSnapshot('"rival-one-fixture.test"', await snapshotOf());
    expect(text).toContain("rank_group #1");
    expect(text).toContain("rank_absolute 2");
    expect(text).not.toMatch(/visibility score|share of voice|winner/i);
    expect(text).toMatch(/computes no score/i);
  });

  /**
   * OUR clock and the vendor's are two different claims and are never merged — and the pair is
   * printed PER KEYWORD, never once for the snapshot. An N-keyword snapshot is N separate requests
   * with N separate timestamps, so a single summary line would have to speak for requests it never
   * read; the assertion below is that BOTH keywords carry their own pair.
   */
  it("keeps the two clocks apart, on every keyword's own block", async () => {
    const text = formatSerpSnapshot(
      '"rival-one-fixture.test"',
      await snapshotOf({ keywords: ["seo software", "second keyword"] }),
    );
    expect(text.match(/Received at 2026-08-24T09:00:00\.000Z \(SeoGrep's own clock\)/g)).toHaveLength(
      2,
    );
    expect(text.match(/datetime "2026-08-19 09:14:22 \+00:00"/g)).toHaveLength(2);
    expect(text).toMatch(/different claim from the clock reading/i);
  });

  /** A row the vendor gave no time for says so, rather than borrowing our own clock reading. */
  it("states the ABSENCE of a vendor time instead of substituting ours", async () => {
    const port = createMockSerpSnapshotPort(NO_RESULT_ENVELOPE, CLOCK);
    const text = formatSerpSnapshot(
      '"x.test"',
      await port.fetchSerpSnapshot({
        target_domain: "x.test",
        keywords: ["k"],
        location_name: "United States",
        language_code: "en",
        device: "desktop",
      }),
    );
    expect(text).toContain("DataForSEO did not report when it measured");
    expect(text).toContain("Received at 2026-08-24T09:00:00.000Z");
  });

  it("says how many measurements were stored, and where to read them back", async () => {
    const text = formatSerpSnapshot('"rival-one-fixture.test"', await snapshotOf());
    expect(text).toContain("1 measurement recorded");
    expect(text).toContain("keyword_positions");
  });
});
