import { defineConfig } from "vitest/config";

/**
 * DB-integration config: runs *.db.test.ts files ONLY, against a local Supabase stack.
 * Deliberately kept out of the fast gate (verify.sh / turbo `test`, which use
 * vitest.config.ts) — the naming glob keeps the split self-maintaining. Invoked solely by
 * guardrails/verify-db.sh, which boots the stack and exports SUPABASE_URL /
 * SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. Mirrors packages/db/vitest.db.config.ts
 * and apps/mcp/vitest.db.config.ts — same split, third workspace.
 *
 * `environment: "node"` (not the fast gate's "jsdom"): these tests hit a real Postgres/
 * PostgREST stack over HTTP and never touch the DOM.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.db.test.ts", "lib/**/*.db.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
