import { defineConfig } from "vitest/config";
// DB-integration specs (*.db.test.ts) run in the separate test:db lane so the
// fast gate (verify.sh) stays DB-less — same split as packages/db.
export default defineConfig({
  test: { environment: "node", exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.db.test.ts"] },
});
