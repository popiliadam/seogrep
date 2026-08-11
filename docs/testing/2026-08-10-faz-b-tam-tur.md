# Faz B — tam tur: 19 tool × 7 site × 3 durum

> 2026-08-10 · Kapsam: PLAN.md 🧪 bloğu · Harness `scripts/testing/tool-sweep.mjs`
> Ham JSONL **repo DIŞINDA** (müşteri URL'leri + GSC sorguları taşır).
> Bu belge KANIT'tır; kural yazmaz, iş emri çıkarmaz, fiyata dokunmaz (NEVER#6).

## Ölçülen para — tek kredi sapması yok

| | |
|---|---|
| hücre | **215** (`ok` 138 · `tool_error` 77) |
| ölçülen toplam delta | **−2855** |
| açılış bakiyesi | 8755 |
| kapanış bakiyesi (canlı `get_credit_balance`) | **5900** |
| 8755 − 2855 | **5900** ✅ birebir |
| ön-kayıtlı projeksiyon | 2915 |
| fark | **60** = ücret alınmayan 12 `pull_gsc_data` hatası × 5 |
| `delta_mismatch` | **12**, hepsi güvenli yönde (beklenen ücret, ölçülen **0**) |

**Faz B'nin "bitti" maddesi — *hiçbir tool hata mesajı için ücret almadı* — 77 `tool_error`
hücresinin 77'sinde ölçümle karşılandı.** Projeksiyon ile ölçüm arasındaki tek fark, ücret
alınmayan gerçek arızalardır; yani sapma değil, bulgunun kendisidir.

**DFS:** 31 canlı DataForSEO çağrısının **31'i de başarılı**; günlük $3 tavanı **hiç
tetiklenmedi**. Rezervasyon tahminleri site başına ~$0.95 iken gerçek maliyetlerin çok altında
kaldığı bir kez daha doğrulandı (#19 ile tutarlı).
**ÖLÇEMEDİĞİM:** günün gerçek DFS doları. `dfs_spend_today_usd()` şefte okunamaz
(Supabase execute_sql izin katmanınca engelli — ve bu DOĞRU; psql ile dolanılmadı).
Koruma benim ölçümüm değil, uygulamanın fail-closed kapısıydı.

## Kapsama — ne ölçüldü, ne ölçülmedi

15 tool yedi kampanya sitesinin **yedisinde de** mutlu yolda koşuldu.

| durum | kapsam |
|---|---|
| **(1) dolu / mutlu yol** | 15 tool × 7 site. GSC ailesinin dördü × 6 site (seogrep'in GSC'si yok — orada (2) koşuldu, bu tasarım, eksik değil) |
| **(2) önkoşulsuz** | audit üçlüsü · `generate_report` · GSC ailesi · `whats_next` · `connect_gsc` · `get_job_status` |
| **(3) hatalı girdi** | 14 tool × {bozuk uuid · olmayan uuid · yabancı kiracı}; premium üçlüsüne ek olarak {bozuk target · project_id+target birlikte} |

`list_projects` ve `get_credit_balance` hesap geneli çalışır; tek çağrı ÖLÇÜMÜN TAMAMIDIR,
yedi kez çağırmak aynı isteği yedi kez atmaktır.

**Durum (2) bu tura kadar hiçbir yerde ölçülemiyordu** ve bu tesadüf değil: yedi projenin
yedisinde de crawl var. 1. oturumun #35'i sekiz tool'a yayılmış hâlde **grep'le** bulmasının
sebebi tam olarak buydu — `generate_report` boş projede hiç çağrılmamıştı. Operatör onayıyla
`example.net` boş fikstür projesi açıldı (IANA rezerve, asla crawl edilmez, 0 kredi).

---

## Ön-kayıtlı soruların cevapları

### B6 — hiçbir tool "failed unexpectedly" dönmüyor mu? ❌ **HAYIR**

**12 hücrede döndü**, hepsi `pull_gsc_data`. Bu, #35'in kapattığı sınıf DEĞİL (tasarlanmış ret);
**gerçek bir dış arıza** ve o yüzden log'lanması doğru. Ama teşhis edilebilir ve kullanıcının
çözebileceği bir arıza jenerik çökme cümlesiyle sunuluyor → bkz. **#52**.

### B4 — bayder + rkturizm https:// property'sine bağlandı mı, veri geliyor mu? ✅ **EVET, İKİSİ DE**

`connect_gsc` ölçümü: `https://bayder.com.tr/` · `https://rkturizm.com/`. #50'nin öngördüğü düşüş
gerçekleşti. `pull_gsc_data` ikisinde de **veri getirdi** (bayder 5000/447 satır, rkturizm
5000/5000). Handoff'un "önce insan: iki tıklama" maddesi **zaten kapanmıştı**; varsayılmadı, ölçüldü.

### B5 — bigcattr crawl'ı hâlâ 1 sayfa/4xx mı? ✅ **EVET — ve bu tur sebebi ÇİFT TARAFLI kanıtladı**

| ölçüm | sonuç |
|---|---|
| SeoGrep crawl'ı (Fly.io çıkış IP'si) | **1 sayfa**, o da 4xx; `audit_tech`: `0 ok (2xx), 1 client error` |
| Faz C probu (ev IP'si, aynı gün) | **40/40 sayfa HTTP 200**, sitemap 178 sayfa bildiriyor |

Site erişilebilir; engellenen şey **bizim çıkış IP'miz**. #37'nin UA hipotezi zaten çürütülmüştü;
bu tur onu ikinci bir açıdan mühürlüyor. Bedeli ölçüldü: crawl 20 + audit üçlüsü 50 = **70 kredi**,
karşılığında tek bir 4xx sayfa — ve hiçbir çıktıda "site bizi reddetti" YAZMIYOR (**#59**).

### B1 — marka + konum deseni kaç sitede? ✅ **2 → EŞİK KARŞILANDI (≥2 → iş emri)**

| site | sorgu | pozisyonlar |
|---|---|---|
| dentnotion | `"dent notion menderes"` (marka + İLÇE) — listenin **1.**'si | 1.9 – 2.1 |
| bayder | `"bayder istanbul"` (2.), `"bayder ankara"` (3.) | 1.9 / 2.9 |

**#38 çalışıyor:** `"dent notion"` artık AÇIKÇA dışlanıyor, bayder'de 5 marka varyantı
(`"bay der"` dahil), rkturizm'de 7 (`"rk turizm bursa"` dahil — yani marka+konum bazen YAKALANIYOR).
Engelleyen yarı yine **#48'in sitelink koşulu**: bu sorguların hiçbirinde ≥2 sayfa ≤1.5'te değil.
Kural yazılmadı; eşik karşılandığı **kayda geçti**.

### B2 — #49 (`bigcat` ≠ `bigcattr`) kaç sitede? ❌ **1 → EŞİK KARŞILANMADI → KURAL YOK**

Yalnız bigcattr. Ön-kayıtlı eşik (≥2) tutmadı, dolayısıyla **#49 bigcattr'ın kendi şekli olarak
kalıyor ve kural yazılmıyor.**

**DİSİPLİN NOTU — eşik oynatılmadı, ve oynatma cazibesi gerçekti.** Veriyi gördükten sonra
bayder'in 1. sırasının `"bağımsız yaşam derneği"` olduğunu fark ettim: `bayder` alan adı etiketi
o adın KISALTMASI, yani "alan adı etiketi ≠ kullanıcının yazdığı marka" sınıfının ikinci üyesi.
Bu okumayla eşik karşılanırdı. **Karşılanmış saymıyorum:** #49 ön-kayıtta *ülke kodu soyma*
olarak tanımlanmıştı; sınıfı veriyi gördükten sonra genişletip kendi eşiğini geçirmek, tam olarak
handoff'un yasakladığı şeydir. Kısaltma vakası **yeni bir hipotez** olarak kaydedilir ve kendi
turunda ölçülür.

### B3 — #46 decay çıktısında fragment'li satırların payı? ⚠️ **ÖLÇÜLEMEDİ**

Yedi sitenin decay çıktılarının hiçbirinde `#` içeren URL satırı çıkmadı; yani eşik (>%10)
sınanacak paydası oluşmadı. Mekanizma kod seviyesinde duruyor (#46 açık), **bu turda canlı vakası
üretilmedi.** Eşik "karşılanmadı" değil, **payda yok**.

---

## Yeni bulgular

### #52 🔴 — GSC refresh token'ı ALTI bağlı projenin DÖRDÜNDE ölü; ürün "bağlı" diyor

**Ölçüm.** `pull_gsc_data`, 6 GSC-bağlı projenin **4'ünde** jenerik çökme cümlesi döndürdü:
adstark · bigcattr · katrenur · dentnotion. Çalışan ikisi: bayder · rkturizm — yani **dün yeniden
onaylanan tam olarak o ikisi**.

**Sebep TAHMİN EDİLMEDİ, sunucu log'undan okundu** (`flyctl logs -a seogrep-mcp`); 12 referans
kimliğinin **12'si de** aynı satır:

```
Tool "pull_gsc_data" failed [ref 11084895]: Google token endpoint failed (400): invalid_grant
```

**Zarar zinciri:**
1. `connect_gsc` → *"already connected for adstark.com.tr — property https://adstark.com.tr/"*
   Yani ürün, bağlantının **sağlıklı olduğunu söylüyor**.
2. `pull_gsc_data` → *"failed unexpectedly … quote reference X"* — kullanıcı bunun bir yetki
   sorunu olduğunu ve **yeniden onaylayarak düzeltebileceğini** öğrenemiyor.
3. Aşağıdaki üç tool tam ücretle **bayat veri** satıyor → **#53**.

Bu, #51'in tarif ettiği boşluğun (bağlanmada property doğrulanıyor, KİMLİK BİLGİSİ hiç
denenmiyor) **ölçülmüş yaygınlığıdır**: tek site anomalisi değil, **çoğunluk durum**.
#51'in "yeniden bağlanma iyileştiriyor" tespiti de doğrulandı — çalışan iki site, yeniden
onaylanan iki site.

### #53 🔴 — Token ölüyken üç GSC tool'u tam ücretle TARİHSİZ, bayat veri döndürüyor

Token'ı ölü dört projede `find_quick_wins` (10) · `detect_cannibalization` (10) ·
`analyze_content_decay` (10) **başarıyla koştu, tam ücret aldı** ve son başarılı `pull`'un
verisini sundu. bigcattr'ın decay çıktısı 1. oturumunkiyle aynı hikâyeyi anlatıyor
(2520 → 1143 tık), dentnotion'ın aynı 13 sayfası.

**Ölçülen asimetri — 32 çıktı, istisnasız:**

| aile | tarih damgası |
|---|---|
| crawl tabanlı (`audit_onpage`, `audit_tech`) | **14/14 VAR** — *"(crawl from 2026-08-09T…)"* |
| GSC tabanlı (`find_quick_wins`, `detect_cannibalization`, `analyze_content_decay`) | **18/18 YOK** |

Yani bağlantısı Ocak'ta ölen bir müşteri, yıl boyunca Ocak verisi için ödemeye devam eder ve
bunu **hiçbir çıktıdan anlayamaz**. Crawl ailesi bu sorunu zaten çözmüş; aynı disiplin GSC
ailesine uygulanmamış — *"bu veriyi başka kim okuyor?"* sorusunun beşinci vakası.

#### #53 KANITLANDI — yeniden onay deneyi kendi kontrol grubunu üretti (aynı gün, +1 saat)

Operatör dört siteye yeniden onay verdi. **Yalnız biri tuttu** — ve bu kaza, deneyin en
değerli parçası oldu:

| site | `pull_gsc_data` | sonra üç analiz tool'unun çıktısı |
|---|---|---|
| **adstark** | ✅ taze veri (234/254 satır) | `find_quick_wins` **DEĞİŞTİ** · `analyze_content_decay` **DEĞİŞTİ** · `detect_cannibalization` aynı |
| bigcattr | ❌ `invalid_grant` | 3/3 **BİREBİR AYNI** |
| katrenur | ❌ `invalid_grant` | 3/3 **BİREBİR AYNI** |
| dentnotion | ❌ `invalid_grant` | 3/3 **BİREBİR AYNI** |

Çıktılar sha256 ile karşılaştırıldı. **Token'ı ölü üç site, 30'ar kredi ödedi (90 kredi) ve
bir saat önce aldığı analizin BİREBİR AYNISINI aldı** — tarihsiz, uyarısız, ve tam ücretle.
Bağlantısı onarılan tek site ise aynı tool'lardan görünür biçimde farklı sonuç aldı.

`detect_cannibalization`'ın adstark'ta değişmemesi çelişki değil: kanibalizasyon grupları
90 günlük iki pencerenin büyük ölçüde örtüştüğü, yapısal olarak durağan çıktılardır.

**Bu, #53'ü mekanizmadan türetilmiş bir iddiadan doğrudan ölçülmüş bir olguya çeviriyor** —
ve kontrol grubunu kurmak gerekmedi, ölçümün kendisi üretti.

**ÖLÇÜLEN İKİNCİ ŞEY — `connect_gsc` ayırt EDEMİYOR.** Yeniden onaydan sonra dört sitenin
dördü de yine *"already connected — property https://…"* dedi; token'ı ölü olan üçü de dahil.
Yani mesaj, canlı bağlantı ile ölü bağlantı arasında **hiçbir fark göstermiyor**; öğrenmenin
tek yolu para harcamak. #52'nin özeti tam olarak budur ve burada canlı gösterildi.

### #54 🔴 — Satın alma öncesi site boyutu tahmini KIRPIK, ama tam sayıymış gibi sunuluyor

`crawl_site` parayı harcatmadan önce şunu der: *"~28 pages discovered; this crawl covers up to
100 of them (20 credits)."* Müşteri bunu "sitem 28 sayfa, hepsi taranacak" diye okur.

**Ölçüm — aynı koşuda, aynı sitede:**

| site | ön-tahmin | crawl'ın GERÇEKTEN keşfettiği | taranan | kapsama |
|---|---|---|---|---|
| dentnotion | **28** | **184** | 26 | %14 |
| adstark | 34 | 85 | 22 | %26 |
| rkturizm | 90 | 156 | 100 | %64 |
| bayder | 64 | 72 | 71 | %99 |
| katrenur | 28 | 29 | 28 | %97 |
| seogrep | 49 | 52 | 52 | %100 |
| bigcattr | **cümle hiç yok** | 1 | 1 | — |

**Mekanizma KODDAN okundu, çıkarım değil.** `estimateSiteSize` toplam **8 saniyelik**
`PRE_DISCOVERY_BUDGET_MS` ile sınırlı ve bu bütçeyi kök + tüm alt sitemap'lerle paylaşıyor.
`loadSitemapSeeds`:

```ts
const childTimeout = hopTimeout(deadline, timeoutMs);
if (childTimeout <= 0) break;   // kalan çocuklar HİÇ istenmiyor
```

Bütçe biterse genişletme durur ve fonksiyon **erken durduğuna dair hiçbir sinyal vermeden**
elindekini döndürür; `estimateSiteSize` de onu `{pages, source:"sitemap"}` diye sarar — eksiksiz
bir sayımdan ayırt edilemez. Sapma sitemap sayısıyla birebir örtüşüyor: 5 sitemap'li dentnotion
6.6×, tek sitemap'li bayder/katrenur ~1.0×.

**Kodun kendisi bu tuzağı bir dalda görmüş, diğerinde görmemiş:** homepage yedek dalının yorumu
*"so truncation never overstates the site's size"* diyor ve o dal için haklı. Birincil (sitemap)
dalda aynı kırpılma var, aynı biçimde sunuluyor, ve uyarısı yok.

### #55 🟡 — `compare_competitors`'ta locale uyarısı HİÇ YOK (0/7)

`ranked_keywords` uyarıyor (7 sitenin 4'ünde), `compare_competitors` **yedisinin hiçbirinde**
uyarmıyor — `adstark.com.tr` ve `bayder.com.tr` gibi apaçık ccTLD'ler dahil. `localeHint()`
`tools/ranked-keywords.ts` içinde yaşıyor ve öteki tool'a hiç uygulanmamış. #39 n=7'de doğrulandı
ve kapsamı genişledi.

### #56 🟡 — Locale uyarısının EŞİĞİ, tam da en çok gerektiği yerde susturuyor

`THIN_RESULT_ROWS = 5`: sonuç ≥5 satırsa uyarı basılmaz.

| rkturizm.com, aynı 65 kredi | sonuç | en iyi pozisyon | en yüksek hacim | uyarı |
|---|---|---|---|---|
| varsayılan `en`/2840 | **11** keyword | #6 | 210 | **YOK** (11 ≥ 5) |
| doğru `tr`/2792 | **482** keyword | **#1** | 880 | — |

**44 kat.** Site en yanlış temsil edildiği durumda "yeterince sonuç var" sayılıp susturuluyor.
bigcattr da aynı: 11 sonuç, Türk sitesi, `.com`, uyarı yok. Uyarı çalışan 4 vakanın hepsi zaten
sonucu 0 ya da 1-3 olan, yani müşterinin bir sorun olduğunu **kendi başına göreceği** vakalar.

### #57 🟡 — En pahalı tool, 7 sitenin 2'sinde 90 krediye ÜÇ SATIR döndürdü

`katrenur` için `compare_competitors`'ın **çıktısının tamamı**:

```
Competitor comparison for your project "katrenur.com" (language en, location 2840) —
DataForSEO has no competitors on record for this domain, so only the target's own numbers are shown:

• katrenur.com (target)
  - No organic ranking data on record.
```

Aynısı `seogrep.com` için. **İki kusur birleşiyor:** yanlış varsayılan locale → veri yok →
90 kredi → ve **#55 yüzünden locale'in sebep olabileceği söylenmiyor** — üstelik `ranked_keywords`
dakikalar önce tam da bu alan adı için uyarmıştı.

### #58 🟡 — Otomatik rakip seçimi, sonuç dönen 5 sitenin 3'ünde DEV site verdi

| site | 1. rakip | o rakibin SERP sayısı |
|---|---|---|
| rkturizm | **facebook.com** | 110.726.575 |
| bigcattr | **instagram.com** | 85.932.260 |
| bayder | **tff.org** (Türkiye Futbol Federasyonu) | 3.393 |
| adstark | brandaft.com | 17 — makul |
| dentnotion | mehmetekerdisklinigi.com | 2 — **gerçek yerel rakip** |

#17/#26 n=7'de: dev-site sorunu **çözülmedi ve çoğunluk sonuç**. #26'nın "kök vendor'da" tespiti
duruyor; bu tur yalnız yaygınlığını ölçtü.

### #59 🟡 — Ön-keşif başarısız olunca `crawl_site` cümleyi SESSİZCE düşürüyor

Altı sitede mesaj *"~N pages discovered; this crawl covers up to 100 of them (20 credits)"* ile
biter. bigcattr'da o cümle **hiç yok** — mesaj `job_id`'den sonra kesilir, iş 6,2 saniyede biter,
**20 kredi yine alınır**, ardından audit üçlüsü 50 kredi daha alır. Hiçbir yerde "siteni
getiremedik" yazmaz. Yokluk, bir hata mesajından çok daha sessizdir.

### #60 🟡 — "Robots conflicts" kuralı KENDİ sitemizde 3/3 yanlış pozitif

`audit_tech`, `seogrep.com` için:

```
Robots conflicts (noindex but internally linked): 3
  · https://seogrep.com/login (linked from 11 page(s))
  · https://seogrep.com/signup (linked from 10 page(s))
  · https://seogrep.com/forgot-password (linked from 1 page(s))
```

Üçü de **tasarım gereği** noindex ve **tasarım gereği** her sayfadan linkli. Kural, kimlik
doğrulama/yardımcı sayfalar için muafiyet tanımıyor. bayder'de aynı kural **gerçek** bir bulgu
üretti (4xx olan `/bagimlilik-tedavisi`, 6 sayfadan linkli) — yani kural değerli, muafiyeti eksik.

### #61 🟢 — `crawl_site` tekrarlanabilirliği kötüleşti (#41 güncellemesi)

adstark, aynı parametreler: **37** (2026-08-09) · **47** (aynı gün) · **22** (bugün).
En yüksekle en düşük arasında **2,1 kat**. Kapsama tabanlı hiçbir kıyas tekrarlanabilir değil.

### #62 🟢 — rkturizm ilk kez ZAMAN değil URL tavanına takıldı

`audit_tech`: *"max URL limit reached"* × 55 (`time budget exhausted` değil). `max_urls`
varsayılanı 100 ve crawl tam 100'de durdu. Mesaj iki sebebi doğru ayırıyor — bu **iyi** ve
korunmalı.

---

## Doğrulanan / kapanan şeyler

| konu | ölçüm |
|---|---|
| **S4 kiracı izolasyonu (#50 sonrası regresyon)** | 14/14 tool, uuid maskelendiğinde mesaj şablonları **BİREBİR AYNI**, hepsinde delta 0. Sızıntı yok. |
| **#35 tasarlanmış ret** | Soğuk fikstürde audit üçlüsü + `generate_report` → dürüst cümle, `isError=true`, **delta 0**. Hiç ölçülmemiş dal artık ölçüldü. |
| **PR #56 (project_id + target birlikte)** | Reddediyor ve *"You were not charged."* diyor. 0 kredi. |
| **#38 marka filtresi** | n=7'de genelleşiyor: bayder 5, rkturizm 7, dentnotion/bigcattr/adstark 1'er marka sorgusu dışlandı. |
| **`whats_next` çok-proje dalı** | İlk kez gerçek girdiyle (9 proje) ölçüldü: doğru şekilde hangi projeyi kastettiğini soruyor. |
| **`audit_onpage` derinliği** | 1. oturumun "dar" teşhisi zayıfladı: 7 sitede 5–7 ayrı bulgu tipi üretti (crawl kapsamı arttıkça denetim zenginleşti). |
| **adstark hâlâ ele geçirilmiş (#22/#23)** | `audit_onpage`'in 1. bulgu sayfası `/spielbank-bad-reichenhall-kompletter-guide`. Operatörde. |

## Ölçülemeyenler — adıyla

1. **Günün gerçek DFS doları.** Şef `dfs_spend_today_usd()` okuyamaz. 31 çağrının hiçbiri
   reddedilmedi, yani tavan aşılmadı — ama harcanan rakam bu belgede YOK.
2. **#46 fragment payı (B3).** Payda oluşmadı; eşik sınanamadı.
3. **`invalid_grant`'in NEDENİ.** Log sebebi veriyor, kökünü vermiyor (iptal mi, süre mi,
   yarım onay mı) — dışarıdan belirlenemez.
4. **H6 vendor şekil varyansı.** MCP yüzeyi ham payload döndürmüyor; yapısal, 1. oturumdan beri
   değişmedi. 31 canlı çağrının 31'i zod şemalarından geçti (canlı sözleşme sinyali), yeni
   fikstür üretilmedi.
5. **`#49`'un ikinci vakası.** Portföyde yok; eşik karşılanmadı ve genişletilmedi.
