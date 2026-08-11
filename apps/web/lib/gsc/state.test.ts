// @vitest-environment node
import { describe, expect, it } from "vitest";
import { freshStatePayload, signState, verifyState } from "./state";

/**
 * The OAuth `state` is a signed, expiring bearer of {user_id}: it is what carries the
 * tenant identity across the round-trip to Google and back, so its integrity is
 * security-load-bearing. These specs pin tamper rejection, expiry, key separation, and
 * malformed-input safety. All local crypto — no network.
 *
 * `project_id` left the payload with migration 0021 (consent is a Google ACCOUNT's, not a
 * project's), so the tamper spec below now forges the field that IS still carried —
 * user_id, the one whose forgery would be a cross-tenant bind.
 */

// A 64-hex (32-byte) TOKEN_ENCRYPTION_KEY. The state HMAC key is DERIVED from it (HKDF),
// never equal to it. Unmistakably a test value.
const SECRET = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const OTHER = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

const PAYLOAD = { user_id: "user-123", exp: 4102444800, nonce: "n-abc" };

describe("signState / verifyState", () => {
  it("round-trips a payload that has not expired", () => {
    const token = signState(PAYLOAD, SECRET);
    expect(verifyState(token, SECRET, 1_000_000)).toEqual(PAYLOAD);
  });

  it("rejects a tampered payload segment", () => {
    const token = signState(PAYLOAD, SECRET);
    const [payload, sig] = token.split(".");
    const forged = { ...PAYLOAD, user_id: "someone-elses-user" };
    const forgedPayload = Buffer.from(JSON.stringify(forged)).toString("base64url");
    expect(payload).not.toBe(forgedPayload);
    expect(verifyState(`${forgedPayload}.${sig}`, SECRET, 1_000_000)).toBeNull();
  });

  it("rejects a tampered signature segment", () => {
    const token = signState(PAYLOAD, SECRET);
    const [payload] = token.split(".");
    const badSig = Buffer.from("not-the-real-hmac").toString("base64url");
    expect(verifyState(`${payload}.${badSig}`, SECRET, 1_000_000)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signState({ ...PAYLOAD, exp: 500 }, SECRET);
    expect(verifyState(token, SECRET, 1000 * 1000)).toBeNull(); // now (ms) is well past exp
  });

  it("accepts right up to the expiry boundary and rejects just past it", () => {
    const token = signState({ ...PAYLOAD, exp: 2000 }, SECRET);
    expect(verifyState(token, SECRET, 1999 * 1000)).toEqual({ ...PAYLOAD, exp: 2000 });
    expect(verifyState(token, SECRET, 2001 * 1000)).toBeNull();
  });

  it("rejects a token signed with a different key (state key is derived per-secret)", () => {
    const token = signState(PAYLOAD, SECRET);
    expect(verifyState(token, OTHER, 1_000_000)).toBeNull();
  });

  it("throws on a non-64-hex secret — the key-format check shared with the token crypto", () => {
    // A mis-provisioned TOKEN_ENCRYPTION_KEY must fail loudly (signed lesson #5), naming
    // the variable, rather than silently derive a garbage-length HKDF key.
    expect(() => signState(PAYLOAD, "not-hex")).toThrowError(/TOKEN_ENCRYPTION_KEY.*64 hex/s);
  });

  it.each([
    ["empty", ""],
    ["no separator", "abcdef"],
    ["too many segments", "a.b.c"],
    ["non-base64 payload", "!!!.???"],
    ["whitespace", " "],
  ])("returns null for a malformed token (%s) without throwing", (_label, token) => {
    expect(verifyState(token, SECRET, 1_000_000)).toBeNull();
  });

  it("two distinct secrets yield distinct signatures (no cross-secret verification)", () => {
    expect(signState(PAYLOAD, SECRET)).not.toBe(signState(PAYLOAD, OTHER));
  });
});

describe("freshStatePayload", () => {
  it("stamps exp = now + ttl and a random nonce", () => {
    const nowMs = 1_700_000_000_000;
    const payload = freshStatePayload("u1", { ttlSeconds: 600, nowMs });
    expect(payload.user_id).toBe("u1");
    expect(payload.exp).toBe(Math.floor(nowMs / 1000) + 600);
    expect(payload.nonce).toMatch(/[0-9a-f-]{36}/);
  });

  it("produces a unique nonce each call", () => {
    const a = freshStatePayload("u");
    const b = freshStatePayload("u");
    expect(a.nonce).not.toBe(b.nonce);
  });

  /**
   * The payload is the whole contract the callback reads. Pinning its KEY SET (not just
   * the fields we assert above) is what makes a re-added `project_id` — or any other
   * smuggled field — a test failure rather than a silent revival of the old axis.
   */
  it("carries exactly user_id, exp and nonce — no project axis survives", () => {
    expect(Object.keys(freshStatePayload("u1")).sort()).toEqual(["exp", "nonce", "user_id"]);
  });
});
