// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  codeChallengeS256,
  createCodeVerifier,
  fetchWithCodeVerifier,
  matchesNonce,
  parsePkceCookie,
  readCookie,
  serializePkceCookie,
} from "./pkce";

/**
 * Unit specs for the PKCE primitives. The route specs prove the two handlers USE them; these
 * prove the pieces themselves hold: a challenge that really is the digest of its verifier, a
 * cookie that round-trips, a parser that fails closed, and a token request that actually
 * carries `code_verifier` on the wire.
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

describe("fetchWithCodeVerifier", () => {
  const CORE_BODY =
    "grant_type=authorization_code&code=auth-code&redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Fgsc%2Fcallback" +
    "&client_id=cid.apps.googleusercontent.com&client_secret=super-secret";

  it("adds code_verifier to the token POST and preserves every other parameter", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const wrapped = fetchWithCodeVerifier("the-verifier", base);

    await wrapped("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: CORE_BODY,
    });

    const [url, init] = base.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const sent = new URLSearchParams(String(init.body));
    expect(sent.get("code_verifier")).toBe("the-verifier");
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("auth-code");
    expect(sent.get("redirect_uri")).toBe("https://app.example.com/api/gsc/callback");
    expect(sent.get("client_id")).toBe("cid.apps.googleusercontent.com");
    expect(sent.get("client_secret")).toBe("super-secret"); // passed through, never reshaped
    expect(init.method).toBe("POST");
  });

  it("keeps the client's own init (headers, abort signal) untouched", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const signal = AbortSignal.timeout(5_000);
    await fetchWithCodeVerifier("v", base)("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code",
    });
    const [, init] = base.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(signal);
    expect(init.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
  });

  // If @pseo/core ever stops sending a form-encoded string, the verifier would silently stop
  // riding along. Google answers a challenged code with invalid_grant when the verifier is
  // missing, so the flow breaks either way — this throw names the reason.
  it("throws instead of exchanging without PKCE when the body is not a form string", async () => {
    const base = vi.fn(async () => new Response("{}"));
    expect(() =>
      fetchWithCodeVerifier("v", base)("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new FormData(),
      }),
    ).toThrow(/form-encoded/i);
    expect(base).not.toHaveBeenCalled();
  });
});
