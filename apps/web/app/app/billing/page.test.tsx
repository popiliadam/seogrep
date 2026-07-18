import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BillingPage from "./page";

/** The card (li) that contains `text`; throws with a readable message if absent. */
function cardOf(text: string): HTMLElement {
  const card = screen.getByText(text).closest("li");
  if (card === null) throw new Error(`no card contains "${text}"`);
  return card;
}

describe("BillingPage", () => {
  it("pairs each plan's price with its CREDIT_PACKAGES credits in the SAME card", () => {
    render(<BillingPage />);
    // Prices re-used from the shared Faz 1 pricing source; credits derive from
    // @pseo/core CREDIT_PACKAGES. within() pins the pairing per card, so a price or
    // credits transposition across cards fails here.
    const plans = [
      ["Trial", "$0", "200 credits"],
      ["Starter", "$19", "1,000 credits"],
      ["Pro", "$49", "3,500 credits"],
      ["Agency", "$149", "12,000 credits"],
    ] as const;
    for (const [name, price, credits] of plans) {
      const card = cardOf(name);
      expect(within(card).getByText(price)).toBeTruthy();
      expect(within(card).getByText(credits)).toBeTruthy();
    }
  });

  it("pairs each top-up's price with its CREDIT_PACKAGES credits in the SAME card", () => {
    render(<BillingPage />);
    const topUps = [
      ["$10", "400 credits"],
      ["$25", "1,100 credits"],
      ["$50", "2,400 credits"],
    ] as const;
    for (const [price, credits] of topUps) {
      expect(within(cardOf(price)).getByText(credits)).toBeTruthy();
    }
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
