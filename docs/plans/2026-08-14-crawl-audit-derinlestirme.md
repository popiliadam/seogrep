# Crawl + Audit Derinleştirme Planı — "MCP üzerinden Screaming Frog"

> Tarih: 2026-08-14 · Durum: **PLANLANDI — dispatch bekliyor** (imza kalemleri hariç)
> Kapsam: `crawl_site` · `audit_onpage` · `audit_tech` · `audit_schema` + panel yansıması
> Operatör talebi: "Screaming Frog gibi her detayı alabileceğimiz ortam, ama MCP üzerinden."

## 0. İlkeler (pazarlıksız)

1. **Kibar crawler duruşu korunur.** SSRF pinning + robots.txt uyumu + bütçeler hiçbir fazda
   gevşemez. Anti-bot/stealth (Scrapling vb.) REDDEDİLDİ: `setup_project` sahiplik doğrulamaz;
   stealth eklemek ürünü "başkasının sitesini korumasını delerek tarayan araç" yapar.
   Scrapling ayrıca Python — TS monorepo'ya ikinci runtime + SSRF katmanının ikinci kopyası.
2. **Fiyata dokunan her şey imzasız dispatch edilmez** (NEVER#6). İmza kalemleri §7'de.
3. **MCP yapar, panel gösterir.** Audit hesaplaması panelde bedavalaşmaz (fiyatı deler);
   panel yalnız KOŞULMUŞ işlerin izini gösterir.
4. **Kural sayısı audit motorunun değil, PageRecord'un fonksiyonu.** Önce sinyal, sonra kural.

## 1. Ölçülmüş mevcut durum (2026-08-14)

- `PageRecord` alanları: url, status, title, metaDescription, h1s, canonical, robotsMeta,
  links, wordCount, jsonLdTypes, issues(4 tür). Yanıt süresi/boyut/header/görsel/hreflang/
  og/H2-H6/derinlik/hash YOK.
- **Crawl döngüsü SIRALI** (`queue.shift()` → `await fetchPage`, crawl.ts ~1095-1108) —
  90 sn bütçede ~25-40 sayfa. Canlı kanıt: dentnotion 26/158 · noraninsaat 24/118 ·
  adstark 37/77, hepsinde baskın sebep "time budget exhausted".
- **JS rendering yok** — canlı kanıt: bigcattr 1 sayfa.
- Crawl sonucu `jobs.result` TEK jsonb (12 MB tavan) — satır bazlı sorgu/gösterim imkânsız.
- Audit'ler senkron ve İZ BIRAKMIYOR (audit_runs yok) — panelde gösterilemez, trend yok.
- Hazır altyapılar: DFS portu (`apps/mcp/src/dfs/`, $3/gün tavan) · `packages/core/email`
  (send.ts) · MCP prompts (`new-site-audit`, `monthly-routine`) · GSC pull verisi.

## 2. Fazlar — mimari omurga (sıralı)

### Faz 0 — `crawl_pages` veri modeli pivotu (HER ŞEYİN ÖN KOŞULU)
Sayfa başına satır (RLS'li, tenant-scoped): url, status, sinyal kolonları, issues jsonb.
`jobs.result` özet+geriye-uyum için kalır; audit motorları ve panel satırlardan okur.
- done_when: migration (cloud-apply İNSAN KUYRUĞU) · worker çift-yazım · audit'ler satırdan
  okuyup BAYT-ÖZDEŞ çıktı veriyor (eski blob yoluyla A/B testi) · 12 MB tavan sorunu kapanıyor.

### Faz 1 — ucuz sinyal genişletmesi (ek istek YOK, mevcut fetch'ten)
Yanıt süresi · sayfa byte'ı · H2-H6 sayıları · img sayısı + alt eksikleri · hreflang ·
og/twitter · lang · X-Robots-Tag · redirect zinciri (hop listesi) · içerik hash'i ·
BFS derinliği · iç link in/out sayıları. Alan tavanları (H-02 deseni) her yeni alana.
- Ardından kural dalgası: onpage (+img-alt, çoklu title tag, title=h1, og eksik, lang eksik,
  URL hijyeni, duplicate-hash grupları, başlık hiyerarşisi) · tech (+yavaş sayfalar,
  redirect zincir uzunluğu/302 kalıcı kullanım, X-Robots-Tag çelişkisi, mixed content,
  güvenlik başlıkları).

### Faz 1.5 — paralel fetch (EN UCUZ BÜYÜK KAZANÇ; Faz 0'dan bağımsız, öne alınabilir)
robots `Crawl-delay` YOKSA 3-4 eşzamanlı istek (origin başına); varsa bugünkü sıralı+delay.
Hedef: aynı 90 sn bütçede ~3× sayfa. "time budget exhausted" vakalarının kök çözümü.
- done_when: canlı üç sorunlu sitede önce/sonra sayfa sayısı ölçümü · robots'lu sitede
  sıralı davranışın korunduğu testle pinli · SSRF pinning eşzamanlılıkta da geçerli.

### Faz 2 — graf analizleri (Faz 0+1 üstüne)
Orphan sayfalar (sitemap ∖ link-graph) · kırık iç linkler · tıklama derinliği dağılımı ·
duplicate içerik grupları · sitemap↔crawl diff. audit_tech ikinci kural dalgası.

### Faz 3 — audit_schema derinleşmesi
JSON-LD GÖVDESİ saklanır (sayfa başına tavanlı, Faz 0 kolonları). Tip başına zorunlu-alan
kontrolü (offers'sız Product, datePublished'sız Article…) · rich-result uygunluk haritası ·
microdata/RDFa tespiti (parser genişletmesi).

### Faz 4 — JS rendering (opt-in) — İMZA İSTER
`crawl_site`'a `render: true`; worker'da Playwright, sayfa başı sıkı bütçe, AYNI SSRF
pinning + robots uyumu. Muhtemelen ayrı kredi fiyatı (§7). Sahiplik kademesiyle (§4-N3)
birlikte düşünülmeli: render ayrıcalığı doğrulanmış sahibe.

### Faz 5 — laboratuvar metrikleri: "satın al" hattı
Lighthouse/CWV kendi motorunda DEĞİL; DFS OnPage/Lighthouse portundan ($3/gün tavan içinde)
ya da PSI API'den. Yeni dış API varsayılanı `packages/core` (NEVER#5; DFS istisnası DFS'e özgü).

## 3. Panel yansıması

1. **`audit_runs` tablosu**: MCP'de koşulan her audit persist edilir (tool, project_id,
   created_at, report jsonb). Fiyat kararı GEREKTİRMEZ — mevcut fiyatla uyumlu.
2. Proje kartına **"Audits" bölümü**: koşulmuş audit'ler tarihiyle (Recent crawls deseni);
   koşulmamışsa asistana yönlendirme (whats_next paritesi).
3. **Trend**: audit_runs birikince "12 issue → 5 issue" zaman çizgisi — Screaming Frog'un
   web arayüzü yok; farklılaşma noktası.
4. Faz 0 sonrası **crawl detay sayfası**: sayfa listesi, durum kodları, issue filtreleri.
5. whats_next merdivenine audit_runs sinyali eklenebilir (audit koşulmuş mu artık ölçülebilir
   olur — bugünkü "sezgisel rehber" körlüğü kısmen kapanır).

## 4. Ek gelişim alanları (2026-08-14 taraması — fazların dışında)

**Motor/adalet:**
- N1. Koşullu yeniden tarama (ETag/If-Modified-Since) — incremental re-crawl.
- N2. `estimate_site` (0 kredi, yeni tool): crawl öncesi boyut/sitemap sağlık ön-izlemesi.
- N3. **Sahiplik kademesi**: GSC `siteOwner` doğrulanmış projeye yüksek tavan/render.
- N4. PAGE_CAP kademeleri (100→250/500, pakete göre) — İMZA.
- N5. Crawl telemetri log satırı (reaper heartbeat deseni): süre/fetch/bütçe kullanımı.

**Zaman ekseni:**
- N6. **`compare_crawls` (yeni tool)**: iki crawl diff'i — yeni/kaybolan sayfa,
  yeni/çözülen issue (Faz 0 sonrası ucuz).
- N7. Zamanlanmış tarama (sunucu cron): otomatik kredi harcama → D17 onay tasarımı, İMZA.

**GSC × crawl köprüleri (en yüksek değer/maliyet):**
- N8. **`audit_content` (yeni tool)**: GSC sorguları × sayfa title/h1 uyumsuzluğu —
  "X'te gösterim alıyorsun ama title'ında X yok" listesi. Yeni dış veri İSTEMEZ.
- N9. Kırık sayfa × backlink (link reclamation): DFS backlink hedefi 404 → kurtarma listesi.
- N10. Üçlü diff: sitemap ∖ crawl ∖ GSC-trafik → öksüz/ölü ağırlık haritası.
- N11. Index kapsama örneklemesi (GSC URL Inspection API, kota sınırlı).

**MCP-doğal:**
- N12. **Sampling ile öneri**: bozuk title/meta düzeltmesini İSTEMCİNİN LLM'i yazar
  (sunucuda sıfır LLM maliyeti). "Audit bulur, asistan yazar" döngüsü ürünleşir.
- N13. MCP resources + structuredContent: raporlar gezilebilir/yapılandırılmış.
- N14. Yeni prompt'lar: `fix-top-issues`, `content-refresh`.

**Teslimat:**
- N15. Aylık rapor e-postası (core/email hazır) — opt-in.
- N16. Rapor zenginleşmesi (audit_runs + trend + diff) · white-label — İMZA (fiyat/paket).
- N17. `audit_sitemap` (ucuz yeni audit): sitemap'te 404, bayat lastmod, boyut ihlali,
  robots sözdizimi.

## 5. Yeni tool adayları — özet tablo

| Aday | Bağımlılık | Kredi (öneri, İMZASIZ GEÇERSİZ) |
|---|---|---|
| `audit_content` (N8) | pull + crawl (mevcut) | 10-15 |
| `compare_crawls` (N6) | Faz 0 | 5-10 |
| `estimate_site` (N2) | mevcut estimateSiteSize | 0 |
| `audit_sitemap` (N17) | mevcut sitemap parser | 5 |
| link reclamation (N9) | DFS portu | DFS ailesi fiyat bandı |

## 6. Önerilen dilim sırası

1. **Faz 1.5 paralel fetch** (bağımsız, ölçülebilir, fiyatsız — hemen)
2. **Faz 0 crawl_pages** (migration → insan kuyruğu) + N5 telemetri
3. **audit_runs + panel Audits bölümü** (fiyatsız)
4. **Faz 1 sinyaller + kural dalgası** (onpage/tech)
5. **N8 audit_content** (fiyat imzasıyla) + N2 estimate_site + N17 audit_sitemap
6. **Faz 2 graf** + N6 compare_crawls
7. **Faz 3 schema gövdesi**
8. **İmza bekleyenler çözüldükçe**: Faz 4 render · N3/N4 kademeler · N7 cron · N16 rapor

## 7. İNSAN İMZA KALEMLERİ (imzasız dispatch YOK)

1. JS rendering kredisi ve sahiplik şartı (Faz 4 + N3).
2. PAGE_CAP kademeleri / paket eşlemesi (N4).
3. Yeni tool fiyatları (§5 tablo — TOOL_COSTS pin'i büyür, NEVER#6).
4. Zamanlanmış tarama = otomatik kredi harcama onay modeli (N7, D17).
5. White-label/rapor paketlemesi (N16).
6. Faz 5 DFS OnPage kullanımı = $/çağrı (mevcut $3/gün tavan yeterli mi).

## 8. Kapı notları

Her dilimde: `verify.sh` + değen paketin kendi şeridi (imzalı ders 15) + migration'lı
dilimlerde `verify-db` + **imaj tarifleri kontrolü** (2026-08-14 Dockerfile vakası — yeni
workspace bağımlılığı ekleyen task, tüketen HER Dockerfile'ı kontrol eder). Crawler
değişikliklerinde canlı önce/sonra ölçümü (aynı üç site: dentnotion/noraninsaat/adstark)
kapının parçasıdır — "yeşil test" tek başına sayfa-sayısı iddiası kanıtlamaz.
