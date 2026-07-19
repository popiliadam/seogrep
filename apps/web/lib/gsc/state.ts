import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring OAuth `state` for the GSC connect flow. The state is the ONLY thing
 * that carries the tenant identity ({user_id, project_id}) across the redirect to Google
 * and back to the callback, so it must be unforgeable and short-lived. It is an HMAC-SHA256
 * MAC over a base64url JSON payload — a compact, stateless token (no server-side store):
 *
 *     base64url(JSON(payload)) . base64url(HMAC-SHA256(base64url(JSON(payload)), stateKey))
 *
 * The HMAC key is DERIVED from TOKEN_ENCRYPTION_KEY via HKDF-SHA256 with a distinct `info`
 * label, so the state MAC key is a SEPARATE key from the token-encryption key (key
 * separation — the same master secret is never used for two purposes). The callback
 * additionally re-checks the live session against `user_id`, so a leaked state alone
 * cannot bind a project to another signed-in user.
 */

/** Default state lifetime: the round-trip to Google's consent screen is quick. */
export const STATE_TTL_SECONDS = 600;

/** HKDF info label — makes the derived MAC key distinct from any other use of the master key. */
const STATE_KEY_INFO = "seogrep:gsc-oauth-state:v1";

export interface StatePayload {
  readonly user_id: string;
  readonly project_id: string;
  /** Absolute expiry, epoch SECONDS. */
  readonly exp: number;
  /** Random per-issue value (defence against state reuse). */
  readonly nonce: string;
}

/**
 * Derive the 32-byte HMAC key from the hex master secret. HKDF with a fixed info label
 * yields a key bound to this purpose; a different master secret yields a different key,
 * so a state signed under one secret never verifies under another.
 */
function deriveStateKey(secretHex: string): Buffer {
  const ikm = Buffer.from(secretHex, "hex");
  return Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), STATE_KEY_INFO, 32));
}

function mac(encodedPayload: string, secretHex: string): Buffer {
  return createHmac("sha256", deriveStateKey(secretHex)).update(encodedPayload).digest();
}

/** Build a fresh payload for {userId, projectId}, stamping exp (now + ttl) and a nonce. */
export function freshStatePayload(
  userId: string,
  projectId: string,
  opts: { ttlSeconds?: number; nowMs?: number } = {},
): StatePayload {
  const nowMs = opts.nowMs ?? Date.now();
  const ttl = opts.ttlSeconds ?? STATE_TTL_SECONDS;
  return {
    user_id: userId,
    project_id: projectId,
    exp: Math.floor(nowMs / 1000) + ttl,
    nonce: randomUUID(),
  };
}

/** Sign a state payload into the `payload.signature` token form. */
export function signState(payload: StatePayload, secretHex: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = mac(encoded, secretHex).toString("base64url");
  return `${encoded}.${signature}`;
}

/**
 * Verify + decode a state token. Returns the payload only when the signature matches
 * (constant-time) AND it has not expired (`exp` is compared against `nowMs`). Any
 * malformed input, bad signature, or expiry yields null — never a throw, so a hostile
 * callback query can only ever be rejected, not crash the route.
 */
export function verifyState(token: string, secretHex: string, nowMs: number = Date.now()): StatePayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;

  const expected = mac(encoded, secretHex);
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }
  if (
    typeof payload?.user_id !== "string" ||
    typeof payload?.project_id !== "string" ||
    typeof payload?.exp !== "number" ||
    typeof payload?.nonce !== "string"
  ) {
    return null;
  }
  if (payload.exp * 1000 < nowMs) {
    return null;
  }
  return payload;
}
