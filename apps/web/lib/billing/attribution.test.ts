// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ATTRIBUTION_CUSTOM_DATA_KEY,
  ATTRIBUTION_TTL_SECONDS,
  attributionEnforced,
  attributionOrigin,
  attributionReferenceTime,
  decideTenant,
  mintAttributionToken,
  readAttributionToken,
} from "./attribution";

/** Fake, unmistakably-not-real secrets. NEVER a real key value in a fixture. */
const SECRET = "test_secret_pdl_ntfset_deadbeef";
const OTHER_SECRET = "test_secret_pdl_ntfset_00000000";
const USER_ID = "3f1a2b4c-5d6e-4f70-8a90-1b2c3d4e5f60";
const VICTIM_ID = "9c8b7a6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";

const MINTED_AT = new Date("2026-08-03T12:00:00Z");
const SOON = new Date("2026-08-03T12:30:00Z"); // inside the window
const TOO_LATE = new Date(MINTED_AT.getTime() + (ATTRIBUTION_TTL_SECONDS + 1) * 1000);

/** An unmarshalled event's `data`, carrying whatever customData the browser sent. */
const eventData = (customData: unknown): unknown => ({ id: "txn_1", customData });
const withToken = (token: unknown, userId = USER_ID): unknown =>
  eventData({ user_id: userId, [ATTRIBUTION_CUSTOM_DATA_KEY]: token });

describe("checkout attribution token (M-05)", () => {
  beforeEach(() => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips: a minted token verifies back to the id it was signed for", () => {
    const token = mintAttributionToken(USER_ID, MINTED_AT);
    expect(token).toMatch(/^v1\./);
    expect(readAttributionToken(withToken(token), SOON)).toEqual({
      status: "verified",
      userId: USER_ID,
    });
  });

  it("is signed with a DERIVED key, never the webhook secret itself", () => {
    // Domain separation is the point: the raw secret must not be the thing signing tokens.
    const token = mintAttributionToken(USER_ID, MINTED_AT) ?? "";
    const [version, subject, expires, signature] = token.split(".");
    const rawSecretSignature = createHmac("sha256", SECRET)
      .update(`${version}.${subject}.${expires}`)
      .digest("base64url");
    expect(signature).not.toBe(rawSecretSignature);
  });

  it("mints nothing when the source secret is absent (checkout still opens, grace accepts)", () => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    expect(mintAttributionToken(USER_ID, MINTED_AT)).toBeNull();
  });

  it("mints nothing for an id that is not a uuid", () => {
    expect(mintAttributionToken("not-a-uuid", MINTED_AT)).toBeNull();
  });

  it("reports ABSENT when customData carries no token at all (the pre-deploy overlay)", () => {
    for (const data of [eventData({ user_id: USER_ID }), eventData(null), undefined]) {
      expect(readAttributionToken(data, SOON)).toEqual({ status: "absent" });
    }
  });

  it("rejects a token whose SUBJECT was swapped for another tenant (the M-05 attack)", () => {
    const token = mintAttributionToken(USER_ID, MINTED_AT) ?? "";
    const [version, , expires, signature] = token.split(".");
    const forged = `${version}.${VICTIM_ID}.${expires}.${signature}`;
    expect(readAttributionToken(withToken(forged, VICTIM_ID), SOON)).toEqual({
      status: "invalid",
      reason: "bad_signature",
    });
  });

  it("rejects a token signed with the WRONG key", () => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", OTHER_SECRET);
    const foreign = mintAttributionToken(USER_ID, MINTED_AT);
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    expect(readAttributionToken(withToken(foreign), SOON)).toMatchObject({
      status: "invalid",
      reason: "bad_signature",
    });
  });

  it("reports an EXPIRED token as expired — never verified — but keeps the SIGNED subject", () => {
    // The signature still held, so the subject is server-attested; only freshness lapsed. Callers
    // need that distinction: a renewal can only ever carry a stale token (see decideTenant).
    const token = mintAttributionToken(USER_ID, MINTED_AT);
    expect(readAttributionToken(withToken(token), TOO_LATE)).toEqual({
      status: "expired",
      userId: USER_ID,
    });
  });

  // NOT pinned here, deliberately: "a well-signed token whose subject is not a uuid reads as
  // bad_subject, not expired". Building one needs the module's unexported HKDF salt/info copied
  // into this file, and a copy would go stale into a FALSE red (bad_signature) the day either
  // constant changes. The case is unreachable anyway — mintAttributionToken refuses a non-uuid
  // subject, and nothing else can produce a signature. The ordering that guarantees it is a
  // comment at the check itself in attribution.ts.

  it("rejects junk shapes without ever reading them as verified", () => {
    for (const junk of ["", "abc", "v1.a.b", "v2.a.b.c", `v1.${USER_ID}.x.y`]) {
      const check = readAttributionToken(withToken(junk), SOON);
      expect(check.status).not.toBe("verified");
    }
    expect(readAttributionToken(withToken(42), SOON)).toEqual({
      status: "invalid",
      reason: "not_a_string",
    });
  });

  it("never verifies without a key, even for a well-formed token", () => {
    const token = mintAttributionToken(USER_ID, MINTED_AT);
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    expect(readAttributionToken(withToken(token), SOON)).toEqual({
      status: "invalid",
      reason: "no_signing_key",
    });
  });

  it("measures expiry against the EVENT's occurred_at, so a Paddle RETRY still verifies", () => {
    // Paddle retries for ~3 days; delivery time must not consume the window.
    const threeDaysLater = new Date(MINTED_AT.getTime() + 3 * 24 * 60 * 60 * 1000);
    const at = attributionReferenceTime(MINTED_AT.toISOString(), threeDaysLater);
    expect(at.toISOString()).toBe(MINTED_AT.toISOString());
    const token = mintAttributionToken(USER_ID, MINTED_AT);
    expect(readAttributionToken(withToken(token), at)).toMatchObject({ status: "verified" });
  });

  it("falls back to now when occurred_at is missing or unparseable", () => {
    const now = new Date("2026-08-03T13:00:00Z");
    expect(attributionReferenceTime(null, now)).toBe(now);
    expect(attributionReferenceTime("not-a-date", now)).toBe(now);
  });
});

describe("PADDLE_ATTRIBUTION_ENFORCE", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => {
    vi.unstubAllEnvs();
    warnSpy.mockClear();
  });

  it("is OFF unless explicitly set to 1/true — everything else means grace", () => {
    for (const value of [undefined, "", " ", "0", "false", "off", "yes-please"]) {
      vi.stubEnv("PADDLE_ATTRIBUTION_ENFORCE", value);
      expect(attributionEnforced()).toBe(false);
    }
    for (const value of ["1", "true", "TRUE", " true "]) {
      vi.stubEnv("PADDLE_ATTRIBUTION_ENFORCE", value);
      expect(attributionEnforced()).toBe(true);
    }
  });

  it("SAYS SO when the value is unrecognised (a typo used to be silent grace)", () => {
    for (const value of ["yes", "on", "enforce", "0.5"]) {
      warnSpy.mockClear();
      vi.stubEnv("PADDLE_ATTRIBUTION_ENFORCE", value);
      expect(attributionEnforced()).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("PADDLE_ATTRIBUTION_ENFORCE");
    }
  });

  it("never echoes the value itself into the log (env does not reach stdout here)", () => {
    const marker = "ENFORCE_VALUE_MUST_NOT_BE_LOGGED";
    vi.stubEnv("PADDLE_ATTRIBUTION_ENFORCE", marker);
    expect(attributionEnforced()).toBe(false);
    const logged = warnSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(marker.toLowerCase());
  });

  it("stays QUIET for every value that is a deliberate setting (on, off or unset)", () => {
    for (const value of [undefined, "", " ", "0", "false", "1", "true", "TRUE", " true "]) {
      vi.stubEnv("PADDLE_ATTRIBUTION_ENFORCE", value);
      attributionEnforced();
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("attributionOrigin", () => {
  it("a browser checkout transaction is `checkout` — the strict side", () => {
    expect(attributionOrigin("transaction.completed", { origin: "web" })).toBe("checkout");
  });

  it("every Paddle-raised transaction origin is `recurring`", () => {
    for (const origin of [
      "subscription_recurring",
      "subscription_charge",
      "subscription_update",
      "subscription_payment_method_change",
      "api",
    ]) {
      expect(attributionOrigin("transaction.completed", { origin })).toBe("recurring");
    }
  });

  it("an unreadable or missing origin falls to `checkout`, never to grace", () => {
    for (const data of [{}, { origin: "" }, { origin: 42 }, null, undefined]) {
      expect(attributionOrigin("transaction.completed", data)).toBe("checkout");
    }
  });

  it("subscription.updated / .canceled are `recurring`; .created is not", () => {
    expect(attributionOrigin("subscription.updated", {})).toBe("recurring");
    expect(attributionOrigin("subscription.canceled", {})).toBe("recurring");
    // Paddle raises `created` as the checkout completes, so its token is seconds old.
    expect(attributionOrigin("subscription.created", {})).toBe("checkout");
  });

  it("an unknown event type falls to `checkout` (fail toward the judgeable side)", () => {
    expect(attributionOrigin("customer.updated", { origin: "subscription_recurring" })).toBe(
      "checkout",
    );
  });
});

describe("decideTenant", () => {
  const verified = { status: "verified", userId: USER_ID } as const;
  const expired = { status: "expired", userId: USER_ID } as const;

  it("uses the SIGNED subject, not the body claim, and reports the disagreement", () => {
    expect(decideTenant(verified, VICTIM_ID, false, "checkout")).toEqual({
      outcome: "accept",
      userId: USER_ID,
      signal: "custom_data_user_id_mismatch",
    });
  });

  it("stays silent when the signed subject and the body agree", () => {
    expect(decideTenant(verified, USER_ID, true, "checkout")).toEqual({
      outcome: "accept",
      userId: USER_ID,
      signal: null,
    });
  });

  it("GRACE (default): absent and invalid are both accepted, and both reported", () => {
    expect(decideTenant({ status: "absent" }, USER_ID, false, "checkout")).toEqual({
      outcome: "accept",
      userId: USER_ID,
      signal: "absent",
    });
    expect(decideTenant(expired, USER_ID, false, "checkout")).toEqual({
      outcome: "accept",
      userId: USER_ID,
      signal: "expired",
    });
  });

  it("ENFORCED: neither absent nor invalid can name a tenant", () => {
    for (const origin of ["checkout", "recurring"] as const) {
      expect(decideTenant({ status: "absent" }, USER_ID, true, origin)).toEqual({
        outcome: "refuse",
        reason: "absent",
      });
      expect(
        decideTenant({ status: "invalid", reason: "bad_signature" }, VICTIM_ID, true, origin),
      ).toEqual({ outcome: "refuse", reason: "bad_signature" });
    }
  });

  it("ENFORCED: an expired token on a CHECKOUT is refused — the TTL still bites where it can", () => {
    expect(decideTenant(expired, USER_ID, true, "checkout")).toEqual({
      outcome: "refuse",
      reason: "expired",
    });
  });

  it("ENFORCED: an expired token on a RECURRING event is graced, not refused", () => {
    // A renewal / plan change / cancellation carries the token minted at the ORIGINAL checkout.
    // A fresh one there is not something an operator can wait for — it can never exist. Without
    // this, enforcement kills every renewal grant and every cancellation the moment Paddle's
    // ~3-day retry window closes, which is what made the flag unusable as a steady state.
    expect(decideTenant(expired, USER_ID, true, "recurring")).toEqual({
      outcome: "accept",
      userId: USER_ID,
      signal: "expired",
    });
  });

  it("an expired token still names the SIGNED subject, never the body claim", () => {
    // Stale is not the same as unproved: the HMAC covered the subject, so it is still authority.
    // If this ever returned the claim, a renewal would be attributable by editing custom_data.
    for (const [enforced, origin] of [
      [false, "checkout"],
      [true, "recurring"],
    ] as const) {
      expect(decideTenant(expired, VICTIM_ID, enforced, origin)).toEqual({
        outcome: "accept",
        userId: USER_ID,
        signal: "expired_user_id_mismatch",
      });
    }
  });
});
