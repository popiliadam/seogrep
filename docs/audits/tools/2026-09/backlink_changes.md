# `backlink_changes` — tool kontrol kaydı (2026-09 turu)

> Dilim: 5 (backlink ailesi) · İşçi: Opus 5 (d5-changes) · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, toplam Δ −70 kredi** (iş emri tavanı: ≤2 ücretli — tam sınırda).
> Taban: `main` 5edf35f, `pnpm --filter @pseo/mcp test` → **160 dosya / 4130 test, 0 fail**.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `tools/backlink-changes.ts:60/86/250` + port `dfs/backlink-changes.ts`; kredi `costs.ts:79` = `  backlink_changes: 35,`; docs "**Cost:** 35 credits."; description ↔ mdx ↔ canlı JSON Schema **üçü de birebir** |
| 2 Mutasyon | ÖLÇÜLDÜ | 6 mutasyon → **6 KIRMIZI, 0 YEŞİL**; ama pencere aritmetiği yalnız AY-ORTASI bir tarihte pinli (B-2) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 6 senaryonun 6'sı ücretsiz reddedildi; defterde 0 satır; `additionalProperties:false` canlıda doğrulandı |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (35+35). Her biri **tam olarak bir** `-35 credits · charge · backlink_changes · project:` satırı, refund yok |
| 5 SEO güncelliği | ÖLÇÜLDÜ | **R-6.8 iki yarıya bölünüyor:** bayat "link spam update" dili **HİÇ YOK** (grep 0 → UYUYOR) · takvimle ilişkilendirme **YOK** (→ B-1, R-6.9 ile birlikte) |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `ui/card-map.ts:40` `backlink_changes: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance` |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:150` EXCLUDED ve **gerekçesi BAYAT** (B-5) · `goals/` hedefi YOK |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — tool'un kendi sözleşmesi (iki seri
birleştirilmez, pencere vendor'ın echo'su, `n/a` ≠ `0`, HARD cap iki yerde) canlıda birebir tuttu ve
altı mutasyonun altısı da kırmızı verdi. Üç yapısal eksik ölçüldü: **(1)** DK-3 — port hatası
rezervasyonu AÇIK bırakıyor ve **test bunu pinliyor** (B-3); **(2)** `windowStart` ay-sonu
tarihlerinde JS `Date` taşmasıyla **istenen pencereden farklı bir pencere** istiyor ve hiçbir test
bunu ölçmüyor (B-2); **(3)** son kova GELECEK tarihli, tamamlanmamış ve `0/0` basılıyor — canlıda
iki çağrının ikisinde de (B-4).

**Hakem kararı (taze Fable, 2026-09-04): PASS.** B-2 `node` ile bağımsız yeniden üretildi (dört
sınır tarihinin dördü de tuttu), B-3'ün "onarım testleri kırmaz" iddiası gerçek onarım koşularak
doğrulandı (H16 → 4130/4130 YEŞİL), altı mutasyonun altısı da kırmızı teyit edildi. Kayıt bu turda
üç yerde GENİŞLETİLDİ: B-2 şiddeti P2→P1, B-2'nin çift yönlü pinsizliği yeni bulgu B-6 olarak
girdi (H-3), ve DK-3'ün ölçülmüş şekil haritası (H-2) §2'ye eklendi. Ölçüm turunun metni SİLİNMEDİ.

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/backlink-changes.ts:243` (`makeBacklinkChangesTool`), üretim örneği
  `backlinkChangesTool` `:303`. Kayıt: `tools/index.ts:27` (import), `:107` (export), `:200` (dizi).
- Port / DFS adaptörü: `apps/mcp/src/dfs/backlink-changes.ts` — iki LIVE uç:
  `…/backlinks/timeseries_new_lost_summary/live` (`:36`) ve `…/backlinks/timeseries_summary/live` (`:38`).
  Canlı istemci `createLiveBacklinkChangesClient` `:456`, ayrıştırıcılar `:337` / `:365`.
- Ücretlendirme kipi: **`charge: "handler"`** (`:250`) — senkron, kendi kendini settle eden yüzey
  ücreti (`withCredits`, `jobId` YOK). Ledger meta `:269`: `{ tool: "backlink_changes", projectId: subject.project?.id }`.
- Zod şeması (`:60-84`) — **canlı `tools/list` JSON Schema ile birebir** (§3'te ölçüldü):
  `target` (string, minLength 1) · `project_id` (uuid) · `group_range` (enum `day|week|month|year`,
  default `month`) · `periods` (int, **min 1 / max 365**, default 12) · `"additionalProperties": false`.
- Description (birebir alıntı, `:86-93` — canlı `tools/list` ile birebir aynı):
  > See how a site's backlink profile changed over time: new and lost backlinks and referring domains per bucket, plus the profile's own totals and DataForSEO rank at each bucket. Pass a target domain (any public domain) or a project_id, and choose day/week/month/year buckets. Synchronous — returns both series immediately. Costs 35 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:79`, birebir): `  backlink_changes: 35,`
  — imza şerhiyle (`costs.ts:72-78`): *"SIGNED BY THE OPERATOR 2026-08-17 at 35 … the WINDOW CAP that
  keeps the worst case there (MAX_BACKLINK_CHANGES_PERIODS, dfs/backlink-changes.ts) is part of the
  signed price, not a soft limit."*
- Docs sayfası (`apps/web/content/docs/tools-reference/backlink-changes.mdx:6`, birebir):
  > **Cost:** 35 credits.

  ve `mdx:31` (birebir):
  > The `periods` ceiling is part of the price rather than a stylistic limit: DataForSEO bills per returned row, and the window is what decides how many rows come back.
- **Sabitler, kaynak satırıyla:**

  | sabit | değer | kaynak |
  |---|---|---|
  | `DFS_BACKLINKS_REQUEST_USD` | **0.024** | `dfs/backlink-changes.ts:51` |
  | `DFS_BACKLINKS_ROW_USD` | **0.000036** | `:52` |
  | `BACKLINK_CHANGES_REQUESTS` | **2** | `:55` |
  | `DEFAULT_BACKLINK_CHANGES_PERIODS` | **12** | `:65` |
  | `MAX_BACKLINK_CHANGES_PERIODS` (HARD cap) | **365** | `:75` |
  | `DFS_BACKLINKS_HISTORY_START` | **2019-01-30** | `:82` |
  | `BUDGET_SAFETY_FACTOR` | **1.5** | `:112` |
  | `BACKLINK_CHANGES_RANK_MAX` | **1000** | `:96` |

  Tahmin (`estimateBacklinkChangesUsd`, `:121`): `2 × (0,024 + (buckets+1) × 0,000036) × 1,5`.
  Varsayılan pencerede (12) = **$0,0734/çağrı** — iş emrinin "~0,073/çağrı" rakamı ölçümle tuttu.
- **HARD cap İKİ YERDE iddiası (`:69-74`) — DOĞRU, ölçüldü:** zod `.max(365)` (`:75`) yüzeyi,
  `clampPeriods` (`dfs:143`) süreç-içi her çağıranı kapatıyor. Mutasyon M3 zod tarafını gevşetti →
  **KIRMIZI** (iki test); yani şema yarısı pinli. `clampPeriods` yarısı ayrıca pinli (`dfs` testi
  `:357`, 10.000 → cap).
- Seçilebilirlik: "backlink profilim zaman içinde nasıl değişti / kaç link kaybettim" cümlelerinde
  seçilir. Karışabileceği komşular: `analyze_backlinks` (ANLIK profil özeti, 70 kredi) ve
  `backlink_details` (TEK TEK linkler, 35 kredi). Ayrım açık: bu tool tek zaman-serisi tool'udur ve
  description'ın ilk üç kelimesi ("changed over time") bunu söylüyor. **Ölçülen risk yok.**

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`, çıktı dosyadan okundu (loglar
`<scratchpad>/dilim5/logs/M*.log`). Taban 4130/4130.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `tools/backlink-changes.ts:269` — `projectId` ledger meta'sından silindi (**Sınıf 1 / NEVER#4**) | kiracı-kapsam pinleri | **KIRMIZI (2)** | `backlinks-project-scope.pin.test.ts > 'backlink_changes' … reserves against the project the call named` + `handler-charge-scope-coverage.pin.test.ts > names a project at every call site that has one to name` — **Sınıf 2 süpürgesi bu tool'u GERÇEKTEN görüyor** |
| M2 | `dfs:522` — `date_from/date_to` vendor echo'su yerine İSTENEN pencere basıldı | echo pini | **KIRMIZI (1)** | `dfs/backlink-changes.test.ts > returns the window DataForSEO echoed, not the one that was requested` |
| M3 | `tools:75` — zod `.max(365)` → `.max(10_000)` (HARD cap'in yüzey yarısı) | şema cap pini | **KIRMIZI (2)** | `caps the window at the schema level, and defaults well below the cap` + `rejects a window past the cap before any handler work` |
| M4 | `dfs:512` — `settleSpend(...)` çağrısı tamamen kaldırıldı (**DK-3 komşusu: settle yolu pinli mi**) | settle spesleri | **KIRMIZI (4)** | dördü de `dfs/backlink-changes.test.ts` içinde; karışık fiyatlı çift dahil |
| M5 | `dfs:167-168` — takvim aritmetiği → `span × 30` / `span × 365` gün yaklaşımı | takvim pini | **KIRMIZI (2)** | `windowStart > walks back by real calendar periods, not by a fixed number of days` + istek gövdesi pini. **Ama bkz. B-2: pin yalnız 2026-08-18 (ay ORTASI) tarihinden ölçüyor** |
| M6 | `tools:220` — `SERIES_DO_NOT_RECONCILE_NOTE` çıktıdan çıkarıldı ("reconciliation the vendor never made" şerhi) | şerh pini | **KIRMIZI (1)** | `formatBacklinkChanges > warns that the two series are not each other's arithmetic, and derives nothing` |

**6/6 KIRMIZI — yeşil kalan mutasyon yok.** Bu tool'un kapı kapsamı bu turun en iyisi.

**Hakem şerhi — M1 hangi sınıfı ölçtü (hakem turu, 2026-09-04):** M1 "Sınıf 1 / NEVER#4" diye
etiketlenmiş; ücret meta'sından `projectId` düşürmek **Sınıf 2**'dir (ücret kapsamı süpürgesi).
Aynı yanlış etiket altı kayıtta da var. **NEVER#4'ün gerçek kiracı okuması**
`tools/project-target.ts:48`'dir (`forUser(getServiceClient(), userId).selectOwnById`) ve **o
zincirin hızlı-şerit pini ÖLÇÜLMEDİ** — canlı 404 kanıtı var (§3, N1), pin kanıtı yok.

**DK-3 (NEVER#5) — MUTASYONLA DEĞİL, STATİK OLARAK KAPANDI, ve bulgu B-3:** `dfs:456-517`
canlı istemcisinde `reserveSpend` 1 · `settleSpend` 1 · **catch-settle 0**; `try/catch` hiç yok.
`settleFailedSpend` (`dfs/budget.ts:211`) bu depoda **beş** portta çağrılıyor
(`client.ts:464`, `keyword-gap.ts:390`, `discover-keywords.ts:871`, `ranked-keywords.ts:563`,
`relevant-pages.ts:762`) — bu port onlardan biri DEĞİL. Modül başlığı davranışı açıkça yazıyor
(`dfs:450-452`): *"a failure at (3) leaves the reservation open at its full estimate"*, ve
`dfs/backlink-changes.test.ts:644` bunu **PİNLİYOR**: `// The reservation stays OPEN at its full
estimate — never less than what really happened.` Yani burada mutasyon gereksiz: kapı zaten
kusurlu davranışı sınıyor. Onarımın testi kırıp kırmayacağı da ölçüldü — **kırmaz**: iddia
`todaySpendUsd` üzerinde ve hem gerçek sayaç (`0014` → `coalesce(actual_usd, estimated_usd)`) hem
bellek defteri (`budget.ts:257-258` → `row.actualUsd ?? row.estimatedUsd`) açık satırı zaten
tahminiyle sayıyor.

**Hakem doğrulaması (H16, 2026-09-04): işçinin iddiası TUTTU.** Hakem `settleFailedSpend`'li gerçek
onarımı bu porta uygulayıp kapıyı koştu → **4130/4130 YEŞİL**. Yani "onarım testleri kırmaz" cümlesi
ölçülmüş bir iddiadır, varsayım değil.

**Hakem eki — DK-3'ün ÖLÇÜLMÜŞ şekil haritası (H-2, hakem turu, 2026-09-04).** Şef gözlemi Ş-3 bu
sınıfın ÜÇ şekli olduğunu söylüyordu; hakem altı portu da ölçtü ve şekil **İKİ**: onarımı bir test
kıran portlar ve hiç test kırmayanlar. **Bu tool ikincisindedir.**

| port | rezervasyonu pinleyen iddia | onarım uygulanınca |
|---|---|---|
| `dfs/competitors.ts:780` | `actualUsd toBeNull` ×2 | KIRMIZI (2) |
| `dfs/backlinks.ts:408` | `actualUsd toBeNull` ×1 (`backlinks.test.ts:380`) | KIRMIZI (1) |
| `dfs/link-gap.ts:322` | hiçbir şey | YEŞİL |
| `dfs/backlink-details.ts:583` | yalnız `todaySpendUsd` (`:768`) | YEŞİL |
| **`dfs/backlink-changes.ts:489` (bu tool)** | **yalnız `todaySpendUsd` (`:644`)** | **YEŞİL (H16)** |
| `dfs/disavow-candidates.ts:849` | yalnız `todaySpendUsd` (`:1284`, `:1318`) | YEŞİL |

**Önemli ayrım:** `dfs/backlink-changes.test.ts:644`'teki *"The reservation stays OPEN at its full
estimate"* bir **YORUM**tur ve altındaki iddia `todaySpendUsd`'a bakar — yani kusurlu davranışın
`status`/`actualUsd` yarısı aslında **pinli DEĞİL**. Kayıttaki "test bunu PİNLİYOR" cümlesi bu
yüzden yalnız yorum düzeyinde doğrudur.
**Tek PR notu:** düzeltme altı porta birlikte girer — `try` isteği VE ayrıştırmayı kapsar (`finally`
DEĞİL), `catch` → `settleFailedSpend` → yeniden fırlat; ve **HER portta** "satır kapandı,
`actualUsd === estimatedUsd`, rows 0" iddiası **yazılır** (bu portta taşınacak iddia yok, eklenecek
iddia var).

**Çalışma ağacı sonunda temiz:** `git diff --stat` → **çıktı yok** (boş).

**Koşulmayanlar (adıyla):** `*.db.test.ts` şeritleri (Docker) — **db şeridi CI/hakem**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt: `<scratchpad>/dilim5/canli/probe.jsonl`.
Defter kontrolü: `list_credit_activity` `project_id` filtresiyle — **bu altı senaryonun hiçbiri
defterde satır üretmedi** (dentnotion'da tek yeni satır H1'inki).

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 uydurma `project_id` | `{project_id:"00000000-0000-4000-8000-000000000000"}` | 200 / `isError:true` | 0 | `No project found with id …. Run list_projects … You were not charged.` — **kiracı sızıntısı yok: "yok" diyor, başkasının projesini göstermiyor** |
| N2 bilinmeyen alan | `{project_id:DENT, nope:1}` | 200 / `isError:true` | 0 | `Invalid input for "backlink_changes": ✖ Unrecognized key: "nope".` — `additionalProperties:false` (#204) canlıda |
| N3 pencere tavanı üstü | `{project_id:DENT, periods:366}` | 200 / `isError:true` | 0 | `✖ Too big: expected number to be <=365 → at periods` — HARD cap'in yüzey yarısı canlıda |
| N4 hem `target` hem `project_id` | `{project_id:DENT, target:"dentnotion.com"}` | 200 / `isError:true` | 0 | `Pass "project_id" or "target", not both — they can name different domains and SeoGrep will not guess which one you meant.` |
| N5 ikisi de yok | `{}` | 200 / `isError:true` | 0 | `Nothing to look up: pass "project_id" … or "target" …` |
| N6 geçersiz `group_range` | `{project_id:DENT, group_range:"quarter"}` | 200 / `isError:true` | 0 | `✖ Invalid option: expected one of "day"\|"week"\|"month"\|"year"` |

**6/6 ücretsiz ret. Charge+refund çifti YOK (T-B11 sınıfı gözlenmedi).**
Canlı `tools/list` şeması kaynakla **birebir** (alan alan karşılaştırıldı: `periods` min 1 / max 365,
`group_range` enum 4 değer, `additionalProperties:false`).

## 4. Canlı mutlu yol

Bakiye: **3212 → 3062** (bu kayıt + `disavow_candidates` kaydının 2 çağrısı ile birlikte
tam **−150**; bu tool'un payı **−70**).

| senaryo | argüman | envelope | kredi Δ | çıktı özeti |
|---|---|---|---|---|
| **H1** dentnotion, varsayılan pencere | `{project_id:DENT}` | 200, `isError` yok | **−35** (`22:00:33 · -35 credits · charge · backlink_changes · project: dentnotion.com`, refund yok) | `month buckets from 2025-09-03 to 2026-09-03`; **13 kova** (12 istendi — "bir kova fazla" belgelenmiş davranış); profil 63 → 242 backlink, 42 → 139 referring domain, rank 105 → 170 of 1,000 |
| **H2** adstark, haftalık 8 | `{project_id:ADSTARK, group_range:"week", periods:8}` | 200, `isError` yok | **−35** (`22:01:52 · -35 credits · charge · backlink_changes · project: adstark.com.tr`, refund yok) | `week buckets from 2026-07-09 to 2026-09-03`; **9 kova**; profil 9.129 → 7.412 backlink (**−%19**), en büyük kayıp 2026-08-30 kovasında **1.041 lost backlinks** |

**Ölçülen sözleşme davranışları (ikisi de canlıda tuttu):**
- **Pencere echo'su vs istenen pencere.** H1: istenen `windowStart(2026-09-03,"month",12)` =
  `2025-09-03`; vendor `2025-09-03`'ü echo'ladı — bu çağrıda ikisi AYNI, yani echo mekanizması
  canlıda AYIRT EDİCİ değil. Ayrımı yapan kanıt mutasyon M2'dir (KIRMIZI) ve fixture testidir
  (vendor `2021-12-01` echo'lar, istek `2025-08-18`). **Kayıt bunu "canlıda ölçüldü" diye
  yazmıyor:** canlıda ölçülen şey pencerenin BASILDIĞI, ayrıldığı değil.
- **İki seri birleştirilmiyor.** `SERIES_DO_NOT_RECONCILE_NOTE` iki çağrının ikisinde de basıldı.
  H1'de aritmetik gerçekten tutmuyor: yeni/kayıp serisi 2025-12-31 kovasında `30 new / 0 lost`
  referring domain derken profil serisi 57 → 87 (+30) diyor — bu kovada tutuyor; ama 2026-08-31'de
  `14 new / 3 lost` (net +11) karşısında profil 128 → 139 (+11) tutarken 2026-05-31'de
  `6 new / 7 lost` (net −1) karşısında profil 126 → 125 (−1). **Tool yine de türetilmiş bir "net"
  basmıyor** — doğru karar, çünkü vendor'ın kendi örneklerinde aynı sayılar tutmuyor.
- **`n/a` ≠ `0`.** İki çağrıda da hiç `n/a` çıkmadı (vendor her alanı gönderdi); yani bu dal
  canlıda ÖLÇÜLEMEDİ, birim testleriyle pinli (`dfs` testi `:165`).

Ham kayıt: `<scratchpad>/dilim5/canli/probe.jsonl` (anahtar `makeRedactor` ile redakte).

**Sınıf 9 (`dfs_spend` tahmin/gerçek) — ŞEF ÖLÇÜMÜ (Ş-1, hakem turu, 2026-09-04).** Şef prod
`public.dfs_spend`'i Supabase MCP ile okudu (`spend_day = 2026-09-03` UTC, son iki saat = Dilim 5).
Bu tool'un ucu:

| uç | n | tahmin | gerçek | oran |
|---|---|---|---|---|
| `backlinks/timeseries_new_lost_summary/live` | 2 | 0,1464 | 0,0976 | **1,5×** |

Yani `BUDGET_SAFETY_FACTOR = 1.5` bu uçta **tam olarak** gerçekleşen orandır — tahmin fazladan
hiçbir marj taşımıyor, yalnız güvenlik çarpanının kendisi kadar yukarıda. **BİLGİ kalemidir;
NEVER#6'ya dokunmaz.** Dilim 5 toplamı: gerçek ≈ $0,47 ↔ tahmin ≈ $0,95, yani günlük $3 tavanı
TAHMİNLE sayıldığı için gerçekte yarı yarıya harcanıyor.

## 5. SEO güncelliği

Referans "Tool eşleme" satırı (`docs/reference/…:240`): `backlink_changes | R-6.8, R-6.9 |
Kayıpların spam/core update takvimiyle ilişkilendirilmemesi`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| **R-6.8** (yayımlanan spam güncelleme geçmişi; **2024–2026 arası ayrı adlandırılmış "link spam update" YOK**) | **İki yarı, iki farklı sonuç.** (a) *Bayat dil yarısı:* `grep -rniI "link spam update"` → `apps/mcp/src` + `apps/web/content` üzerinde **0 eşleşme**; tool hiçbir yerde var olmayan bir "link spam update"e atıfta bulunmuyor. (b) *Takvim yarısı:* `grep -rni "core update\|spam update\|google-updates\|algorithm update"` bu tool'un DÖRT dosyasında (`tools/`, `dfs/`, mdx) → **0 eşleşme** | (a) **UYUYOR** · (b) **AYKIRI** | (b) → B-1 |
| **R-6.9** (core update takvimi) | Aynı grep, aynı 0. Takvim ürüne `gsc-data/google-updates.ts` olarak **VERİ hâlinde girdi** (#217, R-6.8/R-6.9 ile 17/17) ve `updatesInRange` + `renderUpdateOverlap` hazır duruyor; `google-updates.ts`'i içeriden çağıran tek yer `gsc-data/index.ts` re-export'u. Backlink ailesi onu **hiç görmüyor** | **AYKIRI (ölçülmüş)** | H1 penceresi (`2025-09-03..2026-09-03`) **7** yayımlanmış güncelleme içeriyor; H2 penceresi (`2026-07-09..2026-09-03`) **1** — ve H2'nin iki en büyük kayıp kovası (2026-08-23: 200 · 2026-08-30: 1.041) o güncellemenin (**Ağustos 2026 spam, 18 Ağu**) hemen ardında → B-1 |
| R-6.1 (link spam tanımı) | Bu tool bir SAYIM tool'u; hiçbir linki spam diye nitelemiyor, hiçbir tavsiye vermiyor | **İLGİSİZ** | Nitelik ekseni `disavow_candidates` ve `analyze_backlinks`'te |
| R-6.2 (`rel=nofollow/sponsored/ugc`) | Bu tool link-başına alan basmıyor (yalnız kova toplamları) | **İLGİSİZ** | Kovaya indirgeme ekseni `disavow_candidates` kaydında B-6 |
| R-6.5 (Google'a otomatik sorgu) | Tek dış uç `api.dataforseo.com`; Google'a hiç istek yok | **UYUYOR** | `dfs:36-38` iki uç, ikisi de DFS |

**Referans satırına şerh (silme değil, ÖNERİ):** R-6.8/R-6.9'un bu tool'a uygulanışı
`analyze_content_decay`'inkinden **zayıftır ve bu kayıt bunu ölçmüştür**. Orada tool "bu sayfayı
yeniden yaz" diyordu; burada tool **hiçbir tavsiye vermiyor** ve serisi Google sıralaması değil
**DataForSEO'nun kendi indeksidir** — bir Google spam güncellemesi DFS indeksinden backlink silmez.
Yani nedensellik kanalı burada yok; kalan kanal **YORUM**: müşteri "1.041 link kaybettim" ile
"sıralamam düştü"yü aynı hafta görüp ikisini birbirine bağlar. Bu yüzden B-1 **P2**'dir, P1 değil —
ve önerilen düzeltme "sebep budur" demek değil, güncellemeyi **adıyla ve tarihiyle anmaktır**.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:40` eşlemesi: **VAR** — `backlink_changes: "report"`.
`CARDED_TOOLS` (`card-map.ts:62`) yalnız `get_credit_balance` içeriyor, yani **planlı ama sevk
edilmemiş**. Canlı yanıtta `structuredContent` yok (`probe.jsonl` H1/H2 kayıtları: yalnız
`content[].text`). Kartın beklediği alanların taşınıp taşınmadığı bu yüzden **ÖLÇÜLEMEDİ**
(ertelenmiş kalem — MCP Apps dilim 2).

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` girişi: **EXCLUDED, `:150`** — ve gerekçesi **BAYAT** → B-5.
  Birebir: `backlink_changes: "paid, 35 credits/call against the DataForSEO backlinks API. Needs a budget signature."`
  Aynı dosyada `:127-131` şunu yazıyor: *"THE BUDGET-SIGNATURE HALF OF THESE FOUR LINES IS GONE …
  the operator signed the credit budget on 2026-09-02 … A reason that has stopped being true is
  worse than no reason"* — düzeltme **dört satıra** uygulandı, bu satır o dördün içinde değil.
- `goals/` hedefi gerekli mi: **EVET, ama yalnız B-1 düzeltilirse** — `google-updates.ts` takvimi bir
  VERİdir ve bayatlar; `analyze_content_decay` kaydı da aynı bakım deliğini AÇIK bırakmış
  (`analyze_content_decay.md:31`). Bu tool takvimi okumaya başlarsa hedef ortak olmalı, tool başına
  ayrı değil. Bugünkü hâliyle: **HAYIR** (`grep` → `goals/` içinde bu tool için hedef yok).

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, YYYY-MM-DD) |
|---|---|---|---|---|---|
| B-1 | **P2** | **Kayıp serisi, yayımlanmış Google güncelleme takvimiyle hiç ilişkilendirilmiyor — referansın bu tool için adlandırdığı TEK risk.** Takvim ürüne `gsc-data/google-updates.ts` olarak zaten girdi (#217, R-6.8/R-6.9 ile 17/17, `updatesInRange` + `renderUpdateOverlap` hazır) ve backlink ailesi onu hiç import etmiyor. Canlıda iki kez ölçüldü: H1 penceresi 7 yayımlanmış güncelleme kapsıyor; H2 penceresi 1'ini (Ağustos 2026 spam, 18 Ağu) kapsıyor ve **iki en büyük kayıp kovası (200 ve 1.041 backlink) tam onun ardında**. **P1 DEĞİL, ve gerekçesi ölçülmüştür:** bu tool hiçbir tavsiye vermiyor ve serisi DFS'in kendi indeksidir — güncelleme backlink silmez; kalan zarar YORUM zararıdır | `grep -rni "core update\|spam update\|google-updates\|algorithm update"` → `tools/backlink-changes.ts` + `dfs/backlink-changes.ts` + mdx üzerinde **0**; `google-updates.ts` içe aktaran tek yer `gsc-data/index.ts:16` re-export'u; H1/H2 canlı çıktıları + `updatesInRange` hesabı (7 / 1) | Pencere yayımlanmış bir güncellemeyle kesişiyorsa çıktı bunu **serilerin ÜSTÜNDE**, `renderUpdateOverlap`'in zaten kurduğu dille ansın — ama bu tool'a özgü bir cümleyle: *"bu bir sıralama olayı değil, indeks sayımıdır; ikisini aynı sebebe bağlamadan önce sıralamanıza bakın"*. Takvim yeniden yazılmaz, `gsc-data/google-updates.ts` **import edilir** (o dosya zaten satıcıdan bağımsız) | |
| B-2 | ~~P2~~ **P1** (hakem turu, 2026-09-04) | **`windowStart` ay-sonu tarihlerinde istenen pencereden FARKLI bir pencere istiyor — kaynak yorumunun "bunu yapmıyoruz" dediği şeyin ta kendisi.** `dfs:167` `start.setUTCMonth(getUTCMonth() - span)` JS `Date` taşmasına açık: 31 Mart'ta `periods:1` → `2026-03-03` (beklenen `2026-02-28`); 31 Mayıs'ta `periods:3` → `2026-03-03`; 31 Ağustos'ta `periods:6` → `2026-03-03`. `year` ekseninde 29 Şubat 2024 − 1 yıl → `2023-03-01`. Ayın 29–31'inde koşan her `month` çağrısı etkilenir (~ayda 7 gün) ve `month` VARSAYILAN gruplamadır. Yorum (`dfs:154-157`) tam tersini iddia ediyor: *"a fixed-length approximation would ask for a different window than the one the tool advertises"*. **Şiddet bandı (H-1, hakem turu, 2026-09-04): P2 → P1** — bu çıplak bir açıklama boşluğu değil, **ölçülmüş bir iddia hatası + para**: ayın 29–31'inde koşan varsayılan (`month`) bir çağrı, 35 kredi karşılığında İSTENENDEN FARKLI bir pencereye ödeme yapıyor ve kaynak yorumu bunun tersini iddia ediyor | `node` ile doğrudan hesap: `2026-03-31/month/1 → 2026-03-03` · `2026-05-31/month/3 → 2026-03-03` · `2026-08-31/month/6 → 2026-03-03` · `2024-02-29/year/1 → 2023-03-01`. Testin tamamı tek bir AY-ORTASI tarihten ölçüyor (`dfs/backlink-changes.test.ts:339-358`, `TO = 2026-08-18`), bu yüzden M5 kırmızı verse de bu delik açık | Ay sonundan geriye giderken gün taşmasını kelepçeleyin (hedef ayın son gününe sabitleme). **Ve testi ay-ortası tek tarihten kurtarın:** `windowStart` spesi en az 31 Mart / 31 Mayıs / 29 Şubat gibi sınır tarihleri taşısın — ders 14: delik KAPSAM ekseninde değil, GİRDİ ekseninde | |
| B-3 | **P1** | **DK-3 (NEVER#5): port hatasında `dfs_spend` rezervasyonu AÇIK kalıyor, ve TEST BUNU PİNLİYOR.** `dfs:456-517`'de `try/catch` yok: `reserveSpend` 1 · `settleSpend` 1 · catch-settle 0. `settleFailedSpend` (`budget.ts:211`) bu depoda beş portta çağrılıyor (`client.ts:464`, `keyword-gap.ts:390`, `discover-keywords.ts:871`, `ranked-keywords.ts:563`, `relevant-pages.ts:762`); bu port beşin dışında. `status=open` operatörün "uçuşta" sinyalidir ve kalıcı olarak kirlenir (A-3 vakası: 45 dakika sonra hâlâ açık). **P1, çünkü NEVER#5 bütçe ekseni** — ama günlük TAVAN etkilenmez | `grep -n "reserveSpend\|settleSpend"` → `dfs/backlink-changes.ts:3,489,512` (catch yok); modül başlığı `:450-452` davranışı yazıyor; `dfs/backlink-changes.test.ts:644` pinliyor: `// The reservation stays OPEN at its full estimate` | `keyword-gap.ts:355-393` desenini uygulayın: `try` isteği VE ayrıştırmayı kapsasın (`finally` değil — başarı settle'ından sonra ikinci settle olur), `catch` → `settleFailedSpend(reservation, ledger)` → orijinal hatayı yeniden fırlat. **Testler kırmızı vermez:** iddia `todaySpendUsd` üzerindedir ve hem `0014` sayacı hem bellek defteri (`budget.ts:257`) açık satırı zaten tahminiyle sayar — bu ÖLÇÜLDÜ, varsayılmadı. Şerh: `backlink-details.ts:583` ve `backlinks.ts:408` aynı sınıfta; tek PR'da kapanmalı. **Hakem doğrulaması (H16, 2026-09-04): iddia TUTTU** — gerçek onarım koşuldu, 4130/4130 YEŞİL. **Ama hakem ekliyor:** `:644`'teki *"stays OPEN"* bir YORUMdur; altındaki iddia `todaySpendUsd`'a bakar, yani `status`/`actualUsd` yarısı **pinli değil** ve onarım bu portta **sessizce geri alınabilir**. Düzeltme paketi buraya kodu değil, **iddiayı da EKLEMELİ**: "satır kapandı, `actualUsd === estimatedUsd`, rows 0". Şiddet **P1 KALIR**; şekil haritası §2'de (H-2) | |
| B-4 | **P2** | **Son kova GELECEK tarihli, tamamlanmamış, ve `0 new / 0 lost` basılıyor — canlıda iki çağrının İKİSİNDE de.** H1 (3 Eylül'de koşuldu) son kovayı `2026-09-30` diye etiketledi: `0 new / 0 lost backlinks · 0 new / 0 lost referring domains`, ve profil satırı bir önceki kovanın rakamlarını harfi harfine tekrarladı. H2 aynı şekilde `2026-09-06` (3 gün sonrası) kovasını bastı. Docs'un kendi cümlesi (`mdx:24`) basılan sıfırın "hiçbir şey olmadı" ile "kayıt yok"u ayırt edilemez kıldığını söylüyor — ama **ÜÇÜNCÜ hâli, "bu dönem henüz yaşanmadı", hiçbir yerde geçmiyor**: `grep -rniI "incomplete\|partial bucket\|current bucket\|in progress"` dört dosyada 0 | H1 çıktısı son iki satır: `• 2026-09-30 — 0 new / 0 lost …` ve `• 2026-09-30 — 242 backlinks · 139 referring domains · rank 170 of 1,000` (2026-08-31 ile birebir aynı); H2: `• 2026-09-06 — 0 new / 0 lost …`; koşum tarihi 2026-09-03 | Kova etiketi bugünün ötesindeyse satır **kısmi olduğunu söylesin** (etiket vendor'ın, o değişmesin — eklenen tek şey bir işaret ve tek bir cümle). Ucuz alternatif: başlığa "son kova devam eden dönemdir" notu. **Ve pinlensin:** bugünkü kapıda bu davranışı gören hiçbir test yok | |
| B-5 | **P2** | **`plan.mjs:150` EXCLUDED gerekçesi BAYAT — ve aynı dosya bayatlığın kendisini anlatıyor.** Satır birebir: `backlink_changes: "paid, 35 credits/call against the DataForSEO backlinks API. Needs a budget signature."` Bütçe imzası **2026-09-02'de geldi** ve bu tool **2026-09-04'te ücretli koştu** (bu kayıt). `plan.mjs:127-131` düzeltmeyi dört satıra uyguladı ve gerekçesini yazdı — *"A reason that has stopped being true is worse than no reason"* (imzalı ders 16) — bu satır dördün içinde değil. Aynı bayatlık `backlink_details` (`:151`), `disavow_candidates` (`:152`), `audit_speed` (`:153`) satırlarında da duruyor | `scripts/testing/plan.mjs:150` + `:127-131`; bu kayıttaki iki ücretli koşum ve defter satırları | Bayat yarıyı kaldırın; **kalan gerçek engel yazılmalı, yoksa satır EXCLUDED kalmamalı**. Bu tool için per-site bir girdi eksikliği YOK (`project_id` tek başına yetiyor — canlıda ölçüldü), yani gerçek engel yalnız FİYAT: sekiz site × 35 kredi her süpürmede. `serp_snapshot:158-164`'ün yeni dili örnek alınabilir ("Excluded because it is EXPENSIVE, not because it is unsigned"). **Hakem eki (H-5, hakem turu, 2026-09-04) — TEK DÜZELTME:** bayat cümle `plan.mjs`'te **beş** satırda duruyor: `:149` (`link_gap`) · `:150` (bu tool) · `:151` (`backlink_details`) · `:152` (`disavow_candidates`) · `:153` (`audit_speed`). Dilim 4'ün "KAPANDI #223" kaydı yalnız DÖRT satır içindi ve o dördün hiçbiri bunlar değil — sınıf kapanmadı, POZİSYON değiştirdi (ders 14). Beş satır tek düzeltmede kapanmalı | |

| B-6 (hakem turu, 2026-09-04) | **P1** | **`windowStart` takvim aritmetiği ÇİFT YÖNLÜ pinsiz — ne kusur ne onarım ölçülüyor (H-3).** B-2 deliğin kendisini ölçtü; hakem deliğin KAPI tarafını ölçtü ve iki yönün ikisinin de karşılıksız olduğunu buldu: (a) mutasyon M5'in kırmızısı (H12'de yeniden üretildi → 2 KIRMIZI) **yalnız sabit-gün yaklaşımına** tepki veriyor, ay-sonu taşmasına değil; (b) ay-sonunu kelepçeleyen **ONARIM uygulandığında kapı YEŞİL kalıyor** (H14 → 4130/4130). Yani bugünkü kapı, yanlış pencereyi de doğru pencereyi de aynı yeşille geçiriyor — ders 12'nin tarifi: yeşil bir test ancak kasten bozulup kırmızıya döndüğü ölçüldüyse kanıttır, ve burada iki yönde de dönmüyor | H12 (`dfs:167-168` → `span × 30` / `span × 365`) → **KIRMIZI (2)**; H14 (ay-sonu kelepçesi = ONARIM) → **YEŞİL 4130/4130**. Testin girdi ekseni tek noktada duruyor: `dfs/backlink-changes.test.ts:339-358`, `TO = 2026-08-18` (ay ORTASI). Hakemin bağımsız `node` hesabı B-2'nin dört satırını da yeniden üretti: `2026-03-31/month/1 → 2026-03-03` · `2026-05-31/month/3 → 2026-03-03` · `2026-08-31/month/6 → 2026-03-03` · `2024-02-29/year/1 → 2023-03-01` | `windowStart` spesi **sınır tarihlerini girdi olarak taşısın**: en az 31 Mart, 31 Mayıs, 29 Şubat (artık yıl) ve bir `year` ekseni vakası. **Ders 14 — varyantlanan eksen adıyla yazılır:** buradaki delik KAPSAM ekseninde değil (fonksiyon test ediliyor), **GİRDİ ekseninde**; tek bir ay-ortası tarih, ayın 29–31'inde ortaya çıkan bütün sınıfı görünmez kılıyor. Onarım ve pin **aynı PR'da** gitmeli, yoksa B-2 sessizce geri alınabilir | |

`durum` sütunu ölçüm turunda BOŞ bırakılmıştır; kapatan tur doldurur.

### Bu turda ÖLÇÜLMEYENLER (adıyla)

- **`n/a` dalı canlıda** — vendor iki çağrıda da her alanı gönderdi; yalnız birim testiyle pinli.
- **`day` / `year` gruplaması canlıda** — yalnız `month` (H1) ve `week` (H2) koşuldu (ücretli tavan).
- **Kartın `structuredContent`'i** — sevk edilmemiş; ölçülemez, ertelendi.
- **`*.db.test.ts` şeritleri** — Docker; db şeridi CI/hakem.
- **B-2'nin canlı hâli** — ay-sonu bir günde koşum gerektirir (bugün ayın 4'ü); statik + `node`
  hesabıyla ölçüldü, canlı çağrıyla değil.
