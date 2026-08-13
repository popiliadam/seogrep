# GSC property takibi — dahil et / çıkar / geri al

> 2026-08-13 · Durum: **tasarım onaylandı** (operatör, bu oturumda)
> Fiyat/paket rakamı DEĞİŞMEZ. Üç yeni tool **0 kredi** ile eklenir — bu bir kredi kalemi
> yazımıdır ve operatör onayı bu oturumda alınmıştır (NEVER#6).
> Şema DEĞİŞİR: migration `0022`, `projects` tablosuna tek nullable kolon.
> `credit_ledger`'a dokunulmaz (NEVER#2 etkilenmez).

## Problem — operatörün canlı ekranından ölçüldü, tahmin edilmedi

Operatör: *"connection sekmesinde GSC alanı darma duman görünüyor."*

Ölçüm, oturum içinde canlı `/app/connection` üzerinde yapıldı (DOM sorgusu, ekran görüntüsü değil):

| ölçüm | değer |
|---|---|
| Bağlı Google hesabı | 1 — `suleymanncapar@gmail.com` |
| Envanterdeki property | **27** |
| Fiilen okunan property | **1** (`https://rkturizm.com/` → `adstark.com.tr`) |
| "Not used" satırı | 26 |
| Seçilemeyen (disabled) option | 5 — hepsi `siteUnverifiedUser` |
| Proje | **9**, bağlı olan **1**, bağlı olmayan **8** |
| Her proje satırındaki `<option>` | 28 (placeholder + 27) |
| Sayfadaki toplam `<option>` | **243** |
| Sayfa yüksekliği | 2697px |

**Kusur nicel:** ekran 243 option ve 27 envanter satırı basıyor, hepsi tek bir gerçeği anlatmak
için — 26 property hiçbir işe yaramıyor. Sinyal 243'te 1.

**Operatörün önceki oturumdaki şikâyeti ("bazıları seçilemiyor") ise ayrı ve küçük:** 27'nin
yalnız 5'i disabled ve hepsi `siteUnverifiedUser`. `canQuerySearchAnalytics` bunları kasten
kapatıyor ve Google'ın dokümanına göre doğru yapıyor; `siteRestrictedUser` **seçilebiliyor**.
Yani o davranış doğru, kusur değil. Bu spec onu değiştirmez.

## Bir gün önceki imzalı kararın TERSİ — gerekçesi yazılır

`2026-08-12-gsc-connection-ui-design.md`, operatör onayıyla, "property'den proje YARATILMAZ"
kararını dört gerekçeyle yazdı. Bu spec onu **bilinçli olarak geri alır**. Dört gerekçe tek tek
ölçüldü:

| dünkü gerekçe | bugünkü ölçüm | sonuç |
|---|---|---|
| "Proje yaratmak kredi/trial muhasebesine dokunur — bir fiyat kararı" | `TOOL_COSTS.setup_project = 0`; kod tabanında proje kotası, plan limiti veya sayaç **yok** | **geçersiz** |
| "Alan adı ↔ property 1:1 değil" | Belirsizlik `domain → property` yönünde (bir domain'in 6 adayı var, `gscPropertyCandidates`). İhtiyacımız olan ters yön **tek anlamlı**: bir property tam bir domain'e çözülür | **yarı geçerli** |
| "GSC giriş kapısı olmaz; crawl/audit onsuz çalışır" | Karşılandı: omurga proje kalır, property'siz projeler (`example.net`) ekranda görünmeye devam eder | **karşılandı** |
| "İkinci bir proje yaratma yolu açar" | Doğru ve gerçek bedel | **geçerli** — azaltması aşağıda |

Tek ayakta kalan gerekçenin azaltması: `track_gsc_property` kendi `INSERT`'ünü yazmaz;
`setup_project`'in kullandığı normalize + upsert yolunu **paylaşır**. Proje yaratma invariant'ı
tek yerde kalır, çağıran iki olur.

## Alınan kararlar

| karar | kim | ne |
|---|---|---|
| "Dahil et" = **takibe al** | operatör | Property dahil edilince projesi açılır (ya da arşivden döner) ve eşlenir — tek çağrı |
| "Çıkar" = **arşivle**, silme değil | operatör | Geçmiş işler ve GSC eşlemesi korunur; "Geri al" aynı `id`'yi döndürür |
| Omurga **proje**, property değil | şef önerdi, operatör onayladı | Ölçülen üç delik yüzünden (aşağıda) |
| MCP'de **üç** tool | operatör | Fiil başına bir ad; hepsi 0 kredi |

### Neden liste saf property ekseninde kurulmuyor — üç ölçüm

Operatör önce saf property listesine meyletti. Ölçüm üç delik gösterdi:

1. **`example.net` projesinin hiç property'si ve önerisi yok.** Liste property'lerden kurulursa
   bu proje sayfada hiç görünmez — oysa crawl ve audit onun için çalışıyor. Property'siz proje
   bir arıza değil, ürünün kurucu kararı (`connect_gsc`: *"OAuth is deliberately the SECOND
   step"*).
2. **`adstark.com.tr` projesi `https://rkturizm.com/` property'sini okuyor.** Adlar tutmuyor,
   yani "property'den projeyi türet" kuralı bugünkü veride zaten yanlış. Ad-tutmayan eşleme için
   elle bir yol kalmak zorunda.
3. **`rkturizm.com` hem bir proje hem başka bir projenin okuduğu property.** Aynı property iki
   projeye aday; çakışma görünür olmalı (`gsc_connections`'ın `unique (user_id, project_id)`
   kısıtı bunu yasaklamıyor — bilinçli izin, spec 2026-08-09).

Sonuç: etkileşim property listesinden alınır (düz satır, satır başına tek düğme, dropdown yok),
**omurga proje kalır**.

## Tasarım

### 1 · Migration `0022`

```sql
alter table public.projects add column archived_at timestamptz;
-- Reverse: alter table public.projects drop column archived_at;
```

Tek nullable kolon. Varsayılan `null` = aktif. Silme yok, veri kaybı yok, RLS politikaları
değişmez.

**`unique (user_id, domain)` (migration 0010) "Geri al"ı bedavaya veriyor.** Arşivlenmiş
`katrenur.com` dururken aynı domain'i `INSERT` etmek zaten imkânsız — kısıt patlar. Bu yüzden
tek doğru davranış: eşleşen arşiv satırını bul, `archived_at = null` yap. "Geri al" ayrı bir kod
yolu değil, track'in doğal sonucudur: aynı `id`, aynı geçmiş, aynı `gsc_connections` satırı.

### 2 · Paylaşılan saf mantık → `packages/core/src/gsc/property.ts` (yeni dosya)

Bugün `canQuerySearchAnalytics` ve `gscPropertyCandidates` yalnız `apps/web/lib/gsc/oauth.ts`
içinde; `packages/core/src/gsc/` altında sadece `client.ts` ve `crypto.ts` var. MCP'nin bu
mantığa erişimi **yok**, üç yeni tool ikisine de muhtaç.

- **`canQuerySearchAnalytics` taşınır**, `oauth.ts` onu re-export eder. Mevcut testlerin
  hiçbiri değişmez — davranış birebir aynı, pin'ler yerinde kalır (NEVER#8).
- **`propertyToDomain(property)` yeni.** `gscPropertyCandidates`'in tersi:
  - `sc-domain:balerin.com` → `balerin.com`
  - `https://www.bigcattr.com/` → `www.bigcattr.com`
  - `http://foo.com/` → `foo.com`
  - tanınmayan biçim → `null` (yarım okumaz, reddeder)

  Çıktı `normalizeDomain`'den geçirilir; `www` **korunur**, çünkü mevcut projeler zaten
  `www.bigcattr.com` ve `www.noraninsaat.com` diye kayıtlı (ölçüldü).

Konum gerekçesi: iki app'in de ihtiyaç duyduğu **saf** mantık; `packages/core`'un tek runtime
bağımlılığı `zod` ve bu dosya onu da gerektirmiyor.

### 3 · Arayüz — `/app/connection`

Üç grup, tek liste görünümü:

| grup | satır | eylemler |
|---|---|---|
| **Takip ettiğin siteler** | proje başına bir satır: ne okuduğu, ya da hazır öneri, ya da "property yok" | `Onayla` · `Değiştir` · `Çıkar` |
| **Search Console'dan ekle** | kullanılmayan property başına bir satır | `Takibe al` (sorgulanamayanlar disabled + sebebi satırda) |
| **Arşiv** | arşivlenmiş proje başına bir satır | `Geri al` |

Başta arama kutusu ve ~~durum filtresi~~. Dokuz dropdown kalkar; ad-tutmayan eşleme `Değiştir`
altında mevcut `PropertyPicker` ile yapılır — o bileşen **silinmez**, yeri değişir.

**Dosya bölünmesi.** `page.tsx` bugün 609 satır. Yeni bileşenler ayrı dosyalara:
`tracked-projects.tsx`, `property-library.tsx`, `archive-list.tsx`, ve saf görünüm mantığı
`connection-view.ts`'e eklenir. 2026-08-11 kesintisinin dersi geçerli: RSC sınırını aşan hiçbir
değer `"use client"` modülünde tanımlanmaz (`choice.ts`'in başındaki not).

**Üç yeni server action** (`actions.ts`): `trackProperty` · `untrackProject` · `restoreProject`.
Mevcut `saveProjectProperty` ve `unmapProject` korunur.

Her action, `PropertyPicker`'ın bugünkü sözleşmesini sürdürür: sunucunun kendi cümlesi
kullanıcıya **birebir** taşınır; "could not save" gibi açıklama yutan mesaj yazılmaz.

### 4 · MCP — 19 → 22 tool, hepsi **0 kredi**

| tool | girdi | ne yapar |
|---|---|---|
| `list_gsc_properties` | — | Bağlı her hesabın property'leri: yetki seviyesi, sorgulanabilir mi, hangi proje okuyor, arşivde mi |
| `track_gsc_property` | `property`, ops. `account_id` | `propertyToDomain` → projeyi aç **ya da arşivden döndür** → eşle. Idempotent |
| `untrack_project` | `project_id` | Arşivle. Zaten arşivdeyse başarı döner (idempotent) |

`TOOL_COSTS`'a üç satır: `list_gsc_properties: 0`, `track_gsc_property: 0`,
`untrack_project: 0`. Tablo byte-for-byte test ile pinli; pin güncellenir.

Her tool için WORDS kuralı 5/5: zod şema + handler + test + kredi maliyet satırı + docs sayfası.

`list_gsc_properties` hesap başına `sites.list` çağırır. **Bir hesabın listesi okunamazsa boş
liste dönmez** — okunamadığı söylenir. Gözlenmemiş yokluk yokluk değildir (mevcut
`AccountInventory` aynı kuralı taşıyor).

### 5 · Arşivin kör noktası — işin asıl riski

`projects` tablosunu okuyan **10 dosya** var ve hiçbiri arşivden haberdar değil:

```
apps/mcp/src/tools/     list-projects · whats-next · project-target · generate-report
                        connect-gsc · crawl-site · setup-project
apps/mcp/src/queue/     handlers/crawl
apps/web/app/app/connection/  page.tsx · actions.ts
```

Kural: **arşivlenmiş proje ya gizlenir ya da onarımı söyleyen bir cümleyle reddedilir.**

#### Tek boğaz noktası — 10 yamayı 1'e indirir

`project-target.ts` zaten `loadOwnProject(userId, projectId)` adında kiracı-kapsamlı bir proje
çözücü ihraç ediyor, **ama yalnız üç tool onu kullanıyor**: `ranked_keywords`,
`analyze_backlinks`, `compare_competitors`. Geri kalanlar kendi `selectOwnById` / `.from()`
çağrısını yazıyor.

**Bu spec `loadOwnProject`'i tek proje çözücü hâline getirir** ve arşiv kontrolünü ORAYA koyar.
Kendi çözümünü yazan tool'lar (`crawl_site`, `generate_report`, `whats_next`, `connect_gsc`)
ona geçirilir. Bu, işin gerektirdiği hedefli bir iyileştirme: aksi hâlde aynı kontrol dokuz
yere kopyalanır ve dokuzuncusu unutulduğunda sessizce açık kalır.

| yüzey | davranış | nerede |
|---|---|---|
| `id` ile proje çözen her tool | **Reddeder**: *"… is archived. Restore it with `track_gsc_property` or in the Connection page."* | `loadOwnProject` — tek yer |
| `list_projects` · `whats_next` listesi · web listeleri | Arşivlenmişleri **gizler** (liste yolu çözücüden geçmez) | 4 yer |
| `setup_project` | Arşivlenmiş aynı domain'e çağrılırsa **arşivden döndürür** — `unique (user_id, domain)` insert'i zaten yasaklıyor | 1 yer |
| `queue/handlers/crawl` | Kuyruğa girmiş iş arşivlemeden **etkilenmez** — koşan işi yarıda kesmek veri kaybıdır | dokunulmaz |

`pull_gsc_data` bu listede **yok**: o `projects`'i değil `gsc_connections`'ı `project_id` ile
okuyor. Çözücüye geçirildiğinde arşiv reddi ona da bedavaya gelir; geçirilmezse arşivlenmiş bir
projeden veri çekmeye devam eder. Planda **açık bir task** olarak durur, varsayım olarak değil.

Yarım bırakılırsa kusur şu olur: *"çıkardım ama `whats_next` hâlâ onu öneriyor."* Yukarıdaki
tablo uygulama planında **tek tek task** olur; toplu "arşiv desteği eklendi" maddesi yazılmaz.

## Sapmalar — imzalı, sonradan eklendi

**2026-08-13 · durum filtresi YAPILMADI (operatör onaylı takip diliminde karar verildi).**
Yukarıdaki §3 "başta arama kutusu ve durum filtresi" diyordu. Arama kutusu ve kütüphanenin
katlanması yapıldı; **durum filtresi bilinçli olarak yapılmadı.** Gerekçe: sayfanın üç grubu
(takipte · kütüphane · arşiv) ZATEN durum eksenidir; bir durum açılırı, yerleşimin hâlihazırda
ifade ettiği ekseni ikinci kez filtrelerdi. Gerekirse ayrı iş olarak açılır.

Bu not, vaadin izsiz kaybolmaması için yazıldı: bu spec'i okuyan üçüncü oturum, §3'ü açık bir
boşluk sanmasın. Kaybolan bir vaat, bu dalın düzelttiği hatanın ta kendisiydi.

## Kapsam DIŞI — bilinçli

- **Çoklu Google hesabı akışı değişmez.** Bugün 1 hesap bağlı; tasarım N hesabı destekler
  (property satırları hesap başlığı altında gruplanır) ama yeni bir hesap yönetimi yüzeyi
  eklenmez.
- **`siteUnverifiedUser` property'leri doğrulama akışı yok.** Satırda sebep yazılır ve Search
  Console'a link verilir; doğrulama Google'da yapılır.
- **Toplu işlem yok** ("hepsini takibe al"). 22 projeyi tek tıkla açmak geri alması pahalı bir
  eylem; istenirse ayrı iş.
- **`rsc-boundary` kapısının kapsam boşluğu bu spec'te kapanmaz.** Kapı yalnız
  `app/app/connection` klasörünü tarıyor; diğer sunucu yüzeyleri açık (PLAN.md'de kayıtlı,
  ayrı iş).

## Test ve kapı

Kapı, dokunulan **her paketin kendi test script'ini** içerir (imzalı ders 15):
`packages/db` · `packages/core` · `apps/web` · `apps/mcp`. `tsc --noEmit` kapının koştuğu script
değildir.

| katman | ne pinlenir |
|---|---|
| `packages/core` | `propertyToDomain`: dört biçim + tanınmayan girdi `null`. `canQuerySearchAnalytics` taşındıktan sonra **mevcut pin'ler değişmeden geçer** |
| `packages/db` | 0022 migration uygulanır/geri alınır; `archived_at` varsayılan `null` |
| `apps/web` | Üç grup dört durumda render: hiç hesap yok · hesap var property yok · `sites.list` okunamadı · arşiv dolu. Her action'ın sunucu cümlesi birebir taşınıyor |
| `apps/mcp` | Üç tool: şema · tenant izolasyonu · idempotency (iki kez track = tek proje) · arşivden döndürme. Ayrıca `loadOwnProject`'in arşiv reddi **tek yerde** pinlenir ve ona geçirilen her tool için ayrı bir spec o reddi görür — çözücüyü atlayan bir tool testte kırmızı olur |
| `TOOL_COSTS` | Byte-for-byte pin üç yeni satırla güncellenir |

**Her yeni test, kasten bozulup kırmızıya döndüğü ölçülerek kanıtlanır** (imzalı ders 12).
Plandaki mutasyon önerileri **hipotezdir** — koşulmamıştır; bir mutasyon hiçbir şeyi
kırmızıya döndürmezse bu raporlanır, sessizce geçilmez (imzalı ders 13).

## Bilinen sınır — ölçülmeyen şey

- **Tasarım tek hesap üzerinde ölçüldü.** İki hesabın aynı property'yi listelediği durum canlıda
  gözlenmedi; `inventoryRows`'un `accountId` filtresi bunun için var ama yeni yüzeyde
  sınanmadı.
- **22 property'nin hepsi takibe alınırsa** ekranın nasıl davrandığı ölçülmedi; bugünkü ölçüm
  9 proje üzerinde.
- **Arşiv sayısı bugün 0.** "Geri al" yolu canlı veriyle değil, yalnız testle doğrulanacak.
