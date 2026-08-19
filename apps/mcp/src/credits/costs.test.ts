import { describe, expect, it } from "vitest";
import { CREDIT_UNITS, TOOL_COSTS, creditCostFor, isPerUnitTool } from "./costs.js";
import { MAX_COMPARE_TARGETS, MIN_COMPARE_TARGETS } from "../dfs/llm-mentions.js";

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
      crawl_site: 20,
      get_job_status: 0,
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
  it("has exactly 33 tools (no silent additions or drops)", () => {
    expect(Object.keys(TOOL_COSTS)).toHaveLength(33);
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

  it("refuses a unit count outside the signed range, rather than reserving for it", () => {
    expect(() => creditCostFor("ai_visibility_compare", 0)).toThrow(/outside that range/i);
    expect(() => creditCostFor("ai_visibility_compare", 11)).toThrow(/outside that range/i);
    expect(() => creditCostFor("ai_visibility_compare", 2.5)).toThrow(/outside that range/i);
  });

  it("names exactly one per-unit tool — every other price is per call", () => {
    expect(Object.keys(CREDIT_UNITS)).toEqual(["ai_visibility_compare"]);
    expect(isPerUnitTool("ai_visibility_compare")).toBe(true);
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
  });
});
