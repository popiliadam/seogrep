# Dilim 3 — hakemin tekrarlayan sınıflar tablosu

> Tur: 2026-09 tool kontrol turu, dilim 3 (GSC + pozisyon ailesi: `pull_gsc_data`, `find_quick_wins`,
> `detect_cannibalization`, `analyze_content_decay`, `keyword_positions`) · Hakem: taze Opus · 2/2 PASS
> Kaynak: hakemin dilim kapanış turu, 2026-09-03. Bu dosya hakem metnini AKTARIR; yeni bulgu üretmez.
> Kardeşi: `_DILIM2-HAKEM-SINIFLAR.md` (dokuz sınıf, crawl + audit ailesi).

Beş kaydın bulguları tek tek okunduğunda ayrı ayrı görünüyor. Yan yana konduğunda **dokuz sınıf**
çıkıyor, ve bu dilimde sınıfların yarısı **dilim 1 ve 2 ile kesişiyor** — yani tool'a göre kesilen bir
düzeltme dilimi aynı kusuru üçüncü kez düzeltir ve dördüncüsünü unutur.

Sınıf tablosunun asıl işi budur: **düzeltme dilimlerini tool'a göre değil SINIFA göre kesmek.**

| # | sınıf | nerede görüldü (tool listesi) | kök / ortak yol | akıbet |
|---|---|---|---|---|
| 1 | **NEVER#4 kiracı filtresi pinsiz — service-role okumaları `make verify`'da korunmasız** | `pull_gsc_data` B-5 (M4 `gsc_accounts` · M4b `gsc_connections`) · `keyword_positions` F-2 (M3 `countStoredMeasurements` · M3b `loadStoredMeasurements`) · önceki dilimlerden `track_keywords` F-1 (iki konum) | service-role client + `.eq("user_id", …)`'in yalnız `*.db.test.ts` şeridinde sınanması; `service-client-pins.test.ts` bu okumalar için pin taşımıyor | **KISMEN KAPANDI #217 + #216.** #217: `gsc_accounts`, `gsc_connections`, token-status okumaları `service-client-pins.test.ts`'e zincir piniyle girdi. #216: `keyword_positions`'ın count/load filtreleri (4 mutasyon kırmızı). **AÇIK:** `track_keywords` F-1'in İKİ konumu ele alınmadı (`tracked_keywords` #217'de 0, #216'da yalnız metin eşleşmesi) ve **`goals/` hedefi yazılmadı** — sınıf bugün paket testinde duruyor, kapıda değil |
| 2 | **Ücretin ADI/TUTARI çağrı yerinde pinsiz + KAPSAMI (`projectId`) hiç geçirilmiyor** | `keyword_positions` F-1 (ad/tutar, M2 yeşil) ve **H-1** (kapsam, hakem bulgusu) · dilim 2 `audit_speed` B-5 (aynı sınıf, #209'da kapandı) | `withCredits(…, { tool })` meta'sı: `TOOL_COSTS` tablosu pinli ama **hangi satırın okunacağı** ve **hangi projeye yazılacağı** çağrı yerinde. Hakem 14 handler çağrı yeri saydı, bu turun kendi sayımı 16 — **1'i pinli** (#209 sonrası `audit_speed`) | **KAPANDI #215 + #216.** #215 ad/tutar/kapsam üçlüsünü 13 çağrı yerine yazdı, 2 bilinçli null'u yorumlu+pinli bıraktı ve **registry'den türeyen aile taraması** ekledi (`handler-charge-scope-coverage.pin.test.ts`); #216 bu tool'un çağrı yerini kapattı → `missing = []`. Sayım tartışması koşarak çözüldü: **16** (13 + 2 + 1), kaydın sayımı doğruydu. Canlı ✔ (`project: dentnotion.com`). **AÇIK:** `goals/` hedefi yok |
| 3 | **Precondition reddi YANLIŞ tool'a yönlendiriyor** | `keyword_positions` F-3 (P1→**P2**, `track_keywords` yerine `serp_snapshot` olmalı) · `find_quick_wins` B-4 (`pull_gsc_data` yerine `connect_gsc` olmalı) · dilim 1 `get_job_status` B-3 (P2, sonraki adım hiç söylenmiyor) | ret metinleri zinciri **bir halka eksik** kuruyor; `gsc-data/load.ts:35-47` (üç GSC tool'u için tek mesaj) ve `keyword-positions.ts:119-130` | **KAPANDI #216 (+ canlı ✔) ve #217.** `keyword_positions` F-3 ret metni zinciri tam kuruyor (`track_keywords` → `serp_snapshot` → `keyword_positions`) ve canlıda adstark'ta ölçüldü; `find_quick_wins` B-4 bağlantı durumunu okuyup `connect_gsc` / `pull_gsc_data` ayrımını yapıyor. **AÇIK:** sınıfın üçüncü kalemi (Dilim 1 `get_job_status` B-3) bu turun kapsamında değildi — ders 14'ün "üçüncüsü unutulur" uyarısı hâlâ geçerli |
| 4 | **15.000 satır tavanı + sayfalamasızlık: satılan analizlerin tamamı kesik veri üstünde** | **kök: `pull_gsc_data` B-2** (iki pencere de tavanda, `startRow: 0`) · `analyze_content_decay` B-3 (`17 → 0 clicks` kesik çekimin ürettiği şekil) · `detect_cannibalization` R-7.2 satırı (**payda kısalıyor → her pay şişik**) · `find_quick_wins` (ölçülen mutlu yolun TAMAMI kesik veri üstünde koştu) | `gsc-data/pull.ts:66` `MAX_ROW_LIMIT = 15000` + `:100` `startRow: 0`; tavan ölçülmüş bir 12 MB depolama bütçesidir, yükseltmek çözüm değil | **KAPANDI #217 — kök düzeltmeyle.** `startRow` sayfalama (25.000/sayfa, 4 sayfa mutlak tavan) + satır basılmadan ÖNCE uygulanan 6 MB/pencere bayt bütçesi; kesilme artık pencere ADIYLA ve gerçek satır sayısıyla basılıyor, üç türev tool aynı cümleyi taşıyor. Hakem 1. turda FAIL verdi (kontrol sayfadan sonraydı → 21 MB), 2. turda kapandı. **AÇIK kalıntı (P2):** 2 × 6 MB tam 12.000.000 B ve JSON zarfı (~200 B) üstüne biner. **Canlı doğrulama bekliyor** — gerçek GSC'de sayfalamanın 25.000'lik sayfa döndürdüğü ölçülmedi |
| 5 | **"position" üründe iki farklı şey ve hiçbir yüzey ikisini ayırmıyor** | `keyword_positions` F-4 (`rank_group #N`, tek anın SERP sırası) · `find_quick_wins` B-2 (`position 12.3`, pencere ortalaması, bildirilmiyor) · `detect_cannibalization` (§5: semantik doğru, ama ortalama olduğu okura söylenmiyor) | R-7.11; `find-quick-wins.ts:124` vs `keyword-positions-format.ts`; iki yüzey birbirini **0 kez** anıyor (çift yönlü grep) | **KAPANDI #216 + #217.** `keyword_positions` artık *"SERP ranks from a snapshot (rank #4 = the fourth organic result), not Search Console's average position"* diyor; karşı yüzeyde `AVERAGE_POSITION_NOTE` **tek sabit** olarak `find_quick_wins` ve `analyze_content_decay` tarafından paylaşılıyor — iki yüzey aynı sayıyı iki farklı cümleyle açıklayamıyor. **AÇIK:** `goals/` hedefi yok |
| 6 | **Ölçülen, saklanan ve PARASI ÖDENEN veri hiçbir yüzeyden okunamıyor** | `keyword_positions` F-5 (`url` + `item_types`, AI Overview varlığı dahil) — **kalem Dilim 4 `serp_snapshot` kaydına taşındı** | yazan taraf `report` jsonb'sine yazıyor (`serp-snapshot-store.ts:134`), okuyan tarafın kolon projeksiyonu `report`'u almıyor (`keyword-positions-store.ts:73`), biçimlendirici basmıyor, web sayfası kasten okumuyor (`ranking-history.ts:147`) | **ERTELENDİ → Dilim 4 `serp_snapshot`.** Kalem ölçüldüğü kayıtta (F-5) duruyor, düzeltme oraya taşındı; kolon projeksiyonu ve `item_types` bu turda hiç açılmadı |
| 7 | **Core update takvimi üründe hiç yok — düşüş her zaman içeriğe atfediliyor** | `analyze_content_decay` B-1 (canlıda gerçekleşti: önceki pencere İKİ core update içeriyordu) · **eşli ama henüz ölçülmemiş:** R-6.9 referansta `compare_competitors`, `backlink_changes`, `generate_report` satırlarında da yazılı, ve `whats_next` bu ailenin çıktısını taşıyor | `grep -rni "core update"` → `apps/mcp/src/` + docs'ta **0 eşleşme**; kavram bir dosya uzakta (`gsc-data/load.ts:120-125`, *"an algorithm update"*). **Takvim bir VERİDİR ve bayatlar** — koda gömülürse "10 değişiklik" listesinin #1 tuzağına düşer. Bu sınıf **sonraki dilimlerde TEKRAR EDECEK** | **KAPANDI #217 — YALNIZ `analyze_content_decay` için.** Takvim koda gömülmedi, **veri** olarak geldi: `gsc-data/google-updates.ts`, R-6.8/R-6.9 ile 17/17 birebir, `GOOGLE_UPDATES_VERIFIED_ON` + 90 günlük bayatlık uyarısıyla; pencere bir güncellemeyle kesişince not listenin BAŞINDA. **AÇIK, iki eksende:** (a) takvimin BAKIM yolu — hiçbir kapı listeyi Google ile karşılaştırmıyor, ölçülen tek şey doğrulama tarihinin yaşı; (b) sınıfın eşli olduğu diğer dört tool (`compare_competitors`, `backlink_changes`, `generate_report`, `whats_next`) **Dilim 5/6'ya devrediyor** |
| 8 | **Kart planlı, sevk edilmemiş** | **5/5** — beş tool'un beşi | `card-map.ts` eşlemesi VAR (`:20 list`, `:35/:36/:37 report`, `:47 action`); `CARDED_TOOLS` yalnız `get_credit_balance`. Depo-geneli kalem; dilim 1 ve 2'nin her kaydında da vardı (dilim 2 sınıf 8). Bu dilimin katkısı: **dördünde yapısal yarı zaten `gsc_discovery_runs`'a jsonb olarak yazılıyor** — kartın isteyeceği nesne hazır | **ERTELENDİ → kart dilimi (plan gereği).** `CARDED_TOOLS` hâlâ yalnız `get_credit_balance`; beş kaydın beşinde de yapısal yarı hazır. Dilim 1 ve 2'nin aynı kalemiyle birlikte tek dilimde kapanacak |
| 9 | **Tek satırlık zod mesajı NOKTA İLE BİTMİYOR** (eski adıyla "ayırıcısız birleştirme" — **o çerçeve fazla genişti**) | `pull_gsc_data` B-7 · `find_quick_wins` B-5 · `detect_cannibalization` B-5 · `analyze_content_decay` B-5 (dördü de aynı şekli ölçtü) | **Birleştirici DEĞİL, üretici.** `credits/free-refusal.ts:53-59` tek yerde birleştiriyor ve tek satırda boşluk **KASITLI** (`A one-line refusal is prose, and a sentence follows a sentence after a space`), çok satırda `\n\n`; o ayrım dilim 2 `audit_speed` B-6 ile **#210'da kapandı**. Kalan kusur: zod'un tek satırlık mesajı cümle sonu noktalaması taşımıyor | **KAPANDI #217 — üreticide, birleştiricide DEĞİL.** `registry.ts` `terminateOneLine`: tek satırlık zod reddi nokta ile biter, çok satırlı mesaj DOKUNULMADAN geçer; `credits/free-refusal.ts` değişmedi, yani #210'un kararı yeniden açılmadı. Dört kayıt (pull B-7 · quick_wins B-5 · cannib B-5 · decay B-5) tek düzeltmeyle kapandı. **AÇIK:** dördünün de İKİNCİ yarısı (reddin yönlendirici olmaması: `days`, `limit`, `threshold`) kapanmadı |

## Nasıl okunmalı

- **Sınıf 1 ve 2 para/izolasyon yolunun kapısı hakkında.** İkisi de "paketin 3914 testi yeşil" cümlesinin
  **neyi söylemediğini** ölçüyor: kiracı filtresi ve ücretin kime/hangi adla yazıldığı. Dilim 2'nin
  sınıf 5'inin (dar kapı vs paket kapısı) bu dilimdeki devamıdır ve **düzeltmesi de aynı yerdedir** —
  fake-query pini + `goals/` hedefi.
- **Sınıf 3, 5 ve 9 kopya kalemleridir** — kod değil cümle. Üçü de ucuz, üçü de birden çok tool'a
  dokunuyor, ve üçünde de tool başına kapatma **sonuncuyu unutturur** (sınıf 9 tam olarak böyle
  ikinci kez açıldı: #210 kapatmıştı, bu tur onu yanlış çerçeveyle yeniden açacaktı).
- **Sınıf 4 bu dilimin kökü.** Dört kaydın dördü de onun üstünde koştu: `find_quick_wins`'in
  "638 more", `analyze_content_decay`'in `17 → 0`, `detect_cannibalization`'ın şişmiş payları ve
  `pull_gsc_data`'nın kendi cap uyarısı **aynı tek kusurun** dört yüzü.
- **Sınıf 7 tek tool'da ölçüldü ama dört tool'a daha eşli.** Bugün düzeltilmezse önümüzdeki iki
  dilimde aynı bulgu üç kez daha açılır.
- **Sınıf 6 bu kaydın kendi kapsam düzeltmesidir:** ölçüm `keyword_positions`'ta yapıldı, kusur
  `serp_snapshot`'ta — kalem oraya taşındı, referans satırı da (R-5.5/R-8.5) orada bırakıldı.

## Kapsam — bu tablonun ÖLÇMEDİĞİ

- Tablo **dilim 3'ün beş kaydından** çıkarıldı. Sınıfların dilim 1'in 15 tool'unu ve henüz ölçülmemiş
  tool'ları kapsayıp kapsamadığı ölçülmedi; yalnız sınıf 2, 3, 8 ve 9 için önceki dilimlerde adıyla
  karşılık olduğu biliniyor.
- Sınıfların **hiçbiri bir kapıya bağlı değil**: bu dosya prose'dur. Bir sınıfın gerçekten kapandığı,
  ancak `goals/` predicate'i ya da `verify.sh` adımı eklendiğinde ölçülebilir olur. Ölçüldü
  2026-09-03: dilim 3'ün beş tool adı `goals/` altında **tek satır** buluyor
  (`goals/trial-flow-e2e.md:65`) ve o satır bir tool-sayısı başlığıdır, predicate değil.
- Sıklık sayıları **bulgu sayısıdır, müşteri etkisi değil**.
- **Akıbet sütunu 2026-09-03 kapanış turunda DOLDURULDU** (PR / karar / imza). Sütun **prose'dur**: bir
  sınıfın "KAPANDI" satırı, adlandırdığı bulguların kapandığını söyler — o sınıfı ölçen bir predicate
  olduğunu DEĞİL. Dokuz sınıfın hiçbiri bugün `goals/` altında bir hedefe bağlı değil (ölçüldü, ikinci
  kez). Kapanış indeksi: `_DILIM3-KAPANIS.md`.
