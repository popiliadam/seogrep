# Dilim 2 kapanışı — 6 tool, 63 bulgu

> Tarih: 2026-09-03 · Tur: tool kontrol turu 2026-09 · Kayıtlar: bu dizindeki `crawl_site.md`,
> `audit_tech.md`, `audit_schema.md`, `audit_speed.md`, `audit_onpage.md`, `audit_content.md`
> Kural (CLAUDE.md ders 16): bir kalem kapandığında **kapatan tur** kaydı da günceller. Bu dosya
> indekstir; her satırın ayrıntısı kendi kaydındaki `durum (kapanış, 2026-09-03)` sütunundadır.
> Her kalem ya bir PR numarasıyla ya da `AÇIK / ERTELENDİ / İMZA KALEMİ — neden` ile biter.
> Kapatan PR'lar: **#209** (`fix/speed-d2`) · **#210** (`fix/tech-d2`) · **#211** (`fix/crawl-d2`) ·
> **#212** (`fix/content-d2`). Taban: `main` `dff7f32` (dördü de merge edilmiş).

## Sayılar

| | adet |
|---|---|
| Bulgu (6 kayıt toplamı) | **63** |
| P0 | 0 |
| P1 | 19 — **19'u da kapandı** |
| KAPANDI | 29 |
| KISMEN | 3 (`audit_schema` S-B7 · `audit_speed` B-6 · `audit_speed` B-10) |
| AÇIK | 21 |
| ERTELENDİ | 5 (sınıf 8'e 3, sınıf 6'ya 2) |
| İMZA KALEMİ | 5 (T-B5b · S-B5b · A-3b · T-B11 · S-B9 — **iki karara** iniyor) |

`canlı ✔` işaretli bulgu sayısı: **5**, hepsi `audit_speed` (#209 deploy `8be8bd0`, şef turu, Δ −15).
`#210`'un deploy'u da ölçüldü ama **kapattığı bölümler koşullu olduğu için görülemedi** (aşağıda).
`#211` ve `#212` `dff7f32` deploy'u sonrası şef turunda ölçülecek.

## Tool tablosu

| tool | karar (kapanış) | kapatan PR'lar | canlı doğrulama | açık kalemler |
|---|---|---|---|---|
| `crawl_site` | KAPANDI | #211 (+ #210 devri) | **bekliyor** — S5 hücresi ("ikinci özdeş crawl yeniden ücretlendirir mi") deploy sonrası şef turunda | B-5 · B-7 · B-11 AÇIK (iş emrinde yoktu) · B-9 → sınıf 8 · B-10 → sınıf 6 (+R-3.14 açık) |
| `audit_tech` | KAPANDI | #210, #212 | **ölçüldü, GÖRÜLEMEDİ** — adstark 1 sayfalık crawl'da hreflang ve emekli-tip bölümleri KOŞULLU; regresyon yok, Δ −20 | T-B5b · T-B11 **İMZA** · T-B7 → sınıf 8 · T-B8 → sınıf 6 · T-B9 · T-B10 AÇIK |
| `audit_schema` | KAPANDI | #210, #212 | **ölçüldü, GÖRÜLEMEDİ** — emekli-tip bölümü için FAQPage taşıyan özne gerekir | S-B7 **KISMEN** · S-B5b · S-B9 **İMZA** · S-B8 → sınıf 8 · S-B4 · S-B6 · S-B10 AÇIK |
| `audit_speed` | KAPANDI | #209 | **✔ beş bulgu** — provenance `Lighthouse 13.4.0` (B-1), LCP bandı (B-4), desktop + tek-örnek cümleleri (B-2/B-9), geçen denetim listede yok (B-7) | B-6 · B-10 **KISMEN** · B-3 · B-8 AÇIK · mobil ekseni **İMZA** |
| `audit_onpage` | KAPANDI | #212 | **bekliyor** — kapsam cümlesi, tekrar uyarısı ve `job_id` yolu deploy sonrası; `repeatNote` UTC varsayımı da orada | A-3b **İMZA** · A-5 · A-6 · A-7 · A-8 · A-9 · A-10 AÇIK |
| `audit_content` | KAPANDI | #212 | **bekliyor** — aynı deploy | B-3 · B-4 · B-5 · B-6 · B-7 AÇIK (beşi de iş emrinde yoktu) |

**PR'da karşılığı BULUNAMAYAN bulgular** (dört diff'in dosya listesi ve gövdesi tek tek arandı;
"düzeltilmedi" demek değil, **iş emrine hiç girmedi** demektir):

| bulgu | ölçüm |
|---|---|
| `crawl_site` B-5 (8,2 sn sessiz ön-keşif) | `PRE_DISCOVERY` #211 diff'inde **0 eşleşme** |
| `crawl_site` B-7 (200 dışı durum sorun sayılmıyor) | `computeIssues` #211 diff'inde **0 eşleşme** |
| `crawl_site` B-11 · `audit_tech` T-B9 (mobil/`viewport`/CDN eksenleri) | `viewport` ve `USER_AGENT` dört diff'te yalnız **bağlam satırı** olarak var |
| `audit_speed` B-8 (`Run audit_speed for Core Web Vitals.`) | `report/html.ts` ve `generate-report.mdx` **dört PR'ın hiçbirinin dosya listesinde değil** |
| `audit_schema` S-B4 · S-B6 · S-B10 | `audit-schema.ts:6-9` yorum bloğu ve sekiz tipin listesi hiçbir diff'te yok |
| `audit_onpage` A-5 · A-6 · A-7 · A-9 | `lang_missing` / `og_missing` #212'de yalnız bağlam satırı; `nosnippet` hiçbir diff'te yok |
| `audit_content` B-3 · B-5 · B-6 · B-7 | `ID_TOOLS` hiçbir diff'te yok; `audit-content.ts`'te düz `throw new Error(` bugün hâlâ duruyor (satır 347, ölçüldü) |
| `audit_onpage` A-8 · `audit_content` B-4 (`goals/` hedefleri) | **dört PR'ın hiçbiri `goals/` altına dosya eklemedi** |

## Dokuz sınıfın akıbeti

Ayrıntı: `_DILIM2-HAKEM-SINIFLAR.md`'nin yeni **akıbet** sütunu.

| # | sınıf | akıbet |
|---|---|---|
| 1 | En-son-crawl seçimi + kapsam cümlesi yok | **KAPANDI #212** — `job_id` + `Audited crawl <id> from <date>: N page(s), M skipped.`, dört audit'te pinli |
| 2 | Özdeş denetim yeniden ücretlendiriliyor | **kopya yarısı KAPANDI #212** · **ücret yarısı İMZA KALEMİ** |
| 3 | Eşik sabiti testte YANLIŞ pinli | **KAPANDI #212 (A-1) + #210 (S-B1/S-B1b)** — testler silinmedi, çevrildi; pin galeriye bağlandı |
| 4 | Vendor şekli / uydurma fixture | **B-1 KAPANDI #209 + canlı ✔** · **B-10 KISMEN #209** (yorum dürüstleşti, pin duruyor) |
| 5 | Dar kapı vs paket kapısı | **KAPANDI #210 (S-B3) + #209 (B-5)** — **AÇIK:** `charge:"handler"` kullanan her tool için genelleme yazılmadı |
| 6 | robots.txt gövdesi `CrawlResult`'a yazılmıyor | **ERTELENDİ** — T-B8 ve `crawl_site` B-10; alan hiçbir PR'da açılmadı |
| 7 | "You were not charged" vs defterde charge+refund | **İMZA KALEMİ** — T-B11 / S-B9 tek karar; kod yazılmadı |
| 8 | Kart planlı, sevk edilmemiş | **ERTELENDİ → kart dilimi (plan gereği)** — `CARDED_TOOLS` hâlâ yalnız `get_credit_balance` |
| 9 | Ayırıcısız cümle birleştirme | **KAPANDI #210 — sınıf olarak** (üç konum tek satırla). **AÇIK, aynı kalem değil:** `audit_speed` B-6'nın zod mesajı yarısı |

Sınıf 9 dilim 1'de "kapatılmış sayılıyordu" ve üç yeni konumda yaşıyordu (ders 14). Bu turda
kapanış **konumda değil, birleştirmenin yapıldığı tek yerde** yapıldı — `free-refusal.ts:51-60`.
Bu, sınıfın ikinci kez dirilmemesi için gereken farktır; ama bunu ölçen bir kapı yok, yalnız o
dosyanın kendi testi var.

## İmza kalemleri (operatörde — kod yazılmaz)

| kalem | kayıt | neden imza |
|---|---|---|
| Özdeş denetimin ücretsiz tekrarı ya da `confirm` kapısı | `audit_tech` T-B5b · `audit_schema` S-B5b · `audit_onpage` A-3b | **fiyat modeli (NEVER#6)**: 15 kredi bugün *bir denetim koşusunu*, önerilen hâlde *bir crawl'ın denetlenmiş olmasını* satın alır. **Üç audit (5/15/30) TEK imzada** — ayrı ayrı imzalanırsa yüzey kendi içinde tutarsızlaşır |
| "You were not charged." ↔ defterdeki `charge` + `refund` çifti | `audit_tech` T-B11 · `audit_schema` S-B9 | sistem doğru (append-only rezerv/iade, NEVER#2); düzeltilecek olan **kelime**, ve hangi kelimenin doğru olduğu ürün kararı |
| `audit_speed` mobil ekseni | `audit_speed` B-9'un uzun vadeli yarısı | her URL'i iki kez ölçmek **vendor maliyetini ikiye katlar** ve `MAX_SPEED_URLS=5` imzalı fiyatın parçası (NEVER#6) |
| Tavsiye kataloğu donmuş (`whats_next` 22/38 tool'u hiç anmıyor) | Dilim 1, `whats_next.md` F-1 | **devreden**; ürün kapsam kararı |
| Rakip domain | tur genelinde | operatörde |

## Operatör kuyruğu (kod değil, ortam/karar)

| kalem | kaynak | not |
|---|---|---|
| `jobs` **kısmi benzersiz indeks** migration'ı | #211, `crawl_site` B-1 | Hakem şemayla doğruladı. B-1'in uygulama kapısı yarışı kapatmıyor; indeks gerekiyor ve `enqueueJob` **23505'i yakalamalı**. Bu olmadan iki eşzamanlı istek hâlâ iki iş açabilir |
| Yukarıdaki beş imza kalemi | bu dosyanın imza tablosu | üçü tek karara (ücret) iniyor |

## Dilim 3'e devredenler

| kalem | kaynak | neden bu dilimde kapanmadı |
|---|---|---|
| Sınıf 6 — `CrawlResult.robotsTxt` | T-B8 · `crawl_site` B-10 | tek alan, **beş kural birden** açıyor; iş emrine girmedi |
| Sınıf 8 — kart sevki (6/6 tool) | altı kaydın altısı | **plan gereği** ayrı dilim; üç audit'te sevk maliyeti ~sıfır (nesne `audit_runs.report`'ta hazır) |
| Sınıf 9 registry yarısı — zod-issue birleştirmesi | `audit_speed` B-6 | dizi tavanının string'e `<=5 characters` diye uygulanması registry'nin zod mesajında, `free-refusal`'da değil |
| `charge:"handler"` ücret-adı statik kontrolü | `audit_speed` B-5'in genellemesi | B-5 yalnız `audit_speed` için pinlendi; **kapsam kontrol edilmedi** |
| `goals/` hedefleri | `audit_onpage` A-8 · `audit_content` B-4 · `audit_speed` B-4 eşikleri · `audit_schema` galeri + ISO tablosu | dört PR'ın hiçbiri `goals/` altına dosya eklemedi (ölçüldü) |
| `audit_schema` S-B7 ikinci yarısı | #212'nin kendi "Ölçülmeyen" bölümü | `No JSON-LD @type found anywhere on the site.` hâlâ kapsamdan bağımsız |
| `repeatNote` UTC varsayımı | #212 | canlıda ölçülecek |
| hreflang ISO 639-1 tablosu | #210 | tablo tek yerde; eksik kod içerirse **geçerli etiket "geçersiz" raporlanır** → `goals/` adayı |
| `audit_speed` fixture'ı elle kurulu + snake_case alias | #209 | asıl borç uydurma fixture'dı; gerçek vendor yanıtıyla kaydedilmesi ayrı iş |
| `audit_speed` B-3 (TTI) | #209 sonrası | sürüm artık okunabiliyor (`13.4.0`); TTI'nin o sürümdeki anlamı **kaynağıyla** karara bağlanmadı |
| `crawl_site` B-5 · B-7 · B-11 · T-B9 · S-B4 · S-B6 · S-B10 · A-5–A-7 · A-9 · A-10 · content B-3 · B-5 · B-6 · B-7 | ölçüm turu | **iş emrine hiç girmedi** — 21 AÇIK kalemin çoğu bu |

## Kapıların ÖLÇMEDİĞİ — bu kapanışın sınırları

Ders 7: yeşil kapı NE ölçtüğüyle raporlanır. Aşağıdakiler bu turda **ölçülmedi**, ve hiçbiri
"geçti" diye sayılmamıştır.

1. **`*.db.test.ts` şeritleri LOKALDE koşulmadı.** #210 ve #212 bunu kendi "Ölçülmeyen"
   bölümlerinde adıyla yazıyor; `make verify` DB şeritlerini koşmaz (CLAUDE.md komut tablosu).
   İş CI'a bırakıldı — ve **CI'da `verify-db` bu dilimde 4 kez PostgREST 502'siyle kırmızı verip
   deploy'u blokladı** (`audit_tech` T-B10'un ailesi; `verify-db-ci-flake` tuzağı). Bir kapı
   koşuluyor olması, o kapının o sabah bir şey ÖLÇTÜĞÜ anlamına gelmiyor. İstisna: #211'in
   `crawl-site.db.test.ts`'i yerel stack'te 10/10 koştu.
2. **Yarış penceresi hiçbir şeritte ölçülemez.** `crawl_site` B-1'in uygulama kapısı iki
   eşzamanlı isteği kapatmaz; bunu ölçebilecek bir test yazılamıyor, kapatan şey bir **migration**
   ve o operatörde. B-1 satırı "KAPANDI" derken bunu değil, **sıralı ikinci isteği** kastediyor.
3. **#210'un kapattığı bölümler canlıda GÖRÜLEMEDİ.** hreflang ve emekli-tip bölümleri koşullu:
   adstark'ın 1 sayfalık crawl'ında ne hreflang ne FAQPage vardı. Ölçüm koşuldu (Δ −20), regresyon
   yok — ama iddia bugün **birim testinde** duruyor, canlıda değil. Doğrulamak için hreflang'li ve
   FAQPage'li bir özne gerekiyor.
4. **#211 ve #212'nin canlı yarısı hiç ölçülmedi** — `dff7f32` deploy'u sonrası şef turuna kaldı.
   O tura kadar bu dosyadaki `(canlı: bekliyor)` işaretli her satır **bir iddiadır**: kapı yeşil,
   `main` güncel, ama canlı uçta görülmedi.
5. **`goals/` hiç genişlemedi.** Dört PR'ın hiçbiri `goals/` altına dosya eklemedi. Bu turda
   kapanan hiçbir sınıf `make goals` tarafından ölçülmüyor; hepsi paket testinde duruyor.
6. **Secret taraması bu dilimde ayrıca koşulmadı** — `gitleaks` yalnız `make goals` ve CI'ın kendi
   job'ında koşar; `verify.sh` bakmaz (CLAUDE.md kapı kapsam tablosu).
7. **Sınıf tablosunun akıbet sütunu prose'dur.** Bir sınıfın "KAPANDI" satırı, adlandırdığı
   bulguların kapandığını söyler — o sınıfı ölçen bir predicate olduğunu DEĞİL.
