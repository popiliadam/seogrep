# Çok-site × çok-senaryo ölçüm kampanyası — 1. oturum

> Açılış 2026-08-09 · Kapsam: PLAN.md 🧪 bloğu · Ham JSONL **repo DIŞINDA** (müşteri URL'leri +
> GSC sorguları taşır; harness repo içi bir `--out` yolunu reddeder).
> Harness: `scripts/testing/` · İşçi Opus, hakem taze Fable (PASS), kapı `guardrails/verify.sh`.

## Neden bu kampanya vardı

Defterdeki 34 bulgunun neredeyse tamamı **tek siteye** (adstark.com.tr) dayanıyordu. İmzalı
ders 13: bir örnek kuralı ÇÜRÜTMEYE yeter, DOĞRULAMAYA yetmez. Bu yüzden #22'de kural
yazılamamış, #27 genellenememiş, #12'nin sezgiseli dört hakem turu sürmüştü.

## Ölçülen para — 209 hücre, tek satır sapma yok

| katman | hücre | ölçülen delta | uyuşmazlık |
|---|---|---|---|
| K0 (ücretsiz yüzey + tüm S3/S4) | 90 | **0** | 0 |
| K1 (on-page çekirdeği) | 62 | −660 | 0 |
| K2 (GSC ailesi) | 44 | −180 | **12** |
| K3 (premium/DataForSEO) | 11 | −700 | 0 |
| K4 (rapor) | 2 | −30 | 0 |
| **TOPLAM** | **209** | **−1570** | **12** |

Bakiye 10375 → **8805**, canlı `get_credit_balance` ile birebir. Tavan 3000, kullanılan %52.

**12 uyuşmazlığın tamamı iyi yönde:** beklenen ücret, ölçülen **0**. Yani tool hata verdi ve
ücret almadı. Kampanyanın "bitti" tanımındaki madde — *hiçbir tool hata mesajı için ücret
almadı* — **78 `tool_error` hücresinde ölçümle karşılandı.**

`outcome` dağılımı: `ok` 117 · `tool_error` 78 · `skipped_no_foreign_id` 14.

---

## Hipotez kararları — hiçbir eşik veriyi gördükten sonra oynatılmadı

| | hipotez | karar | dayanak |
|---|---|---|---|
| **H1** | #22 çoklu-h1 hack sinyali | ✅ **ADAY KURAL → HAKEME** | 7 temiz sitede 250 meşru sayfada **1** yanlış-pozitif = **%0,40** (eşik <%2). adstark'ta 6/6 spam sayfa ayrıştı, 34/34 meşru sayfa temiz |
| **H2** | #27 ortak-sonek yanlış marka | ❌ **KURAL YAZILMAYACAK** | markayla uyuşmayan sonek **1 sitede** (eşik ≥2) → adstark'ın tema kazası |
| **H3** | #12 / PR #45 marka filtresi | ❌ **YETERSİZ → YENİ TUR** | **iki** yanlış-pozitif, kökleri farklı (aşağıda #38) |
| **H4** | #5 #7 crawl zaman bütçesi | ❌ **TAHMİN ÇÜRÜDÜ (3/8)** | aşağıda |
| **H5** | #6 audit_tech yönlendirme körlüğü | ✅ **#6 BULGUYA YÜKSELTİLDİ** | 8/8 sitede `3xx = 0`, oysa 6/8 sitede her sayfa 301 |
| **H6** | [E] vendor şekil varyansı | ⚠️ **ÖLÇÜLEMEDİ — yapısal** | aşağıda |
| **H7** | [A] bağlam körlüğü | ✅ **#1 KAPANDI, n=8** | GSC bağlı adstark artık denetim üçlüsünü de listeliyor |
| **H8** | PR #56 canlı sınavı | ⚠️ **(a)(b)(d) ✅ · (c) ölçülemedi** | aşağıda |
| **H9** | migration 0021 gerekli mi | ✅ **ZORUNLU** | aynı sitede **11 vs 482** ranked keyword |

### H4 — tahmin çürüdü, ama çürümesi bir şey kazandırdı

Tahmin K1'den **önce** mühürlenmişti (21–29 sayfa/site, boyuttan bağımsız). Gerçek:

| site | tahmin | gerçek | süre | sn/sayfa | kapsama |
|---|---|---|---|---|---|
| adstark.com.tr | 24 | **37** ✗ | 90,6 s | 2,45 | 51% |
| bayder.com.tr | 29 | **66** ✗ | 91,2 s | 1,38 | 103% |
| rkturizm.com | 27 | **56** ✗ | 91,6 s | 1,64 | 62% |
| www.bigcattr.com | 25 | **1** ✗ | 2,5 s | — | 1% |
| www.noraninsaat.com | 22 | 24 ✓ | 90,8 s | 3,78 | 109% |
| katrenur.com | 26 | 28 ✓ | 30,9 s | 1,10 | 100% |
| dentnotion.com | 21 | 28 ✓ | 91,7 s | 3,27 | 16% |
| seogrep.com | 27 | **52** ✗ | 32,5 s | 0,62 | 106% |

**Ölen iddialar:** "21–29 sayfa, boyuttan bağımsız" · "gerçek tavan ~25, `max_urls` sözü 6/8
sitede tutulmuyor" — **dört site tam kapsama aldı**. Modelin hatası tek sayıda: 2,90 sn/sayfa
ayrıştırma yükünü sabit varsaydım; gerçek **0,62–3,78 sn**, altı kat değişiyor.

**Yaşayan iddia:** kapsama boyutla ters orantılı — dentnotion %16, adstark %51.

**Tahminin kazandırdığı:** kalibrasyon noktası 2026-08-07'de adstark'ta 24 sayfa/90 sn idi.
Bugün aynı site, aynı bütçe, **37 sayfa** → **PR #44 + #48 verimi %54 artırmış.** Bu rakam
tahmin önceden mühürlenmeseydi elde olmazdı.

### H6 — neden ölçülemedi

H6 "her DFS çağrısının HAM yanıtını sakla, fixture'larla diff'le" istiyordu. **MCP yüzeyi
vendor JSON'ını değil render edilmiş metni döndürür**; ham payload sunucuda kalır. Harness bunu
mimari olarak yapamaz.

Elde edilen daha zayıf ama gerçek sinyal: **11 canlı DFS çağrısının 11'i de zod şemalarından
geçti** — bugünün vendor payload'ları mevcut şemalara uyuyor (canlı sözleşme testi). **Yeni
fixture varyantı üretilmedi**, yani kampanyanın "en az bir yeni fixture" çıkış kriteri
KARŞILANMADI. Karşılamak için sunucu tarafında ham yakalama gerekir — tool-analizi (5)'teki
"elle tetiklenen aylık vendor-şeması koşusu" ile aynı iş, ve bir kod değişikliği.

### H9 — tek ölçüm, bir migration kararı

`rkturizm.com` (Türk işletmesi, `.com`), aynı 65 kredi, iki locale:

| | varsayılan en/2840 | doğru tr/2792 |
|---|---|---|
| ranked keyword | **11** | **482** |
| pozisyonlar | #6…#17 | **#1, #1, #2, #2, #2…** |
| en yüksek hacim | 210 | **2.400** |

**44 kat.** Varsayılan locale, ticari umre-fiyat sorgularında 1.-2. sırada olan bir işletmeyi
başarısız gösteriyor.

**Ve ccTLD hafifletmesi KUSURSUZ çalışıyor — sorun tam da bu.** Uyarı `rkturizm.com`'da haklı
olarak çıkmadı. Ama portföydeki **yedi Türk işletmesinin beşi `.com`**; sezgisel yaklaşım
ihtiyacı olan vakaların %71'inde tanım gereği tetiklenemiyor. → **0021 zorunlu.**

---

## Yeni bulgular

| # | Kaynak | Tool / alan | Bulgu | Önem | Durum |
|---|---|---|---|---|---|
| 35 | Ş | registry + denetim/GSC aileleri | **Tasarlanmış ret, çökme gibi gösteriliyor — 26 hücre.** "Henüz crawl yok" ve "GSC bağlı değil" gibi tamamen normal durumlar kullanıcıya *"Tool `audit_onpage` failed unexpectedly … quote reference 0edff0bd"* olarak dönüyor. Mimari kilit: ücret almamak için tool THROW etmek zorunda (`withCredits` yalnız throw'da release eder), anlamlı mesaj için `errorResult` RETURN etmek zorunda — **ikisi birden mümkün değil**. `registry.ts:289-320`'de tek tipli kaçış `isPaidBalanceRequired` ve yorumu bu tuzağı aynen tarif ediyor: *"would … turn a working gate into a support ticket."* Aynı cümle bu 26 hücre için de geçerli. Ayrıca `audit-shared.ts:46-48`'in *"The registry turns this into an actionable isError result"* iddiası **ölçülmemiş ve yanlış** (para yarısı doğru, "actionable" yarısı değil). **İkinci zarar birincisinden ağır:** bayder ve rkturizm GSC'de GERÇEKTEN çöktü (12 çağrı) ve mesajları tasarlanmış retlerle **birebir aynı** — generic mesaj, bu kampanyada 12 gerçek arızanın teşhisini imkânsız kıldı. | 🔴 | açık |
| 36 | Ş | `connect_gsc` / OAuth callback | **`www.` ile kaydedilmiş proje, `sc-domain:` property'sine hiç eşleşemez.** `www.noraninsaat.com` → *"already connected … **property null**"*, ham `null` kullanıcıya metin olarak gidiyor. Kök: `apps/web/lib/gsc/oauth.ts:53-59` adayları kurarken baştaki `www.`'yi **soymuyor** ve üstelik `https://www.**www.**noraninsaat.com/` gibi üç anlamsız aday üretiyor. `sc-domain:` property'leri tanım gereği apex kapsamlıdır. Portföyde `www.` ile kayıtlı iki site var; bigcattr yalnızca kullanıcının ayrıca URL-prefix property'si olduğu için kurtuldu. Hangisinin düşeceğini bizim kodumuz değil, kullanıcının SC'de hangi property tipini oluşturduğu belirliyor. **n=8'in sekizi de modeli doğruluyor.** | 🟡 | açık |
| 37 | Ş | `crawl_site` + denetim üçlüsü | **`www.bigcattr.com` crawler'ı reddediyor; 70 kredi karşılığı hiçbir şey.** Crawl **1 sayfa** aldı, o da **4xx**. Ardından üç denetim o tek 4xx sayfa üzerinde koşup **50 kredi daha** aldı. Hiçbir çıktıda "site bizi reddetti" yazmıyor. **UA hipotezi ÇÜRÜTÜLDÜ:** crawler'ın kendi UA'sı dahil beş UA da ev IP'sinden **200** alıyor; fark çıkış IP'si (Fly.io veri merkezi). Bu, PLAN.md'nin Scrapling için sorduğu **(b) şıkkı** — ve kampanya notunun yazdığı gibi doğru çözüm yeni runtime değil, **SeoGrep IP'sinin müşteri WAF'ında izinli listeye alınması**. *Sınır: n=1/8; tam HTTP kodu ölçülmedi (audit yalnız "4xx" kovasını yazıyor).* | 🔴 | açık |
| 38 | Ş | `detect_cannibalization` | **PR #45 filtresi iki farklı yoldan deliniyor — #12 KAPANMADI.** (a) **İki kelimeli marka:** dentnotion'da 107 sonucun **birincisi** `"dent notion"` — ana sayfa 2.0 + beş iç sayfa, yani #12'nin tarif ettiği sitelink deseninin ta kendisi. Kök: `cannibalization.ts:189-200` sorguyu boşluktan bölüp **kelime kelime** karşılaştırıyor; `["dent","notion"]`'ın hiçbiri `dentnotion` token'ına eşit değil. Yorum, ayırıcının kelime İÇİNDE ve marka ile başka şey ARASINDA olmasını düşünmüş, **markanın iki kelimeye bölünmesini** hiç düşünmemiş. (b) **URL fragment'leri ayrı sayfa sayılıyor:** bigcattr'de "british kedi cinsleri" için 8 "rakip sayfa"nın üçü aynı URL'in `#nasil-bir-kedi` / `#renkler` varyantları. Bu yamyamlaşma değil, Google'ın atlama-linki. **PR #45 bozuk değil, eksik** — adstark'ta kusursuz çalıştı ve dışladığı sorguyu açıkça söyledi. | 🔴 | açık |
| 39 | Ş | `compare_competitors` | **ccTLD uyarısı bu tool'da yok.** PR #43'ün uyarısı yalnız `ranked_keywords`'te. `compare_competitors` da en/2840 varsayılanıyla koşuyor, `.com.tr` bir projeyi aldı ve **90 kredi** karşılığında hiçbir uyarı vermedi. Ölçüm: adstark `ranked_keywords` S1+S6a → uyarı VAR; adstark `compare_competitors` → **YOK**; rkturizm (`.com`) hepsinde yok (doğru). | 🟡 | açık |
| 40 | Ş | `ranked_keywords` · `analyze_backlinks` | **`limit` yalnız sunum kısıtı, fiyat tam.** `limit:1` ile `ranked_keywords` "1 ranked keyword **of 3**", `analyze_backlinks` "Top referring domains (**1 of 67**)" döndü — yani veri tamamı çekilip gösterimde kırpılıyor. Kullanıcı tek satır için **65 / 70 kredi** ödüyor. Vendor maliyeti de düşmüyor. Kusur değil ama şemada bu beklenti yönetilmiyor. | 🟢 | açık |
| 41 | Ş | `crawl_site` | **Crawl deterministik değil.** adstark aynı gün, aynı parametre, 12 dakika arayla iki koşuda **37** ve **47** sayfa taradı — **%27 fark**. "Kaç sayfa aldık" koşudan koşuya değişiyor; kapsama tabanlı hiçbir kıyas tekrarlanabilir değil. | 🟢 | açık |
| 42 | Ş | `whats_next` | **Var olmayan projede `isError` kurmuyor.** `outcome: ok` + metin *"No project found with id …"*. Aynı girdide `ranked_keywords`/`analyze_backlinks` `tool_error` dönüyor. İstemci başarıyı başarısızlıktan programatik ayıramıyor. | 🟢 | açık |
| 43 | Ş | `compare_competitors` | **#17 tekrar üretilemedi — vendor varyansı.** Otomatik mod adstark'ta artık youtube/wikipedia/linkedin değil `brandaft.com` (ETV 303) · `kariyer.net` (ETV 5.085) · `clicksus.com` (ETV 24) veriyor; üçün ikisi makul akran. **Bizim düzeltmemiz DEĞİL:** kodda kara liste aradım, **yok**; `compare-competitors.ts:73`'teki "youtube.com, wikipedia.org" yalnız açıklama metninde. Seçim algoritması aynı. Sonuç: "otomatik mod hep çöp verir" iddiası **dengesiz bir gözlem**; üzerine kural yazılmamalı. #26'yı güçlendirir. | 🟢 | açık |

### Kapandığı ÖLÇÜLEN bulgular

| # | doğrulama |
|---|---|
| **#1** | n=8. GSC bağlı adstark artık *"Then: … audit_onpage, audit_tech"* diyor; 6 crawl'sız site "run crawl_site"; seogrep "run audit_onpage". PR #42 canlı. |
| **#8** | n=2, **iki dal da koşturularak**: bağlı projede "connect_gsc" cümlesi **yok**, bağlı olmayanda **var ve doğru**. |
| **#15** | `analyze_backlinks` iki sitede temiz döndü (49.855 ve 93 backlink). PR #41 canlı. |
| **#20** | *"already connected … property https://adstark.com.tr/"* + yeniden onay linki. |
| **D29** | Rapor head'inde `<meta name="robots" content="noindex, nofollow">`. *(Küçük not: iki mükerrer robots etiketi var.)* |

### Tekrar üreyen bulgular

**#9** ve **#10** iki raporun **ikisinde de** duruyor: *"Run `audit_onpage` for the full per-page
breakdown"* (hesabı olmayan okuyucuya) ve *"66 Pages skipped"* (sebepsiz). Ayrıca **#6'nın
sonucu artık müşteriye giden belgede**: raporda *"0 Redirects (3xx)"* yazıyor ve H5 bu sayının
yapısal olarak daima 0 olduğunu kanıtladı.

---

## `normalizeUrl` — tek satır, üç bulgu

```ts
// crawl.ts:303
if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
```

| bulgu | mekanizma | durum |
|---|---|---|
| **#7** crawler kendi 301'ini üretiyor | sitemap `/sayfa/` → crawler `/sayfa` ister → 301 → **her sayfa 2 istek** | **6/8 sitede ölçüldü** (n=1'den n=6'ya) |
| **#6 / H5** `audit_tech` "Redirects: 0" | `crawl.ts:1132` sayfayı nihai durumla (200) kaydeder; `rules/tech.ts:63-65` 3xx'i `page.status`'ten sayar | 8/8 sitede `3xx = 0` |
| **#13** crawl ↔ GSC birleşmiyor | `crawl.ts:1132` `normalizeUrl(outcome.finalUrl)` — 301 izlendikten SONRA slash TEKRAR siliniyor | kod-seviyesinde kesin |

Triyaj bu üçünü ayrı dilimlere koymuştu (#7→4, #6→5, #13→4'e bağlı). **Üçü aynı satırdan
geliyor.** Ayrı yamanırsa aynı fonksiyona üç kez dokunulur.

**#7'nin zamanlama iddiası düzeltildi.** Vergi 301'in yavaşlığı değil, **iki istek atılması**;
ve sabit değil: bayder **+244%**, noraninsaat +102%, adstark +80%, rkturizm +73%, katrenur +45%,
dentnotion +9%. 90 sn'lik bütçeyi en çok **hızlı** siteler kaybediyor — sezginin tersi.

---

## Ürünün İYİ çalıştığı yerler — n=1'de görünmeyen

Önceki turda tek site üzerinden "GSC tool'ları hep boş dönüyor" izlenimi vardı. n=6'da tersi:

| tool | site | çıktı |
|---|---|---|
| `find_quick_wins` | bigcattr | **50 quick win**; "siyam kedisi" 11.5. sırada **34.881 gösterim** |
| `find_quick_wins` | dentnotion | 50 quick win; "20 lik diş ağrısına ne iyi gelir" 10.9. sırada 4.192 gösterim |
| `analyze_content_decay` | bigcattr | 35 düşen sayfa; en üstteki **2520 → 1143 tık (−%54,6)** |
| `analyze_content_decay` | dentnotion | 13 düşen sayfa, biri −%100 |
| `detect_cannibalization` | adstark | doğru "bulgu yok" **+ dışladığı markalı sorguyu açıkça söyledi** |

Düşük trafikli sitede boş dönmek **doğal sınır**, kusur değil — katrenur ve adstark'ta öyle oldu.

---

## Ücretsiz ön-uçuş (ürün kullanılmadan, 0 kredi)

Sekiz site sitemap ağacından boyutlandırıldı: **22–178 sayfa**.

- **www ayrımı çözüldü:** 8/8 site karşı formu **301** ile kanoniğe yolluyor. Risk sitelerde
  değil, bizim sakladığımız formda — `setup_project` **kanonikleştirmiyor**, yazılanı saklıyor.
- **JS-render: 8/8 sunucu-render.** Scrapling'in **(a)** şıkkı bu portföyde gerçekleşmiyor.
  *(Sınır: yalnız ana sayfalar.)* **(b)** şıkkı ise #37 ile **gerçekleşti**.
- Serbest bulgular: `www.bigcattr.com` iki URL formunu da **200** ile sunuyor (kanonikleştirme
  yok, sekizde tek) · sitemap index'inde **ulaşılamaz** bir alt sitemap · `katrenur.com`
  sitemap'inde **ölü URL** · `www.noraninsaat.com` **342 KB HTML / 173 kelime**.

---

## Kendi ölçüm hatalarım — dördü, hepsi rapordan ÖNCE yakalandı

1. **İlk H2 örneklemesi yapısal olarak kördü** — post-sitemap'ten çektiği için "- Artistics"
   soneki (page-sitemap'te) görünemezdi; kendinden emin **yanlış** bir "H2 yok" kararı
   üretecekti. Stratified örneklemeyle düzeltildi.
2. **Marka eşleştiricim iki kez yanlış bayrak kaldırdı** — `bigcattr`↔`BigCat` (alan adındaki
   `tr`), `bayder`↔`Bağımsız Yaşam Derneği` (kısaltma). Kararlar eşleştiriciye değil ham
   title'ları okumama dayanıyor.
3. **Gecikme ortalamasına timeout karıştı** — katrenur "2207 ms ile en yavaş" yazılmıştı; o
   ortalama ölü URL'in 15 sn'lik zaman aşımını içeriyordu. Gerçek: ~360 ms; en yavaş
   **dentnotion (1248 ms)**.
4. **`noindex` probe'um geçersizdi** — gövdedeki *"Robots conflicts (noindex but internally
   linked)"* metnini meta etiketi sanmıştı. HTML head'i doğrudan okuyarak doğrulandı.

---

## ÖLÇÜLEMEYENLER — adıyla

1. **S4 kiracı izolasyonu — 14 hücre.** Yabancı `project_id` yok. Uydurulmadı.
2. **H6 vendor şekil varyansı.** MCP yüzeyi ham payload döndürmüyor (yapısal). **Kampanyanın
   "en az bir yeni fixture" çıkış kriteri KARŞILANMADI.**
3. **Günlük DFS harcaması.** `guardrails/dfs-budget.sh` → **SKIP (exit 97)**;
   `SUPABASE_URL`/`SERVICE_ROLE` şefte yok. `/status` rakamı **basmıyor**, yalnız
   `rpc:dfs_spend_today_usd`'nin varlığını bildiriyor — handoff'un "her günün başında
   /status'tan harcamayı oku" talimatı bu uçla **uygulanamaz**. K3 boyunca vendor maliyeti
   **hiç görülmedi**; koruma benim ölçümüm değil, uygulamanın fail-closed kapısıydı.
4. **bayder + rkturizm GSC çökmelerinin sebebi** — sunucu log'u gerekiyor; #35 yüzünden
   istemciden ayırt edilemiyor.
5. **#37'nin tam HTTP kodu** — audit yalnız "4xx" kovasını yazıyor.

### #44 — kapı yük altında tekrarlanabilir değil

| # | Kaynak | Alan | Bulgu | Önem | Durum |
|---|---|---|---|---|---|
| 44 | Ş | `guardrails/verify.sh` / `crawl.test.ts` | **Cache'siz kapı, makine yüküne göre kırmızı/yeşil değişiyor.** `crawlSite — discovery ceilings … stops ACCUMULATING at the total result byte budget (T8)` testi vitest'in 5000 ms varsayılan sınırına takılıyor. Ölçüm: **izole koşuda 344 ms ve 353 ms** (14 kat marj), tam paralel kapıda **5359 ms → FAIL**. Dört cache'siz koşu: dal FAIL · dal FAIL · **main PASS** · dal PASS. Diff `scripts/` + `docs/` — ikisi de pnpm workspace'lerinin (`apps/*`, `packages/*`) dışında, `apps/mcp` testine dokunamaz; yani **dal nedenli değil, yük nedenli**. Muhtemel mekanizma: aynı anda koşan `@pseo/web:build` (Next.js, CPU-yoğun) ile çakışma. Sonuç iki yönlü ciddi: (a) CI rastgele kırmızı verebilir, (b) **cache'li koşu bunu tamamen gizliyor** — bu oturumda kapı `FULL TURBO` ile "PASS" dedi, `--force` ile aynı ağaçta kırmızı verdi. **"Flaky" DENMEDİ** (bu refleks #46'da bilinçle reddedilmişti); ölçümüyle kaydedildi. | 🟡 | açık |

### #45 — `reaper.db.test.ts` her gece 00:00–00:30 UTC arasında deterministik olarak kırmızı

| # | Kaynak | Alan | Bulgu | Önem | Durum |
|---|---|---|---|---|---|
| 45 | Ş | `apps/mcp/src/queue/reaper.db.test.ts:465` | **CI'da gece yarısı penceresi — ürün kodu değil, TEST hatalı.** Test `insertDfsRow(..., new Date(now.getTime() - 30*60_000))` yazıyor; `insertDfsRow` `spend_day`'i **`now − 30 dk`**'nın UTC tarihinden türetiyor. Reaper ise `reaper.ts:697` `.eq("spend_day", spendDay)` ile **tek bir UTC gününe** kapsamlı sorguyor (satır 521: *"Scoped to the UTC day the CAP is scoped to (migration 0014)"*). **00:00–00:30 UTC arasında `now − 30 dk` ÖNCEKİ gündür** → satır "bugün"de görünmez → `staleDfsReserves` artmaz → `expected 1, received 0`. Ölçüm: PR #59 CI koşusu **`2026-08-09T00:03:14Z`** FAIL · aynı commit yeniden koşuldu (hâlâ pencere içinde) FAIL · `main`'in son koşusu **`2026-08-08T20:58Z`** PASS. Yani **dal-korelasyonlu değil, saat-korelasyonlu**; günde 30 dakikalık bir pencerede her PR kırmızı verir. **Bu, defterdeki "#46'da açıklanamayan verify-db düşüşü" vakasını da açıklıyor** — o üç yeniden koşu ve main penceresinin dışındaydı, o yüzden tekrarlamadı. Düzeltme yönü (bu PR'da YOK): testin eklediği satırın `spend_day`'i, reaper'ın sorgulayacağı günle aynı olmalı. | 🟡 | açık |

**Hipotez ÖN-KAYITLI olarak sınandı ve tuttu.** Teşhis yazıldıktan sonra, kod değiştirilmeden şu
tahmin kaydedildi: *"00:30 UTC'den sonra aynı commit yeniden koşulduğunda yeşile dönecek."*

| koşu | UTC | pencere | sonuç |
|---|---|---|---|
| PR #59 ilk koşu | 00:03 | içi | **FAIL** |
| aynı commit, yeniden koşu | ~00:12 | içi | **FAIL** |
| yeni commit | 00:15 | içi | **FAIL** |
| **aynı commit, yeniden koşu** | **00:34** | **dışı** | ✅ **PASS** |
| `main` | 20:58 | dışı | ✅ PASS |

Beş veri noktası, tek satır kod değişmeden. Teşhis kanıtlandı.

**Bu bulgu kampanyanın kendi kuralını kanıtladı:** *"Yeşil kapı CACHE SAYACIYLA raporlanır;
'16 cached' bir REPLAY'dir, ölçüm değil."* Bu oturumda ilk iki commit cache'li bir "VERIFY: PASS"
üzerine atıldı; `--force` koşulduğunda aynı ağaç kırmızıydı.

## Kapının ölçmediği (imzalı ders 7)

`guardrails/verify.sh` `scripts/` dizinini **hiç görmüyor** (pnpm workspace'leri `apps/*` +
`packages/*`). Harness'ın tek otomatik kontrolü kendi `--self-test`'i; yedi iddiasının her biri
mutasyonla kırmızıya döndürülerek kabul edildi. Hakem iki sertleştirme açığı bıraktı:
**redaksiyonun JSONL yazım yoluna bağlanması pinlenmemiş** (bugün çalıştığı kanıtlandı) ve
kapsama kontrolü tool-adı granülasyonunda.

## Sırada

1. **Kural PR'ı ile kanıt PR'ı AYRI** — bu belge kanıt; H1'in aday kuralı ve #35/#38'in
   düzeltmeleri ayrı PR'lara girer ki hakem ikisini ayrı yargılayabilsin.
2. **0021 migration'ı** — H9 gerekçesi ölçüldü; cloud-apply insan kuyruğunda.
3. **S4** — trial hesabından bir `project_id` gelirse 14 hücre bir koşuda kapanır.
4. **H6** — sunucu tarafı ham yakalama olmadan kapanmaz.
