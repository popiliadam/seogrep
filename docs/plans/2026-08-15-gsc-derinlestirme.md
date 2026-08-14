# GSC Ailesi Derinleştirme — Plan

> Durum: **PLANLANDI — fiyatsız dilimler dispatch edilebilir; imza kalemleri §7'de bekler.**
> Kaynak: 2026-08-15 gece oturumu — 6 ajan raporu (panel haritası · API kullanım envanteri ·
> plan/backlog kısıtları · 7 tool satır-satır · komşu yüzeyler · Google API kataloğu, web-doğrulamalı).
> Kapsam: 7 GSC tool'u (`list_gsc_properties` · `track_gsc_property` · `untrack_project` ·
> `pull_gsc_data` · `find_quick_wins` · `detect_cannibalization` · `analyze_content_decay`)
> + komşu yüzeyler (whats_next, generate_report, prompts, panel).
> Kardeş plan: `2026-08-14-crawl-audit-derinlestirme.md` — çakışmaz; N-numaraları oradan bağımsız,
> burada G-numaraları kullanılır.

## §0 İlkeler (pazarlıksız)

1. **Fiyata dokunan hiçbir şey imzasız dispatch edilmez** (NEVER#6). Bu plandaki her yeni tool
   fiyatı ÖNERİdir; §7 imzalanmadan kod yazılmaz.
2. **MCP yapar, panel gösterir.** Panel, ödenmiş analizi bedavalaştırmaz; yalnız KOŞULMUŞ işin
   izini gösterir. (Ölçülen cazibe: panel pull blob'unu zaten indiriyor ve quick-wins motoru saf —
   panelde bedava koşturmak teknik olarak mümkün, fiyatı deldiği için YASAK.)
3. **OAuth scope'u `webmasters.readonly` kalır.** Okuma tarafındaki her genişleme (URL Inspection
   dahil — doğrulandı, aynı readonly scope yetiyor) yeniden onay istemez. `submit_sitemap`/`sites.add`
   yazma scope'u ister → consent ekranı değişir → Google doğrulaması riske girer (2026-07-28'de zor
   kapanan süreç). **Karar önerisi: RET** — gerekçesiyle §7'de.
4. **Önce dürüstlük, sonra yetenek.** Capped/bayat/pencere-görünmez çıktı düzeltilmeden yeni analiz
   ekseni açılmaz (aşağıda G-DÜR dilimi ilk sıradadır).

## §1 Ölçülen zemin (2026-08-15 itibarıyla)

- Ürün GSC API'sinden yalnız şunu kullanıyor: `sites.list` + `searchAnalytics.query`
  `{dimensions:["query","page"], rowLimit:5000, startRow:0}` — filtre yok, sayfalama yok,
  `date/device/country/searchAppearance/hour` boyutları yok, `dataState` yok, tip (`discover` vb.) yok.
  İstemci (`packages/core/src/gsc/client.ts`) gövdeyi aynen geçirir → genişleme çoğunlukla
  `queryBody`-seviyesi iştir. Tek sıkı bağlantı: `rows.ts` pozisyonel `keys[0]/keys[1]` okur.
- URL Inspection: `searchconsole.googleapis.com/v1` (tek yeni host sabiti), **readonly scope yeter**,
  kota property başına ~2.000/gün + 600/dk → örneklem tool'u olur, site-geneli süpürme olmaz.
- Sitemaps `list/get` readonly ile çalışır; `submit/delete` yazma scope'u ister. `contents[].indexed`
  alanı resmen deprecated — "indexed oranı" ONA kurulamaz.
- Panel bugün üç GSC gerçeği gösteriyor: hesap e-postası, property, pull tarihi. `token_status`
  hiçbir yüzeyde görünmüyor; pull içeriği ve discovery çıktıları hiçbir yerde persist/gösterim yok.
  `/app/projects` pull `result` blob'unu indirip kullanmadan atıyor (payload israfı, ölçüldü).
- Discovery koşuları hiçbir DB izi bırakmıyor (ledger satırı hariç) — `audit_runs` (0024, C dilimi)
  emsali bu aileye henüz uygulanmadı. 0024'ün CHECK'i bilinçli olarak üç audit'e kilitli:
  GSC koşuları oraya YAZAMAZ → ayrı tablo gerekir (G2).

## §2 Bulgu envanteri (kısa künye — ayrıntı ajan raporlarında)

**Motor doğruluğu/dürüstlüğü (REAL):**
- **B1 capped çarpıtması**: `capped` yalnız pull anında uyarılıyor; üç discovery motoru kırpık
  veriyle sessizce koşuyor. Decay HAYALET çürüme üretebilir (önceki pencerenin top-5000'inde olup
  mevcut pencerede kırpılan sayfa current=0 okunur), cannibalization payları kırpık paydayla hesaplanır.
- **B2 fragment asimetrisi**: `#fragment` katlama yalnız cannibalization'da; decay ve quick-wins ham
  URL'le çalışıyor → decay, tık kütlesi bare↔#fragment satırları arasında kayınca stabil makaleyi
  "çürüyor" ilan edebilir (bigcattr şeklinin öteki motora sızmış hâli); quick-wins `#fragment` URL basabilir.
- **B3 pozisyon default'u 0** = "1'in üstü": bozuk satır `looksLikeSitelinks`'i yanlış tetikleyebilir;
  fail-safe yön `Infinity`/satır-düşürme.
- **B4 bayatlık yarım**: provenance PULL tarihini basıyor ama veri 3 gün geriden biter; yaş-uyarısı yok
  (60 günlük pull'dan analiz, tek ipucu sondaki tarih satırı).
- **B5 `days` görünmezliği**: discovery çıktısı pencere aralığını basmıyor; mutlak eşikler (≥20 gösterim,
  ≥5 tık) pencere-uzunluğuna göre anlam değiştiriyor (7 gün ≈ 90 günün ~13× katı sıkılık) — docs'ta da yok.
- **B6 `capped` false-negative**: bayrak parse-sonrası uzunlukla hesaplanıyor; düşen tek bozuk satır
  4999 okutup uyarıyı söndürür. HAM dizi uzunluğuyla kıyaslanmalı.

**Sağlık görünürlüğü (REAL):**
- **B7 `token_status` görünürlüğü eksik** *(hakem düzeltmesi 2026-08-15: alan kısmen kablolu)*:
  kolonu bugün YALNIZ üç discovery tool'u okuyor (`loadGscTokenStatus` → reauth uyarısı,
  gsc-discovery-shared.ts — Faz A Task 8'in bilinçli tasarımı; SAKIN yeniden kurma/duplike etme).
  Okumayanlar: `list_gsc_properties` (ölü credential'a bugünkü cümlesi "…could not be read just now…
  Try again shortly, or reconnect the account on the Connection page." — reconnect tavsiyesi VAR ama
  ölü/geçici AYRIMI yok), `whats_next` merdiveni (`readGscConnected` yalnız `account_id` okur → ölü
  hesapta bile `pull_gsc_data` önerir) ve TÜM web yüzeyleri. Yazanlar: pull'un `invalid_grant` dalı
  (`markGscAccountTokenInvalid`) + web `accounts.ts` `markTokenStatus` — `list_gsc_properties` kendi
  gözlemlediği `invalid_grant`'i yazmıyor.
- **B8 bootstrap kopyası çıkmaz sokak**: "Run connect_gsc for one of your projects" — sıfır projeli
  kullanıcının `setup_project` adımı hiç anılmıyor.

**Para/ops (POLISH→REAL):**
- **B9 idempotency yok**: istemci timeout-retry'ı senkron ücretli yüzeyde çift tahsil eder (ürün-geneli;
  bu aile en uzun senkron gecikmeli). — büyük iş, ayrı karar.
- **B10 `recordSucceededPull` atomik değil** (insert queued → update succeeded); arada düşerse sonsuz
  "queued" hayalet satır. **B11 jobs.result sınırsız birikiyor** (yalnız en yenisi okunuyor; retention yok).

**Kayıp değer (mevcut veriden bedava):**
- **B12** rapor `previous` pencereyi ve satırlardaki `ctr/position`'ı hiç kullanmıyor (dönem-farkı ve
  pozisyon kolonu bedava). **B13** `get_job_status` pull job'ını boş özetle basıyor (`summarizePullResult`
  yok). **B14** pull GEÇMİŞİ birikiyor ama hiçbir tool okumuyor (trend/`compare_pulls` ham maddesi hazır).
  **B15** üç prompt 2026-08-13 property-üçlüsünden habersiz; sağlık-check prompt'u yok. **B16** discovery
  docs sayfalarında 5000-tavan/3-gün-lag mirası yazmıyor (yalnız pull sayfasında). **B17** quick-wins
  50 tavanını sessiz kırpıyor; cannibalization/decay tavansız. **B18** IDN/punycode marka token'ı ölü
  doğuyor (Türkçe pazarda gerçek). **B19** marka-override yok (tip.com "tıp"ı bastırır, kaçış kapısı yok —
  tool paramı S-M, proje kolonu migration). **B20** `track_gsc_property` hesapları seri sorguluyor;
  birebir-eşitlik "did you mean" önerisi basmıyor. **B21** MCP resources/structuredContent hiç yok.

**Sağlam ölçülenler (dokunma):** kiracı izolasyonu her okuma+yazma yolunda mutasyon-testli; para kuralı
(throw=bedava/return=tahsil) her rette defter-pinli; iki pull yarışı zararsız; Pasifik-günü/UTC farkı
5-günlük lag bandında emilmiş.

## §3 Dilimler (fiyatsız — otonom dispatch edilebilir)

Sıra, §0-4 gereği dürüstlük-önce. Her dilim: izole worktree + Opus işçi (yalnız iş emri görür) +
taze hakem (>400 satır → Fable) + kapı (verify.sh + değen paketlerin KENDİ şeritleri — ders 15) +
PR + CI + merge-commit.

- **G1a — token sağlığı yüzeyi** *(B7+B8)*: `list_gsc_properties` `token_status` okur (ölü hesapta
  "connection expired — reconnect", "try again shortly" yalnız gerçek geçicide) VE kendi gözlemlediği
  `invalid_grant`'i best-effort yazar (pull'un `markGscAccountTokenInvalid` yolu). Web Connection:
  hesap satırında "Reconnect needed" rozeti + "last verified" (`token_checked_at`); ölü/geçici metin
  ayrımı. Overview'a tek sağlık satırı. Bootstrap kopya düzeltmesi. **Migration YOK** (web okuması
  service-client kiracı-süzgeçli yoldan; GRANT değişikliği gerekirse o parça durur, rapor edilir).
- **G3 — pull motoru** *(B6 + C1/C2 + claim-c)*: satır tavanı 5.000 → ölçülüp gerekçelenen yeni tavan
  (25k tek istek; depolama matematiği done_when'de), `capped` HAM uzunluktan, iki pencere sorgusu
  paralel (403/reauth dal semantiği bayt-özdeş). Fiyat 5'te SABİT. *Bu bir fiyat-değeri değişimi
  DEĞİL: Google API'si ücretsiz, istek sayısı aynı (tek sayfa), 5 kredi "iki pencerelik pull" satın
  almaya devam eder — 5.000 tavanı hiçbir yerde vaat edilmiş ürün sınırı değil, v0 uygulama sınırıdır
  (docs'ta "limitation" olarak yazılıdır ve docs güncellenir). Karar kaydı §7-2'ye not düşülür.*
- **G5 — discovery dürüstlüğü** *(B1+B2+B4+B5+B17)*: üç render'a pencere aralığı satırı + capped
  caveat'i; ≥30 gün bayat pull'a yeniden-çek önerisi; `documentOf`/fragment katlama decay+quick-wins'e
  paylaşılan yardımcıyla; kırpma notları ("and N more"). Çıktı metni değişir → pinli testler YENİ
  davranışa göre güncellenir (davranış testi silinmez — NEVER#8 şerhi iş emrine yazılır).
- **G2 — `gsc_discovery_runs` persist + panel Insights** *(ÖN KOŞUL: C dilimi/0024 main'de)*:
  migration **0025** — 0024 zırh deseninin ikizi (RLS force, append-only, bileşik FK'ler,
  `tool CHECK in ('find_quick_wins','detect_cannibalization','analyze_content_decay')`,
  `pull_job_id NOT NULL`, yapısal rapor jsonb, SCHEMA_VERSION bump). `makeDiscoveryTool`'a fail-closed
  persist (insert hatası → throw → release). Panel proje kartına "Insights" bölümü: tool başına EN SON
  koşu (sayı + en büyük bulgu + tarih; koşulmamışsa "Not run yet — ask your assistant…"). PR gerekirse
  **hazır-park** (prod DDL operatörde; 0024'le aynı SQL dalgası).
- **G1b — kart pull özeti + payload düzeltmesi** *(ÖN KOŞUL: C main'de — dosya çakışması)*: kartta
  pencere/satır-sayısı/capped; `result` blob'u sorgudan çıkar ya da dar alan seçimine indir
  (P2 kolon-pinli sorgu disiplini emsal).
- **G4 — merdiven token bilinci** *(B7'nin core yarısı)*: `whats_next` + web `signals.ts`'e
  `token_status` sinyali; ölü hesapta "reconnect first" basamağı. Ladder metinleri pinli —
  ders 11: en kısa ayırt edici parça + `/i` ile aranıp güncellenir.
- **G6 — küçük borçlar paketi** *(B3+B10+B13+B15+B20)*: pozisyon fail-safe; `recordSucceededPull`
  atomikliği; `summarizePullResult` (core'a — web de kullanabilsin); prompt tazelenmesi
  (property-üçlüsü + `gsc-health-check` prompt'u); track paralel sorgu + "did you mean".
- **G7 — docs dürüstlüğü** *(B16)*: üç discovery sayfasına miras-sınır cümlesi — **yalnız generator
  yoluyla** (`gen-tool-docs`), elle MDX ihlaldir (docs-schema-sync).

Bilerek DIŞARIDA (ayrı karar ister): B9 idempotency (ürün-geneli altyapı), B11 retention (zamanlanmış
iş = ayrı tasarım), B21 structuredContent (registry tipine dokunur, server-card + mcp-alive 22-şema
pinleriyle birlikte oynar), B19 proje-kolonu marka override (migration + ürün kararı).

## §4 Yeni tool adayları (fiyatlar ÖNERİ — §7 imzasız GEÇERSİZ)

| Aday | Ne | Google çağrısı | Fiyat önerisi |
|---|---|---|---|
| `compare_pulls` | İki pull diff'i: yeni/kaybolan sorgular, pozisyon kazanan/kaybeden, sayfa trendi — ham madde DB'de hazır (B14) | Yok | 5–10 |
| `analyze_ctr_gaps` | Pozisyon ≤5-8 + beklenenin altı CTR → title/meta yeniden yazım listesi (kendi property-eğrisi kıyası; NEVER#7: eğri varsayımı çıktıda beyan edilir) | Yok | 10 |
| `inspect_url` | URL Inspection örneklemi: verdict, coverage, googleCanonical≠userCanonical, lastCrawlTime, rich-results. **Yeni host sabiti + istemci `packages/core`'a yazılır (NEVER#5 varsayılanı — DFS konumu imzalı İSTİSNAdır, emsal değil)**; kota defteri fikri dfs budget'tan, konumu core/app sınırına uygun kurulur | Var (kotalı) | 2-3/URL ya da 10/örneklem |
| `pull_gsc_data` v2 paramları | `dimensions` (device/country/date), `type` (`discover` dahil), regex `page_filter`, `dataState:all` | Var | 5 SABİT kalabilir mi → maliyet profili §7'de |
| `audit_sitemap` (GSC yarısı) | Kardeş plandaki N17'ye `sitemaps.list/get` katmanı: Google'ın gördüğü liste + errors/warnings + lastDownloaded (readonly; `indexed` alanı KULLANILMAZ — deprecated) | Var | kardeş planla birlikte 5 — fiyat imzası kardeş planın §7-3'ünde |
| — `submit_sitemap` | **RET önerisi**: yazma scope'u → consent değişimi → Google doğrulama riski + dışa-etki sınıfı | — | — |

Ufuk (fiyatsız fikir olarak kayda): saatlik veri (`HOUR`+`HOURLY_ALL`, API'de 10 gün — UI'da 24s;
lansman/tazelik izleme), Discover/News tipi ayrı havuzlar, searchAppearance iki-adım deseni,
16-ay ötesi veri ambarı (retention hook), pSEO yayın-kohortu indeksleme hunisi (`inspect_url` +
sitemaps kesişimi — ürünün adındaki işin ta kendisi).

## §5 Panel gösterim tasarımı (karar cümleleri)

1. Connection: hesap satırına sağlık rozeti (`Reconnect needed` kırmızı / `last verified N days ago`).
2. Proje kartı "Search Console": property + hesap e-postası + pull penceresi/satır sayısı/capped +
   gerekirse "connection expired" satırı. (G1b)
3. Proje kartı "Insights": audit'lerin "Audits" bölümünün ikizi — yalnız KOŞULMUŞ discovery izleri. (G2)
4. Overview: tek sağlık satırı ("1 account needs reconnection · 2 stale pulls") → doğru sayfaya link.
5. Trend, persist'in bedava getirisi: koşular birikince "quick wins 12→8→5".

## §6 Kapı notları

- Her dilimde: `TURBO_FORCE=1 bash guardrails/verify.sh` + değen paketlerin kendi şeritleri;
  migration dilimlerinde `bash guardrails/verify-db.sh` (00:00–00:30 UTC penceresinden kaçın);
  Dockerfile'a workspace bağımlılığı ekleyen dilimde imaj-reçetesi kontrolü (ders adayı — #84 vakası).
- Çıktı-metni değiştiren dilimlerde (G5) mutasyon kanıtı: caveat'i kaldır → test kırmızı;
  pencere satırını kaldır → test kırmızı.
- G2'de defter pinleri: persist hatasında `[grant, spend_reserve, spend_release]`, `spend_commit` YOK
  (crawl-pages/audit-runs db-test deseni).
- Ladder/copy değişikliklerinde ders 11: pinli dizgi EN KISA AYIRT EDİCİ PARÇA + `/i` ile aranır.

## §7 İnsan-imza kuyruğu

1. Yeni tool fiyatları: `compare_pulls` · `analyze_ctr_gaps` · `inspect_url` (§4 önerileri).
2. `pull_gsc_data` v2 paramlarının maliyet profili (fiyat 5'te kalsa bile karar kaydı: boyut başına
   ek Google sorgusu = ek gecikme; hangi boyutlar 5'e dahil). *Not: G3'ün tavan yükseltmesi burada
   karar kaydı olarak anılır — fiyat-değeri değişimi sayılmama gerekçesi §3-G3'te.*
3. `submit_sitemap` / yazma scope'u: **RET önerisi** — imzalanırsa kalıcı karar olarak dosyalanır.
4. Rapora discovery bulgularının eklenmesi (B12 ötesi): 15 kredinin aldığını değiştirir —
   NEVER#6 ruhu; "Top 5 quick wins raporda" evet/hayır.
5. B19 marka-override proje kolonu (migration + ürün yüzeyi).
6. Quick-wins ikinci sınıfı (CTR-gap bandı) mevcut 10-kredilik tool'un İÇİNE mi (`find_quick_wins`
   çıktısı zenginleşir, fiyat sabit) ayrı tool'a mı (`analyze_ctr_gaps`) — ürün kararı.

## §8 Operatör adımları (imza dışında)

- G2 merge'inden önce/sonra: `0025_gsc_discovery_runs.sql`'i prod'a uygula (0024'le aynı SQL Editor
  dalgası önerilir; sıra: migration → merge, aksi hâlde discovery persist fail-closed reddeder —
  0023/#89 emsali).
