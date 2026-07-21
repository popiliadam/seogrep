import { describe, expect, it } from "vitest";
import { requireSupabaseAnonKey, requireSupabaseUrl } from "./public-env";

/**
 * Negative + positive proofs for the two PUBLIC Supabase env validators, pinned against the
 * REAL prod variable names (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Signed
 * lesson #5 (2026-07-18 SUPABASE_URL incident): a missing secret must fail loud and NAME the
 * prod variable, never degrade silently — the bare `!` assertions these guards replaced passed
 * `undefined` straight into the Supabase client.
 */

describe("requireSupabaseUrl", () => {
  it("returns the value unchanged when present", () => {
    expect(requireSupabaseUrl("https://project.supabase.co")).toBe("https://project.supabase.co");
  });

  it("throws naming NEXT_PUBLIC_SUPABASE_URL when it is missing", () => {
    expect(() => requireSupabaseUrl(undefined)).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("fails closed on a blank value (whitespace is not a configuration)", () => {
    expect(() => requireSupabaseUrl("   ")).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("requireSupabaseAnonKey", () => {
  it("returns the value unchanged when present", () => {
    expect(requireSupabaseAnonKey("anon-key-value")).toBe("anon-key-value");
  });

  it("throws naming NEXT_PUBLIC_SUPABASE_ANON_KEY when it is missing", () => {
    expect(() => requireSupabaseAnonKey(undefined)).toThrowError(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("fails closed on a blank value", () => {
    expect(() => requireSupabaseAnonKey("")).toThrowError(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
