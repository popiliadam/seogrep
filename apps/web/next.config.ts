import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The GSC OAuth routes reuse the at-rest token crypto + Google REST client that live in
  // @pseo/mcp/src/gsc (one implementation of the seal format, shared with the future
  // pull_gsc_data read path). Those modules ship as raw TypeScript, so Next must transpile
  // the workspace package. They import only node:crypto / fetch and are used from
  // runtime: "nodejs" routes.
  transpilePackages: ["@pseo/mcp"],
};

const withMDX = createMDX();

export default withMDX(nextConfig);
