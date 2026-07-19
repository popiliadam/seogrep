// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildConsentUrl, matchGscProperty } from "./oauth";

/**
 * Pure OAuth-URL construction and the domain -> Search Console property matcher. No
 * network, no secrets: the consent URL carries only the public client_id + redirect +
 * state, and property matching is string logic over the account's verified sites.
 */

describe("buildConsentUrl", () => {
  it("builds the Google consent URL with read-only scope, offline access, and forced consent", () => {
    const url = new URL(
      buildConsentUrl({
        clientId: "cid.apps.googleusercontent.com",
        redirectUri: "https://app.example.com/api/gsc/callback",
        state: "signed-state-token",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("cid.apps.googleusercontent.com");
    expect(p.get("redirect_uri")).toBe("https://app.example.com/api/gsc/callback");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    expect(p.get("access_type")).toBe("offline"); // needed to receive a refresh token
    expect(p.get("prompt")).toBe("consent"); // force refresh-token issue even on re-consent
    expect(p.get("state")).toBe("signed-state-token");
  });
});

describe("matchGscProperty", () => {
  const domainProp = { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" };
  const httpsProp = { siteUrl: "https://example.com/", permissionLevel: "siteOwner" };
  const wwwProp = { siteUrl: "https://www.example.com/", permissionLevel: "siteOwner" };

  it("prefers the sc-domain property when present", () => {
    expect(matchGscProperty("example.com", [wwwProp, domainProp, httpsProp])).toBe(
      "sc-domain:example.com",
    );
  });

  it("falls back to the https url-prefix property", () => {
    expect(matchGscProperty("example.com", [httpsProp])).toBe("https://example.com/");
  });

  it("matches the www url-prefix variant", () => {
    expect(matchGscProperty("example.com", [wwwProp])).toBe("https://www.example.com/");
  });

  it("returns null when the account has no property for the domain", () => {
    expect(
      matchGscProperty("example.com", [
        { siteUrl: "sc-domain:other.com", permissionLevel: "siteOwner" },
      ]),
    ).toBeNull();
  });

  it("returns null for an empty site list", () => {
    expect(matchGscProperty("example.com", [])).toBeNull();
  });

  it("is case-insensitive on the property host", () => {
    expect(
      matchGscProperty("example.com", [
        { siteUrl: "https://WWW.Example.com/", permissionLevel: "siteOwner" },
      ]),
    ).toBe("https://WWW.Example.com/");
  });
});
