import { configDefaults, defineConfig } from "vitest/config";

// Fast-gate config (turbo `test` / verify.sh). *.db.test.ts files need a live
// Supabase stack, so they are excluded here and run only via vitest.db.config.ts —
// the naming glob keeps the split self-maintaining for future DB tests.
export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "src/**/*.db.test.ts"],
  },
});
