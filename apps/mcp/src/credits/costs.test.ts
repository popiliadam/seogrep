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
      find_quick_wins: 10,
      detect_cannibalization: 10,
      analyze_content_decay: 10,
      audit_onpage: 30,
      audit_tech: 15,
      audit_schema: 5,
      generate_report: 15,
      whats_next: 0,
    });
  });

  it("has exactly 16 tools (no silent additions or drops)", () => {
    expect(Object.keys(TOOL_COSTS)).toHaveLength(16);
  });

  it("exposes only non-negative integer costs", () => {
    for (const cost of Object.values(TOOL_COSTS)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(0);
    }
  });
});
