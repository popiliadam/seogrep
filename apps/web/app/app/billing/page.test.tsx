import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BillingPage from "./page";

describe("BillingPage", () => {
  it("renders plan cards: prices from the shared pricing source, credits from CREDIT_PACKAGES", () => {
    render(<BillingPage />);
    // Prices re-used from the Faz 1 pricing data (no new price constant here).
    expect(screen.getByText("$19")).toBeTruthy();
    expect(screen.getByText("$49")).toBeTruthy();
    expect(screen.getByText("$149")).toBeTruthy();
    // Credit counts derive from @pseo/core CREDIT_PACKAGES (starter 1,000 · pro 3,500).
    expect(screen.getByText("1,000 credits")).toBeTruthy();
    expect(screen.getByText("3,500 credits")).toBeTruthy();
  });

  it("renders the top-ups with CREDIT_PACKAGES-derived credits", () => {
    render(<BillingPage />);
    expect(screen.getByText("$10")).toBeTruthy();
    expect(screen.getByText("400 credits")).toBeTruthy();
    expect(screen.getByText("2,400 credits")).toBeTruthy();
  });

  it("Buy buttons are disabled with a checkout-coming-soon note (purchase lands in T7)", () => {
    render(<BillingPage />);
    const buttons = screen.getAllByRole("button", { name: "Buy" });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText("Checkout coming soon").length).toBeGreaterThan(0);
  });
});
