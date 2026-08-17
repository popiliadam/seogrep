import { describe, expect, it } from "vitest";
import {
  canQuerySearchAnalytics,
  cosmeticPropertyKey,
  cosmeticPropertyMatch,
  propertyToDomain,
} from "./property.js";

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

  /**
   * FQDN'in sondaki noktası. `property.ts`'in `.replace(/\.+$/, "")`'i HİÇBİR testle pinli
   * değildi: silindiğinde süit yeşil kalıyordu, çünkü hiçbir vaka sonda nokta taşımıyordu.
   * Google `sc-domain:` değerini kök nokta ile de verebilir ve nokta kalırsa DOMAIN_RE
   * eşleşmez → property null'a düşer, yani "tanımadım" cevabı tanıdığı bir stringe verilir.
   * MUTASYON KOŞULDU: replace silindi → bu spec kırmızı.
   */
  it("FQDN'in sondaki noktasını atar", () => {
    expect(propertyToDomain("sc-domain:balerin.com.")).toBe("balerin.com");
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

/**
 * KOZMETİK EŞ — apps/mcp'nin `track_gsc_property` tool'undan 2026-08-15'te core'a taşındı ve
 * apps/web'in üç NOT_LISTED reddi de artık aynı kuraldan geçiyor. Kural KASTEN APTAL: yalnız
 * SİTEYİ DEĞİŞTİREMEYECEK farklar sayılır (harf büyüklüğü + URL-prefix'te sondaki slash).
 * Öneri tek kopyala-yapıştırla projenin BAĞLANDIĞI property olur ve yanlış bağlanma ancak veri
 * anlamsızlaşınca fark edilir — makul-ama-yanlış öneri, önerisizlikten KÖTÜDÜR.
 */
describe("cosmeticPropertyKey", () => {
  it("harf büyüklüğünü ve URL sonundaki slash'i yok sayar", () => {
    expect(cosmeticPropertyKey("HTTPS://Katrenur.COM/")).toBe("https://katrenur.com");
    expect(cosmeticPropertyKey("  sc-domain:KATRENUR.com  ")).toBe("sc-domain:katrenur.com");
  });

  /**
   * KURALIN TAŞIYICI YARISI: `sc-domain:` öneki ve URL şeması anahtarda KALIR. Bu iki form aynı
   * sitenin İKİ AYRI property'sidir (ayrı veri, ayrı izin), ve onları ayrı tutan tek şey budur.
   * MUTASYON KOŞULDU: anahtar `sc-domain:` + `https://` öneklerini soyacak şekilde değiştirildi
   * → bu spec ve aşağıdaki çapraz-öneri spec'i kırmızıya döndü.
   */
  it("sc-domain: ile https:// formlarını AYNI anahtara indirmez", () => {
    expect(cosmeticPropertyKey("sc-domain:katrenur.com")).not.toBe(
      cosmeticPropertyKey("https://katrenur.com/"),
    );
  });
});

describe("cosmeticPropertyMatch", () => {
  const LISTED_URL = "https://katrenur.com/";
  const LISTED_DOMAIN = "sc-domain:katrenur.com";

  it("yalnız sondaki slash farklıysa listedekini önerir", () => {
    expect(cosmeticPropertyMatch("https://katrenur.com", [LISTED_URL])).toBe(LISTED_URL);
  });

  it("yalnız harf büyüklüğü farklıysa listedekini önerir", () => {
    expect(cosmeticPropertyMatch("SC-DOMAIN:Katrenur.COM", [LISTED_DOMAIN])).toBe(LISTED_DOMAIN);
  });

  // NEGATİF 1 — çapraz. Aynı sitenin iki AYRI property'si; asla birbirine önerilmez.
  it("domain property'si için URL-prefix property'si (ve tersi) ÖNERMEZ", () => {
    expect(cosmeticPropertyMatch(LISTED_URL, [LISTED_DOMAIN])).toBeNull();
    expect(cosmeticPropertyMatch(LISTED_DOMAIN, [LISTED_URL])).toBeNull();
  });

  // NEGATİF 2 — alakasız. Kaç tane listelenmiş olursa olsun, benzerlik ölçülmez.
  it("alakasız property için hiçbir şey önermez — listede kaç tane olursa olsun", () => {
    expect(
      cosmeticPropertyMatch("sc-domain:zephyrbrook.com", [
        LISTED_URL,
        LISTED_DOMAIN,
        "sc-domain:katrenur.com.tr",
        "https://katrenur.co/",
      ]),
    ).toBeNull();
  });

  // NEGATİF 3 — kenar-mesafesi YOK. Tek harf/karakter farkı kozmetik değildir.
  it("tek karakterlik yazım hatasını kozmetik saymaz", () => {
    expect(cosmeticPropertyMatch("sc-domain:katrenu.com", [LISTED_DOMAIN])).toBeNull();
    expect(cosmeticPropertyMatch("https://www.katrenur.com/", [LISTED_URL])).toBeNull();
  });

  it("property'nin KENDİSİNİ önermez ve boş liste null verir", () => {
    expect(cosmeticPropertyMatch(LISTED_DOMAIN, [LISTED_DOMAIN])).toBeNull();
    expect(cosmeticPropertyMatch(LISTED_DOMAIN, [])).toBeNull();
    expect(cosmeticPropertyMatch("", [])).toBeNull();
  });

  /**
   * Beraberlik SIRALAMAYLA bozulur, listenin geliş sırasıyla değil — aynı çağrı iki koşuda
   * aynı cümleyi versin diye. Girdi sırası tersine çevrildiğinde cevap DEĞİŞMEZ.
   * MUTASYON KOŞULDU: `[...near].sort(compareStrings)[0]` → `near[0]` → bu spec kırmızı.
   */
  it("eşit derecede iyi iki adayı SIRALAMAYLA ayırır, geliş sırasıyla değil", () => {
    const tied = ["https://katrenur.com/", "HTTPS://KATRENUR.COM"];
    expect(cosmeticPropertyMatch("https://Katrenur.com", tied)).toBe("HTTPS://KATRENUR.COM");
    expect(cosmeticPropertyMatch("https://Katrenur.com", [...tied].reverse())).toBe(
      "HTTPS://KATRENUR.COM",
    );
  });
});
