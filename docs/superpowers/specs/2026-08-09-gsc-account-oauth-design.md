# GSC bağlantısı: hesap-bazlı OAuth + property picker

> 2026-08-09 · Durum: **tasarım onaylandı, uygulama planı bekliyor**
> Kapsam kararları operatöre soruldu ve alındı (aşağıda kim neyi karara bağladı yazılı).
> Fiyat/kredi rakamı DEĞİŞMEZ (NEVER#6). Bu spec hiçbir fiyat kalemine dokunmaz.

## Problem — ölçüldü, tahmin edilmedi

| kanıt | ölçüm |
|---|---|
| **#52** | 6 GSC-bağlı projenin **4'ünde** refresh token ölü. Sebep `flyctl logs` ile okundu: 12 referansın 12'si de `Google token endpoint failed (400): invalid_grant` |
| **#52** | `connect_gsc` canlı ile ölü bağlantıyı **ayırt edemiyor** — yeniden onaydan sonra dördü de *"already connected — property https://…"* dedi, üçünün token'ı ölüyken |
| **#53** | Token ölüyken üç analiz tool'u tam ücretle **bayat veri** satıyor. Kontrol grubuyla kanıtlandı: bağlantısı onarılan site (adstark) → 2/3 çıktı DEĞİŞTİ; token'ı ölü üç site → **9/9 çıktı BİREBİR AYNI**, her biri yine 30 kredi aldı |
| **#53** | 32 çıktıda istisnasız asimetri: crawl tabanlı tool'lar verisini **14/14 tarihliyor**, GSC tabanlı **18/18 tarihlemiyor** |
| **#36 · #50 · "property null"** | Üçünün de kökü aynı: property **seçilmiyor, tahmin ediliyor** |
| **#63** | Bugünkü per-proje disconnect, Google grant'ını iptal ettiği için aynı hesaptaki öteki projeleri de öldürüyor olabilir (mekanizmadan türetildi, ölçülmedi) |

**Ortak kök:** bağlantı bir **durum** değil, bir **an** olarak modellenmiş. Kimlik bilgisi proje
eksenine kopyalanmış (N proje = N token = N bağımsız ölüm), property kullanıcıya hiç
sorulmamış, ve sağlığı öğrenmenin tek yolu para harcamak.

## Alınan kararlar

| karar | kim | ne |
|---|---|---|
| Çoklu Google hesabı | operatör | Şema baştan çoklu-hesap. `gsc_accounts` tablosu açılır |
| Migration | operatör | **Tek yeniden onay, eşleme korunur.** Eski token'lar silinir, `gsc_property` aynen kalır |
| Kapsam | operatör | Üçü birden: bağlantı kurgusu **+** kimlik sağlığı **+** veri tarihleme |
| Eşleme yüzeyi | şef önerdi, operatör onayladı | **Kalıcı tablo** (`/app/connection`), tek seferlik sihirbaz değil |
| `openid`+`email` scope | operatör | **Eklenir.** Çoklu hesap ancak böyle çalışır |
| Aynı property → iki proje | şef | **İzin verilir**, picker'da not düşülür (teknik zarar yok; bir domain property'si meşru olarak iki projeyi kapsayabilir) |

## Şema

### Yeni: `public.gsc_accounts`

```
id                      uuid pk
user_id                 uuid not null -> auth.users(id) on delete cascade
google_account_sub      text not null      -- Google'ın stabil kullanıcı kimliği
google_account_email    text not null      -- picker'da gösterilir
encrypted_refresh_token bytea not null
token_status            text not null default 'active'   -- 'active' | 'invalid'
token_checked_at        timestamptz
created_at              timestamptz not null default now()
unique (user_id, google_account_sub)
```

**`unique` e-postaya DEĞİL `sub`'a.** Google'da e-posta değişebilir, `sub` değişmez; e-postaya
anahtarlamak aynı hesabı iki kez bağlatırdı.

**`token_status` yalnız `invalid_grant`'ta `'invalid'` olur** — geçici bir 5xx ya da ağ hatası
bağlantıyı ölü ilan etmez. Bu ayrım testle pinlenir.
**Geri dönüş yolu:** başarılı her token yenilemesi `'active'` yazar ve `token_checked_at`'i
günceller. Yani alan, en son GÖZLENEN gerçeği taşır; yeniden onay beklemeden kendini toparlar.

RLS: `enable` + **`force`**, owner-only SELECT. `guardrails/check-rls` bunu zaten zorluyor.

### Değişen: `public.gsc_connections`

| alan | ne olur |
|---|---|
| `encrypted_refresh_token` | **DÜŞER** — kimlik bilgisi artık hesapta |
| `account_id` | **EKLENİR**, `-> gsc_accounts(id) **on delete set null**`, **nullable** |
| `gsc_property` | **AYNEN KALIR** — migration'ın koruduğu şey bu |
| `unique (user_id, project_id)` | korunur |

`account_id IS NULL` + `gsc_property` dolu = *"eşleme duruyor, etkinleştirmek için bağlan"*.
Dürüst durum: eşleme yaşadı, kimlik bilgisi ölmedi — **silindi**.

**`on delete set null`, `cascade` DEĞİL — ve bu self-review'da yakalanan bir çelişkiydi.**
İlk yazımda `cascade` yazmıştım; o hâlde bir hesabı koparmak `gsc_connections` satırlarını
SİLERDİ ve kullanıcı bütün property eşlemelerini kaybederdi — yani migration'da özenle
koruduğumuz şeyi disconnect yok ederdi. `set null` ile hesabı koparmak, migration'ın ürettiği
durumun **aynısına** düşer: eşleme durur, kimlik bilgisi gider, yeniden bağlanınca canlanır.
Tek kod yolu, tek zihinsel model.

### Kripto v4

Token bugün `(user_id, project_id)`'ye AES-GCM AAD ile mühürlü (v3, `AAD_CONTEXT =
"seogrep/gsc-refresh-token"`). Yeni eksen `(user_id, gsc_account_id)`.

**Aynı versiyon baytıyla AAD içeriğini sessizce değiştirmek yasak** — gelecekteki okuyucuyu
yanıltır. Bu yüzden **v4** + ayrı context dizesi `seogrep/gsc-refresh-token/account`.
v2 ve v3 şifreli metin **gürültülü reddedilir** (yeniden bağlanamazlar). Migration onları
zaten siliyor, yani bu yol hiç tetiklenmemeli — ve "hiç tetiklenmemeli" bir testle pinlenir.

## OAuth akışı

1. `/app/connection` → **"Connect Google account"** → `GET /api/gsc/connect`
   **`project_id` YOK.** PKCE ve tek kullanımlık state aynen korunur.
2. Scope: `https://www.googleapis.com/auth/webmasters.readonly` **+ `openid` + `email`**.
   `include_granted_scopes` **KAPALI KALIR** — o karar doğruydu ve korunur.
3. Callback:
   - kod → token takası
   - `id_token`'dan `sub` + `email`
   - `sites.list` çağrısı — **bu çağrının kendisi kimlik doğrulamasıdır**
   - `gsc_accounts` upsert `(user_id, sub)` ile; token v4 AAD'yle `(user_id, account_id)`'ye mühürlenir
   - `/app/connection?connected=<accountId>`'a yönlendir
4. `sites.list` başarısızsa **token SAKLANMAZ** ve kullanıcıya sebebi söylenir.

## Picker — `/app/connection`

Tablo: **proje | property (dropdown) | yetki seviyesi | durum**

- Property listesi **önbelleğe alınmaz, sayfa açılışında canlı çekilir.** Önbellek kendi
  bayatlık sorununu doğurur; ayrıca token ölüyse çekim başarısız olur — ki bu tam da
  göstermek istediğimiz şeydir. Token ölüyse sayfa **500 vermez**, "yeniden bağlan" durumuna düşer.
- Dropdown'ın **önerilen** değerini `resolveGscProperty` üretir. Fonksiyon **karar verici
  olmaktan çıkıp öneri veren oluyor**; davranışı ve mevcut güvenlik pinleri (`blog.example.com`
  apex'e bağlanamaz, tek literal `www.` soyulur) **değişmez**.
- `sites.list`'in döndürdüğü **`permissionLevel` gösterilir**. Sorgulanamayan bir property
  seçilebilir DEĞİLDİR. **#50 yapısal olarak imkânsız hâle gelir.**
- Aynı property birden çok projeye eşlenebilir; picker bunu **not olarak** belirtir, engellemez.
- **Kaybolmuş eşleme:** saklı `gsc_property` canlı `sites.list`'te artık YOKSA (property silindi,
  yetki alındı, ya da hesap değişti) satır *"bu property artık bu hesapta görünmüyor — yeniden
  seç"* diye işaretlenir. Sessizce boş dropdown gösterilmez; kaybın kendisi bilgidir.

**Kaydetme sunucuda doğrulanır, UI'a güvenilmez:** seçilen property canlı `sites.list`'te
var mı **ve** `canQuerySearchAnalytics` geçiyor mu **ve** satır tenant-filtreli mi (NEVER#4).

## Disconnect — iki seviye, ve yarıçapı SÖYLENİR

| eylem | ne yapar | Google'a dokunur mu |
|---|---|---|
| **Projeyi eşlemeden çıkar** | `gsc_connections` satırının `account_id` + `gsc_property` alanını temizler | **HAYIR** |
| **Hesabı kopar** | `revokeGoogleToken` + `gsc_accounts` satırı silinir → `on delete set null` o hesaba bağlı her projenin `account_id`'sini boşaltır; **`gsc_property` eşlemeleri KALIR** ve "yeniden bağlanınca canlanır" durumuna düşer | **EVET** |

İkinci eylemin onay metni **kaç projeyi etkileyeceğini sayıyla söyler** (*"bu 5 projenin
Search Console bağlantısını kesecek"*). Bugünkü davranışın (#63) sessiz olması kusurun kendisiydi.

## Kimlik sağlığı (#52)

| an | davranış |
|---|---|
| bağlanırken | `sites.list` başarısızsa token saklanmaz |
| her yenileme hatasında | yalnız `invalid_grant` → `token_status='invalid'`, `token_checked_at=now()` |
| kullanıcıya | tipli **`GscReauthRequiredError`** → *"Google connection for `<email>` expired. Reconnect: `<url>`"* |

**0 kredi.** Registry catch'inde genel daldan ÖNCE tek tipli dal; dal **tipe** bakar, metne
ASLA. `PreconditionNotMetError` (#35) ve `PaidBalanceRequiredError` (PR #37) desenini birebir izler.

## Veri tarihleme (#53)

`getLatestSucceededResult` `created_at`'i **zaten seçiyor ve döndürüyor**; `loadLatestPull`
onu bir satır sonra **atıyor**. Atmayı bırakır.

Üç analiz tool'unun çıktısına eklenir:

```
Search Console data pulled 2026-08-06 (4 days ago).
```

ve bağlantı ölüyse:

```
⚠ Your Google connection expired — this data cannot be refreshed. Reconnect: <url>
```

## Migration `0021`

1. `gsc_accounts` oluştur + RLS enable/force + owner-select policy
2. `gsc_connections`: `account_id` ekle (nullable), `encrypted_refresh_token` **düşür**
3. `gsc_property` **korunur** — hiçbir satır silinmez

Geri alma yolu her adımın yanına yazılır (mevcut migration'ların konvansiyonu).

## İnsan kuyruğu — kod bunları yapamaz

1. **Google Cloud Console:** `openid` + `email` scope'larının OAuth consent screen'e eklenmesi.
2. **Privacy sayfası:** bugün yalnız "read-only Search Console" diyor; e-posta erişimi ve
   **niçin** istendiği (hesapları birbirinden ayırmak) yazılmalı. Effective date güncellenir.
3. **Yeniden onay:** migration sonrası her kullanıcı Google hesabı başına **bir kez** onay verir.

## Test — hakemin bakacağı yer

| ne | nasıl pinlenir |
|---|---|
| kripto v4 | `(user_id, account_id)`'ye bağlar; **v2/v3 gürültülü reddedilir** |
| `resolveGscProperty` | davranış **değişmez** — mevcut pinler, `blog.example.com` dahil, aynen geçer |
| kaydetme | listede olmayan property **red** · sorgulanamayan seviye **red** · tenant filtresi |
| çoklu hesap | ikinci Google hesabı **ikinci satır** açar, birinciyi ezmez |
| `token_status` | yalnız `invalid_grant`'ta `'invalid'`; 5xx/ağ hatası bağlantıyı ölü ilan **etmez** |
| tipli reauth hatası | **0 kredi** yakar |
| tarihleme | üç tool `pulled_at` taşır; `invalid` durumda uyarı eklenir |
| disconnect | hesabı koparmak o hesabın **tüm** eşlemelerini düşürür; projeyi çıkarmak Google'a **dokunmaz** |
| RLS | `gsc_accounts` owner-only + force — `guardrails/check-rls` |

**Mutasyon testi zorunlu** (yeşil test kanıt değildir): tipli reauth dalını sil → test kırmızı ·
`.eq("user_id")` düşür → DB testi kırmızı · `permissionLevel` kontrolünü kaldır → kaydetme
testi kırmızı. Kırmızıya dönmeyen iddia hiçbir şey ölçmüyordur.

## Kapsam DIŞI (bilerek)

- **Fiyat/kredi hiçbir kalemde değişmez** (NEVER#6).
- `pull_gsc_data`'nın 5000 satır tavanı — ayrı konu, bu spec'e girmiyor.
- #46 fragment birleştirme, #55/#56 locale — Faz D'nin başka dilimleri.
- Otomatik token yenileme/arka plan sağlık taraması — YAGNI. Sağlık, kullanımda ve sayfa
  açılışında zaten ölçülüyor; ayrı bir zamanlayıcı ikinci bir arıza yüzeyi demek.

## Riskler

1. **Scope değişikliği bir kararı geri alıyor.** `oauth.ts:15-17` "tek scope, başka hiçbir şey"
   diyor ve gerekçesi yazılı. Yeni gerekçe (çoklu hesap kimliği) aynı yere yazılır ki
   gelecekteki okuyucu kararın **değiştiğini** ve **niçin** değiştiğini görsün.
2. **Tek token = tek iptal noktası.** Bugün de fiilen öyle (#63), ama artık açık. Disconnect
   onayının yarıçapı sayıyla söylemesi bunun karşılığı.
3. **#63 ölçülmedi.** Yeniden kurgu onu yok ediyor ama "kanıtlandı" diye yazılmaz.
