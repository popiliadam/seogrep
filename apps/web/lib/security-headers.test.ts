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

  it("carries X-Frame-Options: DENY as the second layer for pre-CSP3 user agents", () => {
    expect(headerValue(GLOBAL_SOURCE, "x-frame-options")).toBe("DENY");
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

  it("orders the report rule LAST so its stricter CSP wins over the global one", () => {
    const globalIndex = SECURITY_HEADER_RULES.findIndex((rule) => rule.source === GLOBAL_SOURCE);
    const reportIndex = SECURITY_HEADER_RULES.findIndex((rule) => rule.source === REPORT_SOURCE);
    expect(globalIndex).toBeGreaterThanOrEqual(0);
    // Next applies matching rules in order and a later rule wins for the same header key, so the
    // report page keeps its full lockdown instead of the frame-only global policy.
    expect(reportIndex).toBeGreaterThan(globalIndex);
  });
});
