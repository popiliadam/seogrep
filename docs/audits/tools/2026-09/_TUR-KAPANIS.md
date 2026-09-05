# Tool kontrol turu 2026-09 — TUR KAPANIŞI

> Tarih: 2026-09-05 · Kapsam: **canlı 38 tool'un 38'i**, 7 adımlı protokol (`_SABLON.md`), 6 dilim
> (+ Dilim 0 hazırlık) · Kayıtlar: bu dizindeki 38 `<tool_adı>.md` + altı `_DILIM<n>-KAPANIS.md` +
> beş `_DILIM<n>-HAKEM-SINIFLAR.md` · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> (imzalı, 2026-09-02) · `main` = **`a786cc3`**, canlıda.
> Kural (CLAUDE.md ders 16): bu dosya bir İNDEKSTİR; bir kalem kapandığında kapatan tur onu da günceller.
> **Bu dosya hiçbir kaydın kararını değiştirmez** — yalnız altı kapanış dosyasını yan yana koyar.

## PR aralığı

**#200–#235: 35 merge** (#201 kapatıldı ve #202 ile yeniden açıldı — merge edilmedi).

| tür | adet | PR'lar |
|---|---|---|
| hazırlık (imzalı referans + docs) | 1 | #200 |
| ölçüm (kod yok) | 6 | #202 D1 · #208 D2 · #214 D3 · #220 D4 · #226 D5 · #232 D6 |
| düzeltme (kod) | **22** | #203 #204 #205 #206 · #209 #210 #211 #212 · #215 #216 #217 · #221 #222 #223 #224 · #227 #228 #229 #230 · **#233 #234 #235** |
| kapanış / handoff (docs) | 6 | #207 · #213 · #218 · #219 (handoff) · #225 · #231 |

## Sayılar

| dilim | tool | bulgu | P1 | KAPANDI | KISMEN | AÇIK | ERTELENDİ | İMZA | canlı ✔ |
|---|---|---|---|---|---|---|---|---|---|
| 1 ücretsiz | 12 | 65 | 19 → 19 kapandı | 42 | 1 | 20 | 1 | 1 | 16 |
| 2 crawl + audit | 6 | 63 | 19 → 19 kapandı | 29 | 3 | 21 | 5 | 5 | 5 |
| 3 GSC | 5 | 35 | 9 → 9 kapandı | 15 | 3 | 14 | 1 | 2 | 2 |
| 4 anahtar kelime | 6 | 39 | 9 → 6 kapandı | 18 | 4 | 9 | 4 | 3 | 5 |
| 5 backlink | 6 | 38 | 13 → 11 kapandı | 24 | 1 | 8 | 0 | 5 | 6 |
| 6 rapor + AI | 3 (+1 çapraz) | 28 | 8 → 6 kapandı | 17 | 2 | 4 | 0 | 4 | 5 |
| **TOPLAM** | **38** | **268** | **77 → 70 kapandı** | **145** | **14** | **76** | **11** | **20** | **39** |

Ek: 1 bulgu **ÇÜRÜTÜLDÜ** (Dilim 4, A-8) ve 1 satır **bilgi** (Dilim 6, AVC-6); toplam 268 bu ikisiyle
kapanır. Dilim 3'ün iki ek canlı turu sayaca **eklenmedi** — kayıt bunu adıyla söylüyor (ders 11:
sayılmamış bir sayıyı sonradan düzeltmek tuzağın kendisidir).

**P0: tur boyunca 0.** Kapanmayan 7 P1, adıyla: **İMZA** → `discover_keywords` DK-1 · `disavow_candidates`
DC B-1 · `ai_visibility` AV-4. **KISMEN'lerin imza yarısı** → `discover_keywords` DK-2 (sıralama) ·
`my_pages` A-3 (enum) · `analyze_backlinks` AB-1 (varsayılan `limit`) · `ai_visibility` AV-3 (doktrin).
Yani **kapanmayan her P1 bir kod işi değil, bir İNSAN KARARIDIR** — hiçbiri "yapılamadı" diye açık değil.

**76 AÇIK kalemin hepsi P2'dir ve hepsi aynı cümleyle kapanır: "iş emrine hiç girmedi."** Ölçüldü, kayda
geçti, düzeltilmedi. Bu bir eksiklik değil bir SEÇİMDİR ve burada sayısıyla durur.

## Kredi ve para

| | |
|---|---|
| Bakiye | **4519 → 2347** (defter `get_credit_balance`, 2026-09-05 07:24 UTC) = **Δ 2172 kredi** |
| Dilim payları | D1–D3 ≈ 367 · D4 **620** · D5 **780** · D6 **315** |
| Fiyat değişikliği | **YOK** — 22 düzeltme PR'ının `credits/costs.ts` diff'i **boş** (her dilimde ayrı ayrı ölçüldü, NEVER#6) |
| Vendor (DFS) | günlük $3 tavanı hiç aşılmadı; ölçülen en yüksek gün **$0,149** (2026-09-04). Tavan bugün de **TAHMİNLE** sayılıyor (sınıf D4-9) |

**Defter mutabakatı (şef, 2026-09-05 07:24 UTC):** dilim toplamlarının aritmetiği **2082** + Dilim 6 kapanış turunun K canlısı (**90**, deploy `a786cc3`) = **2172** = defterin Δ'sı (4519 → 2347). Fark **yok**; önceki taslaktaki "30 kredilik fark" şefin bayat bir ara toplamından (2467) kaynaklanıyordu — defter tek gerçek.

## Sınıfların dilimler arası tekrarı

Kaynak: beş `_DILIM<n>-HAKEM-SINIFLAR.md`'nin **akıbet** sütunları. "Tekrar", sınıfın **ayrı dilimlerde
bağımsız olarak yeniden ölçülmesidir**; bulgu sayısı değildir.

| sınıf | kaç dilim | son durum |
|---|---|---|
| **Kart + `structuredContent` yok** (D4-7) | **5** (D2·D3·D4·D5·D6) | **ERTELENDİ → kart dilimi.** `CARDED_TOOLS` `a786cc3`'te hâlâ yalnız `get_credit_balance` |
| **NEVER#4 kiracı ZİNCİRİ pinsiz** (D4-1/2) | **4** (D3·D4·D5·D6) | **KAPANDI #233 — turun TEK `goals/` hedefiyle.** Dört dilim "AÇIK" yazdı; ölçüldüğü turda kapandı |
| **Referans satırı yapısal olarak karşılıksız** (D4-10) | **4** (D3·D4·D5·D6) | **İMZA** — şerhler işlendi, **hiçbir satır silinmedi**; "şerh mi kalıcı düzeltme mi" açık |
| **Açık DFS rezervasyonu / NEVER#5** (DK-3) | **3** (D4·D5·D6) | **KISMEN:** 11 + 2 port kapandı (#224, #227, #234); **vendor fiyatıyla kapatma doktrini İMZA'da** |
| **Ücretli çağrı ABD/İngilizce varsayılanını sessizce uyguluyor** (D4-4) | **3** (D4·D5·D6) | **KAPANDI #223 · #228 · #234** — üye sayısı üç dilimde 4 → 5 → 6 oldu; **varsayılan hiç değişmedi** |
| **Google core/spam update takvimi okunmuyor** (D3-7) | **3** (D3·D5·D6) | **KISMEN:** `analyze_content_decay` (#217) ve `generate_report` (#233 + canlı ✔); `backlink_changes` B-1 ve `compare_competitors` C-2 **İMZA'da** |
| **Basılan ≠ faturalanan / iki ayrı popülasyon tek yüzeyde** (D4-3/8) | **3** (D4·D5·D6) | **KISMEN** — BD-4 ve H-5'in yarısı AÇIK |
| **`plan.mjs` EXCLUDED gerekçesi bayat** (D4-6) | **3** (D3·D4·D5) | **KAPANDI #228 — ama PROSE.** Dilim 6'da tekrar ETMEDİ (dördü de bağımsız okundu); kapı hâlâ yalnız BOŞ gerekçeyi reddediyor |
| **"Proje bulunamadı" için kendi cümlesi** (D1-S6) | **3** (D1·D5·D6) | **KAPANDI #203 · #233** |
| **`dfs_spend` tahmin ile gerçeği ayırmıyor** (D4-9) | **2** (D5·D6) | **ERTELENDİ → operatör kuyruğu** (`status='failed'` migration'ı) |
| **Kaynak yorumu ölçülünce yanlış çıkıyor** (D5) | **2** (D5·D6) | **KISMEN #228 · #234**; AVC-5 AÇIK. **Yorumları ölçen kapı yok** |
| **Teşhis/hüküm ölçülmeden yazıldı** (D6-yeni-A) | **2** (D5 düzeltme sütununda · D6 teşhis sütununda) | **CLAUDE.md DERS ADAYI** (aşağıda) |

Üç satırın ortak dersi tek cümledir: **prose bir sınıfı ne açar ne kapatır.** Dört dilim "AÇIK" yazan
sınıf ölçülünce gerçekten açıktı (D4-1/2); üç dilim "bayat" yazan sınıf ölçülünce bayat değildi (D4-6).
Aradaki farkı yaratan şey kaydın ısrarı değil, **ölçüm**.

## Kapıların ÖLÇMEDİĞİ — tur geneli

1. **`goals/` tur boyunca BİR kez genişledi** (#233, `tenant-scope-service-reads`). Beş dilim boyunca
   hiçbir düzeltme PR'ı `goals/` altına dosya eklemedi — her dilimde ayrı ayrı ölçüldü. Yani kapanan
   145 bulgunun **1'i** bir predicate'e bağlıdır; geri kalanı birim testlerine ve prose'a.
2. **`make verify` secret taraması ve DB şeritlerini koşmaz** (CLAUDE.md kapı tablosu). `*.db.test.ts`
   iddiaları tur boyunca yalnız CI `verify-db`'de koştu; işçi ve hakem hiçbir dilimde koşmadı.
3. **Hakem canlı MCP yüzeyine tur boyunca erişemedi** (seogrep 404). Bütün canlı iddialar işçilerin ham
   `jsonl`'i, `list_credit_activity` defteri ve şefin sondaları üzerinden doğrulandı — **üçüncü bir
   bağımsız okuma yok.**
4. **Sınıf tabloları prose'dur.** Bir sınıfın "KAPANDI" satırı, adlandırdığı bulguların kapandığını
   söyler; o sınıfı ölçen bir predicate olduğunu değil.
5. **Referans şerhleri metindir** (D4-10, dört tekrar): hiçbir kapı bir referans satırının hâlâ
   karşılığı olup olmadığını ölçmüyor.
6. **`plan.mjs` gerekçelerini hiçbir kapı ölçmüyor** — sweep öz-testi yalnız BOŞ gerekçeyi reddeder.
7. **DFS günlük tavanı tahminle sayılıyor** (D4-9): 4,5× ve 3,8× sapmalar ölçüldü, düzeltilmedi.
8. **Kart ekseni hiç ölçülmedi** — beş dilim ertelendi; `structuredContent` bugün 38 tool'un 37'sinde yok.

## Operatöre TEK imza listesi (kod yazılmaz — insan imzalamadan kural olmaz)

Altı kapanış dosyasının imza tabloları birleştirildi. **Hiçbiri bloke etmiyor.**

| # | kalem | kayıt | dilim |
|---|---|---|---|
| 1 | Tavsiye kataloğu donmuş: 38 tool'un 22'si `whats_next` merdiveninde hiç anılmıyor | `whats_next` F-1 | 1 |
| 2 | `You were not charged.` cümlesi 0-kredilik tool'da anlamsız güvence veriyor | `untrack_project` UP-2 (yarısı) | 1 |
| 3 | İş-kuralı reddinde `isError` bayrağı yüzey genelinde tek kurala bağlansın | `whats_next` F-5 (kuyruğa hiç girmedi) | 1 |
| 4 | Ölçümün üçüncü taraf sağlayıcıdan geçtiğinin tool metninde söylenmesi | `track_keywords` F-9 (kuyruğa hiç girmedi) | 1 |
| 5 | **Özdeş denetimin ücretsiz tekrarı ya da `confirm` kapısı — üç audit TEK imzada** | `audit_tech` T-B5b · `audit_schema` S-B5b · `audit_onpage` A-3b | 2 |
| 6 | "You were not charged." ↔ defterdeki `charge`+`refund` çifti (hangi kelime doğru) | `audit_tech` T-B11 · `audit_schema` S-B9 | 2 |
| 7 | `audit_speed` mobil ekseni (`for_mobile`) — vendor maliyetini ×2 yapar | `audit_speed` B-9'un uzun vadeli yarısı | 2 |
| 8 | `find_quick_wins` sıralama politikası | `find_quick_wins` B-1b | 3 |
| 9 | `keyword_positions` ücretsiz kapının `not_measured` hâli | `keyword_positions` F-7 | 3 |
| 10 | `discover_keywords` 100.000 hacim tavanı (**iki ayrı canlı ölçümde de işlevsiz**) | `discover_keywords` DK-1 — **P1** | 4 |
| 11 | `discover_keywords` deterministik kova-içi sıralama (pinli "does not re-order" vaadiyle çelişir) | DK-2 ikinci yarı — **P1'in yarısı** | 4 |
| 12 | `my_pages` `item_types` enum daraltma + "failed unexpectedly" metni | `my_pages` A-3 — **P1'in yarısı** | 4 |
| 13 | `my_pages` ADI | `my_pages` A-7 | 4 |
| 14 | `costs.ts:60` gerekçe bloğu (**rakam DEĞİŞMEZ**) | `ranked_keywords` B-4 | 4 |
| 15 | Kısmi başarısızlıkta fiyat politikası (**önce birim testiyle ÖLÇ**) | `serp_snapshot` S-6 | 4 |
| 16 | Prod'daki bayat `Turkey` serisi (dentnotion) — veri kararı | `serp_snapshot` S-3 | 4 |
| 17 | **Disavow politika metni** (manual-action şartı, "çoğu site kullanmaz", Domain property, "haftalar sürer") — `goals/` predicate'iyle | `disavow_candidates` B-1 + B-4 — **P1; turun en riskli metin kalemi** | 5 |
| 18 | `analyze_backlinks` varsayılan `limit` 1000 düşürülsün mü | `analyze_backlinks` AB-1 — **P1'in yarısı** | 5 |
| 19 | `ESTIMATED_BACKLINK_PROFILE_CALL_USD = 0.3` (gerçek 0,0783 — **3,8×**) | `analyze_backlinks` §4 | 5 |
| 20 | `backlink_changes` / `compare_competitors` takvim bağlama cümlesi (**sıra: önce pencere tarihlenir**) | BC B-1 · C-2 | 5 |
| 21 | `compare_competitors` keşif modu hiç karşılaştırma basmıyor | C-6 | 5 |
| 22 | NOFOLLOW markerlarının "Google does not count" düz iddiası (Google 2019'dan beri **hint** diyor) | `link_gap` + main'deki `NOFOLLOW_ONLY_MARKER` | 5 |
| 23 | **AV-3 doktrin yönü:** vendor'ın $0 reddi bugünün bütçesini serbest bırakır mı — **14 port TEK kural ister** | `ai_visibility` AV-3 · H-9 — **P1'in yarısı** | 6 |
| 24 | **AV-4 / H-5 fiyat doktrini:** 5,58× marj hesabı `MAX_INTERNAL_LIST_ROWS = 100` varsayımına dayanıyor; ölçülen faturalanan satır **≈1**, o çağrıda marj **≈22×** | `ai_visibility` AV-4 · `ai_visibility_compare` H-5 — **P1** | 6 |
| 25 | **H-1 lokal ürün kararı ONAYI:** `chat_gpt` için lokal alanların **sert ret** hâli UYGULANDI (#234) ve canlıda doğrulandı — operatör onayı geriye dönük isteniyor | `ai_visibility` AV-1/H-1 | 6 |
| 26 | `ai_visibility_compare` "cevapsız bir hedef de tam fiyat ödetir" cümlesi | AVC-3 | 6 |
| 27 | `generate_report`'un GSC rakamlarının AI yüzeylerini kapsayıp kapsamadığı + `ai_visibility`'ye yönlendirme | GR-5 | 6 |
| 28 | `ai_visibility` crawler-token cümlesi (`OAI-SearchBot`) — **iki yönlü**: bugün risk karşılıksız, liste eklenirse bayatlama riski açılır | AV-7 | 6 |
| 29 | **Referans şerhleri** — "şerh mi kalıcı düzeltme mi" (D4-10, dört tekrar) | dört dilimin §5'leri | 3–6 |
| 30 | **Rakip domain** — `link_gap` / `keyword_gap` hâlâ elle girdi bekliyor (`compare_competitors` keşfi KISMEN çözdü) | tur geneli | 4–5 |

**Operatör kuyruğu (kod değil; ortam/veri/migration):** `dfs_spend.status='failed'` migration'ı ·
`dfs_spend` kaynak kolonu · M-08 prod migration journal (0022–0033) · `jobs` kısmi benzersiz indeksi ·
prod'daki açık `relevant_pages` rezervasyonu · **`google` için LLM Mentions lokal listesinin
cache'lenmesi** (ayrı iş; bugün `checkLocationName` SERP listesine karşı doğruluyor) ·
`plan.mjs`'in `ai_visibility` EXCLUDED gerekçesinin H-1 sonrası güncellenmesi · `locations.ts` ret
metninin AI bağlamında "paid search" demesi (tool adı parametresi) · **`pseo-wt/` altındaki 60+
worktree temizliği (silme = operatör onayı)**.

## CLAUDE.md ders adayları (imzasız — insan imzalamadan kural olmaz)

1. **Canlı bir vendor reddi, (1) vendor dokümanı okunmadan ve (2) en az BİR karşı-değer denenmeden, P1
   bir teşhisle kayda girmez.** Reddin kendisi bir olgudur; *neden* reddedildiği bir hipotezdir.
   Vaka: `ai_visibility`'nin iki denemesi de `chat_gpt` + ABD-dışı lokaldi; kayda "alanlar vendor
   şemasında yok, kaldırılmalı" yazıldı; vendor dokümanı alanları yayımlıyor ve `google` **92 lokasyon**
   taşıyor. Teşhis uygulansaydı **çalışan bir ekseni üründen silecekti.** (Dilim 6, D6-yeni-A;
   ders 11 + 13'ün teşhis katmanı.)
2. **Şefin iş emrine yazdığı olgu iddiası da bir hipotezdir ve işçi onu ölçmeden kullanmaz.** Dilim 5'te
   iki kez ölçüldü: `compare_competitors` "keşif yok, zorunlu" (yanlıştı — C-5) ve `audit_speed`
   "bu turda ücretli koşulmadı" (yanlıştı — hakem G'yi bu yüzden FAIL etti). İş emri bir bağlamdır,
   bir ölçüm değildir.
3. **Kardeş PR'lar tek update-branch turunda güncellenir ve tool başına ayrı commit tutulur.** Dilim 4'te
   dört paket üst üste BEHIND kaldı; auto-merge bu depoda kapalı ve çakışan PR'da Actions hiç koşmaz,
   yani teker teker güncellemek her seferinde CI'ı sıfırlar. (Mekanik ders; `_DILIM4-KAPANIS.md`.)

## Ne KAPANMADI — tek bakışta

- **7 P1** (hepsi insan kararı: 3 İMZA + 4 KISMEN yarısı) · **76 P2 AÇIK** (hiçbiri iş emrine girmedi).
- **Kart dilimi** (D4-7, beş tekrar) — `CARDED_TOOLS` tek tool.
- **30 imza kalemi** (yukarıdaki tablo) + dokuz kalemlik operatör kuyruğu.
- **Ödenek/deploy sonrasına kalan canlı ölçümler:** `ai_visibility` `google` + `"Turkiye"` (90 kr, #235'in
  tek canlı hücresi) · `ai_visibility_compare` (180–900 kr, tur boyunca hiç koşulmadı) ·
  `disavow_candidates` (40 kr, kasten) · `ranked_keywords` (65 kr) · `keyword_gap` (45 kr) ·
  `generate_report`'un kısmi-veri dalları (özne üretilmeli).
