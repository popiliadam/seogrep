// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ATTRIBUTION_CUSTOM_DATA_KEY,
  ATTRIBUTION_TTL_SECONDS,
  attributionEnforced,
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

  it("rejects an EXPIRED token", () => {
    const token = mintAttributionToken(USER_ID, MINTED_AT);
    expect(readAttributionToken(withToken(token), TOO_LATE)).toEqual({
      status: "invalid",
      reason: "expired",
    });
  });

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
  afterEach(() => {
    vi.unstubAllEnvs();
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
});

describe("decideTenant", () => {
  const verified = { status: "verified", userId: USER_ID } as const;

  it("uses the SIGNED subject, not the body claim, and reports the disagreement", () => {
    expect(decideTenant(verified, VICTIM_ID, false)).toEqual({
      outcome: "accept",
      userId: USER_ID,
      signal: "custom_data_user_id_mismatch",
    });
  });

  it("stays silent when the signed subject and the body agree", () => {
    expect(decideTenant(verified, USER_ID, true)).toEqual({
      outcome: "accept",
      userId: USER_ID,
      signal: null,
    });
  });

  it("GRACE (default): absent and invalid are both accepted, and both reported", () => {
    expect(decideTenant({ status: "absent" }, USER_ID, false)).toEqual({
      outcome: "accept",
      userId: USER_ID,
      signal: "absent",
    });
    expect(decideTenant({ status: "invalid", reason: "expired" }, USER_ID, false)).toEqual({
      outcome: "accept",
      userId: USER_ID,
      signal: "expired",
    });
  });

  it("ENFORCED: neither absent nor invalid can name a tenant", () => {
    expect(decideTenant({ status: "absent" }, USER_ID, true)).toEqual({
      outcome: "refuse",
      reason: "absent",
    });
    expect(decideTenant({ status: "invalid", reason: "bad_signature" }, VICTIM_ID, true)).toEqual({
      outcome: "refuse",
      reason: "bad_signature",
    });
  });
});
