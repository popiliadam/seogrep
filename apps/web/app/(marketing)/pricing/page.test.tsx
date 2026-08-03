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
      ["Ranked keywords (per domain)", "65"],
      ["Backlink profile (per domain)", "70"],
      ["Competitor comparison (per domain)", "90"],
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
      ["Ranked keywords (per domain)", TOOL_COSTS.ranked_keywords],
      ["Backlink profile (per domain)", TOOL_COSTS.analyze_backlinks],
      ["Competitor comparison (per domain)", TOOL_COSTS.compare_competitors],
      ["Monthly report", TOOL_COSTS.generate_report],
    ];
    for (const [label, cost] of expected) {
      const row = screen.getByText(label).closest("tr");
      if (row === null) throw new Error(`no credit-cost row rendered for "${label}"`);
      expect(within(row).getByText(String(cost))).toBeTruthy();
    }
  });

  // COVERAGE, not consistency. The assertion above only checks that the rows the page DOES show
  // carry the right numbers — which is why it stayed green while ranked_keywords, analyze_backlinks
  // and compare_competitors were missing from the page entirely (M-26): a row that isn't rendered
  // can't disagree with anything. This map declares which row represents each PAID tool, so a new
  // non-zero TOOL_COSTS entry that nobody puts on the page fails here instead of drifting off it.
  const PAID_TOOL_ROW: Readonly<Partial<Record<keyof typeof TOOL_COSTS, string>>> = {
    pull_gsc_data: "GSC pull (90 days)",
    crawl_site: "Site crawl (up to 100 URLs)",
    // Grouped row — the three discovery scans share one price, pinned equal above.
    find_quick_wins: "Quick-win, cannibalization, or decay scan",
    detect_cannibalization: "Quick-win, cannibalization, or decay scan",
    analyze_content_decay: "Quick-win, cannibalization, or decay scan",
    // Grouped row — the audit bundle is these three summed, pinned above.
    audit_onpage: "Full on-page + technical + schema audit",
    audit_tech: "Full on-page + technical + schema audit",
    audit_schema: "Full on-page + technical + schema audit",
    research_keywords: "Keyword research (100 keywords)",
    ranked_keywords: "Ranked keywords (per domain)",
    analyze_backlinks: "Backlink profile (per domain)",
    compare_competitors: "Competitor comparison (per domain)",
    generate_report: "Monthly report",
  };

  /**
   * The coverage rule itself, taking the costs table as an argument so it can also be run against a
   * SYNTHETIC one — that is how the test below PROVES the guard bites, instead of trusting that it
   * would. Throws on the first paid tool that no rendered row accounts for. Requires a prior render.
   */
  function assertEveryPaidToolIsListed(costs: Readonly<Record<string, number>>): void {
    for (const [tool, cost] of Object.entries(costs)) {
      if (cost === 0) continue; // free tools spend no credits, so the table has nothing to say
      const label = PAID_TOOL_ROW[tool as keyof typeof TOOL_COSTS];
      if (label === undefined) {
        throw new Error(
          `TOOL_COSTS.${tool} costs ${cost} credits but no pricing-page row is declared for it — ` +
            "add a row (or declare it part of an existing grouped row) so the binding page shows it.",
        );
      }
      if (screen.getByText(label).closest("tr") === null) {
        throw new Error(`no credit-cost row rendered for "${label}" (declared for ${tool})`);
      }
    }
  }

  it("puts EVERY paid tool in TOOL_COSTS on the page — none may drift off it (M-26)", () => {
    render(<Page />);
    expect(() => assertEveryPaidToolIsListed(TOOL_COSTS)).not.toThrow();
  });

  it("…and that rule bites: a NEW paid tool nobody put on the page fails it", () => {
    render(<Page />);
    expect(() => assertEveryPaidToolIsListed({ ...TOOL_COSTS, brand_new_paid_tool: 42 })).toThrow(
      /brand_new_paid_tool costs 42 credits but no pricing-page row is declared/,
    );
    // A new FREE tool is not a pricing-page concern, so it must NOT fail the same rule.
    expect(() => assertEveryPaidToolIsListed({ ...TOOL_COSTS, brand_new_free_tool: 0 })).not.toThrow();
  });

  it("declares no pricing row for a tool that is free or no longer exists", () => {
    for (const tool of Object.keys(PAID_TOOL_ROW)) {
      expect(TOOL_COSTS[tool as keyof typeof TOOL_COSTS], `${tool} is declared but not a paid tool`).toBeGreaterThan(
        0,
      );
    }
  });

  it("shows the beta badge and no popularity claims", () => {
    render(<Page />);
    expect(screen.getAllByText(/beta pricing/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/most popular/i)).toBeNull();
  });

  // Paddle is live and the catalogue is created from these exact figures, so the page may not
  // frame them as provisional again — binding terms point here for the plan numbers.
  it("frames the prices as effective, never as draft or pre-launch", () => {
    const { container } = render(<Page />);
    const rendered = container.textContent ?? "";
    expect(rendered).not.toMatch(/draft/i);
    expect(rendered).not.toMatch(/before launch/i);
    // …and the effective figures still render, so the framing fix can't quietly drop them.
    for (const text of ["$19", "$49", "$149", "1,000", "3,500", "12,000", "200 credits"]) {
      expect(screen.getAllByText(new RegExp(text.replace("$", "\\$"))).length).toBeGreaterThan(0);
    }
    for (const text of ["$10", "$25", "$50", "400 credits", "1,100 credits", "2,400 credits"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  it("notes the crawl page cap and focused large-site path filters", () => {
    render(<Page />);
    expect(screen.getByText(/covers up to 100 pages for 20 credits/i)).toBeTruthy();
    expect(screen.getByText(/path filters/i)).toBeTruthy();
    expect(screen.getByText(/tiered large-site crawling is coming/i)).toBeTruthy();
  });
});
