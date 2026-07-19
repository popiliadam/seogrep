import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enqueueJob } from "./boss.ts";

/**
 * Negative env tests with the REAL production variable names (project law /
 * signed lesson #5: env-reading code is negative-tested against the prod
 * contract — local gate exports must never mask it). No Supabase stack is
 * involved: enqueueJob must fail fast in loadEnv before any connection attempt.
 */

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("enqueueJob env contract (prod names, negative)", () => {
  it("fails fast naming SUPABASE_DB_URL when only it is missing", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-value";
    await expect(
      enqueueJob({ userId: "user-1" }, { tool: "whats_next" }),
    ).rejects.toThrow(/SUPABASE_DB_URL/);
  });

  it("fails fast naming every missing variable when none are set", async () => {
    await expect(enqueueJob({ userId: "user-1" }, { tool: "whats_next" })).rejects.toThrow(
      /SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY.*SUPABASE_DB_URL/s,
    );
  });
});
