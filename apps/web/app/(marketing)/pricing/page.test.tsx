import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// The single source of truth for per-tool credit costs lives in the MCP package; importing it
// here turns any future cost change that misses this page into a failing test (B-M1 drift guard).
import { TOOL_COSTS } from "../../../../mcp/src/credits/costs";
import Page from "./page";

describe("pricing page", () => {
  it("pins the draft package numbers from the spec", () => {
    render(<Page />);
    for (const text of ["$19", "$49", "$149", "1,000", "3,500", "12,000", "200 credits"]) {
      expect(screen.getAllByText(new RegExp(text.replace("$", "\\$"))).length).toBeGreaterThan(0);
    }
  });

  it("pins the rendered top-up amounts", () => {
    render(<Page />);
    for (const text of ["$10", "$25", "$50", "400 credits", "1,100 credits", "2,400 credits"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  it("pins each credit-cost row label to its rendered number", () => {
    render(<Page />);
    const rows: readonly (readonly [string, string])[] = [
      ["GSC pull (90 days)", "5"],
      ["Site crawl (up to 100 URLs)", "20"],
      ["Quick-win, cannibalization, or decay scan", "10"],
      ["Full on-page + technical + schema audit", "50"],
      ["Keyword research (100 keywords)", "25"],
      ["Monthly report", "15"],
    ];
    for (const [label, cost] of rows) {
      const row = screen.getByText(label).closest("tr");
      if (row === null) throw new Error(`no credit-cost row rendered for "${label}"`);
      expect(within(row).getByText(cost)).toBeTruthy();
    }
  });

  it("sources every credit-cost number from TOOL_COSTS so a future cost change can't drift (B-M1)", () => {
    render(<Page />);
    // The single-number "scan" row is only honest if the three discovery tools cost the same.
    expect(TOOL_COSTS.detect_cannibalization).toBe(TOOL_COSTS.find_quick_wins);
    expect(TOOL_COSTS.analyze_content_decay).toBe(TOOL_COSTS.find_quick_wins);
    // The "50" audit bundle is on-page + technical + schema summed (E-I4d makes the label say so).
    const auditBundle = TOOL_COSTS.audit_onpage + TOOL_COSTS.audit_tech + TOOL_COSTS.audit_schema;
    const expected: readonly (readonly [string, number])[] = [
      ["GSC pull (90 days)", TOOL_COSTS.pull_gsc_data],
      ["Site crawl (up to 100 URLs)", TOOL_COSTS.crawl_site],
      ["Quick-win, cannibalization, or decay scan", TOOL_COSTS.find_quick_wins],
      ["Full on-page + technical + schema audit", auditBundle],
      ["Keyword research (100 keywords)", TOOL_COSTS.research_keywords],
      ["Monthly report", TOOL_COSTS.generate_report],
    ];
    for (const [label, cost] of expected) {
      const row = screen.getByText(label).closest("tr");
      if (row === null) throw new Error(`no credit-cost row rendered for "${label}"`);
      expect(within(row).getByText(String(cost))).toBeTruthy();
    }
  });

  it("shows the beta badge and no popularity claims", () => {
    render(<Page />);
    expect(screen.getAllByText(/beta pricing/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/most popular/i)).toBeNull();
  });

  it("notes the crawl page cap and focused large-site path filters", () => {
    render(<Page />);
    expect(screen.getByText(/covers up to 100 pages for 20 credits/i)).toBeTruthy();
    expect(screen.getByText(/path filters/i)).toBeTruthy();
    expect(screen.getByText(/tiered large-site crawling is coming/i)).toBeTruthy();
  });
});
