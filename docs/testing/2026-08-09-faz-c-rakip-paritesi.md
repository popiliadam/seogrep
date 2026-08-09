# Faz C — rakip paritesi: "bu kontrol OLSAYDI kaç bulgu üretirdi?"

> 2026-08-09 · PLAN.md Faz C · Ölçüm ürünün tool'larıyla DEĞİL, sayfalar doğrudan çekilerek
> yapıldı — **0 kredi**. Harness `scripts/testing/parity-probe.mjs` + `seo-checks.mjs`
> (predikatlar saf, `--self-test` 18/18). Ham kayıtlar repo DIŞINDA.
>
> **BU BELGE KURAL YAZMAZ.** Çıktı bir SAYI tablosudur; hangi kontrolün eklenmeye değdiğine
> rakama bakarak İNSAN karar verir. Fiyata dokunulmadı (NEVER#6).

## Örneklem

Yedi site, her sitemap'ten **oransal (stratified)** çekim — 1. oturumun kör örneklemesi
(yalnız post-sitemap) tam olarak bu yüzden tekrarlanmadı.

| site | sitemap'in bildirdiği | çekilen | HTTP 200 |
|---|---|---|---|
| adstark.com.tr | 73 | 40 | 40/40 |
| bayder.com.tr | 64 | 40 | 40/40 |
| rkturizm.com | 90 | 40 | 40/40 |
| www.bigcattr.com | 178 | **34** (6 tekrar düşüldü) | 40/40 |
| katrenur.com | 28 | 28 | 28/28 |
| dentnotion.com | 172 | 39 | 39/39 |
| seogrep.com | 49 | 40 | 40/40 |
| **toplam** | | **261 tekil sayfa** | **%100** |

**bigcattr 40/40 HTTP 200 döndü** — yani site tamamen sağlıklı. SeoGrep'in kendi crawler'ı aynı
gün **1 sayfa** alabildi. Faz B #37/B5'in ikinci taraflı kanıtı burada.

---

## TABLO — on kontrol × yedi site (vaka sayısı)

| kontrol | adstark | bayder | rkturizm | bigcattr | katrenur | dentnotion | seogrep | **Σ** |
|---|---|---|---|---|---|---|---|---|
| 1 · `alt` eksik **görsel** | 156 | 0 | 0 | 14 | 0 | 312 | 0 | **482** |
| 1b · …etkilenen **sayfa** | 39 | 0 | 0 | 2 | 0 | 39 | 0 | **80** |
| 2 · kırık iç link (**tekil URL**) | 1 | 2 | 1 | — | — | 70 | — | **74** |
| 2b · …**ayrı kusur** olarak | **0** | **2** | **1** | — | — | **2** | — | **5** |
| 3 · yetim (örneklem-içi vekil) | 6 | 1 | 4 | 11 | 1 | 0 | 0 | **23** |
| 4 · title ↔ h1 uyumsuz | 1/28 | 3/40 | **8/38** | 1/30 | **7/28** | 4/38 | 3/40 | **27/242** |
| 5 · OG eksiği olan sayfa | 17 | 39 | 19 | 5 | 22 | 5 | **40** | **147** |
| 5b · OG'si **hiç olmayan** | 1 | 0 | 0 | 5 | 2 | 0 | 0 | **8** |
| 6 · hreflang bildiren | 0 | 0 | 0 | 0 | 0 | 11 | 0 | **11** |
| 6b · hreflang **hatası** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| 7 · hız **VEKİLİ** eşik üstü | 1 | 3 | 7 | 3 | 0 | **25** | 0 | **39** |
| 8 · zorunlu şema alanı eksik | 0 | 0 | **1** | 0 | 0 | 0 | 0 | **1** |
| 9 · yönlendiren sitemap URL'i | 0 | 0 | 0 | 1 | 0 | **8** | 0 | **9** |
| 9b · zincir ≥2 · döngü | 0·0 | 0·0 | 0·0 | 0·0 | 0·0 | 0·0 | 0·0 | **0·0** |
| 10 · duplicate gövde (**grup**) | 1 | 0 | 0 | **0** | 0 | 5 | 0 | **6** |

---

## Kontrol kontrol — ne anlama geliyor

### En çok vaka üreten: `alt` eksikliği (482 görsel / 80 sayfa) — ama **iki siteye yığılmış**

adstark 156 ve dentnotion 312; öteki beş sitede **tam sıfır**. Bu, sayının tek başına aldatıcı
olduğu tipik örnek: portföy genelinde "%31 sayfa etkilenmiş" demek yerine "iki WordPress
temasında görsel `alt`'ı otomatik doldurulmuyor" demek doğru.

**Sıfırlar DOĞRULANDI, varsayılmadı.** bayder'in ana sayfası elle çekildi: 33 `<img>` etiketi,
33'ünde de `alt` dolu. Yani sıfır, ayrıştırıcı hatası değil sitenin özelliği.
`alt=""` ve `aria-hidden` **bulgu sayılmadı** — ikisi de görselin dekoratif olduğunu bildiren
standart yol, onları saymak doğru işaretlemeyi kusur ilan etmek olurdu.

### En yanıltıcı ham sayı: kırık iç linkler (74 URL ama **5 kusur**)

dentnotion'ın 70 kırık linkinin **68'i tek bir hata**: canlı HTML'e sızmış, render edilmemiş
şablon değişkenleri —

```
https://dentnotion.com/hakkimizda/{{{ data.url }}}
https://dentnotion.com/hakkimizda/{{{ data.editLink }}}
```

~34 sayfada ikişer tane. Bir SEO aracının "70 kırık link" demesi kullanıcıyı 70 ayrı işe
gönderir; **doğru çıktı "1 kusur, 34 sayfa, tek düzeltme"dir.** Diğerleri: bayder'de bozuk bir
`tel:` href'i (`"tel:+90…"` tırnaklarıyla göreli URL'e dönüşmüş), rkturizm'de bir gerçek 404,
dentnotion'da bir gerçek 404.

**Cloudflare `cdn-cgi/l/email-protection` bağlantıları YANLIŞ POZİTİF sayıldı ve düşüldü**
(JS ile yerine konan e-posta gizleme yer tutucusu); adstark'ın tek "kırık" linki buydu, gerçek
sayısı **0**.

**Ürünün burada bizden AVANTAJI var:** benim probum 261 sayfa örnekledi, SeoGrep'in crawler'ı
zaten her sayfayı çekiyor ve iç link grafiğinin tamamına sahip. Bu kontrol üründe **benim
ölçtüğümden daha doğru** çalışır.

**Ve bir vakayı ürün ZATEN buldu:** bayder'in `/bagimlilik-tedavisi` sayfasını `audit_tech`
kendi "Robots conflicts" kuralıyla yakaladı (*4xx, 6 sayfadan linkli*) — yani mevcut kural
seti kırık-link vakalarının bir kısmına başka bir kapıdan zaten değiyor.

### En sistematik: Open Graph (147 sayfa) — ve 1. sırada **kendi sitemiz** var

`seogrep.com` 40/40 sayfada en az bir OG alanı eksik; bayder 39/40. Bu, paylaşılan linkin
sosyal medyada çıplak URL olarak görünmesi demek. Ucuz bir kontrol, geniş bir yüzey.
**8 sayfada OG hiç yok** (bigcattr 5, katrenur 2, adstark 1).

### Beklenenden çok daha az: zorunlu şema alanları (**1 vaka**)

`audit_schema` yalnız `@type` adlarını okuduğunu **açıkça söylüyor** ve defter bunu tool'un en
iyi özelliği sayıyor (#11). Faz C o dürüst sınırın bedelini ölçtü: 261 sayfada zorunlu alan
eksiği **tek bir sayfada** (rkturizm, `Article.datePublished`). 40 sayfanın 40'ında şema var ve
alanlar dolu.

**Bu, "zorunlu alan doğrulaması ekleyelim" fikrinin ölçülmüş karşı-argümanıdır** — bu portföyde
neredeyse hiç iş çıkarmaz. (Sınır: 261 sayfa, hepsi Türk KOBİ; e-ticaret ağırlıklı bir portföyde
`Product.offers` tablosu bambaşka çıkabilir.)

### Sıfır çıkan iki kontrol: hreflang ve yönlendirme zinciri

- **hreflang:** yalnız dentnotion bildiriyor (11 sayfa) ve **hatası yok**. Tek dilli sitede
  yokluk kusur DEĞİL, o yüzden 0 olarak sayıldı. Bu portföyde kontrol iş çıkarmaz.
- **Yönlendirme zinciri:** 261 URL'de **zincir ≥2 yok, döngü yok**. Sitemap'in bildirdiği
  URL'lerin 9'u yönleniyor (dentnotion 8, bigcattr 1), hepsi tek sıçrama.

**ÖNEMLİ AYRIM — #6/#7 ile karıştırılmamalı.** Buradaki 0, sitelerin temiz olduğunu söyler.
#6/#7'deki 301 seli **crawler'ın kendi ürettiği** yönlendirmedir (`normalizeUrl` sondaki
`/`'ı siliyor, site geri yolluyor). İkisi farklı olgu; bu ölçüm #6'yı çürütmez.

### Duplicate content (6 grup / 13 sayfa) — ve **kendi ölçüm hatam**

| site | grup | örnek |
|---|---|---|
| adstark | 1 | `/ketegori/seo/` = `/ketegori/dijital-reklam-yonetimi/` = `/ketegori/sosyal-medya/` (boş kategori arşivleri; `ketegori` yazım hatası zaten defterde) |
| dentnotion | 5 | `/diyabet-hastalarinda-agiz-ve-dis-bakimi-rehberi/` = `/diyabet-hastalarinda-dis-sagligi-korunmasi-rehberi/` — **farklı başlıklı iki makale, birebir aynı gövde** |

**İlk hesabım 12 grup diyordu ve YANLIŞTI.** bigcattr'ın "6 grubu"nun tamamı örnekleme
artefaktıydı: iki alt-sitemap çakışıyor, aynı URL iki kez çekiliyor ve kontrol kendi kendine
tetikleniyordu. Tekil URL'e indirgenince bigcattr'ın gerçek sayısı **0**. Bu oturumda kendi
ölçümümde yakaladığım **üçüncü** hata (öncekiler: `attr()` sondaki boolean niteliği görmüyordu,
`stratifiedSample` küçük sitemap'i sıfıra yuvarlıyordu — ikisi de kendi self-test'imce yakalandı).

dentnotion'ın 5 grubu ayrıca **kanibalizasyonla aynı sayfaları** işaret ediyor: aynı içerik iki
URL'de → aynı sorguda iki sayfa. İki kontrol aynı kusuru iki ayrı ucundan görüyor.

### Hız — **Core Web Vitals ÖLÇÜLMEDİ, uydurulmadı**

LCP/INP/CLS HTML çekerek ölçülemez (render ya da CrUX alan verisi ister). Ölçülen şey HTML'in
gerçekten belirlediği iki şey: `<head>`'deki render-bloklayan kaynak sayısı ve doküman ağırlığı.

| site | medyan TTFB | medyan HTML | eşik üstü sayfa (≥3 blok. script veya >200 KB) |
|---|---|---|---|
| dentnotion | **896 ms** | **207 KB** | **25/39** |
| bigcattr | 337 ms | 127 KB | 3/34 |
| seogrep | 229 ms | 59 KB | 0/40 |
| adstark | 132 ms | 76 KB | 1/40 |
| rkturizm | 54 ms | 180 KB | 7/40 |
| katrenur | 58 ms | 88 KB | 0/28 |
| bayder | 58 ms | 174 KB | 3/40 |

dentnotion bariz aykırı: en yavaş TTFB, en ağır HTML, sayfalarının **üçte ikisi** eşiğin
üstünde. Aynı site aynı zamanda en çok kırık link, en çok duplicate ve en çok `alt` eksiğine
sahip — yani portföyün en sorunlu sitesi tek bir kontrolde değil, **hepsinde** öne çıkıyor.

### Yetim sayfalar — **bu vekil zayıf ve öyle raporlanıyor**

23 sayfa örneklem içinde hiç iç link almadı. Ama örneklem 261 sayfa, siteler 28–178 sayfa:
örneklenmeyen bir sayfa bunlara link veriyor olabilir. **Bu sayı yetim sayısı DEĞİL, üst
sınır bile değil** — yalnız bir işaret. Gerçek ölçüm tam crawl ister.

**Ve tam crawl ÜRÜNDE zaten var.** Yetim-sayfa kontrolü, bu on kontrol arasında ürünün mevcut
verisiyle benim probumdan **kesinlikle daha iyi** yapabileceği ikinci kontroldür (birincisi
kırık linkler).

---

## Özet — hangi kontrol bu portföyde ne kadar iş çıkarır

| kontrol | vaka | yorum |
|---|---|---|
| `alt` eksikliği | **482 görsel / 80 sayfa** | en yüksek hacim; iki siteye yığılı |
| Open Graph | **147 sayfa** | en yaygın (7/7 sitede var), en ucuz |
| hız (vekil) | **39 sayfa** | tek site baskın; gerçek CWV için ayrı altyapı gerekir |
| title ↔ h1 | **27 sayfa** | 7/7 sitede var, hiçbirinde baskın değil |
| yetim (vekil) | **23** | ölçüm zayıf; ÜRÜN daha iyi yapabilir |
| kırık iç link | **74 URL → 5 kusur** | ham sayı aldatıcı; ÜRÜN daha iyi yapabilir |
| duplicate content | **6 grup / 13 sayfa** | kanibalizasyonla örtüşüyor |
| hreflang | **11 bildirim / 0 hata** | bu portföyde iş yok |
| yönlendirme zinciri | **9 tek sıçrama / 0 zincir / 0 döngü** | bu portföyde iş yok |
| zorunlu şema alanı | **1** | bu portföyde iş yok — `audit_schema`'nın dürüst sınırı ucuza geliyor |

**Tek cümle:** en çok iş çıkaran üç kontrol (`alt`, Open Graph, title↔h1) ürünün zaten çektiği
HTML'den **ek veri olmadan** hesaplanabilir; en az iş çıkaran üçü (hreflang, yönlendirme
zinciri, zorunlu şema alanı) bu portföyde neredeyse hiç vaka üretmiyor. Kırık link ve yetim
sayfa ise ürünün **benden daha iyi** yapabileceği, çünkü tam crawl grafiği onda.

## Bu ölçümün sınırları — adıyla

1. **261 sayfa, 7 site, hepsi Türk KOBİ.** Sektör dağılımı dar; e-ticaret ağırlıklı bir
   portföyde şema ve duplicate tabloları başka çıkar.
2. **CWV ölçülmedi** (yukarıda). Tablodaki "hız" sütunu vekildir ve öyle etiketlidir.
3. **Yetim ve kırık-link sayıları örneklem-bağımlı**; tam crawl olmadan üst sınır bile değil.
4. **JS ile render edilen DOM görülmedi** — prob ham HTML okur. 1. oturum 8/8 sitenin
   sunucu-render olduğunu ölçmüştü, o yüzden risk düşük ama sıfır değil.
5. **Ayrıştırıcı bir bağımlılık değil, küçük toleranslı bir çıkarıcı** (contract.md yeni
   bağımlılığı hakem + lisansa bağlıyor). Bedeli fikstürlerle pinlendi; genel HTML
   ayrıştırıcısı olarak kullanılamaz.
