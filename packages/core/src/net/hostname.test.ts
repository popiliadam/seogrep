import { describe, expect, it } from "vitest";
import {
  DOMAIN_RE,
  nonPublicHostnameReason,
  normalizeDomain,
  sameSiteDomains,
  stripWwwLabel,
} from "./hostname.js";

/**
 * CORE'UN KENDİ ŞERİDİ. Bu modülün pinleri bugüne kadar YALNIZ downstream'de yaşıyordu —
 * `apps/mcp`'nin re-export süitleri (`crawler/ssrf`, `tools/setup-project`). Orası doğru yer
 * değil: bir güvenlik listesi, onu ihraç eden paketin kendi test script'inde ölçülür, yoksa
 * downstream süit taşındığı/yeniden yazıldığı gün `packages/core`'un lane'i rezerve TLD listesi
 * hakkında HİÇBİR ŞEY söylemez ve kimse fark etmez (imzalı ders 15).
 *
 * Buradaki iddialar downstream'dekilerin KOPYASI DEĞİL: her biri modülün kendi sözleşmesini
 * (liste üyeliği · tek etiket · home.arpa · shape ↔ public ayrımı) doğrudan ifade eder.
 */

describe("nonPublicHostnameReason", () => {
  it("rezerve pseudo-TLD'lerin HEPSİNİ adıyla reddeder", () => {
    // Listenin tamamı tek tek: tek bir üye düşerse (ya da eklenirse) burası kırmızıya döner.
    // Tek bir örnek pinlemek listeyi değil, o örneği korur.
    for (const tld of [
      "localhost",
      "local",
      "internal",
      "test",
      "invalid",
      "example",
      "onion",
      "lan",
      "home",
      "corp",
      "intranet",
      "private",
    ]) {
      expect(nonPublicHostnameReason(`host.${tld}`)).toBe(`non-public TLD ".${tld}"`);
    }
  });

  it("gerçek public bir ad için null döner", () => {
    // Pozitif taraf: her şeye "non-public" diyen bir fonksiyon da yukarıdaki döngüyü geçerdi.
    expect(nonPublicHostnameReason("balerin.com")).toBeNull();
    expect(nonPublicHostnameReason("metadata.google.com")).toBeNull();
  });

  it("tek etiketli adı reddeder", () => {
    expect(nonPublicHostnameReason("intranet-box")).toBe("single-label (non-public) hostname");
  });

  it("home.arpa'yı ve alt adlarını reddeder — son etiketi `arpa`, listede DEĞİL", () => {
    expect(nonPublicHostnameReason("home.arpa")).toBe("reserved home.arpa name");
    expect(nonPublicHostnameReason("printer.home.arpa")).toBe("reserved home.arpa name");
    // `arpa`'nın kendisi liste üyesi değil: kural home.arpa'ya özgü, `in-addr.arpa` değil.
    expect(nonPublicHostnameReason("1.2.3.4.in-addr.arpa")).toBeNull();
  });

  it("büyük harf ve sondaki noktayı normalize ETTİKTEN sonra karar verir", () => {
    // Kaçırılırsa gate büyük harfle ya da FQDN noktasıyla atlanabilir hâle gelir.
    expect(nonPublicHostnameReason("Host.INTERNAL")).toBe('non-public TLD ".internal"');
    expect(nonPublicHostnameReason("host.internal.")).toBe('non-public TLD ".internal"');
  });
});

describe("DOMAIN_RE", () => {
  // Bu regex artık `../gsc/property.ts` tarafından da İTHAL EDİLİYOR (kopya silindi), yani
  // burada olup bitene iki fonksiyon birden bağlı: normalizeDomain ve propertyToDomain.
  it("iki+ etiketli, geçerli karakterli, 2-63 harflik TLD'li adı kabul eder", () => {
    expect(DOMAIN_RE.test("balerin.com")).toBe(true);
    expect(DOMAIN_RE.test("www.a-b.co.uk")).toBe(true);
  });

  it("tek etiketi, sondaki noktayı, boş etiketi ve rakamlı TLD'yi reddeder", () => {
    expect(DOMAIN_RE.test("localhost")).toBe(false);
    expect(DOMAIN_RE.test("balerin.com.")).toBe(false);
    expect(DOMAIN_RE.test("balerin..com")).toBe(false);
    expect(DOMAIN_RE.test("balerin.c0m")).toBe(false);
    expect(DOMAIN_RE.test("-lead.com")).toBe(false);
  });

  it("253 karakter sınırını uygular", () => {
    const label = "a".repeat(63);
    expect(DOMAIN_RE.test(`${label}.${label}.${label}.${label}.com`)).toBe(false);
  });
});

describe("normalizeDomain", () => {
  it("URL'den host çıkarır; scheme, port, path ve query düşer", () => {
    expect(normalizeDomain("https://Balerin.com:8443/a/b?q=1#x")).toEqual({
      ok: true,
      domain: "balerin.com",
    });
  });

  it("çıplak host'u da kabul eder ve FQDN noktasını atar", () => {
    expect(normalizeDomain("  balerin.com.  ")).toEqual({ ok: true, domain: "balerin.com" });
  });

  it("ŞEKLİ geçen ama PUBLIC OLMAYAN adı ayrı bir cümleyle reddeder", () => {
    // İki kapının ayrı olduğunun kanıtı: `foo.internal` DOMAIN_RE'yi GEÇER (aşağıda ölçülü),
    // dolayısıyla onu durduran tek şey nonPublicHostnameReason çağrısıdır. Bu çağrı silinirse
    // burası kırmızıya döner — shape testleri dönmez.
    expect(DOMAIN_RE.test("foo.internal")).toBe(true);
    const out = normalizeDomain("https://foo.internal/");
    expect(out).toEqual({
      ok: false,
      error: expect.stringContaining("not a public domain") as unknown as string,
    });
  });

  /**
   * S4 — canlı hesapta 6 kez ölçüldü: `www.` düşmediği için aynı müşteri sitesi İKİ proje oldu.
   * `setup_project`'in kendi açıklaması "aynı domain için tekrar çağırmak mevcut projeyi
   * döndürür" diyordu; adres çubuğundan yapıştırılan biçim için bu İDDİA YANLIŞTI.
   */
  it("baştaki `www.` etiketini düşürür — dört giriş biçimi TEK domaine iner", () => {
    for (const raw of [
      "example.com",
      "www.example.com",
      "https://www.example.com/x?y=1",
      "EXAMPLE.COM",
    ]) {
      expect(normalizeDomain(raw)).toEqual({ ok: true, domain: "example.com" });
    }
  });

  it("`www.` DIŞINDAKİ ilk etiketi ASLA düşürmez — alt alan adı başka bir sitedir", () => {
    // Tuzak burada: kural "ilk etiketi at" DEĞİL, "baştaki www.'yi at".
    expect(normalizeDomain("blog.example.com")).toEqual({ ok: true, domain: "blog.example.com" });
    expect(normalizeDomain("https://shop.example.com/")).toEqual({
      ok: true,
      domain: "shop.example.com",
    });
  });
});

describe("stripWwwLabel", () => {
  it("yalnız BAŞTAKİ www. etiketini, yalnız BİR kez atar", () => {
    expect(stripWwwLabel("www.example.com")).toBe("example.com");
    // Orta yerdeki `www` bir etiket olarak kalır: api.www.x.com farklı bir hosttur.
    expect(stripWwwLabel("api.www.example.com")).toBe("api.www.example.com");
    // Döngü DEĞİL: iki www. üst üste geldiğinde bir tanesi kalır.
    expect(stripWwwLabel("www.www.example.com")).toBe("www.example.com");
  });

  it("büyük harfi ve sondaki noktayı da normalize eder", () => {
    expect(stripWwwLabel("WWW.Example.COM.")).toBe("example.com");
  });

  it("`www.com`u BOZMAZ — kayıtlı bir alan adıdır, `com`a indirilemez", () => {
    expect(stripWwwLabel("www.com")).toBe("www.com");
    expect(normalizeDomain("www.com")).toEqual({ ok: true, domain: "www.com" });
  });

  it("zaten kanonik olan hostu değiştirmez", () => {
    expect(stripWwwLabel("example.com")).toBe("example.com");
    expect(stripWwwLabel("blog.example.com")).toBe("blog.example.com");
  });
});

describe("sameSiteDomains", () => {
  it("kanonik biçimi ÖNCE, `www.` ikizini SONRA verir — sıra bir tercihtir", () => {
    // Sırayı çağıranlar kullanıyor: iki satır da varsa kanonik olan seçilir.
    expect(sameSiteDomains("example.com")).toEqual(["example.com", "www.example.com"]);
  });

  it("`www.`li bir girdi için de AYNI iki biçimi verir", () => {
    // Depodaki eski satır `www.` taşıyor; onu arayan çağrı da aynı çifti sormalı.
    expect(sameSiteDomains("www.example.com")).toEqual(["example.com", "www.example.com"]);
  });

  it("alt alan adını `www.` ikizine genişletir ama kısaltmaz", () => {
    expect(sameSiteDomains("blog.example.com")).toEqual([
      "blog.example.com",
      "www.blog.example.com",
    ]);
  });
});

describe("normalizeDomain (devam)", () => {
  it("boş değeri ve şekli bozuk adı AYRI cümlelerle reddeder", () => {
    expect(normalizeDomain("   ")).toEqual({
      ok: false,
      error: expect.stringContaining("Domain is required") as unknown as string,
    });
    expect(normalizeDomain("localhost")).toEqual({
      ok: false,
      error: expect.stringContaining("not a valid domain") as unknown as string,
    });
  });
});
