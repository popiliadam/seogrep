<!-- DURUM: İMZALI 2026-09-02. Bu liste protokolün 5. adımının ölçüsüdür; hiçbir tool bu listeye göre değerlendirilmeden
     "güncel" sayılmaz. İmza satırı en alttadır.
     Şef doğrulaması 2026-09-02: R-1.1/1.2/1.3/1.4, R-5.1/5.2/5.3/5.5, R-2.1/2.2 birincil
     kaynaktan ikinci kez çekildi ve birebir tuttu. Diğer kurallar işçi gözlemi. -->

# Arama Motoru Kuralları — Referans Listesi (taslak)

> Araştırma tarihi: **2026-09-02**. Tüm gözlem tarihleri bu gündür; her satır o gün
> fiilen `WebFetch` ile çekilmiş bir sayfadan alınmıştır. Çekilmemiş hiçbir URL burada yok.
> Doğrulanamayan iddialar **DOĞRULANAMADI** bölümündedir; gövdede olgu gibi sunulmaz.
> Kural numaraları `R-<bölüm>.<n>` biçimindedir ve sonraki turlarda böyle atıf alır.

---

## 1. Core Web Vitals ve PageSpeed Insights

| kural | eşik/detay | kaynak URL | gözlem tarihi | etkilenen tool'lar |
|---|---|---|---|---|
| R-1.1 | LCP "good" eşiği **2,5 saniye** — 2026-09-02'de web.dev'de hâlâ 2,5 s | https://web.dev/articles/vitals | 2026-09-02 | audit_speed, audit_tech, generate_report |
| R-1.2 | INP "good" eşiği **200 ms veya altı** | https://web.dev/articles/vitals | 2026-09-02 | audit_speed, generate_report |
| R-1.3 | CLS "good" eşiği **0,1 veya altı** | https://web.dev/articles/vitals | 2026-09-02 | audit_speed, generate_report |
| R-1.4 | Ölçüm **75. persentil**te yapılır ve mobil/masaüstü ayrı segmentlenir | https://web.dev/articles/vitals | 2026-09-02 | audit_speed, generate_report |
| R-1.5 | INP **2024'te** stabil Core Web Vital oldu; FID'in yerini aldı. web.dev metnindeki ifade: FID'e "olan tam olarak budur" — INP'nin stabilleşmesi | https://web.dev/articles/vitals | 2026-09-02 | audit_speed |
| R-1.6 | Metrik seti yıllık, önceden duyurulan bir kadansla değişir; sayfada **2025/2026 için ilan edilmiş bir eşik değişikliği yok** | https://web.dev/articles/vitals | 2026-09-02 | audit_speed |
| R-1.7 | PSI API v5 iki ayrı veri döndürür: **field = CrUX gerçek kullanıcı verisi**, **lab = Lighthouse**. Google, **CrUX verisini bu API'den kaldırmayı planladığını** ve ayrı CrUX API'ye geçilmesini önerdiğini belirtiyor. **BÖLÜNDÜ (2026-09-02 hakem turu):** *field ≠ lab* yarısı **KALIR** ve `audit_speed`'i bağlar (tool yalnız lab ölçer, field verisi ürüne hiç girmez — R-1.2/INP'nin neden ölçülemediğinin de gerekçesi). *CrUX'un PSI'dan kaldırılması* yarısı bu üründe **İLGİSİZ**: ürün PSI'ı hiç çağırmıyor | https://developers.google.com/speed/docs/insights/v5/get-started | 2026-09-02 | audit_speed (yalnız field≠lab yarısı) |
| R-1.8 | PSI `runpagespeed` parametreleri: `url` (zorunlu), `category` (accessibility·best-practices·performance·seo), `strategy` (**varsayılan desktop**), `locale`. Lighthouse sürümü yanıttaki `lighthouseVersion` alanından okunur; dokümanda **sabit bir sürüm pinlenmemiştir**. **2026-09-02 hakem turunda BÖLÜNDÜ — bu satır artık bir KAYNAK KAYDIDIR, bağlayıcı kural değil:** tool'a uygulanan hâlleri R-1.8a (sürüm) ve R-1.8b (form faktörü) | https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed | 2026-09-02 | — (bkz. R-1.8a, R-1.8b) |
| R-1.8a | **BÖLÜNDÜ (2026-09-02 hakem turu) — `lighthouseVersion` yarısı, satıcıdan BAĞIMSIZ olarak KALIR.** `lighthouseVersion` bir **LHR (Lighthouse Result) alan adıdır**, PSI'a özgü değildir: Lighthouse'u hangi satıcı üzerinden koşarsan koş yanıtta bu adla gelir. Kural: **koşulan Lighthouse sürümü yanıttan okunur ve raporda bildirilir; sabit sürüm varsayılmaz.** Bu üründe ölçülen ihlal: alan `lighthouse_version` diye aranıyor, dolayısıyla hiç okunamıyor (`audit_speed` B-1) | https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed | 2026-09-02 | audit_speed |
| R-1.8b | **BÖLÜNDÜ (2026-09-02 hakem turu) — `strategy` yarısı, SATICI-NÖTR biçimde yeniden yazıldı.** PSI'ın `strategy` parametre ADI bu ürün için sözleşme değildir; kalıcı olan kuraldır: **form faktörü (mobil/masaüstü) açıkça bildirilir, satıcı varsayılanından MİRAS ALINMAZ** — hem istekte açıkça gönderilerek hem çıktıda yazılarak. DataForSEO karşılığı `for_mobile`. Bu üründe ölçülen ihlal: `for_mobile` hiç gönderilmiyor, satıcı varsayılanı (desktop) miras alınıyor ve çıktıda form faktörü hiç geçmiyor (`audit_speed` B-9) | https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed | 2026-09-02 | audit_speed |

> **Kapsam uyarısı:** PSI dokümanı kota/rate limit **yayımlamıyor**; "sık otomatik sorgular için API anahtarı önerilir" demekle yetiniyor. Bir kota rakamı koda gömülüyorsa kaynağı bu doküman değildir.

> **Şerh — bu ürün PSI'ı ÇAĞIRMIYOR (ölçüldü 2026-09-02, dilim 2 hakem turu).** `audit_speed`
> Lighthouse'a **DataForSEO OnPage Lighthouse** ucu üzerinden ulaşır; PageSpeed Insights API'si bu
> üründe hiç kullanılmaz. Sonuç: **PSI parametre adları sözleşme değil EŞLENİKTİR.** R-1.7 ve R-1.8'in
> PSI'a özgü yarıları (CrUX'un PSI'dan kaldırılması; `strategy` parametre adı) bu üründe bağlayıcı
> değildir — bkz. R-1.7 / R-1.8a / R-1.8b, hepsi bu turda bölündü. Satıcıdan bağımsız olarak KALAN iki
> şey: yanıttaki **LHR alan adları** (`lighthouseVersion` gibi — Lighthouse'un kendi çıktı şeması) ve
> **form faktörünün açıkça bildirilmesi** kuralı (DFS karşılığı `for_mobile`). Bir sonraki referans
> turunda R-1 bölümünün kaynağı PSI dokümanı yerine Lighthouse/LHR dokümanı olmalıdır.

---

## 2. Yapılandırılmış veri (structured data)

| kural | eşik/detay | kaynak URL | gözlem tarihi | etkilenen tool'lar |
|---|---|---|---|---|
| R-2.1 | Google'ın **desteklediği** tipler (2026-09-02 galeri): Article, Breadcrumb, Carousel, Course list, Dataset, Discussion forum, Education Q&A, Employer aggregate rating, Event, Image metadata, Job posting, Local business, Math solver, Movie, Organization, Product, Profile page, Q&A, Recipe, Review snippet, Software app, Speakable, Subscription/paywalled content, Vacation rental, Video | https://developers.google.com/search/docs/appearance/structured-data/search-gallery | 2026-09-02 | audit_schema, generate_report |
| R-2.2 | Galeride **FAQPage ve HowTo artık yok** — 2026-09-02 itibarıyla desteklenen tip listesinde bulunmuyorlar | https://developers.google.com/search/docs/appearance/structured-data/search-gallery | 2026-09-02 | audit_schema |
| R-2.3 | Galeride **ClaimReview, Estimated salary, Learning video, Special announcement, Vehicle listing, Practice problems, Book actions da yok** — ölçülen liste yalnız R-2.1'deki 25 tiptir | https://developers.google.com/search/docs/appearance/structured-data/search-gallery | 2026-09-02 | audit_schema |
| R-2.4 | Carousel tek başına yeterli değil: **Recipe, Course list, Restaurant veya Movie ile birleştirilmeli** | https://developers.google.com/search/docs/appearance/structured-data/search-gallery | 2026-09-02 | audit_schema |
| R-2.5 | Rich Results Test **yalnız Google'da rich result tetikleyen** yapılandırılmış veriyi doğrular; yeni deneyimler eklendikçe teste eklenir. Yani "RRT temiz" ≠ "schema geçerli" | https://developers.google.com/search/blog/2020/07/rich-results-test-out-of-beta | 2026-09-02 | audit_schema |
| R-2.6 | **schema.org sürümü 30.0 — 19 Mart 2026**. Önceki: 29.4 (8 Aralık 2025), 29.3 (4 Eylül 2025) | https://schema.org/docs/releases.html | 2026-09-02 | audit_schema |
| R-2.7 | `Course Info`, `Claim Review` vb. tiplerin Search Console raporlamasından çıkarılması **kesin tarihleriyle** doğrulanamadı → bkz. DOĞRULANAMADI D-2 | — | 2026-09-02 | audit_schema, generate_report |

---

## 3. Tarama ve indeksleme

| kural | eşik/detay | kaynak URL | gözlem tarihi | etkilenen tool'lar |
|---|---|---|---|---|
| R-3.1 | robots.txt, **RFC 9309** (Robots Exclusion Protocol) referanslıdır | https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt | 2026-09-02 | crawl_site, audit_tech |
| R-3.2 | robots.txt **boyut sınırı 500 KiB**; sonrası yok sayılır | https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt | 2026-09-02 | crawl_site, audit_tech |
| R-3.3 | Google robots.txt'i **24 saate kadar** cache'ler; yenilenemeyen durumlarda daha uzun | https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt | 2026-09-02 | crawl_site, audit_tech |
| R-3.4 | Desteklenen alanlar yalnız **user-agent, allow, disallow, sitemap**. **`crawl-delay` Google tarafından desteklenmez** | https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt | 2026-09-02 | crawl_site, audit_tech |
| R-3.5 | Eşleşme: **yol uzunluğuna göre en spesifik kural**; çakışmada (wildcard dahil) **en az kısıtlayıcı** kural kazanır | https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt | 2026-09-02 | crawl_site, audit_tech |
| R-3.6 | robots.txt indekslemeyi engellemez: disallow'lu URL **snippet'siz olarak yine de indekslenebilir** | https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt | 2026-09-02 | crawl_site, audit_tech, my_pages |
| R-3.7 | Sitemap: tek dosya **50 MB (sıkıştırılmamış) veya 50.000 URL**; formatlar XML, RSS/mRSS, Atom 1.0, text, sitemap index | https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap | 2026-09-02 | crawl_site, audit_tech |
| R-3.8 | **Google `<priority>` ve `<changefreq>` değerlerini yok sayar**; `<lastmod>` yalnız tutarlı ve doğrulanabilir şekilde doğruysa kullanılır | https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap | 2026-09-02 | crawl_site, audit_tech |
| R-3.9 | `rel=canonical` **direktif değil güçlü sinyaldir**; redirect de güçlü, sitemap dahil olma **zayıf** sinyaldir. HTTPS ve hreflang kümeleri örtük sinyaldir | https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls | 2026-09-02 | audit_tech, audit_onpage, crawl_site |
| R-3.10 | Canonicalization için **robots.txt ve URL removal tool kullanılmaz**; aynı sayfa için farklı tekniklerle farklı canonical verilmez | https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls | 2026-09-02 | audit_tech |
| R-3.11 | JS boru hattı **crawl → render → index**. `200` dönen her sayfa render kuyruğuna girer (robots meta/header aksini söylemedikçe); kuyrukta bekleme "birkaç saniyeden uzun" olabilir | https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics | 2026-09-02 | crawl_site, audit_tech, audit_onpage |
| R-3.12 | Googlebot **evergreen Chromium** kullanır; robots.txt ile bloklu JS/CSS **render edilmez** | https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics | 2026-09-02 | crawl_site, audit_tech |
| R-3.13 | Canonical **JavaScript ile değil HTML'de** verilmelidir; SPA'larda soft-404 redirect ya da noindex ile çözülür | https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics | 2026-09-02 | **audit_onpage** (2026-09-02 hakem turunda `audit_tech`'ten TAŞINDI: canonical kuralları `apps/mcp/src/audit/rules/onpage.ts:226-229`'da; `rules/tech.ts` `canonical` sözcüğünü hiç geçirmiyor — ölçüldü) |
| R-3.14 | **Mobile-first indexing yürürlüktedir**: Google içerik/başlık/meta description/structured data'nın **mobil ile masaüstünde eşdeğer** olmasını ister | https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing | 2026-09-02 | audit_tech, audit_onpage, crawl_site |
| R-3.15 | Meta robots / X-Robots-Tag desteklenen direktifler: `noindex`, `nofollow`, `none`, `nosnippet`, `indexifembedded`, `max-snippet:[n]`, `max-image-preview:[setting]`, `max-video-preview:[n]`, `notranslate`, `noimageindex`, `unavailable_after:[date]` | https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag | 2026-09-02 | audit_onpage, audit_tech, crawl_site |
| R-3.16 | **`noarchive`, `nocache`, `nositelinkssearchbox` artık Google Search tarafından kullanılmıyor** — bu direktifleri "bulgu" diye raporlamak bayat kuraldır | https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag | 2026-09-02 | audit_onpage, audit_tech |
| R-3.17 | Crawl budget yalnız **1M+ sayfa (haftalık değişen)** veya **10.000+ sayfa (günlük değişen)** sitelerde ve "Discovered – currently not indexed" yığılmasında anlamlıdır | https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget | 2026-09-02 | crawl_site, audit_tech, whats_next |
| R-3.18 | Crawl capacity **sunucu sağlığıyla** artar/azalır; crawl demand site boyutu, güncelleme sıklığı, kalite ve popülerliğe bağlıdır. Kalıcı silinen sayfalar **404/410** dönmelidir | https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget | 2026-09-02 | crawl_site, audit_tech |
| R-3.19 | **Indexing API yalnız `JobPosting` veya `VideoObject` içine gömülü `BroadcastEvent` sayfaları içindir**; onboarding/test için varsayılan **200 kota**, üretim için ayrı onay gerekir | https://developers.google.com/search/apis/indexing-api/v3/quickstart | 2026-09-02 | pull_gsc_data, whats_next |
| R-3.20 | **Google-Extended**, içeriğin **gelecek Gemini modellerinin eğitiminde** kullanılıp kullanılmayacağını yönetir ve **Google Search'teki yer alışı ya da sıralamayı etkilemez** | https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers | 2026-09-02 | audit_tech, ai_visibility, crawl_site |
| R-3.21 | Diğer Google token'ları: Googlebot (Search/Discover/Images/Video/News), Googlebot-Image, Googlebot-Video, Googlebot-News, **GoogleOther** (hiçbir ürünü etkilemez), GoogleOther-Image, GoogleOther-Video, **Google-CloudVertexBot** (site sahibinin talebiyle Vertex AI Agent için) | https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers | 2026-09-02 | audit_tech, crawl_site |
| R-3.22 | **OpenAI:** `GPTBot` = model eğitimi; `OAI-SearchBot` = ChatGPT arama sonuçlarında görünme (**opt-out edilirse ChatGPT search cevaplarında gösterilmez**); `ChatGPT-User` = kullanıcı tetikli ziyaret, otomatik crawl değil. robots.txt değişikliğinin yansıması **~24 saat** | https://developers.openai.com/api/docs/bots | 2026-09-02 | ai_visibility, ai_visibility_compare, audit_tech |
| R-3.23 | **Anthropic:** `ClaudeBot` (eğitim), `Claude-User` (kullanıcı sorgusu üzerine getirme), `Claude-SearchBot` (arama kalitesi). Engelleme robots.txt ile; IP engelleme güvenilir değil | https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler | 2026-09-02 | ai_visibility, audit_tech |
| R-3.24 | **Perplexity:** `PerplexityBot` = sonuçlarda listelenmek için (**eğitim için değil**), `Perplexity-User` = kullanıcı tetikli ve **genel olarak robots.txt'i yok sayar**. IP listeleri JSON olarak yayımlanır | https://docs.perplexity.ai/guides/bots | 2026-09-02 | ai_visibility, audit_tech |
| R-3.25 | **IndexNow** açık kaynak bir protokoldür; içerik ekleme/güncelleme/silme bildirimi için kullanılır. Bing ve Yandex dahil birden çok motor benimsemiştir | https://www.bing.com/indexnow | 2026-09-02 | crawl_site, whats_next |

---

## 4. Sayfa içi ve içerik

| kural | eşik/detay | kaynak URL | gözlem tarihi | etkilenen tool'lar |
|---|---|---|---|---|
| R-4.1 | Title link **tamamen otomatik** üretilir; kaynaklar: `<title>`, sayfadaki görsel başlık, `<h1>`, `og:title`, büyük/belirgin stillenmiş metin, sayfadaki anchor text, sayfaya gelen linklerin metni, **`WebSite` structured data** | https://developers.google.com/search/docs/appearance/title-link | 2026-09-02 | audit_onpage, audit_content, find_quick_wins |
| R-4.2 | **`<title>` için karakter sınırı yoktur**; title link gerektiğinde, tipik olarak cihaz genişliğine göre kırpılır. "60 karakter kuralı" Google dokümanında yoktur | https://developers.google.com/search/docs/appearance/title-link | 2026-09-02 | audit_onpage, audit_content |
| R-4.3 | Title'da keyword stuffing, tekrarlı/boilerplate metin ve sayfa dilinden farklı yazım sistemi önerilmez | https://developers.google.com/search/docs/appearance/title-link | 2026-09-02 | audit_onpage |
| R-4.4 | **Meta description için de uzunluk sınırı yoktur**; snippet cihaz genişliğine göre kırpılır. Snippet öncelikle **sayfa içeriğinden** üretilir, meta description bazen kullanılır | https://developers.google.com/search/docs/appearance/snippet | 2026-09-02 | audit_onpage, audit_content |
| R-4.5 | Snippet kontrolleri: `nosnippet`, `max-snippet:[n]`, sayfa parçası için **`data-nosnippet`** | https://developers.google.com/search/docs/appearance/snippet | 2026-09-02 | audit_onpage, audit_tech |
| R-4.6 | **Helpful content system, Mart 2024'te çekirdek sıralama sistemlerinin parçası oldu** ve ayrı bir sistem olarak listelenmiyor | https://developers.google.com/search/docs/appearance/ranking-systems-guide | 2026-09-02 | audit_content, analyze_content_decay, generate_report |
| R-4.7 | Güncel sistemler listesi: BERT, crisis information, deduplication, exact match domain, freshness, **link analysis/PageRank**, local news, MUM, neural matching, original content, removal-based demotion, passage ranking, RankBrain, reliable information, reviews system, site diversity, spam detection | https://developers.google.com/search/docs/appearance/ranking-systems-guide | 2026-09-02 | audit_content, generate_report |
| R-4.8 | **E-E-A-T doğrudan bir ranking factor değildir**, sistemlerin kaliteyi tanımak için kullandığı kavramsal çerçevedir; **"trust en önemlisidir"** | https://developers.google.com/search/docs/fundamentals/creating-helpful-content | 2026-09-02 | audit_content, generate_report |
| R-4.9 | Görsel SEO: açıklayıcı alt text (stuffing yok), açıklayıcı dosya adı, **image sitemap**, desteklenen formatlar **BMP, GIF, JPEG, PNG, WebP, SVG, AVIF**, keskin/yüksek kaliteli görsel, `og:image`/schema ile tercih edilen görsel | https://developers.google.com/search/docs/appearance/google-images | 2026-09-02 | audit_onpage, crawl_site, audit_content |
| R-4.10 | hreflang üç yolla verilir (HTML, HTTP header, sitemap) ve **çift yönlü olmalıdır**: "iki sayfa birbirini göstermiyorsa etiketler yok sayılır" | https://developers.google.com/search/docs/specialty/international/localized-versions | 2026-09-02 | audit_tech, crawl_site, audit_onpage |
| R-4.11 | hreflang kodu **ISO 639-1 dil** + isteğe bağlı **ISO 3166-1 Alpha 2 bölge**. **Tek başına ülke kodu verilemez**; `EU`/`UN` gibi rezerve kodların etkisi yoktur; `x-default` fallback'tir | https://developers.google.com/search/docs/specialty/international/localized-versions | 2026-09-02 | audit_tech, crawl_site |

---

## 5. AI arama

| kural | eşik/detay | kaynak URL | gözlem tarihi | etkilenen tool'lar |
|---|---|---|---|---|
| R-5.1 | AI Overviews / AI Mode için **ek gereksinim veya özel optimizasyon yoktur**; sayfanın indekslenmiş ve **snippet ile gösterilmeye uygun** olması gerekir | https://developers.google.com/search/docs/appearance/ai-features | 2026-09-02 | ai_visibility, ai_visibility_compare, audit_content |
| R-5.2 | **Google, llms.txt gibi dosyaları tanımadığını açıkça yazar:** "Bu özelliklerde görünmek için yeni makine-okunur dosyalar, AI metin dosyaları veya markup oluşturmanız gerekmez" | https://developers.google.com/search/docs/appearance/ai-features | 2026-09-02 | ai_visibility, audit_tech, audit_schema |
| R-5.3 | AI özelliklerinde gösterimi sınırlamak için **mevcut snippet kontrolleri** kullanılır: `nosnippet`, `data-nosnippet`, `max-snippet`, `noindex` | https://developers.google.com/search/docs/appearance/ai-features | 2026-09-02 | ai_visibility, audit_onpage |
| R-5.4 | `nosnippet` "içeriğin **AI Overviews ve AI Mode için doğrudan girdi olarak kullanılmasını da engeller**"; `max-snippet` bu kullanımı da sınırlar | https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag | 2026-09-02 | ai_visibility, audit_onpage, audit_tech |
| R-5.5 | AI özellikleri **"query fan-out"** kullanır: alt konularda çoklu arama yapılır, bu yüzden **daha geniş ve çeşitli bağlantı kümesi** gösterilir. Tek anahtar kelimeye bakan bir ölçüm bu davranışı yakalayamaz | https://developers.google.com/search/docs/appearance/ai-features | 2026-09-02 | ai_visibility, ai_visibility_compare, serp_snapshot |
| R-5.6 | Search + Gemini eğitimi ayrımı: Search dışındaki Google sistemlerinde eğitim/grounding **Google-Extended** ile sınırlanır (bkz. R-3.20) | https://developers.google.com/search/docs/appearance/ai-features | 2026-09-02 | ai_visibility, audit_tech |
| R-5.7 | **Bing tarafı:** "AI Performance" raporu Bing Webmaster Tools'ta **Public Preview** olarak duyuruldu (blog tarihi **10 Şubat 2026**); Microsoft Copilot, Bing AI özetleri ve seçili partner entegrasyonlarını kapsar | https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview | 2026-09-02 | ai_visibility, ai_visibility_compare |
| R-5.8 | Bing AI Performance metrikleri: **Total Citations**, **Average Cited Pages**, **Grounding Queries** (AI'ın içerik getirirken kullandığı ifadeler), sayfa düzeyi alıntı sayısı, zaman içinde görünürlük trendi. Blogda **API'den söz edilmiyor** | https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview | 2026-09-02 | ai_visibility, generate_report |
| R-5.9 | **ChatGPT görünürlüğü** için OpenAI'ın kendi tarifi: robots.txt'te `OAI-SearchBot`'a izin ver ve yayımlanan IP aralıklarından gelen istekleri kabul et | https://developers.openai.com/api/docs/bots | 2026-09-02 | ai_visibility, audit_tech |

---

## 6. Linkler

| kural | eşik/detay | kaynak URL | gözlem tarihi | etkilenen tool'lar |
|---|---|---|---|---|
| R-6.1 | Link spam = sıralamayı manipüle etmek için üretilen linkler: link alım-satımı, aşırı link takası, otomatik link üretimi, **nitelenmemiş linkli native advertising** | https://developers.google.com/search/docs/essentials/spam-policies | 2026-09-02 | analyze_backlinks, backlink_details, disavow_candidates, link_gap |
| R-6.2 | Ücretli/sponsorlu linkler **`rel="nofollow"` veya `rel="sponsored"`** ile nitelenmelidir; kullanıcı üretimi içerik için `ugc` | https://developers.google.com/search/docs/essentials/spam-policies | 2026-09-02 | analyze_backlinks, backlink_details, audit_onpage |
| R-6.3 | **Site reputation abuse:** üçüncü taraf içeriğin ana sitenin sinyallerini sömürmesi. **AEA dışında manual action**, AEA içinde ayrı kategorize edilip bağımsız sıralanır | https://developers.google.com/search/docs/essentials/spam-policies | 2026-09-02 | audit_content, analyze_backlinks, generate_report |
| R-6.4 | **Scaled content abuse:** "kullanıcıya değer katmadan çok sayıda sayfa üretmek için generative AI araçlarını kullanmak" açıkça yasaklı | https://developers.google.com/search/docs/essentials/spam-policies | 2026-09-02 | audit_content, analyze_content_decay |
| R-6.5 | **Expired domain abuse** ve **machine-generated traffic** (Google'a otomatik sorgu) politikaya aykırıdır. Google'a otomatik sorgu **ToS ihlalidir** | https://developers.google.com/search/docs/essentials/spam-policies | 2026-09-02 | serp_snapshot, keyword_positions, ranked_keywords |
| R-6.6 | **Disavow tool hâlâ vardır** ama Google onu dar tutar: yalnız (1) kayda değer sayıda spam/yapay/düşük kaliteli link varsa **ve** (2) bunlar manual action'a yol açtıysa/açacaksa. "Çoğu site bu aracı kullanmaya ihtiyaç duymayacak" | https://support.google.com/webmasters/answer/2648487 | 2026-09-02 | disavow_candidates, analyze_backlinks |
| R-6.7 | Disavow **Domain property'leri desteklemez**; yanlış kullanımı siteye zarar verebilir; işlenmesi **birkaç hafta** sürer. Önce linkleri kaldırmayı denemek beklenir | https://support.google.com/webmasters/answer/2648487 | 2026-09-02 | disavow_candidates, track_gsc_property |
| R-6.8 | Google'ın yayımladığı güncelleme geçmişi (spam ekseni): **Mart 2024 spam update** (5 Mart 2024), **Haziran 2024 spam** (20 Haz 2024), **Aralık 2024 spam** (19 Ara 2024), **Ağustos 2025 spam** (26 Ağu 2025), **Mart 2026 spam** (24 Mar 2026), **Haziran 2026 spam** (24 Haz 2026), **Ağustos 2026 spam** (18 Ağu 2026). Listede **2024–2026 arası ayrı adlandırılmış bir "link spam update" yok** | https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history | 2026-09-02 | analyze_backlinks, backlink_changes, generate_report, analyze_content_decay |
| R-6.9 | Aynı kaynaktan core update geçmişi: Mart 2024 (5 Mar, 45 gün), Ağustos 2024 (15 Ağu), Kasım 2024 (11 Kas), Aralık 2024 (12 Ara), Mart 2025 (13 Mar), Haziran 2025 (30 Haz), Aralık 2025 (11 Ara), **Mart 2026 core (27 Mar 2026)**, **Mayıs 2026 core (21 May 2026)**; ayrıca **Şubat 2026 Discover update (5 Şub 2026)** | https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history | 2026-09-02 | analyze_content_decay, generate_report, whats_next |

---

## 7. Google Search Console API

| kural | eşik/detay | kaynak URL | gözlem tarihi | etkilenen tool'lar |
|---|---|---|---|---|
| R-7.1 | Search Analytics API boyutları: **country, device, page, query, searchAppearance, date, hour** | https://developers.google.com/webmaster-tools/v1/searchanalytics/query | 2026-09-02 | pull_gsc_data, my_pages, find_quick_wins, detect_cannibalization |
| R-7.2 | **`rowLimit` geçerli aralık 1–25.000, varsayılan 1.000**; `startRow` sıfır tabanlı ve negatif olamaz | https://developers.google.com/webmaster-tools/v1/searchanalytics/query | 2026-09-02 | pull_gsc_data, my_pages, detect_cannibalization |
| R-7.3 | `dataState`: **`all`** (taze veri dahil), **`final`** (varsayılan), **`hourly_all`** (saatlik, kısmi) | https://developers.google.com/webmaster-tools/v1/searchanalytics/query | 2026-09-02 | pull_gsc_data, analyze_content_decay |
| R-7.4 | `type`: **discover, googleNews, news, image, video, web** (varsayılan `web`) | https://developers.google.com/webmaster-tools/v1/searchanalytics/query | 2026-09-02 | pull_gsc_data, generate_report |
| R-7.5 | Filtre operatörleri: `contains`, `equals`, `notContains`, `notEquals`, `includingRegex`, `excludingRegex` (**RE2 sözdizimi**). page/query için `equals`/`notEquals` **büyük-küçük harfe duyarlıdır** | https://developers.google.com/webmaster-tools/v1/searchanalytics/query | 2026-09-02 | pull_gsc_data, detect_cannibalization, find_quick_wins |
| R-7.6 | API **tüm satırları döndürmeyi garanti etmez**, yalnız üsttekileri döndürür — Search Console'un dahili sınırlarına tabidir | https://developers.google.com/webmaster-tools/v1/searchanalytics/query | 2026-09-02 | pull_gsc_data, my_pages, generate_report |
| R-7.7 | **Kota — Search Analytics:** site başına **1.200 QPM**, kullanıcı başına **1.200 QPM**, proje başına **30.000.000 QPD** ve **40.000 QPM** | https://developers.google.com/webmaster-tools/limits | 2026-09-02 | pull_gsc_data, connect_gsc, list_gsc_properties |
| R-7.8 | **Kota — URL Inspection:** site başına **2.000 QPD** ve **600 QPM**; proje başına **10.000.000 QPD** ve **15.000 QPM** | https://developers.google.com/webmaster-tools/limits | 2026-09-02 | audit_tech, my_pages, whats_next |
| R-7.9 | **Kota — diğer tüm kaynaklar** (sitemaps, sites dahil): kullanıcı başına **20 QPS** ve **200 QPM**, proje başına **100.000.000 QPD** | https://developers.google.com/webmaster-tools/limits | 2026-09-02 | list_gsc_properties, track_gsc_property, connect_gsc |
| R-7.10 | Performance verisinde **en yeni veri "preliminary"dir** ve sonraki saatlerde değişebilir; grafikte noktalı çizgiyle gösterilir | https://support.google.com/webmasters/answer/7576553 | 2026-09-02 | pull_gsc_data, analyze_content_decay, find_quick_wins |
| R-7.11 | **"Position" tanımı:** grafikte **sitenizin en üstteki sonucunun ortalama pozisyonu**; tabloda ilgili URL/boyut satırının ortalama pozisyonu | https://support.google.com/webmasters/answer/7576553 | 2026-09-02 | keyword_positions, find_quick_wins, detect_cannibalization, generate_report |
| R-7.12 | **Generative AI performance report** (AI Overviews + AI Mode) yalnız **impressions** ölçer; clicks/CTR/position **yoktur**. Boyutlar: pages, countries, dates, devices. Verisi **Performance raporunun `web` search type'ından** gelir ve **1.000 satır sınırı** aynıdır. Ağustos 2026'da dünya çapında tüm sitelere açıldı | https://support.google.com/webmasters/answer/16984139 | 2026-09-02 | ai_visibility, ai_visibility_compare, pull_gsc_data, generate_report |

> **Kapsam uyarısı:** R-7.12'nin **Search Console API'de** olup olmadığı dokümanda yazmıyor → D-4.

---

## 8. Anahtar kelime ve SERP veri sağlayıcıları

| kural | eşik/detay | kaynak URL | gözlem tarihi | etkilenen tool'lar |
|---|---|---|---|---|
| R-8.1 | DataForSEO API aileleri: **SERP, Keywords Data, DataForSEO Labs, Backlinks, On-Page, Content Analysis, AI Optimization** (+ Merchant, App Data, Business Data) | https://docs.dataforseo.com/v3/ | 2026-09-02 | research_keywords, ranked_keywords, serp_snapshot, analyze_backlinks, audit_content |
| R-8.2 | Rate limit **HTTP header'dan okunur**: `X-RateLimit-Limit` (dakika başına tavan), `X-RateLimit-Remaining`. Artış için support'a başvurulur — dokümanda sabit bir sayı yok | https://docs.dataforseo.com/v3/ | 2026-09-02 | tüm DFS tabanlı tool'lar |
| R-8.3 | Veri saklama: **JSON sonuçlar 30 gün, HTML sonuçlar 7 gün** | https://docs.dataforseo.com/v3/ | 2026-09-02 | serp_snapshot, generate_report, get_job_status |
| R-8.4 | **10 Temmuz 2025** — SERP API'ye AI içerik alanları eklendi: `ai_overview` için **`markdown`**, `ai_overview_element` için **`markdown` + `links`** | https://dataforseo.com/update/more-ai-powered-feature-formats-in-serp-api | 2026-09-02 | serp_snapshot, ai_visibility, ai_visibility_compare |
| R-8.5 | Aynı güncellemeyle yeni item type'lar: **`ai_overview_expanded_element`** (`ai_overview_expanded_component` alt bileşenleriyle), **`ai_overview_video_element`**, **`ai_overview_table_element`** — **Organic ve AI Mode uçlarının ikisinde de** | https://dataforseo.com/update/more-ai-powered-feature-formats-in-serp-api | 2026-09-02 | serp_snapshot, ai_visibility |
| R-8.6 | **28 Ağustos 2026** — AI Overviews dahil SERP elementlerinde **doğrudan hedef URL çözümlemesi**; DataForSEO "URL'lerin %99,99'unu çözdüğünü" bildiriyor. Google "goto" yönlendirme URL'lerini ayrıştıran her kod bayatlamıştır | https://dataforseo.com/updates | 2026-09-02 | serp_snapshot, ai_visibility, keyword_positions, ranked_keywords |
| R-8.7 | Yakın dönem diğer DFS değişiklikleri: **AI Mode SERP sonuçlarına paid ads entegrasyonu**, Popular Products elementine shopping ID/product URL/domain eklenmesi, LLM Responses API'de **kaynak anotasyonları**, LLM Mentions API genişlemesi (historical + Lite uçlar) | https://dataforseo.com/updates | 2026-09-02 | serp_snapshot, ai_visibility, ai_visibility_compare |
| R-8.8 | **Search intent taksonomisi (DataForSEO):** `informational`, `navigational`, `commercial`, `transactional` — her biri 0–1 olasılıkla; **istek başına en fazla 1.000 anahtar kelime**, 38 dil | https://docs.dataforseo.com/v3/dataforseo_labs/google/search_intent/live/ | 2026-09-02 | research_keywords, discover_keywords, keyword_gap, find_quick_wins |
| R-8.9 | **Keyword Planner hacmi:** "bir anahtar kelime **ve yakın varyantlarının**" aranma sayısının **12 aylık ortalaması**; değerler **yuvarlanır** (bu yüzden çoklu lokasyonda toplam tutmaz); tarihsel istatistikler **yalnız exact match** için gösterilir | https://support.google.com/google-ads/answer/3022575 | 2026-09-02 | research_keywords, discover_keywords, keyword_gap, generate_report |

---

## 9. Yerel / Türkiye özelinde

| kural | eşik/detay | kaynak URL | gözlem tarihi | etkilenen tool'lar |
|---|---|---|---|---|
| R-9.1 | **ccTLD güçlü bir coğrafi hedefleme sinyalidir** — ".de Almanya, .cn Çin" gibi. `.tr` da bu sınıftadır (Google örnek vermiyor ama ccTLD tanımı gereği) | https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites | 2026-09-02 | setup_project, audit_tech, compare_competitors |
| R-9.2 | Bazı **vanity ccTLD'ler (`.tv`, `.me`) gTLD gibi** işlenir — ccTLD sinyali otomatik değildir | https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites | 2026-09-02 | setup_project, audit_tech |
| R-9.3 | Ülke hedefleme URL yapıları: ülke domaini > subdomain > subdirectory; **URL parametresi (`?loc=de`) açıkça önerilmez** | https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites | 2026-09-02 | setup_project, crawl_site, audit_tech |
| R-9.4 | **Sunucu konumu bir sinyaldir ama kesin değildir** (CDN ve yurtdışı hosting yüzünden) | https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites | 2026-09-02 | audit_tech |
| R-9.5 | **Dil tespiti yalnız görünür sayfa içeriğinden** yapılır: "`lang` gibi kod düzeyi dil bilgisini veya URL'yi kullanmıyoruz". Türkçe içerik için `lang="tr"` bir sıralama/dil sinyali değildir; hreflang ayrı konudur (R-4.10/R-4.11) | https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites | 2026-09-02 | audit_onpage, audit_content, setup_project |

> Google'ın Türkiye'ye özgü, ayrıca yayımlanmış bir SEO kılavuzu bu turda **bulunamadı**; Türkiye kuralları yukarıdaki genel uluslararası dokümandan türetilir.

---

## DOĞRULANAMADI

Aşağıdakiler ya yalnız üçüncü taraf kaynaklarda geçti, ya birincil sayfa çekilemedi, ya da
birincil kaynakla **çelişti**. Hiçbiri koda kural olarak gömülmemelidir.

| # | iddia | durum |
|---|---|---|
| D-1 | "Mart 2026 core update ile LCP 'good' eşiği 2,5 s'den **2,0 s'ye** indirildi; INP eşit ranking sinyali oldu." | **Birincil kaynakla ÇELİŞİYOR.** web.dev/articles/vitals 2026-09-02'de hâlâ 2,5 s / 200 ms / 0,1 diyor. Yalnız SEO blog'larında geçiyor. Kural sayılmaz. |
| D-2 | Course Info · Claim Review · Estimated Salary · Learning Video · Special Announcement · Vehicle Listing · Book Actions'ın kaldırılma tarihleri (duyuru 12 Haz 2025, SC/RRT kaldırma 9 Eyl 2025, SC API Aralık 2025'e kadar, BigQuery 1 Eki 2025'ten NULL). | Google Search Central blog gövdesi WebFetch'e **açılmadı** (yalnız navigasyon döndü). Tiplerin **listede olmadığı** doğrulandı (R-2.3); **tarihler doğrulanmadı**. |
| D-3 | Practice problems desteğinin **Ocak 2026**'da Search Console/RRT'den kaldırılması. | Yalnız arama sonucu özetinde; birincil blog gövdesi çekilemedi. Tipin galeride olmadığı doğrulandı. |
| D-4 | Generative AI performance verisinin **Search Console API'den** çekilebilirliği. | Destek sayfası API'den söz etmiyor; API referansında `type` değerleri arasında AI yok (R-7.4). **Bilinmiyor.** |
| D-5 | HowTo rich result'ın "13 Eylül"de masaüstünden kaldırılması ve FAQ'ın **yalnız yetkili devlet/sağlık siteleri** için gösterilmesi. | Google'ın 2023/08 blog gövdesi çekilemedi. Her iki tipin **galeride olmadığı** doğrulandı (R-2.2). |
| D-6 | Bing'in genel Webmaster Guidelines içeriği (crawl/indeks/kalite/link kuralları). | bing.com/webmasters/help sayfaları JS ile render ediliyor; **gövde alınamadı**. Bing tarafında yalnız R-5.7, R-5.8 ve R-3.25 doğrulandı. |
| D-7 | **llms.txt**'in Bing/Copilot tarafından tanınıp tanınmadığı. | Microsoft'tan birincil bir açıklama **bulunamadı**. Google tarafı nettir (R-5.2). |
| D-8 | AI Overviews / AI Mode'un hangi ülke ve dillerde açık olduğu. | Google'ın ai-features dokümanı **pazar/dil belirtmiyor**; support.google.com/websearch/answer/13572010 **404** döndü. |
| D-9 | PSI API için sayısal kota/rate limit. | Google dokümanı **yayımlamıyor** (yalnız "API anahtarı önerilir"). |
| D-10 | PSI'ın servis ettiği **Lighthouse sürüm numarası**. | Doküman sürüm pinlemiyor; örnek yanıttaki "3.2.0" eski bir demodur. Sürüm **çalışma zamanında** `lighthouseVersion` alanından okunmalıdır. |
| D-11 | DataForSEO **Labs, Backlinks ve Content Analysis** API'lerinde 2025–2026 kırıcı değişiklik olup olmadığı. | dataforseo.com/updates listesinde bu üç aile için kalem **görünmedi**; "değişmedi" demek için yeterli kanıt yok — yalnız **ölçülmedi**. |
| D-12 | GSC Performance'ta **16 aylık veri saklama** ve **UI'da 1.000 satır** sınırı. | 16 ay: birincil sayfada **bulunamadı**. 1.000 satır: yalnız Generative AI raporu sayfasında geçiyor (R-7.12), genel Performance raporu için ayrıca doğrulanmadı. |

---

## Tool eşleme

38 tool · uyması gereken kural kimlikleri · o tool için **en olası bayatlama riski**.

| tool | uyacağı kurallar | en olası bayatlama riski |
|---|---|---|
| setup_project | R-9.1, R-9.2, R-9.3, R-9.5 | (2026-09-02 ölçüldü: kodda TLD dallanması YOK — risk bugün karşılıksız) ccTLD/dil varsayımı ileride sabit kodlanırsa; vanity ccTLD istisnası (R-9.2) |
| connect_gsc | — (R-7.7, R-7.9 İLGİSİZ — 2026-09-02 ölçüldü: tool Google'a istek atmıyor) | Dış kural yok |
| list_projects | — (yalnız kiracı verisi) | Dış kural yok; risk yalnız iç şema |
| get_credit_balance | — | Dış kural yok |
| list_credit_activity | — | Dış kural yok |
| list_jobs | — (R-8.3 İLGİSİZ — 2026-09-02 ölçüldü: `jobs` satırlarını DFS değil kendi tarayıcımız + GSC yazıyor; DFS tabanlı asenkron tool eklenirse yeniden ölç) | Dış kural yok |
| get_job_status | — (R-8.3 İLGİSİZ — aynı ölçüm; canlıda 43 günlük iş tam cevap verdi) | Dış kural yok |
| whats_next | R-3.17, R-3.19, R-6.9, R-7.12 | Öneri metninin kaldırılmış bir özelliğe (ör. FAQ schema, disavow) yönlendirmesi |
| list_gsc_properties | R-7.9 | Kota sınıfının Search Analytics ile karıştırılması |
| track_gsc_property | R-6.7, R-7.9 | Domain property ile URL-prefix property farkının (disavow desteklemez) gözden kaçması |
| untrack_project | — | Dış kural yok |
| track_keywords | R-6.5 (R-8.8, R-8.9 İLGİSİZ — 2026-09-02 ölçüldü: tool hacim/intent göstermiyor; o risk `research_keywords`/`discover_keywords`/`keyword_gap`te) | Google'a otomatik sorgu ToS (R-6.5) — SERP çekimi vendor üzerinden olmalı |
| crawl_site | R-3.1–R-3.8, R-3.11–R-3.14, R-3.18, R-3.21, R-4.9 | 500 KiB robots.txt sınırı ve `crawl-delay`'in Google'da geçersizliği; `priority`/`changefreq` üretmek |
| pull_gsc_data | R-7.1–R-7.7, R-7.10, R-7.12 | `rowLimit` 25.000 tavanı ve `dataState` seçimi; preliminary veriyi final sanmak |
| research_keywords | R-8.1, R-8.8, R-8.9 | Keyword Planner hacminin exact-match-only ve yuvarlanmış olduğunun raporda söylenmemesi |
| discover_keywords | R-8.8, R-8.9 | Intent taksonomisinin 4 değerden farklı varsayılması; 1.000 keyword/istek sınırı |
| my_pages | R-3.6, R-7.1, R-7.2, R-7.6, R-7.8 | API'nin tüm satırları döndürmeme garantisi (R-7.6) "sayfa yok" diye yorumlanır |
| ranked_keywords | R-6.5, R-8.6, R-8.9 | Google "goto" URL çözümlemesi değişikliği (R-8.6) sonrası kendi URL ayrıştırıcısını tutmak |
| analyze_backlinks | R-6.1, R-6.2, R-6.3, R-6.8, D-11 | `sponsored`/`ugc`/`nofollow` ayrımının tek "nofollow" kovasına indirgenmesi |
| compare_competitors | R-6.9, R-9.1 | Core update tarihlerinin karşılaştırma penceresine yansıtılmaması |
| keyword_gap | R-8.8, R-8.9 | Farklı lokasyonların yuvarlanmış hacimlerinin toplanması (R-8.9 açıkça uyarıyor) |
| link_gap | R-6.1, R-6.2 | Nitelenmiş (sponsored/ugc) linklerin "kazanılabilir fırsat" sayılması |
| backlink_changes | R-6.8, R-6.9 | Kayıpların spam/core update takvimiyle (R-6.8/R-6.9) ilişkilendirilmemesi |
| backlink_details | R-6.1, R-6.2 | `rel` niteliklerinin eksik ayrıştırılması |
| disavow_candidates | R-6.1, R-6.6, R-6.7 | **En yüksek risk:** Google disavow'u manual action'a bağlıyor; araç "rutin temizlik" olarak sunulursa doğrudan zarar verir. Domain property desteklenmiyor |
| find_quick_wins | R-4.1, R-4.4, R-7.5, R-7.10, R-7.11 | "Pozisyon" tanımı (en üstteki sonucun ortalaması, R-7.11) ile eşik mantığının uyuşmaması |
| detect_cannibalization | R-3.9, R-7.1, R-7.2, R-7.5, R-7.11 | Case-sensitive `equals` filtresi ve ortalama-pozisyon semantiği |
| analyze_content_decay | R-4.6, R-6.4, R-6.9, R-7.3, R-7.10 | Düşüşün core update takvimine bakılmadan içeriğe atfedilmesi; preliminary veri |
| audit_onpage | R-4.1–R-4.5, R-4.9, R-3.13, R-3.15, R-3.16, R-6.2 | **Karakter sınırı efsanesi:** Google title/description için sınır yayımlamıyor (R-4.2, R-4.4). `noarchive` bulgusu artık ölü (R-3.16). **R-3.13 bu satıra 2026-09-02 hakem turunda `audit_tech`'ten taşındı** — canonical kuralları `onpage.ts:226-229`'da |
| audit_tech | R-3.1–R-3.12, R-3.14–R-3.16, R-3.19, R-4.10, R-4.11, R-9.4 · **BUGÜN YAPISAL OLARAK KARŞILIKSIZ: R-3.20–R-3.24** | AI crawler token listesinin bayatlaması (Claude-SearchBot, OAI-SearchBot, GoogleOther-*) — ama bu risk bu tool'da **bugün karşılıksızdır**: liste yok ki bayatlasın. **Ölçüldü 2026-09-02 (hakem turu):** `CrawlResult` robots.txt gövdesini TAŞIMIYOR ve audit tarafında bir token listesi YOK (`grep -rni "googlebot\|gptbot\|claudebot\|perplexity\|google-extended" apps/mcp/src/audit/` → hiç eşleşme). **Alan eklenmeden bu eksene erişilemez — bkz. `audit_tech` T-B8.** R-3.22–R-3.24 (OpenAI/Anthropic/Perplexity token'ları) bugün **ai_visibility ailesinde** yaşıyor; audit_tech'e ancak `CrawlResult.robotsTxt` eklendikten sonra atfedilebilir. **R-3.13 audit_onpage'e taşındı** (canonical `onpage.ts:226-229`'da) |
| audit_schema | R-2.1–R-2.6, R-5.2 | **En yüksek risk:** FAQ/HowTo/ClaimReview gibi kaldırılmış tipleri "fırsat" diye önermek; schema.org 30.0 sonrası eski sürüme göre doğrulama |
| audit_speed | R-1.1–R-1.6, R-1.7 (**yalnız field≠lab yarısı**), R-1.8a, R-1.8b | **Ölçüldü 2026-09-02 (hakem turu): tool PSI'ı ÇAĞIRMIYOR** — Lighthouse'a **DataForSEO OnPage Lighthouse** ucu üzerinden ulaşıyor, dolayısıyla *"PSI'dan CrUX'un kaldırılma planı"* riski bu üründe **İLGİSİZDİR** (R-1.7'nin o yarısı düştü; field≠lab yarısı kalır ve INP'nin neden ölçülemediğini açıklar). R-1.8 ikiye bölündü: `lighthouseVersion` yarısı **satıcıdan bağımsız KALIR** (LHR alan adı → R-1.8a), `strategy` yarısı satıcı-nötr kurala çevrildi (*form faktörü açıkça bildirilir, varsayılandan miras alınmaz*; DFS karşılığı `for_mobile` → R-1.8b). Kalan gerçek risk: eşiklerin hardcode edilmesi ve FID kalıntısı. **TTI ekseni için referansta kural YOK (2026-09-02) ve B-1 kapanmadan EKLENMEZ** — satıcının hangi Lighthouse sürümünü koştuğu `lighthouseVersion` okunamadığı için bilinmiyor, sürüm bilinmeden TTI'nin güncelliğine hüküm verilemez (`audit_speed` B-3) |
| audit_content | R-4.6, R-4.8, R-6.3, R-6.4, R-2.2 | Helpful content'in ayrı bir sistemmiş gibi puanlanması (Mart 2024'te core'a girdi) |
| ai_visibility | R-5.1–R-5.9, R-3.20, R-3.22–R-3.24, R-8.4–R-8.7 | **En yüksek risk:** llms.txt önerisi (Google açıkça gereksiz diyor, R-5.2); AI Overview item type şemasının 2025-07 ve 2026-08 değişiklikleriyle kayması |
| ai_visibility_compare | R-5.5, R-5.7, R-5.8, R-8.5, R-8.7, **R-3.22–R-3.24** | Query fan-out (R-5.5) yüzünden tek-kelime karşılaştırmasının yanıltıcı olması. **R-3.22–R-3.24 bu satıra 2026-09-02 hakem turunda eklendi:** AI crawler token ailesi (OpenAI/Anthropic/Perplexity) `audit_tech`'te yapısal olarak karşılıksız (T-B8), ve R-3.22 zaten kendi satırında `ai_visibility_compare`'i adlandırıyordu — asimetri kapatıldı. Token listesi bayatlaması bu ailenin riskidir |
| generate_report | R-1.1–R-1.4, R-2.1, R-4.6, R-6.8, R-6.9, R-7.11, R-7.12 | Rapor metnine gömülü eşik/tip/tanım cümlelerinin sessizce bayatlaması |
| keyword_positions | R-6.5, R-7.11, R-8.6 | "Position" tanımının GSC ile SERP API arasında karıştırılması |
| serp_snapshot | R-5.5, R-6.5, R-8.3–R-8.7 | **En yüksek risk:** yeni AI item type'ları (`ai_overview_table_element`, `ai_overview_video_element`) tanınmayıp sessizce düşürülmesi |

---

## 2024'ten bu yana bir SEO aracını en çok bayatlatan 10 değişiklik

1. **INP, FID'in yerini aldı (2024)** — FID'e dayalı her eşik, rozet ve rapor cümlesi ölü.
2. **Helpful content system Mart 2024'te core'a girdi** — ayrı bir "HCU skoru" üretmek artık gerçeğe karşılık gelmiyor.
3. **FAQ ve HowTo rich result'ları desteklenen tipler listesinden çıktı** — bu schema'ları "fırsat" diye önermek zarar veren tavsiye.
4. **Yedi niş schema tipi 2025'te elendi** (Course Info, Claim Review, Estimated Salary, Learning Video, Special Announcement, Vehicle Listing, Book Actions) — Search Console raporları ve RRT bunları artık göstermiyor.
5. **`nosnippet` ve `max-snippet` artık AI Overviews/AI Mode girdisini de sınırlıyor** — snippet kontrolleri, AI görünürlüğü kontrolü hâline geldi.
6. **`noarchive` ve `nositelinkssearchbox` Google Search tarafından kullanılmıyor** — bunları bulgu diye raporlayan denetimler gürültü üretiyor.
7. **Google-Extended ve AI crawler ailesi ortaya çıktı** (GPTBot/OAI-SearchBot, ClaudeBot/Claude-SearchBot, PerplexityBot) — robots.txt denetimi artık salt Googlebot ekseni değil.
8. **Google, llms.txt'i açıkça gereksiz ilan etti** — 2024-2025'te yaygınlaşan "llms.txt ekleyin" tavsiyesi birincil kaynağa aykırı.
9. **GSC'ye Generative AI performance raporu geldi (Haziran 2026, Ağustos 2026'da global)** — yalnız impression; clicks/CTR/position yok, dolayısıyla eski GSC şemasına AI metriklerini eşlemek yanlış sayı üretir.
10. **DataForSEO SERP API'sinin AI yüzeyi iki kez değişti** (2025-07 markdown/links + yeni item type'lar; 2026-08 doğrudan hedef URL çözümlemesi) — kendi "goto" URL ayrıştırıcısını taşıyan ve eski item type kümesini varsayan kod sessizce eksik veri döndürür.

---

## İmza

- [x] Operatör imzası: "imzalıyorum" — 2026-09-02 (sohbet üzerinden, şef kaydetti)
- İmzayla birlikte: D-1..D-12 kural DEĞİLDİR; koda gömülmez. R-1..R-9 protokolün 5. adımının ölçüsüdür.
