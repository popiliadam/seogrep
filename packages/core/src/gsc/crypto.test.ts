import { createCipheriv } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptToken,
  encryptToken,
  fromByteaHex,
  toByteaHex,
  tokenKeyBytes,
  type TokenOwner,
} from "./crypto.js";

/**
 * Crypto is the armor around the most sensitive value we store (a Google refresh
 * token), so these specs pin the security-load-bearing behavior: round-trip fidelity,
 * non-determinism, tamper/wrong-key rejection, key-format validation, the exact v3
 * on-the-wire layout, that a seal only opens for the ROW IT WAS WRITTEN FOR, and — the
 * ones that cannot be re-derived once broken — that blobs written by the v2 and PRE-v2
 * implementations still open. All local — zero network, zero secrets that resemble
 * real keys.
 */

// Two DISTINCT 64-hex (32-byte) keys. Unmistakably test values, never real.
const KEY_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

/**
 * The `gsc_connections` row these fixtures belong to. v3 binds a seal to exactly this
 * pair, so it is an input to every seal AND every open in this file. The pre-v3 fixtures
 * were sealed with no binding at all and open under ANY owner — that is precisely the
 * backward compatibility being pinned, and precisely the hole v3 closes going forward.
 */
const OWNER: TokenOwner = {
  userId: "aaaaaaaa-0000-4000-8000-0000000000a1",
  projectId: "bbbbbbbb-0000-4000-8000-0000000000b1",
};

const IV_BYTES = 12;
const TAG_BYTES = 16;
/** magic(4) || version(1) || key_id(1) — asserted as LITERAL bytes, never imported. */
const HEADER_BYTES = 6;
/** ASCII "SGSL". Written out here so a change to the constant fails this spec. */
const MAGIC_HEX = "5347534c";

/**
 * A blob produced by the PRE-v2 implementation (`iv || tag || ciphertext`, no header),
 * generated once against the shipped build and frozen here. Nothing in this file can
 * re-derive it, which is the point: if a future refactor drops the legacy read leg, this
 * fixture is the spec that fails. Plaintext + key are test-only values.
 */
const V1_FIXTURE_PLAIN = "1//v1-legacy-refresh-token";
const V1_FIXTURE_HEX =
  "6d778b7314cd72747d631cb0173baa445ce84623022bae81da5f60fdff81aad2" +
  "8b20631fcb7f060cc0bc66f21fe5debe53be708f9ca8";

/**
 * A blob produced by the v2 implementation (`magic || version 2 || key id || iv || tag ||
 * ct`, NO additional authenticated data), captured from the shipped build and frozen here
 * the same way. EVERY Search Console connection live in production today is one of these,
 * and none of them is bound to its row — so this fixture is the standing spec for "an
 * existing customer's connection still opens". Nothing in this file can re-derive it once
 * the writer moves on, which is exactly why it is pinned before the writer moves.
 */
const V2_FIXTURE_PLAIN = "1//v2-headered-refresh-token";
const V2_FIXTURE_HEX =
  "5347534c020147a51a20ff89b903a780280346780ed170b7cb58cddceacb21de" +
  "61c3ccc95d8593c6c4cd2211b4f4f46032512d0fc955255e2c83a2af012b";

/**
 * Seal in the LEGACY v1 layout with a caller-chosen IV. Used to forge the one input the
 * random-IV path cannot produce: a genuine v1 blob whose first bytes impersonate the v2
 * header.
 */
function sealLegacy(plain: string, keyHex: string, iv: Buffer): Buffer {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** The ONE message every unopenable buffer produces. ANCHORED: it must not gain detail. */
const OPAQUE_ERROR = /^failed to decrypt token: wrong key or corrupt ciphertext$/;

/** Opening the frozen legacy blob — the read a broken keyring must never quietly alter. */
const openV1Fixture = (): string => decryptToken(fromByteaHex(V1_FIXTURE_HEX), KEY_A, OWNER);

/** Point the keyring at an explicit ring, or at nothing (the zero-env-change path). */
function setKeyring(ring: string | undefined, activeKeyId?: string): void {
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS", ring);
  vi.stubEnv("TOKEN_ENCRYPTION_ACTIVE_KEY_ID", activeKeyId);
}

// Every spec starts from a bare environment, so the default path under test is the one
// production runs today: no keyring vars set at all.
beforeEach(() => {
  vi.unstubAllEnvs();
  setKeyring(undefined);
});

describe("encryptToken / decryptToken round-trip", () => {
  it.each([
    ["a typical refresh token", "1//0abcдEF-refresh_token.Value_123"],
    ["an empty string", ""],
    ["unicode + emoji", "gençlik 🌱 プロパティ"],
    ["a long value", "x".repeat(4096)],
  ])("seals and opens %s", (_label, plain) => {
    expect(decryptToken(encryptToken(plain, KEY_A, OWNER), KEY_A, OWNER)).toBe(plain);
  });

  it("produces different ciphertext each call (fresh random IV), both decrypting back", () => {
    const a = encryptToken("same-token", KEY_A, OWNER);
    const b = encryptToken("same-token", KEY_A, OWNER);
    expect(a.equals(b)).toBe(false); // semantic security: no deterministic output
    expect(decryptToken(a, KEY_A, OWNER)).toBe("same-token");
    expect(decryptToken(b, KEY_A, OWNER)).toBe("same-token");
  });

  it("lays out the sealed buffer as header(6) || iv(12) || tag(16) || ciphertext", () => {
    const plain = "layout-probe";
    const sealed = encryptToken(plain, KEY_A, OWNER);
    // Empty-plaintext ciphertext is 0 bytes, so the plaintext's UTF-8 length is the
    // ciphertext length under a stream cipher like GCM (no padding).
    expect(sealed.length).toBe(
      HEADER_BYTES + IV_BYTES + TAG_BYTES + Buffer.byteLength(plain, "utf8"),
    );
  });

  it("never leaves the plaintext recoverable from the raw ciphertext bytes", () => {
    const plain = "SUPER-SECRET-REFRESH";
    const sealed = encryptToken(plain, KEY_A, OWNER);
    expect(sealed.toString("utf8")).not.toContain(plain);
    expect(sealed.toString("latin1")).not.toContain(plain);
  });
});

describe("v3 wire format (self-describing header, owner-bound body)", () => {
  it("stamps MAGIC || version 3 || active key id in the first 6 bytes", () => {
    const sealed = encryptToken("header-probe", KEY_A, OWNER);
    // Without an explicit keyring the active id is 1 (the derived legacy slot).
    expect(sealed.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0301`);
  });

  it("costs NOTHING over v2 on the wire — the binding lives in the tag, not the bytes", () => {
    const sealed = encryptToken(V2_FIXTURE_PLAIN, KEY_A, OWNER);
    expect(sealed.length).toBe(fromByteaHex(V2_FIXTURE_HEX).length);
  });

  it("never stores the owner ids it is bound to (they come from the row, not the blob)", () => {
    const sealed = encryptToken("owner-leak-probe", KEY_A, OWNER);
    expect(sealed.toString("latin1")).not.toContain(OWNER.userId);
    expect(sealed.toString("latin1")).not.toContain(OWNER.projectId);
    expect(sealed.toString("hex")).not.toContain(Buffer.from(OWNER.userId).toString("hex"));
  });

  it("still fits the unchanged bytea column: same \\x hex text form, +6 bytes", () => {
    const sealed = encryptToken(V1_FIXTURE_PLAIN, KEY_A, OWNER);
    expect(sealed.length).toBe(fromByteaHex(V1_FIXTURE_HEX).length + HEADER_BYTES);
    expect(decryptToken(fromByteaHex(toByteaHex(sealed)), KEY_A, OWNER)).toBe(V1_FIXTURE_PLAIN);
  });
});

describe("backward read: blobs sealed before v3 still open (no reconnect forced)", () => {
  it("opens the PINNED v1 fixture written by the pre-v2 implementation", () => {
    expect(decryptToken(fromByteaHex(V1_FIXTURE_HEX), KEY_A, OWNER)).toBe(V1_FIXTURE_PLAIN);
  });

  it("proves that fixture is genuinely legacy (no v2 magic, v1 length math)", () => {
    const blob = fromByteaHex(V1_FIXTURE_HEX);
    expect(blob.subarray(0, 4).toString("hex")).not.toBe(MAGIC_HEX);
    expect(blob.length).toBe(
      IV_BYTES + TAG_BYTES + Buffer.byteLength(V1_FIXTURE_PLAIN, "utf8"),
    );
  });

  it("opens the PINNED v2 fixture — the shape every live connection is stored in", () => {
    expect(decryptToken(fromByteaHex(V2_FIXTURE_HEX), KEY_A, OWNER)).toBe(V2_FIXTURE_PLAIN);
  });

  it("proves that fixture is genuinely v2 (magic + version byte 2, v2 length math)", () => {
    const blob = fromByteaHex(V2_FIXTURE_HEX);
    expect(blob.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0201`);
    expect(blob.length).toBe(
      HEADER_BYTES + IV_BYTES + TAG_BYTES + Buffer.byteLength(V2_FIXTURE_PLAIN, "utf8"),
    );
  });

  it("opens a legacy blob whose IV impersonates the v2 header (auth tag decides, not magic)", () => {
    // A pre-v2 IV is 12 random bytes; ~1 in 2^32 of them start with MAGIC. Forge that
    // case deterministically: the v2 leg must attempt key 1, fail the GCM tag, and hand
    // the blob to the legacy leg rather than declaring it corrupt.
    const iv = Buffer.concat([
      Buffer.from(`${MAGIC_HEX}0201`, "hex"),
      Buffer.from("c0ffee1234", "hex"),
      Buffer.from([0x9a]),
    ]);
    expect(iv).toHaveLength(IV_BYTES);
    const forged = sealLegacy("collision-probe", KEY_A, iv);
    expect(decryptToken(forged, KEY_A, OWNER)).toBe("collision-probe");
  });
});

/**
 * M-17. The attack these specs close: `encrypted_refresh_token` used to be
 * cryptographically anonymous, so anyone able to WRITE `gsc_connections` (a service_role
 * key, a SQL-injection sink, a restored dump) could copy victim A's sealed blob into
 * victim B's row and B's next pull would drive A's Google grant. Nothing in the crypto
 * could notice. v3 authenticates the owning (user, project) alongside the ciphertext.
 */
describe("M-17: a seal opens ONLY for the row it was written for", () => {
  const VICTIM_A: TokenOwner = {
    userId: "aaaaaaaa-0000-4000-8000-00000000000a",
    projectId: "11111111-0000-4000-8000-000000000011",
  };
  const VICTIM_B: TokenOwner = {
    userId: "bbbbbbbb-0000-4000-8000-00000000000b",
    projectId: "22222222-0000-4000-8000-000000000022",
  };
  const A_TOKEN = "1//VICTIM-A-GOOGLE-REFRESH-TOKEN";

  it("ROW SWAP: A's sealed token planted in B's row does not open", () => {
    // Exactly the attack: the bytea value is copied verbatim; only the row it is read
    // from changes. Before v3 this returned A's plaintext refresh token.
    const stolen = fromByteaHex(toByteaHex(encryptToken(A_TOKEN, KEY_A, VICTIM_A)));
    expect(() => decryptToken(stolen, KEY_A, VICTIM_B)).toThrowError(OPAQUE_ERROR);
    // ...and it still opens for its rightful row, so the fix costs A nothing.
    expect(decryptToken(stolen, KEY_A, VICTIM_A)).toBe(A_TOKEN);
  });

  it.each([
    ["the user alone (same project)", { userId: VICTIM_B.userId, projectId: VICTIM_A.projectId }],
    ["the project alone (same user)", { userId: VICTIM_A.userId, projectId: VICTIM_B.projectId }],
  ])("rejects a swap of %s — BOTH ids are load-bearing", (_label, owner) => {
    const sealed = encryptToken(A_TOKEN, KEY_A, owner satisfies TokenOwner);
    expect(() => decryptToken(sealed, KEY_A, VICTIM_A)).toThrowError(OPAQUE_ERROR);
  });

  it("reports a mismatched owner with the SAME message as a wrong key — no id probing", () => {
    // If a swap failed differently from a wrong key, an attacker holding a stolen blob
    // could brute-force which row it belongs to through the error alone.
    const sealed = encryptToken(A_TOKEN, KEY_A, VICTIM_A);
    expect(() => decryptToken(sealed, KEY_A, VICTIM_B)).toThrowError(OPAQUE_ERROR);
    expect(() => decryptToken(sealed, KEY_B, VICTIM_A)).toThrowError(OPAQUE_ERROR);
  });

  it("DOWNGRADE: relabelling a v3 blob as v2 does not skip the binding", () => {
    // The one move that would defeat a version-gated check: rewrite the version byte so
    // the reader takes the no-AAD leg. The tag was computed OVER the AAD, so that leg
    // cannot authenticate it either — GCM is the last word on every path.
    const sealed = encryptToken(A_TOKEN, KEY_A, VICTIM_A);
    expect(sealed[4]).toBe(3);
    const downgraded = Buffer.from(sealed);
    downgraded[4] = 2;
    expect(() => decryptToken(downgraded, KEY_A, VICTIM_B)).toThrowError(OPAQUE_ERROR);
    // Not even for the RIGHTFUL owner: a forged header is tampering, full stop.
    expect(() => decryptToken(downgraded, KEY_A, VICTIM_A)).toThrowError(OPAQUE_ERROR);
  });

  it("UPGRADE: relabelling a v2 blob as v3 does not manufacture a binding", () => {
    const relabelled = fromByteaHex(V2_FIXTURE_HEX);
    expect(relabelled[4]).toBe(2);
    relabelled[4] = 3;
    expect(() => decryptToken(relabelled, KEY_A, VICTIM_A)).toThrowError(OPAQUE_ERROR);
  });

  it("encodes the owner canonically: no two id pairs can share a binding", () => {
    // A delimiter-joined AAD would make ("ab","c") and ("a","bc") identical bytes and let
    // one row's seal open another's. Length-prefixing is what rules that out.
    const left = encryptToken(A_TOKEN, KEY_A, { userId: "ab", projectId: "c" });
    expect(() => decryptToken(left, KEY_A, { userId: "a", projectId: "bc" })).toThrowError(
      OPAQUE_ERROR,
    );
  });

  it.each([
    ["userId", { userId: "", projectId: VICTIM_A.projectId }],
    ["projectId", { userId: VICTIM_A.userId, projectId: "" }],
  ])("refuses to seal with an empty %s — never a silently unbound blob", (name, owner) => {
    expect(() => encryptToken(A_TOKEN, KEY_A, owner satisfies TokenOwner)).toThrowError(
      new RegExp(`owner ${name} must be a non-empty id`),
    );
  });

  it("leaves the PRE-v3 formats openable under ANY owner — they carry no binding", () => {
    // Honest statement of the residual exposure: v2/v1 rows stay swappable until their
    // user reconnects. There is no re-seal path, so this is a shrinking population, not
    // a solved one. Breaking them instead would log every existing customer out.
    expect(decryptToken(fromByteaHex(V2_FIXTURE_HEX), KEY_A, VICTIM_B)).toBe(V2_FIXTURE_PLAIN);
    expect(decryptToken(fromByteaHex(V1_FIXTURE_HEX), KEY_A, VICTIM_B)).toBe(V1_FIXTURE_PLAIN);
  });
});

describe("decryptToken rejects the unopenable", () => {
  it("throws on a wrong key (GCM tag mismatch), without leaking the low-level error", () => {
    const sealed = encryptToken("secret", KEY_A, OWNER);
    expect(() => decryptToken(sealed, KEY_B, OWNER)).toThrowError(/wrong key or corrupt/i);
  });

  it("throws when a single ciphertext byte is flipped (tamper detection)", () => {
    const sealed = encryptToken("secret", KEY_A, OWNER);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decryptToken(tampered, KEY_A, OWNER)).toThrowError(/wrong key or corrupt/i);
  });

  it("throws when the auth tag is altered", () => {
    const sealed = encryptToken("secret", KEY_A, OWNER);
    const tampered = Buffer.from(sealed);
    tampered[IV_BYTES] ^= 0xff; // first tag byte
    expect(() => decryptToken(tampered, KEY_A, OWNER)).toThrowError(/wrong key or corrupt/i);
  });

  it("throws a clear error on a truncated buffer (shorter than iv+tag)", () => {
    expect(() => decryptToken(Buffer.alloc(10), KEY_A, OWNER)).toThrowError(/corrupt/i);
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
    expect(() => encryptToken("x", badKey, OWNER)).toThrowError(/TOKEN_ENCRYPTION_KEY.*64 hex/s);
  });

  it("decryptToken also validates the key format up front", () => {
    const sealed = encryptToken("x", KEY_A, OWNER);
    expect(() => decryptToken(sealed, "nope", OWNER)).toThrowError(/TOKEN_ENCRYPTION_KEY.*64 hex/s);
  });

  it("accepts an upper-case hex key (case-insensitive)", () => {
    const upper = KEY_A.toUpperCase();
    expect(decryptToken(encryptToken("ok", upper, OWNER), upper, OWNER)).toBe("ok");
  });
});

describe("bytea hex serialization (DB boundary)", () => {
  it("round-trips a sealed buffer through the \\x hex text form", () => {
    const sealed = encryptToken("db-round-trip", KEY_A, OWNER);
    const hex = toByteaHex(sealed);
    expect(hex.startsWith("\\x")).toBe(true);
    expect(fromByteaHex(hex).equals(sealed)).toBe(true);
    // End to end: encrypt -> hex -> parse -> decrypt.
    expect(decryptToken(fromByteaHex(hex), KEY_A, OWNER)).toBe("db-round-trip");
  });

  it("tolerates a bare hex string with no \\x prefix", () => {
    const sealed = encryptToken("no-prefix", KEY_A, OWNER);
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

describe("keyring: rotation without touching a single stored row", () => {
  it("ZERO-ENV-CHANGE path: with no keyring vars set, the lone key is id 1 and active", () => {
    const sealed = encryptToken("derived-path", KEY_A, OWNER);
    expect(sealed.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0301`);
    expect(decryptToken(sealed, KEY_A, OWNER)).toBe("derived-path");
  });

  it("an empty/whitespace TOKEN_ENCRYPTION_KEYS is 'unset', not a broken ring", () => {
    setKeyring("   ");
    expect(decryptToken(encryptToken("still-works", KEY_A, OWNER), KEY_A, OWNER)).toBe("still-works");
  });

  it("seals under the ACTIVE key id and stamps it in the header", () => {
    setKeyring(`1:${KEY_A},2:${KEY_B}`, "2");
    const sealed = encryptToken("rotated", KEY_A, OWNER);
    expect(sealed.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0302`);
    expect(decryptToken(sealed, KEY_A, OWNER)).toBe("rotated");
  });

  it("reads BOTH keys mid-rotation: v1 rows under the old key still open", () => {
    setKeyring(`1:${KEY_A},2:${KEY_B}`, "2");
    expect(openV1Fixture()).toBe(V1_FIXTURE_PLAIN);
  });

  it("a single-key ring needs no ACTIVE id — that key is the active one", () => {
    setKeyring(`7:${KEY_B}`);
    const sealed = encryptToken("solo", KEY_A, OWNER);
    expect(sealed.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0307`);
    expect(decryptToken(sealed, KEY_A, OWNER)).toBe("solo");
  });

  it("RETIRES a v2 key: a blob sealed under id 1 stops opening once 1 leaves the ring", () => {
    const sealed = encryptToken("compromised-key-era", KEY_A, OWNER);
    setKeyring(`2:${KEY_B}`);
    expect(() => decryptToken(sealed, KEY_A, OWNER)).toThrowError(OPAQUE_ERROR);
  });

  it("RETIRES the legacy key: the pinned v1 fixture stops opening once it leaves the ring", () => {
    setKeyring(`2:${KEY_B}`);
    expect(openV1Fixture).toThrowError(OPAQUE_ERROR);
  });

  it("an UNKNOWN key id yields the SAME opaque message — no keyring probing", () => {
    setKeyring(`9:${KEY_B}`);
    const sealed = encryptToken("sealed-under-9", KEY_A, OWNER);
    setKeyring(`1:${KEY_A}`);
    // Anchored: byte-identical to the wrong-key message, so nothing hints that id 9 once
    // existed or that the header parsed at all.
    expect(() => decryptToken(sealed, KEY_A, OWNER)).toThrowError(OPAQUE_ERROR);
  });
});

describe("keyring structural validation (boot error, never silent degradation)", () => {
  it.each([
    ["no colon", "garbage"],
    ["non-hex key", `1:${"z".repeat(64)}`],
    ["63-hex key", `1:${"0".repeat(63)}`],
    ["missing key", "1:"],
    ["missing id", `:${KEY_A}`],
    ["id 0", `0:${KEY_A}`],
    ["id above 255", `256:${KEY_A}`],
    ["duplicate id", `1:${KEY_A},1:${KEY_B}`],
    ["one good, one broken", `1:${KEY_A},2:nope`],
  ])("rejects %s — reads and writes BOTH stop, no fallback to the lone key", (_label, ring) => {
    setKeyring(ring);
    expect(() => encryptToken("x", KEY_A, OWNER)).toThrowError(/TOKEN_ENCRYPTION_KEYS/);
    expect(openV1Fixture).toThrowError(/TOKEN_ENCRYPTION_KEYS/);
  });

  it("never echoes key material in the failure message", () => {
    setKeyring(`1:${KEY_A},1:${KEY_B}`);
    const seal = (): Buffer => encryptToken("x", KEY_A, OWNER);
    expect(seal).toThrowError(/TOKEN_ENCRYPTION_KEYS/);
    expect(seal).not.toThrowError(KEY_A); // substring match: the value must not appear
    expect(seal).not.toThrowError(KEY_B);
  });

  it("demands an explicit ACTIVE id once the ring holds more than one key", () => {
    setKeyring(`1:${KEY_A},2:${KEY_B}`);
    expect(() => encryptToken("x", KEY_A, OWNER)).toThrowError(/TOKEN_ENCRYPTION_ACTIVE_KEY_ID/);
  });

  it.each([
    ["names a key outside the ring", `1:${KEY_A}`, "2"],
    ["is not a number", `1:${KEY_A}`, "primary"],
  ])("throws when TOKEN_ENCRYPTION_ACTIVE_KEY_ID %s", (_label, ring, active) => {
    setKeyring(ring, active);
    expect(() => encryptToken("x", KEY_A, OWNER)).toThrowError(/TOKEN_ENCRYPTION_ACTIVE_KEY_ID/);
  });

  it("rejects an ACTIVE id other than 1 while no ring is configured", () => {
    setKeyring(undefined, "3");
    expect(() => encryptToken("x", KEY_A, OWNER)).toThrowError(/TOKEN_ENCRYPTION_ACTIVE_KEY_ID/);
  });
});
