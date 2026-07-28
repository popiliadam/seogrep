import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

/**
 * The honesty guards below assert what the copy must NOT say, so they would pass vacuously on an
 * empty render. Every one of them goes through here: an anchor heading plus a length floor means a
 * page that rendered nothing fails loudly instead of looking green.
 */
function renderedText(): string {
  const { container } = render(<Page />);
  const text = container.textContent ?? "";
  expect(text, "empty render — the negative guards below would pass vacuously").toContain(
    "Credits and payment",
  );
  expect(text.length, "page rendered far less copy than the terms have").toBeGreaterThan(1000);
  return text;
}

describe("terms page", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the policy h1", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Terms of Service");
  });

  it("calls itself effective, not a draft — a service taking real money has no draft terms", () => {
    const text = renderedText();
    expect(text).not.toMatch(/\bdrafts?\b/i);
    expect(text).toContain("Effective 28 July 2026");
  });

  it("freezes the effective date — a computed date would silently move with the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-09T12:00:00Z"));
    render(<Page />);
    expect(screen.getByText(/Effective 28 July 2026/)).toBeDefined();
  });

  it("names Paddle as merchant of record, matching the refund policy", () => {
    render(<Page />);
    expect(screen.getByText(/merchant of record/i)).toBeDefined();
    expect(screen.getAllByText(/Paddle/).length).toBeGreaterThan(0);
  });

  it("states the real credit policy: no expiry, not the unimplemented rollover", () => {
    // There is no expiry job and no rollover cap in the code — balance is SUM(delta) over an
    // append-only ledger (packages/db/supabase/migrations/0002_credit_ledger.sql). The spec's
    // D14 "1 month carry-over, 2x cap" was never built, so the terms must not promise it.
    const text = renderedText();
    expect(text).toMatch(/unused credits stay in your balance and do not expire/i);
    expect(text).not.toMatch(/roll[-\s]?over|carr(y|ied)[-\s]?over/i);
  });

  it("drops the pre-launch hedge on pricing — the document is live and so is checkout", () => {
    expect(renderedText()).not.toMatch(/before launch/i);
  });

  it("points at the refund policy instead of leaving refunds unmentioned", () => {
    render(<Page />);
    const link = screen.getByRole("link", { name: /refund policy/i });
    expect(link.getAttribute("href")).toBe("/refunds");
    expect(screen.getByText(/within 14 days of a purchase/i)).toBeDefined();
  });

  it("keeps the pricing page as the single source of plan and credit numbers (NEVER #6)", () => {
    render(<Page />);
    expect(screen.getByRole("link", { name: /view pricing/i }).getAttribute("href")).toBe("/pricing");
    expect(renderedText()).not.toMatch(/\$\d/);
  });

  it("leaves statutory consumer rights untouched", () => {
    render(<Page />);
    expect(screen.getByText(/rights you have as a consumer/i)).toBeDefined();
  });

  it("says how the terms change, so the effective date means something", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 2, name: /changes to these terms/i })).toBeDefined();
  });

  it("names no legal entity or jurisdiction we have not confirmed", () => {
    // The operator is a Turkish sole trader; no trading entity or governing law is settled in the
    // repo. Inventing either is worse than staying silent — this pins the silence.
    const text = renderedText();
    expect(text).not.toMatch(/governing law|governed by the laws|jurisdiction of|Ltd\.|LLC|A\.Ş\.|Inc\./i);
  });
});
