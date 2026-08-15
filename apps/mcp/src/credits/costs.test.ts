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
      find_quick_wins: 10,
      detect_cannibalization: 10,
      analyze_content_decay: 10,
      audit_onpage: 30,
      audit_tech: 15,
      audit_schema: 5,
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
  it("has exactly 23 tools (no silent additions or drops)", () => {
    expect(Object.keys(TOOL_COSTS)).toHaveLength(23);
  });

  it("exposes only non-negative integer costs", () => {
    for (const cost of Object.values(TOOL_COSTS)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(0);
    }
  });
});
