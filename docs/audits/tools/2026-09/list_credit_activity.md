# `list_credit_activity` — tool kontrol kaydı (2026-09 turu)

> Dilim: 1 (hesap ailesi) · İşçi: Opus 4.8 · Tarih: 2026-09-02 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `list-credit-activity.ts:441-474`; kredi `costs.ts:23` = `list_credit_activity: 0,`; docs "**Cost:** Free (0 credits)." — uyumlu |
| 2 Mutasyon | ÖLÇÜLDÜ | M3 (sayfa-2 başlığı) KIRMIZI 2 test; M4 (kiracı filtresi `.eq("user_id",…)` silindi) **YEŞİL KALDI** — hızlı şerit kör, db şeridi koşulmadı |
| 3 Canlı negatif | ÖLÇÜLDÜ | `limit` 0/51/2.5 ve `before_id` "not-a-number"/-5 hepsi `isError: true` ile reddedildi; **ama** ulaşılamayan `before_id` reddedilmiyor — B-1/B-2 |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 512 kayıt, varsayılan 10; sayfa 2 imleçle ulaşıldı; net harcama özeti geldi; kredi Δ 0 |
| 5 SEO güncelliği | İLGİSİZ | Referans satır 211: `| list_credit_activity | — | Dış kural yok |` |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:16` `"list"`; `CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` içeriyor |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs` PLAN girişi **YOK** (ve `EXCLUDED` boş) · `goals/` hedefi yok |

**Karar (ölçüm turu, 2026-09-02):** DÜZELTME GEREKLİ — 512 kayıtlı bir hesaba imlecin sonunda **"No credit activity yet…
nothing has moved your balance so far."** deniyor (canlı ölçüldü). Kardeş tool `list_jobs` bu iki
dalı (bilinmeyen imleç / geçmişin sonu) doğru ayırıyor; düzeltme geri yönde yolculuk etmemiş.

**Karar (kapanış, 2026-09-02):** KAPANDI (dilim 1 düzeltmesi, #205 + #206) — dört P1'in dördü de kapandı (B-1, B-2, B-3 canlı doğrulandı; B-4 hızlı şeritte pinlendi). **Kalan:** B-6 (P2, canlıda ölçülemedi — 0033 sonrası `project_id` taşıyan satır yok).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/list-credit-activity.ts:437-478` (`makeListCreditActivityTool`,
  `handler` satır 464; üretim örneği satır 478)
- Okuma portu: `listOwnCreditActivity` satır 148-173 · özet portu `summarizeOwnSpend` satır 187-200
- Kayıt: `apps/mcp/src/tools/index.ts:6,53,170`
- Zod şeması (alanlar, kısıtlar), satır 446-463:
  - `limit`: `z.int().min(1).max(50).default(10)` (`MAX_ACTIVITY_LIMIT`=50 satır 114,
    `DEFAULT_ACTIVITY_LIMIT`=10 satır 111)
  - `before_id`: `z.int().positive().optional()` — canlı JSON Schema'da
    `{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991}`
  - `additionalProperties` **yok**
- Description (birebir alıntı):
  > List your credit ledger entries, newest first — what each tool charged, for which project, plus net spend per tool. Pages with before_id. Costs 0 credits.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:23`, birebir): `  list_credit_activity: 0,`
  (üstündeki yorum, satır 18-22: "0 credits, and for the same reason get_credit_balance directly
  above it is 0: reading your own ledger is not a purchase.")
- Docs sayfası (`apps/web/content/docs/tools-reference/list-credit-activity.mdx`, birebir):
  > **Cost:** Free (0 credits).

  ve:
  > Only entries that **moved your balance** are listed. A tool run is recorded internally as a charge and a matching settlement marker worth zero credits; the marker is bookkeeping and is left out…
- Tutarsızlıklar:
  1. **Docs sayfası net harcama özetini hiç anlatmıyor.** Description "plus net spend per tool"
     diyor, canlı çıktı `Spent so far: 7081 credits, net of refunds, across 24 tools. Top: …`
     satırını basıyor; mdx gövdesinde ve "### Returns" bölümünde bu cümleden **hiç** söz yok.
     (Frontmatter `description` üretiliyor, gövde elle yazılıyor; drift kontrolü yalnız
     frontmatter'a ve Input tablosuna bakıyor — `apps/web/lib/tool-docs-gen.test.ts`.)
  2. Docs "### Returns" imleç cümlesini de anmıyor: canlı cevap
     `502 older entries not shown — call again with \`before_id: 777\` for the next page.` diyor;
     mdx Input tablosunda `before_id` var, Returns'te yok.
  3. Uyumlu olanlar: description ↔ mdx frontmatter (birebir, maliyet cümlesi soyulmuş),
     `limit`/`before_id` açıklamaları ↔ mdx Input tablosu (birebir), kredi 0 ↔ ölçülen Δ 0.
- Seçilebilirlik: "What have I spent credits on lately?", "kredilerim nereye gitti", "hangi tool ne
  kadar yedi" cümlelerinde seçilir. Karıştığı komşular: (a) **`get_credit_balance`** — "kaç kredim
  var" ile "nereye gitti" ayrımı; bu tool cevabını `Run get_credit_balance for your current total.`
  ile kapatarak ayrımı çıktıda kuruyor. (b) **`list_jobs`** — "ne çalıştırdım" sorusu ikisine de
  gidebilir; ayrım net (biri para, biri iş). **Asıl risk:** description "for which project" dediği
  için model `project_id` argümanı vermeyi dener; şemada böyle bir alan yok ve **sessizce yutuluyor**
  (§3, B-3).

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `npx vitest run src/tools/{get-credit-balance,get-job-status,list-jobs,list-projects,list-credit-activity}.test.ts`
(`apps/mcp` altından). Taban: **156 passed / 5 files**.
`list-credit-activity.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M3 | `list-credit-activity.ts:425-427` `paged ? "Continuing from your cursor…" : …` → daima "most recent" başlığı | sayfa-2 başlığını pinleyen test | **KIRMIZI** (2 test) | `list-credit-activity.test.ts:428` `expect(next).toMatch(/Continuing from your cursor/)` |
| M4 | `list-credit-activity.ts:158` `.eq("user_id", userId)` **silindi** (NEVER #4 kiracı filtresi) | kiracı sızıntısını yakalayan test | **YEŞİL KALDI** | 156/156 geçti. Hızlı şerit portu enjekte ettiği için gerçek sorguya hiç bakmıyor; koruma **yalnız** `list-credit-activity.db.test.ts`'te (Docker/`make verify-db`) — yani `make verify`'ın koştuğu şeritte NEVER #4 bu tool için ölçülmüyor |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). M4 kaynak dosyanın kendi başlığının
"proven load-bearing in list-credit-activity.db.test.ts" iddiasını doğruluyor — koruma gerçek ama
**varsayılan kapının göremediği bir yerde**.

Çalışma ağacı sonunda temiz: `git diff --stat` → **çıktı yok (boş)**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (basılmadı). Her satırda önce/sonra `get_credit_balance`; bakiye **4519** sabit.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| limit alt sınır altı | `{"limit":0}` | 200, `isError: true` | 0 | `Invalid input for "list_credit_activity": ✖ Too small: expected number to be >=1 → at limit` |
| limit üst sınır üstü | `{"limit":51}` | 200, `isError: true` | 0 | `✖ Too big: expected number to be <=50 → at limit` |
| limit tamsayı değil | `{"limit":2.5}` | 200, `isError: true` | 0 | `✖ Invalid input: expected int, received number → at limit` |
| bozuk cursor tipi | `{"before_id":"not-a-number"}` | 200, `isError: true` | 0 | `✖ Invalid input: expected number, received string → at before_id` |
| negatif cursor | `{"before_id":-5}` | 200, `isError: true` | 0 | `✖ Too small: expected number to be >0 → at before_id` |
| **ulaşılamaz cursor (çok büyük)** | `{"before_id":99999999,"limit":2}` | 200, **hata yok** | 0 | **`Continuing from your cursor: 2 of 512 older credit entries, newest first:`** — dönen satırlar hesabın **EN YENİ** iki kaydı. Hiç verilmemiş bir imleç kabul edildi ve en yeni kayıtlar "daha eski kayıtlar" diye etiketlendi |
| **cursor geçmişin dibinde** | `{"before_id":1,"limit":2}` ve `{"before_id":2,"limit":2}` | 200, hata yok | 0 | **`No credit activity yet. Your ledger records credits granted, credits bought, and credits a tool charged — nothing has moved your balance so far.`** — 512 kaydı olan hesaba söyleniyor |
| şemada olmayan `project_id` (gerçek) | `{"project_id":"e2785bf7-…","limit":3}` | 200, hata yok | 0 | Argüman **sessizce yutuldu**; cevap hesap geneli, kapsamlanmamış |
| şemada olmayan `project_id` (rastgele UUID) | `{"project_id":"00000000-0000-4000-8000-000000000000","limit":3}` | 200, hata yok | 0 | Yukarıdakiyle **birebir aynı** cevap — "geçersiz proje" diye bir kavram yok |
| şemada olmayan `project_id` (bozuk) | `{"project_id":"not-a-uuid","limit":3}` | 200, hata yok | 0 | Yine birebir aynı cevap |

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| argümansız | `{}` | 200, text | **0** | `Your 10 most recent credit entries of 512, newest first:` + 10 satır + `These are the entries that moved your balance…` + `502 older entries not shown — call again with \`before_id: 777\`…` + "project not recorded" dipnotu + `Spent so far: 7081 credits, net of refunds, across 24 tools. Top: ranked_keywords 1430 · compare_competitors 1170 · analyze_backlinks 980 · audit_onpage 720 · crawl_site 540 — 2241 across 19 other tools.` |
| dar sayfa | `{"limit":2}` | 200 | **0** | `Your 2 most recent credit entries of 512…` + `510 older entries not shown — call again with \`before_id: 787\`…` |
| **2. sayfa (imleç)** | `{"limit":2,"before_id":787}` | 200 | **0** | `Continuing from your cursor: 2 of 510 older credit entries, newest first:` + `508 older entries not shown — call again with \`before_id: 784\`…` — imleç zinciri çalışıyor, başlık doğru değişiyor, sayaç kalan'ı sayıyor |
| kapsam (proje) | `{"project_id":<gerçek id>}` | 200 | **0** | **Kapsamlama YOK** — §3'e bakınız. `list_projects`'ten alınan gerçek id hiçbir şeyi değiştirmiyor |

**Canlıda ÖLÇÜLEMEYEN dal — ve bu bir bulgu:** 512 kaydın tamamı `project not recorded` diyor.
`LEDGER_PROJECT_SCOPE_SINCE_MS` (satır 314) = `2026-08-26T17:48:00.000Z`; ledger'ın **en yeni** kaydı
`2026-08-26T10:36:21` — yani migration 0033 canlıya çıktıktan **sonra hiç harcama yapılmamış**.
Sonuç: `project: <domain>` ve `no project scope` dallarının ikisi de canlıda **hiç görülemedi**;
0033'ün amacı canlıda doğrulanmamış durumda (yalnız birim testinde pinli:
`list-credit-activity.test.ts` "the project a charge was for" bloğu).

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim1/hesap/probe.jsonl`
(anahtar redakte; `sg_` içeren satır sayısı 0 ölçüldü).

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| — | Referans `docs/reference/2026-09-02-seo-referans-listesi.md:211`: `| list_credit_activity | — | Dış kural yok |` | **İLGİSİZ** | Dış kural yok — kontrol edilen: modül hiçbir dış API'ye çıkmıyor; tek okuduğu tablo `credit_ledger` (satır 154), tek yazma yolu **yok** (NEVER #2 append-only). Hiçbir sağlayıcı tarifesi/saklama penceresi değmiyor |

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR ama sevk edilmemiş** — satır 16
`list_credit_activity: "list"`; `CARDED_TOOLS` (satır 62) yalnız `get_credit_balance` içeriyor.
Canlı `tools/list` bu tool için `_meta` **yayınlamıyor** (ölçüldü), `tools/call` cevabında
`structuredContent` **yok** (ölçüldü) — yani planlı `list` kartı henüz yok. Bu, spec §9'un
"planlı ama sevk edilmemiş" meşru durumu; sessiz bir boşluk değil.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK** (düzeltme fazında eklenir). Not: `EXCLUDED`
  boş (`plan.mjs:91`) ve `assertCoverage` (satır 360) canlı listedeki her tool'un PLAN ya da
  EXCLUDED'da olmasını şart koşuyor; PLAN 19 tool adı içeriyor, canlı sunucu **38** tool yayınlıyor.
  Yani sweep bugün canlıya karşı **başlatılamaz** — bu tool o 19 eksikten biri.
- `goals/` hedefi gerekli mi: **EVET** — bu tool ledger'ın müşteriye görünen tek dökümü;
  "512 kaydı olan hesaba 'no credit activity' denmemesi" makine-kontrollü bir hedefe değer
  (aşağıdaki B-1). Bugün `goals/` altında bu tool'a değen hiçbir predicate yok.

## Bulgular

| # | şiddet | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-02) |
|---|---|---|---|---|---|
| B-1 | **P1** | Geçmişin dibindeki bir imleç, 512 kayıtlı hesaba **`No credit activity yet … nothing has moved your balance so far.`** dedirtiyor. Cümle yanlış ve müşterinin defteri hakkında | canlı: `{"before_id":1}` ve `{"before_id":2}` (§3) | `list_jobs`'un **zaten** taşıdığı ayrımın buraya getirilmesi: `NO_MORE_JOBS_MESSAGE` karşılığı bir "geçmişin sonu" cümlesi; `formatCreditActivity` boş sayfada `paged` bayrağına bakıyor olmalı (bayrak zaten parametrede, satır 403, ama boş dalda kullanılmıyor — satır 406) | KAPANDI #205 + canlı ✔ — "end of your credit history"; canlı `4349f71`: LCA imleç cümleleri |
| B-2 | **P1** | Hiç verilmemiş / ulaşılamaz bir `before_id` reddedilmiyor: en yeni kayıtlar `Continuing from your cursor: … older credit entries` başlığıyla dönüyor | canlı: `{"before_id":99999999}` (§3) | `list_jobs`'taki `unknownCursor` + `UNKNOWN_CURSOR_MESSAGE` deseni (list-jobs.ts:82-84, 131-143). Burada imleç bir bigint olduğu için "kiracıya ait mi" kontrolü de aynı sorguda yapılabilir — bugün başka bir kiracının satır id'si de imleç olarak kabul ediliyor | KAPANDI #205 + canlı ✔ — `unknownCursor` + yabancı-kiracı imleci reddi. Canlı şerh: bilinmeyen imleç iki kardeşte de `isError:false` dönüyor (tutarlı, şef kabul etti) |
| B-3 | P1 | Description "for which project" diyor, şemada `project_id` **yok**, ve verilen `project_id` (gerçek / rastgele UUID / bozuk — üçü de) sessizce yutulup hesap geneli cevap dönüyor. Model kapsamlanmış sanır | canlı 3 satır (§3) | İki seçenekten biri: (a) gerçek bir `project_id` filtresi (0033 sütunu zaten var), (b) `.strict()` ile reddetme. Sessiz yutma ikisinden de kötü | KAPANDI #205 + canlı ✔ — şemada `project_id` (uuid), kiracı filtresinin üstüne; canlı: proje kapsamı |
| B-4 | P1 | NEVER #4 kiracı filtresi hızlı şeritte ölçülmüyor: `.eq("user_id", userId)` silindiğinde 156 testin hepsi geçiyor. Koruma yalnız `*.db.test.ts`'te, o da `make verify`'da koşmuyor | M4 (§2) + `CLAUDE.md` kapı tablosu ("`make verify` … **DB şeritleri YOK**") | Kapının kapsam sorunu; bu tool'a özgü kod düzeltmesi değil. Öneri: `make verify-db`'nin hangi NEVER'ları tek başına taşıdığının zorlama haritasına yazılması | KAPANDI (#206) — üç okumanın da `.eq("user_id")`'i `service-client-pins.test.ts`'te pinli |
| B-5 | P2 | Docs sayfası description'ın vaat ettiği net harcama özetini ve imleç cümlesini hiç anlatmıyor | §1 tutarsızlık 1-2 | mdx gövdesine "Spent so far" satırının ve imleçle sayfalamanın anlatılması; drift kontrolü gövdeye bakmıyor, o yüzden bu elle yakalanmalı | KAPANDI #205 — `list-credit-activity.mdx` gövdesi: "Spent so far" + imleçle sayfalama (S5) |
| B-6 | P2 | Migration 0033'ün proje kapsamı canlıda hiç doğrulanamadı: ledger'ın en yeni satırı, sütunun yazılmaya başladığı andan **7 saat önce** | §4 | Ölçüm turunda bir kez ücretli bir iş koşup (operatör kararı) `project: <domain>` dalının canlıda göründüğünün kanıtlanması; ya da bu dalın "yalnız birim testinde kanıtlı" olduğunun yazılması | AÇIK — canlıda ölçülemedi; 0033 sonrası `project_id` taşıyan gerçek ledger satırı hâlâ yok |

## Taban notu (şef, 2026-09-02, ölçüm sonrası)

Bu kayıt `c8e0daa` tabanında yazıldı; o taban `origin/main`'in **bir PR gerisindeydi** (#198, `159535c`).
Tool kaynağı iki tabanda bayt-özdeş, bu yüzden 1–6. adımların ölçümleri geçerli. **Yalnız 7. adımın sweep
kalemi bayat:** #198 `plan.mjs`'i doldurdu ve `verify.sh`'e `tool-sweep.mjs --self-test`'i ekledi.
Güncel ağaçta ölçüldü: öz-test **7/7 PASS**, "38 live tools accounted for (22 planned + 16 excluded)";
bu tool bugün `PLAN` içinde. Bu dosyadaki "harness başlamıyor / EXCLUDED boş / PLAN 19" satırları
**#198 ile KAPANMIŞTIR** ve düzeltme iş emrine girmez.
