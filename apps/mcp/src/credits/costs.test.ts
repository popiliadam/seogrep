import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CREDIT_UNITS,
  TOOL_COSTS,
  creditCostFor,
  creditsForUnits,
  isPerUnitTool,
  type PerUnitPriceRule,
  type ToolName,
} from "./costs.js";
import { MAX_COMPARE_TARGETS, MIN_COMPARE_TARGETS } from "../dfs/llm-mentions.js";
import { MAX_SERP_KEYWORDS, MIN_SERP_KEYWORDS } from "../dfs/serp.js";
import {
  CONFIRMATION_THRESHOLD_CREDITS,
  evaluateConfirmation,
} from "../tools/registry.js";

// Byte-for-byte pin of the human-approved v0 credit costs (PR #12 merge sign-off).
// CLAUDE.md NEVER #6: price / credit cost / package figures do not change without
// human approval across code + docs + pricing. Changing any number here must fail
// loudly until a human re-signs the table.
describe("TOOL_COSTS pin (NEVER #6 human-approval gate)", () => {
  it("matches the approved v0 literals exactly", () => {
    expect(TOOL_COSTS).toEqual({
      setup_project: 0,
      connect_gsc: 0,
      list_projects: 0,
      get_credit_balance: 0,
      list_credit_activity: 0,
      crawl_site: 20,
      get_job_status: 0,
      list_jobs: 0,
      pull_gsc_data: 5,
      research_keywords: 25,
      discover_keywords: 40,
      my_pages: 40,
      ranked_keywords: 65,
      analyze_backlinks: 70,
      compare_competitors: 90,
      keyword_gap: 45,
      link_gap: 45,
      backlink_changes: 35,
      backlink_details: 35,
      disavow_candidates: 40,
      find_quick_wins: 10,
      detect_cannibalization: 10,
      analyze_content_decay: 10,
      audit_onpage: 30,
      audit_tech: 15,
      audit_schema: 5,
      audit_speed: 15,
      audit_content: 12,
      ai_visibility: 90,
      ai_visibility_compare: 90,
      generate_report: 15,
      whats_next: 0,
      list_gsc_properties: 0,
      track_gsc_property: 0,
      untrack_project: 0,
      track_keywords: 0,
      keyword_positions: 10,
      serp_snapshot: 8,
    });
  });

  // 19 -> 22 on 2026-08-13: the operator approved THREE new 0-credit tools (the Search Console
  // property-management surface). This pin protects the human-approved table, and the table's
  // SCOPE grew — no existing number changed, so this is a re-signature, not a weakened assertion.
  //
  // 22 -> 23 on 2026-08-15: audit_content (plan §4-N8) at a PROPOSED 12 credits. Same shape as
  // the previous growth — no existing number moved — but with one difference that must not be
  // read past: 12 is UNSIGNED. This pin is what makes the proposal visible and immovable until a
  // human approves it; the PR carrying it is parked for exactly that signature (NEVER #6).
  //
  // 23 -> 25 on 2026-08-17: keyword_gap and link_gap at 45 credits each, SIGNED by the operator
  // before the work started. Same shape as the previous two growths — no existing number moved —
  // and unlike audit_content's 12, these two arrived with the signature already in hand.
  //
  // 25 -> 26 on 2026-08-17: audit_speed (plan §B6) at a SIGNED 15 credits — the operator approved
  // the number and the `urls <= 5` cap together on the same day. Three signed additions in one
  // day, and the thing they have in common is what this pin protects: the table GREW each time
  // and no existing number moved.
  //
  // 26 -> 27 on 2026-08-18: backlink_changes (plan §B3) at a SIGNED 35 credits — MADDE 1 row #6 of
  // the 2026-08-17 signature package, which the operator approved with "onaylıyorum, dispatch et".
  // Same shape as the four growths above: the table GREW and no existing number moved. The 35 is
  // BELOW the v1 draft's 45, and the reduction was the operator's own, made before this work
  // started — nothing here re-prices anything.
  //
  // 27 -> 28 on 2026-08-18: backlink_details (plan §B4) at a SIGNED 35 credits — MADDE 1 row #9 of
  // the same 2026-08-17 signature package. Same shape as the five growths above: the table GREW
  // and no existing number moved. It shares backlink_changes's 35 because it makes the same two
  // requests on the same Backlinks tariff; what keeps its worst case inside the signed band is
  // the ROW CAP pair in dfs/backlink-details.ts, which is part of the signed price.
  //
  // 28 -> 29 on 2026-08-19: disavow_candidates (plan §B3) at a SIGNED 40 credits — MADDE 1 row #8
  // of the same 2026-08-17 signature package. Same shape as the six growths above: the table GREW
  // and no existing number moved. It is the first row the operator signed with an explicit
  // sub-band WARNING attached (worst case 2.8x, below the x3 band), and the signature's own
  // remedy was a CAP rather than a price — so what protects this 40 is the row-cap trio in
  // dfs/disavow-candidates.ts, and the gap map's older 55 is stale, not a second opinion.
  //
  // 29 -> 30 on 2026-08-19: discover_keywords (plan §B) at a SIGNED 40 credits — MADDE 1 row #1 of
  // the same 2026-08-17 signature package. Same shape as the seven growths above: the table GREW
  // and no existing number moved. It shares disavow_candidates' 40 by arithmetic, not by analogy —
  // a different vendor family (Labs, not Backlinks) and ONE request, whose worst case at the
  // 1,000-row cap the signature measured at 3.8x. The v1 idea of a SECOND price above limit > 500
  // was dropped in v2: there is one price, and MAX_DISCOVER_ROWS is what holds it.
  //
  // 30 -> 31 on 2026-08-19: my_pages (plan §B) at a SIGNED 40 credits — MADDE 1 row #11 of the same
  // 2026-08-17 signature package. Same shape as the eight growths above: the table GREW and no
  // existing number moved. It shares discover_keywords' 40 by arithmetic rather than by analogy —
  // the same Labs tariff and ONE request, whose worst case at the 1,000-row cap the signature
  // measured at 3.8x. The gap map's 35 for this row is STALE; the signature is later and is what
  // this pin protects. What holds the 40 up is dfs/relevant-pages.ts: the row cap, the single
  // request, and the deliberate ABSENCE of the clickstream flag that would double the vendor bill.
  //
  // 31 -> 33 on 2026-08-19: ai_visibility and ai_visibility_compare, MADDE 2 of the same
  // 2026-08-17 signature package, both at a SIGNED 90. Same shape as the nine growths above — the
  // table GREW and no existing number moved — with ONE difference that must not be read past: the
  // second 90 is a PER-COMPARED-TARGET price, not a call price, so one call of it charges 180 to
  // 900. The table cannot say that on its own, which is what CREDIT_UNITS below is for; reading
  // this row as a flat fee would give away up to 810 signed credits a call.
  //
  // 33 -> 35 on 2026-08-20: the rank tracker's two tools, MADDE 1 rows #3 and #5 of the same
  // 2026-08-17 signature package — track_keywords at a SIGNED 0 and keyword_positions at a SIGNED
  // 10. Same shape as the ten growths above: the table GREW and no existing number moved. What is
  // different from every DataForSEO row above is the BASIS of the 10 — there is no vendor cost to
  // divide by, because the measurements it reads were paid for when they were TAKEN. It is
  // anchored on the three stored-measurement scans (10 each), not on a margin.
  //
  // 35 -> 36 on 2026-08-24: serp_snapshot, MADDE 1 row #4 of the same 2026-08-17 signature package
  // — the MEASURING half of the rank tracker, at a SIGNED 8 per keyword plus a fixed 5 per call.
  // Same shape as the eleven growths above: the table GREW and no existing number moved. It is the
  // FIRST row whose price has a fixed part, so the 8 below is a UNIT price and no call of this tool
  // ever costs 8 — CREDIT_UNITS carries the 5 and the 1-10 keyword range, and one call costs 13 to
  // 85. Reading this row as a flat fee would give away the signed base on every call.
  //
  // 36 -> 37 on 2026-08-25: list_jobs, and 37 -> 38 the same day: list_credit_activity. Both are
  // item 15 of the operator's signature package that day — two of the three free READ-BACK
  // endpoints (the third grew no surface at all; it is a second section inside list_projects).
  // Same shape as the twelve growths above: the table GREW by two ZEROS and no existing number
  // moved. Both are 0 for the reason every other zero here is 0 — no paid API, no vendor cost —
  // and the signature makes the point sharper than that: they read back rows the customer ALREADY
  // paid for (a 20-credit crawl's job_id, their own ledger), so the operator signed them at 0 and
  // called that non-negotiable.
  it("has exactly 38 tools (no silent additions or drops)", () => {
    expect(Object.keys(TOOL_COSTS)).toHaveLength(38);
  });

  /**
   * THE SIGNED ZERO, pinned as a rule the two new rows cannot leave quietly.
   *
   * The byte-pin above already holds both at 0, but it holds every number at once: a reader
   * looking for "is the read-back surface still free?" has to diff a 38-row literal to find out.
   * This spec says it in one line, and it is what turns a non-zero edit to either row into a
   * failure that NAMES the rule the operator signed rather than one that says a big object changed.
   *
   * It is deliberately NOT `expect(TOOL_COSTS.list_jobs).toBe(TOOL_COSTS.get_job_status)` — a
   * comparison to a neighbour stays green if BOTH move.
   */
  it("keeps the three read-back surfaces free, as signed (0 credits, not negotiable)", () => {
    expect(TOOL_COSTS.list_jobs).toBe(0);
    expect(TOOL_COSTS.list_credit_activity).toBe(0);
    // The third read-back grew no surface of its own: it is a section inside list_projects, which
    // was free before this slice and is pinned free by it.
    expect(TOOL_COSTS.list_projects).toBe(0);
  });

  it("exposes only non-negative integer costs", () => {
    for (const cost of Object.values(TOOL_COSTS)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * THE PER-UNIT PRICE — the arithmetic the signature signed, pinned as arithmetic rather than as
 * prose. `ai_visibility_compare` is 90 credits PER COMPARED TARGET over 2-10 targets, so the two
 * numbers a reader can check are 180 (two targets) and 900 (ten). Both are asserted as LITERALS,
 * not as `TOOL_COSTS.ai_visibility_compare * n`: a formula restating the implementation would stay
 * green if the implementation stopped multiplying.
 */
describe("creditCostFor — the one place a per-unit price is multiplied", () => {
  it("charges the flat table price for a per-call tool", () => {
    expect(creditCostFor("discover_keywords")).toBe(40);
    expect(creditCostFor("ai_visibility")).toBe(90);
    expect(creditCostFor("whats_next")).toBe(0);
  });

  it("charges 90 PER COMPARED TARGET: 180 at two targets, 900 at ten", () => {
    expect(creditCostFor("ai_visibility_compare", 2)).toBe(180);
    expect(creditCostFor("ai_visibility_compare", 3)).toBe(270);
    expect(creditCostFor("ai_visibility_compare", 10)).toBe(900);
  });

  it("refuses to multiply a per-CALL price — the shape that would invent a price nobody signed", () => {
    expect(() => creditCostFor("discover_keywords", 4)).toThrow(/priced per call/i);
    expect(() => creditCostFor("ai_visibility", 2)).toThrow(/priced per call/i);
  });

  /**
   * THE OTHER SIDE OF 1 — the half the spec above cannot see, and the reason that refusal was
   * unpinned rather than pinned.
   *
   * The check reads `units !== undefined && units !== 1`: not "more than one", but "anything that is
   * not exactly one". Every count the spec above passes is above 1, so RELAXING the condition to
   * `units > 1` left the ENTIRE suite green (MEASURED) while 0, a negative count, a fraction and a
   * NaN all started returning the flat table price in silence. Silence is the whole failure mode:
   * the number returned is not a report, it is the amount guard.ts reserves and commits against a
   * tenant's ledger.
   *
   * 0 is the value that matters most, because `spec.units?.(input)` is a FUNCTION over caller input
   * (registry.ts) — a count that comes out 0 is what an empty list or a filtered-to-nothing
   * selection produces, i.e. a shape a refactor reaches, not one a human types. On a tool that has
   * no per-unit price at all it must be an error, never a charge.
   *
   * Asserted on more than one tool on purpose: `whats_next` costs 0, so a relaxation would return a
   * harmless-looking 0 there and a full 40 next door — the same bug wearing two faces.
   */
  it("refuses ANY unit count that is not exactly 1 on a per-call tool — 0 included", () => {
    expect(() => creditCostFor("discover_keywords", 0)).toThrow(/priced per call/i);
    expect(() => creditCostFor("discover_keywords", 0)).toThrow(
      /cannot be charged for 0 units/,
    );
    expect(() => creditCostFor("discover_keywords", -1)).toThrow(/priced per call/i);
    expect(() => creditCostFor("discover_keywords", 0.5)).toThrow(/priced per call/i);
    expect(() => creditCostFor("discover_keywords", Number.NaN)).toThrow(/priced per call/i);
    expect(() => creditCostFor("whats_next", 0)).toThrow(/priced per call/i);
    expect(() => creditCostFor("crawl_site", 0)).toThrow(/priced per call/i);
  });

  /**
   * …and the same sweep over the WHOLE per-call surface, so a tool added later inherits the refusal
   * instead of needing a line of its own. The sibling loop BELOW ("still charges a per-call tool
   * with no units argument") proves 34 tools still price at their table value; this one proves the
   * same 34 refuse to be priced for a count of zero.
   */
  it("refuses a zero count on EVERY per-call tool, not just the ones named above", () => {
    for (const tool of Object.keys(TOOL_COSTS) as ToolName[]) {
      if (isPerUnitTool(tool)) continue;
      expect(() => creditCostFor(tool, 0), `${tool}: a zero count was priced, not refused`).toThrow(
        /priced per call/i,
      );
    }
  });

  it("refuses a unit count outside the signed range, rather than reserving for it", () => {
    expect(() => creditCostFor("ai_visibility_compare", 0)).toThrow(/outside that range/i);
    expect(() => creditCostFor("ai_visibility_compare", 11)).toThrow(/outside that range/i);
    expect(() => creditCostFor("ai_visibility_compare", 2.5)).toThrow(/outside that range/i);
  });

  /**
   * THE FLOOR ITSELF — the value the three cases above deliberately step around.
   *
   * `min_units: 2` was stored, rendered on the pricing page and pinned against the port's own
   * MIN_COMPARE_TARGETS while the range check read `units < 1`, so ONE target was priced at a flat
   * 90 against a signed floor of 180. 0, 11 and 2.5 all pass a `< 1` check as readily as a
   * `< min_units` one; 1 is the single value that separates them, which is why its absence let a
   * false sentence survive review. Asserted as a LITERAL 1 rather than
   * `MIN_COMPARE_TARGETS - 1` — a formula tracking the constant would follow the floor down if the
   * floor ever moved and stop testing anything.
   */
  it("refuses ONE unit — the floor is 2, and 1 is the value a `< 1` check would let through", () => {
    expect(() => creditCostFor("ai_visibility_compare", 1)).toThrow(/outside that range/i);
    expect(() => creditCostFor("ai_visibility_compare", 1)).toThrow(/2 to 10/);
  });

  /**
   * OMISSION — not a count at all, and the shape a refactor produces rather than a caller.
   *
   * `units` is optional at every call site that passes it (registry hook, CreditMeta), so dropping
   * it is a deletion, not a typo, and used to be legal: it defaulted to 1 and returned the bare 90.
   * Pinned as a DISTINCT message from the range error, so this stays a test of the omission branch
   * even if the range check is later widened or narrowed.
   */
  it("refuses a per-unit tool with NO count — omission is an error, never a silent 1", () => {
    expect(() => creditCostFor("ai_visibility_compare")).toThrow(/must say how many it buys/i);
  });

  /**
   * The other side of that coin, and the one that must NOT have moved: every per-call tool is
   * charged with no `units` argument at all. Making omission an error for the per-unit tool while
   * breaking this path would break all 34 per-call tools at once.
   */
  it("still charges a per-call tool with no units argument — the common path is untouched", () => {
    expect(creditCostFor("ai_visibility")).toBe(90);
    expect(creditCostFor("ai_visibility", 1)).toBe(90);
    expect(creditCostFor("whats_next")).toBe(0);
    for (const tool of Object.keys(TOOL_COSTS) as (keyof typeof TOOL_COSTS)[]) {
      if (isPerUnitTool(tool)) continue;
      expect(creditCostFor(tool)).toBe(TOOL_COSTS[tool]);
    }
  });

  // One -> two on 2026-08-24: serp_snapshot joins, at a SIGNED 8 per keyword plus a fixed 5 per
  // call. The set GREW; nothing left it, and no existing rule changed.
  it("names exactly two per-unit tools — every other price is per call", () => {
    expect(Object.keys(CREDIT_UNITS)).toEqual(["ai_visibility_compare", "serp_snapshot"]);
    expect(isPerUnitTool("ai_visibility_compare")).toBe(true);
    expect(isPerUnitTool("serp_snapshot")).toBe(true);
    expect(isPerUnitTool("ai_visibility")).toBe(false);
    expect(isPerUnitTool("compare_competitors")).toBe(false);
  });

  /**
   * The ceiling in the price table and the ceiling on the wire are the SAME number, asserted
   * against the port's own constants rather than restated. A `max_units` above the vendor's bound
   * would price a comparison DataForSEO refuses; one below it would refuse a comparison the
   * operator signed.
   */
  it("bounds the units at exactly the port's own compare range", () => {
    expect(CREDIT_UNITS.ai_visibility_compare.min_units).toBe(MIN_COMPARE_TARGETS);
    expect(CREDIT_UNITS.ai_visibility_compare.max_units).toBe(MAX_COMPARE_TARGETS);
    expect(creditCostFor("ai_visibility_compare", MIN_COMPARE_TARGETS)).toBe(180);
    expect(() => creditCostFor("ai_visibility_compare", MAX_COMPARE_TARGETS + 1)).toThrow();
    // Symmetric with the line above, and it only passes because min_units is ENFORCED rather than
    // merely stored: below the vendor's floor is as unpriceable as above its ceiling.
    expect(() => creditCostFor("ai_visibility_compare", MIN_COMPARE_TARGETS - 1)).toThrow();
  });
});

// =================================================================================================
// THE BASE TERM — `base + unit x count`, and the proof the two older paths did not move.
// =================================================================================================

/**
 * The SIGNED shape of `serp_snapshot` (signature package 2026-08-17, MADDE 1 row #4): 5 credits plus
 * 8 per keyword, over 1 to 10 keywords.
 *
 * WRITTEN OUT HERE AS AN INDEPENDENT RESTATEMENT OF THE SIGNATURE, and it stays that way now that
 * the tool has landed (2026-08-24). These constants were originally local because the price line
 * could not ship ahead of its tool; keeping them local afterwards buys something different and
 * worth more — every assertion below is anchored to the numbers a human signed rather than to
 * whatever the table currently holds, so an edit to CREDIT_UNITS cannot quietly re-baseline the
 * arithmetic it is checked against. The shipped table is compared to this restatement once, in
 * the spec directly below, which is where a drift between the two becomes visible.
 *
 * The cap of 10 is the port's own MAX_SERP_KEYWORDS (dfs/serp.ts) — the number the signed 5.3x
 * worst-case margin holds at. It is restated as a literal here rather than imported, so this spec
 * keeps asserting the SIGNED range even if the port's constant is later moved.
 */
const SIGNED_SERP_SNAPSHOT_RULE: PerUnitPriceRule = {
  unit: "keyword",
  base: 5,
  min_units: 1,
  max_units: 10,
};
const SIGNED_SERP_SNAPSHOT_UNIT_CREDITS = 8;

/** `creditsForUnits` under the signed serp_snapshot rule — the call this mechanism was extended for. */
const serpSnapshotCredits = (units: number | undefined): number =>
  creditsForUnits(
    "serp_snapshot",
    SIGNED_SERP_SNAPSHOT_RULE,
    SIGNED_SERP_SNAPSHOT_UNIT_CREDITS,
    units,
  );

describe("creditsForUnits — base + unit x count", () => {
  /**
   * THE SHIPPED PRICE IS THE SIGNED PRICE — the one place the human-approved table is compared
   * against this file's independent restatement of the signature. Every other assertion in this
   * block runs on the local constants, so without this line the two could drift apart in silence:
   * the arithmetic would keep proving that 5 + 8 x N works while the table charged something else.
   */
  it("is the price the table really ships: 8 per keyword, base 5, over 1 to 10", () => {
    expect(TOOL_COSTS.serp_snapshot).toBe(SIGNED_SERP_SNAPSHOT_UNIT_CREDITS);
    expect(CREDIT_UNITS.serp_snapshot).toEqual(SIGNED_SERP_SNAPSHOT_RULE);
    // …and the shipped rule prices the same four calls as the restatement above.
    for (const units of [1, 2, 5, 10]) {
      expect(creditCostFor("serp_snapshot", units)).toBe(serpSnapshotCredits(units));
    }
    expect(creditCostFor("serp_snapshot", 1)).toBe(13);
    expect(creditCostFor("serp_snapshot", 10)).toBe(85);
  });

  /** The cap in the price table and the cap on the wire are the SAME number, never two copies. */
  it("bounds the keywords at exactly the port's own snapshot range", () => {
    expect(CREDIT_UNITS.serp_snapshot.min_units).toBe(MIN_SERP_KEYWORDS);
    expect(CREDIT_UNITS.serp_snapshot.max_units).toBe(MAX_SERP_KEYWORDS);
    expect(() => creditCostFor("serp_snapshot", MAX_SERP_KEYWORDS + 1)).toThrow();
    expect(() => creditCostFor("serp_snapshot", MIN_SERP_KEYWORDS - 1)).toThrow();
  });

  /**
   * The signed arithmetic, asserted as LITERALS rather than as `5 + 8 * n`. A formula restating the
   * implementation stays green when the implementation stops adding the base or stops multiplying;
   * 13 / 21 / 45 / 85 are four numbers a human can check against the signature.
   */
  it("yields the SIGNED 5 + 8 per keyword: 13 at one keyword, 85 at ten", () => {
    expect(serpSnapshotCredits(1)).toBe(13);
    expect(serpSnapshotCredits(2)).toBe(21);
    expect(serpSnapshotCredits(5)).toBe(45);
    expect(serpSnapshotCredits(10)).toBe(85);
  });

  /**
   * The base is FIXED, not per unit. The distinction is the whole reason for the field: 13 per
   * keyword (5 folded into the unit) would charge 130 at ten keywords instead of 85.
   */
  it("charges the base ONCE per call, never once per unit", () => {
    expect(serpSnapshotCredits(10)).not.toBe(13 * 10);
    const perUnitDelta = serpSnapshotCredits(10) - serpSnapshotCredits(9);
    expect(perUnitDelta).toBe(SIGNED_SERP_SNAPSHOT_UNIT_CREDITS);
  });

  /** An ABSENT base and an explicit 0 are the same price, and must stay indistinguishable. */
  it("treats an absent base as exactly 0", () => {
    const absent: PerUnitPriceRule = { unit: "x", min_units: 1, max_units: 4 };
    const zero: PerUnitPriceRule = { unit: "x", base: 0, min_units: 1, max_units: 4 };
    for (const units of [1, 2, 3, 4]) {
      expect(creditsForUnits("t", absent, 7, units)).toBe(creditsForUnits("t", zero, 7, units));
      expect(creditsForUnits("t", absent, 7, units)).toBe(7 * units);
    }
  });

  /**
   * min_units ENFORCED on a base-carrying rule too. 0 is the value a `< 1` check would let through
   * on a rule whose floor is 1 — and it would price a keyword-less snapshot at the bare base of 5.
   */
  it("refuses a count outside the signed range — including the floor and a fraction", () => {
    expect(() => serpSnapshotCredits(0)).toThrow(/outside that range/i);
    expect(() => serpSnapshotCredits(11)).toThrow(/outside that range/i);
    expect(() => serpSnapshotCredits(2.5)).toThrow(/outside that range/i);
    expect(() => serpSnapshotCredits(-1)).toThrow(/outside that range/i);
    expect(() => serpSnapshotCredits(0)).toThrow(/1 to 10/);
    // A floor ABOVE 1 is the case ai_visibility_compare exercises; this one proves the check reads
    // `rule.min_units` rather than a hard-coded 1 that happens to match this rule's floor.
    const floorOfThree: PerUnitPriceRule = { unit: "x", base: 5, min_units: 3, max_units: 9 };
    expect(() => creditsForUnits("t", floorOfThree, 8, 2)).toThrow(/3 to 9/);
    expect(creditsForUnits("t", floorOfThree, 8, 3)).toBe(29);
  });

  /** Omission is an error on a base-carrying rule too, and it names the FULL one-call flat price. */
  it("refuses an omitted count, quoting base + unit as the flat price it would otherwise bill", () => {
    expect(() => serpSnapshotCredits(undefined)).toThrow(/must say how many it buys/i);
    // 13, not 8: the sentence has to name what the wrong path would really have charged.
    expect(() => serpSnapshotCredits(undefined)).toThrow(/flat 13 for up to 10 keywords/);
  });
});

/**
 * THE RULE ITSELF — everything above refuses a bad COUNT against a price assumed to be sound.
 *
 * `creditsForUnits` takes its price as PARAMETERS (`rule`, `unitCredits`) rather than reading the
 * signed tables by name, deliberately: that is what lets a price be proven as arithmetic before its
 * tool exists, which the `serp_snapshot` block above is built on. The cost of that shape is that a
 * DIRECT caller can hand it numbers no table holds — and until these specs, it computed with all of
 * them and returned a number. None of it is reachable from today's two rules (the byte-pins below
 * catch a table edit first), which is exactly why nothing measured it.
 *
 * These are internal errors, phrased for the author of a future call site, and every bound was
 * checked against BOTH signed tables before it was written — see the accepts-what-is-signed spec at
 * the end, which is the half that would go red if a guard were ever tightened onto a real price.
 */
describe("creditsForUnits — the rule itself, refused when it is not a price", () => {
  /**
   * WHY THE NEIGHBOURING FLOOR CHECK DOES NOT ALREADY COVER THIS — measured, not argued.
   *
   * "pins the rule table, and prices every rule at both ends" asserts the floor is `> 0`, that the
   * gap between the two ends is `unit x (max - min)`, and that what remains at the floor is the
   * base. A NEGATIVE base satisfies all three on the signed serp_snapshot shape: -5 + 8 x 1 = 3 is
   * greater than zero; the gap is untouched, because a per-call term cancels out of a difference;
   * and the leftover at the floor IS the -5 the rule claims. The three assertions check that the
   * arithmetic is CONSISTENT, which a negative base is. This spec is the line between consistent
   * and priced — and the reason the guard is not redundant with the loop next door.
   */
  it("would have priced a negative base as a perfectly consistent rule", () => {
    const negative: PerUnitPriceRule = { unit: "keyword", base: -5, min_units: 1, max_units: 10 };
    const unitCredits = 8;

    // Everything the neighbouring loop checks is still true of this rule…
    const floor = (negative.base ?? 0) + unitCredits * negative.min_units;
    const ceiling = (negative.base ?? 0) + unitCredits * negative.max_units;
    expect(Number.isInteger(floor)).toBe(true);
    expect(floor).toBeGreaterThan(0);
    expect(ceiling).toBeGreaterThanOrEqual(floor);
    expect(ceiling - floor).toBe(unitCredits * (negative.max_units - negative.min_units));
    expect(floor - unitCredits * negative.min_units).toBe(negative.base);

    // …and it is still not a price. Without the guard this returned 3 for a one-keyword call whose
    // signed price is 13 — a 10-credit gift on every call, arriving through a green suite.
    expect(() => creditsForUnits("t", negative, unitCredits, 1)).toThrow(/not a price/i);
    expect(() => creditsForUnits("t", negative, unitCredits, 1)).toThrow(/base of -5/);
  });

  it("refuses a base that is not a whole number of credits, in either direction", () => {
    const withBase = (base: number): PerUnitPriceRule => ({
      unit: "keyword",
      base,
      min_units: 1,
      max_units: 10,
    });
    expect(() => creditsForUnits("t", withBase(-1), 8, 1)).toThrow(/not a price/i);
    expect(() => creditsForUnits("t", withBase(2.5), 8, 1)).toThrow(/not a price/i);
    expect(() => creditsForUnits("t", withBase(Number.NaN), 8, 1)).toThrow(/not a price/i);
    expect(() => creditsForUnits("t", withBase(Number.POSITIVE_INFINITY), 8, 1)).toThrow(
      /not a price/i,
    );
    // A base of 0 and an absent base are the SAME price and both stay legal — the guard must not
    // have quietly outlawed the shape `ai_visibility_compare` ships (asserted again here so a
    // tightening to `> 0` fails on this line rather than in production).
    expect(creditsForUnits("t", withBase(0), 8, 1)).toBe(8);
    expect(creditsForUnits("t", { unit: "keyword", min_units: 1, max_units: 10 }, 8, 1)).toBe(8);
  });

  it("refuses a unit price that is not a whole number of credits", () => {
    const rule: PerUnitPriceRule = { unit: "keyword", base: 5, min_units: 1, max_units: 10 };
    expect(() => creditsForUnits("t", rule, -8, 1)).toThrow(/not a price/i);
    expect(() => creditsForUnits("t", rule, 8.5, 1)).toThrow(/not a price/i);
    expect(() => creditsForUnits("t", rule, Number.NaN, 1)).toThrow(/not a price/i);
    expect(() => creditsForUnits("t", rule, -8, 1)).toThrow(/priced at -8 per keyword/);
  });

  /**
   * A floor of 0 prices a call that buys NOTHING at the bare base — the exact shape costs.ts's own
   * header calls out for `serp_snapshot` ("a zero-keyword call would otherwise be priced at the
   * bare base"). Stored min_units used to be the only thing standing between that and a charge;
   * now the floor cannot BE zero.
   */
  it("refuses a floor below one unit, or a floor that is not a whole count", () => {
    const withFloor = (min_units: number): PerUnitPriceRule => ({
      unit: "keyword",
      base: 5,
      min_units,
      max_units: 10,
    });
    expect(() => creditsForUnits("t", withFloor(0), 8, 0)).toThrow(/floor of 0 keywords/);
    expect(() => creditsForUnits("t", withFloor(0), 8, 4)).toThrow(/at least/i);
    expect(() => creditsForUnits("t", withFloor(-2), 8, 4)).toThrow(/at least/i);
    expect(() => creditsForUnits("t", withFloor(1.5), 8, 4)).toThrow(/at least/i);
    expect(() => creditsForUnits("t", withFloor(Number.NaN), 8, 4)).toThrow(/at least/i);
    expect(creditsForUnits("t", withFloor(1), 8, 1)).toBe(13);
  });

  /**
   * An inverted pair is a rule with NO legal count at all: every integer is either below the floor
   * or above the ceiling, so the old code answered every call with a range error naming a range
   * that cannot exist ("charges for 9 to 3 of them"). That is a bug report pointing at the caller
   * instead of at the rule.
   */
  it("refuses a ceiling below its own floor, or a ceiling that is not a whole count", () => {
    const inverted: PerUnitPriceRule = { unit: "keyword", base: 5, min_units: 9, max_units: 3 };
    expect(() => creditsForUnits("t", inverted, 8, 5)).toThrow(/ceiling of 3 keywords/);
    expect(() => creditsForUnits("t", inverted, 8, 5)).toThrow(/no lower than the floor/);
    const fractional: PerUnitPriceRule = { unit: "keyword", min_units: 1, max_units: 4.5 };
    expect(() => creditsForUnits("t", fractional, 8, 4)).toThrow(/no lower than the floor/);
    // min === max is a legitimate rule: exactly one legal count, priced.
    const exactlyThree: PerUnitPriceRule = { unit: "keyword", base: 5, min_units: 3, max_units: 3 };
    expect(creditsForUnits("t", exactlyThree, 8, 3)).toBe(29);
  });

  /**
   * THE RULE IS CHECKED BEFORE THE COUNT, and the reason is in the omission message: it interpolates
   * `base + unitCredits`, so a malformed base used to produce the sentence "would bill one call's
   * flat NaN" — a refusal that names the wrong culprit and an amount that does not exist.
   */
  it("names the malformed rule even when the count is missing too — never 'a flat NaN'", () => {
    const nanBase: PerUnitPriceRule = { unit: "x", base: Number.NaN, min_units: 1, max_units: 4 };
    expect(() => creditsForUnits("t", nanBase, 7, undefined)).toThrow(/not a price/i);
    expect(() => creditsForUnits("t", nanBase, 7, undefined)).not.toThrow(/flat NaN/);
  });

  /**
   * THE OTHER HALF, and the one that would catch a guard tightened onto a real price: every rule the
   * operator has actually signed still prices at both ends. A guard is only free while it is
   * unreachable — one that rejected a signed value would be an outage, not a safeguard (NEVER #6:
   * this file may not move a price, and a refusal is a way of moving one to "unchargeable").
   */
  it("accepts every rule the operator has actually signed, at both ends", () => {
    const rules = Object.entries(CREDIT_UNITS) as [ToolName, PerUnitPriceRule][];
    expect(rules.length).toBeGreaterThan(0); // an empty table must not vacuously pass the loop

    for (const [tool, rule] of rules) {
      expect(() =>
        creditsForUnits(tool, rule, TOOL_COSTS[tool], rule.min_units),
      ).not.toThrow();
      expect(() =>
        creditsForUnits(tool, rule, TOOL_COSTS[tool], rule.max_units),
      ).not.toThrow();
    }

    // A unit price of ZERO is admitted on purpose. Ten signed TOOL_COSTS rows are 0 today and the
    // pin above allows any of them, so a guard demanding a POSITIVE unit price would refuse to
    // price a free tool the day one of them is counted per unit.
    const free: PerUnitPriceRule = { unit: "x", min_units: 1, max_units: 3 };
    expect(creditsForUnits("t", free, 0, 3)).toBe(0);
  });
});

/**
 * THE TWO OLDER PATHS, measured rather than assumed. Extending the mechanism must leave the per-call
 * price and the existing per-unit price byte-identical — including the words of both refusals, which
 * are behaviour a caller reads.
 */
describe("the base term did not move the per-call or the existing per-unit path", () => {
  it("every per-call tool still returns its table price, and nothing else", () => {
    for (const tool of Object.keys(TOOL_COSTS) as (keyof typeof TOOL_COSTS)[]) {
      if (isPerUnitTool(tool)) continue;
      expect(creditCostFor(tool)).toBe(TOOL_COSTS[tool]);
      expect(creditCostFor(tool, 1)).toBe(TOOL_COSTS[tool]);
    }
  });

  it("the per-unit tool still charges 90 per target with NO base folded in", () => {
    for (const targets of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(creditCostFor("ai_visibility_compare", targets)).toBe(90 * targets);
    }
    // The rule carries no base at all — an added one would show up as +N on every line above.
    // Still asserted after serp_snapshot shipped a real base (2026-08-24): a base is PER RULE, and
    // the whole risk of the second rule is that its 5 leaks onto the first one's line.
    expect(CREDIT_UNITS.ai_visibility_compare).not.toHaveProperty("base");
  });

  /**
   * BYTE-IDENTICAL, asserted as whole strings. Every earlier assertion in this file matches a
   * fragment with a regex; a refactor that rebuilt these sentences around the new `base` term could
   * satisfy all of them while changing what an operator reads in a log.
   */
  it("still speaks the exact same two refusals, word for word", () => {
    expect(() => creditCostFor("ai_visibility_compare")).toThrow(
      '"ai_visibility_compare" is priced per compared target, so the call must say how many it ' +
        "buys. Charging it without a unit count would bill one call's flat 90 for up to 10 " +
        "compared targets.",
    );
    expect(() => creditCostFor("ai_visibility_compare", 1)).toThrow(
      '"ai_visibility_compare" is priced per compared target and charges for 2 to 10 of them; 1 ' +
        "is outside that range.",
    );
    // The tail of this one NAMES THE PER-UNIT TABLE, so it grew when serp_snapshot joined it
    // (2026-08-24). That is the sentence tracking the table, not the sentence changing: the
    // message is `Object.keys(CREDIT_UNITS).join(", ")` and always was.
    expect(() => creditCostFor("discover_keywords", 4)).toThrow(
      '"discover_keywords" is priced per call, so it cannot be charged for 4 units. Only ' +
        "ai_visibility_compare, serp_snapshot carry a per-unit price.",
    );
  });

  /**
   * The rule table itself, pinned byte-for-byte — it now carries a PRICE (`base`), so NEVER #6
   * covers it exactly as it covers TOOL_COSTS. An added, removed or altered `base` on any rule here
   * fails on this line alone.
   *
   * THE GUARANTEE THAT MOVED, and why it is not gone. This `it` used to also assert that NO rule
   * carries a base at all, because apps/web/scripts/gen-tool-docs.mjs rendered a per-unit cost line
   * as `cost x min` to `cost x max` and knew NOTHING about a base — so the first tool to ship one
   * would publish a range understating its own price (MEASURED: the signed serp_snapshot rule
   * rendered "8 to 80 credits" for a call costing 13 to 85). That gate bought its guarantee by
   * forbidding the feature, and could only ever fire on the base axis.
   *
   * `renderCostLine` now renders the base, and the guarantee is asserted where the renderer and this
   * table actually meet — apps/web/lib/tool-docs-gen.test.ts, "every priced rule renders the price it
   * is really charged": for EVERY rule in this table, base or not, the credits a docs page STATES for
   * the cheapest and dearest call are read back out of the rendered line and compared against
   * `creditsForUnits`. That covers strictly more than the absence check did.
   *
   * What stays HERE is the half apps/web cannot see: that the arithmetic this table feeds the page is
   * itself well-formed — a real integer price at both ends, with the base counted exactly ONCE per
   * call rather than smuggled into the per-unit figure.
   */
  it("pins the rule table, and prices every rule at both ends with the base counted ONCE", () => {
    expect(CREDIT_UNITS).toEqual({
      ai_visibility_compare: { unit: "compared target", min_units: 2, max_units: 10 },
      serp_snapshot: { unit: "keyword", base: 5, min_units: 1, max_units: 10 },
    });

    const rules = Object.entries(CREDIT_UNITS) as [ToolName, PerUnitPriceRule][];
    expect(rules.length).toBeGreaterThan(0); // an empty table must not vacuously pass the loop below

    for (const [tool, rule] of rules) {
      const unitCredits = TOOL_COSTS[tool];
      const floor = creditsForUnits(tool, rule, unitCredits, rule.min_units);
      const ceiling = creditsForUnits(tool, rule, unitCredits, rule.max_units);

      expect(Number.isInteger(floor), `${tool}: floor call is not an integer price`).toBe(true);
      expect(Number.isInteger(ceiling), `${tool}: ceiling call is not an integer price`).toBe(true);
      expect(floor, `${tool}: cheapest call is free or negative`).toBeGreaterThan(0);
      expect(ceiling, `${tool}: dearest call is cheaper than the cheapest`).toBeGreaterThanOrEqual(
        floor,
      );

      // The base is a PER-CALL term: the whole distance between the two ends is the unit price times
      // the distance in units, and nothing else. A base folded into `unitCredits` widens this gap.
      expect(ceiling - floor, `${tool}: base is being charged per unit, not per call`).toBe(
        unitCredits * (rule.max_units - rule.min_units),
      );
      // …and what remains at the floor, once the counted units are paid for, is exactly the base.
      expect(floor - unitCredits * rule.min_units, `${tool}: the base is not what it says`).toBe(
        rule.base ?? 0,
      );
    }
  });
});

/**
 * THE D17 WEIGHING. The registry gate weighs `creditCostFor(name, spec.units?.(input))`, so a base
 * reaches it automatically — but "automatically" is a hypothesis until it is measured, and the
 * threshold comparison is STRICT (`>`), which is precisely where a 5-credit base can change the
 * answer.
 */
describe("the D17 confirmation gate weighs the base", () => {
  it("is the base, and only the base, that pushes a 200-credit call over the threshold", () => {
    const withBase: PerUnitPriceRule = { unit: "keyword", base: 5, min_units: 1, max_units: 30 };
    const withoutBase: PerUnitPriceRule = { unit: "keyword", min_units: 1, max_units: 30 };

    expect(creditsForUnits("t", withoutBase, 8, 25)).toBe(CONFIRMATION_THRESHOLD_CREDITS);
    expect(evaluateConfirmation(creditsForUnits("t", withoutBase, 8, 25), false)).toEqual({
      requiresConfirmation: false,
      estimate: 200,
    });

    expect(creditsForUnits("t", withBase, 8, 25)).toBe(205);
    expect(evaluateConfirmation(creditsForUnits("t", withBase, 8, 25), false)).toEqual({
      requiresConfirmation: true,
      estimate: 205,
    });
  });

  /**
   * And for the signed rule the answer is NO — checked rather than assumed. The dearest
   * `serp_snapshot` call the signature allows is 85 credits, well under the threshold, so adding a
   * base does not silently start prompting a tool that never prompted before.
   */
  it("leaves the signed serp_snapshot ceiling under the threshold", () => {
    expect(serpSnapshotCredits(SIGNED_SERP_SNAPSHOT_RULE.max_units)).toBe(85);
    expect(serpSnapshotCredits(SIGNED_SERP_SNAPSHOT_RULE.max_units)).toBeLessThan(
      CONFIRMATION_THRESHOLD_CREDITS,
    );
    expect(
      evaluateConfirmation(serpSnapshotCredits(SIGNED_SERP_SNAPSHOT_RULE.max_units), false)
        .requiresConfirmation,
    ).toBe(false);
  });

  /** The existing per-unit tool's own D17 behaviour, unchanged: 900 is over, 180 is not. */
  it("still asks first for a ten-target comparison and not for a two-target one", () => {
    expect(evaluateConfirmation(creditCostFor("ai_visibility_compare", 10), false)
      .requiresConfirmation).toBe(true);
    expect(evaluateConfirmation(creditCostFor("ai_visibility_compare", 2), false)
      .requiresConfirmation).toBe(false);
  });
});

/**
 * EVERY PER-UNIT TOOL CARRIES ITS OWN RESERVATION PIN — the rule turned into a gate.
 *
 * WHY THIS IS A SPEC AND NOT A SENTENCE IN A DOC, stated as it was MEASURED rather than as it
 * first got written down. What the fast lane cannot see is the RESERVE PATH: `withCredits` runs
 * the paid-balance gate before the cost lookup, so no sibling spec ever executes the line that
 * prices a per-unit reserve. Two different mistakes ride on that blindness, and they are NOT the
 * same mistake:
 *
 *   A DROPPED `units:` THROWS — loudly, in production, on every call (costs.ts's omission guard).
 *   It is not a silent give-away; the tool stops answering. The fast lane still cannot see it,
 *   because nothing there runs the throwing line FROM A HANDLER'S RESERVE PATH — which is exactly
 *   what `serp-snapshot.reserve.test.ts` says in its own header. (Read without that qualifier the
 *   sentence is false: this very file calls `creditCostFor` with a per-unit tool and asserts the
 *   throw. What no sibling spec can see is a CALL SITE's mistake.)
 *
 *   A WRONG COUNT is the silent one, and it is the reason this gate exists. Hardcoding `units: 1`
 *   where the call site should compute the real count was measured to bill 13 credits for a
 *   ten-keyword `serp_snapshot` the operator signed at 85 — in range, tool answers, ledger
 *   balances, and 2,621 fast-lane specs stay GREEN. That is the NEVER #6 give-away, and only a
 *   spec written for that one tool — by convention `<tool>.reserve.test.ts` — prices the reserve.
 *
 * The DB lane pins the charge independently (serp-snapshot.db.test.ts asserts the ledger delta),
 * so this is a claim about `verify.sh` alone — which is the gate that has to be able to catch it
 * without a database.
 *
 * A convention nobody enforces is a convention that survives exactly as long as the person who
 * remembers it. Both of today's per-unit tools happen to have their pin; this asserts that the
 * NEXT one cannot ship without it. `CREDIT_UNITS` is the register of per-unit pricing (NEVER #6),
 * so it is the right thing to iterate: adding a row there is precisely the moment the obligation
 * begins.
 *
 * It reads the DIRECTORY rather than importing the specs, because importing them would run them
 * and prove nothing about their existence; a missing file must be a missing file, not a failed
 * import inside somebody else's test.
 *
 * Deliberately NOT asserted here: what the pin CONTAINS. A spec that dictated the assertions of
 * another spec would be a gate on wording rather than on coverage, and would go stale the first
 * time a tool priced its units differently. This pins the obligation; the pin itself is reviewed
 * like any other spec — so this gate proves a file EXISTS, never that it covers anything.
 *
 * And a third per-unit tool pinned ONLY in the DB lane would still fail here. That is intended:
 * `verify.sh` runs without a database, and it is the gate that has to be able to catch a
 * mispriced reserve on its own.
 */
describe("the per-unit reservation pin is an obligation, not a convention", () => {
  it("gives every tool in CREDIT_UNITS its own *.reserve.test.ts", () => {
    const toolsDir = fileURLToPath(new URL("../tools/", import.meta.url));
    const present = readdirSync(toolsDir).filter((name) => name.endsWith(".reserve.test.ts"));

    // The spec file is named from the tool with underscores as dashes — the repo-wide convention
    // for every tool module, asserted rather than assumed so a rename cannot silently orphan a pin.
    const missing = (Object.keys(CREDIT_UNITS) as ToolName[]).filter(
      (tool) => !present.includes(`${tool.replaceAll("_", "-")}.reserve.test.ts`),
    );

    expect(
      missing,
      `per-unit tool(s) with no reservation pin: ${missing.join(", ") || "(none)"} — nothing in ` +
        "the fast lane prices this tool's reserve, so a call site passing the WRONG count stays " +
        "green (measured: `units: 1` bills 13 for a ten-keyword call signed at 85). A DROPPED " +
        "`units:` throws instead — loudly, and only in production.",
    ).toEqual([]);

    // …and the register is not empty, so the loop above cannot pass vacuously.
    expect(Object.keys(CREDIT_UNITS).length).toBeGreaterThan(0);
  });
});
