# `list_projects` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 (hesap ailesi) · İşçi: Opus 4.8 · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `list-projects.ts:351-389`; kredi `costs.ts:16` = `list_projects: 0,`; docs "**Cost:** Free (0 credits)." — uyumlu |
| 2 Mutasyon | ÖLÇÜLDÜ | M5 (defect #52: `account_id === null` → `false`) **YEŞİL KALDI**; M6 (`stripWwwLabel` kaldırıldı) KIRMIZI 4 test |
| 3 Canlı negatif | ÖLÇÜLDÜ | Tool'un hiç argümanı yok; verilen `limit`/`filter`/`include_archived` sessizce yutuldu, kredi Δ 0 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 18 izlenen + 1 arşiv proje, GSC üç durumu da göründü, 2 "aynı site" uyarısı, kredi Δ 0 |
| 5 SEO güncelliği | İLGİSİZ | Referans satır 209: `| list_projects | — (yalnız kiracı verisi) | Dış kural yok; risk yalnız iç şema |` |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:14` `"list"`; `CARDED_TOOLS` yalnız `get_credit_balance` |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:195` PLAN girişi VAR · `goals/` hedefi yok |

**Karar:** DÜZELTME GEREKLİ — çıktı doğru ve kredi Δ 0; ama defect #52'nin (bir kez canlıya çıkmış
bir hata) nöbetçisi `make verify`'ın koştuğu şeritte YOK, ve tool'un hiç sınırı/sayfalaması yok
(18 proje bugün; kardeş iki tool'da 50'lik tavan ve imleç var).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/list-projects.ts:351-389` (`handler` satır 365)
- Yardımcı okumalar: `readGscStates` satır 269-314 · `readLastJobs` satır 330-349
- Saf biçimlendirici: `formatProjectList` satır 240-247
- Kayıt: `apps/mcp/src/tools/index.ts:4,45,166`
- Zod şeması (alanlar, kısıtlar): `z.object({})` satır 364 — **hiç alan yok**. Canlı JSON Schema
  `{"type":"object","properties":{}}`; `additionalProperties` yok.
- Description (birebir alıntı):
  > List the website domains you are tracking (oldest first), each with its Search Console state and last job, plus any projects you have archived. Costs 0 credits.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:16`, birebir): `  list_projects: 0,`
- Docs sayfası (`apps/web/content/docs/tools-reference/list-projects.mdx`, birebir):
  > **Cost:** Free (0 credits).

  ve:
  > **If two tracked projects are mapped to the same Search Console property**, the reply names that property and both projects underneath the list. Each pull fetches one set of rows and is billed once per project, so the pair costs credits twice for the same data.
- Tutarsızlıklar:
  1. **Docs sayfası "aynı site" uyarısını hiç anlatmıyor.** Kaynakta iki ayrı uyarı üreteci var —
     `duplicatePropertyNotes` (satır 123) ve `sameSiteNotes` (satır 156) — ve canlı cevapta
     **yalnız ikincisi** ateşledi (`Heads up: 2 of your projects are the same site — …`).
     mdx yalnız birincisini anlatıyor. İkisi kasten bağımsız (kaynak satır 150-155), ama
     müşteriye görünen cümlelerden biri hiçbir sayfada yazılı değil.
  2. Uyumlu olanlar: description ↔ mdx frontmatter (birebir, maliyet cümlesi soyulmuş),
     "No parameters." ↔ boş şema, kredi 0 ↔ ölçülen Δ 0, "three states, never as a tick" ↔
     `ProjectGscState` üç varyantı ↔ canlı çıktının üç biçimi.
- Seçilebilirlik: "Which sites am I tracking?", "hangi siteleri izliyorum", "project_id'im ne" —
  net seçilir; ayrıca **`project_id`'yi veren tek yer** olduğu için hemen her diğer tool'un
  öncülü. Karışabileceği komşu: **`list_gsc_properties`** ("Search Console'da hangi mülkler var")
  ve **`whats_next`** ("ne yapmalıyım") — ikisinden de description düzeyinde ayrılıyor.
  Zayıf nokta: model bir siteyi aramak istediğinde `filter`/`limit` argümanı **uydurur**
  (şemada yok, sessizce yutuluyor — §3).

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `npx vitest run src/tools/{get-credit-balance,get-job-status,list-jobs,list-projects,list-credit-activity}.test.ts`.
Taban: **156 passed / 5 files**. `list-projects.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M5 | `list-projects.ts:305` `row.account_id === null ? …` → `false ? …` (defect #52'nin birebir geri gelişi: bağlantısı kopmuş proje "connected" okunur) | GSC durumunu pinleyen bir test | **YEŞİL KALDI** | 156/156 geçti. Hızlı şerit yalnız saf `formatProjectList`'i ve description'ı sürüyor; `readGscStates` hiç çağrılmıyor. Koruma **var ama** `list-projects.db.test.ts:292`'de ("This tool was the last surface deciding on the ROW rather than on `account_id`") — yani `make verify-db` şeridinde |
| M6 | `list-projects.ts:159` `const site = stripWwwLabel(project.domain)` → `= project.domain` | "aynı site" uyarısını pinleyen testler | **KIRMIZI** (4 test) | `list-projects.test.ts` "apex and www. tracked as two projects" bloğu: `expected … to match /same site/i`, `expected [] to have a length of 1` |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). M5, iş emrinin değil benim hipotezimdi ve
yeşil kaldı: bir kez canlıya çıkmış bir kusurun (defect #52, 2026-08-27'de 18 projenin 4'ünde
ölçülmüştü) nöbetçisi varsayılan kapının dışında.

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**.

## 3. Canlı negatif yol

Tool'un şemasında hiç alan yok; "geçersiz değer" senaryosu **yok**. Ölçülebilen tek negatif eksen
şemada olmayan argümanlar. Her satırda önce/sonra `get_credit_balance`; bakiye **4519** sabit.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| uydurma sayfalama | `{"limit":5}` | 200, `isError` yok, JSON-RPC error yok | **0** | Argüman **sessizce yutuldu**; 18 projenin tamamı döndü — model "5 tane istedim" sanır |
| uydurma filtre | `{"include_archived":false,"filter":"seogrep"}` | 200, hata yok | **0** | Yine tam liste **ve arşiv bölümü** döndü; `include_archived:false` hiçbir şey yapmadı |

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| argümansız mutlu yol | `{}` | 200, text | **0** | `You are tracking 18 project(s):` + 18 satır + `JOB_SCOPE_NOTE` + **2 adet** `Heads up: 2 of your projects are the same site — …` + `Archived — 1 project(s), most recently archived first:` + 1 satır + geri getirme cümlesi |
| filtre/limit argümanı | (şemada yok) | — | — | **ÖLÇÜLEMEDİ — böyle bir argüman yok.** Tool'un tek çağrı biçimi `{}` |

Ölçülen dal kapsaması (tek çağrıda dördü de göründü):
- `Search Console: https://adstark.com.tr/` → bağlı + mülk eşli
- `Search Console: not connected — https://bayder.com.tr/ is still mapped and comes back when you run connect_gsc (free)` → **defect #52'nin doğru tarafı canlıda**: `account_id` null, `gsc_property` duruyor
- `Search Console: not connected` (retained yok) → `seogrep.com`, `example.net`
- `last job: none yet` → 7 proje · `last job: crawl_site 2026-08-26` → `noraninsaat.com`

**Canlıda görünmeyen dallar (ÖLÇÜLEMEDİ, nedeniyle):**
- `Search Console: connected, no property selected` — bu hesapta `account_id` dolu + `gsc_property`
  null olan proje yok
- `(reconnect needed)` — hiçbir `gsc_accounts.token_status` `invalid` değil
- `duplicatePropertyNotes` — iki **bağlı** projenin aynı mülkü paylaştığı durum yok
  (`noraninsaat` çifti artık bir tarafta `not_connected`)
- `NO_PROJECTS_MESSAGE` / `NO_TRACKED_PROJECTS_MESSAGE` — hesabın 18 projesi var
Dördü de hızlı şeritte pinli (`list-projects.test.ts`).

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/hesap/probe.jsonl`
(anahtar redakte; `sg_` içeren satır 0).

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| — | Referans `docs/reference/2026-09-02-seo-referans-listesi.md:209`: `| list_projects | — (yalnız kiracı verisi) | Dış kural yok; risk yalnız iç şema |` | **İLGİSİZ** | Dış kural yok — kontrol edilen: modül dört kendi tablomuzu okuyor (`projects`, `gsc_connections`, `gsc_accounts`, `jobs`), hiçbir dış API'ye çıkmıyor. Referansın işaret ettiği "iç şema riski" bu turda ayrıca ölçüldü: `gsc_accounts` projeksiyonu `"id, token_status"` ile sınırlı (satır 272), `encrypted_refresh_token` bu yola hiç girmiyor |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR ama sevk edilmemiş** — satır 14 `list_projects: "list"`;
`CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` içeriyor. Canlı `tools/list` bu tool için
`_meta` yayınlamıyor, `tools/call` cevabında `structuredContent` yok (ikisi de ölçüldü).
Planlanan `list` kartı için canlı payload'da hazır alanlar var (domain, project_id, GSC durumu,
son iş) ama bugün yalnız metin dönüyor.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — satır 195, `K0 / S1`,
  "account-wide, not per-site — one call is the whole measurement"
- `goals/` hedefi gerekli mi: **HAYIR** — canlı uç sağlığı `goals/trial-flow-e2e.md` üzerinden
  zaten ölçülüyor ve bu tool'un cevabı kiracı verisine bağlı (sabit bir predicate yazmak, veri
  değiştiğinde kırmızı verir). Defect #52 nöbeti bir `goals/` işi değil, bir **kapı kapsam** işi
  (B-1).

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) |
|---|---|---|---|---|
| B-1 | **P1** | Defect #52'nin nöbetçisi varsayılan kapının dışında: `account_id === null` kontrolü kırıldığında `make verify`'ın koştuğu 156 test yeşil kalıyor. Koruma yalnız `list-projects.db.test.ts` (Docker / `make verify-db`) | M5 (§2) | `readGscStates`'in enjekte edilebilir bir porta çıkarılması (kardeş tool'lardaki `deps.listX` deseni), böylece "null `account_id` = not_connected" kuralı DB'siz de pinlenebilir. Alternatif: kapı kapsam tablosuna "defect #52 yalnız verify-db'de" satırının yazılması |
| B-2 | P1 | Şemada olmayan `limit` / `filter` / `include_archived` sessizce yutuluyor; 18 satırlık tam liste "5 istedim" diyen çağrıya da dönüyor | canlı §3 | 5 tool'da ortak: ya `.strict()` ya yazılı hoşgörü kararı (bkz. `get_credit_balance.md` B-2) |
| B-3 | P2 | Tool'un **hiç** sınırı ve sayfalaması yok; kardeş iki liste tool'unda 50'lik tavan + imleç var. Ayrıca `readLastJobs` `jobs` tablosunu **tavansız** okuyor (satır 330 yorumunda bilerek yazılmış) | kaynak satır 318-330; canlı: 18 proje, `jobs` 56 satır | Bugün acil değil (18 × 56). Öneri: bir eşik geçildiğinde (ör. 50 proje) ya sayfalama ya proje-başına-özet sorgusu; kararın **şimdi** yazılması, tablo büyüdüğünde değil |
| B-4 | P2 | Docs sayfası `sameSiteNotes` uyarısını hiç anlatmıyor; canlıda ateşleyen tek uyarı o | §1 tutarsızlık 1 + canlı §4 | mdx gövdesine "apex + www aynı site" paragrafı; drift kontrolü gövdeye bakmadığı için elle |
| B-5 | P2 | GSC'nin dört dalından üçü ve iki boş-hesap cümlesi canlıda görülemiyor (hesapta o durumlar yok) | §4 | Ölçüm hesabında kasten bir "bağlı ama mülk seçilmemiş" proje tutulması (`example.org` aday); yoksa bu dallar sonsuza kadar yalnız birim testinde kalır |

## Taban notu (şef, 2026-09-02, ölçüm sonrası)

Bu kayıt `c8e0daa` tabanında yazıldı; o taban `origin/main`'in **bir PR gerisindeydi** (#198, `159535c`).
Tool kaynağı iki tabanda bayt-özdeş, bu yüzden 1–6. adımların ölçümleri geçerli. **Yalnız 7. adımın sweep
kalemi bayat:** #198 `plan.mjs`'i doldurdu ve `verify.sh`'e `tool-sweep.mjs --self-test`'i ekledi.
Güncel ağaçta ölçüldü: öz-test **7/7 PASS**, "38 live tools accounted for (22 planned + 16 excluded)";
bu tool bugün `PLAN` içinde. Bu dosyadaki "harness başlamıyor / EXCLUDED boş / PLAN 19" satırları
**#198 ile KAPANMIŞTIR** ve düzeltme iş emrine girmez.
