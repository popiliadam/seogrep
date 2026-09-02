# `get_job_status` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 (hesap ailesi) · İşçi: Opus 4.8 · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `get-job-status.ts:218-241`; kredi `costs.ts:25` = `get_job_status: 0,`; docs "**Cost:** Free (0 credits)." — kredi uyumlu, description maliyeti söylemiyor |
| 2 Mutasyon | ÖLÇÜLDÜ | M9 (`failureClause` kırpması) KIRMIZI 2; M11 (proje cümlesi silindi) KIRMIZI 9; M10 (`errorResult`→`textResult`) **YEŞİL KALDI** |
| 3 Canlı negatif | ÖLÇÜLDÜ | bozuk uuid ve eksik alan `isError: true`; rastgele UUID `No job found with id …` `isError: true`; kredi Δ 0 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 4 gerçek iş (2 succeeded crawl, 1 succeeded pull, 2 failed) okundu; **PR #197 (F-3) ve #199 (F-6) düzeltmeleri canlıda KANITLANDI** |
| 5 SEO güncelliği | R-8.3 → **İLGİSİZ, ölçülerek** | Hiç DFS `task_id` yok; 43 günlük iş tam cevap veriyor; kodda yaş kontrolü **YOK** |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:52` `get_job_status: "action"`; `CARDED_TOOLS` yalnız `get_credit_balance` |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:201,202,210` PLAN girişi VAR (3 hücre) · `goals/` hedefi yok |

**Karar:** DÜZELTME GEREKLİ — iki taze düzeltme canlıda doğrulandı ve tool doğru cevap veriyor;
ama (a) "iş bulunamadı" cevabının `isError` bayrağı hızlı şeritte pinsiz, (b) F-6'nın kapatmadığı
bir noktalama ekseni ölçüldü, (c) tool zincirin sonunda **hiçbir sonraki adım cümlesi** taşımıyor.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/get-job-status.ts:218-241` (`makeGetJobStatusTool`, `handler`
  satır 227; üretim örneği satır 244)
- Saf biçimlendiriciler: `formatJobStatus` satır 180-210 · `jobTiming` satır 83-96 ·
  `failureClause` satır 171-174 · `stampsOf` satır 137-147
- Kayıt: `apps/mcp/src/tools/index.ts:8,66,172`
- Zod şeması (alanlar, kısıtlar), satır 224-226:
  - `job_id`: `z.uuid()` — **zorunlu**, tek alan. Canlı JSON Schema
    `{"type":"string","format":"uuid","pattern":"…","description":"The job_id returned by an async tool such as crawl_site."}`, `required: ["job_id"]`
  - `additionalProperties` **yok**
- Description (birebir alıntı):
  > Check the status and result summary of an async job (e.g. a crawl_site run), by its job_id.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:25`, birebir): `  get_job_status: 0,`
- Docs sayfası (`apps/web/content/docs/tools-reference/get-job-status.mdx`, birebir):
  > **Cost:** Free (0 credits).

  ve "### Returns" bölümü:
  > The job `status` (`queued`, `running`, `succeeded`, or `failed`), its created / started / finished timestamps and elapsed time, a live page count while a crawl runs, and — on success — a result summary, or the error message on failure.
- Tutarsızlıklar:
  1. **Description maliyeti söylemiyor.** Canlı `tools/list`'te 38 tool'un 35'i `Costs N credits`
     diyor; söylemeyen üçü `get_credit_balance`, `get_job_status`, `whats_next`.
  2. **Docs sayfası PR #197'nin F-3 düzeltmesini hiç anmıyor.** Canlı her cevap
     `· project: <domain>` taşıyor; mdx'in "### Returns" listesi damgaları, süreyi, sayacı ve
     özeti sayıyor, **projeyi saymıyor**. Kardeş sayfa `list-jobs.mdx` aynı bilgiyi
     ("The site is named by DOMAIN…") anlatıyor — yani iki sayfa aynı olguyu farklı taşıyor.
  3. Uyumlu olanlar: description ↔ mdx frontmatter (birebir), `job_id` açıklaması ↔ mdx Input
     tablosu (birebir), kredi 0 ↔ ölçülen Δ 0, "timing unavailable" cümlesi ↔ mdx paragrafı ↔
     canlı çıktı.
- Seçilebilirlik: "What's the status of job `<id>`?" — `job_id` zorunlu olduğu için model ancak
  elinde id varken seçebiliyor; id yoksa doğru komşu **`list_jobs`** ve o tool'un description'ı
  (`Use it when you do not have a job_id to hand.`) ayrımı açıkça kuruyor. Ters yön de kurulu:
  `list_jobs`'un cevabı `Run get_job_status with one of these job_id values…` diyor. Bu çift
  bu turun en net eşleşmesi.

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `npx vitest run src/tools/{get-credit-balance,get-job-status,list-jobs,list-projects,list-credit-activity}.test.ts`.
Taban: **156 passed / 5 files**. `get-job-status.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M9 | `get-job-status.ts:173` `failureClause` gövdesi → `return text;` (F-6 düzeltmesinin geri alınması) | çift noktayı yakalayan test | **KIRMIZI** (2 test) | `formatJobStatus punctuates a failed job exactly once > does not double the stop…`: `expected 'Job 11111111-…' not to contain '..'`; ve `failureClause("A sentence.")` → `expected 'A sentence.' to be 'A sentence'` |
| M11 | `get-job-status.ts:143` `` `project: ${projectLabel(job.project_id, domains)}` `` satırı silindi (F-3'ün geri alınması) | proje cümlesini pinleyen testler | **KIRMIZI** (9 test) | `formatJobStatus names the project` bloğunun tamamı + `a running job with NO stored progress prints the plain line, plus its project` |
| M10 | `get-job-status.ts:232` `errorResult(...)` → `textResult(...)` (bulunamayan iş artık hata bayrağı taşımaz) | `isError` bayrağını pinleyen test | **YEŞİL KALDI** | 156/156 geçti. Koruma **var**: `get-job-status.db.test.ts:111,116` `expect(...isError).toBe(true)` — ama `make verify`'ın koşmadığı şeritte. İstemci "iş bulunamadı"yı başarılı sonuç sanardı |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). M10 benim hipotezimdi; canlı ölçüm (§3)
bayrağın **bugün doğru** olduğunu gösteriyor — bulgu davranışta değil, **nöbetin yerinde**.

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**.

### F-6'nın kapatmadığı eksen (repo dışı ölçüm, kaynağa dokunulmadı)

`failureClause`'un iki satırı repo dışı bir dosyaya birebir kopyalanıp sekiz girdiyle koşuldu
(`…/scratchpad/dilim1/hesap/failureclause-probe.mjs`). Sonuçlar:

| girdi | üretilen satır | değerlendirme |
|---|---|---|
| `"…engineering record."` | `failed: …engineering record. created …` | **doğru** — F-6 tam da bu |
| `"…engineering record. "` (sonda **boşluk**) | `failed: …engineering record. . created …` | **HOLE** — `endsWith(".")` false, kırpma olmuyor, renderer bir nokta daha ekliyor |
| `"Did it work?"` | `failed: Did it work?. created …` | Testte **kasten** pinli (`get-job-status.test.ts:520-527` `it.each` — "a question / an exclamation / an ellipsis / an ASCII ellipsis" dördü de `failed: ${error}. created` bekliyor) → tasarım kararı, kusur değil; ama müşteri gözünde `?.` hâlâ iki noktalama |
| `"Nothing was found..."` | `failed: Nothing was found.... created …` | Aynı `it.each` ile pinli; dört nokta bilerek |
| `null` | `failed: unknown error. created …` | doğru |

Yani F-6 "SONLANDIRICI KARAKTER" eksenini varyantlamış (ders 14 uygulanmış, testte görünüyor);
varyantlanmamış eksen **sondaki boşluk**. Bugün ulaşılabilir değil (canlı iki `failed` satırının
ikisi de boşluksuz bitiyor), o yüzden P2.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (basılmadı). Her satırda önce/sonra `get_credit_balance`; bakiye **4519** sabit.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| bozuk id | `{"job_id":"not-a-uuid"}` | 200, `isError: true` | 0 | `Invalid input for "get_job_status": ✖ Invalid UUID → at job_id` |
| zorunlu alan eksik | `{}` | 200, `isError: true` | 0 | `Invalid input for "get_job_status": ✖ Invalid input: expected string, received undefined → at job_id` |
| rastgele UUID | `{"job_id":"00000000-0000-4000-8000-000000000000"}` | 200, **`isError: true`** | 0 | `No job found with id 00000000-0000-4000-8000-000000000000.` — bilinmeyen id ile başka kiracının işi **aynı** cevabı alıyor (varlık sızıntısı yok); ikinci sorgu (proje adı) hiç yapılmıyor |
| şemada olmayan argüman | `{"job_id":"9bc30d40-…","project_id":"nonsense"}` | 200, hata yok | 0 | Fazladan argüman **sessizce yutuldu**; cevap `job_id`'nin cevabı |

Not: yabancı kiracının **gerçek** bir iş id'siyle ölçüm bu turda yapılamadı (elimizde ikinci
kiracının id'si yok) — kod yolu `getJobForUser` ile aynı dala düşüyor ve `get-job-status.db.test.ts:111`
bunu pinliyor.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| **failed** (F-6 kanıtı) | `{"job_id":"24c43b20-…"}` | 200, text | **0** | `Job 24c43b20-… (crawl_site) failed: the job could not be completed — this was a problem on our side, not with your site or your request. The original queue diagnostic (2026-07-21 incident) was moved out of this field on 2026-08-27 and is preserved in the engineering record. created 2026-07-21T10:55:30.924461+00:00 · finished 2026-07-21T10:55:32.219+00:00 · project: seogrep.com.` |
| failed (ikinci) | `{"job_id":"d0dea4d5-…"}` | 200 | **0** | Aynı biçim, `created 2026-07-21T10:39:06.643558+00:00` |
| succeeded crawl | `{"job_id":"af7a2925-…"}` | 200 | **0** | `Job af7a2925-… (crawl_site) succeeded. created … · started … · finished … · took 1m 32s · project: noraninsaat.com. Crawled 26 page(s), skipped 117, 3 issue(s) found (mostly: non-HTML (image/webp)).` |
| succeeded pull + bozuk damga | `{"job_id":"e1db2b1e-…"}` | 200 | **0** | `… (pull_gsc_data) succeeded. created 2026-08-25T16:14:18.768627+00:00 · finished 2026-08-25T16:14:17.299+00:00 · timing unavailable (this job's stored timestamps are out of order) · project: dentnotion.com. Pulled 30 day(s) of Search Console data for https://dentnotion.com/: 11037 row(s) (2026-07-24 → 2026-08-22), 12051 in the previous window.` |
| eski iş (43 gün) | `{"job_id":"9bc30d40-…"}` | 200 | **0** | `… (crawl_site) succeeded. … took 3.7s · project: seogrep.com. Crawled 5 page(s), skipped 8, 0 issue(s) found (mostly: max URL limit reached).` |

### PR #197 / #199 düzeltmelerinin canlıda KANITI (varsayım değil)

- **F-6 (PR #199, `4d86e57`) — tek nokta, iki değil.** Commit mesajının kendisi kusuru şu satırla
  gösteriyordu: `… preserved in the engineering record.. created 2026-07-21T…`. Aynı iş id'si
  (`24c43b20-26f7-4cb2-9f07-221213738696`) bugün canlıda `… engineering record. created 2026-07-21T…`
  dönüyor. Ölçüm: ham cevapta `..` dizisi **0 kez** geçiyor (JSONL kaydı). → **canlıda**
- **F-3 (PR #197, `df53bcd`) — hangi site.** Beş cevabın **beşinde** de damga izinin sonunda
  `· project: <domain>` var (`seogrep.com`, `noraninsaat.com`, `dentnotion.com`). Aynı sözcükler,
  aynı yer, `list_jobs` ile aynı `projectLabel`. → **canlıda**
- **F-1 (PR #197, `8ac7e47`) — iç detay sızmıyor.** `failed` cevaplarının metni müşteri için
  yazılmış bir cümle; ham kuyruk tanısı alanın dışına taşınmış. → **canlıda**

**"What's next" cümlesi — ölçüm:** `get_job_status`'un dört durumunun **hiçbirinde** sonraki adımı
söyleyen bir cümle **yok** (queued/running dalları da kaynakta öyle: satır 188, 196-201).
Kardeş `list_jobs` cevabını `Run get_job_status with one of these job_id values…` ile kapatıyor;
`list_credit_activity` `Run get_credit_balance for your current total.` ile. Zincirin **son**
halkası olan bu tool, başarısız bir iş için bile ("bizim tarafımızda bir sorun") müşteriye ne
yapacağını söylemiyor. Bu bir noktalama kusuru değil, **eksik cümle** (B-3).

**ÖLÇÜLEMEDİ:** `queued` ve `running` dalları — canlıda o durumda iş yok ve üretmek 20 kredilik
`crawl_site` gerektiriyor (bu tur ücretsiz tool'larla sınırlı). 2026-08-27 turundan **devreden**
açık kalem; ilerleme sayacı (`readCrawlProgress`) yalnız birim testinde kanıtlı.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/hesap/probe.jsonl`
(anahtar redakte; `sg_` içeren satır 0).

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-8.3** — "Veri saklama: JSON sonuçlar 30 gün, HTML sonuçlar 7 gün" (`docs.dataforseo.com/v3/`, gözlem 2026-09-02; referans satır 155, risk notu: "Aynı saklama penceresi; süresi geçmiş task ID'sinin hâlâ sorgulanabilir sanılması") | Tool `jobs.result` sütununu okuyor — **bizim** veritabanımız | **İLGİSİZ** (ölçülerek) | Ölçüm 1: `grep -rn "task_id" apps/mcp/src` → **hiç eşleşme yok**; ne saklanıyor ne veriliyor, yani "süresi geçmiş bir DFS task ID'si" bu tool'a hiç ulaşamaz. Ölçüm 2: `jobs` satırı yazan iki tool `crawl_site` (kendi tarayıcımız) ve `pull_gsc_data` (Google GSC API) — DFS değil. Ölçüm 3: kodda yaş/saklama kontrolü **YOK** — canlıda 2026-07-21 tarihli (43 günlük) bir iş tam sonuç özeti döndürdü. Bir DFS-tabanlı asenkron tool eklenirse bu satır **yeniden** ölçülmelidir |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR ama sevk edilmemiş** — satır 52
`get_job_status: "action"`; `CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` içeriyor.
Canlı `tools/list` bu tool için `_meta` yayınlamıyor, `tools/call` cevabında `structuredContent`
yok (ikisi de ölçüldü). Planlanan `action` kartının ihtiyacı olan alanlar (durum, damgalar, proje,
özet) canlı metinde var, yapılı kanalda yok.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR — üç hücre**: satır 201 `K0 / S3a`
  (`job_id: MALFORMED_ID`), satır 202 `K0 / S3b` (`job_id: ABSENT_ID`), satır 210 `K1 / S1`
  ("the terminal read of the crawl this run just enqueued")
- `goals/` hedefi gerekli mi: **EVET** — F-6 ve F-3 iki ayrı PR'da düzeltildi ve ikisinin de canlı
  kanıtı bu turda elle toplandı. "Bir `failed` cevabında `..` geçmez ve satır `project:` taşır"
  makine-kontrollü bir predicate'e değer; bugün `goals/` altında bu tool'a değen hiçbir hedef yok

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) |
|---|---|---|---|---|
| B-1 | **P1** | "İş bulunamadı" cevabının `isError: true` bayrağı hızlı şeritte pinsiz: `errorResult` → `textResult` yapıldığında 156 test yeşil kalıyor. Bayrak düşerse istemci bulunamayan işi **başarılı sonuç** sayar | M10 (§2); koruma yalnız `get-job-status.db.test.ts:111,116` | Bulunamayan iş dalının hızlı şeritte de sürülmesi: `makeGetJobStatusTool` zaten `deps.lookupDomain` alıyor; iş okuması da (`getJobForUser`) enjekte edilebilir bir port olsa bu dal DB'siz pinlenirdi |
| B-2 | P2 | F-6'nın varyantlamadığı eksen: `jobs.error` sonda **boşlukla** biterse satır `record. . created` olur (iki nokta, arada boşluk) | repo dışı ölçüm §2 | `failureClause`'un girdiyi önce `trimEnd()` etmesi; ve testin `it.each` listesine bir "sondaki boşluk" satırı eklenmesi. Bugün ulaşılabilir değil, o yüzden P2 |
| B-3 | P2 | Zincirin son halkası hiçbir durumda sonraki adımı söylemiyor. `failed` cevabı "bizim tarafımızda bir sorun" diyor ve ne yapılacağını söylemiyor; `succeeded` cevabı da hiçbir yere yönlendirmiyor. İki kardeş tool bunu yapıyor | §4 "What's next" ölçümü; `list-jobs.ts:270` ve `list-credit-activity.ts:430-431` | Duruma göre tek cümle: `failed` → aynı tool'u yeniden çalıştırma yolu (ör. `crawl_site`); `succeeded` → sonucu kullanan tool (`whats_next` ya da ilgili audit). Metin kararı, kod kararı değil |
| B-4 | P2 | Description maliyeti söylemiyor (38 canlı tool'un 35'i söylüyor) | canlı `tools/list` sayımı | Diğer 35'le aynı biçimde ` Costs 0 credits.` eklenmesi |
| B-5 | P2 | Docs sayfası F-3'ü (cevabın projeyi adlandırması) hiç anmıyor; kardeş `list-jobs.mdx` aynı olguyu anlatıyor | §1 tutarsızlık 2 | mdx "### Returns" listesine proje maddesinin eklenmesi. Drift kontrolü yalnız frontmatter + Input tablosuna baktığı için elle |
| B-6 | P2 | Şemada olmayan argüman sessizce yutuluyor | canlı §3 | 5 tool'da ortak (bkz. `get_credit_balance.md` B-2) |

## Taban notu (şef, 2026-09-02, ölçüm sonrası)

Bu kayıt `c8e0daa` tabanında yazıldı; o taban `origin/main`'in **bir PR gerisindeydi** (#198, `159535c`).
Tool kaynağı iki tabanda bayt-özdeş, bu yüzden 1–6. adımların ölçümleri geçerli. **Yalnız 7. adımın sweep
kalemi bayat:** #198 `plan.mjs`'i doldurdu ve `verify.sh`'e `tool-sweep.mjs --self-test`'i ekledi.
Güncel ağaçta ölçüldü: öz-test **7/7 PASS**, "38 live tools accounted for (22 planned + 16 excluded)";
bu tool bugün `PLAN` içinde. Bu dosyadaki "harness başlamıyor / EXCLUDED boş / PLAN 19" satırları
**#198 ile KAPANMIŞTIR** ve düzeltme iş emrine girmez.
