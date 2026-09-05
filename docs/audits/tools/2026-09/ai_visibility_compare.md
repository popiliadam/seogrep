# `ai_visibility_compare` — tool kontrol kaydı (2026-09 turu)

> Dilim: 6 · İşçi: Opus 4.8 · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Taban: worktree `audit/dilim6-ai`, main `800d5ee`; `pnpm --filter @pseo/mcp test` → **162 dosya / 4198 test, exit 0**.
> H-01 (rezervasyon / bütçe / fiyat doktrini) **kardeş kayıtta** ölçüldü: `ai_visibility.md` § "H-01".
> Bu tool o port'un ikinci müşterisidir — H-01'in her satırı buraya da uygulanır, **10 katına kadar büyümüş olarak**.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler + zod + `costs.ts:142` + `CREDIT_UNITS:260` + mdx + port okundu; birim aritmetiği **canlıda doğrulandı** (2 hedef = 180) |
| 2 Mutasyon | ÖLÇÜLDÜ | 3 mutasyon: M5/M6 KIRMIZI (7 test), **M4 (S1-b `.strict()`) İKİ YÖNDE DE YEŞİL** |
| 3 Canlı negatif | ÖLÇÜLDÜ | 8 negatif; 7'si ücretsiz, **1'i (N6) ücretsiz OLMASI gerekirken 180 kredi harcadı** — S1-b'nin bedeli |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ (kazara) | N6 gerçek bir cevap döndürdü: 2 hedefin **ikisi de "unanswered"**, 0 satır, 180 kredi, **iade YOK** |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-5.5 (referansın adlandırdığı EN YÜKSEK RİSK) **AYKIRI**; R-3.22–3.24 **AYKIRI (karşılıksız)**; R-8.5/8.7 İLGİSİZ/şerh |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:42` → `"report"`; `CARDED_TOOLS`'ta yok (ertelenmiş) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | `plan.mjs:196` EXCLUDED, gerekçe BAYAT DEĞİL; `goals/` hedefi EVET |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — `targets[]` iç içe objesi katı değil (S1-b, Dilim 1'den
devir) ve bunun bedeli ölçüldü: yazım hatalı bir alan sessizce düşüyor ve çağrı **180 kredi ile** koşuyor;
ayrıca kardeş tool'da kanıtlanan lokal-alan kusuru bu tool'da 180–900 kredilik çağrıları vuruyor.

**Karar (hakem turu, 2026-09-04 — taze Fable, SERT): PASS (şerhli).** HM1 (`compareTargetSchema.strict()`)
→ 4198 **yeşil** (M4 iddiası tuttu) · HM8 (`soleComparedProjectId` → `[...ids][0]`) → **1 kırmızı**
(#215 gerçekten pinli) · canlı defter satırı hakem tarafından işçinin ham `jsonl`'i üzerinden birebir
doğrulandı. Şerhler: **AVC-1 P1 → P2** · **AVC-2 ayrı kalem olmaktan çıktı, AV-1/H-1'e KATLANDI** ·
yeni **H-5** (2 hedef · 0,45 → 0,101 · 4,5× · "0 rows" ↔ vendor 1 satır) · satır/sayı düzeltmeleri.

**Karar (kapanış, 2026-09-05):** **KAPANDI (dilim 6 düzeltmesi, #234 paket I + #235 paket K; kalan:
AVC-3 İMZA · H-5'in fiyat yarısı İMZA · AVC-4'ün keyword ekseni ve AVC-5 AÇIK).** S1-b Dilim 1'den beri
açık olan iç içe katılık deliğini **genel çözümle** kapattı ve 38 tool'da tarandı. **Bu tool canlıda hiç
koşulmadı** (180–900 kredi): AVC-2'nin ikinci canlı hücresi ölçülmedi ve kayıt bunu `canlı ✔` diye
saymıyor. Ölçüm ve hakem turlarının kararları **silinmedi** (ders 16).

---

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/ai-visibility-compare.ts:360` (`charge: "handler"`, `units: comparedTargetCount`)
- Port: `llm-mentions.ts:1168` (`fetchAiVisibilityCompare`), uç `cross_aggregated_metrics/live` (`:146`)
- Kapsam kararı: `soleComparedProjectId:258`

### Zod şeması (canlı `tools/list`'ten ölçüldü, 2026-09-04)

```
top additionalProperties: false                      ← S1 (#204) TUTUYOR
top properties: targets,platform,internal_list_limit,location_name,language_code,confirm
required: ["targets","platform"]
confirm advertised? TRUE                             ← #204 kararı canlıda ✔ (yalnız crawl_site + bu tool)
targets: minItems 2, maxItems 10
targets[] items.additionalProperties: undefined      ← ***S1-b: İÇ İÇE OBJE KATI DEĞİL***
targets[] items.properties: label,domain,keyword,project_id
```

> **(hakem turu, 2026-09-04) — şerh, satır numaraları.** Bu kayıt `compareTargetSchema` için **iki
> farklı satır** veriyor: burada `:94` (tanım), M4 satırında `:128` (`.strict()`'in eklendiği yer).
> Hakemin HM1'i mutasyonu şemanın **tanımına** uyguladı ve 4198 yeşil aldı — yani M4'ün sonucu tuttu.
> Okur satır numarasına değil **sembol adına** baksın (ders 11: kaynak literali değil, en kısa ayırt
> edici parça); iki numaradan hangisinin bugünkü ağaçta doğru olduğu bu turda ayrıca ölçülmedi.

**S1-b kök sebebi ölçüldü:** `registry.ts:489` `refuseUnknownKeys` yalnız `schema instanceof z.ZodObject`
olan **ÜST DÜZEY** şemayı `.strict()` yapıyor. `compareTargetSchema` (`:94`) bir dizi elemanıdır ve
`refuseUnknownKeys`'in menzilinde değildir. Kaynak yorumu bunu zaten söylüyor
(*"Adding `.strict()` tool by tool would be a hand-maintained list of 38 places to remember"*) — çözüm
üst düzeyde doğru, iç içe objelerde **kapsamsız**.

### Description (birebir alıntı, canlı yüzeyden)

> Compare how several domains or keywords are mentioned in one AI assistant's answers, side by side, from
> DataForSEO's LLM Mentions data. Pass 2-10 targets (each a domain, a keyword or one of your project ids)
> and a platform — chat_gpt or google. The answer is scoped to THAT assistant, THAT location and language,
> and whatever moment DataForSEO measured it: this vendor endpoint takes no date range, so there is no
> period to ask for. The targets are listed in the order you passed them and nothing is ranked: SeoGrep
> computes no visibility score, no share of voice and no winner, and a target DataForSEO returned no row
> for is named as unanswered rather than shown as a zero. Synchronous — everything comes back immediately.
> Costs 90 credits, charged per compared target — two targets cost 180 and ten cost 900, and a comparison
> above the safety threshold asks you to confirm before it runs. Needs a paid credit balance: it is not
> available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so
> and charges nothing.

Description **birim fiyatı açıkça söylüyor** ("two targets cost 180 and ten cost 900") — sınıf S7 temiz.
Söylemediği şey: **cevapsız bir hedef de tam fiyat ödetir** (AVC-3).

### Kredi satırı (birebir)

`apps/mcp/src/credits/costs.ts:142`:
```
  ai_visibility_compare: 90,
```
~~`apps/mcp/src/credits/costs.ts:260-263`~~ **`apps/mcp/src/credits/costs.ts:259-262`**
*(hakem turu, 2026-09-04: satır aralığı düzeltildi)*:
```
export const CREDIT_UNITS = {
  ai_visibility_compare: { unit: "compared target", min_units: 2, max_units: 10 },
  serp_snapshot: { unit: "keyword", base: 5, min_units: 1, max_units: 10 },
} as const satisfies Partial<Record<ToolName, PerUnitPriceRule>>;
```

**Aritmetik ÖLÇÜLDÜ, tahmin edilmedi:** `base` YOK (yalnız `serp_snapshot`'ta var), yani fiyat düz
`90 × hedef`. Canlı doğrulama: 2 hedef → defterde **`-180`** (bkz. §4); 3 hedef → D17 istemi
**`estimate_credits: 270`** (bkz. §3 N10). 10 hedef = 900, description ve mdx'te yazılı.

### Docs sayfası

`apps/web/content/docs/tools-reference/ai-visibility-compare.mdx` (ÜRETİLİYOR). Kredi cümlesi birebir:
`**Cost:** 90 credits per compared target — 2 to 10 compared targets per call, so 180 to 900 credits.`
Gövde "It ranks nothing" ve "'No row' is not 'zero'" başlıklarını taşıyor — çıktıyla uyumlu (§4'te
doğrulandı). Tutarsızlık: yok — kredi/aritmetik/`confirm` üçü de kod, docs ve canlı yüzeyde aynı.

### Vendor bütçe tahmini (elle, ÇAĞRIDAN ÖNCE)

`estimateLlmMentionsUsd(groups.length, 100) = (0,10 + hedef×100×0,001) × 1,5`
→ 2 hedef **$0,45** · 10 hedef **$1,65**. İş emrinin ≤$0,50 tavanı 2 hedefte tutuyor; **10 hedef
tavanın 3,3 katıdır ve hesabın günlük ücretsiz-vendor ödeneğini ($0,50) tek başına bitirir.**

### Seçilebilirlik

"Compare my site against these competitors in ChatGPT answers." Karışabileceği komşular:
`compare_competitors` (organik SERP/backlink ekseni, LLM değil) ve `ai_visibility` (tek özne).
`targets` dizisinin zorunlu min 2 olması, tek özne için yanlışlıkla bu tool'un seçilmesini
**ücretsiz** olarak reddediyor (§3 N4). Ayrım yeterli.

---

## 2. Mutasyon (test gerçekten bakıyor mu)

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| **M4** | `ai-visibility-compare.ts:128` — `compareTargetSchema`'ya `.strict()` **EKLENDİ** (S1-b'nin düzeltmesi) | ? | **YEŞİL KALDI (4198/4198)** | **İki yönde de bulgu:** (a) hiçbir test iç içe gevşekliğe BAĞIMLI değil → düzeltme bedava; (b) hiçbir test gevşekliği ya da katılığı ÖLÇMÜYOR → S1-b bugün kapısız. Canlı ölçüm (`items.additionalProperties: undefined`) ve N6 (180 kredilik sessiz kabul) bunu tamamlıyor |
| **M5** | `soleComparedProjectId:262` — `ids.size === 1 ? … : undefined` yerine `[...ids][0]` (liste sırasına göre kapsam uydur) | kiracı/kapsam pini | **KIRMIZI** | `ai-visibility-compare-scope.pin.test.ts > … > records no project scope when the comparison spans two of the caller's projects`. **#215 kararı ("tek proje değilse kapsam yok") gerçekten pinli.** |
| **M6** | `ai-visibility-compare.ts:409` — `withCredits` meta'sından `units:` silindi | ücret aritmetiği | **KIRMIZI (7 test, 3 dosya)** | `ai-visibility-compare.reserve.test.ts` 3 test (*reserves 180 for two targets — the count reaches the guard as `units: 2`* · *reserves 900 for ten confirmed targets* · *hands the guard a COUNT and nothing resembling a price*) + scope pin 3 + `ai-visibility-compare.test.ts` 1. **`reserve.test.ts` başlığındaki "2402 spec yeşil kaldı" iddiası TARİHSEL — delik bugün kapalı ve çok yerden pinli** (ders 13: kendi düzeltmenin teşhisi de hipotezdir; ölçtüm) |

Çalışma ağacı sonunda temiz — `git diff --stat` boş, `162 passed / 4198 passed`. `*.db.test.ts` koşulmadı.

---

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N4 tek hedef | `targets: [{domain}]` | 200 / `isError:true` | 0 | `✖ Too small: expected array to have >=2 items` |
| N5 11 hedef | 11 eleman | 200 / `isError:true` | 0 | `✖ Too big: expected array to have <=10 items` |
| **N6 S1-b** | `targets: [{domain:"adstark.com.tr", bogus_nested:"x"}, {domain:"sempeak.com"}]` | 200 / **`isError` YOK — BAŞARILI** | **−180** | **Bilinmeyen iç içe alan sessizce düşürüldü ve çağrı ücretli koştu.** Bu satır ücretsiz bir negatif OLMALIYDI |
| N7 aynı label | iki hedef `label:"A"` | 200 / `isError:true` | 0 | `Duplicate aggregation_key "A": the vendor echoes this key back and it is what rows are matched on, so two targets cannot share one. You were not charged.` |
| N8 hedef=kendi domaini (yineleme) | aynı domain ×2 | 200 / `isError:true` | 0 | Aynı cümle, `aggregation_key "adstark.com.tr"`. `validateCompareGroups` rezervasyondan ÖNCE (`:379-385`) — doğru |
| N9 biçimsiz uuid target'ta | `targets[1].project_id` bozuk | 200 / `isError:true` | 0 | `✖ Invalid UUID → at targets[1].project_id` — **yol dizinle birlikte adlandırılıyor** |
| N12 **yabancı proje** | geçerli v4 uuid, başkasının | 200 / `isError:true` | 0 | `No project found with id …` — `ai_visibility` ile **birebir aynı cümle**; kiracı sızıntısı yok (NEVER#4) |
| N16 / N17 hedef şekli | `{domain,keyword}` / `{}` | 200 / `isError:true` | 0 | `✖ Each compared target names exactly one of "domain", "keyword" or "project_id" — this one names several…` / `… — this one names none.` → `targets[0]` |
| **N10 D17 confirm** | 3 hedef (270 kr), `confirm` YOK | 200 / başarılı zarf, **iş yapılmadı** | 0 | `{"requires_confirmation":true,"estimate_credits":270,"message":"Confirmation required: \"ai_visibility_compare\" is estimated to cost 270 credits, which is above the 200-credit safety threshold. No credits have been charged. To proceed, run \"ai_visibility_compare\" again with \"confirm\": true."}` — **eşik, aritmetik ve `confirm` sözleşmesi canlıda doğrulandı** |

**Confirm ekseni:** `confirm` alanı yalnız bu tool'da (+ `crawl_site`) ilan ediliyor — Dilim 1 #204
kararının canlı doğrulaması. 2 hedef (180) eşiğin altında olduğu için `confirm`'süz koşuyor; N6'nın
ücretli koşmasının ikinci sebebi budur.

---

## 4. Canlı mutlu yol

Mutlu yol **N6 ile kazara** alındı (bkz. §3 ve "Sapmalar"). Argüman ve çıktı:

| senaryo | argüman | envelope | kredi Δ | çıktı özeti |
|---|---|---|---|---|
| N6 = mutlu yol | `targets:[{domain:"adstark.com.tr", bogus_nested:"x"},{domain:"sempeak.com"}], platform:"chat_gpt"` (lokal alan YOK) | 200, `isError` yok | **−180, iade YOK** | 2 hedef, **0 satır**, ikisi de "unanswered" |

Çıktının taşıdıkları (birebir, kısaltılmış):

- Başlık: `AI visibility comparison across 2 targets — DataForSEO LLM Mentions cross_aggregated_metrics, one request for all of them.`
- Kapsam beyanı **tam**: platform (`Mentions observed in ChatGPT answers only … It says nothing about any other assistant.`), lokal (`location_name not specified in this request, so DataForSEO applied its own default and SeoGrep does not know which`), zaman (`DataForSEO did not report when it measured this, and SeoGrep does not put its own clock in place of a missing vendor timestamp. DataForSEO echoed the platform back as \`chat_gpt\`.`), dönem (`this DataForSEO endpoint takes no date range…`)
- Sıralama şerhi basılıyor: `The targets below are in the order you listed them. … this is not a ranking, and position here means only what you typed.`
- Satır başlığı: `0 rows came back under an internal_list_limit of 10.` → **vendor tavanı (10) telde**, fiyat tabanı (100) değil. Outage düzeltmesi canlıda çalışıyor. *(hakem turu, 2026-09-04: bu cümle **vendor'ın faturaladığı satırla ÇELİŞİYOR** — `dfs_spend.actual_usd = 0.101` ≈ 1 satır. Bkz. **H-5**, sınıf D4-3/8.)*
- Her hedef: `DataForSEO returned no row for this target. That is not a zero: the vendor did not report on it at all, and a zero would be a measurement nobody made.`
- Kapanış: `DataForSEO returned no row for 2 of the 2 compared targets: adstark.com.tr, sempeak.com. Those are unanswered, not zeroes.`

**Sınıf 3/8 (vendor rakamlarının ne olduğu): UYUYOR** — hiçbir rakam uydurulmadı, sıfır basılmadı,
"cevapsız" ile "sıfır" ayrı tutuldu, vendor'ın echo'su bizim isteğimizden ayrı raporlandı.

**Sınıf 2 (ücret kapsamı) canlıda:** defter satırı `-180 credits · charge · ai_visibility_compare ·
**no project scope**`. İki hedef de çıplak domain olduğu için `soleComparedProjectId` → `undefined`.
**#215 kararının canlı görüntüsü budur** ve doğrudur (uydurma kapsam yerine boşluk).

Defter (filtresiz):
```
2026-09-04T01:18:14.681029+00:00 · -180 credits · charge · ai_visibility_compare · no project scope
```
İade satırı **yok** — vendor cevap verdi, yalnız satır döndürmedi. Bakiye sonrası: 2572 kredi.

Ham kayıt: `<scratchpad>/dilim6/canli/ai.jsonl` (anahtar `makeRedactor` ile redakte).
**Şef Supabase okuması için çağrı saati: 2026-09-04T01:18:14Z**, uç `cross_aggregated_metrics/live`,
beklenen `dfs_spend.estimated_usd = 0.45`, `actual_usd` = vendor'ın `cost` alanı.

### H-5 (hakem turu, 2026-09-04 — yeni bulgu; **AV-4'e VERİ**, imza kalemi)

Şef prod `public.dfs_spend`'i okudu (`spend_day = 2026-09-04` UTC) ve bu tek çağrı için ölçtü:

| uç | hedef | tahmin | **gerçek** | oran |
|---|---|---|---|---|
| `llm_mentions/cross_aggregated_metrics/live` | **2** | 0,45 | **0,101** | **4,5×** |

> **Şef gözlemi Ş-1 "3 hedef" diyordu; DOĞRUSU 2 hedef.** 0,45 tahmini **iki** hedefin formülüdür
> (`(0,10 + 2×100×0,001) × 1,5`); üç hedefli deneme (§3 N10) D17 eşiğinde **rezervasyonsuz** reddedildi,
> yani vendor'a hiç gitmedi ve `dfs_spend`'de satırı yoktur. Bir plan/gözlem cümlesi, koşulduğu
> kanıtlanmadan ölçüm değildir (ders 13).

**Ölçülen üç sonuç:**

1. **Tahmin/gerçek oranı 4,5×** — Dilim 5'in `analyze_backlinks` 3,8× vakasıyla **aynı sınıf** (D4-9).
   Günlük $3 tavanı TAHMİNLE sayıldığı için bu ucun bütçe payı gerçeğin dört buçuk katı ayrılıyor.
2. **Faturalanan satır ≈ 1.** Vendor dokümanının kendi örnek cevabı da `cost: 0.101` taşıyor; birim
   fiyat satır başına $0,001 olduğuna göre **bu çağrıda vendor bir satır faturaladı.**
3. **Basılan ≠ faturalanan — sınıf D4-3/8.** Çıktı *"0 rows came back under an internal_list_limit of
   10"* ve *"no row for 2 of the 2 compared targets"* diyor; vendor ise **bir satır** faturaladı. İki
   ifade çelişmiyor olabilir (faturalanan "satır", basılan `items` ile aynı şey olmayabilir) — ama
   **hiçbir yüzey bunun ayrı iki ölçüm olduğunu söylemiyor**, ve müşteri 180 kredi ödeyip "hiçbir şey
   dönmedi" okuyor. Bu, AVC-3'ün (cevapsız hedef de faturalanır) **vendor tarafındaki** yüzüdür.

**Marj:** bu çağrıda 180 kredi karşılığı $0,101 vendor maliyeti — **≈22×**. **AV-4'ün fiyat doktrini
tam olarak bu sayıyı bekliyordu** ve artık bir ölçümü var: `costs.ts:127-134`'ün 5,58× hesabı
`MAX_INTERNAL_LIST_ROWS = 100` (satır TAVANI) varsayımına dayanıyor; ölçülen satır **≈1**.
**NEVER#6 — hiçbir rakam bu turda değişmez; kalem imzaya gider** (fiyat, kredi maliyeti ve paket
rakamları insan onayı olmadan değişmez). Tek çağrılık bir ölçüm bir fiyat kararı için taban değildir;
kalem "22× ölçüldü, taban varsayımı çürüdü" olarak durur.

---

## 5. SEO güncelliği

Referans satırı: `ai_visibility_compare | R-5.5, R-5.7, R-5.8, R-8.5, R-8.7, R-3.22–R-3.24 |
Query fan-out (R-5.5) yüzünden tek-kelime karşılaştırmasının yanıltıcı olması … Token listesi
bayatlaması bu ailenin riskidir`

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-5.5 query fan-out** (referansın adlandırdığı EN YÜKSEK RİSK) | **hiçbir yerde** | **AYKIRI** | Ölçüm: `grep -rniE "fan.?out" apps/mcp/src` → bu tool'da yalnız `:428`'de KONUSU BAŞKA bir kod yorumu ("the fan-out itself" = run-row yazımı). `AI_FAN_OUT_NOTE` (`serp-features.ts:68`) depoda var ve iki tool basıyor. Bu tool **keyword-vs-keyword karşılaştırmayı açıkça davet ediyor** (`keyword` bir hedef tipidir) ve `platform:"google"` doğrudan Google AI cevaplarını ölçüyor — referansın uyardığı yanıltıcılık burada **karşılığını buluyor**. `CALLER_ORDER_NOTE` sıralama yanılgısını kapatıyor, fan-out yanılgısını kapatmıyor → AVC-5 |
| R-5.7 / R-5.8 Bing AI Performance | anılmıyor | **İLGİSİZ (bugün)** | `platform` enum'ı tam olarak `chat_gpt` ve `google`; description *"There is no 'all assistants' option here"* diyor. Bing/Copilot vendor'da yok → uydurulamaz, ve tool bunu söylüyor. Kayda geçer: bir "AI görünürlük karşılaştırması" Copilot'u kapsamıyor |
| **R-3.22–R-3.24 crawler token'ları** | **hiçbir yerde** | **AYKIRI (karşılıksız)** | `grep -rniE "oai-searchbot\|gptbot\|claudebot\|claude-searchbot\|perplexitybot\|chatgpt-user\|google-extended" apps/mcp/src apps/web/content` → **0 eşleşme**. Referansın "token listesi bayatlaması bu ailenin riskidir" cümlesi bugün **karşılıksız: liste yok ki bayatlasın** (`audit_tech` T-B8 ve `ai_visibility` AV-7 ile aynı sonuç). Risk ancak liste eklenirse doğar |
| **R-8.5 AI Overview item type'ları** | ayrıştırıcıda karşılığı yok | **İLGİSİZ — ŞERH ÖNERİLİYOR** | `grep -n "item_type\|ai_overview" apps/mcp/src/dfs/llm-mentions.ts` → **0**. Bu tool SERP uçlarını çağırmıyor; `parseAiVisibilityCompareResponse:830` skalerleri vendor anahtarıyla birebir taşıyor, iç içe alanları **adlandırarak** düşürüyor (`vendor_nested_fields_not_carried`). **Tanınan tip kümesi yok → yeni bir tip sessizce düşürülemez.** `serp_snapshot` #221 ile birebir aynı gerekçe |
| **R-8.7 LLM Mentions genişlemesi** | "no date range" | **ŞERH** | Uç düzeyinde doğru; aile düzeyinde historical uçlar var (bkz. `ai_visibility.md` AV-9) |
| **R-8.7 lokal ekseni (Sınıf 4)** | `location_name` + `language_code` ilan ediliyor | **AYKIRI — statik** | `buildAiVisibilityCompareRequestBody:606` de `...localeKeys(query)` yapıyor, yani `cross_aggregated_metrics`'e de aynı alanlar gidiyor. Kardeş tool'da bu alanlar **40501 ile reddedildi** (`ai_visibility.md` AV-1, iki canlı ölçüm). Bu tool'da **canlı ölçülmedi** — bir deneme 180 kredi + $0,45 vendor demek ve hesabın ücretsiz ödeneği zaten tükenmişti. Kod yolu aynı olduğu için beklenen sonuç aynıdır → AVC-2. *(hakem turu, 2026-09-04: **"beklenen sonuç aynıdır" bir HİPOTEZDİR** — bu uçta ölçüm yok. Kalem **AV-1/H-1'e katlandı**; H-1'in zorunlu canlı listesi bu ucu ayrı bir hücre olarak taşır)* |

**Referans düzeltme önerisi (şerh, silme yok):** satırın R-8.5 kalemi için "*ölçüldü 2026-09-04: bu
ailede allowlist YOK, risk karşılıksız — ayrıştırıcı bir gün tanınan tip kümesine dönerse aynen açılır*"
şerhi; R-3.22–3.24 için "*karşılıksız — liste yok*" şerhi. R-5.5 satırı **aynen kalmalı**: risk
gerçektir ve bugün karşılanmamıştır.

---

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:42` → `ai_visibility_compare: "report"`. `CARDED_TOOLS` (`:62`) yalnız
`get_credit_balance` — bu tool bugün kart çizmiyor. Canlı payload düz metindir (`textResult`), kartın
beklediği yapısal alanları taşımıyor; bir kart eklenecekse hedef-başına bölüm ve "unanswered" ayrımı
yapısal olarak çıkarılabilir hâle gelmeli. Ertelenmiş.

---

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` girişi: **VAR — EXCLUDED**, `:196` birebir:
  > "paid, 90 credits PER TARGET over 2-10 targets. Blocked by H-01 exactly as ai_visibility is."

  **BAYAT DEĞİL** — H-01 açık (bkz. `ai_visibility.md`). Ancak gerekçe fiyat/bütçe eksenini adlandırıyor;
  bugünkü ölçümden sonra ikinci bir engel daha var (lokal alanlar), o da yazılabilir.
- `goals/` hedefi gerekli mi: **EVET** — iki eksende:
  1. **S1-b:** hiçbir kapı iç içe obje katılığını ölçmüyor (M4 iki yönde de yeşil). `registry.test.ts`
     `ALL_TOOLS` üzerinde ilan edilen JSON Schema'yı okuyor; aynı döngü **iç içe `object` düğümlerinde de**
     `additionalProperties:false` arayabilir. Bugün 38 tool'un ilanında bu sorulmuyor.
  2. **AV-10 (kardeş kayıt):** ilan edilen istek alanlarının vendor şemasında var olduğu.

---

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-05) |
|---|---|---|---|---|---|
| **AVC-1** | ~~**P1**~~ → **P2** *(hakem turu, 2026-09-04)*. **Gerekçe:** sessiz-para yolu ölçülünce **yalnız `label` yazım hatasına** indi — `domain`, `keyword` ve `project_id` yazım hataları **ücretsiz** reddediliyor (§3 N17: *"names none"*), çünkü hedef şekli `superRefine` ile ayrıca doğrulanıyor. Yani "180–900 kredi sessizce yanar" kanalı tek bir opsiyonel alandan geçiyor ve o alanın düşmesi **etiket** kusuru üretiyor, ölçüm kusuru değil. **Şiddet bandı (Dilim 5 H-1): çıplak açıklama boşluğu P2, NEVER#4/#5 ekseni ve ölçülmüş iddia hatası P1.** Kalem **vendor per-target seçeneklerini ilan ettiği gün P1'e döner** — o zaman düşen bir alan ölçümün kendisini değiştirir | **S1-b: `targets[]` iç içe objesi katı değil ve bunun bedeli para.** Bilinmeyen bir alan sessizce düşüyor ve çağrı **180–900 kredi ile koşuyor**. En zararlı hâli `label`'ın yazım hatası: `label` vendor'ın `aggregation_key`'idir ve **satırlar onunla eşleştirilir** — düşen bir `labell`, hedefi kullanıcının beklediği adla değil domainiyle etiketler, ve kullanıcı 10 hedefli bir cevapta hangi satırın kime ait olduğunu yanlış okuyabilir. **Üç bağımsız ölçüm:** (a) canlı ilan `targets[] items.additionalProperties: undefined` iken üst düzey `false`; (b) canlı N6 çağrısı `bogus_nested`'ı yuttu, başarıyla döndü ve **defterde `-180` bıraktı**; (c) M4 — `.strict()` eklemek 4198/4198 yeşil bıraktı, yani ne gevşekliğe bağımlılık ne de katılık pini var | Canlı `tools/list` 2026-09-04; defter `2026-09-04T01:18:14Z · -180`; M4 log | `refuseUnknownKeys` (`registry.ts:489`) yalnız üst düzey `ZodObject`'e `.strict()` uyguluyor. İki seçenek: (i) `compareTargetSchema`'ya `.strict()` — tek satır, ölçüldü ki hiçbir şeyi kırmıyor, ama "38 yerde hatırlanacak liste" sorununu geri getirir; (ii) `refuseUnknownKeys` iç içe `ZodObject`'lere de inen bir gezinti yapsın — genel çözüm, ama tüm yüzeyi etkiler ve ayrı ölçüm ister. **Hangi seçenek olursa olsun, `registry.test.ts`'in ilan döngüsü iç içe düğümleri de sorgulamalı** — yoksa aynı delik üçüncü bir eksende açılır (ders 14) |**KAPANDI #234 — ve GENEL seçenekle (ii):** `registry.ts` `refuseUnknownKeys` artık iç düğümlere iniyor (`tightenNode` + `carryMeta`, `.describe()`leri taşıyarak). 38 tool tarandı: **iç içe obje yalnız `ai_visibility_compare.targets[]`**, 36/38 şema **bayt-birebir** (hakem ölçtü). Hakemin şart koştuğu ikinci yarı da yapıldı: `registry.test.ts`'in ilan döngüsü iç içe düğümleri de sorguluyor (ders 14). Canlıda ölçülmedi — reddi görmek 0 kredi, ama şef sondası bu ucu koşmadı. |
| ~~**AVC-2**~~ | ~~**P1**~~ **AYRI KALEM DEĞİL — `ai_visibility` AV-1/H-1'E KATLANDI** *(hakem turu, 2026-09-04)*. Gerekçe hakemin kendi cümlesidir: **bu uçta hiçbir şey ÖLÇÜLMEDİ** (kaydın kendisi de bunu yazıyor); elde yalnız kardeş uçtaki iki ölçüm ve **ortak kod yolu** (`localeKeys` iki gövdeyi de besliyor) var. İki ayrı P1 kalemi tutmak, tek bir ölçülmemiş teşhisi iki kez saymaktır. **H-1'in zorunlu canlı ölçüm listesi bu ucu da kapsar** ve `internal_list_limit` tavanlarının 20 vs 10 ayrışması, iki ucun vendor şemasının aynı olmayabileceğinin ölçülmüş kanıtıdır — yani katlama, "aynı sayılır" demek DEĞİLDİR: tek kalem, **iki canlı hücre**. **Satır silinmedi** | **`location_name` / `language_code` bu tool'un istek gövdesine de giriyor** (`buildAiVisibilityCompareRequestBody:606` → `...localeKeys(query)`), ve kardeş uçta bu alanların ikisi de `40501 Invalid Field` aldı. Aynı kusur burada **180–900 kredilik** çağrıları vurur ve tek bir başarısız 10-hedefli çağrı hesabın günlük ücretsiz-vendor ödeneğinin ($0,50) 3,3 katını rezerve eder | Statik: `:606`; canlı kanıt kardeş uçta (`ai_visibility.md` AV-1, 2026-09-04T01:19:16Z ve 01:19:47Z). **Bu uçta canlı ölçülmedi** — 180 kredi + ödenek tükenmişti | AV-1 ile TEK kalem olarak düzeltilmeli (`localeKeys` her iki gövdeyi de besliyor). Düzeltme sonrası bu uçta da **bir** canlı doğrulama şart: iki ucun vendor şeması aynı olmayabilir (`internal_list_limit` tavanları 20 vs 10 ile zaten ayrışıyor — o dosyanın kendi dersi budur) |**KAPANDI #234 + #235 (AV-1/H-1 ile TEK kalem; `refinePlatformLocale` iki gövdeyi de besliyor) — bu uçta canlı ÖLÇÜLMEDİ.** Hakemin "tek kalem, İKİ canlı hücre" şartının yalnız `ai_visibility` yarısı ölçüldü; compare hücresi 180–900 kredi ister ve şef sondasına girmedi. Kalem bu yüzden `canlı ✔` almadı. |
| **AVC-3** | **P2** | **Vendor'ın hiçbir hedef için satır döndürmediği bir karşılaştırma tam fiyat ödetir ve iade edilmez.** Ölçüldü: 2 hedef, 0 satır, `-180`, iade yok. Description ve mdx "cevapsız ≠ sıfır" ayrımını dürüstçe anlatıyor ama **cevapsız hedefin de faturalandığını** hiçbir yerde söylemiyor. 900 kredilik bir çağrıda bu maddi bir beklenti farkıdır | Defter `2026-09-04T01:18:14Z · -180 · charge · … · no project scope`, iade satırı yok; çıktı `DataForSEO returned no row for 2 of the 2 compared targets` | Metin kalemi (imza değil, tek cümle): fiyat cümlesine "her hedef, vendor o hedef için satır döndürmese bile ücretlendirilir" eklensin. Davranış doğrudur — vendor cevap verdi — ama duyurulmamış |**İMZA KALEMİ — operatörde** ("cevapsız bir hedef de tam fiyat ödetir" cümlesi). Ölçüldü: #234/#235'in eklediği fiyat cümleleri **lokal reddi** hakkındadır (`refused before anything is charged`); cevapsız hedefin faturalandığını söyleyen bir cümle **eklenmedi**. |
| **AVC-4** | **P2** | **R-5.5 fan-out şerhi yok** — referansın bu tool için adlandırdığı EN YÜKSEK RİSK. Tool keyword-vs-keyword karşılaştırmayı bir hedef tipi olarak davet ediyor; `AI_FAN_OUT_NOTE` depoda hazır duruyor ve iki komşu tool basıyor | `grep -rniE "fan.?out" apps/mcp/src`; `serp-features.ts:68`; `CALLER_ORDER_NOTE:282` sıralamayı kapatıyor, fan-out'u değil | Mevcut sabit `platform === "google"` cevaplarına eklensin; keyword hedefi içeren her karşılaştırmada ayrıca değerlendirilsin. NEVER#7 ekseni ve bedava (metin) |**KAPANDI #234 (google dalı)** — `AI_VISIBILITY_FAN_OUT_NOTE` iki AI tool'da da `platform === "google"` cevaplarına bağlandı. **Kalan:** hakemin/kaydın ikinci şıkkı — *keyword hedefi içeren her karşılaştırmada ayrıca değerlendirilsin* — YAPILMADI; şerh bugün yalnız platform eksenine bakıyor. |
| **AVC-5** | **P2** | **`reserve.test.ts` başlığındaki ölçüm iddiası artık TARİHSEL.** Dosya *"The second was measured by DELETING `units:` … 2402 specs stayed GREEN"* diyor; bugün aynı mutasyon **7 testi 3 dosyada** kırmızıya düşürüyor. İddia yanlış değil (o gün doğruydu) ama bugünkü okur "bu delik açık" diye okuyabilir — ders 16'nın bağlam katmanı | M6 log: 7 failed | Başlığa "kapandı — bugün N test kırmızı" şerhi. Küçük ama bu dosyanın tek işi bir ölçümü anlatmak |**AÇIK — PR'da karşılığı bulunamadı.** Ölçüldü: `reserve.test` ve `2402 specs` desenleri #234/#235 diff'lerinde **0 eşleşme**; dosya başlığındaki tarihsel ölçüm iddiası bugün de şerhsiz duruyor (ders 16'nın bağlam katmanı). |
| **AVC-6** | *(bilgi)* | **Doğru çalıştığı ölçülenler** — kayda geçsin ki bir sonraki tur yeniden ölçmesin: D17 eşiği ve aritmetiği (3 hedef → `estimate_credits: 270`, hiçbir şey settle olmadı); `confirm` yalnız bu tool + `crawl_site` (#204 kararı, canlı ✔); `validateCompareGroups` rezervasyondan ÖNCE (yinelenen label ücretsiz reddedildi); `soleComparedProjectId` #215 kararı (M5 KIRMIZI + canlı `no project scope`); `units:` aritmetiği (M6 KIRMIZI + canlı `-180`); vendor tavanı 10 telde (`internal_list_limit of 10` çıktıda); kiracı izolasyonu (yabancı proje, `ai_visibility` ile birebir aynı cümle) | §2, §3, §4 | — |— **bilgi satırı**, kapatılacak kalem yok. Beş kalemin beşi de bu turda yeniden ölçülmedi ve düzeltmelerden etkilenmedi (`confirm` · `validateCompareGroups` · `soleComparedProjectId` · `units:` aritmetiği · kiracı izolasyonu). |
| **H-5** *(hakem turu, yeni)* | **P2** *(bilgi + imza verisi; NEVER#6'ya dokunmaz)* | **Tahmin/gerçek 4,5× ve "0 satır" ↔ vendor'ın faturaladığı ≈1 satır.** Prod `dfs_spend`: `cross_aggregated_metrics/live`, **2 hedef**, tahmin **0,45**, gerçek **0,101**. Vendor dokümanının örnek cevabı da `0.101` taşıyor → satır başına $0,001'den **faturalanan satır ≈ 1**, oysa çıktı *"0 rows came back"* diyor. İkisi tanım gereği aynı şey olmayabilir, ama **hiçbir yüzey bunların ayrı iki ölçüm olduğunu söylemiyor** (sınıf **D4-3/8**, üçüncü tekrar). Oran ekseni Dilim 5'in `analyze_backlinks` 3,8× vakasıyla aynı sınıftır (**D4-9**, ikinci tekrar). Bu çağrıda marj **≈22×** — `costs.ts:127-134`'ün 5,58× hesabının dayandığı `MAX_INTERNAL_LIST_ROWS = 100` **satır tavanı varsayımı ölçülünce çürüdü** | Şef prod okuması (`public.dfs_spend`, `spend_day = 2026-09-04` UTC, Supabase MCP) · çıktı satırı `0 rows came back under an internal_list_limit of 10` · defter `2026-09-04T01:18:14Z · -180` · §4 "H-5" bölümü | **AV-4 ile TEK imza kalemi** (operatörde, NEVER#6): tek çağrılık bir ölçüm fiyat kararına taban değildir, ama *tahminin dayandığı varsayım* artık ölçülmüş biçimde yanlıştır. İkinci iş: çıktının "0 rows" cümlesi ile faturalanan satırın **ayrı iki ölçüm** olduğunu söyleyen bir yan cümle (D4-3/8'in bu dilimdeki hâli). Ş-1'in "3 hedef" sayımı bu kayıtta **2** olarak düzeltildi |**KISMEN — fiyat yarısı İMZA KALEMİ (operatörde, AV-4 ile TEK kalem); "0 satır ≠ faturalanan satır" cümlesi AÇIK — PR'da karşılığı bulunamadı** (`0 rows came back` deseninin yanına ayrı-ölçüm cümlesi eklenmedi; ölçüldü). `dfs_spend` tahmin/gerçek ayrımı (sınıf D4-9) operatör kuyruğunda: `status='failed'` migration'ı. |

---

## Sapmalar (protokolden)

1. **N6 ücretsiz bir negatif olarak tasarlandı, ücretli koştu (180 kredi).** Sebep bulgunun kendisidir:
   iç içe bilinmeyen alan reddedilmediği için çağrı geçerli sayıldı ve 2 hedef D17 eşiğinin (200) altında
   olduğu için `confirm` de istemedi. İş emrinin `ai_visibility_compare` için verdiği tavan
   (**≤1 ücretli çağrı, tam 2 hedef, ≤$0,50 vendor**) **aşılmadı** — bu çağrı o bir tanedir ve
   $0,45 tahminle tavanın içindedir. Sonrasında `paid2` modu **koşulmadı**.
2. **`ai_visibility` mutlu yolu alınamadı** — iki ücretli deneme vendor 40501 ile düştü (kredi iade edildi,
   net 0) ve hesabın $0,50 ücretsiz-vendor ödeneği doldu. Üçüncü deneme ödenek muhafızınca reddedildi.
   İş emrinin `ai_visibility` tavanı (≤1 ücretli çağrı = ≤90 kredi) **aşılmadı**: hiçbir deneme kredi
   harcamadı. Detay `ai_visibility.md` §4.
3. **Toplam kredi Δ bu dilimden: −180** (iş emri tavanı 300). Bakiye ölçümden sonra 2572.

> **(hakem turu, 2026-09-04)** Sapma 2, hakem raporunda **H-6** adını aldı: kredi ekseninde tavan
> aşılmadı (net 0) ama **bütçe ekseninde aşıldı** — ≤1 ücretli çağrı tavanına karşılık vendor'a **2**
> çağrı gitti ve $0,60 ödenek yandı. Ayrıntı: `ai_visibility.md` §4.
> Tur toplamı — **ücretli: compare 180 + `generate_report` 30 = 210 kredi**; `ai_visibility`'nin iki
> denemesi **net 0** (charge+refund). Dilim 6 kredi Δ **−210**, bakiye **2572**. Vendor tarafı: bugün
> toplam **$0,149** (compare 0,101 + `ai_visibility` 2 × 0 + Dilim 5 sondası 0,0484).
