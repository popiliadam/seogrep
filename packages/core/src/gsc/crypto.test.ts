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
 * non-determinism, tamper/wrong-key rejection, key-format validation, the exact v4
 * on-the-wire layout, that a seal only opens for the ROW IT WAS WRITTEN FOR, and that
 * pre-v4 formats (v1/v2/v3) are refused outright — migration 0021 dropped the only
 * column that could ever hold them, so no such ciphertext can legitimately exist any
 * more. Two frozen legacy fixtures (v1, v2) are kept as raw bytes purely to prove the
 * refusal fires on real historical shapes, never decrypted for their plaintext again.
 * All local — zero network, zero secrets that resemble real keys.
 */

// Two DISTINCT 64-hex (32-byte) keys. Unmistakably test values, never real.
const KEY_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

/**
 * The `gsc_accounts` row these fixtures belong to. v4 binds a seal to exactly this
 * pair, so it is an input to every seal AND every open in this file.
 */
const OWNER: TokenOwner = {
  userId: "aaaaaaaa-0000-4000-8000-0000000000a1",
  accountId: "bbbbbbbb-0000-4000-8000-0000000000b1",
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
 * re-derive it, which is the point: it is the standing spec for "a genuinely headerless
 * legacy blob is refused", not a shape any code in this file can regenerate.
 */
const V1_FIXTURE_PLAIN = "1//v1-legacy-refresh-token";
const V1_FIXTURE_HEX =
  "6d778b7314cd72747d631cb0173baa445ce84623022bae81da5f60fdff81aad2" +
  "8b20631fcb7f060cc0bc66f21fe5debe53be708f9ca8";

/**
 * A blob produced by the v2 implementation (`magic || version 2 || key id || iv || tag ||
 * ct`, NO additional authenticated data), captured from the shipped build and frozen here
 * the same way. Migration 0021 dropped the column this used to live in, so this fixture
 * now exists only to pin that a v2-headered buffer is refused BY NAME.
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

/** The ONE message every unopenable v4-shaped buffer produces. ANCHORED: no detail leak. */
const OPAQUE_ERROR = /^failed to decrypt token: wrong key or corrupt ciphertext$/;

/** The message a header naming an older version must produce — ANCHORED on the parts that
 * must survive: which version, and what the operator does about it. */
const legacyRefused = (version: number): RegExp =>
  new RegExp(`^encrypted token format v${version} is no longer supported.*reconnect`, "i");

/** Opening the frozen v1 fixture — always refused now; kept as a function since several
 * specs re-run it under different keyring configurations to prove the refusal doesn't
 * depend on keyring state. */
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

describe("v4 core contract (pinned literally per task-3 brief)", () => {
  it("seals to (userId, accountId) and refuses another account's blob", () => {
    const owner = { userId: "u1", accountId: "a1" };
    const sealed = encryptToken("refresh-token", KEY_A, owner);
    expect(decryptToken(sealed, KEY_A, owner)).toBe("refresh-token");
    expect(() => decryptToken(sealed, KEY_A, { userId: "u1", accountId: "a2" })).toThrow();
  });

  it("refuses a legacy v3 blob LOUDLY and tells the operator what to do", () => {
    // MAGIC is deliberately not exported for a test to import — built here from the
    // literal ASCII bytes of "SGSL" instead: magic(4) || version=3, keyid=0 (2) ||
    // iv+tag+padding (44, never reached — the version check fires first).
    const legacy = Buffer.concat([Buffer.from(MAGIC_HEX, "hex"), Buffer.from([3, 0]), Buffer.alloc(44)]);
    expect(() => decryptToken(legacy, KEY_A, { userId: "u1", accountId: "a1" })).toThrow(
      /no longer supported.*reconnect/i,
    );
  });

  /**
   * Hand-builds a v4-shaped buffer with a CALLER-CHOSEN AAD, bypassing `ownerAad` inside
   * crypto.ts entirely, so this test does not merely re-exercise decryptToken's own logic
   * against itself (encryptToken/decryptToken always agree with each other regardless of
   * what AAD_CONTEXT equals — that is what mutation 1 below discovered: reverting
   * AAD_CONTEXT to the old string does NOT redden any owner-mismatch test, since those
   * depend on the accountId field differing, not on the context prefix). This is the one
   * test in the suite that pins the literal context bytes crypto.ts must use.
   */
  function ownerAadBytes(context: string, userId: string, accountId: string): Buffer {
    const field = (value: string): Buffer => {
      const bytes = Buffer.from(value.toLowerCase(), "utf8");
      const length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.length);
      return Buffer.concat([length, bytes]);
    };
    return Buffer.concat([Buffer.from(context, "ascii"), field(userId), field(accountId)]);
  }

  function sealV4WithAad(plain: string, keyHex: string, keyId: number, iv: Buffer, aad: Buffer): Buffer {
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const header = Buffer.concat([Buffer.from(MAGIC_HEX, "hex"), Buffer.from([4, keyId])]);
    return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
  }

  it("PINS the exact AAD_CONTEXT string — a blob sealed under the OLD context fails to authenticate", () => {
    const iv = Buffer.from("000102030405060708090a0b", "hex"); // fixed IV, determinism only
    const correctAad = ownerAadBytes(
      "seogrep/gsc-refresh-token/account",
      OWNER.userId,
      OWNER.accountId,
    );
    const sealed = sealV4WithAad("hand-sealed-probe", KEY_A, 1, iv, correctAad);
    expect(decryptToken(sealed, KEY_A, OWNER)).toBe("hand-sealed-probe");

    // The PRE-migration context string (no "/account" suffix) — same owner ids, wrong
    // domain separator. If crypto.ts ever reverts AAD_CONTEXT to this, THIS half flips:
    // decryptToken would rebuild AAD with the old string and open this one instead.
    const staleAad = ownerAadBytes("seogrep/gsc-refresh-token", OWNER.userId, OWNER.accountId);
    const staleSealed = sealV4WithAad("hand-sealed-probe", KEY_A, 1, iv, staleAad);
    expect(() => decryptToken(staleSealed, KEY_A, OWNER)).toThrowError(OPAQUE_ERROR);
  });
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

describe("v4 wire format (self-describing header, owner-bound body)", () => {
  it("stamps MAGIC || version 4 || active key id in the first 6 bytes", () => {
    const sealed = encryptToken("header-probe", KEY_A, OWNER);
    // Without an explicit keyring the active id is 1 (the derived legacy slot).
    expect(sealed.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0401`);
  });

  it("costs NOTHING over the pre-v4 header layout — the binding lives in the tag, not the bytes", () => {
    // Pure byte-length comparison against the frozen v2 fixture's raw bytes — no
    // decryption of that fixture happens here (v2 is refused; see "legacy formats").
    const sealed = encryptToken(V2_FIXTURE_PLAIN, KEY_A, OWNER);
    expect(sealed.length).toBe(fromByteaHex(V2_FIXTURE_HEX).length);
  });

  it("never stores the owner ids it is bound to (they come from the row, not the blob)", () => {
    const sealed = encryptToken("owner-leak-probe", KEY_A, OWNER);
    expect(sealed.toString("latin1")).not.toContain(OWNER.userId);
    expect(sealed.toString("latin1")).not.toContain(OWNER.accountId);
    expect(sealed.toString("hex")).not.toContain(Buffer.from(OWNER.userId).toString("hex"));
  });

  it("still fits the unchanged bytea column: same \\x hex text form, +6 bytes", () => {
    const sealed = encryptToken(V1_FIXTURE_PLAIN, KEY_A, OWNER);
    expect(sealed.length).toBe(fromByteaHex(V1_FIXTURE_HEX).length + HEADER_BYTES);
    expect(decryptToken(fromByteaHex(toByteaHex(sealed)), KEY_A, OWNER)).toBe(V1_FIXTURE_PLAIN);
  });
});

/**
 * NEVER#8 note: this whole describe block used to be "backward read: blobs sealed
 * before v3 still open (no reconnect forced)" and pinned that v1/v2 fixtures OPENED.
 * Migration 0021 dropped `gsc_connections.encrypted_refresh_token`, the only column
 * that ever held those bytes, so that claim is now false by construction — no v1/v2/v3
 * ciphertext can exist in this system. The tests below were NOT deleted; each is kept
 * and rewritten to assert the new, opposite behavior: the same fixtures are now
 * refused, loudly where a version byte is present to name.
 */
describe("legacy formats are refused (migration 0021 dropped the only column that held them)", () => {
  it("refuses the PINNED v1 fixture — headerless, so there is no version byte to name (opaque error)", () => {
    // v1 has no magic/version byte at all, so the loud named refusal (which reads the
    // header) cannot fire; it falls through to the same opaque error as any other
    // unopenable buffer. That is still a refusal, just an unnamed one.
    expect(() => decryptToken(fromByteaHex(V1_FIXTURE_HEX), KEY_A, OWNER)).toThrowError(
      OPAQUE_ERROR,
    );
  });

  it("proves that fixture is genuinely legacy (no v4 magic, v1 length math)", () => {
    const blob = fromByteaHex(V1_FIXTURE_HEX);
    expect(blob.subarray(0, 4).toString("hex")).not.toBe(MAGIC_HEX);
    expect(blob.length).toBe(
      IV_BYTES + TAG_BYTES + Buffer.byteLength(V1_FIXTURE_PLAIN, "utf8"),
    );
  });

  it("refuses the PINNED v2 fixture LOUDLY, naming the version and telling the operator to reconnect", () => {
    expect(() => decryptToken(fromByteaHex(V2_FIXTURE_HEX), KEY_A, OWNER)).toThrowError(
      legacyRefused(2),
    );
  });

  it("proves that fixture is genuinely v2 (magic + version byte 2, v2 length math)", () => {
    const blob = fromByteaHex(V2_FIXTURE_HEX);
    expect(blob.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0201`);
    expect(blob.length).toBe(
      HEADER_BYTES + IV_BYTES + TAG_BYTES + Buffer.byteLength(V2_FIXTURE_PLAIN, "utf8"),
    );
  });

  it("a forged buffer whose bytes merely LOOK like a v2 header is refused by byte position, not decrypted", () => {
    // Previously this proved "the GCM tag decides format, not the magic/version bytes" —
    // a genuine v1 blob whose random IV happens to start with the v2 header bytes still
    // opened, because the v2 leg's tag check failed and control fell through to v1. That
    // property is gone on purpose: the legacy-refusal check reads ONLY the magic and
    // version byte position, before any key/tag is touched (see crypto.ts decryptToken —
    // "byte-position only, no decryption attempted"). So this exact forged buffer — a
    // real v1 ciphertext that coincidentally LOOKS like a v2 header — is now refused by
    // name, even though its bytes are not actually a v2 blob.
    const iv = Buffer.concat([
      Buffer.from(`${MAGIC_HEX}0201`, "hex"),
      Buffer.from("c0ffee1234", "hex"),
      Buffer.from([0x9a]),
    ]);
    expect(iv).toHaveLength(IV_BYTES);
    const forged = sealLegacy("collision-probe", KEY_A, iv);
    expect(() => decryptToken(forged, KEY_A, OWNER)).toThrowError(legacyRefused(2));
  });

  it("PRE-v4 formats are refused under ANY owner — not merely unbound, unreadable outright", () => {
    // Honest statement of what changed: v2/v1 used to stay swappable under any owner
    // (no binding). Now they are not readable AT ALL, regardless of owner, because the
    // format itself cannot exist in this system any more.
    expect(() => decryptToken(fromByteaHex(V2_FIXTURE_HEX), KEY_A, OWNER)).toThrowError(
      legacyRefused(2),
    );
    expect(() => decryptToken(fromByteaHex(V1_FIXTURE_HEX), KEY_A, OWNER)).toThrowError(
      OPAQUE_ERROR,
    );
  });
});

/**
 * M-17. The attack these specs close: `encrypted_refresh_token` used to be
 * cryptographically anonymous, so anyone able to WRITE the credential table (a
 * `service_role` key, a SQL-injection sink, a restored dump) could copy victim A's
 * sealed blob into victim B's row and B's next pull would drive A's Google grant.
 * Nothing in the crypto could notice. v4 authenticates the owning (user, account)
 * alongside the ciphertext.
 */
describe("M-17: a seal opens ONLY for the row it was written for", () => {
  const VICTIM_A: TokenOwner = {
    userId: "aaaaaaaa-0000-4000-8000-00000000000a",
    accountId: "11111111-0000-4000-8000-000000000011",
  };
  const VICTIM_B: TokenOwner = {
    userId: "bbbbbbbb-0000-4000-8000-00000000000b",
    accountId: "22222222-0000-4000-8000-000000000022",
  };
  const A_TOKEN = "1//VICTIM-A-GOOGLE-REFRESH-TOKEN";

  it("ROW SWAP: A's sealed token planted in B's row does not open", () => {
    // Exactly the attack: the bytea value is copied verbatim; only the row it is read
    // from changes. Before v3/v4 this returned A's plaintext refresh token.
    const stolen = fromByteaHex(toByteaHex(encryptToken(A_TOKEN, KEY_A, VICTIM_A)));
    expect(() => decryptToken(stolen, KEY_A, VICTIM_B)).toThrowError(OPAQUE_ERROR);
    // ...and it still opens for its rightful row, so the fix costs A nothing.
    expect(decryptToken(stolen, KEY_A, VICTIM_A)).toBe(A_TOKEN);
  });

  it.each([
    ["the user alone (same account)", { userId: VICTIM_B.userId, accountId: VICTIM_A.accountId }],
    ["the account alone (same user)", { userId: VICTIM_A.userId, accountId: VICTIM_B.accountId }],
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

  it("DOWNGRADE: relabelling a v4 blob as v3 does not skip the binding — refused by name, not silently reopened", () => {
    // The move that used to require a tag-authentication argument now dies earlier: any
    // version byte below FORMAT_V4 is refused by the byte-position check before a key
    // or tag is ever touched, for EITHER party.
    const sealed = encryptToken(A_TOKEN, KEY_A, VICTIM_A);
    expect(sealed[4]).toBe(4);
    const downgraded = Buffer.from(sealed);
    downgraded[4] = 3;
    expect(() => decryptToken(downgraded, KEY_A, VICTIM_B)).toThrowError(legacyRefused(3));
    // Not even for the RIGHTFUL owner: a forged version byte is refused outright, full stop.
    expect(() => decryptToken(downgraded, KEY_A, VICTIM_A)).toThrowError(legacyRefused(3));
  });

  it("UPGRADE: relabelling a legacy v2 blob as v4 does not manufacture a binding", () => {
    const relabelled = fromByteaHex(V2_FIXTURE_HEX);
    expect(relabelled[4]).toBe(2);
    relabelled[4] = 4;
    expect(() => decryptToken(relabelled, KEY_A, VICTIM_A)).toThrowError(OPAQUE_ERROR);
  });

  it("encodes the owner canonically: no two id pairs can share a binding", () => {
    // A delimiter-joined AAD would make ("ab","c") and ("a","bc") identical bytes and let
    // one row's seal open another's. Length-prefixing is what rules that out.
    const left = encryptToken(A_TOKEN, KEY_A, { userId: "ab", accountId: "c" });
    expect(() => decryptToken(left, KEY_A, { userId: "a", accountId: "bc" })).toThrowError(
      OPAQUE_ERROR,
    );
  });

  it.each([
    ["userId", { userId: "", accountId: VICTIM_A.accountId }],
    ["accountId", { userId: VICTIM_A.userId, accountId: "" }],
  ])("refuses to seal with an empty %s — never a silently unbound blob", (name, owner) => {
    expect(() => encryptToken(A_TOKEN, KEY_A, owner satisfies TokenOwner)).toThrowError(
      new RegExp(`owner ${name} must be a non-empty id`),
    );
  });

  /**
   * UUID CASE: the binding is on the IDENTITY, not on the text an id happened to arrive in.
   *
   * Every validator that guards these ids is case-INSENSITIVE — pull_gsc_data's `z.uuid()`,
   * and the `/^[0-9a-f]{8}-…/i` regexes in the connect route and the connection actions all
   * accept `A1B2…` — while Postgres stores `uuid` in canonical LOWERCASE. So a connect flow
   * started with a mixed-case account_id seals under an UPPERCASE AAD and lands in a row
   * that reads back lowercase: every later read rebuilds the lowercase AAD and the
   * connection can never be opened again. Fail-CLOSED and no cross-tenant leak (a
   * differently-cased id is still the same tenant), but the connection is bricked.
   *
   * Case-folding both fields inside the AAD is byte-compatible with every v4 row already
   * written, because those were all sealed from canonical ids.
   */
  it("CASE: an id's letter case does not change the binding (validators are case-insensitive)", () => {
    const upper: TokenOwner = {
      userId: VICTIM_A.userId.toUpperCase(),
      accountId: VICTIM_A.accountId.toUpperCase(),
    };
    // Sealed from what the request carried, opened with what the DB stored.
    const sealedUpper = encryptToken(A_TOKEN, KEY_A, upper);
    expect(decryptToken(sealedUpper, KEY_A, VICTIM_A)).toBe(A_TOKEN);
    // ...and the other direction, so neither side is privileged.
    const sealedLower = encryptToken(A_TOKEN, KEY_A, VICTIM_A);
    expect(decryptToken(sealedLower, KEY_A, upper)).toBe(A_TOKEN);
    // One field mixed-cased is the realistic shape of the bug, and must behave the same.
    const mixed: TokenOwner = { userId: upper.userId, accountId: VICTIM_A.accountId };
    expect(decryptToken(encryptToken(A_TOKEN, KEY_A, mixed), KEY_A, VICTIM_A)).toBe(A_TOKEN);
  });

  it("CASE: folding case does not weaken the binding — a DIFFERENT id still fails", () => {
    // The fix must not collapse distinct owners: case-insensitivity is not id-insensitivity.
    const sealed = encryptToken(A_TOKEN, KEY_A, VICTIM_A);
    expect(() => decryptToken(sealed, KEY_A, VICTIM_B)).toThrowError(OPAQUE_ERROR);
    expect(() =>
      decryptToken(sealed, KEY_A, {
        userId: VICTIM_B.userId.toUpperCase(),
        accountId: VICTIM_A.accountId,
      }),
    ).toThrowError(OPAQUE_ERROR);
    // Case folding must not make the length-prefixing redundant either (the ("ab","c") /
    // ("a","bc") collision this suite already rules out, now in mixed case).
    const left = encryptToken(A_TOKEN, KEY_A, { userId: "AB", accountId: "c" });
    expect(() => decryptToken(left, KEY_A, { userId: "a", accountId: "BC" })).toThrowError(
      OPAQUE_ERROR,
    );
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
    expect(sealed.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0401`);
    expect(decryptToken(sealed, KEY_A, OWNER)).toBe("derived-path");
  });

  it("an empty/whitespace TOKEN_ENCRYPTION_KEYS is 'unset', not a broken ring", () => {
    setKeyring("   ");
    expect(decryptToken(encryptToken("still-works", KEY_A, OWNER), KEY_A, OWNER)).toBe("still-works");
  });

  it("seals under the ACTIVE key id and stamps it in the header", () => {
    setKeyring(`1:${KEY_A},2:${KEY_B}`, "2");
    const sealed = encryptToken("rotated", KEY_A, OWNER);
    expect(sealed.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0402`);
    expect(decryptToken(sealed, KEY_A, OWNER)).toBe("rotated");
  });

  it("mid-rotation: a v4 row sealed under the OLD key still opens once a NEW key joins the ring", () => {
    // Was "reads BOTH keys mid-rotation: v1 rows under the old key still open", pinned
    // against the frozen v1 fixture. v1 is unconditionally refused now (see "legacy
    // formats are refused"), so it can no longer stand in for "an older, still-valid
    // row read mid-rotation" — that scenario is rebuilt here on the only format that
    // can exist: seal under key 1 alone, then widen the ring to include key 2 as active,
    // and confirm the key-1 blob still opens.
    const sealed = encryptToken("sealed-before-rotation", KEY_A, OWNER);
    setKeyring(`1:${KEY_A},2:${KEY_B}`, "2");
    expect(decryptToken(sealed, KEY_A, OWNER)).toBe("sealed-before-rotation");
  });

  it("a single-key ring needs no ACTIVE id — that key is the active one", () => {
    setKeyring(`7:${KEY_B}`);
    const sealed = encryptToken("solo", KEY_A, OWNER);
    expect(sealed.subarray(0, HEADER_BYTES).toString("hex")).toBe(`${MAGIC_HEX}0407`);
    expect(decryptToken(sealed, KEY_A, OWNER)).toBe("solo");
  });

  it("RETIRES a key: a blob sealed under id 1 stops opening once 1 leaves the ring", () => {
    const sealed = encryptToken("compromised-key-era", KEY_A, OWNER);
    setKeyring(`2:${KEY_B}`);
    expect(() => decryptToken(sealed, KEY_A, OWNER)).toThrowError(OPAQUE_ERROR);
  });

  it("legacy v1 fixture stays refused whether or not its key is in the ring (refusal is unconditional)", () => {
    // Was "RETIRES the legacy key: the pinned v1 fixture stops opening once it leaves
    // the ring" — it pinned that retiring KEY_A was WHAT CAUSED the v1 fixture to stop
    // opening. That causality is gone: the v1 fixture never opens any more, in ANY
    // keyring state, because the format itself is refused before any key is tried. This
    // rewrite proves exactly that — same assertion true both with and without the key
    // present, which is the opposite of "retiring the key is what breaks it".
    expect(openV1Fixture).toThrowError(OPAQUE_ERROR); // KEY_A (id 1) still in the ring
    setKeyring(`2:${KEY_B}`); // KEY_A (id 1) retired
    expect(openV1Fixture).toThrowError(OPAQUE_ERROR); // unchanged — was never a keyring question
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
