import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// The GSC OAuth routes consume the at-rest token crypto + Google REST client from
// @pseo/core (a built workspace package, like @pseo/db) — no raw-TypeScript source
// deep-import, so no transpilePackages entry is needed.

// Content-Security-Policy for the PUBLIC report route /r/[slug] (C-S1). That page injects a
// stored, self-contained report document via dangerouslySetInnerHTML. The document is safe
// today (single trusted server-side writer; renderReportHtml escapes every dynamic value) —
// this header is defense-in-depth so a future second writer/import path can never escalate to
// stored XSS. The report is a static document: inline <style> only, no <script>, no external
// requests. So we forbid everything (default-src 'none'), block ALL scripts including inline
// (script-src 'none' — an injected <script> in the report body cannot execute), and allow only
// the inline stylesheet the report ships. The page has no client interactivity, so 'none' does
// not break it. Scoped to /r/:slug* so the marketing/app/docs surfaces are untouched.
const REPORT_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/r/:slug*",
        headers: [{ key: "Content-Security-Policy", value: REPORT_CSP }],
      },
    ];
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
