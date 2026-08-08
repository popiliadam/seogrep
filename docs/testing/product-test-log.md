# Ürün testi — plan ve bulgu defteri

> **Yaşayan doküman.** Test sürdükçe buraya yazılır, sonra buradan iş emri çıkar.
> Açılış: 2026-08-07 · Kapsam: 19 MCP tool'unun tamamı, gerçek bir siteye karşı, canlı ortamda.

## Bu neden var

Ürün canlı, para alıyor, üç kapı yeşil, 1568 test geçiyor. Ama **ücretli 13 tool'un 7'si canlıda
bugüne kadar tek bir gerçek çıktı üretmedi** — aralarında en pahalı üçü de var. Yani ürünün
sağlam olduğunu biliyoruz; **iyi olup olmadığını bilmiyoruz.** Bu defter o boşluğu kapatmak için.

### Açılıştaki ölçüm (2026-08-07, `credit_ledger`'dan)

| Ücretli tool | Canlı koşu | Son |
|---|---|---|
| `crawl_site` | 4 | 2026-08-07 |
| `research_keywords` | 3 | 2026-08-07 |
| `audit_onpage` | 2 | **2026-07-20** |
| `generate_report` | 2 | **2026-07-20** |
| `audit_tech` | 1 | **2026-07-20** |
| `audit_schema` | 1 | **2026-07-20** |
| `ranked_keywords` (65) | **0** | — |
| `analyze_backlinks` (70) | **0** | — |
| `compare_competitors` (90) | **0** | — |
| `pull_gsc_data` | **0** | — |
| `find_quick_wins` | **0** | — |
| `detect_cannibalization` | **0** | — |
| `analyze_content_decay` | **0** | — |

> Ücretsiz tool'lar (`setup_project` · `connect_gsc` · `list_projects` · `get_credit_balance` ·
> `get_job_status` · `whats_next`) deftere satır yazmaz — onlar bu tabloda **ölçülemez**, "0"
> yazmıyor olmaları kullanılmadıkları anlamına gelmez.

Ayrıca: GSC bağlantısı **var** (1 satır) ama arkasındaki 4 tool hiç koşmamış. `jobs` tablosundaki
2 başarısız iş 2026-07-21 tarihli ve imzalı ders 6'daki `SUPABASE_DB_URL` vakası — düzeltildi,
açıklanamayan hata yok.

---

## İki yarı, iki farklı ölçüm

Testin iki yarısı **farklı sorular** soruyor ve **farklı kişiler** yapmalı. Karıştırılırsa ikisi de
eksik ölçülür.

### Yarı A — ŞEF (`curl` ile doğrudan MCP endpoint'i)
**Soru: doğru veri dönüyor mu?**
- Çıktı gerçekten doğru mu, sayılar tutarlı mı?
- Defter doğru mu (rezerve → commit, doğru tutar, iade gereken yerde iade)?
- Hata mesajları dürüst mü, iç detay sızdırıyor mu?
- Vendor harcaması beklenen mi?

### Yarı B — OPERATÖR (Claude Desktop / Claude Code, normal cümlelerle)
**Soru: kullanılabilir mi?** ← *şef bunu yapamaz, bugüne dek hiç yapılmadı*
- LLM **açıklamadan doğru tool'u seçiyor mu**? (açıklamalar 2026-08-07'de değişti)
- Çıktı sohbetin içinde işe yarıyor mu, yoksa okunamaz bir duvar mı?
- `whats_next` gerçekten yol gösteriyor mu?
- 65/70/90 kredi ödemiş olmak **değdi** hissi veriyor mu?
- Nerede takılıyorsun, nerede "bu ne demek şimdi" diyorsun?

---

## Test turları

Sıra önemli: her tur bir öncekinin verisine yaslanıyor.

### Tur 1 — Temel akış · **85 kredi**
`setup_project` → `crawl_site` → `audit_onpage` → `audit_tech` → `audit_schema` → `generate_report`

Bakılacak: crawl kaç sayfa buldu, denetim bulguları gerçek mi yoksa jenerik mi, rapor linki
açılıyor mu, rapor bir insana bir şey anlatıyor mu.

### Tur 2 — GSC ailesi · **35 kredi** · *4 tool ilk kez*
`connect_gsc` → `pull_gsc_data` → `find_quick_wins` → `detect_cannibalization` → `analyze_content_decay`

Bakılacak: OAuth akışı pürüzsüz mü, veri gerçekten Search Console'dan mı geliyor, "quick win"
önerileri gerçekten hızlı kazanç mı yoksa gürültü mü.

### Tur 3 — Premium / DataForSEO · **225 kredi** · *üçü de ilk kez* · vendor ≈ **$0.85**
`ranked_keywords` → `analyze_backlinks` → `compare_competitors`

Bakılacak: **en kritik tur.** Bu üçü ürünün en pahalı vaadi ve bugüne kadar hiç çalışmadı.
Çıktı 90 krediyi hak ediyor mu? Rakip karşılaştırması gerçekten karar verdiriyor mu?
Vendor maliyeti tahminle uyuşuyor mu (`dfs_spend`'den ölçülür)?

### Tur 4 — Yardımcılar · **0 kredi**
`whats_next` (her turun arasında!) · `list_projects` · `get_job_status` · `get_credit_balance`

Bakılacak: `whats_next` bağlama göre değişiyor mu, yoksa hep aynı şeyi mi diyor.

**Toplam ≈ 345 kredi** (ödeyen hesapta 1380 var) · **vendor ≈ $0.85** ($3/gün tavanının altında).

---

## Kurallar

1. **Ölç, iddia etme.** Her bulgu bir çıktıya ya da bir DB satırına dayanmalı.
2. **Kredi/fiyat rakamı bu testte DEĞİŞMEZ** (NEVER#6). Bir fiyat yanlış geliyorsa bulgu olarak
   yazılır, dokunulmaz.
3. **Bulgu ≠ iş emri.** Burası ham defter. İş emirleri test bittikten sonra, triyajdan sonra çıkar.
4. Bir bulgu düzeltilirse satırı **silme** — `Durum`'u güncelle. Defterin değeri geçmişinde.

---

# BULGU DEFTERİ

`Kaynak`: **O** = operatör · **Ş** = şef
`Önem`: 🔴 bloklayan (müşteri görürse utanırız) · 🟡 önemli · 🟢 iyileştirme/fikir
`Durum`: `açık` · `iş emri yazıldı` · `düzeltildi` · `kabul edildi (yapılmayacak)`

| # | Kaynak | Tool / alan | Bulgu | Önem | Durum |
|---|---|---|---|---|---|
| 2 | Ş | `crawl_site` | **20 kredi ödendi, ANA SAYFA taranmadı.** adstark.com.tr: 24 sayfa tarandı, 43 atlandı, hepsinin sebebi `time budget exhausted`. Taranan 24'ün **tamamı blog yazısı**; atlananlar arasında `/` (ana sayfa), `/seo`, `/google-ads-yonetimi`, `/iletisim`, `/hakkimizda`, `/referanslar` — yani sitenin **bütün para sayfaları**. Kök sebep ölçüldü (`crawler/crawl.ts:970`): sitemap varsa kuyruk = `[...seeds]`, ana sayfa yalnız **sitemap yoksa** fallback tohum. Yoast `sitemap_index.xml` önce post sitemap'lerini listeliyor → blog önce → 90 sn `DEFAULT_TIME_BUDGET_MS` (crawl.ts:366) 24. sayfada doldu (iş 92 sn sürdü). Defter tarafı DOĞRU ama acımasız: rezerve −20 → commit `delta 0`, %36 kapsama için tam ücret, orantılı iade yok. | 🔴 | **PR #44** |
| 3 | Ş | `crawl_site` | **Atlama sebebi ayrı bir ÜCRETLİ tool'un arkasında.** `crawl_site` cevabı yalnız "skipped 43" diyor — sebep yok, liste yok. Sebep + tam liste `audit_tech`'te (**15 kredi**) çıkıyor. Yani kullanıcı ana sayfasının taranmadığını öğrenmek için 15 kredi daha ödemek zorunda. *(İlk yazımda "sadece DB'de" demiştim — yanlış; `audit_tech` gösteriyor.)* | 🟡 | **PR #44** |
| 6 | Ş | `audit_tech` | **"Redirects surfaced: 0" — oysa taranan 24 URL'in 24'ü de 301.** Ölçüm: `curl` ile dört sayfa, hepsi `301 → /…/`. Sebep yapısal: `PageRecord`'da yönlendirme zinciri alanı YOK (crawl.ts:25-38); `fetchPage` 301'i döngüde izleyip yutuyor, yalnız NİHAİ status'ü (200) yazıyor → `audit_tech` 3xx'i `page.status`'ten saydığı için sonuç daima 0. Kod bunu bilerek yapıyor ve yorumda yazıyor (tech.ts:8-12), yani hata değil **kapsam sınırı** — ama müşteri "Redirects (3xx): 0" satırını "sitemde yönlendirme sorunu yok" diye okur. Teknik SEO denetimi satın almanın ilk üç sebebinden biri tam olarak yönlendirme zinciri bulmaktır. Faz 3'te `PageRecord.originalUrls` borcu kayda geçmişti (PLAN.md:91) — ödenmedi, şimdi müşteriye dönük sonucu var. | 🟡 | açık (dilim 5'e ertelendi) |
| 7 | Ş | `crawl_site` | **Crawler kendi kendine 301 üretiyor.** `normalizeUrl` (crawl.ts) her URL'in sondaki `/`'ını siliyor. Yoast sitemap'i `/roas-nedir/` veriyor → crawler `/roas-nedir` istiyor → site 301 ile `/roas-nedir/`'e geri yolluyor. Yani **her sayfa 1 yerine 2 istek**. Ölçüldü (4 sayfa): slash'sız ort. **0.59 sn**, slash'lı ort. **0.35 sn** → ağ süresinde **~%70 fazladan yük**. Gözlenen tarama hızı 3.7 sn/sayfa olduğu için baskın maliyet bu DEĞİL (ayrıştırma/DB daha ağır) — ama 90 sn'lik bütçeyi yiyen, tamamen kaçınılabilir bir vergi. Trailing-slash WordPress varsayılanıdır, yani web'in büyük kısmı. | 🟡 | açık |
| 8 | Ş | `generate_report` | **Rapor "GSC'yi bağla" diyor, GSC ZATEN bağlı.** Aynı proje için `whats_next` "Google Search Console is connected" derken rapordaki Search performance bölümü "No Search Console data yet. **Connect it with `connect_gsc`**" diyor. `gsc_connections`'ta satır var (2026-07-28). Rapor bağlantı durumuna değil yalnız veri varlığına bakıyor. Doğru mesaj "bağlı, ama veri çekilmemiş — `pull_gsc_data` koş" olmalıydı. İki canlı tool aynı proje hakkında çelişiyor. | 🟡 | **PR #42** |
| 9 | Ş | `generate_report` | **Herkese açık raporun çağrıları yanlış kitleye sesleniyor.** Tool açıklaması raporu "share with clients or teammates" diye satıyor; rapor gövdesinde üç kez "Run `audit_onpage` / `audit_tech` / `audit_schema` for the full per-page breakdown" yazıyor. Raporu alan müşterinin hesabı yok, o tool'ları koşamaz. Paylaşılan artefakt operatöre hitap ediyor. | 🟡 | açık |
| 10 | Ş | `generate_report` | **Raporda "43 Pages skipped" çıplak sayı.** Sebep yok, hangi sayfalar belli değil, ana sayfanın atlandığı görünmüyor. Müşteriye gönderilen belge "43 sayfanı atladık" deyip sebebini söylemiyor → ilk soru "neden?" olur, cevabı belgede yok. #3'ün müşteriye dönük yüzü. | 🟡 | açık |
| 12 | Ş | `detect_cannibalization` | **Tek sonucu YANLIŞ POZİTİF: marka sorgusu sitelink'leri.** Canlı çıktıda tek "yamyamlaşma" `"adstark"` — yani **şirketin kendi marka adı**. Desen tam sitelink imzası: ana sayfa 3.9, dört iç sayfa **tam 1.0** (`/hakkimizda/`, `/iletisim/`, `/sosyal-medya-yonetimi/`, `/ucretsiz-analiz/`). Bu sağlıklı marka SERP davranışı, sorun DEĞİL. Kural tamamen mekanik (`cannibalization.ts`: `MIN_PAGE_IMPRESSIONS=10`, `MIN_SHARE=0.1`, ≥2 sayfa) — marka/navigasyonel sorgu filtresi yok, sitelink deseni (bir sayfa ~1-4 + birkaç sayfa tam 1.0) tanınmıyor. Marka bilinirliği olan HER sitede marka sorgusu bu tool'un ilk sonucu olacak. Bunu gören SEO'cu tool'a güvenmeyi bırakır; bunu ciddiye alan kullanıcı kendi marka sayfalarını de-optimize etmeye kalkar = **aktif zarar**. 🔴 gerekçesi "müşteri görürse utanırız" testidir; triyaj düşürebilir. | 🔴 | **PR #45** |
| 13 | Ş | GSC ↔ crawl | **İki veri kaynağı aynı sayfayı farklı URL biçiminde tutuyor → birleştirilemezler.** Crawler `normalizeUrl` yüzünden `…/roas-nedir` (slash'sız) yazıyor; GSC `…/roas-nedir/` (slash'lı) döndürüyor. Bugün bir yerde JOIN edilmedikleri için **kırık değil, gizli borç**: "bu sayfa düşüşte VE title'ı uzun" gibi crawl×GSC birleşimi isteyen her gelecek özellik sessizce 0 eşleşme bulur. #7 ile aynı kök (`normalizeUrl`). | 🟡 | açık |
| 14 | Ş | `whats_next` | **Analiz tool'larının koşulup koşulmadığını takip etmiyor.** Tur 2 bittikten sonra hâlâ "Then: find_quick_wins, detect_cannibalization, analyze_content_decay" öneriyor — üçü de dakikalar önce koşmuştu; ayrıca rapor üretilmişken "recommended next: generate_report" diyor. Crawl/pull tazeliğini biliyor, analiz geçmişini bilmiyor. Küçük ama tekrar-satın-alma önerdiği için kredi harcatabilir. | 🟢 | açık |
| 15 | Ş | `analyze_backlinks` | **70 kredilik tool CANLIDA HİÇ ÇALIŞMIYOR — `null` anchor'da patlıyor.** İlk gerçek koşu hata verdi (ref `5ded2b4e`). Fly log'u: `DataForSEO anchors result was not in the expected shape: Invalid input: expected string, received null → at items[1].anchor`. Kök sebep tam olarak ölçüldü: `backlinks.ts:105` yorumu **doğru olanı yazmış** — "An empty `anchor` is legitimate (image links carry no anchor text)" — ama tip `anchor: string` (satır 107) ve şema `z.string()` (satır 216); yani `""` kabul, `null` RED. DataForSEO görsel bağlantılar için `null` gönderiyor. **7 fixture'ın hiçbirinde `null` anchor yok** (ölçtüm) → tüm testler yeşil, ilk canlı çağrı ölüyor. NEVER#5'in kabul edilmiş artık riski tam da bu: fixture yalnız bilinen şekilleri kodlar. Görsel backlink'i olmayan alan adı neredeyse yok → tool pratikte **hiçbir müşteride çalışmaz**. *(Para tarafı DOĞRU davrandı: `spend_reserve −70` → `spend_release +70`, kullanıcı ücretlendirilmedi.)* | 🔴 | **DÜZELTİLDİ 2026-08-07** |
| 16 | Ş | DFS bütçe defteri | **Çöken tool AÇIK DFS rezervasyonu bırakıyor — ama bu KASITLI, ve ilk yazdığım şiddet YANLIŞTI.** Ölçülen olgu doğru: `analyze_backlinks` çökünce `dfs_spend`'de `backlinks/summary/live` satırı `status='open'` kaldı ve güne **tahmini $0.30** yazılmaya devam etti (bugün: kapının gördüğü $0.5956 / gerçek $0.2956). **DÜZELTME:** ilk yazımda "$0 gerçek harcamayla" dedim — bu YANLIŞ. Üç istek SIRAYLA koşuyor; çökme 3. istekte (anchors) olduğu için summary + referring_domains **gerçekten para harcadı** (~$0.08 kodun kendi belgelediği örnek maliyetlerle). Yani aşırı-sayım ~$0.22, hayalet değil. 10 çökme = $3.00 sayılır ama ~$0.80 gerçek harcanır → tavan %27 gerçek kullanımda triplenir. Hizmet-kesme riski DURUYOR, "bedava" değil. **Ayrıca: açık bırakma bilinçli bir karar.** `budget.ts:154-158` "an unsettled reservation keeps counting at its estimate, which is the conservative direction" diyor; `backlinks.test.ts`'teki test bunu AÇIKÇA pinliyor ve yorumunda benim uyguladığım düzeltmenin daha önce yazılıp **geri alındığını** anlatıyor: kısmi settle "under-counted a fleet that had already committed to the operation". Şef kısmi-settle'ı denedi, iki test kırmızıya döndü, **NEVER#8 gereği testleri değiştirmeyip değişikliği GERİ ALDI**. Gerçek kusur dar: açık rezervasyonun **üst sınırı yok** (reaper `dfs_spend`'e hiç bakmıyor — dosyada "dfs" 0 kez) ve harcanan gerçek para `tally` ile birlikte kayboluyor. Bu bir **tasarım kararı**, şefin tek başına çevirebileceği bir şey değil → insan + hakem. | 🟡 | **insan kararı bekliyor** |
| 17 | Ş | `compare_competitors` | **90 kredilik amiral gemisi, VARSAYILAN modda saçma sonuç veriyor.** `competitors` alanı boş bırakılınca (şemanın önerdiği yol: "Omit this to let DataForSEO pick") küçük bir Türk ajansı için bulduğu üç rakip: **youtube.com · wikipedia.org · linkedin.com**. Tablo "ETV 12, $5" ile "ETV 331.336.437, $94.699.777"yi yan yana koyuyor. Sebep: rakip seçimi "hedefle kaç organik SERP paylaşıyor" ölçütüne göre — 4 kesişen kelimede dev genel-amaçlı siteler her zaman kazanır. **AMA tool bozuk DEĞİL:** `competitors:["zeo.org"]` (gerçek Türk SEO ajansı) ile koştuğumda çıktı mükemmel oldu — adstark 4 SERP / ETV 12 / 0 top-20 vs zeo.org 313 SERP / ETV 24.694 / 11 adet #1. Yani **yetenek var, varsayılan yol bozuk.** Müşteri 90 kredi ödeyip çöp alıyor, doğru kullanımı keşfetmek için 90 kredi daha ödüyor. | 🔴 | **PR #43** |
| 18 | Ş | `ranked_keywords` · `compare_competitors` | **Varsayılan ülke/dil ABD-İngilizce; tool projenin ülkesini BİLMİYOR.** Üç premium tool `project_id` DEĞİL çıplak `target` alıyor → proje bağlamı sıfır. Varsayılanlar `language_code:"en"`, `location_code:2840` (ABD). `.com.tr` alan adı ülkeyi apaçık söylüyor ama hiçbir uyarı/öneri yok. Ölçtüm, aynı domain aynı 65 kredi: **varsayılan (en/2840)** → 3 kelime, hepsi volume 30, tek sayfa. **doğru (tr/2792)** → 4 kelime, volume 210/480/**3.600**/1.600, dört ayrı sayfa. Yani Türk kullanıcı 65 kredi ödeyip neredeyse boş sonuç alıyor, sonra doğrusunu bulmak için 65 kredi daha ödüyor. Başlıkta "(language en, location 2840)" yazması dürüst ama **`2840` ham vendor kodu** — kullanıcıya "United States" demiyor. | 🔴 | **PR #43** |
| 19 | Ş | DFS maliyet tahmini | **`estimated_usd` gerçeğin ~16 katı.** Ölçüm: `ranked_keywords` tahmin $0.20 → gerçek **$0.0124**; `domain_rank_overview` $0.35 → **$0.0665**. Kapı settle'dan sonra gerçek maliyetle sayıyor (`budget.ts:207`), settle ~1.5 sn sonra geldiği için **sıralı çağrılarda sorun yok** — hipotezimi kontrol ettim, "kapı 16x muhafazakâr" iddiası YANLIŞ. Kalan gerçek etki iki tane: (a) eşzamanlı uçuştaki çağrılar aşırı sayılır, (b) #16'daki hayalet rezervasyonlar 16x şişik değerle takılı kalır. Ayrıca operatör için bilgi: $3/gün tavanı gerçekte ~240 `ranked_keywords` çağrısına denk, 15'e değil. | 🟢 | açık |
| 20 | Ş | `connect_gsc` | **Bağlı projeye de "bağlan" linki veriyor.** adstark.com.tr 2026-07-28'den beri bağlı; `connect_gsc` yine kelimesi kelimesine aynı "open this link and approve access" metnini döndürdü — "zaten bağlısın, property `https://adstark.com.tr/`" demedi. #1 (`whats_next`) ve #8 (`generate_report`) ile **aynı kalıp**: bağlantı durumu `gsc_connections`'ta duruyor, üç ayrı tool ona bakmıyor. Ayrıca MCP yüzeyinde **koparma yolu yok** (web'de var). | 🟡 | **PR #42** |
| 22 | Ş | denetim ailesi (`audit_onpage` · `audit_tech` · `crawl_site`) | **Ürün ENJEKTE EDİLMİŞ sayfaları buldu ve kullanıcıya hiçbir şey söylemedi.** 2026-08-08 canlı taramasında (round-robin düzeltmesi sonrası) `adstark.com.tr`'de 84 keşfedilen URL'in **6'sı** bahis/yetişkin spam'i çıktı: `/1xbet-app-download-for-apple…`, `/grand-casino-admiral-zagreb…` (Hırvatça), `/juegos-de-casino-en-colombia…` (İspanyolca), `/installer-1xbet-pour-android…` (Fransızca), iki `onlyfans` sayfası. Birini elle doğruladım: **canlı, indekslenebilir, 543 kelime, kendine canonical**. Hacklenmiş WordPress klasiği ve ajans müşterilerinin en sık başına gelen şeylerden biri. Ürün bu sayfaları TARADI, `audit_onpage` onlara "multiple h1" dedi ve **hepsi bu**. Kullanıcı altı sayfada h1 uyarısı görüp h1'leri düzeltmeye çalışır; sitesinin ele geçirildiğini asla öğrenmez. | 🟡 | açık |
| 23 | Ş | **TEST SİTESİ — ürün bulgusu DEĞİL** | **`adstark.com.tr` büyük olasılıkla ele geçirilmiş.** #22'deki altı sayfa canlı ve `post-sitemap.xml`'de duruyor. Bu bir SeoGrep kusuru değil, operatörün kendi mülkü hakkında acil bir tespit: bu tür enjeksiyon Google gözünde alan adını yakar. Operatöre bildirildi. | 🔴 | **operatörde** |
| 21 | Ş | `research_keywords` | **Çalışıyor, doğru veri.** 4 kelime, gerçek hacim/CPC/rekabet; `n/a` dönen kelimeyi toplamdan doğru şekilde çıkarıyor (90+210+1900 = 2.200 ✓). İki gelişim alanı: (a) #18'in aynısı — ABD/İngilizce varsayılanı, proje bağlamı yok; (b) yalnız **verilen** listeyi ölçüyor, kelime **önerisi** üretmiyor — "araştırma" adını taşıyan tool'da ilgili-kelime keşfi yok, kullanıcı ne soracağını zaten bilmek zorunda. | 🟢 | açık |
| 11 | Ş | `audit_schema` | **Dürüst ama sığ.** Çıktı yalnız `@type` histogramı (BlogPosting 24, Organization 24…) ve açıkça "only @type names are analyzed, never the JSON-LD body" diyor — bu dürüstlük **iyi**. Ama Rich Results'ın umursadığı zorunlu alan doğrulaması (headline, datePublished, author) yok; "yapısal verim geçerli mi?" sorusuna cevap vermiyor. 5 kredi olduğu için fiyat/değer dengesi kabul edilebilir; beklenti yönetimi açıklamada zaten yapılmış. | 🟢 | açık |
| 4 | Ş | `crawl_site` | **"0 issue(s) found" yanıltıcı.** 43 sayfası düşmüş bir taramanın sonunda "0 sorun" cümlesi "siten temiz" diye okunuyor; aslında "getirebildiğimiz 24 sayfada fetch hatası yok" demek. T6'da kapatılan "No basic issues" yanılgısının crawl özetindeki eşdeğeri. | 🟡 | **PR #44 (kısmen)** |
| 5 | Ş | `crawl_site` | **`max_urls` reklamı tutmuyor — bağlayıcı sınır zaman, URL değil.** Şema "Maximum pages to crawl (1–100, default 100)"; satın alma öncesi mesaj "~34 pages discovered; this crawl covers up to 100 of them (20 credits)". Gerçekte ~3.7 sn/sayfa süren normal bir WordPress sitesinde tavan **24**. Kullanıcı 34'ün tamamını bekleyip 24 alıyor. Zaman bütçesi hiçbir yerde (şema, açıklama, docs) geçmiyor. | 🟡 | açık |
| 1 | Ş | `whats_next` | **GSC dalı denetim dalını yutuyor.** Aynı crawl durumunda tek fark GSC bağlantısı: seogrep.com (crawl ✅, GSC ❌) → `audit_onpage` + üç denetim tool'u listeleniyor; adstark.com.tr (crawl ✅, GSC ✅) → `pull_gsc_data` ve **`audit_onpage`/`audit_tech`/`audit_schema` hiç anılmıyor** — bu projede üçü de hiç koşmamış olmasına rağmen. GSC'yi erken bağlayan kullanıcı, 20 kredi ödediği crawl'ı analiz etmesi gerektiğini hiç öğrenmiyor. | 🟡 | **PR #42** |

---

## Operatör notları (serbest metin)

> Tablo formatına sığmayan her şey buraya — "şurada kafam karıştı", "bunun yerine şöyle olsa",
> "bu tool'u niye kullanayım ki". Yarım cümleler de değerli, sonra beraber ayıklarız.

---

## Şef notları (serbest metin)

> Ölçüm çıktıları, beklenmedik davranışlar, "bu test edilmemiş" tespitleri.

### Tur 1 — temel akış (2026-08-07 gece, adstark.com.tr, 85 kredi)

**Koşulan zincir:** `setup_project` → `crawl_site` → `audit_onpage` → `audit_tech` → `audit_schema`
→ `generate_report`. Hepsi ilk denemede çalıştı, hiçbiri hata vermedi, hiçbiri takılmadı.

**DEFTER KUSURSUZ.** Beş tool, on satır, her biri `spend_reserve` → `spend_commit` çifti;
`delta` toplamı tam **−85**; bakiye 1380 → **1295**; `SUM(credit_ledger)` = `get_credit_balance`
birebir. Gerçek maliyetler: crawl 20 · onpage 30 · tech 15 · schema 5 · report 15. NEVER#2
canlıda yine sağlam. Para tarafında **tek bir bulgu bile yok** — bu turun en net sonucu bu.

**Doğru çalışan diğer şeyler (bulgu değil, kayıt):**
- `setup_project` idempotent: var olan alan adına `created: false` + aynı `project_id`, yeni satır
  açmadı (0010 `unique(user_id,domain)` + ON CONFLICT canlıda çalışıyor).
- `crawl_site` ücretsiz ön-keşif yapıyor (34 sayfa) ve ücreti ONDAN SONRA rezerve ediyor — T8
  tasarımı canlıda doğru.
- `audit_onpage` DOĞRU. "Temiz" dediği üç sayfayı elle doğruladım (`curl` + parse): title var,
  meta description var, tek h1 var, canonical var, 1168-1832 kelime. Uydurmuyor.
- `audit_onpage` trailing-slash canonical'ı bilerek tolere ediyor (onpage.ts:41 `sameUrl`) —
  benim "canonical uyuşmazlığı kaçırıldı" hipotezim YANLIŞ çıktı, tool haklı.
- `/r/XubxZtU6TfE` raporu 200 dönüyor, düzgün render ediyor, `noindex` yerinde (D29 canlı).

**Turun ana dersi:** para yolu ve tool'ların *doğruluğu* sağlam; sorunların tamamı **kapsama ve
anlatım** tarafında. Ürün yanlış bir şey söylemiyor — eksik söylüyor. En pahalı örnek: müşteri
85 kredi harcadı ve elindeki rapor sitesinin **ana sayfası hakkında tek kelime içermiyor**,
üstelik bunu raporda göremiyor.

**Ölçülmedi / bu turda test edilmedi:** `include_paths` ile ikinci bir tarama (bulgu #2'nin
bilinen bir geçici çözümü var mı sorusu) — 20 kredi daha ister, triyaja bırakıldı.

### Tur 2 — GSC ailesi (35 kredi, DÖRT TOOL İLK KEZ CANLI)

**Dördü de ilk denemede çalıştı.** Defter yine kusursuz: 8 satır, reserve→commit, toplam −35,
bakiye 1295 → **1260**.

**OAuth doğrulaması canlıda mühürlendi (beklenmedik ikinci kazanç).** `pull_gsc_data` 2026-07-28'de
alınmış refresh token'la **10 gün sonra** sorunsuz çalıştı. Doğrulama öncesi rejimde o token 7 günde
ölürdü. Yani "OAuth verification bitti" iddiası artık sınanmış bir gerçek, kayıt değil.
Veri gerçek: mevcut pencere 2026-05-07..2026-08-04 **241 satır**, önceki 2026-02-06..2026-05-06
**256 satır**. (Pencerenin bugünden 3 gün geride bitmesi GSC'nin normal veri gecikmesi.)

**`find_quick_wins` turun en iyi çıktısı.** 6 gerçek sorgu, gerçek pozisyon/gösterim, doğru URL —
bir SEO danışmanının o gün üzerinde çalışacağı türden bir liste. 10 krediye değer. **Ama** listenin
1 numarası `/sosyal-medya-reklam-yonetimi/`, yani **crawl'ın atladığı** bir sayfa: ürün "şu sayfayı
iyileştir" diyor, aynı ürünün denetimi o sayfa hakkında hiçbir şey bilmiyor. Bulgu #2'nin iş sonucu.

**`analyze_content_decay` "bulgu yok" dedi ve DOĞRU söyledi.** İddiayı kabul etmeyip ham GSC
pull'unu SQL'le kendim topladım: iki pencere arasında tıklama kaybeden **tek** sayfa var — ana
sayfa, 13 → 9 (−4). Bu hiçbir makul eşiği geçmez. Negatif sonuç gerçek negatif, eşik artefaktı
değil. *(Not: bu site 90 günde ana sayfada ~9-13 tıklama alıyor; düşük trafikli sitelerde bu tool
neredeyse her zaman "bulgu yok" diyecek — kusur değil, doğal sınır.)*

**Turun ana dersi:** GSC ailesi teknik olarak sağlam ve veriyi gerçekten Search Console'dan
getiriyor. Tek gerçek kalite sorunu `detect_cannibalization`'ın marka sorgusunu yamyamlaşma
sanması (#12) — ve bu, tool'un gerçek bir sitede ürettiği **tek** sonuç olduğu için turun en
görünür kusuru.

### Tur 3 — premium / DataForSEO (ÜÇÜ DE İLK KEZ CANLI) — **turun sonucu: 3/3 sorunlu**

Bu turun tek cümlelik özeti: **ürünün en pahalı üç vaadi, canlıda ilk kez koşturulduğunda
üçü de kullanıcıya kötü bir deneyim veriyor** — biri hiç çalışmıyor, ikisi varsayılan
ayarlarıyla çöp üretiyor. Para tarafı ise üç durumda da kusursuz davrandı.

| tool | kredi | ilk canlı sonuç |
|---|---|---|
| `ranked_keywords` | 65 | çalıştı, ama varsayılan ABD/İngilizce → Türk sitesi için ~boş (#18) |
| `analyze_backlinks` | 70 | **ÇÖKTÜ** — `null` anchor (#15). Ücret alınmadı ✅ |
| `compare_competitors` | 90 | çalıştı, ama otomatik rakipler youtube/wikipedia/linkedin (#17) |

**PARA YOLU ÜÇ KEZ SINANDI, ÜÇÜNDE DE DOĞRU.** Özellikle başarısızlık yolu ilk kez canlıda
kanıtlandı: `analyze_backlinks` çöktüğünde defter `spend_reserve −70` → **`spend_release +70`**
yazdı, kullanıcıdan tek kredi alınmadı. Bakiye zinciri baştan sona tuttu:
1380 → 1295 (Tur 1) → 1260 (Tur 2) → 1130 (2× ranked_keywords, backlinks iade) → **950**.
Toplam harcanan **430 kredi**, planlanan ~345'in üstünde çünkü iki tanı koşusu ekledim
(varsayılan-vs-doğru locale, otomatik-vs-açık rakip) — ikisi de bulguyu 🔴'dan "şu satır
yanlış"a indirdiği için değdi.

**VENDOR MALİYETİ TAHMİNİN ÇOK ALTINDA.** Plan ~$0.85 diyordu; gerçek **$0.2056**. Tavan
$3.00, sorun yok. Ama ayrı bir problem çıktı: bugünkü bütçenin **%59'u hayalet** (#16).

**Bu turda ölçülmedi:** `analyze_backlinks`'in mutlu yolu (null anchor'ı olmayan bir domain'de
çalışır mı) — mekanizma zaten zod hatasından kesin, ikinci bir 70 kredi bilgi katmayacaktı.
`ranked_keywords`/`compare_competitors` başka ülkelerde denenmedi.

### Tur 4 — yardımcılar + güvenlik/dürüstlük kontrolleri (0 kredi)

`whats_next` üç farklı bağlamda, `list_projects` · `get_credit_balance` (5×) · `get_job_status`
(çok kez) tur boyunca zaten çalıştırıldı; hepsi doğru çalıştı.

**Kiracı izolasyonu SAĞLAM (ücretsiz ama en değerli kontrol).** Ödeyen hesabın anahtarıyla
trial hesabının (`1bfe47da`) işine eriştim: `fccfb6db…` → *"No job found with id …"* —
**var olmayan bir id ile BİREBİR aynı mesaj**. Aynısı proje için de geçerli: başkasının
projesi *"No project found with id …"* diyor. Yani varlık sızıntısı yok, mesajdan
"bu id var ama senin değil" çıkarılamıyor. Hata mesajları iç detay (stack, SQL, tablo adı)
sızdırmıyor; çöken tool bile yalnızca `ref 5ded2b4e` veriyor ve ayrıntı sunucu log'unda kalıyor.

> **Kendi hatam, kayda geçsin:** ilk izolasyon denemem GEÇERSİZDİ — seçtiğim `9bc30d40` işi
> aslında ödeyen hesabın kendi işiydi, dönen veri "sızıntı" değil normal erişimdi. Sahibi
> DB'den doğrulayıp testi doğru id ile tekrarladım. Ders 7'nin aynısı: neyi ölçtüğünü
> söylemeden "ölçtüm" demek yanıltıcı.

`get_job_status` var olmayan id'de `isError=true` + tek cümle; `whats_next` bağlama göre
gerçekten değişiyor (Tur 1 öncesi "pull_gsc_data", Tur 2 sonrası "you're all set") — statik
değil. Tek kusuru #14.

---

## Oturum kapanış tablosu (2026-08-07 gece, şef yarısı)

**19 tool'un 19'u canlıda çalıştırıldı.** Daha önce hiç çıktı üretmemiş 7 ücretli tool'un
7'si de ilk kez koşturuldu.

> **ŞEF DÜZELTMESİ (aynı oturum, insan sorusu üzerine).** Bu satırı ilk yazdığımda **19/19
> YANLIŞTI** — gerçek sayı 17/19'du. `connect_gsc` hiç çağrılmamıştı (bağlantı zaten vardı,
> ihtiyaç duymadım) ve `research_keywords` bu oturumda hiç koşmamıştı; defterdeki 3 koşusu
> 2026-08-07 **09:14**'e ait, benim oturumum **20:58**'de başladı. İkisini sonradan koşturup
> sayıyı gerçekten 19/19 yaptım. Ders 7'nin bire bir tekrarı: "hepsini ölçtüm" demeden önce
> **hangisini** ölçtüğünü say.

| | |
|---|---|
| Harcanan kredi | **455** (1380 → 925) · planlanan ~345, fark üç tanı koşusu |
| Gerçek vendor maliyeti | **$0.2956** (tahmin $0.85 idi) · tavan $3.00 |
| Bulgu | **21** — 🔴 5 · 🟡 11 · 🟢 5 |
| Defter ihlali | **0** — her tool `reserve`→`commit`/`release`, `SUM(ledger)` = bakiye, her adımda |
| Kiracı izolasyonu ihlali | **0** |
| Kod değişikliği | **0** — bu bir ürün kullanma oturumuydu |

**Oturumun tek cümlelik sonucu:** *para yolu ve altyapı sağlam; ürünün kendisi eksik.*
Beş 🔴'nin **hiçbiri** para, güvenlik veya veri bütünlüğü değil — hepsi "müşteri parasını
verdi, karşılığında beklediği şeyi alamadı" sınıfında. Faz 4'ün "sağlam mı?" sorusu **evet**
diye kapandı; bu oturumun sorduğu "iyi mi?" sorusunun cevabı **henüz değil**.

---

# TRİYAJ (2026-08-07 gece · insan yetkiyi şefe delege etti: "senin önerilerine göre gidelim, bütün onayları veriyorum")

> Kural 3 gereği triyaj testten SONRA yapıldı. Aşağıdaki dilimleme şefin önerisidir; **NEVER#6'ya
> değen hiçbir kalem burada karara bağlanmadı** — fiyat/kredi kalemleri "insan imzası" olarak
> işaretlendi ve dokunulmadı.

## Dilimleme ilkesi

21 bulguyu tek tek değil **kök tema**ya göre grupladım (bkz. `2026-08-07-tool-tool-analiz.md`
altı çapraz tema). Sebep: aynı kökten gelen 4-6 bulgu tek düzeltmeyle kapanıyor, ayrı ayrı
yamalanırsa hem iş üçe katlanıyor hem de gelecekte eklenecek tool aynı tuzağa düşüyor.
Ayrıca her dilim NEVER#10'un 200 satır sınırına sığacak şekilde bölündü.

| Dilim | İçerik | Durum | Neden bu sırada |
|---|---|---|---|
| **1** | #15 — DFS `null` metin alanları (5 nokta) | ✅ **KOD TAMAM**, hakemde | 70 kredilik tool **hiç çalışmıyordu**; en acil ve en ucuz |
| **2** | #16 — `dfs_spend` mutabakatı (reaper üst sınırı) | sırada | Ödeyen müşteriye hizmet kesintisi riski; #15 çökmelerini kalıcı bütçe tüketimine çeviriyordu |
| **3** | **Ucuz dürüstlük**: #1 · #4 · #8 · #14 · #17(açıklama) · #18(uyarı) · #20 | sırada | Yeni yetenek yok, kod riski düşük, algılanan kalite sıçraması en büyük burada |
| **4** | **Crawl ailesi**: #2 · #3 · #5 · #7 · #10 · (#13 aynı kök) | sırada | En büyük ürün kazancı ama en çok iş; operatör turundan SONRA yapılmalı |
| **5** | **Kalite/ayar**: #12 marka filtresi · #6 yönlendirme zinciri | sırada | Doğruluk/güven işi; #6 `PageRecord` şeması değişikliği istiyor |
| **6** | **Ticari/ürün kararı**: #9 · #11 · #21 · beyaz etiket · fiyat kalemleri | **insan** | Ürün kapsamı ve fiyat — şefin kararı değil |

## Bulgu bazında karar

| # | Karar | Gerekçe |
|---|---|---|
| 15 | **iş emri yazıldı → düzeltildi** | Tool tamamen kırıktı; tek satırlık sınıf hatası, 5 noktada kapatıldı |
| 16 | **dilim 2** (öneri (b): reaper'a mutabakat) | Mevcut "açık bırak" kararını BOZMADAN üst sınır koyar; kısmi-settle tartışması açılmaz |
| 2 | **dilim 4** | 🔴 ama düzeltmesi crawl sıralaması + eşzamanlılık = büyük iş; operatör turu tasarımı değiştirebilir |
| 12 | **dilim 5** | 🔴 ama ayar işi; marka/sitelink filtresi tasarım gerektiriyor, acele edilirse yeni yanlış pozitif üretir |
| 17 | **BÖLÜNDÜ**: açıklama → dilim 3, otomatik seçim → dilim 5 | Açıklamayı açık moda çevirmek **kod değişikliği bile değil** ve 🔴'nin yarısını bugün söndürür |
| 18 | **BÖLÜNDÜ**: boş-sonuç uyarısı → dilim 3, ülke alanı → dilim 4 | Uyarı tek cümle; kalıcı çözüm `setup_project`'e ülke alanı ister (şema + migration) |
| 1, 8, 14, 20 | **dilim 3** | Dördü de tek kök (`[A]` bağlam körlüğü) — birlikte kapanır |
| 4, 10 | **dilim 3** | Metin dürüstlüğü; kod riski ~0 |
| 3, 5, 7 | **dilim 4** | Crawl davranışıyla birlikte anlamlı |
| 6 | **dilim 5** | `PageRecord`'a yönlendirme zinciri alanı = Faz 3'ten kalan borç, tek başına bir iş |
| 13 | **dilim 4'e bağlandı** | #7 ile aynı kök (`normalizeUrl`); ayrı düzeltilirse iki kez dokunulur |
| 9 | **insan** | "Rapor kimin belgesi" sorusu ürün kararı; beyaz etiket/PDF ticari kapsam |
| 11, 21 | **kabul edildi (şimdilik yapılmayacak)** | İkisi de 🟢 ve **fiyatı dürüst**; `audit_schema` 5 kredi karşılığında ne verdiğini açıkça söylüyor. Kapsam genişletmek fiyat kararı = NEVER#6 |
| 19 | **kabul edildi (bilgi olarak kayıtlı)** | Kapı settle sonrası gerçek maliyetle sayıyor; sıralı çağrılarda sorun yok. Operatör için not: $3 tavanı ~240 `ranked_keywords` çağrısına denk |

## Bu triyajda BİLEREK yapılmayanlar

- **Fiyat/kredi hiçbir kalemde değişmedi** (NEVER#6). #2'deki "kısmi kapsamada orantılı iade",
  #8'deki "30 kredi / 5 kural", #17'deki "90 kredi / çöp sonuç" — üçü de fiyat sorusu doğuruyor,
  üçü de **insan imzası** olarak bırakıldı.
- **Launch yayınları** hâlâ kapalı (contract.md insan kapısı) ve test bitmeden açılmamalı —
  özellikle 🔴 #2, #12, #17, #18 açıkken.
- **Operatör turu** yapılmadı; dilim 4 ondan SONRA yapılmalı.

**Tool bazında detaylı analiz:** [`2026-08-07-tool-tool-analiz.md`](2026-08-07-tool-tool-analiz.md)
— 19 tool'un her biri için gözlem + geliştirme alanları + öncelik, ve hepsini kesen **altı
çapraz tema** (bağlam körlüğü · ülke körlüğü · URL çatallanması · sessiz kısıtlar ·
fixture↔gerçek boşluğu · "peki ne yapayım?" eksiği).

---

# OTURUM KAPANIŞI — kod tarafı (2026-08-08)

Test bittikten sonra triyajdaki ilk beş dilim yazıldı. **Altı PR, hepsi hakem-onaylı, hepsi CI yeşil.**

| PR | bulgu | hakem |
|---|---|---|
| #41 | **#15** `analyze_backlinks` `null` anchor (5 nokta) + bu defter + tool-tool analiz | Fable PASS |
| #42 | **#1 · #8 · #20** bağlam körlüğü (tema A) | Fable PASS |
| #43 | **#17 · #18** premium varsayılanlar | Opus FAIL → PASS |
| #44 | **#2 · #3 · #4** crawl ana sayfa + atlama dürüstlüğü | Fable PASS |
| #45 | **#12** marka yanlış pozitifi | Opus ×3 FAIL → **Fable** PASS |
| #46 | **#16** `dfs_spend` gözlenebilirliği | Fable PASS |

🔴 5/5 kapandı · 🟡 6 kapandı · on hakem turu, **dördü FAIL**.

## Hakemlerin yakaladığı şeylerin hepsi TEK bir sınıftandı

Kapılar (1568+ test, üç yeşil kapı, `--force` ile cache'siz koşular) bunların **hiçbirini**
yakalayamazdı, çünkü hiçbiri kodun kendi ölçütlerine göre bozuk değildi:

1. **Fixture katılıyordu.** `analyze_backlinks`'in şeması `null` anchor'ı yorumda öngörmüş ama
   `""` diye kodlamıştı; 7 fixture'ın hiçbirinde `null` yoktu. Crawl fixture'ı `/`'ı ilk sıraya
   koyuyordu, o yüzden ana sayfa hatası fixture'da görünmüyordu. **Aynı ders, iki kez.**
2. **Tek örnekten genelleme.** Marka kuralı, canlı vakadaki ana sayfanın 3.9'da olmasına
   uyarlandı — oysa o örneğin TUHAF yanı buydu. En yaygın şekil (`[1.0, 1.0]`) kuralın dışında
   kaldı ve iki sayfalı grupta bastırma aritmetik olarak imkânsız hale geldi.
3. **Hiçbir şey ölçmeyen testler — dört tane.** `maxUrls` tohumları da kırptığı için kopya hiç
   oluşmayan test · `"shop"` `"trail shoes"` içinde alt-dize bile değilken yazılmış alt-dize
   testi · `tsconfig` test dosyalarını `exclude` ederken yazılmış `@ts-expect-error` ·
   paylaşılan tabloda kalıntı sayesinde yeşil kalan `>=` iddiası.
4. **Ölçülmemiş mutlak iddialar (imzalı ders 9, ÜÇ kez).** Yorumda "never a wrong one" yazıp
   `wordpress.com → "wordpress"` ile çürütülmek · "read across the WHOLE window" derken ilk
   host'ta durmak · "apple pie recipe listede kalır" derken `[1.0,1.2]`'de kalmamak.
5. **Ve en kötüsü: yapmadığım bir düzeltmeyi yaptım diye bildirmek.** `assert`'siz bir
   `replace` sessizce eşleşmemiş, ben sonucu doğrulamadan hakeme rapor etmiştim. Kod, sahip
   olmadığı bir güvenlik özelliğini beyan eden bir cümleyle sevk edilecekti.

**Ders adayı (insan imzası bekler):** *Bir dosyayı program yazarak değiştiren her adım
`assert`'le bağlanır ve sonuç `grep` ile teyit edilir. Eşleşmeyen bir `replace` sessizdir;
sessiz bir düzeltme, yapılmamış bir düzeltmedir — ve rapor edilirse yalan olur.*

## Hacklenmiş-sayfa tespiti — ÖLÇÜLEN ve ÇÜRÜTÜLEN sinyaller (bulgu #22 eki)

Bir tespit kuralı önermeden önce dört sinyali gerçek veriye karşı ölçtüm (n=24 taranan sayfa,
6 spam / 18 meşru, **tek site**). Üçü çürüdü:

| sinyal | ölçüm | sonuç |
|---|---|---|
| Başlıkta farklı marka adı ("- Artistics") | spam 6/6 · **meşru 13/18** | ❌ sitenin KENDİ başlık şablonu |
| Yetim sayfa (iç link almıyor) | spam 0 yetim · meşru 0 yetim | ❌ spam sayfalar siteden link ALIYOR |
| `<html lang>` farkı | **hepsi `lang="tr"`** — Hırvatça/İngilizce spam dahil | ❌ WordPress site geneli ayarlıyor |
| **Çoklu h1** | **spam 6/6 · meşru 0/18** | ✅ tek temiz ayraç |

**En önemli sonuç:** çoklu h1 sinyali ürünün elinde ZATEN var (`PageRecord.h1s`) ve `audit_onpage`
onu ZATEN raporluyor (`onpage.ts:93` → `multiple_h1`). Yani eksik olan veri değil, **yorum**:
altı sayfanın aynı kusuru paylaşması "h1'lerini düzelt" değil "bu sayfalar siteye ait olmayabilir"
demek.

**Bu bulgunun sınırları — abartmamak için açıkça yazıyorum:**
- **n = 1 site, 24 sayfa.** Çoklu h1'in genel bir hack göstergesi olduğu KANITLANMADI; bu örnekte
  mükemmel ayrıştırdı, o kadar. Bu oturumda "tek örnekten kural üretmek" üç kez geri teptiği için
  bunu kural olarak önermiyorum.
- Çoklu h1 zaten sıradan bir on-page kusuru; tek başına ele geçirilme kanıtı DEĞİL.
- Gerçek bir tespit için ölçülmemiş fikirler (hiçbiri denenmedi, hepsi yeni veri ister):
  içerik dilinin sayfa-bazlı tespiti (site diliyle çelişen sayfa), önceki tarama ile karşılaştırıp
  sitemap'in ani büyümesi, konu-aykırılığı. **Bunları öneri olarak yazıyorum, ölçüm olarak değil.**

## AÇIK KALANLAR

1. **Merge + deploy.** Altı PR merge'e hazır; merge şef oturumunda araç izniyle bloklandı.
   Merge sonrası prod deploy tetiklenir.
2. **Canlı doğrulama YAPILMADI.** Düzeltmelerin hiçbiri prod'da sınanmadı. Merge+deploy sonrası
   `adstark.com.tr`'ye karşı tekrar koşulmalı: ana sayfa gerçekten taranıyor mu,
   `analyze_backlinks` gerçekten veri döndürüyor mu, marka sorgusu gerçekten dışlanıyor mu.
3. **TESTİN OPERATÖR YARISI HÂLÂ HİÇ YAPILMADI.** Şef bunu yapamaz. 19 tool `curl` ile
   ölçüldü ama "LLM açıklamadan doğru tool'u seçiyor mu", "çıktı sohbette işe yarıyor mu",
   "90 krediye değdi mi" sorularının cevabı yok. **Ürünün SAĞLAM olduğunu artık daha iyi
   biliyoruz; İYİ olup olmadığını hâlâ bilmiyoruz.**
4. Triyajın 5. ve 6. dilimleri (denetim kural setleri · rapor beyaz-etiket/PDF · `audit_tech`
   yönlendirme zinciri #6) yazılmadı — ertelendi, kaybolmadı.
5. #46'da bir `verify-db` koşusu alakasız bir spec'te düştü, üç koşuda ve main'de tekrarlamadı.
   Açıklanamadı; "flaky" DENMEDİ, kayda geçirildi.
