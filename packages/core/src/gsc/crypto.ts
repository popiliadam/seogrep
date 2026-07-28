import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * At-rest encryption for the ONE most sensitive value this product holds: a user's
 * Google refresh token. The plaintext token must NEVER touch the database or a log —
 * it is sealed here with AES-256-GCM before storage and only ever opened server-side
 * to mint a short-lived access token.
 *
 * This module is the SINGLE source of the encryption format. It lives in @pseo/core so
 * BOTH runtimes consume one built implementation: the web OAuth callback seals the token
 * on the WRITE path, and the MCP gateway's `pull_gsc_data` tool opens it on the READ
 * path. It has zero dependencies beyond node:crypto, so neither runtime pulls anything
 * extra. (It was first written under apps/mcp and promoted here so the web app no longer
 * deep-imports @pseo/mcp source — one seal format, one home.)
 *
 * Wire format v2 of the sealed buffer (what the `encrypted_refresh_token` bytea holds):
 *
 *     magic "SGSL" (4) || version = 2 (1) || key id (1) || iv (12) || tag (16) || ct
 *
 * v1 — everything written before this format existed — is the same buffer WITHOUT the
 * 6-byte header: `iv || tag || ciphertext`. Both are read (see {@link decryptToken});
 * only v2 is ever written. The column type and the `\x`-hex storage form are unchanged;
 * a row is simply 6 bytes longer.
 *
 * The header exists so a sealed blob says which key opened it: without it the only
 * answer to a leaked key was "disconnect every user". WHICH format a buffer is in is
 * decided by the GCM auth tag, NOT by the magic bytes — a v1 IV starts with those 4
 * bytes once in ~2^32, so a header that parses but fails authentication falls through
 * to the v1 leg instead of being called corrupt.
 *
 * The 12-byte IV is fresh-random per call, so encrypting the same token twice yields
 * different bytes (semantic security). A wrong key, an unknown key id, or a flipped
 * byte all surface the SAME opaque error — it never reveals which leg failed.
 *
 * Keys are 64 hex characters = 32 raw bytes (AES-256), validated on every call (see
 * {@link tokenKeyBytes}) so a mis-provisioned key fails loudly, never silently.
 */

/** Format marker: ASCII "SGSL" (SeoGrep SeaL). It labels the blob, it does not hide it. */
const MAGIC = Buffer.from("SGSL", "ascii");
/** Version byte. Bumping it is how a future layout (e.g. AAD) stays readable alongside. */
const FORMAT_V2 = 2;
/** magic(4) || version(1) || key id(1) — the v2 prefix ahead of the v1-shaped body. */
const HEADER_BYTES = MAGIC.length + 2;
/** AES-256-GCM standard nonce size. */
const IV_BYTES = 12;
/** GCM authentication tag size. */
const TAG_BYTES = 16;
/** A sealed buffer must hold at least the IV + tag (empty ciphertext is still valid). */
const MIN_SEALED_BYTES = IV_BYTES + TAG_BYTES;
/** Shortest possible v2 buffer: header + IV + tag, empty ciphertext. */
const MIN_V2_BYTES = HEADER_BYTES + MIN_SEALED_BYTES;
/** TOKEN_ENCRYPTION_KEY length: 32 bytes rendered as 64 hex characters. */
const KEY_HEX_LENGTH = 64;
/** The id the single TOKEN_ENCRYPTION_KEY occupies when no explicit keyring is set. */
const LEGACY_KEY_ID = 1;
/** Key ids live in the header's single byte; 0 is reserved so "absent" stays distinct. */
const MIN_KEY_ID = 1;
const MAX_KEY_ID = 255;

/** `"1:<64hex>,2:<64hex>"` — every key that may DECRYPT — and the one id that ENCRYPTS. */
const KEYRING_ENV = "TOKEN_ENCRYPTION_KEYS";
const ACTIVE_KEY_ID_ENV = "TOKEN_ENCRYPTION_ACTIVE_KEY_ID";

const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;
const KEYRING_ENTRY_RE = /^(\d{1,3}):([0-9a-fA-F]{64})$/;
const KEY_ID_RE = /^\d{1,3}$/;

/** The subset of the environment this module reads. Injectable so it stays testable. */
export type TokenKeyEnv = Readonly<Record<string, string | undefined>>;

/**
 * The set of keys a buffer may be opened with, plus the one it gets sealed with. Every
 * key here can DECRYPT; only `activeKeyId` ENCRYPTS. Retiring a key = removing it from
 * this set, which is what makes a leaked key recoverable-from.
 */
export interface TokenKeyring {
  readonly activeKeyId: number;
  readonly activeKey: Buffer;
  readonly keys: ReadonlyMap<number, Buffer>;
}

/**
 * Decode + validate the hex TOKEN_ENCRYPTION_KEY into 32 raw bytes. A key of the wrong
 * length or with non-hex characters is a configuration error, so this throws a message
 * that names the variable (never its value) rather than let a downstream primitive fail
 * with an opaque low-level error.
 *
 * Exported because it is the SINGLE source of the 64-hex key-format check: the OAuth
 * `state` signer (apps/web/lib/gsc/state.ts) derives its HMAC key from the same master
 * secret and reuses this validation so there is no second, drifting regex.
 */
export function tokenKeyBytes(keyHex: string): Buffer {
  if (!KEY_HEX_RE.test(keyHex)) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be ${KEY_HEX_LENGTH} hex characters (32 bytes for AES-256)`,
    );
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Parse `TOKEN_ENCRYPTION_KEYS`. Structure, not length: anything but `<id>:<64 hex>` is a
 * configuration error, and that THROWS rather than degrading to the single legacy key — a
 * ring that silently loses a key is how live tokens become unreadable (signed lesson #6).
 * Messages carry the entry position only, never the value.
 */
function parseKeyring(spec: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  spec.split(",").forEach((entry, index) => {
    const [, idText, keyHex] = KEYRING_ENTRY_RE.exec(entry.trim()) ?? [];
    if (idText === undefined || keyHex === undefined) {
      throw new Error(
        `${KEYRING_ENV} entry #${index + 1} is malformed: expected "<id>:<${KEY_HEX_LENGTH} hex characters>"`,
      );
    }
    const id = Number(idText);
    if (id < MIN_KEY_ID || id > MAX_KEY_ID) {
      throw new Error(
        `${KEYRING_ENV} entry #${index + 1} has key id ${id}: ids must be ${MIN_KEY_ID}-${MAX_KEY_ID}`,
      );
    }
    if (keys.has(id)) throw new Error(`${KEYRING_ENV} declares key id ${id} more than once`);
    keys.set(id, Buffer.from(keyHex, "hex"));
  });
  return keys;
}

/** Pick the one key that seals new tokens. Ambiguity is an error, never a guess. */
function selectActiveKey(
  keys: ReadonlyMap<number, Buffer>,
  activeRaw: string | undefined,
  explicitRing: boolean,
): { id: number; key: Buffer } {
  if (activeRaw === undefined || activeRaw === "") {
    const entries = [...keys.entries()];
    const only = entries.length === 1 ? entries[0] : undefined;
    if (only === undefined) {
      throw new Error(`${ACTIVE_KEY_ID_ENV} must say which ${KEYRING_ENV} key seals new tokens`);
    }
    return { id: only[0], key: only[1] };
  }
  if (!KEY_ID_RE.test(activeRaw)) {
    throw new Error(`${ACTIVE_KEY_ID_ENV} must be a key id number (${MIN_KEY_ID}-${MAX_KEY_ID})`);
  }
  const id = Number(activeRaw);
  const key = keys.get(id);
  if (key === undefined) {
    throw new Error(
      explicitRing
        ? `${ACTIVE_KEY_ID_ENV}=${id} names a key that is not in ${KEYRING_ENV}`
        : `${ACTIVE_KEY_ID_ENV}=${id} is set but ${KEYRING_ENV} is not — the lone TOKEN_ENCRYPTION_KEY is key id ${LEGACY_KEY_ID}`,
    );
  }
  return { id, key };
}

/**
 * Resolve the keyring in force. The DEFAULT path needs no env change at all: with
 * `TOKEN_ENCRYPTION_KEYS` absent the ring is `{1: TOKEN_ENCRYPTION_KEY}` — the key handed
 * in — and id 1 is active, so every existing deploy starts writing v2 with no coordinated
 * Netlify+Fly update. Rotation is then purely additive: add key 2 to the ring on both
 * sides, then flip the active id.
 *
 * When `TOKEN_ENCRYPTION_KEYS` IS set it is the whole authority — the passed key is still
 * format-checked (it also signs OAuth state) but is NOT added to the ring, which is
 * exactly what makes retiring a compromised key possible.
 */
export function resolveTokenKeyring(keyHex: string, env: TokenKeyEnv = process.env): TokenKeyring {
  const legacyKey = tokenKeyBytes(keyHex);
  const spec = env[KEYRING_ENV]?.trim();
  const explicitRing = spec !== undefined && spec !== "";
  const keys = explicitRing ? parseKeyring(spec) : new Map([[LEGACY_KEY_ID, legacyKey]]);
  const active = selectActiveKey(keys, env[ACTIVE_KEY_ID_ENV]?.trim(), explicitRing);
  return Object.freeze({ activeKeyId: active.id, activeKey: active.key, keys });
}

/**
 * One GCM open attempt. Returns null — never throws — so a caller can try the next leg
 * of the format/keyring search without a failure being mistaken for a hard error.
 */
function openGcm(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Read the v2 layout. Null when the header does not parse, the key id is unknown to the
 * keyring, or authentication fails — all three hand the buffer to the v1 leg. */
function openV2(sealed: Buffer, keyring: TokenKeyring): string | null {
  if (sealed.length < MIN_V2_BYTES) return null;
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  if (sealed[MAGIC.length] !== FORMAT_V2) return null;
  const keyId = sealed[MAGIC.length + 1];
  const key = keyId === undefined ? undefined : keyring.keys.get(keyId);
  if (key === undefined) return null;
  const body = sealed.subarray(HEADER_BYTES);
  return openGcm(
    key,
    body.subarray(0, IV_BYTES),
    body.subarray(IV_BYTES, MIN_SEALED_BYTES),
    body.subarray(MIN_SEALED_BYTES),
  );
}

/** Read the headerless v1 layout. It carries no key id, so every keyring key is tried;
 * the GCM tag decides. A key dropped from the keyring can no longer open these. */
function openV1(sealed: Buffer, keyring: TokenKeyring): string | null {
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, MIN_SEALED_BYTES);
  const ciphertext = sealed.subarray(MIN_SEALED_BYTES);
  for (const key of keyring.keys.values()) {
    const opened = openGcm(key, iv, tag, ciphertext);
    if (opened !== null) return opened;
  }
  return null;
}

/**
 * Seal a plaintext token with AES-256-GCM. Returns the v2 wire-format buffer ready to
 * store in the bytea column. A fresh random IV per call means the output is
 * non-deterministic by design. Only v2 is ever written.
 */
export function encryptToken(plain: string, keyHex: string): Buffer {
  const keyring = resolveTokenKeyring(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyring.activeKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT_V2, keyring.activeKeyId])]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Open a sealed buffer — v2 first, then the pre-header v1 layout. Throws a clear error
 * when the buffer is truncated, and one deliberately opaque error when no key/format
 * combination authenticates: wrong key, unknown key id, or tampering all read the same
 * from outside, so a caller learns nothing about the keyring.
 */
export function decryptToken(sealed: Buffer, keyHex: string): string {
  const keyring = resolveTokenKeyring(keyHex);
  if (sealed.length < MIN_SEALED_BYTES) {
    throw new Error(
      `encrypted token is corrupt: expected at least ${MIN_SEALED_BYTES} bytes, got ${sealed.length}`,
    );
  }
  const opened = openV2(sealed, keyring) ?? openV1(sealed, keyring);
  if (opened !== null) return opened;
  // Never leak the low-level OpenSSL message, any key material, or which leg failed.
  throw new Error("failed to decrypt token: wrong key or corrupt ciphertext");
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
