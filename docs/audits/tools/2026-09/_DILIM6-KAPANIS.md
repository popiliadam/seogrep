# Dilim 6 kapanışı — 3 tool + 1 çapraz atıf, 28 bulgu (rapor + AI ailesi)

> Tarih: 2026-09-05 · Tur: tool kontrol turu 2026-09 (SON DİLİM) · Kayıtlar: bu dizindeki
> `generate_report.md`, `ai_visibility.md`, `ai_visibility_compare.md` ve `whats_next.md`
> (yalnız Dilim 6 çapraz-atıf eki — tool Dilim 1'de ölçülmüştü, yeniden ölçülmedi).
> Kural (CLAUDE.md ders 16): bir kalem kapandığında **kapatan tur** kaydı da günceller. Bu dosya
> indekstir; her satırın ayrıntısı kendi kaydındaki `durum (kapanış, 2026-09-05)` sütunundadır.
> Her hücre ya bir PR numarasıyla ya da `AÇIK / ERTELENDİ / İMZA KALEMİ — neden` ile biter.
> Ölçüm PR'ı: **#232** (`b77b881`). Kapatan PR'lar, merge sırasıyla: **#233** paket J (`1030e8b`) ·
> **#234** paket I (`d367875`) · **#235** paket K (`a786cc3`). Üçünün de CI'ı yeşil (flake rerun'larıyla —
> kalıcı tuzak `verify-db-ci-flake`). Taban: `main` **`a786cc3`**, canlıda.
> **#235 bu turda DOĞDU:** şefin #234 sonrası canlı sondası **H-10'u** buldu (`google` + `"Turkey"`),
> aynı gün ölçüldü, düzeltildi, hakemden PASS aldı ve merge edildi.

## Sayılar

| | adet |
|---|---|
| Bulgu (4 kayıt toplamı) | **28** (11 + 6 + 11 + 0) — `ai_visibility` 11 (**H-10 dahil**; geri çekilen AV-2 sayılmadı) · `ai_visibility_compare` 6 (AV-1'e katlanan AVC-2 sayılmadı) · `generate_report` 11 (**depo geneli H-3 dahil**) · `whats_next` **0 yeni** (ek, ayrı numara açılmadı) |
| P0 | 0 |
| P1 | **8** (hakem bandı sonrası) — **6'sı KAPANDI** (AV-1/H-1, GR-1, GR-2, GR-3, H-3, H-10), 1'i **KISMEN** (AV-3), 1'i **İMZA** (AV-4) |
| KAPANDI | **17** |
| KISMEN | **2** (AV-3 doktrin yarısı · H-5 "0 satır ≠ faturalanan satır" yarısı) |
| AÇIK | **4** — dördü de `PR'da karşılığı bulunamadı`: AV-9 · AV-10 · AVC-5 · GR-10 |
| İMZA KALEMİ | **4** (AV-4 · AV-7 · AVC-3 · GR-5) — H-5'in fiyat yarısı AV-4 ile TEK kalem |
| ERTELENDİ | **0 bulgu düzeyinde** — erteleme SINIF düzeyindedir (kart 4/4 → kart dilimi; `dfs_spend` → operatör kuyruğu) |
| bilgi satırı | 1 (AVC-6 — "doğru çalıştığı ölçülenler") |

`canlı ✔` işaretli bulgu sayısı: **6** — H-10 (deploy `a786cc3`, şef sondası 07:24 UTC: google+"Turkey" ücretsiz ret, google+"Turkiye" −90 vendor kabul); GR-3, GR-4 (R-7.11), GR-6, GR-7 (deploy `1030e8b`, şef sondası
2026-09-05 06:26 UTC, 15 kr, dentnotion) ve **AV-1/H-1** (deploy `d367875`, 06:47 UTC, adstark).
**#235'in (K) canlı yarısı YOKTUR** — `google` + `"Turkiye"` mutlu yolu (90 kr) deploy `a786cc3` sonrası
şefin ayrı ölçümünde; H-10 hücresi bu yüzden `canlı ✔` **almadı**.

## Tool tablosu

| tool | karar (kapanış) | kapatan PR'lar | canlı doğrulama | açık kalemler |
|---|---|---|---|---|
| `generate_report` | **KAPANDI** — 9 bulgu kapandı (üç P1 + depo geneli H-3 dahil) | #233 (GR-1, GR-2, GR-3, GR-4, GR-6, GR-7, GR-8, GR-9, H-3) | **✔ dört bulgu** (15 kr, dentnotion): takvim cümlesi çürüme listesinin üstünde · `Position is Google's AVERAGE over the analyzed window …` · `… nested nodes included — a type such as ListItem or GeoCoordinates …` · `… the intermediate hops of a chain are never crawled pages …` | **GR-5 İMZA** (R-7.12 / AI yüzeyi) · **GR-10 AÇIK** (kısmi-veri dalları; özne üretilmeli) |
| `ai_visibility` | **KAPANDI** — 6 bulgu kapandı; **1 YENİ bulgu canlıda doğdu ve aynı gün kapandı** | #234 (AV-1/H-1, AV-5, AV-6, AV-8, H-2, H-9) · **#235 (H-10)** | **✔ AV-1/H-1 — iki hücre birden:** `chat_gpt` + `"Turkey"` **ücretsiz ret** (defterde satır yok) ve `chat_gpt` + `" united states "` **mutlu yol, ürün tarihinde ilk kez** (−90, iade yok) | **AV-3 KISMEN** (doktrin İMZA) · **AV-4 · AV-7 İMZA** · **AV-9 · AV-10 AÇIK** · H-10 canlıda ölçülmedi |
| `ai_visibility_compare` | **KISMEN DÜZELTİLDİ** — 2 bulgu + katlanan AVC-2 kapandı; **tool canlıda hiç koşulmadı** | #234 (AVC-1, AVC-4, AVC-2'nin AV-1'e katlanan yarısı) · #235 (lokal doğrulaması bu uçta da) | **YOK — 180–900 kredi**; hakemin şart koştuğu ikinci canlı hücre ölçülmedi | **AVC-3 İMZA** · **H-5 KISMEN + İMZA** · **AVC-5 AÇIK** · AVC-4'ün keyword ekseni açık |
| `whats_next` (çapraz atıf) | **DEĞİŞMEDİ** — Dilim 1'de kapanmıştı; ek yalnız iki iddiayı taşıyordu | — (#233 diff'inde `whats-next` **0 eşleşme**) | — (0 kredi, ölçüm turunda) | D3-7 için **KAPSAM DIŞI** kararı korundu · F-1 hâlâ **İMZA** · Dilim 1'in altı P2'si açık |

**PR'da karşılığı BULUNAMAYAN bulgular** (üç PR'ın gövdesi ve `gh pr diff` çıktısı tek tek arandı;
"düzeltilmedi" demek değil, **iş emrine hiç girmedi** demektir):

| bulgu | ölçüm |
|---|---|
| `ai_visibility` AV-9 (aile düzeyinde "historical uç yok" okunuşu) | `historical` deseni #234 ve #235 diff'lerinde **0 eşleşme** |
| `ai_visibility` AV-10 (adaptörün ilan ettiği alan vendor şemasında var mı — `goals/` hedefi) | #234 diff'inde `^+++ b/goals/` **0 eşleşme**; turun tek `goals/` hedefi #233'ün kiracı kapsamıdır. **H-10 bu boşluğun ikinci canlı bedelidir** |
| `ai_visibility_compare` AVC-5 (`reserve.test.ts` başlığındaki tarihsel ölçüm iddiası) | `reserve.test` ve `2402 specs` desenleri iki diff'te **0 eşleşme** |
| `generate_report` GR-10 (`plan.mjs`'e üçüncü hücre: kısmi-veri dalı) | `plan.mjs` #233 diff'inde **0 eşleşme**; özne ÜRETİLMESİ gerekiyor |
| `ai_visibility_compare` H-5'in yarısı ("0 rows" ↔ faturalanan satır ayrı ölçümlerdir) | #234'ün eklediği fiyat cümleleri **lokal reddi** hakkında; `0 rows came back` yanına ayrı-ölçüm cümlesi eklenmedi |

## On dört sınıfın akıbeti

Ayrıntı: `_DILIM6-HAKEM-SINIFLAR.md`'nin artık dolu **akıbet** sütunu. Özet: **6 KAPANDI · 4 KISMEN ·
2 ERTELENDİ · 1 İMZA · 1 bu dilimde tekrar etmedi (D4-6)**.

Bu dilimin iki kayda değer satırı:

- **D4-1/2 (NEVER#4 kiracı zinciri) dört dilim boyunca "AÇIK" yazıyordu ve bu turda ölçülünce gerçekten
  pinsiz çıktı** — sonra da **turun TEK `goals/` hedefine** bağlandı (#233). Prose ne kapatır ne açar;
  yalnız kaydeder. Sınıfın kapanışı, onu ölçen bir predicate doğduğu gün oldu.
- **D6-yeni-A (teşhis ölçülmeden yazıldı) hem kapandı hem kendini tekrar etti.** Hakemin "hipotez" dediği
  teşhis canlıda doğrulandı (iki hücre), ve **aynı sonda sınıfın yeni bir örneğini üretti**: #234'ün
  `google` dalı değeri doğrulamadan geçiriyordu, çünkü "vendor listesi elimizde yok" varsayılmıştı —
  oysa liste **Dilim 3 F-8'den beri depoda** duruyordu (`dfs/locations.ts`). Bir düzeltmenin kendi
  gerekçesi de bir hipotezdir (Dilim 5'in BD-8 dersi, ikinci kez ve farklı eksende).

## Hakem hükümleri ve sapmaları (adıyla)

Ölçüm turu: taze **sert Fable** — **2/4 PASS · 1/4 PASS-şerhli · 1/4 dar FAIL**. Üç düzeltme paketinin
üçü de taze Fable hakemden geçti (**I ilk turda dar FAIL → follow-up ile PASS**).

| paket | hakem hükmü / sapma |
|---|---|
| **ölçüm (#232)** | `ai_visibility` **dar FAIL** — ölçülen olgular doğru, **teşhis ölçülmeden yazılmış** (D6-yeni-A). Kayıt düzeltilerek kapandı: AV-1 gövdesi yeniden yazıldı (H-1), **AV-2 GERİ ÇEKİLDİ**, AV-8 daraltıldı (H-4), AV-7 AYKIRI → İLGİSİZ; yeni **H-2** (D4-4 altıncı üye), **H-3** (depo geneli, NEVER#4), **H-5**, **H-6** (bütçe sapması: ≤1 ücretli çağrı tavanına karşılık vendor'a 2 çağrı, $0,60 ödenek), **H-9** (lighthouse). **İki hakem-eki mutasyon kayıt iddiasını yanlışladı/genişletti** (HM2b kırmızı → AV-8 daraldı; HM9 yeşil → H-3 doğdu) — ikisi de plandaki mutasyon listesinde yoktu |
| **J (#233)** | **PASS.** 8 karşı-mutasyon kırmızı (db.ts filtre → 2 + goal FAIL · GR-2 · `throw`→`return` → 2 · overlap null / renderer boş · position note · eski cümle → 2 · iki ipucu). NEVER#8: 3 silinen satır **sıkılaştırma**. Şerh (P3): `html.test.ts` ListItem/GeoCoordinates iddiası **zayıf** (canlı öznenin tip listesine bağlı). GR-5/GR-10 imza/kapsam olarak dışarıda bırakıldı — hakem bunu onayladı |
| **I (#234)** | **İlk turda dar FAIL → follow-up (F-1..F-5, F-7; 6 commit ≤20 satır) → PASS.** 12 karşı-mutasyon kırmızı. Sapmalar: **iki commit 284/336 satır → NEVER#10 sapması** (bölünebilirdi; ara commit'te `gen-tool-docs --check` kırmızıydı, F-6). Doktrin: **fiyatlı vendor reddi dalına DOKUNULMADI** — hakem hükmü, AV-3'ün insan kararı olduğu |
| **K (#235)** | **PASS.** 5 karşı-mutasyon kırmızı; dist'ten **9 senaryo `run()` sondası** (port erişimi 0 ret yolunda). **NEVER#8 hükmü adıyla:** iki spec'in `"Turkey"` karşı-değeri kusuru kodluyordu → iddia `"Turkiye"`/`"France"` ile **korunup genişletildi**, silinen `expect` yok. Küçük kalem: ret metni `locations.ts`'ten geliyor ve AI bağlamında **"paid search"** diyor |

## Kredi ve vendor

| kalem | kredi | not |
|---|---|---|
| Ölçüm turu (2026-09-04) | **−210** | `ai_visibility_compare` −180 (2 hedef, iade yok) + `generate_report` 2 × −15; `ai_visibility` iki denemesi **net 0** (charge+refund) |
| J canlı sondası (2026-09-05 06:26 UTC) | **−15** | dentnotion raporu, dört bulgu `canlı ✔` |
| I canlı sondası (06:47 UTC) | **−90** | `chat_gpt` + US/en mutlu yol; `google` + Turkey **−90/+90** (net 0, H-10); `chat_gpt` + Turkey **ücretsiz** |
| **Dilim 6 toplamı** | **−405** | **Bakiye 2347** (defter, 2026-09-05 07:24 UTC) — ölçüm 210 + J canlı 15 + I canlı 90 + K canlı 90 |

**Vendor:** ölçüm günü toplam **$0,149** (compare 0,101 + `ai_visibility` 2 × 0 + Dilim 5 sondası 0,0484);
2026-09-05'te 2 `aggregated_metrics` isteği (biri vendor 40501 ile reddedildi, **$0,30 ödenek** yandı — H-10).
**Hiçbir kredi fiyatı, marj ya da paket rakamı değişmedi** (NEVER#6): üç PR'ın `credits/costs.ts` diff'i
**boş**, ölçüldü. `dfs/locations.ts` diff'i de boş (`KNOWN_LOCATIONS`'a satır eklenmedi — NEVER#7).

**Defter mutabakatı (şef):** Dilim 5 sonu 2752 → −210 ölçüm = 2542 → −15 J canlı = 2527 → −90 I canlı = 2437 (06:47 UTC, `get_credit_balance` ile okundu) → −90 K canlı = **2347**. Fark yoktu; taslaktaki 2467/"30 kredi" şefin bayat ara toplamıydı (ders 12 analoğu: kendi toplamın değil defter).

## Kapıların ÖLÇMEDİĞİ — bu kapanışın sınırları

Ders 7: yeşil kapı NE ölçtüğüyle raporlanır.

1. **`ai_visibility_compare` canlıda hiç koşulmadı** (180–900 kredi). AVC-1'in reddi, AVC-4'ün fan-out
   şerhi ve AVC-2'nin lokal doğrulaması bu uçta **yalnız birim testi** düzeyinde kanıtlı.
2. **H-10'un mutlu yolu (`google` + `"Turkiye"`) ölçülmedi** — vendor'ın o lokal için veri döndürdüğü
   bugün bir **varsayımdır**; `checkLocationName` yalnız SERP listesine karşı doğruluyor ve
   **`language_code` hiç kontrol edilmiyor** (bu, kodda pinli bir dürüstlük notudur).
3. **`*.db.test.ts` şeritleri işçi/hakem tarafından koşulmadı** (Docker); CI `verify-db`'de koştu.
   `generate-report.db.test.ts`'in slug çakışması / `reports insert failed` / `revokeReportLink`
   dalları bu turda hiç sınanmadı.
4. **`make verify` secret taraması ve DB şeritlerini koşmaz** (CLAUDE.md kapı tablosu). `gitleaks`
   yalnız CI'da ve `make goals`'ta.
5. **Sınıf tablosunun akıbet sütunu prose'dur** — bir sınıfın "KAPANDI" satırı, adlandırdığı bulguların
   kapandığını söyler, o sınıfı ölçen bir predicate olduğunu DEĞİL. Bu turda predicate doğan **tek**
   sınıf D4-1/2'dir.
6. **Kart ekseni (D4-7) bu dilimde de ölçülmedi ötesinde bir şey yapılmadı** — `CARDED_TOOLS` `main`
   `a786cc3`'te hâlâ yalnız `get_credit_balance`.
7. **Hakem canlı MCP yüzeyine erişemedi** (seogrep 404, tur boyunca); canlı iddialar işçilerin ham
   `jsonl`'i + `list_credit_activity` defteri + şefin sondası üzerinden doğrulandı.
8. **AV-3'ün doktrin çatışması bugün de yürürlükte:** `budget.ts:194-201` ile `llm-mentions`'ın fiyatlı
   red dalı zıt iddiada, ve bunu ölçen hiçbir kapı yok.
