import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import { SECURITY_HEADER_RULES } from "./lib/security-headers";

// The GSC OAuth routes consume the at-rest token crypto + Google REST client from
// @pseo/core (a built workspace package, like @pseo/db) — no raw-TypeScript source
// deep-import, so no transpilePackages entry is needed.

// The header rules themselves live in lib/security-headers.ts so they are covered by the test
// run; this file is only the wiring (L-11).
const nextConfig: NextConfig = {
  async headers() {
    return SECURITY_HEADER_RULES.map((rule) => ({
      source: rule.source,
      headers: rule.headers.map((header) => ({ key: header.key, value: header.value })),
    }));
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
