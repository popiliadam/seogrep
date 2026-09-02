# `get_credit_balance` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 (hesap ailesi) · İşçi: Opus 4.8 · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `get-credit-balance.ts:34-76`; kredi `costs.ts:17` = `get_credit_balance: 0`; docs `get-credit-balance.mdx` "**Cost:** Free (0 credits)." — üçü uyumlu |
| 2 Mutasyon | ÖLÇÜLDÜ | M1 (badge daima "Paid") KIRMIZI 2 test; M2 (tekil/çoğul birim) YEŞİL KALDI — bulgu B-3 |
| 3 Canlı negatif | ÖLÇÜLDÜ | `{"foo":"bar"}` ve `{"limit":5,"project_id":…}` HTTP 200, reddedilmedi, sessizce yutuldu; kredi Δ 0 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | `Credit balance: 4519 credits. …` + `structuredContent.card` dolu; kredi Δ 0 |
| 5 SEO güncelliği | İLGİSİZ | Referans listesi bu tool için "—" (dış kural yok) diyor; satır 210 |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:12` `"metric"`, `CARDED_TOOLS` (satır 62) tek üyesi bu tool; canlı payload kartın 5 alanını da taşıyor |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:196` PLAN girişi VAR · `goals/trial-flow-e2e.md` canlı predicate'i bu tool'u çağırıyor |

**Karar:** DÜZELTME GEREKLİ — tool doğru çalışıyor ve kredi Δ 0 ölçüldü; ama (a) description tek başına
maliyeti söylemiyor (38 tool'un 35'i söylüyor), (b) bilinmeyen argüman sessizce yutuluyor, (c) tekil/çoğul
birim hiçbir testte pinli değil.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/get-credit-balance.ts:33-76` (`defineTool`, `handler` satır 45)
- Kayıt: `apps/mcp/src/tools/index.ts:5,51,167`
- Zod şeması (alanlar, kısıtlar): `z.object({})` — **hiç alan yok**, hiçbir kısıt yok
  (satır 36). Canlı `tools/list` bunu `{"type":"object","properties":{}}` olarak yayınlıyor;
  `additionalProperties` **yok**.
- Description (birebir alıntı):
  > Show your available credit balance (the running total of your credit ledger).
- Kredi satırı (`apps/mcp/src/credits/costs.ts:17`, birebir): `  get_credit_balance: 0,`
- Docs sayfası (`apps/web/content/docs/tools-reference/get-credit-balance.mdx`, birebir):
  > **Cost:** Free (0 credits).

  ve gövde:
  > Sums your credit ledger, scoped to your account, and returns the available balance. Paid tools debit credits when they run, and a balance of 0 blocks them until you top up.
- Tutarsızlıklar:
  1. **Description maliyet cümlesi taşımıyor.** Canlı `tools/list` üzerinde ölçüldü: 38 tool'un
     **35'i** description'ında `Costs N credits` diyor; söylemeyen üçü `get_credit_balance`,
     `get_job_status`, `whats_next`. Docs sayfası "Free (0 credits)" diyor, description demiyor.
  2. Onun dışında karşılaştırılanlar uyumlu: description ↔ mdx frontmatter `description`
     (birebir aynı dize), şema (parametresiz) ↔ mdx "### Input / No parameters.",
     kredi satırı ↔ mdx "Free (0 credits)" ↔ ölçülen canlı Δ 0.
- Seçilebilirlik: "How many credits do I have left?", "kaç kredim kaldı", "bakiyem" cümlelerinde
  seçilir. Karışabileceği komşu: **`list_credit_activity`** — "kredilerim nereye gitti?" sorusu
  ikisine de benziyor. Ayrım canlı çıktıda yapılıyor (bu tool "Run … for your current total"
  demiyor; `list_credit_activity` sonunda `Run get_credit_balance for your current total.` diyerek
  ok'u buraya çeviriyor), ama **description düzeyinde ayrım zayıf**: bu tool'un description'ı
  "running total" diyor, komşununki "net spend per tool" diyor; ikisi de bir toplamdan söz ediyor.

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `npx vitest run src/tools/{get-credit-balance,get-job-status,list-jobs,list-projects,list-credit-activity}.test.ts`
(worktree `apps/mcp` altından). Taban: **156 passed / 5 files**.
`*.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `get-credit-balance.ts:67` `badge: paid ? "Paid" : "Trial"` → `badge: "Paid"` | kart rozetinin trial hesabı "Paid" göstermemesi | **KIRMIZI** (2 test) | `get-credit-balance.test.ts:264` `expected 'Paid' not to be 'Paid'` + `states nothing in the data channel…` |
| M2 | `get-credit-balance.ts:50` `const unit = balance === 1 ? "credit" : "credits"` → `= "credits"` | tekil birim pinleyen bir test | **YEŞİL KALDI** | 156/156 geçti. Bakiyesi tam **1** olan hesap hem cümlede hem kartın `unit` alanında "1 credits" okur; hiçbir test bakmıyor |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). M2 şefin değil benim hipotezimdi ve yeşil kaldı → B-3.

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**; `git status --short` yalnız bu
turun yeni `.md` dosyalarını gösteriyor.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (yol anahtarı taşır — basılmadı). Her satırda çağrıdan önce ve sonra
`get_credit_balance` okundu; bakiye **4519** sabit kaldı.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| bilinmeyen argüman | `{"foo":"bar"}` | HTTP 200, `isError` yok, JSON-RPC error yok | **0** | Argüman **sessizce yutuldu**; cevap argümansız çağrıyla birebir aynı |
| başka tool'un argümanları | `{"limit":5,"project_id":"e2785bf7-…"}` | HTTP 200, `isError` yok | **0** | Aynı — şemada olmayan `limit`/`project_id` ne reddediliyor ne de raporlanıyor. Canlı `inputSchema`'da `additionalProperties: false` **hiçbir tool'da yok** (38/38 ölçüldü) |

Şema tarafı: bu tool'un hiç alanı olmadığı için "geçersiz değer" senaryosu yok — reddedilebilecek
bir alan yok. Bu, negatif yolun **ölçülemediği** değil, **var olmadığı** anlamına geliyor.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| argümansız mutlu yol | `{}` | HTTP 200, `content[0].type: "text"` + `structuredContent` | **0** | `Credit balance: 4519 credits. Paid tools debit credits when they run, and a balance of 0 blocks them until you top up. Your account has a paid balance, so the tools that read live data from a paid third-party SEO provider are unlocked — trial credits alone would not have been enough.` |
| ölçüm aracı olarak | `{}` × 72 (diğer 36 adımın önü/arkası) | hepsi HTTP 200 | **0** | Bakiye 36 adım boyunca 4519'da sabit; hiçbir ücretsiz tool ledger'a dokunmadı |

`structuredContent.card` canlı payload'ı (birebir):
`{"kind":"metric","title":"Credit balance","value":"4519","unit":"credits","badge":"Paid","facts":[{"label":"Vendor tools","value":"Unlocked"}]}`
ve `structuredContent.summary` metin cevabının aynısı.

**Trial dalı ÖLÇÜLEMEDİ** — bu hesap `hasPaidBalance() === true`; `badge: "Trial"` /
"Locked — needs a paid balance" dalı yalnız ödemesi olmayan bir hesapta canlıda görülebilir.
Hızlı şeritte (`get-credit-balance.test.ts:127,225,261`) pinli.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/hesap/probe.jsonl`
(36 satır, anahtar redakte — `makeRedactor(MCP_SMOKE_URL)`; dosyada `sg_` geçen 0 satır ölçüldü).

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| — | Referans listesi `docs/reference/2026-09-02-seo-referans-listesi.md:210`: `| get_credit_balance | — | Dış kural yok |` | **İLGİSİZ** | Dış kural yok — kontrol edilen: tool hiçbir dış API'ye çıkmıyor (`creditBalance` + `hasPaidBalance`, ikisi de kendi Supabase'imiz), dolayısıyla hiçbir sağlayıcı kuralı/tarifesi/saklama penceresi bu tool'a değmiyor |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — satır 12 `get_credit_balance: "metric"`, ve satır 62
`CARDED_TOOLS` kümesinin **tek** üyesi. Canlı payload kartın beklediği alanları taşıyor mu: **evet** —
`kind/title/value/unit/badge/facts` altısı da canlıda dolu geldi (yukarıdaki JSON), `_meta.ui.resourceUri`
= `ui://seogrep/card` `tools/list` üzerinde ilan ediliyor. Metin cevabı kartla birlikte değişmedi
(`content[0].text` = `structuredContent.summary`).

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — satır 196, `K0 / S1`,
  "account-wide; also the instrument every other cell is measured with"
- `goals/` hedefi gerekli mi: **HAYIR (zaten var)** — `goals/trial-flow-e2e.md:12` canlı uçta
  `get_credit_balance` çağırıp `balance|credits` arıyor, satır 83 `tools/list` sayısını 38'e pinliyor

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) |
|---|---|---|---|---|
| B-1 | P2 | Description maliyeti söylemiyor; 38 canlı tool'un 35'i söylüyor. Maliyeti soran bir model bu tool için description'da cevap bulamaz | canlı `tools/list` üzerinde sayıldı: söylemeyenler `get_credit_balance`, `get_job_status`, `whats_next` | Description'a diğer 35'le aynı biçimde ` Costs 0 credits.` eklenmesi önerilir; `gen-tool-docs` maliyet cümlesini zaten soyuyor, mdx frontmatter değişmez |
| B-2 | P2 | Şemada olmayan argüman sessizce yutuluyor (`{"foo":"bar"}`, `{"limit":5}` → HTTP 200, argümansız cevabın aynısı). Canlı 38 tool'un **hiçbirinde** `additionalProperties: false` yok | canlı ölçüm §3 | Sunucu genelinde bir karar konusu: ya `.strict()` (istemciye "bu argüman yok" denir) ya da bilerek hoşgörü — hangisi olursa olsun **yazılı** olmalı. Bu tool'a özgü düzeltme değil; §Bulgular'da 5 tool'da da tekrarlanıyor |
| B-3 | P2 | Tekil/çoğul birim pinsiz: bakiyesi 1 olan hesap "1 credits" okur (hem cümle hem kart `unit`) | M2 mutasyonu yeşil kaldı (§2) | `formatBalanceSentence` benzeri saf bir yardımcıya `balance === 1` vakasını pinleyen bir test — mevcut testin `it.each` kalıbıyla (0, 1, 2) |
| B-4 | P2 | "Trial" dalı canlıda ölçülemez: bu hesap ödemiş; ürünün ödememiş bir hesabı yok | §4 | Ölçüm turu için tek seferlik bir trial kiracı; ya da bu dalın "yalnız birim testinde kanıtlı" olduğunun kapı kapsam tablosuna yazılması |

## Taban notu (şef, 2026-09-02, ölçüm sonrası)

Bu kayıt `c8e0daa` tabanında yazıldı; o taban `origin/main`'in **bir PR gerisindeydi** (#198, `159535c`).
Tool kaynağı iki tabanda bayt-özdeş, bu yüzden 1–6. adımların ölçümleri geçerli. **Yalnız 7. adımın sweep
kalemi bayat:** #198 `plan.mjs`'i doldurdu ve `verify.sh`'e `tool-sweep.mjs --self-test`'i ekledi.
Güncel ağaçta ölçüldü: öz-test **7/7 PASS**, "38 live tools accounted for (22 planned + 16 excluded)";
bu tool bugün `PLAN` içinde. Bu dosyadaki "harness başlamıyor / EXCLUDED boş / PLAN 19" satırları
**#198 ile KAPANMIŞTIR** ve düzeltme iş emrine girmez.
