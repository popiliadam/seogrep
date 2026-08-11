import { describe, expect, it } from "vitest";
import {
  GscReauthRequiredError,
  isGscReauthRequired,
  isInvalidGrant,
  renderReconnectInstruction,
} from "./reauth-error.ts";

/**
 * The classifier is the whole safety of this feature: it decides between "reconnect your Google
 * account" (an OAuth round the user has to redo) and "try again in a minute". Getting it wrong in
 * the permissive direction also WRITES token_status='invalid' on a live account, so the negative
 * cases below are not padding — each one is a message shape a real transient failure produces.
 */

describe("isInvalidGrant", () => {
  it("recognises the message @pseo/core's tokenError builds for a dead grant", () => {
    expect(isInvalidGrant(new Error("Google token endpoint failed (400): invalid_grant"))).toBe(true);
  });

  it("does NOT match a 5xx from the same endpoint", () => {
    expect(isInvalidGrant(new Error("Google token endpoint failed (503): unknown_error"))).toBe(false);
  });

  it("does NOT match a network/timeout error that merely mentions the phrase", () => {
    // A bare substring test would answer true here and mark a live account invalid.
    expect(
      isInvalidGrant(new Error("fetch failed while checking for invalid_grant conditions")),
    ).toBe(false);
  });

  it("does NOT match a non-Error value", () => {
    expect(isInvalidGrant("Google token endpoint failed (400): invalid_grant")).toBe(false);
  });
});

describe("GscReauthRequiredError", () => {
  it("accepts a null link — the instruction survives a deployment with no WEB_BASE_URL", () => {
    const error = new GscReauthRequiredError("a@x.com", null);
    expect(error.reconnectUrl).toBeNull();
    // The message is the account's, not the link's: it never depended on the URL.
    expect(error.message).toBe("Google Search Console connection for a@x.com expired");
  });

  it("carries the account email and the reconnect link the registry renders", () => {
    const error = new GscReauthRequiredError("a@x.com", "https://web.test/api/gsc/connect?project_id=p1");
    expect(error.accountEmail).toBe("a@x.com");
    expect(error.reconnectUrl).toBe("https://web.test/api/gsc/connect?project_id=p1");
    expect(error.name).toBe("GscReauthRequiredError");
    expect(error.message).toBe("Google Search Console connection for a@x.com expired");
  });

  it("is narrowed by isGscReauthRequired, and a plain Error with the same words is NOT", () => {
    expect(isGscReauthRequired(new GscReauthRequiredError("a@x.com", "https://web.test/c"))).toBe(true);
    expect(
      isGscReauthRequired(new Error("Google Search Console connection for a@x.com expired")),
    ).toBe(false);
  });
});

/**
 * The fallback exists so a missing WEB_BASE_URL costs the user the LINK and never the
 * INSTRUCTION. "Connection" is the real page (/app/connection — the nav label in
 * apps/web/app/app/layout.tsx and the page's own h1), not a plausible-sounding invention.
 */
describe("renderReconnectInstruction", () => {
  it("prints the link when there is one", () => {
    expect(renderReconnectInstruction("https://web.test/api/gsc/connect?project_id=p1")).toBe(
      "Reconnect: https://web.test/api/gsc/connect?project_id=p1",
    );
  });

  it("names the page when there is none — and never renders a null or undefined link", () => {
    const text = renderReconnectInstruction(null);
    expect(text).toBe("Reconnect it from the Connection page in your SeoGrep dashboard.");
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });
});
