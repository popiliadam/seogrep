# `research_keywords` — tool kontrol kaydı (2026-09 turu)

> Dilim: 4 · İşçi: Opus 4.8 · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Taban: `pnpm --filter @pseo/mcp test` → **155 dosya / 4016 test passed** (temiz ağaç, 2026-09-03).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `charge:"handler"`, 25 kredi (`costs.ts:35`), kredi/davranış cümleleri docs ile birebir; **`keyword_info.monthly_searches` hiç okunmuyor** (`grep -rn monthly_searches apps/mcp/src` → yalnız fixture) |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyonun **5'i KIRMIZI**; `git diff --stat` boş, geri koşu 4016/4016 |
| 3 Canlı negatif | ÖLÇÜLDÜ | 6 ücretsiz senaryo, hepsi `isError:true` + "You were not charged"; defterde 585→585 satır (Δ=0) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (tr/2792), her biri `-25 · charge · research_keywords · no project scope`, refund yok |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-8.1 UYUYOR · R-8.8 UYUYOR · **R-8.9 AYKIRI** (yuvarlama/12-ay/exact-match cümlesi hiçbir yüzeyde yok, üstelik yuvarlanmış hacimler TOPLANIYOR) |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:21` `research_keywords: "list"`; `CARDED_TOOLS` yalnız `get_credit_balance` (satır 62) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | bu dosya ✔ · `plan.mjs` PLAN girişi VAR (satır 261 K0/S3c, satır 290 K3/S1) · `goals/` gerekmez |

**Karar (ölçüm turu, 2026-09-03):** DÜZELTME GEREKLİ — para yolu, kiracı kapsamı ve şema reddi
kusursuz ölçüldü; kusur RAPOR DÜRÜSTLÜĞÜNDE: Keyword Planner hacminin yuvarlanmış/12-aylık/yakın-varyant
doğası hiçbir cümlede söylenmiyor ve o yuvarlanmış sayılar bir "toplam" olarak toplanıyor (R-8.9).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/research-keywords.ts:424` (`makeResearchKeywordsTool`), `name:` satır 427,
  `charge: "handler"` satır 431. Vendor adaptörü `apps/mcp/src/dfs/client.ts`, run yazıcı
  `apps/mcp/src/dfs/keyword-runs.ts`.
- Zod şeması (`research-keywords.ts:101`): `keywords: z.array(z.string().min(1)).min(1).max(100)` ·
  `language_code: z.string().min(2).default("en")` · `location_code: z.number().int().positive().default(2840)`.
  Nesne `.strict` değil ama registry `additionalProperties:false` uyguluyor — canlıda ölçüldü (§3 N2/N4).
- Description (birebir alıntı, `research-keywords.ts:118`):
  > "Look up Google search volume, CPC, competition, keyword difficulty, search intent and search-volume
  > trend for up to 100 keywords. Synchronous — returns a table immediately. Costs 25 credits. Needs a paid
  > credit balance: it is not available on trial credits. If live keyword data is unavailable on this
  > deployment, the tool says so and charges nothing."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:35`, birebir): `  research_keywords: 25,`
- Docs sayfası: `apps/web/content/docs/tools-reference/research-keywords.mdx`.
  Kredi cümlesi birebir: `**Cost:** 25 credits.`
  Davranış cümlesi birebir: *"**You are also not charged for a lookup that comes back completely empty.**
  If the provider returns no figure for a single one of your keywords, there is no table to hand you, so
  the tool refuses the lookup with a message saying so and the credits are returned to your balance."*
  Hacim tanımı birebir: *"**Search volume** — average monthly Google searches."*
- DFS adaptörü (`dfs/client.ts`):
  uç `https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live`;
  tarife `KEYWORD_OVERVIEW_REQUEST_USD = 0.012` + `KEYWORD_OVERVIEW_PER_KEYWORD_USD = 0.00012`;
  tahmin `estimateKeywordOverviewCostUsd()` = liste × `KEYWORD_OVERVIEW_ESTIMATE_MARGIN = 1.5`;
  ayrıştırıcı zod, her metrik `nullish`, `hasMetrics()` dokuz alanı OR'luyor.
  Fixture `dfs/fixtures/keyword-overview.json` canlıda gördüğüm alan kümesiyle uyuşuyor
  (`competition`, `competition_level`, `cpc`, `search_volume`, `search_volume_trend`,
  `last_updated_time`, `keyword_difficulty`, `search_intent_info`).
- **Vendor ucu teyidi (şef gözlemi Ş-5, hakem turu, 2026-09-03):** ödenen uç prod'da da
  `dataforseo_labs/google/keyword_overview/live` çıktı — Keywords Data (Google Ads) ucu DEĞİL.
  Kanıt: Supabase `public.dfs_spend`, spend_day 2026-09-03, bu tool'un iki isteği
  `keyword_overview/live` endpoint satırıyla ($0,025 toplam). Referans satırı R-8.9'u
  "Keyword Planner hacmi" diye adlandırıyor ve Labs `keyword_overview` de aynı Google Ads
  hacmini taşır; ama kaynak ucun kayıtta ADIYLA durması gerekiyordu — bu satır onu sabitler.
- **Tutarsızlık 1 (ölçüldü):** fixture'ın `keyword_info` nesnesi `monthly_searches` (yıl/ay/hacim dizisi)
  taşıyor; `grep -rn "monthly_searches" apps/mcp/src` fixture dışında **0 eşleşme**. Vendor'ın 12 aylık
  serisi projeksiyonda düşürülüyor ve düşürüldüğü hiçbir yerde söylenmiyor.
- **Tutarsızlık 2 (ölçüldü):** tool her teslim edilen aramayı `keyword_research_runs`'a yazıyor
  (migration 0029, `serveKeywordOverview`), ama `research-keywords.mdx` bu kaydı ve panodaki
  **Lookups** sayfasını HİÇ anmıyor — `grep -niE "lookup|record|history|dashboard"` yalnız "lookup"
  kelimesini fatura cümlesinde buluyor. Kardeş `discover_keywords.mdx`'in "Limitations" bölümü aynı
  kaydı açıkça anlatıyor. Asimetri.
- Tutarsızlık aranan ve BULUNMAYAN yer: description ↔ costs.ts ↔ mdx kredi rakamı üçü de 25;
  `verify.sh:40` `gen-tool-docs.mjs --check` drift'i zaten kapıya bağlamış.
- Seçilebilirlik: "bu kelimelerin hacmi ne / şu listeyi fiyatla / CPC'si kaç" → `research_keywords`.
  Komşu `discover_keywords` ile karışma riski DÜŞÜK ve ölçülebilir gerekçeyle: iki description da
  ayrım cümlesini kendisi taşıyor (`discover_keywords`: *"the question that comes before pricing a
  list you already have"*), `research_keywords` **liste ALIR**, `discover_keywords` **liste ÜRETİR**.
  Gerçek karışma riski `keyword_gap` iledir (o da hacim basar) — ama `keyword_gap` rakip domain ister.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Log dizini
`/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/ed07ad51-99ee-4158-ba60-03e288098193/scratchpad/dilim4/logs/`.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `research-keywords.ts:456` — `withCredits` meta'sına `projectId: undefined` eklendi (kiracı/kapsam ekseni) | `handler-charge-scope-coverage.pin.test.ts` | **KIRMIZI** (1 failed / 4015 passed) | `m1.log`: *"leaves the exempt tools genuinely without one, rather than quietly scoped"* |
| M2 | `credits/costs.ts:35` — `25` → `26` (ücret tutarı) | `costs.test.ts` + `research-keywords.test.ts` | **KIRMIZI** (2 failed) | `m2.log`: *"matches the approved v0 literals exactly"* ve *"advertises its name, the 25-credit cost…"* |
| M3 | `dfs/client.ts:242` — `hasMetrics()`'ten `search_intent_info?.main_intent` terimi silindi (vendor alanı düşürme) | `dfs/client.test.ts` | **KIRMIZI** (1 failed) | `m3.log`: *"counts a search intent as data even with no Ads metrics anywhere"* — 2026-08-25 defektinin pini yaşıyor |
| M4 | `research-keywords.ts:442` — `keywordSet.length === 0` → `=== -1` (rezerv ÖNCESİ ücretsiz kapı) | `keyword-research-runs.test.ts` | **KIRMIZI** (1 failed) | `m4.log`: *"refuses an all-blank keyword list, reaching neither the port nor the writer"* |
| M5 | `research-keywords.ts:283` — `missingKeywords()` → `return []` (eksik kelime mutabakatı) | `research-keywords.test.ts` S12 + `research-keywords-coverage.test.ts` | **KIRMIZI** (8 failed) | `m5.log`; içindeki `server.test.ts > GET /status … pendingJobs:null` FLAKE'tir — temiz ağaç geri koşusunda geçti, mutasyona atfedilmedi |

Yeşil kalan mutasyon **YOK**. Çalışma ağacı sonunda temiz:

```
$ git diff --stat
(çıktı boş)
$ pnpm --filter @pseo/mcp test   # restore.log
 Test Files  155 passed (155)
      Tests  4016 passed (4016)
```

`*.db.test.ts` şeritleri koşulmadı (Docker) — db şeridi CI/hakem.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt aşağıda. Defter satır sayısı bu blok boyunca **585 → 585**.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 boş liste (minItems) | `{"keywords":[]}` | 200 / `isError:true` | 0 | `✖ Too small: expected array to have >=1 items → at keywords` + *"You were not charged."* — vendor'a ulaşmadı |
| N2 bilinmeyen alan | `{"keywords":["seo software"],"foo":"bar"}` | 200 / `isError:true` | 0 | `✖ Unrecognized key: "foo"` — `additionalProperties:false` CANLIDA doğrulandı |
| N3 hep-boşluk liste | `{"keywords":["   ","  "]}` | 200 / `isError:true` | 0 | `NO_KEYWORDS_MESSAGE` birebir döndü; **rezerv-öncesi dürüstlük kapısı ölçüldü** — defterde satır yok |
| N4 uydurma `project_id` | `{"keywords":["seo"],"project_id":"1111…5555"}` | 200 / `isError:true` | 0 | `✖ Unrecognized key: "project_id"` — bu tool proje almıyor, kiracı sızıntısı için yüzey YOK |
| N15 101 kelime | 101 elemanlı liste | 200 / `isError:true` | 0 | `✖ Too big: expected array to have <=100 items` |
| N0 defter tabanı | `get_credit_balance` | 200 | — | balance 4142 (paralel işçilerle paylaşımlı) |

Kiracı sızıntısı ekseni bu tool'da **yapısal olarak karşılıksız**: şema `project_id`/`target` almıyor,
ledger satırı `no project scope` ile açılıyor ve bu `handler-charge-scope-coverage.pin.test.ts`'te
gerekçesiyle pinli (`NO_SUBJECT_TO_SCOPE`).

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| P1 ücretli, Türkçe pazar | 4 Türkçe kelime, `language_code:"tr"`, `location_code:2792` | 200 / `isError:null` | **−25**, defter: `-25 · charge · research_keywords · no project scope`, refund YOK | 4/4 kelime figürle döndü; hacim 8.100 / 1.000 / 480 / 110; difficulty 57/26/8/0; intent `commercial`/`informational` (+`navigational`,`informational` foreign); trend üç bacak; kapanış satırı: *"CPC and competition were last refreshed by DataForSEO on 2026-08-19 (15 days ago)."* |
| P2 aynı çağrı 22 sn sonra | P1 ile birebir aynı argümanlar | 200 / `isError:null` | **−25**, ikinci `charge` satırı, refund YOK | Çıktı **birebir aynı**. "already researched" / "you ran this N seconds ago" benzeri HİÇBİR uyarı yok; 0029 run kaydı yazılıyor ama okunmuyor (A-3 sınıfı, fiyat değil davranış) |

Ölçülen ek gerçekler:
- Başlık satırı: *"Search volume for 4 keywords (language tr, location 2792), **9,690 total monthly
  searches**"* — bu, dört YUVARLANMIŞ Keyword Planner değerinin toplamıdır (8.100+1.000+480+110).
- Türkçe pazarda "no data" yolu tetiklenmedi: `hasMetrics()`'in 2026-08-25 genişletmesi sayesinde
  dört satırın dördü de `has_data` — Labs yarısı (difficulty/intent/competition/trend) doluydu.
- `charge:"handler"` pre-reserve dürüstlük kapısı canlıda kanıtlandı (N3): boş/blank kelimede defter
  satırı OLUŞMADI.

Ham kayıt (anahtar redakte, repo dışı):
`/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/ed07ad51-99ee-4158-ba60-03e288098193/scratchpad/dilim4/canli/raw.jsonl`

DFS reddi: **YOK** — "daily cap" mesajı hiçbir çağrıda görülmedi.

## 5. SEO güncelliği

Referans "Tool eşleme" satırı: `research_keywords | R-8.1, R-8.8, R-8.9 | Keyword Planner hacminin
exact-match-only ve yuvarlanmış olduğunun raporda söylenmemesi`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-8.1 (DFS aileleri) | `dfs/client.ts` tek uç: `dataforseo_labs/google/keyword_overview/live` — Labs ailesi, R-8.1'in saydığı aileler içinde | **UYUYOR** | 2026-08-17'de emekli `keywords_data/google_ads/search_volume`'dan taşınmış; kaynakta gerekçesiyle yazılı |
| R-8.8 (intent taksonomisi: 4 değer, 0–1 olasılık, ≤1.000 kw/istek) | `client.ts` `searchIntentSchema`: `main_intent: z.string().nullish()`, `foreign_intent: z.array(z.string()).nullish()` — **enum YOK**, vendor ne derse geçer; şema tavanı `.max(100)` ≪ 1.000 | **UYUYOR** | Canlıda gözlenen değerler `commercial`, `informational`, `navigational` — dördün içinde. Beşinci bir değer gelse kod kırılmaz, basar. Olasılıklar (`*_intent_probability`) hiç okunmuyor ama R-8.8 bunu zorunlu kılmıyor |
| R-8.9 (12 aylık ortalama · yakın varyantlar dahil · **yuvarlanmış** · tarihsel yalnız exact match) | Çıktıda `volume 8,100`; docs'ta yalnız *"average monthly Google searches"*. `grep -rniE "12.month\|rounded\|close variant\|exact match"` iki tool kaynağı, iki DFS adaptörü ve iki mdx üzerinde **0 eşleşme** | **AYKIRI** | Üç ayrı yüz: (a) yuvarlama söylenmiyor, (b) "yakın varyantlar dahil" söylenmiyor — okur sayıyı tam-eşleşme sanır, (c) **yuvarlanmış değerler toplanıp tek bir "9,690 total monthly searches" olarak sunuluyor**, ki R-8.9 tam da toplamın tutmayacağını söylüyor. Ayrıca vendor'ın `monthly_searches` serisi elde olduğu hâlde düşürülüyor. **H-1 (hakem turu, 2026-09-03):** aynı R-8.9 kalemi bu dilimde DÖRT kayıtta ölçüldü — `research_keywords` RK-1 · `discover_keywords` DK-2 · `keyword_gap` G-1 · `ranked_keywords` B-3 — ve dördü üç farklı şiddetle yazılmıştı. Tek bant: **çıplak açıklama boşluğu (bare disclosure) P2, ölçülmüş bir iddia hatası P1.** Düzeltme dördü için PAYLAŞILAN TEK SABİT olmalı (bkz. `_DILIM4-HAKEM-SINIFLAR.md` sınıf 3) |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:21` → `research_keywords: "list",`. `CARDED_TOOLS` (satır 62) yalnız
`get_credit_balance` içeriyor, yani bu tool bugün kart ÇİZMİYOR — eşleme ileri dilim için duruyor.
Canlı payload bir `list` kartının isteyeceği yapısal alanları taşıyor mu: **kısmen** — metin satırları
`• <keyword> — volume …, CPC …, competition …` biçiminde tekdüze ve ayrıştırılabilir, ama tool
`structuredContent` DÖNDÜRMÜYOR (canlı envelope'ta yalnız `content[].text` var), yani kart
verisini metinden geri-ayrıştırmak zorunda kalır.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — satır 261 (`K0/S3c`, boş liste şema reddi) ve
  satır 290 (`K3/S1`, ham vendor şekli). `EXCLUDED`'da değil, gerekçe bayatlaması sorunu yok.
- `goals/` hedefi gerekli mi: **HAYIR** — para yolu (`ledger-integrity`, `append-only-armor`) ve
  secret ekseni zaten hedefli; bu tool'a özgü canlı-uç iddiası yok. R-8.9 bulgusu bir METİN
  kalemidir, predicate'i kaynak grep'i olurdu ve düzeltme dalgasında `docs-static.md`'ye eklenebilir.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, YYYY-MM-DD) |
|---|---|---|---|---|---|
| RK-1 | ~~**P1**~~ → **P2** (hakem turu, 2026-09-03) | **R-8.9 AYKIRI:** çıktı ve docs, Keyword Planner hacminin 12 AYLIK ORTALAMA olduğunu, YAKIN VARYANTLARI kapsadığını ve YUVARLANDIĞINI hiçbir yerde söylemiyor. Okur `volume 8,100`'ü tam-eşleşme, tek-ay, kesin bir sayı sanır | `grep -rniE "12.month\|rounded\|close variant\|exact match"` → `research-keywords.ts`, `dfs/client.ts`, `research-keywords.mdx` üzerinde 0 eşleşme; canlı P1 çıktısı (§4) | CPC tazelik satırının yanına kalıcı bir HACİM cümlesi: hacmin yakın varyantlar dahil 12 aylık ortalama ve yuvarlanmış olduğunu söyleyen tek satır; aynı cümle mdx'e. Kaynak: R-8.9. **Şiddet düzeltmesi (hakem turu, 2026-09-03): P1 → P2** — bu bir ÇIPLAK AÇIKLAMA boşluğudur (bare disclosure): basılan rakam vendor'ın verdiği rakamdır, ürün onu bozmuyor; para ya da kiracı ekseni yok. Hakem bandı: bare disclosure P2, ölçülmüş iddia hatası P1 (H-1). Kardeşleri `keyword_gap` G-1 (aynı gerekçeyle P2'ye çekildi), `discover_keywords` DK-2 ve bu kaydın RK-2'si (ikisi P1 KALDI — ölçülmüş iddia), `ranked_keywords` B-3 (zaten P2, bandın çapası) | |
| RK-2 | **P1 KALDI** (hakem turu, 2026-09-03) | Yuvarlanmış hacimler TOPLANIP tek "total monthly searches" olarak sunuluyor — R-8.9 bu toplamın tutmayacağını açıkça söylüyor; üstelik dört kelimenin toplamı, kelimeler arası çakışan yakın varyantlar yüzünden çift sayım da içerebilir | `formatKeywordOverview()` `rows.reduce((sum, row) => sum + (row.search_volume ?? 0), 0)`; canlı: "9,690 total monthly searches" | Toplamı ya kaldırmak ya da yanına "these are rounded vendor figures; the total is indicative" şerhi koymak. Karar metin/ürün kalemi olabilir. **Hakem gerekçesi (2026-09-03) — P1 neden KALIYOR:** RK-1'in aksine bu bir açıklama boşluğu değil, ürünün KENDİ ÜRETTİĞİ yeni bir sayıdır — dört yuvarlanmış vendor değerini toplayıp "9,690 total monthly searches" basmak, vendor'ın hiç söylemediği bir rakamı ürün adına iddia etmektir. Bant kuralı gereği (H-1) ölçülmüş iddia hatası P1 kalır | |
| RK-3 | P2 | Vendor'ın `keyword_info.monthly_searches` 12 aylık serisi projeksiyonda düşürülüyor ve düşürüldüğü söylenmiyor — RK-1'in cevabı elde olduğu hâlde kullanılmıyor | fixture `keyword-overview.json` `monthly_searches` taşıyor; `grep -rn "monthly_searches" apps/mcp/src` fixture dışında 0 | En azından "vendor also returns a 12-month series; this tool prints its average" demek; ya da seriyi run raporuna almak | |
| RK-4 | P2 | Aynı kelime seti saniyeler içinde tekrar sorulduğunda tam ücret alınıyor ve HİÇBİR uyarı yok; `keyword_research_runs` (0029) yazılıyor ama hiç okunmuyor | Canlı P1/P2 (§4): 22 sn arayla iki `-25` satırı, birebir aynı metin | Fiyat değişmeden bir cümle: "you looked this exact keyword set up N minutes ago — see the Lookups page". Yazılan kaydın okunmaması Dilim 2 A-3 ailesiyle aynı sınıf | |
| RK-5 | P2 | `research-keywords.mdx` run kaydını ve panodaki **Lookups** sayfasını hiç anmıyor; kardeş `discover_keywords.mdx` aynı kaydı "Limitations" başlığında açıkça anlatıyor — asimetrik dokümantasyon | `grep -niE "lookup\|record\|history\|dashboard" research-keywords.mdx` → yalnız fatura cümlesi | `discover_keywords.mdx`'in "Limitations" paragrafının eşdeğerini bu sayfaya eklemek | |
| RK-6 | P2 | `dfs_spend.actual_usd`, vendor'ın döndürdüğü `cost` ile BİZİM tahminimizi ayırt etmiyor: `extractResponseCostUsd(raw) ?? estimate` ikisini aynı kolona yazıyor ve şemada kaynak alanı yok | `dfs/client.ts` `createLiveClient` (4) adımı; `packages/db/supabase/migrations/0014_dfs_spend_budget.sql:28-37` — kolonlar `estimated_usd`, `actual_usd`, `row_count`, `status`; kaynak kolonu YOK | `actual_usd_source text check (in ('vendor','estimate'))` benzeri bir kolon; operatörün günlük harcama okuması ölçülmüş ile varsayılmışı ayırabilsin (ders 9) | |
| RK-7 | P2 | Tool `structuredContent` döndürmüyor; `card-map.ts` eşlemesi `"list"` olduğu hâlde kart, veriyi düz metinden geri-ayrıştırmak zorunda kalır | Canlı envelope: yalnız `content[].text`; `card-map.ts:21` + `CARDED_TOOLS` (satır 62) | Kart dilimi bu tool'a geldiğinde `structuredContent` şartı iş emrine yazılsın | |
