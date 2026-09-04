# `ai_visibility` — tool kontrol kaydı (2026-09 turu)

> Dilim: 6 · İşçi: Opus 4.8 · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Taban: worktree `audit/dilim6-ai`, main `800d5ee`; `pnpm --filter @pseo/mcp test` → **162 dosya / 4198 test, exit 0**.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler + zod + description + `costs.ts:135` + mdx + DFS adaptörü okundu; kredi/metin tutarsızlığı YOK |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyon: M1/M2/M3 KIRMIZI, M7 **YEŞİL KALDI**; `git diff --stat` boş |
| 3 Canlı negatif | ÖLÇÜLDÜ | 9 negatif, **hepsi ücretsiz** (defterde satır yok); kiracı izolasyonu ayırt edilemez cümle ile |
| 4 Canlı mutlu yol | **ÖLÇÜLEMEDİ** | 2 ücretli deneme **vendor 40501 ile düştü** (`location_name`, sonra `language_code`); 3. deneme hesabın $0,50 ücretsiz-vendor ödeneği tükendiği için reddedildi |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-5.2 **TEMİZ** (llms.txt kaynakta hiç yok); R-5.5 ve R-5.9/R-3.22–3.24 **AYKIRI**; R-8.4/8.5 **İLGİSİZ** (şerh önerisi) |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:41` → `"report"`; `CARDED_TOOLS` yalnız `get_credit_balance` (ertelenmiş) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | `plan.mjs:192` EXCLUDED gerekçesi **BAYAT DEĞİL** — H-01 hâlâ açık; `goals/` hedefi EVET |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — tool'un KENDİ ilan ettiği ve dokümante ettiği iki
alan (`location_name`, `language_code`) DataForSEO tarafından reddediliyor; 2026-08-25 outage'ının aynı
sınıfı iki alan daha üzerinde yaşıyor ve mutlu yol bu yüzden ölçülemedi.

**Karar (kapanış, YYYY-MM-DD):**

---

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/ai-visibility.ts:299` (`makeAiVisibilityTool` → `defineTool`, `charge: "handler"`)
- Port: `apps/mcp/src/dfs/llm-mentions.ts` (`createLiveAiVisibilityClient:1085`, `fetchAiVisibility:1150`)
- Paylaşılan yüzey: `apps/mcp/src/tools/ai-visibility-shared.ts`
- Uç: `aggregated_metrics/live` (`llm-mentions.ts:141`)

### Zod şeması (canlı `tools/list`'ten ölçüldü, 2026-09-04)

```
top additionalProperties: false          ← S1 (#204) burada TUTUYOR
properties: subject,target,project_id,keyword,platform,internal_list_limit,location_name,language_code
required:   ["subject","platform"]
confirm advertised? false                ← doğru: düz 90 kr, D17 eşiği 200'ün altında
internal_list_limit: int 1..20, default 20   ← VENDOR_MAX_INTERNAL_LIST_AGGREGATED
```

`superRefine` (`ai-visibility.ts:143-166`) `SUBJECT_INPUT_RULES` üzerinden diğer öznenin alanını
**reddeder, yok saymaz** — gerekçe kaynakta yazılı: *"ignoring it would run a different lookup than the
one you asked for, and bill you for it."* Ölçüm: `.superRefine()` Zod v4'te `ZodObject` döndürüyor, bu
yüzden `refuseUnknownKeys` (`registry.ts:489`, `instanceof z.ZodObject`) bu şemaya ULAŞIYOR — canlı
`additionalProperties: false` bunu doğruluyor (varsayım değil, ölçüm).

### Description (birebir alıntı, canlı yüzeyden)

> Measure how a domain or a keyword is mentioned in one AI assistant's answers, from DataForSEO's LLM
> Mentions data. Pick a subject: "domain" (pass target or project_id) or "keyword" (pass keyword), and a
> platform — chat_gpt or google. The answer is scoped to THAT assistant, THAT location and language, and
> whatever moment DataForSEO measured it: this vendor endpoint takes no date range, so there is no period
> to ask for. Every figure is a DataForSEO field printed under DataForSEO's own name — SeoGrep computes no
> visibility score, no share of voice and no sentiment, and a figure the vendor did not report is shown as
> unreported rather than as zero. Synchronous — everything comes back immediately. Costs 90 credits. Needs
> a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on
> this deployment, the tool says so and charges nothing.

**"THAT location and language"** cümlesi ölçümle çürüdü — bkz. AV-1.

### Kredi satırı (`apps/mcp/src/credits/costs.ts:135`, birebir)

```
  ai_visibility: 90,
```

Yorum bloğu (`costs.ts:127-134`) 5,58× marjı `MAX_INTERNAL_LIST_ROWS` "ROW CAP" varsayımı üzerine kuruyor;
`llm-mentions.ts:38-50` bu varsayımı ŞERH ile geri çekiyor. İki dosya çelişmiyor (biri şerhi taşıyor,
diğeri taşımıyor) ama `costs.ts` tek başına okunduğunda kanıtlanmış bir marj gibi okunuyor. → AV-4.

### Docs sayfası

`apps/web/content/docs/tools-reference/ai-visibility.mdx` (ÜRETİLİYOR — `apps/web/scripts/gen-tool-docs.mjs`).
Kredi cümlesi birebir: `**Cost:** 90 credits.` Input tablosu `location_name` için birebir:

> OPTIONAL DataForSEO `location_name` — a NAME, e.g. "United States", not the numeric location_code the
> other SeoGrep tools take (this vendor family publishes no code).

Bu satırdaki **"United States"** örneği, canlıda 40501 aldığım değer sınıfının ta kendisi (AV-1/AV-2).

### Bütçe aritmetiği (elle hesaplandı, ÇAĞRIDAN ÖNCE)

`estimateLlmMentionsUsd(targets, rows) = (1×$0,10 + targets×rows×$0,001) × BUDGET_SAFETY_FACTOR(1,5)`

| çağrı | ham vendor | rezervasyon (×1,5) | fleet $3'ün payı | hesap ödeneği $0,50'nin payı |
|---|---|---|---|---|
| ai_visibility, 1 hedef @100 satır | $0,20 | **$0,30** | %10 | **%60** |
| compare, 2 hedef @100 | $0,30 | $0,45 | %15 | %90 |
| compare, 10 hedef @100 | $1,10 | **$1,65** | **%55** | **%330 — tek başına ödeneği bitirir** |

Son satır H-01'in ölçülmüş sonucudur: **tek bir başarısız 10-hedefli compare, hesabın günlük ücretsiz
vendor ödeneğinin 3,3 katını rezerve eder.** `free-vendor-calls.ts:122` bunu zaten biliyor
(*"ONE failure ends the allowance. That is the tool the budget exists for."*).

### Seçilebilirlik

"Does example.com come up in ChatGPT answers?" / "How is <phrase> mentioned in Google's AI answers?"
Karışabileceği komşu: `serp_snapshot` (AI Overview VARLIĞINI ölçer, LLM cevabını değil) ve
`ai_visibility_compare` (aynı soru, 2-10 özne). `subject` zorunlu ve varsayılansız olduğu için LLM'in
"domain mı keyword mü" seçimini yapması gerekiyor — sessiz bir yanlış özne mümkün değil. Ayrım yeterli.

---

## H-01 — üç hata yolunda rezervasyonun akıbeti (ÖNCE ölçüldü)

> Kaynak iddia: `docs/audits/2026-08-27-audit-remediation-closure.md:100` — *"AI visibility bütçe üst
> sınırı. Ölçüldü ve doğrulandı … Ücretli AI smoke bloklu kalıyor."*

### Üç yol × rezervasyon tablosu

`attempt()` — `apps/mcp/src/dfs/llm-mentions.ts:1116-1143`

| # | yol | kod | rezervasyon akıbeti | pinleyen test |
|---|---|---|---|---|
| 1 | **transport hatası** (`post` throw / HTTP !ok) | `:1122-1126` — settle YOK | **AÇIK KALIR**, `actual_usd = null`, gün boyu tahmininden sayılır | `llm-mentions.test.ts` > *"leaves the reservation OPEN at its estimate when nothing priced the failure"* → `expect(spend.rows()[0]?.actualUsd).toBeNull()` + `todayUsd ≈ ESTIMATED_AI_VISIBILITY_CALL_USD` |
| 2 | **vendor non-20000** (HTTP 200, task 40501) | `:1130-1134` — `settleSpend(reservation, vendorPriced, 0)` yalnız `vendorPriced !== null` ise | **KAPANIR — vendor'ın kendi rakamına**, ki bu **$0,00 olabilir** | *"settles a refused call at the vendor's own price, so ten refusals cannot fill the cap"* → `for (const row of spend.rows()) expect(row.actualUsd).toBe(0)` · *"settles at the vendor's figure when the refusal carried one"* → `toBeCloseTo(0.07)` |
| 3 | **ayrıştırma hatası / okunamayan gövde** | aynı catch, `extractLlmMentionsCostUsd(raw) === null` | **AÇIK KALIR** | 2. yolun `vendorPriced === null` dalı; ayrı isimli test yok (2 ve 3 tek catch'i paylaşıyor) |

**Testler `status`'ü değil, `actualUsd`'yi (ve `todaySpendUsd`'yi) pinliyor.** Yani "open kaldı mı" sorusu
`actual_usd === null` üzerinden ölçülüyor — bellek-içi ledger'da bu doğru vekildir.

### DK-3 sınıfı: **KISMEN**

`llm-mentions.ts` `settleFailedSpend`'i **import ETMİYOR**. Ölçüm:

```
grep -n "settleFailedSpend" apps/mcp/src/dfs/*.ts
→ backlink-changes · backlink-details · backlinks · competitors · discover-keywords
  · link-gap · ranked-keywords · relevant-pages · client   (9 port + budget.ts + testler)
→ llm-mentions.ts: HİÇ EŞLEŞME YOK
```

Dilim 4/5'te 11 port `settleFailedSpend` ile kapandı; bu aile o dalganın DIŞINDA kaldı.

### Doktrin çatışması — P1

`budget.ts:194-201` (`settleFailedSpend`, 2026-09-03 vakası) birebir:

> **NOT the vendor's reported cost, even when the failing response carries one.** A task DataForSEO
> rejected can report `cost: 0` while the request really was billed, and trusting that number on the one
> path where nothing was delivered would settle a paid call as free and hand today's remaining budget to
> the next caller.

`llm-mentions.ts:1105-1111` (2026-08-25 vakası) tam tersini söylüyor:

> `settleSpend` is exactly the reconciliation step for "the real cost is now known", and **a refusal the
> vendor priced at $0.00 is a real cost of $0.00.**

Aynı dizinde, aynı vendor hakkında, iki zıt iddia. `budget.ts` daha YENİ (2026-09-03) ve daha
muhafazakâr; `llm-mentions.ts` daha ESKİ ve gevşek yöndedir. Kimse ikisini uzlaştırmamış. → AV-3.

### Başlık :1078-1081 BAYAT mı? — **EVET** (ders 16)

`createLiveAiVisibilityClient` başlığı birebir:

> A failure at (2) **leaves the reservation open at its full estimate, which is never less than the spend
> that really happened.**

Kod bunu artık yapmıyor: 2. yol `vendorPriced` ile KAPATIYOR, ve `vendorPriced` $0,00 olabilir — bu da
"gerçekten olan harcamadan asla az değil" iddiasının tersidir. Başlık, altındaki `attempt()` doc-comment'i
(:1105-1111) tarafından çürütülüyor ama güncellenmemiş.

### Vendor üst sınırı — hâlâ KANITSIZ

`MAX_INTERNAL_LIST_ROWS = 100` (fiyat tabanı) vs `VENDOR_MAX_INTERNAL_LIST_AGGREGATED = 20` (telde).
`llm-mentions.ts:38-50` ve `:196-212` şerhi doğru ve güncel: `internal_list_limit` bir SATIR TAVANI DEĞİL
(*"maximum number of elements within internal arrays … `sources_domain`, `search_results_domain`"*), yani
**bu port'un gönderdiği hiçbir şey vendor'ın faturaladığı satır sayısını kontrol etmiyor.** Faturalanan
satır için vendor'dan bir üst sınır alınmadıkça 5,58× marj bir BAZ'dır, ölçülmüş bir marj değil.
Ölçtüğüm bugünkü durum: **iddia hâlâ kanıtsız** — 2026-08-27 kapanış notunun "ölçüldü ve doğrulandı"sı
*şerhin varlığını* doğruluyor, *fiyatı* değil. `plan.mjs:192` gerekçesi bu yüzden BAYAT DEĞİL.

**H-01 satırı: KISMEN.** Üç yoldan yalnız biri (vendor fiyatlandırdıysa) kapanıyor; ikisi açık kalıyor;
ve kapanan tek yol bunu `budget.ts`'nin açıkça yasakladığı sayıyla ($0,00 olabilir) yapıyor.

---

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`, çıktı DOSYADAN okundu (`scratchpad/dilim6/m*.log`).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `llm-mentions.ts:1132` — kısmi settle'ı devre dışı (`&& false`) | rezervasyon-kapanış testleri | **KIRMIZI** (2 test) | `settles a refused call at the vendor's own price…` + `settles at the vendor's figure when the refusal carried one`. **H-01 (a) kapalı.** |
| M2 | `llm-mentions.ts:237` — `BUDGET_SAFETY_FACTOR` 1,5 → 0,75 | bütçe tahmini pinleri | **KIRMIZI** (4 test, 2 dosya) | `free-vendor-calls.pin.test.ts > … > ai_visibility` + `… > ai_visibility_compare — the dearest call this product can make`; `llm-mentions.test.ts > errs HIGH: the estimate is strictly above the vendor's own formula, in that DIRECTION`. **H-01 (b) kapalı — tahmin hem YÖN hem DEĞER olarak pinli.** |
| M3 | `buildAiVisibilityRequestBody:549` — `...localeKeys(query)` spread'i silindi | ? | **KIRMIZI** (1 test) | `llm-mentions.test.ts > the request body for aggregated_metrics (ai_visibility) > sends the parameters this endpoint publishes, and NOT the ones siblings use`. **Ama pinin YÖNÜ yanlış** — bkz. AV-2. |
| M4 | *(compare kaydında — S1-b `.strict()`)* | — | — | bkz. `ai_visibility_compare.md` M4 |
| M7 | `ai-visibility-shared.ts:313` — `AI_VISIBILITY_JUDGEMENT_NOTE`'tan sıralama cümlesi silindi (*"and re-orders nothing — these endpoints publish no ordering field, so there is nothing to sort by and none is invented"*) | NEVER#7 metin pini | **YEŞİL KALDI** | 4198/4198 geçti. Testler `expect(text).toContain(AI_VISIBILITY_JUDGEMENT_NOTE)` yazıyor — yani **sabitin VARLIĞINI** pinliyor, **içeriğini değil**. → AV-8 |

Çalışma ağacı sonunda temiz:

```
$ git diff --stat
(boş)
$ pnpm --filter @pseo/mcp test
Test Files  162 passed (162)
     Tests  4198 passed (4198)
```

`*.db.test.ts` **koşulmadı** (Docker) — db şeridi CI/hakem. M3 turunda `server.test.ts > mcp gateway
per-IP flood throttle` de kırmızıydı; temiz koşuda yeşil → **flake**, mutasyonla ilgisiz.

---

## 3. Canlı negatif yol

Uç: canlı MCP (`MCP_SMOKE_URL`, anahtar redakte). Script: `<scratchpad>/dilim6/canli/probe-ai.mjs`.
**Dokuz negatifin dokuzu da ücretsiz** — `list_credit_activity` filtresiz okundu, hiçbirinde satır yok.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 biçimsiz uuid | `project_id: "1111…-4444-5555…"` | 200 / `isError:true` | 0 | `✖ Invalid UUID → at project_id`. *(varyant nibble'ı geçersiz — bu şema reddi, kiracı testi DEĞİL)* |
| N2 bilinmeyen alan (üst) | `+ bogus_field: 1` | 200 / `isError:true` | 0 | `✖ Unrecognized key: "bogus_field". You were not charged.` — **S1 (#204) canlıda tutuyor** |
| N3 özne çaprazı | `subject:"keyword"` + `target` | 200 / `isError:true` | 0 | İKİ ayrı ihlal ayrı ayrı adlandırılıyor (eksik `keyword` + fazla `target`), gerekçe cümlesiyle |
| N11 **yabancı proje** | geçerli v4 uuid, başkasının | 200 / `isError:true` | 0 | `No project found with id …. Run list_projects …` — **bilinmeyen id ile BİREBİR aynı cümle**; id varlığı sızmıyor (NEVER#4) |
| N13 tavan üstü | `internal_list_limit: 100` | 200 / `isError:true` | 0 | `✖ Too big: expected number to be <=20` — **outage'ın telde kalan yarısı canlıda kapalı** |
| N14 hem/hem | `target` + `project_id` | 200 / `isError:true` | 0 | `Pass "project_id" or "target", not both — they can name different domains and SeoGrep will not guess which one you meant.` |
| N15 hiçbiri | yalnız `subject`+`platform` | 200 / `isError:true` | 0 | `Nothing to look up: pass "project_id" … or "target" …` |

`resolveTarget`'ın iki ayrı cümlesi (N14/N15) `SUBJECT_INPUT_RULES.domain.requires = []` kararını
doğruluyor: kaynak yorumu *"repeating it here would produce a second wording for one mistake"* diyor ve
canlıda gerçekten tek cümle geliyor.

---

## 4. Canlı mutlu yol — **ÖLÇÜLEMEDİ**

Üç ücretli deneme yapıldı; **hiçbiri kredi harcamadı** (üçü de defterde charge+refund çifti ya da hiç satır).

| # | saat (UTC) | argüman | envelope | kredi Δ | sonuç |
|---|---|---|---|---|---|
| P1 | **2026-09-04T01:19:16Z** | `subject:domain, project_id:adstark, platform:chat_gpt, location_name:"Turkey", language_code:"tr"` | 200 / `isError:true` | −90 sonra +90 (refund) | **vendor 40501: `Invalid Field: 'location_name'.`** |
| P1b | **2026-09-04T01:19:47Z** | aynı, `location_name` YOK, `language_code:"tr"` VAR | 200 / `isError:true` | −90 sonra +90 (refund) | **vendor 40501: `Invalid Field: 'language_code'.`** |
| P1c | **2026-09-04T01:20:05Z** | aynı, lokal alan HİÇ YOK (mutlu yol denemesi) | 200 / `isError:true` | 0 (vendor'a hiç gitmedi) | **hesap ödeneği reddi:** *"`ai_visibility` is paused for your account until 00:00 UTC … daily allowance of $0.50 worth of such un-charged calls — and yours is now used up for today."* |

**Bu bir vendor bütçe reddi değil, tool kusurunun sonucudur.** İki başarısız çağrı × $0,30 tahmin = $0,60 >
$0,50 → `free-vendor-calls.ts:70` (`FREE_VENDOR_SPEND_DAILY_USD`) doğru davranarak hesabı durdurdu.
Muhafız kusurlu değil; muhafızı tetikleyen şey tool'un KENDİ ilan ettiği alanların vendor tarafından
reddedilmesi. Mutlu yol **00:00 UTC sonrasına** kalıyor.

Defter (filtresiz, çağrılardan sonra):

```
2026-09-04T01:19:48Z · +90 · refund · ai_visibility · project: adstark.com.tr
2026-09-04T01:19:47Z · -90 · charge · ai_visibility · project: adstark.com.tr
2026-09-04T01:19:17Z · +90 · refund · ai_visibility · project: adstark.com.tr
2026-09-04T01:19:16Z · -90 · charge · ai_visibility · project: adstark.com.tr
```

`project: adstark.com.tr` kapsamı defterde GÖRÜNÜYOR → migration 0033 / sınıf 2 canlıda doğrulandı.
Charge+refund çifti `withCredits`'in tasarlanmış release yoludur (throw guarded bölgeden çıkıyor),
T-B11 sınıfı bir sızıntı DEĞİL.

**Şef Supabase okuması için:** yukarıdaki üç saat (`01:19:16Z`, `01:19:47Z`, `01:20:05Z`) + compare için
`01:18:14Z`. `dfs_spend` tarafında beklenen: iki `aggregated_metrics/live` satırı, `estimated 0.30`,
`actual` = vendor'ın refusal gövdesinde ne yazdıysa (muhtemelen `0`, AV-3'ün tam da konusu);
`01:20:05Z` için **hiç satır olmamalı** (ödenek reddi rezervasyondan öncedir).

---

## 5. SEO güncelliği

Referans "Tool eşleme" satırı: `ai_visibility | R-5.1–R-5.9, R-3.20, R-3.22–R-3.24, R-8.4–R-8.7 |
En yüksek risk: llms.txt önerisi (R-5.2); AI Overview item type şemasının kayması`

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-5.2 llms.txt** (EN YÜKSEK RİSK) | hiçbir yerde | **UYUYOR (ölçülerek)** | `grep -rniE "llms\.txt\|llms-txt" apps/mcp/src apps/web/content apps/web/src` → **0 eşleşme**. 2024-25'in en yaygın bayat tavsiyesi bu üründe hiç yok. Referansın "en yüksek risk"i **karşılıksız** |
| R-5.1 ek gereksinim yok | tool hiçbir "AI için şunu yap" tavsiyesi vermiyor; yalnız vendor alanı basıyor | **UYUYOR** | `AI_VISIBILITY_JUDGEMENT_NOTE` tavsiye değil, sınır beyanı |
| **R-5.5 query fan-out** | **hiçbir yerde** | **AYKIRI** | `AI_FAN_OUT_NOTE` bu depoda VAR (`tools/serp-features.ts:68`) ve `serp_snapshot` + `keyword_positions` basıyor. `platform:"google"` tam olarak fan-out yüzeyini ölçüyor ama şerh yok. Ölçüm: `grep -rniE "fan.?out" apps/mcp/src` → ai-visibility ailesinde yalnız bir KOD yorumu (`ai-visibility-compare.ts:428`, konusu başka) → AV-6 |
| R-5.3 / R-5.4 snippet kontrolleri | anılmıyor | **İLGİSİZ** | Bu tool ölçer, öneri vermez; `nosnippet` tavsiyesi `audit_onpage`'in ekseni |
| R-5.6 Google-Extended | anılmıyor | **AYKIRI (ölçüm boşluğu)** | R-3.20 ile aynı kalem |
| R-5.7 / R-5.8 Bing AI Performance | anılmıyor | **İLGİSİZ (bugün)** | DFS LLM Mentions `platform` enum'ı **tam olarak iki** değer taşıyor (`chat_gpt`, `google`) ve description bunu açıkça söylüyor (*"There is no 'all assistants' option here"*). Bing/Copilot vendor'da yok → uydurulamaz. Kayda geçer: ürün "AI görünürlüğü" derken Copilot'u KAPSAMIYOR ve bunu söylüyor |
| **R-5.9 OAI-SearchBot tarifi** | anılmıyor | **AYKIRI** | ChatGPT görünürlüğünü ÖLÇEN tool, OpenAI'ın yayımladığı tek eyleme dönük tavsiyeyi (robots.txt'te `OAI-SearchBot`'a izin) hiç anmıyor → AV-7 |
| **R-3.20 / R-3.22–R-3.24 crawler token'ları** | hiçbir yerde | **AYKIRI (ölçüm boşluğu)** | `grep -rniE "oai-searchbot\|gptbot\|claudebot\|claude-searchbot\|perplexitybot\|google-extended\|chatgpt-user" apps/mcp/src apps/web/content` → **0 eşleşme**. Referansın "token listesi bayatlaması" riski bu ailede de **karşılıksız: liste yok ki bayatlasın** (`audit_tech` T-B8 ile aynı sonuç) |
| **R-8.4 / R-8.5 AI Overview item type'ları** | ayrıştırıcıda karşılığı yok | **İLGİSİZ — ŞERH ÖNERİLİYOR** | Ölçüm: `grep -n "item_type\|ai_overview" apps/mcp/src/dfs/llm-mentions.ts` → **0 eşleşme**. Bu tool SERP uçlarını değil `aggregated_metrics`'i çağırıyor; ayrıştırıcı skalerleri **birebir vendor anahtarıyla** taşıyor (`vendor_metrics`) ve iç içe alanları **adlandırarak** düşürüyor. Tanınan tip kümesi olmadığı için bir tip **sessizce düşürülemez** — `serp_snapshot` #221 ile birebir aynı sonuç |
| **R-8.6 goto URL çözümlemesi** | ayrıştırıcı yok | **İLGİSİZ (ölçüldü)** | `grep -iE "goto\|/url\?q=\|google\.com/url\|redirect" apps/mcp/src/dfs/llm-mentions.ts` → 0 eşleşme |
| **R-8.7 LLM Mentions genişlemesi (historical + Lite)** | tool "no date range" diyor | **ŞERH** | Uç-kapsamlı olarak DOĞRU (`aggregated_metrics/live` tarih parametresi yayımlamıyor). Ama description'ın *"so there is no period to ask for"* cümlesi AİLE düzeyinde bir mutlak gibi okunuyor; R-8.7 ailenin **historical** uçlarla genişlediğini kaydediyor. Ürün kararı, kod kusuru değil → AV-9 |
| **R-8.7 lokal (Sınıf 4)** | `location_name` + `language_code` ilan ediliyor | **AYKIRI — ÖLÇÜLDÜ** | İkisi de canlıda 40501 alıyor. Lokal ekseni bu tool'da **erişilemez**: alan verirsen çağrı düşer, vermezsen cevap *"not specified … SeoGrep does not know which"* der → AV-1 |

**Referans düzeltme önerisi (şerh, silme yok):** `ai_visibility` satırının "en yüksek risk"i iki kalemden
oluşuyor ve **ikisi de bugün karşılıksız** — llms.txt hiç yok, item type allowlist'i hiç yok. Satır
SİLİNMEMELİ (bir gün allowlist gelirse risk aynen açılır) ama "**ölçüldü 2026-09-04: ikisi de karşılıksız;
gerçekleşen risk lokal alanların vendor tarafından reddi**" şerhi düşülmeli.

---

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:41` → `ai_visibility: "report"`. `CARDED_TOOLS` (`:62`) yalnız
`get_credit_balance` içeriyor, yani bu tool bugün kart ÇİZMİYOR — eşleme ileriye dönük. Canlı payload
kartın beklediği alanları taşıyor mu: **ÖLÇÜLEMEDİ** (mutlu yol alınamadı). Ertelenmiş kalem.

---

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` girişi: **VAR — EXCLUDED**, `:192-195` birebir:
  > "paid, 90 credits/call — and BLOCKED beyond price: H-01 (audit 2026-08-26) found the vendor budget
  > ceiling for this family unproven, so paid AI smoke is refused until the upper bound is established and
  > the margin re-signed."

  **BAYAT DEĞİL.** Ölçtüm: üst sınır hâlâ kurulmuş değil (`internal_list_limit` faturalanan satırı
  kontrol etmiyor), marj yeniden imzalanmadı. Gerekçenin tarihi ("2026-08-26") kapanış dosyasındaki
  2026-08-27 ile bir gün ayrışıyor — kozmetik.
- `goals/` hedefi gerekli mi: **EVET** — `goals/dfs-budget-guard.md` bugün fleet $3 tavanına bakıyor;
  AV-1'i yakalayacak hedef **yok**: "her ücretli DFS adaptörünün ilan ettiği her istek alanı, o ucun
  vendor şemasında VAR mı" sorusunu hiçbir kapı sormuyor. Bu, 2026-08-25 outage'ının bir alanda
  kapatılıp iki alanda açık kalmasının sebebidir.

---

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, YYYY-MM-DD) |
|---|---|---|---|---|---|
| **AV-1** | **P1** | **`location_name` ve `language_code` — ikisi de ilan edilen, dokümante edilen, örneklenen alanlar — `aggregated_metrics/live` tarafından `40501 Invalid Field` ile reddediliyor. Tool bu alanlardan biri verildiğinde HER ZAMAN düşer.** 2026-08-25 outage'ının (`internal_list_limit`) aynı sınıfı; o düzeltme yalnız bir alana baktı. Sonuç canlıda ölçüldü: iki deneme hesabın $0,50 günlük ücretsiz-vendor ödeneğini bitirdi ve tool 00:00 UTC'ye kadar durduruldu | Canlı 2026-09-04T01:19:16Z → `Invalid Field: 'location_name'.` · 01:19:47Z → `Invalid Field: 'language_code'.` · 01:20:05Z → ödenek reddi. Kaynak: `llm-mentions.ts:557` (`...localeKeys(query)`) | Vendor'ın `aggregated_metrics` **input şeması** okunup hangi alanların gerçekten yayımlandığı doğrulanmalı (`llm_mentions_locations_and_languages` ucu ayrı bir uçtur — lokal oraya sorulup ID/ad ALINIR mı, yoksa bu uç lokal hiç almaz mı). Alan gerçekten yoksa: şemadan **kaldırılmalı** ve mdx/description'daki "THAT location and language" cümlesi düzeltilmeli. Alan varsa ama DEĞER biçimi farklıysa (ör. `location_name` yerine ülke listesi), doğru biçim gönderilmeli. Her iki durumda da düzeltme, `internal_list_limit` gibi **fixture'la değil vendor şemasıyla** doğrulanmalı | |
| **AV-2** | **P1** | **Testin PİNİ yanlış yöne bakıyor: `expect(body.location_name).toBe("United States")`** — yani süit, vendor'ın reddettiği alanın ve tam da mdx'in örneklediği değerin telde OLMASINI zorunlu kılıyor. Ders 12'nin en saf hâli: fixture gerçek vendor'dan hoşgörülü olduğu için eksik kısıt GEÇEN teste dönüşmüş. Bu test, başlığında 2026-08-25 outage'ını anlatan dosyanın içinde | `llm-mentions.test.ts` > *"sends the parameters this endpoint publishes, and NOT the ones siblings use"*; M3 (spread silindi) bu testi KIRMIZI yaptı | AV-1 çözülürken bu test de tersine çevrilmeli. Kalıcı çare: bu ailenin fixture'ları vendor'ın **input** şemasından türetilmeli; bugün istek gövdesini doğrulayan tek şey yine bizim yazdığımız bir beklenti | |
| **AV-3** | **P1** | **DK-3 KISMEN + doktrin çatışması.** `llm-mentions.ts` bu ailedeki tek port ki `settleFailedSpend`'i import etmiyor. Transport ve okunamayan-gövde yollarında rezervasyon AÇIK kalıyor; vendor-refuse yolunda ise **vendor'ın kendi rakamıyla** kapanıyor — ki bu $0,00 olabilir. `budget.ts:194-201` bunu ADIYLA yasaklıyor: *"NOT the vendor's reported cost, even when the failing response carries one … would settle a paid call as free and hand today's remaining budget to the next caller."* İki dosya aynı vendor hakkında zıt iddiada | `llm-mentions.ts:1122-1134`; `grep settleFailedSpend` → llm-mentions 0 eşleşme, 9 kardeş port eşleşme; M1 KIRMIZI | Çatışmayı bir insan çözmeli: ya `budget.ts`'nin doktrini geçerlidir ve bu port da `settleFailedSpend`'e geçer (transport + okunamayan yollar da kapanır), ya da `llm-mentions`'ın gerekçesi kabul edilir ve `budget.ts`'nin uyarısı bu aile için şerh alır. **Bugünkü hâl — iki zıt kural, ikisi de yürürlükte — en kötüsü** | |
| **AV-4** | **P1** | **H-01 fiyat doktrini hâlâ KANITSIZ ve artık ölçülmüş bir sonucu var.** `internal_list_limit` faturalanan satırı kontrol etmiyor, dolayısıyla 5,58× marj bir BAZ'dır. Ölçülen üst sınırlar: $0,30 / $0,45 / **$1,65** — sonuncusu fleet $3 tavanının %55'i ve hesap başına $0,50 ödeneğin **%330'u**, yani tek bir başarısız 10-hedefli çağrı ödeneği kendi başına bitirir | `estimateLlmMentionsUsd:261` elle hesaplandı; `free-vendor-calls.ts:70,122`; `llm-mentions.ts:38-50, 196-212` şerhi | Operatör imzası (NEVER#6). Vendor'dan **faturalanan satır** üst sınırı alınana kadar `plan.mjs`'in EXCLUDED gerekçesi doğru kalır. Ara adım olarak `internal_list_limit`'in fiyat tabanı olarak kullanımı bırakılıp tahminin gerçekten ölçülebilir bir tavana bağlanması düşünülmeli | |
| **AV-5** | **P2** | **Başlık BAYAT (ders 16):** `llm-mentions.ts:1078-1081` *"A failure at (2) leaves the reservation open at its full estimate, which is never less than the spend that really happened."* — kod artık 2. yolda kapatıyor, ve kapattığı sayı $0,00 olabilir, yani "asla az değil" yanlış | `:1078-1081` vs `:1105-1111` vs `:1130-1134` | Başlık `attempt()`'in bugünkü üç yolunu anlatacak şekilde güncellensin (AV-3 kararı ne olursa olsun) | |
| **AV-6** | **P2** | **R-5.5 fan-out şerhi yok.** `AI_FAN_OUT_NOTE` depoda var ve iki tool basıyor; `platform:"google"` tam da Google AI cevaplarını ölçtüğü hâlde `ai_visibility` basmıyor | `grep -rniE "fan.?out" apps/mcp/src`; `serp-features.ts:68` | Şerh, `platform === "google"` cevaplarına eklensin (mevcut sabit yeniden kullanılabilir). NEVER#7 ekseni | |
| **AV-7** | **P2** | **R-5.9 / R-3.22–3.24: hiçbir AI crawler token'ı üründe yok.** ChatGPT görünürlüğünü ölçen tool, OpenAI'ın yayımladığı tek eyleme dönük tavsiyeyi (robots.txt'te `OAI-SearchBot`) hiç anmıyor. Referansın "token listesi bayatlaması" riski **karşılıksız — liste yok** | `grep -rniE "oai-searchbot\|gptbot\|claudebot\|perplexitybot\|google-extended"` → 0 | Ürün kararı. En ucuz hâli: cevabın sonuna, ölçüm sıfır satır döndüğünde, "ChatGPT'nin sitenizi görebilmesi için OpenAI `OAI-SearchBot`'a izin verilmesini şart koşuyor" gibi TEK bir kaynak-atıflı cümle. Liste eklenirse bayatlama riski AÇILIR — kayda geçsin | |
| **AV-8** | **P2** | **NEVER#7 metni yalnız KİMLİĞİYLE pinli.** Testler `expect(text).toContain(AI_VISIBILITY_JUDGEMENT_NOTE)` yazıyor; sabitin İÇİ boşaltılırsa süit yeşil kalır. M7: sıralama cümlesi silindi → 4198/4198 geçti | M7 YEŞİL; `ai-visibility.test.ts:394`, `ai-visibility-compare.test.ts:359` | En az bir test, sabitin İÇİNDEKİ yükü taşıyan cümleleri (skor yok / sıralama yok / bildirilmeyen ≠ sıfır) ayrı ayrı `/i` regex'le pinlesin (ders 11: kaynak literali değil, en kısa ayırt edici parça) | |
| **AV-9** | **P2** | Description ve mdx *"this vendor endpoint takes no date range, so there is no period to ask for"* diyor. Uç düzeyinde DOĞRU; ama R-8.7 ailenin **historical** uçlarla genişlediğini kaydediyor, ve cümle aile düzeyinde bir mutlak gibi okunuyor | Referans R-8.7; `llm-mentions.ts:141-147` (yalnız iki `/live` ucu) | Metin şerhi: "*this endpoint*" vurgusu korunsun; ya da bir cümle ile "DataForSEO bu aile için ayrıca historical uçlar yayımlıyor; SeoGrep bugün onları çağırmıyor" denilsin. İmza kalemi değil, metin borcu | |
| **AV-10** | **P2** | **Hiçbir kapı, bir DFS adaptörünün ilan ettiği istek alanlarının o ucun vendor şemasında var olduğunu ölçmüyor.** AV-1'in kök sebebi budur: 2026-08-25 outage'ı bir alanda kapatıldı, iki alan açık kaldı ve bunu yakalayan tek şey canlı ücretli çağrı oldu | `goals/` listesi; `verify.sh` kapsam tablosu (CLAUDE.md) | `goals/` hedefi ya da bir `check-*` : her `dfs/*.ts` istek gövdesinin anahtarları, o adaptörün başlığında alıntılanan vendor input şemasıyla karşılaştırılsın. Bugün vendor şeması yalnız YORUM olarak duruyor — makine okunur bir yere (fixture ya da JSON) inerse kapıya bağlanabilir | |
</content>
</invoke>
