import { afterEach, describe, expect, it, vi } from "vitest";
import { createServiceClient } from "./server.js";

/**
 * Negative env proofs for the @pseo/db service-role factory (signed lesson #5, 2026-07-18).
 * It reads SUPABASE_URL, FALLING BACK to NEXT_PUBLIC_SUPABASE_URL — the exact incident fix
 * (Netlify defined only the public name, so the bare read threw the signup trial grant in prod
 * while local gates stayed green) — plus SUPABASE_SERVICE_ROLE_KEY. A url missing under BOTH
 * names, or a missing key, must fail LOUD. Fast, DB-less lane (not *.db.test.ts): the factory
 * decides to throw before opening any connection.
 */

const URL = "https://project.supabase.co";
const KEY = "service-role-key-value";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createServiceClient (@pseo/db server.ts)", () => {
  it("returns a client when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present", () => {
    vi.stubEnv("SUPABASE_URL", URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY);
    expect(createServiceClient()).toBeDefined();
  });

  it("accepts NEXT_PUBLIC_SUPABASE_URL as the url fallback (the Netlify incident fix)", () => {
    // SUPABASE_URL truly UNSET (undefined) — the incident state; the ?? fallback only fires on
    // nullish, not on an empty string, so this must delete the var to exercise the real path.
    vi.stubEnv("SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY);
    expect(createServiceClient()).toBeDefined();
  });

  it("throws when the url is missing under BOTH SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL", () => {
    vi.stubEnv("SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY);
    expect(() => createServiceClient()).toThrowError(
      /SUPABASE_URL.*NEXT_PUBLIC_SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("throws naming SUPABASE_SERVICE_ROLE_KEY when the key is missing", () => {
    vi.stubEnv("SUPABASE_URL", URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    expect(() => createServiceClient()).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
