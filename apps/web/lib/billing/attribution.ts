import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * M-05 — checkout attribution token.
 *
 * Paddle `customData` is settable AND updatable from the browser while the overlay is open, so
 * `custom_data.user_id` is a CLAIM, not authority. An attacker cannot mint free credits (they
 * still have to pay for a real, Paddle-signed transaction) but they can point their own paid
 * transaction at any uuid they know — corrupting tenant attribution, support and audit. The fix
 * is a short-lived HMAC token minted SERVER-side when checkout starts, carried through customData
 * next to the existing user_id, and verified in the webhook: the verified subject — never the raw
 * body id — becomes the tenant.
 *
 * KEY MATERIAL: derived from PADDLE_WEBHOOK_SECRET, deliberately NOT a new required env var (that
 * would be a human deploy blocker on a live checkout). HKDF-derived with a domain-separation label
 * so the signing key is not the webhook secret reused verbatim for a second purpose. The secret is
 * reachable from BOTH call sites because they are the same Netlify deployment of apps/web sharing
 * one process env — the mint server action and the webhook route. That also buys an invariant: the
 * route fail-closes (500) without the secret, so verification can never run keyless.
 *
 * GRACE: a MISSING token is accepted (and logged). Customers sit mid-checkout across deploys with
 * an overlay built before this shipped; refusing them would cost paying customers their credits.
 * Enforcement is opt-in via PADDLE_ATTRIBUTION_ENFORCE and OFF unless explicitly set.
 */

/** The customData key the overlay carries the token under, next to the existing user_id. */
export const ATTRIBUTION_CUSTOM_DATA_KEY = "attribution_token";

/** Token format tag. Bumping it invalidates every older token (they read as `malformed`). */
const TOKEN_VERSION = "v1";

/**
 * How long a minted token stays valid. Measured against the EVENT's own `occurred_at` (see
 * `attributionReferenceTime`), not delivery time, so Paddle's ~3-day retry window does not eat the
 * budget: a retry of a legitimate purchase verifies exactly as the first delivery did. The window
 * only has to cover "clicked Buy -> finished paying".
 */
export const ATTRIBUTION_TTL_SECONDS = 60 * 60;

/** HKDF domain separation: this label is what makes the signing key ITS OWN key, not the secret. */
const HKDF_INFO = "pseo:paddle-checkout-attribution:v1";
const HKDF_SALT = "pseo:paddle-checkout-attribution:salt:v1";
const KEY_BYTES = 32;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The derived signing key, or null when the source secret is absent. Derived per call, not cached:
 * a rotated PADDLE_WEBHOOK_SECRET must take effect on the next request, not the next cold start.
 */
function signingKey(): Buffer | null {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    return null;
  }
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), HKDF_SALT, HKDF_INFO, KEY_BYTES),
  );
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function equalsConstantTime(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Mint a token for an ALREADY-AUTHENTICATED user id. Returns null when it cannot be signed
 * (no secret, or an id that is not a uuid) — the caller then opens checkout without one and the
 * grace path accepts it. Minting must never be able to cost a sale.
 */
export function mintAttributionToken(userId: string, now: Date = new Date()): string | null {
  const key = signingKey();
  if (!key || !UUID_PATTERN.test(userId)) {
    return null;
  }
  const expiresAt = Math.floor(now.getTime() / 1000) + ATTRIBUTION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${userId}.${expiresAt}`;
  return `${payload}.${sign(payload, key)}`;
}

export type AttributionCheck =
  | { readonly status: "verified"; readonly userId: string }
  | { readonly status: "absent" }
  | { readonly status: "invalid"; readonly reason: string };

/**
 * Read + verify the token out of an unmarshalled event's `data` (its `customData`). Decides
 * nothing about what the route should DO — see `decideTenant`. `at` is the instant expiry is
 * measured at. Signature FIRST: expiry and subject live inside the signed payload, so they are
 * only worth reading once the HMAC holds.
 */
export function readAttributionToken(eventData: unknown, at: Date): AttributionCheck {
  const customData = (eventData as { customData?: unknown } | null | undefined)?.customData;
  const raw = (customData as Record<string, unknown> | null | undefined)?.[
    ATTRIBUTION_CUSTOM_DATA_KEY
  ];
  if (raw === undefined || raw === null || raw === "") {
    return { status: "absent" };
  }
  if (typeof raw !== "string") {
    return { status: "invalid", reason: "not_a_string" };
  }
  const key = signingKey();
  if (!key) {
    // Unreachable from the webhook (it 500s without the secret before it ever gets here) — a
    // floor, not a second gate. Never "verified" without a key.
    return { status: "invalid", reason: "no_signing_key" };
  }
  const parts = raw.split(".");
  const [version, subject, expires, signature] = parts;
  if (
    parts.length !== 4 ||
    version !== TOKEN_VERSION ||
    subject === undefined ||
    expires === undefined ||
    signature === undefined
  ) {
    return { status: "invalid", reason: "malformed" };
  }
  if (!equalsConstantTime(signature, sign(`${TOKEN_VERSION}.${subject}.${expires}`, key))) {
    return { status: "invalid", reason: "bad_signature" };
  }
  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt)) {
    return { status: "invalid", reason: "malformed_expiry" };
  }
  if (Math.floor(at.getTime() / 1000) > expiresAt) {
    return { status: "invalid", reason: "expired" };
  }
  if (!UUID_PATTERN.test(subject)) {
    return { status: "invalid", reason: "bad_subject" };
  }
  return { status: "verified", userId: subject };
}

/**
 * The instant a token's expiry is measured against: the event's own `occurred_at` when Paddle
 * gave us a usable one (it is inside the signature-verified body, so it is vendor-attested), else
 * now. This is what makes retries safe — see ATTRIBUTION_TTL_SECONDS.
 */
export function attributionReferenceTime(occurredAt: string | null, now: Date = new Date()): Date {
  if (occurredAt) {
    const parsed = new Date(occurredAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return now;
}

/**
 * ENFORCEMENT FLAG. OFF unless explicitly set to "1"/"true" — unset, empty, "0", "false" and
 * anything unrecognised all mean grace. Default-off is load-bearing: an EXPIRED token from a real
 * customer who left the overlay open would otherwise cost them the credits they paid for.
 */
export function attributionEnforced(): boolean {
  const raw = process.env.PADDLE_ATTRIBUTION_ENFORCE?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export type TenantDecision =
  | { readonly outcome: "accept"; readonly userId: string; readonly signal: string | null }
  | { readonly outcome: "refuse"; readonly reason: string };

/**
 * The whole policy, pure and in one place. `signal` is a reason string the caller logs (one line,
 * one channel — the reason is what an operator counts), or null when there is nothing to say.
 *  - verified          -> accept the SIGNED subject; a body id that disagrees is discarded and
 *                         reported (custom_data was edited after checkout started).
 *  - anything else, ON -> refuse; the caller must not write state and must not close the event.
 *  - anything else, OFF-> accept the claim and report why it could not be verified. `absent` is
 *                         the expected shape of every overlay opened before this shipped.
 */
export function decideTenant(
  check: AttributionCheck,
  claimedUserId: string,
  enforced: boolean,
): TenantDecision {
  if (check.status === "verified") {
    return {
      outcome: "accept",
      userId: check.userId,
      signal: check.userId === claimedUserId ? null : "custom_data_user_id_mismatch",
    };
  }
  const reason = check.status === "absent" ? "absent" : check.reason;
  return enforced
    ? { outcome: "refuse", reason }
    : { outcome: "accept", userId: claimedUserId, signal: reason };
}
