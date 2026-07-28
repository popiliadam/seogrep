import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page, { metadata } from "./page";

/**
 * The honesty guards below assert what the copy must NOT say, so they would pass vacuously on an
 * empty render. Every one of them goes through here: an anchor heading plus a length floor means a
 * page that rendered nothing fails loudly instead of looking green.
 */
function renderedText(): string {
  const { container } = render(<Page />);
  const text = container.textContent ?? "";
  expect(text, "empty render — the negative guards below would pass vacuously").toContain(
    "14-day refund window",
  );
  expect(text.length, "page rendered far less copy than the policy has").toBeGreaterThan(1000);
  return text;
}

describe("refunds page", () => {
  it("renders the policy h1", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Refund Policy");
  });

  it("states the 14-day window and the unused-credits condition", () => {
    render(<Page />);
    expect(screen.getByText(/within 14 days of a purchase/i)).toBeDefined();
    expect(screen.getByText(/substantially unused/i)).toBeDefined();
  });

  it("names Paddle as merchant of record (Paddle bills, invoices, and refunds)", () => {
    render(<Page />);
    expect(screen.getByText(/merchant of record/i)).toBeDefined();
    expect(screen.getAllByText(/Paddle/).length).toBeGreaterThan(0);
  });

  it("gives the support address on both the policy and the how-to-request section", () => {
    render(<Page />);
    expect(screen.getAllByText(/support@seogrep\.com/).length).toBeGreaterThan(1);
  });

  it("says consumed credits are not refundable", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 2, name: /what is not refundable/i })).toBeDefined();
    expect(screen.getByText(/already spent are not refundable/i)).toBeDefined();
  });

  it("describes cancellation as access to the end of the paid period with no refund for it", () => {
    render(<Page />);
    expect(screen.getByText(/no refund for the remainder of that period/i)).toBeDefined();
  });

  it("keeps a cancellation path for subscribers the portal button never renders for", () => {
    // billing/page.tsx gates the portal on PADDLE_API_KEY && status === "active" exactly, so
    // past_due/paused subscribers see no button — the copy must not send them to a dead end.
    render(<Page />);
    expect(screen.getByText(/cancel with Paddle directly/i)).toBeDefined();
  });

  it("states how long an approved refund takes to land, hedged on the bank", () => {
    render(<Page />);
    expect(screen.getByText(/funds usually appear within 5.10 business days/i)).toBeDefined();
    expect(screen.getByText(/depending on your bank/i)).toBeDefined();
  });

  it("promises no pro-rata refund the billing system cannot give (honesty pin)", () => {
    // Catches "prorated"/"pro-rated" too — the /pro[-\s]?rata/i first cut did not.
    expect(renderedText()).not.toMatch(/pro[-\s]?rat(a|ed)/i);
  });

  it("claims no automatic credit clawback — there is no refund handler in the webhook", () => {
    expect(renderedText()).not.toMatch(/clawed back|automatically removed|reversed automatically/i);
  });

  it("reuses the site's real trial claim instead of inventing one", () => {
    render(<Page />);
    expect(screen.getByText(/200 credits, no card required/i)).toBeDefined();
  });

  it("leaves statutory consumer rights untouched", () => {
    render(<Page />);
    expect(screen.getByText(/rights you have as a consumer/i)).toBeDefined();
  });

  it("keeps a title and a description within the meta budget, with no price figure", () => {
    expect(typeof metadata.title).toBe("string");
    expect((metadata.title as string).length).toBeGreaterThan(0);
    expect((metadata.description as string).length).toBeLessThanOrEqual(155);
    expect(metadata.description as string).not.toMatch(/\$\d/);
  });
});
