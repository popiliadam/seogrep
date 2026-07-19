import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withCredits } from "./guard.ts";

/**
 * Fast-lane tests for the zero-cost path of withCredits. Every SUPABASE_* variable
 * is stripped for the duration of each test, so ANY attempt to construct a DB
 * client (and therefore any reserve RPC) would throw the loadEnv error — passing
 * proves the 0-credit path skips the ledger entirely (brief proof (d), unit half;
 * the DB-observed half lives in guard.db.test.ts).
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

describe("withCredits zero-cost path (no env, no DB)", () => {
  it("runs fn and returns its value for a 0-credit tool (whats_next)", async () => {
    let calls = 0;
    const result = await withCredits(
      { userId: "user-1" },
      { tool: "whats_next", jobId: "job-1" },
      async () => {
        calls += 1;
        return "advice";
      },
    );
    expect(result).toBe("advice");
    expect(calls).toBe(1);
  });

  it("propagates fn errors unchanged (nothing reserved, nothing to release)", async () => {
    await expect(
      withCredits({ userId: "user-1" }, { tool: "get_job_status", jobId: "job-1" }, async () => {
        throw new Error("tool blew up");
      }),
    ).rejects.toThrow("tool blew up");
  });
});
