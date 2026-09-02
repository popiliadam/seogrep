# `audit_onpage` — tool kontrol kaydı (2026-09 turu)

> Dilim: 2 (content) · İşçi: Opus 4.8 (d2-content) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, toplam Δ −60 kredi** (izin sınırı 2 çağrı / 60 kredi — tam sınırda).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `audit-onpage.ts:11-32` + `audit-shared.ts:76-151`; kredi `costs.ts:106` = `  audit_onpage: 30,`; docs "**Cost:** 30 credits." — description ↔ mdx ↔ canlı JSON Schema üçü de tutuyor |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyon: M1/M1b/M2/M4 KIRMIZI — **60 ve 160 eşikleri tek karaktere kadar pinli** · **M3 (`sameUrl` fragment temizliği) YEŞİL KALDI** |
| 3 Canlı negatif | ÖLÇÜLDÜ | 6 senaryonun 6'sı doğru reddedildi, net kredi Δ **0** (bakiye 4459 sabit); şema dışı anahtar reddediliyor; 3'ü defterde **charge+refund çifti** yazıyor |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı, her biri Δ **−30**. **30 kredilik denetim 1 (bir) sayfa okudu** ve bunu bir uyarı olarak söylemedi (A-2); ikinci çağrı bayt-aynı çıktı için 30 krediyi tekrar aldı (A-3) |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 13 kural tek tek; **EN YÜKSEK RİSK GERÇEKLEŞMİŞ:** R-4.2/R-4.4 karakter sınırı efsanesi hem kaynakta hem docs'ta hem de TESTTE canlı. `noarchive` bulgusu YOK (R-3.16 temiz) |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:29` `audit_onpage: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`; canlı `tools/call` `structuredContent`/`_meta` **taşımıyor** (ölçüldü, `get_credit_balance` taşıyor) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi **VAR** (3 hücre: `:264` S2, `:269` S1, `:274` S5) · `goals/` içinde bu tool'u ölçen hedef **YOK** |

**Karar:** DÜZELTME GEREKLİ — para hikâyesi ve reddetme yolları kusursuz çalıştı (net Δ 0, "You were
not charged" doğru), ama tool'un ürettiği iki temel bulgu türü (title 60 / meta 160) **2026-09-02
tarihli birincil kaynağa göre var olmayan bir sınırı** müşteriye kural gibi satıyor, ve 30 kredilik
bir denetim tek sayfalık bir crawl'ı **kapsam uyarısı olmadan** denetleyip tam ücret alıyor.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/audit-onpage.ts:23-32` (`renderOnpageAudit` :23, `makeAuditOnpageTool` :28,
  üretim örneği `auditOnpageTool` :32). Gerçek gövde ORTAK: `apps/mcp/src/tools/audit-shared.ts:76-151`
  (`makeAuditTool`) — `audit_tech` ve `audit_schema` ile paylaşılıyor.
- Kural motoru: `apps/mcp/src/audit/rules/onpage.ts:317-337` (`auditOnpage`), eşikler `:13-21`.
  Biçimlendirici: `apps/mcp/src/audit/format.ts:77-115` (`formatOnpageReport`), etiket haritası `:40-73`.
- Kayıt: `apps/mcp/src/tools/index.ts:14` (import), `:82` (export), `:181` (araç dizisi)
- Zod şeması (alanlar, kısıtlar), `audit-shared.ts:72-74` — canlı JSON Schema ile birebir doğrulandı:
  - `project_id`: `z.uuid().describe("The project to audit (from setup_project / list_projects).")`
    — **tek alan ve tek zorunlu alan** (canlı `"required": ["project_id"]`)
  - Canlı şema `"additionalProperties": false` taşıyor (`registry.ts` `schema.strict()`, #204) — ölçüldü
  - `confirm` YOK, `charge` varsayılan `"surface"` (rezerv handler'dan ÖNCE açılır)
- Description (birebir alıntı, `audit-onpage.ts:11-13` ve canlı `tools/list` aynı):
  > Audit on-page SEO for a project's latest crawl: titles, meta descriptions, h1s, canonicals, and thin content, per page. Costs 30 credits. Run crawl_site first.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:106`, birebir): `  audit_onpage: 30,`
  (Yorumsuz satır — `audit_speed`/`audit_content`'in aksine bu satırın imza gerekçesi yazılı değil;
  fiyat PR #12 merge onayına dayanıyor, `costs.ts:5`.)
- Docs sayfası (`apps/web/content/docs/tools-reference/audit-onpage.mdx`, birebir):
  > **Cost:** 30 credits.

  ve `:8`:
  > It is **synchronous**: it returns the findings immediately. Run `crawl_site` first — if the project has never been crawled, the tool tells you so and charges nothing.

  ve `:14-15` — **5. adımın merkezindeki iki cümle**:
  > - **Titles** — missing, too long (over ~60 characters), too short, or duplicated across pages.
  > - **Meta descriptions** — missing, too long (over ~160 characters), too short, or duplicated.

  ve `:25`:
  > Thresholds are conservative "worth a look" signals, not hard rules.
- Ücretlendirme kipi: `charge: "surface"` (varsayılan, `audit-shared.ts:89` yorumu). Rezerv çağrı
  anında açılır; `withCredits` DÖNEN handler'ı COMMIT, FIRLATAN handler'ı RELEASE eder. Bu yüzden
  iki reddin ikisi de `throw new PreconditionNotMetError` (`audit-shared.ts:111` arşiv, `:125` crawl yok).
  Canlıda doğrulandı: net Δ 0 (§3).
- Tutarsızlıklar: **yok**. Karşılaştırılanlar: `audit-onpage.ts:11-13` description ↔ canlı `tools/list`
  description (birebir) ↔ mdx frontmatter `description` (kredi cümlesi çıkarılmış hâli, birebir);
  `costs.ts:106` 30 ↔ mdx "**Cost:** 30 credits." ↔ description "Costs 30 credits." ↔ ölçülen Δ −30;
  `onpage.ts:15/18/21` 60/160/200 ↔ mdx "~60"/"~160"/"~200 words" (birebir).
  **Not:** tutarlılık burada bir güvence değil — üç yerin üçü de aynı yanlışı taşıyor (§5, A-1).
- Seçilebilirlik: "sitemi on-page denetle", "başlıklarım/meta açıklamalarım nasıl", "audit my titles".
  Komşuları: `audit_tech` (15 kredi — durum kodları, yönlendirme zinciri, robots çakışması),
  `audit_schema` (5 kredi — JSON-LD), `audit_speed` (15 kredi — Lighthouse), `audit_content` (12 kredi
  — GSC × crawl). **En yüksek karışma riski `audit_tech`**: ikisi de "sitemi analiz et" cümlesinde
  aday, ikisi de aynı crawl'ı okuyor, ve fiyat farkı 2× (30 vs 15). Description'lar alanları
  sayarak ayırıyor ama hiçbiri diğerini ADIYLA anmıyor; `get_job_status`'ın bitiş cümlesi üçünü de
  birlikte öneriyor ("run audit_onpage, audit_tech or audit_schema") — yani model üçünü de çağırma
  eğiliminde (50 kredi). Bu tur **başka bir işçinin** aynı proje üzerinde `audit_tech` + `audit_schema`
  koştuğu defterden görüldü (§3 not).

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `pnpm --filter @pseo/mcp exec vitest run src/audit src/tools/audit-content.test.ts
src/tools/audit-runs.test.ts`. Taban: **244 passed / 16 files**.
`audit-onpage.db.test.ts` ve `audit-runs.db.test.ts` Docker ister — **db şeridi koşulmadı**.
Not: `apps/mcp/src/tools/` altında `audit-onpage.test.ts` **yok**; tool yüzeyi hızlı şeritte
`audit-runs.test.ts:120/186/252` üzerinden 0-kredilik bir ad altında sürülüyor (`audit-runs.test.ts:24`).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | **Title eşiği** — `audit/rules/onpage.ts:15` `const TITLE_MAX = 60;` → `= 500;` | 60 karakter kuralını ölçen testler | **KIRMIZI** (6 test) | `auditOnpage — title rules > flags a title over 60 chars…`: `expected [] to include 'title_too_long'`; ayrıca `format.test.ts` iki testi, `format-graph`/`format-signals` bayt-bayt regresyon testleri |
| M1b | **Aynı eşik, bir tık** — `TITLE_MAX = 60` → `= 65` | — (hipotez: 5 karakterlik kayma sessiz geçer mi?) | **KIRMIZI** (4 test) | Aynı testler. **Eşik SAYISI pinli**, "bir eşik var" değil. `format-signals`/`format-graph` bayt-bayt karşılaştırma yaptığı için 60↔65 farkı bile yakalanıyor |
| M2 | **Meta eşiği, bir tık** — `onpage.ts:18` `const META_MAX = 160;` → `= 161;` | 160 karakter kuralını ölçen test | **KIRMIZI** (2 test) | `auditOnpage — meta description rules > flags a meta over 160 and under 50 chars`: `expected [] to include 'meta_too_long'`. **Tek karaktere kadar pinli** |
| **M3** | **Canonical fragment toleransı** — `onpage.ts:173` `url.hash = "";` satırı SİLİNDİ (`sameUrl` artık `#top` taşıyan bir self-canonical'ı "başka yeri gösteriyor" sayar) | fragment toleransını ölçen bir test | **YEŞİL KALDI** | **244/244 passed.** `sameUrl`'ün yorumu (`:168`) "ignoring a trailing slash and fragment" diyor; hiçbir test fragment eksenine bakmıyor. Sonuç: `<link rel="canonical" href="…/a#top">` taşıyan bir sayfa 30 kredilik raporda **yanlış** `canonical_elsewhere` bulgusu alır. (Slash ekseni pinli, fragment ekseni değil — ders 14'ün "hangi ekseni varyantladın" vakası) |
| M4 | **Thin content eşiği, bir tık** — `onpage.ts:21` `const THIN_CONTENT_WORDS = 200;` → `= 201;` | 200 kelime kuralını ölçen test | **KIRMIZI** (5 test) | En öğretici çıktı: `expected 'thin content (42 words, minimum 201)' to match /\b200\b/` — test kaynak literaliyle değil **REGEX'le** iddia ediyor (ders 11'in doğru uygulanmış hâli) |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). İş emrinin önerdiği eksen (`audit/rules/**`
eşikleri) **üç üç kırmızı verdi** — yani bu tool'da eşikler kapının EN İYİ korunan yeri. Kapının kör
noktası eşiklerde değil, **eşiklerin doğruluğunda** (§5, A-1: kapı yanlış bir sayıyı sadakatle
koruyor) ve **URL normalizasyonunda** (M3).

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**; kapı yeniden **244/244 passed**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (basılmadı). Bakiye önce **4459**, altı senaryodan sonra **4459** — net Δ **0**.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| bozuk id | `{"project_id":"not-a-uuid"}` | 200, `isError: true`, 339 ms | **0** | `Invalid input for "audit_onpage": ✖ Invalid UUID` / `  → at project_id You were not charged.` — zod, rezervden ÖNCE; **defterde satır yok** |
| geçersiz project_id (rastgele uuid) | `{"project_id":"00000000-0000-4000-8000-000000000000"}` | 200, `isError: true`, 547 ms | **0** | `No crawl found for this project. Run crawl_site first. You were not charged.` — varlık sızdırmıyor (`audit/load.ts` tek cümle kuralı) |
| crawl'ı olmayan proje | `{"project_id":"257ad998-…"}` (example.net, soğuk fikstür) | 200, `isError: true`, 563 ms | **0** | **Yukarıdakiyle BİREBİR aynı cümle** — precondition/refund yolu: defterde `-30 charge` + `+30 refund` çifti (aşağıda) |
| **şema dışı anahtar** | `{"project_id":"e2785bf7-…","max_pages":5}` | 200, `isError: true`, 344 ms | **0** | `Invalid input for "audit_onpage": ✖ Unrecognized key: "max_pages" You were not charged.` — sessiz yutma YOK |
| arşivli proje | `{"project_id":"77f40d69-…"}` | 200, `isError: true`, 571 ms | **0** | `That project is archived, so it is not being tracked right now. Restore it with setup_project for the same domain — which works whether or not the project has a Search Console property — or with track_gsc_property for its property, or from the Connection page in SeoGrep. You were not charged.` |
| null id | `{"project_id":null}` | 200, `isError: true`, 337 ms | **0** | `✖ Invalid input: expected string, received null` / `  → at project_id You were not charged.` |

**Defterin gerçekte ne yazdığı (ÖLÇÜLDÜ, `list_credit_activity`).** "You were not charged" NET olarak
doğru, ama üç handler-seviyesi ret **iki satır** yazıyor. Birebir:

```
- 2026-09-02T14:44:55.506108+00:00 · +30 credits · refund · audit_onpage · project: dilim1-tek-kullanimlik-8b3f7c.com
- 2026-09-02T14:44:55.40767+00:00  · -30 credits · charge · audit_onpage · project: dilim1-tek-kullanimlik-8b3f7c.com
- 2026-09-02T14:44:54.579711+00:00 · +30 credits · refund · audit_onpage · project: example.net
- 2026-09-02T14:44:54.444647+00:00 · -30 credits · charge · audit_onpage · project: example.net
- 2026-09-02T14:44:54.022884+00:00 · +30 credits · refund · audit_onpage · project: 00000000-0000-4000-8000-000000000000
- 2026-09-02T14:44:53.899375+00:00 · -30 credits · charge · audit_onpage · project: 00000000-0000-4000-8000-000000000000
```

Bu bir defekt DEĞİL — `credit_ledger` append-only (NEVER#2), rezerv/serbest bırakma iki satır olmak
zorunda, ve `list_credit_activity`'nin kendi cümlesi bunu söylüyor: `These are the entries that moved
your balance, so a refunded run shows both its charge and its refund.` **Zod seviyesindeki üç ret
(bozuk uuid, şema dışı anahtar, null) defterde HİÇ satır yazmıyor** — rezerv daha açılmamış. İki
kademe canlıda ayırt edildi. Tek gözlem: var olmayan proje için `project:` sütununda ham uuid
görünüyor (A-9, P2).

## 4. Canlı mutlu yol

Özne: **adstark.com.tr** (`project_id: e2785bf7-9963-4b6a-a6d7-aaed7b550abe`, `list_projects` canlı
çıktısından). Bakiye: **4439 → 4409** (Ç1), **4382 → 4352** (Ç2), toplam **Δ −60**, **2 ücretli çağrı**.
(Aradaki 4409→4382 sapması BENİM DEĞİL: aynı anda koşan başka işçilerin `audit_content`/`audit_speed`
satırları defterde görülüyor — bu yüzden Δ, bitişik bakiye çiftleriyle ölçüldü, uçtan uca farkla değil.)

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| Ç1 mutlu yol | `{"project_id":"e2785bf7-…"}` | 200, text, **619 ms**, `isError` yok, `structuredContent: null`, `_meta: null` | **−30** | Tam gövde aşağıda. Başlık: `On-page audit — 1 page(s) analyzed (crawl from 2026-09-02T14:26:48.349Z).` |
| Ç2 aynı crawl'ın YENİDEN denetimi | aynı argüman | 200, text, **624 ms** | **−30** | **Bayt-bayt aynı metin.** İkinci kez 30 kredi. `plan.mjs:274`'ün açık S5 hücresi ("a re-audit of an unchanged crawl: same output, second charge?") böylece **cevaplandı: EVET, ikinci ücret alınıyor** (A-3) |

Ç1/Ç2 çıktısı (birebir, tamamı):

```
On-page audit — 1 page(s) analyzed (crawl from 2026-09-02T14:26:48.349Z).

Summary: 1 images missing alt text.
1 page(s) with findings; 0 clean.

Findings by page:
- https://adstark.com.tr/iletisim
    · 16 of 17 images missing alt text
```

**Bu çıktının en önemli özelliği ne SÖYLEDİĞİ değil, ne SÖYLEMEDİĞİ (A-2).** Ölçülen zincir:

- `list_jobs` (canlı, aynı oturum): adstark'ın en son iki crawl'ı
  `53907ab7-… finished 2026-09-02T14:27:00.292+00:00` (Dilim 2 A fazının `include_paths:["/iletisim"]`
  daraltılmış crawl'ı, **1 sayfa**) ve ondan 3 dakika öncesi `6f8e3fb6-… finished 14:24:51.788`
  (**51 sayfa**, `docs/audits/tools/2026-09/crawl_site.md` §4).
- Raporun damgası `crawl from 2026-09-02T14:26:48.349Z` — yani `loadLatestCrawl` **EN SONUNCUYU**
  seçti, en GENİŞİNİ değil.
- Sonuç: müşteri 30 kredi ödedi, sitesinin **tek bir sayfası** denetlendi, ve raporda bunun bir
  sorun olabileceğini söyleyen **tek bir cümle yok**. "1 page(s) analyzed" dürüst ama uyarı değil;
  `0 clean` ifadesi bir sitenin tamamı hakkında konuşuyormuş gibi okunuyor.
- Karşılaştırma kendi ailesinden geliyor: **12 kredilik `audit_content` aynı veriyle kapsam cümlesini
  BASIYOR** (`Checked 3 of 234 query/page pairs against 1 of the 1 crawled pages. 231 could not be
  checked…`) ve düzeltmenin adını veriyor (`run crawl_site again (or widen it)`). Aynı disiplin
  30 kredilik kardeşinde yok. mdx'in ilgili cümlesi (`:43`) yalnız **sayfa listesinin** kapağından
  söz ediyor, crawl'ın kapsamından değil.

**Eşiklerin canlı ölçülememesi (dürüst sınır).** Bu tek sayfa `title_too_long` / `meta_too_long` /
`thin_content` bulgularının HİÇBİRİNİ ateşlemedi (sayfanın title'ı `"İletişim - Artistics"` = 20
karakter, §"audit_content" kaydında birebir). Yani 60/160 eşiklerinin müşteriye giden cümlesi
**canlıda ölçülemedi**; yeni bir `crawl_site` iş emrimde YASAK. Eşiklerin davranışı §2'de mutasyonla
ve §5'te kaynak satırıyla ölçüldü — ikisi de doğrudan kanıt, ama canlı cümle metni değil.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim2/d2-content/probe.jsonl`
(anahtar `makeRedactor(process.env.MCP_SMOKE_URL)` ile redakte).

## 5. SEO güncelliği

Kaynak: `apps/mcp/src/audit/rules/onpage.ts` + `apps/mcp/src/audit/format.ts` + `audit-onpage.mdx`.
Referans satırı (`docs/reference/…:235`): `audit_onpage | R-4.1–R-4.5, R-4.9, R-3.15, R-3.16, R-6.2 |
**Karakter sınırı efsanesi:** Google title/description için sınır yayımlamıyor (R-4.2, R-4.4).
noarchive bulgusu artık ölü (R-3.16)`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-4.1 title link tamamen otomatik üretilir (kaynaklar: `<title>`, h1, `og:title`, anchor text, `WebSite` schema) | `onpage.ts:205` `missing_title` — `<title>` yoksa bulgu. `og_missing` (`:264-271`) ve `title_equals_h1` (`:258`) var; ama hiçbir cümle Google'ın title'ı ÜRETEBİLECEĞİNİ söylemiyor | **KISMEN AYKIRI** | "missing title" bir kayıp değil, bir RİSK: Google h1/og:title/anchor'dan üretir. Tool bunu mutlak bir eksiklik gibi raporluyor. Yönü doğru (yazılı title tercih edilir), gerekçesi eksik |
| **R-4.2 `<title>` için karakter sınırı YOKTUR; "60 karakter kuralı" Google dokümanında yoktur** | `onpage.ts:15` `const TITLE_MAX = 60;`, yorumu `:13-14` "Titles beyond ~60 chars are routinely truncated in Google's results". Bulgu metni `:207` `title too long (${n} chars, limit 60)`. mdx `:14` "too long (over ~60 characters)" | **AYKIRI** | **A-1, tur'un en yüksek riski ve GERÇEKLEŞMİŞ.** Üç yerde birden: kaynak sabiti, müşteriye giden cümle ("limit 60"), docs sayfası. Dahası **testte pinli** (M1b: 65'e çekmek 4 testi kırmızıya düşürüyor) — kapı yanlış sayıyı sadakatle koruyor. `onpage.ts:8-10`'un "first-principles … NOT lifted from any external engine" ifadesi kaynağı doğru anlatıyor ama doğruluğu değil |
| R-4.3 title'da keyword stuffing / boilerplate önerilmez | Stuffing kontrolü **YOK**. En yakını `duplicate_title` (`:209`) ve `title_stray_chars` (`:210`, markup artığı) | **İLGİSİZ (ölçülerek)** | `grep -n "stuffing\|repeat" onpage.ts` → eşleşme yok. Bir boşluk, bayat kural değil |
| **R-4.4 meta description için de uzunluk sınırı YOKTUR; snippet öncelikle SAYFA İÇERİĞİNDEN üretilir** | `onpage.ts:18` `const META_MAX = 160;`, bulgu metni `:216` `meta description too long (${n} chars, limit 160)`. mdx `:15` "too long (over ~160 characters)" | **AYKIRI** | A-1'in ikinci yarısı. Ek katman: Google snippet'i çoğu zaman meta'dan DEĞİL sayfadan üretir, yani "meta description too short (42 chars, minimum 50)" iki kez varsayımlı bir bulgu. M2: 161 bile kırmızı |
| R-4.5 snippet kontrolleri: `nosnippet`, `max-snippet:[n]`, `data-nosnippet` | **HİÇ YOK.** `grep -rn "nosnippet\|max-snippet\|data-nosnippet" apps packages --include=*.ts` → yalnız `tech-signals.test.ts:120` (fikstür dizgisi), üretim kodunda **sıfır** | **İLGİSİZ — ama boşluk (A-7)** | `AuditPage.robotsMeta` (`crawl-data.ts:26`) ve `xRobotsTag` (`:64`) crawl'da SAKLI ve audit_onpage bunları hiç okumuyor. Snippet uzunluğu hakkında 30 kredilik bir bulgu üretilirken snippet'i gerçekten kontrol eden direktifler hiç bakılmadan geçiliyor |
| R-4.9 görsel SEO (alt text · dosya adı · image sitemap · BMP/GIF/JPEG/PNG/WebP/SVG/AVIF · og:image) | Yalnız **alt sayımı**: `onpage.ts:247-252` `${n} of ${m} images missing alt text`. Bu turda canlıda ateşleyen TEK bulgu türü buydu | **KISMEN** | Dosya adı, format, image sitemap ekseni yok. **`og_missing` kuralı (`:264-271`) `ogImage`'ı hiç okumuyor** — alan `crawl-data.ts:61`'de saklı olmasına rağmen kural yalnız `ogTitle`+`ogDescription`'a bakıyor; R-4.9'un "og:image ile tercih edilen görsel" ekseni ölçülmüyor (A-6) |
| R-3.15 meta robots / X-Robots-Tag desteklenen direktifler | audit_onpage `robotsMeta`'yı **hiç okumuyor**. `grep -n "robotsMeta\|xRobots" apps/mcp/src/audit/rules/onpage.ts` → eşleşme yok; direktif ailesi `rules/tech.ts:42-44, 237-296`'te (audit_tech) | **İLGİSİZ (ölçülerek)** | Ayrım doğru (fiyat ayrı), ama müşteri 30 kredilik "on-page" denetiminde `noindex`'li bir sayfanın raporlandığını görmez |
| **R-3.16 `noarchive`/`nocache`/`nositelinkssearchbox` artık kullanılmıyor — bunları bulgu saymak BAYAT** | Ölçüm: `grep -rn "noarchive\|nocache\|nositelinkssearchbox" apps packages --include=*.ts` → **hiç eşleşme yok** (üretim ya da test, hiçbiri) | **UYUYOR (ölçülerek)** | Referansın bu tool için adlandırdığı ikinci risk **karşılıksız**: ölü direktif hiç üretilmiyor, saklanmıyor, raporlanmıyor |
| R-6.2 ücretli/sponsorlu linkler `nofollow`/`sponsored`/`ugc` ile nitelenmeli | `onpage.ts` içinde `rel` / `nofollow` / `sponsored` / `ugc` **hiç geçmiyor** (grep, sıfır eşleşme). `AuditPage.links` (`crawl-data.ts:27`) yalnız URL dizisi — `rel` niteliği crawl'da **saklanmıyor** bile | **İLGİSİZ — yapısal boşluk** | Bayat bir kural değil; ölçülemez bir kural: veri modeli `rel`'i taşımıyor. Bu tool bu ekseni ancak crawler değişirse görebilir |
| R-9.5 dil tespiti yalnız GÖRÜNÜR İÇERİKTEN; "`lang` gibi kod düzeyi dil bilgisini kullanmıyoruz" | `onpage.ts:273-276` `lang_missing` → `missing html lang attribute`, `format.ts:60` etiketi `"missing html lang"` | **AYKIRI (A-5)** | Google'ın kendi ifadesine göre `<html lang>` bir arama/dil sinyali DEĞİL. 30 kredilik bir SEO raporunda bunu bulgu diye saymak R-9.5'e aykırı. (Erişilebilirlik değeri ayrı bir konu ve rapor bunu söylemiyor.) Düşük şiddet, çünkü tavsiye zararsız — ama sayı şişiriyor |
| R-3.14 mobile-first indexing: içerik/başlık/meta/schema mobil ile masaüstünde eşdeğer olmalı | Crawler tek bir user-agent'la tek sürüm çekiyor; audit_onpage mobil/masaüstü ayrımı yapmıyor | **İLGİSİZ (bildirilmemiş)** | Bir bulgu değil ama raporun kapsam sınırı: bulgular MASAÜSTÜ HTML hakkında ve hiçbir cümle bunu söylemiyor |
| R-3.11 crawl → render → index; JS içeriği render sonrası görünür | Render yok (`crawl_site` kaydı §5, `page-signals.ts:8-11`). JS ile basılan bir başlık `missing_title` sayılır | **AYKIRI (bildirilmiş — kaynakta)** | Kaynak dürüst, **müşteriye giden hiçbir cümle bunu söylemiyor**. `crawl_site` kaydındaki aynı bulgunun bu tool'daki sonucu: yanlış `missing_title`/`missing_meta` bulguları 30 kredilik raporda |
| R-3.9 `rel=canonical` direktif değil GÜÇLÜ SİNYAL | `onpage.ts:226-229` `missing_canonical` ve `canonical_elsewhere (${url})`. Hiçbir cümle "sinyal" / "direktif değil" ayrımını yapmıyor | **KISMEN** | Kural doğru yönde (canonical eksikliği raporlanır), ama `canonical points elsewhere` cümlesi bir ihlal gibi okunuyor — oysa çoğu durumda kasıtlı ve meşru bir tercih. M3 bu cümlenin YANLIŞ ateşlenebileceği bir ekseni de açıkta bıraktı |
| R-4.10 hreflang çift yönlü olmalı | `AuditPage.hreflangs` (`crawl-data.ts:58`) SAKLI; audit_onpage hiç okumuyor (grep: `hreflang` → onpage.ts'te sıfır) | **İLGİSİZ** | audit_tech'in alanı; kayıt için burada |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:29` eşlemesi: **VAR** — `  audit_onpage: "report",`.
Sevk durumu: `card-map.ts:62` `export const CARDED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(["get_credit_balance"]);`
— yani eşleme planlı, **sevk edilmemiş**.

Canlı ölçüm (aynı oturumda, aynı transport): `audit_onpage`'in `tools/call` cevabı
`structuredContent: null` ve `_meta: null`; **kıyas noktası ölçüldü** — `get_credit_balance`'ın aynı
oturumdaki cevabı `structuredContent: PRESENT`. Yani fark tool'a özgü, transport'a değil.
Kartın beklediği alanlar sorusu bu yüzden **ÖLÇÜLEMEDİ — payload hiç üretilmiyor**.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — üç hücre: `:264` (K1/S2 soğuk: "Must THROW so
  withCredits releases … expected delta 0", canlıda §3'te doğrulandı), `:269` (K1/S1 kampanya siteleri),
  `:274` (K1/S5 "a re-audit of an unchanged crawl: same output, second charge?" — **bu turda cevaplandı**).
  `ID_TOOLS:76`'da da var.
- `goals/` hedefi gerekli mi: **EVET** — iki gerekçeyle. (a) 60/160 eşikleri şu anda testlerle
  KORUNUYOR ve düzeltilmeleri gerekiyorsa hedef, düzeltilmiş hâlin geri kaymasını engeller;
  (b) `goals/` altında audit_onpage davranışını ölçen hiçbir hedef yok (`grep -rln "audit_onpage" goals/`
  → yalnız `migration-journal-sync.md`, tablo adı üzerinden).

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) |
|---|---|---|---|---|
| A-1 | **P1** | **Karakter sınırı efsanesi üç katmanda birden canlı ve testle korunuyor.** Google `<title>` ve meta description için sınır YAYIMLAMIYOR (R-4.2/R-4.4); tool "limit 60"/"limit 160" diye bir kural bildiriyor | `onpage.ts:15,18`; bulgu metinleri `:207,:216`; `audit-onpage.mdx:14-15`; M1b/M2 kırmızı — eşik sayısı testte pinli | Eşikleri SİLMEK değil, ÇERÇEVEYİ değiştirmek: bulgu metni "limit" yerine ölçülmüş bir gerekçe versin (ör. "typically truncated in Google's results at this width — Google publishes no character limit"), mdx'e R-4.2/R-4.4'ün cümlesi girsin, ve `onpage.ts:13-14/17` yorumları "limit" kelimesini bırakmasın. NEVER#6 kapsamında değil (fiyat değil), ama müşteri metni — insan onayı önerilir |
| A-2 | **P1** | **30 kredilik denetim kapsam uyarısı basmıyor.** Ç1/Ç2 tek sayfalık bir crawl'ı denetledi; 3 dakika önce biten 51 sayfalık crawl'dan söz eden tek kelime yok. 12 kredilik `audit_content` aynı veride kapsam cümlesini BASIYOR | §4 zinciri: `list_jobs` iki crawl · rapor damgası `14:26:48.349Z` · `audit_content` çıktısı `Checked 3 of 234 … against 1 of the 1 crawled pages. 231 could not be checked…` | `formatOnpageReport`'un başlık satırına `audit_content`'in kapsam disiplini taşınsın: kaç sayfa tarandı, o crawl'ın `max_urls`/`include_paths` ile daraltılıp daraltılmadığı, ve daha geniş bir crawl varsa adı. En ucuz hâli: crawl 1–N sayfa ise "this crawl covered N page(s) — run crawl_site again (or widen it) before reading this as a site-wide audit" |
| A-3 | **P1** | **Değişmemiş bir crawl'ın yeniden denetimi bayt-aynı çıktı için 30 krediyi tekrar alıyor**, ve hiçbir cümle uyarmıyor | §4 Ç1/Ç2: aynı argüman, aynı metin, iki `-30 credits · charge · audit_onpage` satırı (`14:45:24.573049` ve `14:46:04.685547`) | `audit_runs` zaten crawl job id'sini saklıyor (`audit-shared.ts:144-147`). Aynı `(tenant, project, crawlJobId, tool)` için var olan raporu ÜCRETSİZ döndürmek ya da en azından "you already audited this crawl on <date>; re-running charges 30 credits again" uyarısı + `confirm` istemek. Ücret modeli kararı → insan imzası |
| A-4 | P2 | **`sameUrl`'ün fragment toleransı hiçbir testin bakmadığı yerde** (M3 yeşil): fragment'li bir self-canonical yanlış `canonical_elsewhere` bulgusu üretebilir | M3: `url.hash = "";` silindi, 244/244 yeşil. Yorum (`onpage.ts:168`) toleransı iddia ediyor | `onpage.test.ts`'e fragment ekseninde bir vaka: `canonical: "https://e/a#top"`, `url: "https://e/a"` → temiz. (Slash ekseni zaten pinli; eksik olan yalnız fragment) |
| A-5 | P2 | **`lang_missing` kuralı R-9.5'e aykırı**: Google dil tespitinde kod düzeyi `lang`'ı kullanmadığını AÇIKÇA söylüyor; tool bunu SEO bulgusu sayıyor | `onpage.ts:273-276`; `format.ts:60`; R-9.5 (`docs/reference/…:173`) | Ya bulgudan çıkarılsın, ya da metni erişilebilirlik gerekçesine taşınsın ("not a Google ranking or language signal; it matters for screen readers and browser rendering"). Sayının bulgu toplamına girmesi ayrıca gözden geçirilsin |
| A-6 | P2 | **`og_missing` kuralı `ogImage`'ı okumuyor**, oysa alan crawl'da saklı; R-4.9'un "og:image ile tercih edilen görsel" ekseni ölçülmüyor | `onpage.ts:264-271` yalnız `ogTitle`+`ogDescription`; `crawl-data.ts:61` `ogImage?: string \| null` | Ya kuralın kapsamına alınsın (üç alanın üçü de yoksa "no share preview"), ya da `AuditPage`'e neden okunmadığı yazılsın. Görsel paylaşım kartı ekseni ayrı bir bulgu olabilir |
| A-7 | P2 | **Snippet kontrolleri (R-4.5) hiçbir yerde yok**: `nosnippet`/`max-snippet`/`data-nosnippet` üretim kodunda sıfır eşleşme; `robotsMeta`/`xRobotsTag` audit_onpage'e ulaşıyor ama okunmuyor | grep (§5, R-4.5 satırı); `crawl-data.ts:26,64` | Snippet uzunluğu hakkında bulgu üreten bir tool'un `nosnippet`/`max-snippet` taşıyan sayfayı ayırt etmesi doğru olur: o sayfada meta uzunluğu bulgusu ANLAMSIZ. En küçük hâli: `max-snippet:[n]` varsa meta uzunluk bulgusunu bastır. (R-5.4: bu direktifler AI Overviews girdisini de sınırlıyor — ayrı bir ürün fırsatı) |
| A-8 | P2 | **`goals/` altında bu tool'un davranışını ölçen hiçbir hedef yok** | `grep -rln "audit_onpage" goals/` → yalnız `migration-journal-sync.md` | A-1 düzeltildikten sonra "hiçbir müşteri metni yayımlanmamış bir karakter sınırını kural gibi anmaz" predicate'i `goals/`a yazılsın |
| A-9 | P2 | Var olmayan bir proje için defter satırı `project:` sütununda **ham uuid** gösteriyor — `project: 00000000-0000-4000-8000-000000000000` | §3 defter alıntısı | Çözülemeyen bir proje kimliği için satır ya kapsamsız yazılsın (`no project scope`, `audit_speed`'in yaptığı gibi) ya da gösterim "unknown project" desin |
| A-10 | P2 | Tool yüzeyinin **kendi hızlı şerit test dosyası yok** (`apps/mcp/src/tools/audit-onpage.test.ts` mevcut değil); arşiv kapısı ve precondition dalları yalnız `audit-onpage.db.test.ts`'te (Docker) ve bu turda CANLIDA ölçüldü | `ls apps/mcp/src/tools/ \| grep audit-onpage` → yalnız `.db.test.ts`; `audit-runs.test.ts:24` 0-kredilik ad kullanıyor | Kabul edilebilir (paylaşılan gövde `audit-shared.ts`'te ve `audit-runs.test.ts` onu sürüyor), ama `verify.sh` bu iki dalı hiç koşmuyor — `goals/` predicate'i ya da DB-siz bir port testi ile kapatılması önerilir |
