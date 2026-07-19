import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, fromByteaHex, toByteaHex, tokenKeyBytes } from "./crypto.js";

/**
 * Crypto is the armor around the most sensitive value we store (a Google refresh
 * token), so these specs pin the security-load-bearing behavior: round-trip fidelity,
 * non-determinism, tamper/wrong-key rejection, key-format validation, and the exact
 * on-the-wire layout (iv || tag || ciphertext). All local — zero network, zero secrets
 * that resemble real keys.
 */

// Two DISTINCT 64-hex (32-byte) keys. Unmistakably test values, never real.
const KEY_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

const IV_BYTES = 12;
const TAG_BYTES = 16;

describe("encryptToken / decryptToken round-trip", () => {
  it.each([
    ["a typical refresh token", "1//0abcдEF-refresh_token.Value_123"],
    ["an empty string", ""],
    ["unicode + emoji", "gençlik 🌱 プロパティ"],
    ["a long value", "x".repeat(4096)],
  ])("seals and opens %s", (_label, plain) => {
    expect(decryptToken(encryptToken(plain, KEY_A), KEY_A)).toBe(plain);
  });

  it("produces different ciphertext each call (fresh random IV), both decrypting back", () => {
    const a = encryptToken("same-token", KEY_A);
    const b = encryptToken("same-token", KEY_A);
    expect(a.equals(b)).toBe(false); // semantic security: no deterministic output
    expect(decryptToken(a, KEY_A)).toBe("same-token");
    expect(decryptToken(b, KEY_A)).toBe("same-token");
  });

  it("lays out the sealed buffer as iv(12) || tag(16) || ciphertext", () => {
    const plain = "layout-probe";
    const sealed = encryptToken(plain, KEY_A);
    // Empty-plaintext ciphertext is 0 bytes, so the plaintext's UTF-8 length is the
    // ciphertext length under a stream cipher like GCM (no padding).
    expect(sealed.length).toBe(IV_BYTES + TAG_BYTES + Buffer.byteLength(plain, "utf8"));
  });

  it("never leaves the plaintext recoverable from the raw ciphertext bytes", () => {
    const plain = "SUPER-SECRET-REFRESH";
    const sealed = encryptToken(plain, KEY_A);
    expect(sealed.toString("utf8")).not.toContain(plain);
    expect(sealed.toString("latin1")).not.toContain(plain);
  });
});

describe("decryptToken rejects the unopenable", () => {
  it("throws on a wrong key (GCM tag mismatch), without leaking the low-level error", () => {
    const sealed = encryptToken("secret", KEY_A);
    expect(() => decryptToken(sealed, KEY_B)).toThrowError(/wrong key or corrupt/i);
  });

  it("throws when a single ciphertext byte is flipped (tamper detection)", () => {
    const sealed = encryptToken("secret", KEY_A);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decryptToken(tampered, KEY_A)).toThrowError(/wrong key or corrupt/i);
  });

  it("throws when the auth tag is altered", () => {
    const sealed = encryptToken("secret", KEY_A);
    const tampered = Buffer.from(sealed);
    tampered[IV_BYTES] ^= 0xff; // first tag byte
    expect(() => decryptToken(tampered, KEY_A)).toThrowError(/wrong key or corrupt/i);
  });

  it("throws a clear error on a truncated buffer (shorter than iv+tag)", () => {
    expect(() => decryptToken(Buffer.alloc(10), KEY_A)).toThrowError(/corrupt/i);
  });
});

describe("key-format validation", () => {
  it.each([
    ["too short", "0123"],
    ["63 hex chars", "0".repeat(63)],
    ["65 hex chars", "0".repeat(65)],
    ["non-hex characters", "z".repeat(64)],
    ["empty", ""],
  ])("encryptToken throws naming TOKEN_ENCRYPTION_KEY for %s", (_label, badKey) => {
    expect(() => encryptToken("x", badKey)).toThrowError(/TOKEN_ENCRYPTION_KEY.*64 hex/s);
  });

  it("decryptToken also validates the key format up front", () => {
    const sealed = encryptToken("x", KEY_A);
    expect(() => decryptToken(sealed, "nope")).toThrowError(/TOKEN_ENCRYPTION_KEY.*64 hex/s);
  });

  it("accepts an upper-case hex key (case-insensitive)", () => {
    const upper = KEY_A.toUpperCase();
    expect(decryptToken(encryptToken("ok", upper), upper)).toBe("ok");
  });
});

describe("bytea hex serialization (DB boundary)", () => {
  it("round-trips a sealed buffer through the \\x hex text form", () => {
    const sealed = encryptToken("db-round-trip", KEY_A);
    const hex = toByteaHex(sealed);
    expect(hex.startsWith("\\x")).toBe(true);
    expect(fromByteaHex(hex).equals(sealed)).toBe(true);
    // End to end: encrypt -> hex -> parse -> decrypt.
    expect(decryptToken(fromByteaHex(hex), KEY_A)).toBe("db-round-trip");
  });

  it("tolerates a bare hex string with no \\x prefix", () => {
    const sealed = encryptToken("no-prefix", KEY_A);
    const bare = sealed.toString("hex");
    expect(fromByteaHex(bare).equals(sealed)).toBe(true);
  });
});

describe("tokenKeyBytes (the shared 64-hex key-format check, reused by the state signer)", () => {
  it("decodes a valid 64-hex key to 32 raw bytes", () => {
    const bytes = tokenKeyBytes(KEY_A);
    expect(bytes).toHaveLength(32);
    expect(bytes.equals(Buffer.from(KEY_A, "hex"))).toBe(true);
  });

  it.each([
    ["too short", "0123"],
    ["63 hex chars", "0".repeat(63)],
    ["non-hex characters", "z".repeat(64)],
    ["empty", ""],
  ])("throws naming TOKEN_ENCRYPTION_KEY for %s", (_label, badKey) => {
    expect(() => tokenKeyBytes(badKey)).toThrowError(/TOKEN_ENCRYPTION_KEY.*64 hex/s);
  });
});
