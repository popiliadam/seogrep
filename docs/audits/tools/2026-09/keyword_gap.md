# `keyword_gap` — tool kontrol kaydı (2026-09 turu)

> Dilim: 4 · İşçi: Opus 5 · Tarih: 2026-09-03 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | handler + zod + `keyword_gap: 45` + docs 3 yüzeyde tutarlı; `intersections:false` ile `target1`=rakip semantiği kaynakta yazılı |
| 2 Mutasyon | ÖLÇÜLDÜ | 5/5 KIRMIZI (fiyat, kapsam pini, target1/2 takası, organic pini, kesilme cümlesi) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 6 senaryo, 6 ücretsiz ret, defterde 0 satır |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (45+45), gerçek veri: 121 kesişim, `100 of 121` ve `5 of 121` |
| 5 SEO güncelliği | ÖLÇÜLDÜ | R-8.9 AYKIRI (hacim şerhi hiç yok) · R-8.8 İLGİSİZ (intent yüzeyi yok, 0 eşleşme) |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:27` → `"list"`; `CARDED_TOOLS`'ta DEĞİL |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | kayıt ✔ · `plan.mjs` EXCLUDED (gerekçesi kısmen bayat) · `goals/` gerekmiyor |

**Karar (ölçüm turu, 2026-09-03):** DÜZELTME GEREKLİ — tool mekanik olarak sağlam ve canlıda doğru veri
üretiyor, ama ödenen hacim rakamının Keyword Planner şerhi (yuvarlama + yakın varyantlar) üründe hiçbir
yerde söylenmiyor (R-8.9 açıkça uyarıyor).

**Karar (kapanış, YYYY-MM-DD):** _(düzeltme dalgası doldurur; ölçüm turunun kararı silinmez)_

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/keyword-gap.ts:253` (`makeKeywordGapTool`), port `apps/mcp/src/dfs/keyword-gap.ts:328`
- Zod şeması (alanlar, kısıtlar): `target` (targetField) · `project_id` (uuid) · `competitor` (`z.string().min(1)`,
  zorunlu) · `limit` (int 1–1000, default 100) · `language_code` (`min(2)`, default `"en"`) ·
  `location_code` (pozitif int, default `2840`). `additionalProperties:false` (canlı N4 ile doğrulandı).
- Description (birebir alıntı):
  > "Find the Google organic keywords a competitor ranks for and your domain does not — each with its monthly search volume, the competitor's position, the page holding that ranking, keyword difficulty and CPC. Pass a target domain (any public domain) or a project_id, plus one competitor. Synchronous — returns the list immediately. Costs 45 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:70`, birebir): `keyword_gap: 45,`
- Docs sayfası (`apps/web/content/docs/tools-reference/keyword-gap.mdx`):
  - satır 6 birebir: `**Cost:** 45 credits.`
  - satır 64 birebir: `One gap is **one** DataForSEO request, charged **once**, as a single tool call. If it fails, the whole call fails and **you are not charged** — a half-built list is never billed. Rankings are read for the United States in English unless you pass `location_code` and `language_code`.`
  - satır 17 birebir: `- **Search volume** — average monthly Google searches, and the order the list is sorted in, biggest opportunity first.`
- Vendor isteği gövdesi (`dfs/keyword-gap.ts:344-358`): `target1`=RAKİP, `target2`=çağıranın domaini,
  `intersections:false`, `item_types:["organic"]`, `limit`, `language_code`, `location_code`,
  `order_by:["keyword_data.keyword_info.search_volume,desc"]`. Uç:
  `/v3/dataforseo_labs/google/domain_intersection/live`.
- Maliyet tahmini: `estimateKeywordGapUsd(limit) = ($0.012 + limit×$0.00012) × 1.5`; gerçek maliyet
  yanıtın `cost` alanından `settleSpend` ile kapatılıyor (`dfs/keyword-gap.ts:367`).
- Yanıt ayrıştırıcı: `gapResultSchema` — her metrik `nullish`; `second_domain_serp_element` KASTEN
  okunmuyor (`intersections:false` modunda yapısal olarak yok, satır 230-233).
- Tutarsızlıklar: **yok** — description'daki 45, `costs.ts:70` ve docs satır 6 üçü de aynı; `limit`
  şema açıklaması ile docs satır 52 birebir aynı cümle; `KEYWORD_GAP_MAX_LIMIT`/`DEFAULT_KEYWORD_GAP_LIMIT`
  şemaya sabit olarak değil, port'tan import edilerek giriyor (drift yapısal olarak engelli).
- Fiyatın `limit`'ten bağımsız oluşu ÖLÇÜLDÜ ve bir tutarsızlık DEĞİL: iki canlı çağrı (5 satır ve 100
  satır) defterde ikisi de −45. İmzalı düz fiyat; docs "Cost: 45 credits" diyerek bunu doğru anlatıyor.
- Seçilebilirlik: "rakibimin sıralandığı, benim sıralanmadığım kelimeler" cümlesinde seçilir.
  Karışabileceği komşular: `compare_competitors` (aynı soru, ÇOKLU rakip ve farklı eksen),
  `link_gap` (aynı soru, backlink ekseninde, aynı 45 fiyat), `ranked_keywords` (tek domainin KENDİ
  sıralamaları — gap değil), `discover_keywords` (rakipsiz keşif). Ayırt edici cümle description'ın
  ilk satırında ("a competitor ranks for and your domain does not") net.

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Taban: **155 dosya / 4016 test, 0 fail**
(`…/scratchpad/dilim4/logs/baseline.log`).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M-KG1 | `costs.ts:70` `keyword_gap: 45` → `44` | fiyat pini | **KIRMIZI** (2) | `costs.test.ts > matches the approved v0 literals exactly` + `keyword-gap.test.ts > advertises its name, the 45-credit cost…` · `logs/m-kg1.log` |
| M-KG2 | `keyword-gap.ts:292` ücret meta'sından `projectId` düşürüldü | H-1 kapsam pini | **KIRMIZI** (2) | `handler-charge-scope-coverage.pin.test.ts` + `rankings-project-scope.pin.test.ts > 'keyword_gap' records which project its spend was for (H-1)` · `logs/m-kg2.log` |
| M-KG3 | `dfs/keyword-gap.ts:349-350` `target1`/`target2` takas edildi (ters soru, aynı fiyat) | vendor gövde pini | **KIRMIZI** (1) | `dfs/keyword-gap.test.ts > sends the COMPETITOR as target1 and the caller's domain as target2, non-intersecting` · `logs/m-kg3.log` |
| M-KG4 | `dfs/keyword-gap.ts:352` `item_types: ITEM_TYPES_ORGANIC` gövdeden silindi (vendor default'u `["organic","paid"]`) | organic pini | **KIRMIZI** (1) | `dfs/keyword-gap.test.ts > pins organic-only items, the requested limit, the locale and the volume ordering` · `logs/m-kg4.log` |
| M-KG5 | `keyword-gap.ts:133-138` vendor-sessizliği dalı `return ""` yapıldı (kısa liste tam listeymiş gibi okunur) | kesilme dürüstlüğü | **KIRMIZI** (1) | `keyword-gap.test.ts > F3 … says the vendor sent no total, rather than letting the list read as complete` · `logs/m-kg5.log` |

**5/5 KIRMIZI — yeşil kalan mutasyon yok.** Bu tool'un fiyatı, kiracı/proje kapsamı, vendor gövdesinin
iki semantik pini ve kesilme cümlesi gerçekten ölçülüyor.

Çalışma ağacı sonunda temiz — `git diff --stat` çıktısı: **(boş)**. Geri alma sonrası kapı yeniden
**4016 passed (4016)** (`logs/restore.log`).

`*.db.test.ts` şeritleri (`keyword-gap.db.test.ts`) Docker ister — **KOŞULMADI, db şeridi CI/hakem**.

## 3. Canlı negatif yol

Uç: `MCP_SMOKE_URL` (redakte). Ham kayıt aşağıda. Defter her senaryodan sonra okundu.

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| KG-N1 rakip = kendi domaini | `project_id`=adstark, `competitor:"adstark.com.tr"` | 200 / `isError:true` | **0** | `SELF_COMPETITOR_MESSAGE` birebir; normalizer RESOLVED target'a karşı çalışıyor (proje yolu da kapalı) |
| KG-N2 geçersiz domain | `competitor:"bu bir domain degil !!"` | 200 / `isError:true` | **0** | `"…" is not a valid domain or URL. You were not charged.` — `withNoChargeNote` ekli |
| KG-N3 uydurma project_id (uuid değil) | `project_id:"11111111-…"` | 200 / `isError:true` | **0** | zod `Invalid UUID` — reserve'e hiç ulaşmıyor |
| KG-N4 bilinmeyen alan | `depth:50` eklendi | 200 / `isError:true` | **0** | `Unrecognized key: "depth"` → `additionalProperties:false` doğrulandı |
| KG-N5 hem `target` hem `project_id` | ikisi birden | 200 / `isError:true` | **0** | "not both — they can name different domains and SeoGrep will not guess" |
| KG-N6 geçerli ama YABANCI uuid | `project_id:"9f1c2d3e-…"` | 200 / `isError:true` | **0** | `No project found with id …` — **başkasının projesi ile hiç olmayan proje aynı cevabı veriyor** (kiracı sızıntısı yok) |

**Defter kanıtı:** negatiflerden ÖNCE `595 entries`, tüm negatiflerden SONRA hâlâ `595 entries`
(`list_credit_activity`). Altı ücretsiz retten **hiçbiri** defterde satır açmadı; charge+refund çifti de yok.

## 4. Canlı mutlu yol

Rakip seçimi (operatörden gelmedi, `compare_competitors` ÇAĞRILMADI): **sempeak.com**.
Gerekçe — ölçüldü, varsayılmadı: `adstark.com.tr` `<title>` = "Dijital Pazarlama ve Reklam Ajansı - Adstark";
`sempeak.com` `<title>` = "Sempeak | Dijital Pazarlama ve SEO Ajansı", `<html lang="tr">`, meta açıklaması
"performans pazarlaması ve SEO ajansı". Aynı sektör (TR dijital pazarlama/reklam ajansı), aynı dil, aynı
pazar. Sınanan diğer adaylar DNS/HTTP'de düşmüştü (`dijitalasistan.com.tr`, `adcolony.com.tr`,
`performics.com.tr` vb. → `000`); `relevancedigital.com` ayakta ama Atina/Selanik merkezli (sektör aynı,
pazar değil) — bu yüzden seçilmedi.

| senaryo | argüman | envelope | kredi Δ | çıktı özeti |
|---|---|---|---|---|
| KG-P1 varsayılan limit | adstark `project_id` vs `sempeak.com`, `language_code:"tr"`, `location_code:2792` | 200 / ok | **−45** `project: adstark.com.tr` | Başlık: `100 of 121 keywords sempeak.com ranks for and your project "adstark.com.tr" does not, highest search volume first`. 100 satır; her satır hacim + rakip pozisyonu + difficulty + CPC + rakip URL + ETV |
| KG-P2 küçük limit | aynı + `limit:5` | 200 / ok | **−45** `project: adstark.com.tr` | Başlık: `5 of 121 keywords …`. İlk 5 satır KG-P1'in ilk 5'i ile birebir aynı (sıralama deterministik) |

Ölçülen içerik (kişisel veri yok, hepsi kamuya açık SERP verisi):
- **Kesişim sayısı:** vendor 121 toplam bildirdi; iki çağrı da aynı `total_count`'u verdi.
- **Hacim yuvarlaması gözle görülür:** 40.500 · 22.200 · 14.800 · 9.900 · 8.100 (×2 farklı kelime) ·
  5.400 (×3 farklı kelime) · 4.400 · 3.600 (×3). Keyword Planner'ın kova değerleri (R-8.9).
- **Intent:** çıktıda intent/niyet alanı **YOK** (hiçbir satırda).
- **Lokasyon:** tek `location_code` per çağrı — farklı lokasyonların hacimleri toplanmıyor (R-8.9'un
  asıl uyarısı bu üründe yapısal olarak karşılıksız).
- **Vendor maliyeti:** `settleSpend` yanıtın kendi `cost`'undan kapatıyor; tool çıktısı vendor maliyetini
  KULLANICIYA basmıyor (tasarım — kredi fiyatı düz 45).
- **Kesilme cümlesi `limit`'i ADLANDIRMIYOR:** `5 of 121` ve `100 of 121` doğru sayılar, ama hiçbiri
  listenin neden durduğunu (varsayılan mı, çağıranın `limit`'i mi, vendor tavanı mı) söylemiyor → G-2.

**Defter (birebir):**
`2026-09-03T19:41:55 · -45 credits · charge · keyword_gap · project: adstark.com.tr`
`2026-09-03T19:41:33 · -45 credits · charge · keyword_gap · project: adstark.com.tr`
İki satır da `project: <domain>` kapsamı taşıyor (Dilim 3 H-1 ailesi **UYUYOR**). Refund yok.
DFS "daily cap" reddi **görülmedi**.

Ham kayıt: `/private/tmp/claude-501/-Users-apple-dev-pseo-web-saas/ed07ad51-99ee-4158-ba60-03e288098193/scratchpad/dilim4/canli/raw.jsonl` (anahtar `makeRedactor` ile redakte).

## 5. SEO güncelliği

Referans "Tool eşleme" satırı: `keyword_gap | R-8.8, R-8.9 | Farklı lokasyonların yuvarlanmış hacimlerinin toplanması (R-8.9 açıkça uyarıyor)`.

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-8.8 (intent taksonomisi: 4 değer, 0–1 olasılık, ≤1.000 kw/istek) | Hiç yok. `grep -niE "intent" dfs/keyword-gap.ts tools/keyword-gap.ts` → **0 eşleşme**; canlı çıktının 100 satırının hiçbirinde intent yok | **İLGİSİZ** | Tool intent yüzeyi taşımıyor, dolayısıyla bayatlayacak bir taksonomi de yok. `limit` tavanı 1.000 = R-8.8'in istek başına sınırıyla zaten aynı. **Referans satırı düzeltilmeli** (Dilim 3'ün `keyword_positions`/R-8.6 için yaptığı şerhin aynısı) |
| R-8.9 (hacim = kelime + YAKIN VARYANTLARI, 12 aylık ortalama, YUVARLANMIŞ; tarihsel yalnız exact match) | Hacim `"40,500 searches/mo"` diye düz basılıyor. Kaynakta şerh **yok**: `grep -niE "round\|close variant\|exact match\|12.month\|average" tools/keyword-gap.ts` → 3 eşleşme, **üçü de yanlış pozitif** (`Math.round` satır 107, "background job" satır 29, "around it" satır 273). Docs satır 17 yalnız "average monthly Google searches" diyor — ortalamayı söylüyor, yuvarlamayı ve yakın-varyant kapsamını söylemiyor | **AYKIRI** | Referansın adlandırdığı "farklı lokasyonların toplanması" riski bu tool'da karşılıksız (tek lokasyon). Ama şerhin KENDİSİ hiç yok, ve canlı veri yuvarlamayı gözle gösteriyor (8.100 iki kelimede, 5.400 üç kelimede aynı). Aile geneli: `research-keywords.ts`'te de aynı grep **0 eşleşme** — kardeş tool da taşımıyor. **H-1 (hakem turu, 2026-09-03):** aynı R-8.9 kalemi bu dilimde dört kayıtta ölçüldü (`research_keywords` RK-1 · `discover_keywords` DK-2 · bu kaydın G-1'i · `ranked_keywords` B-3) ve üç farklı şiddetle yazılmıştı. Tek bant: **çıplak açıklama boşluğu P2, ölçülmüş iddia hatası P1** — G-1 P2 tarafına düşer |

Diğer R-x.y satırları `keyword_gap`'i adlandırmıyor. `D-x` kalemleri kural değildir, işlenmedi.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:27` → `keyword_gap: "list"`. Eşleme **VAR**.
`CARDED_TOOLS` (satır 62) bugün yalnız `get_credit_balance` içeriyor, `keyword_gap` **DEĞİL** — yani
eşleme var ama kart çizilmiyor (bu ailenin tamamı için doğru olan durum).
Canlı payload kartın isteyeceği yapısal alanları taşıyor: her satır ayrık bir kalem (keyword) ve
kalem başına `search_volume` / `competitor_position` / `keyword_difficulty` / `cpc` / `competitor_url` /
`competitor_etv` — bir `list` kartının satır+metrik yapısına birebir oturur. Başlık satırı da kartın
üst şeridi için hazır (`N of M`).

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK — EXCLUDED** (satır 128):
  `keyword_gap: "paid, 45 credits/call. Also requires a competitor domain per site — a per-site input the matrix does not yet carry."`
  Gerekçenin **ikinci yarısı hâlâ doğru** (matris rakip domain taşımıyor — bu turda rakip elle seçildi).
  Gerekçe "budget signature" demiyor, dolayısıyla 2026-09-02 "kredi sınırımız yok" kararından
  bayatlamadı. → G-4'te yalnız kısmi güncelleme öneriliyor.
- `goals/` hedefi gerekli mi: **HAYIR** — tool ücretli ve kullanıcı-tetiklemeli; kalıcı bir canlı-uç
  hedefi her koşuda 45 kredi yakardı. Mutasyon kapsaması 5/5 zaten paket kapısında.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, YYYY-MM-DD) |
|---|---|---|---|---|---|
| G-1 | ~~**P1**~~ → **P2** (hakem turu, 2026-09-03) | **Ödenen hacim rakamının Keyword Planner şerhi üründe hiçbir yerde yok (R-8.9).** Çıktı `"40,500 searches/mo"` diyor; bunun (a) kelimenin **ve yakın varyantlarının** toplamı, (b) **12 aylık ortalama**, (c) **yuvarlanmış** bir değer olduğu ne kaynakta ne docs'ta söyleniyor. Liste ayrıca bu rakama göre SIRALANIYOR, yani okuyucu yuvarlanmış kovalara göre önceliklendiriyor | `grep -niE "round\|close variant\|exact match\|12.month\|average" apps/mcp/src/tools/keyword-gap.ts` → 3 eşleşme, üçü de yanlış pozitif (`Math.round`:107, "background job":29, "around it":273). Docs `keyword-gap.mdx:17` yalnız "average monthly Google searches". Canlı KG-P1: 8.100 iki ayrı kelimede, 5.400 üç ayrı kelimede — kova değerleri | Satır render'ına değil, BAŞLIĞA tek cümlelik şerh: hacmin yakın varyantları kapsadığı, 12 aylık ortalama olduğu ve yuvarlandığı. `research_keywords` de aynı şerhi taşımıyor (ölçüldü) — düzeltme **aile geneli** yapılmalı, yoksa iki tool aynı rakamı iki farklı dürüstlükle basar. **Şiddet düzeltmesi (hakem turu, 2026-09-03): P1 → P2** — bu bir ÇIPLAK AÇIKLAMA boşluğudur (bare disclosure): basılan rakam vendor'ın kendi rakamıdır, ürün ondan yeni bir sayı türetmiyor ve referansın adlandırdığı asıl risk (farklı lokasyonların toplanması) bu tool'da yapısal olarak karşılıksız (tek `location_code`). Hakem bandı (H-1): bare disclosure P2, ölçülmüş iddia hatası P1 — P1 tarafında kalanlar `research_keywords` RK-2 (yuvarlanmışları toplayıp yeni bir "total" basmak) ve `discover_keywords` DK-2 (ölçülen sıralama iddiası) | |
| G-2 | P2 | **Kesilme cümlesi `limit`'i adlandırmıyor.** `5 of 121` ve `100 of 121` doğru, ama listenin neden durduğunu söylemiyor: okuyucu 100'ün vendor tavanı mı, tool varsayılanı mı, kendi `limit`'i mi olduğunu ayırt edemiyor | Canlı KG-P1 (`limit` yok → `100 of 121`) ↔ KG-P2 (`limit:5` → `5 of 121`); `renderGapHeader` `keyword-gap.ts:155-169` `limit`'i hiç okumuyor | Başlığa nedeni ekle — "(limit 5; ask for more with `limit`)". `renderGapTotalNote`'un vendor-sessizliği dalı zaten bu ailede doğru kurulmuş, eksik olan yalnız KİM kesti bilgisi | |
| G-3 | P2 | **`project_id` verilse bile locale varsayılanı projeden türemiyor:** `language_code:"en"`, `location_code:2840` (ABD). Türk bir projenin gap'i, çağıran açıkça geçersiz kılmazsa ABD/İngilizce ölçülür — ücretli ve sessizce yanlış pencere | `keyword-gap.ts:81-87` şema varsayılanları ↔ `resolveTarget` projeyi çözüyor ama locale okumuyor. Docs `keyword-gap.mdx:64` bunu açıkça yazıyor ("Rankings are read for the United States in English unless…"), yani belgeli — ama proje-kapsamlı çağrıda yine de sessiz varsayılan | Proje kayıtlı bir locale taşıyorsa varsayılan ondan türetilsin; türetilemiyorsa başlıkta "measured for location 2840 (United States) — pass `location_code` to change" gibi bir uyarı. Bu turda ölçüm bilerek `tr`/`2792` ile yapıldı. **SINIF ATFI (hakem H-3, 2026-09-03) — bu bulgu tek başına değil, LOKAL-VARSAYILAN sınıfının üyesidir (P1 sınıf):** ölçülmüş kardeşi `my_pages` A-2 (iki ücretli çağrının ikisi de en/2840'ta 1 satır döndürdü — 2 × 40 kredi zarar ÖLÇÜLDÜ); azaltıcıyı taşıyan tek tool `ranked_keywords` (`twoLetterTld` + `localeHint`, ağaçta tek sahibi); ölçülmemiş dördüncü üye `discover_keywords` `for_site`. Düzeltme tool başına değil SINIF olarak kesilmeli, yoksa aynı kusur dört kez ayrı ayrı açılır (bkz. `_DILIM4-HAKEM-SINIFLAR.md` sınıf 4) | |
| G-4 | P2 | `plan.mjs` EXCLUDED gerekçesi **kısmen** bayat: "requires a competitor domain per site — a per-site input the matrix does not yet carry" hâlâ doğru, ama bu tur rakibin ölçülebilir biçimde seçilebildiğini gösterdi (sektör + dil + canlı HTTP doğrulaması ile), yani engel "imkânsız" değil "matriste alan yok" | `scripts/testing/plan.mjs:128` ↔ bu kaydın §4 rakip seçim gerekçesi | Matrise site başına `competitor` alanı eklenirse tool PLAN'a alınabilir; alınmayacaksa gerekçe "matris alanı eklenene kadar" diye tarihlensin | |
| G-5 | P2 | **Referans listesi `keyword_gap`'i R-8.8'e eşliyor ama tool'da intent yüzeyi yok** — bayat olmayan, hiç var olmayan bir riski işaret ediyor | `grep -niE "intent"` iki kaynak dosyada 0 eşleşme; canlı 100 satırda intent yok | Referansın "Tool eşleme" satırına Dilim 3'ün R-8.6 şerhi biçiminde not: `R-8.8 İLGİSİZ — ölçüldü 2026-09-03: tool intent okumuyor/basmıyor`. Intent bir gün eklenirse eşleme geri açılır | |

`durum` sütunu ölçüm turunda BOŞ bırakılmıştır; kapatan tur doldurur.
