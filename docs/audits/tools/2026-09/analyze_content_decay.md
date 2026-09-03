# `analyze_content_decay` — tool kontrol kaydı (2026-09 turu)

> Dilim: 3 (GSC) · İşçi: Opus 5 (d3-gsc) · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.
> Bu tur ÜCRETLİ mutlu yolu içerir: **2 çağrı, toplam Δ −20 kredi** (izin sınırı 2 çağrı / 10 kredi başına — tam sınırda).
> Precondition: `pull_gsc_data` (aynı dilim, ayrı kayıt).

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | `analyze-content-decay.ts:19-31` + ortak iskele `gsc-discovery-shared.ts:122-230`; kredi `costs.ts:105` = `  analyze_content_decay: 10,`; docs "**Cost:** 10 credits." — description ↔ mdx ↔ canlı JSON Schema üçü de birebir |
| 2 Mutasyon | ÖLÇÜLDÜ | 3 mutasyon: M1 KIRMIZI (1) · M2 KIRMIZI (3) · **M3 (`previous <= 0` → `previous < 0`) YEŞİL KALDI 3914/3914 — ama EŞDEĞER MUTANT, test deliği DEĞİL** (aritmetik kanıt §2'de) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 3 senaryonun 3'ü doğru reddedildi; net kredi Δ **0**; arşiv kapısı ve şema dışı anahtar (#204) canlıda ölçüldü |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı: 90 günlük pencerede **10 çürüyen sayfa**, 7 günlük pencerede **1** — aynı site, aynı gün; her biri **tam olarak bir** `-10 credits · charge · analyze_content_decay` satırı |
| 5 SEO güncelliği | ÖLÇÜLDÜ | 5 kural tek tek; R-7.10 (preliminary) **örnek alınacak** biçimde kapatılmış · R-4.6 "helpful content" bayat dili **HİÇ YOK** (grep) · **R-6.9 AYKIRI: karşılaştırma penceresinin içinde İKİ core update var ve çıktı bunu hiç anmıyor** |
| 6 Kart | PLANLI, SEVK EDİLMEMİŞ | `card-map.ts:37` `analyze_content_decay: "report"`; `CARDED_TOOLS` (`:62`) yalnız `get_credit_balance`; canlı `structuredContent` YOK (kontrol: `get_credit_balance` PRESENT) |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | Bu dosya ✔ · `plan.mjs:75` + `:280` + `:284` PLAN girişleri **VAR** · `goals/` içinde hedef **YOK** (grep) |

**Karar (ölçüm turu, 2026-09-03):** DÜZELTME GEREKLİ — bu tool'un tazeleme-gecikmesi guard'ı (R-7.10) bu
dilimin en iyi kapatılmış SEO kuralıdır ve bayat "helpful content skoru" dili hiç yok (R-4.6); üç ayrı
tavsiye dalı da veriden türetiliyor, tek şablon değil. Ama **referansın bu tool için adlandırdığı BİRİNCİ
risk — "düşüşün core update takvimine bakılmadan içeriğe atfedilmesi" — canlıda birebir gerçekleşti:**
karşılaştırılan iki pencere R-6.9'un listelediği Mart 2026 (27 Mar) ve Mayıs 2026 (21 May) core
update'lerini kapsıyordu ve on sayfanın onuna da SAYFAYI değiştirme talimatı verildi; repoda
`core update` diye bir dize **hiç geçmiyor**. İkinci yapısal eksik: çürüme **yalnız tıklamadan**
ölçülüyor, gösterim satırda dururken atılıyor — yani "sıralamayı kaybettim" ile "sıralamayı korudum,
tıklamayı kaybettim" aynı tavsiyeyi alıyor.

**Karar (kapanış, <YYYY-MM-DD>):** — düzeltme dalgası bittiğinde KAPATAN tur yazar; ölçüm turunun kararı SİLİNMEZ, yanına yazılır (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/analyze-content-decay.ts:19-31` (`makeAnalyzeContentDecayTool`),
  üretim örneği `analyzeContentDecayTool` `:33`. Gerçek `defineTool` ortak iskelede:
  `apps/mcp/src/tools/gsc-discovery-shared.ts:132-229`
- Kayıt: `apps/mcp/src/tools/index.ts:13` (import), `:81` (export), `:180` (araç dizisi)
- Motor: `apps/mcp/src/gsc-data/content-decay.ts` (`analyzeContentDecay` `:63`, `clicksByPage` `:50`),
  belge kimliği `apps/mcp/src/gsc-data/document.ts` (`documentOf` `:27`), render + tavsiye
  `apps/mcp/src/gsc-data/format.ts` (`formatContentDecay` `:245`, `contentDecayAdvice` `:223`),
  rapor şekli `apps/mcp/src/gsc-data/runs.ts:89-94` (`ContentDecayReport`)
- Zod şeması (`gsc-discovery-shared.ts:118-120`) — canlı JSON Schema ile birebir:
  `project_id`: `z.uuid()`, **tek alan, zorunlu**; `"additionalProperties": false` (#204) — §3 N13'te ölçüldü
- Description (birebir alıntı, `analyze-content-decay.ts:14-17` — canlı `tools/list` ile birebir aynı):
  > Find decaying pages from your latest Search Console pull: pages whose clicks dropped meaningfully (absolute and proportional) vs the previous window, biggest loss first. Costs 10 credits. Run pull_gsc_data first.
- Kredi satırı (`apps/mcp/src/credits/costs.ts:105`, birebir): `  analyze_content_decay: 10,`
- Ücretlendirme kipi: **varsayılan `"surface"`** (rezerv → handler → commit/release);
  para kuralı `gsc-discovery-shared.ts:31-38`
- Docs sayfası (`apps/web/content/docs/tools-reference/analyze-content-decay.mdx:6`, birebir):
  > **Cost:** 10 credits.

  ve `mdx:12` (birebir):
  > It sums each page's clicks across both windows (a page can rank for many queries) and flags a page when it lost **at least 5 clicks** AND **at least 30%** of its previous clicks. Both thresholds must be met, so a tiny wobble or a large-but-proportionally-small dip is left out. Results are ordered by clicks lost, biggest bleed first.

  ve `mdx:38` (birebir):
  > This analysis sees only what [`pull_gsc_data`](/docs/tools-reference/pull-gsc-data) brought back. A pull fetches at most **15,000** `(query, page)` rows per window, and a page that fell out of a truncated window's top rows is read as having lost those clicks, so a large property can show a decay that never happened — the analysis prints a caveat when either window hit the cap.
- **Sabit eşikler, kaynak satırıyla:**

  | sabit | değer | kaynak |
  |---|---|---|
  | `DECAY_MIN_ABS_DROP` (mutlak tıklama kaybı) | **5** | `gsc-data/content-decay.ts:24` |
  | `DECAY_MIN_DROP_RATIO` (oransal kayıp) | **0.3** (%30) | `gsc-data/content-decay.ts:26` |
  | `DECAY_SEVERE_DROP_RATIO` (tavsiye dalı eşiği) | **0.7** (%70) | `gsc-data/format.ts:196` |
  | `GSC_FRESHNESS_LAG_DAYS` (miras) | **3** | `gsc-data/windows.ts:23` |
  | `MAX_ROW_LIMIT` (miras) | **15000** | `gsc-data/pull.ts:66` |

  Kural (`content-decay.ts:63-84`): iki pencerede de **BELGE** başına tıklama toplanır
  (`clicksByPage`, `documentOf` ile `#fragment` katlanır) → önceki pencerede `<= 0` tıklama varsa
  atlanır (temel yok) → `lost = previous - current`, `ratio = lost / previous` → **her ikisi de**
  (`lost >= 5` VE `ratio >= 0.3`) sağlanırsa listeye girer → `clicks_lost` desc sıralanır.
  **Liste TAVANSIZDIR** (`mdx:30`: *"biggest loss first, and not capped"*).
  Tavsiye üç dal (`format.ts:223-242`): `current_clicks === 0` → "Nothing left, önce indexlenme/
  yönlendirme kontrol et"; `ratio >= 0.7` → "Severe, re-target"; aksi → "Partial slide, refresh + iç link".
- **İş emrinin sorduğu "helpful content dili" kontrolü — ÖLÇÜLDÜ, YOK:**
  `grep -rni "core update\|helpful content"` → `apps/mcp/src/` ve
  `apps/web/content/docs/tools-reference/` üzerinde **tek eşleşme yok**. Yani (a) R-4.6'nın bayat dili
  (ayrı bir "HCU skoru") **hiç yok** — iyi; (b) ama **core update takvimi de hiç yok** — B-1.
- Tutarsızlıklar: **yok — ne karşılaştırıldı:** `DESCRIPTION` ↔ mdx frontmatter ↔ canlı `tools/list`
  (üçü birebir); `mdx:12`'nin "at least 5 clicks"/"at least 30%" cümlesi ↔ `content-decay.ts:24,26`;
  `mdx:32`'nin üç tavsiye dalı anlatısı ↔ `format.ts:223-242` (üç dal, aynı sıra, aynı anlam);
  `costs.ts` 10 ↔ mdx "**Cost:** 10 credits." ↔ ölçülen defter satırı `-10`; `mdx:38`'in "**15,000**"
  ↔ `MAX_ROW_LIMIT` ↔ canlı footer cümlesi.
- Seçilebilirlik: "hangi sayfalarım trafik kaybediyor", "içeriğim çürüyor mu", "düşüşteki sayfalar"
  cümlelerinde seçilir. **Karışma riski olan komşular:** (1) `audit_content` — adı en yakın olan;
  o TARANAN sayfa metnine bakar (kalite/derinlik), bu GSC performansına bakar ve sayfayı hiç
  görmez. İkisi "içerik" kelimesini paylaşıyor ve description'lar bu ayrımı açıkça söylemiyor.
  (2) `backlink_changes` — o da "kayıp" ekseninde ama link tarafında; R-6.8/R-6.9 ikisini de
  etkiliyor. (3) `whats_next` — ücretsiz yönlendirici. **Asimetri:** description "from your latest
  Search Console pull" + "Run pull_gsc_data first" ile precondition'ı yazıyor; canlıda doğru mesaj
  döndü (§3).

## 2. Mutasyon (test gerçekten bakıyor mu)

Koşulan kapı (M1, M2): `pnpm --filter @pseo/mcp exec vitest run src/gsc-data src/tools/find-quick-wins.test.ts
src/tools/gsc-discovery-shared.test.ts src/tools/gsc-discovery-runs.test.ts` → **taban 314 passed / 16 files**.
M3 için paketin TAMAMI: `pnpm --filter @pseo/mcp exec vitest run` → **taban 3914 passed / 147 files**.
`gsc-discovery-runs.db.test.ts` / `gsc-discovery.db.test.ts` Docker ister — **db şeritleri koşulmadı**.

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M1 | `gsc-data/content-decay.ts:24` `DECAY_MIN_ABS_DROP = 5` → `1` (bir-iki tıklamalık dalgalanma da "çürüme" olur) | mutlak tabanı gören test | **KIRMIZI** (1 test) | En dar pin. Sabitin gerekçesi `content-decay.ts:11-14`'te ("the loss is real, not a one-or-two-click wobble") ve test onu tutuyor |
| M2 | `gsc-data/format.ts:196` `DECAY_SEVERE_DROP_RATIO = 0.7` → `0.95` (canlıda "Severe" alan üç sayfa "Partial slide" alırdı) | tavsiye dalını gören testler | **KIRMIZI** (3 test / 1 dosya) | **Tavsiye METNİ pinli, yalnız seçim değil.** Canlıda ölçülen üç dalın ikisinin sınırı buradan geçiyor (%71,4 ve %77,8 → Severe); 0,95'te üçü de dal değiştirirdi |
| M3 | `gsc-data/content-decay.ts:69` `if (previous <= 0) continue;` → `if (previous < 0) continue;` (iş emrinin "temel yok" kapısını kır hipotezi) | temel-yok kapısını gören test | **YEŞİL KALDI — 3914/3914** | **Ama bu bir TEST DELİĞİ DEĞİL, EŞDEĞER MUTANT** (ders 13: planın yazdığı mutasyon bir hipotezdir). Aritmetik kanıt: `previous === 0` iken `lost = 0 - current = -current <= 0`, yani `lost >= DECAY_MIN_ABS_DROP` (5) **hiçbir zaman** sağlanamaz; `ratio = lost / 0` de `NaN` ya da `-Infinity` olur ve her iki hâlde `>= 0.3` false döner. Kapı **savunmacıdır, yük taşımaz** — davranış birebir aynı kalır, dolayısıyla yeşil kalması DOĞRU cevaptır. Yakalayacak bir test yazılamaz, çünkü gözlenebilir bir fark yok. Bunu "delik" diye raporlamak yanlış ölçüm olurdu (ders 11) |

Yeşil kalan her mutasyon bir bulgudur (ders 12/13) — **M3 hariç, ve nedeni yukarıda aritmetikle
yazıldı.** Bu tool'da gerçek bir yeşil-mutant deliği yok.
Çalışma ağacı sonunda temiz: `git diff --stat` → **boş çıktı**.
Geri alma sonrası regresyon: 27 dosya / **498 passed**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt: repo dışı `…/scratchpad/dilim3/d3-gsc/calls.jsonl`.
Kredi Δ `list_credit_activity`'nin `project_id` kapsamlı okumasından (paylaşılan kiracı uyarısı:
`pull_gsc_data` kaydı §3).

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| N9 çekim yapılmamış + GSC bağlı olmayan proje (seogrep.com) | `4e0caff0-…` | 200, `isError:true` | **−10 / +10 ÇİFTİ** (net 0) | `No Search Console data found for this project. Run pull_gsc_data first. You were not charged.` — precondition tipli, cümle verbatim. Yönlendirme kusuru `find_quick_wins` B-4 ile ortak (tek mesaj, üç tool) |
| N13 **şema dışı anahtar** (#204) | `{"project_id":"4e0caff0-…","threshold":0.5}` | 200, `isError:true` | **defterde satır YOK** | `Invalid input for "analyze_content_decay": ✖ Unrecognized key: "threshold" You were not charged.` — `strict()` rezervden ÖNCE. `threshold` bilinçli seçildi: eşikler kodda sabit ve bir kullanıcının gevşetmek istemesi beklenir; reddediliyor ve **sabitlerin nerede olduğu söylenmiyor** |
| N14 **arşivlenmiş proje** | `77f40d69-…` (dilim1-tek-kullanimlik) | 200, `isError:true` | **−10 / +10 ÇİFTİ** (net 0) | `That project is archived, so it is not being tracked right now. Restore it with setup_project for the same domain … You were not charged.` — arşiv kapısı çekim okumasından ÖNCE (`gsc-discovery-shared.ts:157-160`) ve **ARŞİV cümlesi, "çekim yok" cümlesi değil**; sıralama doğru |

**Defter kanıtı:** N13 (şema reddi) **hiçbir satır yazmadı**; N9 ve N14 (precondition reddi) `charge` +
`refund` çifti yazdı, net 0 — ve N14'ün çifti `project: dilim1-tek-kullanimlik-8b3f7c.com` etiketiyle
göründü, yani arşivlenmiş bir proje bile defterde doğru adlandırılıyor. dentnotion kapsamlı defterde
**8 satırın 8'i de `charge`, hiç `refund` yok**. NEVER#2 canlıda doğrulandı.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| H4 90 günlük çekim üstünde | `{"project_id":"fa9340e5-…"}` (dentnotion.com) | 200, `isError` yok, **1,31 s** | **−10** (`2026-09-03T09:06:28Z · -10 credits · charge · analyze_content_decay · project: dentnotion.com`) | `10 decaying pages (biggest loss first):` · en büyüğü `.../implant-agrisi-nasil-gecer/ — 140 → 90 clicks (lost 50, down 35.7%)` · üç dal da göründü: 7× "Partial slide", 3× "Severe", 1× "Nothing left" · footer 3 satır (pencere `2026-06-03..2026-08-31` vs `2026-03-05..2026-06-02` + **cap uyarısı** + provenance) |
| H7 7 günlük çekim üstünde (ikinci pull'dan sonra) | aynı argüman | 200, `isError` yok, **1,02 s** | **−10** (`…T09:07:10Z · -10 credits · charge · analyze_content_decay · project: dentnotion.com`) | `1 decaying page` (`.../dis-beyazlatma-izmir/ — 11 → 5 clicks (lost 6, down 54.5%)`) · footer **2 satır — cap uyarısı YOK** (7 günlük çekim tavanın altındaydı) |

Toplam ücretli: **2 çağrı, −20 kredi** (tavan: 2 çağrı / 20 kredi). Her çağrı defterde **tam olarak bir**
`charge` satırı; `refund` yok.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/37f05938-81d4-4e04-a911-d0ea9b56d81c/scratchpad/dilim3/d3-gsc/calls.jsonl` (anahtar redakte).

İş emrinin sorularına canlı cevaplar:

- **Düşüş penceresi nedir?** İki bitişik, eşit pencere; uzunluk `pull_gsc_data`'nın `days`'i.
  Canlıda ölçülen: 90 gün → current `2026-06-03..2026-08-31`, previous `2026-03-05..2026-06-02`;
  7 gün → current `2026-08-25..2026-08-31`, previous `2026-08-18..2026-08-24`. **Bu tool pencereyi
  seçmez, çekimden miras alır** — ve çıktı bunu footer'da açıkça yazıyor.
- **Core update takvimiyle kesişimi söylüyor mu (R-6.9)?** **HAYIR — ve canlı ölçüm kesişimin
  gerçek olduğunu gösterdi.** R-6.9'un listelediği **Mart 2026 core (27 Mar 2026)** ve
  **Mayıs 2026 core (21 May 2026)** güncellemelerinin İKİSİ de H4'ün ÖNCEKİ penceresinin
  (`2026-03-05..2026-06-02`) içinde; yani karşılaştırmanın temel aldığı dönem iki core update
  tarafından şekillendirilmiş ve pencere sınırı ikincisinden ~13 gün sonra. On sayfanın onuna da
  SAYFAYI değiştirme talimatı verildi. Repoda `core update` dizesi **hiç geçmiyor** (grep) → B-1.
- **"helpful content" dili var mı (R-4.6 → bayat)?** **HAYIR — ölçüldü, tek eşleşme yok.**
  Ayrı bir "HCU skoru" ya da "helpful content sistemi" iddiası yok; tavsiyeler "refresh /
  re-target / verify indexing" gibi somut işler. **BAYAT DEĞİL.**
- **İkinci çağrı deterministik mi, yeniden ücret mi, "already analyzed" notu var mı?**
  Yeniden ücret alındı (ikinci −10), **önbellek yok**, **"already analyzed" benzeri not YOK**.
  Determinizm bu tool'da ayrıca ölçülmedi çünkü ikinci çağrı kasten farklı bir çekim üzerinde
  koşuldu; aynı iskele/kip için bayt-determinizmi `find_quick_wins`'te kanıtlandı (sha256 eşleşmesi).
  **Ölçülen daha değerli şey:** aynı site, aynı gün, farklı pencere → **10 sayfa → 1 sayfa** (B-4).
- **Kesik çekim "hiçbir şey kalmadı" uydurur mu?** Canlıda tam o şekil çıktı:
  `.../gaziemir-dis-klinikleri/ — 17 → 0 clicks` — ve H4'ün **her iki penceresi de 15.000 satır
  tavanındaydı**. Kod bunu biliyor (`format.ts:206-211`: *"this is also the shape a truncated pull
  manufactures"*) ve tavsiye "önce indexlenmeyi doğrula" diyor; ama cap uyarısı **listenin altında,
  ayrı bir footer satırı** olarak duruyor → B-3.

## 5. SEO güncelliği

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-4.6 (Helpful content system Mart 2024'te core'a girdi; ayrı bir sistem olarak listelenmiyor) | Repoda `helpful content` dizesi **hiç geçmiyor** (grep: `apps/mcp/src/` + `apps/web/content/docs/tools-reference/` → 0 eşleşme); ayrı bir kalite skoru üretilmiyor | **UYUYOR** | Referansın "10 değişiklik" listesindeki #2 riski (ayrı bir HCU skoru üretmek) bu tool'da **karşılıksız**. Tavsiyeler somut ve sisteme değil sayfaya bakıyor |
| R-6.4 (Scaled content abuse: değer katmadan generative AI ile çok sayfa üretmek yasaklı) | Tavsiyeler: `Refresh the content and add internal links` · `Re-target rather than tweak — check what ranks for this page's main query now, then rewrite against it` · `Check the page is still indexed, reachable and not redirected before rewriting anything` | **UYUYOR** | Hiçbir dal "toplu içerik üret" demiyor; en agresif dal bile TEK sayfayı yeniden hedeflemeyi öneriyor ve önce SERP'e bakmayı istiyor. R-6.4 ihlali yok |
| **R-6.9** (core update takvimi: Mart 2026 = 27 Mar · Mayıs 2026 = 21 May · Şubat 2026 Discover update = 5 Şub) | **Hiçbir yerde yok.** `grep -rni "core update"` → `apps/mcp/src/` ve `apps/web/content/docs/tools-reference/` üzerinde **0 eşleşme**. Karşılaştırma tarihleri hesaplanıyor ve BASILIYOR (footer), ama hiçbir takvimle kesiştirilmiyor | **AYKIRI — referansın bu tool için adlandırdığı BİRİNCİ risk, canlıda gerçekleşti** | Ölçülen kesişim: H4'ün önceki penceresi `2026-03-05..2026-06-02` **iki core update içeriyor**. Kavram üründe ZATEN VAR ve BİR DOSYA UZAKTA: `gsc-data/load.ts:120-125` bir çekimin neden 30 günde bayatladığını açıklarken *"seasonality, a redesign, **an algorithm update**"* diyor — yani neden karşılaştırmanın KENDİSİNE uygulanmadığı bir gözden kaçmadır, bilinçli bir karar değil → B-1 |
| R-7.3 (`dataState`) | Çekimden miras; `pull_gsc_data` `dataState` göndermiyor → satıcı varsayılanı `final` | **EKSİK (miras)** | Kök bulgu `pull_gsc_data` B-1. Bu tool için sonucu doğru (final veri), ama bağımlılık okunaksız |
| R-7.10 (en yeni veri preliminary; sonraki saatlerde değişir) | Çekimden miras: `GSC_FRESHNESS_LAG_DAYS = 3` (`windows.ts:23`) ve gerekçesi **tam bu tool'un başarısızlığını adıyla anıyor** (`windows.ts:8-13`: *"a window running up to today books a page's real traffic as real zeros and **analyze_content_decay reports a perfectly stable page as decaying** (M-20)"*); maliyeti `mdx:40`'ta | **UYUYOR — bu dilimin en iyi kapatılmış kuralı** | Kuralın bu tool için önemi diğer ikisinden büyük (yanlış SIFIR doğrudan "Nothing left" dalını tetikler) ve guard tam da o vakadan türetilmiş. Ayrıca guard'ın SINIRI da yazılı (5 güne kadar gecikmeye karşı ölçülmüş, ötesi açık) |

**Listede olmayan ve uydurulmayan:** "tıklama düşerken gösterim sabitse sebep SERP'tir" diye bir kural
referansta **YOKTUR**; B-2 bu yüzden bir SEO kuralı ihlali olarak değil, **tool'un elindeki veriyi
kullanmaması** (gösterim satırda duruyor, atılıyor) olarak ve R-7.12'nin ölçülmüş yarısına
dayandırılarak yazıldı. Aynı şekilde "pencere uzunluğuna göre ölçeklenmiş eşik" diye bir kural da yok —
B-4 tool'un KENDİ footer cümlesinin (`format.ts:50-58`, 13× aritmetiği) işaret ettiği boşluktur.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts` eşlemesi: **VAR** — `:37` `  analyze_content_decay: "report",`.
`CARDED_TOOLS` (`:62`) yalnız `get_credit_balance` → kart **planlı, sevk edilmemiş**.
Canlıda ölçüldü: H4/H7 yanıtları yalnız `result.content[0].text`; `structuredContent` YOK, `_meta` YOK.
**Sonda:** aynı oturumda `get_credit_balance` `structuredContent` **PRESENT** döndürdü.

Yapısal yarı hazır ve saklanıyor: `ContentDecayReport` (`runs.ts:89-94`) — `window` (iki aralık +
satır sayısı + `capped`), `total`, `top` (`{page, clicks_lost}`), `decays`. Kart sevk edilirse
**`window.capped` bayrağının kartta da görünmesi şart**: kartın en görünür alanı `top` olacak ve
canlıda ölçülen `17 → 0 clicks` tipi bir satır tam olarak kesik çekimin ürettiği şekildir (B-3) —
uyarı olmadan bir kartta gösterilirse metindeki caveat'tan bile daha az korur.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **VAR** — `:75` (`{ tool: "analyze_content_decay",
  idArg: "project_id", targetArg: null }`), senaryolar `:280` (S2, GSC bağlantısı yok) ve `:284` (S1)
- `goals/` hedefi gerekli mi: **EVET.** İki nedenle: (1) B-1 düzeltilip core-update takvimi çıktıya
  girerse, o takvim **bayatlayacak bir veridir** (R-6.9 bir tarih listesidir ve her yeni güncellemede
  uzar) — `goals/`a bağlanmazsa kaçınılmaz olarak eskir ve "10 değişiklik" listesinin #1 tuzağına
  (gömülü tarih/eşik cümlelerinin sessizce bayatlaması) düşer; (2) R-7.10 guard'ı bugün üç ayrı
  testle pinli ama hiçbir `goals/` hedefi onu adlandırmıyor, ve bu tool'un doğruluğu tümüyle ona
  dayanıyor

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, <YYYY-MM-DD>) |
|---|---|---|---|---|---|
| B-1 | **P1** | **Düşüş, core update takvimine bakılmadan içeriğe atfediliyor — referansın bu tool için adlandırdığı BİRİNCİ risk, canlıda gerçekleşti.** H4'te karşılaştırılan pencereler: current `2026-06-03..2026-08-31`, previous `2026-03-05..2026-06-02`. R-6.9'a göre **Mart 2026 core (27 Mar 2026)** ve **Mayıs 2026 core (21 May 2026)** güncellemelerinin ikisi de ÖNCEKİ pencerenin içinde, ve pencere sınırı ikincisinden ~13 gün sonra. On sayfa döndü ve **onunun da tavsiyesi sayfayı değiştirmek**: yedi "Refresh the content and add internal links", üç "Re-target rather than tweak", bir "Check the page is still indexed". Bir algoritma güncellemesinin bütün bir siteyi aynı anda düşürebileceği hiçbir yerde geçmiyor — `grep -rni "core update"` `apps/mcp/src/` + `apps/web/content/docs/tools-reference/` üzerinde **0 eşleşme**. **Kavram ÜRÜNDE VAR ve BİR DOSYA UZAKTA:** `gsc-data/load.ts:120-125` bir çekimin 30 günde neden bayatladığını açıklarken *"seasonality, a redesign, an algorithm update"* diyor — yani aynı ekip aynı gerçeği yazmış, ama karşılaştırmanın KENDİSİNE uygulamamış. **Şiddet P1: sayılar doğru, ATIF yanlış** — müşteri on sayfayı yeniden yazma işine girer ve sebep sayfalarında olmayabilir | Canlı H4 çıktısı (pencere tarihleri + 10 sayfa + üç tavsiye dalı); R-6.9 tarih listesi; `grep -rni "core update"` → 0; `gsc-data/load.ts:120-125` kavramın bir dosya uzakta oluşu; referans "Tool eşleme" satırı: *"Düşüşün core update takvimine bakılmadan içeriğe atfedilmesi"* | Analiz penceresi bilinen bir core/spam update tarihini KAPSIYORSA çıktı bunu **listenin BAŞINDA** söylesin ve tavsiyeleri şartlasın ("bu düşüşlerin ortak bir sebebi olabilir; sayfa sayfa yeniden yazmadan önce sitenin bütününe bakın"). **Takvim bir VERİDİR ve bayatlar** — koda gömülmemeli, `goals/`a bağlı ve tarihi/kaynağı yazılı bir listeden okunmalı (R-6.9'un kaynağı `status.search.google.com` geçmiş sayfasıdır). Ucuz ilk adım: takvim olmadan bile, **çok sayıda sayfanın aynı anda düşmesi** kendi başına bir sinyaldir ve tool bunu ölçebilir (canlıda 10/10) |  |
| B-2 | **P1** | **Çürüme YALNIZ tıklamadan ölçülüyor; gösterim satırda duruyor ve atılıyor.** `clicksByPage` (`content-decay.ts:50-57`) yalnız `row.clicks` topluyor; `GscRow` `impressions`'ı da taşıyor (`rows.ts:59-66`) ve kullanılmıyor. Sonuç: tool **"sıralamayı kaybettim"** (gösterim düştü) ile **"sıralamayı korudum, tıklamayı kaybettim"** (gösterim sabit, CTR düştü) arasını ayıramıyor — ve ikisine de **aynı** talimatı veriyor. Canlıda 10 sayfanın 8'i "Refresh the content and add internal links" / "Re-target" aldı ve **hiçbirinin yanında bir gösterim rakamı basılmadı**. R-7.12 ikinci durumun bugün neden sık olduğunu söylüyor: Generative AI raporunun verisi Performance'ın **`web` search type'ından** gelir, yani AI Overview gösterimleri bu sayıların İÇİNDEDİR ama tıklamaları değildir. "İçeriği tazele" bir SERP değişikliğinin cevabı değildir. **Şiddet P1: teşhis eksik, tedavi yanlış olabiliyor** — ve düzeltmek için yeni veri gerekmiyor, veri zaten saklanan çekimin içinde | `content-decay.ts:50-57` (`row.clicks` alınıyor, `row.impressions` atılıyor); `rows.ts:59-66` satırın gösterimi taşıdığı; canlı H4'te 10 satırın hiçbirinde gösterim yok; R-7.12 | Her çürüyen sayfa için gösterim de toplansın ve **tavsiye dalı ikisinin ORANINA göre seçilsin**: gösterim de düştüyse "sıralama kaybı" (mevcut refresh/re-target dilleri doğru), gösterim korunup tıklama düştüyse **ayrı bir dördüncü dal** — sayfa hâlâ görünüyor, kaybedilen tıklama; önce SERP'e bakılsın. Basılan satıra gösterim rakamının eklenmesi tek başına bile büyük kazanç: okur farkı kendisi görür. Eşik ÖNERİLMİYOR — referansta yok (§5 şerhi) |  |
| B-3 | **P2** | **Kesik çekimin UYDURDUĞU "Nothing left" satırı ile onu açıklayan caveat birbirinden uzakta.** Canlı H4: `.../gaziemir-dis-klinikleri/ — 17 → 0 clicks` ve tavsiye `→ Nothing left: 17 → 0 clicks. Check the page is still indexed, reachable and not redirected before rewriting anything.` — ve aynı çekimin **her iki penceresi de 15.000 satır tavanındaydı**. `format.ts:206-211` bunu tam olarak öngörüyor (*"this is also the shape a truncated pull manufactures (a page that fell out of the row cap's top rows reads as zero) … The footer's cap caveat is the other half of that guard"*), ama o "öbür yarı" **on satırlık bir listenin ALTINDA, üç satırlık bir footer'ın ikinci satırında** duruyor. İhtiyacı olan satır ile açıklaması arasında 20+ satır var. Ayrıca liste **tavansız** (`mdx:30`) — kesik bir büyük mülkte bu liste keyfi uzunlukta hayalet satır üretebilir | Canlı H4 çıktısı (`17 → 0` satırı, footer'daki cap uyarısı 22 satır aşağıda); `format.ts:206-211` kodun kendi öngörüsü; `gsc-discovery-shared.ts:210-213` footer sırası; `pull_gsc_data` B-2 (tavan doldu) | Çekim `capped` iken **"Nothing left" dalının kendi cümlesi** bunu söylesin ("…ya da bu sayfa çekimin üst satırlarından düştü — pull bu turda tavana ulaştı"). Satırın yanında, footer'da değil. Ucuz, ücretsiz, ve kodun zaten yazdığı gerekçenin uygulanması. Liste tavanı ayrıca değerlendirilsin: `find_quick_wins` tavan uyguluyor, bu tool uygulamıyor — aynı ailede iki politika |  |
| B-4 | **P2** | **Mutlak eşikler 13× değişen bir pencereye sabit uygulanıyor; aynı site aynı gün "10 sorun" ya da "1 sorun" veriyor.** `DECAY_MIN_ABS_DROP = 5` ve `DECAY_MIN_DROP_RATIO = 0.3` pencere uzunluğundan bağımsız. Canlıda ölçüldü: **aynı site (dentnotion.com), aynı gün (2026-09-03)**, 90 günlük pencerede **10 çürüyen sayfa**, 7 günlük pencerede **1**. Müşteri `days`'i alakasız bir sebeple seçmiştir (ör. "son haftaya bakayım") ve cevabın büyüklüğü o seçimle 10× değişiyor. `format.ts:50-58` bu aritmetiği (7 günde 90 güne göre ~13× daha sıkı) **zaten hesaplamış** ve çözüm olarak pencereyi BASMAYI seçmiş — yani sorun biliniyor, mitigasyon bir bildirim, ölçekleme değil | Canlı H4 (90 gün → 10 sayfa) vs H7 (7 gün → 1 sayfa), aynı site aynı gün; `content-decay.ts:24,26`; `format.ts:50-58` mevcut mitigasyonun kendi aritmetiği | Üç seçenek: (1) mutlak eşiği pencere uzunluğuna göre ölçekle (ör. günlük tıklama kaybı üzerinden) — davranışı değiştirir, ölçüm ister; (2) footer'ın pencere satırına eşiğin O pencerede ne anlama geldiğini ekle ("90 günde 5 tıklama kaybı"); (3) bilinçli kabul edilip dokümante edilsin. **En azından (2)** yapılmalı — bugün footer pencereyi söylüyor ama eşiği söylemiyor, yani okur 13× farkı çıkaramaz |  |
| B-5 | **P2** | **`threshold` gibi doğal bir anahtar sessizce reddediliyor + noktalama.** N13: `{"project_id":…,"threshold":0.5}` → `✖ Unrecognized key: "threshold" You were not charged.` Eşikler kodda sabit ve bir kullanıcının/modelin gevşetmek ya da sıkmak istemesi beklenir (özellikle B-4'ün 10× farkı yaşandıktan sonra); cevap ne eşiklerin sabit olduğunu ne de nerede tanımlandığını söylüyor. Ayrıca tek satırlık zod mesajı ile ücret cümlesi arasında ayırıcı yok — dilim 3'ün dört tool'unun dördünde de ölçüldü, `pull_gsc_data` B-7 / `audit_speed` (dilim 2) B-6 ile **aynı yüzey-geneli kusur** | §3 N13; dilim 3'ün diğer üç tool'unda birebir aynı (N4, N11, N12) | Noktalama yarısı `pull_gsc_data` B-7 ile TEK yerde kapanır. Eşik yarısı için: description ya da mdx eşiklerin sabit olduğunu ve **neden** sabit olduğunu söylesin (gerekçe `content-decay.ts:11-14`'te zaten yazılı, dışarı çıkmıyor). Şema değişmesin — `strict()` doğru davranıyor |  |

### Ölçülemeyenler (ve nedeni)

- **Kesilmemiş bir 90 günlük çekim üzerinde davranış** — dentnotion'ın her iki penceresi de 15.000
  satır tavanını doldurdu (`pull_gsc_data` B-2), yani ölçülen 10 çürümenin bir kısmı hayalet olabilir
  ve `17 → 0` satırı bunun en olası adayıdır. Ayırt etmek daha küçük bir mülkte ikinci bir ölçüm
  isterdi; kredi tavanı (2 çağrı) dentnotion'ın iki penceresine harcandı.
- **Aynı çekim üzerinde bayt-determinizmi** — bu tool'da ölçülmedi; ikinci çağrı kasten farklı bir
  çekim üzerinde koşuldu (pencere ekseni daha bilgilendiriciydi). Aynı iskele ve kip için bayt bayt
  determinizm `find_quick_wins`'te kanıtlandı (sha256 eşleşmesi, 7271/7271 bayt).
- **`gsc-discovery-runs.db.test.ts` / `gsc-discovery.db.test.ts` şeritleri** — Docker gerekiyor,
  koşulmadı (protokol izni). `ContentDecayReport`'un `gsc_discovery_runs`'a yazıldığı yalnız statik
  olarak doğrulandı.
- **B-1'in düzeltmesi için gereken takvimin BAKIM yolu** — R-6.9 bir tarih listesidir ve bu turda
  yalnız 2026-09-02 itibarıyla doğrulanmıştır; onu koda taşıyan bir düzeltmenin nasıl taze
  tutulacağı bir ürün/altyapı kararıdır ve bu turda ölçülmedi.
- **B-2'nin ayıracağı iki vakanın canlı örneği** — gösterim verisi çıktıda hiç basılmadığı için,
  ölçülen 10 sayfanın hangisinin "sıralama kaybı" hangisinin "CTR kaybı" olduğu **bu turda
  bilinemedi**. Bulgunun kendisi tam da budur.
