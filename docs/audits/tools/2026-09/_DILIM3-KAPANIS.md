# Dilim 3 kapanışı — 5 tool, 35 bulgu

> Tarih: 2026-09-03 · Tur: tool kontrol turu 2026-09 · Kayıtlar: bu dizindeki `pull_gsc_data.md`,
> `find_quick_wins.md`, `detect_cannibalization.md`, `analyze_content_decay.md`, `keyword_positions.md`
> Kural (CLAUDE.md ders 16): bir kalem kapandığında **kapatan tur** kaydı da günceller. Bu dosya
> indekstir; her satırın ayrıntısı kendi kaydındaki `durum (kapanış, 2026-09-03)` sütunundadır.
> Her kalem ya bir PR numarasıyla ya da `AÇIK / ERTELENDİ / İMZA KALEMİ — neden` ile biter.
> Kapatan PR'lar: **#215** (`fix/ledger-scope-d3`, main'de) · **#216** (`fix/positions-d3`, main'de) ·
> **#217** (`fix/gsc-d3`) `bbc259d` ile **main'de** (2026-09-03; db şeridi 117cb00 ile lokalde VERIFY-DB PASS, CI verify-db yeşil). Taban: `main` `aa52154` (#215 + #216 merge edilmiş).

## Sayılar

| | adet |
|---|---|
| Bulgu (5 kayıt toplamı) | **35** (`find_quick_wins`'in üstü çizili özgün B-1'i sayılmadı; hakemin H-1'i sayıldı) |
| P0 | 0 |
| P1 | 9 (+ H-1 "P1 adayı") — **8'i kapandı**, 1'i (F-5) ertelendi; H-1 kapandı |
| KAPANDI | **15** |
| KISMEN KAPANDI | 3 (`find_quick_wins` B-5 · `detect_cannibalization` B-5 · `analyze_content_decay` B-5 — üçünün de yalnız noktalama yarısı) |
| AÇIK | **14** |
| ERTELENDİ | 1 (`keyword_positions` F-5 → Dilim 4) |
| İMZA KALEMİ | 2 (`keyword_positions` F-7 · `find_quick_wins` B-1b) |

`canlı ✔` işaretli bulgu sayısı: **2**, ikisi de `keyword_positions` (#215/#216 deploy `aa52154`, şef turu,
Δ −10). **#217'nin canlı yarısı hiç ölçülmedi** — PR henüz merge edilmedi.

## Tool tablosu

| tool | karar (kapanış) | kapatan PR'lar | canlı doğrulama | açık kalemler |
|---|---|---|---|---|
| `keyword_positions` | **DÜZELTİLDİ** — 6 bulgu kapandı | #216 (F-1, F-2, F-3, F-4, H-1'in kendi çağrı yeri) · #215 (H-1'in aile yarısı) · F-9 kod gerektirmedi | **✔ iki bulgu** — defter satırı `project: dentnotion.com` (H-1), adstark'ta ön koşul reddi `serp_snapshot`'ı doğru sırayla adlandırıyor (F-3) | F-5 → **Dilim 4** · F-7 **İMZA** · F-6 · F-8 · F-10 · F-11 AÇIK |
| `pull_gsc_data` | **KISMEN DÜZELTİLDİ** — 3 bulgu kapandı | #217 (B-2, B-5, B-7) | **bekliyor** — sayfalamanın gerçek GSC'de 25.000'lik sayfa döndürdüğü ve bayt bütçesinin dentnotion'da nerede bağladığı deploy sonrası | B-1 · B-3 · B-4 · B-6 AÇIK · B-2'nin **12 MB zarf kalıntısı** AÇIK (P2) · B-5'in `goals/` hedefi AÇIK |
| `find_quick_wins` | **KISMEN DÜZELTİLDİ** — 3 bulgu + 1 yarı kapandı | #217 (B-1a, B-2, B-4, B-5'in noktalama yarısı) | **bekliyor** | B-1b **İMZA** (sıralama politikası) · B-3 AÇIK · B-5'in `days` yarısı AÇIK |
| `detect_cannibalization` | **KISMEN DÜZELTİLDİ** — en zararlı vaka kapandı, **sınıf kapanmadı** | #217 (B-1'in kök URL ekseni, B-5'in noktalama yarısı) | **bekliyor** | **hub/liste ekseni AÇIK** · B-2 · B-3 · B-4 AÇIK · B-5'in `limit`/uzunluk yarısı AÇIK · `goals/` hedefi AÇIK |
| `analyze_content_decay` | **DÜZELTİLDİ** — iki P1 de kapandı | #217 (B-1, B-2, B-5'in noktalama yarısı) | **bekliyor** | takvimin **BAKIM yolu AÇIK** · B-3 · B-4 AÇIK · B-5'in eşik yarısı AÇIK |

**PR'da karşılığı BULUNAMAYAN bulgular** (üç PR'ın gövdesi ve diff'i tek tek arandı; "düzeltilmedi"
demek değil, **iş emrine hiç girmedi** demektir):

| bulgu | ölçüm |
|---|---|
| `pull_gsc_data` B-1 (`dataState` mirası) | `dataState` #217 diff'inde **0 eşleşme** |
| `pull_gsc_data` B-3 (R-7.6, tavan ALTINDA uyarı yok) | `describeTruncation` yalnız `capped` pencereleri adlandırıyor; koşulsuz cümle yok |
| `pull_gsc_data` B-4 (429 / kota) | `Retry-After` **0**, `quota` **0** eşleşme; tek `429` eşleşmesi bir dosya hash'i |
| `pull_gsc_data` B-6 (uydurma uuid deftere çift yazıyor) | `charge:"surface"` sıralaması #217'de değişmedi |
| `find_quick_wins` B-3 (üç farklı birimi sayan başlık) | `MAX_QUICK_WINS` **0 eşleşme**; `…more cleared the bands` satırı yalnız bağlam |
| `detect_cannibalization` B-2 · B-3 · B-4 | `brandTokenOf` / `registrableLabel` / `looksLikeSitelinks` **0 eşleşme**; mutlak pozisyon tabanı yok; canonical'ın direktif olmadığı şerhi yok (B-1 paragrafındaki tek değinme hariç) |
| `detect_cannibalization` B-1'in **hub/liste ekseni** | `hub` / `listing page` / `category page` desenleri **ne #217 diff'inde ne main'de** var (PR gövdesi "hub heuristiği zaten vardı" diyor — **doğrulanamadı**) |
| `analyze_content_decay` B-3 · B-4 | `Nothing left:` **0 eşleşme**; `DECAY_MIN_*` sabitleri yalnız bağlam satırı |
| `keyword_positions` F-6 (`plan.mjs` gerekçesi) · F-8 (`Turkey` serisi) · F-11 (`match this filter`) | `scripts/testing/plan.mjs` #216'nın dosya listesinde YOK; `Turkey` 0; `match this filter in total` yalnız bir yorum satırında |
| dört kaydın `goals/` hedefleri (kök-URL · kiracı filtreleri · takvim bayatlığı · CTR ekseni) | **üç PR'ın hiçbiri `goals/` altına dosya eklemedi** — #217 bunu kendi "Ölçülmeyen" bölümünde adıyla yazıyor |

## Dokuz sınıfın akıbeti

Ayrıntı: `_DILIM3-HAKEM-SINIFLAR.md`'nin artık dolu **akıbet** sütunu.

| # | sınıf | akıbet |
|---|---|---|
| 1 | NEVER#4 kiracı filtresi pinsiz | **KISMEN KAPANDI #217 + #216** — üç GSC okuması + `keyword_positions`'ın ikisi pinlendi; **`track_keywords` F-1'in iki konumu ve `goals/` hedefi AÇIK** |
| 2 | Ücretin adı/tutarı + KAPSAMI çağrı yerinde pinsiz | **KAPANDI #215 + #216 + canlı ✔** — 13 çağrı yeri + 2 bilinçli null + bu tool; aile taraması `missing = []`; sayım koşularak **16** çıktı |
| 3 | Precondition reddi yanlış tool'a yönlendiriyor | **KAPANDI #216 (+ canlı ✔) ve #217** — iki kalem; **üçüncüsü (Dilim 1 `get_job_status` B-3) kapsamda değildi** |
| 4 | 15.000 satır tavanı + sayfalamasızlık | **KAPANDI #217** — `startRow` sayfalama + ölçülmüş bayt bütçesi + pencere adıyla kesilme cümlesi; **12 MB zarf kalıntısı (P2) ve canlı doğrulama AÇIK** |
| 5 | "position" üründe iki farklı şey | **KAPANDI #216 + #217** — `AVERAGE_POSITION_NOTE` tek sabit, iki tool paylaşıyor; **`goals/` hedefi yok** |
| 6 | Ödenen veri hiçbir yüzeyden okunamıyor | **ERTELENDİ → Dilim 4 `serp_snapshot`** |
| 7 | Core update takvimi üründe hiç yok | **KAPANDI #217 — yalnız `analyze_content_decay` için**; takvim VERİ olarak geldi. **Takvimin bakımı AÇIK**; eşli dört tool **Dilim 5/6'ya devrediyor** |
| 8 | Kart planlı, sevk edilmemiş (5/5) | **ERTELENDİ → kart dilimi** (plan gereği) |
| 9 | Tek satırlık zod mesajı nokta ile bitmiyor | **KAPANDI #217 — üreticide** (`registry.ts` `terminateOneLine`); `free-refusal.ts` DOKUNULMADI, #210'un kararı yeniden açılmadı. **Reddin yönlendirici olmaması yarısı AÇIK** |

Sınıf 9, dilim 2'de yanlış çerçeveyle ("ayırıcısız birleştirme") yeniden açılmak üzereydi; hakem çerçeveyi
düzeltti ve düzeltme **birleştiricide değil üreticide** yapıldı. Kapanmış bir kararın (dilim 2 → #210)
yeniden açılmaması bu turda **kasıtlı bir kısıt** olarak taşındı ve diff'te doğrulandı.

## İmza kalemleri (operatörde — kod yazılmaz)

| kalem | kayıt | neden imza |
|---|---|---|
| `find_quick_wins` **sıralama politikası** (gösterime göre sıralama, CTR'ı en düşük olanı başa koyuyor) | `find_quick_wins` B-1b | Aynı fiyata satılan çıktının **ne olduğunu** değiştirir. NEVER#6'nın rakam yarısına girmez ama ürün kararıdır. #217 sıralamaya **kasten dokunmadı**; B-1a'nın cümle düzeltmesi seçenek (1)'dir ve geri alınabilir |
| `keyword_positions` ücretsiz kapının `not_measured` hâli | `keyword_positions` F-7 | 10 kredi bugün `count > 0` şartıyla alınıyor; yalnız-`not_measured` bir okumanın ücretsizleşmesi **ücretlendirme davranışını** değiştirir |
| Dilim 2'den devreden beş imza kalemi | `_DILIM2-KAPANIS.md` | üçü tek karara (özdeş denetimin ücreti) iniyor — bu dilimde açılmadı |
| Rakip domain | tur genelinde | operatörde |

## Operatör kuyruğu (kod değil, ortam/karar)

| kalem | kaynak | not |
|---|---|---|
| **#217 canlı turu** | bu dosya | merge edildi; deploy sonrası canlı tur (≈25 kredi: sayfalama, bayt bütçesi, yeni cümleler) — sonuç bu dosyanın sonuna ek olarak yazılır |
| Yukarıdaki iki imza kalemi | imza tablosu | ikisi de para/ürün ekseninde |

## Dilim 4'e devredenler

| kalem | kaynak | neden bu dilimde kapanmadı |
|---|---|---|
| **F-5 — ölçülen, saklanan ve parası ödenen SERP verisi (URL + `item_types`, AI Overview dahil)** | `keyword_positions` F-5 | Kusur yazan tarafta ve kolon projeksiyonunda; hakem kalemi `serp_snapshot` kaydına taşıdı, R-5.5/R-8.5 eşlemesi de orada |
| `keyword_positions` F-8 (vendor'ın **reddettiği** lokasyon adı kalıcı seri başlığı) | `keyword_positions` F-8 | Satırı açan taraf `serp_snapshot`; okuma tarafında kapatmak yalnız yarısıdır |
| `keyword_positions` F-10 (`ranked` dalı ürün tarihinde hiç ölçülmedi) | `keyword_positions` F-10 | `serp_snapshot`'ın `max_crawl_pages`/timeout kök nedeni kapanmadan bu dal hiçbir yerde ölçülemez |
| **Sınıf 7 — core update takvimi**, `compare_competitors` · `backlink_changes` · `generate_report` · `whats_next` | `_DILIM3-HAKEM-SINIFLAR.md` sınıf 7 | Takvim artık VAR (`gsc-data/google-updates.ts`); eşli dört tool **Dilim 5/6'da** ölçülecek. Bugün düzeltilmezse aynı bulgu üç kez daha açılır |
| Sınıf 8 — kart sevki (5/5) | beş kaydın beşi | plan gereği ayrı dilim; dördünde yapısal yarı `gsc_discovery_runs`'a jsonb olarak zaten yazılıyor |
| `goals/` hedefleri: kök-URL · GSC kiracı filtreleri · takvim bayatlığı · ücret adı/kapsamı · CTR ekseni | dört kaydın "goals/ gerekli mi" bölümleri | üç PR'ın hiçbiri `goals/` altına dosya eklemedi (ölçüldü) |
| `pull_gsc_data` B-1 · B-3 · B-4 · B-6 · `find_quick_wins` B-3 · `detect_cannibalization` B-2 · B-3 · B-4 · `analyze_content_decay` B-3 · B-4 · `keyword_positions` F-6 · F-11 | ölçüm turu | **iş emrine hiç girmedi** — 14 AÇIK kalemin tamamı bu |

## Kapıların ÖLÇMEDİĞİ — bu kapanışın sınırları

Ders 7: yeşil kapı NE ölçtüğüyle raporlanır. Aşağıdakiler bu turda **ölçülmedi**, ve hiçbiri "geçti"
diye sayılmamıştır.

1. **#217 canlıda hiç görülmedi.** PR CI'da; merge ve deploy olmadan bu dosyadaki her `KAPANDI #217`
   satırı **bir birim-testi iddiasıdır**. Özellikle sayfalamanın gerçek GSC'de 25.000'lik sayfa
   döndürdüğü, bayt bütçesinin dentnotion'da nerede bağladığı ve yeni cümlelerin canlı metni
   ölçülmedi. **Canlıda ölçülen tek şey #215/#216'dır** (deploy `aa52154`, iki bulgu).
2. **DB şeritlerinin durumu üç PR'da da CI'a bırakılmış görünüyor — ve bu bir çelişkidir.** Üç PR'ın
   **üçünün de** kendi "Ölçülmeyen" bölümü *"DB şeritleri → CI"* diyor; buna karşılık #217 iki DB şerit
   dosyasına (`gsc-discovery-runs.db.test.ts`, `gsc-discovery.db.test.ts`) **dokundu** ve pinleri
   tool'un kendi renderer'ından geçecek şekilde çevirdi — biri B-1 yüzünden kırmızıya döndüğü için
   (yorumu bunu adıyla yazıyor). Yani şeridin bir kısmı **çevrilmiş** ama koşulduğu PR gövdelerinde
   yazmıyor. `make verify` DB şeritlerini **koşmaz** (CLAUDE.md komut tablosu); bu kapanış turu şeridi
   kendisi koşmadı, yalnız diff'i okudu. **Şef için açık soru:** #217'nin DB şeridi lokalde koşuldu mu,
   yoksa yalnız pinler mi güncellendi?
3. **CI `verify-db` bu depoda bilinen bir PostgREST 502 flake'i taşıyor** (`verify-db-ci-flake` tuzağı,
   dilim 2'de 4 kez kırmızı verdi). Bir kapının koşuluyor olması, o kapının o sabah bir şey ÖLÇTÜĞÜ
   anlamına gelmiyor — #217'nin CI durumu bu yüzden merge anında ayrıca okunmalı.
4. **Yarış ve kota dalları hiçbir şeritte ölçülemedi.** GSC kotası (R-7.7, 1.200 QPM) yüzlerce ücretli
   çağrı isterdi; 403 ve `invalid_grant` dalları bir projenin Google tarafındaki iznini bozmayı
   gerektirirdi ve iş emri bunu yasakladı. `pull_gsc_data` B-4 bu yüzden hem AÇIK hem ÖLÇÜLEMEZ.
5. **`goals/` hiç genişlemedi.** Üç PR'ın hiçbiri `goals/` altına dosya eklemedi. Bu turda kapanan
   hiçbir sınıf `make goals` tarafından ölçülmüyor; hepsi paket testinde duruyor. `detect_cannibalization`
   B-1 için bunun bedeli ölçülmüştür: hakem dışlamayı **eklediğinde de** 3914/3914 yeşil kalmıştı,
   yani düzeltme bugün sessizce geri alınabilir.
6. **Takvimin doğruluğunu hiçbir kapı ölçmüyor.** `google-updates.ts` R-6.8/R-6.9 ile 17/17 birebir
   kaydedildi ve kendi doğrulama tarihinin yaşını (90 gün) ölçüyor — ama **listeyi Google ile
   karşılaştıran bir kontrol yok**. Bayat bir takvim kırmızı vermez, sessizce yanlış atıf üretir.
7. **Secret taraması bu dilimde ayrıca koşulmadı** — `gitleaks` yalnız `make goals` ve CI'ın kendi
   job'ında koşar; `verify.sh` bakmaz (CLAUDE.md kapı kapsam tablosu).
8. **Sınıf tablosunun akıbet sütunu prose'dur.** Bir sınıfın "KAPANDI" satırı, adlandırdığı bulguların
   kapandığını söyler — o sınıfı ölçen bir predicate olduğunu DEĞİL.

## Canlı doğrulama eki (şef, 2026-09-03, deploy `aa52154`, Δ −10)

- `keyword_positions` dentnotion okuması defterde **`project: dentnotion.com`** satırı bıraktı — bu ailenin
  defter satırları ürün tarihinde ilk kez proje kapsamı taşıyor (H-1 ✔). Ölçümden önce aynı satırlar
  `no project scope` idi.
- adstark.com.tr'de ön koşul reddi doğru cümleyle döndü ve eksik adımı ölçüm olarak adlandırdı
  (`serp_snapshot`), `track_keywords`'ü ayrı ve ücretsiz adım olarak bıraktı (F-3 ✔).
- **#217'nin canlı yarısı bu eke DAHİL DEĞİLDİR** — merge sonrası ayrı bir tur gerekir.
