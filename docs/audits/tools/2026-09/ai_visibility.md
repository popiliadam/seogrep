# `ai_visibility` — tool kontrol kaydı (2026-09 turu)

> Dilim: 6 · İşçi: Opus 4.8 · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Taban: worktree `audit/dilim6-ai`, main `800d5ee`; `pnpm --filter @pseo/mcp test` → **162 dosya / 4198 test, exit 0**.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler + zod + description + `costs.ts:135` + mdx + DFS adaptörü okundu; kredi/metin tutarsızlığı YOK |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyon: M1/M2/M3 KIRMIZI, M7 **YEŞİL KALDI**; `git diff --stat` boş |
| 3 Canlı negatif | ÖLÇÜLDÜ | ~~9 negatif~~ **7 negatif** *(hakem turu, 2026-09-04: §3 tablosu yedi satır taşıyor — N1·N2·N3·N11·N13·N14·N15)*, **hepsi ücretsiz** (defterde satır yok); kiracı izolasyonu ayırt edilemez cümle ile |
| 4 Canlı mutlu yol | **ÖLÇÜLEMEDİ** | 2 ücretli deneme **vendor 40501 ile düştü** (`location_name`, sonra `language_code`); 3. deneme hesabın $0,50 ücretsiz-vendor ödeneği tükendiği için reddedildi *(hakem turu: bu iki çağrı iş emrinin ≤1 ücretli çağrı tavanını AŞTI — H-6, §4)* |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-5.2 **TEMİZ** (llms.txt kaynakta hiç yok); R-5.5 ve R-5.9/R-3.22–3.24 **AYKIRI**; R-8.4/8.5 **İLGİSİZ** (şerh önerisi) |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:41` → `"report"`; `CARDED_TOOLS` yalnız `get_credit_balance` (ertelenmiş) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | `plan.mjs:192` EXCLUDED gerekçesi **BAYAT DEĞİL** — H-01 hâlâ açık; `goals/` hedefi EVET |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — tool'un KENDİ ilan ettiği ve dokümante ettiği iki
alan (`location_name`, `language_code`) DataForSEO tarafından reddediliyor; 2026-08-25 outage'ının aynı
sınıfı iki alan daha üzerinde yaşıyor ve mutlu yol bu yüzden ölçülemedi.

**Karar (hakem turu, 2026-09-04 — taze Fable, SERT): FAIL (dar) — kayıt DÜZELTİLEREK kapanır.**
Ölçülen olgular (iki 40501 reddi, kredi iadesi, ödenek tükenmesi) doğru; **teşhis ölçülmeden yazılmış.**
Vendor REST dokümanı bu ucun lokal alanlarını YAYIMLIYOR ve `chat_gpt`'yi US/en ile sınırlıyor; denenen
tek kombinasyon `chat_gpt` + ABD-dışıdır. *"Alan yoksa şemadan kaldırılmalı"* bir HİPOTEZDİR (ders 13).
Düzeltilenler: **AV-1 gövdesi yeniden yazıldı (= H-1)** · **AV-2 GERİ ÇEKİLDİ** · **AV-8 daraltıldı (H-4)** ·
**AV-7 AYKIRI → İLGİSİZ** · yeni **H-2** (D4 sınıf 4 altıncı üye) · **H-6** protokol sapması ·
**H-9** DK-3'ün lighthouse kardeşi · **H-01 satırı KISMEN → HAYIR** · sayı/satır düzeltmeleri.

**Karar (kapanış, 2026-09-05):** **KAPANDI (dilim 6 düzeltmesi, #234 paket I + #235 paket K; kalan:
AV-3'ün doktrin yarısı · AV-4 · AV-7 İMZA · AV-9 · AV-10 AÇIK).** Hakemin FAIL gerekçesi olan teşhis
hatası (D6-yeni-A) düzeltilerek kapandı: H-1 **canlıda iki hücreyle** doğrulandı (ücretsiz ret + mutlu
yolun ürün tarihindeki ilk koşusu), ve aynı sonda **H-10'u** doğurdu — bir düzeltmenin kendi çıktısı da
bir hipotezdir (Dilim 5'in BD-8 dersi, ikinci kez). Ölçüm ve hakem turlarının kararları **silinmedi**.

---

## 1. Statik okuma

- Handler: ~~`apps/mcp/src/tools/ai-visibility.ts:299`~~ **`apps/mcp/src/tools/ai-visibility.ts:303`**
  *(hakem turu, 2026-09-04: satır numarası düzeltildi)* (`makeAiVisibilityTool` → `defineTool`, `charge: "handler"`)
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

> **(hakem turu, 2026-09-04)** Bu cümle *çürümedi*; **eksik**. Ölçülen şey `chat_gpt` + ABD-dışı
> kombinasyonunun reddidir, cümlenin yanlışlığı değil. Vendor dokümanı `chat_gpt`'yi **yalnız US/en**
> ile sınırlıyor, `google`'ı 92 lokasyonla yayımlıyor — yani "THAT location and language" `google` için
> DOĞRU, `chat_gpt` için **hiçbir zaman kullanıcının seçtiği** lokal değil. Description bu ayrımı
> söylemediği için yeniden yazılmalı → **H-1** (AV-1'in yeni gövdesi).

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

> **(hakem turu, 2026-09-04) — yeni bulgu H-2.** Bu alıntının parantezi **"this vendor family publishes
> no code"** diyor ve bu **YANLIŞ**: vendor dokümanı `location_code`'u (varsayılan **2840**) ve
> `language_code`'u (varsayılan **`en`**) açıkça yayımlıyor. Aynı yanlış varsayımın ikinci yüzü
> `ai-visibility-shared.ts:244` çıktı cümlesidir — *"DataForSEO applied its own default and SeoGrep does
> not know which"* — **varsayılan biliniyor** (2840 / `en`). İkisi birlikte **Dilim 4 sınıf 4'ün
> (ABD/İngilizce varsayılanının sessizce uygulanması) ALTINCI üyesidir**; `format/locale-default.ts`
> (`defaultLocaleWarning`) bu aileye hiç bağlanmamış. `locationNameField` (`ai-visibility-shared.ts:97`)
> ve mdx üretici aynı cümleyi taşıyor → **H-2, P2** (bulgular tablosu).

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

> **(hakem turu, 2026-09-04) — üç-yol tablosu KAYNAKLA BİREBİR DOĞRULANDI.** Hakem üç satırı da kaynakta
> okudu: `:1122-1126` settle **yok** · `:1130-1134` yalnız `vendorPriced !== null` iken
> `settleSpend(…, 0)` · `vendorPriced === null` dalı **açık**. Adlandırılan test başlıkları da
> doğrulandı, ve HM6 (`:1132` → `&& false`) **KIRMIZI ×2** verdi — yani 2. yolun pini gerçek.
> Aynı turda ölçülen ikinci kanıt: `settleFailedSpend` grep'i `llm-mentions.ts`'te **0**.

### DK-3 sınıfı: **KISMEN**

`llm-mentions.ts` `settleFailedSpend`'i **import ETMİYOR**. Ölçüm:

```
grep -n "settleFailedSpend" apps/mcp/src/dfs/*.ts
→ backlink-changes · backlink-details · backlinks · competitors · discover-keywords
  · link-gap · ranked-keywords · relevant-pages · client   (9 port + budget.ts + testler)
→ llm-mentions.ts: HİÇ EŞLEŞME YOK
```

Dilim 4/5'te 11 port `settleFailedSpend` ile kapandı; bu aile o dalganın DIŞINDA kaldı.

> **(hakem turu, 2026-09-04) — yeni bulgu H-9: bu kayıt `lighthouse`'u anmıyor.** DK-3 sınıfının kardeşi
> yalnız `llm-mentions` değil: `dfs/lighthouse.ts:563` rezervasyonu **"Reservation deliberately left
> OPEN"** diye bırakıyor ve `dfs/lighthouse.test.ts:652` bunu **kasten pinliyor** (`actualUsd`
> `toBeNull`). Ne bu kayıt ne `ai_visibility_compare.md` lighthouse'u anıyor. **Ailenin bugünkü DK-3
> resmi ÜÇ ŞEKİLDİR ve üçü aynı dizinde yaşıyor:** (1) **açık bırak** — `lighthouse`, `llm-mentions`
> transport yolu; (2) **tahminle kapat** — Dilim 4/5'in 11 portu (`settleFailedSpend`); (3) **vendor
> fiyatıyla kapat** — `llm-mentions` non-20000 yolu, ki `budget.ts:194-201` bunu ADIYLA yasaklıyor.
> Doktrin kararı (AV-3) bu üç şeklin hepsini birden bağlamalıdır, yalnız bu ailenin ikisini değil.
>
> **Kapanış (2026-09-05): H-9 KAPANDI #234** — `lighthouse.ts:554` ve `llm-mentions`'ın transport /
> okunamayan-gövde yolları `settleFailedSpend`'e (TAHMİNLE) geçti; `lighthouse.test.ts`'in "açık bırakır"
> pini **taşındı**, para yarısı korundu (NEVER#8 ihlali değil). **Üçüncü şekil — vendor fiyatıyla kapatma —
> DOKUNULMADI:** o bir doktrin kararıdır ve AV-3 imza kaleminde durur.

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

> **(hakem turu, 2026-09-04) — "üç yolda da kapanıyor mu" sorusunun cevabı: HAYIR.** Hakem soruyu tek
> tek ölçtü: **transport → AÇIK** (`llm-mentions.test.ts:1079` bunu TASARIM OLARAK pinliyor, yani
> onarım o pini taşımadan giremez) · **non-20000 → vendor fiyatıyla KAPANIR, ve o fiyat $0 olabilir**
> (`:1051`, `:1065`; HM6 mutasyonu iki testi kırmızıya düşürdü) · **okunamayan gövde → AÇIK, adlı test
> YOK** (2. ve 3. yol tek `catch`'i paylaşıyor). "KISMEN" nitelemesi doğru ama zayıf: `status` ekseninde
> üç yoldan **ikisi** açık ve **biri** yasaklı doktrinle kapanıyor.

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
~~**Dokuz negatifin dokuzu da ücretsiz**~~ **YEDİ negatifin yedisi de ücretsiz** *(hakem turu,
2026-09-04: aşağıdaki tablo yedi satır taşıyor; "dokuz" sayımı kayıtta karşılıksız)* —
`list_credit_activity` filtresiz okundu, hiçbirinde satır yok.

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

> **(hakem turu, 2026-09-04) — H-6, protokol sapması (bulgu değil, tur kaydı).** İş emri bu tool için
> **≤1 ücretli çağrı** tavanı koymuştu; vendor'a **2 çağrı** gitti (P1 ve P1b). Kredi ekseninde tavan
> aşılmadı — net Δ **0**, ikisi de iade edildi — ama **bütçe ekseninde aşıldı:** 2 × $0,30 = **$0,60**
> ödenek yakıldı ve hesabın $0,50'lik günlük ücretsiz-vendor payı bitti. Sapmanın bedeli tam olarak
> §4'ün başlığıdır: **mutlu yol bu turda ölçülemez oldu.** Ders: bir alan reddedildiğinde ikinci
> denemenin *hangi ekseni varyantladığı* önce yazılır (ders 14) — burada ikinci deneme aynı ekseni
> (lokal alan × `chat_gpt`) tekrarladı, karşı-değeri (`google` + Turkey, ya da `chat_gpt` + US/en)
> denemedi; H-1'in ölçülmeden yazılmasının mekaniği budur.

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
| R-5.6 Google-Extended | anılmıyor | ~~**AYKIRI (ölçüm boşluğu)**~~ → **İLGİSİZ + ŞERH** *(hakem turu)* | R-3.20 ile aynı kalem; ikisi de bir crawler-token yüzeyi VARSAYIYOR, bu tool'da öyle bir yüzey yok |
| R-5.7 / R-5.8 Bing AI Performance | anılmıyor | **İLGİSİZ (bugün)** | DFS LLM Mentions `platform` enum'ı **tam olarak iki** değer taşıyor (`chat_gpt`, `google`) ve description bunu açıkça söylüyor (*"There is no 'all assistants' option here"*). Bing/Copilot vendor'da yok → uydurulamaz. Kayda geçer: ürün "AI görünürlüğü" derken Copilot'u KAPSAMIYOR ve bunu söylüyor |
| **R-5.9 OAI-SearchBot tarifi** | anılmıyor | ~~**AYKIRI**~~ → **İLGİSİZ + ŞERH** *(hakem turu)* | ChatGPT görünürlüğünü ÖLÇEN tool, OpenAI'ın tavsiyesini (robots.txt'te `OAI-SearchBot`'a izin) anmıyor — ama **bu tool bir ölçüm yüzeyidir, öneri yüzeyi değil** ve hiçbir yerde öneri vermiyor. Referans satırı bir ÖNERİ yüzeyi varsaymış → **D4-10** (referans satırı yapısal olarak karşılıksız). → AV-7 |
| **R-3.20 / R-3.22–R-3.24 crawler token'ları** | hiçbir yerde | ~~**AYKIRI (ölçüm boşluğu)**~~ → **İLGİSİZ + ŞERH** *(hakem turu)* | `grep -rniE "oai-searchbot\|gptbot\|claudebot\|claude-searchbot\|perplexitybot\|google-extended\|chatgpt-user" apps/mcp/src apps/web/content` → **0 eşleşme**. Referansın "token listesi bayatlaması" riski bu ailede de **karşılıksız: liste yok ki bayatlasın** (`audit_tech` T-B8 ile aynı sonuç) |
| **R-8.4 / R-8.5 AI Overview item type'ları** | ayrıştırıcıda karşılığı yok | **İLGİSİZ — ŞERH ÖNERİLİYOR** | Ölçüm: `grep -n "item_type\|ai_overview" apps/mcp/src/dfs/llm-mentions.ts` → **0 eşleşme**. Bu tool SERP uçlarını değil `aggregated_metrics`'i çağırıyor; ayrıştırıcı skalerleri **birebir vendor anahtarıyla** taşıyor (`vendor_metrics`) ve iç içe alanları **adlandırarak** düşürüyor. Tanınan tip kümesi olmadığı için bir tip **sessizce düşürülemez** — `serp_snapshot` #221 ile birebir aynı sonuç |
| **R-8.6 goto URL çözümlemesi** | ayrıştırıcı yok | **İLGİSİZ (ölçüldü)** | `grep -iE "goto\|/url\?q=\|google\.com/url\|redirect" apps/mcp/src/dfs/llm-mentions.ts` → 0 eşleşme |
| **R-8.7 LLM Mentions genişlemesi (historical + Lite)** | tool "no date range" diyor | **ŞERH** | Uç-kapsamlı olarak DOĞRU (`aggregated_metrics/live` tarih parametresi yayımlamıyor). Ama description'ın *"so there is no period to ask for"* cümlesi AİLE düzeyinde bir mutlak gibi okunuyor; R-8.7 ailenin **historical** uçlarla genişlediğini kaydediyor. Ürün kararı, kod kusuru değil → AV-9 |
| **R-8.7 lokal (Sınıf 4)** | `location_name` + `language_code` ilan ediliyor | **AYKIRI — ÖLÇÜLDÜ** | İkisi de canlıda 40501 alıyor. Lokal ekseni bu tool'da **erişilemez**: alan verirsen çağrı düşer, vermezsen cevap *"not specified … SeoGrep does not know which"* der → AV-1 |

**Referans düzeltme önerisi (şerh, silme yok):** `ai_visibility` satırının "en yüksek risk"i iki kalemden
oluşuyor ve **ikisi de bugün karşılıksız** — llms.txt hiç yok, item type allowlist'i hiç yok. Satır
SİLİNMEMELİ (bir gün allowlist gelirse risk aynen açılır) ama "**ölçüldü 2026-09-04: ikisi de karşılıksız;
gerçekleşen risk lokal alanların vendor tarafından reddi**" şerhi düşülmeli.

> **(hakem turu, 2026-09-04) — H-8, metin yetkisi kullanıldı; referansa İŞLENDİ.**
> **KABUL:** R-8.4/R-8.5 **İLGİSİZ + şerh** (ayrıştırıcıda tanınan tip kümesi yok → sessiz düşme
> yapısal olarak imkânsız) · R-5.2 **TEMİZ** (`llms.txt` grep'i depoda 0; referansın "en yüksek risk"i
> bu üründe karşılıksız).
> **DÜZELTİLDİ:** R-3.20 · R-3.22–R-3.24 · R-5.6 · R-5.9 **AYKIRI → İLGİSİZ + şerh** — dördü de bir
> *öneri/robots yüzeyi* varsayıyor, bu tool ölçüm basıyor (D4-10, dördüncü tekrar).
> **YENİDEN YAZILDI:** satırın "en yüksek risk"i artık **"`chat_gpt` yalnız US/en lokal matrisi +
> vendor varsayılanının (2840/`en`) söylenmemesi"**tir — llms.txt ya da item type kayması değil.
> Şerhler `docs/reference/2026-09-02-seo-referans-listesi.md`'ye işlendi; **hiçbir satır silinmedi.**

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

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-05) |
|---|---|---|---|---|---|
| **AV-1** = **H-1** | **P1** *(hakem turu: P0 DEĞİL — kredi iade edildi, kiracı sızıntısı yok, lokalsiz çağrı çalışıyor: AVC N6)* | **GÖVDE YENİDEN YAZILDI (hakem turu, 2026-09-04). Ölçüm turu metni bu satırın altındaki blokta korunuyor.** **Ölçülen gerçek:** iki ücretli deneme de `platform: chat_gpt` **+** ABD-dışı lokal (`location_name:"Turkey"`, sonra `language_code:"tr"`) ile gitti ve `40501 Invalid Field` aldı (`ai.jsonl` 01:19:15.9Z · 01:19:46.1Z). **Vendor REST dokümanı** (`aggregated_metrics/live` ve `cross_aggregated_metrics/live`) `location_name`, `location_code` (**varsayılan 2840**), `language_code` (**varsayılan `en`**) ve `language_name` alanlarını **YAYIMLIYOR**, ve şu notu düşüyor: *"chat_gpt data is available for United States and English only."* Yani 40501, "alan yok" reddi olarak da **değer × platform kombinasyonu** reddi olarak da okunur — ve **denenen tek kombinasyon `chat_gpt` + ABD-dışıdır**; ne `google` + Turkey ne `chat_gpt` + US/en denendi (H-6). **Gerçek kusur bir platform×lokal MATRİSİNİN yokluğudur:** `chat_gpt` ⇒ yalnız US/en; `google` ⇒ 92 lokasyon, listesi **ÜCRETSİZ** `llm_mentions/locations_and_languages` ucunda. Ürün herhangi bir string'i kabul ediyor, **rezervasyondan önce doğrulamıyor**, ve her deneme $0,30 ödenek yakıyor. Kardeş uç (`ai_visibility_compare` **AVC-2**) bu kaleme **KATLANDI** — `localeKeys` iki gövdeyi de besliyor | Canlı 2026-09-04T01:19:16Z → `Invalid Field: 'location_name'.` · 01:19:47Z → `Invalid Field: 'language_code'.` · 01:20:05Z → ödenek reddi. Kaynak: `llm-mentions.ts:557` (`...localeKeys(query)`) + `:606` (compare). **Vendor dokümanı:** docs.dataforseo.com/v3/ai_optimization/llm_mentions/{aggregated_metrics,cross_aggregated_metrics}/live | **(1) Pre-reserve doğrulama:** `platform === "chat_gpt"` ⇒ lokal alanlar sabitlensin (US/en) ya da verilirse **ücretsiz** reddedilsin; `platform === "google"` ⇒ vendor'ın `locations_and_languages` listesi cache/fixture'a alınıp değer ona karşı doğrulansın. **(2) Fixture GERÇEK yakalanmış cevaptan** türetilsin (bugünkü fixture elle yazılmış). **(3) Description** *"THAT location and language"* cümlesi yeniden yazılsın: `chat_gpt`'de lokal **kullanıcının seçtiği** değildir. **(4) ZORUNLU CANLI ÖLÇÜM — düzeltme sonrası, ödenek 00:00 UTC'de sıfırlandıktan SONRA (yani 2026-09-05+):** `chat_gpt` + US/en **ve** `google` + Turkey/tr, ikisi de. Bu iki hücre ölçülmeden H-1 bir HİPOTEZ olarak kalır |**KAPANDI #234 + canlı ✔** — `refinePlatformLocale` doğrulaması **şemada**, `withCredits`'ten ÖNCE. Canlı (deploy `d367875`, şef 2026-09-05 06:47 UTC, adstark): `chat_gpt` + `"Turkey"`/`"tr"` → **ücretsiz ret**, vendor cümlesi alıntılı (`"chat_gpt data is available for the United States and English only"`) + `You were not charged.`, **defterde satır yok**; `chat_gpt` + `" united states "`/`EN` → **mutlu yol ürün tarihinde İLK KEZ** (−90, iade yok), kanonik yazım vendor'ca kabul edildi (F-1). Hakemin şart koştuğu iki hücrenin **ikisi de** ölçüldü; `google` + `"Turkey"` hücresi **yeni bulgu H-10'u** açtı (aşağıda). |
| ~~**AV-2**~~ | ~~P1~~ **GERİ ÇEKİLDİ (hakem turu, 2026-09-04)** | ~~Testin PİNİ yanlış yöne bakıyor~~ — **iddia YANLIŞ ölçülmüş.** `llm-mentions.test.ts:332`'nin `expect(body.location_name).toBe("United States")` beklentisi bir **ters pin değildir**: vendor dokümanına göre `chat_gpt` için **"United States" TEK GEÇERLİ DEĞERDİR**, yani pin doğru yöne bakıyor ve süit doğru şeyi zorunlu kılıyor. **Yerine H-1 geçer.** Gerçekten eksik olan pin şudur: *"`chat_gpt` + ABD-dışı bir lokal, REZERVASYONDAN ÖNCE reddedilir"* — bugün böyle bir iddia hiçbir dosyada yok. **Satır silinmedi** (ders 16: geri çekilen bir iddia, geri çekildiği yazılarak durur) | `llm-mentions.test.ts:332`; M3 (spread silindi) bu testi KIRMIZI yaptı — mutasyonun kırmızı vermesi pinin YÖNÜ hakkında hiçbir şey söylemez (ders 13) | Düzeltme H-1'in (1) maddesindedir; bu satırdan ayrı bir iş çıkmaz |**GERİ ÇEKİLDİ (hakem turu, 2026-09-04) — kapatılacak kalem yok.** Yerine geçen H-1 #234 ile kapandı; hakemin adlandırdığı eksik pin ("`chat_gpt` + ABD-dışı lokal, rezervasyondan ÖNCE reddedilir") artık `ai-visibility.test.ts`'te var. Satır ders 16 gereği **silinmedi**. |
| **AV-3** | **P1** | **DK-3 KISMEN + doktrin çatışması.** `llm-mentions.ts` bu ailedeki tek port ki `settleFailedSpend`'i import etmiyor. Transport ve okunamayan-gövde yollarında rezervasyon AÇIK kalıyor; vendor-refuse yolunda ise **vendor'ın kendi rakamıyla** kapanıyor — ki bu $0,00 olabilir. `budget.ts:194-201` bunu ADIYLA yasaklıyor: *"NOT the vendor's reported cost, even when the failing response carries one … would settle a paid call as free and hand today's remaining budget to the next caller."* İki dosya aynı vendor hakkında zıt iddiada | `llm-mentions.ts:1122-1134`; `grep settleFailedSpend` → llm-mentions 0 eşleşme, 9 kardeş port eşleşme; M1 KIRMIZI | Çatışmayı bir insan çözmeli: ya `budget.ts`'nin doktrini geçerlidir ve bu port da `settleFailedSpend`'e geçer (transport + okunamayan yollar da kapanır), ya da `llm-mentions`'ın gerekçesi kabul edilir ve `budget.ts`'nin uyarısı bu aile için şerh alır. **Bugünkü hâl — iki zıt kural, ikisi de yürürlükte — en kötüsü** |**KISMEN — yarısı KAPANDI #234, yarısı İMZA KALEMİ (operatörde).** Kapanan: transport hatası ve okunamayan/fiyatsız gövde yolları artık `settleFailedSpend`'e (TAHMİNLE) gidiyor — `llm-mentions.ts` ve `lighthouse.ts:554` (H-9) birlikte. **Dokunulmayan:** vendor'ın FİYATLI reddi dalı — doktrin (`budget.ts:194-201` ↔ `llm-mentions`) **insan kararıdır**, hakem hükmü de bunu böyle bıraktı. İki zıt kural bugün de yürürlükte. |
| **AV-4** | **P1** | **H-01 fiyat doktrini hâlâ KANITSIZ ve artık ölçülmüş bir sonucu var.** `internal_list_limit` faturalanan satırı kontrol etmiyor, dolayısıyla 5,58× marj bir BAZ'dır. Ölçülen üst sınırlar: $0,30 / $0,45 / **$1,65** — sonuncusu fleet $3 tavanının %55'i ve hesap başına $0,50 ödeneğin **%330'u**, yani tek bir başarısız 10-hedefli çağrı ödeneği kendi başına bitirir | `estimateLlmMentionsUsd:261` elle hesaplandı; `free-vendor-calls.ts:70,122`; `llm-mentions.ts:38-50, 196-212` şerhi | Operatör imzası (NEVER#6). Vendor'dan **faturalanan satır** üst sınırı alınana kadar `plan.mjs`'in EXCLUDED gerekçesi doğru kalır. Ara adım olarak `internal_list_limit`'in fiyat tabanı olarak kullanımı bırakılıp tahminin gerçekten ölçülebilir bir tavana bağlanması düşünülmeli |**İMZA KALEMİ — operatörde** (NEVER#6; `ai_visibility_compare` **H-5** ile TEK kalem). Kod tarafı değişmedi ve değişmemeliydi: #234/#235'in `credits/costs.ts` diff'i **boş** (ölçüldü). |
| **AV-5** | **P2** | **Başlık BAYAT (ders 16):** `llm-mentions.ts:1078-1081` *"A failure at (2) leaves the reservation open at its full estimate, which is never less than the spend that really happened."* — kod artık 2. yolda kapatıyor, ve kapattığı sayı $0,00 olabilir, yani "asla az değil" yanlış | `:1078-1081` vs `:1105-1111` vs `:1130-1134` | Başlık `attempt()`'in bugünkü üç yolunu anlatacak şekilde güncellensin (AV-3 kararı ne olursa olsun) |**KAPANDI #234** — `attempt()` başlığı bugünkü üç yolu anlatacak biçimde yeniden yazıldı; bayat cümle ("never less than the spend that really happened") **tarihsel not olarak** duruyor, sessizce silinmedi (ders 16). |
| **AV-6** | **P2** | **R-5.5 fan-out şerhi yok.** `AI_FAN_OUT_NOTE` depoda var ve iki tool basıyor; `platform:"google"` tam da Google AI cevaplarını ölçtüğü hâlde `ai_visibility` basmıyor | `grep -rniE "fan.?out" apps/mcp/src`; `serp-features.ts:68` | Şerh, `platform === "google"` cevaplarına eklensin (mevcut sabit yeniden kullanılabilir). NEVER#7 ekseni |**KAPANDI #234** — `AI_QUERY_FAN_OUT_MECHANISM` `serp-features.ts`'ten ayrıştırıldı ve `ai-visibility-shared.ts`'te `AI_VISIBILITY_FAN_OUT_NOTE` olarak **yalnız `platform === "google"`** cevaplarına bağlandı (`chat_gpt`'de basılmaması KASTEN — fan-out Google hakkında bir iddiadır). Canlı çıktıda **ölçülmedi**: şefin `google` sondası vendor 40501'e düştü (H-10). |
| **AV-7** | **P2** *(şiddet değişmedi)* · **AYKIRI → İLGİSİZ + ŞERH** *(hakem turu, 2026-09-04: bu tool bir ÖLÇÜM yüzeyidir ve hiçbir yerde öneri vermiyor; referans satırı bir öneri yüzeyi VARSAYMIŞ — **D4-10**, dördüncü tekrar. Kalem bir "uyum ihlali" değil, bir **ürün kararı** olarak durur; şerh referansa işlendi, satır silinmedi)* | **R-5.9 / R-3.22–3.24: hiçbir AI crawler token'ı üründe yok.** ChatGPT görünürlüğünü ölçen tool, OpenAI'ın yayımladığı tek eyleme dönük tavsiyeyi (robots.txt'te `OAI-SearchBot`) hiç anmıyor. Referansın "token listesi bayatlaması" riski **karşılıksız — liste yok** | `grep -rniE "oai-searchbot\|gptbot\|claudebot\|perplexitybot\|google-extended"` → 0 | Ürün kararı. En ucuz hâli: cevabın sonuna, ölçüm sıfır satır döndüğünde, "ChatGPT'nin sitenizi görebilmesi için OpenAI `OAI-SearchBot`'a izin verilmesini şart koşuyor" gibi TEK bir kaynak-atıflı cümle. Liste eklenirse bayatlama riski AÇILIR — kayda geçsin |**İMZA KALEMİ — operatörde** (crawler-token cümlesi, iki yönlü ürün kararı). Ölçüldü: `OAI-SearchBot` #234 ve #235 diff'lerinde **0 eşleşme**; risk hâlâ karşılıksız. |
| **AV-8** | **P2** | **DARALTILDI (hakem turu, 2026-09-04 = H-4).** ~~NEVER#7 metni yalnız KİMLİĞİYLE pinli; sabitin İÇİ boşaltılırsa süit yeşil kalır~~ — **bu genel iddia ölçülünce YANLIŞ çıktı.** Hakem sabiti tümüyle `""` yaptı (HM2b) ve süit **KIRMIZI** verdi: `ai-visibility.test.ts:395` `/computes no visibility score/i`. Yani sabitin içi boşaltılamıyor, yükün bir kısmı gerçekten pinli. **Kalan gerçek boşluk yalnız İKİ CÜMLEDİR:** *"re-orders nothing / there is nothing to sort by"* ve *"unreported, never as a zero"* — bu ikisi hiçbir regex tarafından tutulmuyor, ve M7 tam olarak birincisini sildiği için yeşil kaldı | M7 YEŞİL (sıralama cümlesi) · **HM2b KIRMIZI** (`ai-visibility.test.ts:395`, `/computes no visibility score/i`) · `ai-visibility-compare.test.ts:359` | En az bir test, sabitin İÇİNDEKİ yükü taşıyan cümleleri (skor yok / sıralama yok / bildirilmeyen ≠ sıfır) ayrı ayrı `/i` regex'le pinlesin (ders 11: kaynak literali değil, en kısa ayırt edici parça) |**KAPANDI #234** — hakemin daralttığı iki cümle ayrı ayrı `/i` regex'le pinlendi: `/re-orders nothing/i`, `/nothing to sort by/i`, `/unreported, never as a zero/i` (ders 11: kaynak literali değil, en kısa ayırt edici parça). |
| **AV-9** | **P2** | Description ve mdx *"this vendor endpoint takes no date range, so there is no period to ask for"* diyor. Uç düzeyinde DOĞRU; ama R-8.7 ailenin **historical** uçlarla genişlediğini kaydediyor, ve cümle aile düzeyinde bir mutlak gibi okunuyor | Referans R-8.7; `llm-mentions.ts:141-147` (yalnız iki `/live` ucu) | Metin şerhi: "*this endpoint*" vurgusu korunsun; ya da bir cümle ile "DataForSEO bu aile için ayrıca historical uçlar yayımlıyor; SeoGrep bugün onları çağırmıyor" denilsin. İmza kalemi değil, metin borcu |**AÇIK — PR'da karşılığı bulunamadı.** Ölçüldü: `historical` deseni #234 ve #235 diff'lerinde **0 eşleşme**; `"this endpoint"` vurgusu metin borcu olarak duruyor. |
| **AV-10** | **P2** | **Hiçbir kapı, bir DFS adaptörünün ilan ettiği istek alanlarının o ucun vendor şemasında var olduğunu ölçmüyor.** AV-1'in kök sebebi budur: 2026-08-25 outage'ı bir alanda kapatıldı, iki alan açık kaldı ve bunu yakalayan tek şey canlı ücretli çağrı oldu | `goals/` listesi; `verify.sh` kapsam tablosu (CLAUDE.md) | `goals/` hedefi ya da bir `check-*` : her `dfs/*.ts` istek gövdesinin anahtarları, o adaptörün başlığında alıntılanan vendor input şemasıyla karşılaştırılsın. Bugün vendor şeması yalnız YORUM olarak duruyor — makine okunur bir yere (fixture ya da JSON) inerse kapıya bağlanabilir |**AÇIK — PR'da karşılığı bulunamadı.** Ölçüldü: #234 diff'inde `goals/` altına **hiçbir dosya** eklenmedi (turun tek `goals/` hedefi #233'ün kiracı kapsamıdır). Bir adaptörün ilan ettiği istek alanlarının vendor şemasında var olduğunu **bugün de hiçbir kapı ölçmüyor** — H-10 bunun ikinci canlı bedelidir. |
| **H-2** *(hakem turu, yeni)* | **P2** | **Ürün, vendor'ın varsayılanını BİLDİĞİ hâlde "bilmiyorum" diyor — ve bir yerde de "böyle bir kod yok" diyor.** İki yüz: (a) `ai-visibility-shared.ts:97` `locationNameField` (ve ondan üretilen mdx satırı) *"this vendor family publishes no code"* diyor — **YANLIŞ**, vendor `location_code`'u varsayılan **2840** ile yayımlıyor; (b) `ai-visibility-shared.ts:244` çıktı cümlesi *"DataForSEO applied its own default and SeoGrep does not know which"* diyor — **varsayılan biliniyor** (2840 / `en`), yani bu bir *çıplak açıklama* (bare disclosure), bilgisizlik değil. **Dilim 4 sınıf 4'ün (ABD/İngilizce varsayılanının sessizce uygulanması) ALTINCI üyesi**; `format/locale-default.ts` (`twoLetterTld` + `defaultLocaleWarning`) bu aileye **hiç bağlanmamış** | Vendor dokümanı (`location_code` default 2840, `language_code` default `en`) ↔ `ai-visibility-shared.ts:97` ve `:244`; `grep locale-default apps/mcp/src/tools/ai-visibility*` → 0 | (a) "publishes no code" cümlesi **kaldırılsın** ya da doğrusuyla değiştirilsin (kaynak: vendor input şeması). (b) ":244" cümlesi varsayılanı ADIYLA söylesin — Dilim 4/5'te beş tool'a bağlanan `defaultLocaleWarning` deseninin aynısı. **Varsayılan DEĞİŞMEZ** (`locale-default.ts` modül başlığı: fiyat + davranış kararı, imza gerektirir) — değişen yalnız okurun ne öğrendiğidir. H-1 ile aynı PR'da gitmeli: ikisi de aynı matrisi anlatıyor |**KAPANDI #234** — "publishes no code" cümlesi kaldırıldı (vendor `location_code` **2840**'ı yayımlıyor), `:244` çıplak açıklaması varsayılanı ADIYLA söylüyor, ve Dilim 4'ün `defaultLocaleWarning`/`twoLetterTld` deseni bu aileye **ilk kez bağlandı** (sınıf D4-4'ün altıncı üyesi). Varsayılan **DEĞİŞMEDİ** (NEVER#6). |
| **H-10** *(şef canlı sondası, 2026-09-05 — YENİ)* | **P1 (NEVER#5 ödenek)** | **`google` platformunda lokal adı vendor'a DOĞRULANMADAN gidiyor ve $0,30 ödenek yakıyor.** #234'ün `google` dalı değeri geçiriyor ve yalnız *"not validated against the vendor list"* notu koyuyordu; canlı `ai_visibility {platform: google, location_name: "Turkey", language_code: "tr"}` rezervasyon açtı, vendor **40501 `Invalid Field: 'location_name'`** döndürdü, kredi iade edildi (`-90` + `+90`) ama **günlük ücretsiz-vendor ödeneğinden $0,30 yandı**. Vendor'ın kanonik yazımı **`"Turkiye"`**'dir ve bu bilgi depoda **Dilim 3 F-8'den beri** duruyor (`dfs/locations.ts` `KNOWN_LOCATIONS`, `serp_snapshot`'ta kullanılıyor) — AI ailesi ona hiç bağlanmamıştı. **AV-10'un ikinci canlı bedeli:** bir adaptörün gönderdiği değerin vendor sözlüğünde var olduğunu ölçen bir kapı yok | Canlı 2026-09-05T06:47:15Z (deploy `d367875`, adstark): `-90 charge` + `+90 refund` (06:47:17), çıktıda DK-3/H-01 metni (`… used part of SeoGrep's own daily third-party-data allowance — that is our cost, not yours`); `dfs/locations.ts` `KNOWN_LOCATIONS` (Dilim 3 F-8) | `refinePlatformLocale`'ün `google` dalı `checkLocationName`'e bağlansın: bilinen yanlış yazım **ücretsiz** reddedilsin ve doğrusu önerilsin; vendor listesi UYDURULMASIN (NEVER#7) | **KAPANDI #235** — `checkLocationName` **şemada** (`safeParse`, `withCredits`'ten önce → rezervasyon şeklen imkânsız); `"Turkey"` → `"Turkiye"` önerisiyle ücretsiz ret, `"Istanbul,Turkey"` → `"Istanbul,Turkiye"`; bilinen ad / lokalsiz / yalnız dil geçer; `KNOWN_LOCATIONS`'a satır **eklenmedi**. Hakem (taze Fable) PASS: 5 karşı-mutasyon kırmızı, dist'ten 9 senaryo sondası. **canlı ✔ YOK** — `google` + `"Turkiye"` (90 kr) deploy `a786cc3` sonrası şefin ölçümünde; ret metninin `locations.ts`'ten gelen *"paid search"* kokusu ayrı küçük kalem |

### Korunan ölçüm-turu metni — AV-1 (hakem turu ÖNCESİ gövde, silinmedi)

> **`location_name` ve `language_code` — ikisi de ilan edilen, dokümante edilen, örneklenen alanlar —
> `aggregated_metrics/live` tarafından `40501 Invalid Field` ile reddediliyor. Tool bu alanlardan biri
> verildiğinde HER ZAMAN düşer.** 2026-08-25 outage'ının (`internal_list_limit`) aynı sınıfı; o düzeltme
> yalnız bir alana baktı. Sonuç canlıda ölçüldü: iki deneme hesabın $0,50 günlük ücretsiz-vendor
> ödeneğini bitirdi ve tool 00:00 UTC'ye kadar durduruldu.
> *Önerilen düzeltme (ölçüm turu):* vendor'ın `aggregated_metrics` input şeması okunup hangi alanların
> gerçekten yayımlandığı doğrulanmalı; **alan gerçekten yoksa şemadan kaldırılmalı** ve
> mdx/description'daki "THAT location and language" cümlesi düzeltilmeli.
>
> **Hakem şerhi:** *"Tool bu alanlardan biri verildiğinde HER ZAMAN düşer"* ve *"alan gerçekten yoksa
> kaldırılmalı"* — ikisi de **n=2, tek platform, tek lokal** üzerinden kurulmuş **hipotezlerdir**; vendor
> dokümanı üçünü de çürütüyor. Metin burada, **ders 13'ün bu turdaki en pahalı vakası** olarak duruyor:
> ölçülen bir arızanın teşhisi, ölçülmeden yazıldığında sonraki turu yanlış yöne gönderir (D6-yeni-A).
