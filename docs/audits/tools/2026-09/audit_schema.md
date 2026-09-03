# `audit_schema` — tool kontrol kaydı (2026-09 turu)

> Dilim: 2 (tech) · İşçi: Opus 4.8 (d2-tech) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, Δ −10 kredi** (`audit_tech` ile birlikte dilim
> toplamı **Δ −40**, tavan tam dolu).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `audit-schema.ts:27-33` + ortak kurucu `audit-shared.ts:76-150`; kredi `costs.ts:108` = `  audit_schema: 5,`; docs "**Cost:** 5 credits." — description ↔ mdx ↔ canlı `tools/list` BİREBİR, tutarsızlık yok |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyon: M1/M2/M3 KIRMIZI · **M4 (dizi biçimli `@type`) YEŞİL KALDI** (geniş kapıda da) · **M5 (kredi iade yolu) DAR kapıda YEŞİL, GENİŞ kapıda KIRMIZI** — ders 15'in birebir örneği |
| 3 Canlı negatif | ÖLÇÜLDÜ | 6 senaryonun 6'sı doğru reddedildi, net Δ **0**; şema dışı anahtar reddediliyor (`Unrecognized key: "types"`). **Defterde ölçüldü:** zod'u geçen 3 redde rezerv açılıp 80–200 ms'de iade ediliyor |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (Δ −5 · −5). İkinci çağrı **byte-for-byte aynı** metni döndürdü ve TEKRAR ücretlendirdi. Denetlenen crawl **1 sayfa**, 0 JSON-LD |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 7 kural tek tek + yargılanan 8 tipin R-2.1 galerisine karşı BİREBİR eşlemesi. **BİR BAYAT TİP VAR: `FAQPage`** (R-2.2). llms.txt önerisi YOK (R-5.2 temiz) |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:31` `audit_schema: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`; canlı `tools/list` `_meta` yok, `tools/call` `result` anahtarları yalnız `["content"]` |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi **VAR** (`:78`, `:266`, `:271`) · `goals/` içinde audit_schema hedefi **YOK** |

**Karar (ölçüm turu, 2026-09-02):** DÜZELTME GEREKLİ — description dürüstlük açısından bu turun en iyi metinlerinden biri
(*"unknown @type names are never judged"*, *"a crawl made before bodies were stored counts for
coverage but is not validated"* — üçü de canlıda doğru çıktı); ama **yargıladığı 8 tipten biri
(`FAQPage`) 2026-09-02 galerisinde artık yok** ve bunu ölçen hiçbir kapı bulunmuyor, **dizi
biçimli `@type` alan doğrulamasında korumasız**, ve **kredi iade yolunu dar kapı görmüyor**.

**Karar (kapanış, 2026-09-03):** KAPANDI (#210 + #212) — **üç P1'in üçü de kapandı:** galeri pini (S-B1b), dizi `@type` (S-B2), iade yolunun dar şeride taşınması (S-B3); S-B1 ve S-B5 de kapandı. **Kalanlar:** S-B5b ve S-B9 **İMZA KALEMİ** · S-B7 **KISMEN** (kapsamsız `anywhere on the site` cümlesi açık) · S-B8 ERTELENDİ → sınıf 8 · S-B4 · S-B6 · S-B10 **AÇIK — iş emrinde yoktu**. **Kapının ÖLÇMEDİĞİ:** emekli-tip bölümü koşullu olduğu için canlıda görülmedi (FAQPage taşıyan özne gerekir); ISO tablosu eksik kod içerirse geçerli etiket "geçersiz" raporlanır ve buna bakan bir `goals/` hedefi YOK.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/audit-schema.ts:41-43` (`makeAuditSchemaTool` → ortak kurucu),
  üretim örneği `auditSchemaTool` `:45`. Gerçek handler gövdesi **`audit_tech` ile AYNIDIR**:
  `apps/mcp/src/tools/audit-shared.ts:76-150`.
- Kural motoru: `apps/mcp/src/audit/rules/schema.ts` (246 satır, `auditSchema` `:200`),
  biçimlendirici `apps/mcp/src/audit/format.ts:283-334` (`formatSchemaReport`),
  girdi `apps/mcp/src/audit/crawl-data.ts`, yükleyici `apps/mcp/src/audit/load.ts`,
  koşu defteri `apps/mcp/src/audit/runs.ts`.
- Kayıt: `apps/mcp/src/tools/index.ts:16` (import), `:85` (export), `:183` (araç dizisi).
- Zod şeması (`audit-shared.ts:72-74`) — `audit_tech` ile **BİREBİR AYNI OBJE**; canlı JSON
  Schema ile doğrulandı:
  - `project_id`: `z.uuid()`, tek alan, zorunlu; `"additionalProperties": false`
  - `.describe("The project to audit (from setup_project / list_projects).")` — canlıda birebir
  - **Tip filtresi, crawl seçimi, blok limiti — hiçbiri şemada yok**
- Description (birebir alıntı):
  > Report structured-data coverage AND required-field validation for a project's latest crawl: which pages carry JSON-LD, which carry none, how often each schema.org @type name appears site-wide, which blocks fail to parse, and — on pages whose crawl stored the JSON-LD bodies — which known types are missing required fields. Detection is JSON-LD only; microdata and RDFa are not read, unknown @type names are never judged, and a crawl made before bodies were stored counts for coverage but is not validated. Costs 5 credits. Run crawl_site first.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:108`, birebir): `  audit_schema: 5,`
- Ücretlendirme kipi: varsayılan `"surface"` — `audit_tech` ile aynı rezerv/commit zinciri.
- Docs sayfası (`apps/web/content/docs/tools-reference/audit-schema.mdx`, birebir):
  > **Cost:** 5 credits.

  ve:
  > **Detection is JSON-LD only** — microdata and RDFa are not read at all, so a page marked up that way counts here as having no structured data.

  ve (sınırın en açık ifadesi):
  > **This is not full structured-data validation.** It is a required-field check over a handful of types, on the blocks that were stored. Only the first few blocks of a page are kept, and each is kept only up to a length cap, so a page whose markup was partly stored is listed as such and the reply says the fields were checked on the stored blocks only. Absence of a finding is not a clean bill of health.

  ve (raporun kendisine öncelik veren cümle):
  > **The closing note of every reply tells you which of the two you just got**, and names how many pages were checked; a reader should trust that line over any general statement, here or in the tool list.
- Tutarsızlıklar: **yok** (fiyat/şema/metin ekseninde). Karşılaştırılanlar: kaynak `DESCRIPTION`
  ↔ canlı `tools/list` description (birebir, JSONL'de) ↔ mdx frontmatter (üretilmiş, kırpılmış);
  `costs.ts:108` 5 ↔ description "Costs 5 credits." ↔ mdx "**Cost:** 5 credits." ↔ ölçülen Δ −5;
  mdx'in saydığı örnek tipler (`Product` no `offers`, `Article` no `datePublished`,
  `BreadcrumbList` no trail, `LocalBusiness` no address) ↔ `REQUIRED_FIELDS` (`schema.ts:40-49`)
  — dördü de birebir tutuyor. **Ancak mdx örneklerin ARASINA `FAQPage`'i almıyor**, yani
  müşteriye giden sayfa yargılanan sekiz tipin tam listesini hiç vermiyor (S-B6).
  Kaynak dosyanın üst yorumu (`audit-schema.ts:6-9`) hâlâ eski, dar hâli anlatıyor
  — *"Detection is JSON-LD only (the crawler stores type names, not the body)"* — oysa gövdeler
  artık saklanıyor ve doğrulanıyor; hemen altındaki ikinci yorum bloğu (`:11-26`) doğru hâli
  anlatıyor. İki yorum ÇELİŞİYOR; kullanıcıya giden hiçbir metin etkilenmiyor (S-B10).
- Seçilebilirlik: "check my structured data", "schema markup'ım doğru mu", "rich result alabilir
  miyim", "Product schema'm eksik mi" → `audit_schema`. **Asıl karışma riski tool'lar arasında
  değil, BEKLENTİDEDİR:** "schema'm doğru mu" sorusunun cevabı bu tool DEĞİLDİR ve description
  bunu açıkça söylüyor (*"unknown @type names are never judged"*). 5 kredi bu turun en dürüst
  fiyat/vaat oranı: pahalı olmayan bir tool, yapmadığı şeyi baştan söylüyor. İkinci risk:
  `audit_tech`/`audit_onpage` ile aynı girdiyi aldığı için model üçünü birden çağırabilir
  (toplam 50 kredi) ve hiçbir tool bunu söylemez.

## 2. Mutasyon (test gerçekten bakıyor mu)

Dar kapı: `pnpm --filter @pseo/mcp exec vitest run src/audit/ src/tools/audit-tech.test.ts
src/tools/audit-schema.test.ts src/tools/audit-runs.test.ts` → taban **214 passed / 17 files**.
Geniş kapı: `pnpm --filter @pseo/mcp test` → taban **3766 passed / 143 files**.
`*.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | **Kural tablosu** — `schema.ts:41` `Product: ["name", "offers"]` → `["name"]` | `offers`siz Product'ı yakalayan test | **KIRMIZI** (5 test) | `required fields per type > POSITIVE: a Product with no offers is named, with the field it lacks` + **`the required-field table is exactly the documented minimum`** — yani tablonun KENDİSİ pinli. Ayrıca `NEGATIVE: an EMPTY value is not a declaration` ve `one row per (page, type, missing set)` |
| M2 | **Doktrin** — `schema.ts:222` `if (page.jsonLdBlocks === undefined) continue;` silindi (gövdesi olmayan sayfa "doğrulandı" sayılır) | "yokluk bulgu değildir" kuralı | **KIRMIZI** (4 test) | `FIELD-ABSENT: a page with no stored bodies is SILENT and is not counted as validated` + `a legacy crawl renders exactly what it rendered before the Faz 1 rules > structured data: byte-for-byte` + `… the note still says only @type names` + `the returned text is byte-identical … 'audit_schema'`. Kaynağın 11-15'teki yorumunun testte tam karşılığı var |
| M3 | **Ayrıştırma** — `schema.ts:126-129` `@graph` üyeleri toplanmıyor | `@graph` okuyan test | **KIRMIZI** (1 test) | `required fields per type > reads @graph members, and a nested REFERENCE is not judged` — hem pozitif (@graph okunur) hem negatif (iç içe referans yargılanmaz) tek testte |
| **M4** | **Dizi biçimli `@type`** — `schema.ts:139` `if (Array.isArray(type)) return type.filter(…)` satırı silindi (`"@type": ["Product","IndividualProduct"]` artık hiç yargılanmaz) | JSON-LD'nin standart çoklu-tip biçimi | **YEŞİL KALDI** | Dar kapı **214/214**, geniş kapı **3766/3766**. Fonksiyonun kendi JSDoc'u (`:135`) "a string, or an array of them" diyor; hiçbir test dizi dalına bakmıyor. Etki asimetrik ve sinsi: böyle bir sayfa `typeCoverage`'da GÖRÜNMEYE devam eder (o sayım crawler'ın topladığı `jsonLdTypes`'tan gelir), ama `offers`i eksik Product'ı **hiç bildirilmez** — rapor "tipin var, sorun yok" gibi okunur |
| **M5** | **Kredi iade yolu** — `audit-shared.ts:125` `throw new PreconditionNotMetError(load.error)` → `return textResult(load.error)` (`withCredits` dönen handler'ı COMMIT eder → 5/15/30 kredi tahsil edilir) | "denetlenecek crawl yok" reddi ücretsizdir | **DAR KAPIDA YEŞİL, GENİŞ KAPIDA KIRMIZI (2 test)** | Dar kapı **214/214 yeşil** — audit şeridinde para yolunu ölçen HİÇBİR test yok. Geniş kapıda kırmızı: `every free refusal states the fee — one helper, three priced tools > audit_schema (5 credits): no crawl -> refuses, and says the refusal was free` (`budget-refusal.test.ts`) ve `the pre-condition refusal reaches the client verbatim > audit builder: NO_CRAWL_MESSAGE, isError, no crash sentence, no reference, no log line`. **Ders 15'in birebir örneği:** "dokunduğum dizinin testleri yeşil" kapının koştuğu şey DEĞİLDİR |

M1–M3 ve M5 iş emrinin adlandırdığı eksenlerdi (kural eşiği/koşulu + `audit-shared.ts` iade yolu);
dördü de bir yerde kırmızı verdi, ama **M5 nerede kırmızı verdiği bakımından bir bulgudur**.
M4 benim hipotezimdi ve tek gerçek delik odur.

Yeşil kalan her mutasyon bir bulgudur (ders 12/13).

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**, `git status --short` → boş;
geniş kapı yeniden **3766/3766**.
(Kapı kararlılığı uyarısı için `audit_tech.md` §2 sonundaki nota bakınız — aynı ağaçta 5 koşudan
2'si ilgisiz bir `server card` testinde kırmızı verdi.)

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (basılmadı). Bakiye önce/sonra **4479 sabit**. Bakiye tek başına kanıt
değildir (aynı kiracıda paralel işçiler var), bu yüzden Δ ayrıca `list_credit_activity`'den
kendi tool adımı taşıyan satırlardan doğrulandı.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| bilinmeyen uuid | `{"project_id":"00000000-0000-4000-8000-000000000000"}` | 200, `isError: true` | **0 (net)** | `No crawl found for this project. Run crawl_site first. You were not charged.` — `audit_tech` ile **kelimesi kelimesine aynı** cümle (ortak `NO_CRAWL_MESSAGE`, `load.ts:30`) |
| bozuk uuid | `{"project_id":"not-a-uuid"}` | 200, `isError: true` | **0** | `Invalid input for "audit_schema": ✖ Invalid UUID` / `  → at project_id You were not charged.` |
| **şema dışı anahtar** | `{"project_id":"e2785bf7-…","types":["Product"]}` | 200, `isError: true` | **0** | `Invalid input for "audit_schema": ✖ Unrecognized key: "types" You were not charged.` — #204 canlıda. Bu senaryo kasten "makul görünen" bir anahtarla denendi: bir modelin uydurması en olası alan tip filtresidir, ve sessizce yutulmuyor |
| arşivli proje | `{"project_id":"77f40d69-…"}` | 200, `isError: true` | **0** | `That project is archived, so it is not being tracked right now. Restore it with setup_project for the same domain — which works whether or not the project has a Search Console property — or with track_gsc_property for its property, or from the Connection page in SeoGrep. You were not charged.` |
| **crawl'ı olmayan proje** (`example.net`) | `{"project_id":"257ad998-…"}` | 200, `isError: true` | **0 (net; defterde −5 sonra +5)** | `No crawl found for this project. Run crawl_site first. You were not charged.` |
| zorunlu alan yok | `{}` | 200, `isError: true` | **0** | `Invalid input for "audit_schema": ✖ Invalid input: expected string, received undefined` / `  → at project_id You were not charged.` |

### İade yolunun DEFTER tarafı — ölçüldü (S-B9)

`list_credit_activity` üstünden, birebir (`{"limit":30,"before_id":805}` ve `{"limit":25}`):

```
- 2026-09-02T14:44:01.887748+00:00 · -5 credits · charge · audit_schema · project: 00000000-0000-4000-8000-000000000000
- 2026-09-02T14:44:02.0875+00:00   · +5 credits · refund · audit_schema · project: 00000000-0000-4000-8000-000000000000
- 2026-09-02T14:44:05.840767+00:00 · -5 credits · charge · audit_schema · project: dilim1-tek-kullanimlik-8b3f7c.com
- 2026-09-02T14:44:05.918551+00:00 · +5 credits · refund · audit_schema · project: dilim1-tek-kullanimlik-8b3f7c.com
- 2026-09-02T14:44:07.282995+00:00 · -5 credits · charge · audit_schema · project: example.net
- 2026-09-02T14:44:07.417974+00:00 · +5 credits · refund · audit_schema · project: example.net
```

Üç ölçüm, `audit_tech`'inkiyle aynı: (a) rezerv YALNIZ zod'u geçen üç redde açılıyor — diğer üçü
defterde hiç satır bırakmadı; (b) iade 78–200 ms içinde; (c) tool `You were not charged.` derken
defter `-5 credits · charge · audit_schema` diyor. Sistem doğru (append-only rezerv/iade,
NEVER#2), çelişen şey KELİMELERDİR. Ayrıntı ve öneri: `audit_tech.md` T-B11.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim2/d2-tech/probe.jsonl`
(anahtar `makeRedactor(process.env.MCP_SMOKE_URL)` ile redakte; dosyada uç nokta dizisi yok).

## 4. Canlı mutlu yol

Özne: **adstark.com.tr** (`project_id: e2785bf7-9963-4b6a-a6d7-aaed7b550abe`). Bakiye
**4464 → 4459** (Ç1) ve **4444 → 4439** (Ç2), toplam **Δ −10**, **2 ücretli çağrı**.
Defter kanıtı (birebir, iade satırı YOK — gerçekten tahsil edildi):

```
- 2026-09-02T14:44:28.163866+00:00 · -5 credits · charge · audit_schema · project: adstark.com.tr
- 2026-09-02T14:45:01.20163+00:00  · -5 credits · charge · audit_schema · project: adstark.com.tr
```

| senaryo | argüman | envelope | kredi Δ | çıktı özeti |
|---|---|---|---|---|
| Ç1 mutlu yol | `{"project_id":"e2785bf7-…"}` | 200, `result` anahtarları **yalnız `["content"]`**, 605 ms | **−5** | 4 bölüm (aşağıda birebir) |
| Ç2 determinizm | aynı argüman | 200, `["content"]`, 657 ms | **−5** | **byte-for-byte AYNI metin** (`===` ile ölçüldü) |

Ç1 = Ç2 çıktısı, birebir:

```
Structured-data audit — 1 page(s) (crawl from 2026-09-02T14:26:48.349Z).

Coverage: 0 of 1 page(s) have JSON-LD; 1 have none.

No JSON-LD @type found anywhere on the site.

Pages with NO structured data:
  · https://adstark.com.tr/iletisim

Note: detection is JSON-LD only (microdata/RDFa are not read); required fields were checked against the stored JSON-LD bodies on 1 page(s).
```

**Dört ölçüm bu on satırdan çıkıyor.**

**(a) Kapanış notu, çelişkili okunuyor (S-B4).** Rapor iki cümle arayla önce
`Coverage: 0 of 1 page(s) have JSON-LD` sonra `required fields were checked against the stored
JSON-LD bodies on 1 page(s)` diyor. Kod doğru: `pagesValidated` "gövde ALANI mevcut olan sayfa"
sayar ve gövdesi BOŞ olan sayfa da bir ölçümdür (`schema.ts:85-89` bunu yorumunda söylüyor).
Ama müşteriye giden cümle "1 sayfada gövde vardı ve kontrol ettim" gibi okunuyor. Sıfır JSON-LD'li
bir sitede bu cümle **var olmayan bir işi** anlatıyor gibi duruyor.

**(b) İkinci özdeş denetim ikinci kez ücretlendirildi (S-B5).** Aynı `crawl_job_id`, aynı byte'lar,
5 kredi daha; `audit_runs`'a ikinci satır (`audit-shared.ts:144` koşulsuz `writeRun`).
`audit_tech` T-B5 ile aynı kalem, aynı öneri.

**(c) "No JSON-LD @type found anywhere on the site." cümlesi 1 SAYFALIK bir crawl'a dayanıyor.**
`anywhere on the site` ifadesi tüm siteyi ima ediyor; ölçülen tek sayfa `/iletisim`. Denetlenen
crawl, `crawl_site`'ın ikinci, dar koşusudur (`include_paths: ["/iletisim"]`); aynı gün 51
sayfalık geniş bir crawl da vardı ve `loadLatestCrawl` yalnız EN SONUNCUYU alır (`load.ts:41-47`).
`audit_tech` T-B4 ile aynı kök neden, ama audit_schema'da **cümlenin kendisi** aşırı genelliyor.

**(d) ÖLÇÜLEMEDİ — gövde doğrulaması hiç tetiklenemedi.** `Required fields missing`,
`Pages with unparseable JSON-LD`, `Pages whose JSON-LD was only partly stored` ve
`Types across the site` bölümlerinin **dördü de** bu crawl'da satırsız kaldı, çünkü sayfada
hiç JSON-LD yok. §5'teki cümle envanteri bu yüzden **canlı gözlemden değil biçimlendirici
kaynağından** çıkarılmıştır (`format.ts:283-334`, tam okuma). Kapatmak için JSON-LD'si olan bir
projeye (ör. `dentnotion.com`, `noraninsaat.com`) bir çağrı gerekir; iş emrinin öznesi adstark ve
kredi tavanı tam dolu olduğu için YAPILMADI.

## 5. SEO güncelliği

Kaynak: `apps/mcp/src/audit/rules/schema.ts` + `apps/mcp/src/audit/format.ts:283-334`.
Referans satırı: `audit_schema | R-2.1–R-2.6, R-5.2 | **En yüksek risk:** FAQ/HowTo/ClaimReview
gibi kaldırılmış tipleri "fırsat" diye önermek; schema.org 30.0 sonrası eski sürüme göre
doğrulama`.

### 5a. Tool'un üretebileceği HER cümle (biçimlendiriciden tam sayım)

| # | üretilen cümle (`format.ts` satırı) | R-kuralı | uyum |
|---|---|---|---|
| 1 | `Structured-data audit — N page(s) (crawl from …).` (`:285`) | — | provenans |
| 2 | `Coverage: X of N page(s) have JSON-LD; Y have none.` (`:287-288`) | **R-2.5** | UYUYOR — "kapsam" iddiası, "geçerlilik" iddiası değil; R-2.5'in ("RRT temiz ≠ schema geçerli") uyardığı karışıklığa düşmüyor |
| 3 | `Types across the site:` + `<Type>: N page(s)` (`:292-293`) | **R-2.1** | **UYUYOR — allowlist YOK.** Crawler'ın gördüğü HER `@type` adı sayılır; galeri listesi hiçbir yerde kodlanmamıştır, dolayısıyla **bu bölüm bayatlayamaz**. Bedeli: hangi tipin Google'da bir rich result ürettiği de HİÇ söylenmez |
| 4 | `No JSON-LD @type found anywhere on the site.` (`:295`) | R-2.1 | KISMEN — `anywhere on the site` 1 sayfalık bir crawl'da da basılıyor (§4c) |
| 5 | `Pages with NO structured data:` + URL listesi (`:299-300`) | R-2.1 | UYUYOR — hangi schema'nın EKLENMESİ gerektiği **önerilmiyor**. Referansın adlandırdığı en yüksek risk ("kaldırılmış tipleri fırsat diye önermek") tam burada olabilirdi ve **yok**: tool hiçbir tip önermiyor |
| 6 | `Required fields missing: N` + `url — <Type> is missing a, b` (`:306-309`) | **R-2.1, R-2.2, R-2.3** | **AYKIRI (bir tipte).** Yargılanan 8 tipin biri `FAQPage` ve o tip galeride YOK (aşağıdaki tablo) |
| 7 | `Pages with unparseable JSON-LD: N` + `url (N block(s) failed to parse)` (`:312-313`) | R-2.5 | UYUYOR — ayrıştırılamayan blok Google için de ayrıştırılamaz; kaynak gerekçeyi yazıyor (`schema.ts:169-171`) |
| 8 | `Pages whose JSON-LD was only partly stored: N` + `url (N block(s) not stored)` + `  Note: required fields were checked on the stored blocks only.` (`:316-318`) | — | dış kural yok; kısmi ölçümü ilan etmesi doğru |
| 9a | `Note: detection is JSON-LD only (microdata/RDFa are not read); required fields were checked against the stored JSON-LD bodies on N page(s).` (`:328-329`) | R-2.5 | KISMEN — S-B4 (0 JSON-LD'li sayfada da basılıyor) |
| 9b | `Note: detection is JSON-LD only (microdata/RDFa are not read); only @type names are analyzed, never the JSON-LD body.` (`:330-331`) | R-2.5 | UYUYOR — eski crawl'lar için doğru cümle |
| 10 | `  … and N more` (her listede, `:28`) | — | 50'lik tavan; sessiz düşme yok |

### 5b. Galeri eşlemesi — yargılanan 8 tip, R-2.1'in 25 tipine karşı BİREBİR

`REQUIRED_FIELDS` (`schema.ts:40-49`) tool'un **yargıladığı** tam listedir. Listede olmayan hiçbir
tip yargılanmaz (`schema.ts:178` `if (required === undefined) continue;` — canlı description da
bunu söylüyor: *"unknown @type names are never judged"*).

| yargılanan tip | R-2.1 galerisinde var mı | uyum | not |
|---|---|---|---|
| `Product` | **VAR** (Product) | UYUYOR | zorunlu alanlar `name`, `offers` — galeri Product dokümanının merkezindeki iki alan |
| `Article` | **VAR** (Article) | UYUYOR | `headline`, `datePublished` |
| `BlogPosting` | galeride ADIYLA yok; `Article` ailesinin alt tipi | UYUYOR (aile) | R-2.1 "Article" diyor; `BlogPosting` schema.org'da onun alt tipidir. Uydurma değil |
| **`FAQPage`** | **YOK** — R-2.2 açıkça *"Galeride FAQPage ve HowTo artık yok"* diyor | **AYKIRI — BAYAT TİP** | Tool FAQ schema'sını ÖNERMİYOR (o kısım temiz), ama VAR OLAN bir `FAQPage`'i yargılıyor ve `mainEntity` eksikse müşteriye düzeltilecek bir iş yaratıyor. Google artık bu tip için rich result göstermiyor; iş karşılıksız (S-B1) |
| `BreadcrumbList` | **VAR** (Breadcrumb) | UYUYOR | `itemListElement` |
| `Organization` | **VAR** (Organization) | UYUYOR | `name` |
| `WebSite` | galeride YOK (25 tipin arasında değil) | **UYUYOR — ama gerekçesi başka bir kuralda** | R-2.1 rich-result galerisidir; `WebSite` orada olmasa da **R-4.1 birincil kaynağı onu adıyla anıyor**: title link kaynakları arasında *"`WebSite` structured data"*. Yani bu tipin belgelenmiş bir Google kullanımı VAR. Bayat değil |
| `LocalBusiness` | **VAR** (Local business) | UYUYOR | `name`, `address` |

**Galeride olup tool'un HİÇ yargılamadığı 20 tip** (bir eksiklik değil, kasıtlı dar kapsam —
`schema.ts:37-38` gerekçesini yazıyor; kayda geçsin diye): Carousel, Course list, Dataset,
Discussion forum, Education Q&A, Employer aggregate rating, Event, Image metadata, Job posting,
Math solver, Movie, Profile page, Q&A, Recipe, Review snippet, Software app, Speakable,
Subscription/paywalled content, Vacation rental, Video.

### 5c. Kalan kurallar

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-2.1** desteklenen 25 tip | `typeCoverage` allowlist'siz sayıyor; `REQUIRED_FIELDS` 8 tip yargılıyor | **KISMEN** | Sayım tarafı bayatlayamaz (allowlist yok); yargı tarafında 8 tipin 7'si galeriyle ya doğrudan ya belgeli biçimde uyuşuyor, 1'i (FAQPage) uyuşmuyor |
| **R-2.2** FAQPage ve HowTo galeriden çıktı | `FAQPage` **yargılanan listede** (`schema.ts:44`); `HowTo` hiç geçmiyor | **YARIM AYKIRI** | Ölçüm: `grep -rniE "FAQPage\|HowTo\|ClaimReview" apps/mcp/src` → **7 eşleşme, hepsi `FAQPage`**: üretim kodunda 2 (`rules/schema.ts:31` yorum, `:44` tablo), testte 5 (`schema-fields.test.ts` 3, `crawler/crawl.test.ts` 2 — yani testler de bu tipi pinliyor). **`HowTo` ve `ClaimReview` depoda HİÇ yok.** Riskin üç adından ikisi karşılıksız, biri gerçek — ve gerçek olan hem kodda hem kapıda sabitlenmiş |
| **R-2.3** ClaimReview + 6 niş tip de galeride yok | hiçbiri kodda yok | **UYUYOR (ölçülerek)** | aynı grep |
| R-2.4 Carousel tek başına yetmez (Recipe/Course/Restaurant/Movie ile eşlenmeli) | Carousel hiç modellenmiyor | **İLGİSİZ** | Tool tip ilişkilerini hiç kurmuyor; yalnız düz sayım + alan kontrolü. Yanlış bir şey söylemiyor |
| **R-2.5** RRT temiz ≠ schema geçerli | Description, mdx ve kapanış notu ÜÇÜ de "bu tam doğrulama değildir" diyor | **UYUYOR — bu turun en iyi uyumu** | mdx birebir: *"Absence of a finding is not a clean bill of health."* Kural bir aracın kendini fazla satmasına karşı; bu tool tam tersini yapıyor |
| **R-2.6** schema.org sürümü 30.0 (19 Mart 2026) | Hiçbir sürüm pinlenmiyor | **İLGİSİZ (ölçülerek)** | Ölçüm: `grep -rni "schema.org/version\|schemaVersion" apps/mcp/src` → hiç eşleşme yok. Referansın "eski sürüme göre doğrulama" riski **karşılıksız**: tool hiçbir sürüme göre doğrulamıyor, 8 tiplik elle yazılmış bir minimuma göre doğruluyor. Bayatlayamaz — ama schema.org'un kendi kısıtlarını da hiç uygulamıyor |
| **R-5.2** Google llms.txt gibi dosyaları tanımadığını AÇIKÇA yazıyor | Tool llms.txt'i hiç anmıyor | **UYUYOR (ölçülerek)** | Ölçüm: `grep -rni "llms.txt" apps/mcp/src apps/web/content/docs` → **hiç eşleşme yok**. 2024-2025'in en yaygın bayat tavsiyesi bu üründe hiç yok |

**Bayat kural taraması sonucu: BİR BAYAT TİP VAR — `FAQPage`.** Referansın bu tool için
adlandırdığı en yüksek riskin ("FAQ/HowTo/ClaimReview gibi kaldırılmış tipleri fırsat diye
önermek") **öneri yarısı temiz** (tool hiçbir schema önermiyor, `HowTo` ve `ClaimReview` kodda
hiç yok), **yargı yarısı kirli**: `FAQPage` hâlâ yargılanan sekiz tipten biri. İkinci risk
("schema.org 30.0 sonrası eski sürüme göre doğrulama") karşılıksız — hiçbir sürüm pinlenmiyor.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR ama sevk edilmemiş** — satır 31
`audit_schema: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`.
Canlıda ölçüldü: `tools/list` girişinin anahtarları **`name,description,inputSchema`** —
**`_meta` YOK**; iki `tools/call` cevabının `result` anahtarları **yalnız `["content"]`** —
**`structuredContent` YOK**.
`audit_tech`'te olduğu gibi, kartın isteyeceği yapılı nesne **zaten üretiliyor ve saklanıyor**:
`SchemaReport` `audit_runs.report`'a jsonb olarak yazılıyor (`audit/runs.ts:63-74`,
`auditReportToJson`). Bir `report` kartının doğrudan kullanabileceği alanlar hazır:
`pagesWithSchema`/`pageCount` (kapsam oranı), `typeCoverage` (çubuk), `missingFields` (satırlar).

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `plan.mjs:78` (`ID_TOOLS`:
  `{ tool: "audit_schema", idArg: "project_id", targetArg: null }`) ve **iki hücre**: `:266`
  (K1/S2, hiç crawl edilmemiş proje — bu turda canlıda koşuldu, net Δ 0) ve `:271` (K1/S1,
  kampanya siteleri). **S1 hücresi hiç koşulmamıştır** ve tam olarak §4(d)'de ölçülemeyen ekseni
  (gerçek JSON-LD taşıyan bir site) hedefler.
- `goals/` hedefi gerekli mi: **EVET** — `grep -rn "audit_schema" goals/` → hiç eşleşme yok.
  Değeceği iki predicate: (a) **galeri tazeliği** — `REQUIRED_FIELDS`'in anahtar kümesinin
  referans listesinin R-2.1 tipleriyle (artı R-4.1'in `WebSite` istisnasıyla) karşılaştırılması;
  bugün bir tip galeriden düştüğünde hiçbir kapı ses çıkarmıyor ve `FAQPage` tam olarak böyle
  kaldı. (b) **dizi biçimli `@type`** — M4'ün yeşil kaldığı eksen; bu ikincisi `goals/` yerine
  doğrudan `rules/schema-fields.test.ts`'e tek bir test olarak da inebilir.

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-03) |
|---|---|---|---|---|---|
| S-B1 | P2 | **`FAQPage` hâlâ yargılanan tipler arasında — R-2.2 ile aykırı.** 2026-09-02 galerisinde FAQPage yok; tool bir müşterinin FAQPage markup'ında `mainEntity` eksikse bunu bulgu olarak basıyor ve karşılıksız iş yaratıyor. **Hakem şerhi (şiddet P1'den P2'ye indirildi):** referansın bu tool için adlandırdığı en yüksek risk *"kaldırılmış tipleri **fırsat diye önermek**"*tir ve o risk GERÇEKLEŞMEMİŞ — `REQUIRED_FIELDS` bir **doğrulama** tablosudur, biçimlendiricide öneri dili yoktur (hakem grep'ledi; bu turda `format.ts` üzerinde yeniden ölçüldü: `recommend`/`opportunity`/`consider adding`/`suggest` → **hiç eşleşme yok**). Yani tool markup'ı OLMAYAN siteye FAQPage eklemesini söylemiyor; yalnız VAR olan markup'ı bozuk sayıyor | `schema.ts:44` `FAQPage: ["mainEntity"],` + `:31` yorumu; 7 grep eşleşmesinin 5'i test (§5c R-2.2); R-2.2 / R-2.3; `format.ts` öneri-dili grep'i (bu turda, boş) | Üç seçenek, hiçbiri "sessizce sil" değil: (a) `FAQPage`'i tablodan çıkarmak — ama o zaman tool markup'ı olan siteye hiçbir şey demez; (b) tabloda TUTUP bulgu cümlesine bir not eklemek ("FAQPage no longer produces a rich result in Google Search"); (c) yargılanan tip listesini referans listesine bağlayan bir `goals/` predicate'i (bkz. S-B1b). **(b)+(c) önerilir:** müşteri hem markup'ının bozuk olduğunu hem de düzeltmenin artık bir rich result getirmeyeceğini öğrenir | **KAPANDI #210** (canlıda gözlenmedi — FAQPage'li özne gerekir) — `FAQPage` doğrulama tablosundan çıktı; `FAQPage`/`HowTo` **emekli tip** olarak raporlanıyor: `FAQPage is no longer a Google rich result; keep it only if it serves users.` Seçenek (b) alındı |
| S-B1b | **P1** | **Kapı, yargılanan tip tablosunun TAZELENMESİNE direniyor — kalıcı bulgu.** `the required-field table is exactly the documented minimum` testi `REQUIRED_FIELDS`'i birebir pinliyor (M1'de ölçüldü). Bu, S-B1'den bağımsız ve ondan uzun ömürlü bir kusurdur: bugün FAQPage, yarın schema.org galerisinden düşen başka bir tip — tabloyu galeriye göre güncelleyen HER iş, önce testi değiştirmek zorunda kalır. NEVER#8 ("testi geçirmek için testi değiştirmek") ile birebir çarpışan bir kapı: test, doğru olanı yapmayı kural ihlali gibi gösteriyor. **`goals/` adayı** | §2 M1; `schema.ts:40-49` ↔ pinleyen test adı; R-2.2 / R-2.3 | Pin SİLİNMEZ (tabloyu koruyor). Değişmesi gereken, pinin NEYE bağlandığıdır: `goals/` altına, yargılanan tip listesini referans listesinin R-2.1 galerisine bağlayan bir predicate — "yargılanan her tip, o gün geçerli galeride VAR ya da yanında neden tutulduğunu söyleyen bir not taşıyor". Böylece tablo tazelendiğinde kapı yeşile döner, bugünse tazelenmeye direniyor | **KAPANDI #210** — pin artık kaynağın o günkü değerine değil **R-2.1'in 25 tiplik galerisine** bağlı (`R_2_1_GALLERY` + `BACKED_BY`; her yargılanan tip bir galeri satırına ya da adı yazılı bir kurala izlenir, `FAQPage`/`HowTo` yokluğu ayrıca pinli). Seçenek (c)'nin `goals/` predicate'i YAZILMADI — tablo tazelendiğinde kapı artık yeşile döner |
| S-B2 | **P1** | **Dizi biçimli `@type` alan doğrulamasında korumasız.** `typesOf`'un dizi dalı silindiğinde dar kapı 214/214, geniş kapı **3766/3766 yeşil kaldı**. `"@type": ["Product","IndividualProduct"]` JSON-LD'nin standart ve yaygın biçimidir | §2 M4; `schema.ts:136-141` | `schema-fields.test.ts`'e tek bir test: `@type` dizi olan bir Product'ın eksik `offers`'ı bildirilir. Üç satır, ve bugün kapının göremediği tek biçim. Etkisi asimetrik: böyle bir sayfa `typeCoverage`'da GÖRÜNMEYE devam ettiği için rapor "tipin var" der ve eksik alan hiç bildirilmez — sessiz bir yanlış-temiz | **KAPANDI #210** — dizi biçimli `@type` (`["Product","IndividualProduct"]`) alan doğrulamasında pinli |
| S-B3 | **P1** | **Kredi iade yolunu DAR kapı görmüyor (ders 15).** `throw` → `return textResult` mutasyonu — yani "denetlenecek crawl yok" reddinin 5/15/30 krediye mal olması — `src/audit/` + üç audit test dosyasından oluşan şeritte **214/214 yeşil** kaldı. Yalnız `pnpm --filter @pseo/mcp test` (`budget-refusal.test.ts` + registry testi) kırmızı verdi | §2 M5, iki kırmızı testin adı orada | Bir bulgu olarak kaydı önemlidir çünkü **kapının kendisi hakkında**: bu tool'a dokunan bir iş "audit testlerim yeşil" diyerek para yolunu kırmış olabilir. Öneri: `audit-shared.ts`'e dokunan işlerin iş emrine kapı olarak paket-geneli `pnpm --filter @pseo/mcp test` yazılsın; ya da para pinlerinden biri audit şeridine taşınsın | **KAPANDI #210** — iade yolu DAR şeritte pinli: `rpcCalls` `["reserve_credits","release_reserve"]`, `commit_reserve` YOK |
| S-B4 | P2 | **Kapanış notu, hiç JSON-LD olmayan bir sitede yapılmamış bir işi anlatıyor gibi okunuyor.** `Coverage: 0 of 1 page(s) have JSON-LD` ile `required fields were checked against the stored JSON-LD bodies on 1 page(s)` iki cümle arayla duruyor | §4 canlı çıktı (birebir); `schema.ts:85-89`, `format.ts:325-332` | Kod doğru — `pagesValidated` "gövde alanı MEVCUT olan sayfa" demektir ve bu gerçekten bir ölçümdür. Düzeltilecek olan cümledir: ör. `bodies were available to check on N page(s)` ya da `missingFields`/`invalidJson` sıfırken kapanışın "…and none of them carried any JSON-LD to check" demesi | AÇIK — iş emrinde yoktu |
| S-B5 | P2 | **Özdeş denetim tekrarında UYARI CÜMLESİ yok.** Aynı `crawl_job_id`, byte-for-byte aynı metin, Δ −5 ve −5, `audit_runs`'a ikinci satır. Kopya yarısı: ödemeden önce "bu crawl zaten denetlendi" diyen tek cümle yok | §4 Ç1≡Ç2; `audit-shared.ts:144`; `audit/runs.ts:63-74` | `audit_tech` T-B5 ile AYNI kalem ve aynı öneri (rapor başlığına `this crawl was already audited at <ts>`). Ücretlendirme davranışı değişmez; audit_schema'da tutar küçük (5 kredi) ama sessizlik aynı | **KAPANDI #212** + canlı ✔ (dff7f32) — `audit_tech` T-B5 ile aynı cümle, dört audit'te ortak |
| S-B5b | İMZA KALEMİ | **Ücretsiz tekrar / `confirm` kapısı fiyat modelidir (NEVER#6).** `audit_tech` T-B5b ile aynı karar; audit_schema'nın birim fiyatı 5 kredi ve bu karar üç ücretli audit'in üçünü birden bağlar — tek tek imzalanırsa yüzey kendi içinde tutarsızlaşır | §4 Ç1≡Ç2; NEVER#6; kardeş kalemler `audit_tech` T-B5b, `audit_onpage` A-3b | Operatör imzası olmadan KOD YAZILMAZ. **Üçü tek imzada karara bağlanmalı** — 5 / 15 / 30 kredilik üç audit için farklı tekrar politikası, müşteriye açıklanamaz bir yüzey üretir | İMZA KALEMİ — `audit_tech` T-B5b / `audit_onpage` A-3b ile TEK karar |
| S-B6 | P2 | **Yargılanan sekiz tipin tam listesi müşteriye HİÇBİR YERDE verilmiyor.** mdx dört örnek sayıyor (`Product`, `Article`, `BreadcrumbList`, `LocalBusiness`), description "known types" diyor; `FAQPage`, `BlogPosting`, `Organization`, `WebSite` hiçbir müşteri metninde geçmiyor. Bulgu almayan bir müşteri hangi tiplerin bakılıp hangilerinin bakılmadığını bilemiyor | `audit-schema.mdx:24` ↔ `schema.ts:40-49` | Sekiz tipi mdx'te listelemek (üretilmiş olarak, tablodan) — hem S-B1'i görünür kılar hem "not judged" iddiasını denetlenebilir yapar. Bugün "handful of types" ifadesi doğru ama sayısız | AÇIK — iş emrinde yoktu. mdx #210'da *"each one backed by a type Google's own gallery documents"* cümlesini kazandı, ama **sekiz tipin listesi hâlâ verilmiyor** |
| S-B7 | P2 | **Denetlenen crawl seçilemiyor; `anywhere on the site` cümlesi 1 sayfaya dayanıyor.** `loadLatestCrawl` yalnız EN SON crawl'ı alır; adstark'ta 51 sayfalık crawl'ın üstüne 1 sayfalık dar crawl yazılmıştı | `load.ts:41-47`; §4 canlı çıktı; `format.ts:295` | `audit_tech` T-B4 ile aynı kök neden. audit_schema'ya özgü ek: `No JSON-LD @type found anywhere on the site.` cümlesindeki `anywhere on the site` ifadesi, taranan sayfa sayısı ne olursa olsun basılıyor — cümle crawl kapsamını içermeli | KISMEN **#212** — `job_id` + kapsam cümlesi kapandı; **AÇIK:** `No JSON-LD @type found anywhere on the site.` cümlesi hâlâ kapsamdan bağımsız (#212'nin kendi "Ölçülmeyen" bölümü bunu adıyla yazıyor) |
| S-B8 | P2 | **Kart planlı, sevk edilmemiş; yapılı kanal boş — oysa `SchemaReport` zaten jsonb olarak saklanıyor.** Canlı `tools/list` `_meta` taşımıyor, `tools/call` yalnız `content` taşıyor | `card-map.ts:31` + `:62`; canlı envelope ölçümü (§6); `audit/runs.ts:63-74` | Depo-geneli kalem. Bu tool'a özgü not: bir `report` kartının isteyeceği üç alan (`pagesWithSchema`/`pageCount`, `typeCoverage`, `missingFields`) rapor nesnesinde hazır duruyor | ERTELENDİ → sınıf 8 (kart dilimi) |
| S-B9 | P2 | **"You were not charged." ile defterin `-5 credits · charge · audit_schema` satırı aynı olayı zıt kelimelerle anlatıyor.** Reddedilen üç çağrının üçü de deftere önce `charge`, 78–200 ms sonra `refund` yazdı | §3 "İade yolunun DEFTER tarafı" — altı satır birebir | `audit_tech` T-B11 ile aynı kalem; sistem doğru (append-only, NEVER#2), düzeltilecek olan kelime. Depo-geneli, üç ücretli audit'in üçünü birden ilgilendiriyor | İMZA KALEMİ — sınıf 7; `audit_tech` T-B11 ile tek karar |
| S-B10 | P2 | **Kaynak dosyanın iki yorum bloğu birbiriyle çelişiyor.** `audit-schema.ts:6-9` hâlâ *"the crawler stores type names, not the body"* diyor; hemen altındaki blok (`:11-26`) ve canlı description gövdelerin saklandığını ve doğrulandığını söylüyor. Müşteriye giden hiçbir metin etkilenmiyor | `audit-schema.ts:6-9` ↔ `:27-33` ↔ canlı description | Yalnız yorum; ama bu dosyayı okuyan bir sonraki işçi ilk bloğu okuyup "gövde saklanmıyor" varsayabilir — ders 16'nın kod yorumlarındaki hâli (kapanmış bir iddiayı bırakmak). İlk blok ikincisiyle birleştirilsin | AÇIK — iş emrinde yoktu; `audit-schema.ts:6-9` yorum bloğu hiçbir PR diff'inde değişmedi |

## Canlı doğrulama eki (şef, 2026-09-03, deploy `dff7f32`, Δ −25)

- `audit_schema` cevabı kapsam cümlesiyle başlıyor: `Audited crawl 53907ab7 from 2026-09-02: 1 page(s), 0 URL(s) skipped. That is this project's most recent crawl — pass job_id …` (sınıf 1 ✔).
- Tekrar-denetim notu basıldı: `Note: this crawl was already audited by audit_schema on 2026-09-03 08:30 UTC. Re-running produces the same report and is charged again.` — UTC damgası doğru biçimde (repeatNote UTC varsayımı ✔).
- `crawl_site` ikinci istek: `A crawl of adstark.com.tr is already in flight — poll it with get_job_status {…}. job_id: … · status: queued. No second crawl was queued and you were not charged …` — bakiye ikinci istekte değişmedi (B-1 sıralı yarısı ✔; ilk cevap `status: queued or already running`, B-2 ✔).
- Defter satırları artık `project: adstark` taşıyor — migration 0033 proje kapsamı canlıda ilk kez görüldü (Dilim 1 LCA B-6'nın canlı yarısı ✔).
