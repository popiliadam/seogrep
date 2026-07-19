import { describe, expect, it } from "vitest";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "./env.ts";

/**
 * Negative + positive proofs for the DataForSEO env reads, exercised with the REAL prod
 * variable names (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD / DFS_LIVE). Signed lesson #5:
 * env-reading code is negative-tested against the actual prod names, because a local
 * gate's own export names can mask the prod contract. A separate file so the existing
 * env.test.ts is left untouched.
 */

describe("isDfsLiveEnabled", () => {
  it("is true ONLY for an exact DFS_LIVE=1 (paid path stays off by default)", () => {
    expect(isDfsLiveEnabled({ DFS_LIVE: "1" })).toBe(true);
  });

  it("is false when DFS_LIVE is unset, empty, or any other value", () => {
    expect(isDfsLiveEnabled({})).toBe(false);
    expect(isDfsLiveEnabled({ DFS_LIVE: "" })).toBe(false);
    expect(isDfsLiveEnabled({ DFS_LIVE: "0" })).toBe(false);
    expect(isDfsLiveEnabled({ DFS_LIVE: "true" })).toBe(false);
    expect(isDfsLiveEnabled({ DFS_LIVE: " 1 " })).toBe(false);
  });
});

describe("requireDataForSeoCredentials", () => {
  it("returns the login + password when both real prod vars are present", () => {
    expect(
      requireDataForSeoCredentials({ DATAFORSEO_LOGIN: "user@x.test", DATAFORSEO_PASSWORD: "pw" }),
    ).toEqual({ login: "user@x.test", password: "pw" });
  });

  it("fails closed, naming BOTH variables, when either is missing", () => {
    expect(() => requireDataForSeoCredentials({})).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
    expect(() => requireDataForSeoCredentials({ DATAFORSEO_LOGIN: "user@x.test" })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
    expect(() => requireDataForSeoCredentials({ DATAFORSEO_PASSWORD: "pw" })).toThrow(
      /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/,
    );
    // Present-but-blank must also fail closed (a whitespace value is not a credential).
    expect(() =>
      requireDataForSeoCredentials({ DATAFORSEO_LOGIN: "  ", DATAFORSEO_PASSWORD: "pw" }),
    ).toThrow(/DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/);
  });
});
