import { describe, expect, it } from "vitest";
import { TOOL_COSTS } from "./costs.js";

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
  it("has exactly 29 tools (no silent additions or drops)", () => {
    expect(Object.keys(TOOL_COSTS)).toHaveLength(29);
  });

  it("exposes only non-negative integer costs", () => {
    for (const cost of Object.values(TOOL_COSTS)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(0);
    }
  });
});
