# `discover_keywords` — tool kontrol kaydı (2026-09 turu)

> Dilim: 4 · İşçi: Opus 4.8 · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Taban: `pnpm --filter @pseo/mcp test` → **155 dosya / 4016 test passed** (temiz ağaç, 2026-09-03).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | 4 mod → 4 Labs ucu, `charge:"handler"`, 40 kredi (`costs.ts:46`), `DISCOVER_REQUESTS_PER_LOOKUP = 1` fiyatın taşıyıcısı |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyonun **5'i KIRMIZI**; `git diff --stat` boş, geri koşu 4016/4016 |
| 3 Canlı negatif | ÖLÇÜLDÜ | 10 ücretsiz senaryo, hepsi `isError:true` + "You were not charged"; defterde satır YOK |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (`ideas`, tr/2792), her biri `-40 · charge · discover_keywords · no project scope`; **100 satırın 100'ü konu-dışı** |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-8.8 UYUYOR (enum yok, 1.000 tavanının altında) · **R-8.9 AYKIRI** (yuvarlama/12-ay/yakın-varyant cümlesi yok) |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:22` `discover_keywords: "list"`; `CARDED_TOOLS`'ta DEĞİL |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | bu dosya ✔ · `plan.mjs` **EXCLUDED** (satır 126) ve gerekçesi **BAYAT** · `goals/` gerekmez |

**Karar (ölçüm turu, 2026-09-03):** DÜZELTME GEREKLİ — mekanizma (mod ayrımı, ücretsiz kapılar, kiracı
kapsamı, pencere altyazısı) ölçülen en temiz yüzeylerden biri; kusur, `ideas` modunun ürün değerinde:
100.000'lik varsayılan tavan, gürültü sınıfının ÜSTÜNDE kaldı ve müşteri 40 krediye 100 satırın 0'ını
kullanabildi.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/discover-keywords.ts:1092` (`makeDiscoverKeywordsTool`), `name:` satır 1095,
  `charge: "handler"` satır 1099. Vendor adaptörü `apps/mcp/src/dfs/discover-keywords.ts`,
  run yazıcı `apps/mcp/src/dfs/subject-runs.ts`, hedef çözümü `apps/mcp/src/tools/project-target.ts`.
- Zod şeması (`discover-keywords.ts:203`, `.superRefine` ile): `mode` (enum, DEFAULT YOK) ·
  `seeds` (1–200, her biri ≤200 karakter) · `seed` (≤200) · `depth` (0–4) · `target` · `project_id` (uuid) ·
  `include_subdomains` · `limit` (1–1000, default 100) · `offset` (≥0) · `min_volume` · `max_volume` ·
  `max_difficulty` (0–100) · `language_code` (default "en") · `location_code` (default 2840).
  `superRefine` iki iş yapıyor: mod-alan ayrımı (`MODE_INPUT_RULES`) ve `min_volume > max_volume` reddi.
- Description (birebir alıntı, `discover-keywords.ts:405`, baş ve son):
  > "Discover keywords to target, from DataForSEO Labs — the question that comes before pricing a list
  > you already have. Pick a mode: \"ideas\" … \"for_site\" … Each mode takes its own input, and a field
  > belonging to another mode is rejected rather than ignored. … Costs 40 credits. Needs a paid credit
  > balance: it is not available on trial credits. If live DataForSEO access is unavailable on this
  > deployment, the tool says so and charges nothing."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:46`, birebir): `  discover_keywords: 40,`
- Docs sayfası: `apps/web/content/docs/tools-reference/discover-keywords.mdx`.
  Kredi cümlesi birebir: `**Cost:** 40 credits.`
  Fiyat/istek cümlesi birebir: *"One call is one **flat price**, charged **once**, and behind it is
  **one** DataForSEO request. If it fails, the whole call fails and **you are not charged.**"*
  Kayıt cümlesi birebir: *"That record is history, not a live surface. No call here reads a previous
  run, nothing is refreshed for you, and there is no \"new since last time\" — so to see the current
  picture, run it again."*
- DFS adaptörü (`dfs/discover-keywords.ts`) — 4 uç:
  `keyword_ideas/live`, `keyword_suggestions/live`, `related_keywords/live`, `keywords_for_site/live`.
  Tarife `DFS_LABS_REQUEST_USD = 0.012` + `DFS_LABS_ROW_USD = 0.00012`;
  `DISCOVER_REQUESTS_PER_LOOKUP = 1` (imzalı marjın taşıyıcısı, M8 ile KIRMIZI olduğu ölçüldü);
  `estimateDiscoverKeywordsUsd(rows)` = (1 istek + satır) × `BUDGET_SAFETY_FACTOR = 1.5`;
  `MODE_ITEM_CARRIER` — yalnız `related` alanlarını `keyword_data` altında taşıyor, parser bunu tek
  kaynaktan okuyor; `parseDiscoverResponse` "item geldi ama satır çıkmadı" durumunda **THROW** ediyor
  (ücretli çağrıyı "bu tohumda kelime yok" gibi göstermemek için).
- Tekilleştirme: **yapılmıyor ve yapılmasına gerek yok** — ölçüldü: tek istek, tek uç, vendor'ın kendi
  sıralı listesi; birleştirilecek ikinci bir yanıt yok (`DISCOVER_REQUESTS_PER_LOOKUP = 1`).
  "keyword ideas" vs "related": ikisi FARKLI uç (`keyword_ideas` kategori komşuluğu, `related_keywords`
  Google'ın "searches related to" öğesi) ve `MODE_MEANS` her ikisini vendor'ın diliyle basıyor.
- Tutarsızlık: **yok** — description ↔ `costs.ts:46` ↔ mdx üçünde de 40 kredi; `MAX_SEEDS`/`MAX_SEED_CHARS`/
  `depth` aralıkları şema, description ve mdx'te aynı sayılarla; `verify.sh:40` `gen-tool-docs.mjs --check`
  drift'i zaten kapıda tutuyor.
- Seçilebilirlik: "bana yeni kelime bul / bu domain hangi kelimelerde geçer / şu kelimeye benzer sorgular"
  → `discover_keywords`. `research_keywords`'le karışma riski DÜŞÜK: her iki description da ayrımı
  kendisi söylüyor. **Gerçek seçilebilirlik riski tool İÇİNDE:** dört mod bir LLM'in tek seferde doğru
  seçmesi gereken bir ayrım ve `mode`'un DEFAULT'u yok — bu doğru karar (yanlış modu sessizce
  koşmaktansa reddetmek), ama `ideas` ile `suggestions` arasındaki fark ("kategori komşusu" vs "tohumu
  İÇEREN daha uzun sorgu") kullanıcı cümlesinden çoğu zaman okunamaz; §4'te ölçülen gürültü tam da
  yanlış modun seçilmesiyle aynı sonucu verir.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Log dizini
`/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/ed07ad51-99ee-4158-ba60-03e288098193/scratchpad/dilim4/logs/`.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M6 | `discover-keywords.ts:1126` — meta'dan `projectId: project?.id` silindi (NEVER #4 / kapsam ekseni) | `discovery-project-scope.pin.test.ts` + `handler-charge-scope-coverage.pin.test.ts` | **KIRMIZI** (2 failed / 4014 passed) | `m6.log`: *"reserves against the project the call named"* ve *"names a project at every call site that has one to name"* |
| M7 | `dfs/discover-keywords.ts` `toRow()` — `search_volume: info?.search_volume ?? null` → `null` (vendor alanı düşürme) | `dfs/discover-keywords.test.ts` + `tools/discover-keywords.test.ts` | **KIRMIZI** (4 failed) | `m7.log`: *"reads the wrapped mode's fields from keyword_data and the flat modes' from the item"*, *"prints every metric under its own vendor field name, unmerged"* |
| M8 | `dfs/discover-keywords.ts:284` — `DISCOVER_REQUESTS_PER_LOOKUP` 1 → 2 (imzalı fiyat marjı) | `dfs/discover-keywords.test.ts` + `credits/free-vendor-calls.pin.test.ts` | **KIRMIZI** (6 failed) | `m8.log`: *"really makes exactly ONE request per lookup — the number the margin rests on"*. **Kaynaktaki "bu sabit oynarsa test KIRMIZI olur" iddiası hipotez değildi — ölçüldü ve doğru çıktı** |
| M9 | `dfs/discover-keywords.ts:215` — `DEFAULT_NOISY_MODE_MAX_VOLUME` 100.000 → 50.000 (tavan/kesilme cümlesi ekseni) | `dfs/discover-keywords.test.ts` + `tools/discover-keywords.test.ts` | **KIRMIZI** (3 failed) | `m9.log`: *"reads the ceiling off ONE named constant, never a sprinkled literal"* — tavan hem sabit hem BASILAN cümle olarak pinli |
| M10 | `dfs/discover-keywords.ts:117` — `DISCOVER_ENDPOINTS`'te `ideas` ↔ `suggestions` uçları takas edildi (yanlış ücretli uca gitme) | `dfs/discover-keywords.test.ts` + `tools/discover-keywords.test.ts` | **KIRMIZI** (4 failed) | `m10.log`: *"sends each mode to ITS OWN endpoint"*, *"names the vendor function from the endpoint the money is spent at"* |

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

Defterde bu blok boyunca **hiç satır oluşmadı**.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N5 MAX_SEEDS üstü | `mode:"ideas"`, 201 tohum | 200 / `isError:true` | 0 | `✖ Too big: expected array to have <=200 items → at seeds` |
| N6 geçersiz depth | `mode:"related"`, `depth:9` | 200 / `isError:true` | 0 | `✖ Too big: expected number to be <=4 → at depth` |
| N7 bozuk uuid | `project_id:"1111-2222-3333-4444-…"` (v4 değil) | 200 / `isError:true` | 0 | `✖ Invalid UUID` — şema katmanında, DB'ye hiç gitmeden |
| N7b **uydurma ama geçerli v4 uuid** | `mode:"for_site"`, `project_id:"11111111-2222-4333-8444-555555555555"` | 200 / `isError:true` | 0 | *"No project found with id … Run list_projects to see your projects…"* — **kiracı sızıntısı YOK**: `project-target.ts:42` "var ama senin değil" ile "hiç yok" durumlarını AYIRT ETMİYOR (`selectOwnById` `.eq("user_id", …)`), yani numaralandırma kehaneti yok |
| N8 yabancı mod alanı | `mode:"for_site"` + `seed` | 200 / `isError:true` | 0 | Uzun ve öğretici ret: *"…so it does not take \"seed\". A field belonging to another mode is refused rather than ignored: ignoring it would run a different lookup than the one you asked for, and bill you for it."* |
| N9 min>max | `min_volume:5000`, `max_volume:100` | 200 / `isError:true` | 0 | *"…no keyword could satisfy both and DataForSEO would return an empty list for the full price. Refused before anything was charged…"* — 40 kredilik boş küme kapısı CANLIDA doğrulandı |
| N10 bilinmeyen alan | `foo:1` | 200 / `isError:true` | 0 | `✖ Unrecognized key: "foo"` |
| N11 limit tavanı | `limit:1001` | 200 / `isError:true` | 0 | `✖ Too big: expected number to be <=1000` — imzalı fiyat tavanı |
| N12 iki özne birden | `target` + `project_id` | 200 / `isError:true` | 0 | *"Pass \"project_id\" or \"target\", not both…"* |
| N13 hiç özne yok | `mode:"for_site"` yalnız | 200 / `isError:true` | 0 | *"Nothing to look up: pass \"project_id\" … or \"target\"…"* |
| N14 tohum 201 karakter | `mode:"suggestions"`, 201 karakterlik seed | 200 / `isError:true` | 0 | `✖ Too big: expected string to have <=200 characters` |

Vendor'ın reddedeceği yer/dil kombinasyonu **ŞEMADA yakalanmıyor**: `location_code` yalnız
`z.number().int().positive()`, `language_code` yalnız `z.string().min(2)`. Geçersiz bir kombinasyon
vendor'a gider; orada task `status_code != 20000` dönerse `unwrapFirstResult` THROW eder ve
`withCredits` release eder (müşteri ücretsiz), ama **DFS bütçesinden rezervasyon açık kalır**
(`budget.ts`: hata anında rezervasyon tahmin değerinde açık bırakılır — kasıtlı, muhafazakâr yön).
Bu yol canlıda TETİKLENMEDİ (ücretli tavan) — ÖLÇÜLEMEDİ olarak kayda geçer.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti |
|---|---|---|---|---|
| P3 `ideas`, varsayılan limit | `mode:"ideas"`, `seeds:["reklam ajansı","dijital pazarlama"]`, `tr`/`2792` | 200 / `isError:null` | **−40**, defter: `-40 · charge · discover_keywords · no project scope`, refund YOK | 30.261 karakter, **100 satır** (kesilme YOK — varsayılan pencere bütçenin altında). Pencere altyazısı: *"100 keywords in this window (offset 0, limit 100). DataForSEO counts 1,282,842 keywords matching this lookup in total — this window is a slice of that set, not a count of it"*. Filtre satırı vendor grameriyle: `[["keyword_info.search_volume","<=",100000]]`. Tavan cümlesi: *"A DEFAULT search-volume ceiling of 100,000 was applied…"* |
| P4 `ideas`, `limit:20` | P3 + `limit:20` | 200 / `isError:null` | **−40** (aynı düz fiyat), refund YOK | 8.468 karakter, **20 satır**; altyazı *"20 keywords in this window (offset 0, limit 20)"* — limit'i ADIYLA söylüyor; whole-set sayısı yine 1.282.842 (satır sayısından TÜRETİLMİYOR); ilk 20 satır P3'ün ilk 20'siyle birebir aynı (determinizm) |

**Ölçülen en zararlı gerçek (P3):** 100 satırın **100'ü** konu dışıydı — `e-okul öğrenci girişi`,
`kreatin nedir`, `nöbetçi eczane ankara`, `türkiye kosova maçı`, `e devlet mhrs`, `hemşirelik taban
puanları` … Bir reklam ajansı/dijital pazarlama tohumundan gelen sonuçların **hiçbiri** konuyla ilgili
değildi. Ve hacim dağılımı: **max 90.500, min 49.500** — yani **tüm gürültü, 100.000'lik varsayılan
tavanın ALTINDA kaldı**; tavan tek bir satır bile düşürmedi. Dahası 100 satır yalnız **4 ayrı hacim
değeri** taşıyor (90.500 ×18 · 74.000 ×21 · 60.500 ×24 · 49.500 ×37) — Keyword Planner yuvarlamasının
doğrudan gözlemi.

Bu, `dfs/discover-keywords.ts:196-206`'daki gerekçeyi doğrudan yalanlıyor. Kaynak diyor ki tavan
*"chosen so that it sits above what a single site could plausibly own and below the national-utility
class the walkthrough found"*. Ölçüldü 2026-09-03: bu pazarda ulusal-kamu sınıfı **49.500–90.500**
bandında oturuyor, yani tavanın ALTINDA. Kaynak dürüst davranıp bu sayının ölçülmüş bir eşik
OLMADIĞINI zaten yazmıştı (ders 11 disiplini) — ama sayının YÖNÜ değil, DEĞERİ karşılıksız çıktı.

**İDDİA DARALTMASI (hakem H-4, 2026-09-03) — yukarıdaki "gerekçeyi doğrudan yalanlıyor" çerçevesi
FAZLA GENİŞ.** Kaynak bloğu (`dfs/discover-keywords.ts:190-213`) ölçümün bulduğu iki şeyi ZATEN
yazıyor. Birebir: *"this number is NOT a measured relevance threshold and is not presented as one"*
ve *"WHAT IT DOES NOT DO, stated because the same walkthrough measured it: it cannot remove an
off-topic keyword of ORDINARY volume, which is exactly what `ideas` returned. A volume bound is a
proxy for relevance and a partial one; the surface's warning, not this number, is what carries the
honesty there."* Yani bu turun ölçtüğü "100 satırın 100'ü konu dışı" sonucu kaynağın kendi
şerhinin İÇİNDEDİR ve onu yalanlamaz. Bugünkü ölçümün yalanladığı **tek** ifade, aynı bloğun
*"below the national-utility class the walkthrough found"* şartıdır: ölçülen ulusal-kamu sınıfı
49.500–90.500 bandında, yani 100.000'in ALTINDA oturuyor. Kaynağın "yön" (üst sınır) iddiası
ölçülmedi ve bu tur onu ne doğruladı ne yalanladı.

Yan ölçümler:
- Uyarı bloğu basıldı ve doğruydu; müşteri yanıltılmıyor, yalnız 40 kredi karşılığında kullanılabilir
  satır almıyor.
- Intent değerleri: `navigational`, `informational`, `transactional` (+ foreign olarak üçü de) — R-8.8'in
  dört değerinin içinde; beşinci bir değer görülmedi.
- `cpc not reported by DataForSEO` satırları var — vendor'ın raporlamadığı alan **0 yazılmıyor**,
  sözle "unreported" deniyor (mdx'in iddiası canlıda doğrulandı).
- Kapanış paragrafı NEVER #7 disiplinini basıyor: *"SeoGrep adds no score of its own, ranks nothing by a
  formula of its own, and calls no keyword easy or worth targeting…"*

Ham kayıt (anahtar redakte, repo dışı):
`/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/ed07ad51-99ee-4158-ba60-03e288098193/scratchpad/dilim4/canli/raw.jsonl`

DFS reddi: **YOK** — "daily cap" mesajı hiçbir çağrıda görülmedi.
Ölçülemeyen modlar: `suggestions`, `related`, `for_site` — ücretli tavan (tool başına 2 çağrı) doldu.

**ÖLÇÜLMEDİ — `for_site` lokal varsayılanı (hakem H-3 sınıfı, 2026-09-03).** Bu tur `for_site` modunu
hiç koşmadı, dolayısıyla bu kaydın onun hakkında ölçülmüş hiçbir iddiası yok. Kayda geçirilen tek
şey, modun ŞEKLİ: `for_site` bir `target`/`project_id` alıyor ve `language_code` "en" /
`location_code` 2840 varsayılanlarını diğer modlarla paylaşıyor (§1 şema) — yani **lokal-varsayılan
sınıfının ölçülmemiş dördüncü üyesi**. Sınıfın ölçülmüş üyeleri: `my_pages` A-2 (P1, iki ücretli
çağrının ikisi de en/2840'ta 1 satır, 2 × 40 kredi zarar ÖLÇÜLDÜ) · `keyword_gap` G-3 (P2, proje
çözülse bile locale projeden türemiyor) · `ranked_keywords` (ağaçta `twoLetterTld` + `localeHint`
azaltıcısını taşıyan TEK tool). Bu satır bir bulgu DEĞİL, bir ölçülmemişlik kaydıdır — "geçti"
diye sayılmamalıdır (bkz. `_DILIM4-HAKEM-SINIFLAR.md` sınıf 4).

## 5. SEO güncelliği

Referans "Tool eşleme" satırı: `discover_keywords | R-8.8, R-8.9 | Intent taksonomisinin 4 değerden
farklı varsayılması; 1.000 keyword/istek sınırı`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-8.8 (4 değerli intent taksonomisi; ≤1.000 kw/istek; 38 dil) | `dfs/discover-keywords.ts` `keywordDataSchema.search_intent_info`: `main_intent: z.string().nullish()`, `foreign_intent: z.array(z.string()).nullish()` — **enum YOK, 4 değer VARSAYILMIYOR**; `MAX_DISCOVER_ROWS = 1000` ve `MAX_SEEDS = 200` ikisi de vendor tavanının içinde | **UYUYOR** | Riskin iki yarısı da karşılıksız: taksonomi bir stringe geçiliyor (beşinci değer gelse basılır, kırılmaz) ve hiçbir istek 1.000'i aşamıyor (`clampRows` + şema `.max(1000)`, canlıda N11 ile doğrulandı). Intent OLASILIKLARI (`*_probability`) okunmuyor — R-8.8 bunu zorunlu tutmuyor |
| R-8.9 (12 aylık ortalama · yakın varyantlar · **yuvarlanmış** · tarihsel yalnız exact match) | Her satır `search_volume 90,500` basıyor; `grep -rniE "12.month\|rounded\|close variant\|exact match"` tool + adaptör + mdx üzerinde **0 eşleşme** | **AYKIRI** | `research_keywords` ile aynı boşluk (RK-1), ayrıca burada ikinci ve daha sert bir yüzü var: rows *"in DataForSEO's own order, by keyword_info.search_volume, highest first"* diye satılıyor, ama yuvarlama yüzünden **P3'ün 100 satırı yalnız 4 ayrı hacim değeri taşıyor** — 90.500 ×18, 74.000 ×21, 60.500 ×24, 49.500 ×37 (ölçüldü). Yani "highest first" sıralamanın 100 satırın 96'sında hiçbir ayırt ediciliği yok; sıra dört kovanın İÇİNDE keyfî. Ürün sıralamayı vendor'a atfederken sıranın anlamsızlaştığı yeri söylemiyor. **H-1 (hakem turu, 2026-09-03):** aynı R-8.9 kalemi bu dilimde dört kayıtta ölçüldü (`research_keywords` RK-1 · bu kaydın DK-2'si · `keyword_gap` G-1 · `ranked_keywords` B-3) ve üç farklı şiddetle yazılmıştı. Tek bant: **çıplak açıklama boşluğu P2, ölçülmüş iddia hatası P1.** DK-2 bandın P1 tarafında kalır (aşağıda gerekçe) |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:22` → `discover_keywords: "list",`. `CARDED_TOOLS` (satır 62) yalnız
`get_credit_balance` içerdiği için bu tool bugün kart ÇİZMİYOR. Canlı payload bir `list` kartının
isteyeceği alanları taşıyor mu: **kısmen** — `structuredContent` YOK, yalnız `content[].text`; satırlar
iki-satırlık düzenli bir blok (`• <keyword>` + `field value · field value`) olduğu için ayrıştırılabilir
ama kart, pencere altyazısını (`offset`/`limit`/`vendor_total_count`) ve tavan cümlesini de taşımak
zorunda — bunlar bugün yalnız düz metinde var.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` girişi: **EXCLUDED** (satır 126), gerekçe birebir:
  `"paid, 40 credits/call and a DataForSEO Labs request. Needs an operator budget signature (NEVER #6)."`
  **Bu gerekçe BAYAT** — 2026-09-02 operatör kararı ("kredi sınırımız yok") ve bu turun kendisi
  (bugün iki ücretli çağrı imzalı tavanla koşuldu) gerekçenin dayanağını kaldırdı. Ders 16 sınıfı:
  kapanmış bir kalemin gerekçesi indekste duruyor.
- `goals/` hedefi gerekli mi: **HAYIR** — `dfs-budget-guard.md` vendor tavanını, `ledger-integrity.md`
  krediyi zaten hedefliyor. Tavan-değeri bulgusu (DK-1) bir ÜRÜN kararıdır, predicate'i yoktur.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, YYYY-MM-DD) |
|---|---|---|---|---|---|
| DK-1 | **P1** | `ideas` modunun varsayılan 100.000'lik hacim tavanı, korumak için konduğu gürültü sınıfının **ÜSTÜNDE**: canlı ölçümde 100 satırın 100'ü konu dışıydı ve hepsi 49.500–90.500 bandındaydı — tavan tek satır düşürmedi. Müşteri 40 krediye 0 kullanılabilir satır aldı | §4 P3; `dfs/discover-keywords.ts:196-206` iddiası (*"below the national-utility class the walkthrough found"*) bu pazarda ölçülerek yalanlandı. **İDDİA DARALTMASI (hakem H-4, 2026-09-03):** yalanlanan **yalnız** bu şarttır. Aynı blok (`:190-213`) sayının ölçülmüş bir eşik olmadığını (*"this number is NOT a measured relevance threshold and is not presented as one"*) ve konu-dışı SIRADAN hacimli kelimeyi eleyemediğini (*"it cannot remove an off-topic keyword of ORDINARY volume, which is exactly what `ideas` returned"*) ZATEN yazıyor — "kaynağın gerekçesini doğrudan yalanlıyor" çerçevesi bu yüzden fazla genişti; kaynağın YÖN (üst sınır) iddiası ölçülmedi | Ya tavanı ölçülmüş bir bandın altına indirmek (operatör imzası — tavan fiyat kontrolü DEĞİL, kaynak bunu söylüyor), ya `ideas` için tavanı bırakıp uyarıyı sertleştirmek, ya da kaynaktaki "ulusal sınıfın altında" gerekçesini ÖLÇÜMLE değiştirmek. En azından kaynak yorumu bugünkü ölçümle güncellenmeli (ders 16) | |
| DK-2 | **P1 KALDI** (hakem turu, 2026-09-03) | **R-8.9 AYKIRI:** hacim değerlerinin yuvarlanmış, yakın varyantlar dahil, 12 aylık ortalama olduğu hiçbir yüzeyde söylenmiyor — ve tool sıralamayı *"by keyword_info.search_volume, highest first"* diye satarken yuvarlama yüzünden **100 satır yalnız 4 ayrı değer taşıyor** (90.500 ×18 · 74.000 ×21 · 60.500 ×24 · 49.500 ×37), yani sıralama satırların %96'sında ayırt edici değil | `grep -rniE "12.month\|rounded\|close variant\|exact match"` → `discover-keywords.ts`, `dfs/discover-keywords.ts`, `discover-keywords.mdx` üzerinde 0 eşleşme; §4 P3 hacim dağılımı (ölçüldü 2026-09-03) | Kriter bloğuna tek cümle: hacimlerin yuvarlanmış vendor değerleri olduğu ve eşit değerli satırlar arasındaki sıranın anlam taşımadığı. `research_keywords` RK-1 ile TEK bir metin kalemi olarak imzalanabilir. **Hakem gerekçesi (2026-09-03) — P1 neden KALIYOR:** kalemin ikinci yarısı çıplak bir açıklama boşluğu değil, ÖLÇÜLMÜŞ bir iddia hatasıdır — tool sıralamayı *"by keyword_info.search_volume, highest first"* diye satıyor, oysa 100 satırın 96'sında sıra ayırt edici değil (dört kova ölçüldü: 90.500 ×18 · 74.000 ×21 · 60.500 ×24 · 49.500 ×37). Bant kuralı (H-1): bare disclosure P2, ölçülmüş iddia hatası P1 | |
| DK-3 | P2 | Vendor'ın reddedeceği `location_code`/`language_code` kombinasyonu şemada yakalanmıyor; vendor reddi müşteriye ücretsiz döner ama **DFS bütçe rezervasyonu tahmin değerinde AÇIK kalır** — paylaşılan $3 günlük tavandan düşer | `discover-keywords.ts` şema (`location_code: z.number().int().positive()`); `dfs/budget.ts` — hata yolunda rezervasyon kasıtlı olarak açık bırakılıyor | Ölçüm turu bu yolu tetiklemedi (ÖLÇÜLEMEDİ). Öneri: geçerli location/language listesinin bir kez çekilip pinlenmesi ya da en azından bu yolun bilinen sınırlama olarak dokümante edilmesi. **ÇAPRAZ ATIF (şef gözlemi Ş-3, hakem turu 2026-09-03): kardeş vaka `my_pages`'te PROD'DA doğrulandı** — bu kaydın "rezervasyon açık kalır" iddiası artık kod okumasından çıkan bir hipotez değil: Supabase `public.dfs_spend`, spend_day 2026-09-03, `relevant_pages/live · status=open · estimated 0.036 · actual null` satırı 19:31'de açıldı ve ~20:15'te hâlâ `open`; günlük tavana TAHMİNİYLE sayılıyor (`dfs_spend_today_usd` = 0,245920 bu satırı içeriyor). Ayrıntı `my_pages` A-3. Bu tool'un KENDİ yolu (geçersiz locale) yine de ölçülmedi — açık kalır | |
| DK-4 | P2 | `plan.mjs` EXCLUDED gerekçesi bayat: *"Needs an operator budget signature (NEVER #6)"* — imza 2026-09-02'de geldi ve bu tur tool'u ücretli koştu | `scripts/testing/plan.mjs:126` | Gerekçeyi güncellemek ya da tool'u PLAN'a dar bir hücreyle (tek site, `limit:1`) almak. `my_pages` satırı (127) aynı bayat gerekçeyi taşıyor — komşu dilime not | |
| DK-5 | P2 | `dfs_spend.actual_usd` vendor'ın `cost`'u ile bizim tahminimizi ayırt etmiyor (`extractDiscoverCostUsd(raw) ?? estimate`), şemada kaynak kolonu yok | `dfs/discover-keywords.ts` `createLiveDiscoverKeywordsClient` settle adımı; `0014_dfs_spend_budget.sql:28-37` | `research_keywords` RK-6 ile AYNI bulgu, aynı düzeltme (kaynak kolonu). Tek kalem olarak ele alınmalı | |
| DK-6 | P2 | Dört mod arasındaki seçim tamamen LLM'e bırakılmış ve `mode`'un default'u yok (doğru karar), ama `ideas` ile `suggestions` farkı kullanıcı cümlesinden çoğu zaman okunamaz; yanlış mod seçimi §4'teki gürültüyle aynı sonucu verir ve 40 krediye mal olur | Description ve `MODE_INPUT_RULES` mod ayrımını doğru anlatıyor; ölçülen sonuç (P3) modun kendisinin zayıf olduğunu gösteriyor | `ideas`'ın description'ına "if your seeds are a service/agency category, prefer suggestions/related" benzeri bir yönlendirme; ya da `ideas`'ı varsayılan olarak `suggestions`'a yönlendiren bir cümle. Metin kalemi, kod değil | |
| DK-7 | P2 | Tool `structuredContent` döndürmüyor; `card-map.ts:22` `"list"` eşlemesi var ama kart pencere altyazısını ve tavan cümlesini düz metinden geri-ayrıştırmak zorunda kalır | Canlı envelope: yalnız `content[].text` | `research_keywords` RK-7 ile aynı sınıf; kart dilimi bu aileye geldiğinde iş emrine yazılsın | |
