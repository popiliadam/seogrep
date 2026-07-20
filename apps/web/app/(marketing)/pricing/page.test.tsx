import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
      ["Full on-page + technical audit", "50"],
      ["Keyword research (100 keywords)", "25"],
      ["Monthly report", "15"],
    ];
    for (const [label, cost] of rows) {
      const row = screen.getByText(label).closest("tr");
      if (row === null) throw new Error(`no credit-cost row rendered for "${label}"`);
      expect(within(row).getByText(cost)).toBeTruthy();
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
