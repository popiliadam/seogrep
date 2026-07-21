import { afterEach, describe, expect, it, vi } from "vitest";
import { createServiceClient } from "./db.ts";

/**
 * Negative env proofs for the MCP service-role client factory (signed lesson #5, 2026-07-18):
 * createServiceClient must fail LOUD, naming the REAL prod vars (SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY), when either is missing — never construct a half-configured
 * RLS-bypassing client. A separate *.env.test.ts (not *.db.test.ts) so it runs in the fast,
 * DB-less gate: the factory throws (or builds a stateless client object) without any connection.
 */

const URL = "https://project.supabase.co";
const KEY = "service-role-key-value";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createServiceClient (apps/mcp db.ts)", () => {
  it("returns a client when both prod vars are present", () => {
    vi.stubEnv("SUPABASE_URL", URL);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY);
    expect(createServiceClient()).toBeDefined();
  });

  it.each(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])(
    "throws (naming both prod vars) when %s is missing",
    (missing) => {
      vi.stubEnv("SUPABASE_URL", URL);
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY);
      vi.stubEnv(missing, "");
      expect(() => createServiceClient()).toThrowError(
        /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/,
      );
    },
  );
});
