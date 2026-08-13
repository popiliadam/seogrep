import { describe, expect, it } from "vitest";
import { canQuerySearchAnalytics, propertyToDomain } from "./property.js";

describe("propertyToDomain", () => {
  it("sc-domain: önekini soyar", () => {
    expect(propertyToDomain("sc-domain:balerin.com")).toBe("balerin.com");
  });

  it("url-prefix property'sinin HOST'unu döndürür — www KORUNUR", () => {
    // Mevcut projeler zaten `www.bigcattr.com` diye kayıtlı (canlıda ölçüldü 2026-08-13).
    // www'yi soymak, var olan projeyle eşleşmeyen İKİNCİ bir proje yaratırdı.
    expect(propertyToDomain("https://www.bigcattr.com/")).toBe("www.bigcattr.com");
    expect(propertyToDomain("http://foo.com/")).toBe("foo.com");
  });

  it("büyük harfi küçültür", () => {
    expect(propertyToDomain("sc-domain:BALERIN.com")).toBe("balerin.com");
  });

  it("tanınmayan biçimi YARIM OKUMAZ, reddeder", () => {
    expect(propertyToDomain("")).toBeNull();
    expect(propertyToDomain("sc-domain:")).toBeNull();
    expect(propertyToDomain("ftp://foo.com/")).toBeNull();
    expect(propertyToDomain("just-a-string")).toBeNull();
    expect(propertyToDomain("sc-domain:localhost")).toBeNull(); // tek etiket
  });
});

describe("canQuerySearchAnalytics", () => {
  // Bu pinler apps/web/lib/gsc/oauth.test.ts'ten TAŞINDI, DEĞİŞTİRİLMEDİ.
  it("Google'ın dokümanladığı üç seviyeyi kabul eder", () => {
    expect(canQuerySearchAnalytics("siteOwner")).toBe(true);
    expect(canQuerySearchAnalytics("siteFullUser")).toBe(true);
    expect(canQuerySearchAnalytics("siteRestrictedUser")).toBe(true);
  });

  it("siteUnverifiedUser ve bilinmeyeni fail-closed reddeder", () => {
    expect(canQuerySearchAnalytics("siteUnverifiedUser")).toBe(false);
    expect(canQuerySearchAnalytics("SITEOWNER")).toBe(false);
    expect(canQuerySearchAnalytics("")).toBe(false);
  });
});
