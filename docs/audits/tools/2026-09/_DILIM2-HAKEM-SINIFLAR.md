# Dilim 2 — hakemin tekrarlayan sınıflar tablosu

> Tur: 2026-09 tool kontrol turu, dilim 2 (crawl + audit ailesi: `crawl_site`, `audit_tech`,
> `audit_schema`, `audit_speed`, `audit_onpage`, `audit_content`) · Hakem: taze Opus 4.8 · 6/6 PASS
> Kaynak: hakemin dilim kapanış turu, 2026-09-02. Bu dosya hakem metnini AKTARIR; yeni bulgu üretmez.

Altı kaydın bulguları tek tek okunduğunda ayrı ayrı görünüyor. Yan yana konduğunda **dokuz sınıf**
çıkıyor: aynı kusur birden çok tool'da, çoğu zaman aynı ortak kod yolundan. Bir sınıfı tool başına
düzeltmek, onu altı kez düzeltmek demektir — ve altıncısı unutulur.

Sınıf tablosunun asıl işi budur: **düzeltme dilimlerini tool'a göre değil SINIFA göre kesmek.**

| # | sınıf | nerede görüldü | kök / ortak yol | not |
|---|---|---|---|---|
| 1 | **En-son-crawl seçimi + kapsam cümlesi yok** | `audit_tech` T-B4 · `audit_schema` S-B7 · `audit_onpage` A-2 | `load.ts:41-47` (`loadLatestCrawl` yalnız EN SON succeeded crawl'ı alır; şemada crawl seçecek alan yok) | **`audit_content` KARŞI ÖRNEK:** aynı veriyi okuyor ama kapsam cümlesini BASIYOR (`Checked 3 of 234 … against 1 of the 1 crawled pages. 231 could not be checked…`). Yani bu bir mimari zorunluluk değil — dört tool'dan biri doğrusunu zaten yapıyor ve kopyalanacak metin elde |
| 2 | **Özdeş denetim yeniden ücretlendiriliyor** | `audit_tech` T-B5 · `audit_schema` S-B5 · `audit_onpage` A-3 | `audit-shared.ts:144` — `writeRun` KOŞULSUZ | **Hakem turunda İKİYE BÖLÜNDÜ.** (i) *kopya* yarısı P2: "bu crawl `<ts>`'de zaten denetlendi" uyarısı yok — `audit_runs` gereken veriyi zaten saklıyor, fiyat modeline dokunmadan yazılabilir. (ii) *ücret* yarısı **İMZA KALEMİ**: ücretsiz tekrar ya da `confirm` kapısı bir **fiyat modeli** kararıdır (NEVER#6) ve üç audit (5/15/30 kredi) tek imzada karara bağlanmalı. `crawl_site` B-1 ile de aynı aile |
| 3 | **Eşik sabiti testte YANLIŞ pinli** | `audit_onpage` A-1 (60/160 karakter) · `audit_schema` S-B1 (`FAQPage`) | testler, kaynağın o günkü değerini birebir pinliyor | Pin'in kendisi kusur değil; kusur pinin **neye** bağlandığı. A-1'de Google'ın YAYIMLAMADIĞI bir sınır kural gibi pinli; S-B1'de galeriden düşmüş bir tip `the required-field table is exactly the documented minimum` testiyle pinli ve tablo **tazelenmeye direniyor** (S-B1b, `goals/` adayı). İkisinde de kapı, doğru olanı yapmayı NEVER#8 ihlali gibi gösteriyor |
| 4 | **Vendor şekli / uydurma fixture** | `audit_speed` B-1 · `audit_speed` B-10 | `dfs/fixtures/lighthouse.json:26-29`; `dfs/lighthouse.ts:437-441` | Ders 12'nin dilim 2'deki iki vakası. B-1: fixture dört alanı snake_case yazıyor, satıcı camelCase gönderiyor — test double'ı gerçeğinden hoşgörülü, eksik kısıt GEÇEN teste dönüşmüş. B-10: satıcı dokümanında karşılığı olmayan `enable_javascript` hem koda hem TESTE pinlenmiş — kanıtlanmamış bir garantiyi test pinlemesi, aynı dersin ikinci yüzü. **Düzeltme sırası: önce fixture, sonra şema** |
| 5 | **Dar kapı vs paket kapısı** | `audit_schema` S-B3 · `audit_speed` B-5 · `crawl_site` M4/M5 | ders 15 ("bir task'ın kapısı, DEĞDİĞİ her paketin KENDİ test script'ini içerir") | S-B3: kredi iade yolu dar şeritte 214/214 YEŞİL, yalnız paket kapısı kırmızı. B-5: `withCredits` anahtarı yanlış tool'a çevrilince paketin 3766 testi yeşil kaldı — yakalayan tek test `make verify-db` şeridinde, `make verify`'da DEĞİL. Sınıfın anlamı: bu turda "audit testlerim yeşil" cümlesi **para yolu hakkında hiçbir şey söylemiyor** |
| 6 | **robots.txt gövdesi `CrawlResult`'a yazılmıyor** | `audit_tech` T-B8 · `crawl_site` B-10 | `crawler/crawl.ts:130-151` — `CrawlResult` robots.txt metnini taşımıyor | Tek satırlık bir alan (`CrawlResult.robotsTxt`, **zaten indirilmiş** metin) audit tarafında beş kuralı birden açar. Referans tarafındaki karşılığı bu turda işlendi: R-3.20–R-3.24 `audit_tech` için **yapısal olarak karşılıksız** ilan edildi ve R-3.22–R-3.24 `ai_visibility` ailesine eşlendi. Bugün `User-agent: Googlebot / Disallow: /` yazan bir site denetimde TEMİZ görünüyor |
| 7 | **"You were not charged" vs defterde charge+refund** | `audit_tech` T-B11 · `audit_schema` S-B9 | rezerv aç → iade et (append-only, NEVER#2 — **sistem doğru**) | Düzeltilecek olan KELİME, mekanizma değil. **`audit_onpage` ve `audit_content` bu davranışı GÖRDÜ ama bulgu AÇMADI** — aynı defter satırları onların kayıtlarında da var. Sınıf tablosunun tam olarak yakaladığı şey bu: iki kayıt aynı olguyu ölçüp raporlamamış. (`audit_content` §3'te ayrıca DÖRT çiftin ÜÇ sayıldığı ölçüm hatası bu turda düzeltildi) |
| 8 | **Kart planlı, sevk edilmemiş** | **6/6** — altı tool'un altısı | `card-map.ts` eşlemesi VAR; `CARDED_TOOLS` yalnız `get_credit_balance` | Canlı `tools/list` `_meta` taşımıyor, `tools/call` `structuredContent` taşımıyor. Depo-geneli kalem, dilim 1'in her kaydında da vardı. Bu dilimin katkısı: **üç audit'te sevk maliyeti neredeyse sıfır** — `TechReport`/`SchemaReport` zaten `audit_runs.report`'a jsonb olarak yazılıyor, yani kartın isteyeceği nesne hazır ve serileştirilmiş durumda |
| 9 | **Ayırıcısız cümle birleştirme** | `crawl_site` B-8 · `audit_tech` T-B6 · `audit_speed` B-6 | `withNoChargeNote` birleştirmesi — `→ at project_id You were not charged.` | 2026-08-27'de kapatılan **F-6 ailesinin** aynısı (o da noktalama birleştirmesiydi, `get_job_status`). Bir kez kapatılan bir kusurun ikinci konumda hâlâ yaşadığı vaka: birleştirme tek yerden yapılmalı ve önceki parçanın son karakterine göre boşluk/nokta eklemeli. `audit_speed` B-6'da üstelik zod'un ÇOK SATIRLI mesajıyla birleşiyor |

## Nasıl okunmalı

- **Sınıf 2, 3 ve 7 metin/karar kalemleri** — kodu değil cümleyi ya da imzayı bekliyorlar. Sınıf 2'nin
  ücret yarısı ve sınıf 3'ün A-1 yarısı **insan imzası** olmadan ilerlemez.
- **Sınıf 1, 6 ve 8 tek bir yapısal ekle kapanıyor** (kapsam cümlesi · `CrawlResult.robotsTxt` ·
  `structuredContent`) ve üçünde de gereken veri **zaten elde**. Bu üçü en yüksek getirili dilimdir.
- **Sınıf 4 ve 5 kapının kendisi hakkında.** Bunlar tool bulgusu değil, **ölçüm aracının** bulgusudur:
  düzeltilmezlerse bir sonraki turun "yeşil" raporu yine aynı şeyi kaçırır (ders 12 · ders 15).
- **Sınıf 9 dilim 1'de kapatılmış sayılıyordu.** Kapanış, kusurun BULUNDUĞU konumda yapılmıştı; sınıf
  olarak kapatılmadığı için üç yeni konumda yaşıyor (ders 14: hangi ekseni varyantladığını yaz).

## Kapsam — bu tablonun ÖLÇMEDİĞİ

- Tablo **dilim 2'nin altı kaydından** çıkarıldı. Dilim 1'in 15 tool'u ve henüz ölçülmemiş tool'lar
  bu sınıfların KAPSAMINDA MI, ölçülmedi — yalnız sınıf 8 ve 9 için dilim 1'de karşılık olduğu biliniyor.
- Sınıfların **hiçbiri bir kapıya bağlı değil**: bu dosya prose'dur. Bir sınıfın gerçekten kapandığı,
  ancak `goals/` predicate'i ya da `verify.sh` adımı eklendiğinde ölçülebilir olur.
- Sıklık sayıları **bulgu sayısıdır, müşteri etkisi değil**. Altı tool'da görünen bir sınıf, altı kat
  daha çok müşteriyi etkilediği anlamına gelmez.
