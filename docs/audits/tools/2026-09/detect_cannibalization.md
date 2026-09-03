# `detect_cannibalization` — tool kontrol kaydı (2026-09 turu)

> Dilim: 3 (GSC) · İşçi: Opus 5 (d3-gsc) · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, toplam Δ −20 kredi** (izin sınırı 2 çağrı / 10 kredi başına — tam sınırda).
> Precondition: `pull_gsc_data` (aynı dilim, ayrı kayıt).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `detect-cannibalization.ts:19-32` + ortak iskele `gsc-discovery-shared.ts:122-230`; kredi `costs.ts:104` = `  detect_cannibalization: 10,`; docs "**Cost:** 10 credits." — description ↔ mdx ↔ canlı JSON Schema üçü de birebir |
| 2 Mutasyon | ÖLÇÜLDÜ | 3 mutasyon: M1 KIRMIZI (1) · M2 KIRMIZI (5) · M3 KIRMIZI (4) — üç ekseni de (pay tabanı · marka bastırma · tavsiye kapısı) test görüyor |
| 3 Canlı negatif | ÖLÇÜLDÜ | 3 senaryonun 3'ü doğru reddedildi; net kredi Δ **0**; şema dışı anahtar reddediliyor (#204) |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (90 günlük çekim: **46 grup + 10 markalı hariç**; 7 günlük çekim: 1 grup + 3 markalı); her biri **tam olarak bir** `-10 credits · charge · detect_cannibalization` satırı |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 5 kural tek tek; R-7.11 ortalama-pozisyon riski **gerekçesiyle KAPATILMIŞ** (`CANNIBAL_CLEAR_LEADER_GAP`); R-7.5 yapısal olarak ilgisiz (GSC filtresi hiç kullanılmıyor); **R-3.9 AYKIRI** ve canlıda ANA SAYFAYI birleştirmeye aday gösterdi |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:36` `detect_cannibalization: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`; canlı `structuredContent` YOK (kontrol: `get_credit_balance` PRESENT) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:74` + `:279` + `:283` PLAN girişleri **VAR** (`:283` notu H3 hipotezini adıyla taşıyor) · `goals/` içinde hedef **YOK** (grep) |

**Karar (ölçüm turu, 2026-09-03):** DÜZELTME GEREKLİ — motor bu dilimin en iyi gerekçelendirilmiş parçası:
marka bastırma iki canlı vakadan (adstark 2026-08-07, dentnotion 2026-08-09/08-25) türetilmiş ve kendi
karşı-örneğini yazıyor; tavsiye kapısı ortalama-pozisyon gürültüsünü (R-7.11) ADIYLA anıp iki floor
koyuyor; parça katlaması bir ölçülmüş yanlış-pozitiften geliyor. Ama **canlıda tavsiye, sitenin ANA
SAYFASINI bir doktor biyografi sayfasına canonical'lamayı önerdi** (`https://dentnotion.com/` → 10,0.
pozisyonda, `.../doctor/dt-gurkan-zeybek-3/` → 1,9) ve `cannibalizationAdvice`'te kök URL'i (ya da
herhangi bir hub/liste sayfasını) dışlayan **hiçbir kapı yok**; R-3.9 canonical'ı güçlü bir sinyal
saydığı için Google bunu onaylarsa zarar geri alınamaz sınıftadır.

**Karar (kapanış, <YYYY-MM-DD>):** — düzeltme dalgası bittiğinde KAPATAN tur yazar; ölçüm turunun kararı SİLİNMEZ, yanına yazılır (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/detect-cannibalization.ts:19-32` (`makeDetectCannibalizationTool`),
  üretim örneği `detectCannibalizationTool` `:34`. Gerçek `defineTool` ortak iskelede:
  `apps/mcp/src/tools/gsc-discovery-shared.ts:132-229`
- Kayıt: `apps/mcp/src/tools/index.ts:12` (import), `:80` (export), `:179` (araç dizisi)
- Motor: `apps/mcp/src/gsc-data/cannibalization.ts` (`detectCannibalization` `:79`), marka modülü
  `apps/mcp/src/gsc-data/brand.ts`, belge katlama `apps/mcp/src/gsc-data/document.ts`
  (`collapseFragments` `:71`, `groupByQuery` `:33`), render + tavsiye
  `apps/mcp/src/gsc-data/format.ts` (`formatCannibalization` `:154`, `cannibalizationAdvice` `:129`),
  rapor şekli `apps/mcp/src/gsc-data/runs.ts:74-87` (`CannibalizationReport`)
- Zod şeması (`gsc-discovery-shared.ts:118-120`) — canlı JSON Schema ile birebir:
  `project_id`: `z.uuid()`, **tek alan, zorunlu**; `"additionalProperties": false` (#204) — §3 N12'de ölçüldü
- Description (birebir alıntı, `detect-cannibalization.ts:14-17` — canlı `tools/list` ile birebir aynı):
  > Detect keyword cannibalization from your latest Search Console pull: queries where two or more of your pages meaningfully compete for the same query, grouped per query. Costs 10 credits. Run pull_gsc_data first.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:104`, birebir): `  detect_cannibalization: 10,`
- Ücretlendirme kipi: **varsayılan `"surface"`** (rezerv → handler → commit/release); ortak iskelenin
  para kuralı `gsc-discovery-shared.ts:31-38`
- Docs sayfası (`apps/web/content/docs/tools-reference/detect-cannibalization.mdx:6`, birebir):
  > **Cost:** 10 credits.

  ve `mdx:12` (birebir):
  > From the pull's current window, it groups rows by query and flags a query when **two or more of its pages** each clear both floors: at least **10 impressions** and at least a **10% share** of that query's impressions. A dominant page plus a negligible straggler is not flagged — only genuine competition. Groups are ordered by total impressions, biggest query first.

  ve `mdx:38` (birebir):
  > Where the data supports it, a query also carries a **consolidation recommendation**: which URL to keep and which to canonicalize or merge into it, with the positions and impressions that decision was read from. It is deliberately **omitted** when the competing pages are within about half a SERP page of each other, or when a lower-ranking page is earning more clicks than the better-ranked one — naming a keeper there would be a guess, and the wrong keeper means consolidating away the page that was working.
- **Sabit eşikler, kaynak satırıyla:**

  | sabit | değer | kaynak |
  |---|---|---|
  | `CANNIBAL_MIN_PAGE_IMPRESSIONS` | **10** | `gsc-data/cannibalization.ts:27` |
  | `CANNIBAL_MIN_SHARE` | **0.1** (%10) | `gsc-data/cannibalization.ts:29` |
  | `SITELINK_PINNED_MAX_POSITION` | **1.5** | `gsc-data/cannibalization.ts:55` |
  | `CANNIBAL_CLEAR_LEADER_GAP` (tavsiye kapısı) | **5** | `gsc-data/format.ts:105` |
  | `MIN_BRAND_TOKEN_LENGTH` | **3** | `gsc-data/brand.ts:58` |
  | `MIN_FUZZY_BRAND_LENGTH` | **8** | `gsc-data/brand.ts:83` |

  Grup kuralı (`cannibalization.ts:84-110`): sorguya göre grupla → `#fragment` katla → `< 2` sayfa ise at
  → toplam gösterim `<= 0` ise at → her sayfa İKİ tabanı da geçmeli (`>= 10` gösterim **VE** toplamın
  `>= %10`'u) → `>= 2` rakip kaldıysa grup. Sıralama: toplam gösterim desc; grup içi gösterim desc.
  Tavsiye kapısı (`format.ts:129-151`): lider POZİSYONA göre seçilir (gelen dizi GÖSTERİME göre sıralı
  olduğu için yeniden sıralanır, `:130`), **her** geride kalan `>= 5` pozisyon geride olmalı (`:135`),
  ve **hiçbiri** liderden fazla tıklama almamalı (`:136`). Aksi hâlde tavsiye **atlanır**, boş basılmaz.
- Tutarsızlıklar: **yok — ne karşılaştırıldı:** `DESCRIPTION` ↔ mdx frontmatter ↔ canlı `tools/list`
  (üçü birebir); `mdx:12`'nin "10 impressions"/"10% share" cümlesi ↔ `cannibalization.ts:27,29`;
  `mdx:38`'in "within about half a SERP page" cümlesi ↔ `CANNIBAL_CLEAR_LEADER_GAP = 5` ve
  `format.ts:95-104`'ün gerekçesi ("Five positions is roughly half a SERP page"); `costs.ts` 10 ↔ mdx
  "**Cost:** 10 credits." ↔ ölçülen defter satırı `-10`; `mdx:44`'ün "**15,000**" ↔ `MAX_ROW_LIMIT`.
- Seçilebilirlik: "kanibalizasyon var mı", "aynı kelimeye iki sayfam mı çıkıyor", "hangi sayfalarım
  birbiriyle yarışıyor" cümlelerinde seçilir. **Karışma riski olan komşular:** (1) `audit_onpage` —
  yinelenen başlık/description bulguları üretir ve kullanıcı "aynı içerikten iki sayfa" derse oraya da
  gidebilir; ayrım net: bu tool GSC'den GERÇEK rekabeti okur, `audit_onpage` sayfa metnine bakar.
  (2) `audit_tech` — canonical bulguları orada (R-3.13'ün 2026-09-02'de `audit_onpage`'e taşındığı
  hatırlanmalı). (3) `my_pages`. **Asimetri:** description "from your latest Search Console pull" +
  "Run pull_gsc_data first" diyerek precondition'ı açıkça yazıyor; canlıda doğru mesaj döndü (§3).

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı: `pnpm --filter @pseo/mcp exec vitest run src/gsc-data src/tools/find-quick-wins.test.ts
src/tools/gsc-discovery-shared.test.ts src/tools/gsc-discovery-runs.test.ts` → **taban 314 passed / 16 files**.
`gsc-discovery-runs.db.test.ts` / `gsc-discovery.db.test.ts` Docker ister — **db şeritleri koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `gsc-data/cannibalization.ts:29` `CANNIBAL_MIN_SHARE = 0.1` → `0.01` (bir yuvarlama kuyruğu da "rakip" sayılır) | pay tabanını gören test | **KIRMIZI** (1 test) | Tek test — bandın **en dar** pini. `CANNIBAL_MIN_PAGE_IMPRESSIONS` ekseni bununla birlikte değişmediği için ayrı; ikisi `cannibalization.ts:91-95`'te AND ile bağlı |
| M2 | `gsc-data/cannibalization.ts:55` `SITELINK_PINNED_MAX_POSITION = 1.5` → `0.0` (hiçbir sayfa "pinlenmiş" sayılmaz → zayıf marka eşleşmeleri artık bastırılmaz) | marka/sitelink bastırma testleri | **KIRMIZI** (5 test / 2 dosya) | Marka bastırmanın **en kırılgan** yarısı iyi pinli. Bu, PR #45'in ürettiği filtrenin kendisi — ve `cannibalization.ts:57-74` bir ÖNCEKİ sürümün neden yanlış olduğunu (iki sayfalık grupta aritmetik olarak imkânsız) yazıyor |
| M3 | `gsc-data/format.ts:105` `CANNIBAL_CLEAR_LEADER_GAP = 5` → `0` (her grupta bir "keeper" adı verilir) | tavsiye kapısını gören testler | **KIRMIZI** (4 test / 2 dosya) | Tavsiyenin **atlanması** da pinli, yalnız basılması değil. `format.ts:107-127` null'ın "sonradan doldurulacak bir boşluk değil, gerçek bir cevap" olduğunu yazıyor ve test bunu tutuyor |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13). **Bu tool'da yeşil kalan mutasyon YOK.**
Çalışma ağacı sonunda temiz: `git diff --stat` → **boş çıktı**.
Geri alma sonrası regresyon: 27 dosya / **498 passed**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt: repo dışı `…/scratchpad/dilim3/d3-gsc/calls.jsonl`.
Kredi Δ `list_credit_activity`'nin `project_id` kapsamlı okumasından (paylaşılan kiracı uyarısı:
`pull_gsc_data` kaydı §3).

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N8 çekim yapılmamış + GSC bağlı olmayan proje (seogrep.com) | `4e0caff0-…` | 200, `isError:true` | **−10 / +10 ÇİFTİ** (net 0) | `No Search Console data found for this project. Run pull_gsc_data first. You were not charged.` — precondition tipli (`PreconditionNotMetError`), cümle verbatim geçiyor. Yönlendirme kusuru `find_quick_wins` B-4 ile aynı (ortak iskele, tek mesaj) |
| N12 **şema dışı anahtar** (#204) | `{"project_id":"4e0caff0-…","limit":5}` | 200, `isError:true` | **defterde satır YOK** | `Invalid input for "detect_cannibalization": ✖ Unrecognized key: "limit" You were not charged.` — `strict()` rezervden ÖNCE. `limit` bilinçli seçildi: çıktı uzun ve bir model doğal olarak kısaltmak isteyebilir; alınmıyor ve neden alınmadığı söylenmiyor |
| N-arşiv (ailede ölçüldü, ortak iskele `:157-160`) | `77f40d69-…` | 200, `isError:true` | **−10 / +10 ÇİFTİ** | `That project is archived… You were not charged.` — arşiv kapısı çekim okumasından ÖNCE |

**Defter kanıtı:** N12 (şema reddi) **hiçbir satır yazmadı**; N8 ve arşiv (precondition reddi)
`charge` + `refund` çifti yazdı, net 0. dentnotion kapsamlı defterde **8 satırın 8'i de `charge`,
hiç `refund` yok** — mutlu yolda iade edilen hiçbir şey yok. NEVER#2 canlıda doğrulandı.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| H3 90 günlük çekim üstünde | `{"project_id":"fa9340e5-…"}` (dentnotion.com) | 200, `isError` yok, **~1,4 s** | **−10** (`2026-09-03T09:05:58Z · -10 credits · charge · detect_cannibalization · project: dentnotion.com`) | `46 cannibalized queries (most impressions first):` · en büyüğü `"izmir diş beyazlatma"` 682 gösterim (7,5 vs **92,6** pozisyon) · `Excluded 10 branded queries ("dent notion", …, "dentnotion", …, "dentmotion")` · footer 3 satır (pencere + **cap uyarısı** + provenance) |
| H8 7 günlük çekim üstünde (ikinci pull'dan sonra) | aynı argüman | 200, `isError` yok, **~1,4 s** | **−10** (`…T09:07:21Z · -10 credits · charge · detect_cannibalization · project: dentnotion.com`) | `1 cannibalized query` (`"gürkan zeybek"`, 38 gösterim) · `Excluded 3 branded queries` · footer **2 satır — cap uyarısı YOK** (7 günlük çekim tavanın altındaydı, koşullu satır doğru çalışıyor) |

Toplam ücretli: **2 çağrı, −20 kredi** (tavan: 2 çağrı / 20 kredi). Her çağrı defterde **tam olarak bir**
`charge` satırı; `refund` yok.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim3/d3-gsc/calls.jsonl` (anahtar redakte).

İş emrinin sorularına canlı cevaplar:

- **Eşik nedir?** İki taban AND ile: `>= 10` gösterim **ve** sorgunun toplam gösteriminin `>= %10`'u
  (`cannibalization.ts:91-95`). Kullanıcıya açılmıyor. Canlı en küçük grup: `"gece diş plağı"` — iki
  sayfa, 12'şer gösterim, toplam 24 (her biri %50). En büyük: `"izmir diş beyazlatma"` 682 gösterim.
- **Ortalama pozisyon semantiği nasıl ele alınıyor (R-7.11)?** **Adıyla ve gerekçesiyle.**
  `format.ts:95-104`: *"`position` is a mean over the whole window, so a 2-position spread is inside
  the noise of which page Google happened to prefer on which day — and naming a keeper there would be
  advice to DELETE the wrong page's ranking."* Bu yüzden tavsiye ancak **her** geride kalan sayfa
  `>= 5` pozisyon geride olduğunda basılıyor. Canlıda etkisi ölçüldü: 46 grubun bir kısmı tavsiye
  **almadı** (ör. `"diş kaplamada en iyisi hangisi"` — iki sayfa da 7,5'te; `"en yakın dişçi"` — 11,7
  vs 7,5) ve boş bir ok basılmadı, satır hiç yok. **Referansın bu tool için adlandırdığı riskin bu
  yarısı KAPATILMIŞ.**
- **Case-sensitive `equals` filtresi (R-7.5)?** **Böyle bir filtre YOK.** Ölçüldü: çekim
  `dimensionFilterGroups` göndermiyor (`pull.ts:94-102`, gövdenin tamamı 5 alan), yani GSC tarafında
  hiçbir `equals` kullanılmıyor. Kuralın bu ürün içindeki karşılığı **yerel** ve iki eksende:
  (a) sorgu ekseni — `groupByQuery` (`document.ts:33-41`) bir JS `Map`'i **ham sorgu dizgisiyle**
  anahtarlıyor, yani JS semantiğiyle büyük-küçük harfe duyarlı; pratikte Google `query` boyutunu
  küçük harfe indirdiği için bu eksen bugün karşılıksız. (b) sayfa ekseni — `documentOf`
  (`document.ts:27-30`) yalnız `#fragment` atıyor; sorgu dizgisi, sondaki eğik çizgi ve BÜYÜK/küçük
  harf **kasten** normalize edilmiyor ve yorum bunun gerekçesini yazıyor (`:22-25`: *"a query string
  or a trailing slash can be a genuinely different document, and guessing there would merge real
  rivals into one"*). **Ölçülmüş sonuç: uydurma yok, gerekçe yazılı — bu eksende bulgu yok.**
- **İkinci çağrı deterministik mi, yeniden ücret mi, "already analyzed" notu var mı?**
  Yeniden ücret alındı (ikinci −10), **önbellek yok**, **"already analyzed" benzeri not YOK**.
  Determinizm bu tool'da ayrıca ölçülmedi çünkü ikinci çağrı **kasten farklı bir çekim** üzerinde
  koşuldu (7 günlük); motor saf bir fonksiyon olduğu için aynı çekimde aynı çıktının geleceği
  `find_quick_wins`'te bayt bayt kanıtlandı (sha256 eşleşmesi) ve aynı iskele/kip geçerli.
  **Ölçülen daha değerli şey:** aynı site, aynı gün, farklı pencere → **46 grup → 1 grup**.
- **Marka bastırma canlıda ne yaptı?** 90 günde **10 markalı sorgu** hariç tutuldu ve hepsi ADIYLA
  basıldı (`"dent notion"`, `"dentnotion"`, `"dent notion yorumları"`, ve iki yazım hatası:
  `"dent nation"`, `"dentmotion"`). Bulanık eşleşme `MIN_FUZZY_BRAND_LENGTH = 8` sayesinde çalıştı
  (`dentnotion` 10 karakter). Hariç tutma **sessiz değil** — `mdx:20`'nin "This matters most when the
  list ends up empty" uyarısı canlıda karşılığını buldu: H8'de 3 markalı hariç tutuldu ve listede
  tek grup kaldı.

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-3.9 (`rel=canonical` **direktif değil güçlü sinyaldir**; redirect de güçlü, sitemap zayıf) | Tavsiye cümlesi birebir: `canonicalize or merge <URL> into it` (`format.ts:146-150`). Çıktıda, description'da ve mdx'te **sinyalin yok sayılabileceğini söyleyen tek kelime yok**; iki seçenek ("canonicalize or merge") **eşit** sunuluyor, oysa R-3.9 bunları farklı güçte sıralıyor | **AYKIRI** | İki eksende: (a) canonical bir DİREKTİF gibi sunuluyor — Google onu yok sayarsa iki sayfa yarışmaya devam eder ve kullanıcı işi bitmiş sanır; (b) R-3.9 redirect'i de güçlü sayıyor ve "merge" ile "canonicalize" arasındaki fark (birinde eski URL yaşar, diğerinde yaşamaz) hiçbir yerde söylenmiyor → B-2 |
| R-7.1 (boyutlar) | `query` + `page` boyutlarını okuyor (`pull.ts:98`); grup ekseni `query`, rakip ekseni `page` | **UYUYOR** | Tool'un sorusu tam olarak bu iki boyutun kesişimi; uydurma boyut yok |
| R-7.2 (`rowLimit` 1–25.000; `startRow`) | Çekimden MİRAS: 15.000 satır tavanı, sayfalama yok | **AYKIRI (miras)** | Ve bu tool'da sonucu **matematikseldir, kozmetik değil**: her pay `impressions / totalImpressions` ile hesaplanıyor (`cannibalization.ts:92-94`) ve kesilmiş bir pencere **paydayı** kısaltır, yani her pay olduğundan **büyük** okunur. `mdx:44` bunu açıkça yazıyor. Canlı H3'te iki pencere de tavandaydı → tüm 46 grubun payları şişmiş olabilir. Kök bulgu `pull_gsc_data` B-2 |
| R-7.5 (filtre operatörleri; `equals` case-sensitive) | GSC filtresi **hiç kullanılmıyor**; yerel gruplama ham dizgiyle anahtarlanıyor ve normalize etmeme kararı gerekçeli (`document.ts:22-25`) | **İLGİSİZ (yapısal) — ölçüldü** | Referansın bu tool için adlandırdığı riskin bu yarısı **karşılıksız**: bayatlayacak bir filtre yok. Yerel eksende de uydurma normalizasyon yok |
| R-7.11 ("Position" = ilgili satırın ortalaması) | Rakip pozisyonları ham basılıyor; tavsiye kapısı ortalamanın gürültüsünü ADIYLA anıp `>= 5` pozisyon farkı istiyor (`format.ts:95-105, :135`); katlamada gösterim-ağırlıklı ortalama (`document.ts:84-87`) | **UYUYOR — referansın adlandırdığı risk KAPATILMIŞ** | Referansın satırı: *"Case-sensitive `equals` filtresi ve ortalama-pozisyon semantiği"*. İkinci yarı burada, ilk yarı yukarıda; **ikisi de bugün gerçekleşmiyor**. Kalan tek eksik: çıktı pozisyonun bir ORTALAMA olduğunu okura söylemiyor (`find_quick_wins` B-2 ile aynı aile) |

**Listede olmayan ve uydurulmayan:** kişi/marka-dışı navigasyonel sorguların (bir hekimin adı gibi)
nasıl sınıflandırılacağı bu referans listesinde **YOKTUR**; B-3 bu yüzden bir SEO kuralı ihlali olarak
değil, **ölçülmüş bir yanlış-pozitif sınıfı** olarak yazıldı. Aynı şekilde "iki sayfa da 40. sıradaysa
birleştirme önerilmemeli" diye bir kural da listede yok — B-4 tool'un KENDİ gerekçesine (nedeni
`format.ts:107-127`'de yazılı iki floor'un amacı) dayandırıldı, dış kurala değil.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — `:36` `  detect_cannibalization: "report",`.
`CARDED_TOOLS` (`:62`) yalnız `get_credit_balance` → kart **planlı, sevk edilmemiş**.
Canlıda ölçüldü: H3/H8 yanıtları yalnız `result.content[0].text`; `structuredContent` YOK, `_meta` YOK.
**Sonda:** aynı oturumda `get_credit_balance` `structuredContent` **PRESENT** döndürdü.

Yapısal yarı hazır ve saklanıyor: `CannibalizationReport` (`runs.ts:74-87`) — `window`, `total`
(**yalnız eyleme dönük gruplar**), `branded` (hariç tutulan sayı, ayrı bir alan olarak), `top`, ve
`groups` (**markalılar dahil**, her biri kendi `branded` bayrağıyla). `runs.ts:76-81` `branded`'ın neden
`total`'a dahil edilmediğini gerekçesiyle yazmış: *"a report whose total silently included them would
tell the panel to show work that the tool's own text tells the user not to do."* Kart sevk edilirse
**hariç tutma satırının kartta da görünmesi şart** — `mdx:20`'nin "boş liste iki farklı şey demek
olabilir" uyarısı yalnız metinde yaşıyor.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `:74` (`{ tool: "detect_cannibalization",
  idArg: "project_id", targetArg: null }`), senaryolar `:279` (S2, GSC yok) ve `:283` (S1), ve
  `:283`'ün notu hipotezi adıyla taşıyor: *"H3: one brand/navigational false positive is enough to
  call the PR #45 filter insufficient"*. **Bu turda tam o hipotez bir kez daha doğrulandı** (B-3:
  `"gürkan zeybek"`, bir hekim adı, markasız sayıldı) — yani sweep planı doğru soruyu soruyor ve
  cevap hâlâ "yetersiz"
- `goals/` hedefi gerekli mi: **EVET.** B-1 (kök URL koruması) bir kez eklenirse, onu geri alacak bir
  düzeltme hiçbir testi kırmaz — ve sonucu, bir müşteriye ana sayfasını canonical'lamasını
  söylemektir. `goals/`a "birleştirme tavsiyesi hiçbir zaman sitenin kök URL'ini fold edilecek taraf
  olarak adlandırmaz" gibi bir hedef, bu sınıfı kapıya taşıyan en ucuz yoldur

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, <YYYY-MM-DD>) |
|---|---|---|---|---|---|
| B-1 | **P1** | **Birleştirme tavsiyesi sitenin ANA SAYFASINI fold edilecek taraf olarak adlandırabiliyor — canlıda adlandırdı.** Ölçülen satır (H3, birebir): `→ Keep https://dentnotion.com/doctor/dt-gurkan-zeybek-3/ (position 1.9, 25 clicks); canonicalize or merge https://dentnotion.com/doktorlarimiz/ (position 8.8), https://dentnotion.com/ (position 10.0) into it — they sit 6.8+ positions behind while holding 346 of this query's 624 impressions.` Yani müşteriye **ana sayfasını ve doktorlar liste sayfasını** bir doktor biyografi sayfasına canonical'lamasını söylüyor. `cannibalizationAdvice` (`format.ts:129-151`) kök URL'i, hub/liste sayfalarını ya da herhangi bir sayfa SINIFINI dışlamıyor; iki floor'u da (gap `>= 5`, lider tıklamada geçilmesin) bu vaka **sağlıyor**, yani mevcut korumalar yapısal olarak bunu göremiyor. R-3.9 canonical'ı **güçlü bir sinyal** saydığı için Google bunu onaylarsa sonuç geri alınması pahalı bir kayıptır. **Şiddet P1, P0 DEĞİL: sayılar doğru ve tavsiye uygulanana kadar zarar yok** — ama uygulanabilir, tek satırlık ve yetkin görünen bir talimat | Canlı H3 çıktısı (`"gürkan zeybek"` grubu, 3 sayfa, 624 gösterim); `format.ts:129-151` (`cannibalizationAdvice`) — kök/hub dışlaması **yok**; R-3.9 | Tavsiye, **fold edilecek** tarafta kök URL'i (`path === "/"`) barındırıyorsa ya tamamen atlansın (null — dosyanın kendi kuralı: "null gerçek bir cevaptır") ya da yön TERSİNE çevrilerek okura bırakılsın ("ana sayfanız bu sorguda da görünüyor; birleştirme kararına ana sayfayı KATMAYIN"). Aynı kapı liste/hub sayfaları için de düşünülebilir ama onları güvenilir biçimde tanımak veri gerektirir; **kök URL tek satırlık, kesin ve en zararlı vakayı kapatır**. Düzeltmeyle birlikte bu ekseni pinleyen bir test gelmeli (ders 14: hangi ekseni varyantladığın yazılır — M1/M2/M3 pay, marka ve gap eksenlerini pinliyor, **URL SINIFI ekseni pinsiz**) |  |
| B-2 | **P2** | **`canonicalize or merge` bir DİREKTİF gibi sunuluyor (R-3.9).** R-3.9 birebir: `rel=canonical` **direktif değil güçlü sinyaldir**. Çıktının, description'ın ve `detect-cannibalization.mdx`'in hiçbir yerinde Google'ın bu sinyali yok sayabileceği yazmıyor; ayrıca "canonicalize" ile "merge" eşit iki seçenek gibi sunuluyor, oysa aralarındaki fark (eski URL yaşamaya devam eder / etmez) tavsiyenin sonucunu tümden değiştirir ve R-3.9 redirect'i ayrı bir güçlü sinyal olarak sayıyor. R-3.10 ayrıca aynı sayfaya farklı tekniklerle farklı canonical verilmemesini istiyor — tool birden çok gruba aynı sayfayı farklı rollerde koyabilir ve bunu takip etmiyor (canlıda ölçüldü: `.../zirkonyum-vs-porselen-kaplama/` bir grupta KEEPER, başka grupta FOLD edilecek taraf) | `format.ts:146-150` tavsiye şablonu; canlı H3'te `.../zirkonyum-vs-porselen-kaplama/` iki grupta zıt rollerde (`"en sağlıklı diş yapımı hangisidir"` vs `"en iyi diş yapımı hangisi"`); R-3.9, R-3.10 | Tavsiye cümlesine ya da mdx'e bir şerh: canonical'ın bir sinyal olduğu ve Google'ın yok sayabileceği; ve aynı sayfanın birden çok grupta zıt rol alabildiği — bu durumda önce SAYFA düzeyinde bir karar verilmesi gerektiği. **Aynı sayfanın iki grupta zıt rolde çıkması ayrıca tespit edilebilir ve basılabilir** — veri elde (`groups` tamamı raporda) |  |
| B-3 | **P2** | **Marka bastırma yalnız ALAN ADI jetonunu tanıyor; kişi/kurum adı navigasyonel sorguları markasız sayılıyor.** Canlıda en büyük ikinci grup `"gürkan zeybek"` — kliniğin kendi hekiminin adı, yani saf navigasyonel bir sorgu — ve **markalı sayılmadı**, üstelik B-1'in ana-sayfa tavsiyesini o üretti. `brandTokenOf` alan adının kayıtlanabilir etiketinden türüyor (`brand.ts:87-100`), yani `dentnotion` dışında hiçbir isim marka olamaz. Sitelink testi de tutmadı çünkü sayfalar 1,9 / 8,8 / 10,0'da (eşik `<= 1.5`). `plan.mjs:283` bu hipotezi ADIYLA taşıyor (*"one brand/navigational false positive is enough to call the PR #45 filter insufficient"*) — **bu tur onu bir kez daha doğruladı** | Canlı H3: `"gürkan zeybek"` grubu markasız listelendi, 10 marka-dizgisi sorgusu ise doğru hariç tutuldu; `brand.ts:87-100` `registrableLabel`; `cannibalization.ts:75-77` `looksLikeSitelinks`; `plan.mjs:283` | Referansta bu eksende **kural YOK** (§5 şerhi), bu yüzden yalnız yön önerilir: navigasyonel şeklin ikinci bir sinyali — ör. grubun **liderinin** çok yüksek CTR'ı ve çok düşük pozisyonu (canlıda 1,9 pozisyon / 275 gösterim / 25 tıklama = %9 CTR, listedeki her şeyin onlarca katı) — markasız navigasyonel sorguları ayırt edebilir. **Bu bir ürün kararıdır ve ölçüm ister**; B-1'in kök-URL kapısı bundan bağımsız ve daha ucuzdur, önce o gelmeli |  |
| B-4 | **P2** | **Tavsiye, HİÇBİR sayfanın sıralamadığı gruplarda da basılıyor.** Gap testi yalnız GÖRECELİDİR; mutlak bir pozisyon tabanı yok. Canlı örnekler: `"izmir ağrısız diş tedavisi"` → `Keep .../periodonti-dis-eti-tedavisi/ (position 38.0); canonicalize or merge .../izmirin-en-iyi-dis-hastanesi/ (position 43.2)` — 89 gösterimlik bir sorguda 4. sayfa ile 5. sayfa arasında birleştirme tavsiyesi; `"izmir implant tedavisi"` → 26,8 vs 81,8. Ayrıca **ikinci floor 46 grubun çoğunda vakuftur**: tıklama testi (`format.ts:136`) her iki taraf da 0 tıklamadayken hiçbir şey elemiyor — canlıda tavsiye basılan grupların çoğunda lider `0 clicks` yazıyor | Canlı H3: `"izmir ağrısız diş tedavisi"` (38,0 vs 43,2), `"izmir implant tedavisi"` (26,8 vs 81,8), `"gece plağı"` (15,0 vs 41,3); `format.ts:129-151` — mutlak pozisyon tabanı yok, tıklama testi 0-0'da vakuf | Mutlak bir taban: lider sayfa görünür bir aralıkta değilse (ör. ilk iki SERP sayfası) tavsiye atlansın — birleştirme, ikisi de görünmeyen iki sayfa için doğru işin ta kendisi değildir; asıl iş sıralamaktır. **Sayı referansta YOK**, bu yüzden seçilen eşik ölçülmeli ve pinlenmeli. Tıklama floor'unun 0-0 vakufluğu ayrıca yazılsın: iki taraf da tıklama almıyorsa o floor bir koruma sağlamıyor ve tavsiye tek ayak üzerinde duruyor |  |
| B-5 | **P2** | **`limit` gibi doğal bir anahtar sessizce reddediliyor + noktalama.** N12: `{"project_id":…,"limit":5}` → `✖ Unrecognized key: "limit" You were not charged.` Çıktı canlıda 46 grup + 10 hariç tutma satırı kadar uzundu; bir modelin kısaltmaya çalışması beklenir. Reddin kendisi doğru (`strict()`, #204), ama cevap yönlendirici değil. Ayrıca tek satırlık zod mesajı ile ücret cümlesi arasında ayırıcı yok — `pull_gsc_data` B-7 / `audit_speed` (dilim 2) B-6 ile **aynı yüzey-geneli kusur**, bu turda dört tool'un dördünde de ölçüldü | §3 N12; dilim 3'ün diğer üç tool'unda birebir aynı (N4, N11, N13) | Noktalama yarısı `pull_gsc_data` B-7 ile birlikte, TEK yerde kapanır. Kısaltma yarısı için: çıktının uzunluğu bir ürün kararı — bugün `find_quick_wins` sayfa/sorgu tavanı uyguluyor, bu tool **hiç tavan uygulamıyor** (46 grubun 46'sı basıldı). Aynı ailede iki farklı politika olması ayrıca bir tutarsızlık; birlikte karara bağlanmalı |  |

### Ölçülemeyenler (ve nedeni)

- **Kesilmemiş bir 90 günlük çekim üzerinde davranış** — dentnotion'ın her iki penceresi de 15.000
  satır tavanını doldurdu (`pull_gsc_data` B-2), yani ölçülen 46 grubun **her payı kısaltılmış bir
  paydaya** bölünmüş olabilir. Daha küçük bir mülkte (adstark.com.tr) ikinci bir ölçüm kredi tavanına
  sığmadı (2 çağrı, ikisi de dentnotion'ın iki farklı penceresine harcandı).
- **Aynı çekim üzerinde bayt-determinizmi** — bu tool'da ölçülmedi; ikinci çağrı kasten farklı bir
  çekim üzerinde koşuldu. `find_quick_wins`'te aynı iskele ve aynı kip için bayt bayt kanıtlandı.
- **`gsc-discovery-runs.db.test.ts` / `gsc-discovery.db.test.ts` şeritleri** — Docker gerekiyor,
  koşulmadı (protokol izni). `CannibalizationReport`'un `gsc_discovery_runs`'a gerçekten yazıldığı
  yalnız statik olarak doğrulandı.
- **B-3'ün doğru düzeltmesi** — kişi adı / navigasyonel sorgu ayrımı için referansta kural yok;
  önerilen CTR sinyali bir HİPOTEZDİR ve ölçülmeden koda girmemeli.
