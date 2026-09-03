# `audit_content` — tool kontrol kaydı (2026-09 turu)

> Dilim: 2 (content) · İşçi: Opus 4.8 (d2-content) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **1 çağrı, toplam Δ −12 kredi** (izin sınırı 2 çağrı / 24 kredi — sınırın altında kalındı, gerekçe §4).
> **DFS bütçesi ilgisiz:** bu tool DataForSEO'ya ÇIKMIYOR — ölçüldü (§1).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `audit-content.ts:74-375`; kredi `costs.ts:126` = `  audit_content: 12,`; docs "**Cost:** 12 credits."; `grep dfs\|dataforseo` → **sıfır eşleşme**, vendor yolu yok |
| 2 Mutasyon | ÖLÇÜLDÜ | 4 mutasyon: M5/M8 KIRMIZI · **M6 (`UNCAPPED` → motor kapağı) ve M7 (`total` yeniden türetimi) YEŞİL KALDI** — ikisi de kaynağın KENDİ yorumunun önlediğini iddia ettiği hata |
| 3 Canlı negatif | ÖLÇÜLDÜ | 6 senaryonun 6'sı doğru reddedildi, net kredi Δ **0**; precondition sırası (önce pull, sonra crawl) canlıda doğrulandı; defterde **dört** charge+refund çifti (hakem turunda düzeltildi — ilk kayıt üç saymıştı) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 1 ücretli çağrı, Δ **−12**, 676 ms. Kapsam cümlesi, marka istisnası ve pencere/provenans satırları BASILDI (birebir §4) |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 10 kural tek tek; **BAYAT KURAL YOK ve bu ölçülerek söyleniyor:** "helpful content", "E-E-A-T", "AI-generated", "scaled content" → depoda **sıfır** eşleşme (R-4.6/R-4.8/R-6.4 temiz) |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:33` `audit_content: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`; canlı cevap `structuredContent`/`_meta` taşımıyor |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi **YOK** — `EXCLUDED:134`'te gerekçesiyle var, **ama `ID_TOOLS`'ta da yok ve bu bir sürüklenme** (B-3) · `goals/` hedefi **YOK** |

**Karar (ölçüm turu, 2026-09-02):** DÜZELTME GEREKLİ — tool ölçülen her SEO ekseninde temiz ve dürüst (kapsam cümlesi, marka
istisnası, pencere provenansı, "calls no outside service"), ürünün en iyi yazılmış açıklama metnine
sahip; ama **kaynağın kendi yorumlarının "bu yüzden böyle yazıldı" dediği iki değişmez hiçbir testin
bakmadığı yerde duruyor** (M6, M7) ve `plan.mjs`'in kimlik tablosunda yok.

**Karar (kapanış, 2026-09-03):** KAPANDI (#212) — **iki P1'in ikisi de kapandı:** `UNCAPPED` değişmezi ve `total`'ın filtrelenmiş listeden türetilmesi artık 60 çiftlik tek bir fikstürle ölçülüyor (B-1/B-2). Tool ayrıca sınıf 1 ve sınıf 2'nin kopya yarısını dört audit ile birlikte kazandı (`job_id`, kapsam cümlesi, tekrar uyarısı). **Kalanlar:** B-3 · B-4 · B-5 · B-6 · B-7 **AÇIK** — beşi de iş emrinde yoktu; B-5'in düz `throw new Error(` satırı bugün ölçülerek doğrulandı (`audit-content.ts:347`).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/audit-content.ts:274-369` (`makeContentAuditTool`), üretim sarmalayıcı
  `makeAuditContentTool` `:371`, örnek `auditContentTool` `:375`. Motor çağrısı + render `:239-272`
  (`renderContentAudit`).
- Yardımcılar: `packages/core/src/content/title-query-match.ts` (saf motor, `analyzeTitleQueryMatch:204`,
  `MAX_CONTENT_MISMATCHES = 50` `:57`), `apps/mcp/src/tools/audit-content-format.ts` (metin),
  `audit-content-runs.ts` (0026 tablosuna satır), `gsc-data/` (pull yükleyici, marka eşleşmesi,
  fonksiyon kelimeleri), `audit/load.ts` (crawl yükleyici).
- Kayıt: `apps/mcp/src/tools/index.ts:18` (import), `:87` (export), `:185` (araç dizisi)
- Zod şeması (`audit-content.ts:97-101`) — canlı JSON Schema ile birebir doğrulandı:
  - `project_id`: `z.uuid().describe("The project to audit (must have run pull_gsc_data and crawl_site first).")`
    — **tek alan, tek zorunlu alan** (canlı `"required": ["project_id"]`)
  - Canlı şema `"additionalProperties": false` (ölçüldü, §3)
- Description (birebir alıntı, `audit-content.ts:74-77`; sayı `TOOL_COSTS`'tan İNTERPOLE ediliyor,
  yazılmıyor — canlı `tools/list` aynısını veriyor):
  > Find queries your pages rank for but never mention in their title or h1, joining your latest pull and crawl. Costs 12 credits. Run pull_gsc_data and crawl_site first.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:126`, birebir): `  audit_content: 12,`
  Aynı bloğun imza cümlesi (`costs.ts:116-119`, birebir):
  > It reads TWO stored measurements and calls no paid API, so the price is the analysis, not a vendor cost. SIGNED BY THE OPERATOR 2026-08-17 at 12, shipped in PR #107 across code + docs + pricing.
- **Vendor yolu: YOK — ölçüldü.** `grep -n "dfs\|dataforseo\|DataForSEO" apps/mcp/src/tools/audit-content.ts
  apps/mcp/src/tools/audit-content-runs.ts packages/core/src/content/title-query-match.ts` → **sıfır
  eşleşme**. İş emrindeki "DFS Content Analysis'e çıkıyorsa günlük $3 tavanı" şartı bu tool için
  **karşılıksız**: iki depolanmış ölçümü birleştiriyor, dışarı çıkmıyor. (R-8.1 DFS'in bir "Content
  Analysis" ailesi olduğunu söylüyor; bu ürün onu bu tool'da KULLANMIYOR.)
- Docs sayfası (`apps/web/content/docs/tools-reference/audit-content.mdx`, birebir):
  > **Cost:** 12 credits.

  ve `:12`:
  > It joins two things you have already paid for and calls no outside service.

  ve `:22` (kapsam disiplini — bu turun en önemli karşılaştırma noktası, bkz. `audit_onpage.md` A-2):
  > The answer always states how many of your query/page pairs it was able to check and across how many crawled pages, because this tool joins two measurements with different reach.

  ve `:44`:
  > If nothing mismatches, it says so (and you are still charged for the delivered analysis).
- Ücretlendirme kipi: `charge: "surface"` (varsayılan; `audit-content.ts:286` yorumu). Üç ret de
  FIRLATIYOR: arşiv (`:299`), pull yok (`:313`), crawl yok (`:316`). Ek olarak `:331-333` job id'siz
  bir yükleme için **düz `Error`** fırlatıyor (rezerv serbest kalır ama müşteri jenerik çökme cümlesi
  görür — bu dal canlıda üretilemedi, §3 notu).
- Tutarsızlıklar: **yok**. Karşılaştırılanlar: `audit-content.ts:74-77` description ↔ canlı `tools/list`
  description (birebir) ↔ mdx frontmatter (kredi cümlesi çıkarılmış hâli, birebir); `costs.ts:126` 12 ↔
  mdx "**Cost:** 12 credits." ↔ description "Costs 12 credits." ↔ ölçülen Δ −12; `:97-101` `describe()`
  ↔ mdx Input tablosu (birebir) ↔ canlı JSON Schema (birebir); mdx "at most **15,000**" ↔ pull tarafının
  satır kapağı; mdx `:12` "calls no outside service" ↔ grep (yukarıda).
- Seçilebilirlik: "sayfalarım hangi aramalarda çıkıyor ama başlıklarında geçmiyor", "which pages rank
  for things their titles don't mention". Komşuları: `find_quick_wins` (10 kredi, GSC pozisyon
  fırsatları), `detect_cannibalization` (10 kredi, aynı sorgu için yarışan sayfalar),
  `analyze_content_decay` (10 kredi, düşen sayfalar), `audit_onpage` (30 kredi, crawl'ın kendisi).
  **En yüksek karışma riski `find_quick_wins`**: ikisi de "GSC verimden fırsat çıkar" ailesinde ve
  fiyatlar yakın (12 vs 10). Ayrım keskin ve description'da yazılı: bu tool title/h1 METNİNE bakan
  TEK tool. İkinci risk: kullanıcı "içerik denetimi yap" derse model `audit_content` seçer ama
  bu tool **içeriği denetlemiyor** — yalnız title/h1 ile sorgu kelimelerini eşleştiriyor; adı
  vaat ettiğinden geniş (B-6).

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `pnpm --filter @pseo/mcp exec vitest run src/audit src/tools/audit-content.test.ts
src/tools/audit-runs.test.ts`. Taban: **244 passed / 16 files** (`audit-content.test.ts` = 48 test).
`audit-content.db.test.ts` Docker ister — **db şeridi koşulmadı**; gerçek ad altındaki rezerv/commit/
release zinciri (`audit-content.ts:264-272` yorumunun işaret ettiği şerit) bu turda YALNIZ CANLIDA
ölçüldü (§3, §4).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M5 | **Sayfa başına sorgu kapağı** — `audit-content-format.ts:24` `MAX_QUERIES_PER_PAGE = 5` → `= 6` | kapağı ve "kalanı say" cümlesini ölçen testler | **KIRMIZI** (2 test) | `the report is grouped by page > says how many of the page's queries mismatch…`: `expected [ '    - "zirkonyum ', …(5) ] to have a length of 5 but got 6`; ve `…counts the queries it did not print…`: `expected 'Checked 9 of 9 query/page pairs again…' to match /…and 3 more of this page's queries/`. **Kapak sayısı tek birime kadar pinli** |
| **M6** | **Filtre-öncesi kapak kaldırma** — `audit-content.ts:243` `analyzeTitleQueryMatch(…, UNCAPPED)` → `analyzeTitleQueryMatch(…, MAX_CONTENT_MISMATCHES)` (yani motor önce 50'ye kırpsın, filtreler o 50 üstünde koşsun) | `UNCAPPED`'ın var oluş gerekçesini ölçen test | **YEŞİL KALDI** | **244/244 passed.** `audit-content.ts:130-135` yorumu bu hatayı ADIYLA anlatıyor: *"Filtering a pre-capped list would silently shrink the answer: fifty rows in, eight of them branded, forty-two out — and `total` would still claim fifty."* Neden yeşil kaldığı ölçüldü: `MAX_CONTENT_MISMATCHES = 50` ve **hiçbir fikstür 50 eşleşmezliğe ulaşmıyor** (en büyüğü 9 çift) — kapak etkileşimi hiçbir testte gözlemlenebilir değil |
| **M7** | **`total`'ın yeniden türetimi** — `audit-content.ts:225` `total: functionWords.kept.length,` → `total: result.total,` (yani motorun ürettiği sayı, filtrelerden GEÇEN değil) | filtrelenmiş toplamı ölçen test | **YEŞİL KALDI** | **244/244 passed.** Aynı satırın yorumu (`:220-221`): *"`total` is re-derived from the KEPT list, so the pre-cap headline the caller reads counts the findings that survived rather than the ones the engine produced."* Tek yakın pin `audit-content.test.ts:419` `expect(report?.total).toBe(2)` — ama o fikstürde marka/fonksiyon istisnası YOK, yani iki sayı zaten eşit. **Ders 12/14'ün ders kitabı vakası: pin var, ekseni varyantlanmamış** |
| M8 | **Kapı sırası** — `audit-content.ts:217-218` marka kapısı ile fonksiyon-kelime kapısının SIRASI takas edildi | sıranın load-bearing olduğunu ölçen test | **KIRMIZI** (1 test) | `a finding with nothing to say is dropped, not printed empty > runs the brand gate FIRST, so a branded query left holding function words still drops`: `expected 'Checked 1 of 1 query/page pairs again…' to contain 'No title/h1 mismatches found'`. Sıra GERÇEKTEN korunuyor — testin ADI bile kuralı söylüyor |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). İş emrinin önerdiği eksen
(`audit-content-format.ts`) **kırmızı verdi** (M5) — yani iş emrinin hipotezi doğruydu ama kapının
kör noktası orada değildi. **İki delik de `audit-content.ts`'in KENDİ yorumlarının "bu hatayı
önlüyorum" dediği satırlarda çıktı:** bir yorum, bir test değildir.

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**; kapı yeniden **244/244 passed**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (basılmadı). Bakiye önce **4459**, altı senaryodan sonra **4459** — net Δ **0**.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| bozuk id | `{"project_id":"not-a-uuid"}` | 200, `isError: true`, 533 ms | **0** | `Invalid input for "audit_content": ✖ Invalid UUID` / `  → at project_id You were not charged.` — zod, rezervden ÖNCE; defterde satır yok |
| geçersiz project_id (rastgele uuid) | `{"project_id":"00000000-0000-4000-8000-000000000000"}` | 200, `isError: true`, 518 ms | **0** | `No Search Console data found for this project. Run pull_gsc_data first. You were not charged.` — **varlık sızdırmıyor**; `audit-content.ts:292-296` yorumunun tarif ettiği davranış (çözülemeyen proje arşiv kapısında DEĞİL, pull okumasında düşüyor) canlıda doğrulandı. Defterde `-12 charge` + `+12 refund` çifti (`14:44:56.794` / `14:44:56.917`) — bu ret de handler seviyesinde, rezerv AÇILIP iade ediliyor |
| **crawl'ı da pull'u da olmayan proje** | `{"project_id":"257ad998-…"}` (example.net, soğuk fikstür) | 200, `isError: true`, 553 ms | **0** | Aynı cümle. **Precondition SIRASI doğrulandı:** iki eksik girdiden ÖNCE `pull_gsc_data` adlandırılıyor (`audit-content.ts:302-311`'nin ürün kararı: "Naming the harder missing step first") |
| **crawl'ı VAR, pull'u YOK** | `{"project_id":"4e0caff0-…"}` (seogrep.com — kampanyanın GSC kontrol grubu) | 200, `isError: true`, 553 ms | **0** | Aynı cümle. Defterde `-12 charge` + `+12 refund` çifti (`14:44:57.867481` / `14:44:57.998064`) — **refund yolu ÖLÇÜLDÜ** |
| **şema dışı anahtar** | `{"project_id":"e2785bf7-…","limit":5}` | 200, `isError: true`, 336 ms | **0** | `Invalid input for "audit_content": ✖ Unrecognized key: "limit" You were not charged.` — sessiz yutma YOK |
| arşivli proje | `{"project_id":"77f40d69-…"}` | 200, `isError: true`, 557 ms | **0** | `That project is archived, so it is not being tracked right now. Restore it with setup_project for the same domain — which works whether or not the project has a Search Console property — or with track_gsc_property for its property, or from the Connection page in SeoGrep. You were not charged.` — arşiv kapısı pull okumasından ÖNCE (`:301`) |
| pull/crawl job id'siz yükleme | — | — | — | **ÖLÇÜLEMEDİ — yapısal.** `audit-content.ts:331-333` düz `Error` fırlatıyor; bu dal ancak yükleyicinin job id'siz döndüğü bir depo durumunda görülür ve canlıdan tetiklenemez. Not: TİPLİ olmadığı için müşteri **jenerik çökme cümlesi** görürdü (B-5) |

Defter kanıtı (`list_credit_activity`) — **ilk altı satır birebir; son iki satır hakem turunda eklendi
ve `…` ile işaretli kısmı transkribe edilmemiştir** (aşağıdaki düzeltme notu):

```
- 2026-09-02T14:44:58.89618+00:00  · +12 credits · refund · audit_content · project: dilim1-tek-kullanimlik-8b3f7c.com
- 2026-09-02T14:44:58.752385+00:00 · -12 credits · charge · audit_content · project: dilim1-tek-kullanimlik-8b3f7c.com
- 2026-09-02T14:44:57.998064+00:00 · +12 credits · refund · audit_content · project: seogrep.com
- 2026-09-02T14:44:57.867481+00:00 · -12 credits · charge · audit_content · project: seogrep.com
- 2026-09-02T14:44:57.453095+00:00 · +12 credits · refund · audit_content · project: example.net
- 2026-09-02T14:44:57.318539+00:00 · -12 credits · charge · audit_content · project: example.net
- 2026-09-02T14:44:56.917…+00:00   · +12 credits · refund · audit_content · (çözülemeyen proje: 00000000-0000-4000-8000-000000000000)
- 2026-09-02T14:44:56.794…+00:00   · -12 credits · charge · audit_content · (çözülemeyen proje: 00000000-0000-4000-8000-000000000000)
```

> **Düzeltme (hakem turu, 2026-09-02).** İlk kayıt bu çifti alıntıdan düşürmüş ve toplamı ÜÇ saymıştı;
> defterde **DÖRT** charge+refund çifti var. Son iki satırın saniye-altı kısmı hakemin verdiği kesinlikte
> (`.794` / `.917`) yazıldı — kalan basamaklar ve `project:` sütununun defterdeki tam biçimi ölçüm turunda
> transkribe edilmediği için **uydurulmadı**, `…` ile işaretlendi. Yukarıdaki ilk altı satır birebirdir.

**DÖRT** handler-seviyesi ret, **DÖRT** charge+refund çifti; net Δ 0 ve "You were not charged" **doğru**.
Dördü §3 tablosundaki dört handler-seviyesi senaryoya birebir oturuyor ve zaman sırası da tutuyor:
`00000000-…` (.794) → example.net (57.318) → seogrep.com (57.867) → arşivli proje (58.752). Kalan iki
senaryo (bozuk uuid, şema dışı anahtar) zod'da, yani rezervden ÖNCE düşüyor — defterde satırları YOK.
`list_credit_activity` bunu kendi cümlesiyle açıklıyor: `a refunded run shows both its charge and its refund.`

## 4. Canlı mutlu yol

Özne: **adstark.com.tr** (`project_id: e2785bf7-9963-4b6a-a6d7-aaed7b550abe`). Bakiye **4409 → 4397**,
**Δ −12**, **1 ücretli çağrı**, 676 ms. Girdiler `list_jobs` canlı çıktısından doğrulandı:
`pull_gsc_data — succeeded · created 2026-08-09T16:59:47.490854+00:00` ve
`crawl_site — succeeded · created 2026-09-02T14:26:47.506514+00:00` (Dilim 2 A fazının daraltılmış
1 sayfalık crawl'ı).

| senaryo | argüman | envelope | kredi Δ | çıktı özeti |
|---|---|---|---|---|
| Ç1 mutlu yol | `{"project_id":"e2785bf7-…"}` | 200, text, 676 ms, `isError` yok, `structuredContent: null`, `_meta: null` | **−12** | Tam gövde aşağıda; 1 sayfa, 1 eşleşmezlik, 2 markalı sorgu istisna edildi |

Çıktı (birebir, tamamı):

```
Checked 3 of 234 query/page pairs against 1 of the 1 crawled pages. 231 could not be checked because the page drawing them was not in the crawl — run crawl_site again (or widen it) to cover them.
Excluded 2 queries whose only missing words were your own brand name: your brand is on the page whether or not the title repeats it, so that is not a missing keyword.

1 page with queries whose words are missing from them (most impressions first):
• https://adstark.com.tr/iletisim — 1 query missing words, 1 impressions, 0 clicks. Current title: "İletişim - Artistics"
    - "telefon numarası nedir" — 1 impressions, 0 clicks; missing "telefon", "numarası", "nedir" (0/3 words present)

Analyzed window: 2026-05-09..2026-08-06 (90 days) vs previous 2026-02-08..2026-05-08.
Search Console data pulled 2026-08-09 (23 days ago).
Crawl data fetched 2026-09-02.
```

**İş emrinin sorduğu üç kalem, sırayla:**

- **"helpful content" puanı/etiketi üretiyor mu?** — **HAYIR, ölçülerek.** Ne çıktıda ne kaynakta;
  `grep -rni "helpful content" apps packages` → **sıfır eşleşme**. R-4.6 açısından temiz (§5).
- **E-E-A-T'yi nasıl adlandırıyor?** — **Hiç adlandırmıyor.** `grep -rni "E-E-A-T\|EEAT\|\bE-A-T\b"` →
  **sıfır eşleşme**. R-4.8'in "ranking factor değil" tuzağına düşmek için önce kavramı anmak gerekir;
  tool onu hiç anmıyor.
- **AI-üretim tespiti var mı (R-6.4)?** — **HAYIR.** `grep -rni "ai-generated\|scaled content\|ai detection"` →
  **sıfır eşleşme**. Tool bir metnin AI ile yazılıp yazılmadığı hakkında hiçbir iddia üretmiyor.

**Ölçülen dürüstlük noktaları** (her biri bir R kuralının değil, ürün disiplininin kanıtı):
kapsam cümlesi **listeden ÖNCE** geldi ve 231/234'ün kontrol edilemediğini açıkça söyledi; marka
istisnası **sayısıyla** duyuruldu (gizli düşüş yok); `missing "numarası"` — kelime **arayanın yazdığı
imlâyla** basıldı, motorun yarı-katlanmış hâliyle değil (`audit-content-format.ts:87-118`'in çözdüğü
hata canlıda doğrulandı); pull'un yaşı (23 gün) ve crawl'ın tarihi ayrı ayrı verildi.

**İkinci ücretli çağrı YAPILMADI (izin 2 idi).** Gerekçe: izin kapsamındaki tek özne adstark ve
aynı pull+crawl çifti üzerinde ikinci bir çağrı yalnız `audit_onpage`'de zaten ölçtüğüm "yeniden
çalıştırma yine ücretlendiriyor" cevabını tekrarlardı; yeni bir bilgi üretmeyen ücretli çağrı
yapılmadı. Toplam tur harcaması **72 ≤ 84 kredi**.

**Ölçülemeyen mutlu-yol dalı:** `formatContentMismatches`'in boş cümlesi (`No title/h1 mismatches
found: …`) ve mdx `:44`'ün "you are still charged" iddiası — adstark'ta eşleşmezlik VAR olduğu için
üretilemedi; başka bir özne iş emrimde yok. **ÖLÇÜLEMEDİ — özne yok.** (Birim testte pinli: M8'in
kırmızı çıktısı bu cümleyi kullanıyor.)

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim2/d2-content/probe.jsonl`
(anahtar `makeRedactor(process.env.MCP_SMOKE_URL)` ile redakte).

## 5. SEO güncelliği

Kaynak: `apps/mcp/src/tools/audit-content.ts` + `audit-content-format.ts` +
`packages/core/src/content/title-query-match.ts` + `audit-content.mdx`.
Referans satırı (`docs/reference/…:239`): `audit_content | R-4.6, R-4.8, R-6.3, R-6.4, R-2.2 |
Helpful content'in ayrı bir sistemmiş gibi puanlanması (Mart 2024'te core'a girdi)`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-4.6 helpful content system Mart 2024'te core'a girdi; ayrı sistem olarak listelenmiyor** | Hiçbir puan, etiket ya da "HCU" kavramı yok. Ölçüm: `grep -rni "helpful content" apps packages` → **sıfır eşleşme** | **UYUYOR (ölçülerek)** | Referansın bu tool için adlandırdığı ASIL risk **karşılıksız**. Tool tek bir şey iddia ediyor ve o şey ölçülebilir: sorgu kelimeleri title/h1'de geçiyor mu |
| **R-4.8 E-E-A-T doğrudan ranking factor DEĞİLDİR; kavramsal çerçevedir, "trust en önemlisidir"** | Kavram hiç anılmıyor. Ölçüm: `grep -rni "E-E-A-T\|EEAT\|\bE-A-T\b" apps packages` → **sıfır eşleşme** | **UYUYOR (ölçülerek)** | Anılmayan bir kavram yanlış anlatılamaz. Kayıt için: bu, ürünün "ölçemediğimi iddia etmem" duruşunun en temiz örneği |
| R-6.3 site reputation abuse (üçüncü taraf içeriğin ana sitenin sinyallerini sömürmesi) | Tool sayfanın SAHİBİNİ ya da içeriğin kaynağını hiç modellemiyor; yalnız `(query, page)` × `(title, h1s)` | **İLGİSİZ** | Bir boşluk değil kapsam dışı: bu eksen crawl'ın URL yapısını + editoryal sahipliği bilmeyi gerektirir. Yanlış bir iddia üretmiyor |
| **R-6.4 scaled content abuse: "kullanıcıya değer katmadan çok sayıda sayfa üretmek için generative AI kullanmak"** | AI tespiti ya da ölçek uyarısı **yok**. Ölçüm: `grep -rni "ai-generated\|scaled content\|ai detection" apps packages` → **sıfır eşleşme** | **UYUYOR (ölçülerek) — ama sessiz** | Yanlış bir iddia üretmiyor. Yine de dikkat: tool'un tavsiyesi *"Rewrite that page's title so it covers the missing words"* (mdx `:32`), ve bu tavsiye **otomatikleştirilirse** R-4.3 (title stuffing) ile R-6.4 arasında bir risk doğar. Tool bunu bir yerde uyarmıyor (B-7) |
| R-2.2 galeride FAQPage/HowTo artık YOK | audit_content schema önerisi üretmiyor; `grep -n "FAQPage\|HowTo" apps/mcp/src/tools/audit-content.ts` → sıfır. Bu tipler yalnız `audit/rules/schema.ts:31,44`'te (audit_schema) | **İLGİSİZ** | audit_schema'nın alanı; bu kayıtta yalnız "bu tool bayat bir schema önerisi ÜRETMİYOR" olarak durur |
| R-4.1 title link kaynakları: `<title>`, h1, `og:title`, anchor text… | **Tool tam da bu kuralla hizalı:** yalnız `<title>`'a değil `<title>` VE h1'lere birden bakıyor (`audit-content.ts:120` `supplyPages` → `{url, title, h1s}`). mdx `:18` gerekçeyi yazıyor: "A title trimmed to fit the search result routinely drops a qualifier the heading keeps" | **UYUYOR** | Ürünün SEO gerçeğine en yakın tasarım kararı. R-4.1'in "anchor text / gelen link metni" ekseni okunmuyor, ama o crawl'da yok |
| R-4.2 / R-4.4 karakter sınırı YOKTUR | Bu tool **hiçbir uzunluk eşiği kullanmıyor** — `grep -n "length >\|MAX.*= 60\|= 160" audit-content*.ts` → uzunluk eşiği yok; kapaklar yalnız LİSTE kapağı (`MAX_QUERIES_PER_PAGE`, `MAX_CONTENT_PAGES`, `MAX_CONTENT_MISMATCHES`) | **UYUYOR** | Kardeş tool'un (`audit_onpage`, A-1) düştüğü tuzağa bu tool düşmüyor. Aynı depoda iki farklı duruş — düzeltme fazında bu tool referans alınabilir |
| R-4.9 görsel SEO | Görsel ekseni hiç yok | **İLGİSİZ** | Kapsam dışı; audit_onpage'in alanı |
| R-9.5 dil tespiti yalnız görünür içerikten; `lang` sinyal değil | Tool `<html lang>`'a hiç bakmıyor; Türkçe eşleşmeyi **metnin kendisinden** yapıyor (`foldBrandWord`: `ş→s ç→c ü→u ğ→g ı→i`, `audit-content-format.ts:99-102`) ve fonksiyon kelimeleri iki dilli (`ve`, `ile`, `bir`, `the`, `and`, `for`) | **UYUYOR** | R-9.5'in ruhu: dil, içerikten. Tool tam olarak bunu yapıyor ve `audit_onpage`'in `lang_missing` bulgusunun aksine kod düzeyi `lang`'a hiç güvenmiyor |
| R-8.1 DataForSEO aileleri (Content Analysis dahil) | **Kullanılmıyor** — grep, sıfır eşleşme (§1) | **İLGİSİZ (ölçülerek)** | İş emrinin DFS bütçe şartı bu tool için karşılıksız; vendor maliyeti 0, 12 kredi tamamen analiz ücreti (`costs.ts:116-119`) |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:33` eşlemesi: **VAR** — `  audit_content: "report",`.
Sevk durumu: `card-map.ts:62` `CARDED_TOOLS` yalnız `get_credit_balance` — eşleme planlı,
**sevk edilmemiş**.

Canlı ölçüm: `audit_content`'in `tools/call` cevabı `structuredContent: null`, `_meta: null`;
aynı oturumda `get_credit_balance` `structuredContent: PRESENT` döndü — fark tool'a özgü.
Kartın beklediği alanlar sorusu **ÖLÇÜLEMEDİ — payload hiç üretilmiyor**. Not: bu tool'un yapısal
raporu (`ContentAuditReport`, `audit-content-runs.ts`) 0026 tablosuna zaten YAZILIYOR — yani kartın
okuyacağı veri var, yalnız cevaba iliştirilmiyor.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK — ve iki katmanlı bir durum.**
  - `EXCLUDED:134` gerekçesiyle kayıtlı ve gerekçe geçerli (birebir):
    > `audit_content: "paid, 12 credits/call. Reads a stored pull AND a stored crawl, so it can only run after K1 and K2 both land on the same site."`
  - **Ama `ID_TOOLS`'ta da yok**, ve `assertIdToolTable` (`plan.mjs:455-479`) tam olarak bunu
    yakalamak için yazılmış: `if (takesId && !listed) problems.push(…)`. Canlı `tools/list`'ten
    hesaplandı — `audit_content` dahil **15 tool** `project_id`/`target` alıyor ve `ID_TOOLS`'ta yok
    (`list_credit_activity, list_jobs, audit_content, discover_keywords, my_pages, keyword_gap,
    link_gap, backlink_changes, backlink_details, disavow_candidates, ai_visibility, untrack_project,
    track_keywords, serp_snapshot, keyword_positions`). Yani sweep canlı uca karşı koşturulsa
    **başlangıçta 15 problemle fırlar**; S3/S4 hücreleri bu 15 tool için hiç üretilmiyor (B-3).
- `goals/` hedefi gerekli mi: **EVET** — `grep -rln "audit_content" goals/` → yalnız
  `migration-journal-sync.md` (tablo adı üzerinden). M6/M7'nin açıkta bıraktığı iki değişmez
  (filtre-öncesi kapak kaldırma · `total`'ın filtrelenmiş listeden türetilmesi) `goals/`a değil
  önce `audit-content.test.ts`'e ait; `goals/` katmanına ait olan, "hiçbir müşteri raporu
  filtrelenmiş bir listeyi filtresiz bir toplamla anmaz" predicate'idir.

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-03) |
|---|---|---|---|---|---|
| B-1 | **P1** | **`UNCAPPED` değişmezi ölçülmüyor** (M6 yeşil): motor kapağı filtrelerden önce uygulanırsa cevap sessizce küçülür — kaynağın kendi yorumunun adıyla anlattığı hata. Sebep ölçüldü: hiçbir fikstür `MAX_CONTENT_MISMATCHES = 50`'ye ulaşmıyor (en büyüğü 9 çift) | M6: `audit-content.ts:243` `UNCAPPED` → `MAX_CONTENT_MISMATCHES`, **244/244 yeşil**; yorum `:130-135`; kapak `title-query-match.ts:57` | `audit-content.test.ts`'e **51+ eşleşmezlik üreten** bir fikstür: marka + fonksiyon kelimesi istisnaları kapağın ötesinde kalsın, ve `total` ile shortlist'in doğru sayıları pinlensin. Fikstür üretimi ucuz (döngüyle kurulabilir); eksik olan fikstür, kural değil | **KAPANDI #212** — **60 çiftlik** fikstür `MAX_CONTENT_MISMATCHES = 50` kapağının ötesine geçiyor (60 bulundu, 8 filtrelendi, 52 kaldı, shortlist KALANIN ilk 50'si); `UNCAPPED` artık ölçülüyor |
| B-2 | **P1** | **`total`'ın filtrelenmiş listeden türetilmesi ölçülmüyor** (M7 yeşil): geri alınırsa rapor `…and N more query/page pairs mismatch.` derken filtrelerin ZATEN attığı satırları sayar — müşteriye var olmayan bulgu vaat eder | M7: `audit-content.ts:225` `functionWords.kept.length` → `result.total`, **244/244 yeşil**; yorum `:220-221`; tek yakın pin `audit-content.test.ts:419` `expect(report?.total).toBe(2)` (istisnasız fikstür) | Var olan `total` pinini **istisnaların BULUNDUĞU** bir fikstüre taşımak yeter: marka + fonksiyon istisnası olan bir senaryoda `total`'ın motor toplamından KÜÇÜK olduğunu pinle. B-1 ile aynı fikstür ikisini birden kapatabilir | **KAPANDI #212** — `total` aynı fikstürde filtrelenmiş listeden türetildiği için motor toplamından KÜÇÜK olarak pinli |
| B-3 | P2 | **`audit_content` (ve 14 tool daha) `plan.mjs` `ID_TOOLS`'ta yok**, oysa `project_id` alıyor; `assertIdToolTable` canlı listeye karşı 15 problemle fırlar → sweep'in S3/S4 hücreleri bu tool'lar için hiç üretilmiyor | `plan.mjs:69-84` (ID_TOOLS), `:455-479` (assertion); canlı `tools/list`'ten hesaplanan 15 adlı liste (§7) | Ya `ID_TOOLS` canlı yüzeye göre tamamlansın, ya da assertion'ın `EXCLUDED`'ı da kabul etmesi sağlansın. Kararın kendisi ucuz değil (S3/S4 hücreleri ücretsiz olsa da hedef siteleri var) — ama şu anki hâl "gate var" görüntüsü veriyorken hiçbir dalda koşmuyor | AÇIK — iş emrinde yoktu; `ID_TOOLS` hiçbir PR diff'inde geçmiyor |
| B-4 | P2 | **`goals/` altında bu tool'un davranışını ölçen hiçbir hedef yok** | `grep -rln "audit_content" goals/` → yalnız `migration-journal-sync.md` | B-1/B-2 test şeridinde kapatıldıktan sonra, "filtrelenmiş liste filtresiz toplamla anılmaz" predicate'i `goals/`a yazılsın | AÇIK — B-1/B-2 kapandı ama predicate yazılmadı: dört PR'ın hiçbiri `goals/` altına dosya eklemedi |
| B-5 | P2 | **Job id'siz yükleme dalı TİPLİ DEĞİL** — `throw new Error(...)`; registry `PreconditionNotMetError` dışını jenerik çökme cümlesine düşürüyor (2026-08-09'da 26 canlı çağrının aldığı cümle, `audit-content.ts:60-63` yorumu) | `audit-content.ts:331-333`; karşılaştırma: aynı dosyadaki üç ret TİPLİ (`:299,:313,:316`) | Bu dal gerçekten "olmamalı" bir durum ve fail-closed olması doğru; ama müşteriye giden cümle tasarlanmamış. Tipli bir iç hata sınıfı ya da en azından tasarlanmış bir cümle önerilir. (Rezerv zaten serbest kalıyor — para riski YOK) | AÇIK — iş emrinde yoktu; `audit-content.ts`'te düz `throw new Error(` bugün hâlâ duruyor (satır 347, ölçüldü) |
| B-6 | P2 | **Tool'un adı vaat ettiğinden geniş:** "audit_content" içeriği denetlemiyor; yalnız sorgu kelimelerini title/h1 ile eşleştiriyor. LLM "içerik denetimi yap" cümlesinde bu tool'u seçer ve müşteri içerik kalitesi denetimi bekler | description ve mdx doğru anlatıyor, ama AD anlatmıyor; `renderContentAudit` yalnız title/h1 okuyor (`audit-content.ts:120`) | Ad NEVER kapsamında değil ama değiştirilmesi kırıcı olur. En ucuz düzeltme: description'ın ilk cümlesi zaten dar ve doğru — mdx'in ilk paragrafına "this is not a content-quality audit" cümlesi eklensin | AÇIK — iş emrinde yoktu; mdx'e "this is not a content-quality audit" cümlesi girmedi |
| B-7 | P2 | Tool'un tavsiyesi (*"Rewrite that page's title so it covers the missing words"*) otomatikleştirilirse R-4.3 (title keyword stuffing) ve R-6.4 (scaled content abuse) riskine açık; hiçbir yerde bir sınır cümlesi yok | `audit-content.mdx:32`; R-4.3 / R-6.4 | mdx'e tek cümle: eksik kelimeleri title'a doldurmak değil, sayfanın gerçekten o sorguyu KARŞILADIĞINDAN emin olmak amaçlanır. Bulgu listesinin sonuna aynı cümlenin kısası konabilir | AÇIK — iş emrinde yoktu |
