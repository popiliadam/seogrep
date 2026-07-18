import { configDefaults, defineConfig } from "vitest/config";

// Fast-gate config (turbo `test` / verify.sh). ledger-repo.test.ts needs a live
// Supabase stack, so it is excluded here and runs only via vitest.db.config.ts.
export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "src/ledger-repo.test.ts"],
  },
});
