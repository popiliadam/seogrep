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
      ["Content audit (queries vs page titles)", "12"],
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

  // COVERAGE, not consistency. The label-to-number spec above only checks that the rows the page
  // DOES show carry the right numbers — which is why it stayed green while ranked_keywords,
  // analyze_backlinks and compare_competitors were missing from the page entirely (M-26): a row
  // that isn't rendered can't disagree with anything. This map declares which row represents each
  // PAID tool, so a new non-zero TOOL_COSTS entry that nobody puts on the page fails here instead
  // of drifting off it. It is ALSO the arithmetic: every row's expected number is derived from the
  // tools declared into it (see expectedRowCosts) — nothing about a grouped row is restated by hand.
  const SCAN_ROW = "Quick-win, cannibalization, or decay scan";
  const AUDIT_ROW = "Full on-page + technical + schema audit";
  type RowMap = Readonly<Partial<Record<string, string>>>;
  const PAID_TOOL_ROW: Readonly<Partial<Record<keyof typeof TOOL_COSTS, string>>> = {
    pull_gsc_data: "GSC pull (90 days)",
    crawl_site: "Site crawl (up to 100 URLs)",
    // Grouped row — the three discovery scans SHARE one price (SHARED_PRICE_ROWS).
    find_quick_wins: SCAN_ROW,
    detect_cannibalization: SCAN_ROW,
    analyze_content_decay: SCAN_ROW,
    // Grouped row — the audit bundle is its declared members SUMMED (E-I4d makes the label say so).
    audit_onpage: AUDIT_ROW,
    audit_tech: AUDIT_ROW,
    audit_schema: AUDIT_ROW,
    // Its OWN row, deliberately not a member of AUDIT_ROW: audit_content needs a Search Console
    // pull as well as a crawl, so the bundle's price would be advertising something a crawl alone
    // cannot run. NOTE for the reviewer — this number is UNSIGNED (NEVER #6); the PR is parked.
    audit_content: "Content audit (queries vs page titles)",
    research_keywords: "Keyword research (100 keywords)",
    ranked_keywords: "Ranked keywords (per domain)",
    analyze_backlinks: "Backlink profile (per domain)",
    compare_competitors: "Competitor comparison (per domain)",
    generate_report: "Monthly report",
  };

  /**
   * Rows that render ONE shared price rather than a sum: the three discovery scans cost 10 each,
   * not 30 together. Every other row is a SUM row — a single-tool row sums to its own cost.
   */
  const SHARED_PRICE_ROWS: readonly string[] = [SCAN_ROW];

  /**
   * The number each declared row MUST render, DERIVED from the declaration itself. Hardcoding a
   * group's arithmetic is exactly what let a 4th paid tool hide inside the audit row: the coverage
   * rule below accepted "declare it part of an existing grouped row", the hand-written 3-term sum
   * never grew, and the page kept advertising a total that no longer accounted for everything
   * charged under that label. Nothing here is restated by hand, so the declaration and the
   * expectation cannot diverge again.
   *
   * Takes the costs table AND the row map so both can be SYNTHETIC — that is how the specs below
   * prove these rules bite instead of trusting that they would. Throws when a shared-price row's
   * members disagree, since one rendered number cannot then be honest for all of them.
   */
  function expectedRowCosts(costs: Readonly<Record<string, number>>, rows: RowMap = PAID_TOOL_ROW) {
    const members = new Map<string, { tool: string; cost: number }[]>();
    for (const [tool, label] of Object.entries(rows)) {
      const cost = costs[tool];
      if (label === undefined || cost === undefined) continue; // a tool that no longer exists
      members.set(label, [...(members.get(label) ?? []), { tool, cost }]);
    }
    const totals = new Map<string, number>();
    for (const [label, declared] of members) {
      if (SHARED_PRICE_ROWS.includes(label)) {
        const shared = declared[0]?.cost ?? 0;
        const disagreeing = declared.filter((member) => member.cost !== shared);
        if (disagreeing.length > 0) {
          throw new Error(
            `the "${label}" row renders ONE shared price but its declared tools cost ` +
              `${declared.map((m) => `${m.tool}=${m.cost}`).join(", ")} — no single number is honest for all.`,
          );
        }
        totals.set(label, shared);
      } else {
        totals.set(label, declared.reduce((sum, member) => sum + member.cost, 0));
      }
    }
    return totals;
  }

  /** The credits cell of a rendered row, as text. Requires a prior render. */
  function renderedRowCost(label: string): string {
    const row = screen.getByText(label).closest("tr");
    if (row === null) throw new Error(`no credit-cost row rendered for "${label}"`);
    return row.querySelector("td:last-child")?.textContent?.trim() ?? "";
  }

  /** Every declared row renders the total derived from everything declared into it. */
  function assertRowsRenderTheirDerivedTotal(
    costs: Readonly<Record<string, number>>,
    rows: RowMap = PAID_TOOL_ROW,
  ): void {
    const totals = expectedRowCosts(costs, rows);
    if (totals.size === 0) throw new Error("no rows were derived — the declaration is empty");
    for (const [label, expected] of totals) {
      const rendered = renderedRowCost(label);
      if (rendered !== String(expected)) {
        const declared = Object.entries(rows)
          .filter(([, candidate]) => candidate === label)
          .map(([tool]) => tool);
        throw new Error(
          `the "${label}" row expects ${expected} credits from its declared tools ` +
            `(${declared.join(" + ")}) but the page renders ${rendered}.`,
        );
      }
    }
  }

  /**
   * The coverage rule itself, taking the same synthetic-friendly arguments. Throws on the first
   * paid tool that no rendered row accounts for. Requires a prior render.
   */
  function assertEveryPaidToolIsListed(
    costs: Readonly<Record<string, number>>,
    rows: RowMap = PAID_TOOL_ROW,
  ): void {
    for (const [tool, cost] of Object.entries(costs)) {
      if (cost === 0) continue; // free tools spend no credits, so the table has nothing to say
      const label = rows[tool];
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

  it("sources every credit-cost number from TOOL_COSTS so a future cost change can't drift (B-M1)", () => {
    render(<Page />);
    expect(() => assertRowsRenderTheirDerivedTotal(TOOL_COSTS)).not.toThrow();
  });

  it("…and that rule bites: a 4th paid tool declared INTO the audit row breaks its total", () => {
    render(<Page />);
    const hidden = { ...TOOL_COSTS, audit_links: 40 };
    const declared = { ...PAID_TOOL_ROW, audit_links: AUDIT_ROW };
    // This is the escape the coverage rule left open — its own failure message invited it, and
    // the coverage rule alone is STILL satisfied by it (asserted last). Only the derived total
    // notices that the row now charges for four tools while advertising three.
    expect(() => assertRowsRenderTheirDerivedTotal(hidden, declared)).toThrow(
      /the "Full on-page \+ technical \+ schema audit" row expects 90 credits .* but the page renders 50/,
    );
    expect(() => assertEveryPaidToolIsListed(hidden, declared)).not.toThrow();
  });

  it("…and it bites the other way: a shared-price row whose members stop agreeing", () => {
    render(<Page />);
    // The single-number scan row is only honest while the three discovery tools cost the same.
    expect(() =>
      assertRowsRenderTheirDerivedTotal({ ...TOOL_COSTS, analyze_content_decay: 12 }),
    ).toThrow(/renders ONE shared price but its declared tools cost .*analyze_content_decay=12/);
  });

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
