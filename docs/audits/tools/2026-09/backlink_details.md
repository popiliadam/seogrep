# `backlink_details` — tool kontrol kaydı (2026-09 turu)

> Dilim: 5 · İşçi: Opus 5 · Tarih: 2026-09-04 · Referans: `docs/reference/2026-09-02-seo-referans-listesi.md`
> Kural: her adımın sonucu ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / ATLANDI olarak yazılır. "Geçti" yalnız kanıt satırıyla geçer.
> Kredi satırı, docs cümlesi, description: burada ALINTI yapılır, özetlenmez.

## Özet

| adım | sonuç | tek satır kanıt |
|---|---|---|
| 1 Statik | ÖLÇÜLDÜ | 35 kredi düz (`costs.ts:89`); 700+200 satır kapağı imzalı fiyattan TÜRETİLİYOR; çıktı tavanı 28.000 kr VAR |
| 2 Mutasyon | ÖLÇÜLDÜ | 5 mutasyon → **5 KIRMIZI, 0 YEŞİL**; ama DK-3 ekseninin YALNIZ YARISI pinli (M-BD6, aşağıda) |
| 3 Canlı negatif | ÖLÇÜLDÜ | 6 senaryo, 6 ücretsiz ret, defterde 0 satır |
| 4 Canlı mutlu yol | ÖLÇÜLDÜ | 2 ücretli çağrı (−35 `project:` + −35 `no project scope`); **boş link penceresi hiçbir şey söylemedi** |
| 5 SEO güncelliği | ÖLÇÜLDÜ | **R-6.2 AYKIRI** (satıcının `attributes` dizisi hiç ayrıştırılmıyor) · R-6.1 KISMEN UYUYOR |
| 6 Kart | ÖLÇÜLDÜ | `card-map.ts:23` → `"list"`; `CARDED_TOOLS`'ta DEĞİL |
| 7 Kanıt üçlüsü | ÖLÇÜLDÜ | kayıt ✔ · `plan.mjs` EXCLUDED, **gerekçe BAYAT** ("Needs a budget signature") · `goals/` gerekmiyor |

**Karar (ölçüm turu, 2026-09-04):** DÜZELTME GEREKLİ — bu tool ailenin en özenli yazılmış üyesi
(pencere/bütün-küme ayrımı, iki spam skorunun satıcı yazımıyla korunması, çıktı tavanı, "bunlar için
de ödediniz" cümlesi — hepsi ölçüldü ve hepsi çalışıyor), ama **ödenen bir çağrının link penceresi
boş döndüğünde cevap o pencere hakkında TEK KELİME etmiyor** ve modülün kendi "nothing measured is
lost" gerekçesi ölçülünce yanlış çıktı.

**Hakem kararı (taze Fable, 2026-09-04): FAIL (dar) — kayıt DÜZELTİLDİ, geri çekilmedi.** Tek FAIL
sebebi BD-6'nın düzeltme sütunundaki ölçülmemiş iddiaydı ("onarım M-BD6'nın kırdığı testin ledger
iddiasını da değiştirir"); hakem gerçek onarımı koştu → **4130/4130 YEŞİL** (H15), yani bu portta
onarım hiçbir testi kırmıyor. Asıl bulgu bunun tersidir ve kayıtta YOKTU: status/actualUsd ekseni
**PİNSİZ**. Düzeltme BD-6'ya işlendi. Ayrıca: şiddet bandı uygulandı (BD-2 P1→P2, BD-3 P1→P2,
BD-6 P2→P1), BD-1'in "ulaşılamaz" cümlesi nitelendi, DK-3 şekil haritası (H-2) §2'ye girdi.
Ölçüm turunun metni SİLİNMEDİ.

**Karar (kapanış, 2026-09-04):** **KISMEN DÜZELTİLDİ** (dilim 5 düzeltmesi, #227 · #228 · #229; BD-8 için #230 merge bekliyor) — dört bulgu kapandı (BD-1 canlı ✔, BD-2, BD-3, BD-6, BD-7). **Kalan:** BD-4 ve BD-5 **AÇIK — iş emrine hiç girmedi**; **BD-8 yeni** ve `main`'de henüz YOK. Ölçüm turunun kararı yukarıda durur, silinmedi (ders 16).

## 1. Statik okuma

- Handler: `apps/mcp/src/tools/backlink-details.ts:417` (`makeBacklinkDetailsTool`), `charge: "handler"`.
  Port: `apps/mcp/src/dfs/backlink-details.ts:553` (`createLiveBacklinkDetailsClient`), çözücü `:635`.
  Biçimlendirici saf: `formatBacklinkDetails` (`:359`), yardımcıları `renderWindowCaption` (`:170`),
  `renderBacklinkRow` (`:206`), `renderTargetPageRow` (`:219`), `renderOutputLimitNote` (`:306`).
- Zod şeması: `target` (`targetField("list individual backlinks for")`) · `project_id` ·
  `limit` (`int().min(1).max(MAX_BACKLINK_DETAIL_ROWS=700).default(DEFAULT_BACKLINK_DETAIL_ROWS=50)`) ·
  `offset` (`int().min(0).max(MAX_BACKLINKS_OFFSET=20_000).default(0)`) ·
  `page_limit` (`int().min(1).max(MAX_TARGET_PAGE_ROWS=200).default(DEFAULT_TARGET_PAGE_ROWS=20)`).
  `additionalProperties:false` — canlı BD-N2 ile doğrulandı. **Beş sayının beşi de port'tan import**,
  şemada literal yok. Varsayılan ≠ maksimum (kardeşi `analyze_backlinks`'in aksine).
- Description (birebir alıntı, canlı `tools/list` ile birebir aynı):
  > "List a site's individual backlinks — who links, from which page, to which page of the site, with what anchor — plus the site's own pages ranked by the links they earned. Pass a target domain (any public domain) or a project_id, and page through the link list with limit and offset. Synchronous — returns both lists immediately. Costs 35 credits. Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so and charges nothing."
- Kredi satırı (`apps/mcp/src/credits/costs.ts:89`, birebir): `  backlink_details: 35,`
  Üstündeki imza yorumu (`:80-88`) satır kapağını fiyata BAĞLIYOR, birebir alıntı:
  `// margin band (MAX_BACKLINK_DETAIL_ROWS 700 + MAX_TARGET_PAGE_ROWS 200 = 900 billed rows,`
  `// dfs/backlink-details.ts) are part of the signed price, not a soft limit`
- Docs sayfası (`apps/web/content/docs/tools-reference/backlink-details.mdx`, üretiliyor:
  `apps/web/scripts/gen-tool-docs.mjs:2664`):
  - satır 6 birebir: `**Cost:** 35 credits.`
  - satır 71 birebir (kısmi): `**\`limit\` and \`page_limit\` are display controls, not price controls.** This call costs the same whatever you ask for, and asking for fewer rows saves you nothing: DataForSEO's own bill for this endpoint is nearly all a flat per-request fee — measured on one profile, nineteen times the rows cost thirteen per cent more.`
  - satır 77 birebir: `Every delivered lookup is **recorded**: SeoGrep keeps a row saying what was looked up, when, under which settings, and a capped summary of what came back.` ← **"capped" yazıyor, doğru** (kaynak yorumunun aksine — BD-2)
- DFS adaptörü — **iki uç, tek mantıksal arama** (`dfs/backlink-details.ts:60-62`):
  `/v3/backlinks/backlinks/live` · `/v3/backlinks/domain_pages_summary/live`. Gövdeler (`:589`, `:601`):
  ikisinde de `target`, `limit`, `backlinks_status_type:"live"`, `include_subdomains:true`,
  `rank_scale:"one_thousand"`; link ucunda ayrıca `offset` ve `mode:"as_is"` (gruplayan
  `one_per_domain`/`one_per_anchor` yerine açıkça pinli), `order_by:["rank,desc"]`; sayfa ucunda
  `order_by:["backlinks,desc"]` ve **offset GÖNDERİLMİYOR** (`:580-581`: sayfa listesi bir genel
  bakış, sayfalanan bir akış değil — canlı BD-P3 bunun sonucunu gösterdi).
- Maliyet tahmini: `estimateBacklinkDetailsUsd(link, page)` = her istek için
  `(DFS_BACKLINKS_REQUEST_USD + satır × DFS_BACKLINKS_ROW_USD) × BUDGET_SAFETY_FACTOR(1.5)`, tarife
  `backlink-changes.ts`'ten IMPORT (`:3` — ikinci bir kopya bilerek yok). Marj aritmetiği
  `:139-148`'de yazılı: 35 kredi × $0,0124 = $0,4340 gelir ÷ $0,0804 en kötü satıcı = **5,40×**,
  imzalı taban 5,2×. Satıcının kendi 1000+1000 tavanında 3,6×'e düşer — kapak bu yüzden 700/200.
- Ayrıştırıcı: `backlinkItemSchema` (`:327`) on iki alan okuyor. **Satıcının aynı item'da gönderdiği
  `attributes` dizisi şemada YOK** — §5, BD-3. `dofollow` `boolean|null` olarak korunuyor
  (`false` gerçek veri, yokluk değil). Boş `anchor` `""`, `item_type` "neden boş" diye yanına basılıyor.
  `domain_from`/`url`'ü olmayan satır düşürülüyor.
- Çıktı tavanı **VAR** (`:275-277`): `MAX_RENDERED_OUTPUT_CHARS = 28_000`,
  `LINK_LIST_CHAR_BUDGET = 20_000`, `TARGET_PAGE_LIST_CHAR_BUDGET = 5_000`. Gerekçe `:246-274`'te
  ÖLÇÜMLE yazılı (2026-08-25: 62.729 karakter, istemci reddi, 35 kredi + $0,055 alındı).
  **Canlı ölçüm gerekçedeki "~320 karakter" iddiasını doğruladı: gerçek ortalama 318 karakter/satır.**
- **Tutarsızlık: bir tane, ve gerekçe cümlesinde** → BD-2 (aşağıda). Fiyat ekseninde tutarsızlık yok:
  `costs.ts:89` = 35, description "Costs 35 credits", mdx satır 6 "35 credits", canlı defter −35 ×2.
- Seçilebilirlik: "kimler bana link veriyor / hangi sayfalarıma link geliyor / linklerimi tek tek göster"
  cümlesinde seçilir. Komşular ve karışma riski `analyze_backlinks` kaydının §1'inde (AB-6): iki
  description birbirini ADIYLA anmıyor, ayrım yalnız docs sayfasında. Bu tool YANLIŞ seçilirse
  müşteri 35 yerine 70 kredi öder (ya da tersi, satır isterken toplam alır).

## 2. Mutasyon (test gerçekten bakıyor mu)

Kapı: `pnpm --filter @pseo/mcp test`. Taban: **160 dosya / 4130 test** (`logs/baseline.log`;
`server.test.ts` tek flake, dosya tek başına 106/106 PASS). Geri alma sonrası **4130 passed (4130)**,
exit 0 (`logs/restore.log`).

| # | kırılan şey (kaynak, satır) | beklenen kırmızı test | sonuç | not |
|---|---|---|---|---|
| M-BD1 | `credits/costs.ts:89` `backlink_details: 35` → `36` (NEVER #6 imzalı sabit) | fiyat pini | **KIRMIZI** (4) | `costs.test.ts > TOOL_COSTS pin (NEVER #6 human-approval gate) > matches the approved v0 literals exactly` + `backlink-details.test.ts > backlink_details tool metadata > advertises its name, the 35-credit cost…` + `> S14 — the limit description states measured billing behaviour > names the flat credit price the caller actually pays…` + **`link-gap.test.ts > S14 … > names the tool that DOES carry the linking pages, and that it is a separate paid lookup`** (komşu tool'un metni bu fiyatı anıyor) · `logs/m-bd1.log` |
| M-BD2 | `backlink-details.ts:443` ücret meta'sından `projectId` düşürüldü (**Sınıf 2 / NEVER #4**) | kapsam pini | **KIRMIZI** (2) | `backlinks-project-scope.pin.test.ts > 'backlink_details' records which project its spend was for (H-1) > reserves against the project the call named` + `handler-charge-scope-coverage.pin.test.ts > names a project at every call site that has one to name` · `logs/m-bd2.log` |
| M-BD3 | `dfs/backlink-details.ts:420` `dofollow: item.dofollow ?? null` → sabit `null` (**R-6.2 ekseni**) | ayrıştırıcı + tüketici pini | **KIRMIZI** (10) | `dfs/backlink-details.test.ts` ×2 (`projects the vendor's own example items to link rows`, `keeps a vendor ZERO and a vendor FALSE as data, not as absence`) + **`disavow-candidates` ailesinden 8 test** (`counts dofollow links by the vendor's own boolean, not by presence` dahil) — alan iki tool tarafından paylaşılıyor · `logs/m-bd3.log` |
| M-BD4 | `backlink-details.ts:186` pencere başlığı yasak `"N of M"` biçimine çevrildi | pencere/bütün-küme ayrımı | **KIRMIZI** (10) | `backlink-details.test.ts > renderWindowCaption …` ×5 (aralarında `never joins the two counts with an 'of', the way a head-of-list caption would`) + `formatBacklinkDetails` ×4 + `disavow-candidates.test.ts` ×1 · `logs/m-bd4.log` |
| M-BD5 | `backlink-details.ts:276` `LINK_LIST_CHAR_BUDGET` 20.000 → 20.000.000 (**kesilme/tavan ekseni**) | çıktı tavanı pini | **KIRMIZI** (4) | `backlink-details.test.ts > S14 — the reply is bounded so the client can display it >` `keeps the measured limit-200 / page_limit-9 shape inside the output ceiling` + `holds the ceiling at the widest window the schema permits` + `says how many rows were fetched and not printed, and that they were paid for` + `points at offset, not at a narrower window…` · `logs/m-bd5.log` |
| M-BD6 | `dfs/backlink-details.ts:589` BİRİNCİ istek hatasında `settleSpend` çağrıldı (**DK-3 ekseni**) | rezervasyon-açık pini | **KIRMIZI** (1) | `dfs/backlink-details.test.ts > never issues the second request when the first one fails` — **yalnız bu bir tane**; ikinci-istek hatası testi (`throws when the SECOND request fails, instead of reporting half an answer`) defteri HİÇ okumuyor · `logs/m-bd6.log` |
| M-BD7 | `backlink-details.ts:371` boş link listesinin gizlenmesi kaldırıldı (`links.length === 0` → `false`) | boş-pencere sessizliği | **KIRMIZI** (1) | `backlink-details.test.ts > formatBacklinkDetails > prints only the list that came back, when one of the two is empty` — **sessizlik KASTEN pinli** (BD-1'in kanıtı) · `logs/m-bd7.log` |

**7 KIRMIZI / 0 YEŞİL.** Her kırmızı LOG DOSYASINDAN okundu (`> log 2>&1; echo exit=$?`).

**Hakem şerhi — M-BD2 hangi sınıfı ölçtü (hakem turu, 2026-09-04):** M-BD2 "Sınıf 2 / NEVER#4"
diye etiketlenmiş; ücret meta'sından `projectId` düşürmek **Sınıf 2**'dir (ücret kapsamı süpürgesi),
NEVER#4 değil. Aynı yanlış etiket altı kayıtta da var. **NEVER#4'ün gerçek kiracı okuması**
`tools/project-target.ts:48`'dir (`forUser(getServiceClient(), userId).selectOwnById`) ve **o
zincirin hızlı-şerit pini ÖLÇÜLMEDİ** — canlı 404 kanıtı var (§3, BD-N1), pin kanıtı yok.

**Ders 14 — hangi EKSENİ varyantladım:** DK-3'te varyantladığım eksen "HANGİ istek düşüyor"du.
Birinci istek hatası pinli (M-BD6 → 1 KIRMIZI); **ikinci istek hatasında defterde ne olduğunu
hiçbir test sormuyor** — mevcut test yalnız "iki istek atıldı ve fırladı" diyor. Bu bir delik, BD-6.

Çalışma ağacı sonunda temiz — `git diff --stat` çıktısı: **(boş)**.

`*.db.test.ts` şeritleri (`backlink-details.db.test.ts`) Docker ister — **KOŞULMADI, db şeridi CI/hakem**.

### DK-3 (NEVER #5) — statik durum

`dfs/backlink-details.ts:583` rezervasyonu açıyor, `:614` tek seferde settle ediyor; **arada catch yok**,
port hatasında satır `status=open` kalıyor. `settleFailedSpend` (`dfs/budget.ts:211`) VAR, beş kardeş
port çağırıyor, bu port çağırmıyor. **DK-3 bu tool'da AÇIK.**
**Ders 16 kontrolü:** kardeşi `dfs/backlinks.ts:25`/`:453` ve `link-gap.ts:311` bu davranışı YORUMDA
açıkça yazıyor; **`backlink-details.ts` hiçbir yerde yazmıyor** — modül başlığı (`:544-552`) yalnız
`cost` alanı olmayan yanıtın nasıl settle edildiğini anlatıyor, başarısızlıkta ne olduğunu söylemiyor.
Bayat bir iddia yok, ama kardeşlerinde olan bir cümle burada eksik.

**Hakem düzeltmesi — kardeş port sayısı (hakem turu, 2026-09-04):** "beş kardeş port" cümlesi dört
port sayan bir grep'e dayanıyor; beşincisi `dfs/client.ts:464`. Tam liste: `client.ts:464` ·
`discover-keywords.ts:871` · `ranked-keywords.ts:563` · `keyword-gap.ts:390` · `relevant-pages.ts:762`.

**Hakem eki — DK-3'ün ÖLÇÜLMÜŞ şekil haritası (H-2, hakem turu, 2026-09-04).** Şef gözlemi Ş-3 üç
şekil sayıyordu; hakem altı portu da ölçtü ve şekil **İKİ**: onarımı bir test kıran portlar ve hiç
test kırmayanlar. **Bu tool ikincisindedir.**

| port | rezervasyonu pinleyen iddia | onarım uygulanınca |
|---|---|---|
| `dfs/competitors.ts:780` | `actualUsd toBeNull` ×2 | KIRMIZI (2) |
| `dfs/backlinks.ts:408` | `actualUsd toBeNull` ×1 (`backlinks.test.ts:380`) | KIRMIZI (1) |
| `dfs/link-gap.ts:322` | hiçbir şey | YEŞİL |
| **`dfs/backlink-details.ts:583` (bu tool)** | **yalnız `todaySpendUsd` (`:768`)** | **YEŞİL — 4130/4130 (H15)** |
| `dfs/backlink-changes.ts:489` | yalnız `todaySpendUsd` (`:644`) | YEŞİL |
| `dfs/disavow-candidates.ts:849` | yalnız `todaySpendUsd` (`:1284`, `:1318`) | YEŞİL |

**Tek PR notu:** düzeltme altı porta birlikte girer — `try` isteği VE ayrıştırmayı kapsar
(`finally` DEĞİL), `catch` → `settleFailedSpend` → orijinal hatayı yeniden fırlat; ve **HER portta**
"satır kapandı, `actualUsd === estimatedUsd`, rows 0" iddiası yazılır. İki portta mevcut iddia
TAŞINIR ("leaves OPEN" → "SETTLES at estimate"), dört portta (bu tool dahil) **eklenir**.

## 3. Canlı negatif yol

| senaryo | argüman | HTTP / envelope | kredi Δ | gözlem |
|---|---|---|---|---|
| BD-N1 uydurma `project_id` | `project_id: 9f1c2d3e-…` | 200 / `isError:true` | **0** | `No project found with id … You were not charged.` — başkasının projesi ile hiç olmayan proje ayırt EDİLEMİYOR (doğru davranış) |
| BD-N2 bilinmeyen alan | `+ mode: "one_per_domain"` | 200 / `isError:true` | **0** | `Unrecognized key: "mode"` — `mode` port'ta pinli bir fiyat/anlam kararı, caller knob DEĞİL; canlıda doğrulandı |
| BD-N3 limit dışı | `limit: 701` | 200 / `isError:true` | **0** | zod `Too big: expected number to be <=700 → at limit` — imzalı satır kapağı ŞEMADA, reserve'e ulaşmıyor |
| BD-N4 offset dışı | `offset: 20001` | 200 / `isError:true` | **0** | zod `Too big: expected number to be <=20000 → at offset` — satıcının belgelediği tavan |
| BD-N5 page_limit dışı | `page_limit: 201` | 200 / `isError:true` | **0** | zod `Too big: expected number to be <=200 → at page_limit` |
| BD-N6 geçersiz domain | `target: "http://"` | 200 / `isError:true` | **0** | `"http://" is not a valid domain or URL. You were not charged.` |

**Defter kanıtı:** altı ücretsiz retten hiçbiri defterde satır açmadı; ücretli çağrılardan önce
filtresiz defter **605 entries**'te sabit kaldı. charge+refund çifti yok.

**Bare target kabul ediliyor mu / defter kapsamı:** EVET kabul ediliyor ve kapsam **bilinçli null** —
ücretli BD-P3 ile ölçüldü (§4). Negatif değil, tasarım: `credits/guard.ts` `undefined`'ı gerçek bir
cevap sayıyor ve defter onu KELİMEYLE basıyor (`no project scope`), boş bırakmıyor.

## 4. Canlı mutlu yol

| senaryo | argüman | envelope | kredi Δ | çıktı özeti (kişisel veri/anahtar yok) |
|---|---|---|---|---|
| BD-P1 dentnotion, varsayılan pencere | `{project_id: fa9340e5-…}` | 200 / ok | **−35** `project: dentnotion.com` | 18.545 kr / 127 satır. Başlık `Individual backlinks — 50 backlinks in this window (offset 0, limit 50). DataForSEO counts 190 backlinks for this target in total — this window is a slice of that set, not a count of it:` · 50 link satırı, **ortalama 318 karakter** · sonra `Pages of this site that earn the links — 9 pages in this window (offset 0, limit 20). DataForSEO counts 9 pages …` + 9 sayfa · sonda `VENDOR_SPAM_SCORE_NOTE` birebir. **50 linkin 50'si `dofollow`**; `nofollow` kelimesi yalnız SAYFA listesinde (`(N nofollow)`) 9 kez geçiyor. Kesilme YOK (`Output limit reached` → 0) |
| BD-P2 adstark, **bare target**, pencere listenin SONUNU aşıyor | `{target:"adstark.com.tr", limit:5, offset:19000, page_limit:3}` | 200 / ok | **−35** `no project scope` | 1.164 kr / 12 satır. **Çıktıda "Individual backlinks" bloğu HİÇ YOK** — ne başlık, ne satır, ne "bu pencere boş döndü" cümlesi, ne `offset 19.000 / limit 5` bilgisi. Yalnız üst başlık (`Backlinks for "adstark.com.tr" — the individual links, and the pages of this site they point at:`), sonra sayfa listesi (3 sayfa), sonra spam notu |

**Kesilme/tavan cümlesi ÖLÇÜLEMEDİ (bilinçli):** varsayılan pencerede (50+20) kesilme oluşmuyor —
kaynak yorumunun kendi hesabı bunu söylüyor ve canlı doğruladı (18.545 kr < 28.000 tavanı). Kesilmeyi
canlı görmek için `limit: 700` gerekirdi; **bu ücretli tavanın üçüncü çağrısı olurdu, yapılmadı.**
Yerine: mutasyon M-BD5 kesilme yolunun DÖRT testle pinli olduğunu gösterdi (birim düzeyi kanıt).

**BD-P2'nin anlamı (BD-1'in kanıtı).** Modülün kendi sözleşmesi (`backlink-details.ts:63-76`) diyor ki
"every count printed here NAMES THE SET IT COUNTS" ve pencere sınırları sayının yanında basılır.
Boş pencerede bu sözleşme uygulanmıyor: `formatBacklinkDetails:371` `links.length === 0` ise bloğu
komple atlıyor. Dürüst mesajı yazan `renderNothingFound` (`:349`) — ki YORUMU tam olarak bu vakayı
anlatıyor, birebir: *"The empty answer must still name the window it was empty FOR: 'no backlinks' at
offset 19,000 means the page ran out, not that the site has none"* (`backlink-details.test.ts:322-326`)
— **yalnız İKİ pencere de boşken** çalışıyor. Sayfa penceresi ise HER ZAMAN offset 0'dan çekiliyor
(`dfs/backlink-details.ts:580-581`), yani sayfası olan her gerçek domainde dolu geliyor. Sonuç:
o dürüst mesaj üretimde pratikte **ulaşılamaz**, ve onu sınayan test (`:327`) elle kurulmuş bir
double üzerinde koşuyor (`details(window_([], null, {offset:19000, limit:50}), window_([], null))`) —
üretimin üretemediği bir girdi şekli. Ders 12'nin tarifi birebir.

**Hakem nitelendirmesi (2026-09-04) — "ulaşılamaz" cümlesi DARALTILMALI.** İddia yalnız **sayfası
olan** domainlerde geçerlidir: sayfa penceresi her zaman offset 0'dan çekildiği için gerçek bir
domainde dolu gelir, dolayısıyla `renderNothingFound` orada asla çalışmaz. Ama **hiç backlink'i
olmayan bir özne** (örn. `example.net`) iki pencereyi de boş döndürür ve `renderNothingFound`
üretimde **çalışır**. Yani doğru cümle "üretimde ulaşılamaz" değil, **"yalnız sayfası olan
domainlerde ulaşılamaz"**dır. Bu, BD-1'i zayıflatmaz — ödenen çağrının sessiz kaldığı vaka
(dolu sayfa penceresi + boş link penceresi) hâlâ ölçülmüş ve hâlâ karşılıksız.

**Defter (birebir, benim açtığım iki satır):**
`2026-09-03T21:55:13.30447+00:00 · -35 credits · charge · backlink_details · no project scope`
`2026-09-03T21:54:43.35301+00:00 · -35 credits · charge · backlink_details · project: dentnotion.com`
Aritmetik tutuyor (düz 35 ×2, `limit`/`offset`/`page_limit` fiyatı hiç değiştirmedi — description'ın
"asking for fewer rows costs the same" iddiası CANLIDA doğrulandı: 50 satırlık çağrı da 5 satırlık
çağrı da 35). **Refund yok.** Proje filtreli okuma birinci satırı gösterdi, ikinci satır yalnız
filtresiz okumada göründü — bare target çağrısı kapsamsız, beklendiği gibi. DFS **"daily cap" reddi
görülmedi**; `backlink_details` bu turdan önce defterin ilk-5'inde değildi.

**Sınıf 9 (`dfs_spend` tahmin/gerçek) — ÖLÇÜLEMEDİ:** prod `public.dfs_spend` şef ortamından
okunamıyor. Statik oran (hesaplandı, varsayılmadı): tahmin
`estimateBacklinkDetailsUsd(50,20) = (0,024 + 50×0,000036)×1,5 + (0,024 + 20×0,000036)×1,5 = $0,0758`;
fixture'lardaki gerçek satıcı bedelleri `0,02015 + 0,02012 = $0,04027`. Oran **~1,88×** — 1,5
güvenlik çarpanıyla tutarlı, kardeşi `analyze_backlinks`'in ~2,1×'inden dar.

**Sınıf 9 — ŞEF ÖLÇÜMÜ (Ş-1, hakem turu, 2026-09-04): artık ÖLÇÜLDÜ.** Yukarıdaki "okunamıyor"
satırı işçinin ortamı içindir; şef prod `public.dfs_spend`'i Supabase MCP ile okudu
(`spend_day = 2026-09-03` UTC). Bu tool'un ucu:

| uç | n | tahmin | gerçek | oran |
|---|---|---|---|---|
| `backlinks/backlinks/live` | 4 | 0,388 | 0,2214 | **1,75×** |

n=4 bu ucun Dilim 5'teki TÜM çağrılarıdır (bu tool 2 + `disavow_candidates` 2 — üçü de aynı ucu
paylaşıyor), yani oran uca aittir, tek tool'a değil. Statik hesaptan (~1,88×) dar çıkması, güvenlik
çarpanının bu uçta gerçeğe en yakın oturduğu anlamına gelir. **BİLGİ kalemidir; NEVER#6'ya
dokunmaz.** Dilim 5 toplamı: gerçek ≈ $0,47 ↔ tahmin ≈ $0,95.

Ham kayıt: `<scratchpad>/dilim5/canli/raw.jsonl` (anahtar `makeRedactor` ile redakte).

## 5. SEO güncelliği

Referans "Tool eşleme" satırı (birebir):
`| backlink_details | R-6.1, R-6.2 | \`rel\` niteliklerinin eksik ayrıştırılması |`

| kural | tool'da nasıl görünüyor | uyum | not |
|---|---|---|---|
| R-6.1 (link spam = manipülasyon için üretilen linkler; alım-satım, takas, otomatik üretim, **nitelenmemiş linkli native advertising**) | Tool linki linkin KENDİ satırında gösteriyor: kaynak domain, kaynak SAYFA (`url_from`), hedef sayfa, anchor, follow durumu, satıcı rank'i, satıcı spam skoru, ilk/son görülme. Kendi hükmünü katmıyor ve `VENDOR_SPAM_SCORE_NOTE` bunu açıkça söylüyor (canlı çıktıda birebir basıldı). Bu, R-6.1'in şekillerini bir insanın TANIYABİLECEĞİ tek yüzey. Ama "nitelenmemiş" yarısı ölçülemiyor — bkz. R-6.2 | **KISMEN UYUYOR** | Canlı BD-P1'de desen açıkça görünür: aynı kaynak-domain ailesinden art arda profil sayfası linkleri, hepsi aynı gün-saatte ilk görülmüş, hepsi `dofollow`. Ürün bunu YORUMLAMIYOR (doğru), ama okuyucuya niteliği de vermiyor |
| R-6.2 (**ücretli/sponsorlu linkler `rel="nofollow"` ya da `rel="sponsored"`, kullanıcı üretimi içerik için `ugc`**) | Satıcının `/backlinks/backlinks/live` item'ı — repo'nun kendi fixture'ında, satıcının kendi örnek gövdesi — `dofollow` alanının YANINDA bir **`attributes`** alanı taşıyor. `backlinkItemSchema` (`dfs/backlink-details.ts:327`) `attributes`'ı okumuyor; `grep -rn "attributes" --include="*.ts" apps/mcp/src/dfs` → **0 eşleşme**. Çıktıda bir link yalnız `dofollow` / `nofollow` / `follow status n/a` olabiliyor (`followClause`, `:190`). Canlı BD-P1: 50 satırın 50'si `dofollow`, `sponsored`/`ugc`/`rel=` **0 kez** | **AYKIRI** | **Referansın adlandırdığı risk BU ÜRÜNDE GERÇEK.** `rel="sponsored"` bir link ile düz `rel="nofollow"` bir link çıktıda AYIRT EDİLEMEZ — ikisi de "nofollow" basar. R-6.2 tam olarak bu üç değeri BİRBİRİNDEN ayırmayı şart koşuyor. Kardeş kayıt `analyze_backlinks` AB-2 aynı boşluğun PROFİL yarısını ölçtü (`referring_links_attributes`, `sponsored: 88`) → BD-3 |

`D-x` kalemleri kural değildir, işlenmedi. Referansın bu tool için verdiği iki kuralın ikisi de
ölçüldü; eşleme DOĞRU (`analyze_backlinks`'in R-6.3 satırında olduğu gibi bir karşılıksızlık yok).

### Referansa şerh (silme yok, ÖNERİ)

R-6.3 (site reputation abuse) referansta `analyze_backlinks`'e iliştirilmiş, ama ölçülünce o tool'un
konum verisi hiç yok. **Taşıyan tool bu:** `BacklinkDetailRow.url_from` linkin kaynak SAYFASINI
veriyor (canlı: `https://jobs.suncommunitynews.com/profiles/…` gibi üçüncü-taraf profil sayfaları —
R-6.3'ün tarif ettiği şeklin ta kendisi). Ayrıca satıcı aynı item'da `semantic_location` alanı da
gönderiyor ve o da ayrıştırılmıyor.

**Hakem kararı — R-6.3 (H-6, hakem turu, 2026-09-04): ONAY, şerh referansa işlendi.** Bağımsız
ölçüm: `url_from` ağaçta yalnız `dfs/backlink-details.ts:200`, `:329`, `:415`'te geçiyor — konum
verisini taşıyan tek tool budur. `docs/reference/2026-09-02-seo-referans-listesi.md`'nin R-6.3
satırının etkilenen-tool listesine `backlink_details` **eklendi**; `analyze_backlinks` satırdan
SİLİNMEDİ, yanına ölçüm şerhi düşüldü (Dilim 3/4 emsali: referanstan satır silinmez).

Öneri (işçi metni): R-6.3'ün etkilenen-tool listesinde `analyze_backlinks`
yerine (ya da yanına) `backlink_details` yazılsın.

## 6. Kart (MCP Apps)

`apps/mcp/src/ui/card-map.ts:23` → `backlink_details: "list"`. Eşleme **VAR**.
`CARDED_TOOLS` (satır 62) bugün yalnız `get_credit_balance` içeriyor, `backlink_details` **DEĞİL**
(Sınıf 7-kart, ertelenmiş).
Canlı payload bir `list` kartının isteyeceği yapıyı taşıyor: iki ayrı liste, her birinin kendi
başlığı ve pencere sınırları, satır başına ayrık alanlar (domain, iki URL, anchor, follow, rank,
spam, durum kodu, iki tarih). **Kart çizilirse iki not:** (1) 318 karakterlik satır bir kart satırına
sığmaz, alan seçimi gerekir; (2) **BD-1 kartla KENDİLİĞİNDEN kapanmaz** — boş pencere kartta da
boş bir alan olur, ve "bu pencere boş döndü" cümlesi metin katmanında yazılmalıdır.

## 7. Kanıt üçlüsü

- Bu dosya: ✔
- `scripts/testing/plan.mjs` PLAN girişi: **YOK — EXCLUDED** (satır 151, birebir):
  `backlink_details: "paid, 35 credits/call against the DataForSEO backlinks API. Needs a budget signature.",`
  **Gerekçe BAYAT** → BD-7. Aynı cümle komşu iki satırda da duruyor (`:150 backlink_changes`,
  `:152 disavow_candidates`) — kapsam dışı, şerh olarak yazıldı.
- `goals/` hedefi gerekli mi: **HAYIR** — ücretli ve kullanıcı-tetiklemeli; kalıcı bir canlı hedef
  her koşuda 35 kredi + satıcı parası yakardı ve `dfs-budget-guard.md` zaten satıcı tavanına bakıyor.
  BD-1 ve BD-2 birer **birim testi** işidir, `goals/` işi değil.

## Bulgular

| # | şiddet (P0/P1/P2) | bulgu | kanıt | önerilen düzeltme (KOD YAZILMAZ, öneri) | durum (kapanış, 2026-09-04) |
|---|---|---|---|---|---|
| BD-1 | **P1** | **Ödenen bir çağrının link penceresi boş döndüğünde cevap o pencere hakkında TEK KELİME etmiyor.** Ne başlık, ne "boş döndü" cümlesi, ne hangi `offset`/`limit` altında boş döndüğü — hepsi yok; üst başlık ise hâlâ "the individual links, and the pages of this site they point at" diye SÖZ veriyor. Okuyucu "bu sitenin linki yok", "penceresi listenin sonunu aştı" ve "bir şey ters gitti" arasında ayrım yapamıyor. **Ders 12'nin tam örneği:** bu vakayı doğru cevaplayan `renderNothingFound` var, yorumu tam bu senaryoyu (offset 19.000) anlatıyor, ve testi de var — ama İKİ pencere de boşken çalışıyor, oysa sayfa penceresi HER ZAMAN offset 0'dan çekildiği için gerçek bir domainde asla boş gelmiyor. Dürüst mesaj üretimde pratikte ulaşılamaz; testi elle kurulmuş, üretimin üretemediği bir double üzerinde yeşil. **Hakem nitelendirmesi (2026-09-04):** "üretimde ulaşılamaz" cümlesi fazla geniş — doğrusu **"yalnız SAYFASI OLAN domainlerde ulaşılamaz"**; hiç backlink'i olmayan bir özne (örn. `example.net`) iki pencereyi de boş döndürür ve `renderNothingFound` üretimde ÇALIŞIR. Bulgunun kendisi ayakta: ödenen çağrının sessiz kaldığı vaka (dolu sayfa penceresi + boş link penceresi) canlıda ölçüldü. **Şiddet: P1 KALIR** (hakem turu) — zarar kanalı ödenen ve karşılığı görünmeyen bir cevaptır | **Canlı BD-P2 (35 kredi ödendi):** `target:"adstark.com.tr", limit:5, offset:19000, page_limit:3` → 1.164 karakterlik cevapta `Individual backlinks` dizgisi **hiç geçmiyor**, `19,000` **hiç geçmiyor**. Kaynak: `backlink-details.ts:371` (`links.length === 0 ? [] : …`) ↔ `:365` (`renderNothingFound` yalnız `links.length === 0 && pages.length === 0`) ↔ `dfs/backlink-details.ts:580-581` (sayfa ucuna offset gönderilmiyor). **M-BD7 → sessizlik KASTEN pinli** (`prints only the list that came back, when one of the two is empty` KIRMIZI oldu). Testin double'ı: `backlink-details.test.ts:328-330` | Boş link penceresi de KENDİ başlığını bassın: `renderWindowCaption` zaten `window_row_count = 0` ile doğru cümleyi üretiyor (`0 backlinks in this window (offset 19,000, limit 5)` + satıcının bütün-küme sayısı) — yani düzeltme yeni metin yazmak değil, `links.length === 0` kısayolunu KALDIRMAK ve satır bloğunu boş bırakmak. `renderNothingFound` yalnız "iki pencere de boş" hâlinde kalabilir. Testin tarafında: bugünkü `:312` testi sessizliği pinliyor, dolayısıyla sözleşme değiştiği için o iddia TERSİNE çevrilmeli (testi silmek değil, taşımak) ve `:327`'nin yanına ÜRETİMİN ÜRETEBİLDİĞİ şekil eklenmeli: boş link penceresi + dolu sayfa penceresi |**KAPANDI #229 + canlı ✔** (deploy `ff71037`, 35 kr): `Individual backlinks — 0 backlinks in this window (offset 19,000, limit 5).` + `EMPTY_LINK_WINDOW_NOTE`. **Aynı canlı satır BD-8'i açtı** — sessizlik gitti, yanlış iddia kaldı |
| BD-2 | ~~P1~~ **P2** (hakem turu, 2026-09-04) | **Ölçülmüş iddia hatası, ve bir tasarım kararının GEREKÇESİ o iddiaya dayanıyor.** `backlink-details.ts:262-263` çıktı tavanının neden şema daraltmaya tercih edildiğini anlatırken birebir şunu diyor: *"bounding the RENDERED TEXT keeps the wide window … and keeps the fetched rows — the run report written to domain_lookup_runs still records the whole window, so nothing measured is lost."* Bu **yanlış**: `dfs/runs.ts:83` `MAX_RUN_ROWS = 50` ve `backlinkDetailsRunReport` her iki listeyi `cappedWindow` → `capRows` ile 50 satıra kırpıyor. `limit: 700`'de 650 satır ne cevapta ne kayıtta — ve o 650 satır için para ödendi. Aynı repoda `runs.ts:226-228` TERSİNİ açıkça yazıyor (*"Every list is capRows'd. That matters MORE here … backlink_details asks the vendor for up to 700 link rows"*). **Şiddet bandı (H-1, hakem turu, 2026-09-04): P1 → P2** — yanlış iddia KAYNAK YORUMUNDA duruyor, müşteriye basılan mdx cümlesi doğru (`capped summary`), yani müşteri yüzeyinde zarar yok; aynı sınıfın kardeşi `link_gap` B-2 zaten P2 | `tools/backlink-details.ts:262` ↔ `dfs/runs.ts:83,86-88,532-541,610-611`. `shown` alanı gerçek sayıyı kaydediyor ama `rows` 50'de kesiliyor. Public doküman DOĞRU (`backlink-details.mdx:77`: `a capped summary of what came back`) — hata yalnız kaynak gerekçesinde, yani karar veren metinde | Yorum bugünkü gerçeğe çevrilsin: kayıt **kapaklı bir özet**tir (ilk 50 satır + `shown` + satıcı toplamı), "whole window" değil. Bu, tavan kararını GEÇERSİZ KILMAZ — şema daraltmak hâlâ imzalı fiyatı hareket ettirirdi — ama gerekçe "hiçbir ölçüm kaybolmuyor" değil "kayıt kapaklı, okunmayan satırlar `offset` ile yeniden çekilir" olmalı, ki cevabın kendi kesilme notu zaten bunu söylüyor. Ders 16: her oturumda okunan bir dosyada kapanmamış/yanlış bir iddia bırakmak, sessizce yanlış yönlendirir |KAPANDI #228 — `tools/backlink-details.ts:274` gerekçesi düzeltildi ve `MAX_RUN_ROWS = 50` adıyla yazıldı; "nothing measured is lost" cümlesi geri çekildi (ders 16) |
| BD-3 | ~~P1~~ **P2** (hakem turu, 2026-09-04) | **R-6.2: satıcının link başına gönderdiği `rel` nitelikleri (`attributes`) ayrıştırıcıya hiç girmiyor.** Bir link çıktıda yalnız `dofollow` / `nofollow` / `follow status n/a` olabiliyor. `rel="sponsored"` bir ücretli link ile düz `rel="nofollow"` bir link **ayırt edilemez** — oysa R-6.2 bu üçünü (nofollow · sponsored · ugc) birbirinden ayırmayı şart koşuyor, ve bu tool'un tek işi linkleri TEK TEK göstermek. Parası ödenen yanıtın içinde gelen bir alan atılıyor. **Şiddet bandı (H-1, hakem turu, 2026-09-04): P1 → P2** — satıcının `dofollow=false`'unu "nofollow" diye basmak YANLIŞ değil KABA bir indirgemedir (çıplak açıklama boşluğu); sınıfın dört üyesi (`analyze_backlinks` AB-2, bu, `link_gap` B-1, `disavow_candidates` B-6) tek şiddet taşır. **Kök (H-4, hakem turu): üç ayrıştırıcı, dört tool** — `backlinkItemSchema` (`dfs/backlink-details.ts:327`; bu tool + `disavow_candidates` ithal ediyor) · `summaryResultSchema` (`dfs/backlinks.ts:206`) · `intersectionEntrySchema` (`dfs/link-gap.ts:196`). Tek dalga, satıcı adlarıyla, yokluk icat edilmeden | `dfs/fixtures/backlinks-list.json` (satıcının kendi örneği) item'ında `attributes` alanı `dofollow`'un yanında duruyor. `backlinkItemSchema` (`dfs/backlink-details.ts:327-340`) onu içermiyor; `grep -rn "attributes" --include="*.ts" apps/mcp/src/dfs` → **0**. `followClause` (`tools/backlink-details.ts:190-193`) yalnız boolean okuyor. Canlı BD-P1: 50 link, 50 × `dofollow`, `sponsored`/`ugc`/`rel=` → **0**. M-BD3 KIRMIZI (10 test) = mevcut dar yol yoğun pinli | `backlinkItemSchema`'ya `attributes: z.array(z.string()).nullish()` eklensin, `BacklinkDetailRow`'a taşınsın, ve `followClause` nitelikleri **satıcının verdiği adlarla** yanına yazsın: `nofollow (sponsored)` / `nofollow (ugc)` / `dofollow`. Satıcı hiç nitelik vermediyse bugünkü davranış aynen kalsın — YOKLUK icat edilmesin (`vendorSpamScore` deseni). Kardeş bulgu: `analyze_backlinks` AB-2 (profil düzeyi `referring_links_attributes`); ikisi bir dalgada kapanabilir |KAPANDI #229 — `backlinkItemSchema.attributes` (`null` ↔ `[]` ayrı, pinli) + `format/rel-attributes.ts` tek sözlük. **Canlıda ölçülemedi:** link penceresi boş döndüğü için `DataForSEO attributes: …` satırı hiç basılmadı |
| BD-4 | P2 | **"bu pencere o kümenin bir dilimi, sayımı değil" cümlesi, dilim = küme olduğunda da basılıyor.** Canlı BD-P1: `Pages of this site that earn the links — 9 pages in this window (offset 0, limit 20). DataForSEO counts 9 pages for this target in total — this window is a slice of that set, not a count of it:`. Burada pencere DOLU DEĞİL (9 < 20) ve satıcı toplamı da 9 — yani bu pencere gerçekten o kümenin sayımı. Bir yanlış okumayı önlemek için yazılan cümle, başka bir yanlış okuma üretiyor | Canlı BD-P1 sayfa başlığı (birebir yukarıda). Kaynak: `renderWindowCaption` (`tools/backlink-details.ts:186`) cümleyi KOŞULSUZ ekliyor. M-BD4 bu cümlenin 10 testle pinli olduğunu gösterdi — yani kasıtlı, gözden kaçma değil | Tek koşul yeter: `window_row_count === vendor_total_count && window_row_count < window_limit && window_offset === 0` ise cümle "this window holds the whole set DataForSEO reports for this target" olsun. Diğer bütün hâllerde bugünkü cümle kalsın. Modülün "iki küme asla bir 'of' ile birleştirilmez" kuralı BOZULMAZ — sayılar yine ayrı ayrı adlandırılır |**AÇIK — PR'da karşılığı bulunamadı.** `renderWindowCaption` (`:188`) "this window is a slice of that set, not a count of it" cümlesini hâlâ koşulsuz basıyor |
| BD-5 | P2 | **`no anchor text (anchor link)` — anchor'ın neden boş olduğunu açıklamak için yazılan yan cümle, `item_type === "anchor"` olduğunda hiçbir şey açıklamıyor.** Kod yorumu (`:195-199`) niyeti şöyle yazıyor: *"`item_type` is the vendor's own explanation — printing it beside the blank keeps 'no anchor text' from reading as a defect in the lookup"*. `image` için işe yarıyor; `anchor` için totoloji | Canlı BD-P1'de bir satır: `from https://jobs.suncommunitynews.com/profiles/… · no anchor text (anchor link) · dofollow …`. Kaynak: `anchorClause` (`tools/backlink-details.ts:200-203`) — `item_type`'ı süzmeden basıyor | `item_type === "anchor"` (yani "açıklamayan" değer) hâlinde parantez düşürülsün, düz `no anchor text` kalsın; `image`, `redirect` gibi gerçekten açıklayan değerlerde bugünkü biçim korunsun. Ölçülmeyen kısım: satıcının `item_type` değer kümesinin tamamı bilinmiyor, bu yüzden "açıklayanlar" beyaz liste değil, yalnız `anchor` kara listesi önerilir |**AÇIK — PR'da karşılığı bulunamadı.** `tools/backlink-details.ts:218` `no anchor text (${row.item_type} link)` aynen duruyor; `anchor` totolojisi kapanmadı |
| BD-6 | ~~P2~~ **P1** (hakem turu, 2026-09-04) | **DK-3 (NEVER #5) AÇIK, ve ekseninin yalnız YARISI pinli.** Port hatasında rezervasyon `status=open` kalıyor (beş kardeş port `settleFailedSpend` ile onarıldı, bu değil). Üstelik: BİRİNCİ istek düşerse defterde ne olduğu pinli, **İKİNCİ istek düşerse hiçbir test defteri okumuyor** — oysa ikinci istek hatasında birinci isteğin GERÇEK parası çoktan harcanmış olur, yani defter açısından daha ilginç olan dal ölçülmüyor. **Şiddet bandı (H-1, hakem turu, 2026-09-04): P2 → P1** — DK-3 doğrudan NEVER#5 (bütçe) eksenidir, kardeşleri `backlink_changes` B-3 ve `disavow_candidates` B-3 zaten P1 yazıyor, ve altı kopya TEK PR'da kapanacağı için tek şiddet taşımalı | `dfs/backlink-details.ts:583` reserve ↔ `:614` tek settle, arada catch yok. `grep -rn settleFailedSpend` → beş kardeş port; `backlink-details.ts` listede YOK. M-BD6 → **yalnız 1** test KIRMIZI (`never issues the second request when the first one fails`); `throws when the SECOND request fails, instead of reporting half an answer` (`:783`) `todaySpendUsd`'yi hiç çağırmıyor. Ders 14: varyantlanan eksen "HANGİ istek düşüyor" | İki parça: (1) `settleFailedSpend` bir catch'ten çağrılsın (kardeşlerdeki birebir desen) — bu, M-BD6'nın kırdığı testin ledger iddiasını da değiştirir, dolayısıyla o iddia sözleşmeyle birlikte taşınmalı; (2) `throws when the SECOND request fails` testine defter iddiası eklensin, hangi karar verilirse verilsin. Kardeş bulgu: `analyze_backlinks` AB-5. **Hakem düzeltmesi (2026-09-04) — "iddia taşınır" YANLIŞ, taşınacak iddia YOK:** hakem gerçek onarımı (`settleFailedSpend` bir catch'ten) uygulayıp kapıyı koştu → **4130/4130 YEŞİL** (H15). `dfs/backlink-details.test.ts:768` yalnız `todaySpendUsd`'yi pinliyor ve onarım o toplamı KORUYOR (`budget.ts:211-217` satırı `estimatedUsd` ile kapatır), dolayısıyla kırılan test yok. **Asıl bulgu bunun tersidir ve ölçüm turunda YOKTU:** bu portta `status`/`actualUsd` ekseni **hiç pinli değil** — onarım sessizce geçer ve bir sonraki refactor'da sessizce geri alınabilir. Dolayısıyla düzeltme paketi bu porta yalnız kodu değil, **iddiayı da EKLEMEK** zorundadır: "satır kapandı, `actualUsd === estimatedUsd`, rows 0". Şekil haritası §2'de (H-2) |KAPANDI #227 — catch → `settleFailedSpend`; **İKİNCİ istek dalına YENİ status iddiası eklendi**, yani hakemin "pinsiz yarı" hükmü de kapandı |
| BD-7 | P2 | **`plan.mjs` EXCLUDED gerekçesi bayat — Dilim 4'ün dört satırda düzelttiği CÜMLENİN AYNISI.** `scripts/testing/plan.mjs:151`: `"paid, 35 credits/call against the DataForSEO backlinks API. Needs a budget signature."` Bütçe imzası 2026-09-02'de geldi (operatör kararı), ve bu tool 2026-09-03'te **iki kez ücretli koştu** — biri proje kapsamlı, biri bare target. Gerekçenin dayanağı yok | `scripts/testing/plan.mjs:151` ↔ bu kaydın §4'ü (iki ücretli çağrı, iki defter satırı). Dilim 4'ün aynı sınıfı: `_DILIM4-HAKEM-SINIFLAR.md` sınıf 6, `#223` ile `plan.mjs:126/127/128/141` düzeltildi — 150/151/152 düzeltilmedi. **Kapı bayat GEREKÇEYİ ölçmez**: `tool-sweep.mjs --self-test` yalnız tool'un PLAN ya da EXCLUDED'da olduğuna bakar | Gerekçe bugünkü gerçeğe çevrilsin ya da tool PLAN'a alınsın. PLAN'a alınırsa gereken tek şey site başına bir `project_id` (matris zaten taşıyor) — yani `analyze_backlinks`'in K3 S1 hücresiyle aynı şekil; kalan sebep artık "imzasız" değil "site başına 35 kredi + satıcı ücreti". **Şerh (kapsam dışı):** aynı bayat cümle `:150` (`backlink_changes`) ve `:152` (`disavow_candidates`) satırlarında da duruyor — o iki tool'un kendi dilim kayıtlarında ölçülmeli. **Hakem eki (H-5, hakem turu, 2026-09-04) — TEK DÜZELTME:** bayat cümle `plan.mjs`'te **beş** satırda duruyor: `:149` (`link_gap`) · `:150` (`backlink_changes`) · `:151` (bu tool) · `:152` (`disavow_candidates`) · `:153` (`audit_speed`). Dilim 4'ün "KAPANDI #223" kaydı yalnız DÖRT satır içindi ve o dördün hiçbiri bunlar değil — yani sınıf kapanmadı, POZİSYON değiştirdi (ders 14). Beş satır tek düzeltmede kapanmalı; tool başına kapatmak sonuncuyu unutturur |KAPANDI #228 — `plan.mjs` beş ardışık bayat satırın biri; **gerekçe metnini hiçbir kapı ölçmüyor** (sweep self-test yalnız boş gerekçeyi reddeder) |
| BD-8 (şef canlı sondası, 2026-09-04) | **P1** | **Pencere dışı `offset`'te satıcının `total_count 0`'ı "hedefin toplamı" gibi basılıyor — ve bu cümle #229'un BD-1 düzeltmesiyle birlikte doğdu.** Boş pencere artık konuşuyor (BD-1 ✔) ama aynı nefeste ölçülmemiş bir iddia kuruyor: özne 242 backlink taşırken çıktı `DataForSEO counts 0 backlinks for this target in total` diyor. NEVER#7 ekseni: satıcının pencereye ait sayacı hedefin toplamı diye sunuluyor | Canlı (deploy `ff71037`, dentnotion.com, `limit 5, offset 19000`, 35 kr): `Individual backlinks — 0 backlinks in this window (offset 19,000, limit 5).` hemen ardından `DataForSEO counts 0 backlinks for this target in total`; AYNI cevabın sayfa penceresi 175/18/17… backlink'li satırlar listeliyor ve `analyze_backlinks` aynı özne için **242 backlink** ölçtü. Kaynak: `renderWindowCaption` (`tools/backlink-details.ts:188`) — `vendor_total_count === 0` dalı `null` dalından ayrılmıyor | Pencere BOŞ **ve** `vendor_total_count === 0` iken iki olgu satıcının kendi alan adıyla AYRI yazılsın: bu 0 pencereyi tarif eder, hedefin backlink'lerini değil. Sayım > 0 iken ya da satır varken bugünkü cümle aynen kalsın; `renderNothingFound` (iki pencere de boş) dokunulmasın |**KAPANDI (#230, merge bekliyor)** — hakem koşuyor, `main` `ff71037`'de YOK. Bu bir iddiadır, kapanış değil |

`durum` sütunu ölçüm turunda BOŞ bırakılır; kapatan tur doldurur.
