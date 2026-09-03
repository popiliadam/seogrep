# `pull_gsc_data` — tool kontrol kaydı (2026-09 turu)

> Dilim: 3 (GSC) · İşçi: Opus 5 (d3-gsc) · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, toplam Δ −10 kredi** (izin sınırı 2 çağrı / 5 kredi başına — tam sınırda).
> Bu tool diğer üçünün PRECONDITION'ıdır; bu yüzden dilimde ÖNCE ölçüldü.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `pull-gsc-data.ts:227-416`; kredi `costs.ts:34` = `  pull_gsc_data: 5,`; docs "**Cost:** 5 credits." — description ↔ mdx ↔ canlı JSON Schema üçü de birebir |
| 2 Mutasyon | ÖLÇÜLDÜ | 4 mutasyon: M1/M2/M3 KIRMIZI · **M4 (`gsc_accounts` kiracı filtresi silindi) 3914 testin TAMAMI YEŞİL + `tsc --noEmit` temiz** |
| 3 Canlı negatif | ÖLÇÜLDÜ | 8 senaryonun 8'i doğru reddedildi; net kredi Δ **0** (şema-dışı 5 vaka defterde hiç satır bırakmadı, precondition 3 vakası charge+refund ÇİFTİ bıraktı) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (dentnotion `days=90` ve `days=7`), her biri **tam olarak bir** `-5 credits · charge · pull_gsc_data · project: dentnotion.com` satırı; 90 günlük çekimde **İKİ pencere de 15.000 satır tavanını doldurdu** |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 9 kural tek tek; R-7.10 (preliminary) **örnek alınacak** biçimde kapatılmış (3 günlük gecikme + gerekçe + docs), ama R-7.2 (25.000 tavanı · `startRow`) ve R-7.6 (tüm satır garantisi yok) AYKIRI/EKSİK |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:47` `pull_gsc_data: "action"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`; canlı `tools/call` `structuredContent` taşımıyor (**kontrol: aynı oturumda `get_credit_balance` PRESENT döndü**) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:72` + `:277` + `:281` + `:285/:286` PLAN girişleri **VAR** · `goals/` içinde `pull_gsc_data` geçen hedef **YOK** (grep) |

**Karar (ölçüm turu, 2026-09-03):** DÜZELTME GEREKLİ — para yolu ve tazeleme gecikmesi (R-7.10) canlıda kusursuz
çalıştı ve refuse-önce-ücret-sonra disiplini 8/8 tuttu; ama (a) **ürünün en büyük GSC mülkünde her iki pencere de
satır tavanını doldurdu**, yani bu çekimin üstüne satılan üç adet 10 kredilik analiz kesilmiş veri üzerinde koştu ve
sayfalama (`startRow`, R-7.2) hiç uygulanmıyor; (b) **her Google refresh token'ını tutan tabloya giden kiracı
filtresi `make verify`'ın koştuğu hiçbir test tarafından görülmüyor** — silindiğinde 3914/3914 yeşil kaldı,
ve hakem aynı eksenin **ikinci konumunu** (`defaultLoadConnection` → `gsc_connections`) bağımsız olarak koştu:
o da 3914/3914 yeşil (M4b);
(c) `dataState` satıcı varsayılanından miras alınıyor ve bu hiçbir yerde yazmıyor.

**Karar (kapanış, 2026-09-03):** **KISMEN DÜZELTİLDİ — üç bulgu kapandı, dördü açık.** #217 (`fix/gsc-d3`, **CI'da**, hakem Fable 2 turda PASS) B-2'yi (sayfalama + ölçülmüş bayt bütçesi + pencere adıyla kesilme cümlesi), B-5'i (üç service-role okuması için kiracı zincir pinleri) ve B-7'yi (registry'de tek satırlık zod reddinin noktalanması) kapattı. **Kapanmayanlar adıyla:** B-1 (`dataState` mirası), B-3 (R-7.6 koşulsuz cümlesi), B-4 (429/kota), B-6 (defter kirlenmesi) — dördü de #217 diff'inde arandı ve **karşılığı yok**. B-2'nin kendisi kapandı ama **kalıntı P2 açık**: 2 × 6 MB tam 12.000.000 B'dir, JSON zarfı (~200 B) bunun üstüne biner. B-5 kapandı ama **`goals/` hedefi yazılmadı**. Canlı doğrulama **bekliyor** (#217 henüz deploy edilmedi).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/pull-gsc-data.ts:227-416` (`makePullGscDataTool`; `defineTool` `:233`,
  `handler` `:241`); üretim örneği `pullGscDataTool` `:419`
- Kayıt: `apps/mcp/src/tools/index.ts:10` (import), `:78` (export), `:177` (araç dizisi)
- Motor/port: `apps/mcp/src/gsc-data/pull.ts` (`runPull` `:108`), pencere matematiği
  `apps/mcp/src/gsc-data/windows.ts` (`computeWindows` `:57`), satır ayrıştırma
  `apps/mcp/src/gsc-data/rows.ts`, Google istemcisi `packages/core/src/gsc/client.ts`
  (uç `WEBMASTERS_BASE = "https://www.googleapis.com/webmasters/v3"` `:20`)
- Zod şeması (`pull-gsc-data.ts:63-72`) — canlı JSON Schema ile birebir doğrulandı:
  - `project_id`: `z.uuid()` — **zorunlu** (canlı: `"required": ["project_id"]`, `format: "uuid"`)
  - `days`: `z.number().int().min(7).max(90).default(90)` (canlı: `minimum: 7`, `maximum: 90`, `default: 90`)
  - Canlı şema `"additionalProperties": false` taşıyor (registry `schema.strict()`, #204) — §3 N4'te ölçüldü
  - **`dataState`, `type`/`searchType`, `dimensions`, `rowLimit`, `dimensionFilterGroups`,
    `aggregationType` için HİÇBİR alan yok** — hepsi kodda sabit (bkz. istek gövdesi altta)
- Description (birebir alıntı, `pull-gsc-data.ts:235-238` — canlı `tools/list` ile birebir aynı):
  > Pull two windows of Google Search Console performance (current + previous period) for a connected project, so find_quick_wins / detect_cannibalization / analyze_content_decay can analyze it. Costs 5 credits. Run connect_gsc first.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:34`, birebir): `  pull_gsc_data: 5,`
- Ücretlendirme kipi: **varsayılan `"surface"`** — rezerv → handler → RETURN'de commit / THROW'da release.
  Dosya başlığı (`:21-28`) para kuralını kendi yazıyor: *"anything that means 'no pull happened' must THROW
  (no charge), and a stored pull must RETURN (charge 5)"*. Sıfır satır dönen bir çekim **teslim edilmiş
  sayılır ve commit eder** (`:27-28`).
- Docs sayfası (`apps/web/content/docs/tools-reference/pull-gsc-data.mdx:6`, birebir):
  > **Cost:** 5 credits.

  ve `mdx:46` (birebir):
  > Search Console finalizes a day's data with a ~2–3 day delay, and reports a day it has not finalized as **zero** rather than as missing. Both windows therefore end **3 days before today** instead of running up to it, which clears the delay Google documents with margin to spare: measured against lags of up to 5 days, no unfinalized day is read as a traffic collapse. It is a bounded guard, not an absolute one — if Search Console ever falls further behind than that, unfinalized days re-enter the window and a run of zeros can still look like a drop. The trade-off: the newest 3 days are not analyzed, so a genuine drop surfaces here up to 3 days after it begins.

  ve `mdx:47` (birebir):
  > A single page of up to 15,000 `(query, page)` rows is fetched per window; a very large property is truncated to the top rows Google returns, and the pull says so when it happens.
- **Google'a giden istek gövdesinin TAMAMI** (`gsc-data/pull.ts:94-102`, birebir):
  ```
  { startDate, endDate, dimensions: ["query", "page"], rowLimit, startRow: 0 }
  ```
  `rowLimit` = `MAX_ROW_LIMIT` = **15000** (`pull.ts:66`), `startRow` **daima 0** — sayfalama yok.
- Sabitler (kaynak satırıyla): `MAX_ROW_LIMIT = 15000` (`pull.ts:66`) ·
  `GSC_FRESHNESS_LAG_DAYS = 3` (`windows.ts:23`) · `MIN_DAYS = 7` / `MAX_DAYS = 90`
  (`pull-gsc-data.ts:60-61`) · `GSC_QUERY_TIMEOUT_MS = 30_000` (`core/gsc/client.ts:57`)
- Tutarsızlıklar: **yok — ne karşılaştırıldı:** `DESCRIPTION` ↔ mdx frontmatter `description` ↔ canlı
  `tools/list` description (üçü birebir); `project_id`/`days` `describe()` metinleri ↔ mdx Input tablosu ↔
  canlı JSON Schema (üçü birebir); `costs.ts` 5 ↔ mdx "**Cost:** 5 credits." ↔ ölçülen defter satırı `-5`;
  mdx:47'nin "15,000" rakamı ↔ `MAX_ROW_LIMIT` ↔ canlı çıktının `15,000-row cap` cümlesi (üçü tutuyor,
  ve prose'daki rakam `formatPullSummary`'de sabitten TÜRETİLİYOR — `format.ts:35-37`).
- Seçilebilirlik: "Search Console verimi çek", "son 90 günün GSC performansı", "hangi sorgularda
  görünüyorum" cümlelerinde seçilir. **Karışma riski olan komşular:** (1) `connect_gsc` — kullanıcı
  "Search Console'u bağla" derse; bu tool doğru sırayı description'ında söylüyor ("Run connect_gsc first").
  (2) `my_pages` — o da GSC Search Analytics okur ama DFS Labs `relevant_pages` ile birleştirir; ikisi
  arasındaki fark description'da geçmiyor. (3) **Asıl risk asimetrisi:** bu tool bir ÇEKİM yapar, üç
  türev tool ise SAKLANAN çekimi okur; model "quick wins bul" dediğinde doğrudan `find_quick_wins`
  çağırırsa 10 kredilik bir precondition reddi alır. Üç türev tool'un description'ı "Run pull_gsc_data
  first" diyerek bunu kapatıyor — ölçüldü, §3 N7-N9 doğru mesajı verdi.

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı (M1–M3): `pnpm --filter @pseo/mcp exec vitest run src/gsc-data src/tools/pull-gsc-data.test.ts
src/tools/find-quick-wins.test.ts src/tools/gsc-discovery-shared.test.ts src/tools/gsc-discovery-runs.test.ts
src/tools/service-client-pins.test.ts` → **taban 346 passed / 18 files**.
M4 için paketin TAMAMI: `pnpm --filter @pseo/mcp exec vitest run` → **taban 3914 passed / 147 files**,
ayrıca `pnpm --filter @pseo/mcp exec tsc --noEmit`.
`pull-gsc-data.db.test.ts` ve `gsc-storage.db.test.ts` Docker ister — **db şeridi koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `gsc-data/pull.ts:66` `MAX_ROW_LIMIT = 15000` → `25000` (R-7.2'nin Google tavanı) | satır tavanını pinleyen testler | **KIRMIZI** (11 test / 3 dosya) | Tavan üç yerden birden pinli: motorun kendi pin testi, `formatPullSummary`'nin türetilmiş cümlesi ve üç türev tool'un footer caveat'ı (`gsc-discovery-shared.test.ts:146`). Sabiti değiştirmek DELİBERE bir iş — kod yorumunun (`pull.ts:64`) iddia ettiği gibi |
| M2 | `gsc-data/windows.ts:23` `GSC_FRESHNESS_LAG_DAYS = 3` → `0` (M-20 hayalet-düşüş yolunu geri açar) | pencere matematiği + footer testleri | **KIRMIZI** (11 test / 3 dosya) | R-7.10'un tek savunması pinli. Gecikmenin **kendisi** de parametreleştirilmiş (`computeWindows(reference, days, lagDays)`) ki testler gecikmesiz matematiği ayrıca pinleyebilsin |
| M3 | `gsc-data/pull.ts:98` `dimensions: ["query", "page"]` → `["query"]` (R-7.1 boyut seçimi) | istek gövdesi pini | **KIRMIZI** (1 test) | Boyut çifti pinli; `page` düşerse üç türev tool'un tamamı anlamsızlaşırdı |
| M4 | `tools/pull-gsc-data.ts:166-172` — `defaultLoadAccountToken`'dan `.eq("user_id", userId)` **SİLİNDİ** (`gsc_accounts`: üründeki HER Google refresh token'ının durduğu tablo) | kiracı filtresini gören herhangi bir test | **YEŞİL KALDI — 3914/3914, `tsc --noEmit` de temiz** | Kaynağın KENDİ yorumu (`:163-165`) *"mutation-tested: dropping the user_id filter here is what pull-gsc-data.db.test.ts's SECURITY spec catches"* diyor — **doğru, ama o şerit `make verify-db`'de, `make verify`'da DEĞİL** (CLAUDE.md kapı tablosu: "DB şeritleri YOK"). Ve `service-client-pins.test.ts` — tam bu sınıfı kapatmak için 2026-09-02'de yazılan dosya — `gsc_accounts` ya da `pull-gsc-data.ts`'nin `gsc_connections` okuması için **hiç pin taşımıyor** (grep: dosyada `gsc_connections` yalnız `connect_gsc` ve `track_gsc_property` için pinli). Kullanılmayan `userId` parametresi derleyiciden de geçiyor → B-5 |
| **M4b** (hakem, 2026-09-03) | `tools/pull-gsc-data.ts:146-157` — `defaultLoadConnection`'dan (`gsc_connections`) `.eq("user_id", userId)` **SİLİNDİ** — aynı eksen, **BAŞKA konum** (ders 14) | kiracı filtresini gören herhangi bir test | **YEŞİL KALDI — 3914/3914** | Hakem bu ikinci konumu bağımsız olarak koştu ve ölçtü. Yani B-5'in kanıtı tek bir okumaya değil, **bu dosyadaki İKİ service-role okumasına birden** dayanıyor: `gsc_accounts` (M4) ve `gsc_connections` (M4b). `service-client-pins.test.ts` ikisi için de pin taşımıyor |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). Çalışma ağacı sonunda temiz:
`git diff --stat` → **boş çıktı**; `git status --short` → yalnız bu turun yeni `docs/audits/tools/2026-09/*.md` dosyaları.
Geri alma sonrası regresyon: 27 dosya / **498 passed**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt: repo dışı `…/scratchpad/dilim3/d3-gsc/calls.jsonl`.

**Ölçüm yöntemi (protokol · 2026-09-02 dersi):** kiracı PAYLAŞILIYOR. `get_credit_balance` farkı bu turda da
yanılttı — 8 ücretli çağrım net −70 iken bakiye 4277 → 4197 (−80) düştü; aradaki −10 başka bir işçinin.
Aşağıdaki "kredi Δ" sütunu **bakiye farkı değil, `list_credit_activity`'de kendi tool adımı taşıyan satırlardır**
(`project_id` kapsamıyla okundu).

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N1 uuid değil | `{"project_id":"not-a-uuid"}` | 200, `isError:true` | **defterde satır YOK** | `Invalid input for "pull_gsc_data": ✖ Invalid UUID\n  → at project_id\n\nYou were not charged.` — şema kapısı rezervden ÖNCE |
| N2 bilinmeyen uuid | `11111111-2222-4333-8444-555555555555` | 200, `isError:true` | **−5 / +5 ÇİFTİ** (net 0) | `No Search Console connection for project 11111111-… Run connect_gsc first. You were not charged.` — varlık kâhini yok: bilinmeyen proje ile başka kiracının projesi aynı cümleyi alıyor |
| N3 **GSC bağlı olmayan proje** (seogrep.com) | `4e0caff0-…` | 200, `isError:true` | **−5 / +5 ÇİFTİ** (net 0) | N2 ile **birebir aynı cümle**. `PreconditionNotMetError` → registry cümleyi olduğu gibi basıyor, generic "failed unexpectedly" yok. İş emrinin istediği "GSC bağlı değil" negatif yolu: **doğru tool'a yönlendiriyor** (`connect_gsc`) |
| N4 **şema dışı anahtar** (#204) | `{"project_id":"4e0caff0-…","dataState":"all"}` | 200, `isError:true` | **defterde satır YOK** | `Invalid input for "pull_gsc_data": ✖ Unrecognized key: "dataState" You were not charged.` — `strict()` en dışta. **Noktalama kusuru:** tek satırlık zod mesajı ile ücret cümlesi arasında ayırıcı yok (N1'de var) → B-7 |
| N5a `days` alt sınır | `days: 6` | 200, `isError:true` | **defterde satır YOK** | `✖ Too small: expected number to be >=7` |
| N5b `days` üst sınır | `days: 91` | 200, `isError:true` | **defterde satır YOK** | `✖ Too big: expected number to be <=90` |
| N5c `days` tam sayı değil | `days: 30.5` | 200, `isError:true` | **defterde satır YOK** | `✖ Invalid input: expected int, received number` |
| N6 arşivlenmiş proje | `77f40d69-…` (dilim1-tek-kullanimlik) | 200, `isError:true` | **−5 / +5 ÇİFTİ** (net 0) | `That project is archived, so it is not being tracked right now. Restore it with setup_project … You were not charged.` — arşiv kapısı bağlantı okumasından ÖNCE (`:273-276`), doğru |

**Defter kanıtı (kritik ayrım, dilim 2'den FARKLI):** bu tool `charge: "surface"` kullanıyor, yani rezerv
handler'dan ÖNCE açılıyor. Sonuç: **şema reddi hiç satır yazmaz** (N1, N4, N5a-c → 5 vaka, 0 satır), ama
**precondition reddi append-only deftere `charge` + `refund` ÇİFTİ yazar** (N2, N3, N6 → 3 vaka, 6 satır,
net 0). `audit_speed` (dilim 2, `charge:"handler"`) negatif yolunda hiç satır bırakmıyordu; ikisi de
doğru, ama **defter okuyan bir insan için aynı şeye benzemiyorlar**. NEVER#2 (append-only) canlıda
doğrulandı: refund satırı charge'ı silmiyor, yanına yazıyor.

**ÖLÇÜLEMEDİ — 403 (izin yok) ve `invalid_grant` (ölü kimlik bilgisi) dalları.** Her ikisi de portföydeki
bir projenin Google tarafındaki iznini bozmayı gerektirirdi; iş emri `track_gsc_property`/`connect_gsc`
yazmayı ve GSC bağlantısını değiştirmeyi YASAKLIYOR. Statik karşılıkları tam ve tipli
(`pull-gsc-data.ts:200-221` 403 · `:370-388` reauth), ve `pull-gsc-data.db.test.ts` bunları gerçek
`@pseo/core` istemcisi + sahte 403 fetch ile sürüyor — ama o şerit `make verify`'da koşmuyor (M4/B-5).

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| H1 varsayılan pencere | `{"project_id":"fa9340e5-…"}` (dentnotion.com) | 200, `isError` yok, **4,53 s** | **−5** (`2026-09-03T09:05:18Z · -5 credits · charge · pull_gsc_data · project: dentnotion.com`) | `Pulled 90 days…` · Current `2026-06-03..2026-08-31`: **15000 rows** · Previous `2026-03-05..2026-06-02`: **15000 rows** · `Note: this window hit the 15,000-row cap — results cover the top rows only; comparisons may be partial.` · `job_id: 6d2fa240-…` |
| H2 alt sınır penceresi | `{"project_id":"fa9340e5-…","days":7}` | 200, `isError` yok, **2,98 s** | **−5** (`…T09:07:07Z · -5 credits · charge · pull_gsc_data · project: dentnotion.com`) | `Pulled 7 days…` · Current `2026-08-25..2026-08-31`: **5678 rows** · Previous `2026-08-18..2026-08-24`: **6059 rows** · **cap cümlesi YOK** (koşullu satır doğru çalışıyor) · `job_id: ea2107ec-…` |

Toplam ücretli: **2 çağrı, −10 kredi**. Her çağrı defterde **tam olarak bir** `charge` satırı bıraktı;
`refund`/`release` yok. `project` alanı **`dentnotion.com`** — proje kapsamı doğru yazılıyor.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim3/d3-gsc/calls.jsonl` (anahtar redakte).

İş emrinin sorularına canlı cevaplar:

- **Hangi tarih aralığı?** `days=90` için current `2026-06-03..2026-08-31`, previous `2026-03-05..2026-06-02`.
  Çağrı günü **2026-09-03**, current bitişi **2026-08-31** — yani tam olarak `GSC_FRESHNESS_LAG_DAYS = 3`
  gün geride. İki pencere eşit uzunlukta ve bitişik (`06-02` → `06-03`). Matematik canlıda birebir tuttu.
- **Kaç satır?** 90 günde **15000 / 15000** — **ikisi de tavanda**. 7 günde 5678 / 6059 (tavanın altında).
  Portföyün en büyük GSC veri setinde varsayılan pencere **tamamen kesilmiş** veri veriyor → B-2.
- **`dataState` ne?** **Hiç gönderilmiyor.** İstek gövdesinin tamamı `{startDate, endDate, dimensions,
  rowLimit, startRow}` (`pull.ts:94-102`). R-7.3'e göre gönderilmeyince Google varsayılanı `final`
  uygular — yani bugünkü davranış DOĞRU, ama **kod bunu hiçbir yerde söylemiyor** → B-1.
- **Preliminary veri uyarısı var mı (R-7.10)?** Doğrudan bir uyarı **yok** — çünkü buna gerek bırakmayan
  bir GUARD var: her iki pencere de 3 gün geriden bitiyor ve `windows.ts:1-23` bunun gerekçesini
  M-20 vakasıyla yazıyor. `mdx:46` maliyeti de açıkça söylüyor ("the newest 3 days are not analyzed").
  **Bu, bu dilimdeki en iyi kapatılmış SEO kuralıdır.**
- **`rowLimit`/`startRow` nasıl kullanılıyor (R-7.2)?** `rowLimit: 15000` (Google tavanı 25.000),
  `startRow: 0` **daima** — sayfalama hiç yok. 15.000 seçimi keyfi değil, **ölçülmüş bir depolama
  bütçesi**: `pull.ts:38-65` dört satır popülasyonunun JSON boyutunu ölçüp (119 B → 360 B) iki
  pencerenin 12 MB `jsonb` bandına sığdığı en yüksek yuvarlak değeri seçiyor. Yani tavanı yükseltmek
  ÇÖZÜM DEĞİL; eksik olan `startRow` ile sayfalama → B-2.
- **İkinci çağrı deterministik mi, yeniden ücret mi?** Yeniden ücret (ikinci −5), **önbellek yok**, ve
  her çağrı YENİ bir `jobs` satırı yazıyor (`job_id` farklı). Türev tool'lar `getLatestSucceededPull`
  ile **en yenisini** okuduğu için H2'den sonra analizler 7 günlük pencereye kaydı — ölçüldü
  (`analyze_content_decay` 10 sayfa → 1 sayfa). "already pulled" benzeri bir not **yok**.

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-7.1 (boyutlar: country, device, page, query, searchAppearance, date, hour) | `dimensions: ["query", "page"]` sabit (`pull.ts:98`), kullanıcıya seçtirilmiyor | **UYUYOR** | İkisi de geçerli boyut. `device` ve `country` hiç çekilmiyor — üç türev tool'un hiçbiri bunlara bakmadığı için bugün karşılıksız bir eksik, uydurma bir boyut adı yok |
| R-7.2 (`rowLimit` 1–25.000, varsayılan 1.000; `startRow` sıfır tabanlı) | `rowLimit: 15000` (`pull.ts:66`), `startRow: 0` **sabit** (`:100`) | **AYKIRI (sayfalama ekseninde)** | Değerler geçerli aralıkta ve varsayılanın 15 katı — bu iyi. Ama R-7.2 `startRow`'u da tanımlıyor ve kod onu **hiç kullanmıyor**: tek sayfa çekiliyor. Canlıda İKİ pencere de doldu → B-2 |
| R-7.3 (`dataState`: `all` / `final` (varsayılan) / `hourly_all`) | İstek gövdesinde **hiç yok** → satıcı varsayılanı `final` miras alınıyor | **EKSİK (uyumlu ama bildirilmemiş)** | Bugünkü sonuç doğru. Ama R-1.8b'nin (dilim 2'de imzalanan) kuralı tam olarak budur: *sonucu sessizce değiştiren bir bayrak açıkça bildirilir, varsayılandan MİRAS ALINMAZ* → B-1 |
| R-7.4 (`type`: discover/googleNews/news/image/video/web, varsayılan `web`) | Gönderilmiyor → varsayılan `web` | **UYUYOR (ama B-1 ile aynı miras)** | `web` bu ürün için doğru seçim; ne çıktı ne docs "yalnız web araması" diyor |
| R-7.5 (filtre operatörleri; page/query için `equals` büyük-küçük harfe duyarlı) | **Hiç `dimensionFilterGroups` gönderilmiyor** | **İLGİSİZ (yapısal olarak)** | Ölçüldü: istek gövdesinin TAMAMI 5 alan. Bu kuralın bu üründeki karşılığı GSC tarafında değil, YEREL gruplamada yaşıyor (`document.ts:33-41` JS `Map` anahtarı) — `detect_cannibalization` kaydına yazıldı |
| R-7.6 (API tüm satırları döndürmeyi garanti etmez) | Yalnız `capped` bayrağı var (`pull.ts:151,156`), o da satır sayısı tavanı DOLDURDUĞUNDA | **EKSİK** | Tavanın ALTINDA kalan bir pencere hiçbir uyarı basmıyor — canlı H2 (5678/6059) tek kelime etmedi. R-7.6 tavandan bağımsız olarak "yalnız üsttekiler" diyor → B-3 |
| R-7.7 (kota: site başına 1.200 QPM, kullanıcı başına 1.200 QPM, proje başına 30M QPD / 40.000 QPM) | Kodda **hiçbir kota rakamı, geri çekilme ya da 429 sınıflandırması yok**; bir çekim 1 token + 2 EŞZAMANLI `searchAnalytics.query` atıyor (`pull.ts:127-130`) | **AYKIRI (dayanıklılık ekseninde)** | Uydurma kota rakamı YOK — bu doğru (kaynak yayımlıyor ama kod gömmemiş, iyi). Ama 429 `apiError` ile düz `Error`'a dönüşüp (`core/gsc/client.ts:284`) registry'nin generic "failed unexpectedly, quote reference X" dalına düşüyor — 403 dalının kaldırmak için yazıldığı davranışın birebir aynısı → B-4 |
| R-7.10 (en yeni veri "preliminary", sonradan değişir) | `GSC_FRESHNESS_LAG_DAYS = 3` (`windows.ts:23`), gerekçesi `windows.ts:1-23`'te M-20 vakasıyla yazılı, maliyeti `mdx:46`'da açıkça | **UYUYOR — bu dilimin en iyi kapatılmış kuralı** | Kaynak yorumu Google'ın "unfinalized günü SIFIR olarak raporladığı" davranışını adıyla anıyor; guard 5 güne kadar gecikmeye karşı ölçülmüş; ve **sınırı da söylüyor** ("a bounded guard, not an absolute one") |
| R-7.12 (Generative AI raporu yalnız impression; `web` search type'ından gelir, 1.000 satır) | Tool AI verisi çekmiyor ve **çektiğini iddia etmiyor** | **UYUYOR** | Yanlış eşleme riski (eski GSC şemasına AI metrikleri bindirmek — "10 değişiklik" #9) burada karşılıksız. Ama R-7.12'nin ikinci yarısı — AI Overview gösterimlerinin ZATEN bu `web` impression'larının içinde olduğu — `find_quick_wins` ve `analyze_content_decay` için bulgu üretti; oradaki kayıtlara yazıldı |
| R-3.19 (Indexing API yalnız JobPosting/VideoObject) | Tool Indexing API'ye **hiç dokunmuyor** | **İLGİSİZ** | Referansın `pull_gsc_data` satırında listelenmiş, ama kodda karşılığı yok: bir gönderim yolu olmadığı için yanlış kullanılamaz. `outward_action_gate.py` `index_update` de ayrıca kapıda |

**Listede olmayan ve uydurulmayan:** GSC verisinin 16 aylık saklama süresi (D-12, DOĞRULANAMADI) ·
`webmasters/v3` ile `searchconsole/v1` uçları arasındaki fark · `aggregationType` semantiği. Hiçbiri
kural gibi sunulmadı.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — `:47` `  pull_gsc_data: "action",`.
`CARDED_TOOLS` (`:62`) yalnız `get_credit_balance` içeriyor → kart **planlı, sevk edilmemiş**.
Canlıda ölçüldü: H1/H2 yanıtları yalnız `result.content[0].text` taşıyor — `structuredContent` YOK,
`_meta` YOK. **Bu okuma bir sonda ile doğrulandı:** aynı oturumda `get_credit_balance`
`structuredContent` **PRESENT** döndürdü, yani "ABSENT" harness körlüğü değil gerçek ölçüm.
`"action"` şeklinin beklediği alanlar (iki pencere aralığı + satır sayıları + `job_id`) çıktıda
yapısal olarak zaten var; kart sevk edilirse **cap uyarısının kartta da görünmesi** şart —
tavanı dolduran bir çekim kartta uyarısız görünürse üç türev tool'un caveat'ı da anlamını kaybeder.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `:72` (`{ tool: "pull_gsc_data", idArg: "project_id",
  targetArg: null }`), senaryolar `:277` (S2 soğuk, GSC bağlantısı yok), `:281` (S1 bağlı),
  `:285` (S6a `days: 7`), `:286` (S6b `days: 90`, yorumu: *"days maximum (= the default, bought once to
  pin the boundary)"*)
- **`goals/` şerhi (hakem, 2026-09-03):** "hedef YOK" iddiası **özde doğru**. Dilim 3'ün beş tool adı `goals/` altında aranınca tek satır çıkıyor — `goals/trial-flow-e2e.md:65`, ve o satır `### 33 → 35 — 2026-08-20, track_keywords + keyword_positions` başlığıdır: **tool sayısı pininin tarihçesi, bir predicate değil.** Bu ailenin hiçbir davranışı bugün bir `goals/` predicate'i tarafından korunmuyor.
- `goals/` hedefi gerekli mi: **EVET.** İki nedenle: (1) M4, üründeki her Google kimlik bilgisini tutan
  tablonun kiracı filtresini `make verify`'ın koştuğu hiçbir testin görmediğini ölçtü — kalıcı hedef,
  "`gsc_accounts` ve `gsc_connections` üzerindeki her service-role okuması `user_id` filtresi taşır"
  olmalı ve `verify.sh`'ın koştuğu bir şeritte (fake-query pini) durmalı; (2) B-2 düzeltildikten sonra
  "tavanı dolduran bir çekim ya sayfalanır ya da satılan analizin kesik olduğu satır düzeyinde
  söylenir" iddiası bir hedefe bağlanmazsa bir sonraki turda yine sessizce geçer.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-03) |
|---|---|---|---|---|---|
| B-1 | **P2** | **`dataState` satıcı varsayılanından MİRAS ALINIYOR ve bu hiçbir yerde yazmıyor.** İstek gövdesi `dataState` taşımıyor (`pull.ts:94-102`), Google varsayılanı `final` uyguluyor (R-7.3) — yani bugünkü sonuç doğru. Ama dilim 2'de İMZALANAN R-1.8b kuralı tam olarak bunu yasaklıyor: *"form faktörü … açıkça bildirilir, satıcı varsayılanından MİRAS ALINMAZ"*, ve aynı gerekçe `dataState` için de geçerli — `all`'a kayan bir varsayılan, `GSC_FRESHNESS_LAG_DAYS`'in savunduğu M-20 hayalet-düşüşünü sessizce geri getirirdi. **Şiddet P2, P1 DEĞİL:** 3 günlük gecikme guard'ı `dataState`'ten BAĞIMSIZ olarak da çalışır (final veri zaten 2–3 gün gecikir), yani tek savunma bu değil | `gsc-data/pull.ts:94-102` istek gövdesinin tamamı; R-7.3; R-1.8b (dilim 2 imzası); `windows.ts:1-23` guard'ın gerekçesi | `dataState: "final"` AÇIKÇA gönderilsin ve istek gövdesini pinleyen mevcut teste (M3'ün kırdığı test) bu alan da eklensin. `days` gibi kullanıcıya açılmasına gerek yok — kural "seçilebilir olsun" değil, "bildirilsin" | **AÇIK — PR'da karşılığı yok.** `dataState` #217 diff'inde **0 eşleşme** (ölçüldü); istek gövdesi hâlâ satıcı varsayılanını miras alıyor |
| B-2 | **P1** | **Portföyün en büyük GSC mülkünde varsayılan çekimin İKİ penceresi de satır tavanını doldurdu, ve sayfalama (`startRow`, R-7.2) hiç uygulanmıyor.** Canlı H1: dentnotion.com, `days=90`, current 15000/15000 ve previous 15000/15000. Bu çekimin üstüne satılan **üç adet 10 kredilik analizin üçü de** kesilmiş veri üzerinde koştu — ve sonuçları ölçüldü: `find_quick_wins` "638 more cleared the bands" dedi, `analyze_content_decay` `17 → 0 clicks` şeklinde bir "hiçbir şey kalmadı" satırı üretti (ki `format.ts:224-229` bunun tam olarak kesik çekimin ürettiği şekil olduğunu kendi yazıyor), `detect_cannibalization` her payı kısaltılmış bir paydaya böldü. `startRow` daima 0 (`pull.ts:100`). **Tavanı 25.000'e çıkarmak ÇÖZÜM DEĞİL:** 15.000 ölçülmüş bir depolama bütçesidir (`pull.ts:38-65`, non-ASCII satırlarla 25.000 = 12,70 MB, 12 MB bandın üstünde) — ve dentnotion Türkçe uzun-kuyruk bir sitedir, yani tam o popülasyon | Canlı H1 çıktısı (her iki pencere 15000); `pull.ts:66` + `:38-65` bütçe ölçümü; `pull.ts:94-102` `startRow: 0`; R-7.2; türev tool'ların canlı çıktıları (§4, ve diğer üç kayıt) | Üç seçenek, sıralı: (1) **`startRow` ile sayfalama** + depolama-farkında bir durma kuralı (aynı 12 MB bandına karşı, satır BOYUTU ölçülerek) — asıl düzeltme budur; (2) tavan dolduğunda çıktının **hangi eksende** kesildiğini söylemesi ("en çok gösterim alan 15.000 (sorgu, sayfa) çifti"); (3) tavan dolduğunda `days`'i düşürmenin daha eksiksiz bir tablo vereceğini söyleyen bir yönlendirme — canlıda ölçüldü, 7 gün tavanın altında kalıyor. (1) gelene kadar (2) ve (3) ucuz | **KAPANDI #217** — `startRow` sayfalama (`PULL_PAGE_ROW_LIMIT = 25000`, `MAX_PULL_PAGES = 4`) + satır BASILMADAN ÖNCE uygulanan `PULL_WINDOW_BYTE_BUDGET = 6_000_000` (`takeWithinBudget`), ve pencere ADIYLA "truncated at N rows" cümlesi; bayt/satır rakamları sondayla yeniden ölçüldü. Hakem 1. turda bunu FAIL etti (kontrol sayfa eklendikten SONRAYDI → 21 MB), 2. turda kapandı. **Kalıntı P2 AÇIK:** 2 × 6 MB tam 12.000.000 B'dir ve JSON zarfı (~200 B) bunun ÜSTÜNE biner. **`include_paths` benzeri bir kalem bu bulguda yok** |
| B-3 | **P2** | **R-7.6 karşılıksız: tavanın ALTINDA kalan bir pencere "eksiksiz" gibi sunuluyor.** `capped` bayrağı yalnız satır sayısı `rowLimit`'e ulaştığında kalkıyor (`pull.ts:151,156`); canlı H2 (5678 / 6059 satır) hiçbir uyarı basmadı. R-7.6 ise tavandan bağımsız olarak *"API tüm satırları döndürmeyi garanti etmez, yalnız üsttekileri döndürür"* diyor. Bir kullanıcı 5.678 satırı sitesinin TÜM (sorgu, sayfa) çiftleri sanabilir | Canlı H2 çıktısı (cap cümlesi yok); `pull.ts:140-157` `capped` türetimi; R-7.6 | `formatPullSummary`'ye koşulsuz bir cümle: dönen satırların Google'ın **seçtiği** üst satırlar olduğu ve düşük gösterimli uzun kuyruğun eksik olabileceği. Ücretsiz, kopya değişikliği. `capped` bayrağı KALSIN — o daha güçlü bir iddiadır ve ayrı kalmalı | **AÇIK — PR'da karşılığı yok.** Caveat hâlâ yalnız `capped` iken basılıyor (`describeTruncation` → `cut === null` ise boş); tavanın ALTINDA kalan pencere için koşulsuz cümle eklenmedi |
| B-4 | **P2** | **Kota aşımı (R-7.7) generic çökme cümlesine düşüyor.** 429 için ne sınıflandırma, ne geri çekilme, ne yeniden deneme var; `apiError` (`core/gsc/client.ts:226,284`) düz bir `Error` üretiyor, `isSearchAnalyticsForbidden` (`pull-gsc-data.ts:202`) yalnız `403` öneki arıyor, `isInvalidGrant` de tutmuyor → registry'nin *"failed unexpectedly … quote reference X"* dalı. Bu, 2026-08-09'da iki canlı projeye saatlerce verilen ve 403 dalının kaldırmak için yazıldığı cümlenin BİREBİR aynısı — sadece başka bir kapıdan. Para güvende (throw → release, ölçülmedi ama tip yolu net) | `core/gsc/client.ts:226-232, :284`; `pull-gsc-data.ts:200-204, :390-396`; R-7.7; dosyanın kendi 2026-08-09 anlatısı `:38-48` | 429 için üçüncü bir tipli refusal: kota aşıldığını ve **ne zaman** yeniden denenebileceğini söyleyen bir cümle (Google `Retry-After` gönderiyorsa okunsun). Eşzamanlı iki sorgunun (`pull.ts:127-130`) site başına 1.200 QPM'e karşı ölçülmesi ayrıca yazılsın — bugün hiçbir yerde yok | **AÇIK — PR'da karşılığı yok.** `429`, `Retry-After` ve kota #217 diff'inde yok (ölçüldü: `Retry-After` 0, `quota` 0 eşleşme) |
| B-5 | **P1** | **`gsc_accounts` VE `gsc_connections` kiracı filtrelerini `make verify`'ın koştuğu HİÇBİR test görmüyor — eksen İKİ KONUMDA da pinsiz.** `.eq("user_id", userId)` `defaultLoadAccountToken`'dan silindiğinde paketin **3914 testinin tamamı yeşil** kaldı ve `tsc --noEmit` de temiz çıktı. **Hakem (2026-09-03) ikinci konumu ölçtü:** aynı filtre `defaultLoadConnection`'dan (`gsc_connections`, `:146-157`) silindiğinde de **3914/3914 yeşil** — ders 14'ün ekseni (aynı kusuru BAŞKA konumda ara) burada bir kez daha karşılığını buldu, yani bulgu tek bir okumanın kazası değil, bu dosyadaki her service-role okumasının ortak hâli. Bu tablo üründeki **her Google refresh token'ını** tutuyor; filtre olmadan bir kiracının `account_id`'si başka bir kiracının mührünü açmaya aday olurdu (şifre çözme `{userId, accountId}` ile bağlı olduğu için ikinci bir savunma var — bu yüzden P0 değil P1 — ama o savunma bu filtrenin YERİNE geçmek üzere yazılmamış). Kaynağın kendi yorumu (`:163-165`) doğru bir şey söylüyor ama **yanlış kapıya işaret ediyor**: yakalayan spec `make verify-db` şeridinde. Ve `service-client-pins.test.ts` — 2026-09-02'de tam bu sınıf için yazılan dosya, başlığında "dokuz kısıt ölçüldü" diyen dosya — `pull-gsc-data.ts`'nin İKİ okuması için de (`gsc_accounts`, `gsc_connections`) pin taşımıyor | M4 (`gsc_accounts`, `:166-172`) ve **M4b** (`gsc_connections`, `:146-157`, hakem): her ikisi de 3914/3914 YEŞİL + `tsc --noEmit` temiz; `test/fake-query.ts:1-11` başlığı; `service-client-pins.test.ts` grep'i (`gsc_connections` yalnız `connect_gsc`/`track_gsc_property` için pinli); CLAUDE.md kapı tablosu "DB şeritleri YOK" | `service-client-pins.test.ts`'e üç pin: `defaultLoadConnection`, `defaultLoadAccountToken` ve `loadGscTokenStatus` (`gsc-data/load.ts:91-118`, aynı delik) — üçü de `statement.calls` üzerinde `eq("user_id", …)` arasın, **satırlar üzerinden DEĞİL** (fake-query'nin kendi kuralı). Ardından `goals/`a kalıcı bir hedef: "GSC tablolarına giden her service-role okuması kiracı filtresi taşır". Kaynaktaki yorumun "mutation-tested" cümlesi de hangi ŞERİTTE olduğunu söyleyecek şekilde düzeltilsin — bugünkü hâli okuru yanlış kapıya gönderiyor | **KAPANDI #217** — `gsc_accounts`, `gsc_connections` ve token-status okumaları için `service-client-pins.test.ts` zincir pinleri (NEVER#4). **AÇIK kalan:** `goals/` hedefi yazılmadı (PR'ın kendi "Ölçülmeyen" bölümü de bunu adıyla yazıyor) |
| B-6 | **P2** | **Var olmayan bir `project_id` append-only deftere kalıcı satır çifti yazıyor.** N2'de uydurma bir uuid (`11111111-2222-4333-8444-555555555555`) gönderildi; rezerv handler'dan önce açıldığı için defter `-5 charge` + `+5 refund` çifti aldı ve `list_credit_activity` bunu ham uuid olarak bastı (`project: 11111111-…`), çünkü çözülecek bir proje yok. Net etki sıfır ve satırlar kiracının kendi defterinde — bu yüzden P2 — ama defter append-only (NEVER#2), yani bu satırlar hiç silinemez ve her yazım hatası defteri kalıcı olarak kirletiyor | §3 N2; `list_credit_activity` canlı çıktısı; `gsc-discovery-shared.ts:136` ve `pull-gsc-data.ts:240` (ikisi de varsayılan `"surface"` kipi) | Bu bir TASARIM sorusudur, tek tool'un değil: `charge:"surface"` kullanan HER tool aynı davranışı gösterir (dilim 3'te dördü de ölçüldü). Ya proje çözümlemesi rezervden önceye alınsın (ama o zaman varlık kâhini riski yeniden değerlendirilmeli — `project-target.ts`'in sıralama kuralı tam bunu engelliyor), ya da davranış BİLİNÇLİ kabul edilip `list_credit_activity` çözülemeyen bir `project_id`'yi "(bilinmeyen proje)" diye bassın. **Ölçülmeden düzeltilmemeli** — mevcut sıralamanın gerekçesi güçlü | **AÇIK — PR'da karşılığı yok.** Kaydın kendi şerhi gereği ölçülmeden düzeltilmemeli; `charge:"surface"` kullanan HER tool'un ortak davranışı, tek tool kalemi değil |
| B-7 | **P2** | **Tek satırlık zod mesajı NOKTA İLE BİTMİYOR; ücret cümlesi arkasına boşlukla ekleniyor.** N4: `✖ Unrecognized key: "dataState" You were not charged.` **İlk yazımda bu "ayırıcısız birleştirme" diye kaydedilmişti; hakem (2026-09-03) o çerçeveyi düzeltti ve fazla geniş buldu:** birleştirme tek yerde yapılıyor (`credits/free-refusal.ts:53-59`, `withNoChargeNote`) ve tek satırlık mesajda boşluk **KASITLIDIR** — kaynak gerekçesini kendi yazıyor (birebir): `A one-line refusal is prose, and a sentence follows a sentence after a space`; çok satırlı mesajda `\n\n` kullanılıyor, ve tam o ayrım Dilim 2'nin `audit_speed` B-6'sını (`→ at project_id You were not charged.`) **#210'da kapattı**. **Bugünkü gerçek kusur birleştiricide değil ÜRETİCİDE:** zod'un tek satırlık mesajı cümle sonu noktalaması taşımıyor (`… "dataState"` + boşluk), bu yüzden doğru kural bile iki cümleyi noktasız bitiştiriyor | §3 N4; `credits/free-refusal.ts:53-59` (ayrım + gerekçe, birebir); dilim 2 `audit_speed` B-6 → #210 (kapandı); dilim 3'ün diğer üç tool'unda birebir aynı şekil (N11, N12, N13) | Düzeltme **zod mesajının kendisinde**: tek satırlık şema reddi nokta ile bitsin (ör. `✖ Unrecognized key: "dataState".`). **`withNoChargeNote`'un boşluk/`\n\n` dalı DEĞİŞMESİN** — onu değiştirmek #210'un kapattığı çok-satır vakasını geri açar; kapanmış bir karar yeniden açılmaz. Dilim 3'ün dört kaydı (bu · `find_quick_wins` B-5 · `detect_cannibalization` B-5 · `analyze_content_decay` B-5) **tek düzeltmeyle** kapanır | **KAPANDI #217** — düzeltme **registry'de**: `terminateOneLine`, tek satırlık zod reddini nokta ile bitirir, ÇOK SATIRLI mesaja DOKUNMAZ; `credits/free-refusal.ts` değişmedi, yani #210'un kararı yeniden açılmadı. Dilim 3'ün dördü (bu · quick_wins B-5 · cannib B-5 · decay B-5) tek düzeltmeyle kapandı |

**Çapraz atıf — H-1 (hakem bulgusu, `keyword_positions` kaydında):** bu kaydın §4'te ölçtüğü
`project: dentnotion.com` etiketi, `charge:"surface"` kipinin ürünüdür — registry proje kimliğini
`withCredits`'e geçiriyor (`registry.ts:623`, `projectId: declaredProjectId(parsed.data)`) ve guard
onu `p_project_id` olarak yazıyor (`guard.ts:124,134`). **`charge:"handler"` ailesinde bu geçiş HİÇ
yapılmıyor** (`keyword-positions.ts:200`, `audit-speed.ts:365`, `ranked-keywords.ts:646`,
`my-pages.ts:897`, `serp-snapshot.ts:242` — hakem 14 çağrı yeri saydı, bu turun kendi sayımı 16),
dolayısıyla `list_credit_activity project_id=…` o aileyi **yapısal olarak eksik** raporluyor. Bu
kaydın "defter kanıtı" bölümlerinde kullanılan proje-kapsamlı okuma yöntemi bu yüzden **yalnız
surface tool'ları için tamdır**; dilim 3'ün dört GSC tool'unun dördü de surface olduğu için bu turun
ölçümleri etkilenmedi. Bulgunun tam metni: `keyword_positions.md` H-1.

### Ölçülemeyenler (ve nedeni)

- **403 (izin yok) ve `invalid_grant` (ölü kimlik) dallarının CANLI kanıtı** — portföydeki bir projenin
  Google tarafındaki iznini bozmayı gerektirirdi; iş emri GSC bağlantısını değiştirmeyi yasaklıyor.
  Statik karşılıkları tam ve tipli, ama onları sürten spec `make verify`'da koşmuyor (B-5).
- **`pull-gsc-data.db.test.ts` ve `gsc-storage.db.test.ts` şeritleri** — Docker gerekiyor, koşulmadı
  (protokol izni). Kiracı-izolasyonu iddialarının TAMAMI bu şeritte yaşıyor (B-5).
- **Kota (429) davranışının canlı kanıtı** — 1.200 QPM'i tetiklemek yüzlerce ücretli çağrı isterdi;
  tavan 2 çağrı.
- **`capped` bayrağının FALSE-NEGATIVE ekseni** — `countSearchAnalyticsRows` ham yanıtı sayıyor
  (`rows.ts:87-89`) ve bu doğru tasarım; ama Google'ın tavanın altında satır kestiği bir vaka
  (R-7.6) canlıda tetiklenemez, çünkü kesip kesmediğini söyleyen bir alan yok.

## Canlı doğrulama eki (şef, 2026-09-03, deploy `bbc259d`, Δ −25, dentnotion)

- `pull_gsc_data`: **Current window 2026-06-03..2026-08-31: 21342 rows · Previous window 2026-03-05..2026-06-02: 29603 rows** — eski 15.000 tavanı aşıldı, sayfalama canlı (B-2 ✔); "truncated" cümlesi basılmadı → bayt bütçesine değmedi (bu mülkte bağlayan sınır yok).
- `analyze_content_decay`: not listenin başında — `Note: the period being compared spans Google's March 2026 spam update (24 Mar), March 2026 core update (27 Mar), May 2026 core update (21 May), June 2026 spam update (24 Jun), August 2026 spam update …` (B-1 ✔); satır `140 → 90 clicks (lost 50, down 35.7%); 71,167 → 33,114 impressions, position 7.6 → 6.7` (B-2 ✔); R-7.11 cümlesi var.
- `detect_cannibalization`: kök URL artık hiçbir satırda "canonicalize or merge" tarafında değil; `Your home page … is left out of that decision` cümlesi basıldı (B-1 kök ekseni ✔). `/doktorlarimiz/` hub sayfası hâlâ fold edilecek taraf — bilinen AÇIK yarı.
- `find_quick_wins`: bu turda canlıda koşulmadı (10 kredi; B-1a/B-4 birim+docs kanıtıyla kapalı).
- Defter: üç satır da `project: dentnotion.com` kapsamlı (H-1 ailesi canlıda ikinci kez ✔).
