import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// The GSC OAuth routes consume the at-rest token crypto + Google REST client from
// @pseo/core (a built workspace package, like @pseo/db) — no raw-TypeScript source
// deep-import, so no transpilePackages entry is needed.
const nextConfig: NextConfig = {};

const withMDX = createMDX();

export default withMDX(nextConfig);
