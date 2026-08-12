# `/app/connection` — bağlantı yüzeyi kullanılabilir hâle getirilir

> 2026-08-12 · Durum: **tasarım onaylandı** (operatör, bu oturumda)
> Fiyat/kredi rakamı DEĞİŞMEZ (NEVER#6). Bu spec hiçbir fiyat kalemine dokunmaz.
> Şema DEĞİŞMEZ. Bu spec yalnız sunum katmanını değiştirir.

## Problem — operatörün ekranından ölçüldü, tahmin edilmedi

Operatör hesabını disconnect etti ve **çıkmaz sokağa** düştü. Ekran görüntüsünden okunan üç kusur:

| # | ne | kanıt |
|---|---|---|
| 1 | **Bağlanma yolu görünmüyor.** `Connect Google account` düz bir `<a>` ve gövde metniyle aynı görsel ağırlıkta — bir bölüm başlığı gibi duruyor. Disconnect sonrası sayfadaki tek çıkış o. | `page.tsx`, `self-start font-medium text-neutral-700` |
| 2 | **Sıfır hesap durumu gürültü üretiyor.** Dokuz proje satırının dokuzu da aynı paragrafı tekrar ediyor ("No Search Console properties are available for this project yet…"), dropdown hiç yok. Ekran bilgi vermiyor. | ekran görüntüsü, 9 satır |
| 3 | **Yetkili property listesi hiçbir yerde yok.** Kullanıcı bağlandıktan sonra Google'da neye erişimi olduğunu göremiyor; yalnız proje başına öneri görüyor. | `page.tsx` — `sites.list` yalnız dropdown seçeneği üretiyor |

**Bağlam şerhi, dürüstlük için:** operatör **çalışan bağlı hâli hiç görmedi**. Sayfa 2026-08-11'de bir RSC sınır ihlali yüzünden her render'da çöküyordu (PR #71 ile düzeltildi); ardından disconnect edildi. Yani "yarım yamalak" hükmünün bir kısmı hiç render olmamış bir ekrandan geliyor. Buna rağmen 1, 2 ve 3 bağımsız olarak doğrulandı ve gerçek.

## Alınan kararlar

| karar | kim | ne |
|---|---|---|
| Property'ler proje YARATMAZ | şef önerdi, operatör onayladı | Search Console ürünün giriş kapısı olmaz; projeler yalnız MCP `setup_project` ile doğar |
| Kutu = **envanter**, atama proje satırında | şef | Şema dayatıyor (aşağıda) |
| Kapsam yalnız sunum | şef | Migration yok, şema yok, fiyat yok |

### Neden property'den proje yaratılmıyor — reddedilen seçenek yazılır

Değerlendirildi ve **reddedildi**: "kutudan seçilen her property için karşılığı yoksa proje aç."

1. Ürünün modelini ters çevirir. `crawl` ve `audit` araçları GSC olmadan çalışır; GSC bir **zenginleştirme**, giriş kapısı değil.
2. İkinci bir proje yaratma yolu açar. Bugün tek yol var (`setup_project`), tek yer invariant taşıyor.
3. Alan adı ↔ property eşlemesi 1:1 **değil**: `sc-domain:katrenur.com`, `https://www.bigcattr.com/`, `https://adstark.com.tr/` aynı ürün içinde bir arada. `resolveGscProperty` zaten tam bu belirsizlik için var ve güvenlik pinleri taşıyor (`blog.example.com` apex'e bağlanamaz).
4. Proje yaratmak kredi/trial muhasebesine dokunur — bir **ürün ve fiyat kararı**, bir UI düzeltmesinin içine kaçak binmemeli.

Ayrı bir konu olarak açık kalır.

### Neden kutu ters yönde kurulmuyor — şemadan çıkan kısıt

`gsc_connections` üzerinde `unique (user_id, project_id)`. Yani:

- bir **proje** en fazla **bir** property okur;
- bir **property** birden çok projeye verilebilir (spec 2026-08-09, bilinçli izin).

Kutuyu "property → çok proje" yönünde kurmak, ekranın veritabanının söylemediği bir şeyi vaat etmesi olurdu. Bu yüzden **iki ayrı liste**:

- **Envanter** — "Google'da neye yetkin var" (Google'ın gerçeği, `sites.list`)
- **Atama** — "hangi proje neyi okuyor" (bizim kaydımız, `gsc_connections`)

İkisini tek listede birleştirmek, **farklı oldukları durumu görünmez kılar** — ki operatörün bugünkü durumu tam olarak odur (7 saklı eşleme, 0 bağlı hesap).

## Tasarım

### 1 · Sıfır hesap durumu

- `Connect Google account` **birincil buton** olur (bugünkü düz link değil). Sayfadaki tek çıkış yolu olduğu için görsel ağırlığı da öyle olmalı.
- Altında tek satır: ne yapacağını söyler.
- Proje listesi **dokuz paragrafa değil tek cümleye** iner: *"Connect a Google account to choose which Search Console property each project reads."*
- Proje satırları yine görünür (kullanıcı projelerini görmeye devam eder) ama her satır tekrar eden açıklama yerine yalnız `Not connected` rozeti taşır.
- **Seçenek yokken dropdown RENDER EDİLMEZ.** Boş bir `<select>` seçilecek bir şey varmış gibi durur; bugünkü ekranın gürültüsünün kaynağı da bu. Satırda yalnız rozet kalır, açıklama sayfa düzeyindeki tek cümledir.
- **Saklı eşleme yine gösterilir.** Operatörün yedi projesinde `gsc_property` duruyor ve `account_id` null; o satırlar "daha önce şu property kaydedilmişti" bilgisini korur (2026-08-11'de eklenen `retained` notu), çünkü kaybın kendisi bilgidir.

### 2 · Bağlı hâl — property envanteri (YENİ)

Her bağlı hesap için, `sites.list`'in döndürdüğü **her property** bir satır:

| alan | içerik |
|---|---|
| property | dizgi birebir (`sc-domain:` biçimi dahil) |
| yetki | `permissionLevel`, olduğu gibi |
| kullanım | onu okuyan proje adı/adları, ya da `Not used` |

- **Sorgulanamayan** property'ler pasif gösterilir ve sebebi yazılır (bugünkü `canQuerySearchAnalytics` kuralı, davranışı değişmez).
- **Karşılığında proje olmayan** property açıkça işaretlenir ve `setup_project` yolu yazılır — çıkmaz sokak bırakılmaz.
- Listeleme **okunamadıysa** (ölü kimlik bilgisi) envanter "okunamadı" der; **yok** demez. Bu, 2026-08-11'de düzeltilen aynı dürüstlük kuralıdır.

### 3 · Ekleme / çıkarma

- **Ekle** = proje satırındaki dropdown'dan property seç → `Save`. Sunucu `sites.list`'i yeniden çeker ve hem listelenmiş hem sorgulanabilir olduğunu doğrular (mevcut `saveProjectProperty`, değişmez).
- **Çıkar** = `Unmap` → Google'a **dokunmaz**, yalnız eşleme kalkar (mevcut `unmapProject`, değişmez).
- **Hesabı kaldır** = hesap satırında `Disconnect` → Google'da yetkiyi iptal eder ve kaç projeyi etkileyeceğini **sayıyla** söyler (mevcut `disconnectAccount` + `describeDisconnect`, değişmez).

### 4 · Çıkmaz sokak kapanır

`Connect Google account` **her durumda** görünür: sıfır hesapta da, bağlıyken de (ikinci hesap eklemek için). Operatörü tıkayan tam olarak bunun yokluğuydu.

## Kapsam DIŞI — bilinçli

- Şema değişikliği, migration — **yok**.
- Proje yaratma — yok (yukarıda gerekçeli reddedildi).
- `saveProjectProperty` / `unmapProject` / `disconnectAccount` / `accessTokenFor` **davranışı** — değişmez; yalnız çağrıldıkları yüzey değişir.
- `resolveGscProperty` — davranışı ve güvenlik pinleri **değişmez**; öneri kaynağı olarak kalır.
- `/app?gsc=…` vs `/app/connection?error=…` sözlük birleştirmesi — ayrı iş (7c).
- Fiyat, kredi, paket rakamı — **NEVER#6**, dokunulmaz.

## Test ve kapı

- Sıfır hesap durumu: buton görünür, tek cümle görünür, dokuz paragraf **yok**.
- Envanter: sorgulanabilir/sorgulanamaz/projesiz/okunamadı — dördü de pinlenir.
- Envanterin "okunamadı" hâli **yokluk iddia etmez** (2026-08-11 dürüstlük kusurunun tekrarını önler).
- `rsc-boundary.test.ts` yeşil kalır — sunucu bileşeni client modülünden **değer** import etmez.
- Kapı: `TURBO_FORCE=1 bash guardrails/verify.sh` → `VERIFY: PASS`, 16/16, `Cached: 0`.
- **Mutasyon zorunlu:** her yeni iddia kasten bozulup kırmızıya döndüğü görülür. Bu planda dört prescribed mutasyon hiçbir şeyi kırmızıya döndürmedi; yazan koşmamıştı.

## Bilinen sınır — ölçülmeyen şey

Bu tasarım **gerçek tarayıcıda** doğrulanmadan tamamlanmış sayılmaz. 2026-08-11 kesintisi tam olarak testlerin göremediği bir sınırdaydı: `next build` kabul etti, `page.test.tsx` client bileşenleri mock'luyordu, vitest'te RSC sınırı yoktu. Bitiş kanıtı, operatörün sayfayı açıp bir property kaydetmesi ve `pull_gsc_data`'nın satır getirmesidir.
