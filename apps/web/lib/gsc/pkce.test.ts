// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  codeChallengeS256,
  createCodeVerifier,
  matchesNonce,
  parsePkceCookie,
  readCookie,
  serializePkceCookie,
} from "./pkce";

/**
 * Unit specs for the PKCE primitives. The route specs prove the two handlers USE them; these
 * prove the pieces themselves hold: a challenge that really is the digest of its verifier, a
 * cookie that round-trips, and a parser that fails closed.
 *
 * Getting the verifier ONTO THE WIRE is no longer this module's job — it is a parameter of
 * @pseo/core's `exchangeCodeForTokens`, specced there against the real request body
 * ("exchangeCodeForTokens — PKCE code_verifier" in packages/core/src/gsc/client.test.ts).
 * The callback route spec still pins that this app hands the cookie's verifier to that
 * parameter, and drives the REAL client with it to prove it survives the package boundary.
 */

describe("createCodeVerifier", () => {
  it("is high-entropy, unique per call, and within RFC 7636's length window", () => {
    const first = createCodeVerifier();
    const second = createCodeVerifier();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(first.length).toBeLessThanOrEqual(128);
    // base64url only — nothing that would need escaping in a form body or a header.
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("codeChallengeS256", () => {
  it("is base64url(SHA-256(verifier)) — the digest, never the secret", () => {
    const verifier = createCodeVerifier();
    const challenge = codeChallengeS256(verifier);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(challenge).not.toContain(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("matches the RFC 7636 appendix B test vector", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("pkce cookie value", () => {
  it("round-trips {nonce, verifier}", () => {
    const nonce = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";
    const verifier = createCodeVerifier();
    expect(parsePkceCookie(serializePkceCookie(nonce, verifier))).toEqual({ nonce, verifier });
  });

  it("fails closed on anything malformed (the callback then refuses the flow)", () => {
    expect(parsePkceCookie(null)).toBeNull();
    expect(parsePkceCookie(undefined)).toBeNull();
    expect(parsePkceCookie("")).toBeNull();
    expect(parsePkceCookie("no-separator")).toBeNull();
    expect(parsePkceCookie(".verifier-only")).toBeNull();
    expect(parsePkceCookie("nonce-only.")).toBeNull();
  });
});

describe("readCookie", () => {
  it("picks one cookie out of a header, and only on an exact name match", () => {
    const header = "other=1; gsc_oauth=abc.def; gsc_oauth_extra=zzz";
    expect(readCookie(header, "gsc_oauth")).toBe("abc.def");
    expect(readCookie(header, "gsc_oauth_extra")).toBe("zzz");
    expect(readCookie(header, "absent")).toBeNull();
    expect(readCookie(null, "gsc_oauth")).toBeNull();
    expect(readCookie("", "gsc_oauth")).toBeNull();
  });
});

describe("matchesNonce", () => {
  it("accepts an identical nonce and rejects every near miss", () => {
    expect(matchesNonce("abc-123", "abc-123")).toBe(true);
    expect(matchesNonce("abc-123", "abc-124")).toBe(false);
    expect(matchesNonce("abc-123", "abc-1234")).toBe(false); // differing length must not throw
    expect(matchesNonce("", "abc-123")).toBe(false);
  });
});
