import { configDefaults, defineConfig } from "vitest/config";

// Fast-gate config (turbo `test` / verify.sh). *.db.test.ts files need a live Supabase
// stack, so they are excluded here and run only via vitest.db.config.ts — same split as
// packages/db and @pseo/mcp (the naming glob keeps it self-maintaining for future DB tests).
export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "components/**/*.test.tsx",
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
    ],
    exclude: [...configDefaults.exclude, "**/*.db.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
  esbuild: { jsx: "automatic" }
});
