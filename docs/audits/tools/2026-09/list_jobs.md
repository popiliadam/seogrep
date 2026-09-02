# `list_jobs` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 (hesap ailesi) · İşçi: Opus 4.8 · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `list-jobs.ts:276-316`; kredi `costs.ts:33` = `list_jobs: 0,`; docs "**Cost:** Free (0 credits)." — uyumlu |
| 2 Mutasyon | ÖLÇÜLDÜ | M7 (`unknownCursor` dalı silindi) KIRMIZI 1 test; M8 (bileşik imleç → yalnız `created_at.lt`) **YEŞİL KALDI** — db şeridi koşulmadı |
| 3 Canlı negatif | ÖLÇÜLDÜ | `limit` 0/51 ve bozuk uuid reddedildi; ulaşılamaz imleç doğru cevabı verdi; **`status` ve `project_id` sessizce yutuldu** — B-1 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 56 iş, 3 sayfa (10 / 50 / 6), imleç zinciri tam, kredi Δ 0 |
| 5 SEO güncelliği | R-8.3 → **İLGİSİZ, ölçülerek** | `apps/mcp/src`'te hiç DFS `task_id` yok; 43 günlük iş hâlâ tam listeleniyor; kodda yaş kontrolü **YOK** |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:15` `"list"`; `CARDED_TOOLS` yalnız `get_credit_balance` |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi **YOK** · `goals/trial-flow-e2e.md:74` yalnız tool sayımında anıyor |

**Karar (ölçüm turu, 2026-09-02):** DÜZELTME GEREKLİ — sayfalama ve imleç dalları canlıda dört senaryoda da doğru çalıştı;
ama "başarısız işlerimi göster" gibi en doğal iki argüman (`status`, `project_id`) şemada yok ve
verildiğinde sessizce yutulup **filtrelenmemiş** liste dönüyor.

**Karar (kapanış, 2026-09-02):** KAPANDI (dilim 1 düzeltmesi, #198 + #204 + #205 + #206 [CI'da, merge bekliyor]) — iki P1 de kapandı: `status`/`project_id` gerçek filtre oldu (B-1, canlı doğrulandı), bileşik imleç hızlı şeritte pinlendi (B-2). **Kalan:** B-3 (P2) ERTELENDİ → Dilim 2, 20 kredilik crawl ile.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/list-jobs.ts:276-316` (`makeListJobsTool`, `handler` satır 303;
  üretim örneği satır 316)
- Okuma portu: `listOwnJobs` satır 112-164 · saf biçimlendirici `formatJobList` satır 234-273
- Kayıt: `apps/mcp/src/tools/index.ts:9,68,176`
- Zod şeması (alanlar, kısıtlar), satır 285-302:
  - `limit`: `z.int().min(1).max(50).default(10)` (`MAX_JOB_LIST_LIMIT`=50 satır 94,
    `DEFAULT_JOB_LIST_LIMIT`=10 satır 87)
  - `before_id`: `z.uuid().optional()` — canlı JSON Schema `{"type":"string","format":"uuid", …}`
  - **`status` alanı yok · `project_id` alanı yok · `additionalProperties` yok**
- Description (birebir alıntı):
  > List your recent background jobs — crawls and Search Console pulls — newest first, with each job_id. Use it when you do not have a job_id to hand. Pages with before_id. Costs 0 credits.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:33`, birebir): `  list_jobs: 0,`
  (üstündeki yorum satır 26-32: "0 credits: it reads the tenant's OWN jobs rows and calls no paid
  API… charging a customer to find the id of something they already paid for is not a price, it is
  a toll on their own data.")
- Docs sayfası (`apps/web/content/docs/tools-reference/list-jobs.mdx`, birebir):
  > **Cost:** Free (0 credits).

  ve:
  > The list deliberately carries **no results**. A finished crawl or Search Console pull can store a very large result — one measured pull held close to a megabyte — so printing even a few of them would bury the answer you asked for.
- Tutarsızlıklar: **yok** — karşılaştırılanlar: description ↔ mdx frontmatter (mdx'te 155 karakter
  bütçesi nedeniyle `Pages…` diye kesilmiş, bu `gen-tool-docs`'un kuralı), `limit`/`before_id`
  açıklamaları ↔ mdx Input tablosu (birebir), kredi 0 ↔ ölçülen Δ 0, "timestamps out of order"
  cümlesi ↔ mdx paragrafı ↔ canlı çıktı (üçü aynı sözcükler).
- Seçilebilirlik: "How is the crawl I started doing?", "işlerim ne durumda", "job_id'im yok" —
  description'ın `Use it when you do not have a job_id to hand.` cümlesi ayrımı açıkça kuruyor;
  komşusu **`get_job_status`** (id VARSA). **Asıl risk:** "hangi işlerim başarısız oldu?" /
  "şu projenin işleri" cümlelerinde model `status` ve `project_id` argümanı **uydurur** —
  ikisi de sessizce yutuluyor (§3).

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `npx vitest run src/tools/{get-credit-balance,get-job-status,list-jobs,list-projects,list-credit-activity}.test.ts`.
Taban: **156 passed / 5 files**. `list-jobs.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M7 | `list-jobs.ts:247` `if (page.unknownCursor === true) return UNKNOWN_CURSOR_MESSAGE;` **silindi** | bilinmeyen imleci ayıran test | **KIRMIZI** (1 test) | `list_jobs paging — the advice names a value that works > answers an unreachable cursor without saying whether it exists elsewhere`: `expected 'That is the end of your job history —…' to be 'No job found with that before_id, so …'` |
| M8 | `list-jobs.ts:150-153` bileşik imleç `or(created_at.lt…, and(created_at.eq…, id.lt…))` → `query.lt("created_at", cursor.createdAt)` | aynı milisaniyedeki iki işin atlanmasını/yinelenmesini yakalayan test | **YEŞİL KALDI** | 156/156 geçti. Koruma **var**: `list-jobs.db.test.ts:242` ("a created_at-only cursor skips or repeats here") — ama `make verify`'ın koşmadığı şeritte |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). M8 benim hipotezimdi; kaynağın kendi yorumu
(satır 118-129) bu tehlikeyi zaten adlandırıyor, ölçüm o nöbetin **nerede** olduğunu gösterdi.

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (basılmadı). Her satırda önce/sonra `get_credit_balance`; bakiye **4519** sabit.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| limit alt sınır altı | `{"limit":0}` | 200, `isError: true` | 0 | `Invalid input for "list_jobs": ✖ Too small: expected number to be >=1 → at limit` |
| limit üst sınır üstü | `{"limit":51}` | 200, `isError: true` | 0 | `✖ Too big: expected number to be <=50 → at limit` |
| bozuk id | `{"before_id":"not-a-uuid"}` | 200, `isError: true` | 0 | `Invalid input for "list_jobs": ✖ Invalid UUID → at before_id` |
| rastgele UUID (var olmayan iş) | `{"before_id":"00000000-0000-4000-8000-000000000000"}` | 200, hata yok | 0 | **Doğru dal:** `No job found with that before_id, so there is no page to continue from. Call list_jobs without before_id to start again from your most recent jobs.` — varlık sızdırmıyor |
| geçmişin dibi | `{"before_id":"0b70efd7-…"}` (en eski iş) | 200, hata yok | 0 | **Doğru dal:** `That is the end of your job history — there is nothing older than the cursor you passed.` |
| **şemada olmayan `status`** | `{"status":"failed","limit":3}` | 200, hata yok | 0 | **Filtre uygulanmadı.** Dönen 3 satırın üçü de `succeeded`; başlık `Your 3 most recent job(s) of 56` — "başarısızları göster" isteği sessizce hesap geneline dönüştü |
| **şemada olmayan `project_id`** | `{"project_id":"4e0caff0-…","limit":3}` | 200, hata yok | 0 | **Kapsamlama yok.** Dönen üç iş `noraninsaat.com` ve `dentnotion.com` projelerine ait — istenen `seogrep.com` projesinin işi listede yok |

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| argümansız | `{}` | 200, text | **0** | `Your 10 most recent job(s) of 56, newest first:` + 10 satır + `Run get_job_status with one of these job_id values…` + `46 older job(s) not shown — call again with \`before_id: 13fd6204-…\` for the next page.` |
| tavan | `{"limit":50}` | 200 | **0** | `Your 50 most recent job(s) of 56…` + `6 older job(s) not shown — call again with \`before_id: a68a8e22-…\`…` — 2026-08-27'de bulunan D-8 kusurunun ("raise limit (max 50)" tavandaki çağırana) düzeltilmiş hâli **canlıda** |
| 2. sayfa (imleç) | `{"limit":50,"before_id":"a68a8e22-…"}` | 200 | **0** | `Continuing from your cursor: 6 of 6 older job(s), newest first:` — başlık değişiyor, sayaç kalan'ı sayıyor, kesme cümlesi yok (kalan 0) |
| proje adı (F-3/`projectLabel`) | `{}` | 200 | **0** | Her satır `· project: <domain>` taşıyor (ör. `project: noraninsaat.com`) — ham uuid değil |
| bozuk damga işareti | `{}` | 200 | **0** | İki `pull_gsc_data` satırı: `created 2026-08-25T16:14:18.768627+00:00 · finished 2026-08-25T16:14:17.299+00:00 · timestamps out of order — this job's stamps are not reliable` — süre türetilmiyor |

Ölçülen durum dağılımı: 56 işin **56'sı** `succeeded` ya da `failed` (50 succeeded + ilk 50'de 0
failed; son 6'da 2 failed). `queued` / `running` satırları canlıda **ÖLÇÜLEMEDİ** — bunları
üretmek 20 kredilik bir `crawl_site` gerektirir ve bu tur ücretsiz tool'larla sınırlı.
`jobs.tool` canlıda yalnız `crawl_site` ve `pull_gsc_data` değerlerini taşıyor — `JOB_SCOPE_NOTE`
ve mdx'in iddiası doğrulandı.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/hesap/probe.jsonl`
(anahtar redakte; `sg_` içeren satır 0).

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-8.3** — "Veri saklama: JSON sonuçlar 30 gün, HTML sonuçlar 7 gün" (`docs.dataforseo.com/v3/`, gözlem 2026-09-02; referans satır 155) | Bu tool `jobs` tablosunun **kendi** satırlarını listeliyor; DFS'in sakladığı hiçbir şeye dokunmuyor | **İLGİSİZ** (ölçülerek, varsayılarak değil) | Ölçüm 1: `grep -rn "task_id" apps/mcp/src` → **hiç eşleşme yok**; sunucu hiçbir yerde bir DFS task id'si saklamıyor ya da müşteriye vermiyor. Ölçüm 2: `jobs` satırlarını yazan iki tool `crawl_site` (kendi tarayıcımız) ve `pull_gsc_data` (Google Search Console API) — ikisi de DFS değil. Ölçüm 3: canlıda **2026-07-21** tarihli (43 günlük) iki iş hâlâ listeleniyor ve `get_job_status` tam cevap veriyor; kodda **hiçbir yaş kontrolü yok** (`grep` ile `retention|maxAge|older than` yalnız `reaper.ts`'in 15/30 dakikalık **çalışma** pencerelerini buluyor, saklama penceresi değil). Referansın adlandırdığı risk ("süresi geçmiş task ID'sinin hâlâ sorgulanabilir sanılması") bu tool'da **karşılıksız**: sorgulanabilir bir DFS task ID'si yok |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR ama sevk edilmemiş** — satır 15 `list_jobs: "list"`;
`CARDED_TOOLS` (satır 62) yalnız `get_credit_balance`. Canlı `tools/list` bu tool için `_meta`
yayınlamıyor, `tools/call` cevabında `structuredContent` yok (ikisi de ölçüldü). Planlanan `list`
kartının beklediği alanlar (tool, status, damgalar, proje, job_id) canlı metinde var ama yapılı
kanalda yok.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK** (düzeltme fazında eklenir). `EXCLUDED` boş
  (`plan.mjs:91`); `assertCoverage` canlı listedeki her tool'un PLAN ya da EXCLUDED'da olmasını
  şart koşuyor. PLAN'da 19 tool adı var, canlı sunucu **38** yayınlıyor → sweep bugün canlıya karşı
  başlatılamaz ve `list_jobs` o 19 eksikten biri.
- `goals/` hedefi gerekli mi: **EVET** — sayfalama zincirinin ("her sayfa bir sonrakinin
  değerini adıyla veriyor") canlıda kırılmadığı makine-kontrollü bir predicate'e değer; bugün
  `goals/trial-flow-e2e.md` bu tool'u yalnız **tool sayımı** bağlamında anıyor (satır 74),
  davranışını ölçmüyor.

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-02) |
|---|---|---|---|---|---|
| B-1 | **P1** | `status` ve `project_id` şemada yok, verildiğinde sessizce yutuluyor. "Başarısız işlerimi göster" isteğine 3 `succeeded` satır dönüyor; "şu projenin işleri" isteğine başka projelerin işleri dönüyor. Model filtrelenmiş sandığı bir listeyi müşteriye anlatır | canlı `{"status":"failed"}` ve `{"project_id":"4e0caff0-…"}` (§3) | İki seçenek: (a) `status` (`queued\|running\|succeeded\|failed`) ve `project_id` gerçek filtre olarak eklensin — `jobs` tablosunda ikisi de sütun; (b) en azından `.strict()` ile reddedilsin. Bugünkü sessiz yutma en kötüsü | KAPANDI #205 + #204 + canlı ✔ — filtre yarısı #205 (`status` enum + `project_id`, daraltılmış cevap filtreyi adıyla söylüyor), sessiz yutma yarısı #204; canlı `4349f71`: status filtresi (2 failed iş) + bogus status reddi |
| B-2 | P1 | Bileşik imlecin nöbetçisi varsayılan kapının dışında: `created_at`-only imlece düşürüldüğünde 156 test yeşil kalıyor | M8 (§2) | `listOwnJobs`'un imleç mantığının saf bir yardımcıya ayrılması (sıralama+imleç karşılaştırması), ya da kapı kapsam tablosuna "bileşik imleç yalnız verify-db'de" satırı | KAPANDI (#206, merge bekliyor) — bileşik imleç `(created_at, id)` ve aynı çiftle sıralama pinli |
| B-3 | P2 | `queued` / `running` satırları canlıda ölçülemiyor; bu iki durumun tek kanıtı birim testi | §4 | Operatör onaylı tek bir 20 kredilik `crawl_site` ile ölçüm penceresi; ya da bu iki dalın "yalnız birim testinde kanıtlı" olduğunun kayda geçmesi (2026-08-27 turundan **devreden** açık kalem) | ERTELENDİ → Dilim 2 — 20 kredilik `crawl_site` gerekiyor; operatör izin verdi, harness sınıflandırıcısı ücretli çağrıyı reddetti |
| B-4 | P2 | `plan.mjs` PLAN/EXCLUDED kapsaması canlı sunucudan 19 tool geride; `assertCoverage` bugün canlıya karşı hata fırlatır | `plan.mjs:91` (`EXCLUDED` boş) + 19 planlı ad vs canlı 38 | Sweep'in ya PLAN'ının tamamlanması ya da eksik 19'un **yazılı gerekçeyle** `EXCLUDED`'a alınması. Bu bir depo-geneli kalem; bu turun 5 tool'undan 2'sini (list_jobs, list_credit_activity) doğrudan etkiliyor | KAPANDI #198 — `plan.mjs` PLAN/EXCLUDED kapsaması (taban notu) |

## Taban notu (şef, 2026-09-02, ölçüm sonrası)

Bu kayıt `c8e0daa` tabanında yazıldı; o taban `origin/main`'in **bir PR gerisindeydi** (#198, `159535c`).
Tool kaynağı iki tabanda bayt-özdeş, bu yüzden 1–6. adımların ölçümleri geçerli. **Yalnız 7. adımın sweep
kalemi bayat:** #198 `plan.mjs`'i doldurdu ve `verify.sh`'e `tool-sweep.mjs --self-test`'i ekledi.
Güncel ağaçta ölçüldü: öz-test **7/7 PASS**, "38 live tools accounted for (22 planned + 16 excluded)";
bu tool bugün `PLAN` içinde. Bu dosyadaki "harness başlamıyor / EXCLUDED boş / PLAN 19" satırları
**#198 ile KAPANMIŞTIR** ve düzeltme iş emrine girmez.
