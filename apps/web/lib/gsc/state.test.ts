// @vitest-environment node
import { describe, expect, it } from "vitest";
import { freshStatePayload, signState, verifyState } from "./state";

/**
 * The OAuth `state` is a signed, expiring bearer of {user_id, project_id}: it is what
 * carries the tenant identity across the round-trip to Google and back, so its integrity
 * is security-load-bearing. These specs pin tamper rejection, expiry, key separation, and
 * malformed-input safety. All local crypto — no network.
 */

// A 64-hex (32-byte) TOKEN_ENCRYPTION_KEY. The state HMAC key is DERIVED from it (HKDF),
// never equal to it. Unmistakably a test value.
const SECRET = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const OTHER = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

const PAYLOAD = { user_id: "user-123", project_id: "proj-456", exp: 4102444800, nonce: "n-abc" };

describe("signState / verifyState", () => {
  it("round-trips a payload that has not expired", () => {
    const token = signState(PAYLOAD, SECRET);
    expect(verifyState(token, SECRET, 1_000_000)).toEqual(PAYLOAD);
  });

  it("rejects a tampered payload segment", () => {
    const token = signState(PAYLOAD, SECRET);
    const [payload, sig] = token.split(".");
    const forged = { ...PAYLOAD, project_id: "someone-elses-project" };
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
    const payload = freshStatePayload("u1", "p1", { ttlSeconds: 600, nowMs });
    expect(payload.user_id).toBe("u1");
    expect(payload.project_id).toBe("p1");
    expect(payload.exp).toBe(Math.floor(nowMs / 1000) + 600);
    expect(payload.nonce).toMatch(/[0-9a-f-]{36}/);
  });

  it("produces a unique nonce each call", () => {
    const a = freshStatePayload("u", "p");
    const b = freshStatePayload("u", "p");
    expect(a.nonce).not.toBe(b.nonce);
  });
});
