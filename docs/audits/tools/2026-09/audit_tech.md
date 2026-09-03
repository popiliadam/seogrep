# `audit_tech` — tool kontrol kaydı (2026-09 turu)

> Dilim: 2 (tech) · İşçi: Opus 4.8 (d2-tech) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, Δ −30 kredi** (dilim tavanı 40; `audit_schema` ile
> birlikte toplam **Δ −40**, tam sınırda).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `audit-tech.ts:28-35` + ortak kurucu `audit-shared.ts:76-150`; kredi `costs.ts:107` = `  audit_tech: 15,`; docs "**Cost:** 15 credits." — description ↔ mdx ↔ canlı `tools/list` üçü de BİREBİR tutuyor, tutarsızlık yok |
| 2 Mutasyon | ÖLÇÜLDÜ | 7 mutasyon: M1/M2/M3/M4/M5 KIRMIZI · **M6 ve M7 (`noindex` kelime sınırı, İKİ ayrı kopyada) YEŞİL KALDI** — tam paket şeridinde de (3766/3766) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 6 senaryonun 6'sı doğru reddedildi, net Δ **0**; şema dışı anahtar reddediliyor (`Unrecognized key: "depth"`, #204 canlıda). **Defterde ölçüldü:** zod'u geçen 3 redde rezerv AÇILIYOR ve 90–200 ms'de iade ediliyor — cevabın "You were not charged." cümlesi defterin `charge` satırıyla ZIT (T-B11) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (Δ −15 · −15). İkinci çağrı **byte-for-byte aynı** raporu döndürdü ve TEKRAR ücretlendirdi. Denetlenen crawl: **1 sayfa** — 51 sayfalık crawl'ın üstüne yazılmış |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 25 kural tek tek; **BAYAT KURAL YOK** (`noarchive`/`nositelinkssearchbox` hiç geçmiyor, `crawl-delay` raporlanmıyor), ama **11 kural yapısal olarak ölçülemez** (robots.txt gövdesi audit'e hiç ulaşmıyor) ve hreflang toplanıp hiç okunmuyor |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:30` `audit_tech: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`; canlı `tools/list` `_meta` taşımıyor, `tools/call` `result` anahtarları yalnız `["content"]` (ikisi de ölçüldü) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi **VAR** (`:77`, `:265`, `:270`) · `goals/` içinde audit_tech DAVRANIŞINI ölçen hedef **YOK** |

**Karar (ölçüm turu, 2026-09-02):** DÜZELTME GEREKLİ — para hikâyesi dürüst (altı reddin altısı ücretsiz, kredi satırı
tek kaynaktan) ve bayat SEO kuralı taşımıyor; ama **hangi crawl'ın denetlendiği seçilemiyor**
(15 kredi 1 sayfaya gitti), **ikinci özdeş denetim sessizce ikinci kez ücretlendiriliyor**,
`noindex` token'ının kelime sınırı hiçbir testin bakmadığı yerde duruyor, ve referans listesinin
bu tool'a atfettiği 25 kuralın **11'i tool'un eline hiç ulaşmayan veri** üstünde.

**Karar (kapanış, 2026-09-03):** KAPANDI (#210 + #212) — **dört P1'in dördü de kapandı:** token ayrıştırma ve iki kopyanın birleşmesi (T-B1), `none` (T-B2), hreflang kural motoru (T-B3), crawl seçimi + kapsam cümlesi (T-B4). T-B5 kopya yarısı ve T-B6 de kapandı. **Kalanlar:** T-B5b ve T-B11 **İMZA KALEMİ** · T-B7 ERTELENDİ → sınıf 8 · T-B8 ERTELENDİ → sınıf 6 · T-B9 ve T-B10 **AÇIK**. **Kapının ÖLÇMEDİĞİ:** hreflang ve emekli-tip bölümleri **koşullu** olduğu için #210 deploy'unda canlıda GÖRÜLMEDİ (adstark'ta 1 sayfalık crawl, hreflang'siz) — regresyon yok, Δ −20; iddia bugün birim testinde duruyor.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/audit-tech.ts:43-45` (`makeAuditTechTool` → ortak kurucu),
  üretim örneği `auditTechTool` `:47`. Gerçek handler gövdesi **ortaktır**:
  `apps/mcp/src/tools/audit-shared.ts:76-150` (`makeAuditTool`).
- Kural motoru: `apps/mcp/src/audit/rules/tech.ts` (421 satır, `auditTech` `:398`),
  biçimlendirici `apps/mcp/src/audit/format.ts:179-279` (`formatTechReport`),
  girdi ayrıştırıcı `apps/mcp/src/audit/crawl-data.ts`, crawl yükleyici `apps/mcp/src/audit/load.ts`,
  koşu defteri `apps/mcp/src/audit/runs.ts`.
- Kayıt: `apps/mcp/src/tools/index.ts:15` (import), `:84` (export), `:182` (araç dizisi).
- Zod şeması (`audit-shared.ts:72-74`) — canlı JSON Schema ile birebir doğrulandı:
  - `project_id`: `z.uuid()`, **tek alan ve zorunlu** (canlı `"required": ["project_id"]`)
  - `.describe("The project to audit (from setup_project / list_projects).")` — canlı şemada birebir
  - Canlı şema `"additionalProperties": false` taşıyor (registry `schema.strict()`, #204) ve
    `format: "uuid"` + `pattern` ile geliyor
  - **Başka hiçbir alan yok:** crawl seçimi, bölüm filtresi, eşik ayarı — hiçbiri şemada yok (B-4)
- Description (birebir alıntı):
  > Audit technical SEO for a project's latest crawl. Always reported: HTTP status, Redirects surfaced, Not crawled (skipped URLs grouped by reason), Robots conflicts (noindex but internally linked). Reported only when the crawl has them: Slow pages, Heavy pages, Redirect chains, X-Robots-Tag conflicts, Deep pages, No internal links found (orphan signal), Broken internal links, Sitemap vs crawl (printed whenever a sitemap was read — even at zero). Costs 15 credits. Run crawl_site first.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:107`, birebir): `  audit_tech: 15,`
- Ücretlendirme kipi: **varsayılan `"surface"`** — rezerv çağrı anında açılır, handler döner,
  COMMIT olur (`audit-shared.ts:19-30` bunu kendi yorumunda söylüyor). Bu yüzden "denetlenecek
  crawl yok" cevabı **THROW** etmek zorundadır; `return` etseydi 15 kredi tahsil edilirdi.
  Bu tam olarak M5 mutasyonunun ölçtüğü şeydir (bkz. §2).
- Docs sayfası (`apps/web/content/docs/tools-reference/audit-tech.mdx`, birebir):
  > **Cost:** 15 credits.

  ve:
  > Run `crawl_site` first — with no crawl on record the tool says so and charges nothing.

  ve (eşikler, prose ↔ sabit):
  > **Slow pages** — a fetch that took over three seconds, redirect hops included, because that is what a visitor actually waits for.

  > **Heavy pages** — an HTML document over a megabyte and a half. The markup alone; images are never counted here.
- Tutarsızlıklar: **yok**. Karşılaştırılanlar: kaynak `DESCRIPTION` ↔ canlı `tools/list`
  description (birebir, JSONL'de) ↔ mdx frontmatter `description` (üretilmiş, kırpılmış);
  `costs.ts:107` 15 ↔ description "Costs 15 credits." ↔ mdx "**Cost:** 15 credits." ↔ ölçülen
  Δ −15; `SLOW_PAGE_MS = 3_000` (`tech.ts:27`) ↔ mdx "over three seconds" ↔ canlı başlık biçimi
  `Slow pages (fetch over 3000 ms)`; `HEAVY_PAGE_BYTES = 1_500_000` (`tech.ts:34`) ↔ mdx
  "a megabyte and a half"; `DEEP_PAGE_DEPTH = 4` ↔ mdx "four or more clicks";
  `REDIRECT_CHAIN_MIN = 2` ↔ mdx "two or more hops". **Beş eşiğin beşi de üç yerde tutuyor**,
  ve bu üçlü uyum `audit-tech.test.ts`'te gerçek bir render'a karşı pinli (M1 ve M3 bunu
  kırmızıya döndürdü).
  Tek üslup notu (tutarsızlık değil): description "Sitemap vs crawl"i *"Reported only when the
  crawl has them"* listesinde sayıyor ama parantez içinde tersini söylüyor
  (*"printed whenever a sitemap was read — even at zero"*). Parantez çelişkiyi kapatıyor.
- Seçilebilirlik: "run a technical audit", "sitemde teknik SEO sorunu var mı", "404'lerim var mı",
  "sitemap ile taranan sayfalar tutuyor mu" → `audit_tech`. **Üç komşusu aynı girdiyi alıyor ve
  aynı crawl'ı okuyor**: `audit_onpage` (30 kredi), `audit_schema` (5), ayrıca `audit_speed` (15,
  ayrı girdi) ve `audit_content` (12). Ayrım yalnız description'daki bölüm adlarından okunur;
  şema, hata cümlesi ve "Run crawl_site first" cümlesi ÜÇÜNDE DE AYNIDIR. "Sitemi denetle" diyen
  bir kullanıcı için model üçünü de çağırırsa fatura **50 kredi**dir ve hiçbir tool bunu söylemez.
  İkinci risk: `crawl_site`'ın bitiş cümlesi üç tool'u da adıyla öneriyor
  (*"run audit_onpage, audit_tech or audit_schema"*, Dilim 2 crawl kaydında ölçüldü), yani
  sıralamayı öğreten cümle ücret toplamını hiç anmıyor.

## 2. Mutasyon (test gerçekten bakıyor mu)

Dar kapı: `pnpm --filter @pseo/mcp exec vitest run src/audit/ src/tools/audit-tech.test.ts
src/tools/audit-schema.test.ts src/tools/audit-runs.test.ts` → taban **214 passed / 17 files**.
Geniş kapı: `pnpm --filter @pseo/mcp test` → taban **3766 passed / 143 files**.
`*.db.test.ts` Docker ister — **db şeridi koşulmadı** (`audit-runs.db.test.ts`,
`audit-onpage.db.test.ts`, `audit-speed.db.test.ts`).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | **Eşik** — `tech.ts:40` `DEEP_PAGE_DEPTH = 4` → `40` | derinlik eşiğini ve prose↔sabit uyumunu ölçen testler | **KIRMIZI** (7 test) | `deep_pages > NEGATIVE + BOUNDARY: depth 3 is clean, depth 4 is not` + `audit_tech — the ground truth the prose has to match > prints twelve sections…` + description ve **docs sayfası** testleri. Eşik değişince yalnız kural değil, tool description'ı ve mdx bülteni de kırmızıya dönüyor — üç yüzey tek pinde |
| M2 | **Koşul tersine** — `tech.ts:292-297` X-Robots-Tag çatışmasından "meta susuyor" yarısı silindi (`&& !(page.robotsMeta …)` kaldırıldı) | iki kanalın AYNI şeyi söylemesinin çatışma OLMADIĞINI ölçen test | **KIRMIZI** (1 test) | `x_robots_conflict > NEGATIVE: both channels saying noindex is a site repeating itself, not a conflict`. Testin kendi yorumu (`tech-signals.test.ts:110`) bu mutasyonu adıyla öngörmüş |
| M3 | **Eşik** — `tech.ts:375` `page.status >= 400` → `>= 500` (4xx hedefli iç linkler artık kırık sayılmaz) | kırık iç link kuralı | **KIRMIZI** (9 test) | `broken_internal_links > POSITIVE: a link to a page this crawl fetched and got a 404 from` + `… normalizes trailing slashes on BOTH sides` + description/docs testleri + `the returned text is byte-identical … 'audit_tech'` |
| M4 | **Doktrin** — `tech.ts:344` `if (sitemapUrls === undefined \|\| sitemapUrls.length === 0)` → yalnız `undefined` (boş sitemap artık "0 ve 0 anlaşma" diye basılır) | null ≠ boş doktrini | **KIRMIZI** (1 test) | `sitemap_diff > EMPTY: a crawl that looked and found no usable sitemap also claims nothing`. Kaynağın 334-341'deki yorumunun testte karşılığı VAR |
| M5 | **Sınıflandırma** — `tech.ts:204` `categorizeSkip`'ten `\|\| r.includes("time budget")` silindi | zaman bütçesi atlamalarının `limit` kovasına düşmesi | **KIRMIZI** (1 test) | `categorizeSkip > buckets each crawler skip reason`. Canlı crawl'ın baskın atlama sebebi tam olarak buydu ("time budget exhausted after 91s"), yani kapı gerçek veriyi koruyor |
| **M6** | **`noindex` kelime sınırı** — `tech.ts:44` `hasNoindex`: `/\bnoindex\b/i` → `/noindex/i` | R-3.15: direktif TOKEN'dır, alt dizi değil | **YEŞİL KALDI** | Dar kapı **214/214**, geniş kapı **3766/3766**. `hasNoindex` yalnız X-Robots-Tag çatışmasında kullanılıyor: `X-Robots-Tag: x-noindexing` gibi bir değer bugün doğru şekilde yok sayılıyor, yarın yanlış şekilde çatışma sayılırsa **hiçbir kapı görmez** |
| **M7** | **İkinci kopya** — `tech.ts:247` `robotsConflicts` içindeki SATIR İÇİ `/\bnoindex\b/i` → `/noindex/i` | aynı kural, meta kanalında | **YEŞİL KALDI** | Dar **214/214**, geniş **3766/3766**. Aynı düzenli ifade **iki ayrı yerde kopyalanmış** (`:44` fonksiyon, `:247` satır içi) ve İKİSİ de korumasız — ders 14'ün "aynı cümleyi taşıyan İKİNCİ sabit" kalıbı |

M1–M5 iş emrinin/şefin önerdiği eksenlerdi (eşik ve koşul tersine çevirme) ve **beşi de kırmızı
verdi** — yani hipotez bu kez doğruydu. Yeşil kalan iki mutasyon **benim hipotezimdi** ve ikisi de
aynı yerde: `noindex` direktifinin TOKEN olarak ayrıştırılması, yani R-3.15'in tam merkezi.

Yeşil kalan her mutasyon bir bulgudur (ders 12/13).

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**, `git status --short` → boş;
geniş kapı yeniden **3766/3766**.

> **Kapı kararlılığı notu (bu tool'a ait DEĞİL, ama ölçüldü):** aynı ve DEĞİŞMEMİŞ ağaçta beş
> `pnpm --filter @pseo/mcp test` koşusundan **ikisi** kırmızı verdi, her ikisinde de aynı test:
> `mcp gateway public server card > the card describes the REAL key-based auth and claims no OAuth
> we do not implement`, hata `TypeError: Cannot read properties of undefined (reading 'required')`
> (gerçek bir HTTP sunucusu ayağa kaldırıp kendi kartını çeken test). Audit şeridiyle ilgisi yok;
> ama bu turda `pnpm --filter @pseo/mcp test` **deterministik değildi** ve bunu bilmeden bir
> mutasyon "kırmızı" sanılabilirdi. Bulgu T-B10.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (basılmadı). Her çağrının önünde ve arkasında `get_credit_balance` koşuldu:
bakiye **4479'da sabit kaldı**. Ama **bakiye farkı bu turda tek başına kanıt değildir** — bu
kiracının defterine aynı anda başka dilim işçileri de yazıyordu (aşağıdaki defter dökümünde
`audit_onpage`/`audit_content` satırları görünüyor, benim işim değil). Bu yüzden Δ, protokolün
düzeltilmiş tarifine göre **`list_credit_activity` üstünden, kendi tool adımı taşıyan defter
satırlarından** doğrulandı.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| bilinmeyen uuid | `{"project_id":"00000000-0000-4000-8000-000000000000"}` | 200, `isError: true` | **0** | `No crawl found for this project. Run crawl_site first. You were not charged.` — varlık sızdırmıyor (`load.ts:34-40`'ın kasıtlı tek cümlesi), ücretsizliği kendisi söylüyor |
| bozuk uuid | `{"project_id":"not-a-uuid"}` | 200, `isError: true` | **0** | `Invalid input for "audit_tech": ✖ Invalid UUID` / `  → at project_id You were not charged.` |
| **şema dışı anahtar** | `{"project_id":"e2785bf7-…","depth":3}` | 200, `isError: true` | **0** | `Invalid input for "audit_tech": ✖ Unrecognized key: "depth" You were not charged.` — **#204 canlıda doğrulandı**; sessiz yutma YOK |
| arşivli proje (kendi kiracımız) | `{"project_id":"77f40d69-…"}` | 200, `isError: true` | **0** | `That project is archived, so it is not being tracked right now. Restore it with setup_project for the same domain — which works whether or not the project has a Search Console property — or with track_gsc_property for its property, or from the Connection page in SeoGrep. You were not charged.` — arşiv kapısı crawl okumasından ÖNCE (`audit-shared.ts:109-112`) |
| **crawl'ı olmayan proje** (`example.net`, `last job: none yet`) | `{"project_id":"257ad998-…"}` | 200, `isError: true` | **0** | `No crawl found for this project. Run crawl_site first. You were not charged.` — **iade yolu ölçüldü: kredi hiç DÜŞMEDİ.** Rezerv açılıp geri verilmiyor değil; `withCredits` THROW'da RELEASE ediyor ve bakiye 4479'da hiç kımıldamadı (önce/sonra iki ayrı `get_credit_balance` ile) |
| zorunlu alan yok | `{}` | 200, `isError: true` | **0** | `Invalid input for "audit_tech": ✖ Invalid input: expected string, received undefined` / `  → at project_id You were not charged.` |

Not (T-B6): iki cümle **ayırıcısız** birleşiyor — `→ at project_id You were not charged.`
Altı senaryonun üçünde aynı biçim. 2026-08-27'deki F-6 (`get_job_status` çift nokta) ve Dilim 2
`crawl_site` B-8 ile aynı aile: cümle birleştirme tek yerden yapılmıyor.

### İade yolunun DEFTER tarafı — ölçüldü, ve cümleyle çelişiyor (T-B11)

İş emrinin sorduğu soru buydu: *"kredi düşüp iade ediliyor mu?"* Bakiye hiç kımıldamadığı için
`get_credit_balance` bu soruyu **cevaplayamaz**. `list_credit_activity` cevaplıyor, ve cevap
**evet**: rezerv defterin kendisine yazılıyor, sonra iade ediliyor. Aşağıdaki altı satırın altısı
birebir alıntıdır (`list_credit_activity {"limit":30,"before_id":805}`):

```
- 2026-09-02T14:43:53.419155+00:00 · -15 credits · charge · audit_tech · project: 00000000-0000-4000-8000-000000000000
- 2026-09-02T14:43:53.611882+00:00 · +15 credits · refund · audit_tech · project: 00000000-0000-4000-8000-000000000000
- 2026-09-02T14:43:57.708338+00:00 · -15 credits · charge · audit_tech · project: dilim1-tek-kullanimlik-8b3f7c.com
- 2026-09-02T14:43:57.798391+00:00 · +15 credits · refund · audit_tech · project: dilim1-tek-kullanimlik-8b3f7c.com
- 2026-09-02T14:43:59.114558+00:00 · -15 credits · charge · audit_tech · project: example.net
- 2026-09-02T14:43:59.250406+00:00 · +15 credits · refund · audit_tech · project: example.net
```

Üç ölçüm:

1. **Rezerv YALNIZ zod'u geçen üç senaryoda açılıyor.** Altı negatiften üçü (bozuk uuid, şema dışı
   anahtar, eksik alan) defterde **hiç satır bırakmadı** — reddediliş handler'a girmeden,
   registry katmanında oluyor. Diğer üçü (bilinmeyen uuid, arşivli, crawl'ı olmayan) rezerv
   açıyor ve THROW ile serbest bırakıyor. `audit-shared.ts:19-30`'un ilan ettiği sözleşme
   canlıda **birebir** böyle davranıyor.
2. **İade süresi 90–200 ms** (yukarıdaki damgalardan ölçüldü: 192 ms · 90 ms · 136 ms).
3. **Cümle ile defter aynı olayı ZIT kelimelerle anlatıyor (T-B11).** Tool'un cevabı
   `You were not charged.` diyor; aynı olayın defter satırı `-15 credits · charge · audit_tech`
   diyor. Defterin kendi kapanış cümlesi bunu açıklıyor — birebir:
   > These are the entries that moved your balance, so a refunded run shows both its charge and its refund.

   Yani sistem tutarlı ve append-only doğru (NEVER#2); **çelişen şey kelimelerdir**, ve tesadüfen
   düzelten şey `list_credit_activity`'nin bir cümlesidir — `audit_tech`'in kendi cevabında bu
   uyarı yok.
4. **Yan gözlem (sızıntı değil, ama kayda değer):** arşivli projenin defter satırı projeyi
   **adıyla** yazıyor (`project: dilim1-tek-kullanimlik-8b3f7c.com`), var olmayan uuid'inki ham
   uuid'i. Kendi defterinde olduğu için kiracı sınırı ihlali yok; ama defter, tool'un cevabının
   kasten gizlediği bir ayrımı (proje var mı yok mu) **çözüyor**.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim2/d2-tech/probe.jsonl`
(53 kayıt: 17 `tools/call` + 34 `get_credit_balance` + 2 `tools/list` girişi; anahtar
`makeRedactor(process.env.MCP_SMOKE_URL)` ile redakte, dosyada tek bir uç nokta dizisi yok).

## 4. Canlı mutlu yol

Özne: **adstark.com.tr** (`project_id: e2785bf7-9963-4b6a-a6d7-aaed7b550abe`, `list_projects`
canlı çıktısından). Bakiye: **4479 → 4464** (Ç1) ve **4459 → 4444** (Ç2), toplam **Δ −30**,
**2 ücretli çağrı**. (Aradaki 4464→4459 `audit_schema`'nındır.)

Bakiye farkı yan kanıttır; asıl kanıt defterdir (`list_credit_activity`, birebir) — bu iki satır
**iade satırı taşımıyor**, yani gerçekten tahsil edildi:

```
- 2026-09-02T14:44:26.365081+00:00 · -15 credits · charge · audit_tech · project: adstark.com.tr
- 2026-09-02T14:44:59.718027+00:00 · -15 credits · charge · audit_tech · project: adstark.com.tr
```

| senaryo | argüman | envelope | kredi Δ | çıktı özeti |
|---|---|---|---|---|
| Ç1 mutlu yol | `{"project_id":"e2785bf7-…"}` | 200, `result` anahtarları **yalnız `["content"]`**, 646 ms | **−15** | 5 bölüm basıldı (aşağıda birebir) |
| Ç2 determinizm | aynı argüman | 200, `["content"]`, 596 ms | **−15** | **byte-for-byte AYNI metin** (`===` ile ölçüldü, JSONL üstünde) |

Ç1 = Ç2 çıktısı, birebir:

```
Technical audit — 1 page(s), 0 skipped (crawl from 2026-09-02T14:26:48.349Z).

HTTP status: 1 ok (2xx), 0 redirect (3xx), 0 client error (4xx), 0 server error (5xx).

Redirects surfaced: 0

Not crawled (skipped): 0

Robots conflicts (noindex but internally linked): 0

Sitemap vs crawl (1 URL(s) read from the sitemap):
  in the sitemap but not crawled: 0; crawled but not in the sitemap: 0
```

**İki ölçüm bu çıktıdan çıkıyor ve ikisi de bulgudur.**

**(a) Denetlenen crawl, beklenen crawl DEĞİL (T-B4).** `crawl from 2026-09-02T14:26:48.349Z` ve
`1 page(s)`: bu, Dilim 2'nin crawl işçisinin ikinci, DAR crawl'ıdır
(`max_urls: 5, include_paths: ["/iletisim"]`, 1 sayfa). Aynı gün aynı projede **51 sayfalık**
geniş bir crawl da koşmuştu ve 20 kredi ödenmişti; `loadLatestCrawl` (`load.ts:41-47`) yalnız
**EN SON succeeded crawl**'ı alır, şemada crawl seçecek bir alan yoktur, ve rapor "bu, sitenizin
dar bir kesitidir" demez. 15 kredi 1 sayfaya gitti. Rapor teknik olarak dürüst (`1 page(s)`
yazıyor) ama müşterinin okuduğu şey "sitem temiz"tir.

**(b) İkinci özdeş denetim ikinci kez ücretlendirildi (T-B5).** Aynı `crawl_job_id` üstünde,
aynı saniyeler içinde, aynı byte'lar — 15 kredi daha. Hiçbir uyarı yok, hiçbir "bu crawl daha
önce denetlendi" cümlesi yok, ve `audit_runs`'a ikinci bir satır yazıldı (`audit-shared.ts:144`
koşulsuz `writeRun`). `crawl_site`'ın B-1'i (çift kuyruk koruması yok) ile aynı ailedendir, ama
burada koruma daha ucuz olurdu: girdi tamamen deterministik, önceki koşu zaten `audit_runs`'ta.

**Bölümlerin hangisi basıldı:** 12 bölümün **4'ü her koşuda basılan garantililer** + sitemap diff
(sitemap OKUNDUĞU için, "0 ve 0" ölçülmüş bir mutabakattır). Kalan 7 bölüm (Slow / Heavy /
Redirect chains / X-Robots / Deep / Orphan / Broken links) satırı olmadığı için basılmadı —
`format.ts:218-222`'nin ilan ettiği kural canlıda böyle davrandı. Beşinci HTTP kovası
("no usable status") da basılmadı, çünkü `status.other === 0`.

**ÖLÇÜLEMEDİ (bu turda):** 7 koşullu bölümün HİÇBİRİ canlı veriyle görülemedi — 1 sayfalık,
0 atlamalı, 200 dönen bir crawl hiçbirini tetiklemez. Bölüm metinleri §5'te **kaynaktan**
(biçimlendiricinin üretebileceği cümlelerin tamamı) çıkarıldı, canlı gözlemden değil. Bunu
kapatmak için ya daha zengin bir crawl'ı olan başka bir proje (ör. `noraninsaat.com`,
`dentnotion.com`) üstünde bir çağrı gerekir — iş emrinin öznesi adstark olduğu ve kredi tavanı
tam dolduğu için YAPILMADI.

## 5. SEO güncelliği

Kaynak: `apps/mcp/src/audit/rules/tech.ts` + `apps/mcp/src/audit/format.ts:179-279` +
`apps/mcp/src/audit/crawl-data.ts`.
Referans satırı: `audit_tech | R-3.1–R-3.16, R-3.19–R-3.24, R-4.10, R-4.11, R-9.4 | AI crawler
token listesinin bayatlaması (Claude-SearchBot, OAI-SearchBot, GoogleOther-*)`.

### 5a. Tool'un üretebileceği HER bulgu cümlesi (biçimlendiriciden tam sayım) → kural eşlemesi

`formatTechReport` 16 farklı cümle kalıbı üretebilir. Hepsi burada, hangi R-kuralına dokunduğuyla.

| # | üretilen cümle (kaynak: `format.ts` satırı) | R-kuralı | uyum |
|---|---|---|---|
| 1 | `Technical audit — N page(s), M skipped (crawl from …).` (`:182`) | — | provenans satırı, kural taşımıyor |
| 2 | `HTTP status: a ok (2xx), b redirect (3xx), c client error (4xx), d server error (5xx).` (`:184-185`) | **R-3.18** | KISMEN — 404 ve **410 ayırt edilmiyor**; R-3.18 kalıcı silmenin 410 olmasını ister, tool ikisini de "client error (4xx)" der |
| 3 | `  4xx pages:` + URL listesi (`:187`) | R-3.18 | aynı: 410 ayrı adlandırılmıyor |
| 4 | `  5xx pages:` + URL listesi (`:188`) | R-3.18 | UYUYOR — sunucu sağlığı crawl capacity'nin girdisidir |
| 5 | `  N page(s) carried no usable status and are in none of the four counts above, so those four do not add up to the N page(s) crawled:` (`:196-200`) | — | dış kural yok; NEVER#7 kaleminin kendisi |
| 6 | `Redirects surfaced: N` + `url — reason` (`:203-206`) | **R-3.9** | KISMEN — redirect'in "güçlü canonical sinyali" olduğu HİÇBİR YERDE söylenmiyor; yalnız sayılıyor |
| 7 | `Not crawled (skipped): N` + `  <kategori>: N` (`:208-211`) | **R-3.2, R-3.5, R-3.6** | **KISMEN — `robots` kategorisi crawler'ın kararıdır, SİTENİN robots.txt'i değil.** "blocked by robots.txt" cümlesi bizim botumuzun engellendiğini söyler; Googlebot'un engellenip engellenmediğini SÖYLEMEZ (bkz. 5b) |
| 8 | `    <reason> — N URL(s):` + `      · url` + `      … and N more URL(s) with this reason, not listed` (`:162-167`) | — | biçim; hiçbir şey sessizce düşmüyor |
| 9 | `    … and N more reason(s) here, covering N URL(s), not listed` (`:175`) | — | biçim |
| 10 | `Robots conflicts (noindex but internally linked): N` + `url (linked from N page(s))` (`:213-215`) | **R-3.15, R-3.6** | **KISMEN — yalnız `noindex` token'ı aranıyor; `none` direktifi TANINMIYOR** (bkz. T-B2). `noarchive`/`nositelinkssearchbox` HİÇ raporlanmıyor → R-3.16 açısından **TEMİZ** |
| 11 | `Slow pages (fetch over 3000 ms): N` + `url (N ms)` (`:224-225`) | — (R-1.x `audit_speed`'in) | listede yok — bu eşik dış bir kurala değil, kaynağın kendi gerekçesine dayanıyor (`tech.ts:21-27`, "3 s is the round number the field has used") ve bunu yazıyor |
| 12 | `Heavy pages (HTML over 1500000 bytes): N` + `url (N bytes)` (`:228-229`) | — | listede yok; aynı, gerekçe kaynakta yazılı |
| 13 | `Redirect chains (2+ hops): N` + `a → b → c` (`:232-233`) | **R-3.9** | UYUYOR — zincir bir canonical sinyali zayıflatır; ama cümle bunu söylemiyor, yalnız zinciri basıyor |
| 14 | `X-Robots-Tag conflicts (header says noindex, meta does not): N` + `url (X-Robots-Tag: …)` (`:238-240`) | **R-3.15** | UYUYOR — X-Robots-Tag R-3.15'in adlandırdığı iki kanaldan biri. Ama yine yalnız `noindex`; `none`, `nosnippet`, `max-snippet`, `unavailable_after` hiç okunmuyor |
| 15 | `Deep pages (4+ clicks from a crawl seed): N` + `url (depth N)` (`:243-244`) | **R-3.17** | KISMEN — R-3.17 crawl budget'ın **1M+ / 10.000+ sayfa** sitelerde anlamlı olduğunu söyler; tool 100 sayfa tavanlı bir crawl üstünde "deep pages" raporlar ve bu ölçek uyarısını hiç vermez |
| 16 | `No internal links found (orphan signal): N` + `url (depth N)` + `  Note: the crawl is bounded, so a page whose only linking page was not fetched appears here too.` (`:247-249`) | — | **örnek dürüstlük**: kuralın kanıtlamadığı şeyi cümlenin kendisi söylüyor |
| 17 | `Sitemap vs crawl (N URL(s) read from the sitemap):` + `  in the sitemap but not crawled: N; crawled but not in the sitemap: N` (+ iki alt liste) (`:260-272`) | **R-3.7, R-3.8** | UYUYOR — `<loc>` dışında hiçbir sitemap alanı okunmuyor (aşağıda ölçüldü), yani `priority`/`changefreq` bayatlığı **karşılıksız** |
| 18 | `Broken internal links (target crawled, answered 4xx/5xx): N` + `from → to (status)` (`:275-276`) | R-3.18 | UYUYOR (kapsamı `tech.ts:182-191`'de yazılı: taranmamış hedef sayılmaz) |
| 19 | `  … and N more` (her listede, `:28`) | — | 50'lik tavan; hiçbir şey sessizce düşmüyor |

### 5b. Referans listesinin bu tool'a atfettiği 25 kural, tek tek

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-3.1 RFC 9309 | Kural motorunda robots.txt ayrıştırması **YOK**. Ayrıştırıcı `crawler/robots.ts`'te ve çıktısı `CrawlResult`'a **yazılmıyor** | **İLGİSİZ (yapısal)** | Ölçüm: `CrawlResult` (`crawler/crawl.ts:130-151`) yalnız `pages`, `skipped`, `fetchedAt`, `sitemapUrls` taşır. audit_tech robots.txt'i HİÇ görmez |
| **R-3.2** robots 500 KiB | ölçülemez — gövde ulaşmıyor | **İLGİSİZ (yapısal)** | Tavan `crawler/crawl.ts`'te ve `crawl_site`'ın kaydında (Dilim 2) B-4 olarak açık |
| R-3.3 robots 24 s cache | hiçbir yerde | **İLGİSİZ** | Müşteriye "robots değişikliğin ~24 saatte yansır" diyen cümle de yok |
| **R-3.4** `crawl-delay` Google'da geçersiz | Tool `crawl-delay`'i **bulgu diye RAPORLAMIYOR** | **UYUYOR (ölçülerek)** | Ölçüm: `grep -rni "crawl-delay\|crawlDelay" apps/mcp/src/audit/` → hiç eşleşme yok. Bayat kural üretmiyor. Eksik olan: crawl-delay'li bir sitede kapsamın neden düştüğü söylenmiyor (o `crawl_site`'ın alanı) |
| **R-3.5** en spesifik / beraberlikte en az kısıtlayıcı | ölçülemez — gövde ulaşmıyor | **İLGİSİZ (yapısal)** | Beraberlik çözümü `crawler/robots.ts:114`'te ve Dilim 2 crawl kaydının B-3'ü |
| **R-3.6** disallow ≠ noindex | `robots` skip kategorisi basılıyor (bizim botumuz için), `Robots conflicts` bölümü noindex + iç link diyor | **KISMEN** | İki kavram raporda YAN YANA duruyor ("Not crawled → robots" ve "Robots conflicts") ve **farkları hiçbir cümlede açıklanmıyor**. R-3.6'nın uyardığı karışıklık tam burada mümkün |
| R-3.7 sitemap 50 MB / 50.000 URL | Sitemap diff `crawl.sitemapUrls` üstünde çalışıyor (crawler 500'le sınırlı) | **KISMEN** | Tool sitemap'in boyut/adet sınırını AŞIP AŞMADIĞINI söylemiyor; yalnız okunan URL sayısını basıyor (`N URL(s) read from the sitemap`). 500'lük tavan raporda anılmıyor → 500'den fazla URL'li bir sitemap'te "crawled but not in the sitemap" **yanlış pozitif** üretir |
| **R-3.8** `priority`/`changefreq` yok sayılır | Hiç okunmuyor, hiç üretilmiyor | **UYUYOR (ölçülerek)** | Ölçüm: `grep -rni "priority\|changefreq\|lastmod" apps/mcp/src/audit/` → hiç eşleşme yok. Referansın adlandırdığı risk bu tool'da **karşılıksız** |
| R-3.9 canonical güçlü SİNYAL, redirect güçlü, sitemap zayıf | Redirect'ler ve zincirler sayılıyor; sitemap üyeliği diff'te; canonical **audit_onpage**'in | **KISMEN** | Üç sinyalin üçü de ayrı ayrı raporlanıyor ama **hiçbir yerde birleştirilmiyor**: "bu URL'nin canonical'ı X diyor, redirect Y'ye gidiyor, sitemap Z'yi ilan ediyor" cümlesi yok. Sinyal çelişkisi R-3.9'un asıl konusudur |
| R-3.10 canonicalization'da robots kullanılmaz | hiçbir yerde | **İLGİSİZ** | Bu bir teşhis kuralı; tool onu üretecek veriye (canonical + robots eşleşmesi) sahip ama kullanmıyor |
| R-3.11 crawl → render → index | Render YOK (crawler tek `fetch`) | **AYKIRI (bildirilmiş — ama BU tool'da bildirilmemiş)** | `crawl_site` tarafında kaynak dürüst; `audit_tech`'in çıktısında ve mdx'inde "bu denetim JavaScript çalıştırmayan bir taramaya dayanır" cümlesi **YOK**. Sonuç: JS ile basılan bir `noindex` ya da bir X-Robots başlığı denetime hiç girmez |
| R-3.12 evergreen Chromium, bloklu JS/CSS render edilmez | hiçbir yerde | **AYKIRI (bildirilmemiş)** | JS/CSS'in robots ile bloklu olup olmadığı hiç bakılmıyor |
| R-3.13 canonical JS ile değil HTML'de | Bu tool canonical'a hiç bakmıyor (`audit_onpage`'in) | **İLGİSİZ (bu tool için)** | Referans listesi R-3.13'ü audit_tech'e atfediyor ama kural motorunda `canonical` HİÇ okunmuyor: `grep -n "canonical" apps/mcp/src/audit/rules/tech.ts` → hiç eşleşme yok. **Referans ↔ tool eşlemesinin kendisi burada gevşek** |
| **R-3.14 mobile-first indexing** | Tek masaüstü geçiş; `viewport` ne `AuditPage`'te ne de kuralda var | **AYKIRI** | Ölçüm: `grep -rniE "viewport\|mobile" apps/mcp/src/audit/` (test dışı) → **tek eşleşme, o da düzyazı**: `rules/tech.ts:25` `"…what a phone on mobile data would see"` — yavaş sayfa eşiğinin gerekçe cümlesi. `viewport` sözcüğü **hiç geçmiyor**. "Mobil ile masaüstü eşdeğer mi" sorusu bu veriden cevaplanamaz ve tool bunu söylemiyor |
| **R-3.15** meta robots / X-Robots-Tag direktif kümesi | Yalnız **`noindex`** aranıyor (`tech.ts:44` ve `:247`, iki kopya) | **KISMEN — üç boşluk** | (a) **`none` tanınmıyor**: `content="none"` Google'da `noindex,nofollow` demektir; tool onu temiz sayar. (b) `nosnippet`, `max-snippet`, `noimageindex`, `unavailable_after`, `indexifembedded` hiç okunmuyor — R-5.3/R-5.4 açısından da kör. (c) Token sınırı korumasız (M6/M7) |
| **R-3.16** `noarchive`/`nocache`/`nositelinkssearchbox` ÖLÜ | Hiçbiri kodda geçmiyor | **UYUYOR (ölçülerek)** | Ölçüm: `grep -rni "noarchive\|nositelinkssearchbox\|nocache" apps/mcp/src apps/web/content/docs` → **hiç eşleşme yok**. Referansın bu tool için adlandırdığı bayatlama riski **karşılıksız** — bayat kural YOK |
| R-3.19 Indexing API yalnız JobPosting/BroadcastEvent | hiçbir yerde | **İLGİSİZ** | Bu tool Indexing API'ye hiç dokunmuyor |
| **R-3.20 Google-Extended** | hiçbir yerde | **AYKIRI (ölçüm boşluğu)** | Ölçüm: `grep -rni "google-extended\|googlebot\|gptbot\|claudebot\|perplexity\|oai-searchbot" apps/mcp/src/audit/` → **hiç eşleşme yok** |
| **R-3.21 Googlebot token ailesi** | hiçbir yerde | **AYKIRI (ölçüm boşluğu)** | `User-agent: Googlebot` altında `Disallow: /` yazan bir site bu denetimde **sorunsuz** görünür. Bu, 15 kredilik bir teknik denetimin sorabileceği en ucuz ve en yüksek etkili sorudur ve sorulmuyor |
| **R-3.22 OpenAI (GPTBot / OAI-SearchBot / ChatGPT-User)** | hiçbir yerde | **AYKIRI** | Referansın bu tool için adlandırdığı **birincil bayatlama riski** ("AI crawler token listesinin bayatlaması") bugün karşılıksız: liste bayatlayamaz çünkü **liste yok** |
| **R-3.23 Anthropic (ClaudeBot / Claude-User / Claude-SearchBot)** | hiçbir yerde | **AYKIRI** | aynı |
| **R-3.24 Perplexity** | hiçbir yerde | **AYKIRI** | aynı |
| **R-4.10 hreflang çift yönlü olmalı** | `AuditPage.hreflangs` **AYRIŞTIRILIYOR** (`crawl-data.ts:57`, `:187`) ve **HİÇBİR KURAL OKUMUYOR** | **AYKIRI — veri var, kural yok** | Ölçüm: `grep -rn "hreflang" apps/mcp/src/audit/` → yalnız `crawl-data.ts` (4 satır, hepsi tanım/ayrıştırma); `rules/` altında **sıfır** eşleşme. Çift yön kontrolü (A→B ve B→A) bu veriden **tek bir crawl içinde hesaplanabilir** ve hesaplanmıyor |
| **R-4.11 hreflang kodu ISO 639-1 (+3166-1), tek başına ülke kodu geçersiz** | aynı — okunmuyor | **AYKIRI — veri var, kural yok** | `AuditHreflang.lang` ham dize olarak duruyor; `x-default`, `EU`/`UN` rezerve kodları, tek başına ülke kodu (`hreflang="de-DE"` doğru, `hreflang="DE"` geçersiz) hiç doğrulanmıyor |
| **R-9.4 sunucu konumu bir sinyaldir ama kesin değil** | hiçbir yerde | **AYKIRI (ölçüm boşluğu)** | Ne IP, ne CDN başlığı, ne `Server` başlığı saklanıyor. Tool bunu ölçmediğini de söylemiyor |

**Bayat kural taraması sonucu: BAYAT KURAL YOK.** Üç ayrı bayatlama riski adıyla arandı ve
üçü de karşılıksız çıktı: `noarchive`/`nositelinkssearchbox` (R-3.16) hiç raporlanmıyor,
`crawl-delay` (R-3.4) bulgu diye üretilmiyor, `priority`/`changefreq` (R-3.8) hiç okunmuyor.
Referansın bu tool için adlandırdığı asıl risk — **AI crawler token listesinin bayatlaması** —
bugün karşılıksızdır çünkü **hiç token listesi yok**: R-3.20–R-3.24'ün beşi de ölçülmüyor.
Bu tool'un SEO borcu bayat kural değil, **ölçülmeyen eksen**: robots.txt'in KENDİSİ (11 kural),
hreflang (2 kural, üstelik veri elde), mobil (1) ve sunucu konumu (1).

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR ama sevk edilmemiş** — satır 30
`audit_tech: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance` içeriyor.
Canlıda ölçüldü: `tools/list` girişinin anahtarları **`name,description,inputSchema`** —
**`_meta` YOK**; iki `tools/call` cevabının da `result` anahtarları **yalnız `["content"]`** —
**`structuredContent` YOK**.
Planlanan `report` kartının bekleyeceği alanlar bugün yalnız DÜZ METİNDE var ve **yapısal rapor
zaten üretiliyor** (`TechReport`, `audit_runs.report`'a jsonb olarak yazılıyor —
`audit/runs.ts:63-74`). Yani bu tool'da kartın ihtiyacı olan yapılı veri **halihazırda mevcut ve
saklanıyor**; eksik olan tek şey onu `structuredContent` olarak cevaba da koymak. Depo genelinde
en ucuz kart adaylarından biridir.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `plan.mjs:77` (`ID_TOOLS`:
  `{ tool: "audit_tech", idArg: "project_id", targetArg: null }`) ve **iki hücre**: `:265`
  (K1/S2, hiç crawl edilmemiş proje — bu turda canlıda koşuldu, Δ 0) ve `:270` (K1/S1, kampanya
  siteleri, notu: `H5: compare 'Redirects surfaced' against curl-counted 3xx`). **H5 hücresi hiç
  koşulmamıştır** ve tam olarak §4'te ölçülemeyen ekseni (koşullu bölümlerin gerçek veriyle
  görülmesi) hedefler.
- `goals/` hedefi gerekli mi: **EVET** — bugün `goals/` altında audit_tech'in DAVRANIŞINI ölçen
  hiçbir hedef yok (`grep -rn "audit_tech" goals/` → tek eşleşme `docs-schema-sync.md:6`, o da
  fiyat-cümlesi sürüklenmesi hakkında, denetimin kendisi hakkında değil). Değeceği iki predicate:
  (a) **direktif token'ı** — `noindex` kelime sınırının (M6/M7) makine-kontrollü olarak kırmızıya
  dönebilmesi, ve `none` direktifinin tanınması; (b) **çift denetim** — aynı `crawl_job_id`
  üstünde ikinci bir ücretli denetimin ne yaptığı. Birincisi `goals/` yerine doğrudan
  `rules/tech-signals.test.ts`'e iki test olarak da inebilir; kapı kapsamı açısından fark yok.

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-03) |
|---|---|---|---|---|---|
| T-B1 | **P1** | **`noindex` direktifinin TOKEN sınırı korumasız — ve regex İKİ yerde kopyalanmış.** `/\bnoindex\b/i` → `/noindex/i` mutasyonu hem `hasNoindex`'te (`tech.ts:44`) hem satır içi kopyada (`tech.ts:247`) yapıldı; dar kapı 214/214, **geniş kapı 3766/3766 yeşil kaldı** | §2 M6, M7 | `tech-signals.test.ts`'e tek bir test: `X-Robots-Tag: x-noindexing` ve `content="no-index"` çatışma DEĞİL. Ayrıca satır içi kopya `hasNoindex`'e indirgensin — bugün aynı kural iki yerde ve ikisi de korumasız (ders 14 kalıbı) | **KAPANDI #210** (canlıda gözlenmedi — çakışma taşıyan özne bulunamadı) — direktifler TOKEN olarak ayrıştırılıyor, iki kopya tek yardımcıya indi, `x-noindexing` negatif vakası pinli |
| T-B2 | **P1** | **R-3.15'in `none` direktifi tanınmıyor.** `<meta name="robots" content="none">` Google'da `noindex, nofollow` demektir; motor yalnız `noindex` alt dizisini arar, dolayısıyla `none` ile gizlenmiş bir sayfa **hem** "Robots conflicts" **hem** "X-Robots-Tag conflicts" bölümlerinde görünmez. 15 kredilik teknik denetimin en pahalı sessizliği | `tech.ts:43-45`, `:247`; ölçüm: `grep -rn "\"none\"\|'none'" apps/mcp/src/audit/` → hiç eşleşme yok | `hasNoindex`'i `/\b(noindex\|none)\b/i` yapmak yeterli değil — `none` aynı zamanda `nofollow` demektir ve rapor bunu ayırt etmelidir. En küçük dürüst adım: `none`'ı noindex sayan tek bir token ayrıştırıcısı + testinde `content="none"` vakası | **KAPANDI #210** (canlıda gözlenmedi — `none` taşıyan özne bulunamadı) — `none` = noindex+nofollow; `max-image-preview:none` noindex sayılmıyor (negatif pin); `googlebot:` önekli header okunuyor |
| T-B3 | **P1** | **hreflang toplanıyor ve hiç okunmuyor — R-4.10 ve R-4.11 tam kör.** `AuditPage.hreflangs` ayrıştırılıyor (`crawl-data.ts:57`, `:148-158`, `:187`) ama `rules/` altında sıfır tüketici var. Çift yönlülük (A→B, B→A) tek bir crawl içinde hesaplanabilir; dil kodu biçimi hiç doğrulanmıyor | `grep -rn "hreflang" apps/mcp/src/audit/` → yalnız `crawl-data.ts`; §5b R-4.10/R-4.11 satırları | Toplanmış ve kullanılmayan veri, bu tool'un en ucuz kazancıdır: yeni istek yok, yeni crawl yok. İki bölüm önerilir — "hreflang not reciprocated" (A, B'yi gösteriyor, B A'yı göstermiyor) ve "hreflang code not valid" (tek başına ülke kodu, rezerve kod). Referans R-4.10/R-4.11'i bu tool'a atfediyor | **KAPANDI #210** (canlıda gözlenmedi — hreflang'li özne gerekir) — `audit/rules/hreflang.ts`: kod biçimi (ISO 639-1 + opsiyonel script/bölge, tek başına ülke kodu geçersiz, `EU`/`UN` rezerve), x-default (recommended, not required), karşılıklılık yalnız crawl kümesi içinde ve küme dışı hedefler sayılıp "ölçülmedi" deniyor. Rapor 12 → **15 bölüm** |
| T-B4 | **P1** | **Denetlenecek crawl seçilemiyor; dar bir crawl geniş olanı sessizce gölgeliyor.** `loadLatestCrawl` yalnız EN SON succeeded crawl'ı alır; şemada crawl seçecek alan yoktur. Ölçüldü: aynı gün adstark'ta 51 sayfalık crawl'ın üstüne 1 sayfalık `include_paths` crawl'ı yazılmış, ve 15 kredi **1 sayfaya** gitti. Rapor "1 page(s)" diyor ama "bu, sitenizin dar bir kesitidir; geniş crawl'ınız N sayfaydı" demiyor | `load.ts:41-47`; §4 Ç1 çıktısı (`crawl from 2026-09-02T14:26:48.349Z`, `1 page(s)`) | En az müdahaleli: rapor başlığına crawl'ın KAPSAMINI koymak (`include_paths` ile daraltılmış mı, `max_urls` neydi) — veri `jobs` satırında zaten var. Daha iyisi: isteğe bağlı `crawl_job_id` alanı, `list_jobs`'tan alınabilir. Bugün müşteri hangi crawl'ı denetlediğini raporun tarih damgasından geri çıkarmak zorunda | **KAPANDI #212** (canlı: bekliyor) — isteğe bağlı `job_id` (kiracı+proje+tool+durum filtreli okuyucu) + her cevabın başında `Audited crawl <id> from <date>: N page(s), M skipped.` **"include_paths ile daraltılmıştı" cümlesi bilerek YOK:** `jobs` girdi kolonu taşımıyor (hakem şemayla doğruladı) |
| T-B5 | P2 | **Özdeş denetim tekrarında UYARI CÜMLESİ yok.** Aynı proje, aynı `crawl_job_id`, saniyeler arayla iki çağrı: **byte-for-byte aynı metin**, Δ −15 ve −15, ve `audit_runs`'a ikinci satır. Bu satır yalnız **kopya** yarısını kaydeder: müşteri, ödemeden ÖNCE bu crawl'ın zaten denetlendiğini söyleyen tek bir cümle görmüyor. `audit_runs` gereken veriyi (tenant, project, crawl_job, tool, ts) zaten saklıyor — yani uyarı, fiyat modeline hiç dokunmadan yazılabilir | §4 Ç1≡Ç2 (`===` ölçümü); `audit-shared.ts:144` koşulsuz `writeRun`; `audit/runs.ts:63-74` | Rapor başlığına tek cümle: `this crawl was already audited at <ts> — the report below is the same one`. Kopya değişikliği; ücretlendirme davranışı AYNI kalır, yalnız sessizlik kalkar. Ücretin kendisi T-B5b'nin konusu ve İMZA ister | **KAPANDI #212** (canlı: bekliyor) — `Note: this crawl was already audited by <tool> on <ts>. Re-running produces the same report and is charged again.`; önce-oku-sonra-yaz sırası pinli. Ücret DEĞİŞMEDİ |
| T-B5b | İMZA KALEMİ | **Özdeş denetimin ücretsiz tekrarı ya da `confirm` kapısı bir FİYAT MODELİ kararıdır (NEVER#6).** "Kayıtlı raporu ücretsiz döndür" de, "`confirm` gelene kadar ücretlendirme" de tool'un birim fiyatının ne satın aldığını değiştirir: bugün 15 kredi *bir denetim koşusunu*, önerilen hâlde *bir crawl'ın denetlenmiş olmasını* satın alır. Kod tarafı ucuz; karar ucuz değil ve şef imzalayamaz | §4 Ç1≡Ç2; NEVER#6 (fiyat, kredi maliyeti, paket rakamları insan onayı olmadan değişmez); aynı kalem `audit_schema` S-B5b ve `audit_onpage` A-3b'de, `crawl_site` B-1 ile de aynı aile | Operatör imzası olmadan KOD YAZILMAZ. İmzaya giderken ölçülmüş üç sayı: üç ücretli audit'in birim fiyatı (15 / 5 / 30), aynı crawl'a ikinci denetimin canlıda ölçülmüş sıklığı (bu turda 3/3 — ama bu ÖLÇÜM trafiğidir, müşteri trafiği değil), ve ücretsiz tekrar penceresinin vendor maliyeti (bu tool'da **yok**: denetim yerel veriden koşuyor, DFS çağrısı içermiyor) | İMZA KALEMİ — operatör kuyruğunda; üç ücretli audit (5/15/30) **tek imzada** karara bağlanmalı (NEVER#6) |
| T-B6 | P2 | **Hata cümleleri ayırıcısız birleşiyor:** `→ at project_id You were not charged.` Altı negatif senaryonun üçünde | §3 tablosu | 2026-08-27'deki F-6 ve Dilim 2 `crawl_site` B-8 ile aynı aile. Öneri: "You were not charged." ekini yapan yer tek olsun ve önceki parçanın son karakterine göre boşluk/nokta eklesin. Depo geneli bir kalem | **KAPANDI #210** (canlı: ölçülmedi) — `free-refusal.ts`: çok satırlı redde ayırıcı `\n\n`, tek satır davranışı bayt-özdeş. `crawl_site` B-8 ve `audit_speed` B-6'nın noktalama yarısı da bu satırla kapandı |
| T-B7 | P2 | **Kart planlı, sevk edilmemiş; yapılı kanal boş — oysa yapılı rapor ZATEN üretiliyor.** Canlı `tools/list` `_meta` taşımıyor, `tools/call` yalnız `content` taşıyor. `TechReport` ise `audit_runs.report`'a jsonb olarak yazılıyor | `card-map.ts:30` + `:62`; canlı envelope ölçümü (§6); `audit/runs.ts:63-74` | Depo-geneli kalem, ama bu tool onun EN UCUZ vakası: `structuredContent` olarak koyulacak nesne zaten elde ve zaten serileştiriliyor (`auditReportToJson`) | ERTELENDİ → sınıf 8 (kart dilimi) |
| T-B8 | P2 | **Referansın bu tool'a atfettiği 11 robots kuralı (R-3.1, R-3.2, R-3.5, R-3.20–R-3.24 ve komşuları) YAPISAL olarak ölçülemez: robots.txt gövdesi audit'e hiç ulaşmıyor.** `CrawlResult` robots.txt taşımıyor; audit'in robots hakkında bildiği tek şey crawler'ın kendi skip sebebidir. Sonuç: `User-agent: Googlebot` altında `Disallow: /` yazan bir site bu denetimde temiz görünür, ve GPTBot/ClaudeBot/PerplexityBot/Google-Extended hiç sorulmaz | `crawler/crawl.ts:130-151` (`CrawlResult` alanları); `grep -rni "googlebot\|gptbot\|claudebot\|perplexity\|google-extended" apps/mcp/src/audit/` → hiç eşleşme yok | Tek satırlık bir alan (`CrawlResult.robotsTxt`, zaten indirilmiş metin) audit tarafında **beş kuralı birden** açar. Kısa vadede en azından mdx'e ve rapora bir cümle: "this audit does not read your robots.txt directly; it reports only what our crawler was blocked from". Bugün müşteri tersini varsayabilir, çünkü rapor "Robots conflicts" başlığı taşıyor | ERTELENDİ → sınıf 6 (`CrawlResult.robotsTxt`) — `crawl_site` B-10 ile tek kalem; hiçbir PR'da karşılığı yok |
| T-B9 | P2 | **R-3.11/R-3.12/R-3.14 ve R-9.4 eksenleri ölçülmüyor ve bu SÖYLENMİYOR.** Tarama tek masaüstü geçiş, JavaScript çalıştırılmıyor, `viewport` toplanmıyor, sunucu konumu/CDN hiç bakılmıyor. `crawl_site` kaynağı bu sınırı kendi içinde ilan ediyor; `audit_tech`'in çıktısında ve mdx'inde karşılığı yok | §5b R-3.11/3.12/3.14/9.4 satırları; ölçüm: `viewport` sözcüğü `apps/mcp/src/audit/` altında **hiç geçmiyor**, `mobile` yalnız bir gerekçe düzyazısında (`rules/tech.ts:25`) | mdx'e ve raporun kapanışına tek cümle: "this audit reads a single desktop, non-JavaScript pass". Bu, R-3.14'ün gerçek işini (ikinci geçiş) yapmadan da yanlış güveni kaldırır | AÇIK — iş emrinde yoktu; `viewport`/`USER_AGENT` hiçbir PR diff'inde değişmedi |
| T-B11 | P2 | **"You were not charged." ile defterin `-15 credits · charge · audit_tech` satırı aynı olayı ZIT kelimelerle anlatıyor.** Reddedilen üç çağrının üçü de deftere önce bir `charge`, 90–200 ms sonra bir `refund` satırı yazdı. Bakiye hiç kımıldamadı, yani `get_credit_balance` bu soruyu cevaplayamaz; çelişkiyi ancak `list_credit_activity` gösteriyor ve düzelten cümle de yine ORADA | §3 "İade yolunun DEFTER tarafı" — altı satır birebir | Sistem doğru (append-only rezerv/iade, NEVER#2) — düzeltilecek olan KELİME. İki seçenek: (a) reddin cümlesine "(a reserve is opened and released, so your activity log shows a charge and a matching refund)" eklemek; (b) defterde iade edilmiş çifti tek satırda `charge, refunded` olarak göstermek. Bugün müşteri "ücretlendirilmedim" cümlesini okuyup defterinde ücret satırı görüyor | İMZA KALEMİ — sınıf 7; `audit_schema` S-B9 ile tek karar ("You were not charged" ↔ defterdeki charge+refund çifti) |
| T-B10 | P2 | **Kapı bu turda deterministik değildi.** Aynı ve DEĞİŞMEMİŞ ağaçta 5 `pnpm --filter @pseo/mcp test` koşusundan 2'si kırmızı: `mcp gateway public server card > the card describes the REAL key-based auth…`, `TypeError: Cannot read properties of undefined (reading 'required')`. audit şeridiyle ilgisiz, ama bir mutasyon sonucunu yanlış okutabilirdi | run1/run2/run3 logları (scratchpad); §2 sonundaki not | audit_tech'in kalemi değil — ayrı bir kaleme taşınmalı. Bu kayıtta durmasının sebebi: mutasyon sonuçlarının hangi koşullarda okunduğu, sonucun kendisi kadar kayda değer (verify-db flake'iyle aynı aile) | AÇIK — ayrı kalem (kapı flake'i). Bu dilimde AYNI aile yeniden görüldü: `verify-db` CI'da **4 kez** PostgREST 502'siyle kırmızı verip deploy'u blokladı |
