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
    "Processors we use",
  );
  expect(text.length, "page rendered far less copy than the policy has").toBeGreaterThan(1500);
  return text;
}

describe("privacy page", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the policy h1", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Privacy Policy");
  });

  it("calls itself effective, not a draft — a live policy cannot describe itself as unfinished", () => {
    const text = renderedText();
    expect(text).not.toMatch(/\bdrafts?\b/i);
    // Moved 28 July -> 4 August 2026 with the M-25 rewrite of "Your rights" and "Data retention".
    // The page's own "Changes to this policy" section promises this date moves when the policy is
    // updated, so leaving it would have made the policy breach its own rule on the way out.
    expect(text).toContain("Effective 5 August 2026");
  });

  it("freezes the effective date — a computed date would silently move with the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-09T12:00:00Z"));
    render(<Page />);
    expect(screen.getByText(/Effective 5 August 2026/)).toBeDefined();
  });

  it("does not promise erasure of the append-only credit ledger", () => {
    // credit_ledger REVOKEs UPDATE/DELETE/TRUNCATE from every role and rejects row mutations via
    // reject_mutation(), and its user_id FK is ON DELETE RESTRICT
    // (packages/db/supabase/migrations/0002_credit_ledger.sql:12,32-41). "We remove everything" is
    // therefore false; the exception has to be on the page.
    const text = renderedText();
    expect(text).toMatch(/append-only/i);
    expect(text).toMatch(/accounting records/i);
    expect(text).not.toMatch(/remove (all|everything|all of it)|erase everything|delete everything/i);
  });

  it("discloses that a generated report gets a public link", () => {
    // generate_report always mints a public_slug and /r/[slug] serves it with no auth
    // (apps/mcp/src/tools/generate-report.ts:80, apps/web/app/r/[slug]/page.tsx:8).
    render(<Page />);
    expect(screen.getByText(/public link/i)).toBeDefined();
    expect(screen.getByText(/without signing in/i)).toBeDefined();
  });

  it("names every third party the running system actually touches", () => {
    const text = renderedText();
    for (const processor of ["Supabase", "Netlify", "Fly.io", "Paddle", "Resend", "PostHog", "Google", "DataForSEO"]) {
      expect(text, `${processor} missing from the processor list`).toContain(processor);
    }
  });

  it("describes the Search Console connection as read-only and encrypted at rest", () => {
    // GSC_READONLY_SCOPE (packages/core/src/gsc/client.ts:23) + the sealed bytea token in
    // apps/web/lib/gsc/store.ts — the policy must claim neither more nor less.
    const text = renderedText();
    expect(text).toMatch(/refresh token encrypted at rest/i);
    expect(text).toMatch(/read-only access only/i);
  });

  it("commits to the Google API Services User Data Policy, including Limited Use", () => {
    // Google's sensitive-scope verification (webmasters.readonly) checks the privacy policy for this
    // disclosure by name; it is also a real promise the running system keeps — GSC data only feeds
    // the user's own analyses (packages/core/src/gsc/client.ts) and never leaves the service.
    const text = renderedText();
    expect(text).toContain("Google API Services User Data Policy");
    expect(text).toMatch(/Limited Use/);
    expect(text).toMatch(/never used for advertising/i);
  });

  it("keeps PostHog honest: a hashed identifier, not the email address", () => {
    // lib/analytics.ts sends sha256(user id) as distinct_id on all three product events, and the
    // raw id never leaves that module (apps/web/lib/analytics.ts safeCapture).
    expect(renderedText()).toMatch(/hashed identifier/i);
  });

  it("keeps the live support address as the privacy contact", () => {
    render(<Page />);
    expect(screen.getAllByText(/support@seogrep\.com/).length).toBeGreaterThan(1);
  });

  it("keeps the no-AI-training claim the footer and docs also make", () => {
    render(<Page />);
    expect(screen.getByText(/never used to train AI models/i)).toBeDefined();
  });

  it("says how the policy changes, so the effective date means something", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 2, name: /changes to this policy/i })).toBeDefined();
  });

  it("names no legal entity or jurisdiction we have not confirmed", () => {
    const text = renderedText();
    expect(text).not.toMatch(/governing law|governed by the laws|jurisdiction of|Ltd\.|LLC|A\.Ş\.|Inc\./i);
  });
});
