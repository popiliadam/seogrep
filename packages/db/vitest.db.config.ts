import { defineConfig } from "vitest/config";

/**
 * DB-integration config: runs ledger-repo.test.ts ONLY, against a local Supabase
 * stack. Deliberately kept out of the fast gate (verify.sh / turbo `test`, which use
 * the default vitest.config.ts). Invoked solely by guardrails/verify-db.sh, which
 * boots the stack and exports SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/ledger-repo.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
