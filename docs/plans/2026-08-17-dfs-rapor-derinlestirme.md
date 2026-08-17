# DFS ailesi + `generate_report` derinleştirme planı

> Operatör talimatı 2026-08-17: kalan **5 kırmızı tool** — `research_keywords` ·
> `ranked_keywords` · `analyze_backlinks` · `compare_competitors` · `generate_report` — crawl+audit
> ailesindeki **üçlü ritüelle** ele alınır: (1) ne işe yarıyor, (2) gelişim alanları + plan,
> (3) panel gösterimi. Katalog karşılaştırması kardeş dosyada:
> `docs/plans/2026-08-17-dataforseo-katalog-gap-haritasi.md`.
>
> Kaynak: 6 salt-okunur keşif ajanı + şefin canlı ölçümleri (Supabase + `/status` + prod ledger).

## 0. İlkeler (pazarlıksız)

1. **Fiyat imzasız dispatch YOK** (NEVER#6). Bu plandaki hiçbir kredi rakamı geçerli değildir;
   hepsi §7'deki tek pakette operatöre gider.
2. **Ölçülmemiş eksen "0" diye yazılmaz.** `audit/format.ts`'in disiplini rapora da taşınır.
3. **Yeşil test ancak kasten bozulup kırmızıya döndüğü ölçüldüyse kanıttır** (imzalı ders 12).
4. **Planın yazdığı mutasyon bir HİPOTEZDİR** (imzalı ders 13) — kırmızı vermeyen mutasyon bir
   bulgudur, sessizce geçilmez.
5. **DFS keşif çağrıları $3/gün tavanı içinde**; tavan imzalıdır ve bu planla değişmez.

---

## 1. Beş tool'un mekaniği ("ne işe yarıyor")

### 1.1 Ortak iskelet — dört DFS tool'u

Dördü de `charge:"handler"`: `defineTool` otomatik rezerv AÇMAZ, handler kendi uzlaşmasını yapar.
Sebep kodda yazılı — `charge:"surface"` rezervi handler'dan ÖNCE açar, ve bu tool'ların **ücretsiz
ret kapıları rezervden önce koşmak zorundadır** (NEVER#2: defter sıfır kez dokunulur).

Kapı sırası (`ranked_keywords` / `analyze_backlinks` / `compare_competitors`):

1. **zod parse** — geçersiz girdi, handler hiç koşmadan reddedilir.
2. **D17 onay eşiği** — `TOOL_COSTS > 200` ise onay ister. Dördü de altında; hiç tetiklenmez.
3. **`resolveTarget`** — `project_id` XOR `target`; proje kiracı-kapsamlı okunur; arşivli proje
   reddi **sahiplik kapısından SONRA** (yabancı arşivli proje, var olmayanla birebir aynı cümleyi
   alır); domain paylaşılan `normalizeDomain`'den geçer.
4. *(yalnız `compare_competitors`)* **`normalizeCompetitors`** — ilk geçersiz domain tüm çağrıyı
   reddeder; hedefin kendisi ve tekrarlar düşürülür; liste boşalırsa RET (tek satırlık tabloya para
   ödetmez).
5. **`port.enabled`** — `DFS_LIVE=1` + iki credential yoksa `disabledPort`; net İngilizce ret,
   fixture **asla** gerçekmiş gibi sunulmaz (NEVER#7).
6. **paid-balance kapısı** — `withCredits`'in İLK satırı, maliyet okumasından bile önce. Trial
   hesap burada, rezervden önce reddedilir.

Ancak bundan sonra: rezerv → DFS istekleri → commit. Herhangi bir istek atarsa `withCredits`
RELEASE eder — **kısmi profil faturalanmaz**, ve bu dört ayrı arıza noktası için DB testinde
ölçülüdür.

`research_keywords` aynı iskeletin domainsiz hâli (kapı 1-2-5-6).

### 1.2 Tool tool

| tool | kredi | paid istek | endpoint(ler) | vendor tahmini |
|---|---|---|---|---|
| `research_keywords` | 25 | **1** | `keywords_data/google_ads/search_volume/live` | $0,10 sabit |
| `ranked_keywords` | 65 | **1** | `dataforseo_labs/google/ranked_keywords/live` | $0,20 sabit |
| `analyze_backlinks` | 70 | **3** | backlinks `summary` + `referring_domains` + `anchors` | $0,30 (tek rezervasyon) |
| `compare_competitors` | 90 | **2–5** | `competitors_domain` (yalnız keşifte) + domain başına `domain_rank_overview` | **dinamik**: (rakip+1)×$0,0375 **+ yalnız keşif akışında** $0,20 |
| `generate_report` | 15 | **0** | — (saklanmış crawl + pull okur) | — |

**`research_keywords`** — 1–100 kelime; çıktı `• keyword — volume N, CPC $X, competition C` +
toplam aylık arama. Projeksiyon 4 alan.

**`ranked_keywords`** — domainin ZATEN sıralandığı organik kelimeler. Limit 1–1000 (**varsayılan
1000 = maksimum**). Başlık "N of TOPLAM" der (truncation dürüstlüğü). İnce sonuç (<5 satır) +
varsayılan locale ise **locale uyarısı** eklenir; domain iki harfli ccTLD ise TLD adıyla söylenir.
(2026-08-07 ölçümü: aynı domain varsayılanda 3 satır/volume 30, `tr/2792`'de 3.600'e kadar — aynı
65 kredi iki kez.)

**`analyze_backlinks`** — profil özeti + top referring domains + top anchors. `limit` **her iki
listeye ayrı ayrı** uygulanır. "dofollow-only" etiketi bilinçli ve dar: DFS'in
`referring_domains_nofollow`'u "en az bir nofollow'u olan" demek, çıkarınca kalan küme "hiç
nofollow'u olmayan"dır.

**`compare_competitors`** — hedef + ≤3 rakip yan yana. Her satırda **kaynak etiketi** (target /
found by DataForSEO / supplied by you), kesişen kelime sayısı + o kesişimdeki ortalama pozisyon,
organik SERP sayısı, pozisyon bantları, ETV, paid-eşdeğer maliyet. Bantlar **"top 20" ve toplama
eşit değil** — bilinçli.

**`generate_report`** — tek girdi `project_id`. Paid API çağırmaz. Yol: WEB_BASE_URL fail-closed →
sahiplik + arşiv kapısı → `loadLatestCrawl` + `loadLatestPull` + `gsc_connections.account_id`
paralel → ikisi de yoksa TİPLİ ret → model + HTML → `reports` insert (8 bayt CSPRNG slug, base58,
unique çakışmasında bir kez retry) → public link.
Rapor içinde **üç saf motor gerçekten koşar** (`auditOnpage`/`auditTech`/`auditSchema`) — aynı
crawl, aynı motor, ek maliyet sıfır. **Koşmayan:** keşif motorları (quick wins / kanibalizasyon /
çürüme) ve DFS ailesinin tamamı.

---

## 2. Ölçülmüş mevcut durum (2026-08-17, şef, canlı)

| ölçüm | değer |
|---|---|
| bugünkü DFS harcaması | **$0,00 / 0 çağrı** → $3 tavanın tamamı boş |
| zirve gün | 2026-08-09: **31 çağrı, $1,8443** (çok-site kampanyası) = tavanın %61'i |
| **öksüz rezervasyon** | 2026-08-07 ve 2026-08-08'de `status='open'`, **$0,30'ar** — tam olarak `ESTIMATED_BACKLINK_PROFILE_CALL_USD`. İki backlink profili uçuşta öldü, hiç settle edilmedi. **Temizleyen yok** (reaper yalnız SAYIYOR). |
| `credit_ledger` | 5.940 bakiye / 699 satır; toplam harcanan **5.860 kredi** |
| **DFS'in payı** | **3.460 kredi = %59** — ranked 1.170 · competitors 1.080 · backlinks 910 · research 300. **Hiçbiri üründe iz bırakmıyor.** |
| `reports` | 12 satır, en yenisi 2026-08-09, HTML **3.138–7.808 bayt** (rapor gerçekten "hafif") |
| prod tabloları | `crawl_pages` · `audit_runs` · `gsc_discovery_runs` · `audit_content_runs` — **dördü de boş**; DFS karşılığı **yok** |
| `/status` schema alanı | makineden makineye **farklı**: üç ardışık pollda iki makine `unknown`, biri `ready`. Sentinel RPC prod'da VAR + service_role EXECUTE yetkisi VAR (ölçüldü). Sebep şema değil, **1000 ms'lik prob sınırı** Fly→Supabase(Tokyo) turunun altında kalıyor; `ready` terminal olduğu için bir makine yakalayınca kilitleniyor. |
| kapı temeli | `TURBO_FORCE=1 verify.sh` → **16/16, 0 cached, 1148 web testi, exit 0** (bu planın işçileri bu temele karşı ölçülür) |

---

## 3. Bulgular — `generate_report`

Fiyat **15'te sabit kaldığı sürece B1–B11 imza GEREKTİRMEZ**: hiçbiri yeni paralı çağrı, yeni
kuyruk ya da yeni dış bağımlılık getirmiyor.

| # | bulgu | büyüklük | imza |
|---|---|---|---|
| B1 | **Rapor, koşturduğu motorların çıktısının büyük bölümünü çöpe atıyor** — `TechReport` 16 alan üretir, projeksiyon 3 üst-alandan 6 çıktı alır; `SchemaReport` 8 alan üretir, projeksiyon 3'ünü alır; `duplicateGroups` düşer. (Payda üç farklı sayımla dolaştı — bağlayıcı olan alan adları, oran değil.) Sitemap diff, kırık iç link, yavaş/ağır sayfa, X-Robots çelişkisi, orphan sinyali, eksik zorunlu schema alanı, `invalid_json` — hesaplanıp atılıyor. | M | hayır |
| B2 | **Üç keşif motoru saf ve elde, ama koşmuyor.** `model.ts`'in "those need extra data/cost" gerekçesi **kaynakla çelişiyor** — üçü de yalnız `PullData` alıyor ve rapor onu zaten bellekte tutuyor. | M | hayır |
| B3 | **Bayatlık hiç söylenmiyor.** `pulledAt` atılıyor; `STALE_PULL_DAYS` eşiği ve "This data is stale" cümlesi keşif tarafında ZATEN VAR. Rapor 3 ay önceki ölçümden bugünün tarihiyle üretilebiliyor. | S | hayır |
| B4 | **Rapor satırında `project_id` YOK** → proje bazında rapor listelenemiyor, panelde rapor kartı yok, ikinci rapor birinciyle ilişkilendirilemiyor. | M (migration) | hayır |
| B5 | **Provenance sistemin en zayıfı:** `reports.job_id` kolonu var ama doldurulmuyor. Üç kardeş tablo (`audit_runs`/`gsc_discovery_runs`/`audit_content_runs`) girdi job'ını NOT NULL tutuyor; müşteriye giden tek artefakt hangi crawl'dan üretildiğini kaydetmiyor. | S–M | hayır |
| B6 | **Escaping DOĞRU (13/13 sink) ama 4'ü ÖLÇÜLMEMİŞ.** `escapeHtml` şu dörtten silinse suite yeşil kalır: `<meta content>`, `domain`+`generatedAt`, `fetchedAt`, `windowStart/End`. Kritik değil (domain normalize ediliyor) ama **HTML kimliği doğrulanmamış herkese açık bir sayfaya gidiyor**. | S | hayır |
| B7 | **`@media print` yok** — ajans raporunun birincil dağıtımı PDF; `box-shadow` + koyu zemin mürekkep yakıyor. | S | hayır |
| B8 | **Erişilebilirlik:** `<main>` yok, `<th scope>` yok, `.hint`/`.l` kontrastı ~2,3:1 (WCAG AA altı). | S | hayır |
| B9 | **Belgede paylaşım uyarısı yok** — "anyone with the URL can view it" yalnız MCP yanıtında; raporu ALAN kişi görmez. | S | hayır |
| B10 | **`crawl_pages` (0023) yeni sinyallerin hiçbirini taşımıyor** (`h2/h3Count`, `sitemapUrls` yok). Bugün okuyucusu olmadığı için görünmüyor; rapor bu tabloya bağlanırsa **ölçülmemiş eksende sessizce eksik veri** verir. **Rapor→crawl_pages bağlanmadan önce kapatılmalı.** | M | hayır |
| B11 | **Docs sayfası G1 öncesini anlatıyor** — "basic on-page issues" ve "not a re-run of the analysis engines" ikisi de artık yanlış; ürünü olduğundan zayıf gösteriyor. Sayfa **generator'dan** üretiliyor: türev değil KAYNAK düzeltilir. | S | hayır |
| B12 | **DFS ailesi rapora giremiyor** — üç aracın 65/70/90 kredilik çıktısı hiçbir yerde saklanmıyor. (a) kalıcılık tablosu + (b) raporun onu OKUMASI **maliyetsiz ve imzasız**; (c) raporun KENDİ DFS çağrısını yapması **imza ŞART**. | (a) M · (c) L | (a)(b) hayır · **(c) EVET** |

Ek: **rapor sürümleme yok**, aynı projeye ikinci rapor ilişkisiz, `revokeReportLink` yalnız
`public_slug`'ı null'lar — **satır ve `html` kalır** (KVKK karar dosyası #108 madde 8 tam bu deliği
kaydediyor). `title.max(120)` bir **reddetme**dir, kod yorumunun dediği gibi clamp değil.

---

## 4. Bulgular — dört DFS tool'u

### 4.1 Para ve bütçe

| # | bulgu | büyüklük | imza |
|---|---|---|---|
| D1 | **Açık vendor rezervasyonu günü kapatabilir.** Hata yolunda `settleSpend` çağrılmaz; rezervasyon tahmini kadar bütçe yemeye devam eder. Aritmetik: **15 başarısız `ranked_keywords` = $3,00 = günlük tavan, $0 gerçek harcamayla**; `analyze_backlinks` için 10 çökme. Fleet-global olduğu için **bir kiracının çöken çağrıları ödemiş kiracıların gününü tüketir** — `paid-balance.ts`'in önlemek için yazıldığı senaryonun ta kendisi, kazayla ve bedavaya. **Canlı kanıt: iki öksüz $0,30 rezervasyonu prod'da duruyor.** ⚠️ **ÇÖZÜM REÇETESİ ŞERHLİ:** "hata yolunda `settleSpend(reservation, 0, 0)`" **fan-out ortasında ölen koşuda YANLIŞTIR** — orada kısmi GERÇEK harcama vardır ve $0'a kapatmak bütçeyi eksik sayar; `dfs/backlinks.ts` ve `reaper.ts` bu kararı yorumla ve **pinli testlerle** açıkça savunuyor ("settling them at less would reopen a decision the team already made"). İşçi emri yalnız **hiç istek atılmamış / ilk istek yanıtsız** durumu kapsayabilir, ve o pinli testlerle yüzleşerek. "Başarısız çağrı = $0 vendor faturası" da **ölçülmemiş bir varsayımdır**. | S–M | hayır |
| D2 | **Bütçe tavanı reddi kullanıcıya "çökme" olarak görünüyor.** RPC'nin net cümlesi registry'nin üç tipli dalına uymuyor → generic *"failed unexpectedly, quote reference X"*. Tasarlanmış ret, arıza gibi okunuyor — 2026-08-09 kampanyasının ana dersinin **tavan ekseninde açık kalmış hâli**. Aynı şey her DFS-tarafı hata için geçerli. | M | hayır |
| D3 | **Başarısız koşuda "ücretlendirilmedin" DENMİYOR.** İade gerçekten yapılıyor ama cümlede yok — oysa her kasıtlı ret bunu söylüyor. 70-90 kredilik bir tool için destek bileti üreten tek eksik cümle. | S | hayır |
| D4 | **Kiracı başına DFS kotası yok.** Kasıtlı bir saldırgan (büyük domain + `limit:1000`) çağrı başına dokümante tavan $0,132'ye yaklaşır → ~22 çağrı = $2,90 = günlük tavan = 1.430 kredi. **Ölçülmüş gerçek ortalama çok daha düşük:** prod'da settle edilmiş 18 `ranked_keywords` çağrısının ortalaması **$0,0193** (min $0,012, max $0,0698). Yani senaryo savunulabilir ama **tipik kullanım değil, en kötü hâl**. `topup_50` 2.400 kredi/$50. Yani **$50 ödeyen tek hesap, dakika-limitiyle ~25 saniyede fleet'in DFS yüzeyini o gün için kapatabilir.** Saldırının maliyeti $0'dan $50'a çıkmış, mümkünlüğü kalkmamış. | M | kota rakamı operatör kararı |
| D5 | **Yeni ücretli tool trial kapısına OTOMATİK girmiyor ve hiçbir kapı bunu söylemez.** `PAID_BALANCE_TOOLS` elle allowlist; `reserveSpend` çağıran bir tool'un bu sette olduğunu iddia eden test **yok**. Mevcut pin yalnız *ekleme* yönünü yakalar. Kapatma: `pricing/page.test.tsx`'in M-26 testi (her ücretli tool sayfada olmalı) **tam bu şeklin çalışan örneği**. | S | hayır |
| D6 | **Tool açıklamalarındaki `Costs N credits.` cümlesi 13 BAŞKA tool'da elle yazılı ve hiçbir kapıya bağlı değil.** ⚠️ **Bu bir DFS bulgusu DEĞİLDİR ve burada yalnız çapraz-referans olarak duruyor:** dört DFS tool'u + `audit_content` bu cümleyi `${TOOL_COSTS.x}` ile **interpole ediyor**, yani fiyat değişince `tools/list` metinleri otomatik değişir. Gerçek borç `audit-onpage`/`audit-tech`/`audit-schema`/`crawl-site`/`pull-gsc-data`/`generate-report`/`find-quick-wins`/`detect-cannibalization`/`analyze-content-decay`/`connect-gsc`/`list-gsc-properties`/`track-gsc-property`/`untrack-project` dosyalarındaki **14 literal satırdadır**. Generator bu cümleleri docs'tan siliyor → docs sync kapısı hiç bakmıyor → fiyat değişirse `verify.sh` yeşil kalır. **Kullanıcının satın alma öncesi gördüğü tek rakam budur.** Doğru çözüm: interpolasyonu 13 dosyaya da yaymak (DFS ailesi zaten doğru şekli gösteriyor). | S | hayır |

### 4.2 Ürün / veri

| # | bulgu | büyüklük | imza |
|---|---|---|---|
| D7 | **Ödenen yanıtın yarısı çöpe gidiyor.** `ranked_keywords`: `result.metrics.organic` (domainin tüm sıralama dağılımı + ETV, tek blok), `keyword_info.cpc`/`competition` (**kullanıcı bunları 25 kredi daha ödeyerek `research_keywords`'ten satın alıyor**), `serp_item.etv`/`title`, `last_updated_time`. `research_keywords`: **`monthly_searches[]` — 12 aylık trend**, `competition_index`, teklif bandı. `analyze_backlinks`: per-domain `backlinks_spam_score` (**disavow'un tek girdisi**), `first_seen`/`lost_date`, per-anchor `referring_domains` (over-optimization'ın doğru paydası), TLD/ülke/link-tipi dağılımları. **Şerh:** `target_spam_score` ve `serp_item.check_url` bizim fixture'larımızda YOK — vendor'un döndürdüğü **doğrulanmadı**, bu ikisi "atılan alan" değil **doğrulanmamış vendor iddiası**dır. `compare_competitors`: `pos_21_30…91_100` (**domainin varlığının ~%85'i**), `is_new/up/down/lost`, tüm `paid` bloğu. | S–M (her biri) | hayır |
| D8 | **`limit` varsayılanları maksimuma pinli** (`ranked_keywords` 1000, `analyze_backlinks` 1000 **her iki listeye ayrı** → ~2000 madde işareti, `compare_competitors` discovery 1000 satır alıp **3'ünü kullanıyor**). Vendor maliyeti satırla ölçeklenir; LLM bağlamı boşa yenir. | S | hayır |
| D9 | **`ranked_keywords`'te sıralama YOK.** Gövdede `order_by` yok → 1000 satır DFS'in belirtilmemiş varsayılan sırasında. **Dokümanın kendi örneği bu yüzden yanlış:** "top 50 keywords" `limit:50` ile "en iyi 50"yi değil sırası bilinmeyen ilk 50'yi getirir. Ürün "top" kelimesini satıyor, kod sağlamıyor. | S | hayır |
| D10 | **Otomatik rakip keşfi hâlâ dev siteleri getiriyor** — düzelen tek şey açıklama metni oldu. Kodda kara liste yok, büyüklük-bandı filtresi yok, "anlamlı rakip bulunamadı" dürüstlüğü yok. Varsayılan yol hâlâ 90 krediyi çöpe atabiliyor. | M | hayır |
| D11 | **Locale körlüğü.** `.com.tr` bir proje `project_id` ile sorulsa bile ABD SERP'i okunuyor; hedefin metrikleri boş dönüp "No organic ranking data on record." yazılıyor ve **tam ücret tahsil ediliyor**. Kök sebep: `projects` kaydında ülke/dil alanı yok. `research_keywords`'ün locale uyarısı ise **hiç yok** (asimetri). | M | hayır |
| D12 | **`full_domain_metrics` HİPOTEZİ** — discovery yanıtı tam-domain metriklerini taşıyorsa `compare_competitors` 5 istek yerine 1 yapabilir (≈$0,184→$0,132 dokümante sabitlerle, gecikme 5 sıralı HTTP→1). **Repo fixture'ında `full_domain_metrics.organic` ile `metrics.organic` BİREBİR AYNI** (şef ölçtü) — fixture bunu **kanıtlayamaz**, yalnız alanın varlığını gösterir. **Tek canlı çağrı gerekir; ondan önce dispatch YOK.** | L | hayır (ölçüm gerekir) |
| D13 | **Hiçbir şey saklanmıyor** → trend yok, rapor entegrasyonu yok, `whats_next` önerisi yok, panel yok, aynı gün ikinci çağrı tam ücret. `/app/usage` "ranked_keywords −65" der, **hangi domain için olduğunu söylemez** (defterde sorgu izi yok). | L | (a) hayır |
| D14 | **URL yolu sessizce düşürülüyor** — `normalizeDomain` `https://example.com/blog/post`'u `example.com` yapar, uyarı yok. DFS Backlinks `target` olarak URL kabul eder (sayfa profili); kullanıcı sayfa backlink'i isteyip domain profili alıyor ve 70 kredi ödüyor. | S | hayır |
| D15 | **`offset` ve `filters` hiç gönderilmiyor** — 1000. satırdan ötesi erişilemez; "yalnız dofollow", "spam_score<30" gibi daraltmalar mümkünken hep tam liste satın alınıyor. | S/M | hayır |
| D16 | **Aynı fiyat, ~3,5× farklı vendor maliyeti.** `compare_competitors` supplied akışı ≈$0,052, discovery akışı ≈$0,184 (kod sabitlerinden türetildi: 4×$0,013 · $0,132+4×$0,013 — **dokümante rakamlar, ölçülmedi**) — ikisi de 90 kredi (bilinçli pinli). Bugün "iyi kullanım" (rakibi kendin adlandır) pahalı ve D10 sayesinde aynı zamanda değersiz olan kullanımı sübvanse ediyor. | S | **EVET** |
| D17 | Kısmi sonuç sessiz (100 kelime sorulup 60 dönerse söylenmiyor) · keyword normalizasyonu/dedup sıfır · `n/a` "veri yok" ile "hiç aranmıyor"u aynı işaretle gösteriyor (`?? 0` toplamı) · `rank_group` "position" diye satılıyor, `rank_absolute` atılıyor · `spell` düzeltmesi yutuluyor · `THIN_RESULT_ROWS=5` eşiği `.io`/`.ai`/`.co` domainlerinde yanlış-pozitif · vendor tahmini `limit`'ten bağımsız sabit. | S (her biri) | hayır |

### 4.3 Kapsam dışı ama bu turda ölçüldü

**`/app/usage` harcama grafiği yapısal olarak ÖLÜ.** `ui.tsx` hem sparkline hem 14-günlük grafikte
`kind === "spend_commit" && delta < 0` filtreliyor; migration `0011:38-39` ise
`check (kind <> 'spend_commit' or delta = 0)` diyor. **Kesişim boş küme.** Prod ledger'ında 229
`spend_commit` satırı var ve `sum(delta) = 0` (şef ölçtü) → sparkline hiç çizilmiyor, grafik hep
"0 total". Doğru kaynak `spend_reserve` (negatif), `spend_release`'lerle netlenir. **S · imzasız.**

---

## 5. Panel yansıması — "MCP yapar, panel gösterir"

### 5.1 Desen (0024/0025/0026 ikizlerinden)

Zorunlu parçalar: `id uuid pk` · `user_id` + `project_id` · girdi job FK'i · `report jsonb`
(**yapısal**, render edilmiş metin değil) · `created_at` · **bileşik FK'ler** `(user_id, project_id)
→ projects(user_id, id)` kolon listesiz `on delete cascade` · tek index
`(user_id, project_id, created_at desc)` · `enable` **+ `force` row level security` ·** tek
`select_own` policy · `grant select` (authenticated) + `grant select, insert` (service_role) —
**UPDATE/DELETE KASTEN YOK** · `revoke truncate` · her DDL altında `-- Reverse:`.

0026'nın açık kuralları: **`tool` kolonu + CHECK yalnız tablo birden fazla tool'a hizmet ediyorsa
vardır** · **girdi FK sayısı = tool'un okuduğu saklı ölçüm sayısı**.

Yazma yolu: motor **bir kez** koşar ve `{report, text}` döner · yazım `return`'den ÖNCE, guard'sız
(çünkü `withCredits` RETURN edeni COMMIT eder) · hata **YUTULMAZ, throw** — yoksa evin en kötü
şekli çıkar: *ücretlendirilmiş kiracı, teslim edilmiş rapor, sonsuza dek "hiç koşmadı" diyen panel*
· `Json` dönüşümü cast değil `JSON.parse(JSON.stringify(...))` round-trip'i.

Panel: saf karar katmanı (`lib/projects/*.ts`, I/O yok) + RSC sorgusu **çağıranın authenticated
client'ıyla** (service client'a dokunulmaz; RLS gerçek kapı) + yanına açık `user_id` filtresi
(savunmada derinlik) + **yalnız `report->` alt alanları** seçilir, asla `report` bütünü + proje/tool
başına `.limit(1).maybeSingle()` + hata **THROW** (degrade yok) + hep-N-satır (hiç koşmayanlar
dahil: "yokluk daha eyleme dönük olan yarıdır") + `null` **asla `0` diye basılmaz** + tarih
`YYYY-MM-DD` (`Intl` yasak — hydration).

**TREND HENÜZ YOK.** `lib/projects` altında `trend` kelimesi hiç geçmiyor; bugünkü panel yalnız EN
SON koşuyu gösterir. Bir işçiye "trendi 0024 gibi yap" denemez — **emsal yoktur**.

### 5.2 DFS ailesine uygulama — desen OLDUĞU GİBİ uygulanamaz

Dört ölçülmüş engel:

- **E1 — DFS tool'larının `jobs` satırı YOK** (dördü de `charge:"handler"`, senkron). Yani
  `<x>_job_id uuid not null` FK'i **yazılamaz** — 0024/0025/0026'nın provenance omurgası burada yok.
- **E2 — `project_id` opsiyoneldir.** Üç domain tool'u `target` VEYA `project_id` alır ve çıplak
  `target` (rakip domain) en tipik kullanımdır. `NOT NULL` en tipik paid çağrıyı kaydedilemez kılar.
- **E3 — `research_keywords`'ün domain'i YOKTUR** (girdisi kelime listesi) → aynı `target not null`
  kolonunu paylaşamaz.
- **E4 — Payload sınıfı farklı:** `ranked_keywords` 1000 satır ≈ 120 KB ham.

**Karar: tablo adı `dfs_runs` KULLANILMAZ** — `dfs_spend` (0014) zaten vendor **harcama** defteridir
ve `dfs_spend_today_usd` şema sentinel'idir; ikisi karışır. Önerilen ad: **`domain_lookup_runs`**.

**İki tablo:**
1. `domain_lookup_runs` — `ranked_keywords` + `analyze_backlinks` + `compare_competitors` (ortak
   provenance: `target` + locale). `project_id` **NULLABLE** ve bu, desenden ayrıldığı tek yer;
   bedeli açıkça yazılır: nullable kolonla bileşik FK `MATCH SIMPLE` olur ve null satırda kontrolü
   **atlar** → o satırda kiracı güvencesi `user_id`'dir (panelin zaten filtrelediği şey).
2. `research_keywords` **ayrı tablo ya da bu dilimin dışında** — kelime listesini `target` kolonuna
   sıkıştırmak, 0025'in "kolonun adını bir yalana çevirirdi" cümlesinin birebir tekrarıdır.

**Payload kapağı zorunlu:** `report` jsonb + **O(1) başlık alanları** (`total`, `top`) tepede —
PostgREST jsonb'ye iner ama diziyi sayamaz/ilk elemanını alamaz. Liste ≤50 satırla kapaklanır
(0026'nın `MAX_CONTENT_MISMATCHES` deseni); `total` **kapak öncesi** sayıdır.

**Rank tracker BAŞKA BİR ŞEKİL ister.** Koşu-defteri "bu koşu ne dedi?"ye cevap verir; rank tracker
"kelime X zaman içinde nasıl hareket etti?" diye sorar — jsonb blob bunu cevaplayamaz. Bu tam olarak
0023'ün `jobs.result` hakkında yazdığı şeydir. Gerekli şekil: satır ekseni
(`rank_snapshots(user_id, project_id, run_id, keyword, position, url, captured_on)` +
`unique (user_id, project_id, keyword, captured_on)`), koşu-defterinin **yanında**.

**Ve NEVER#7 uyarısı:** `ranked_keywords` üzerine kurulan bir "rank tracker" **rank tracker
DEĞİLDİR** — Labs verisi periyodik yenilenen bir veritabanıdır, dünün fotoğrafı değil geçen ayın
olabilir. Gerçek olanı `serp_organic_live_advanced` ister (gap haritası B2/D7).

DDL taslakları ve cloud-apply deseni gap haritasının kardeşi olan keşif reçetesinde; migration
**0027** bu plan için ayrılmıştır (yerel son migration 0026, cloud'da tablo doğrulandı).

---

## 6. Dilim sırası

**Faz A — imzasız, bugün yapılabilir**

| # | dilim | kapsam | durum |
|---|---|---|---|
| **R1** | `generate_report` zenginleştirme | B1+B2+B3+B6+B7+B8+B9+B11 | **KOD BİTTİ · Fable hakemi PASS** (dal `feat/report-enrichment`, 7 commit, kaynak 697 satır, fiyat 15 SABİT, kapı 16/16). İşçi 45 mutasyon uyguladı, 41'i ilk ölçümde kırmızı; **üç gerçek delik** buldu ve kapattı. Hakem kendi bağımsız mutasyonuyla **dördüncü deliği** buldu (cannibalization sorgu sink'i escape ediliyor ama pinsiz — düşürüldüğünde 1320 test yeşil kaldı); aynı dilimde kapatılıyor. |
| **R2** | `/app/usage` ölü grafik | §4.3 | sıradaki |
| **R3** | DFS para/dürüstlük dilimi | D1 (öksüz rezervasyon) + D2 (tipli bütçe hatası) + D3 ("ücretlendirilmedin") + D5 (yapısal trial-kapısı testi) | sıradaki |
| **R4** | DFS "zaten ödenmiş alanları göster" | D7 + D8 + D9 (varsayılan limit + `order_by`) + D17'nin ucuzları | R3'ten sonra (aynı dosyalar) |
| **R5** | `domain_lookup_runs` (0027) hazır-park + panel | §5.2 | R4'ten sonra; **operatör SQL adımı §7'de** |
| **R6** | `get_credit_balance` harcama dökümü | 0 kredi, ledger'da veri tam mevcut (`tool` kolonu her spend satırında) | bağımsız |
| **R7** | D6 (açıklama cost cümlesi kapısı) + D14 + D15 + B10 | küçük borçlar | son |

**Faz B — imza sonrası** (gap haritası C1–C9): keyword keşif ailesi → `audit_speed` → link/keyword
gap → rank tracker → disavow → AI görünürlüğü.

**Ölçüm gerektiren, dispatch edilmeyen:** D12 (`full_domain_metrics`) — tek canlı DFS çağrısı.

---

## 7. İNSAN İMZA KALEMLERİ (imzasız dispatch YOK)

### 7.1 Fiyat kalemleri

| # | kalem | öneri | not |
|---|---|---|---|
| S1 | **13 yeni tool'un kredi fiyatı** (gap haritası B1–B9) | `kredi ≈ vendor_USD × 400…500` kuralıyla türetilmiş tablo | tek pakette imzalanmalı ki fiyatlar **birbirine göre** tutarlı kalsın; mevcut 25/65/70/90 çıpası ancak topluca bakılırsa korunur |
| S2 | **AI ailesi fiyatları** (`ai_visibility`, `ai_visibility_compare`) | **AYRI ve SONRA** | birim maliyet **ölçülmedi**; ölçmeden sayı imzalamak NEVER#9 |
| S3 | **`research_keywords`'ün geleceği** | `score_keywords` onun üst kümesi — emekli mi, yeniden fiyatlanıyor mu? | **mevcut bir fiyatı oynatır** = tam NEVER#6 |
| S4 | **`compare_competitors` düz fiyatı** (D16) | düz kalsın (mevcut, savunulabilir) **ya da** discovery için ayrı satır | imzasız dokunulmaz |
| S5 | **Kiracı başına günlük DFS kotası** (D4) | fleet tavanının %25'i | rakam operatör kararı; **rank tracker bundan önce canlıya çıkmamalı** |
| S6 | **`audit_tech` 15→20** (teknoloji tespiti eklenirse) | opsiyonel | eklenmezse imza gerekmez |

### 7.2 SQL / altyapı adımları

| # | adım | ne zaman |
|---|---|---|
| Q1 | **`0027_domain_lookup_runs.sql` prod'a uygula** (Supabase SQL Editor) | R5'in PR'ı **hazır-park**ta beklerken; **migration'sız merge = tool yazamaz, fail-closed düşer** |
| Q2 | `public-rls-force-armor.db.test.ts` → `NON_EXEMPTABLE_TABLES` listesine yeni tablo **ve** `audit_content_runs` (**açık borç**: 0026 artık commit'li ama listede yok) | R5 ile aynı dilim |

### 7.3 İzin / erişim kalemleri

| # | kalem | durum |
|---|---|---|
| P1 | **DFS MCP paid çağrısı şef oturumunda sınıflandırıcı tarafından REDDEDİLDİ** | D12'nin ölçümü bu yüzden yapılamadı. Workaround **denenmedi** (doğru davranış). Operatör izin verirse tek çağrı yeterli; bugünkü DFS bütçesi **$0,00/$3,00** — tamamen boş. |
| P2 | **`costs.ts` imza sapması** | Kaynak hâlâ *"audit_content PROPOSED AT 12 AND NOT YET SIGNED"* diyor; PLAN.md ise 2026-08-17'de imzalandığını yazıyor. **Rakam değişmiyor (12), yalnız yorum bayat** — yeni fiyat paketi imzaya gitmeden önce düzeltilmeli. |

---

## 8. Kapı notları — bu planın kapsamadığı

- `verify.sh` **secret taraması ve DB şeritlerini KOŞMAZ**; `verify-db.sh` + `make goals` ayrıca gerekir.
- `make goals` **hiçbir CI job'ında koşmuyor** — kalıcı hedefler yalnız elle ölçülür.
- `check-append-only.sh` kapsamı `credit_ledger events` ile **hardcoded** — yeni `*_runs` tablosunu
  görmez; append-only yalnız kendi db-test'inin davranışsal probuyla kanıtlıdır.
- `cross-tenant-fk.db.test.ts` üç edge'i hardcoded tutar — yeni bileşik FK yalnız kendi db-test'iyle
  kanıtlanır.
- 00:00–00:30 UTC arasında `verify-db` **her dalda** deterministik kırmızı (reaper `spend_day`).
- Paylaşılan lokal Supabase stack'ine **anonssuz `verify-db` reset atılmaz** (iki kaza kaydı var).
- **YENİ (bu turda ölçüldü):** `apps/mcp/tsconfig.json` `exclude: ["src/**/*.test.ts"]` — **`@pseo/mcp`
  test dosyaları HİÇ typecheck edilmiyor.** R1'in her fixture sapması yalnız vitest runtime'ında
  çıktı, `tsc`'de asla. `packages/db`'nin `dbtest_typegate`'i bu problemin çözülmüş emsali. Ayrı
  iş chip'i düşüldü.

---

## 9. Ders adayları (insan imzası olmadan kural değildir)

1. **Hakem, işçinin mutasyon listesini DEĞİL kendi bağımsız mutasyonlarını koşar.** Bu turda kanıt:
   işçi 45 mutasyon uyguladı ve üç gerçek delik buldu; hakem yalnız 7 bağımsız mutasyon yaptı ve
   **dördüncü deliği** buldu (cannibalization sorgu sink'i — işçinin R1-d ekseni quickWins'ti,
   Opportunities'in kendi sink'leri kör noktasıydı). İşçinin listesi tanımı gereği kendi kör
   noktasını içermez.
2. **Plan dosyasındaki "ölçüldü" etiketi, kod yorumundan alıntıyla aynı şey değildir.** Bu turda
   plan hakeminin üçüncü bloklayıcısı tam buydu: `~$0,013` bir DFS doküman fiyatının kod yorumundan
   alıntısıydı, "komşusu ölçüldü" diye etiketlenmişti. Prod'da fan-out **tek settle** olduğu için o
   birim maliyet ölçülemez bile. Kural adayı: **her rakamın yanına kaynağı yazılır** — ÖLÇÜLDÜ
   (nerede) / DOKÜMANTE (kim) / TÜRETİLDİ (hangi sabitlerden).
3. **Bir bulgu, yanlış aileye dosyalanırsa yanlış premis taşır.** "Costs N credits kapıya bağlı
   değil" bulgusu DFS tablosundaydı; oysa DFS ailesi doğru şekli (`${TOOL_COSTS.x}` interpolasyonu)
   zaten gösteriyordu ve borç 13 başka dosyadaydı. O iş emrine giden işçi bağlanacak bir şey
   bulamazdı.
