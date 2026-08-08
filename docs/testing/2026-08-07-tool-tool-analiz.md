# 19 MCP tool'u — tek tek geliştirme analizi

> Kaynak: `product-test-log.md` (2026-08-07 gece ürün testi). **Her satır o oturumda canlıda
> gözlenmiş bir davranışa ya da okunmuş bir kod satırına dayanır.** Ölçülmemiş şeyler
> "ölçülmedi" diye işaretlidir — tahmin, bulguymuş gibi yazılmaz.
>
> Bu belge **iş emri değildir.** Triyaj insanla beraber yapılacak (test defteri kural 3).
> Fiyat/kredi rakamlarına dokunulmadı (NEVER#6); fiyat/değer dengesizliği yalnız *bulgu* olarak yazıldı.

---

## Önce: altı çapraz tema

Tek tek bakmadan önce, 19 tool'a dağılmış ama **kökü ortak** olan altı desen. Aşağıdaki
tool başlıklarında bunlara `[A]`…`[F]` diye atıf var. Tek tek düzeltmek yerine kökten
çözmek çok daha ucuz.

| | Tema | Ne oluyor | Etkilenen tool |
|---|---|---|---|
| **A** | **Bağlam körlüğü** | Projenin durumu (GSC bağlı mı, crawl var mı, hangi analiz koşmuş) DB'de duruyor; tool'lar ona bakmadan konuşuyor | `whats_next` · `connect_gsc` · `generate_report` · `list_projects` |
| **B** | **Ülke/dil körlüğü** | Dört premium tool `project_id` değil çıplak `target`/`keywords` alıyor → ABD/İngilizce varsayıyor. Proje kaydında ülke alanı **yok** | `ranked_keywords` · `compare_competitors` · `research_keywords` · (kök: `setup_project`) |
| **C** | **URL biçim çatallanması** | `normalizeUrl` sondaki `/`'ı siliyor; GSC ise `/`'lı döndürüyor → aynı sayfa iki farklı anahtar | `crawl_site` · GSC ailesi · gelecekteki her birleşim |
| **D** | **Sessiz kısıtlar** | Zaman bütçesi, eşikler, kapsam sınırları kullanıcıya söylenmiyor; çıktı "sorun yok" gibi okunuyor | `crawl_site` · `audit_tech` · `audit_schema` · `analyze_content_decay` |
| **E** | **Fixture ↔ gerçek boşluğu** | NEVER#5 fixture'ları yalnız bilinen şekilleri kodluyor; ilk canlı çağrı yeni şekille ölüyor | `analyze_backlinks` (kanıtlı) · diğer DFS tool'ları (taranmadı) |
| **F** | **"Peki ne yapayım?" eksiği** | Tool'lar veri veriyor, eylem vermiyor; öncelik/etki tahmini/nasıl düzeltilir yok | denetim üçlüsü · GSC ailesi · premium üçlü |
| **G** | **Veri var, yorum yok** | Ham sayfa verisi elimizde ama ona doğru soru sorulmuyor: sayfalar arası tutarlılık, ortak kusur deseni, kompozisyon analizi yok. Rakiplerin sahip olmadığı tek şey bu veri — kullanılmadan bırakılıyor | `audit_onpage` (#27) · denetim ailesi (#22) · `analyze_backlinks` (#29) |

---

# ÜCRETSİZ TOOL'LAR (6)

## 1. `setup_project` — ücretsiz
**Gözlenen:** Var olan alan adında `created: false` + aynı `project_id`, ikinci satır açmadı.
0010 migration'ın `unique(user_id,domain)` + ON CONFLICT'i canlıda doğru çalışıyor. **Kusursuz.**

**Geliştirme alanları**
1. **Ülke/dil alanı yok `[B]` — en değerli tek ekleme.** Proje kurulurken ülke/dil sorulsa (ya da
   `.com.tr` gibi ccTLD'den türetilse), dört premium tool varsayılanını oradan alır ve 🔴 #18
   kökten kapanır. Şu an bu bilgi üründe **hiçbir yerde** tutulmuyor.
2. **Alan adı ön-doğrulaması yok.** Site erişilebilir mi, robots ne diyor, sitemap var mı —
   hiçbiri kurulumda kontrol edilmiyor. Kullanıcı `adstark.com` yazsa (doğrusu `.com.tr`) hata
   almaz, 20 kredilik crawl'da öğrenir. *(Ölçülmedi: yanlış alan adıyla crawl denenmedi.)*
3. **Özet dönmüyor `[A]`.** "Zaten var" derken projede ne olduğunu söylemiyor (kaç crawl, GSC
   bağlı mı). Kullanıcı ardından `whats_next` çağırmak zorunda.

**Öncelik: (1) yüksek — bir 🔴'nin kalıcı çözümü burada.** (2)-(3) düşük.

---

## 2. `connect_gsc` — 0 kredi
**Gözlenen:** İki durumda da **birebir aynı** metin. Bağlı olmayan projede doğru; bağlı projede
(adstark, 2026-07-28'den beri) yine "open this link and approve access" dedi. → **bulgu #20**

**Geliştirme alanları**
1. **Bağlantı durumunu oku `[A]`.** "adstark.com.tr zaten bağlı — property `https://adstark.com.tr/`,
   2026-07-28'den beri. Yeniden bağlamak istersen bu link." Veri `gsc_connections`'ta hazır duruyor.
2. **Koparma yolu MCP'de yok.** Web'de var (2026-07-28 canlı), MCP yüzeyinde yok. Sohbetten
   bağlayabilen kullanıcı sohbetten koparamıyor.
3. **Hangi property'nin seçildiği tool'a dönmüyor.** OAuth sonrası kullanıcı hangi property'nin
   bağlandığını MCP üzerinden hiç göremiyor.
4. Metin kalitesi **iyi**: "READ-ONLY … never write access" cümlesi güven veriyor, opsiyonel
   olduğunu söylüyor. Buna dokunma.

**Öncelik: (1) orta, (2) orta.**

---

## 3. `list_projects` — ücretsiz
**Gözlenen:** 2 proje, `domain` + `project_id`. Doğru ve hızlı.

**Geliştirme alanları**
1. **Durum sütunu yok `[A]`.** Ne crawl tarihi, ne sayfa sayısı, ne GSC durumu. Oysa `whats_next`
   bu bilgiyi zaten okuyor → aynı sorgudan gelir, **ek maliyet ~0**.
2. **Çok projede kör nokta.** Kullanıcı her proje için ayrı ayrı `whats_next` çağırmak zorunda;
   3-4 projeli bir ajans için bu her seferinde 4 tur.
3. Boş durumda ne dediği **ölçülmedi** (projesiz hesap denenmedi).

**Öncelik: (1) düşük maliyet / yüksek UX kazancı — iyi bir "quick win".**

---

## 4. `get_credit_balance` — ücretsiz
**Gözlenen:** Her ölçümde `SUM(credit_ledger)` ile **birebir** aynı. Oturum boyunca 5 kez
çağrıldı, 5'inde de tuttu. **Doğruluk kusursuz.**

**Geliştirme alanları**
1. **Trial mi paid mi söylemiyor — gerçek bir tuzak.** Dört DFS tool'u *paid balance* şart koşuyor
   (PR #37). Trial kullanıcı 1380 değil 180 kredi görüp "yeterli" sanıyor, `ranked_keywords`
   çağırıp reddediliyor. Bakiye satırı bunu **önceden** söyleyebilir.
2. **Harcama geçmişi yok.** "Bu ay 455 kredi harcadın, en çok `compare_competitors`'a" bilgisi
   deftere zaten yazılı; tek satırlık özet çıkarmak bedava.
3. **Kredinin para karşılığı yok.** Kullanıcı 90 kredinin ne demek olduğunu bilmiyor.

**Öncelik: (1) orta — yanlış beklentiyi baştan kesiyor.**

---

## 5. `get_job_status` — ücretsiz
**Gözlenen:** Doğru çalışıyor. **Kiracı izolasyonu temiz:** başka kiracının işi, var olmayan id
ile *birebir aynı* "No job found" mesajını veriyor — varlık sızıntısı yok. Var olmayan id'de
`isError=true` + tek cümle, iç detay sızdırmıyor.

**Geliştirme alanları**
1. **İlerleme göstermiyor.** 92 saniyelik crawl boyunca yalnız "is running" diyor — kaç sayfa
   tarandı, ne kadar kaldı belli değil. Kullanıcı kör bekliyor. (Ben bile poll döngüsü yazmak
   zorunda kaldım.)
2. **Tahmini bitiş yok.** Ön-keşif "34 sayfa" diyebiliyorsa kaba bir süre de verebilir.
3. Bitiş özeti `crawl_site`'ın kusurunu miras alıyor: "skipped 43" sebepsiz `[D]` → #3.

**Öncelik: (1) orta — algılanan kaliteyi en ucuz artıran şey.**

---

## 6. `whats_next` — ücretsiz
**Gözlenen:** **Gerçekten bağlama duyarlı**, statik değil: Tur 1 öncesi "pull_gsc_data", Tur 2
sonrası "you're all set". Tek projede doğru yönlendiriyor, çok projede doğru şekilde soruyor.
Ama iki kusuru var: **#1** ve **#14**.

**Geliştirme alanları**
1. **🔴 #1 — GSC dalı denetim dalını yutuyor `[A]`.** Temiz A/B: aynı crawl durumu, tek fark GSC.
   Bağlıyken `audit_onpage`/`audit_tech`/`audit_schema` **hiç anılmıyor**, üçü de hiç koşmamış
   olsa bile. GSC'yi erken bağlayan kullanıcı 20 kredilik crawl'ını analiz etmesi gerektiğini
   asla öğrenmiyor. **Dal önceliği sorunu — en yüksek öncelikli ücretsiz düzeltme.**
2. **#14 — analiz geçmişini bilmiyor.** Koşulmuş tool'ları tekrar öneriyor; rapor üretilmişken
   yine `generate_report` diyor. Kredi harcatabilir.
3. **Maliyet söylemiyor `[F]`.** "Sıradaki adım: `audit_onpage`" diyor ama "30 kredi" demiyor.
   Ücretsiz bir tool'un kullanıcıya en kolay verebileceği şey bu.
4. **Çok projede toplu özet yok** — her proje için ayrı çağrı.

**Öncelik: (1) yüksek · (3) düşük maliyet, yüksek getiri.**

---

# TARAMA VE DENETİM (5)

## 7. `crawl_site` — 20 kredi · **en çok iş gerektiren tool**
**Gözlenen:** 24 sayfa tarandı, 43 atlandı, **hepsi `time budget exhausted`**. Taranan 24'ün
tamamı blog yazısı; atlananlar arasında **ana sayfa** ve bütün ticari sayfalar. İş 92 sn sürdü,
`DEFAULT_TIME_BUDGET_MS = 90_000` (crawl.ts:366). Defter doğru ama tam ücret alındı.
→ **#2 🔴 · #3 · #4 · #5 · #7**

**Geliştirme alanları**
1. **🔴 Ana sayfayı kuyruğun başına al.** Kök sebep tek satır: `crawl.ts:970` civarı,
   `seeds.length > 0 ? [...seeds] : [rootSeed]` — sitemap varsa ana sayfa **yalnız yedek tohum**.
   Yoast önce post sitemap'ini listeliyor → blog önce → ana sayfa bütçeye yetişemiyor.
2. **Öncelik sırası ekle.** Sitemap sırasına körlemesine uymak yanlış: ana sayfa → gezinti/servis
   sayfaları → kategoriler → blog. Bütçe dolduğunda **düşenler en az değerliler olmalı**, şu an
   tam tersi oluyor.
3. **Eşzamanlı fetch.** Şu an sıralı; 3.7 sn/sayfa. Birkaç paralel istek (crawl-delay'e saygılı)
   aynı 90 saniyede kat kat fazla sayfa demek. **Bütçe sorununun asıl çözümü bu.**
4. **`normalizeUrl` kendi 301'ini üretiyor `[C]`.** Sondaki `/` siliniyor → Yoast'ın `/sayfa/`
   URL'i `/sayfa` olarak isteniyor → site 301'le geri yolluyor → **her sayfa 2 istek**. Ölçüldü:
   slash'sız 0.59 sn, slash'lı 0.35 sn (~%70 fazladan ağ yükü).
5. **Zaman bütçesini görünür yap `[D]`.** Şemada da, açıklamada da, docs'ta da geçmiyor.
   `max_urls: 1–100, default 100` **tutulamayan bir söz** — gerçek tavan zaman.
6. **Bütçe dolunca AÇIKÇA uyar.** Cevap "skipped 43" diyor; "90 sn doldu, **ana sayfan dahil**
   43 sayfa taranamadı, `include_paths` ile daralt ya da tekrar çalıştır" demeli.
7. **Kısmi kapsamada ücret.** %36 kapsama için tam 20 kredi alındı. *(Fiyat kararı = NEVER#6,
   yalnız bulgu olarak yazıldı.)*
8. **"0 issue(s) found" yanıltıcı `[D]`.** 43 sayfası düşmüş taramada "0 sorun" cümlesi
   "siten temiz" diye okunuyor.

**Öncelik: EN YÜKSEK. (1) tek satır, (3) en büyük kazanç, (6) en ucuz dürüstlük.**

---

## 8. `audit_onpage` — 30 kredi (**en pahalı denetim**)
**Gözlenen:** **DOĞRU.** 3 bulgu üretti, üçü de gerçek. "Temiz" dediği üç sayfayı elle
doğruladım (`curl` + parse): title, meta description, tek h1, canonical hepsi yerinde,
1168–1832 kelime. Uydurmuyor. Trailing-slash canonical'ı **bilerek** tolere ediyor
(`onpage.ts:41 sameUrl`) — benim "kaçırdı" hipotezim yanlış çıktı, tool haklı.

**Geliştirme alanları**
1. **Kural seti dar, fiyat en yüksek.** 30 kredi karşılığında 5 kontrol: title / meta / h1 /
   canonical / ince içerik. 24 sayfada tek bir bulgu tipi çıktı ("title too long" ×3).
2. **Eksik kontroller (piyasa standardı):** site içi **duplike** title/meta, title↔h1 uyumu,
   görsel `alt` eksikliği, iç link derinliği/yetim sayfalar, kırık iç linkler, `noindex`
   kazaları, Open Graph eksikleri.
3. **Eşik karakter bazlı.** "title too long (64 chars)" — Google **piksel** genişliğine bakar;
   Türkçe geniş karakterlerde 64 karakter farklı, İngilizcede farklı davranır.
4. **Önceliklendirme yok `[F]`.** Bulgular düz liste; hangisi önce yapılmalı belli değil.
5. **"Neden / nasıl" yok `[F]`.** "title too long" diyor, önerilen başlık vermiyor.

**Öncelik: orta-yüksek — fiyat/değer dengesizliği en görünür burada.**

---

## 9. `audit_tech` — 15 kredi
**Gözlenen:** Atlanan 43 URL'i **sebebiyle birlikte** dökümledi (bu iyi — #3'ün bilgisi burada).
Ama: **"HTTP status: 24 ok, 0 redirect (3xx)" ve "Redirects surfaced: 0"** — oysa ölçtüm,
taranan 24 URL'in **24'ü de 301**. → **#6 🔴**

**Geliştirme alanları**
1. **🔴 Yönlendirme körlüğü.** `PageRecord`'da (crawl.ts:25-38) yönlendirme zinciri alanı **yok**;
   `fetchPage` 301'i döngüde izleyip yutuyor, yalnız nihai status'ü (200) yazıyor → `audit_tech`
   3xx'i `page.status`'ten saydığı için sonuç **daima 0**. Kod bunu biliyor ve yorumda yazıyor
   (tech.ts:8-12) → hata değil **kapsam sınırı**. Ama müşteri "Redirects: 0" satırını
   "sorunum yok" diye okur. **Faz 3'te `PageRecord.originalUrls` borcu kaydedilmişti
   (PLAN.md:91), ödenmedi.** Düzeltmesi: zinciri kaydet, gerçek 3xx raporla.
2. **Eksik kontroller (bir "teknik denetim"den beklenenler):** sayfa hızı/Core Web Vitals,
   mobil uyum, HTTPS & karışık içerik, `hreflang`, sitemap↔robots tutarlılığı, kırık iç linkler,
   yönlendirme **zinciri/döngüsü**, kanonik çatışmaları.
3. **Atlanan liste burada olmamalı.** 43 satırlık döküm `crawl_site`'ın işi; `audit_tech`
   çıktısının çoğunu bu kaplıyor ve asıl teknik analiz cılız kalıyor.
4. **"Robots conflicts (noindex but internally linked)" iyi bir kontrol** — korunmalı.

**Öncelik: yüksek — (1) tool'un ana vaadi.**

---

## 10. `audit_schema` — 5 kredi
**Gözlenen:** 24/24 sayfada JSON-LD, 6 tip. Açıkça **"only @type names are analyzed, never the
JSON-LD body"** diyor — bu dürüstlük **iyi ve korunmalı**. → **#11 🟢**

**Geliştirme alanları**
1. **Zorunlu alan doğrulaması yok.** `BlogPosting` için `headline`/`datePublished`/`author`/`image`
   var mı bakmıyor — Rich Results'ın umursadığı tam olarak bu.
2. **Sayfa kırılımı yok.** "24 sayfada BlogPosting" diyor; **hangi** sayfada hangi tip eksik demiyor.
3. **Microdata/RDFa okunmuyor** (açıklamada dürüstçe yazıyor).
4. **Fiyatı dürüst.** 5 kredi, en ucuz denetim; beklenti açıklamada zaten yönetilmiş.
   Bu yüzden 🟢 — "sığ ama yalan söylemiyor".

**Öncelik: düşük. Fiyat/değer dengesi bu tool'da doğru kurulmuş — diğerlerine örnek.**

---

## 11. `generate_report` — 15 kredi · **ürünün satış yüzü**
**Gözlenen:** `/r/XubxZtU6TfE` 200 dönüyor, düzgün render ediyor, `noindex` yerinde (D29 canlı),
XSS yok. → **#8 · #9 · #10**

**Geliştirme alanları**
1. **GSC çelişkisi `[A]` (#8).** Rapor "No Search Console data yet — **Connect it with
   `connect_gsc`**" diyor; oysa GSC **bağlı**. Aynı proje için `whats_next` "is connected" diyor.
   İki canlı tool çelişiyor. Doğrusu: "bağlı, veri çekilmemiş → `pull_gsc_data`".
2. **Çağrılar yanlış kitleye (#9).** Tool kendini "share with clients or teammates" diye satıyor,
   gövdede 3 kez "Run `audit_onpage`…" yazıyor. **Raporu alan müşterinin hesabı yok.**
3. **"43 Pages skipped" çıplak sayı (#10) `[D]`.** Müşteriye giden belgede sebepsiz; ilk soru
   "neden?" olur, cevabı belgede yok.
4. **Beyaz etiket yok.** Ajans müşterisine gönderilecek belgede ajansın logosu/adı yok, altta
   "powered by SeoGrep" var. Ajans müşterisi için bu **satın alma engeli**.
5. **PDF/indirme yok** — ajanslar rapor eki gönderir.
6. **Karşılaştırma yok.** Tek anlık görüntü; "geçen aya göre" yok, oysa iki GSC penceresi
   (`pull_gsc_data`) zaten elde.

**Öncelik: orta-yüksek. (1) hata sayılır, (4)-(5) ticari.**

---

# GSC AİLESİ (4)

## 12. `pull_gsc_data` — 5 kredi
**Gözlenen:** İlk canlı koşu, sorunsuz. 241 / 256 satır. **2026-07-28'de alınmış refresh token
10 gün sonra çalıştı** → OAuth doğrulamasının tuttuğu canlıda kanıtlandı.

**Geliştirme alanları**
1. **Hangi property'den çekildiği cevapta yok.** Kullanıcı `https://adstark.com.tr/` mi yoksa
   `sc-domain:` mi olduğunu göremiyor — yanlış property bağlıysa fark edemez.
2. **Veri gecikmesi açıklanmıyor.** Pencere bugünden 3 gün geride bitiyor (GSC'nin normali) ama
   kullanıcı bunu "eksik veri" sanabilir. Tek cümle yeter.
3. **Büyük sitede davranış ölçülmedi.** 241 satır küçük; satır tavanı/sayfalama var mı denenmedi.
4. **5 kredi çok uygun** — fiyat/değer dengesi doğru.

**Öncelik: düşük. Tool sağlıklı.**

---

## 13. `find_quick_wins` — 10 kredi · **turun EN İYİ çıktısı**
**Gözlenen:** 6 gerçek sorgu, gerçek pozisyon/gösterim, doğru URL. Bir SEO danışmanının o gün
üzerinde çalışacağı liste. 10 krediye fazlasıyla değer.

**Geliştirme alanları**
1. **Crawl verisiyle birleşmiyor `[C]` (#13) — en değerli eksik.** "Bu sayfa 16. sırada" diyor
   ama "üstelik title'ı çok uzun ve meta'sı yok" diyemiyor, çünkü GSC `/sayfa/`, crawler `/sayfa`
   yazıyor → **join tutmuyor**. İki veri kaynağının birleşimi bu ürünün en güçlü vaadi olurdu.
2. **Neden "quick win" olduğu yazmıyor `[F]`.** 8–20 pozisyon + hacim mantığı gizli.
3. **Eylem önerisi yok `[F]`.** "16. sıradasın" ile "ne yapayım" arasındaki boşluk kullanıcıda.
4. **Tahmini kazanç yok.** "16 → 8 çıkarsan ~X tık" hesabı elde olan veriyle yapılabilir.
5. **İronik ama gerçek:** listenin 1 numarası `/sosyal-medya-reklam-yonetimi/` — **crawl'ın
   atladığı** sayfa. Ürün "şunu iyileştir" diyor, kendi denetimi o sayfayı hiç görmemiş (#2).

**Öncelik: (1) yüksek değer · diğerleri orta.**

---

## 14. `detect_cannibalization` — 10 kredi
**Gözlenen:** Gerçek sitedeki **tek** sonucu **yanlış pozitif**: marka sorgusu `"adstark"`.
Desen tam sitelink imzası — ana sayfa 3.9, dört iç sayfa **tam 1.0**. → **#12 🔴**

**Geliştirme alanları**
1. **🔴 Marka/navigasyonel sorgu filtresi yok.** Kural tamamen mekanik (`cannibalization.ts`:
   `MIN_PAGE_IMPRESSIONS=10`, `MIN_SHARE=0.1`, ≥2 sayfa). Marka bilinirliği olan **her** sitede
   marka sorgusu bu tool'un ilk sonucu olacak. Alan adına/marka adına benzeyen sorgular elenmeli.
2. **Sitelink deseni tanınmıyor.** "Biri ~1-4 + birkaçı tam 1.0" → yamyamlaşma değil, **sağlıklı**
   marka SERP'i. Bu desen kural olarak yazılabilir.
3. **Sorgu niyeti ayrımı yok.** Bilgi amaçlı sorguda iki sayfanın çıkması normaldir; ticari
   sorguda sorundur.
4. **Eylem önerisi yok `[F]`.** Birleştir mi, canonical mi, de-optimize mi?
5. **Zarar potansiyeli:** bunu ciddiye alan kullanıcı kendi marka sayfalarını de-optimize etmeye
   kalkar. Yanlış pozitif burada **nötr değil, zararlı**.

**Öncelik: yüksek.**

---

## 15. `analyze_content_decay` — 10 kredi
**Gözlenen:** "Bulgu yok" dedi ve **DOĞRU söyledi.** İddiayı kabul etmeyip ham GSC pull'unu
SQL'le kendim topladım: iki pencere arasında tıklama kaybeden **tek** sayfa var — ana sayfa,
13 → 9 (−4). Hiçbir makul eşiği geçmez. **Gerçek negatif, eşik artefaktı değil.**

**Geliştirme alanları**
1. **Eşiğini söylemiyor `[D]`.** "Bulgu yok" derken neye göre yok olduğunu yazmıyor; kullanıcı
   "tool çalıştı mı, yoksa sitem mi iyi?" ayrımını yapamıyor.
2. **Düşük trafikte hep boş dönecek.** Bu site 90 günde ana sayfada ~9-13 tık alıyor. Kusur
   değil, **doğal sınır** — ama 10 kredi alınmadan önce söylenebilir: "bu pencerede anlamlı
   analiz için yeterli veri yok".
3. **Ücretsiz ön kontrol yok.** `crawl_site`'ın ücretsiz ön-keşfi gibi, "yeterli veri var mı"
   kontrolü ücretlendirmeden önce yapılabilir → boş sonuca 10 kredi ödenmez.
4. **Mevsimsellik ayrımı yok.** Yaz düşüşü decay değildir; yıl-üstü-yıl karşılaştırması bunu ayırır.

**Öncelik: orta — (3) fiyat adaleti açısından en anlamlısı.**

---

# PREMIUM / DataForSEO (4)

## 16. `research_keywords` — 25 kredi
**Gözlenen:** Çalışıyor, gerçek veri: hacim / CPC / rekabet. `n/a` dönen kelimeyi toplamdan
doğru çıkarıyor (90+210+1900 = 2.200 ✓). → **#21 🟢**

**Geliştirme alanları**
1. **ABD/İngilizce varsayılanı `[B]`.** `location_code: 2840`, `language_code: "en"`.
2. **Kelime ÖNERMİYOR.** Adı "research" ama yalnız **verilen** listeyi ölçüyor. İlgili kelime /
   soru / uzun kuyruk keşfi yok → kullanıcı ne soracağını **zaten bilmek** zorunda. Bir anahtar
   kelime aracından beklenen birinci şey bu.
3. **`n/a` dönen kelimeye de tam ücret.** 100 kelimenin 100'ü `n/a` dönse yine 25 kredi.
4. **Zorluk (KD) ve SERP görünümü yok** — "bu kelimeyi alabilir miyim?" sorusuna cevap vermiyor.

**Öncelik: (2) ürün açısından en büyük eksik.**

---

## 17. `ranked_keywords` — 65 kredi
**Gözlenen:** Aynı domain, aynı 65 kredi, iki koşu: **varsayılan (en/2840)** → 3 kelime, hepsi
volume 30, tek sayfa. **doğru (tr/2792)** → 4 kelime, volume 210/480/**3.600**/1.600, dört sayfa.
→ **#18 🔴**

**Geliştirme alanları**
1. **🔴 Ülke/dil `[B]`.** Tool `project_id` değil çıplak `target` alıyor → proje bağlamı sıfır.
   `.com.tr` ccTLD ülkeyi apaçık söylüyor, hiçbir uyarı yok. Türk kullanıcı 65 kredi ödeyip
   ~boş sonuç alıyor, doğrusunu bulmak için 65 kredi daha ödüyor.
2. **`location_code` ham vendor kodu.** Başlıkta "(language en, location **2840**)" yazıyor —
   dürüst ama kullanıcıya "United States" demiyor. En azından adını yaz; idealde ülke adı kabul et.
3. **`project_id` kabul etsin.** Hem bağlam gelir hem kullanıcı alan adını tekrar yazmaz.
4. **Sonuç boşsa uyar.** "0-3 sonuç geldi; `location_code` sitenin ülkesiyle uyuşmuyor olabilir"
   cümlesi bu 🔴'yi tek başına yarı yarıya söndürür.
5. **65 kredi / 4 satır** — *(fiyat = NEVER#6, yalnız bulgu.)*

**Öncelik: yüksek. (4) en ucuz hafifletme, (1) gerçek çözüm.**

---

## 18. `analyze_backlinks` — 70 kredi · **ÜRÜNDEKİ EN CİDDİ KUSUR**
**Gözlenen:** İlk gerçek koşuda **çöktü** (ref `5ded2b4e`). Fly log'u:
`anchors result was not in the expected shape: expected string, received null → at items[1].anchor`.
→ **#15 🔴 + #16 🔴**

**Geliştirme alanları**
1. **🔴 `null` anchor şeması `[E]`.** `backlinks.ts:105` yorumu **doğru olanı yazmış** —
   "An empty `anchor` is legitimate (image links carry no anchor text)" — ama tip `anchor: string`
   (107) ve şema `z.string()` (216): `""` kabul, `null` **red**. DataForSEO görsel bağlantılarda
   `null` gönderiyor. **7 fixture'ın hiçbirinde `null` anchor yok** (ölçtüm) → tüm testler yeşil,
   ilk canlı çağrı ölüyor. Görsel backlink'i olmayan alan adı neredeyse yok → tool **pratikte
   hiçbir müşteride çalışmaz**. Düzeltmesi `z.string().nullish()` + `""` fallback: **tek satır.**
2. **🔴 Açık DFS rezervasyonu, reaper kapsamıyor.** Çökünce `dfs_spend`'de `backlinks/summary/live`
   satırı `status='open'`, `actual_usd=NULL` kaldı → günlük bütçeye **tahmini $0.30** olarak
   yazılmaya devam ediyor. **`reaper.ts`'te "dfs" kelimesi 0 kez geçiyor** (ölçtüm). Ölçüm:
   kapının gördüğü $0.5956 / gerçek $0.2956 → **hayalet $0.30**. Aritmetik: **10 çökme = $3.00 =
   günlük tavan, $0 gerçek harcamayla** → o gün **ödemiş** müşterilere tüm DFS tool'ları kapanır.
   PR #37'nin engellemek için yazıldığı hizmet-kesme senaryosu, kazayla ve bedavaya.
3. **Diğer DFS şemalarını tara `[E]`.** Aynı sınıf hata `backlinks_summary`, `referring_domains`,
   `competitors`, `ranked_keywords` şemalarında da olabilir — **taranmadı**. `null` gelebilecek
   her metin alanı gözden geçirilmeli.
4. **Fixture'lara aykırı varyant ekle.** `null` anchor, boş liste, eksik alan.
5. **Canlı sözleşme testi.** NEVER#5 test/CI'da gerçek çağrıyı yasaklıyor ve bu doğru; ama
   **elle tetiklenen**, ayda bir, tek çağrılık bir "vendor şeması hâlâ uyuyor mu" koşusu bu
   sınıfı tamamen yakalar. Bu oturumun asıl dersi bu.
6. **Para tarafı DOĞRU davrandı:** `spend_reserve −70` → **`spend_release +70`**, kullanıcı
   ücretlendirilmedi. Bu, iade yolunun canlıdaki **ilk kanıtı**.

**Öncelik: EN YÜKSEK — ikisi zincirli. (1) tek satır, (2) müşteriye hizmet kesintisi.**

---

## 19. `compare_competitors` — 90 kredi · **en pahalı tool**
**Gözlenen:** Varsayılan otomatik modda küçük bir Türk ajansı için bulduğu rakipler:
**youtube.com · wikipedia.org · linkedin.com**. Tablo "ETV 12, $5" ile "ETV 331.336.437,
$94.699.777"yi yan yana koyuyor. **AMA** `competitors:["zeo.org"]` ile koşunca çıktı
**mükemmel**: adstark 4 SERP / ETV 12 / 0 top-20 vs zeo.org 313 SERP / ETV 24.694 / 11 adet #1.
→ **#17 🔴**

**Geliştirme alanları**
1. **🔴 Otomatik rakip seçimi bozuk.** Ölçüt "hedefle kaç organik SERP paylaşıyor" — 4 kesişen
   kelimede dev genel-amaçlı siteler her zaman kazanır. **Yetenek var, varsayılan yol bozuk**;
   şema da varsayılanı öneriyor ("Omit this to let DataForSEO pick them").
2. **Dev/genel siteleri ele.** youtube, wikipedia, linkedin, facebook, instagram, pinterest,
   amazon… bir kara liste tek başına sonucun çoğunu düzeltir.
3. **Büyüklük bandı filtresi.** Hedefin 100.000 katı trafiği olan site rakip değildir; ETV/SERP
   oranına bir üst sınır konabilir.
4. **Anlamlı rakip yoksa dürüstçe söyle.** Saçma liste vermektense "bu kesişimde anlamlı rakip
   bulunamadı, `competitors` ile kendin belirt" demek hem dürüst hem daha faydalı.
5. **Ülke/dil `[B]`** — #18 ile aynı.
6. **Açık modu öne çıkar.** Açıklama şu an otomatik modu öneriyor; iyi çalışan yol **açık mod**.
   Açıklamayı tersine çevirmek **kod değişikliği bile değil**, en ucuz düzeltme.

**Öncelik: yüksek. (6) bugün yapılabilir, (2) küçük, (1) gerçek çözüm.**

---

# Toplu görünüm

| # | Tool | Kredi | Bu oturumdaki durum | Öncelik |
|---|---|---|---|---|
| 18 | `analyze_backlinks` | 70 | **çöküyor + bütçe sızdırıyor** | 🔥 en yüksek |
| 7 | `crawl_site` | 20 | ana sayfayı taramıyor | 🔥 en yüksek |
| 19 | `compare_competitors` | 90 | varsayılan mod çöp | yüksek |
| 17 | `ranked_keywords` | 65 | varsayılan ülke yanlış | yüksek |
| 14 | `detect_cannibalization` | 10 | tek sonucu yanlış pozitif | yüksek |
| 9 | `audit_tech` | 15 | yönlendirme körü | yüksek |
| 6 | `whats_next` | 0 | denetim dalını yutuyor | yüksek (ücretsiz) |
| 11 | `generate_report` | 15 | GSC çelişkisi + yanlış kitle | orta-yüksek |
| 8 | `audit_onpage` | 30 | doğru ama dar | orta-yüksek |
| 1 | `setup_project` | 0 | ülke alanı yok (B'nin kökü) | orta-yüksek |
| 16 | `research_keywords` | 25 | öneri üretmiyor | orta |
| 15 | `analyze_content_decay` | 10 | doğru; boş sonuca tam ücret | orta |
| 4 | `get_credit_balance` | 0 | trial/paid demiyor | orta |
| 5 | `get_job_status` | 0 | ilerleme yok | orta |
| 2 | `connect_gsc` | 0 | bağlıyken de "bağlan" | orta |
| 13 | `find_quick_wins` | 10 | **iyi**; crawl ile birleşmiyor | orta |
| 3 | `list_projects` | 0 | durum sütunu yok | düşük |
| 12 | `pull_gsc_data` | 5 | **sağlıklı** | düşük |
| 10 | `audit_schema` | 5 | **sığ ama dürüst** | düşük |

**En iyi üç tool:** `find_quick_wins` (gerçek değer) · `audit_onpage` (doğruluk) ·
`audit_schema` (fiyat/değer dürüstlüğü — diğerlerine örnek).

**Bir cümle:** para yolu, güvenlik ve altyapı **sağlam**; kusurların tamamı ürünün
*kapsamında* ve *anlatımında*. Ürün yanlış bir şey söylemiyor — **eksik** söylüyor.
