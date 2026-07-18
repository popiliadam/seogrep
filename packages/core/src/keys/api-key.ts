import { createHash, randomBytes as cryptoRandomBytes } from "node:crypto";

/**
 * Pure personal-API-key domain. No I/O, no clock, no global state. The only
 * non-determinism (entropy) is injected so callers/tests can pin the format and
 * hashing; the DB layer (packages/db) persists ONLY the hash + prefix, never the
 * plaintext key, which is shown to the user exactly once at creation time.
 *
 * `node:crypto` is a runtime dependency here (core already runs in a Node context —
 * its fetch adapters do); base58 and the URL template are hand-written so the package
 * takes on no new dependency.
 */

/** Bitcoin base58 alphabet — omits the visually ambiguous 0 O I l. */
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_RADIX = 58n;

/** Human-facing key prefix (also stored, for display/lookup). */
const KEY_PREFIX = "sg_";
/** Bytes of entropy per key. 24 bytes -> ~33 base58 chars (~192 bits). */
const KEY_ENTROPY_BYTES = 24;
/** Stored/displayed prefix length: KEY_PREFIX (3) + 8 base58 chars. */
const STORED_PREFIX_LENGTH = 11;

/** Default personal MCP URL template; `{key}` is replaced with the plaintext key. */
export const DEFAULT_MCP_URL_TEMPLATE = "https://mcp.seogrep.com/mcp/{key}";
const MCP_URL_PLACEHOLDER = "{key}";

export interface GeneratedApiKey {
  /** Plaintext key — returned to the caller once, never persisted or logged. */
  readonly key: string;
  /** First 11 chars of the key (`sg_` + 8 base58) — safe to store and display. */
  readonly prefix: string;
  /** SHA-256 hex of the plaintext key — the only key material stored in the DB. */
  readonly hash: string;
}

/**
 * Encode bytes as Bitcoin base58 (big-endian big integer). Each leading zero byte
 * maps to a leading '1', matching the canonical scheme.
 */
export function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte === 0) leadingZeros += 1;
    else break;
  }

  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % BASE58_RADIX);
    value = value / BASE58_RADIX;
    // charAt returns "" for out-of-range; remainder is always 0..57 so it is a real char.
    encoded = BASE58_ALPHABET.charAt(remainder) + encoded;
  }

  return "1".repeat(leadingZeros) + encoded;
}

/** SHA-256 hex digest of a UTF-8 string (64 lowercase hex chars). */
export function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function defaultRandomBytes(size: number): Uint8Array {
  return cryptoRandomBytes(size);
}

/**
 * Generate a fresh personal API key. Randomness is a parameter (defaults to a CSPRNG)
 * so tests can pin the format deterministically. Returns the plaintext `key` (show
 * once), the stored `prefix`, and the stored SHA-256 `hash`.
 */
export function generateApiKey(
  randomBytes: (size: number) => Uint8Array = defaultRandomBytes,
): GeneratedApiKey {
  const key = `${KEY_PREFIX}${base58Encode(randomBytes(KEY_ENTROPY_BYTES))}`;
  return {
    key,
    prefix: key.slice(0, STORED_PREFIX_LENGTH),
    hash: sha256hex(key),
  };
}

/** Resolve the MCP URL template from the environment, falling back to the default. */
export function mcpUrlTemplate(): string {
  return process.env.MCP_URL_TEMPLATE ?? DEFAULT_MCP_URL_TEMPLATE;
}

/** Build a personal MCP URL by substituting `{key}` in `template`. Pure. */
export function mcpUrlFor(key: string, template: string): string {
  return template.replace(MCP_URL_PLACEHOLDER, key);
}
