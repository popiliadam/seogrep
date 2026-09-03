# Dilim 4 — hakemin tekrarlayan sınıflar tablosu

> Tur: 2026-09 tool kontrol turu, dilim 4 (anahtar kelime ailesi: `research_keywords`,
> `discover_keywords`, `ranked_keywords`, `my_pages`, `keyword_gap`, `serp_snapshot`) ·
> Hakem: taze Opus, 2026-09-03 ~20:25 UTC · **6/6 PASS** (biri bir kanıt hatasıyla: `my_pages`, H-2)
> Kaynak: hakemin ölçüm turu raporu. Bu dosya hakem metnini AKTARIR; yeni bulgu üretmez.
> Kardeşleri: `_DILIM2-HAKEM-SINIFLAR.md` (dokuz sınıf) · `_DILIM3-HAKEM-SINIFLAR.md` (dokuz sınıf).

Altı kaydın bulguları tek tek okunduğunda ayrı ayrı görünüyor. Yan yana konduğunda **on sınıf**
çıkıyor, ve onun **beşi dilim 1–3 ile kesişiyor** — üçü ÜÇÜNCÜ kez tekrar ediyor. Sınıf tablosunun
asıl işi budur: **düzeltme dilimlerini tool'a göre değil SINIFA göre kesmek.**

| # | sınıf | nerede görüldü (tool listesi) | kök / ortak yol | kesişim | akıbet |
|---|---|---|---|---|---|
| 1 | **NEVER#4 kiracı filtresi hızlı şeritte pinsiz** | `my_pages` A-1 (`crawl_pages` okuması, `my-pages-crawl.ts:107`) | `service-client-pins.test.ts` bu zinciri hiç tanımıyor (`grep` → 0); tek koruma Docker isteyen `my-pages.db.test.ts (h)` ve o şerit hiçbir tarafça koşulmadı | Dilim 3 sınıf 1 — **ÜÇÜNCÜ tekrar**; hâlâ `goals/` hedefi yok | |
| 2 | **Ücret kapsamı süpürgesi YANLIŞ NESNEYİ okuyor** | `ranked_keywords` B-1 | `handler-charge-scope-coverage.pin.test.ts` `META_WINDOW = 8` yorum-dışı satır sayıyor; `ranked-keywords.ts`'te bu pencere `writeRun`'ın `tool:`+`projectId` satırlarına ulaşıyor. `my_pages`'te aynı pencere `port.fetchRelevantPages` argümanlarına düşüyor ve süpürge doğru çalışıyor (M8 KIRMIZI) | Dilim 3 sınıf 2 **"KAPANDI" idi — yeni POZİSYONDA yeniden açıldı** (ders 14: eksen aynı, pozisyon farklı) | |
| 3 | **R-8.9 hacim şerhi hiçbir yüzeyde yok** | `research_keywords` RK-1 · `discover_keywords` DK-2 · `keyword_gap` G-1 · `ranked_keywords` B-3 (**4 tool**) | Aynı satıcı alanı dört yerde basılıyor; `grep -rniE "close variant\|rounded\|12.month\|exact match"` dört kaynak + dört mdx üzerinde 0 eşleşme | Yeni. **Düzeltme PAYLAŞILAN TEK SABİT olmalı** — dört mdx'e kopyalanırsa dördü ayrışır | |
| 4 | **Ücretli çağrı ABD/İngilizce varsayılanını sessizce uyguluyor** | `my_pages` A-2 (**P1**, 2 × 40 kredi zarar ÖLÇÜLDÜ) · `keyword_gap` G-3 (P2) · `ranked_keywords` (azaltıcıyı taşıyan TEK tool) · `discover_keywords` `for_site` (**ÖLÇÜLMEDİ**) | `location_code` 2840 / `language_code` "en" varsayılanları paylaşılıyor; `twoLetterTld` + `localeHint` çifti ağaçta yalnız `ranked-keywords.ts`'te | Yeni (hakem H-3) | |
| 5 | **Parası ödenen veri hiçbir yüzeyden okunamıyor** | `serp_snapshot` S-1 (`item_types`, `ai_overview*` dahil) + S-2 (sıralayan URL'i basan TEK yüzey pinsiz — M-SS7 yeşil kaldı) | `serp-snapshot-store.ts:134` yazıyor ↔ `keyword-positions-store.ts:73` `COLUMNS`'ta `report` yok ↔ iki biçimlendiricide `item_types` 0 eşleşme | Dilim 3 sınıf 6 (F-5 devri) — **yarısı düzeltildi**: URL yarısı `serp_snapshot` için YANLIŞ çıktı, boşluk yalnız `keyword_positions`'ta | |
| 6 | **`plan.mjs` EXCLUDED gerekçesi bayat** | `my_pages` A-5 · `discover_keywords` DK-4 · `serp_snapshot` S-7 · `keyword_gap` G-4 (kısmen) | `plan.mjs:126/127/141` "budget signature" diyor; 2026-09-02 operatör kararı o dayanağı kaldırdı ve üçü bu turda ücretli koşuldu | Ders 16 sınıfı: kapanmış bir kalemin gerekçesi indekste duruyor | |
| 7 | **Kart planlı, sevk edilmemiş + `structuredContent` YOK** | **6/6** — altı tool'un altısı (RK-7, DK-7 adıyla; diğer dördü §6'larda) | `card-map.ts` eşlemeleri VAR (`:18`, `:19`, `:21`, `:22`, `:25`, `:27`); `CARDED_TOOLS` yalnız `get_credit_balance` | Dilim 2 ve 3 sınıf 8 — **ÜÇÜNCÜ tekrar**; kart dilimine ertelenmiş durumda | |
| 8 | **Basılan değer ile SINANAN değer farklı** | `ranked_keywords` B-2 (flat-zero notu) · B-5 (yuvarlama söylenmiyor) · `research_keywords` RK-2 · `discover_keywords` DK-2 | `thousands()` = `Math.round` (basılan) ↔ `flatZeroNote` `=== 0` (sınanan); `format/flat-zero.ts` iki tool tarafından paylaşılıyor | Yeni — **sınıf 3'ün altındaki mekanizma**: yuvarlama hem gizleniyor hem yanlış dala sokuyor | |
| 9 | **`dfs_spend.actual_usd` ÖLÇÜLEN ile TAHMİNİ ayırmıyor** | `ranked_keywords` RK-6 karşılığı · `research_keywords` RK-6 · `discover_keywords` DK-5 | `extractResponseCostUsd(raw) ?? estimate` ikisini aynı kolona yazıyor; `0014_dfs_spend_budget.sql:28-37`'de kaynak kolonu yok | Ders 9: operatörün günlük harcama okuması ölçülmüş ile varsayılmışı ayırt edemiyor | |
| 10 | **Referans "Tool eşleme" satırı YAPISAL OLARAK ihlal edilemez kurala işaret ediyor** | `my_pages` ↔ R-7.1/R-7.2/R-7.6/R-7.8 (tool GSC'ye hiç dokunmuyor) · `keyword_gap` ↔ R-8.8 (G-5: intent yüzeyi yok) | Referans, tool'un satıcısını VARSAYMIŞ; ölçüm iki satırı da yanlışladı | Dilim 3'ün `track_keywords`/`connect_gsc` şerhleri — **ikinci tekrar** | |

`akıbet` sütunu bu ölçüm turunda **BOŞ bırakılmıştır** — kapanış turu doldurur (PR / karar / imza).
Dilim 3'ün aynı sütunu kapanışta doldurulmuştu; biçim `_DILIM3-HAKEM-SINIFLAR.md`'dekiyle aynıdır.

## Nasıl okunmalı

- **Sınıf 1 ve 2 para/izolasyon yolunun kapısı hakkında ve ikisi de "4016 test yeşil" cümlesinin
  neyi SÖYLEMEDİĞİNİ ölçüyor.** Sınıf 2 özellikle önemlidir: Dilim 3'te "KAPANDI" yazılmıştı, bu
  turda **başka bir pozisyonda** yeniden açıldı. Bir kapının bir tool'da doğru çalışması, komşusunda
  doğru çalıştığının kanıtı değildir — aynı mutasyon iki tool'da iki farklı sonuç verdi (M3 vs M8).
- **Sınıf 3, 6 ve 10 kopya kalemleridir** — kod değil cümle. Üçü de ucuz, üçü de birden çok kayda
  dokunuyor, ve üçünde de tool başına kapatma **sonuncuyu unutturur**.
- **Sınıf 3'ün şiddet bandı bu turda tekleştirildi (H-1).** Aynı kalem dört kayıtta üç farklı
  şiddetle yazılmıştı. Bant: **çıplak açıklama boşluğu (bare disclosure) P2 · ölçülmüş iddia hatası
  P1.** Uygulaması: RK-1 P1→P2 · G-1 P1→P2 · B-3 P2 (çapa) · RK-2 ve DK-2 **P1 KALDI** (biri
  yuvarlanmışları toplayıp yeni bir "total" basıyor, öbürü ölçülmüş bir sıralama iddiası satıyor).
- **Sınıf 4 bu dilimin en pahalı kusuru ve dört üyesinin biri hiç ölçülmedi.** Üç ölçülmüş üyenin
  toplam ölçülen zararı 2 × 40 kredi (`my_pages`); azaltıcı ağaçta tek bir tool'da duruyor. Sınıf
  bugün kesilmezse aynı bulgu önümüzdeki dilimlerde iki kez daha açılır.
- **Sınıf 5 Dilim 3'ten devralındı ve devralınan iddianın YARISI yanlış çıktı** — `serp_snapshot`
  sıralayan URL'i basıyor, boşluk yalnız `keyword_positions`'ta. Devralınan bir kalem, devralındığı
  gibi kabul edilmez; yeniden ölçülür (bu kayıt onu yaptı).
- **Sınıf 8, sınıf 3'ün altındaki mekanizmadır:** aynı yuvarlama hem okura söylenmiyor (sınıf 3) hem
  de ürünün kendi uyarı dalını sessizce atlatıyor (`ranked_keywords` B-2). İki sınıfın düzeltmesi
  birlikte tasarlanmalı.

## Kapsam — bu tablonun ÖLÇMEDİĞİ

- Tablo **dilim 4'ün altı kaydından** çıkarıldı. Sınıfların henüz ölçülmemiş tool'ları (dilim 5
  backlink ailesi, dilim 6 rapor + AI ailesi) kapsayıp kapsamadığı **ölçülmedi**; yalnız sınıf 1, 2,
  5, 7 ve 10 için önceki dilimlerde adıyla karşılık olduğu biliniyor.
- **Hakem canlıyı bağımsız olarak yeniden elde edemedi** (seogrep MCP 404; ücretsiz tool'lar için
  transport yolu iş emrinde vardı ama kullanılmadı). §3/§4 iddiaları yalnız işçilerin ham
  `jsonl`'i üzerinden doğrulandı — canlı yüzeyin ikinci bağımsız okuması YOK.
- **`*.db.test.ts` şeritleri hiçbir tarafça koşulmadı.** Sınıf 1'in tek koruması `my-pages.db.test.ts
  (h)` ve o şeridin gerçekten kırmızı verdiği **kanıtlanmadı** — ne işçi ne hakem koştu.
- **Ölçülemeyen dallar:** `my_pages` A-3'ün teşhisi (sunucu log'u `457d2b7d` okunmadı) · `serp_snapshot`
  S-6 (kısmi başarısızlıkta tam ücret) · `discover_keywords` DK-3 (geçersiz locale'de açık rezervasyon
  — kardeş vakası `my_pages`'te prod'da doğrulandı, kendi yolu değil) · `my_pages` A-6 (satıcı-yanı
  kesilme) · `discover_keywords` `suggestions`/`related`/`for_site` · `ranked_keywords`'ün `.com`
  karşı-ölçümü · Dilim 1'den devreden `queued`/`running` dalları.
- **Sınıfların hiçbiri bir kapıya bağlı değil:** bu dosya prose'dur. Bir sınıfın gerçekten kapandığı,
  ancak `goals/` predicate'i ya da `verify.sh` adımı eklendiğinde ölçülebilir olur. Akıbet sütunu
  dolduğunda da bu geçerlidir: "KAPANDI" satırı, adlandırdığı bulguların kapandığını söyler — o
  sınıfı ölçen bir predicate olduğunu DEĞİL.
- Sıklık sayıları **bulgu sayısıdır, müşteri etkisi değil.**

## Canlı / bütçe — bu dilimde ne harcandı

Şef defter çapraz kontrolü (`list_credit_activity`, tüm hesap, 2026-09-03 19:30–19:42 UTC):
`find_quick_wins` 10 · `research_keywords` 25×2 · `discover_keywords` 40×2 · `ranked_keywords` 65×2 ·
`my_pages` 40×2 (+ 40/−40 charge+refund çifti, net 0) · `serp_snapshot` 21×2 · `keyword_positions` 10 ·
`keyword_gap` 45×2 = **492 kredi**. Üç işçinin toplamı **482** + şefin Dilim 3 canlı turu **10** = 492 —
**tuttu**. Bakiye `get_credit_balance` ile **4152 → 3660**.

Vendor tarafı: bugünkü DFS harcaması **$0,2459** (12 settled istek ≈ $0,21 + Lighthouse $0,005 +
`relevant_pages` açık rezervasyonu $0,036), günlük $3 tavanının **%8'i**. Tahmin/gerçek oranı üç
tool'da ölçüldü — `serp` 0,12 → 0,056 · `relevant_pages` 0,0765 → 0,0242 · `ranked` 0,0558 → 0,0247 —
yani 1,5× güvenlik marjı pratikte **2–3×** fazla ayırıyor. **BİLGİ kalemidir; NEVER #6'ya dokunmaz**
(hiçbir kredi fiyatı, marj ya da paket rakamı değişmedi).

Anahtar sızıntısı: `sg_` deseni ham `jsonl`'lerde **0**, altı `.md` kaydında **0** (hakem ölçtü).

## İmza kalemleri (operatörde — kod yazılmaz)

Hakemin §4'ü dokuz kalem saydı; **H-5 şef tarafından cevaplandı ve kapandı**, geriye **8** kalır:

| # | kalem | kayıt | neden imza |
|---|---|---|---|
| 1 | `ideas` varsayılan hacim tavanı 100.000 (TR pazarında tek satır düşürmedi) | `discover_keywords` DK-1 | Ürün kararı; üç şık var (tavanı indir · tavanı bırakıp uyarıyı sertleştir · kaynak gerekçesini ölçümle değiştir). H-4 sonrası iddia daraltıldı: yalanlanan yalnız "ulusal-kamu sınıfının altında" şartı |
| 2 | `item_types` enum daraltma | `my_pages` A-3 | **Önce TEŞHİS, sonra imza** — şemanın reklam ettiği bir değeri kaldırmak müşteri yüzeyini daraltır; hata satıcıdan mı ayrıştırıcıdan mı geldiği ölçülmedi |
| 3 | `my_pages` ADI | `my_pages` A-7 | Ad değişikliği müşteri yüzeyini kırar; ucuz alternatif docs'a bir yönlendirme satırı |
| 4 | `costs.ts:60` gerekçe bloğu | `ranked_keywords` B-4 | **Rakam DEĞİŞMEZ** (NEVER #6) — yalnız ölçülmüş vendor maliyeti ve marj bandı yazılır |
| 5 | Kısmi başarısızlıkta fiyat politikası | `serp_snapshot` S-6 | **Önce birim testiyle ÖLÇ** — 2 kelimenin 1'i `not_measured` dönerse tam ücret alınıyor gibi görünüyor, ama ölçülmedi |
| 6 | Prod'daki bayat `Turkey` serisi temizliği (dentnotion) | `serp_snapshot` S-3 | Veri kararı; yazan taraf kapandı, okuma tarafı operatörde |
| 7 | Referans listesi düzeltmeleri (`my_pages` R-7.x · `keyword_gap` R-8.8) | `my_pages` §5 · `keyword_gap` G-5 | Metin yetkisi. Şerhler bu turda **önceki turun emsaline uyularak** yazıldı (satır silinmedi, yalnız "Ölçüldü 2026-09-03" şerhi eklendi) |
| 8 | R-8.9 tek şiddet bandı | H-1, sınıf 3 | Bandın kendisi bu dosyada yazılı; **imza, düzeltmenin tek paylaşılan sabitte yapılmasına** dairdir — dört mdx'e kopyalanırsa aynı rakam dört farklı dürüstlükle basılır |

**Kapanan kalem — H-5:** `serp_snapshot` §4'teki 10 kredilik `keyword_positions` çağrısı, gap işçisinin
iş emrinde adıyla yetkilendirilmişti (*"10 kredi, TAVANA DAHİL DEĞİL — şefin Dilim 3 F-10 kapanış
yarısı; yalnız ranked üretilmişse"*) ve şart tutmuştu. **Bulgu değildir**, kayıtta yetki şerhi olarak
durur (ders 16: kapanmış bir kalem indekste açık bırakılmaz).
