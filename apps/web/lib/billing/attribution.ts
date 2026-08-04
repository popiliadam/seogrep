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
 *
 * WHAT THE TOKEN DOES NOT BIND (accepted residual): the payload is subject + expiry, NOT the
 * transaction. A token stolen from a live session can therefore attribute the THIEF's own paid
 * transaction to its subject — but only to its own subject (the subject is inside the signature),
 * and only inside the TTL on a first-party checkout. Binding a transaction id is impossible here:
 * the id does not exist yet when the overlay opens. The residual is bounded by session security
 * plus ATTRIBUTION_TTL_SECONDS, and its worst outcome is credits landing on the victim's account,
 * not leaving it. Do not "fix" it by widening the TTL — the TTL is the bound.
 *
 * The operator contract for PADDLE_ATTRIBUTION_ENFORCE (both states, the two preconditions, the
 * heal path) lives in scripts/paddle-smoke.md — "Attribution enforcement". Keep them in step.
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
  /** Signature held AND the token is still fresh: `userId` is server-attested authority. */
  | { readonly status: "verified"; readonly userId: string }
  /**
   * Signature held, freshness did not. The subject is STILL server-attested — the HMAC covers it —
   * so this carries the subject where `invalid` cannot: only recency lapsed, not authenticity.
   * Its own status because that is exactly the distinction enforcement has to be able to draw
   * (see `decideTenant`), and a union member cannot be forgotten the way an optional field can.
   */
  | { readonly status: "expired"; readonly userId: string }
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
  // Subject shape BEFORE expiry: `expired` hands the subject back to the caller, so it may only be
  // reached once the subject is a thing we would have been willing to mint for in the first place.
  if (!UUID_PATTERN.test(subject)) {
    return { status: "invalid", reason: "bad_subject" };
  }
  if (Math.floor(at.getTime() / 1000) > expiresAt) {
    return { status: "expired", userId: subject };
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
 *
 * An unrecognised value used to be indistinguishable from an unset one at runtime: an operator who
 * set `PADDLE_ATTRIBUTION_ENFORCE=yes` got silent grace and no way to tell. It now says so once per
 * event it is consulted for. The value itself is NOT logged — the fix ("set it to 1, or unset it")
 * does not depend on knowing it, and this file's standing rule is that env never reaches stdout.
 */
export function attributionEnforced(): boolean {
  const raw = process.env.PADDLE_ATTRIBUTION_ENFORCE?.trim().toLowerCase();
  if (raw === "1" || raw === "true") {
    return true;
  }
  if (raw !== undefined && raw !== "" && raw !== "0" && raw !== "false") {
    console.warn(
      "paddle attribution: PADDLE_ATTRIBUTION_ENFORCE has an unrecognised value — treating it as OFF (grace). Set it to 1 or true to enforce, or unset it.",
    );
  }
  return false;
}

/**
 * Where the event came from, for the sole purpose of judging its token. This is NOT a security
 * boundary by itself — it decides what enforcement is ENTITLED to conclude from a stale token.
 *
 *  - `checkout`  — a first-party checkout completion: the overlay was open, our server action
 *                  minted a token seconds ago, so a token that is absent, forged or stale is a
 *                  fact about THIS event and enforcement may refuse it.
 *  - `recurring` — Paddle raised it on its own (a renewal charge, a plan change, a cancellation).
 *                  No overlay was open, so no fresh token can exist: whatever custom_data carries
 *                  was written months ago at checkout time. Staleness here is a fact about the
 *                  CALENDAR, not about the event, and refusing it would refuse every renewal.
 *
 * The discriminator is vendor-attested: `eventType` and the transaction's `origin` are both inside
 * the body the webhook signature already covers, so a browser cannot dress a checkout up as a
 * renewal. `origin` is a required field on Paddle's transaction notification; anything unreadable
 * (or the checkout value "web") falls to `checkout`, i.e. to the strict side.
 *
 * `api`-origin transactions also read as `recurring`. We never create transactions through the
 * Paddle API, and one cannot be provoked from a browser — it needs our server API key — so the
 * only shapes that reach this branch in practice are Paddle's own subscription_* origins.
 */
export type AttributionOrigin = "checkout" | "recurring";

/** Paddle's transaction `origin` for a transaction created by the browser checkout overlay. */
const CHECKOUT_TRANSACTION_ORIGIN = "web";

/** Subscription lifecycle events that can fire arbitrarily long after the checkout that made them. */
const RECURRING_EVENT_TYPES = new Set(["subscription.updated", "subscription.canceled"]);

export function attributionOrigin(eventType: string, eventData: unknown): AttributionOrigin {
  if (RECURRING_EVENT_TYPES.has(eventType)) {
    return "recurring";
  }
  // subscription.created is deliberately NOT here: Paddle raises it as the checkout completes, so
  // its token is seconds old and enforcement can judge it exactly like the transaction beside it.
  if (eventType !== "transaction.completed") {
    return "checkout";
  }
  const origin = (eventData as { origin?: unknown } | null | undefined)?.origin;
  return typeof origin === "string" && origin !== "" && origin !== CHECKOUT_TRANSACTION_ORIGIN
    ? "recurring"
    : "checkout";
}

export type TenantDecision =
  | { readonly outcome: "accept"; readonly userId: string; readonly signal: string | null }
  | { readonly outcome: "refuse"; readonly reason: string };

/**
 * The whole policy, pure and in one place. `signal` is a reason string the caller logs (one line,
 * one channel — the reason is what an operator counts), or null when there is nothing to say.
 *
 *  - verified              -> accept the SIGNED subject; a body id that disagrees is discarded and
 *                             reported (custom_data was edited after checkout started).
 *  - expired               -> the signature held, so the subject is STILL server-attested: accept
 *                             THAT subject, never the body claim. Refused under enforcement only
 *                             on a `checkout` origin, where a stale token is a fact about the event.
 *  - absent / invalid, ON  -> refuse; the caller must not write state and must not close the event.
 *  - absent / invalid, OFF -> accept the claim and report why it could not be verified. `absent` is
 *                             the expected shape of every overlay opened before this shipped.
 *
 * WHY `expired` IS NOT REFUSED ON A RECURRING EVENT. A renewal charge, a plan change and a
 * cancellation all carry the token minted at the ORIGINAL checkout — nobody opens an overlay to be
 * renewed, so a fresh token is not something the operator can wait for, it is something that can
 * never exist. Refusing them made enforcement structurally unusable: left on past Paddle's ~3-day
 * retry window it would kill renewal grants and cancellations outright. Accepting a stale-but-
 * authentic token there costs nothing enforcement was actually buying, because the HMAC still
 * proves who the subject is; only the replay window lapsed, and a replay window has no meaning for
 * an event no browser initiated.
 *
 * WHAT ENFORCEMENT STILL REFUSES, everywhere including renewals: `absent`, `bad_signature`,
 * `malformed`, `malformed_expiry`, `bad_subject`, `not_a_string`, `no_signing_key` — i.e. every
 * shape in which the subject was never proved. Plus `expired` on a `checkout` origin, so the TTL
 * keeps biting in the one place a fresh token was actually available. A forged first-party checkout
 * is refused exactly as before.
 */
export function decideTenant(
  check: AttributionCheck,
  claimedUserId: string,
  enforced: boolean,
  origin: AttributionOrigin,
): TenantDecision {
  if (check.status === "verified") {
    return {
      outcome: "accept",
      userId: check.userId,
      signal: check.userId === claimedUserId ? null : "custom_data_user_id_mismatch",
    };
  }
  if (check.status === "expired") {
    if (enforced && origin === "checkout") {
      return { outcome: "refuse", reason: "expired" };
    }
    return {
      outcome: "accept",
      userId: check.userId, // the SIGNED subject — stale is not the same as unproved
      signal: check.userId === claimedUserId ? "expired" : "expired_user_id_mismatch",
    };
  }
  const reason = check.status === "absent" ? "absent" : check.reason;
  return enforced
    ? { outcome: "refuse", reason }
    : { outcome: "accept", userId: claimedUserId, signal: reason };
}
