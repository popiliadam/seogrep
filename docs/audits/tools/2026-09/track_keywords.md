# `track_keywords` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 · İşçi: Opus 4.8 (yonlendirme) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | Handler `apps/mcp/src/tools/track-keywords.ts:223`, depo `tracked-keywords-store.ts`; canlı `tools/list` description + şeması kaynakla BİREBİR (drift yok) |
| 2 Mutasyon | ÖLÇÜLDÜ — 3 mutasyon, 2 KIRMIZI / **1 YEŞİL KALDI** | M7 (`untrackKeywords`'ten `.is("untracked_at", null)` filtresi silindi) 143/143 dosya, 3680/3680 test yeşil kaldı |
| 3 Canlı negatif | ÖLÇÜLDÜ — 14 senaryo | boş liste · boş string · yalnız-boşluk · 1 karakter · 500 kelime · 101 kelime · bilinmeyen/arşivli/bozuk proje · geçersiz device/action/dil/lokasyon; hepsi kredi Δ=0 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ — 7 adımlı tam yaşam döngüsü | track → tekrar track (idempotence + normalizasyon + dedup) → untrack → tekrar untrack → hiç-izlenmemişi untrack → yeniden track (revive) → son untrack |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-6.5 UYUYOR (tool hiçbir motora sorgu atmıyor, bunu cevabında söylüyor) · R-8.8 İLGİSİZ · R-8.9 İLGİSİZ (tool hacim döndürmüyor) — referans eşlemesinin bu tool için öngördüğü bayatlama riski **karşılıksız** |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:50` `track_keywords: "action"` (PLANLI); `CARDED_TOOLS` yalnız `get_credit_balance` — canlı envelope'ta `structuredContent` YOK, tutarlı |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi **YOK** ve `EXCLUDED`'da da yok (P1) · `goals/` hedefi EVET |

**Karar:** **DÜZELTME GEREKLİ** — kayıt/arşiv semantiği canlıda yedi adımda kusursuz çalışıyor ve tek bir bayat SEO iddiası yok; fakat (a) "iki kez untrack tarihi bozmaz" garantisi Docker'sız hiçbir kapıda korunmuyor, (b) tool `plan.mjs` kapsam iddiasının dışında, (c) MCP yüzeyinde izlenen kelimeleri OKUMA yolu yok.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/track-keywords.ts:216-291` (`makeTrackKeywordsTool`, `name` satırı `:223`).
  Depo katmanı: `apps/mcp/src/tools/tracked-keywords-store.ts` (normalizasyon `:84`, üst sınır `:60`, upsert `:178`, arşiv damgası `:205`).
  Lokasyon kontrolü: `../dfs/locations.ts` → `checkLocationName` (saf string kontrolü, ağ yok).
- Zod şeması (alanlar, kısıtlar):
  - `project_id`: `z.uuid()` — **zorunlu**
  - `keywords`: `z.array(z.string().min(1)).min(1).max(100)` — **zorunlu**; canlı JSON Schema `minItems:1, maxItems:100, items.minLength:1`
  - `action`: `z.enum(["track","untrack"]).default("track")`
  - `location_name`: `z.string().min(1).default("United States")`
  - `language_code`: `z.string().min(2).default("en")`
  - `device`: `z.enum(["desktop","mobile"]).default("desktop")`
  - `additionalProperties` kısıtı YOK
- Description (birebir alıntı, canlı `tools/list` = kaynak `DESCRIPTION`, `track-keywords.ts:129-133`):
  > "Choose which keywords a project's ranking is watched for, on one location, language and device. Registration only: it takes no measurement and contacts no search engine. Running it twice for the same keyword is safe, and untracking archives rather than deletes. Costs 0 credits."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:153`, birebir): `  track_keywords: 0,`
  Aynı bloktaki gerekçe (`costs.ts:150-152`, birebir): `  // track_keywords = 0 (row #3). Registration only: it records which keywords a project wants` / `  // watched and takes no measurement at all, so there is no vendor cost and nothing to price. It` / `  // joins the three 0-credit Search Console tools above on exactly that ground.`
- Docs sayfası: `apps/web/content/docs/tools-reference/track-keywords.mdx`.
  Kredi cümlesi birebir: `**Cost:** Free (0 credits).`
  Üst sınır cümlesi birebir:
  > "A project may track up to **100** keywords at once (counting each location and device separately). The limit is about what measuring the whole set costs and how much of it can be measured in a day — not about storage of the list itself, which is free."
  Arşiv cümlesi birebir:
  > "`action: \"untrack\"` archives the keyword rather than deleting it. Every position already measured for it stays exactly where it is and [`keyword_positions`](/docs/tools-reference/keyword-positions) still reads it. Tracking it again brings back the same record, including the date you first started watching it — and untracking something twice does not change that date either."
- Tutarsızlıklar: **yok** — karşılaştırılanlar: (1) canlı `tools/list` description'ı ↔ kaynak `DESCRIPTION` (bayt bayt aynı), (2) canlı `inputSchema` (6 alan, default'lar, enum'lar, min/max) ↔ `track-keywords.ts:74-125` zod şeması (tam örtüşme), (3) docs "100" ↔ `MAX_TRACKED_KEYWORDS_PER_PROJECT = 100` (`tracked-keywords-store.ts:60`), (4) docs "Free (0 credits)" ↔ `TOOL_COSTS.track_keywords = 0`, (5) docs'un "untracking twice does not change that date" cümlesi ↔ `untrackKeywords`'ün `.is("untracked_at", null)` filtresi (`:216`) ↔ canlı H4 cevabı — üçü de aynı şeyi söylüyor.
- Seçilebilirlik: LLM bu tool'u "şu kelimeler için sıralamamı takip et / bu kelimeleri izlemeye al" cümlelerinde seçer.
  **Karışacağı komşular, üç ayrı eksen:**
  1. **`track_gsc_property`** — ad öneki aynı (`track_`), ikisi de 0 kredi, ikisi de "kaydet" fiili. Bir istemci "track my site" cümlesinde ikisi arasında kalır. Ayrım yalnız description'da.
  2. **`keyword_positions` / `serp_snapshot`** — kullanıcının "takip et" derken kastettiği çoğu zaman ÖLÇÜM'dür. Bu tool ölçüm yapmaz ve bunu hem description'da hem her cevabın sonunda söyler (`NO_MEASUREMENT_NOTE`). **Bu iyi bir tasarım kararı ve canlıda doğrulandı.**
  3. **`research_keywords` / `discover_keywords`** — "hangi kelimeleri izlemeliyim" sorusu onlara, "şunları izle" bu tool'a gider. Description bu ayrımı açıkça yazmıyor ama "Choose which keywords…" ifadesi doğru yöne itiyor.
  **Ölçülmüş asıl seçilebilirlik riski:** kullanıcı "izlemeye aldım" dedikten sonra hiçbir şey o kelimeyi ÖLÇMÜYOR — `tracked_keywords` tablosunu MCP yüzeyinde okuyan/kullanan tek bir tool yok (bulgu F-3).

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test` — 143 dosya / 3680 test. Taban: exit 0 (workspace paketleri derlendikten sonra; bkz. `whats_next.md` F-10).
`*.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M5 | `tracked-keywords-store.ts:85` — `normalizeTrackedKeyword`'ten `.toLowerCase()` silindi | normalizasyon + dedup testleri | **KIRMIZI** | 3 test: "trims, collapses internal whitespace and folds case" · "folds duplicates, drops blanks and keeps the caller's order" · "passes the FULL identity to storage" |
| M6 | `track-keywords.ts:271` — üst sınır `created+revived` yerine `created+revived+unchanged` ile ölçülüyor (yani zaten izlenen kelime de "eklenen" sayılıyor) | üst sınır testi | **KIRMIZI** | 1 test: "the per-project cap > does NOT refuse a call at the cap that adds nothing new" — yorumdaki "re-running the same call at the cap must succeed" özelliği gerçekten pinli |
| **M7** | `tracked-keywords-store.ts:216` — `untrackKeywords`'ten `.is("untracked_at", null)` filtresi silindi (ikinci `untrack` arşiv damgasını YENİDEN yazar) | — | **YEŞİL KALDI** | mcp 143/143 dosya · 3680/3680 test · exit 0 |

**M7'nin anlamı (ders 12).** Birim şeridi `untrackKeywords`'ü PORT olarak enjekte ediyor (`TrackKeywordsDeps.untrack`), yani birim testinde gerçek sorgu hiç koşmuyor — test double, gerçek çalışma zamanından hoşgörülü. Sonuç: **description'da, docs sayfasında ve canlı cevapta ÜÇ AYRI YERDE söz verilen** "untracking something twice does not change that date either" garantisi, Docker'sız hiçbir kapı tarafından ölçülmüyor.
Tek koruma `apps/mcp/src/tools/track-keywords.db.test.ts:245` — `it("(g) untracking twice does not re-date the archive stamp")`, satır `:252` yorumu: `// The second call matches nothing at all — untracked_at is null is part of the filter.` — ve o şerit `make verify` kapsamında DEĞİL (CLAUDE.md komut tablosu: "DB şeritleri YOK").
Ayrıca M7 canlı cevabı da ÇELİŞİK hâle getirirdi: `classify` hâlâ `known` satırlarından "already archived" listesini üretir, `stamped` ise artık o satırları da içerir — cevap aynı anda `Stopped tracking 2 keywords` VE `Already untracked, so their dates were left as they were` derdi. Yeşil bir süit, kendi kullanıcı metnini yalanlayan bir davranışı geçiriyor.

Çalışma ağacı sonunda temiz: `git status --short` → **boş çıktı**; `git diff --stat` → **boş çıktı**. `tracked-keywords-store.ts` ve `track-keywords.ts` `diff` ile orijinal kopyalarına karşı bayt-özdeş ("ALL FOUR IDENTICAL"). Revert sonrası mcp 143/143 · 3680/3680 · exit 0.

## 3. Canlı negatif yol

Kredi bakiyesi ölçüm boyunca **4519 → 4519**. Hedef proje: adstark.com.tr (`list_projects`'ten alındı).

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 boş liste | `keywords: []` | 200, `isError:true` | 0 | `✖ Too small: expected array to have >=1 items → at keywords` |
| N2 boş string | `keywords: [""]` | 200, `isError:true` | 0 | `✖ Too small: expected string to have >=1 characters → at keywords[0]` |
| N3 yalnız boşluk | `keywords: ["   "]`, `Turkiye`/`tr` | 200, `isError:true` | 0 | Zod GEÇİYOR (3 karakter), sonra iş kuralı kesiyor: `Nothing was changed: every keyword in the list was blank once trimmed, so there is nothing to track. Pass the keywords you want watched, one per list entry.` |
| N4 **1 karakterlik kelime** | `keywords: ["a"]`, `location_name: "Türkiye"` | 200, `isError:true` | 0 | **Şema 1 karakteri KABUL ediyor** (`minLength:1`), normalizasyon da düşürmüyor; çağrı ancak lokasyon adında kesiliyor: `Nothing was tracked: DataForSEO does not know a location called "Türkiye". Its own name for that place is "Turkiye" — pass that instead. … This was refused before any search was run.` Yani **tek harflik bir kelime izlemeye alınabilir** — üst sınıra sayar, ileride ölçüldüğünde satıcıya para harcatır. Yazma yapılmadan ölçülebilmesi için lokasyon reddi kasten aynı çağrıya eklendi |
| N5 **500 kelime** | `keywords: [500 öğe]` | 200, `isError:true` | 0 | `✖ Too big: expected array to have <=100 items → at keywords` — **üst sınır 100** ve şema seviyesinde, DB'ye inmeden |
| N6 101 kelime (sınır+1) | `keywords: [101 öğe]` | 200, `isError:true` | 0 | Aynı mesaj — sınır tam 100'de |
| N7 tekrar eden kelime | `["  ADSTARK  ","Dijital  Reklam   Yönetimi","adstark"]` | 200, başarı | 0 | 3 öğe → **2 kelime**; cevap `Tracking 2 keywords … Already tracked, unchanged: "adstark", "dijital reklam yönetimi".` Kırpma + iç boşluk daraltma + küçük harfe indirme + dedup canlıda tek çağrıda doğrulandı |
| N8 bilinmeyen proje | `project_id: 00000000-0000-4000-8000-000000000000` | 200, **`isError:true`** | 0 | `No project found with id … Run list_projects to see your projects, or create one with setup_project. You were not charged.` |
| N9 arşivli proje | canlı arşiv listesinden `4f3eb00a-…` | 200, **`isError:true`** | 0 | `That project is archived, so it is not being tracked right now. Restore it with setup_project…` |
| N10 bozuk uuid | `project_id: "not-a-uuid"` | 200, `isError:true` | 0 | `✖ Invalid UUID → at project_id` |
| N11 geçersiz device | `device: "tablet"` | 200, `isError:true` | 0 | `✖ Invalid option: expected one of "desktop"\|"mobile" → at device` |
| N12 kısa dil kodu | `language_code: "t"` | 200, `isError:true` | 0 | `✖ Too small: expected string to have >=2 characters → at language_code` |
| N13 boş lokasyon | `location_name: ""` | 200, `isError:true` | 0 | `✖ Too small: expected string to have >=1 characters → at location_name` |
| N14 geçersiz action | `action: "delete"` | 200, `isError:true` | 0 | `✖ Invalid option: expected one of "track"\|"untrack" → at action` — **silme yolu şemada yok**; tek geri alma "untrack" (arşiv) |
| N15 `project_id` yok | `{keywords:["adstark"]}` | 200, `isError:true` | 0 | `✖ Invalid input: expected string, received undefined → at project_id` |

**Üst sınır (`capRefusal`) reddi ÖLÇÜLEMEDİ** — hesabın adstark projesi 100 sınırının çok altında ve sınıra dayanmak için 100 kalıcı kayıt yazmak gerekirdi (iş emri 2 kelimeyle sınırlı). Metin `track-keywords.ts:159-168`'te okundu, birim testi M6 ile kırmızıya döndüğü doğrulandı.

## 4. Canlı mutlu yol

Kimlik: proje = adstark.com.tr (`e2785bf7-…`, `list_projects`'ten), `location_name: "Turkiye"`, `language_code: "tr"`, `device: "desktop"`.
Kelimeler markadan ve sitenin kendi kategori sluglarından seçildi: `adstark` (marka) ve `dijital reklam yönetimi` (sitenin `/ketegori/dijital-reklam-yonetimi/` kategorisi, `docs/testing/2026-08-09-faz-c-rakip-paritesi.md:125`'te kayıtlı gerçek crawl çıktısından).

| senaryo | argüman | envelope | kredi Δ | çıktı özeti |
|---|---|---|---|---|
| H1 yeni kayıt | `keywords:["adstark","dijital reklam yönetimi"]` | 200, başarı | 0 | `Tracking 2 keywords for "adstark.com.tr" — Turkiye · language tr · desktop SERP.` / `Newly tracked: "adstark", "dijital reklam yönetimi".` + `NO_MEASUREMENT_NOTE` |
| H2 idempotence + normalizasyon + dedup | `["  ADSTARK  ","Dijital  Reklam   Yönetimi","adstark"]` | 200, başarı | 0 | `Already tracked, unchanged: "adstark", "dijital reklam yönetimi".` — 3 öğe → 2 kelime, yeni satır yok |
| H3 kaldırma | `action:"untrack"`, aynı 2 kelime | 200, başarı | 0 | `Stopped tracking 2 keywords … : "adstark", "dijital reklam yönetimi".` + `Untracking archives the keyword — every position already measured for it is kept…` |
| H4 **kaldırma idempotence** | H3 tekrar | 200, başarı | 0 | `Nothing changed for "adstark.com.tr" — …` / `Already untracked, so their dates were left as they were: "adstark", "dijital reklam yönetimi".` — **damganın korunduğu iddiası canlıda METİN olarak doğrulandı; damganın gerçekten değişmediği ÖLÇÜLEMEDİ** (satır okunamıyor, bkz. F-3) |
| H5 hiç izlenmemişi kaldırma | `action:"untrack"`, `["bu-kelime-hic-izlenmedi-9f3a"]` | 200, başarı | 0 | `Not tracked for this project on this location, language and device, so there was nothing to stop: …` — üç durum (durduruldu / zaten arşivli / hiç yoktu) ayrı ayrı raporlanıyor |
| H6 yeniden izleme (revive) | `["adstark","dijital reklam yönetimi"]` | 200, başarı | 0 | `Tracked again (the earlier record came back, so nothing about them was lost): …` — arşivden diriltme yolu canlıda |
| H7 son kaldırma | `action:"untrack"`, aynı 2 kelime | 200, başarı | 0 | `Stopped tracking 2 keywords …` — döngü kapandı, bırakılan durum: **arşivli** |

**Kaldırma yolu VAR** — ayrı bir `untrack_keywords` tool'u değil, aynı tool'un `action:"untrack"` dalı. **Gerçek SİLME yolu YOK ve olmaması tasarım kararı** (`untrack_project`'in proje düzeyindeki kuralının kelime granülünde tekrarı); bu, description'da, docs'ta ve her cevapta yazılı.

### Yapılan kalıcı değişiklikler

| ne | nerede | son durum |
|---|---|---|
| `adstark` | `tracked_keywords`, proje adstark.com.tr · `Turkiye` · `tr` · `desktop` | **arşivli** (`untracked_at` damgalı, H7) — satır tabloda kalıyor, tasarım gereği silinmiyor |
| `dijital reklam yönetimi` | aynı kimlik | **arşivli** (H7) |
| `bu-kelime-hic-izlenmedi-9f3a` | — | **hiç yazılmadı** (H5 yalnız var-olmayanı untrack etmeyi ölçtü; `untrackKeywords` yalnız UPDATE yapar, INSERT etmez) |

Aktif (izlenen) kelime sayısı ölçüm öncesi hâline döndürüldü. Ücretli hiçbir tool çağrılmadı; `keyword_positions` **çağrılmadı**.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/yonlendirme/out.jsonl` (anahtar `makeRedactor(MCP_SMOKE_URL)` ile redakte).

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-6.5** (Google'a otomatik sorgu ToS ihlalidir) | Tool hiçbir motora gitmiyor ve bunu HER cevabında söylüyor: `"Tracking records what to watch; it takes no measurement. No search engine was contacted, no position was read, and nothing was charged."` Description'da da: `"Registration only: it takes no measurement and contacts no search engine."` | **UYUYOR** | İleride bu kayıtları ölçecek şey ölçümü DataForSEO üzerinden yapar (`tracked-keywords-store.ts:39-44` yorumu vendor'ın "$0.02 per keyword per scrape" tarifesini anıyor), yani Google'a doğrudan otomatik sorgu bu tool'dan çıkmıyor. **Ölçülmüş şerh:** ne tool metni ne docs, ileriki ölçümün üçüncü taraf bir kazıyıcıdan geçtiğini söylüyor — kullanıcıya sunulan cümle yalnız "a SERP snapshot has been taken" |
| **R-8.8** (intent taksonomisi: informational/navigational/commercial/transactional, istek başına ≤1.000 kelime, 38 dil) | Tool intent SINIFLANDIRMASI yapmıyor, döndürmüyor, saklamıyor | **İLGİSİZ** | Referans eşlemesi R-8.8'i bu tool'a yazmış; ölçüldüğünde karşılığı yok. `language_code` alanı DFS'in dil listesine karşı doğrulanmıyor (yalnız `min(2)`) — R-8.8'in "38 dil" tarafının tek dolaylı teması bu, ve kontrol edilmiyor (F-5) |
| **R-8.9** (Keyword Planner hacmi: yakın varyantlar dahil, 12 ay ortalaması, yuvarlanmış, tarihsel yalnız exact match) | Tool **hiçbir arama hacmi göstermiyor, hesaplamıyor, saklamıyor**. Description, docs sayfası ve tüm canlı cevaplarda "volume", "search volume", "aylık arama" geçen tek kelime yok | **İLGİSİZ** | Referans listesinin bu tool için öngördüğü "en olası bayatlama riski" (`Hacim semantiği: yuvarlanmış, 12 ay ortalaması, yakın varyant dahil`) **karşılıksız** — risk `research_keywords` / `discover_keywords` / `keyword_gap` tarafında. Referans listesindeki tool-eşlemesi bu satırda düzeltilmeli (öneri, F-6) |
| R-8.3 (DFS saklama: JSON 30 gün / HTML 7 gün) | Tool bir DFS task'ı üretmiyor | İLGİSİZ | — |
| R-7.11 ("position" tanımı) | Tool pozisyon döndürmüyor; `NO_MEASUREMENT_NOTE` pozisyonun ayrı bir yoldan geldiğini söylüyor | **UYUYOR** | Konum semantiğini karıştırma riski yok |
| Bayatlatan 10 madde | Hiçbiri metinde geçmiyor | **UYUYOR** | Kanıt: `grep -niE "crawl budget\|indexnow\|indexing api\|llms\.txt\|faq\|howto\|noarchive\|disavow\|FID \|60 char\|160 char"` ilgili dosyalarda **NO MATCH**. Bu tool SEO tekniği değil, kayıt semantiği anlatıyor |

**Doğru olduğu ölçülen SEO iddiaları.** Tool iki yerde arama motoru davranışı hakkında iddiada bulunuyor ve ikisi de referansla çelişmiyor:
1. `"Google returns different results and a different layout on each, so a desktop ranking says nothing about a mobile one"` — R-3.14 mobile-first indexing'i doğruluyor, cihaz başına farklı SERP iddiası referans listesinde ayrıca YASAKLANMIYOR; **listede bu iddiayı doğrulayan ya da çürüten bir kural yok — listede yok**.
2. `"it calls Turkey \"Turkiye\""` — bu bir Google iddiası değil, DataForSEO lokasyon adı iddiası; canlı N4 çağrısında satıcı adının gerçekten "Turkiye" olduğu, kendi hata metniyle doğrulandı.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — `card-map.ts:50` → `track_keywords: "action"`.
`card-map.ts:62` → `CARDED_TOOLS = new Set(["get_credit_balance"])` — PLANLI, henüz SEVK EDİLMEMİŞ.
Canlı doğrulama: 21 `track_keywords` çağrısının hiçbirinde `structuredContent` yok; aynı oturumda `get_credit_balance` `structuredContent.card` döndürdü. Plan ↔ canlı **tutarlı**.
Canlı payload bir "action" kartının beklediği alanları taşıyor mu: **ÖLÇÜLEMEDİ** — bugün çıktı tek parça `content[0].text`. Kart geldiğinde ayrık alanlar hazır: `classify()` zaten `{created, revived, unchanged}` üçlüsünü, `describeIdentity()` kimlik satırını ayrı üretiyor.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK** — `grep -n "track_keywords" scripts/testing/plan.mjs` → hiç eşleşme. `EXCLUDED` da boş (`plan.mjs:91` → `export const EXCLUDED = Object.freeze({});`) ve yorumu (`plan.mjs:87-89`) hâlâ `"Empty today — all 19 live tools are planned"` diyor; canlı yüzey **38 tool**. `assertCoverage` (`plan.mjs:360`) bu tool'u "ne PLAN'da ne EXCLUDED'da" diye reddeder — yani sweep bugün koşulsa kapsam iddiası patlar. (Düzeltme fazında eklenir.)
- `goals/` hedefi gerekli mi: **EVET** — M7 yeşil kaldığı için. Hedef, `untrackKeywords`'ün arşivli satırı yeniden damgalamadığını Docker'sız bir şeritte iddia etmeli (ör. sorgu kurucusunun `.is("untracked_at", null)` çağrısını yaptığını pinleyen bir sahte kurucu; bugünkü birim double'ı filtreyi hiç görmüyor).

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) |
|---|---|---|---|---|
| F-1 | **P1** | "İki kez untrack, arşiv tarihini değiştirmez" garantisi — description'da, docs sayfasında ve canlı H4 cevabında üç kez verilen söz — Docker'sız hiçbir kapıda korunmuyor. Filtre silindiğinde 3680 testin hiçbiri kırmızıya dönmüyor | M7: `tracked-keywords-store.ts:216`'dan `.is("untracked_at", null)` silindi → mcp 143/143 · 3680/3680 · exit 0. Tek koruma `track-keywords.db.test.ts:245` (Docker; `make verify` koşmaz) | `goals/` altına Docker istemeyen bir hedef, ya da birim şeridindeki sahte kurucunun (`loadTracked`/`untrack` double'ı) uygulanan filtreleri KAYDEDİP iddia etmesi. CLAUDE.md ders 12'nin "filtreleri kaydedip UYGULAMAYAN sahte kurucu" vakasının aynısı, bir tool ötede |
| F-2 | **P1** | `track_keywords` `scripts/testing/plan.mjs`'de ne `PLAN`'da ne `EXCLUDED`'da; ayrıca `EXCLUDED` yorumu hâlâ "all 19 live tools" diyor, canlı yüzey 38 tool. Kapsam iddiası bayat | `grep -n "track_keywords" scripts/testing/plan.mjs` → boş; `plan.mjs:87-91`; canlı `tools/list` → 38 | Ya `PLAN`'a hücre eklenmeli (bu turda ölçülen 7 adımlı yaşam döngüsü hazır senaryo), ya `EXCLUDED`'a yazılı gerekçe. Yorumdaki "19" güncellenmeli. **Bu bulgu yalnız `track_keywords`'e özgü değil** — 38'e karşı sayılması gereken bir kapsam listesi 19'da donmuş |
| F-3 | **P1** | MCP yüzeyinde izlenen kelimeleri OKUMA yolu yok. `tracked_keywords` tablosunu hiçbir MCP tool'u okumuyor: `serp_snapshot` kelimeleri argümandan alıyor, `keyword_positions` `keyword_position_measurements`'ı okuyor. Tablo yalnız web panelinden (`apps/web/app/app/rankings/read-tracked-keywords.ts`) görülüyor. Ayrıca hiçbir otomatik tazeleyici yok (`tracked-keywords-store.ts:39-44` bunu kendisi yazıyor: "A REFRESHER THAT DOES NOT EXIST YET") | `grep -rn "tracked_keywords" --include=*.ts apps packages` → yazan tek yer store, okuyan tek yer web Rankings sayfası. Tool'un kendi hata metni bile bunu itiraf ediyor: `"run track_keywords with the same list to see what is actually tracked"` — okuma için YAZMA çağrısı öneriliyor | Ya bir okuma dalı (`action: "list"`, 0 kredi), ya `list_projects`'in proje satırına izlenen kelime SAYISI, ya da description'a "the list is visible in the SeoGrep Rankings page" cümlesi. MCP-only kullanıcı bugün ne izlediğini öğrenemiyor |
| F-4 | P2 | 1 karakterlik kelime kabul ediliyor (`items.minLength: 1`). Tek harflik bir kayıt 100'lük üst sınıra sayar ve ileride ölçüldüğünde satıcıya ~$0.02 harcatır; hiçbir SERP'te anlamlı sonuç vermez | Canlı N4: `["a"]` şemayı ve normalizasyonu geçti, yalnız lokasyon adında kesildi | Anlamlı bir alt sınır (ör. `min(2)`), ya da 1 karakterlik girdiyi "muhtemelen yazım hatası" diye açıkça reddeden bir iş kuralı. Sınır bir ÜRÜN sayısıdır (NEVER #6 bağlamaz) ama davranış değişikliğidir |
| F-5 | P2 | `language_code` yalnız `min(2)` ile doğrulanıyor; `location_name` DataForSEO'nun listesine karşı kontrol edilirken (`checkLocationName`, ve bu ölçülmüş bir kazanç — canlı N4) dil kodu için eşdeğer bir kontrol yok. Satıcının tanımadığı bir dil kodu ücretsiz kaydediliyor, ücretli SERP çağrısının sonunda reddediliyor — lokasyon için kapatılan deliğin dil eksenindeki hâli | `track-keywords.ts:109-116` ↔ `:98-108`; canlı N12 yalnız uzunluğu kesiyor | `checkLocationName`'in kardeşi bir `checkLanguageCode`. Not: dil listesinin nerede olduğu bu turda ölçülmedi; `dfs/locations.ts` yalnız lokasyon taşıyor |
| F-6 | P2 | Referans listesinin tool eşlemesi `track_keywords` için "en olası bayatlama riski: Hacim semantiği (R-8.9)" diyor; ölçüldüğünde tool hiçbir hacim göstermiyor — risk karşılıksız, gerçek risk `research_keywords`/`discover_keywords`/`keyword_gap`'te | `docs/reference/2026-09-02-seo-referans-listesi.md` "Tool eşleme" tablosu `track_keywords` satırı ↔ canlı çıktılar + description + docs (hiçbirinde hacim yok) | Referans listesinin `track_keywords` satırı R-6.5 ile sınırlanmalı; R-8.8/R-8.9 kaldırılmalı ya da "İLGİSİZ, ölçüldü 2026-09-02" şerhi düşülmeli. **Bu bir referans listesi düzeltmesidir, kod değil** |
| F-7 | P2 | Cevabın ilk satırı `Tracking 2 keywords for "adstark.com.tr" — …` — buradaki 2 sayısı İSTEĞİN toplamı (created+revived+unchanged), projenin toplamı değil. 100 kelime izleyen bir projede 2 kelimelik bir çağrı yine "Tracking 2 keywords" der; okur bunu proje toplamı sanabilir. Üst sınır reddi ise proje toplamını (`active`) doğru raporluyor, yani aynı tool iki farklı sayıyı aynı fiil ile anıyor | `renderTracked` (`track-keywords.ts:299-301`) ↔ `capRefusal` (`:159-168`); canlı H1/H2 çıktıları | Başlığın "In this request: 2 keywords" gibi kapsamını söylemesi, ya da `countActive`'in her başarılı cevapta proje toplamını da vermesi (ekstra bir sorgu, tool 0 kredi) |
| F-8 | P2 | Şemada `additionalProperties` kısıtı yok — yazım hatalı alan sessizce yok sayılır (yüzey geneli davranış; `whats_next` F-9 ile aynı) | Canlı `whats_next` N5 ölçümü; `track_keywords` şeması aynı biçimde kısıtsız | Yüzey geneli karar; tek tool'da değiştirmek tutarsızlık üretir |
| F-9 | P2 | Tool ölçümün nasıl yapılacağını söylerken üçüncü taraf bir sağlayıcıdan geçtiğini söylemiyor: `"A position appears only once a SERP snapshot has been taken"`. Kodda `"$0.02 per keyword per scrape"` yazıyor; kullanıcıya sunulan metinde "scrape" ya da sağlayıcı adı yok (R-6.5'in bağlamı) | `NO_MEASUREMENT_NOTE` (`track-keywords.ts:176-179`) ↔ `tracked-keywords-store.ts:39-44` | Ölçümün nasıl yapıldığını açıklayan cümlenin docs sayfasında olması yeterli olabilir; tool metnine eklemek gerekmez. **Metin değişikliği önerisidir, imza gerektirir** |
