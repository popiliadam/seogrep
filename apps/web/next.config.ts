import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import { SECURITY_HEADER_RULES } from "./lib/security-headers";

// The GSC OAuth routes consume the at-rest token crypto + Google REST client from
// @pseo/core (a built workspace package, like @pseo/db) — no raw-TypeScript source
// deep-import, so no transpilePackages entry is needed.

// The header rules themselves live in lib/security-headers.ts so they are covered by the test
// run; this file is only the wiring (L-11).
const nextConfig: NextConfig = {
  // Next advertises itself with `x-powered-by: Next.js` unless this is off. It hands an attacker a
  // free framework fingerprint — which stack, therefore which CVE list to try — for nothing in
  // return (L-02, audit 2026-08-26).
  //
  // WHAT WAS ACTUALLY MEASURED, 2026-08-27, and nothing beyond it: `curl -D -` against production
  // returned `x-powered-by: Next.js`, so the finding is live rather than theoretical; and after
  // this flag, `next build` resolves it into .next/required-server-files.json as
  // `"poweredByHeader": false` — the artifact the running server reads its config from. The
  // post-deploy response header itself has NOT been read yet; read it once this ships.
  //
  // Unlike the rules below this is a FRAMEWORK FLAG, not a header this repo emits, so there is
  // nothing importable for a unit test to assert. lib/security-headers.test.ts pins the flag's
  // presence AND its value in this file, so a future edit cannot drop or flip it in silence.
  poweredByHeader: false,
  turbopack: {
    // The monorepo root, stated rather than guessed. Next scans upward for lockfiles and picks a
    // root; on this machine it found a stray /Users/apple/package-lock.json OUTSIDE the repo and
    // announced "we selected the directory of /Users/apple/package-lock.json as the root"
    // (L-08, audit 2026-08-26). Nothing was proven to break, but the root decides which files are
    // traced into the build, so leaving it to whatever lockfiles happen to exist on the builder is
    // a property of the machine rather than of the repo. Derived from this file's own location, so
    // it is right in a worktree, in CI and on Netlify alike.
    root: join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  },
  async headers() {
    return SECURITY_HEADER_RULES.map((rule) => ({
      source: rule.source,
      headers: rule.headers.map((header) => ({ key: header.key, value: header.value })),
    }));
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
