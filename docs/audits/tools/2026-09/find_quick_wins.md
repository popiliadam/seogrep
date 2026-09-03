# `find_quick_wins` — tool kontrol kaydı (2026-09 turu)

> Dilim: 3 (GSC) · İşçi: Opus 5 (d3-gsc) · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, toplam Δ −20 kredi** (izin sınırı 2 çağrı / 10 kredi başına — tam sınırda).
> Precondition: `pull_gsc_data` (aynı dilim, ayrı kayıt).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `find-quick-wins.ts:204-208` + ortak iskele `gsc-discovery-shared.ts:122-230`; kredi `costs.ts:103` = `  find_quick_wins: 10,`; docs "**Cost:** 10 credits." — description ↔ mdx ↔ canlı JSON Schema üçü de birebir |
| 2 Mutasyon | ÖLÇÜLDÜ | 3 mutasyon + 1 çapraz: M1 KIRMIZI (6) · M2 KIRMIZI (6) · M3 KIRMIZI (3) · çapraz (fiyat 10→5) KIRMIZI — NEVER#6 pini canlı |
| 3 Canlı negatif | ÖLÇÜLDÜ | 5 senaryonun 5'i doğru reddedildi; net kredi Δ **0** (şema reddi defterde satır bırakmadı, precondition reddi charge+refund çifti bıraktı) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı, **çıktı BAYT BAYT AYNI** (sha256 `b525386991…`, 7271 bayt); her biri **tam olarak bir** `-10 credits · charge · find_quick_wins · project: dentnotion.com` satırı; "already analyzed" benzeri not YOK |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 5 kural tek tek; **R-4.2/R-4.4 karakter-sınırı efsanesi bu ailede HİÇ YOK** (ölçüldü, dilim 2'den sızma olmamış); R-7.11 pozisyon semantiği DOĞRU ama **bildirilmiyor**; R-7.12 üzerinden gerçek bir seçim kusuru bulundu |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:35` `find_quick_wins: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`; canlı `structuredContent` YOK (**kontrol: `get_credit_balance` aynı oturumda PRESENT**) — ama rapor `gsc_discovery_runs`'a YAZILIYOR |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:73` + `:278` + `:282` PLAN girişleri **VAR** · `goals/` içinde `find_quick_wins` geçen hedef **YOK** (grep) |

**Karar (ölçüm turu, 2026-09-03):** DÜZELTME GEREKLİ — motor saf, deterministik ve iyi belgelenmiş; para yolu
5/5 dürüst; ve referansın bu tool için adlandırdığı iki bayatlama riskinden biri (**karakter sınırı efsanesi**)
kodda ve dokümanda **hiç yok** — dilim 2'de kaldırılan metin buraya sızmamış. Ama (a) tool'un kendi
cümlesi bir **CTR** iddiasıdır ("convert existing demand into clicks") ve seçim CTR'a HİÇ bakmıyor; canlıda
en tepedeki tavsiye **24.864 gösterime karşı 28 tıklama** (CTR %0,1) olan bir satır çıktı — R-7.12'nin
söylediği gibi AI Overview gösterimleri bu `web` sayılarının İÇİNDE olduğundan bu şekil "neredeyse
kazanılmış" değil "SERP tıklamayı alıyor" olabilir; (b) başlıktaki sayfa sayısı **kesilmiş kısa listenin**
sayfa sayısıdır, kalan satır sayısıysa kesilmemiş toplamdan — iki farklı birim, biri kapalı biri açık.

**Karar (kapanış, <YYYY-MM-DD>):** — düzeltme dalgası bittiğinde KAPATAN tur yazar; ölçüm turunun kararı SİLİNMEZ, yanına yazılır (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/find-quick-wins.ts:204-206` (`makeFindQuickWinsTool`), üretim örneği
  `findQuickWinsTool` `:208`. Gerçek `defineTool` ortak iskelede:
  `apps/mcp/src/tools/gsc-discovery-shared.ts:132-229` (`makeDiscoveryTool`)
- Kayıt: `apps/mcp/src/tools/index.ts:11` (import), `:79` (export), `:178` (araç dizisi)
- Motor: `apps/mcp/src/gsc-data/quick-wins.ts` (`findQuickWinsResult` `:65`), belge katlama
  `apps/mcp/src/gsc-data/document.ts` (`collapseFragmentsAcrossQueries` `:108`), rapor şekli
  `apps/mcp/src/gsc-data/runs.ts:63-71` (`QuickWinsReport`)
- Zod şeması (`gsc-discovery-shared.ts:118-120`) — canlı JSON Schema ile birebir:
  - `project_id`: `z.uuid()`, **tek alan, zorunlu**
    (`.describe("The project to analyze (must have run pull_gsc_data first).")`)
  - Canlı şema `"additionalProperties": false` (registry `schema.strict()`, #204) — §3 N4'te ölçüldü
  - **`days`, `limit`, eşik, filtre için HİÇBİR alan yok** — her şey saklanan çekimden ve sabitlerden gelir
- Description (birebir alıntı, `find-quick-wins.ts:19-22` — canlı `tools/list` ile birebir aynı):
  > Find quick-win keyword opportunities from your latest Search Console pull: queries ranking in positions 8–20 with enough impressions to be worth a push, prioritized. Costs 10 credits. Run pull_gsc_data first.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:103`, birebir): `  find_quick_wins: 10,`
- Ücretlendirme kipi: **varsayılan `"surface"`** — rezerv → handler → RETURN'de commit / THROW'da release.
  `gsc-discovery-shared.ts:31-38` para kuralını yazıyor: *"'no pull to analyze' must THROW, not return an
  error result — otherwise the caller would be charged for being told to run pull_gsc_data first. A pull
  that exists but yields zero findings is a delivered analysis and DOES commit."*
- Docs sayfası (`apps/web/content/docs/tools-reference/find-quick-wins.mdx:6`, birebir):
  > **Cost:** 10 credits.

  ve `mdx:12` (birebir):
  > From the pull's current window, it selects queries where your page ranks in **positions 8–20** with **at least 20 impressions**, then prioritizes them by impressions (biggest opportunity first, ties broken by the better position). Already-winning queries (position under 8) and near-zero-demand long-tail queries are left out, so the list stays a focused shortlist rather than a dump.
- **Sabit eşikler, kaynak satırıyla:**

  | sabit | değer | kaynak |
  |---|---|---|
  | `QUICK_WIN_MIN_POSITION` | **8** | `gsc-data/quick-wins.ts:30` |
  | `QUICK_WIN_MAX_POSITION` | **20** | `gsc-data/quick-wins.ts:32` |
  | `QUICK_WIN_MIN_IMPRESSIONS` | **20** | `gsc-data/quick-wins.ts:34` |
  | `MAX_QUICK_WINS` (kısa liste tavanı) | **50** | `gsc-data/quick-wins.ts:36` |
  | `MAX_QUERIES_PER_PAGE` (sayfa başına basılan sorgu) | **5** | `tools/find-quick-wins.ts:34` |
  | `MAX_QUICK_WIN_PAGES` (basılan sayfa) | **12** | `tools/find-quick-wins.ts:35` |
  | `PAGE_ONE_LAST_POSITION` (tavsiye bandı eşiği) | **10** | `tools/find-quick-wins.ts:97` |

  Seçim yordamı `isQuickWin` (`quick-wins.ts:41-47`) tam olarak üç koşul: `position >= 8`,
  `position <= 20`, `impressions >= 20`. **`ctr` ve `clicks` seçime HİÇ girmiyor** — ikisi de yalnız
  basılıyor (`find-quick-wins.ts:137-141`).
- **İş emrinin sorduğu "uydurma karakter sınırı" kontrolü — ÖLÇÜLDÜ, YOK:**
  `grep -rniE "60 char|155 char|160 char|characters|meta description|title tag"` →
  `apps/mcp/src/gsc-data/` + `apps/mcp/src/tools/find-quick-wins.ts` + dilimin dört `.mdx`'i üzerinde
  **tek bir eşleşme yok** (yalnız `brand.ts`'de marka jetonu uzunluğu için "characters" geçiyor, alakasız).
  Tavsiye cümlelerinin tamamı iki kalıptan ibaret (`find-quick-wins.ts:119-130`) ve ikisi de bant
  hakkında, uzunluk hakkında değil. **Dilim 2'de kaldırılan metin buraya sızmamış.**
- Tutarsızlıklar: **yok — ne karşılaştırıldı:** `DESCRIPTION` ↔ mdx frontmatter ↔ canlı `tools/list`
  (üçü birebir); `mdx:12`'nin "positions 8–20"/"at least 20 impressions" cümlesi ↔ `quick-wins.ts:30-34`
  sabitleri ↔ canlı çıktının `(position 8–20 with demand)` başlığı (üçü tutuyor); `costs.ts` 10 ↔ mdx
  "**Cost:** 10 credits." ↔ ölçülen defter satırı `-10`; `mdx:38`'in "**15,000**" rakamı ↔ `MAX_ROW_LIMIT`.
- Seçilebilirlik: "quick win'lerim ne", "hangi kelimeler az kaldı", "kolay kazanç", "2. sayfadaki
  kelimelerim" cümlelerinde seçilir. **Karışma riski olan komşular:** (1) `whats_next` — kullanıcı "ne
  yapmalıyım" derse; o ücretsiz bir yönlendirici, bu 10 kredilik bir analiz. (2) `keyword_positions` /
  `ranked_keywords` — ikisi de "pozisyon" kelimesini taşıyor ama DFS/SERP tarafından okuyor; bu tool
  yalnız KENDİ GSC verinizi okur ve dışarıdan hiçbir şey görmez. Description "from your latest Search
  Console pull" diyerek ayrımı kuruyor. (3) `my_pages` — o da GSC + sayfa ekseninde, ama DFS ile
  birleştiriyor. **Asimetri:** üçü de proje alır ama yalnız bu üçlü SAKLANAN çekimi okur; model
  `pull_gsc_data`'yı atlarsa 10 kredilik değil ÜCRETSİZ bir precondition reddi alır (ölçüldü, §3).

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `pnpm --filter @pseo/mcp exec vitest run src/gsc-data src/tools/find-quick-wins.test.ts
src/tools/gsc-discovery-shared.test.ts src/tools/gsc-discovery-runs.test.ts` → **taban 314 passed / 16 files**.
Çapraz mutasyon için `src/credits` → **taban 152 passed / 9 files**.
`gsc-discovery-runs.db.test.ts` ve `gsc-discovery.db.test.ts` Docker ister — **db şeritleri koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `gsc-data/quick-wins.ts:30` `QUICK_WIN_MIN_POSITION = 8` → `4` (iş emrinin sorduğu "pozisyon 4–20?" hipotezi) | bandın alt kenarını gören testler | **KIRMIZI** (6 test / 3 dosya) | Bandın **alt** kenarı üç katmanda birden pinli: motor, tool render'ı, ve boş-liste cümlesi (`"no query is ranking in positions 8–20"`, `find-quick-wins.ts:166`). İş emrinin hipotezi yanlıştı — kodda 4 değil 8; ve 8 gerçekten pinli |
| M2 | `gsc-data/quick-wins.ts:34` `QUICK_WIN_MIN_IMPRESSIONS = 20` → `0` (talep tabanını kaldır) | gösterim tabanını gören testler | **KIRMIZI** (6 test / 3 dosya) | Taban pinli. Bu eşik `format.ts:50-58`'in "mutlak eşik 7 günde 90 günden ~13× daha sıkıdır" cümlesinin de konusu — sayı bir yerde değişirse footer cümlesi de yalan olurdu |
| M3 | `tools/find-quick-wins.ts:97` `PAGE_ONE_LAST_POSITION = 10` → `20` (her tavsiye "top 5" der) | tavsiye bandını gören testler | **KIRMIZI** (3 test / 2 dosya) | Tavsiye METNİ de pinli, yalnız seçim değil. Bu iyi: canlıda ölçülen iki kalıbın ("into the top 10" / "into the top 5") ayrımı testin gördüğü bir şey |
| Çapraz | `credits/costs.ts:103` `find_quick_wins: 10` → `5` (NEVER#6: fiyat insan onayı olmadan değişmez) | fiyat pini | **KIRMIZI** (1 test) | `costs.test.ts:24-26` `TOOL_COSTS pin (NEVER #6 human-approval gate)` → `expect(TOOL_COSTS).toEqual({…})`. **Dilim 2'nin `audit_speed` B-5'i (ücret ANAHTARI pinsiz) ile karıştırılmamalı:** fiyat RAKAMI pinli, ücretin hangi tool ADINA yazıldığı ayrı bir eksen. Bu ailede o eksen `charge:"surface"` olduğu için registry'nin kendi `name` alanından geliyor (`gsc-discovery-shared.ts:133`), yani `audit_speed`'in deliği burada YAPISAL OLARAK yok — tool adı tek bir yerden akıyor |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). **Bu tool'da yeşil kalan mutasyon YOK.**
Çalışma ağacı sonunda temiz: `git diff --stat` → **boş çıktı**.
Geri alma sonrası regresyon: 27 dosya / **498 passed**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt: repo dışı `…/scratchpad/dilim3/d3-gsc/calls.jsonl`.
Kredi Δ **bakiye farkından değil**, `list_credit_activity`'nin `project_id` kapsamlı okumasından
(paylaşılan kiracı — bkz. `pull_gsc_data` kaydı §3'teki yöntem uyarısı).

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N7 **çekim yapılmamış + GSC bağlı olmayan proje** (seogrep.com) | `4e0caff0-…` | 200, `isError:true` | **−10 / +10 ÇİFTİ** (net 0) | `No Search Console data found for this project. Run pull_gsc_data first. You were not charged.` — **precondition mesajı DOĞRU TOOL'a mı yönlendiriyor? KISMEN HAYIR** → B-4 |
| N10 bilinmeyen uuid | `11111111-2222-4333-8444-555555555555` | 200, `isError:true` | **−10 / +10 ÇİFTİ** (net 0) | N7 ile **birebir aynı cümle** — `load.ts:40-47` bunu kasten yapıyor (varlık kâhini yok). Bu doğru tasarım |
| N11 **şema dışı anahtar** (#204) | `{"project_id":"4e0caff0-…","days":30}` | 200, `isError:true` | **defterde satır YOK** | `Invalid input for "find_quick_wins": ✖ Unrecognized key: "days" You were not charged.` — `strict()` en dışta ve rezervden ÖNCE. Model'in `days` göndermeye kalkması gerçekçi bir senaryo (kardeş tool `pull_gsc_data` onu ALIYOR); reddediliyor ve **neden alınmadığı söylenmiyor** |
| N15 zorunlu alan eksik | `{}` | 200, `isError:true` | **defterde satır YOK** | `✖ Invalid input: expected string, received undefined\n  → at project_id\n\nYou were not charged.` |
| N-arşiv (ailede `analyze_content_decay` ile ölçüldü, ortak iskele) | `77f40d69-…` | 200, `isError:true` | **−10 / +10 ÇİFTİ** | Arşiv kapısı `gsc-discovery-shared.ts:157-160`'ta ve ÜÇ tool için de tek yerde; çekim okumasından ÖNCE |

**Defter kanıtı:** N11 ve N15 (şema reddi) **hiçbir satır yazmadı**; N7, N10 ve arşiv (precondition
reddi) `charge` + `refund` çifti yazdı, net 0. `list_credit_activity` `project_id: fa9340e5-…`
kapsamıyla okunduğunda **8 satırın 8'i de `charge`, hiç `refund` yok** — yani mutlu yolda hiçbir
şey iade edilmedi ve negatif yoldaki hiçbir çift dentnotion'a yazılmadı. NEVER#2 canlıda doğrulandı.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| H2 birinci çağrı | `{"project_id":"fa9340e5-…"}` (dentnotion.com, 90 günlük çekim üstünde) | 200, `isError` yok, **1,37 s** | **−10** (`2026-09-03T09:05:31Z · -10 credits · charge · find_quick_wins · project: dentnotion.com`) | `15 pages with quick-win queries (position 8–20 with demand), best first:` · 12 sayfa basıldı, `…and 3 more pages with quick wins.` · **`…and 638 more cleared the bands.`** · footer 3 satır (pencere + cap uyarısı + provenance) |
| H5 ikinci çağrı, aynı çekim | aynı | 200, `isError` yok, **~1,3 s** | **−10** (`…T09:06:56Z · -10 credits · charge · find_quick_wins · project: dentnotion.com`) | **BAYT BAYT AYNI**: 7271 bayt, sha256 `b525386991d185ab…` her ikisinde de. `diff` boş |

Toplam ücretli: **2 çağrı, −20 kredi** (tavan: 2 çağrı / 20 kredi). Her çağrı defterde **tam olarak bir**
`charge` satırı bıraktı; `refund` yok.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim3/d3-gsc/calls.jsonl` (anahtar redakte).

İş emrinin sorularına canlı cevaplar:

- **Eşikler kodda sabit mi?** **Evet, yedi sabitin yedisi de** (tabloya bkz. §1). Kullanıcıya açılan
  hiçbir eşik yok; şema tek alan taşıyor. Bantlar çıktının BAŞLIĞINDA basılıyor
  (`(position 8–20 with demand)`), yani müşteri neye baktığını görüyor.
- **CTR eşiği var mı?** **HAYIR.** `isQuickWin` (`quick-wins.ts:41-47`) yalnız pozisyon ve gösterim
  okuyor. CTR **basılıyor** ama seçime girmiyor → B-1.
- **R-7.11 ile uyumlu mu?** **Evet, ve iyi.** Bant bir `(query, page)` SATIRININ ortalama pozisyonuna
  uygulanıyor — R-7.11'in ikinci yarısı ("tabloda ilgili URL/boyut satırının ortalama pozisyonu"),
  doğru olan. Parça katlaması (`#fragment`) pozisyonu **GÖSTERİM-AĞIRLIKLI ORTALAMA** ile birleştiriyor
  (`document.ts:84-87`) ve yorumu neden ("Google's own position is already an impression-weighted
  average over appearances") yazıyor — alternatif olan "en iyi satırı al" seçeneğini gerekçesiyle
  reddetmiş. **Ama çıktı bunun bir ORTALAMA olduğunu hiç söylemiyor** → B-2.
- **Tavsiye cümleleri uydurma karakter sınırı içeriyor mu (dilim 2'de kaldırılmıştı)?** **HAYIR —
  ölçüldü, tek eşleşme bile yok** (grep, §1). Canlıda basılan iki kalıbın tamamı:
  `→ Push "<sorgu>" (position X, N impressions) into the top 5|10 — it is this page's only quick-win
  query, so tighten the page around that phrase.` ve `… — one on-page pass serves all N of this
  page's quick-win queries, so widen it to cover them rather than chasing the one.` **BAYAT DEĞİL.**
- **İkinci çağrı deterministik mi, yeniden ücret mi, "already analyzed" notu var mı?**
  **Deterministik — bayt bayt aynı** (sha256 karşılaştırması yapıldı, 7271/7271). **Yeniden ücret
  alındı** (ikinci −10). **"already analyzed" benzeri bir not YOK** ve önbellek yok; motor saklanan
  çekim üzerinde saf bir fonksiyon. Fiyat başına aynı cevabı iki kez satmak bir ürün kararıdır —
  ama en azından `gsc_discovery_runs`'a **ikinci bir satır** yazılıyor (`gsc-discovery-shared.ts:197`),
  yani panel iki koşuyu ayrı görüyor.

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-4.1 (title link tamamen otomatik; kaynaklar `<title>`, h1, og:title, anchor text, `WebSite` schema) | Tool title/h1/og hakkında **hiçbir şey söylemiyor**; tavsiyeleri "sayfayı bu ifadeye daralt / bu sorguları kapsayacak şekilde genişlet" | **UYUYOR (yapısal olarak)** | Riskin gerçekleşmesi için tool'un bir title tavsiyesi vermesi gerekirdi; vermiyor. Google'ın title'ı kendi ürettiği gerçeğine aykırı hiçbir cümle yok |
| R-4.2 / R-4.4 (`<title>` ve meta description için Google'ın YAYIMLADIĞI karakter sınırı YOKTUR) | **Kodda ve dört mdx'te tek bir karakter-sınırı cümlesi yok** (grep, §1) | **UYUYOR** | Referansın `audit_onpage` satırında "**Karakter sınırı efsanesi**" diye adlandırdığı ve dilim 2'de kaldırılan metnin bu aileye **sızmadığı** ölçüldü. İş emrinin "hâlâ varsa BAYAT" sorusunun cevabı: **yok** |
| R-7.5 (filtre operatörleri; `equals` büyük-küçük harfe duyarlı) | Tool GSC'ye hiç istek atmıyor; okuduğu çekim de `dimensionFilterGroups` göndermiyor (`pull.ts:94-102`) | **İLGİSİZ (yapısal olarak)** | Bu kuralın bu ürün içindeki yerel karşılığı (`Map` anahtarının büyük-küçük harfe duyarlılığı) `detect_cannibalization` kaydına yazıldı; burada gruplama sorgu+belge ekseninde ve aynı semantiği miras alıyor |
| R-7.10 (en yeni veri preliminary) | Doğrudan bir cümle yok; guard `pull_gsc_data`'dan MİRAS (`GSC_FRESHNESS_LAG_DAYS = 3`), ve `mdx:40` bunu açıkça devrediyor: *"Both windows also end **3 days before today** rather than running up to it, so the newest days are not analyzed yet."* | **UYUYOR** | Mirasın açıkça yazılması doğru tasarım — üç türev tool da aynı cümleyi taşıyor ve `pull_gsc_data`'ya link veriyor |
| R-7.11 ("Position" = grafikte en üstteki sonucun ortalaması; tabloda ilgili satırın ortalaması) | Bant `(query, page)` satırının ortalama pozisyonuna uygulanıyor; katlamada gösterim-ağırlıklı ortalama (`document.ts:84-87`) | **UYUYOR (semantik) · EKSİK (bildirim)** | Referansın bu tool için adlandırdığı risk — *"'Pozisyon' tanımı ile eşik mantığının uyuşmaması"* — **semantik olarak gerçekleşmemiş**: doğru tanım kullanılıyor ve katlama gerekçeli. Ama sayfa bloğu başına 6+ kez "position" yazılıyor ve hiçbiri bunun bir PENCERE ORTALAMASI olduğunu söylemiyor → B-2 |
| R-7.12 (Generative AI raporu yalnız impression; verisi Performance'ın `web` type'ından gelir) | Tool AI verisi çekmiyor; ama okuduğu `web` impression'ları **AI Overview gösterimlerini de içeriyor** | **AYKIRI (dolaylı, ama ölçüldü)** | Bu kuralın ikinci yarısı bu tool'u bağlıyor: AI Overview'ın çıktığı bir sorguda gösterim yüksek, tıklama sıfıra yakın olur. Canlıda tam bu şekil çıktı ve tool ona "en büyük fırsat" dedi → B-1 |

**Listede olmayan ve uydurulmayan:** pozisyona göre BEKLENEN CTR eğrisi (8. sırada %X olmalı gibi) bu
referans listesinde **YOKTUR**; B-1 bu yüzden "CTR eşiği koyun" diye bir SEO kuralı olarak değil,
**tool'un kendi cümlesi ile kendi filtresi arasındaki tutarsızlık** olarak ve R-7.12'ye dayandırılarak
yazıldı. Bir eşik önerilirse kaynağı bu doküman olmayacaktır.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — `:35` `  find_quick_wins: "report",`.
`CARDED_TOOLS` (`:62`) yalnız `get_credit_balance` içeriyor → kart **planlı, sevk edilmemiş**.
Canlıda ölçüldü: H2/H5 yanıtları yalnız `result.content[0].text` taşıyor — `structuredContent` YOK,
`_meta` YOK. **Sonda ile doğrulandı:** aynı oturumda `get_credit_balance` `structuredContent`
**PRESENT** döndürdü, yani ABSENT okuması gerçek.

**Ama bu tool'un yapısal yarısı zaten üretiliyor ve SAKLANIYOR:** `QuickWinsReport`
(`runs.ts:63-71`) — `window` (iki aralık + satır sayısı + `capped`), `total` (kap ÖNCESİ sayı),
`top` (en yüksek gösterimli win), `wins` (kısa liste). `gsc-discovery-shared.ts:197` bunu her
çağrıda `gsc_discovery_runs`'a yazıyor. Yani kart sevk edildiğinde `"report"` şeklinin isteyeceği
her alan **hazır**; eksik olan tek şey `structuredContent` olarak DIŞARI verilmesi. `runs.ts:48-56`
`total` ve `top`'un neden ayrıca kopyalandığını (PostgREST jsonb içinde sayamaz/ilk öğeyi alamaz)
gerekçesiyle yazmış — kart tarafı düşünülmüş.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `:73` (`{ tool: "find_quick_wins",
  idArg: "project_id", targetArg: null }`), senaryolar `:278` (S2, GSC bağlantısı yok → soğuk yol)
  ve `:282` (S1, bağlı proje)
- `goals/` hedefi gerekli mi: **EVET.** İki nedenle: (1) B-1 düzeltilirse (CTR ekseni seçime ya da
  metne girerse) o iddia bir hedefe bağlanmazsa bir sonraki turda sessizce geri alınabilir;
  (2) daha önemlisi, **karakter-sınırı efsanesinin YOKLUĞU bugün hiçbir kapı tarafından korunmuyor** —
  dilim 2'de bu metin bir kez üretilip kaldırıldı, ve onu bu aileye geri sokacak bir düzeltme
  hiçbir testi kırmaz. `goals/`a "GSC ailesinin tavsiye metinlerinde title/description karakter
  sınırı geçmez" gibi bir grep-hedefi, R-4.2/R-4.4'ü kapıya taşıyan en ucuz yoldur

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, <YYYY-MM-DD>) |
|---|---|---|---|---|---|
| B-1 | **P1** | **Tool'un kendi cümlesi bir CTR iddiasıdır, seçimi ise CTR'a HİÇ bakmaz.** Motor yorumu (`quick-wins.ts:5-8`) *"a small on-page push can convert impressions into clicks"* diyor; `isQuickWin` (`:41-47`) yalnız `position` ve `impressions` okuyor, `ctr` ve `clicks` seçime hiç girmiyor — yalnız BASILIYOR. Canlıda bunun sonucu: en tepedeki tavsiye `https://dentnotion.com/20lik-dis-agrisina-ne-iyi-gelir/` — **24.864 gösterim, 28 tıklama, CTR %0,1, pozisyon 10,6**; ikinci sayfada 17.160 gösterime karşı 9 tıklama. Aynı listede pozisyon 8,4'te CTR %0,3 ve pozisyon 8,3'te CTR %0,5 satırları da var, yani **aynı bantta beş kat fark** ölçüldü ve tool ikisini de aynı sesle "fırsat" diye sıralıyor — üstelik gösterime göre sıraladığı için CTR'ı en DÜŞÜK olanı en başa koyuyor. R-7.12: Generative AI raporunun verisi Performance'ın `web` type'ından gelir, yani **AI Overview gösterimleri bu sayıların içindedir**; 8–11. sırada %0,1 CTR "neredeyse kazanılmış" değil "SERP tıklamayı almış" olabilir ve o iki durum aynı tavsiyeyi almamalı. **Şiddet P1: yanlış sayı değil, yanlış SIRALAMA** — müşteri 10 kredi ödeyip en üstteki üç satıra bakarsa en az dönüşecek işi en önce yapar | Canlı H2 çıktısı (üç sayfanın CTR'ları: %0,1 · %0,0 · %0,5); `quick-wins.ts:5-8` motor yorumu vs `:41-47` filtre; `find-quick-wins.ts:137-141` CTR'ın basıldığı satır; R-7.12 | İki seçenek, ikisi de **eşik ÖNERMEDEN**: (1) sıralamaya CTR ekseni katılsın (ör. aynı gösterim bandında CTR düşük olan **önce değil sonra** gelsin, ya da ikinci bir "CTR yüksek, pozisyon yakın" grubu ayrılsın); (2) daha ucuzu — tavsiye cümlesi CTR'ı OKUSUN: bandın çok altında bir CTR'da "önce SERP'e bak (AI Overview / öne çıkan snippet / reklam), sonra sayfaya" densin. **Bir CTR EŞİĞİ referansta YOKTUR** (§5 şerhi); eşik konacaksa kaynağı ayrıca ölçülmeli ve pinlenmeli |  |
| B-2 | **P2** | **"position" bir PENCERE ORTALAMASIDIR ve çıktı bunu hiç söylemiyor.** Sayfa bloğu başına altıdan fazla kez "position X.Y" basılıyor (`find-quick-wins.ts:134-141`) ve tavsiye bandı (`PAGE_ONE_LAST_POSITION = 10`) bu ortalamaya bir SIRA gibi uygulanıyor. Canlıda ölçülen `position 10.6` bir 90 GÜNLÜK ortalamadır: yarı zaman 5., yarı zaman 16. olan bir sayfa da aynı sayıyı verir, ve ona "top 10'a çıkar" demek işin yarısını zaten yapılmış saymaktır. R-7.11 tanımı doğru KULLANILMIŞ (§5) — eksik olan tek şey bunun okura söylenmesi. Footer pencere uzunluğunu yazıyor ama ortalamayı yazmıyor | Canlı H2: `position 10.6` / `best position 9.0` satırları; `find-quick-wins.ts:97` + `:119-130` bandın ortalamaya uygulanışı; `document.ts:84-87` ağırlıklı ortalama; R-7.11 | Başlık cümlesine bir yan cümle: pozisyonların analiz edilen pencerenin ORTALAMASI olduğu, tek bir günün sırası olmadığı. Ücretsiz, kopya değişikliği; footer'daki pencere satırının hemen yanına oturur |  |
| B-3 | **P2** | **Başlıktaki sayfa sayısı KESİLMİŞ listeden, kalan sayı ise KESİLMEMİŞ toplamdan — iki farklı birim.** Canlı: `15 pages with quick-win queries` … `…and 3 more pages with quick wins.` … `…and 638 more cleared the bands.` Buradaki **15**, 50'lik kısa listenin (`MAX_QUICK_WINS`) içindeki sayfa sayısıdır; **638** ise 688 uygun SATIRIN kesilen kısmıdır. Yani okur "sitemde 15 sayfada quick win var" diye anlar, gerçek sayfa sayısı bilinmiyor ve kesinlikle daha büyük. Üç sayı üç farklı şeyi sayıyor (kısa listedeki sayfa · basılmayan sayfa · basılmayan satır) ve yalnız sonuncusu birimini söylüyor | Canlı H2 çıktısının ilk ve son satırları; `find-quick-wins.ts:164-182` (`groups` kısa listeden türetiliyor, `total` ise `findQuickWinsResult`'ın kap ÖNCESİ sayısı, `quick-wins.ts:69`) | Başlık cümlesi hangi kümeyi saydığını söylesin ("en yüksek talepli 50 fırsatın dağıldığı 15 sayfa"), ya da sayfa sayısı da kap ÖNCESİ küme üzerinden hesaplansın (motorun `qualifying` dizisi zaten elde — `quick-wins.ts:66-69`). İkincisi daha dürüst ve maliyeti bir `Set` |  |
| B-4 | **P2** | **GSC'ye HİÇ bağlanmamış bir projede precondition mesajı yanlış tool'a yönlendiriyor.** N7: seogrep.com'un Search Console bağlantısı yok (canlı `list_projects`: *"Search Console: not connected"*), ama tool `Run pull_gsc_data first.` diyor. Kullanıcı öyle yapınca `pull_gsc_data` `Run connect_gsc first.` diyor — iki adımlı bir çıkmaz, ve ikisi de kullanıcının kendi panelinde ZATEN görünen bir gerçeği (bağlı değil) söylemiyor. `load.ts:40-47` mesajın tekliğini varlık-kâhini gerekçesiyle savunuyor ve **bilinmeyen/başka kiracının projesi için bu doğru** — ama KENDİ projesinin bağlı olmadığı bilgisi zaten `list_projects`'te basılıyor, yani o vakada gizlenecek bir şey yok | §3 N7 vs `pull_gsc_data` §3 N3 (iki farklı cümle, aynı proje); canlı `list_projects` çıktısı; `gsc-data/load.ts:35-36` `NO_PULL_MESSAGE`, `:40-47` gerekçe | Çekim yoksa bağlantı durumu bir kez okunsun (`loadGscTokenStatus` ile aynı yol, `load.ts:91`): bağlantı **yoksa** cümle `connect_gsc`'ye, **varsa** `pull_gsc_data`'ya yönlendirsin. Varlık kâhini korunur: her iki cümle de yalnız KENDİ kiracısının projesi çözüldüğünde ayrışır; çözülemeyen id bugünkü tek cümleyi almaya devam eder |  |
| B-5 | **P2** | **`days` gibi kardeş tool'un ALDIĞI bir anahtar sessizce reddediliyor.** N11: `{"project_id":…,"days":30}` → `✖ Unrecognized key: "days"`. `pull_gsc_data` `days`'i alır, bu tool almaz ve **neden almadığı hiçbir yerde yazmaz** — analiz penceresi ÇEKİM zamanında belirlenmiştir. Bir model (ya da insan) "son 30 günün quick win'lerini bul" isteğini doğal olarak buraya `days` ile taşır. Ayrıca aynı satırda B-7 noktalama kusuru var (`"days" You were not charged.`, ayırıcı yok) | §3 N11 canlı çıktısı; `gsc-discovery-shared.ts:118-120` tek alanlı şema; `pull-gsc-data.ts:65-71` `days` alanı | Description'a ya da mdx'e bir cümle: pencere uzunluğunun `pull_gsc_data` çağrısında seçildiği ve bu analizin **saklanan** çekimin penceresini kullandığı. Şema değişmesin — `strict()` doğru davranıyor; eksik olan cevabın YÖNLENDİRİCİ olmaması. Noktalama yarısı `pull_gsc_data` B-7 ile birlikte kapanır |  |

### Ölçülemeyenler (ve nedeni)

- **`gsc_discovery_runs` satırının GERÇEKTEN yazıldığının canlı kanıtı** — yazma yolu var
  (`gsc-discovery-shared.ts:197`) ve `load.jobId` yoksa fail-closed (`:192-195`), ama satırı okuyacak
  bir tool yüzeyde yok; doğrulama DB erişimi isterdi (iş emri dışı).
- **`gsc-discovery-runs.db.test.ts` / `gsc-discovery.db.test.ts` şeritleri** — Docker gerekiyor,
  koşulmadı (protokol izni).
- **Kesilmemiş bir çekim üzerinde davranış** — dentnotion'ın 90 günlük çekiminde iki pencere de
  15.000 satır tavanını doldurdu (`pull_gsc_data` B-2), yani ÖLÇÜLEN mutlu yolun tamamı kesilmiş
  veri üstünde koştu. 7 günlük çekim tavanın altındaydı ama bu tool ona karşı çağrılmadı
  (kredi tavanı: 2 çağrı, ikisi de determinizm eksenine harcandı).
- **Pozisyona göre beklenen CTR** — referans listesinde böyle bir kural **YOK** (§5 şerhi), bu yüzden
  B-1 bir eşik önermiyor.
