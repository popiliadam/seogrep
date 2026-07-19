import { defineConfig } from "vitest/config";
// test:db lane — ONLY the DB-integration specs. Requires the local Supabase
// stack env (export via `supabase status -o env`, see guardrails/verify-db.sh).
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.db.test.ts"] },
});
