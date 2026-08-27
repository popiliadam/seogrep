import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GLOBAL_SOURCE, REPORT_SOURCE, SECURITY_HEADER_RULES } from "./security-headers";

function ruleFor(source: string) {
  return SECURITY_HEADER_RULES.find((rule) => rule.source === source);
}

function headerValue(source: string, key: string): string | undefined {
  return ruleFor(source)?.headers.find((header) => header.key.toLowerCase() === key.toLowerCase())
    ?.value;
}

/**
 * L-11: frame-ancestors was scoped to /r/:slug*, so /login, /signup and the whole /app dashboard
 * shipped NO frame protection at all — clickjacking defence was left to a platform default that
 * the 2026-07-28 live check showed was not there. These pins keep the protection
 * repository-enforced rather than deploy-dependent.
 */
describe("security header rules", () => {
  it("applies frame protection to EVERY route, not just the public report", () => {
    const global = ruleFor(GLOBAL_SOURCE);
    expect(global).toBeDefined();
    // "/:path*" is Next's catch-all for headers: it matches "/" and every nested path, so /login,
    // /signup and /app/* are all covered by construction.
    expect(GLOBAL_SOURCE).toBe("/:path*");
    expect(headerValue(GLOBAL_SOURCE, "content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  /**
   * L-10. The global policy carried frame-ancestors and nothing else, so outside the public report
   * route there was no CSP layer at all. These two directives are the ones that could be turned on
   * from a static reading — the capability each forbids was grepped for and is unused.
   */
  it("blocks <base> hijacking and plugin content on every route (L-10)", () => {
    const csp = headerValue(GLOBAL_SOURCE, "content-security-policy") ?? "";
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  /**
   * The NEGATIVE half, and it is the more important one. form-action 'self' looks like an obvious
   * hardening win and would break a paying customer: app/billing/actions.ts redirects a form
   * submission to Paddle's hosted portal, and browsers apply form-action to the redirect target.
   * Pinning its ABSENCE means a future "let's tighten the CSP" pass has to read this test — and the
   * reason on the constant — before it can delete the line.
   */
  it("does NOT set form-action globally: the Paddle portal is a cross-origin form redirect", () => {
    const csp = headerValue(GLOBAL_SOURCE, "content-security-policy") ?? "";
    expect(csp).not.toContain("form-action");
    // The report route is a different case and keeps its lockdown: that page has no form at all.
    expect(headerValue(REPORT_SOURCE, "content-security-policy")).toContain("form-action 'none'");
  });

  it("carries X-Frame-Options: DENY as the second layer for pre-CSP3 user agents", () => {
    expect(headerValue(GLOBAL_SOURCE, "x-frame-options")).toBe("DENY");
  });

  it("does not leak full URLs to third parties (Referrer-Policy)", () => {
    expect(headerValue(GLOBAL_SOURCE, "referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("denies powerful features the product never uses (Permissions-Policy)", () => {
    const policy = headerValue(GLOBAL_SOURCE, "permissions-policy");
    expect(policy).toBeDefined();
    for (const feature of ["camera=()", "microphone=()", "geolocation=()"]) {
      expect(policy).toContain(feature);
    }
    // payment=() would disable the Payment Request API that the Paddle checkout overlay uses
    // for Apple/Google Pay — denying it here would break paid conversion.
    expect(policy).not.toContain("payment=()");
  });

  it("keeps the strict C-S1 report CSP intact (frame hardening must not dilute it)", () => {
    const reportCsp = headerValue(REPORT_SOURCE, "content-security-policy");
    expect(reportCsp).toBeDefined();
    for (const directive of [
      "default-src 'none'",
      "script-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src 'self' data:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(reportCsp).toContain(directive);
    }
  });

  /**
   * L-02 is not a header this module emits — it is Next's `poweredByHeader` FLAG, and turning it
   * off removes `x-powered-by: Next.js` (a free framework fingerprint) from every response. There
   * is nothing importable to assert, so this reads next.config.ts as text.
   *
   * A SOURCE-TEXT ASSERTION IS A WEAK TEST AND IS USED DELIBERATELY, with its weakness named. It
   * does NOT prove the running server omits the header; what proves the flag reaches the server is
   * `next build` resolving it into .next/required-server-files.json, measured 2026-08-27. What
   * this test CAN do is fail when someone deletes or flips the flag, which is the regression that
   * would otherwise ship in silence. Asserting the VALUE too, not just the key, is the difference
   * between this and a test that stays green when the flag goes back to `true` — both mutations
   * were run and both measured red before this test was kept.
   */
  it("keeps Next's x-powered-by fingerprint disabled in next.config.ts (L-02)", () => {
    // Resolved from the package root (vitest runs with cwd = apps/web). A wrong cwd makes
    // readFileSync THROW rather than return empty, so this cannot degrade into a silent pass.
    const config = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toMatch(/poweredByHeader\s*:\s*false/);
    expect(config).not.toMatch(/poweredByHeader\s*:\s*true/);
  });

  it("orders the report rule LAST so its stricter CSP wins over the global one", () => {
    const globalIndex = SECURITY_HEADER_RULES.findIndex((rule) => rule.source === GLOBAL_SOURCE);
    const reportIndex = SECURITY_HEADER_RULES.findIndex((rule) => rule.source === REPORT_SOURCE);
    expect(globalIndex).toBeGreaterThanOrEqual(0);
    // Next applies matching rules in order and a later rule wins for the same header key, so the
    // report page keeps its full lockdown instead of the frame-only global policy.
    expect(reportIndex).toBeGreaterThan(globalIndex);
  });
});
