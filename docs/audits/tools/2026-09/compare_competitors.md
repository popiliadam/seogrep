# `compare_competitors` — tool kontrol kaydı (2026-09 turu)

> Dilim: 5 · İşçi: Opus 5 · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler + zod + `compare_competitors: 90` + docs tutarlı; **`competitors` ZORUNLU DEĞİL — keşif akışı var** (iş emrinin varsayımı yanlış çıktı) |
| 2 Mutasyon | ÖLÇÜLDÜ | 5/5 KIRMIZI (fiyat 2 · kapsam pini 2 · MAX_COMPETITORS 9 · DK-3 2 · lokal ifşası 3) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 7 senaryo, 7 ücretsiz ret, defterde 0 satır (606 → 606) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 1 ücretli çağrı (90); **`.com.tr` özne en/2840 varsayılanında ölçüldü: 3 organic SERP** — uyarı basılmadı |
| 5 SEO güncelliği | ÖLÇÜLDÜ | **R-6.9 AYKIRI** (karşılaştırma penceresi TARİHSİZ; takvim ağaçta var, bu tool okumuyor) · **R-9.1 AYKIRI** |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:38` → `"report"`; `CARDED_TOOLS`'ta DEĞİL; `structuredContent` yok |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | kayıt ✔ · `plan.mjs:318` **PLAN'da (K3/S1)** — ve o hücre tam da C-1'in ölçtüğü varsayılanı satın alıyor · `goals/` gerekmiyor |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — kredi yolu, kiracı filtresi, ölçüm-kaynağı
ayrımı ve rakam dürüstlüğü bu ağacın en sağlam yazılmış yüzeylerinden biri (ölçüm kaynağını satır
satır adlandırıyor, iki farklı vendor ölçümünü birbirinden çıkarmayı REDDEDİYOR). İki eksende
düzeltme gerekiyor: **90 kredilik çağrı bir ccTLD öznesini sessizce ABD/İngilizce ölçüyor** (Dilim 4
sınıf 4'ün ölçülmemiş beşinci üyesi) ve **hareket sayaçlarının penceresi tarihsiz**, dolayısıyla
referansın adlandırdığı core-update ilişkilendirmesi yapısal olarak mümkün değil.

**Hakem kararı (taze Fable, 2026-09-04): PASS.** M-CC4 (2 KIRMIZI) ve M-CC5 (3 KIRMIZI) bağımsız
yeniden üretildi, ve **C-5'in şef iş-emri defektini doğru işlediği** teyit edildi (aşağıda Ş-2).
Kayıt bu turda genişletildi: şiddet bandı uygulandı (C-2 P1→P2, C-3 P2→P1), C-5'e kapanış şartı ve
şefin kendi kaydı eklendi (H-7 / Ş-2), ve DK-3'ün ölçülmüş şekil haritası (H-2) §2'ye girdi.
Ölçüm turunun metni SİLİNMEDİ.

**Karar (kapanış, YYYY-MM-DD):** düzeltme dalgası bittiğinde KAPATAN tur yazar — ölçüm turunun
kararı SİLİNMEZ, yanına yazılır (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/compare-competitors.ts:555` (`makeCompareCompetitorsTool`), port
  `apps/mcp/src/dfs/competitors.ts:722` (`createLiveCompetitorsClient`). İki uç:
  `/v3/dataforseo_labs/google/competitors_domain/live` ve
  `/v3/dataforseo_labs/google/domain_rank_overview/live` (`dfs/competitors.ts:52-55`).
- Zod şeması (alanlar, kısıtlar): `target` (targetField) · `project_id` (uuid) · `competitors`
  (`z.array(z.string().min(1)).min(1).max(MAX_COMPETITORS=3)` **`.optional()`**) · `limit`
  (int 1–1000, default 10) · `language_code` (`min(2)`, default `"en"`) · `location_code`
  (pozitif int, default `2840`). `additionalProperties:false` (canlı C-N3 ile doğrulandı).
- **İŞ EMRİNİN VARSAYIMI YANLIŞ ÇIKTI (ders 13).** İş emri "rakip listesi ZORUNLU (z.array min 1,
  keşif yok — ölçüldü)" diyordu. Ölçüm: canlı `tools/list` yanıtında bu tool'un şemasında
  **`required` dizisi hiç yok**; `competitors` `.optional()` (`tools/compare-competitors.ts:80`) ve
  omit edildiğinde **keşif akışı** koşuyor (`dfs/competitors.ts:776` `discovering`,
  `COMPETITORS_DISCOVERY_MAX_LIMIT`, `DEFAULT_COMPETITORS_DISCOVERY_LIMIT=10`). `min(1)` yalnız
  **verilen** listenin boş olamayacağını söyler. Ölçüm bu turda **verilen-rakip (supplied) akışında**
  yapıldı; keşif akışı ücretli tavan yüzünden koşulmadı (§4).
- Description (birebir alıntı):
  > "Compare a domain with its competitors on Google organic search — organic SERP counts, all twelve position bands (#1 to #100), estimated monthly organic traffic, the paid-equivalent traffic cost, and whether each domain is gaining or losing rankings, side by side. Ends with a target-vs-competitor difference section: each rival's organic SERP count, estimated traffic and paid-equivalent cost against the target's, with the gap between them stated. NAME the competitors you care about (up to 3) for a useful comparison; automatic discovery only works well for domains with a broad keyword footprint. Pass a target domain (any public domain) or a project_id to compare one of your own sites. Synchronous — returns a table immediately. Costs 90 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing."

  **Özel kontrol (iş emri): description keşfi "kullanıcıdan istediğini" söylüyor mu?** EVET, ve
  büyük harfle: `"NAME the competitors you care about (up to 3) for a useful comparison; automatic
  discovery only works well for domains with a broad keyword footprint."` Bu **seçilebilirlik
  açısından doğru kurulmuş** — "rakiplerim kim?" cümlesinde tool seçilirse keşif akışı gerçekten
  vardır, yani yanlış seçim değildir; ve şema açıklaması küçük/niş sitede `youtube.com`,
  `wikipedia.org` dönebileceğini adıyla uyarıyor (`tools/compare-competitors.ts:82-87`). Bulgu YOK.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:62`, birebir): `compare_competitors: 90,`
- Docs sayfası (`apps/web/content/docs/tools-reference/compare-competitors.mdx` — ÜRETİLİYOR):
  - satır 6 birebir: `**Cost:** 90 credits.`
  - satır 63 birebir: `| `location_code` | integer | No | DataForSEO location code (default 2840 = United States). |`
  - satır 73 birebir: `How many times one comparison reads DataForSEO depends on which mode you used. Letting DataForSEO **discover** the rivals normally takes a **single** request — that one response already carries every listed domain's own metrics — while **naming** the competitors yourself takes one rank-overview request per compared domain, because a rival you chose is not part of any discovery result.`
  - satır 75 birebir: `You pay the same either way: it is a **flat price**, charged **once**, as a single tool call. If any of those requests fails, the whole call fails and **you are not charged** — a partial comparison is never billed.`
- **Fiyat aritmetiği — ÖLÇÜLDÜ (iş emri sorusu: 90 sabit mi, rakip başına mı).** **Sabit.** Kredi
  fiyatı 90, vendor istek sayısından bağımsız: keşif akışı normalde 1 istek, verilen-rakip akışı
  `MAX_COMPARED_DOMAINS = MAX_COMPETITORS + 1 = 4`'e kadar istek (`dfs/competitors.ts:59`). Canlı
  C-P1 (1 rakip → 2 rank-overview isteği) defterde **−90** yazdı. Docs satır 75 bunu doğru anlatıyor.
- Bütçe sabitleri: `DFS_LABS_REQUEST_USD=0.012`, `DFS_LABS_ROW_USD=0.00012`,
  `BUDGET_SAFETY_FACTOR=1.5`; `ESTIMATED_COMPETITOR_COMPARISON_CALL_USD = estimateDiscoveryUsd(1000)
  + ESTIMATED_RANK_OVERVIEW_REQUEST_USD` (`dfs/competitors.ts:105-106`) — yani üst sınır **keşif
  akışının vendor satır tavanı** için hesaplanmış.
- Tutarsızlıklar: **yok** — description'daki 90, `costs.ts:62` ve docs satır 6 üçü de aynı;
  `MAX_COMPETITORS`/`COMPETITORS_DISCOVERY_MAX_LIMIT`/`DEFAULT_COMPETITORS_DISCOVERY_LIMIT` şemaya
  port'tan import edilerek giriyor, canlı şemadaki `maxItems: 3` ve `default: 10` bunu doğruluyor.
- Seçilebilirlik: "rakiplerimle karşılaştır", "rakiplerim kim" cümlelerinde seçilir. Karışabileceği
  komşular: `keyword_gap`/`link_gap` (aynı soru, TEK rakip ve tek eksen, 45 kredi),
  `ranked_keywords` (tek domainin kendi sıralamaları — bu tool'un çıktısıyla **farklı vendor
  ölçümü**, ve tool bunu §4'te görülen footer'da adıyla söylüyor).

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Taban: **160 dosya / 4130 test, 0 fail**
(`…/scratchpad/dilim5/logs/baseline.log`).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M-CC1 | `costs.ts:62` `compare_competitors: 90` → `89` | fiyat pini | **KIRMIZI** (2) | `costs.test.ts > matches the approved v0 literals exactly` + `compare-competitors.test.ts > advertises its name, the 90-credit cost…` · `logs/m-cc1.log` |
| M-CC2 | `compare-competitors.ts:592` ücret meta'sından `projectId` düşürüldü | sınıf 2 kapsam süpürgesi | **KIRMIZI** (2) | `rankings-project-scope.pin.test.ts > 'compare_competitors' records which project its spend was for (H-1)` + `handler-charge-scope-coverage.pin.test.ts > names a project at every call site that has one to name` · `logs/m-cc2.log` |
| M-CC3 | `dfs/competitors.ts:58` `MAX_COMPETITORS = 3` → `4` | rakip tavanı + fiyat/istek aritmetiği | **KIRMIZI** (9) | En geniş kapsama: şema (`maxItems`), `selectDiscoveredCompetitors`, `estimateComparisonUsd`, fark bölümü kesilme notu, keşif tek-istek pini, mock port, varsayılan limit karşılaştırması · `logs/m-cc3.log` |
| M-CC4 | **DK-3 onarımı UYGULANDI:** `dfs/competitors.ts:789-859` iki akış `try/catch`'e alındı, catch `settleFailedSpend(reservation, ledger)` çağırıyor | rezervasyon davranışını pinleyen test | **KIRMIZI** (2) | `dfs/competitors.test.ts > propagates a failure of the TARGET FALLBACK, keeping the paid discovery on the books` + `> propagates a MID-FAN-OUT failure on the SUPPLIED flow, which still fans out` · `logs/m-cc4.log`. **Bu iki test AÇIK KALAN rezervasyonu KASTEN pinliyor** — bkz. C-3 |
| M-CC5 | `compare-competitors.ts:444` başlıktaki `(language …, location …)` ifşası boşaltıldı | lokal ifşa pini | **KIRMIZI** (3) | `compare-competitors.test.ts > echoes the language and location the numbers were read for` + iki başlık testi · `logs/m-cc5.log` |

**5/5 KIRMIZI — yeşil kalan mutasyon yok.** Fiyat, kiracı/proje kapsamı, rakip tavanı, bütçe
rezervasyonunun akıbeti ve lokal İFŞASI gerçekten ölçülüyor.

**Hakem şerhi — M-CC2 hangi sınıfı ölçtü (hakem turu, 2026-09-04):** M-CC2 "sınıf 2 kapsam
süpürgesi" diye doğru etiketlenmiş; kardeş kayıtların aynı mutasyona "Sınıf 1 / NEVER#4" demesi
YANLIŞTIR. **NEVER#4'ün gerçek kiracı okuması** `tools/project-target.ts:48`'dir
(`forUser(getServiceClient(), userId).selectOwnById`) ve **o zincirin hızlı-şerit pini altı kayıtta
da ÖLÇÜLMEDİ** — canlı 404 kanıtı var (§3, C-N4), pin kanıtı yok.

**Hakem eki — DK-3'ün ÖLÇÜLMÜŞ şekil haritası (H-2, hakem turu, 2026-09-04).** Şef gözlemi Ş-3 bu
sınıfın ÜÇ şekli olduğunu söylüyordu; hakem altı portu da ölçtü ve şekil **İKİ**. **Bu tool,
haritanın en sıkı pinli ucudur: iddia iki testte ve `actualUsd` ekseninde.**

| port | rezervasyonu pinleyen iddia | onarım uygulanınca |
|---|---|---|
| **`dfs/competitors.ts:780` (bu tool)** | **`actualUsd toBeNull` ×2** | **KIRMIZI (2) — H05** |
| `dfs/backlinks.ts:408` | `actualUsd toBeNull` ×1 (`backlinks.test.ts:380`) | KIRMIZI (1) |
| `dfs/link-gap.ts:322` | hiçbir şey | YEŞİL |
| `dfs/backlink-details.ts:583` | yalnız `todaySpendUsd` (`:768`) | YEŞİL |
| `dfs/backlink-changes.ts:489` | yalnız `todaySpendUsd` (`:644`) | YEŞİL |
| `dfs/disavow-candidates.ts:849` | yalnız `todaySpendUsd` (`:1284`, `:1318`) | YEŞİL |

**Tek PR notu:** düzeltme altı porta birlikte girer — `try` isteği VE ayrıştırmayı kapsar (`finally`
DEĞİL), `catch` → `settleFailedSpend` → yeniden fırlat; ve **HER portta** "satır kapandı,
`actualUsd === estimatedUsd`, rows 0" iddiası bulunur. **Bu tool ile `analyze_backlinks`'te iddia
TAŞINIR** ("leaves OPEN" → "SETTLES at estimate"; günün toplamı değişmez —
`budget.db.test.ts:131`), **kalan dört portta EKLENİR.** Sırası önemlidir: iddiayı taşımadan
gönderilen bir onarım kapıyı kırmızıya düşürür ve "onarım yanlış" diye okunur (C-3'ün uyarısı). **Ölçülen boşluk bir eksik pin değil,
eksik bir DAVRANIŞTIR:** lokal ifşa ediliyor ve pinli, ama ccTLD **uyarısı** hiç yok (C-1), ve
pinlenen rezervasyon davranışı sızdıran olanı (C-3).

Çalışma ağacı sonunda temiz — `git status --short` ve `git diff --stat` çıktısı: **(boş)**.
Geri alma sonrası kapı yeniden **160 passed (160) / 4130 passed (4130)**, EXIT=0 (`logs/restore.log`).

`*.db.test.ts` şeridi (`compare-competitors.db.test.ts`) Docker ister — **KOŞULMADI, db şeridi CI/hakem**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Defter her turdan önce ve sonra okundu.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| C-N1 `competitors` boş dizi | `competitors: []` | 200 / `isError:true` | **0** | `Too small: expected array to have >=1 items → at competitors` — zod, reserve'e ulaşmıyor |
| C-N2 dört rakip (MAX 3) | `competitors:["a.com","b.com","c.com","d.com"]` | 200 / `isError:true` | **0** | `Too big: expected array to have <=3 items → at competitors` |
| C-N3 bilinmeyen alan | `depth:50` eklendi | 200 / `isError:true` | **0** | `Unrecognized key: "depth"` → `additionalProperties:false` doğrulandı |
| C-N4 uydurma project_id | `project_id:"9f1c2d3e-…"` (geçerli uuid, yabancı) | 200 / `isError:true` | **0** | `No project found with id …` — başkasının projesi ile hiç olmayan proje aynı cevabı veriyor (kiracı sızıntısı yok) |
| C-N5 rakip listesi yalnız kendi domaini | `competitors:["adstark.com.tr"]`, proje aynı domain | 200 / `isError:true` | **0** | `The "competitors" list contains no domain to compare against — it must name at least one domain other than the target. Omit it to let DataForSEO pick competitors for you.` — normalizer RESOLVED target'a karşı çalışıyor, **ve ret cümlesi keşif akışını adıyla öneriyor** |
| C-N6 listede geçersiz domain | `["sempeak.com","!! gecersiz !!"]` | 200 / `isError:true` | **0** | `"!! gecersiz !!" is not a valid domain or URL. You were not charged.` — ilk geçersiz domain tüm çağrıyı reddediyor (kısmi karşılaştırma satılmıyor) |
| C-N7 hem `target` hem `project_id` | ikisi birden | 200 / `isError:true` | **0** | `Pass "project_id" or "target", not both — they can name different domains and SeoGrep will not guess which one you meant.` |

**Defter kanıtı:** negatiflerden ÖNCE `606 entries`, tüm negatiflerden SONRA hâlâ `606 entries`
(`list_credit_activity`). Yedi ücretsiz retten **hiçbiri** defterde satır açmadı; charge+refund
çifti de yok (T-B11 sınıfı görülmedi).

## 4. Canlı mutlu yol

Rakip: **sempeak.com** (Dilim 4'te ölçümle seçildi; `keyword_gap.md` §4 gerekçesi devralındı).
**Ücretli tavan gereği tek çağrı** — verilen-rakip (supplied) akışı seçildi, çünkü sınıf 4 eksenini
ölçen akış budur ve keşif akışı aynı varsayılanları paylaşır.

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| C-P1 supplied akış, varsayılan lokal | adstark `project_id` + `competitors:["sempeak.com"]`, `language_code`/`location_code` **verilmedi** | 200 / ok | **−90** `project: adstark.com.tr` | Başlık: `Competitor comparison for your project "adstark.com.tr" (language en, location 2840) — the target against 1 competitor you supplied:` |

Ölçülen içerik:
- **Hangi metrikler basılıyor (iş emri sorusu):** domain başına altı satır — `Organic SERPs
  containing the domain` · 12 pozisyon bandı iki satırda (#1-20, #21-100) · `Estimated monthly
  organic traffic (ETV)` · `Estimated monthly cost of the same traffic as paid ads` · hareket
  sayaçları. Ardından **Target vs each competitor** farkı üç ölçüde.
- **Ölçülen rakamlar (birebir):** `adstark.com.tr` → SERP **3**, hepsi #21-30 bandında, ETV **0**,
  paid-equivalent **$0**; `sempeak.com` → SERP **8** (#2-3'te 1, #11-20'de 1, kalanı #21-60), ETV
  **36**, paid-equivalent **$0**. Fark bölümü: `+5`, `+36`, `no difference`.
- **SINIF 4 — 90 KREDİLİK ÖLÇÜM ABD/İNGİLİZCE PENCEREDE YAPILDI VE UYARI BASILMADI.** Özne
  `.com.tr`, `twoLetterTld("adstark.com.tr")` → `"tr"` (yerel doğrulandı), çağrı her iki varsayılanda
  (`en` / `2840`), yani `onDefaultLocale` **true** — `defaultLocaleWarning` bağlansa **fire ederdi**.
  Bağlı değil: `grep -rn "locale-default|defaultLocaleWarning|twoLetterTld" apps/mcp/src` bu tool'un
  hiçbir dosyasını döndürmüyor (yalnız `keyword-gap.ts`, `my-pages.ts`, `discover-keywords.ts`,
  `ranked-keywords.ts`). **Ölçülen zarar:** aynı iki domain aynı turda `keyword_gap` tarafından
  `tr`/`2792`'de ölçüldüğünde **121 kesişen anahtar kelime** bulunmuştu (`keyword_gap.md` §4);
  burada ABD penceresinde toplam **3 ve 8 organic SERP** çıktı. Rakamlar vendor'ın kendi rakamları
  ve YANLIŞ değil — **yanlış olan pencere**, ve sayfada yanlış görünmüyor (`locale-default.ts`'in
  modül başlığının birebir uyardığı şey).
- **Lokal İFŞA EDİLİYOR:** başlık `(language en, location 2840)` diyor ve bu üç testle pinli (M-CC5).
  Yani bu bir gizleme değil, **uyarı eksikliğidir**; ayrım C-1'in şiddet gerekçesinde.
- **Hareket penceresi TARİHSİZ (birebir):**
  `  - Since DataForSEO's previous check — newly ranking: 2 · moved up: 1 · moved down: 0 · no longer found: 1`
  "previous check" ne zamandı — çıktının hiçbir yerinde yok, şemada bir tarih alanı yok, port böyle
  bir alan okumuyor. → C-2.
- **Vendor rakamı olduğu SÖYLENİYOR (sınıf 3/8 — UYUYOR).** Her whole-domain başlığı ölçümü
  adlandırıyor: `Across the whole domain — every keyword it ranks for, from DataForSEO's
  domain-overview data:`; tahminler "Estimated" diye etiketli; ve footer (birebir):
  `Note: whole-domain totals name the DataForSEO data they were read from. DataForSEO measures these separately, so a different total in another SeoGrep tool is a second measurement, not a contradiction.`
  Ayrıca fark bölümü **iki farklı vendor ölçümünü birbirinden çıkarmayı REDDEDİYOR**
  (`renderDifferenceBlock`, `tools/compare-competitors.ts:362-388`) ve null'ı 0 gibi çıkarmıyor
  (`:327-336`). Bu, Dilim 4 sınıf 8'in ("basılan ≠ sınanan") **karşılıksız kaldığı** bir yüzey:
  fark aritmetiği kasten BASILAN (yuvarlanmış) değerler üzerinde yapılıyor ve gerekçesi kaynakta
  yazılı (`:323-325`). **Bulgu YOK — ölçüldü ve doğru.**
- **DFS "daily cap" reddi görülmedi.**

**Defter (birebir):**
`2026-09-03T21:54:48 · -90 credits · charge · compare_competitors · project: adstark.com.tr`
Tek satır, `project: <domain>` kapsamı taşıyor (Dilim 3 H-1 ailesi **UYUYOR**). Refund yok.
İki rank-overview vendor isteği tek kredi satırına düştü — `dfs_spend` tarafı ayrı defter
(sınıf 9, ertelenmiş).

**Sınıf 9 (`dfs_spend` tahmin/gerçek) — ŞEF ÖLÇÜMÜ (Ş-1, hakem turu, 2026-09-04): artık ÖLÇÜLDÜ.**
Şef prod `public.dfs_spend`'i Supabase MCP ile okudu (`spend_day = 2026-09-03` UTC, son iki saat =
Dilim 5 çağrıları). Bu tool'un ucu:

| uç | n | tahmin | gerçek | oran |
|---|---|---|---|---|
| `dataforseo_labs/google/domain_rank_overview/live` | 1 | 0,0364 | 0,0242 | **1,5×** |

`BUDGET_SAFETY_FACTOR = 1.5` bu uçta **tam olarak** gerçekleşen orandır. Not: n=1, yani şefin
tablosunda C-P1'in İKİ rank-overview isteği tek satır olarak toplanmış görünüyor — tool bazında
istek-başı maliyet **ayrıştırılmadı**. **BİLGİ kalemidir; NEVER#6'ya dokunmaz.** Dilim 5 geneli:
gerçek ≈ $0,47 ↔ tahmin ≈ $0,95, yani günlük $3 vendor tavanı TAHMİNLE sayıldığı için gerçekte
yarı yarıya harcanıyor.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/ed07ad51-99ee-4158-ba60-03e288098193/scratchpad/dilim5/canli/raw.jsonl` (anahtar `makeRedactor` ile redakte).

**ÖLÇÜLEMEDİ:** keşif (discovery) akışı — ikinci bir 90 kredilik çağrı gerektirirdi ve iş emrinin
tavanı "≤1 ücretli; ikincisi YALNIZ ilki vendor/bütçe reddi aldıysa" diyor; ilk çağrı reddedilmedi.
Keşfin `youtube.com`/`wikipedia.org` riski (description'ın kendi uyarısı) bu turda **sınanmadı**.

## 5. SEO güncelliği

Referans "Tool eşleme" satırı: `compare_competitors | R-6.9, R-9.1 | Core update tarihlerinin karşılaştırma penceresine yansıtılmaması`.
**Risk KARŞILIĞINI BULDU ve adlandırdığından daha derin çıktı** (aşağıda).

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-6.9 (Google'ın yayımladığı core update geçmişi: Mart 2026 core 27 Mar, Mayıs 2026 core 21 May, …) | Tool bir "gaining or losing rankings" ekseni satıyor (description birebir) ve `is_new`/`is_up`/`is_down`/`is_lost` sayaçlarını basıyor. `grep -rniE "core update\|spam update\|algorithm"` bu tool'un iki kaynak dosyasında **0 eşleşme**; takvim ağaçta VERİ olarak duruyor (`gsc-data/google-updates.ts`, 17 güncelleme, `GOOGLE_UPDATES_VERIFIED_ON="2026-09-02"`) ve `renderUpdateOverlap` tüm ağaçta **yalnız** `analyze-content-decay.ts:45` tarafından okunuyor | **AYKIRI** | **Referansın tarif ettiğinden bir adım daha kötü ve bu ölçüldü:** ortada takvimin üzerine düşürüleceği bir PENCERE yok — hareket sayaçları `"Since DataForSEO's previous check"` diyor ve o kontrolün tarihi ne çıktıda ne şemada ne port'ta var. Yani `renderUpdateOverlap(start, end)` bugün bu tool'dan **çağrılamaz**: iki argümanı da yok. Düzeltme sırası bu yüzden tersten: önce pencere tarihlenmeli, sonra takvim bağlanmalı → C-2 |
| R-9.1 (**ccTLD güçlü bir coğrafi hedefleme sinyalidir**; `.tr` bu sınıftadır) | Tool `location_code`'u alıyor, varsayılanı 2840 (ABD) ve başlıkta ifşa ediyor. Öznenin ccTLD'si ile seçilen lokasyon arasında **hiçbir ilişki kurulmuyor**: `.com.tr` bir özne 2840'ta ölçüldü ve tek kelime uyarı çıkmadı (canlı C-P1) | **AYKIRI** | Kural, ccTLD'nin bir coğrafi hedefleme SİNYALİ olduğunu söylüyor; ürün o sinyali elinde tutuyor (`twoLetterTld` ağaçta, `format/locale-default.ts`) ve bu 90 kredilik yüzeyde kullanmıyor. `ranked_keywords`'ün "the same 65 credits, twice, to discover a parameter the tool never mentioned" dersi (locale-default.ts modül başlığı) burada 90 kredide tekrarlandı → C-1 |

Diğer R-x.y satırları `compare_competitors`'ı adlandırmıyor. `D-x` kalemleri kural değildir, işlenmedi.
**Referans satırına şerh önerisi YOK** — Dilim 4'ün iki satırının aksine (my_pages↔R-7.x,
keyword_gap↔R-8.8) bu satırın adlandırdığı iki risk de **karşılığını buldu**; satır doğru.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:38` → `compare_competitors: "report"`. Eşleme **VAR**.
`CARDED_TOOLS` (satır 62) bugün yalnız `get_credit_balance` içeriyor, `compare_competitors` **DEĞİL**.
Canlı payload'da `structuredContent` **YOK** (yanıt yalnız `content[].text`). Dilim 4 sınıf 7'nin
**DÖRDÜNCÜ tekrarı** (kart dilimine ertelenmiş).
Canlı payload bir `report` kartının isteyeceği yapıyı taşıyor: domain başına başlık + etiketli metrik
blokları + ayrı bir fark bölümü + kaynak-ölçüm dipnotu — yani zaten rapor biçiminde, ama metin olarak.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — satır 318 (birebir):
  `{ layer: "K3", scenario: "S1", tool: "compare_competitors", sites: K3_DEFAULT, needs: ["projectId"], args: (c) => ({ project_id: c.projectId }) },`
  ayrıca satır 83'te `idArg`/`targetArg` listesinde. **Ölçülen not (bulgu değil, kapsam uyarısı):**
  bu hücre `project_id` dışında argüman geçmiyor, yani **C-1'in ölçtüğü en/2840 varsayılanını satın
  alıyor** — `K3_DEFAULT` siteleri arasında `.com.tr` özneler var. Kardeş tool'lar (`discover_keywords`,
  `my_pages`) tam da bu gerekçeyle EXCLUDED'a alınmış (`plan.mjs:133-142`: "a sweep on the default
  would measure the default rather than the tool"), `compare_competitors` alınmamış. C-1 kapanırsa
  hücre anlamlı olur; kapanmazsa aynı gerekçe buraya da yazılmalı → C-4.
- `goals/` hedefi gerekli mi: **HAYIR** — tool ücretli (90) ve kullanıcı-tetiklemeli; kalıcı bir
  canlı-uç hedefi her koşuda 90 kredi yakardı. Mutasyon kapsaması 5/5 zaten paket kapısında.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, YYYY-MM-DD) |
|---|---|---|---|---|---|
| C-1 | **P1** | **Sınıf 4'ün ölçülmemiş BEŞİNCİ üyesi, ve sınıfın en pahalı yüzeyi (90 kredi).** `.com.tr` bir özne, çağıran açıkça geçersiz kılmazsa ABD/İngilizce ölçülüyor ve `defaultLocaleWarning` bu tool'a hiç bağlanmamış. Dilim 4 sınıf 4 "dört üye" diye kapandı (#223); bu tool o sayıma **hiç girmemişti** — kapsam uyarısı ("dilim 5/6 tool'larını kapsayıp kapsamadığı ölçülmedi") tam olarak burada karşılığını buldu | Canlı C-P1: `project_id`=adstark (`.com.tr`), lokal verilmedi → başlık `(language en, location 2840)`, sonuç **3 organic SERP**; aynı domain çifti `tr`/`2792`'de 121 kesişen kelime vermişti (`keyword_gap.md` §4). `twoLetterTld("adstark.com.tr")` → `"tr"`, `onDefaultLocale` true → uyarı fire ederdi. `grep -rn "locale-default\|defaultLocaleWarning\|twoLetterTld" apps/mcp/src` → bu tool'un hiçbir dosyası yok | **Varsayılanı DEĞİŞTİRME** (`format/locale-default.ts` modül başlığı: fiyat+davranış kararı, insan imzası ister). Mevcut paylaşılan uyarıyı bağla — `keyword_gap`/`my_pages`/`discover_keywords` için #223'te yapılanın aynısı, dördüncü bir kopya değil aynı sabit. Bağlanacak yer `formatCompetitorComparison`'ın başlık bloğu; `target` olarak **RESOLVED** domain geçilir (`comparison.target`), çünkü proje-kapsamlı çağrıda çağıran domaini hiç yazmamıştır — locale-default.ts'in kendi kuralı. **Şiddet gerekçesi:** hakem bandında (H-1) çıplak açıklama boşluğu P2'dir, ama burada lokal ZATEN ifşa ediliyor (M-CC5 pinli) — eksik olan açıklama değil, **ölçülmüş zarar**: `my_pages` A-2 ile aynı şekil (2×40 kredi), burada tek çağrıda 90 kredi. **Şiddet (H-1, hakem turu, 2026-09-04): P1 KALIR** — işçinin gerekçesi kabul edildi; kalem Dilim 4 sınıf 4'ün **beşinci üyesidir** ve ölçülmüş bir kredi zararı taşıyan tek üyedir (90 kredi, tek çağrı) | |
| C-2 | ~~P1~~ **P2** (hakem turu, 2026-09-04) | **Tool bir "kazanıyor mu kaybediyor mu" ekseni satıyor ama o eksenin PENCERESİ tarihsiz — dolayısıyla R-6.9 yapısal olarak uygulanamıyor.** `is_new`/`is_up`/`is_down`/`is_lost` "Since DataForSEO's previous check" diye basılıyor; o kontrolün ne zaman olduğu çıktıda, şemada ve port'ta yok. Google'ın güncelleme takvimi ağaçta VERİ olarak duruyor ve bu tool onu okumuyor | Canlı C-P1 hareket satırı (birebir §4'te); `grep -rniE "core update\|spam update\|algorithm"` `tools/compare-competitors.ts` + `dfs/competitors.ts` → **0 eşleşme**; `renderUpdateOverlap` tüm ağaçta yalnız `analyze-content-decay.ts:45`'te; `google-updates.ts:46-64` 17 güncelleme, `GOOGLE_UPDATES_VERIFIED_ON="2026-09-02"` | İki adım, sırası önemli: (1) **pencereyi tarihle** — vendor yanıtında bir "previous check" tarihi varsa okunup basılsın; yoksa cümle bunu söylesin ("DataForSEO does not report when its previous check was"), çünkü tarihsiz bir hareket sayacından tarihli bir sonuç çıkarmak uydurmadır (NEVER #7/#9). (2) Tarih varsa `renderUpdateOverlap(previousCheck, today)` bağlanabilir — `analyze_content_decay` B-1'in aynısı, aynı sabitten, **kopya cümle yazılmadan**. Adım (1) olmadan (2) imkânsız; bu yüzden referansın "takvime yansıtılmaması" tarifi burada eksik teşhis. **Şiddet gerekçesi:** ölçülmüş iddia sorunu — ürün, kaynağını adlandıramadığı bir zaman aralığı üzerinden yön (`moved up`/`moved down`) satıyor. **Şiddet bandı (H-1, hakem turu, 2026-09-04): P1 → P2 — işçinin gerekçesi kısmen REDDEDİLDİ.** Ürün satıcı atfını DOĞRU yapıyor (`"Since DataForSEO's previous check"` — sayacın kimin olduğu yazılı, uydurulmuş bir yön yok); eksik olan tek şey **TARİH**, yani bu bir çıplak açıklama boşluğudur (bare disclosure). Aynı sınıfın kardeşi `analyze_backlinks` AB-4 (tarih damgası yok) zaten P2 ve iki kalem tek bandı taşır | |
| C-3 | ~~P2~~ **P1** (hakem turu, 2026-09-04) | **DK-3 (NEVER #5): port hatasında rezervasyon açık kalıyor — ve burada bu davranış İKİ TESTLE KASTEN PİNLİ.** `reserveSpend` 1 / `settleSpend` 1 / catch-settle **0**. Dilim 4'ün `settleFailedSpend` onarımı uygulandığında iki test KIRMIZI oluyor: testler `actualUsd`'nin `null` kalmasını ve günün toplamının tam tahmini taşımasını iddia ediyor | `dfs/competitors.ts:780` (reserve) ↔ `:863` (settle); mutasyon M-CC4 → 2 KIRMIZI (`logs/m-cc4.log`). Test gövdesi `competitors.test.ts:808-812`: `expect(await todaySpendUsd(ledger)).toBeCloseTo(OPEN_DISCOVERY_RESERVATION, 5)` + `expect(ledger.rows()[0]?.actualUsd).toBeNull(); // still open` | **Bu, DK-3 sınıfının tek-tip olmadığının kanıtıdır ve düzeltme dalgası bunu bilmeden giremez.** Kardeşi `link_gap`'te aynı mutasyon YEŞİL kalıyor (o kaydın B-3'ü): orada hiçbir test yok, burada davranış pinli. **Ölçülen çözüm:** testlerin dayandığı güvenlik özelliği (günün toplamı tahmini korur, düşmez) `settleFailedSpend` ile **korunuyor** — `budget.ts:211-217` rezervasyonu `reservation.estimatedUsd` ile kapatıyor, satır sayısı 0; `budget.db.test.ts:131` bunu adıyla söylüyor: `settleFailedSpend CLOSES the row at its estimate, and today's total does not move`. Yani onarım günün toplamını değiştirmez, yalnız `actualUsd === null` iddiasını geçersiz kılar. İki testin **iddiası** güncellenmeli (mekanizma), **gerekçesi** değil. Bunu yazmadan onarım gönderilirse kapı kırmızı verir ve "onarım yanlış" diye okunur. **Şiddet bandı (H-1, hakem turu, 2026-09-04): P2 → P1** — DK-3 doğrudan NEVER#5 (bütçe) eksenidir, kardeşleri `backlink_changes` B-3 ve `disavow_candidates` B-3 zaten P1 yazıyor, ve altı kopya TEK PR'da kapanacağı için tek şiddet taşımalı. **Hakem doğrulaması (H05, 2026-09-04):** M-CC4 bağımsız yeniden üretildi → 2 KIRMIZI, ikisi de `actualUsd toBeNull`. Şekil haritası §2'de (H-2): **altı portun yalnız İKİSİNDE** (bu tool + `analyze_backlinks`) iddia TAŞINIR, kalan dörtte EKLENİR — yani işçinin "DK-3 tek tip değil" tespiti doğru, ama ayrım iki uçludur, üç değil (Ş-3 düzeltildi) | |
| C-4 | P2 | **`plan.mjs:318` `compare_competitors`'ı PLAN'da tutuyor ama hücre lokal argümanı geçmiyor** — yani C-1'in ölçtüğü varsayılanı satın alıyor. Kardeş tool'lar tam bu gerekçeyle EXCLUDED'a alınmış, bu alınmamış (asimetri) | `plan.mjs:318` (`args: (c) => ({ project_id: c.projectId })`) ↔ `:133-142` (`discover_keywords`/`my_pages` EXCLUDED gerekçeleri: "a sweep on the default would measure the default rather than the tool") | C-1 kapandığında hücre anlamlı olur (uyarı basılır, ölçüm ne ölçtüğünü söyler) — o zaman değişiklik gerekmez. C-1 kapanmadan önce süpürge koşacaksa, ya hücreye per-site `language_code`/`location_code` eklensin ya da kardeşleriyle aynı gerekçeyle EXCLUDED'a alınsın. **Kapı bu asimetriyi ölçmez:** `tool-sweep.mjs --self-test` yalnız tool'un PLAN ya da gerekçeli EXCLUDED'da olduğunu kontrol eder, hücrenin argümanlarını değil | |
| C-5 | P2 | **İş emrinin "keşif yok, rakip listesi zorunlu" varsayımı ölçümle yanlışlandı (ders 13) — ve bunun bir maliyeti var:** keşif akışı bu turda hiç sınanmadı, dolayısıyla description'ın kendi uyardığı risk (`youtube.com`/`wikipedia.org` gibi genel devlerin rakip diye dönmesi) **ölçülmemiş durumda**. Kayıt bunu "ölçüldü" diye taşımamalıdır | Canlı `tools/list` şemasında `required` dizisi yok, `competitors` `.optional()` (`tools/compare-competitors.ts:80`); `dfs/competitors.ts:776` `discovering` dalı; `DEFAULT_COMPETITORS_DISCOVERY_LIMIT=10` | Bir sonraki dilime tek satırlık ölçüm: `project_id` + `competitors` OMIT ile bir çağrı (90 kredi), keşfedilen üç rakibin gerçekten rakip olup olmadığı ve `discovered_total_count` başlığının (`the top N of M competitors DataForSEO found`) doğru basılıp basılmadığı. **Bu bir kod bulgusu değil, kapsam bulgusudur** — kayda bu yüzden giriyor (ders 16: ölçülmeyeni ölçülmüş gibi bırakmak, hiç yazmamaktan kötüdür). **Hakem kararı (H-7, 2026-09-04): C-5 YETERLİ — eksik olan tek şey KAPANIŞ ŞARTIYDI, o da şu:** keşif akışı **düzeltme dalgasından SONRA**, tek ücretli çağrıyla (**90 kredi**) ölçülür; önce değil, çünkü C-1'in uyarısı bağlanmadan koşulan bir keşif çağrısı yine ABD/İngilizce penceresini ölçer ve 90 krediyi iki kez yakar. Ölçülecekler: keşfedilen rakiplerin gerçekten rakip olup olmadığı, `discovered_total_count` başlığının doğruluğu, ve description'ın kendi uyardığı `youtube.com`/`wikipedia.org` riski. **Şef kaydı (Ş-2, ders 13):** iddianın kaynağı işçi değil ŞEFTİ — gap işçisinin iş emrinde *"compare_competitors rakip listesi ZORUNLU (z.array min 1, keşif yok — ölçüldü)"* yazıyordu; şefin gerçekte ölçtüğü şey `.array(z.string().min(1))` satırıydı, `.optional()` ve keşif dalı ölçüm satırının dışındaydı. İşçi iddiayı ölçtü, çürüttü ve raporladı — **doğru davranış**. Ders: iş emrindeki "ölçüldü" damgası da bir hipotezdir; işçi onu kaynağından yeniden ölçer. Şiddet **P2 KALIR** | |

`durum` sütunu ölçüm turunda BOŞ bırakılır; kapatan tur doldurur (izinli değerler `_SABLON.md`'de).
