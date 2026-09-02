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

// The global policy (L-11, widened for L-10). It used to be frame-ancestors ONLY, which left
// every marketing, auth and app route with clickjacking defence and nothing else — no layer at all
// between an XSS and data leaving the page (L-10, audit 2026-08-26).
//
// WHAT IS ADDED, AND WHY EXACTLY THESE TWO. Both forbid a capability this product does not use, so
// each was VERIFIED UNUSED before being turned on rather than assumed:
//
//   base-uri 'none'   — grepped: this app renders no <base> element anywhere. It is also the
//                       highest-value directive available without a nonce: an injected
//                       `<base href="//attacker">` silently retargets EVERY relative URL on the
//                       page, script src included, turning one injection point into all of them.
//   object-src 'none' — grepped: no <object> and no <embed>. Plugin content is a legacy script
//                       execution path with no use here.
//
// WHAT IS DELIBERATELY NOT ADDED, each for a MEASURED reason rather than caution:
//
//   form-action 'self' — WOULD BREAK A PAYING CUSTOMER. app/billing/actions.ts:103 redirects a
//                        <form action={openCustomerPortal}> submission to Paddle's hosted portal,
//                        i.e. cross-origin, and browsers enforce form-action against the REDIRECT
//                        target. This is exactly the "defense-in-depth header that breaks
//                        checkout" trade the constitution's NEVER list exists to prevent.
//   script-src / connect-src / default-src — cannot be added honestly from a static reading. Next
//                        ships inline hydration scripts, so a real script-src needs per-request
//                        nonces (which also forces dynamic rendering and would move the Lighthouse
//                        numbers), and connect-src must enumerate Supabase, PostHog, Turnstile and
//                        Paddle exactly. Both need verification against a RUNNING app — a login
//                        that breaks under a wrong connect-src is a total outage. Staging that is
//                        the remaining half of L-10 and is still open.
//
// X-Frame-Options is the second layer for user agents that do not implement CSP3 frame-ancestors.
const GLOBAL_CSP = ["frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'"].join("; ");

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
