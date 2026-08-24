# DataForSEO MCP kataloğu (76 tool) ↔ SeoGrep gap haritası

> Ölçüm tarihi: **2026-08-17** · Yöntem: 76 DFS MCP tool'unun **şeması okundu**, hiçbiri
> **çağrılmadı** (0 vendor harcaması). Bizim yüzeyimiz kaynak koddan okundu.
> Kardeş dosya: `docs/plans/2026-08-17-dfs-rapor-derinlestirme.md` (dilimler + imza kuyruğu).

> ## ⚠️ BU DOSYANIN KREDİ RAKAMLARI **ÖNERİ**, FİYAT DEĞİL — ve dokuzu imzada değişti
>
> Bu bir **2026-08-17 tarihli ölçüm ve öneri** dosyasıdır. "önerilen kredi" rakamları o günkü
> teklifi taşır ve **kasten değiştirilmemiştir**: neyin önerildiği, neyin imzalandığından ayrı bir
> olgudur ve önerinin üstüne imzayı yazmak, teklifin yanlış olduğu bilgisini siler.
>
> **Yürürlükteki tek fiyat kaynağı `apps/mcp/src/credits/costs.ts`'tir** (NEVER#6). 2026-08-24'te
> dosyadaki **her** öneri tek tek o tabloya karşı okundu; **dokuzu imzada başka bir yere oturdu**:
>
> | tool | bölüm | bu dosyadaki öneri | İMZALI ve canlı |
> |---|---|---|---|
> | `serp_snapshot` | §B2 | 20 + kelime başına 8 | **5** + kelime başına 8 |
> | `backlink_changes` | §B3 | 45 | **35** |
> | `link_gap` | §B3 | 60 | **45** |
> | `disavow_candidates` | §B3 | 55 | **40** |
> | `keyword_gap` | §B4 | 60 | **45** |
> | `my_pages` | §B4 | 35 | **40** |
> | `ai_visibility` | §B5 | 50 | **90** |
> | `ai_visibility_compare` | §B5 | 70 | **90 / hedef** (2-10 hedef → 180-900) |
> | `audit_speed` | §B6 | 35 | **15** |
>
> AI ailesindeki 50→90 ve 70→90 bir pazarlık değil **düzeltme**: vendor fiyatları sonradan
> ÖLÇÜLDÜ ve 50 kredi zarar ediyordu. `serp_snapshot`'ın tabanı 20→5 düştü çünkü taban N ile
> amortize oluyor.
>
> **Öneri = imza olanlar:** `discover_keywords` 40 (§B1) · `track_keywords` 0 (§B2) ·
> `keyword_positions` 10 (§B2) · `backlink_details` 35 (§B3). §B1'in `discover_keywords` için
> önerdiği **ikinci kademe** (`limit>500` → 65) **v2'de DÜŞTÜ**: tek fiyat var, ve imzalı en kötü
> vakayı ayakta tutan şey artık fiyat değil **satır kapağı** (`MAX_DISCOVER_ROWS` = 1.000, lookup
> başına tek istek) — bunlar yumuşak sınır değil, imzalı fiyatın parçası (`costs.ts:22-31`).
>
> **Hiç sevk edilmemiş olanlar** (`TOOL_COSTS`'ta yoklar): `keyword_trends` 25 (§B7-B9) — imzalı,
> ama vendor maliyeti hâlâ ölçülmedi · `score_keywords` 30 (§B1) · `brand_mentions` 40 (§B7-B9).
> Bunların rakamı **öneri olarak kalır**; sevkten önce ölçülür ve imzalanır.
>
> Satır numarası KASTEN verilmiyor: bu notun kendisi dosyayı kaydırıyor ve bir önceki sürümü tam
> olarak bu yüzden altı yanlış satıra atıf yapıyordu. Bölüm başlıkları kaymıyor.

## 0. Bugünkü yüzeyimiz — ölçüm

### 0.1 Çağırdığımız yedi uç, dört tool

| # | Endpoint (hepsi `POST …/live`) | Tool (kredi) | Projekte ettiğimiz alan sayısı |
|---|---|---|---|
| 1 | `keywords_data/google_ads/search_volume` | `research_keywords` (25) | 4 |
| 2 | `dataforseo_labs/google/ranked_keywords` | `ranked_keywords` (65) | 5 |
| 3 | `backlinks/summary` | `analyze_backlinks` (70) | 7 |
| 4 | `backlinks/referring_domains` | ↑ aynı tool | 3 |
| 5 | `backlinks/anchors` | ↑ aynı tool | 2 |
| 6 | `dataforseo_labs/google/competitors_domain` | `compare_competitors` (90) | 4 |
| 7 | `dataforseo_labs/google/domain_rank_overview` | ↑ (domain başına 1, ≤4 domain) | 7 |

Kanıt: `apps/mcp/src/dfs/client.ts:29-30` · `dfs/ranked-keywords.ts:30-31` ·
`dfs/backlinks.ts:35-39` · `dfs/competitors.ts:33-35`.

### 0.2 Yapısal kısıtlar — gap analizinin kanıt tabanı

| kısıt | kanıt | sonucu |
|---|---|---|
| `offset` hiç gönderilmiyor | yedi uçun hiçbirinin gövdesinde yok | 1000. satırdan sonrası **erişilemez** |
| `filters` hiç gönderilmiyor | aynı | sunucu-taraflı daraltma yok; hep tam liste satın alınıyor |
| Yalnız `/live` | 7/7 | task-based (POST→GET) hattı **hiç yazılmadı** |
| 30 sn transport deadline | `dfs/client.ts:195` | Lighthouse/derin SERP: **para harcanır, veri gelmez** |
| Fleet-global tek sayaç, kiracı alt-bütçesi YOK | `dfs/budget.ts:34` · migration `0014` | tek kiracı günü bitirebilir |
| DFS sonucu için kalıcılık tablosu YOK | migration 0001–0026'da karşılığı yok | **zaman serisi imkânsız** |
| Locale yalnız İKİ eksende ölçülü | `dfs/…/ranked-keywords.ts` yorumu: US 2840, TR 2792 | yeni pazar = `location_code` çözümleyicisi |
| Performans/CWV ölçümü sıfır | `apps/mcp` altında Lighthouse referansı yok (grep) | `audit_tech` hız hakkında tek kelime edemiyor |

### 0.3 Fiyat çıpası — birim ekonomi (türetildi, uydurulmadı)

`packages/core/src/billing/packages.ts` + `apps/web/components/pricing-plans.ts`:

| paket | fiyat | kredi | kredi başına gelir |
|---|---|---|---|
| starter | $19 | 1.000 | $0,0190 |
| pro | $49 | 3.500 | $0,0140 |
| **agency** | **$149** | **12.000** | **$0,0124 — en muhafazakâr** |
| topup_10 | $10 | 400 | $0,0250 |

En muhafazakâr kurla (agency) mevcut imzalı DFS fiyatlarının gerçek marjı:

| tool | kredi | gelir | vendor maliyeti | çarpan |
|---|---|---|---|---|
| `research_keywords` | 25 | $0,31 | **$0,09 (ÖLÇÜLDÜ** — 2026-08-07 ilk canlı çağrı) | **3,4×** |
| `ranked_keywords` | 65 | $0,81 | ~$0,132 (kod yorumu, DFS dokümanına atıf) | 6,1× |
| `analyze_backlinks` | 70 | $0,87 | ~$0,144 (`dfs/backlinks.ts` tahmin sabitleri) | 6,0× |
| `compare_competitors` | 90 | $1,12 | ~$0,184 (`dfs/competitors.ts`) | 6,1× |

**Türetilen fiyat kuralı** (aşağıdaki her öneri bununla hesaplandı):

> `kredi ≈ vendor_USD × 400…500`, 5'lik ızgaraya yuvarlanır. Taban `audit_schema` = 5.
> Vendor maliyeti SIFIR olan (saklanmış veriyi analiz eden) tool'larda çıpa DFS değil, kendi
> analiz çıpalarımızdır: `find_quick_wins` 10 · `audit_content` 12 · `audit_tech` 15 ·
> `generate_report` 15 · `crawl_site` 20 · `audit_onpage` 30.

**Bu kural bir ÖNERİDİR, imza değildir.** Aşağıdaki hiçbir rakam NEVER#6 anlamında geçerli
değildir; hepsi `docs/plans/2026-08-17-dfs-rapor-derinlestirme.md` §7'deki tek imza paketinde
operatöre gider.

---

## A. Kapsam tablosu — 76 satır

**Sayım: TAM 1 · KISMİ 8 · YOK 67.**
(KISMİ olanlar: `backlinks_anchors` · `backlinks_referring_domains` · `backlinks_summary` ·
`labs_competitors_domain` · `labs_domain_rank_overview` · `labs_ranked_keywords` ·
`on_page_content_parsing` · `on_page_instant_pages`.)

Maliyet sınıfları: **[0]** metadata/sözlük · **[U] ucuz** (tek satırlık DB sorgusu; **DOKÜMANTE**
~$0,013 — DataForSEO Labs standart fiyatlandırması, kod yorumundan alıntı; **ÖLÇÜLMEDİ**, prod
`dfs_spend`'te fan-out tek settle olduğu için izole birim maliyet yok) · **[O] orta** (1000 satırlık
liste, ~$0,06–0,13, aynı şekilde dokümante) · **[P] pahalı** (birim başına
gerçek iş: canlı SERP kazıma / headless Chrome / LLM inference — birim ucuz olsa da **kullanım N
ile çarpıldığı için $3 tavanını asıl bunlar yer**).

### A1 · ai_optimization (11)

| DFS tool | karşılık | ne eksik | değer | maliyet |
|---|---|---|---|---|
| `keyword_data_locations_and_languages` | YOK | locale sözlüğü hiç tüketilmiyor | orta (iç) | [0] |
| `keyword_data_search_volume` | YOK | **LLM'lerdeki** arama hacmi (bizimki Google Ads) | yüksek | [O] |
| `llm_mentions_aggregated_metrics` | YOK | markanın LLM cevaplarında anılma metriği | çok yüksek | [O] *ölçülmedi* |
| `llm_mentions_cross_aggregated_metrics` | YOK | 2–10 hedef yan yana | yüksek | [O] *ölçülmedi* |
| `llm_mentions_filters` | YOK | filtre sözlüğü | orta (iç) | [0] |
| `llm_mentions_locations_and_languages` | YOK | locale sözlüğü | orta (iç) | [0] |
| `llm_mentions_search` | YOK | ham anılma kayıtları | yüksek | [O] *ölçülmedi* |
| `llm_mentions_top_domains` | YOK | LLM'lerin **kaynak gösterdiği** domainler | çok yüksek | [O] *ölçülmedi* |
| `llm_mentions_top_pages` | YOK | "hangi sayfam AI'a kaynak oluyor" | çok yüksek | [O] *ölçülmedi* |
| `llm_models` | YOK | model kataloğu | düşük (iç) | [0] |
| `llm_response` | YOK | DFS üzerinden ham LLM prompt'u | **düşük — bkz. E4** | [P] |

### A2 · backlinks (20)

| DFS tool | karşılık | ne eksik | değer | maliyet |
|---|---|---|---|---|
| `anchors` | **KISMİ** | 2/14 alan (fixture anahtar sayımı); `first_seen`/`lost_date`/`referring_domains`/`rank` yok | orta | [O] |
| `available_filters` | YOK | **filtre DSL'inin tek kaynağı** | yüksek (iç) | [0] |
| `backlinks` | YOK | **link-link listesi hiç yok** | yüksek | [O] |
| `bulk_backlinks` | YOK | 1000 hedef tek istekte | orta | [O] |
| `bulk_new_lost_backlinks` | YOK | **kazanılan/kaybedilen link** | yüksek | [O] |
| `bulk_new_lost_referring_domains` | YOK | ↑ domain ekseni | yüksek | [O] |
| `bulk_pages_summary` | YOK | 1000 sayfanın link özeti | orta | [O] |
| `bulk_ranks` | YOK | toplu domain rank | orta | [U] |
| `bulk_referring_domains` | YOK | toplu RD sayısı | orta | [U] |
| `bulk_spam_score` | YOK | **disavow kararının ana metriği** | yüksek | [U] |
| `competitors` | YOK | **link** rakipleri (bizimki *kelime* rakibi bulur) | yüksek | [O] |
| `domain_intersection` | YOK | **Link Gap** — rakibe link veren, bize vermeyen | **çok yüksek** | [O] |
| `domain_pages` | YOK | sayfa bazlı link dağılımı | orta | [O] |
| `domain_pages_summary` | YOK | ↑ özet | orta | [O] |
| `page_intersection` | YOK | sayfa düzeyinde link gap | yüksek | [O] |
| `referring_domains` | **KISMİ** | 3/14 alan (fixture anahtar sayımı); per-domain `spam_score` yok → disavow imkânsız | orta | [O] |
| `referring_networks` | YOK | **IP/subnet kümelenmesi = PBN tespiti** | yüksek | [O] |
| `summary` | **KISMİ** | 7/26 alan (fixture); `referring_links_tld`/`…types`/`…countries`/`referring_pages` atılıyor. **`target_spam_score` bizim fixture'ımızda YOK** — vendor'un döndürdüğü doğrulanmadı | orta | [U] |
| `timeseries_new_lost_summary` | YOK | **zaman serisi grafiği** | yüksek | [O] |
| `timeseries_summary` | YOK | ↑ toplam profil serisi | yüksek | [O] |

### A3 · business_data (1)

| `business_listings_search` | YOK | Google Maps işletme kayıtları | **düşük — bkz. E2** | [O] |
|---|---|---|---|---|

### A4 · content_analysis (3)

| DFS tool | karşılık | ne eksik | değer | maliyet |
|---|---|---|---|---|
| `phrase_trends` | YOK | ifadenin atıf eğrisi | orta | [O] |
| `search` | YOK | ham atıf kayıtları + sentiment | orta | [O] |
| `summary` | YOK | atıf + sentiment özeti | orta | [O] |

### A5 · dataforseo_labs (21)

| DFS tool | karşılık | ne eksik | değer | maliyet |
|---|---|---|---|---|
| `available_filters` | YOK | Labs filtre DSL sözlüğü | yüksek (iç) | [0] |
| `bulk_keyword_difficulty` | YOK | **KD hiç yok** | **çok yüksek** | [U] |
| `bulk_traffic_estimation` | YOK | 1000 domain trafik tahmini | orta | [O] |
| `google_competitors_domain` | **KISMİ** | `filters`/`offset` yok; rakip sayısı **3'te sabit** | — | [O] |
| `google_domain_intersection` | YOK | **Keyword Gap** | **çok yüksek** | [O] |
| `google_domain_rank_overview` | **KISMİ** | yalnız `metrics.organic`; `paid` bloğu + `pos_21_30…91_100` + `is_new/up/down/lost` atılıyor | — | [U] |
| `google_historical_keyword_data` | YOK | 2021'den beri hacim geçmişi | yüksek | [O] |
| `google_historical_rank_overview` | YOK | **domain görünürlük geçmişi** tek çağrıda | **çok yüksek** | [O] |
| `google_historical_serp` | YOK | kelimenin SERP geçmişi | yüksek | [O] |
| `google_keyword_ideas` | YOK | 200 tohumdan kategori-komşusu fikirler | **çok yüksek** | [O] |
| `google_keyword_overview` | YOK | 700 kelime: hacim + intent + aylık seri | **çok yüksek** | [O] |
| `google_keyword_suggestions` | YOK | tohumu içeren long-tail | **çok yüksek** | [O] |
| `google_keywords_for_site` | YOK | sıralanmadıkları dahil ilgili kelimeler | yüksek | [O] |
| `google_page_intersection` | YOK | ≤20 sayfa kesişimi | yüksek | [O] |
| `google_ranked_keywords` | **KISMİ** | 5 alan; `etv`/`kd`/`intent`/önceki pozisyon okunmuyor; `item_types` **`ai_overview_reference`'ı kaçırıyor** | — | [O] |
| `google_related_keywords` | YOK | `depth` ile 4680 fikir | yüksek | [O] |
| `google_relevant_pages` | YOK | **kendi sayfalarımın sıralama dağılımı** | yüksek | [O] |
| `google_serp_competitors` | YOK | 200 kelimelik kümede kim görünür | yüksek | [O] |
| `google_subdomains` | YOK | alt alan adı kırılımı | düşük | [U] |
| `google_top_searches` | YOK | filtreli keşif havuzu | orta | [O] |
| `search_intent` | YOK | **intent hiç yok** | **çok yüksek** | [U] |

### A6 · domain_analytics (4)

| DFS tool | karşılık | ne eksik | değer | maliyet |
|---|---|---|---|---|
| `technologies_available_filters` | YOK | sözlük | düşük (iç) | [0] |
| `technologies_domain_technologies` | YOK | teknoloji yığını tespiti | orta | [U] |
| `whois_available_filters` | YOK | sözlük | düşük (iç) | [0] |
| `whois_overview` | YOK | **hedef parametresi YOK** — prospecting ucu | **düşük — bkz. E3** | [O] |

### A7 · keywords_data (6)

| DFS tool | karşılık | ne eksik | değer | maliyet |
|---|---|---|---|---|
| `dataforseo_trends_demography` | YOK | yaş/cinsiyet (≤5 kelime) | düşük | [U] |
| `dataforseo_trends_explore` | YOK | DFS kendi trend verisi | orta | [U] |
| `dataforseo_trends_subregion_interests` | YOK | bölgesel ilgi | orta | [U] |
| `google_ads_search_volume` | **TAM** | — `research_keywords` aynı ucu çağırıyor | — | [O] |
| `google_trends_categories` | YOK | kategori sözlüğü | düşük (iç) | [0] |
| `google_trends_explore` | YOK | Trends + **yükselen sorgular** | yüksek | [U] |

### A8 · on_page (3)

| DFS tool | karşılık | ne eksik | değer | maliyet |
|---|---|---|---|---|
| `content_parsing` | **KISMİ** | kendi tarayıcımız var ama **JS render yok** → SPA'da kör | orta | [P] |
| `instant_pages` | **KISMİ** | 25+ sinyal + 12 kural bizde; DFS'in `checks[]` + okunabilirlik yok | orta | [P] |
| `lighthouse` | **YOK** | **hız/CWV ölçümümüz sıfır** | **çok yüksek** | [P] |

### A9 · serp (7)

| DFS tool | karşılık | ne eksik | değer | maliyet |
|---|---|---|---|---|
| `locations` | YOK | konum sözlüğü | yüksek (iç) | [0] |
| `organic_live_advanced` | **YOK** | **canlı SERP anlık görüntüsü — gerçek rank tracker'ın tek yolu** | **çok yüksek** | [P] |
| `youtube_locations` | YOK | — | düşük — E1 | [0] |
| `youtube_organic_live_advanced` | YOK | — | düşük — E1 | [P] |
| `youtube_video_comments_live_advanced` | YOK | — | düşük — E1 | [P] |
| `youtube_video_info_live_advanced` | YOK | — | düşük — E1 | [P] |
| `youtube_video_subtitles_live_advanced` | YOK | — | düşük — E1 | [P] |

---

## B. Gap kümeleri — ürün hikâyeleri ve ÖNERİLEN tool'lar

> 67 açık DFS ucunu 67 MCP tool'una çevirmek yüzeyi 23→90 yapar ve çağıran LLM'in tool seçimini
> bozar. Aşağıda **16 tool** öneriliyor; her biri birden fazla DFS ucunu bir ürün sorusunun
> arkasında toplar. Dağılım: **13'ü tek imza paketinde** · **2'si AI ailesi** (önce ölçüm) ·
> **1'i `brand_mentions`** (AI kararına bağlı). İmza paketi:
> `docs/plans/2026-08-17-dfs-genisleme-imza-paketi.md`.

### B1 · Keyword keşif ailesi — **en büyük tek delik** (9 DFS ucu → 2 tool)

Bugün `research_keywords` **zaten bildiğin** kelimelerin hacmini döner. "Hangi kelimeleri
hedeflemeliyim" sorusunun cevabı üründe **yok**.

**`discover_keywords` — önerilen 40 kredi**
`keyword_ideas` · `keyword_suggestions` · `related_keywords` · `keywords_for_site` · `top_searches`
```
{ seed: string|string[] (≤200), mode: "ideas"|"suggestions"|"related"|"for_site",
  limit: 1..1000 = 100, offset?, min_volume?, max_difficulty?, language_code, location_code }
→ { mode, total_count, rows:[{ keyword, search_volume, cpc, competition,
    keyword_difficulty, search_intent, trend_12m }] }
```
Gerekçe: 1000 satırlık Labs isteği ~$0,132 → ×450 ≈ 59; ortalama koşu ~100 satır kabul edilerek
**40**. `limit>500` için iki-kademeli fiyat (65) imza dosyasında **ayrı madde**.

**`score_keywords` — önerilen 30 kredi**
`keyword_overview` (700/çağrı) · `search_intent` (1000/çağrı) · `bulk_keyword_difficulty` (1000/çağrı)
Üçü de [U] sınıfı; toplam ≈ $0,04–0,06 → ×450 ≈ 18–27 → **30**.
**İmza sorusu:** bu tool `research_keywords`'ün ÜST KÜMESİ. İkisi aynı soruya farklı fiyat veremez
— `research_keywords` emekli mi, yeniden fiyatlanıyor mu? Bu **mevcut bir fiyatı oynatır**.

### B2 · Rank tracker / zaman serisi (4 uç → 3 tool)

**`track_keywords` — önerilen 0 kredi** (kayıt işlemi; `track_gsc_property` çıpası)
**`serp_snapshot` — önerilen 20 kredi + kelime başına 8** · `serp_organic_live_advanced`
**`keyword_positions` — önerilen 10 kredi** (saklanmış seriyi okur, vendor maliyeti SIFIR)

Kademeli fiyat bilinçli: canlı SERP **kelime başına bir kazımadır**, birim maliyeti *ölçülmedi*,
ve tek düz fiyat D3'teki tavan riskini gizler.
**Ön koşul:** yeni kalıcılık tablosu + cron + **kiracı başına günlük alt-bütçe** (bkz. D3).

### B3 · Backlink izleme + link gap + disavow (18 uç → 4 tool)

| tool | önerilen kredi | DFS uçları |
|---|---|---|
| `backlink_changes` | 45 | `timeseries_new_lost_summary` + `timeseries_summary` |
| `link_gap` | 60 | `domain_intersection` (+ `page_intersection` mod) |
| `disavow_candidates` | 55 | `bulk_spam_score` + `referring_networks` + filtreli `backlinks` |
| `backlink_details` | 35 | `backlinks` + `domain_pages_summary`, `offset` destekli |

`disavow_candidates` **`disavow_txt` üretir ama Google'a ASLA göndermez** — dış dünya insanda
(`contract.md`). Üretim öneridir, gönderim değildir.

### B4 · Rakip / pazar payı derinleştirme (7 uç → 2 tool)

`keyword_gap` — 60 kredi (`link_gap`'in kelime ikizi, aynı [O] sınıfı) ·
`my_pages` — 35 kredi (`google_relevant_pages`, **`crawl_pages` ile join** → "sıralanan sayfam vs
taradığım sayfam"; `audit_content`'in DFS eşdeğeri, en özgün birleşimimiz).

### B5 · AI / LLM görünürlüğü — yeni pazar (8 uç → 2 tool)

`ai_visibility` — 50 kredi · `ai_visibility_compare` — 70 kredi.
**Bu iki fiyat, canlı bir ölçüm koşusu olmadan imzaya GİTMEMELİ** — birim maliyet *ölçülmedi*.
İmza dosyasında "$3 tavanı altında 3 keşif çağrısı yapılıp gerçek `cost` okunacak" maddesi olmalı.

### B6 · Sayfa hızı — kendi audit ailemizin deliği (3 uç → 1 tool)

`audit_speed` — 35 kredi, `urls ≤ 5`.
**Teknik ön koşul, fiyattan bağımsız:** `dfs/client.ts:195`'teki 30 sn deadline Lighthouse'a
yetmez → ya kendi deadline'ı ya worker moduna geçiş (`crawl_site` gibi).

### B7–B9 · Küçükler

`keyword_trends` — 25 kredi ([U]) · `brand_mentions` — 40 kredi (B5 canlıya çıkarsa tek tool'da
`source:"ai"|"web"` modu olarak birleştirilmeli) · **teknoloji tespiti ayrı tool OLMAMALI** —
`audit_tech` çıktısına bir satır (0 ek kredi, ya da `audit_tech` 15→20 imzası).

### B10 · Metadata (10 uç → 0 tool)

Dördü `available_filters`, ikisi `locations`, `llm_models`, `trends_categories`…
**Ürünleştirilmemeli ama TÜKETİLMELİ:** `packages/core` altında build-time derlenmiş locale/filtre
sözlüğü. 0 kredi, 0 yüzey, imza yok — ve **B1–B5'in hepsinin ön koşulu**.

---

## C. Öncelik

### C0 — İMZASIZ (fiyat kararı gerektirmez, hepsinin ön koşulu)

1. **`offset` + `filters`** desteği yedi mevcut uca → 1000-satır tavanı kalkar
2. **Locale/filtre sözlüğü** (B10) → `packages/core`
3. **Kiracı başına günlük DFS alt-bütçesi** — B2/B6 canlıya çıkmadan **zorunlu**
4. **DFS sonuç kalıcılık tablosu** — B2/B3/B5'in hepsi buna bağlı
5. **Task-based + uzun-deadline transport hattı** — B6 için
6. **`ranked_keywords` projeksiyonunu genişlet** — `etv`/`kd`/`intent`/`ai_overview_reference`
   **zaten satın alınıyor ve atılıyor**. *Fiyat değişmez, değer artar — en yüksek değer/emek oranı.*
7. **`compare_competitors`: `full_domain_metrics` HİPOTEZİ** — discovery yanıtı tam-domain
   metriklerini taşıyorsa 5 istek yerine 1 yeter. **Repo fixture'ında `full_domain_metrics.organic`
   ile `metrics.organic` BİREBİR AYNI** (şef ölçtü) — yani fixture bu hipotezi **kanıtlayamaz**,
   yalnızca alanın varlığını gösterir. **Tek canlı çağrı gerekir; dispatch ondan önce YOK.**

### C1–C9 — imzalı dilimler (değer/emek sırası)

| # | dilim | değer/emek | neden bu sırada |
|---|---|---|---|
| C1 | B1 keyword keşif (2 tool) | **çok yüksek** | aynı Labs envelope, adaptör birebir yeniden kullanılır; kalıcılık/cron gerektirmez |
| C2 | B6 `audit_speed` | yüksek | kendi audit ailemizin adlandırılmış deliği; `audit_runs` şemasına oturur; C0-5'e bağımlı |
| C3 | B3 `link_gap` + `backlink_changes` | yüksek | backlinks adaptörü en olgun kod |
| C4 | B4 `keyword_gap` + `my_pages` | yüksek | C1'in locale/filtre işini miras alır |
| C5 | B2 rank tracker (3 tool) | orta-yüksek | **en yüksek emek + en yüksek tavan riski**; C0-3 ve C0-4'e bağımlı |
| C6 | B3 `disavow_candidates` + `backlink_details` | orta | C3 üstüne oturur |
| C7 | B5 AI görünürlüğü | belirsiz-yüksek | **fiyat imzası öncesi keşif koşusu şart** |
| C8 | B7 trendler + B9 teknoloji | orta | ucuz, dar |
| C9 | B8 marka atıfları | orta | C7 ile birleşmeli |

---

## D. Tuzaklar

**D1 — Task-based hattımız yok.** 7/7 ucumuz `/live`. DFS'in ucuz yolu POST+GET. Her yeni aileyi
en pahalı modda satın alma riski.

**D2 — 30 sn deadline pahalı uçlarda bize karşı çalışır.** Aşılırsa: **para harcanır, veri gelmez,
rezervasyon AÇIK kalır** (`dfs/client.ts` kendi yorumu bunu söylüyor). B6 tam bu tuzağın üstünde.

**D3 — $3/gün tavanı hangi ailelerde ANINDA dolar.** Bugünkü kapasite (ölçülen $0,09/research
çağrısıyla) ≈ 33 research **ya da** ~22 ranked **ya da** ~16 competitors — *fleet-genelinde*.
- **Rank tracker en tehlikelisi:** maliyet `kelime × proje × gün` ile çarpılır. 20 proje × 25
  kelime = **500 SERP çağrısı/gün**, ve bu *hiçbir kullanıcı hiçbir şey yapmadan*.
  **Kiracı alt-bütçesi olmadan B2 canlıya ÇIKMAMALI.**
- **Lighthouse:** sayfa başına headless Chrome; `urls ≤ 5` sınırı bu yüzden.
- Labs/keşif aileleri görece güvenli (istek başına sabit, satırla ölçekleniyor).

**D4 — Bozuk filtre para harcamadan bütçe alanı yer.** Filtre DSL'i uçtan uca değişir (4 ayrı
`available_filters` bu yüzden var). Hatalı filtre → task 20000 dönmez → kodumuz throw eder →
**rezervasyon AÇIK kalır**. Filtre üretimi build-time doğrulanmalı.

**D5 — Sayfalama sessiz kırpar.** `limit ≤ 1000`, `offset` yok. `total_count` okunuyor (dürüstlük
iyi) ama 1000. satırın ötesine yol yok: "veri yok" değil, "veriyi göremiyoruz".

**D6 — Locale iki yüzlü.** DFS MCP `location_name` (string), REST `location_code` (int) alır.
**Yanlış kod hata vermez — başka pazarın verisini döndürür.**

**D7 — Veri tazeliği aileden aileye değişir ve bu bir ÜRÜN hatası doğurur.**
Labs = periyodik yenilenen veritabanı · Backlinks = sürekli indeks · SERP live = gerçek zamanlı ·
`historical_*` = arşiv.
**Sonuç: `ranked_keywords` üzerine kurulan bir "rank tracker" rank tracker DEĞİLDİR.** Gerçek olanı
`serp_organic_live_advanced` ister. Bu ayrım pazarlama metnine de geçmeli — NEVER#7.

**D8 — `bulk_*` uçlarda rezervasyon modelimiz kırılıyor.** Bugünkü `ESTIMATED_*` sabitleri düz ve
çağrı başına. 1000 hedefli bir `bulk_*` isteğinin maliyeti satırla ölçeklenir.
`dfs/competitors.ts`'in `estimateComparisonUsd`'i doğru şablonu zaten gösteriyor.

**D9 — `include_subdomains` / `exclude_large_domains` varsayılanları sessizce sonucu değiştirir.**
Bayrakları AÇIKÇA pinlemek, "top N" iddiasının belgeli kalmasının tek yolu (aynı disiplin
`RANK_SCALE`/`ORDER_BY` için `dfs/backlinks.ts`'te zaten uygulanmış).

---

## E. Ne ürünleştirilmemeli (gerekçeli; karar operatörün)

**E1 · YouTube ailesi (5 tool).** Veri modelimiz **domain + GSC property** anahtarlı; YouTube'un
ne domain'i ne GSC bağlantısı var, `setup_project`'in hiçbir alanı video ID taşımıyor. Alıcı da
farklı. **Kısmi istisna:** "kelimemde video SERP'i var mı" sorusu `serp_organic_live_advanced`'in
`serp_features` çıktısından zaten ücretsiz gelir.

**E2 · `business_listings_search`.** Yerel SEO ayrı ürün hattı; konum varlığımız, NAP kavramımız,
panelde yeri yok. Tek tool "yerel SEO da yapıyoruz" vaadini doğurur, arkası boş kalır.

**E3 · `whois_overview`.** Şemasında **hedef parametresi yok**, yalnız `filters` — bu "domainimi
göster" ucu değil, whois veritabanını tarayan bir **prospecting** ucu. Hizmet ettiği kişi site
sahibi değil. (`technologies_domain_technologies` farklı: hedefli, ve B9'da `audit_tech`'e satır
olarak öneriliyor.)

**E4 · `llm_response`.** DFS'e para ödeyip bir LLM prompt'u koşturmak — **biz zaten bir LLM
istemcisine konuşan MCP sunucusuyuz**, çağıranın kendi modeli var. Dar istisna ("belirli model
markam hakkında ne diyor") `llm_mentions_*` ailesi tarafından toplu ve ucuz karşılanıyor.

**E5 · 10 metadata tool'u.** Ürünleştirilmemeli **ama tüketilmeli** (B10/C0-2).
