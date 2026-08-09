// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildConsentUrl, gscPropertyCandidates, matchGscProperty } from "./oauth";

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
        codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
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
    // L-10: PKCE is committed to here. Only the digest travels; `codeChallenge` is a required
    // parameter, so a caller cannot quietly drop the protection by forgetting a field.
    expect(p.get("code_challenge")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(p.get("code_challenge_method")).toBe("S256");
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

  /**
   * The measured failure (live 2026-08-09): connect_gsc reported "property null" for the
   * project www.noraninsaat.com while the account held sc-domain:noraninsaat.com. The old
   * candidate list never stripped the leading www., so a www. project on an account whose
   * only property is a domain property could not match at all — a class failure, since a
   * domain property is apex-scoped and carries no www.
   */
  it("matches a www. project against the account's apex domain property", () => {
    expect(
      matchGscProperty("www.noraninsaat.com", [
        { siteUrl: "sc-domain:noraninsaat.com", permissionLevel: "siteOwner" },
      ]),
    ).toBe("sc-domain:noraninsaat.com");
  });

  /**
   * The other live www. project. It matched BEFORE this change only because a url-prefix
   * property carrying www happened to exist — luck, decided by which property type the
   * customer created. It must keep matching.
   */
  it("still matches a www. project against its www url-prefix property", () => {
    expect(
      matchGscProperty("www.bigcattr.com", [
        { siteUrl: "https://www.bigcattr.com/", permissionLevel: "siteOwner" },
      ]),
    ).toBe("https://www.bigcattr.com/");
  });

  /**
   * Regression over the five apex projects measured live 2026-08-09 — three on domain
   * properties, two on url-prefix properties. None of them may change behaviour.
   */
  it.each([
    ["bayder.com.tr", "sc-domain:bayder.com.tr"],
    ["rkturizm.com", "sc-domain:rkturizm.com"],
    ["katrenur.com", "sc-domain:katrenur.com"],
    ["adstark.com.tr", "https://adstark.com.tr/"],
    ["dentnotion.com", "https://dentnotion.com/"],
  ])("keeps matching the apex project %s to %s", (domain, siteUrl) => {
    expect(matchGscProperty(domain, [{ siteUrl, permissionLevel: "siteOwner" }])).toBe(siteUrl);
  });

  /**
   * THE SECURITY PIN. Google's end really does treat sc-domain:example.com as covering
   * blog.example.com — we refuse it anyway. A property list cannot tell us whether whoever
   * verified the apex meant to hand this tenant the subdomain's data, and subdomains can
   * belong to different parties. Matching here would pull someone else's Search Console
   * data into this account. Only a literal leading `www.` is ever stripped.
   */
  it.each(["blog.example.com", "shop.example.com", "customer.example.com"])(
    "refuses to bind the subdomain project %s to the parent's domain property",
    (domain) => {
      expect(matchGscProperty(domain, [domainProp])).toBeNull();
      expect(gscPropertyCandidates(domain)).not.toContain("sc-domain:example.com");
    },
  );

  it("does not reduce a subdomain even when its own property is absent and the apex is verified", () => {
    expect(matchGscProperty("blog.example.com", [domainProp, httpsProp, wwwProp])).toBeNull();
  });

  /**
   * Preference order when the account holds BOTH shapes: the domain property wins, because
   * it covers every subdomain and both schemes while a url-prefix property covers exactly
   * one scheme+host. Holds whether the project was stored apex or www.
   */
  it.each(["example.com", "www.example.com"])(
    "prefers the domain property over the www url-prefix property for %s",
    (domain) => {
      expect(matchGscProperty(domain, [wwwProp, domainProp])).toBe("sc-domain:example.com");
    },
  );
});

describe("gscPropertyCandidates", () => {
  /**
   * The apex list is the one this file has always produced — same strings, same order.
   * Pinned literally so a future "normalisation" cannot reorder it unnoticed.
   */
  it("produces the historical five candidates for an apex domain", () => {
    expect(gscPropertyCandidates("example.com")).toEqual([
      "sc-domain:example.com",
      "https://example.com/",
      "https://www.example.com/",
      "http://example.com/",
      "http://www.example.com/",
    ]);
  });

  it("produces apex and www candidates for a www domain, apex domain property first", () => {
    expect(gscPropertyCandidates("www.example.com")).toEqual([
      "sc-domain:example.com",
      "sc-domain:www.example.com",
      "https://www.example.com/",
      "https://example.com/",
      "http://www.example.com/",
      "http://example.com/",
    ]);
  });

  // `www.` is dropped or added, never both, so the www.www. candidates the old list built
  // for a www. input cannot be constructed. (An input that already reads www.www.foo is
  // echoed as stored — matching stays exact, so echoing costs nothing.)
  it.each(["example.com", "www.example.com", "blog.example.com", "www.noraninsaat.com"])(
    "never builds a www.www. candidate for %s",
    (domain) => {
      for (const candidate of gscPropertyCandidates(domain)) {
        expect(candidate).not.toContain("www.www.");
      }
    },
  );

  it.each(["example.com", "www.example.com"])("emits no duplicate candidate for %s", (domain) => {
    const candidates = gscPropertyCandidates(domain);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("returns nothing for an empty or www-only domain instead of a bare scheme", () => {
    expect(gscPropertyCandidates("")).toEqual([]);
    expect(gscPropertyCandidates("   ")).toEqual([]);
    expect(gscPropertyCandidates("www.")).toEqual([]);
    expect(
      matchGscProperty("www.", [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }]),
    ).toBeNull();
  });
});
