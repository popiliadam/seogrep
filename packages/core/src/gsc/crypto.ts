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
 * Wire format v4 of the sealed buffer (what `gsc_accounts.encrypted_refresh_token` holds):
 *
 *     magic "SGSL" (4) || version = 4 (1) || key id (1) || iv (12) || tag (16) || ct
 *
 * Migration 0021 moved the credential off `gsc_connections` (bound per `(user_id,
 * project_id)`) onto the new per-account table `gsc_accounts` and DROPPED
 * `gsc_connections.encrypted_refresh_token` outright. So v4 rebinds the AAD to the new
 * axis, `(user_id, account_id)`, under a NEW context string and a NEW version byte —
 * reusing the v3 byte with different AAD content would be a silent semantic change; a
 * future reader must be able to see from the byte alone that the binding moved.
 *
 * That AAD is deliberately NOT stored in the buffer. It is supplied by the CALLER from
 * the row it is reading, which is the entire point: a sealed blob lifted out of one
 * `gsc_accounts` row and written into another user's row is opened with the NEW row's
 * ids, the tag no longer verifies, and the theft fails closed. Storing the ids inside the
 * blob would move them along with it and bind nothing. See docs/audits (M-17) for the
 * original attack this closes.
 *
 * Formats v1/v2/v3 are NOT read any more. They cannot exist in this system: migration
 * 0021 dropped the only column that ever held them. A buffer that parses as one of those
 * versions is refused LOUDLY, naming the version and telling the operator to reconnect —
 * deliberately NOT the opaque "wrong key or corrupt ciphertext" error, because a
 * format-version byte is not a secret and an unactionable error is a real cost to an
 * operator staring at it. The opaque error is reserved for the case where a v4-shaped
 * buffer fails to authenticate (wrong key, unknown key id, mismatched owner, tampering).
 *
 * The 12-byte IV is fresh-random per call, so encrypting the same token twice yields
 * different bytes (semantic security).
 *
 * Keys are 64 hex characters = 32 raw bytes (AES-256), validated on every call (see
 * {@link tokenKeyBytes}) so a mis-provisioned key fails loudly, never silently.
 */

/** Format marker: ASCII "SGSL" (SeoGrep SeaL). It labels the blob, it does not hide it. */
const MAGIC = Buffer.from("SGSL", "ascii");
/**
 * Headered AND bound to its `(user_id, account_id)` via GCM AAD. The only format read or
 * written. v1/v2/v3 are refused by name (see the module doc) — migration 0021 dropped the
 * only column that could hold them, so no such ciphertext can exist in this system.
 */
const FORMAT_V4 = 4;
/** magic(4) || version(1) || key id(1) — the header prefix ahead of the iv/tag/ct body. */
const HEADER_BYTES = MAGIC.length + 2;
/** AES-256-GCM standard nonce size. */
const IV_BYTES = 12;
/** GCM authentication tag size. */
const TAG_BYTES = 16;
/** A sealed buffer must hold at least the IV + tag (empty ciphertext is still valid). */
const MIN_SEALED_BYTES = IV_BYTES + TAG_BYTES;
/** Shortest possible headered buffer: header + IV + tag, empty ciphertext. */
const MIN_HEADERED_BYTES = HEADER_BYTES + MIN_SEALED_BYTES;
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
 * The `gsc_accounts` row a sealed token belongs to. Migration 0021 moved the credential off
 * `gsc_connections` (one per `(user_id, project_id)`) onto this new per-account table, so
 * the binding axis moves with it: `(user_id, account_id)` names exactly one `gsc_accounts`
 * row, and both halves are in hand at every place the seal is touched.
 *
 * The row's own `id` is deliberately NOT part of this: a writer that upserts an account row
 * cannot always know the id of a row it may be creating, so binding to it would leave that
 * write path unable to seal at all.
 */
export interface TokenOwner {
  readonly userId: string;
  readonly accountId: string;
}

// Separate context string: silently changing the AAD CONTENT under the same version byte
// would mislead a future reader. v4 + a new context makes the change visible, and old
// blobs are refused BY NAME instead of failing like a "wrong key".
const AAD_CONTEXT = "seogrep/gsc-refresh-token/account";

/**
 * Encode one owner field as `length(4, big-endian) || utf8 bytes`. Length-prefixed rather
 * than delimiter-joined so no two distinct owners can ever encode to the same bytes — a
 * separator would only be unambiguous while the ids stay UUID-shaped, and a binding that
 * depends on a format assumption elsewhere is not a binding.
 */
function aadField(name: string, value: string): Buffer {
  if (value.length === 0) {
    throw new Error(`sealed token owner ${name} must be a non-empty id`);
  }
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

/**
 * The exact bytes AES-GCM authenticates alongside the ciphertext. Never stored: the caller
 * rebuilds it from the row being read, so a blob moved to another row is authenticated
 * against THAT row's ids and fails.
 *
 * CASE-FOLDED, and that is load-bearing. The AAD must bind the row's IDENTITY, not the text
 * an id happened to arrive in. Postgres stores `uuid` in canonical lowercase, but every
 * validator these ids pass through is case-INSENSITIVE — `z.uuid()` in pull_gsc_data and the
 * `/^[0-9a-f]{8}-…/i` regexes in the connect route and the connection actions all accept
 * `A1B2…`. Without folding, a connect flow started with a mixed-case account_id would seal
 * under an uppercase AAD into a row that reads back lowercase, and every later read would
 * rebuild the lowercase AAD: the connection could never be opened again (fail-closed, no
 * cross-tenant leak, but permanently bricked). Folding is byte-compatible with every v4 row
 * already written — those were all sealed from canonical, already-lowercase ids.
 *
 * `toLowerCase` and not `toLocaleLowerCase`: the mapping must not depend on the host locale
 * (the Turkish dotless-i would fold `I` differently and make a seal unopenable on another
 * machine). Case-insensitive is not id-insensitive — distinct ids stay distinct, and the
 * length-prefixing above still rules out any two pairs sharing a binding.
 */
function ownerAad(owner: TokenOwner): Buffer {
  return Buffer.concat([
    Buffer.from(AAD_CONTEXT, "ascii"),
    aadField("userId", owner.userId.toLowerCase()),
    aadField("accountId", owner.accountId.toLowerCase()),
  ]);
}

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
 * in — and id 1 is active, so every existing deploy starts writing v4 with no coordinated
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
function openGcm(
  key: Buffer,
  iv: Buffer,
  tag: Buffer,
  ciphertext: Buffer,
  aad: Buffer | null,
): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    // AAD must be fed before any update() call; a mismatch surfaces at final() as a tag
    // failure, indistinguishable from a wrong key — which is the property we want.
    if (aad !== null) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Read the v4 headered layout. Null when the header does not parse, the version is not
 * v4, the key id is unknown to the keyring, or authentication fails — every one of those
 * is treated identically by the caller (the opaque error), never distinguished.
 */
function openHeadered(sealed: Buffer, keyring: TokenKeyring, aad: Buffer): string | null {
  if (sealed.length < MIN_HEADERED_BYTES) return null;
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  if (sealed[MAGIC.length] !== FORMAT_V4) return null;
  const keyId = sealed[MAGIC.length + 1];
  const key = keyId === undefined ? undefined : keyring.keys.get(keyId);
  if (key === undefined) return null;
  const body = sealed.subarray(HEADER_BYTES);
  return openGcm(
    key,
    body.subarray(0, IV_BYTES),
    body.subarray(IV_BYTES, MIN_SEALED_BYTES),
    body.subarray(MIN_SEALED_BYTES),
    aad,
  );
}

/**
 * Seal a plaintext token with AES-256-GCM, BOUND to the `gsc_accounts` row it is about to
 * be stored in. Returns the v4 wire-format buffer ready for the bytea column. A fresh
 * random IV per call means the output is non-deterministic by design.
 *
 * `owner` is a required parameter, not an option: an optional binding is how M-17 comes
 * back — one future call site forgetting it would silently write an unbound blob. Making
 * the compiler ask for it is the only durable guard.
 */
export function encryptToken(plain: string, keyHex: string, owner: TokenOwner): Buffer {
  // Key first: a mis-provisioned key is a deploy fault and must win over an owner fault.
  const keyring = resolveTokenKeyring(keyHex);
  const aad = ownerAad(owner);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyring.activeKey, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT_V4, keyring.activeKeyId])]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Open a sealed buffer. `owner` must be the ids of the `gsc_accounts` row the buffer was
 * READ FROM; it is what authenticates the blob.
 *
 * A buffer whose header names an older version (v1/v2/v3) is refused LOUDLY, by name —
 * migration 0021 dropped the only column those formats could live in, so no such
 * ciphertext can legitimately exist any more, and an operator seeing an unactionable
 * "wrong key" error for what is actually a stale/pre-migration blob is a real cost. That
 * check is byte-position only (no decryption attempted for those versions) — it is not a
 * secret, so naming it does not weaken anything.
 *
 * Throws a clear error when the buffer is truncated, and one deliberately opaque error
 * when a v4-shaped buffer fails to authenticate: a wrong key, an unknown key id, a blob
 * belonging to another row, and plain tampering all read identically from outside, so
 * neither the keyring nor the true owner of a stolen blob can be probed through it.
 */
export function decryptToken(sealed: Buffer, keyHex: string, owner: TokenOwner): string {
  const keyring = resolveTokenKeyring(keyHex);
  const aad = ownerAad(owner);
  if (sealed.length < MIN_SEALED_BYTES) {
    throw new Error(
      `encrypted token is corrupt: expected at least ${MIN_SEALED_BYTES} bytes, got ${sealed.length}`,
    );
  }
  const looksHeadered =
    sealed.length >= HEADER_BYTES && sealed.subarray(0, MAGIC.length).equals(MAGIC);
  const version = looksHeadered ? sealed[MAGIC.length] : undefined;
  if (version !== undefined && version < FORMAT_V4) {
    throw new Error(
      `encrypted token format v${version} is no longer supported — reconnect Google Search Console`,
    );
  }
  const opened = openHeadered(sealed, keyring, aad);
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
