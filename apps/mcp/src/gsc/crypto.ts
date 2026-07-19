import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * At-rest encryption for the ONE most sensitive value this product holds: a user's
 * Google refresh token. The plaintext token must NEVER touch the database or a log —
 * it is sealed here with AES-256-GCM before storage and only ever opened server-side
 * to mint a short-lived access token.
 *
 * This module is the SINGLE source of the encryption format. It lives under apps/mcp
 * (the MCP gateway owns the future `pull_gsc_data` read path), and the web OAuth
 * callback reuses it to seal the token on the write path — one format, no drift. It
 * has zero dependencies beyond node:crypto so both runtimes can import it cleanly.
 *
 * Wire format of the sealed buffer (what the `encrypted_refresh_token` bytea holds):
 *
 *     iv (12 bytes) || auth tag (16 bytes) || ciphertext (variable)
 *
 * The 12-byte IV is fresh-random per call, so encrypting the same token twice yields
 * different bytes (semantic security). The GCM tag authenticates the ciphertext: a
 * wrong key or a single flipped byte fails `final()` and we surface a clear error
 * rather than returning garbage.
 *
 * The key is TOKEN_ENCRYPTION_KEY — 64 hex characters = 32 raw bytes (AES-256). It is
 * validated on every call so a mis-provisioned key fails loudly at first use, never
 * silently.
 */

/** AES-256-GCM standard nonce size. */
const IV_BYTES = 12;
/** GCM authentication tag size. */
const TAG_BYTES = 16;
/** A sealed buffer must hold at least the IV + tag (empty ciphertext is still valid). */
const MIN_SEALED_BYTES = IV_BYTES + TAG_BYTES;
/** TOKEN_ENCRYPTION_KEY length: 32 bytes rendered as 64 hex characters. */
const KEY_HEX_LENGTH = 64;

const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;

/**
 * Decode + validate the hex key into 32 raw bytes. A key of the wrong length or with
 * non-hex characters is a configuration error, so we throw a message that names the
 * variable (never its value) rather than let AES fail with an opaque low-level error.
 */
function keyBytes(keyHex: string): Buffer {
  if (!KEY_HEX_RE.test(keyHex)) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be ${KEY_HEX_LENGTH} hex characters (32 bytes for AES-256)`,
    );
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Seal a plaintext token with AES-256-GCM under `keyHex`. Returns the wire-format
 * buffer (iv || tag || ciphertext) ready to store in the bytea column. A fresh random
 * IV per call means the output is non-deterministic by design.
 */
export function encryptToken(plain: string, keyHex: string): Buffer {
  const key = keyBytes(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Open a buffer produced by {@link encryptToken}. Throws a clear error when the key is
 * wrong, the buffer is truncated, or the ciphertext/tag has been tampered with — the
 * GCM tag check in `final()` is what makes tampering detectable rather than silent.
 */
export function decryptToken(sealed: Buffer, keyHex: string): string {
  const key = keyBytes(keyHex);
  if (sealed.length < MIN_SEALED_BYTES) {
    throw new Error(
      `encrypted token is corrupt: expected at least ${MIN_SEALED_BYTES} bytes, got ${sealed.length}`,
    );
  }
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = sealed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM authentication failed: wrong key, or the ciphertext/tag was altered. Never
    // leak the low-level OpenSSL message or any key/token material.
    throw new Error("failed to decrypt token: wrong key or corrupt ciphertext");
  }
}

/**
 * Render a sealed buffer as the `\x`-prefixed hex string PostgreSQL/PostgREST use as the
 * text representation of `bytea` on the Data API. This is the DB serialization boundary:
 * {@link encryptToken} returns raw bytes; the bytea column stores this string form.
 */
export function toByteaHex(sealed: Buffer): string {
  return `\\x${sealed.toString("hex")}`;
}

/**
 * Parse the `bytea` value read back from the Data API (a `\x`-prefixed hex string, or a
 * bare hex string) into raw bytes for {@link decryptToken}. Tolerant of a missing prefix
 * so a caller does not depend on the exact PostgREST text encoding.
 */
export function fromByteaHex(value: string): Buffer {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}
