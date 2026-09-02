# `crawl_site` — tool kontrol kaydı (2026-09 turu)

> Dilim: 2 (crawl) · İşçi: Opus 4.8 (d2-crawl) · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, toplam Δ −40 kredi** (izin sınırı 2 çağrı / 40 kredi — tam sınırda).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `crawl-site.ts:281-389`; kredi `costs.ts:24` = `  crawl_site: 20,`; docs "**Cost:** 20 credits." — description ↔ mdx ↔ canlı JSON Schema üçü de tutuyor, tutarsızlık yok |
| 2 Mutasyon | ÖLÇÜLDÜ | 6 mutasyon: M1/M2/M3/M6 KIRMIZI · **M4 (robots Allow/Disallow beraberliği) ve M5 (robots 512 KiB tavanı) YEŞİL KALDI** — ikisi de R-3.2/R-3.5 ekseni |
| 3 Canlı negatif | ÖLÇÜLDÜ | 7 senaryonun 7'si doğru reddedildi, kredi Δ 0; **şema dışı anahtar artık reddediliyor** (`Unrecognized key: "depth"`, #204 canlıda) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı: 51 sayfa/138 atlanan (Δ −20) ve 1 sayfa (Δ −20). Devreden `queued`/`running` ölçümü §4'te |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 16 kural tek tek; **BAYAT KURAL YOK** (`priority`/`changefreq` hiç okunmuyor), ama R-3.14/R-3.21/R-4.9 eksenleri ölçülmüyor |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:46` `crawl_site: "action"`; `CARDED_TOOLS` yalnız `get_credit_balance`; canlı `tools/list` `_meta` taşımıyor, `tools/call` `structuredContent` taşımıyor (ikisi de ölçüldü) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi **VAR** (3 hücre) · `goals/` içinde crawl davranışını ölçen hedef **YOK** |

**Karar:** DÜZELTME GEREKLİ — ücretli yol uçtan uca doğru çalıştı ve para hikâyesi dürüst;
ama `get_job_status`'ın `queued` dalı belgelenen akışla **yapısal olarak erişilemez**, aynı proje
için ikinci bir crawl'u durduran **hiçbir koruma yok**, ve robots.txt'in iki temel ekseni
(beraberlik çözümü, ayrıştırma tavanı) hiçbir testin bakmadığı yerde duruyor.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/crawl-site.ts:281-389` (`makeCrawlSiteTool`; `defineTool` 286,
  `handler` 298, üretim örneği `crawlSiteTool` 392)
- Kayıt: `apps/mcp/src/tools/index.ts:7` (import), `:65` (export), `:171` (araç dizisi)
- Yardımcılar: `crawl-seeds.ts` (opt-in DFS tohumlama), `crawler/crawl.ts` (tarayıcı),
  `queue/boss.ts:98-147` (`enqueueJob`), `queue/handlers/crawl.ts` (işçi tarafı),
  `packages/core/src/guide/crawl-summary.ts` (özet cümlesi)
- Zod şeması (alanlar, kısıtlar), satır 100-127 — canlı JSON Schema ile birebir doğrulandı:
  - `project_id`: `z.uuid()` — **tek zorunlu alan** (canlı `"required": ["project_id"]`)
  - `max_urls`: `z.number().int().min(1).max(PAGE_CAP).default(PAGE_CAP)` — `PAGE_CAP = 100` (satır 54)
  - `include_paths`: `z.array(z.string().min(1)).optional()`
  - `seed_from_ranking_pages`: `z.boolean().default(false)`
  - `confirm`: **şemada YOK**, `confirmsInHandler: true` (satır 297) sayesinde `tools/list`'e
    `defineTool` tarafından enjekte ediliyor; canlı şemada var (ölçüldü)
  - Canlı şema `"additionalProperties": false` taşıyor — `registry.ts:490` `schema.strict()`
    (38 şemanın tek yerden sıkılaştırılması, #204)
- Description (birebir alıntı):
  > Crawl a project's website (async). Returns a job_id immediately; poll it with get_job_status. Costs 20 credits, charged when the crawl runs.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:24`, birebir): `  crawl_site: 20,`
  Tohumlamanın ayrı satırı (`costs.ts:59`, birebir): `  my_pages: 40,` —
  `crawl-seeds.ts:63` `export const SEED_CHARGE_CREDITS = TOOL_COSTS[SEED_CHARGE_TOOL];`
  (literal değil, tablodan okunuyor — NEVER#6)
- Docs sayfası (`apps/web/content/docs/tools-reference/crawl-site.mdx`, birebir):
  > **Cost:** 20 credits.

  ve:
  > The crawl is charged only when it runs — a crawl that reaches no pages is not charged.

  ve:
  > Before queuing, `crawl_site` runs a quick, **free** size check, and any page count it quotes is a **lower bound** — "at least N pages", never "~N".
- Ücretlendirme kipi: `charge: "worker"` (satır 292). Yüzey defterine HİÇ dokunmuyor; tek
  20-kredilik rezerv/commit zinciri işçinindir (`queue/worker.ts` + `credits/guard.ts`).
  "Sayfa gelmezse ücret yok" iddiasının gerçek yeri: `queue/handlers/crawl.ts:372-384` —
  `result.pages.length === 0` ise `PreconditionNotMetError` **fırlatılıyor**, guard rezervi
  serbest bırakıyor, iş `failed` oluyor. İddia kodda karşılığı olan bir iddia.
- Tutarsızlıklar: **yok**. Karşılaştırılanlar: description ↔ mdx frontmatter (birebir) ↔ canlı
  `tools/list` description (birebir); dört alanın `describe()` metni ↔ mdx Input tablosu (birebir)
  ↔ canlı JSON Schema (birebir); `costs.ts` 20 ↔ mdx "**Cost:** 20 credits." ↔ ölçülen Δ −20;
  `SEED_CHARGE_CREDITS` 40 ↔ description içindeki "40 credits" ↔ mdx "(40 credits, its own ledger line)".
- Seçilebilirlik: "Crawl my example.com project", "sitemi tara", "sayfalarımı çek" — komşusu YOK
  denecek kadar ayrık; tek gerçek karışma riski **`audit_tech`/`audit_onpage`** ("sitemi analiz et"):
  ikisi de crawl_site'ın sonucunu OKUR, kendileri taramaz. `get_job_status`'ın kendi cevabı bu
  sırayı öğretiyor ("run audit_onpage, audit_tech or audit_schema") — canlıda ölçüldü.
  İkinci risk: model `confirm`'ü **prompt görmeden** gönderirse ön-keşif atlanır ve müşteri
  büyük-site uyarısını hiç görmez (şema `confirm`'ü serbestçe kabul ediyor; §4'te bilerek yapıldı).

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `pnpm --filter @pseo/mcp exec vitest run src/tools/crawl-site.test.ts
src/tools/crawl-seeds.test.ts src/crawler/crawl.test.ts src/crawler/robots.test.ts
src/crawler/sitemap.test.ts src/queue/handlers/crawl.test.ts`.
Taban: **230 passed / 6 files**. `crawl-site.db.test.ts`, `crawl-pages.db.test.ts`,
`crawl.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | **Tohum üretimi** — `crawl-seeds.ts:145` ayırıcı zorunluluğu kaldırıldı: `key.startsWith(`${originKey}/`)` → `key.startsWith(`${originKey}`)` | `example.community/x`'i `example.com` sanan satırı yakalayan test | **KIRMIZI** (1 test) | `rankingSeedCandidates … > counts a subdomain, another domain and an unkeyable address as off-site`: `expected [] to equal [ "https://example.com/munity/a" ]` — kaynağın satır 142'deki yorumu ("so `example.community/x` cannot pass as `example.com`") testte karşılığı olan bir yorum |
| M2 | **Kredi iade yolu** — `crawl-seeds.ts:266-270` `throw new NoUsableSeedsError(...)` → aynı değerin `return`'ü (guard dönen callback'i COMMIT eder) | boş tohumlamanın ücretsiz olduğunu ölçen test | **KIRMIZI** (2 test) | `fetchRankingSeeds — nothing delivered, nothing charged`: `expected 'seeded' to be 'empty'`. Testler yalnız `kind`'a bakmıyor — `creditsCharged` 0, `credits.charged` 0 ve `credits.released` 1 de pinli (`crawl-seeds.test.ts:230-236`). İade yolunun nöbetçisi GERÇEK |
| M3 | **Büyük-site istemi eşiği** — `crawl-site.ts:349` `projection.credits > CONFIRMATION_THRESHOLD_CREDITS` → `… * 1000` (istem hiç ateşlenmez) | onay istemini ölçen testler | **KIRMIZI** (4 test) | `fires confirmation for a very large site (unconfirmed): NOT enqueued…` + `HONESTY: states the real 20-credit charge…` + `confirms just above the boundary (1100 pages -> 220 credits projected)` + `does NOT buy seeds for a call that returns the large-site confirmation`. Sınırın hemen üstü (1100 sayfa) ayrıca pinli — eşik kaydırması yakalanır |
| **M4** | **robots beraberlik çözümü** — `crawler/robots.ts:114` `return allow >= disallow;` → `return allow > disallow;` (eşit uzunlukta Allow/Disallow çakışmasında **Disallow kazanır**) | R-3.5 / RFC 9309 "çakışmada en az kısıtlayıcı kural kazanır" | **YEŞİL KALDI** | `robots.test.ts` + `crawl.test.ts` → **164/164 passed**. Kaynağın kendi yorumu (satır 113) "a tie resolves in favour of Allow" diyor; hiçbir test bunu ölçmüyor. Site sahibinin AÇIKÇA izin verdiği bir yol sessizce atlanır ve müşteri 20 krediyi daha küçük bir tarama için öder |
| **M5** | **robots ayrıştırma tavanı** — `crawler/crawl.ts:714` `MAX_ROBOTS_BYTES = 512 * 1024` → `= 64` (robots.txt'in ilk 64 baytından sonrası yok sayılır) | R-3.2 / RFC 9309 §2.5 tavanı | **YEŞİL KALDI** | `crawl.test.ts` + `handlers/crawl.test.ts` → **171/171 passed**. robots.txt kesilmesini ölçen **hiçbir test yok**: tavan bir gün düşerse Disallow'lu URL'ler taranır ve kapı hiçbir şey söylemez |
| M6 | **crawl-delay uygulaması** — `crawler/crawl.ts:1576` `Math.min(robots.crawlDelayMs, crawlDelayCapMs)` → `0 * Math.min(...)` | nezaket gecikmesini ölçen test | **KIRMIZI** (1 test) | `crawlSite — bounded parallel fetching > stays STRICTLY sequential when robots sets a Crawl-delay (politeness is not negotiable)`: `expected 4 to be 1` — eşzamanlılığın 1'e düşmesi pinli |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). **M4 ve M5 benim hipotezlerimdi**, iş emrinin
önerdiği üç eksen (M1 tohum, M2 iade, M3 eşik) üçü de kırmızı verdi — yani iş emrinin hipotezi bu
kez doğru çıktı, ama **kapının kör noktası başka yerdeydi**: robots.txt'in kendisi. İkisi de
5. adımın (SEO güncelliği) tam merkezindeki iki kural: R-3.2 ve R-3.5.

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**; kapı yeniden **230/230 passed**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (basılmadı). Bakiye önce/sonra **4519 sabit** — yedi negatif senaryonun
hiçbiri kredi harcamadı ve hiçbiri iş kuyruğuna satır açmadı (`crawl-site.ts:306-323`, iki reddin
de `enqueue`'dan ÖNCE dönmesi).

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| geçersiz project_id (rastgele uuid) | `{"project_id":"00000000-0000-4000-8000-000000000000"}` | 200, `isError: true` | **0** | `No project found with id 00000000-0000-4000-8000-000000000000. Create one with setup_project first. You were not charged.` — varlık sızdırmıyor, ücretsizliği kendisi söylüyor |
| bozuk id | `{"project_id":"not-a-uuid"}` | 200, `isError: true` | **0** | `Invalid input for "crawl_site": ✖ Invalid UUID` / `  → at project_id You were not charged.` |
| **şema dışı anahtar** | `{"project_id":"e2785bf7-…","depth":3}` | 200, `isError: true` | **0** | `Invalid input for "crawl_site": ✖ Unrecognized key: "depth" You were not charged.` — **#204 canlıda doğrulandı**; sessiz yutma YOK |
| arşivli proje | `{"project_id":"77f40d69-…"}` (Dilim 1'in arşivlediği proje) | 200, `isError: true` | **0** | `That project is archived, so it is not being tracked right now. Restore it with setup_project for the same domain — … — or from the Connection page in SeoGrep. You were not charged.` — sahiplik kapısından SONRA (satır 321), başka kiracının arşivlisi "yok" ile ayırt edilemez kalıyor |
| max_urls alt sınır altı | `{"project_id":"e2785bf7-…","max_urls":0}` | 200, `isError: true` | **0** | `✖ Too small: expected number to be >=1` `→ at max_urls` |
| max_urls üst sınır üstü | `{"project_id":"e2785bf7-…","max_urls":101}` | 200, `isError: true` | **0** | `✖ Too big: expected number to be <=100` `→ at max_urls` — `PAGE_CAP` tek kaynak (satır 54) |
| boş include_paths elemanı | `{"project_id":"e2785bf7-…","include_paths":[""]}` | 200, `isError: true` | **0** | `✖ Too small: expected string to have >=1 characters` `→ at include_paths[0]` |
| **aynı proje için ikinci crawl, ilki koşarken** | — | — | — | **ÖLÇÜLEMEDİ — bütçe.** İki eşzamanlı crawl = 2 ücretli çağrı = 40 kredi, ve o iki çağrı mutlu yola harcandı; üçüncü çağrı izin sınırının dışında. **Statik olarak ÖLÇÜLDÜ ve koruma YOK** (B-1) |

Not (B-8): iki cümle **ayırıcısız** birleşiyor — `→ at project_id You were not charged.`
Aynı aile 2026-08-27 turundaki F-6 (`get_job_status` çift nokta) ile aynı: cümle birleştirme
tek yerden yapılmıyor.

## 4. Canlı mutlu yol

Özne: **adstark.com.tr** (`project_id: e2785bf7-9963-4b6a-a6d7-aaed7b550abe`, `list_projects`
canlı çıktısından). Bakiye: **4519 → 4499 → 4479**, toplam **Δ −40**, **2 ücretli çağrı**.

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| Ç1 tam site (onaysız) | `{"project_id":"e2785bf7-…"}` | 200, text, **9032 ms** | **−20** | `Crawl queued for adstark.com.tr. job_id: 6f8e3fb6-… · status: queued · estimated_credits: 20. Track it with get_job_status { "job_id": "6f8e3fb6-…" }.` — **"At least N pages discovered" cümlesi YOK**: `projectFullCrawl` null döndü, yani 8 sn'lik ücretsiz boyut kontrolü bu alan adında hiçbir şey üretmedi (B-5) |
| Ç1 bitiş | poll #15 (+113,8 sn) | 200 | 0 | `Job 6f8e3fb6-… (crawl_site) succeeded. created … · started … · finished … · took 1m 31s · project: adstark.com.tr. Crawled 51 page(s), skipped 138, 9 issue(s) found (mostly: time budget exhausted after 91s — the crawl stopped on TIME, not at the 100-page limit (51 page(s) crawled); coverage varies between runs at the same price, so re-run, or narrow the crawl with include_paths to cover a section fully). Its result is ready to analyze — run audit_onpage, audit_tech or audit_schema.` |
| Ç2 dar kapsam + `confirm` | `{"project_id":"e2785bf7-…","max_urls":5,"include_paths":["/iletisim"],"confirm":true}` | 200, text, **851 ms** | **−20** | `Crawl queued for adstark.com.tr. job_id: 53907ab7-… · status: queued · estimated_credits: 20. …` — `confirm:true` ön-keşfi ATLIYOR (`crawl-site.ts:336-342`): **9032 ms → 851 ms**, ölçülmüş fark ~8,2 sn |
| Ç2 bitiş | poll #5 (+16,9 sn) | 200 | 0 | `Job 53907ab7-… (crawl_site) succeeded. … took 12.2s · project: adstark.com.tr. Crawled 1 page(s), skipped 0, 0 issue(s) found. Its result is ready to analyze — run audit_onpage, audit_tech or audit_schema.` — 1 sayfa için de düz 20 kredi (fiyat sayfa başına değil, tasarım böyle) |

**Sonuç özetinin İÇERİĞİ** (iş emrinin sorduğu üç kalem):
- **sayfa sayısı** — ÖLÇÜLDÜ: var (`Crawled 51 page(s), skipped 138`), ve baskın atlama sebebi
  adıyla veriliyor.
- **durum kodları** — **YOK.** `PageRecord.status` kaydediliyor (`crawl.ts:1830`) ama özet
  cümlesi (`packages/core/src/guide/crawl-summary.ts:43-47`) yalnız sayfa/atlanan/sorun sayıyor.
  Dahası `computeIssues` (`crawl.ts:669-678`) **200 dışı bir durumu sorun saymıyor**: başlığı ve
  meta açıklaması olan bir 404/410 HTML sayfası "0 issue" ile **taranmış sayfa** olarak sayılır (B-7).
- **robots/sitemap bulguları** — **YOK.** robots.txt ve sitemap okunuyor (`crawl.ts:1295-1303`,
  `1578-1600`), sitemap URL'leri sonuca yazılıyor (`CrawlResult.sitemapUrls`, en çok 500),
  ama müşteriye giden hiçbir cümlede robots ya da sitemap bulgusu yok — bunlar ancak ayrı ve
  **ücretli** `audit_tech` üzerinden okunabiliyor (B-7).

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim2/d2-crawl/probe.jsonl`
(44 kayıt, anahtar `makeRedactor(process.env.MCP_SMOKE_URL)` ile redakte).

### Devreden ölçüm — `get_job_status` / `list_jobs` `queued` ve `running` dalları

Dilim 1'in açık kalemi (`list_jobs.md` B-3, `get_job_status.md`): iki durum yalnız birim
testinde kanıtlıydı. Bu turda **crawl koşarken canlıda ölçüldü**. Aşağıdaki cümleler birebirdir.

**`running` — ÖLÇÜLDÜ, iki tool'da da.**

- `get_job_status`, ilerleme SATIRI OLMADAN (ilk toplu yazımdan önce, +9,0 sn):
  > Job 6f8e3fb6-be62-428a-a023-b80f07923a2a (crawl_site) is running. created 2026-09-02T14:23:19.866216+00:00 · started 2026-09-02T14:23:20.525+00:00 · project: adstark.com.tr.
- `get_job_status`, ilerleme SATIRI İLE (+21,2 sn; sonra 24,8 sn'de aynı damgayla tekrarladı,
  29,4 · 35,2 · 50,9 · 66,5 · 82,1 · 97,8 sn'de sırasıyla 7 → 11 → 19 → 31 → 39 → 47 sayfaya çıktı):
  > Job 6f8e3fb6-be62-428a-a023-b80f07923a2a (crawl_site) is running. created 2026-09-02T14:23:19.866216+00:00 · started 2026-09-02T14:23:20.525+00:00 · project: adstark.com.tr. 3 page(s) crawled, 1 skipped so far (as of 2026-09-02T14:23:32.515Z).
- `list_jobs` satırı (aynı anda, `{"limit":3}`):
  > - crawl_site — running · created 2026-09-02T14:23:19.866216+00:00 · project: adstark.com.tr · job_id: 6f8e3fb6-be62-428a-a023-b80f07923a2a

  Not: `running` satırında `finished` damgası ve süre **yok** — biten satırlarla aynı listede
  ayrımı bu kuruyor. mdx'in "a job that is working and a job that is stuck no longer look alike"
  iddiası doğrulandı: ilerleme sayacı gerçekten ilerliyor (3 → 47), damga da ilerliyor.

**`queued` — `list_jobs`'ta ÖLÇÜLDÜ, `get_job_status`'ta ÖLÇÜLEMEDİ (yapısal).**

- `list_jobs` satırı, ikinci çağrının **uçuşu sırasında** eşzamanlı yoklamayla, +586 ms:
  > - crawl_site — queued · created 2026-09-02T14:26:47.506514+00:00 · project: adstark.com.tr · job_id: 53907ab7-db2a-43cf-bdd6-fedb271f4636

  (+1221 ms'de aynı satır `running`'e döndü — pencere **~635 ms**.)
- `get_job_status`'ın `queued` cümlesi **ÖLÇÜLEMEDİ**, ve sebebi bir zamanlama şansızlığı değil:
  - `jobs` satırı `status: "queued"` ile INSERT ediliyor (`queue/boss.ts:105-110`), pg-boss'a
    gönderim ondan SONRA (satır 126).
  - Ölçüm: satır **14:26:47.506**'da yaratıldı, işçi **14:26:48.068**'de aldı → **562 ms**.
  - `crawl_site` çağrısı ise `job_id`'yi çağırana **851 ms**'de döndürdü (ve `confirm:true` ile
    ön-keşif ATLANMIŞ hâliyle; onaysız Ç1'de bu süre **9032 ms** idi).
  - Yani belgelenen akışta çağıran `job_id`'yi eline aldığında iş **her zaman** çoktan `running`.
    `get_job_status`'ın `queued` dalı ancak işçi MEŞGULKEN görülebilir — bu tur ölçülemedi, çünkü
    iki eşzamanlı crawl üçüncü bir ücretli çağrı isterdi (B-2).
- `crawl_site`'ın kendi cevabı yine de `· status: queued ·` diyor, ve mdx "A `job_id`, a `status`
  of `queued`" diye söz veriyor — **doğru**, ama takip aracının bir daha asla doğrulayamayacağı
  bir durum. Dilim 1'in B-3'ü bununla **yarı kapanır**: `list_jobs` tarafı kapandı,
  `get_job_status` tarafı açık ve nedeni artık ölçülmüş.

## 5. SEO güncelliği

Kaynak: `apps/mcp/src/crawler/**` + `apps/mcp/src/tools/crawl-site.ts` + `crawl-seeds.ts`.
Referans satırı: `crawl_site | R-3.1–R-3.8, R-3.11–R-3.14, R-3.18, R-3.21, R-4.9 | 500 KiB
robots.txt sınırı ve crawl-delay'in Google'da geçersizliği; priority/changefreq üretmek`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-3.1 RFC 9309 | `robots.ts:1-7` kendini "Minimal robots.txt parser … not spec-complete" ilan ediyor; grup seçimi, Allow/Disallow, `*`/`$`, Crawl-delay modelleniyor | **UYUYOR (bildirilmiş sınırla)** | `crawl.ts:707` RFC 9309 §2.5'i adıyla anıyor. Spec-dışı bırakılanlar (ör. `Sitemap:` direktifi robots'tan okunmuyor — sitemap `/sitemap.xml`'den deneniyor) bir bulgu değil ama kayıtta dursun |
| **R-3.2** robots **500 KiB** sınırı | `crawl.ts:714` `MAX_ROBOTS_BYTES = 512 * 1024` (= 512 KiB ≥ 500 KiB) ve `readCappedText` fazlasını **iptal ediyor** | **UYUYOR** — ama **korumasız** | **M5**: tavan 64 bayta düşürüldüğünde 171/171 test yeşil. Uyum kodda var, kapıda yok |
| R-3.3 robots 24 s cache | Tarayıcı her crawl'da robots.txt'i **yeniden** çekiyor (`crawl.ts:1295-1303`); cache yok | **İLGİSİZ (ölçülerek)** | Bayatlık riski yok; ama müşteriye "robots değişikliğin Google'a 24 saate kadar yansır" diyen bir cümle de yok — o `audit_tech`'in alanı |
| **R-3.4** `crawl-delay` Google'da **geçersiz** | `robots.ts:97-100` Crawl-delay'i AYRIŞTIRIYOR; `crawl.ts:1576` 1 sn tavanla UYGULUYOR; `crawl.ts:1701` eşzamanlılığı **1'e** düşürüyor | **KISMEN** | İki ayrı şey: (a) **kendi botumuz** için nezaket — doğru ve M6 ile kapıda korumalı; (b) **müşteriye söylenen** — hiçbir yerde "Google `crawl-delay`'i desteklemez" denmiyor, ve crawl-delay'li bir sitede kapsamın neden düştüğü de söylenmiyor. Tool `crawl-delay`'i **bulgu diye raporlamıyor**, yani BAYAT değil; eksik olan açıklama |
| R-3.5 en spesifik / beraberlikte **en az kısıtlayıcı** | `robots.ts:110-114` `longestMatch` + `return allow >= disallow;` (yorum: "a tie resolves in favour of Allow") | **UYUYOR** — ama **korumasız** | **M4**: `>=` → `>` yapıldığında 164/164 test yeşil. Kuralın kendisi doğru yazılmış, hiçbir test bakmıyor |
| R-3.6 disallow ≠ noindex | Robots'la bloklu URL `blocked by robots.txt` sebebiyle atlanıyor (`crawl.ts:1807-1809`) | **İLGİSİZ** | "Bloklu URL yine de snippet'siz indekslenebilir" bir tarama değil bir **teşhis** ifadesi; `audit_tech`/`my_pages`'in alanı |
| R-3.7 sitemap **50 MB / 50.000 URL** | `sitemap.ts:61` `MAX_SITEMAP_LOCS = 50_000` (**birebir uyuyor**); `crawl.ts:713` `MAX_SITEMAP_BYTES = 8_000_000` (8 MB < 50 MB) | **KISMEN — gerekçeli AYKIRI** | Gerekçe kaynakta yazılı (`crawl.ts:702-707`): "the sitemaps.org 50 MB file limit is deliberately NOT honoured on a shared 512 MB machine". Yalnız XML/index okunuyor; RSS/Atom/text formatları desteklenmiyor (`sitemap.ts:75` `<sitemapindex>`/`<urlset>`). En çok 5 alt sitemap (`MAX_CHILD_SITEMAPS`) |
| **R-3.8** Google `<priority>`/`<changefreq>`'i **yok sayar** | `parseSitemap` (`sitemap.ts:68-76`) YALNIZ `<loc>` okuyor | **UYUYOR (ölçülerek)** | Ölçüm: `grep -rn "priority\|changefreq\|lastmod" apps/mcp/src/crawler/` → **hiç eşleşme yok**. Referans listesinin bu tool için adlandırdığı asıl risk ("`priority`/`changefreq` üretmek") bu tool'da **karşılıksız**: üretilmiyor, saklanmıyor, raporlanmıyor. `<lastmod>` de okunmuyor |
| R-3.11 crawl → **render** → index | Render adımı YOK. `page-signals.ts:8-11`: "scripts not executed, JS-injected content invisible" | **AYKIRI (bildirilmiş)** | Kaynak dürüst, **müşteriye giden hiçbir cümle bunu söylemiyor**. JS ile basılan bir başlık "missing title" olarak sayılır ve `issues`'a girer |
| R-3.12 evergreen Chromium; bloklu JS/CSS render edilmez | Hiç tarayıcı yok; tek `fetch`, `accept: text/html,application/xhtml+xml` (`crawl.ts:1068`) | **AYKIRI (bildirilmiş)** | JS/CSS'in robots ile bloklu olup olmadığı hiç bakılmıyor |
| R-3.13 canonical **JS ile değil HTML'de** | `canonical` yalnız HTML'den okunuyor (`parseHtml`) | **UYUYOR — ama ters yönde yanlış pozitif** | JS ile konan canonical'ı Google GÖRÜR (render eder), biz görmeyiz → "canonical yok" diye bir kayıt üretiriz. Kuralla aynı yönde ama nedeni farklı |
| **R-3.14 mobile-first indexing** | Tek UA: `crawl.ts:683` `USER_AGENT = "SeoGrepBot/1.0 (+https://seogrep.com/docs)"`. Mobil varyant yok, ikinci geçiş yok | **AYKIRI** | Ölçüm: `grep -rn "viewport" apps/mcp/src/crawler/` → **hiç eşleşme yok**; `<meta name="viewport">` toplanmıyor bile. "Mobil ile masaüstü eşdeğer mi" sorusu bu tarama verisinden **cevaplanamaz**, ve tool bunu söylemiyor |
| R-3.18 crawl capacity / kalıcı silinenler **404/410** | `PageRecord.status` saklanıyor (`crawl.ts:1830`); `computeIssues` (`crawl.ts:669-678`) yalnız title / meta description / çoklu h1 / noindex'e bakıyor | **AYKIRI** | 200 dışı durum **sorun sayılmıyor**; 404 ile 410 ayrımı hiçbir yerde yapılmıyor. Kapasite tarafı: 90 sn'lik sabit bütçe (`DEFAULT_TIME_BUDGET_MS`) sunucu sağlığına göre uyarlanmıyor — canlıda 91 sn'de bağladı |
| **R-3.21 Googlebot token'ları** | `robots.ts:9` `BOT_TOKEN = "seogrepbot"`; grup seçimi `groups.get("seogrepbot") ?? groups.get("*")` (satır 104) | **AYKIRI (ölçüm boşluğu)** | Ölçüm: `grep -rni "googlebot\|google-extended\|gptbot\|claudebot" apps/mcp/src/crawler/` → yalnız `robots.test.ts:36`, o da **negatif** vaka (googlebot grubunun SEÇİLMEDİĞİ test). `User-agent: Googlebot` altında `Disallow: /` yazan bir site bizim crawl'ımızda **sorunsuz** taranır ve müşteri Googlebot'a kapalı olduğunu **hiç öğrenmez** |
| **R-4.9 görsel SEO** (alt text, dosya adı, image sitemap, **AVIF** dahil formatlar) | `page-signals.ts` yalnız `imgCount` ve `imgMissingAlt` sayıyor; `ogImage` yazıldığı gibi saklanıyor | **KISMEN** | Ölçüm: `grep -rn "avif\|AVIF\|image/webp\|imageSitemap" apps/mcp/src/crawler/ apps/mcp/src/tools/crawl-site.ts` → **hiç eşleşme yok**. Format, dosya adı ve image sitemap eksenlerinin **hiçbiri** ölçülmüyor. `alt=""` bilerek "eksik" sayılıyor ve bu **kaynakta yazılı** ("KNOWN, DELIBERATE FALSE POSITIVE", `page-signals.ts:83-86`) — dürüst bir sapma |

**Bayat kural taraması sonucu: BAYAT KURAL YOK.** Referansın bu tool için adlandırdığı iki
riskten biri (`priority`/`changefreq` üretmek) ölçülerek karşılıksız çıktı; diğeri
(`crawl-delay`'in Google'da geçersizliği) bir **bulgu olarak raporlanmadığı** için bayatlayamıyor.
Bu tool'un SEO borcu bayat kural değil, **ölçülmeyen eksen**: mobil, Googlebot token'ları,
durum kodları ve görsel formatları.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR ama sevk edilmemiş** — satır 46 `crawl_site: "action"`;
`CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` içeriyor.
Canlıda ölçüldü: `tools/list` girişi yalnız `{name, description, inputSchema}` taşıyor —
**`_meta` yok**; iki `tools/call` cevabının da `result` anahtarları yalnız `["content"]` —
**`structuredContent` yok**.
Planlanan `action` kartının bekleyeceği alanlar (job_id, status, estimated_credits, domain)
canlı METİNDE var ve makine-okunur biçimde (`job_id: <uuid> · status: queued ·
estimated_credits: 20`) ama **yapılı kanalda yok**; bugün bir istemci onları ancak
düzenli ifadeyle söker (`scripts/testing/runner.mjs:123`'ün `parseJobId`'sinin yaptığı da tam olarak bu).

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `plan.mjs:71` (`ID_TOOLS`:
  `{ tool: "crawl_site", idArg: "project_id", targetArg: null }`) ve **üç hücre**: `:267` (K1/S1,
  kampanya siteleri), `:272` (K1/S6a, `max_urls: 1`), `:273` (K1/S5, **"does a second identical
  crawl charge again"**, adstark). Sweep öz-testi bugün **7/7 PASS**, "38 live tools accounted for
  (22 planned + 16 excluded)". **S5 hücresi B-1'in tam sorusudur ve hiç koşulmamıştır** —
  `verify.sh` yalnız öz-testi koşar, canlı sweep'i asla.
- `goals/` hedefi gerekli mi: **EVET** — bugün `goals/` altında crawl_site'ın DAVRANIŞINI ölçen
  hiçbir hedef yok (`grep -rn "crawl_site" goals/` → hiç eşleşme yok; `trial-flow-e2e.md:5`
  yalnız düzyazıda "crawl→audit→rapor" zincirini anıyor). Değeceği iki predicate:
  (a) **çift kuyruk** — aynı proje için iş kuyrukta/koşuyorken açılan ikinci işin ne yaptığı;
  (b) **robots ekseni** — M4/M5'in yeşil kaldığı iki kuralın (beraberlik çözümü, ayrıştırma
  tavanı) makine-kontrollü olarak kırmızıya dönebilmesi. İkincisi `goals/` yerine doğrudan
  `crawler/robots.test.ts`'e iki test olarak da inebilir; kapı kapsamı açısından fark yok.

## Bulgular

| # | şiddet | durum | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) |
|---|---|---|---|---|---|
| B-1 | **P1** | AÇIK | **Çift kuyruk koruması YOK.** `enqueueJob` koşulsuz INSERT ediyor; `crawl_site` handler'ı aynı proje için `queued`/`running` bir iş olup olmadığına **bakmıyor**. İkinci istek ikinci işi açar ve işçi ikinci 20-kredilik rezervi de bağlar — müşteri aynı taramayı iki kez öder | `queue/boss.ts:98-147` (dedupe/singleton anahtarı yok) + `crawl-site.ts:373-384` (ön kontrol yok). Canlı doğrulama bütçe nedeniyle ÖLÇÜLEMEDİ; `plan.mjs:273` bu senaryoyu adıyla planlıyor ("does a second identical crawl charge again") ve hiç koşulmamış | Ya (a) aynı `project_id` için terminal olmayan bir iş varken yeni isteğin mevcut `job_id`'yi döndürmesi ("bu proje için zaten bir crawl koşuyor: <job_id>"), ya (b) `confirm` isteyen bir istem. Sessizce ikinci kez ücretlendirmek en kötüsü. Kapatmadan önce **S5 hücresi canlıda koşulmalı** — koruma yokluğu statiktir, DAVRANIŞ ölçülmemiştir |
| B-2 | **P1** | AÇIK | **`get_job_status`'ın `queued` dalı belgelenen akışla yapısal olarak erişilemez.** İş 562 ms'de işçiye geçiyor, `crawl_site` `job_id`'yi 851 ms'de (onaysız yolda 9032 ms'de) döndürüyor. Çağıran `job_id`'yi eline aldığında iş her zaman `running`. Yani `crawl_site`'ın ve mdx'in söz verdiği `status: queued`, takip aracıyla **hiçbir zaman** doğrulanamaz | §4 "Devreden ölçüm": created 14:26:47.506 · started 14:26:48.068 · çağrı dönüşü 851 ms. `list_jobs` eşzamanlı yoklamayla `queued`'i +586 ms'de gördü (pencere ~635 ms) | Üç seçenek: (a) `queued` cümlesinin yalnız işçi meşgulken görüldüğünü **docs'ta söylemek**; (b) `crawl_site`'ın cevabındaki `status: queued` yerine "queued — a worker usually picks it up within a second" gibi ömrü belli bir ifade; (c) `queued` dalını üretim akışında ölçebilen bir kapı (iki eşzamanlı iş). Dilim 1'in B-3'ü **`list_jobs` tarafında KAPANDI**, `get_job_status` tarafında açık kalıyor |
| B-3 | **P1** | AÇIK | **robots.txt beraberlik çözümü korumasız.** Eşit uzunlukta Allow/Disallow çakışmasında Disallow'u kazandıran mutasyon 164/164 testi yeşil bıraktı. R-3.5 / RFC 9309 en az kısıtlayıcıyı ister; kaynak doğru yazılmış, hiçbir test bakmıyor. Bozulursa: site sahibinin açıkça izin verdiği yollar sessizce atlanır, müşteri daha küçük bir taramaya 20 kredi öder | M2 tablosu M4 (`robots.ts:114`) | `robots.test.ts`'e tek bir test: `Disallow: /a` + `Allow: /a` → `/a` izinli. Üç satır, ve şu an kapının göremediği tek kural |
| B-4 | **P1** | AÇIK | **robots.txt ayrıştırma tavanı korumasız.** `MAX_ROBOTS_BYTES` 512 KiB'den 64 bayta düşürüldüğünde 171/171 test yeşil kaldı — robots.txt'in kesilmesini ölçen hiçbir test yok. R-3.2'nin tam ekseni | M2 tablosu M5 (`crawl.ts:714`) | Tavanın ÜSTÜNDE kural taşıyan bir robots.txt fixture'ı ile tek test: kesilen kısımdaki `Disallow` uygulanmıyor VE bu bir atlama sebebi olarak görünüyor. Bugün sessizce taranır |
| B-5 | P2 | AÇIK | **Ücretsiz ön-keşif 8,2 sn'ye mal oldu ve hiçbir şey üretmedi.** adstark.com.tr'de `projectFullCrawl` null döndü; cevap "At least N pages discovered" cümlesini hiç taşımadı. Müşteri `job_id`'yi 9 saniye bekledi, karşılığında ek bir bilgi almadı | Ç1 9032 ms vs Ç2 (`confirm:true`, ön-keşif atlanır) 851 ms; Ç1 cevabında projeksiyon cümlesi yok. `PRE_DISCOVERY_BUDGET_MS = 8_000` (`crawl.ts:2045`) | Ön-keşfin null döndüğünü **söylemek** ("we could not size this site before queuing"), ya da bütçeyi düşürmek. Bugün sessiz bir 8 saniye: çağıran ne beklediğini de, neden bir şey almadığını da bilmiyor |
| B-6 | P2 | AÇIK | **90 sn'lik zaman bütçesi 100 sayfalık tavandan ÖNCE bağlıyor.** Canlıda 51 sayfa tarandı, 138 atlandı; baskın sebep "time budget exhausted after 91s". Şema ve docs "up to 100 pages" diyor; aynı 20 kredi için teslim edilen 51 | Ç1 bitiş cümlesi (§4) | Cevabın kendisi bunu dürüstçe söylüyor ("coverage varies between runs at the same price") — bu iyi. Eksik olan **beklentinin önden kurulması**: `max_urls`'in açıklaması ve mdx "up to 100 pages" derken zaman bütçesini hiç anmıyor. Öneri: `max_urls` açıklamasına ve mdx'e bir cümle |
| B-7 | P2 | AÇIK | **Durum kodları, robots ve sitemap bulguları müşteriye HİÇ ulaşmıyor.** Özet yalnız sayfa/atlanan/sorun sayıyor. 200 dışı durum sorun sayılmıyor: başlıklı bir 404 sayfası "0 issue" ile "taranmış sayfa" olur (R-3.18) | `crawl-summary.ts:43-47` (özet cümlesi) + `crawl.ts:669-678` (`computeIssues`) + `crawl.ts:1830` (status saklanıyor ama kullanılmıyor) | `computeIssues`'a tek bir kural: `status !== 200` → `issues`'a girsin (`"404 not found"` / `"410 gone"` ayrı adlarla). Bu tek satır R-3.18'i ölçülebilir kılar ve 20 kredilik taramanın çıktısını ücretli `audit_tech`'e bağımlı olmaktan çıkarır |
| B-8 | P2 | AÇIK | **Hata cümleleri ayırıcısız birleşiyor:** `→ at project_id You were not charged.` Yedi negatif senaryonun beşinde aynı biçim | §3 tablosu | 2026-08-27'deki F-6 ile aynı aile (o da noktalama birleştirmesiydi). Öneri: `withNoChargeNote`'un birleştirmesi tek yerden yapılsın ve önceki parçanın sonuna göre boşluk/nokta eklesin |
| B-9 | P2 | AÇIK | **Kart planlı, sevk edilmemiş; yapılı kanal boş.** Canlı `tools/list` `_meta` taşımıyor, `tools/call` `structuredContent` taşımıyor. `job_id`/`status`/`estimated_credits` yalnız düz metinde, ve harness onları düzenli ifadeyle söküyor | `card-map.ts:46` + `CARDED_TOOLS` (satır 62) + canlı envelope ölçümü (§6) | Depo-geneli bir kalem (Dilim 1'in her kaydında da var). Bu tool'a özgü not: `action` kartının alanları zaten metinde makine-okunur; `structuredContent` eklendiğinde `runner.mjs:123`'ün `parseJobId` regex'i de emekli olabilir |
| B-10 | P2 | AÇIK | **R-3.14 ve R-3.21 eksenleri hiç ölçülmüyor ve bu söylenmiyor.** Tek masaüstü UA, mobil geçiş yok, `viewport` toplanmıyor bile; robots grup seçimi yalnız `seogrepbot`/`*` — `User-agent: Googlebot` altında `Disallow: /` yazan bir site sorunsuz taranır ve müşteri Googlebot'a kapalı olduğunu öğrenmez | §5 tablosu (iki grep ölçümü) | En ucuz kazanç R-3.21: robots.txt zaten indirilmiş durumda; `Googlebot` grubunun bizi değil **Google'ı** neyle kısıtladığını okuyup bir bulgu satırı üretmek ek istek gerektirmiyor. R-3.14 gerçek bir iş (ikinci geçiş / mobil UA) — kısa vadede docs'ta "this crawl is a single desktop pass and does not run JavaScript" demek yeterli |
| B-11 | P2 | AÇIK | **R-4.9'un format/dosya-adı/image-sitemap eksenleri yok.** Yalnız `imgCount` ve `imgMissingAlt`; AVIF/WebP/SVG desteği ya da image sitemap hiç bakılmıyor | §5 tablosu (grep: hiç eşleşme yok) | `alt=""` sapması kaynakta yazılı ve dürüst — dokunulmasın. Format ekseni `audit_onpage`'in işi olabilir; bu kayıt yalnız **crawl'ın o veriyi hiç toplamadığını** tespit ediyor: toplanmayan veri sonradan ücretsiz analiz edilemez |
