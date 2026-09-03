# `serp_snapshot` — tool kontrol kaydı (2026-09 turu)

> Dilim: 4 · İşçi: Opus 5 · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
>
> **Bu kayıt Dilim 3'ten üç kalem DEVRALIR ve bugünkü hâllerini yeniden ölçer:** F-5 (P1, ödenen SERP
> verisinin okunamaması), F-8 (P2, vendor'ın reddettiği lokasyon adı), F-10 (P2, `ranked` dalının hiç
> ölçülememesi). Kaynak: `docs/audits/tools/2026-09/keyword_positions.md:212,215,217`. Devralınan
> numaralar §"Devralınan kalemler"de kendi bulgu numaralarıyla (S-1, S-3, S-4) yeniden ölçülmüştür.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | 5+8/kw fiyatı `CREDIT_UNITS`+`TOOL_COSTS`'ta ayrı ayrı; `MAX_SERP_KEYWORDS` şemaya port'tan giriyor; depth/engine pinli |
| 2 Mutasyon | ÖLÇÜLDÜ | 8 mutasyon → **7 KIRMIZI, 1 YEŞİL KALDI** (S-2: sıralayan URL'i basan tek yüzey pinsiz) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 7 senaryo, 7 ücretsiz ret, defterde 0 satır; "Turkey" ve "Türkiye" ikisi de "Turkiye" öneriyor |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (21+21). **`ranked` dalı ürün tarihinde İLK KEZ üretildi ve okundu** |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-8.5 kısmen UYUYOR (enum yok → tip düşmüyor) · R-8.4 AYKIRI · R-5.5 AYKIRI · R-8.6/R-8.3 İLGİSİZ · R-6.5 UYUYOR |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:25` → `"list"`; `CARDED_TOOLS`'ta DEĞİL |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | kayıt ✔ · `plan.mjs` EXCLUDED (gerekçesi BAYAT) · `goals/` gerekmiyor |

**Karar (ölçüm turu, 2026-09-03):** DÜZELTME GEREKLİ — tool artık gerçek `ranked` ölçümü üretiyor
(F-10 kapandı, kök neden kapandı), ama parası ödenen SERP özellik verisi (`item_types`, AI Overview
dahil) hiçbir yüzeyden okunamıyor ve onu basan tek yüzey (sıralayan URL) hiçbir testle pinli değil.

**Karar (kapanış, YYYY-MM-DD):** _(düzeltme dalgası doldurur; ölçüm turunun kararı silinmez)_

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/serp-snapshot.ts:189` (`makeSerpSnapshotTool`); port `apps/mcp/src/dfs/serp.ts:912`
  (`createLiveSerpSnapshotClient`); yazıcı `apps/mcp/src/tools/serp-snapshot-store.ts:222`; biçimlendirici
  `apps/mcp/src/tools/serp-snapshot-format.ts:118`.
- Zod şeması: `target` · `project_id` · `keywords` (`array(string().min(1))`, `.min(MIN_SERP_KEYWORDS=1)`
  `.max(MAX_SERP_KEYWORDS=10)` — **sayılar port'tan import**, şemada literal yok) · `location_name`
  (default `"United States"`) · `language_code` (default `"en"`) · `device` (`enum(SERP_DEVICES)` =
  `["desktop","mobile"]`, default `"desktop"`). `additionalProperties:false` (canlı SS-N7 ile doğrulandı).
  **`depth` ve `search_engine` GİRDİ DEĞİL** — ikisi de fiyat kararı, port'ta pinli (`SERP_DEPTH=100`,
  `DFS_SERP_SEARCH_ENGINE="google"`).
- Description (birebir alıntı):
  > "Measure where a domain appears in Google's organic results for up to 10 keywords, on one location, one language and one device, and store each reading so keyword_positions can read it back later. Each keyword is a separate live search at a fixed depth. Three answers are kept apart and never collapsed into a number: found (with DataForSEO's own rank_group and rank_absolute), searched for and not found among the results actually examined, and not measured at all. SeoGrep computes no visibility score and no ranking of its own. Synchronous — everything comes back immediately. Costs 8 credits, charged per keyword, plus a fixed 5 credits per call — one keyword costs 13 and 10 cost 85. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing."
- Kredi satırları (`apps/mcp/src/credits/costs.ts`, birebir):
  - satır 186: `serp_snapshot: 8,`
  - satır 261: `serp_snapshot: { unit: "keyword", base: 5, min_units: 1, max_units: 10 },`
  - toplama tek yerde: `creditsForUnits` (`costs.ts`), tool tarafında `serpSnapshotCredits`.
- Docs sayfası (`apps/web/content/docs/tools-reference/serp-snapshot.mdx`):
  - satır 6 birebir: `**Cost:** 5 credits per call plus 8 credits per keyword — 1 to 10 keywords per call, so 13 to 85 credits.`
  - satır 34 birebir: `A position is a measurement at a moment, not a property of a site. Every reading is taken on **one** search engine, **one** location, **one** language, **one** device and to one fixed depth, and the answer states all of them — Google returns different results and a different layout on desktop and on mobile, so a desktop reading says nothing about a mobile one.`
  - satır 40 birebir: `Nothing here runs on a schedule. A snapshot happens because you asked for one, so no credits are ever spent while you are not looking.`
- Vendor isteği gövdesi (`dfs/serp.ts:521-533`, kelime BAŞINA bir istek):
  `{ keyword, location_name, language_code, device, depth: 100, max_crawl_pages: 10 }`.
  `max_crawl_pages` = `serpMaxCrawlPages(100)` = `ceil(100/10)` = 10, depth'ten TÜRETİLİYOR.
  Uç: `/v3/serp/google/organic/live/advanced` (engine PATH segmenti, gövdede yok).
- Maliyet tahmini: `estimateSerpSnapshotUsd(n) = n × $0.02 × 1.5`; gerçek maliyet **istek başına**
  katlanıyor (`sumSettledSerpCostUsd`) — `cost` alanı olmayan yanıt $0.00 değil KENDİ tahminine yazılıyor.
- Yanıt ayrıştırıcı: `resultSchema` = `{keyword, check_url, datetime, se_results_count, item_types, items}`.
  **`item_types` `z.array(z.string()).nullish()` — enum DEĞİL** (R-8.5 için belirleyici, §5). `items`
  `z.unknown()` olarak okunuyor, sonra `organicItems` **yalnız `type === "organic"`** olanları süzüyor.
- Tutarsızlıklar: **yok** — description'daki 13/85, `costs.ts` 5+8 kuralından TÜRETİLİYOR
  (`serpSnapshotCredits(1)` / `serpSnapshotCredits(10)`), docs satır 6 ile birebir aynı; canlı ölçüm
  2 kelimede tam **21** kredi (5 + 8×2) verdi.
- Seçilebilirlik: "şu kelimelerde şu an kaçıncı sıradayım" cümlesinde seçilir. Karışabileceği komşular:
  `keyword_positions` (aynı veriyi OKUR, ölçmez, 10 kredi — asıl karışma riski), `track_keywords`
  (ücretsiz, yalnız kaydeder), `ranked_keywords` (vendor'ın kendi veritabanından domainin TÜM
  sıralamaları, anlık ölçüm değil), `find_quick_wins` (GSC ortalama pozisyonu — farklı sayı türü).
  Description "and store each reading so keyword_positions can read it back later" diyerek çifti ayırıyor.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Taban: **155 dosya / 4016 test, 0 fail** (`logs/baseline.log`).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M-SS1 | `costs.ts:261` `base: 5` → `4` (imzalı sabit parça) | fiyat aritmetiği | **KIRMIZI** (7) | `costs.test.ts` ×2 + `serp-snapshot.reserve.test.ts` ×3 (13/45/85) + `serp-snapshot.test.ts` ×2 · `logs/m-ss1.log` |
| M-SS2 | `dfs/serp.ts:531` `max_crawl_pages` gövdeden silindi | 2026-08-25 kök neden pini | **KIRMIZI** (3) | `dfs/serp.test.ts > sends max_crawl_pages on EVERY request, derived from the depth` + "asks for enough crawl pages to COVER the pinned depth" + depth pini · `logs/m-ss2.log` |
| M-SS3 | `dfs/serp.ts:693` `vendor_item_types: data?.item_types ?? []` → `[]` (**F-5 ekseni**) | ayrıştırıcı/saklama pini | **KIRMIZI** (2) | `dfs/serp.test.ts > carries the vendor's check_url, echoed keyword and result count…` + `serp-snapshot.test.ts > the stored report…` · `logs/m-ss3.log` |
| M-SS4 | `dfs/locations.ts:70` `canonical: "Turkiye"` bozuldu (**F-8 ekseni**) | lokasyon reddi + öneri | **KIRMIZI** (8) | `locations.test.ts` ×4 + `serp-snapshot.test.ts > refuses a location name DataForSEO does not know, free of charge` + `track-keywords.test.ts` ×3 · `logs/m-ss4.log` |
| M-SS5 | `serp-snapshot-store.ts:172` `project_id: target.projectId` → `null` (kiracı/proje ekseni) | saklama kapsamı | **KIRMIZI** (1) | `serp-snapshot.test.ts > stores project_id when a project resolved it and NULL when a bare target did` · `logs/m-ss5.log` |
| M-SS6 | `dfs/serp.ts:646` organic süzgeci kaldırıldı (featured snippet organic sayılır) | rank ölçeği pini | **KIRMIZI** (6) | `dfs/serp.test.ts > counts ORGANIC items only — a featured snippet's rank_group is on a different scale` + 5 tane daha · `logs/m-ss6.log` |
| **M-SS7** | `serp-snapshot-format.ts:62` sıralayan **URL** çıktıdan silindi (`— ${url}` atıldı) | — | **YEŞİL KALDI** | **4016 passed (4016)** — hiçbir test kırılmadı. `logs/m-ss7.log`. **BULGU S-2** |
| M-SS8 | `serp-snapshot.ts:252` ücret meta'sından `projectId` düşürüldü | H-1 kapsam pini | **KIRMIZI** (3) | `discovery-project-scope.pin.test.ts > 'serp_snapshot' records which project its spend was for (H-1)` + `handler-charge-scope-coverage.pin.test.ts` + reserve pini · `logs/m-ss8.log` |

**7 KIRMIZI / 1 YEŞİL.** Yeşil kalan M-SS7 bir bulgudur (ders 12/13): parası ödenen ve üründe YALNIZ
bu yüzeyde görünen sıralayan URL, hiçbir testin bakmadığı bir satırda duruyor.

Çalışma ağacı sonunda temiz — `git diff --stat` çıktısı: **(boş)**. Geri alma sonrası kapı yeniden
**4016 passed (4016)** (`logs/restore.log`).

`*.db.test.ts` şeritleri (`serp-snapshot.db.test.ts`) Docker ister — **KOŞULMADI, db şeridi CI/hakem**.

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| SS-N1 sıfır kelime | `keywords: []` | 200 / `isError:true` | **0** | zod `Too small: expected array to have >=1 items` |
| SS-N2 11 kelime | 11 elemanlı liste | 200 / `isError:true` | **0** | zod `Too big: expected array to have <=10 items` — cap ŞEMADA, reserve'e ulaşmıyor |
| SS-N3 `location_name:"Turkey"` | + `language_code:"tr"` | 200 / `isError:true` | **0** | `DataForSEO does not know a location called "Turkey". Its own name for that place is "Turkiye" — pass that instead. … This was refused before any search was run. You were not charged.` |
| SS-N4 `location_name:"Türkiye"` | + `language_code:"tr"` | 200 / `isError:true` | **0** | Aynı mesaj, aynı öneri (`"Turkiye"`). Aksanlı biçim `foldKey` ile aynı kanonike düşüyor |
| SS-N5 duplicate kelime | `["adstark","Adstark"]` | 200 / `isError:true` | **0** | `Duplicate keyword "Adstark": it would be scraped and billed twice…` — büyük/küçük harf duyarsız |
| SS-N6 yabancı uuid | `project_id:"9f1c2d3e-…"` | 200 / `isError:true` | **0** | `No project found with id …` — başkasının projesi ile hiç olmayan proje **ayırt edilemiyor** (doğru davranış) |
| SS-N7 bilinmeyen alan | `depth:10` eklendi | 200 / `isError:true` | **0** | `Unrecognized key: "depth"` — depth caller knob DEĞİL, canlıda doğrulandı |

**Defter kanıtı:** yedi ücretsiz retten hiçbiri defterde satır açmadı (negatifler öncesi/sonrası
`595 entries` sabit). charge+refund çifti de yok.

## 4. Canlı mutlu yol

Özne: `adstark.com.tr` (`project_id` e2785bf7-…). Kelimeler prod'da ZATEN izlenen iki Türkçe kelime
(`"adstark"`, `"dijital reklam yönetimi"`), `location_name:"Turkiye"`, `language_code:"tr"` — yeni
`track_keywords` kaydı AÇILMADI.

| senaryo | argüman | envelope | kredi Δ | çıktı özeti |
|---|---|---|---|---|
| SS-P1 desktop | 2 kelime, Turkiye/tr, `device:"desktop"` | 200 / ok | **−21** `project: adstark.com.tr` | `"adstark"` → **RANKED**: `rank_group #1 (rank_absolute 1) — https://adstark.com.tr/`, **77** organic sonuç sayıldı. `"dijital reklam yönetimi"` → absent, **99** sonuç sayıldı. 2 measurement kaydedildi |
| SS-P2 mobile | aynı 2 kelime, `device:"mobile"` | 200 / ok | **−21** `project: adstark.com.tr` | `"adstark"` → **RANKED** `rank_group #1 (rank_absolute 1)`, **75** sayıldı. `"dijital reklam yönetimi"` → absent, **100** sayıldı |

İkinci çağrı için **mobile ekseni** seçildi (aynı kelimeyi tekrar ölçmek yerine): aynı kimliği ikinci kez
faturalamak yeni bilgi vermezdi, oysa cihaz ekseni hem `DEVICE_MEANS` iddiasını sınıyor hem `ranked`
dalının tekrarlanabilirliğini ölçüyor hem de ayrı bir measurement kimliği yaratıyor.

**Bu turun asıl sorusu — `ranked` üretiliyor mu: EVET.**
- 4 ücretli vendor isteği, **0 timeout, 0 `40501 Invalid location_name`**. 2026-08-25'te 3 istekten 3'ü
  başarısızdı (1 × 40501 + 2 × 30 sn timeout).
- Sayılan organic sonuç: **77 / 99 / 75 / 100** — dördü de 10'un ÇOK üstünde, yani `max_crawl_pages: 10`
  vendor tarafından kabul edildi ve depth gerçekten taranmış. `dfs/serp.ts:178-181`'in "ilk çağrı tek
  kelimeyle izlenmeli, `organic_items_examined` 10'un belirgin üstünde olmalı" koşulu **karşılandı**.
- `serp.ts:167`'nin "bu değişikliğin timeout'ları çözdüğü İDDİA EDİLMİYOR" şerhi artık ölçüyle
  desteklenebilir: kontrollü çift hâlâ yok (omitted-key yolu ölçülmedi), ama **bu gövdeyle 4/4 başarı**.
- Cihaz ekseni gerçek: aynı kelime, aynı an, farklı cihaz → farklı sayılan sonuç (77 vs 75, 99 vs 100).
  Description'ın "a desktop reading says nothing about a mobile ranking" cümlesi **hâlâ doğru** ve
  canlıda her iki cihaz için de doğru `DEVICE_MEANS` basıldı.
- "found" / "not found among examined" / "not measured" ayrımı **korunuyor**: absent satırı 99 ve 100'e
  scope'lanmış, depth 100'e değil; hiçbir yerde 0/null pozisyon yok.
- **Vendor `cost` alanı:** `sumSettledSerpCostUsd` ile okunuyor ve `dfs_spend`'e yazılıyor, ama tool
  ÇIKTISINDA vendor maliyeti basılmıyor (tasarım — kredi fiyatı kullanıcının gördüğü tek sayı).
- **`item_types` çıktıda YOK** (aşağıda S-1).

**F-10 kapanışının okuma yarısı** (`keyword_positions`, 10 kredi — iş emri gereği tavan dışı):
`keyword_positions(project_id=adstark, keyword="adstark")` →
`"adstark" on adstark.com.tr — Turkiye · language tr · desktop SERP · google · depth 100 · matched by exact_host_www_stripped`
`2026-09-03T19:39:13.836+00:00 — rank_group #1 (rank_absolute 1), of 77 organic result(s) examined.`
**Ürün tarihinde ilk kez `ranked` bir satır okundu.** Aynı çıktıda **URL yok, item_types yok** (S-1).

**YETKİ ŞERHİ (hakem H-5, 2026-09-03) — bu 10 kredilik çağrı bir bulgu DEĞİLDİR.** Hakem raporu
defterdeki `19:39:50 · -10 credits · charge · keyword_positions` satırını "tavan-dışı çağrı, şef
doğrulamalı" diye işaretledi; **şef cevabı: YETKİLİYDİ.** Çağrı, gap işçisinin iş emrinde adıyla
yazılıydı (birebir): *"serp_snapshot sonrası keyword_positions (10 kredi, TAVANA DAHİL DEĞİL —
şefin Dilim 3 F-10 kapanış yarısı; yalnız ranked üretilmişse)"*. Şart da tutmuştu: `ranked` gerçekten
üretilmişti. Kalem burada **kapanır** — açık bir bütçe sorusu olarak taşınmaz.

**Defter (birebir, dört satır):**
`19:42:16 · -21 credits · charge · serp_snapshot · project: adstark.com.tr`
`19:41:55 · -45 credits · charge · keyword_gap · project: adstark.com.tr`
`19:41:33 · -45 credits · charge · keyword_gap · project: adstark.com.tr`
`19:39:50 · -10 credits · charge · keyword_positions · project: adstark.com.tr`
`19:39:05 · -21 credits · charge · serp_snapshot · project: adstark.com.tr`
Aritmetik **tutuyor**: 5 + 8×2 = 21, iki çağrıda da. Hepsi `project: <domain>` kapsamlı (H-1 UYUYOR).
**Refund yok** — ve bu turda `not_measured` satırı da üretilmedi, yani 2026-08-25'in "vendor tarafı
başarısızsa iade" kararı bu turda **sınanamadı** (S-6).
Defter özeti çağrılar boyunca `across 25 tools` kaldı — `serp_snapshot` 2026-08-25'te zaten defterde
görünmüştü, bu tur onu 26.'ncı tool yapmadı; değişen şey ilk kez **başarılı** servis etmesi.
DFS "daily cap" reddi **görülmedi**.

**Vendor bütçesi — tahmin/gerçek oranı (şef gözlemi Ş-4, hakem turu 2026-09-03; BİLGİ, fiyat kararı
DEĞİL).** Prod `public.dfs_spend` okumasında bu tool'un settle olmuş satırları **tahmin $0,12 →
gerçek $0,056** verdi (kardeşler: `relevant_pages` 0,0765 → 0,0242 · `ranked_keywords` 0,0558 →
0,0247). Kaynaktaki 1,5× güvenlik marjı pratikte **2–3×** fazla ayırıyor; paylaşılan $3/gün
tavanından gerçekte harcanandan iki-üç kat pay bloke ediliyor. Bugünkü toplam vendor harcaması
$0,2459 — tavanın %8'i, yani bugün bağlayan bir sınır olmadı. **NEVER #6'ya dokunmaz:** kredi
fiyatı (5 + 8/kelime), marj ve paket rakamları değişmedi ve değiştirilmesi önerilmiyor.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/ed07ad51-99ee-4158-ba60-03e288098193/scratchpad/dilim4/canli/raw.jsonl` (anahtar `makeRedactor` ile redakte).

## 5. SEO güncelliği

Referans "Tool eşleme" satırı: `serp_snapshot | R-5.5, R-6.5, R-8.3–R-8.7 | En yüksek risk: yeni AI item type'ları (ai_overview_table_element, ai_overview_video_element) tanınmayıp sessizce düşürülmesi`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-5.5 (AI özellikleri **query fan-out** yapar; tek kelimeye bakan ölçüm bunu yakalayamaz) | Çıktı tek kelimeyi tek sorgu olarak ölçüyor ve bunu söylemiyor. `grep -niE "fan.?out" dfs/serp.ts tools/serp-snapshot*.ts` → **0 eşleşme** | **AYKIRI** | Tool zaten "one keyword = one paid search" diyor, ama AI yüzeylerinin alt-sorgulara dağıldığı ve tek-kelime okumasının o davranışı kapsamadığı söylenmiyor → S-5 |
| R-6.5 (Google'a otomatik sorgu ToS ihlali) | Tüm SERP okumaları DataForSEO ucundan (`/v3/serp/google/organic/live/advanced`); üründe Google'a doğrudan otomatik sorgu yok | **UYUYOR** | `dfs/serp.ts:103` tek uç; `transport` dışında ağ çağrısı yok |
| R-8.3 (JSON sonuç 30 gün, HTML 7 gün saklanır) | Tool vendor'ın deposunu geri OKUMUYOR: her satırı kendi `keyword_position_measurements` tablosuna yazıyor (migration 0030) ve `keyword_positions` oradan okuyor | **İLGİSİZ** | Vendor saklama penceresi bu tool için karşılıksız — ölçüldü, varsayılmadı: `dfs/serp.ts`'te `id`/`task_get` ile geri okuma yolu yok |
| R-8.4 (2025-07: `ai_overview` için `markdown`, `ai_overview_element` için `markdown` + `links`) | Bu alanlar **hiç taşınmıyor**. `grep -niE "markdown\|\blinks\b" dfs/serp.ts` → **0 eşleşme**. Yapısal sebep: `organicItems` (`serp.ts:644-646`) `items`'ı `type === "organic"` ile süzüyor, yani her AI Overview elementi saklamadan ÖNCE düşüyor | **AYKIRI** | Tool'un amacı organic rank ölçmek, dolayısıyla süzgeç kendi içinde doğru — ama sonuç, ödenen yanıtın AI içeriğinin hiç saklanmaması. Kayıp `items` düzeyinde, `item_types` düzeyinde değil |
| R-8.5 (yeni item type'lar: `ai_overview_expanded_element`, `ai_overview_video_element`, `ai_overview_table_element`) | **Sayfa düzeyi `item_types` bir enum DEĞİL:** `serp.ts:590` `item_types: z.array(z.string()).nullish()`. Bilinmeyen/yeni tipler **sessizce düşmez**, `vendor_item_types` içinde birebir taşınır ve `report` jsonb'sine yazılır (`serp-snapshot-store.ts:134`). M-SS3 bunun pinli olduğunu gösterdi | **KISMEN UYUYOR** | **Referansın adlandırdığı risk (yeni tipin ayrıştırıcıda düşmesi) BU ÜRÜNDE KARŞILIKSIZ** — ölçüldü. Ama risk yer değiştiriyor: tip saklanıyor, **hiçbir yüzey basmıyor** (S-1). Yani "sessizce düşürülme" ayrıştırıcıda değil GÖSTERİM katmanında oluyor |
| R-8.6 (2026-08: doğrudan hedef URL çözümlemesi; "goto" ayrıştıran kod bayatlamıştır) | `grep -rniE "goto\|/url\?q=\|google\.com/url\|redirect"` serp+gap ailesinin 8 dosyasında → **0 eşleşme**. `SerpPlacement.url` vendor'ın `url`'ünü hiç dokunmadan taşıyor (`toPlacement`, `serp.ts:629`) | **İLGİSİZ** | Bayatlayacak bir ayrıştırıcı yok. Canlı kanıt: dönen URL `https://adstark.com.tr/` — çözülmüş, yönlendirme sarmalayıcısı değil |
| R-8.7 (AI Mode'a paid ads, Popular Products'a shopping ID, LLM Responses kaynak anotasyonları) | Bu tool yalnız `organic` item'ları sayıyor; paid/shopping elementleri ne sayılıyor ne saklanıyor | **İLGİSİZ** | Organic rank ölçümü için doğru sınır; R-8.7 `ai_visibility` ailesinin riski |

`D-x` kalemleri kural değildir, işlenmedi.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:25` → `serp_snapshot: "list"`. Eşleme **VAR**.
`CARDED_TOOLS` (satır 62) bugün yalnız `get_credit_balance` içeriyor, `serp_snapshot` **DEĞİL**.
Canlı payload kartın isteyeceği yapısal alanları taşıyor: kelime başına ayrık blok, blok başına
`status` (üç değerden biri), `rank_group`/`rank_absolute`, `organic_items_examined`, `url`, iki ayrı
saat (bizim + vendor'ın). Bir `list` kartı için satır+rozet yapısı hazır. **Kart bir gün çizilirse
`item_types`'ın kartın rozet şeridine doğal adayı olduğu not edilmelidir** (S-1'in ucuz kapanış yolu).

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK — EXCLUDED** (satır 141):
  `serp_snapshot: "paid, 5 + 8 per keyword over 1-10 keywords. Needs a budget signature and a per-site keyword list."`
  **Gerekçenin İKİ yarısı da bayat** (ölçüldü, bkz. S-7): "budget signature" 2026-09-02 "kredi
  sınırımız yok" kararından sonra geçersiz; "per-site keyword list" ise adstark'ta ZATEN var ve bu
  turda kullanıldı.
- `goals/` hedefi gerekli mi: **HAYIR** — ücretli ve kullanıcı-tetiklemeli; kalıcı canlı hedef her
  koşuda en az 13 kredi + vendor parası yakardı, ve `dfs-budget-guard.md` zaten vendor tavanına bakıyor.
  Ama S-2 (pinsiz URL) bir `goals/` işi değil, bir **birim testi** işidir.

## Devralınan kalemler — Dilim 3'ten taşındı ve BUGÜN yeniden ölçüldü

| devralınan | Dilim 3'teki iddia | 2026-09-03 ölçümü | yeni numara |
|---|---|---|---|
| **F-5** (P1) | "`url` ve `item_types` `report` jsonb'sine yazılıyor ama `serp-snapshot-format.ts` **basmıyor**, `keyword-positions-store.ts` kolon projeksiyonu almıyor, web `ranking-history.ts` kasten okumuyor" | **YARISI DÜZELTİLDİ.** `item_types` iddiası **DOĞRU** (iki biçimlendiricide de 0 eşleşme, `COLUMNS`'ta `report` yok). **`url` iddiası `serp_snapshot` için YANLIŞ:** `serp-snapshot-format.ts:62` URL'i basıyor ve canlı çıktı bunu gösterdi (`rank_group #1 (rank_absolute 1) — https://adstark.com.tr/`). URL boşluğu YALNIZ `keyword_positions` tarafında (canlı KP çıktısında URL yok) | **S-1** |
| **F-8** (P2) | "Vendor'ın reddettiği lokasyon adı (`Turkey`) kalıcı seri başlığı olarak yaşıyor; yazan taraf `serp_snapshot`" | **YAZAN TARAF KAPANDI** — ölçüldü: `"Turkey"` ve `"Türkiye"` ikisi de reserve'den ÖNCE, ücretsiz reddediliyor ve ikisi de `"Turkiye"`yi öneriyor (SS-N3/SS-N4). M-SS4 bunun 8 testle pinli olduğunu gösterdi. **OKUYAN taraf yeniden ölçülmedi** (dentnotion'daki bayat seri hâlâ orada olabilir; okumak 10 kredi eder ve bu turun sorusu değildi) | **S-3** |
| **F-10** (P2) | "`ranked` dalı ürün tarihinde hiç ölçülemedi; prod'daki 3 measurement satırının 3'ü de `not_measured`" | **KAPANDI (her iki yarısı).** Yazma: SS-P1/SS-P2 dört istekte `ranked` üretti (77/99/75/100 sonuç sayıldı, 0 timeout, 0 40501). Okuma: `keyword_positions` `rank_group #1 (rank_absolute 1), of 77 organic result(s) examined` satırını geri okudu. Kök neden (`max_crawl_pages` gönderilmiyordu) **kapalı ve ölçüldü** | **S-4** |

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, YYYY-MM-DD) |
|---|---|---|---|---|---|
| S-1 | **P1** | **[F-5 devralındı, DÜZELTİLEREK]** Parası ödenen, ayrıştırılan ve saklanan SERP özellik listesi (`item_types` — `ai_overview*` dahil) **hiçbir yüzeyden okunamıyor.** `serp_snapshot` onu `report` jsonb'sine yazıyor ama basmıyor; `keyword_positions` kolon projeksiyonuna `report`'u hiç almıyor; web Rankings sayfası kasten okumuyor. Sonuç: **AI Overview varlığı üründe hiçbir yerde görülemiyor** (R-5.5/R-8.5). **Dilim 3'ün iddiasının URL yarısı bu turda YANLIŞ çıktı:** `serp_snapshot` sıralayan URL'i BASIYOR (canlı: `— https://adstark.com.tr/`); URL boşluğu yalnız `keyword_positions`'ta | `grep -n "item_types" serp-snapshot-format.ts keyword-positions-format.ts` → **0**. `keyword-positions-store.ts:73` `COLUMNS`'ta `report` yok ↔ `serp-snapshot-store.ts:134` `item_types: row.observed.vendor_item_types` ↔ `dfs/serp.ts:693`. Canlı SS-P1 ve KP çıktılarının ikisinde de tek bir SERP-özellik satırı yok. M-SS3 KIRMIZI = veri gerçekten saklanıyor | En ucuz kapanış: `serp_snapshot` çıktısına kelime başına tek satır — sayfada bulunan `item_types`'tan `"organic"` çıkarılmış hâli (`ranked_keywords.ts:289` bu deseni ZATEN uyguluyor, kopyalanacak hazır emsal). En az `ai_overview*` varlığının söylenmesi R-5.5 için zorunlu. `keyword_positions` tarafı ayrı kalem (tek-kelimeye daralmış okumada opsiyonel `include_report`) | |
| S-2 | **P1** | **Ürün genelinde sıralayan URL'i basan TEK yüzey hiçbir testle pinli değil.** `renderPlacement`'tan URL'i silmek 4016 testin hiçbirini kırmadı. `keyword_positions` URL basmadığına göre (S-1), bu satır silinirse ödenen URL üründe tamamen okunamaz hâle gelir ve kapı bunu görmez | **M-SS7: `serp-snapshot-format.ts:62`'de `— ${url}` silindi → `Tests 4016 passed (4016)`** (`logs/m-ss7.log`). Karşılaştırma: aynı dosyanın rank kısmı da pinsiz — yalnız `— ${url}` denendi | `serp-snapshot-format.test.ts`'e (ya da `serp-snapshot.test.ts`'in "what the answer says" bloğuna) `ranked` bir satırın URL'i bastığını iddia eden tek test. Ders 12'nin tam örneği: yeşil bir yüzey, kasten bozulup kırmızıya dönmediği sürece kanıt değildir | |
| S-3 | P2 | **[F-8 devralındı — YAZAN TARAF KAPANDI]** Vendor'ın reddettiği lokasyon adıyla artık satır AÇILAMIYOR: `"Turkey"` ve `"Türkiye"` ücretsiz, reserve öncesi reddediliyor ve doğru yazım öneriliyor. **Kalan yarı:** Dilim 3'te prod'da ölçülen bayat `Turkey` serisi (dentnotion, `diş beyazlatma`) hâlâ okuma tarafında eşdeğer bir kimlikmiş gibi görünüyor olabilir — bu turda **yeniden ölçülmedi** | Canlı SS-N3/SS-N4 (ikisi de `You were not charged.`, ikisi de `"Turkiye"` öneriyor); M-SS4 → 8 test KIRMIZI. Okuma yarısı için kanıt Dilim 3'ün canlı P1 çıktısı (`keyword_positions.md:215`) | Okuma tarafında: `not_measured` bir serinin başlığında reddin LOKASYON ADINA ait olduğunun belirtilmesi; ya da prod'daki bayat satırların operatörce temizlenmesi (veri kararı, insan imzası). Yazan taraf için ek iş YOK | |
| S-4 | P2 | **[F-10 devralındı — KAPANDI]** `ranked` dalı ürün tarihinde ilk kez üretildi ve geri okundu; `max_crawl_pages` kök nedeni kapalı ve ÖLÇÜLDÜ (4/4 istek başarılı, 75–100 sonuç sayıldı, 10'un çok üstünde). Kalan şerh: `dfs/serp.ts:165-176`'nın "omitted-key yolu ölçülmedi, kontrollü çift yok" cümlesi **hâlâ doğru** — bu tur `max_crawl_pages` GÖNDERİLEN yolun çalıştığını kanıtladı, gönderilmeyenin bozuk olduğunu değil | Canlı SS-P1/SS-P2 çıktıları + defterdeki iki −21 satırı; `keyword_positions` okuma satırı | `serp.ts:165-181`'deki "NOT MEASURED" bloğu güncellensin: artık ölçülmüş olan (gönderilen yol 4/4 başarılı, depth gerçekten tarandı) ile hâlâ ölçülmemiş olan (kontrollü omitted-key çifti) ayrılsın. Ders 16: kapanmış bir iddiayı "hâlâ açık" bırakan yorum sessizce yanlış yönlendirir | |
| S-5 | P2 | **R-5.5 query fan-out şerhi çıktıda yok.** Tool "one keyword = one paid search" diyor ama AI yüzeylerinin alt-sorgulara dağıldığını, dolayısıyla tek-kelime okumasının o davranışı kapsamadığını söylemiyor | `grep -niE "fan.?out" dfs/serp.ts tools/serp-snapshot*.ts` → **0 eşleşme**; canlı çıktının hiçbir bloğunda geçmiyor | S-1'in düzeltmesiyle birlikte tek cümle: sayfada `ai_overview*` görüldüğünde, AI yüzeyinin alt-sorgulara dağıldığı ve bu tek-kelime ölçümünün onu kapsamadığı. İki bulgu tek satırla kapanır | |
| S-6 | P2 | **"Vendor tarafı başarısızsa iade" kararı (2026-08-25) bu turda SINANAMADI** — dört isteğin dördü de başarılı olduğu için `not_measured` satırı üretilmedi ve defterde iade satırı beklenmedi. Karar bugün uygulanıyor mu, ölçülmedi | Defterde dört ücretli satır, sıfır refund; `withCredits` yalnız THROW'da release ediyor, oysa `buildFailedSerpRow` bir kelimenin başarısızlığını THROW'a çevirmiyor — kısmi başarısızlık **tam fiyata** faturalanıyor gibi görünüyor (`dfs/serp.ts:947-952` + `serp-snapshot.ts:242`). Ayrıca ölçüldü: `grep -niE "refund\|release\|partial"` `serp-snapshot.test.ts` + `serp-snapshot.reserve.test.ts` içinde **konuyla ilgili 0 eşleşme** — kısmi başarısızlığın fiyatını sınayan test YOK | Kod okumasından çıkan hipotez (ölçülmedi, bu yüzden P2): 2 kelimelik bir çağrının 1 kelimesi `not_measured` dönerse tenant 21 kredinin tamamını ödüyor. Bir birim testi ile ucuza sınanır (mock port'tan bir satırı `not_measured` döndür, rezervasyonu oku). Ölçülmeden düzeltme önerilmez | |
| S-7 | P2 | `plan.mjs` EXCLUDED gerekçesi **tamamen bayat**: "Needs a budget signature and a per-site keyword list" — budget signature yarısı 2026-09-02 kararıyla, keyword list yarısı adstark'ın mevcut izlenen kelimeleriyle geçersiz | `scripts/testing/plan.mjs:141` ↔ bu kaydın §4'ü (izlenen kelimelerle ücretli çağrı yapıldı) | Gerekçe yenilensin ya da tool PLAN'a alınsın. Alınırsa maliyet site başına ≥13 kredi + vendor parası — bu bir bütçe kararıdır, ama **artık "imzasız" değil, sadece "pahalı"** | |

`durum` sütunu ölçüm turunda BOŞ bırakılmıştır; kapatan tur doldurur.
