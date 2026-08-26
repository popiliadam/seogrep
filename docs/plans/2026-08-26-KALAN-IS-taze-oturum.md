# KALAN İŞ — TAZE OTURUM BURADAN BAŞLAR

> **Durum: %100 DEĞİL.** 22 dilim birleşti ve hakemden geçti; ama turun **onaylı işinin bir kısmı
> hiç yapılmadı** ve ölçüldü. Aşağısı iddia değil, ölçüm.
>
> **Dal:** `integration/duzeltme-dalga-ab` — `main @8668ff2` üzerine 136 commit,
> **push EDİLMEDİ** (`origin/main`'de olmayan 136 commit, bu dalı içeren remote dal: **0**).
> Üç kapı yeşil: `verify.sh` (mcp 129/3184 · web 118/1724 · core 17/316 · 38 doküman senkron) ·
> `verify-db.sh` (21/165 · 51/481 · 7/48) · `make goals` (16/16, 5 SKIP).

---

## A. ~~YAPILMAYAN ONAYLI İŞ~~ — **KAPANDI 2026-08-26**

İmza paketi (`2026-08-26-imza-paketi-onay.md`) bunları **onayladı**, fiyat sabit. **Hiçbiri kodda yok.**

> **✅ BEŞİ DE CANLI KODDA.** Kapanış kaydı: `2026-08-26-A-bolumu-kapanis.md`.
> 5/5 PASS · 5 hakem turu (2'si Fable) · **4 FAIL, yanlış alarm 0** · 27 mutasyon kanıtı.
> Üç kapı yeşil: `verify.sh` (mcp **130/3312**) · `verify-db.sh` (mcp 51/**482**) · `make goals` **16/16 (5 SKIP)**.
> **Kredi fiyatı değişikliği: SIFIR. Vendor harcaması: $0,00.** Dal artık `main` üzerine **159 commit**.
>
> Aşağıdaki tablo tarihsel kayıttır — teşhislerinin **üçü hipotezdi ve ikisi yanlış çıktı**
> (md.9 tamamen, md.10 kısmen). Ayrıntı kapanış kaydının §4'ünde.



| md. | ne | ölçüm (2026-08-26) |
|---|---|---|
| **3** | GSC üçlüsüne **tavsiye katmanı** (`find_quick_wins`, `detect_cannibalization`, `analyze_content_decay`) — üçünde de eylem önerisi yok, veri öneriyi destekliyor | üç dosyada `recommend/next step/action/suggest` **yok** (bulunan iki eşleşme tesadüfi: bir `pct()` fonksiyonu ve bir yorum) |
| **4** | `compare_competitors`'a **fark tablosu** — 90 kredi, tek karşılaştırma cümlesi yok | `difference/vs\./compared with` → **0** |
| **9** | `generate_report`'a **hız bölümü** | `report/model.ts`'te `speed/lighthouse/Core Web` → **0** |
| **10** | `discover_keywords`'ün gürültülü modlarına (`for_site`, `ideas`) **uyarı + hacim tavanı** | `noisy/unrelated/irrelevant/national` → **0** |
| **12** | Crawl'ın **DFS sıralayan-sayfa listesinden tohumlanması** (ek maliyet `my_pages` ≈ 40 kredi, onaylı) | `my_pages/ranked page/seed from` → **0** |

~~**Bunlar `[kod]` ve imzalı — taze oturum doğrudan dispatch edebilir.**~~ → **YAPILDI.**

### Her biri için iş emri notu
- **md.3** en büyüğü: üç tool, üç ayrı veri şekli. Kredi **artmıyor**. Ölçülen boşluk şuydu —
  `detect_cannibalization` poz. 7,7 ile poz. 92,4'ü yan yana koyuyor ama *"92. sıradakini kanonikle"*
  demiyor. Tavsiye **veriden türemeli**, kalıp cümle olmamalı.
- **md.4**: veri hikâyeyi zaten taşıyor — dentnotion **190 SERP / ETV 864 / $347**, rakipler
  **59 ve 25 SERP** ama **$976** ve **$1.140**. Yani rakipler az sıralamayla 3-4× değerli trafik alıyor.
- **md.10**: ölçüm `for_site` **0/15** alakalı (`çeviri`, `hava durumu`, `namaz vakitleri`),
  `ideas` **0/5**; `suggestions` **8/8** ve `related` **5/5** temiz. Uyarı **yalnız** iki gürültülü moda.
- **md.12**: sitenin **en yüksek etv'li sayfası** (127,2) crawl'a hiç girmedi.

---

## B. CANLI DOĞRULAMA BORCU — deploy sonrası, üçü de açık

| dilim | ne kanıtlanacak | nasıl |
|---|---|---|
| **S2** | `serp_snapshot` gerçekten düzeldi mi | **TEK kelime**, izlenerek. Üç şey okunur: task status **20000** mi · `organic_items_examined` **10'un belirgin üstünde** mi (yoksa kırpılmış) · gerçek `cost`. **Nedensellik iddiası ÇEKİLDİ** — turun kanıtı 9 organik satırdı, yani bir sayfa. |
| **S3** | AI ailesi gerçekten çalışıyor mu + **gerçek yanıt gövdesi** | 1 çağrı. Fixture'lar **uydurma**; başarılı çağrının satır basıp basmadığı kanıtlanmamış. Aynı çağrı **S20'nin marj tabanını** da ölçer (≤$0,30). |
| **S21** | apex→`www` sitesi gerçekten crawl oluyor mu | Gerçek bir apex→www yönlendiren site. Şu an yalnız sahte transport'a karşı kanıtlı. |

Her çağrının önü/sonu `select dfs_spend_today_usd()`.

---

## C. ÖLÇÜLDÜ, DÜZELTİLMEDİ — tek dilim olmalı

| ne | ölçüm |
|---|---|
| `my_pages` çıktısı **sınırsız** | `limit 1000` → **409.163** karakter (hakem ölçtü) |
| `discover_keywords` **sınırsız** | ~**317.000** karakter |
| kıyas | istemcinin bu turda **reddettiği** yanıt **62.729** karakterdi |
| `my_pages` **her vendor sayfasını İKİ KEZ** basıyor | `project_id` verilince: hakem tam örtüşmede **863.363** karakter ölçtü (**+%111**) |

**Birlikte düzeltilmeli:** çift basım, kapağın tutması gereken boyutu ikiye katlıyor.

> **A turundan gelen YENİ ölçüm (2026-08-26):** `analyze_content_decay` tavsiye katmanıyla
> 30 sayfada **2.109 → 6.289 karakter (+%198)** ve **listesi kapaksız**. C dilimi bunu da kapsamalı.
> Saklanan bulgu büyümüyor (`writeRun` yapısal raporu yazıyor, render metnini değil).
Emsal: `backlink_details`'in 28.000 karakterlik bütçesi + dürüst kesme notu (bu turda indi).

---

## D. İNSAN KARARI BEKLEYEN — üç şey

1. **S20** — AI ailesinin marjı **ölçülmemiş** (`2026-08-26-s20-ai-marj-karar-dosyasi.md`, 4 madde).
2. **S23** — vendor `0` gönderdiğinde ne basılacak (`2026-08-26-s23-vendor-sifiri-karar-dosyasi.md`, 4 madde).
3. **Deploy / push** — 136 commit push edilmedi. **S4 ile S21 AYNI TRENDE binmeli**: `www.`
   normalizasyonu tek başına giderse apex→`www` yönlendiren siteler için **yeni** projelerde crawl
   komple çalışmaz (ücret alınmaz, sebep `jobs.error`'da görünür, ama çalışmaz).

---

## E. CHIP KUYRUĞU — 10 madde

Ayrıntısı `2026-08-26-duzeltme-turu-kapanis-handoff.md` §4'te. Özet:
`gen-tool-docs --check` bayat `dist` doğruluyor · MCP testleri hiç typecheck edilmiyor (~40-61 hata) ·
ücretsiz retlerde kiracı sınırı yok (**~247 boş çağrı $3 tavanını doldurur**) · fiyat-kapısında latent
em-dash yanlış-pozitifi · tool `description`'ları o kapıdan taranmıyor · `formatQuickWins` üretimde ölü ·
`audit_tech` 15 kredinin ne aldığını eksik anlatıyor (4 bölüm diyor, **8 tane daha** basıyor) ·
`rules/onpage.ts:137`'deki `OPEN FOLLOW-UP` yorumu artık yanlış · **`ONPAGE_LABELS` SIRA kuralı pinsiz**
(hakem ölçtü: anahtarları başa taşımak 41/41 yeşil) · `format.test.ts` yorumu fazla söylüyor.

---

## F. TEMİZLİK BORCU — canlı hesapta duruyor

`www.seogrep.com` · `bu-domain-kesinlikle-yok-9f3a2c.com` (arşivde) · `noraninsaat.com` ·
`dentnotion.com`'un 2 tracked keyword'ü · **3 `not_measured` SERP satırı** · public rapor · `example.net`.

**`not_measured` satırları S2'nin canlı doğrulaması yapılana kadar KANITTIR — silinmez.**

---

## G. TAZE OTURUMA İKİ UYARI

1. **Defterin teşhisleri hipotezdir.** Bu turda **beş kez** doğru cevap "isteneni yapma" oldu, ve
   beşinde de iş emrini şef yazmıştı. Kanıtı birebir taşı, **teşhisi hipotez diye etiketle**, ve
   işçiye *"premis yanlışsa reddet ve ölç"* iznini **açıkça** ver. Bu turda o izin vardı ve beş kez
   kullanıldı; hepsi doğru karardı.
2. **İmza adayı ders — sekiz vaka:** *geçen bir kontrol, kapsamadığı bir eksenin kanıtı değildir.*
   Uygulanabilir kural: bir değişiklik bir tool'un **BASTIĞI** şeyi değiştiriyorsa, koşulmayan
   şeritleri **renderer'ın ADIYLA** grep'le — iddia sözdizimiyle değil.
   Ve iş emri şablonuna eklenecek: **iş emrindeki her davranış kuralı bir teste dönüşür, yoksa
   yalnız bir yorumdur** (hakem ölçtü: `ONPAGE_LABELS` sıra kuralı tam da böyle pinsiz kaldı).
