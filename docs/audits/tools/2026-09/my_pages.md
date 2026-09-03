# `my_pages` — tool kontrol kaydı (2026-09 turu)

> Dilim: 4 · İşçi: Opus 5 (d4-ranked) · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | Handler `apps/mcp/src/tools/my-pages.ts:869`; kredi `costs.ts:59` `  my_pages: 40,` (gerekçe bloğu `:47-58` tam). **İş emrinin/referansın "GSC" önermesi YANLIŞ ÇIKTI:** tool DataForSEO Labs `relevant_pages` + kendi `crawl_pages`'imizi okur, Search Console'a hiç dokunmaz (§5) |
| 2 Mutasyon | ÖLÇÜLDÜ — 4 mutasyon, 3 KIRMIZI / **1 YEŞİL KALDI** | M7 (`my-pages-crawl.ts:107` `.eq("user_id", userId)` silindi — NEVER #4) → **155/155 dosya, 4016/4016 test YEŞİL** (A-1). Taban 155 dosya / 4016 test |
| 3 Canlı negatif | ÖLÇÜLDÜ — 12 senaryo, 11'i temiz | 11/12 ret "You were not charged", defterde satır yok. **12.'si (`item_types: ["featured_snippet"]`, ŞEMAYA UYGUN) "failed unexpectedly" verdi ve defterde charge+refund çifti bıraktı** (A-3) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ — 2 ücretli çağrı, **−80 kredi** | adstark.com.tr (5 sayfalık taze crawl) ve dentnotion.com (100 sayfalık crawl). **İkisi de en/2840 varsayılanında SADECE 1 satıcı sayfası döndürdü** ve tool lokal uyarısı vermiyor (A-2) |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-3.6 **UYUYOR** (crawl şerhi robots'u ADIYLA anıyor) · **R-7.1 / R-7.2 / R-7.6 / R-7.8 İLGİSİZ** — ölçüldü: kaynakta GSC yolu YOK; referans satırı için düzeltme önerisi §5'te · R-8.1 UYUYOR |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:18` `my_pages: "list"` (PLANLI); `CARDED_TOOLS` yalnız `get_credit_balance` — 15 canlı çağrının hiçbirinde `structuredContent` yok. Plan ↔ canlı tutarlı |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` **EXCLUDED** girişi VAR ama **gerekçesi BAYAT** (A-5) · `goals/` hedefi EVET (A-1) |

**Karar (ölçüm turu, 2026-09-03):** **DÜZELTME GEREKLİ** — bu tool'un dürüstlük disiplini olağanüstü:
"crawl'da bulunamadı" ≠ "sayfa yok" ve "bu pencerede adlanmadı" ≠ "sıralanmıyor" ayrımlarının ikisi de
canlıda tarihi, sayfa sayısı ve pencere sınırlarıyla birlikte basıldı; hiçbir kapsama skoru, yüzde ya da
not üretilmiyor; her rakam satıcının kendi alan adıyla anılıyor; tahminler TAHMİN olduğu söylenerek
yuvarlanıyor. Buna karşılık: (a) **NEVER #4 kiracı filtresi Docker'sız hiçbir kapıda korunmuyor** —
silindi ve 4016 testin tamamı yeşil kaldı, (b) **iki ücretli çağrının ikisi de en/2840 varsayılanında 1
sayfa döndürdü ve tool bunun sebebini hiç adlandırmıyor** — kardeşi `ranked_keywords` tam bu dersi kendi
kaynağında yazılı taşıyor ama `my_pages` onu miras almamış, (c) şemanın reklam ettiği bir `item_types`
değeri satıcıya gidip beklenmedik hatayla dönüyor.

**Karar (kapanış, <YYYY-MM-DD>):** — düzeltme dalgası bittiğinde KAPATAN tur yazar; ölçüm turunun kararı
SİLİNMEZ, yanına yazılır (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/my-pages.ts:866-942` (`makeMyPagesTool`, `name` satırı `:869`).
  Saf biçimlendirici `formatMyPages` `:780`; karşılaştırma `renderComparison` `:662`; sayım `renderMatchCount` `:651`.
  Crawl yarısı: `apps/mcp/src/tools/my-pages-crawl.ts` — `loadCrawlSide` `:101`, `crawl_pages` okuması `:104-112`, `joinPages`.
  Satıcı yarısı: `apps/mcp/src/dfs/relevant-pages.ts` — uç `:118`, birleştirme anahtarı `pageJoinKey` `:165`, tarife `:206-207`, istek gövdesi `buildRelevantPagesRequestBody` `:436`, metrik projeksiyonu `:548-567`.
  Koşu kaydı: `dfs/runs.ts:765` → `domain_lookup_runs` (migration 0031), `user_id` + `project_id` satırda (`:759-760`); crawl özeti `myPagesCrawlView` `my-pages.ts:818` (yalnız SAYIMLAR, URL'ler DEĞİL).
- Zod şeması (alanlar, kısıtlar) — canlı redlerle birebir doğrulandı (N4–N10):
  - `target`: `targetField("list the ranking pages of")`, opsiyonel · `project_id`: `z.uuid()`, opsiyonel
  - `limit`: `z.number().int().min(1).max(1000).default(100)`
  - `offset`: `z.number().int().min(0).default(0)`
  - `item_types`: `z.array(z.enum(["organic","paid","featured_snippet","local_pack"])).min(1).max(4).optional()`
  - `min_organic_etv`: `z.number().min(0).optional()` · `min_organic_count`: `z.number().int().min(0).optional()`
  - `language_code`: `z.string().min(2).default("en")` · `location_code`: `z.number().int().positive().default(2840)`
  - **`additionalProperties: false`** — canlıda VAR (N4: `include_clickstream_data` → "✖ Unrecognized key")
- Description (birebir alıntı, `my-pages.ts:191-202`):
  > "List the pages of a domain that DataForSEO Labs reports ranking figures for, and compare them against the pages your own last crawl fetched. Each page carries DataForSEO's position histogram (pos_1 through pos_91_100), etv, count and estimated_paid_traffic_cost per result type — it does NOT carry the keywords a page ranks for, which this endpoint does not return; use ranked_keywords with a page URL for that. Pass project_id to also see which of those pages your crawl fetched, which it did not, and which pages it fetched that this window of DataForSEO's list did not name — each stated as a fact about that window and that crawl, not as a verdict about your site. SeoGrep ranks nothing and scores nothing. Synchronous — everything comes back immediately. Costs 40 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:59`, birebir): `  my_pages: 40,`
  Gerekçe bloğunun ilk üç satırı birebir (`costs.ts:47-49`):
  `  // my_pages (plan 2026-08-17 §B, MADDE 1 row #11): DataForSEO Labs \`relevant_pages\` — one row per` /
  `  // PAGE of a domain, carrying that page's position histogram and traffic estimates, joined` /
  `  // against the pages our own crawl fetched. SIGNED BY THE OPERATOR 2026-08-17 at 40, with the`
- Docs sayfası: `apps/web/content/docs/tools-reference/my-pages.mdx`.
  Kredi cümlesi birebir (`:6`): `**Cost:** 40 credits.`
  Kapsam cümlesi birebir (`:8`):
  > "`my_pages` lists the pages of a domain that **DataForSEO Labs reports ranking figures for**, and compares them against the pages **your own last crawl fetched**. It is the PAGE axis of the question [`ranked_keywords`](/docs/tools-reference/ranked-keywords) answers on the keyword axis."
  Crawl şerhi birebir (`:38`):
  > "**"Not found in that crawl" is not "the page does not exist".** Your crawl is one run, on one day, starting from the site's own start URL and following links under its depth, page-count and robots limits. The answer names the crawl's date and how many pages it fetched, right beside the list."
- Tutarsızlıklar: **yok** — karşılaştırılanlar: (1) canlı redlerin adlandırdığı sınırlar ↔ zod `:103-187`
  tam örtüşme; (2) docs `:66` `limit` açıklaması ↔ şemanın `.describe()` metni **birebir aynı dize**;
  (3) docs "40 credits" ↔ `TOOL_COSTS.my_pages = 40` ↔ description şablonu — tek kaynak;
  (4) `MAX_RELEVANT_PAGES_ROWS = 1000` ↔ docs "1-1000, default 100" — aynı.
  **Docs'ta Search Console hiç geçmiyor** (`grep -n "GSC\|Search Console" my-pages.mdx` → sıfır eşleşme) —
  bu, §5'teki referans düzeltmesinin ikinci bağımsız kanıtı.
- Seçilebilirlik: **bu turun en ilginç seçilebilirlik vakası.** "my pages" adı, "sayfalarım Search
  Console'da ne durumda" cümlesini doğal olarak çekiyor — ama tool GSC'ye hiç bakmıyor; o soru
  `pull_gsc_data` / `find_quick_wins`'in. Ölçülen azaltıcılar gerçek ve güçlü: (a) description **İLK
  cümlesinde** satıcıyı adlandırıyor ("that DataForSEO Labs reports ranking figures for"), (b) "it does
  NOT carry the keywords a page ranks for" cümlesi description'ın içinde, (c) çıktının her cevabında
  `WHAT_THE_VENDOR_RETURNS` sabiti (`:349`) aynı şeyi bir kez daha söylüyor — canlıda iki çağrıda da
  basıldı. Kalan risk ADIN kendisinde: MCP istemcisi çoğu zaman yalnız tool ADINI ve ilk satırı görür.
  En yakın komşu `ranked_keywords` ile ayrım net ve İKİ YÖNLÜ (her ikisi de diğerini adıyla işaret ediyor).

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Taban (`logs/baseline.log`): **155 dosya / 4016 test, 0 failed.**
Sonuçlar log DOSYASINDAN okundu.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M7 | `my-pages-crawl.ts:107` `.eq("user_id", userId)` SİLİNDİ (NEVER #4, crawl yarısı) | kiracı filtresi pini | **YEŞİL KALDI** | `logs/m7.log`: `Test Files 155 passed (155)` · `Tests 4016 passed (4016)` — A-1 |
| M8 | `my-pages.ts:901` ledger meta'sından `projectId` silindi | H-1 aile süpürgesi + tool pini | **KIRMIZI** (2 failed) | `handler-charge-scope-coverage.pin.test.ts > names a project at every call site that has one to name` **VE** `rankings-project-scope.pin.test.ts > 'my_pages' …` — `logs/m8.log` |
| M9 | `my-pages.ts:388` `vendor_total_count === null` dalı, pencere satır sayısıyla dolduruldu | "satıcı susunca uydurma" pini | **KIRMIZI** (1 failed) | `my-pages.test.ts > says the vendor gave no total rather than back-filling one from the rows in hand` — `logs/m9.log` |
| M10 | `dfs/relevant-pages.ts:566` `is_lost: raw.is_lost ?? null` → `null` (satıcı alanı düşürüldü) | ayrıştırıcı alan pini | **KIRMIZI** (2 failed) | `relevant-pages.test.ts > projects every metric under the VENDOR's own name` + `keeps a vendor silence as null on EVERY metric field, never as 0` — `logs/m10.log` |

**M7, YEŞİL KALAN MUTASYON — ne kapsanıyor, ne kapsanmıyor (ölçüldü, varsayılmadı).**
`my-pages-crawl.ts:32-39` başlığı filtreyi "DEFENCE IN DEPTH" diye tarif ediyor — yani ikinci savunma
hattı — ve `job_id`'nin zaten kiracı-kapsamlı çözüldüğünü söylüyor. Bu doğru olabilir; **ölçülen şey,
o iddianın hızlı şeritte HİÇBİR kapı tarafından sınanmadığıdır.**

- `service-client-pins.test.ts` (fake-query zincir pini deseni): `grep -niE "my-pages|my_pages|crawl_pages"`
  → **sıfır eşleşme**. Bu tool'un zinciri o dosyada hiç yok.
- `my-pages.test.ts`: `userId` yalnız `:752-759`'da geçiyor ve orada sınanan şey **enjekte edilmiş**
  `LoadCrawlSideFn`'e doğru `userId`'nin GEÇİLDİĞİ — gerçek sorgunun onu KULLANDIĞI değil. Bu, ders 12'nin
  tam şekli: test double gerçeğinden hoşgörülü, eksik kısıt geçen teste dönüşüyor.
- `my-pages.db.test.ts` başlığı `:36` bunu **adıyla iddia ediyor**: `(h) TENANT ISOLATION on the CRAWL SIDE,
  both directions — a stranger reading the same …`. Ama bu şerit **Docker ister** ve iş emrince koşulmadı;
  `make verify` de `*.db.test.ts` koşmaz (CLAUDE.md kapı tablosu: "DB şeritleri YOK").
  → **db şeridi CI/hakem.** Bu kayıt, o şeridin gerçekten kırmızı verdiğini KANITLAMIYOR; yalnız hızlı
  şeritte hiçbir şeyin bakmadığını kanıtlıyor.

Çalışma ağacı sonunda temiz — `git diff --stat` çıktısı BOŞ (M10 geri alımından sonra ölçüldü).

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 özne yok | `{}` | 200 · isError | 0 | "Nothing to look up: pass "project_id" … or "target" … You were not charged." — `ranked_keywords` ile BİREBİR aynı cümle (paylaşılan `resolveTarget`) |
| N2 iki özne | `target` + `project_id` | 200 · isError | 0 | "Pass "project_id" or "target", not both …" |
| N3 yabancı geçerli uuid | `project_id: f47ac10b-…-4372-…` | 200 · isError | 0 | "No project found with id f47ac10b-… Run list_projects…" — **kiracı sızıntısı yok**, varlık/yokluk sızmıyor |
| N4 bilinmeyen alan | `include_clickstream_data: true` | 200 · isError | 0 | `✖ Unrecognized key` — fiyat ikiye katlayan parametrenin şemaya sızamadığı da böylece ölçüldü (NEVER #6) |
| N5 limit 0 | `limit: 0` | 200 · isError | 0 | `✖ Too small: expected number to be >=1 → at limit` |
| N6 limit 1001 | `limit: 1001` | 200 · isError | 0 | `✖ Too big: expected number to be <=1000 → at limit` |
| N7 negatif offset | `offset: -1` | 200 · isError | 0 | `✖ Too small: expected number to be >=0 → at offset` |
| N8 boş item_types | `item_types: []` | 200 · isError | 0 | `✖ Too small: expected array to have >=1 items` |
| **N9 `item_types: ["featured_snippet"]`** | **şemaya UYGUN enum değeri** | **200 · isError · "failed unexpectedly"** | **charge −40 + refund +40 (net 0)** | `Tool "my_pages" failed unexpectedly. The server logged the details under reference 457d2b7d … You were not charged.` — **A-3** |
| N10 negatif etv filtresi | `min_organic_etv: -1` | 200 · isError | 0 | `✖ Too small: expected number to be >=0` |
| N11 geçersiz alan adı | `target: "http://"` | 200 · isError | 0 | `"http://" is not a valid domain or URL.` |
| N12 arşivli proje | arşivli `project_id` | 200 · isError | 0 | Arşiv cümlesi + geri getirme yolu |

**11/12 tamamen ücretsiz** ve defterde satır bırakmadı. **N9 istisnadır ve iki ayrı defterde iz bıraktı:**

- Kredi defteri: `-40 credits · charge · my_pages · no project scope` ardından
  `+40 credits · refund · my_pages · no project scope` (13 saniye arayla). Net 0 — `withCredits`'in
  THROW→RELEASE sözleşmesi **doğru çalıştı**, müşteri gerçekten ücretlendirilmedi. T-B11 sınıfı,
  protokolün istediği gibi kayda geçirildi.
- **DFS bütçe defteri: rezervasyon AÇIK KALDI.** `relevant-pages.ts:706-709` bunu kasten böyle tarif
  ediyor (birebir): *"A failure at (2) leaves the reservation open at its full estimate, which is never
  less than the spend that really happened."* Yani güvenli yön seçilmiş; ama sonuç, şemanın reklam ettiği
  bir değerin **paylaşılan $3/gün tavanından pay yemesi** ve karşılığında hiçbir şey teslim etmemesidir.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| H1 crawl'lı proje | `project_id` = adstark.com.tr, `limit: 25` | 200 · ok · 3.998 char · `structuredContent` YOK | **−40** · defter: `charge · my_pages · project: adstark.com.tr` | **1 satıcı sayfası**, `vendor_total_count` 1. Başlık crawl tarihini adlandırdı ("compared against the crawl of it recorded 2026-09-03"). Eşleşme 0/1; crawl 5 sayfa getirmişti ve satıcının sayfası (`/seo-uzmani/`) onların arasında değildi. Üç populasyon da ayrı başlıklar altında, her biri kendi sınır cümlesiyle |
| H2 büyük site | `project_id` = dentnotion.com, `limit: 200` | 200 · ok · 7.393 char | **−40** · defter: `charge · my_pages · project: dentnotion.com` | **Yine 1 satıcı sayfası**, `vendor_total_count` 1 — 100 sayfalık crawl'a karşı. Eşleşme 1/1. Crawl-yanı kesilme notu **ateşledi**: "Output limit reached — 50 pages printed above, 49 more … nothing was charged for the ones left out … that is discovery order, not an order of importance" |

Ham kayıt: `<scratchpad>/dilim4/canli/dilim4.jsonl` (anahtar redakte; `makeRedactor(MCP_SMOKE_URL)`).

**Defter (Dilim 3 H-1 ekseni): İKİ satır da doğru proje kapsamını taşıyor** (`project: adstark.com.tr`,
`project: dentnotion.com`). Mutlu yollarda refund yok. Bu tool için toplam **−80 kredi** (+ N9'un net-sıfır
charge/refund çifti).

**H1+H2'nin ortak bulgusu — lokal uyarısı YOK (A-2).** İki farklı Türk sitesi, biri 5 biri 100 sayfa
crawl'lı, ikisi de en/2840 varsayılanında **birer** satıcı sayfası döndürdü. Çıktının verdiği tek eylem
önerisi `windowLimitsNote`'un cümlesi: *"Advance \`offset\` to read further into the list."* — ama
`vendor_total_count` 1 olduğu için offset'i ilerletmek boş pencere getirir; gerçek sebep lokal
varsayılanıdır ve hiçbir yerde adlandırılmıyor. Kardeş tool bu dersi kendi kaynağında YAZILI taşıyor
(`tools/ranked-keywords.ts:145-152`, birebir): *"adstark.com.tr returned 3 rows … on the default; the same
domain at tr/2792 returned rows carrying volumes up to 3,600 — the same 65 credits, twice, to discover a
parameter the tool never mentioned."* Bu turda aynı şey `my_pages`'te 40 kredi × 2 olarak tekrarlandı.

**ÖLÇÜLEMEDİ — satıcı-yanı kesilme cümlesi.** `renderVendorLimitNote` (`:562`) ve `VENDOR_LIST_CHAR_BUDGET`
(18.000) / `vendorSideBudgets` (`:514`) yolları canlıda hiç tetiklenmedi: iki öznenin ikisi de tek satır
döndürdü. Bu yol yalnız birim testlerinde kanıtlı; canlı kanıt yok. **Kalan ücretli tavan bu turda
harcandığı için ölçülmedi, "geçti" diye yazılmadı.**

## 5. SEO güncelliği

Referans "Tool eşleme" satırı (`:234`): `my_pages | R-3.6, R-7.1, R-7.2, R-7.6, R-7.8 | API'nin tüm
satırları döndürmeme garantisi (R-7.6) "sayfa yok" diye yorumlanır`.

**İş emrinin uyardığı çelişki ÖLÇÜLDÜ ve referans satırı yanlış çıktı.** Kanıtlar:
`my-pages.ts:5-46` import listesi yalnız `../dfs/relevant-pages.ts`, `./my-pages-crawl.ts`, `../dfs/runs.ts`,
`./project-target.ts`, `../format/quantities.ts` ve kredi katmanını çekiyor — GSC modülü YOK.
`my-pages-crawl.ts` yalnız `crawl_pages` ve `jobs` okuyor. `my-pages.mdx`'te "Search Console" / "GSC"
**sıfır kez** geçiyor. Çıktının hiçbir cümlesinde Search Console adı yok (iki canlı cevabın tamamı okundu).

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-3.6 (robots.txt indekslemeyi engellemez; disallow'lu URL yine indekslenebilir) | `crawlLimitsNote` (`:398-413`) crawl'ın sınırlarını sayarken **robots'u ADIYLA** anıyor ve mutlak yorumu açıkça yasaklıyor. Canlı H1'de birebir bastı: *"following links from the site's own start URL under its depth, page-count and robots limits. "Not found in that crawl" therefore means exactly that — it is not a statement that the page does not exist, is not on your site, or cannot be crawled."* | **UYUYOR** | Bu, R-3.6'nın ürün karşılığının tam olarak doğru hâli: robots yüzünden crawl'a girmeyen bir sayfa Google'da hâlâ sıralanabilir, ve tool "crawl'da yok" ile "sayfa yok"u karıştırmayı cümle düzeyinde reddediyor. Satıcı yarısı için de simetrik şerh var (`windowLimitsNote` `:416`) |
| R-7.1 (Search Analytics boyutları) | — | **İLGİSİZ** | Ölçüldü: tool GSC Search Analytics'i hiç çağırmıyor; "boyut" kavramının burada karşılığı yok |
| R-7.2 (`rowLimit` 1–25.000, varsayılan 1.000; `startRow` ≥0) | — | **İLGİSİZ** | Tool'un `limit`/`offset`'i **DataForSEO Labs** tarifesine bağlı (1–1.000, varsayılan 100) ve fiyat taşıyıcı. GSC'nin 25.000'i buraya uygulanırsa **yanlış ölçüm** olur: bu tavan `MAX_RELEVANT_PAGES_ROWS` ve imzalı 40 kredi ile bağlıdır (NEVER #6) |
| R-7.6 (API tüm satırları döndürmez) | — | **İLGİSİZ (kural), ama RİSK GERÇEK ve BAŞKA KURALDAN geliyor** | Referansın risk cümlesi ("tüm satırları döndürmeme garantisi 'sayfa yok' diye yorumlanır") **doğru bir risktir** ve tool onu kapatıyor — ama kaynağı GSC değil, satıcının kendi penceresi. `renderWindowCaption` (`:379`) ve `renderNoPages` (`:747`) bu ayrımı taşıyor; M9 mutasyonu da bunun testle korunduğunu gösterdi |
| R-7.8 (URL Inspection kotası) | — | **İLGİSİZ** | Tool URL Inspection'ı hiç çağırmıyor |
| R-8.1 (DFS aile listesi) | `DataForSEO Labs` — uç `dataforseo_labs/google/relevant_pages/live` (`:118`) | **UYUYOR** | Docs ve çıktı aynı aileyi adlandırıyor |
| R-8.2 (rate limit header'dan; sabit sayı yok) | Gömülü kota rakamı yok | **UYUYOR** | Uydurma kota yok |
| R-6.5 (Google'a otomatik sorgu) | `grep -rniE "google\.com\|googleapis\|search\?q="` → **sıfır eşleşme** | **UYUYOR** | Motora hiç gidilmiyor |

**Referans listesi için düzeltme önerisi (§5'in çıktısı, kod değil metin):** `2026-09-02-seo-referans-listesi.md:234`
satırı şu hâle gelmeli — `my_pages | R-3.6, R-8.1, R-8.2 (R-7.1/R-7.2/R-7.6/R-7.8 İLGİSİZ — 2026-09-03
ölçüldü: tool GSC'yi hiç çağırmıyor; kaynak DataForSEO Labs relevant_pages + kendi crawl_pages'imiz) |
Satıcı PENCERESİNİN "sayfa yok" diye yorumlanması (R-7.6'nın ürün karşılığı, ama kaynağı GSC değil DFS)`.
Ayrıca `R-7.1`, `R-7.2`, `R-7.6` ve `R-7.8` satırlarının "etkilenen tool'lar" sütunundan `my_pages`
çıkarılmalı. Bu, Dilim 3'ün `track_keywords`/`connect_gsc` satırlarında yaptığı işlemin aynısıdır.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:18` — `my_pages: "list"` eşlemesi **VAR** (planlı sınıf).
`CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`; canlıda kart çizilmiyor.
Canlı doğrulama: 15 `my_pages` çağrısının hiçbirinde `result.structuredContent` yok (`hasStructured: false`).
Plan ↔ canlı **tutarlı**.

"list" kartının isteyeceği yapısal alanlar canlı payload'da mevcut ama bugün yalnız METİN içinde. Dikkat
edilmesi gereken: bu tool'un cevabı **düz bir liste DEĞİL, üç populasyonlu bir PARTİSYON**
(matched / vendorOnly / crawlOnly, artı keylenemeyenler) ve her populasyon kendi sınır cümlesini taşıyor.
Bir "list" kartı bu üç grubu tek listeye düzleştirirse `PARTITION_NOTE` (`:724`) ve `crawlLimitsNote`'un
taşıdığı ayrım kaybolur — kart tasarımı bu tool'da grup başlıklarını ve sınır cümlelerini KORUMALIDIR.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` girişi: **EXCLUDED VAR, gerekçe BAYAT.** Birebir (`:127`):
  `  my_pages: "paid, 40 credits/call and a DataForSEO Labs request. Needs an operator budget signature.",`
  Bu gerekçe 2026-09-02'nin "kredi sınırımız yok" kararından sonra bayat; üstelik bu turda `my_pages`
  **iki kez ücretli olarak koşuldu** ve defterde iki `charge · my_pages` satırı var. (A-5)
- `goals/` hedefi gerekli mi: **EVET** — A-1 için. Predicate, `my-pages-crawl.ts`'in `crawl_pages`
  okumasında `user_id` filtresinin varlığını **Docker'sız** sınamalı (`service-client-pins.test.ts`'in
  fake-query zincir pini deseni bunun için zaten var ve bu tool'u hiç kapsamıyor). Hedef yazılırken
  ders 12 uyarısı geçerli: sahte kurucu filtreleri KAYDETMEKLE kalmayıp UYGULAMALI, yoksa yeni pin de
  yeşil-ama-yanlış-sebeple olur.

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, <YYYY-MM-DD>) |
|---|---|---|---|---|---|
| A-1 | **P1** | NEVER #4 — `crawl_pages` okumasının kiracı filtresi (`user_id`) silindiğinde **Docker'sız hiçbir kapı kırmızı vermiyor**. `service-client-pins.test.ts` bu zinciri hiç tanımıyor; `my-pages.test.ts`'in `userId` iddiası enjekte edilmiş bir double'a yapılıyor, gerçek sorguya değil | M7: `logs/m7.log` — `Test Files 155 passed (155)`, `Tests 4016 passed (4016)`. `grep -niE "my-pages\|my_pages\|crawl_pages" service-client-pins.test.ts` → sıfır eşleşme. `my-pages.test.ts:752-759` yalnız `LoadCrawlSideFn`'e geçen argümanı sınıyor | `service-client-pins.test.ts`'e `loadCrawlSide` zinciri için fake-query pini eklenmeli: `.eq("user_id", …)` çağrısının gerçekten YAPILDIĞI sınanmalı. Kapı `make verify`'ın koştuğu şeritte olmalı — bugünkü tek koruma `my-pages.db.test.ts (h)` ve o Docker istiyor. **Bu kayıt db şeridinin kırmızı verdiğini KANITLAMIYOR** (koşulmadı); hakem/CI o yarıyı ayrıca doğrulamalı | |
| A-2 | **P1** | Lokal uyarısı YOK. İki ücretli çağrının ikisi de en/2840 varsayılanında **1 satıcı sayfası** döndürdü (biri 100 sayfalık crawl'ı olan siteye karşı) ve çıktı sebebi hiç adlandırmıyor; verdiği tek öneri (`offset`'i ilerlet) `vendor_total_count == 1` iken işe yaramaz. Kardeş `ranked_keywords` aynı dersi kaynağında yazılı taşıyor, `my_pages` miras almamış | H1: adstark, `vendor_total_count` 1, crawl 5 sayfa. H2: dentnotion, `vendor_total_count` 1, crawl 100 sayfa. İkisi de `language en, location 2840`. Kaynak dersi: `tools/ranked-keywords.ts:145-152` ("the same 65 credits, twice, to discover a parameter the tool never mentioned") | `ranked_keywords`'ün `localeHint` + `twoLetterTld` çiftinin karşılığı buraya taşınmalı — **kopya değil, PAYLAŞILAN** bir yardımcı olarak (iki tool'un cümlesi ayrışırsa aynı domain iki farklı tavsiye alır). Eşik `my_pages` için satır sayısı değil `vendor_total_count` olmalı. `GENERIC_TWO_LETTER_TLDS` listesi ve "ülke kodunu TAHMİN ETME" kısıtı aynen korunmalı | |
| A-3 | **P1** | Şemanın reklam ettiği `item_types` değeri `"featured_snippet"` **beklenmedik sunucu hatası** üretiyor: kullanıcı `Tool "my_pages" failed unexpectedly … reference 457d2b7d` görüyor. Hata satıcı isteğinden SONRA oluşuyor: kredi defterinde charge+refund çifti var (net 0, doğru) ama DFS bütçe rezervasyonu **açık kalıyor** — yani paylaşılan $3/gün tavanından pay yiyor ve karşılığında hiçbir şey teslim edilmiyor | N9 canlı: `isError: true`, metin yukarıda birebir. Defter: `-40 charge my_pages` (19:31:13) → `+40 refund my_pages` (19:31:15). Enum kaynağı `dfs/relevant-pages.ts:258-263` (dört değer). Rezervasyon yolu `:706-709` + `:723-745`: `throw`'da `settleSpend`'e hiç ulaşılmıyor (dosyanın kendi yorumu bunu kasıtlı diye tarif ediyor) | Önce **TEŞHİS**: hata satıcıdan mı (non-20000 task) yoksa ayrıştırıcıdan mı geliyor — sunucu log'u `457d2b7d` referansıyla okunmalı; bu kayıt onu ölçemedi. Sonuca göre ya enum yalnız gerçekten çalışan değerlere daraltılmalı (şema reklam ettiğini teslim etmeli), ya da hata ücretsiz ve ANLAŞILIR bir redde çevrilmeli. Ayrıca: satıcı reddi kullanıcıya "unexpectedly" diye değil, satıcı reddi olduğu söylenerek dönmeli | |
| A-4 | P2 | Tekil/çoğul hataları canlıda iki kez bastı: `DataForSEO counts 1 pages matching this lookup in total` ve `Of the 1 page in this window whose address could be keyed, 1 also appear in the crawl…` | H1 ve H2 çıktıları (ikisinde de `vendor_total_count == 1`). Kaynak: `renderWindowCaption:388-390` (`whole` dalında çoğul yok) ve `renderMatchCount:653-655` (`also appear` sabit) | Her iki cümlede de `exactCount` sonucuna göre tekil/çoğul seçilmeli — dosya bunu zaten başka yerlerde doğru yapıyor (`rows === 1 ? "page" : "pages"`, `:382`). Saf fonksiyon, testi ucuz | |
| A-5 | P2 | `plan.mjs:127` `my_pages` EXCLUDED gerekçesi bayat: "Needs an operator budget signature." — 2026-09-02'nin "kredi sınırımız yok" kararından sonra geçersiz, ve bu turda tool iki kez ücretli koşuldu | Birebir satır §7'de. Defterde `charge · my_pages · project: adstark.com.tr` ve `… · project: dentnotion.com` | Ya EXCLUDED kaldırılıp PLAN satırlarına dönüştürülmeli (en az: varsayılan lokal + açık lokal çifti, A-2'yi kalıcı ölçmek için), ya da gerekçe bugünkü GERÇEK sebeple değiştirilmeli. Aynı bayat cümle `discover_keywords:126`'da da var — tek turda birlikte bakılmalı | |
| A-6 | P2 | Satıcı-yanı çıktı-tavanı yolu (`renderVendorLimitNote`, `vendorSideBudgets`, 18.000/9.000 bütçeleri) **canlıda hiç ölçülemedi**: iki özne de tek satır döndürdü. Yalnız birim testlerinde kanıtlı | H1 `limit: 25` → 1 satır; H2 `limit: 200` → 1 satır. Crawl-yanı tavanı ise ateşledi (50 basıldı / 49 basılmadı), yani mekanizmanın YARISI canlı doğrulandı | Ölçüm, satıcının çok satır döndürdüğü bir özneyle tekrarlanmalı — A-2 düzeltilirse doğru lokalde aynı siteler zaten çok satır döndürecek, yani tek çağrı iki bulguyu birden kapatabilir. **"Geçti" diye kapatılmamalı: bu kayıt onu ÖLÇMEDİ** | |
| A-7 | P2 | Seçilebilirlik: "my pages" adı "sayfalarım Search Console'da nasıl" sorusunu çekiyor ama tool GSC'ye hiç bakmıyor. Azaltıcılar güçlü ve ölçüldü (description'ın ilk cümlesi satıcıyı adlandırıyor; `WHAT_THE_VENDOR_RETURNS` her cevapta basılıyor), kalan risk yalnız ADIN kendisinde | Description `:191-202`; `WHAT_THE_VENDOR_RETURNS` `:349` — canlıda iki cevapta da basıldı. Referans listesinin kendisi de bu tuzağa düşmüştü (§5) | Kod değil **imza kalemi**: ad değişikliği (örn. `ranking_pages`) müşteri yüzeyini kırar. Alternatif ve ucuz olan: docs sayfasına "Bu tool Search Console verisi OKUMAZ — o soru `pull_gsc_data`'nın" diye bir yönlendirme satırı. İnsan imzası gerekir | |
