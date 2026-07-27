import { describe, expect, it } from "vitest";
import { loadEnv, requireTokenEncryptionKey, requireWebBaseUrl } from "./env.ts";

/**
 * A complete environment using the REAL production variable names. The
 * 2026-07-18 SUPABASE_URL incident (local export names masked the prod
 * contract) is the signed lesson behind pinning these exact names here.
 */
const completeEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value",
  SUPABASE_DB_URL: "postgres://user:pass@db.host:5432/postgres",
} as const;

describe("loadEnv", () => {
  it("parses a complete environment and defaults PORT to 8080", () => {
    const env = loadEnv({ ...completeEnv });
    expect(env.SUPABASE_URL).toBe(completeEnv.SUPABASE_URL);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(completeEnv.SUPABASE_SERVICE_ROLE_KEY);
    expect(env.SUPABASE_DB_URL).toBe(completeEnv.SUPABASE_DB_URL);
    expect(env.PORT).toBe(8080);
  });

  it("honours an explicit PORT (dev uses 3458)", () => {
    const env = loadEnv({ ...completeEnv, PORT: "3458" });
    expect(env.PORT).toBe(3458);
  });

  it.each(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"])(
    "throws an error naming the missing %s",
    (missingKey) => {
      const partial: Record<string, string> = { ...completeEnv };
      delete partial[missingKey];
      expect(() => loadEnv(partial)).toThrowError(new RegExp(missingKey));
    },
  );

  it("names every missing required key in one error", () => {
    expect(() => loadEnv({})).toThrowError(
      /SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY.*SUPABASE_DB_URL/s,
    );
  });
});

/**
 * SUPABASE_DB_URL structural contract. A malformed value (a left-over `[YOUR-PASSWORD]`
 * placeholder) once satisfied min(1), so the gateway booted and pg-boss only crashed later
 * at runtime: the worker crash-looped, Fly stopped it, and the async pipeline was down while
 * /status stayed green. These cases pin the boot-time rejection with the REAL prod name.
 */
const INVALID_DB_URLS = [
  ["not a url", /SUPABASE_DB_URL must be a valid URL/],
  ["http://host:5432/db", /SUPABASE_DB_URL must use the postgres:\/\/ or postgresql:\/\/ scheme/],
  ["postgresql://user:[YOUR-PASSWORD]@host:5432/db", /SUPABASE_DB_URL must not contain/],
  ["postgresql:///db", /SUPABASE_DB_URL must include a host/],
  ["", /SUPABASE_DB_URL is required/],
] as const;

describe("SUPABASE_DB_URL structural validation", () => {
  it.each([
    "postgresql://user:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
    "postgresql://user:pass@db.example.supabase.co/postgres",
  ])("accepts the prod-shaped connection string %s", (dbUrl) => {
    expect(loadEnv({ ...completeEnv, SUPABASE_DB_URL: dbUrl }).SUPABASE_DB_URL).toBe(dbUrl);
  });

  it("trims surrounding whitespace so the delivered value is clean", () => {
    // new URL() ignores surrounding spaces, so a padded value passed validation while the
    // RAW string reached pg-boss, which read it as a relative URL and silently resolved a
    // garbage host — the same silent-async-down shape as the placeholder incident.
    const dbUrl = "postgresql://user:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
    expect(loadEnv({ ...completeEnv, SUPABASE_DB_URL: `  ${dbUrl}  ` }).SUPABASE_DB_URL).toBe(
      dbUrl,
    );
  });

  it.each(INVALID_DB_URLS)("rejects %s at boot", (dbUrl, expected) => {
    expect(() => loadEnv({ ...completeEnv, SUPABASE_DB_URL: dbUrl })).toThrowError(expected);
  });

  it("uses a distinct message per violated rule", () => {
    const messages = INVALID_DB_URLS.map(([dbUrl]) => {
      try {
        loadEnv({ ...completeEnv, SUPABASE_DB_URL: dbUrl });
        return "accepted";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("still aggregates a malformed SUPABASE_DB_URL with another missing key in one error", () => {
    const partial: Record<string, string> = {
      ...completeEnv,
      SUPABASE_DB_URL: "postgresql://user:[YOUR-PASSWORD]@host:5432/db",
    };
    delete partial.SUPABASE_URL;
    expect(() => loadEnv(partial)).toThrowError(
      /SUPABASE_URL: .*SUPABASE_DB_URL must not contain/s,
    );
  });
});

/**
 * Negative cases for the two fail-closed readers (signed lesson #5, 2026-07-18): a missing
 * secret must fail loudly and NAME the real prod variable, never degrade silently. These pin
 * the CURRENT (already-correct) behaviour of requireWebBaseUrl / requireTokenEncryptionKey as
 * a contract, so a future regression here is caught the same way the SUPABASE_URL incident
 * should have been.
 */
describe("requireWebBaseUrl", () => {
  it("throws an error naming WEB_BASE_URL when it is missing", () => {
    expect(() => requireWebBaseUrl({})).toThrowError(/WEB_BASE_URL/);
  });

  it("trims a trailing slash so callers can append a path", () => {
    expect(requireWebBaseUrl({ WEB_BASE_URL: "https://seogrep.com/" })).toBe(
      "https://seogrep.com",
    );
  });
});

describe("requireTokenEncryptionKey", () => {
  it("throws an error naming TOKEN_ENCRYPTION_KEY when it is missing", () => {
    expect(() => requireTokenEncryptionKey({})).toThrowError(/TOKEN_ENCRYPTION_KEY/);
  });
});

describe("valid values pass through unchanged", () => {
  it("requireWebBaseUrl and requireTokenEncryptionKey return the configured value", () => {
    expect(requireWebBaseUrl({ WEB_BASE_URL: "https://seogrep.com" })).toBe(
      "https://seogrep.com",
    );
    const KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
    expect(requireTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: KEY })).toBe(KEY);
  });
});
