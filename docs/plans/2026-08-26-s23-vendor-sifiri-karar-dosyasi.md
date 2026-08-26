# S23 — VENDOR'IN `0` GÖNDERDİĞİ ALANLAR · KARAR DOSYASI (imza bekliyor)

> Kaynak: `2026-08-26-s1-DUZELTME-canli-olcum.md`. Ürünün çekirdek vaadi
> *"raporlanmayan alan asla sıfır basılmaz"* **teknik olarak tutuluyor** — ama müşteri yine de
> güvenilmez bir sayı okuyor, çünkü **sıfırı vendor gönderiyor.**

## 1. Ölçüm

| ölçüm | uç | sonuç |
|---|---|---|
| 2026-08-25, tur | Labs `keyword_suggestions` | **13/13** satır `keyword_difficulty 0` |
| 2026-08-25, tur | Labs `ranked_keywords` | **10/10** satır `difficulty 0/100` |
| 2026-08-25 21:00 UTC, şef canlı | Labs `ranked_keywords` | **6/6** satır `difficulty 0/100` |

Hacimler: **2.400 – 14.800**. `diş teli` (14.800 arama) için zorluk 0 **inandırıcı değil**.

**Üç çağrı, iki ayrı uç, 29 satır, hepsi tam olarak 0.** Bu bir dağılım değil — **bir sabit.**
Gerçek zorluk değerleri değişir.

**Ve kod sadık:** ayrıştırma `?? null`, basım `!== null` — `0` ancak vendor `0` gönderdiğinde basılır
(kaynak okundu + mutasyonla kanıtlandı). Yani kusur bizim tarafta değil.

## 2. Bilmediğimiz şey — ve bunu bilmediğimizi yazmak önemli

`0`ın ne anlama geldiği **ölçülmedi**. En az üç olasılık var ve **hiçbiri elenmedi**:
1. DataForSEO bu hesap/pazar için zorluğu **hesaplamıyor** ve boş yerine `0` gönderiyor;
2. Zorluk **ayrı bir abonelik/uç** gerektiriyor (`bulk_keyword_difficulty`) ve temel yanıtta `0` geliyor;
3. Değer **gerçekten** 0 (uzun kuyrukta mümkün — ama 14.800 aramalı baş terimde değil).

**Bu belirsizliği tek bir ölçüm kapatır** ve o ölçüm **bizim tarafımızda değil, vendor tarafında.**

## 3. Neden kolay çözümlerin ikisi de YANLIŞ

- **(a) Olduğu gibi bas** *(bugünkü hâl)* — sadık, ama müşteriye modellenmiş bir sayı gibi görünen
  bir yer tutucu gösteriyor. `difficulty 0/100`, "bu kelime kolay" diye okunur.
- **(b) `0`ı "raporlanmadı" say** — **meşru bir sıfırı yok eder.** Uzun kuyrukta zorluk 0 gerçektir;
  `is_lost: 0` ("hiç kelime kaybetmedi") tamamen normaldir; küçük bir haber sitesinde `rank 0`
  olabilir. Ve bu, **turun düzeltmeye çalıştığı kusurun aynadaki hâli** olurdu: bir ölçümü sessizce
  yok etmek.

**Alanın türüne bakmadan verilen her blanket kural yanlıştır.** Tek bir ölçümden genel politika
türetmek, bu turda beş kez yakaladığımız hatanın ta kendisi olur.

## 4. ŞEFİN ÖNERİSİ — ölç, sonra alana özel karar ver

**4.1 — Ücretsiz ve hemen: "sabit sıfır" sinyali.**
Bir yanıtta **DEĞİŞMESİ GEREKEN bir alan her satırda aynı `0` ise**, bu bir ölçüm değil bir
yer tutucudur. Satır başına değil, **çıktının sonunda bir kez** söylensin:
> *"DataForSEO returned a difficulty of 0 for all N keywords in this response. A field that does not
> vary across a whole result set is more likely absent from your DataForSEO plan than measured —
> treat it as unavailable, not as easy."*

Bedeli: **sıfır vendor parası, sıfır kredi**, ve yalnız ölçülmüş koşulda tetiklenir.
Alana özel değil, **desene** özel — bu yüzden meşru sıfırları yok etmez.

**4.2 — Ayrı ve ucuz: zorluğun gerçekten sağlanıp sağlanmadığını ölç.**
DataForSEO dokümantasyonu + gerekirse tek bir `bulk_keyword_difficulty` çağrısı (≤$0,02) ile
`keyword_difficulty`in bu hesapta **kapsam dahilinde olup olmadığı** ölçülür. Sonuç ne olursa olsun
dosyaya yazılır. Kapsam dışıysa, doğru düzeltme alanı **basmayı bırakmak** olabilir — ama o zaman
bunu **ölçüme dayanarak** yaparız.

**4.3 — Diğer üç alan için ŞU AN karar YOK.**
`rank 0`, `is_lost: 0`, `trend monthly 0%` — üçünde de `0` **meşru bir değer olabilir** ve hiçbiri
"her satırda aynı" desenini göstermedi. **4.1'in sinyali onları da kapsar** ve fazlası gerekmez.

## 5. İMZA MADDELERİ

| # | karar | şef önerisi |
|---|---|---|
| **23.1** | "Sabit sıfır" uyarısı eklensin mi (ücretsiz, desen-tetikli, çıktı sonunda bir kez) | **Evet.** Meşru sıfırı yok etmez, müşteriyi yanlış okumaktan korur |
| **23.2** | `0`ı blanket "raporlanmadı" saymak | **HAYIR.** Meşru ölçümü siler; turun düzelttiği kusurun aynası |
| **23.3** | `keyword_difficulty`in plan kapsamı ölçülsün mü (≤$0,02) | **Evet**, ve sonuç ne çıkarsa dosyaya yazılsın |
| **23.4** | Kapsam dışı çıkarsa alanı basmayı bırakmak | **Ölçümden SONRA** ayrı karar. Şimdi taahhüt yok |

## 6. Bu dosyanın KAPSAMADIĞI

- Hiçbir fiyat/kredi değişikliği — hiçbiri önerilmiyor.
- Çekirdek vaadin kendisi: *"raporlanmayan asla sıfır basılmaz"* **doğru kalıyor ve 11 noktada
  pinli.** Bu dosya vaadin **arkasındaki** soruyu soruyor: vendor sıfır gönderdiğinde ne yapılır.
