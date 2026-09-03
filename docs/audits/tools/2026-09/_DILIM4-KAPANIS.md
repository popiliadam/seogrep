# Dilim 4 kapanışı — 6 tool, 39 bulgu (anahtar kelime ailesi)

> Tarih: 2026-09-04 · Tur: tool kontrol turu 2026-09 · Kayıtlar: bu dizindeki `research_keywords.md`,
> `discover_keywords.md`, `ranked_keywords.md`, `my_pages.md`, `keyword_gap.md`, `serp_snapshot.md`
> Kural (CLAUDE.md ders 16): bir kalem kapandığında **kapatan tur** kaydı da günceller. Bu dosya
> indekstir; her satırın ayrıntısı kendi kaydındaki `durum (kapanış, 2026-09-04)` sütunundadır.
> Her hücre ya bir PR numarasıyla ya da `AÇIK / ERTELENDİ / İMZA KALEMİ / ÇÜRÜTÜLDÜ — neden` ile biter.
> Ölçüm PR'ı: **#220** (`1d6c069`). Kapatan PR'lar, merge sırasıyla: **#222** paket A (`5cbec9b`) ·
> **#221** paket C (`1c8a854`) · **#223** paket B (`8cc06dd`) · **#224** paket D (`5a8252f`).
> Dördünün de CI'ı **`verify-db` DAHİL yeşil geçti** (şef CI'da okudu) — yani paket C'nin
> `serp-snapshot.db.test.ts (h)` / `keyword-positions.db.test.ts (i)` pinleri, paket D'nin
> `budget.db.test.ts` pini ve paket A'nın mevcut `my-pages.db.test.ts (d)/(h)` pinleri **koşuldu**.
> Taban: `main` `5a8252f`.

## Sayılar

| | adet |
|---|---|
| Bulgu (6 kayıt toplamı) | **39** (7 + 7 + 5 + 8 + 5 + 7) |
| P0 | 0 |
| P1 | **9** — ölçüm turunda 11 yazılmıştı; hakem bandı H-1 ikisini (RK-1, G-1) P2'ye çekti. **6'sı KAPANDI** (RK-2, B-1, A-1, A-2, S-1, S-2), 2'si KISMEN (DK-2, A-3), 1'i İMZA (DK-1) |
| KAPANDI | **18** |
| KISMEN | **4** (DK-2 · A-3 · G-5 · S-3) |
| AÇIK | **9** — 8'i `PR'da karşılığı bulunamadı`, 1'i `canlıda ölçülemedi` (A-6) |
| ERTELENDİ | **4** (RK-6 · DK-5 → Dilim 5/6 · RK-7 · DK-7 → kart dilimi) |
| İMZA KALEMİ | **3** (DK-1 · B-4 · A-7) — ayrıca KISMEN'lerin yarıları: DK-2 sıralama · A-3 enum · G-5 şerh · S-3 prod serisi |
| ÇÜRÜTÜLDÜ | **1** (A-8) |

`canlı ✔` işaretli bulgu sayısı: **5** — RK-1, RK-2 (`research_keywords`), A-2 (`my_pages`),
S-1 ve S-5 (`serp_snapshot` + `keyword_positions`). Hepsi deploy **`8cc06dd`** (A+C+B), şef turu
2026-09-03 21:17–21:18 UTC, Δ −128 kredi, özne adstark.com.tr. **Paket D'nin (`5a8252f`) canlı
yarısı YOKTUR ve olamaz** — kapattığı şey bir vendor hata yoludur, canlıda üretilemez.

## Tool tablosu

| tool | karar (kapanış) | kapatan PR'lar | canlı doğrulama | açık kalemler |
|---|---|---|---|---|
| `research_keywords` | **KAPANDI** — 2 bulgu kapandı | #223 (RK-1, RK-2) | **✔ ikisi de** (`8cc06dd`): hacim şerhi + `≈260 total monthly searches (approximate — a sum of rounded figures)` | RK-3 · RK-4 · RK-5 **AÇIK** (üçü de iş emrine girmedi) · RK-6 → Dilim 5/6 · RK-7 → kart |
| `discover_keywords` | **DÜZELTME GEREKLİ** — 2 bulgu + 1 yarı kapandı | #223 (DK-2 şerh yarısı, DK-4) · #224 (DK-3) | **✔ dolaylı**: `for_site` ürün tarihinde ilk kez canlıda koştu ve lokal uyarısı basıldı; DK-1 tavanı İKİNCİ kez işlevsiz ölçüldü | **DK-1 İMZA** · DK-2 sıralama yarısı **İMZA** · DK-6 AÇIK · DK-5 → Dilim 5/6 · DK-7 → kart |
| `ranked_keywords` | **KAPANDI** — 4 bulgu kapandı (tek P1 dahil) | #222 (B-1) · #223 (B-2, B-3, B-5) | **YOK — tool canlıda hiç koşulmadı** (65 kredi); dört düzeltme de birim-testi iddiasıdır | **B-4 İMZA** (`costs.ts` gerekçe bloğu) · B-1'in `goals/` hedefi yok |
| `my_pages` | **KISMEN DÜZELTİLDİ** — 3 bulgu kapandı, 1 yarım, 1 çürütüldü | #222 (A-1, A-3'ün rezervasyon yarısı, A-8 pini) · #223 (A-2, A-5) · #224 (A-3 aile) | **✔ A-2** (`8cc06dd`, adstark 40 kredi): `.tr` domain + DEFAULT locale uyarısı birebir | A-3 enum/metin **İMZA** · **A-7 İMZA** · A-4 **AÇIK** · A-6 **canlıda hâlâ ölçülemedi** · A-1'in `goals/` hedefi yok |
| `keyword_gap` | **KISMEN DÜZELTİLDİ** — 3 bulgu + 1 şerh kapandı | #223 (G-1, G-3, G-4) · #220 (G-5 şerhi) | **YOK — tool canlıda koşulmadı** (45 kredi); sınıf 3 ve 4 sabitleri kardeş yüzeylerde ✔ | G-2 **AÇIK** · G-5'in "şerh mi kalıcı düzeltme mi" yarısı **İMZA** |
| `serp_snapshot` | **KAPANDI** — 3 bulgu kapandı (iki P1 dahil) + F-5 devri tam kapandı | #221 (S-1, S-2, S-5) · #223 (S-7) | **✔ S-1 ve S-5** (`8cc06dd`, 13+10 kredi): SERP özellik satırı, `AI Overview PRESENT`, fan-out paragrafı, `ranked URL` | S-3 okuma yarısı **İMZA** · S-4 **AÇIK** · S-6 **AÇIK + İMZA** |

**PR'da karşılığı BULUNAMAYAN bulgular** (dört PR'ın gövdesi ve `gh pr diff` çıktısı tek tek arandı;
"düzeltilmedi" demek değil, **iş emrine hiç girmedi** demektir):

| bulgu | ölçüm |
|---|---|
| `research_keywords` RK-3 (vendor'ın 12 aylık serisi düşürülüyor) | `monthly_searches` dört diff'te **0 eşleşme** |
| `research_keywords` RK-4 (aynı set saniyeler içinde tekrar sorulunca tam ücret, uyarı yok) | `keyword_research_runs` ve `looked this exact` **0 eşleşme** — yazılan kayıt hâlâ okunmuyor |
| `research_keywords` RK-5 (mdx run kaydını/Lookups sayfasını anmıyor) | #223 `research-keywords.mdx`'e YALNIZ hacim şerhini ekledi; `Lookups` **0 eşleşme** |
| `discover_keywords` DK-6 (`ideas` ↔ `suggestions` mod ayrımı LLM'e bırakılmış) | yönlendirme cümlesi (`prefer suggestions` benzeri) dört diff'te **yok** |
| `my_pages` A-4 (tekil/çoğul: `1 pages`, `1 page … also appear`) | `renderWindowCaption` / `renderMatchCount` dalı dört diff'te **yok**; `format/quantities.ts` yalnız `MODEL_PRECISION_CLAUSE` taşıyor. Kardeşi `find_quick_wins` B-6 de açık |
| `keyword_gap` G-2 (kesilme cümlesi `limit`'i adlandırmıyor) | `renderGapHeader` `limit`'i hâlâ okumuyor; `ask for more with` **0 eşleşme** |
| `serp_snapshot` S-4 (`dfs/serp.ts:165-176` "NOT MEASURED / omitted-key" yorumu bayat) | dört PR'ın hiçbiri o bloğa dokunmadı. F-10'un KENDİSİ canlıda ikinci kez doğrulandı |
| `serp_snapshot` S-6 (kısmi başarısızlıkta tam ücret) | kısmi başarısızlığın FİYATINI sınayan test dört diff'te **yok** — hakem "önce birim testiyle ÖLÇ" demişti, ölçüm yapılmadı |
| altı kaydın `goals/` hedefleri (B-1 ücret kapsamı · A-1 kiracı zinciri) | **dört PR'ın hiçbiri `goals/` altına dosya eklemedi** — ölçüldü (`grep -l "^+++ b/goals/"` → boş). Dördüncü dilimde de aynı |

## On sınıfın akıbeti

Ayrıntı: `_DILIM4-HAKEM-SINIFLAR.md`'nin artık dolu **akıbet** sütunu.

| # | sınıf | akıbet |
|---|---|---|
| 1 | NEVER#4 kiracı filtresi pinsiz | **KAPANDI #222** — iki zincir pini (`crawl_pages` + `jobs` portu); `goals/` hedefi hâlâ YOK |
| 2 | Ücret kapsamı süpürgesi yanlış nesneyi okuyor | **KAPANDI #222** — dengeli tarama + maskeli anahtar + öz-test; ders 14 ikinci kez ödedi |
| 3 | R-8.9 hacim şerhi hiçbir yüzeyde yok | **KAPANDI #223 + canlı ✔** — TEK paylaşılan sabit, dört mdx'e kopyalanmadı |
| 4 | Ücretli çağrı ABD/İngilizce varsayılanını sessizce uyguluyor | **KAPANDI #223 + canlı ✔** — `twoLetterTld` taşındı; ölçülmemiş dördüncü üye (`for_site`) canlıda koştu |
| 5 | Parası ödenen veri hiçbir yüzeyden okunamıyor | **KAPANDI #221 + canlı ✔** — Dilim 3 sınıf 6 / F-5'in TAM kapanışı; web Rankings sayfası ayrı dilim |
| 6 | `plan.mjs` EXCLUDED gerekçesi bayat | **KAPANDI #223 — ama PROSE**; sweep self-test bayat gerekçeyi ölçmez |
| 7 | Kart + `structuredContent` yok (6/6) | **ERTELENDİ → kart dilimi** — ÜÇÜNCÜ tekrar |
| 8 | Basılan değer ile sınanan değer farklı | **KAPANDI #223** — `printedAs` zorunlu; sınıf 3 ile birlikte tasarlandı |
| 9 | `dfs_spend.actual_usd` ölçüleni tahminden ayırmıyor | **ERTELENDİ → Dilim 5/6** — migration ister, prod journal geride |
| 10 | Referans "Tool eşleme" satırı yapısal olarak ihlal edilemez kurala işaret ediyor | **KISMEN — şerhler #220'de; bu tur ÜÇÜNCÜSÜNÜ ekledi (`serp_snapshot` R-8.5); şerh mi düzeltme mi İMZA** |

Sınıf 2 bu turun en öğretici satırıdır: Dilim 3'te "KAPANDI" yazılmıştı ve **doğruydu — o pozisyonda**.
Aynı süpürge komşu tool'da yanlış nesneyi okuyordu ve aynı mutasyon iki tool'da iki farklı sonuç
verdi (M3 yeşil / M8 kırmızı). Ders 14 ("hangi EKSENİ varyantladığın yazılır") ikinci kez ödedi.

## Hakem hükümleri ve sapmaları (dördü PASS — adıyla)

Dört düzeltme paketinin dördü de taze Fable hakemden **PASS** aldı. Sapmalar ve hükümler:

| paket | hakem hükmü / sapma |
|---|---|
| A (#222) | 208 satırlık bir commit **bölünebilirdi** (ayrıştırıcı; başlık prose'u ayrılabilirdi) · **Ş-2 iddiası ÇÜRÜTÜLDÜ** (çağrı çıplak `target` ile yapılmıştı) · A-3 teşhisi bir **ÇIKARIM** (non-20000 task gözlenmedi) · reaper `staleDfsReserves` artık yalnız gerçek çökmeleri sayar · **"$3 tavanı ne gevşedi ne sıkıştı"** — 0014 sayacı `coalesce(actual, estimated)` okuduğu için günlük toplam sente kadar aynı (hakem 0014'ü okuyarak hükmetti) · P3 kalıntı follow-up'ta kapandı |
| B (#223) | **DK-2 KISMEN** — kova notu girdi, deterministik kova-içi sıralama pinli *"SeoGrep does not re-order them"* vaadiyle çelişirdi → İMZA kalemi · iki commit **bölünebilirdi** (ders: iş emrine "tool başına commit") · **sınıf 6 prose-only** — sweep self-test bayat gerekçeyi ölçmez · `for_site` boş cevap pini follow-up `69e99cd`'de kapandı |
| C (#221) | **R-8.5 ayrıştırıcı riski KARŞILIKSIZ** — `item_types: z.array(z.string())`, tanınan tip kümesi yok; risk yalnız GÖSTERİMDEYDİ → referans satırına şerh (aşağıda) · `report` her satırla geliyor: **200 satır × büyük report bayt senaryosu ölçülmedi** · `apps/web` Rankings sayfası `report` okumuyor (ayrı dilim) |
| D (#224) | `serp` mevcut testi `not.toBe(0)` ile açık satırın `null`'unu **geçiriyordu** (ders 12 vakası) → `toBeCloseTo(estimate)` · `dfs/client.ts` başarısızlık yolu **hiç pinsizdi** · follow-up `5c29ad5`: **keyword-gap "exactly once" pini gerçek maliyetle güçlendi — `finally` mutasyonu artık 2 kırmızı** · Dilim 5/6 deliği ADIYLA: `backlink-changes:489 · backlinks:408 · competitors:780 · lighthouse:554 · link-gap:322 · disavow-candidates:849 · backlink-details:583 · llm-mentions:1157+1177` |

## İmza kalemleri (operatörde — kod yazılmaz)

Hakemin 8 kalemi + bu kapanışın 2 yeni kalemi = **10**. Hiçbiri bloke etmiyor.

| # | kalem | kayıt | neden imza |
|---|---|---|---|
| 1 | `ideas` varsayılan 100.000 hacim tavanı | `discover_keywords` DK-1 | Ürün kararı, üç şık. **Bu turda İKİNCİ kez ölçüldü ve yine işlevsiz çıktı** — tr/2792 `ideas` (100/100 konu dışı) ve en/2840 `for_site` (20/20 konu dışı, hepsi 90.500) |
| 2 | `item_types` enum daraltma + "failed unexpectedly" metni | `my_pages` A-3 | Şemanın reklam ettiği değeri kaldırmak müşteri yüzeyini daraltır; teşhis ÇIKARIM |
| 3 | `my_pages` ADI | `my_pages` A-7 | Ad değişikliği müşteri yüzeyini kırar |
| 4 | `costs.ts:60` gerekçe bloğu | `ranked_keywords` B-4 | **Rakam DEĞİŞMEZ** (NEVER#6); dört PR'ın `costs.ts` diff'i boş — ölçüldü |
| 5 | Kısmi başarısızlıkta fiyat politikası | `serp_snapshot` S-6 | Önce birim testiyle ÖLÇ — bu turda da ölçülmedi |
| 6 | Prod'daki bayat `Turkey` serisi (dentnotion) | `serp_snapshot` S-3 | Veri kararı; yazan taraf kapalı |
| 7 | Referans listesi şerhleri (`my_pages` R-7.x · `keyword_gap` R-8.8 · **YENİ: `serp_snapshot` R-8.5**) | §5'ler, G-5 | Metin yetkisi: şerh mi kalıcı düzeltme mi |
| 8 | R-8.9 tek şiddet bandı | H-1, sınıf 3 | Uygulandı — bare disclosure P2, ölçülmüş iddia hatası P1; düzeltme tek paylaşılan sabitte yapıldı |
| 9 | **YENİ — `discover_keywords` deterministik kova-içi sıralama** | DK-2 ikinci yarı | İkincil sıralama, pinli *"SeoGrep does not re-order them"* vaadiyle çelişir: ya vaat değişir ya sıra |
| 10 | Rakip domain | tur geneli | `keyword_gap`/`link_gap`/`compare_competitors` için hâlâ operatörde |

## Operatör kuyruğu (kod değil, ortam/karar)

| kalem | kaynak | not |
|---|---|---|
| **Paket D (`5a8252f`) deploy'u** | bu dosya | Deploy koşuyordu; D'nin canlı doğrulaması **yapılamaz** (vendor hata yolu üretilemez), yalnız regresyon gözlenir |
| Prod'daki **açık `relevant_pages` rezervasyonu** (2026-09-03 19:31, `estimated 0.036`) | `my_pages` A-3 | Yeni kod ESKİ satırı kapatmaz; reaper sayar. Kapanmadıkça günlük $3 tavanından tahminiyle pay yer |
| M-08 prod migration journal (0022–0033) | Dilim 3'ten devir | Sınıf 9 (`dfs_spend` kaynak kolonu) bunun arkasında |
| Yukarıdaki 10 imza kalemi | imza tablosu | Beşi para/ürün ekseninde |

## Dilim 5'e devredenler

| kalem | kaynak | neden bu dilimde kapanmadı |
|---|---|---|
| **DK-3 sınıfı sekiz portta AÇIK, ADIYLA** — `backlink-changes:489 · backlinks:408 · competitors:780 · lighthouse:554 · link-gap:322 · disavow-candidates:849 · backlink-details:583 · llm-mentions:1157+1177` | #224 "Ölçülmeyen" | Paket D anahtar kelime ailesinin beş portunu kapattı; sekizi backlink + AI ailesinde ve o dilimlerde ölçülecek. "leaves the reservation open" yorumları hâlâ duruyor |
| Sınıf 9 — `dfs_spend.actual_usd` kaynak kolonu | RK-6 · DK-5 | Migration ister; prod journal geride (M-08) |
| Sınıf 7 — kart + `structuredContent` (6/6) | altı kaydın altısı | Plan gereği ayrı dilim; ÜÇÜNCÜ tekrar |
| Sınıf 7 (Dilim 3) — core update takvimi eşli tool'lar: `compare_competitors` · `backlink_changes` · `generate_report` · `whats_next` | `_DILIM3-KAPANIS.md` | Dilim 5/6'da ölçülecek; takvim VERİ olarak zaten var |
| `goals/` hedefleri: ücret adı/kapsamı (B-1) · kiracı zinciri (A-1) | iki kaydın §7'leri | Dördüncü dilimde de hiçbir PR `goals/` altına dosya eklemedi |
| RK-3 · RK-4 · RK-5 · DK-6 · A-4 · G-2 · S-4 · S-6 | ölçüm turu | **iş emrine hiç girmedi** — 8 AÇIK kalemin tamamı bu |
| A-6 (`my_pages` satıcı-yanı kesilme) | `my_pages` A-6 | Canlıda ölçülemedi; A-2 düzeltildiği için doğru lokalde çok satır dönerse tek çağrı ile kapanabilir |

## Kapıların ÖLÇMEDİĞİ — bu kapanışın sınırları

Ders 7: yeşil kapı NE ölçtüğüyle raporlanır. Aşağıdakiler bu turda **ölçülmedi** ve hiçbiri "geçti"
diye sayılmamıştır.

1. **Paket D (#224) canlıda hiç görülmedi ve GÖRÜLEMEZ.** Kapattığı şey vendor hata yoludur:
   canlıda üretmek için satıcının reddedeceği bir çağrıyı KASTEN yapmak gerekir. Bu dosyadaki her
   `KAPANDI #224` satırı bir **birim-testi + gerçek-SQL şeridi** iddiasıdır. `budget.db.test.ts`
   pini işçi tarafından KOŞULMADI (Docker); CI `verify-db`'de koşuldu ve yeşil geçti.
2. **`ranked_keywords` ve `keyword_gap` canlıda hiç koşulmadı** (65 + 45 kredi). Yedi `KAPANDI`
   satırı bu iki kayıtta birim testine ve paylaşılan sabitin BAŞKA bir tool yüzeyindeki canlı
   kanıtına dayanıyor. Sabitin deploy edildiği ölçüldü; o tool'un kendi çıktısında basıldığı
   ölçülmedi.
3. **Hakem canlıyı bağımsız olarak yeniden elde edemedi** (seogrep MCP 404). §3/§4 iddiaları
   işçilerin ham `jsonl`'i ve şefin kendi turu üzerinden doğrulandı — üçüncü bir bağımsız okuma yok.
4. **`goals/` hiç genişlemedi — dördüncü dilim üst üste.** Bu turda kapanan hiçbir sınıf
   `make goals` tarafından ölçülmüyor; hepsi paket testinde duruyor. Sınıf 1 ve 2 için bunun
   bedeli ölçülüdür: ikisi de bugün sessizce geri alınabilir ve `make goals` yeşil kalır.
5. **`verify.sh` secret taraması ve DB şeritlerini koşmaz** (CLAUDE.md kapı kapsam tablosu).
   `gitleaks` yalnız CI job'ında ve `make goals`'ta; DB şeritleri yalnız `make verify-db`/CI'da.
6. **Sınıf tablosunun akıbet sütunu prose'dur.** Bir sınıfın "KAPANDI" satırı, adlandırdığı
   bulguların kapandığını söyler — o sınıfı ölçen bir predicate olduğunu DEĞİL.
7. **`plan.mjs` gerekçeleri (sınıf 6) hiçbir kapı tarafından ölçülmüyor.** `tool-sweep.mjs
   --self-test` yalnız 38 tool'un PLAN ya da EXCLUDED'da olduğunu ölçer; gerekçenin bugün doğru
   olup olmadığını değil. Aynı bayatlama bir yıl sonra sessizce geri gelir.
8. **`report` bayt ekseni ölçülmedi:** #221 `keyword_positions`'ın `COLUMNS`'una `report` ekledi ve
   o okumada bayt tavanı YOK; 200 satır × büyük report senaryosu hiçbir yerde ölçülmedi (hakem C'nin
   şerhi).
9. **A-3'ün teşhisi bir çıkarımdır.** Sunucu log'u `457d2b7d` bu turda da okunmadı; hatanın
   satıcıdan mı ayrıştırıcıdan mı geldiği hâlâ ölçülmemiştir. Rezervasyon yarısı kapandı, teşhis
   kapanmadı.

## Canlı doğrulama eki (şef, 2026-09-03 21:17–21:18 UTC, deploy `8cc06dd`, Δ −128, adstark.com.tr)

Defter (`list_credit_activity`, proje filtreli): `-13 serp_snapshot · -10 keyword_positions ·
-40 my_pages · -40 discover_keywords`, hepsi `project: adstark.com.tr`; `research_keywords` −25
kapsamsız (proje almaz — #215'in bilinçli null kararı). Refund yok. Vendor tarafı ≈ $0,10.

- **`serp_snapshot`** ("dijital reklam yönetimi", Turkiye/tr/desktop): `SERP features besides
  organic: 2 — ai_overview, people_also_ask. AI Overview PRESENT (ai_overview).` ve fan-out
  paragrafı — **S-1 ve S-5 ✔**; `not found among the 99 organic result(s) examined` → F-10 ikinci
  kez ✔, 0 timeout.
- **`keyword_positions`**: `rank_group #1 (rank_absolute 1), of 77 organic result(s) examined.
  ranked URL https://adstark.com.tr/ · SERP features besides organic: 3 — ai_overview,
  related_searches, images.` ve mobil seride `No AI Overview reported on this page.` —
  **Dilim 3 F-5'in TAM kapanışı canlıda**; 5 okuma / 4 seri, hepsi `Turkiye` (F-8 yeni satır açmadı).
- **`research_keywords`** (2 kelime, tr/2792): `≈260 total monthly searches (approximate — a sum of
  rounded figures)` + hacim şerhinin tamamı — **RK-2 ve RK-1 ✔**.
- **`my_pages`** (adstark, varsayılan lokal): `This lookup used the DEFAULT locale — the United
  States, in English — but adstark.com.tr is a .tr domain …` — **A-2 ✔**; `Both are shown to the
  nearest whole visit and whole dollar` (B-5'in paylaşılan sabiti) ✔; yine **1 satır** döndü →
  **A-6 bir kez daha ölçülemedi**.
- **`discover_keywords`** (`for_site`, limit 20, varsayılan lokal): aynı uyarı basıldı — **sınıf 4'ün
  ölçülmemiş dördüncü üyesi ürün tarihinde ilk kez canlıda**; 20/20 satır konu dışı ve hepsi 90.500
  → **DK-1 için ikinci ölçüm**.
- **Ölçülmeyen bu turda:** `ranked_keywords` flat-zero notu (65) · `keyword_gap` (45) · paket D'nin
  hata yolu · prod'daki eski açık `relevant_pages` rezervasyonu (19:31) hâlâ `open`.

## Kredi

Dilim 4 toplamı **620 kredi** = ölçüm turu 482 + şefin Dilim 3 `find_quick_wins` eki 10 + kapanış
canlı turu 128. Bakiye **4152 → 3532**, defterle birebir. **Hiçbir kredi fiyatı, marj ya da paket
rakamı değişmedi** (NEVER#6; dört PR'ın `credits/costs.ts` diff'i BOŞ — ölçüldü).
