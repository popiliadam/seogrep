/**
 * Response security headers, in ONE testable place because next.config.ts itself is not covered
 * by the test run (L-11: the previous, config-only rule was never asserted anywhere).
 *
 * Consumed by next.config.ts's headers(). Order matters: Next applies every matching rule in
 * order and a later rule wins for the same header key, so the catch-all comes first and the
 * stricter report policy last.
 */

interface HeaderRule {
  readonly source: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

/** Next's catch-all for headers — matches "/" and every nested path. */
export const GLOBAL_SOURCE = "/:path*";
export const REPORT_SOURCE = "/r/:slug*";

// Content-Security-Policy for the PUBLIC report route /r/[slug] (C-S1). That page injects a
// stored, self-contained report document via dangerouslySetInnerHTML. The document is safe
// today (single trusted server-side writer; renderReportHtml escapes every dynamic value) —
// this header is defense-in-depth so a future second writer/import path can never escalate to
// stored XSS. The report is a static document: inline <style> only, no <script>, no external
// requests. So we forbid everything (default-src 'none'), block ALL scripts including inline
// (script-src 'none' — an injected <script> in the report body cannot execute), and allow only
// the inline stylesheet the report ships. The page has no client interactivity, so 'none' does
// not break it.
const REPORT_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// Frame protection for EVERY route (L-11). It used to exist only inside the report CSP above,
// which left /login, /signup and the whole /app dashboard with no clickjacking defence at all —
// a live check confirmed the platform adds none. Deliberately frame-ancestors ONLY: a global
// script-src/default-src would have to model the whole marketing + docs + dashboard surface, and
// getting that wrong breaks the product. X-Frame-Options is the second layer for user agents
// that do not implement CSP3 frame-ancestors.
const GLOBAL_CSP = "frame-ancestors 'none'";

export const SECURITY_HEADER_RULES: readonly HeaderRule[] = [
  {
    source: GLOBAL_SOURCE,
    headers: [
      { key: "Content-Security-Policy", value: GLOBAL_CSP },
      { key: "X-Frame-Options", value: "DENY" },
      // Full URLs (which can carry a report slug or a query) never leave the origin; same-origin
      // navigation keeps the full referrer, cross-origin gets the bare origin, HTTPS->HTTP none.
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Deny the powerful features this product never asks for, so an injected/embedded frame
      // cannot prompt for them in our name. NOT payment=(): the Paddle checkout overlay uses the
      // Payment Request API for Apple/Google Pay, and denying it would break paid conversion.
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ],
  },
  {
    // Last: its CSP must override the frame-only global policy for the report route.
    source: REPORT_SOURCE,
    headers: [{ key: "Content-Security-Policy", value: REPORT_CSP }],
  },
];
