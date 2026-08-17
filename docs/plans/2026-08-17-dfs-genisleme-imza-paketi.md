# DFS genişleme — İMZA PAKETİ (v2, ÖLÇÜLMÜŞ · 2026-08-17)

> **v1 tahminlerle kurulmuştu; bu sürüm vendor'ın kendi fiyat listesiyle yeniden kuruldu.**
> Operatör onayıyla ölçüm yapıldı (2026-08-17). Bu paket imzalanana kadar **hiçbir yeni ücretli
> tool dispatch edilmez** (NEVER#6).
>
> Kaynaklar: [Labs](https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api) ·
> [SERP](https://dataforseo.com/pricing/serp/google-organic-serp-api) ·
> [Lighthouse](https://dataforseo.com/pricing/on-page/lighthouse-api) ·
> [Backlinks](https://dataforseo.com/pricing/backlinks/backlinks) ·
> [LLM Mentions](https://dataforseo.com/pricing/ai-optimization/llm-mentions)

---

## Girdi 1 — vendor fiyat formülleri (DOKÜMANTE + prod verimizle ÇAPRAZ DOĞRULANDI)

| API | formül | doğrulama |
|---|---|---|
| **Labs** (çoğu uç) | **$0,012/istek + $0,00012/satır** | ✅ dört nokta (aşağıda) |
| Labs `search_intent` | $0,012/istek + $0,00012/kelime | — |
| Labs historical rank | $0,12/istek + $0,0012/satır — **10× pahalı** | — |
| **Backlinks** | **$0,024/istek + $0,000036/satır** | ✅ (aşağıda) |
| **SERP Google Organic Live** | **$0,002/SERP**, her 10 sonuç için çarpan | — |
| SERP Standard kuyruk | $0,0006/SERP (~5 dk gecikme) | — |
| **OnPage Lighthouse** | **$0,005/sayfa** (live = standard) | — |
| OnPage crawl | $0,000125/sayfa | — |
| **LLM Mentions** | **$0,10/istek + $0,001/satır** ⚠️ | — |
| Keywords Data `google_ads/search_volume` | **$0,0900/çağrı** | ✅ ÖLÇÜLDÜ (prod, 11 settle) |

**Labs formülünün dört bağımsız doğrulaması** — hepsi bizim kendi verimizden:

| ölçüm | formülün dediği | gerçek |
|---|---|---|
| `ranked_keywords` min (0 satır) | $0,012 | **$0,012** ✅ |
| `ranked_keywords` ortalama (~61 satır) | $0,0193 | **$0,0193** ✅ |
| `ranked_keywords` max (~481 satır) | $0,0698 | **$0,0698** ✅ |
| `domain_rank_overview` (1 satır) | $0,01212 | kodumuzun ~$0,013'ü ✅ |

**Backlinks formülünün doğrulaması:** üçlü profil = 3×$0,024 + (1+1000+1000)×$0,000036 =
**$0,144** — kodumuzdaki `ESTIMATED_BACKLINK_PROFILE_CALL_USD` türevi ile birebir.

## Girdi 2 — gelir kuru

En muhafazakâr: **agency $149 / 12.000 kredi = $0,0124/kredi**. Bütün marjlar bununla.

## Fiyatlama kuralı (v2'de netleştirildi)

> Kredi, **tipik** çağrının vendor maliyetine ×400–500 ile bağlanır; **en kötü hâl (max limit)
> yine de ≥3× kalmalıdır.** v1 kuralı yalnız "worst-case × 450" diyordu ve tipik kullanımı
> cezalandırıyordu.

---

## ⚠️ MADDE 0 — v1'in HATALARI (önce bunlar okunmalı)

Ölçüm üç yerde v1'i çürüttü. İkisi bize **zarar** yazacaktı:

**H1 — AI ailesi v1 fiyatıyla ZARAR EDERDİ.** LLM Mentions **$0,10/istek + $0,001/satır**.
v1'in `ai_visibility` 50 kredi = $0,62 geliri; 1000 satırlık bir çağrı $1,10 vendor maliyeti →
**0,56× — her çağrıda zarar**. 100 satırda bile $0,20 → 3,1×, bandın tabanı. Bu ailenin fiyatı
**satır kapağı olmadan yazılamaz**.

**H2 — `score_keywords` v1 tasarımıyla başa baştı.** Üç ayrı Labs isteği (700–1000 kelime)
= 3 × $0,096 = **$0,288**; 30 kredi = $0,372 → **1,29×**. Ama gerek yok: `keyword_overview`
zaten hacim + CPC + rekabet + **intent** + aylık seriyi tek istekte veriyor. → **Bu tool listeden
tamamen düşüyor**, Madde 3'e katlanıyor (aşağıda).

**H3 — `audit_speed` ve `serp_snapshot` v1'de AŞIRI fiyatlanmıştı.** Lighthouse **$0,005/sayfa**:
5 URL = $0,025, v1'in 35 kredisi **17,4×** — bandın çok üstünde. SERP Live **$0,002/SERP**:
v1'in "20 + 8/kelime" tabanı gereksiz yüksekti.

**Ve bir sürpriz kazanç (H4):** `research_keywords` bugün **en kötü marjımız** (3,4×) çünkü Google
Ads `search_volume` ucu **$0,0900/çağrı** — Labs'ın 100 kelimelik `keyword_overview`'ı ise
**$0,024**. Aynı fiyatta, **3,75× daha ucuz**, ve üstüne difficulty + intent + 12 aylık seri.

---

## MADDE 1 — 11 tool'un kredi fiyatı (v2, ölçülmüş)

| # | tool | **v2 kredi** | v1 | tipik vendor | en kötü vendor | tipik marj | en kötü marj |
|---|---|---|---|---|---|---|---|
| 1 | `discover_keywords` | **40** | 40 | $0,024 (100 satır) | $0,132 (1000) | 20,7× | **3,8×** |
| 3 | `track_keywords` | **0** | 0 | — | — | — | — |
| 4 | `serp_snapshot` | **5 + 8/kelime** | 20+8 | $0,02/kelime (depth 100) | aynı | — | **5,3×** |
| 5 | `keyword_positions` | **10** | 10 | $0 (saklanmışı okur) | $0 | ∞ | ∞ |
| 6 | `backlink_changes` | **35** | 45 | $0,061 | $0,12 | 7,1× | 3,6× |
| 7 | `link_gap` | **45** | 60 | $0,024 | $0,132 | 23× | **4,2×** |
| 8 | `disavow_candidates` | **40** | 55 | $0,094 | $0,18 | 5,3× | 2,8× ⚠️ |
| 9 | `backlink_details` | **35** | 35 | $0,048 | $0,084 | 9,0× | 5,2× |
| 10 | `keyword_gap` | **45** | 60 | $0,024 | $0,132 | 23× | **4,2×** |
| 11 | `my_pages` | **40** | 35 | $0,024 | $0,132 | 20,7× | **3,8×** |
| 12 | `audit_speed` | **15** | 35 | $0,025 (5 URL) | $0,025 | 21,5× | 21,5× |
| 13 | `keyword_trends` | **25** | 25 | *ölçülmedi* | *ölçülmedi* | ? | ? |

**Şerhler:**
- **#8 en kötü hâlde 2,8×** — bandın altında. Çözüm fiyat değil **kapak**: aday listesi 200 satırla
  sınırlı kalırsa $0,094 tipik geçerli. Kapak koda yazılır, ve `limit`'in 1000'e çıkmasına izin
  verilmez.
- **#4** `depth=100` ile pinlenir (kendi sıranı bulmak için gerekli); depth 10'da maliyet ×10 düşer,
  o zaman fiyat da düşmeli — **tek depth pinlemek doğru olan**.
- **#12 `audit_speed` 15 kredi** = `audit_tech` ile aynı çıpa. `urls ≤ 5` kapağı fiyatın parçası.
- **#13 tek ölçülmemiş kalem** — Keywords Data / Trends ailesinin fiyatı bulunamadı. 25 kredi
  ($0,31) $0,06'ya kadar güvenli; kalibrasyon taahhüdüne bağlı.
- **#2 `score_keywords` LİSTEDEN DÜŞTÜ** (H2 → Madde 3).

**İmza:** ☐ tabloyu onaylıyorum · ☐ şu satırları değiştir: ______

---

## MADDE 2 — AI görünürlüğü: ÖLÇÜLDÜ, v1 fiyatı ZARARDI

**LLM Mentions = $0,10/istek + $0,001/satır.** Bizim çağırdığımız her ailenin **10 katı** taban
maliyet, ve satır fiyatı Labs'ın **8,3 katı**.

| tool | **v2 kredi** | v1 | koşul | vendor | marj |
|---|---|---|---|---|---|
| `ai_visibility` | **90** | 50 ❌ | `internal_list_limit ≤ 100` **kapağı ZORUNLU** | $0,20 | 5,6× |
| `ai_visibility_compare` | **hedef başına 90** | 70 ❌ | 2–10 hedef | $0,10 + hedef×satır | 5,6× |

**Yapısal uyarı:** 10 hedefli bir karşılaştırma **900 kredi** eder ve `registry.ts`'in **200-kredi
onay eşiğini** (D17) aşar — yani kullanıcıya koşmadan önce onay sorulur. Bu doğru davranış ama
**ürün kararıdır**: ya hedef sayısı 3'le sınırlanır (270 kredi, hâlâ eşik üstü), ya eşik bu tool
için bilinçli kabul edilir.

**Satır kapağı olmadan bu iki tool yazılmamalı** — kapaksız tek çağrı $1,10 vendor maliyeti üretir
ve 90 kredi ($1,12) onu ancak karşılar.

**İmza:** ☐ 90/hedef-başına-90 + kapak · ☐ ertele · ☐ başka: ____

---

## MADDE 3 — `research_keywords`: (c) onaylandı, ve ölçüm onu ÖDÜLLENDİRDİ

Onayın: *"aynı 25 kredide genişlet, yeni tool yazma."* Ölçüm bunu beklenenden iyi yaptı:

| | bugün | (c) sonrası |
|---|---|---|
| uç | Keywords Data `google_ads/search_volume` | Labs `keyword_overview` |
| vendor (100 kelime) | **$0,0900** (ölçüldü) | **$0,024** |
| marj (25 kredide) | **3,4× — en kötümüz** | **12,9×** |
| dönen metrikler | hacim · CPC · rekabet | + **keyword difficulty** · **search intent** · **12 aylık seri** |
| batch tavanı | 100 | 700'e kadar çıkabilir |

**Fiyat değişmiyor (25), marj 3,8× iyileşiyor, üç metrik ekleniyor.** `score_keywords` gereksiz
hâle geliyor.

**TEK ŞART — dispatch öncesi doğrulanacak:** `keyword_overview`'ın `search_volume`'u Google Ads
rakamıyla aynı mı? DFS `keyword_info`'yu Google Ads'ten türettiğini söylüyor ama **biz ölçmedik**.
Canlı bir A/B (aynı 10 kelime, iki uç) yapılmadan bu uç değiştirilmez — yanlış hacim, sessizce
yanlış SEO kararı üretir.

**İmza:** ☐ (c) + A/B şartı · ☐ mevcut uçta kal, yalnız alan ekle

---

## MADDE 4 — `compare_competitors`: (c) onaylandı, ve ölçüm bir MİSPRICING ortaya çıkardı

Onayın: *"fiyat sabit, keşif kalitesini düzelt."* Uygulanıyor. Ama D12 ölçümü fiyat tablosunu da
etkiliyor:

**D12 CANLIDA DOĞRULANDI.** Gerçek `competitors_domain` yanıtında `full_domain_metrics` ile
`metrics` **farklı** (semrush: 62.749 vs 7.383 kelime) — ve `full_domain_metrics.organic`
`domain_rank_overview`'ın verdiği yedi alanın **hepsini artı 8 pozisyon bandı + `is_new/up/down/lost`**
taşıyor. **Hedefin kendisi de listenin ilk satırı olarak dönüyor.**
> ⚠️ Bizim fixture'ımızda bu iki blok **birebir aynıydı** — yani fixture bu ayrımı hiç temsil
> etmiyormuş. İmzalı ders 12'nin bir örneği daha; fixture düzeltilecek.

Sonuç: keşif akışı **5 istek → 1 istek**.

| | bugün | D12 sonrası |
|---|---|---|
| keşif akışı vendor | $0,180 | **$0,0132** (limit 10) |
| 90 kredideki marj | 6,2× | **84×** |
| gecikme | 5 sıralı HTTP | 1 |
| $3 tavanındaki günlük kapasite | ~16 | **~227** |

**84× bir marj değil, bir mispricing.** Karar senin: fiyatı düşürmek (ör. 45 → 42×) müşteri
lehinedir ama **NEVER#6 gereği yine imza ister**; tutmak da savunulabilir (değer fiyatlaması).
Ben **90'da tutmayı** öneriyorum — tool'un değeri maliyetinde değil, rakip seçiminde.

**İmza:** ☐ 90'da kalsın (şef önerisi) · ☐ ____'e düşür

---

## MADDE 5 — kota: kaldırıldı, yerine kapasite kararı

Senin itirazın kabul: **kredi zaten haktır, ikinci kota koymuyoruz.** Yerine:

1. **Kiracı kotası YOK.**
2. **$3/gün'e bugün dokunma** — bağlayıcı değil (bugün $0,00; zirve gün $1,84). Ama artık
   ölçülmüş bir kapasite anlamı var: $3 ≈ **227 keşif-akışı** `compare_competitors` (D12 sonrası)
   ya da **~155** `ranked_keywords` (tipik) ya da **600** Lighthouse sayfası ya da **1500** SERP.
   Bir haftada iki gün %70'i aşarsa tavan yeniden türetilir.
3. **Gözetimsiz harcamaya ayrı bütçe:** rank tracker (`kelime × proje × gün`, cron) kullanıcı
   hiçbir şey yapmadan harcar. **Kota gerekiyorsa yalnız oraya gerekir.** Bugün öyle bir tool yok.

**İmza:** ☐ kabul

---

## MADDE 6 — kalibrasyon taahhüdü ✅ onaylandı

İlk haftanın gerçek `dfs_spend` kayıtlarıyla teyit; herhangi bir tool **×3'ün altına düşerse**
fiyat oturumu yeniden açılır. **v2'de zorunlu olan tek kalem: #13 `keyword_trends`** (tek
ölçülmemiş fiyat).

---

## MADDE 7 — SQL adımları

**Q1 — `0027_domain_lookup_runs.sql`: HENÜZ YAZILMADI.** R5 dilimi üretecek, PR **hazır-park**ta
bekleyecek, SQL metni tek blok hâlinde bu maddeye eklenecek.
Uygulama: Supabase panosu → SQL Editor (proje `dvtqlxwnhdzveytqgksd`).
**Bedel:** uygulanmadan merge edilirse üç DFS tool'u koşu kaydını yazamaz ve **fail-closed düşer**.
Doğrulama: şef `list_tables` ile **tabloyu** görür (sinyale değil tabloya güven).

**Q2 — açık borç (SQL değil):** `public-rls-force-armor.db.test.ts` → `NON_EXEMPTABLE_TABLES`
listesinde `audit_content_runs` **yok**; 0026 commit'li olduğu için bu bir borç. R5 ile kapanır.

---

## MADDE 8 — izin ✅ kullanıldı

Onayınla **bir** `competitors_domain` çağrısı yapıldı. Sonuç Madde 4'te (D12 doğrulandı).
Maliyet: **~$0,0132** (10 satır × Labs formülü).
⚠️ Bu çağrı **DFS MCP sunucusu** üzerinden gitti, yani **senin DFS hesabından** düştü ve **bizim
`dfs_spend` defterimize YAZILMADI**. Bizim uygulamamızın bugünkü kaydı hâlâ $0,00 — doğru, çünkü
uygulamamız bu çağrıyı yapmadı.
Ayrıca ölçüldü: MCP sunucusu yanıttan **`cost` alanını düşürüyor** ve **`limit: 3` istememe rağmen
10 satır döndürdü** — bu sunucu üzerinden maliyet ölçümü mümkün değil, fiyatlar vendor'ın liste
fiyatından alındı.

---

## MADDE 9 — `costs.ts` yorum sapması ✅ onaylandı

`audit_content: 12` **imzalıydı**; `costs.ts`'teki "PROPOSED AT 12 AND NOT YET SIGNED" yorumu bayat.
Rakam değişmiyor, yorum düzeltilecek.

---

## Özet — v1'e göre ne değişti

| | v1 | v2 |
|---|---|---|
| tool sayısı | 13 + 2 AI | **11 + 2 AI** (`score_keywords` düştü) |
| zarar riski | 3 belirsiz | **0 belirsiz** — biri (AI) ölçüldü ve fiyatı 1,8× yükseltildi, biri (score_keywords) tasarımla ortadan kalktı, biri (audit_speed) fiyatı 35→15 düştü |
| ölçülmemiş fiyat | 5 kalem | **1 kalem** (#13) |
| en düşük marj | bilinmiyor (1,2× olabilirdi) | **2,8×** (#8, kapakla 5,3×) |
| sürpriz | — | `research_keywords` marjı 3,4× → **12,9×**, aynı fiyatta |
