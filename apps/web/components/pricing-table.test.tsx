import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PLANS } from "./pricing-plans";
import { PricingTable } from "./pricing-table";

/**
 * This file exists because a referee found the gap: every plan card was repointed from
 * /#waitlist to /signup and NOTHING pinned it. Reverting that href passed all 584 web tests and
 * verify.sh, and shipped four buttons that scroll a buyer to a dead anchor. The landing page's
 * "leaves no waitlist anchor behind" test only inspects the landing DOM, so it gave false comfort
 * about exactly this component.
 */
describe("PricingTable", () => {
  it("routes every plan card to /signup", () => {
    render(<PricingTable />);
    const ctas = screen.getAllByRole("link");
    expect(ctas.length).toBe(PLANS.length);
    for (const cta of ctas) expect(cta.getAttribute("href")).toBe("/signup");
  });

  it("leaves no link pointing at the removed waitlist", () => {
    const { container } = render(<PricingTable />);
    expect(container.querySelector('a[href*="waitlist"]')).toBeNull();
  });

  it("renders one card per plan", () => {
    render(<PricingTable />);
    for (const plan of PLANS) {
      expect(screen.getByRole("heading", { name: plan.name })).toBeDefined();
    }
  });
});
