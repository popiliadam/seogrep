# SeoGrep düşmanca tam depo denetimi

Tarih: 2026-07-28
İncelenen commit: `55fea3611ed5bc4c1ef623152e48450a4cec31e3`
Depo: `popiliadam/seogrep`
Kapsam: 458 tracked dosya, 57.987 satır
Karar: **Canlı para ve kontrolsüz yeni kullanıcı alımı için NO-GO**

> Bu çalışma yalnız bulgu üretir. Uygulama kodu, test, migration, konfigürasyon, fiyat,
> veri veya dış servis durumu düzeltilmedi. Eklenen tek dosya bu rapordur.

## Yönetici özeti

Kod tabanı sıradan bir “testi var, lint geçiyor” projesinden belirgin biçimde daha disiplinli:
tenant filtreleri yaygın, Paddle imzası veri yazımından önce doğrulanıyor, event/ref
idempotency mevcut, ledger append-only tasarlanmış, crawler DNS pinning uyguluyor ve dinamik
rapor içeriği kaçışlanıyor. Buna rağmen düşmanca incelemede mevcut yeşil kapıların yakalamadığı
birkaç ciddi çalışma-zamanı ve para-bütünlüğü boşluğu bulundu.

En önemli sonuçlar:

1. Kredi settlement RPC'si geçici hata verirse rezerv kalıcı olarak açık kalabiliyor. Async iş
   `failed` durumuna geçirildiği için reaper'ın `running` sorgusundan düşüyor; sync çağrının ise
   `jobs` satırı hiç yok. Kullanıcı sonuç alamadan tekrar tekrar borçlandırılabilir.
2. Crawler URL ve süre sayısını sınırlıyor fakat response byte, açılmış gövde, sitemap `<loc>`,
   link kuyruğu ve sonuç boyutunu sınırlamıyor. 512 MB makinede tek kontrollü site OOM üretebilir.
3. DataForSEO `$3/gün` koruması atomik veya global değil; `/tmp` üzerinde makine/boot başına
   sıfırlanıyor. Ayrıca belgelerde daha önce konuşmada açığa çıktığı kabul edilen vendor parolası
   hâlâ rotasyonsuzken hesabın fonlanıp live moda alınması sıradaki kapı olarak duruyor.
4. Public `/status`, her anonim istekte indekssiz exact DB count başlatıyor. Bir saniyelik
   `Promise.race` yalnız HTTP bekleyişini bitiriyor; alttaki sorguyu iptal etmiyor.
5. Private-beta/waitlist söylemine rağmen `/signup` açık; invite, CAPTCHA, IP/domain ve disposable
   e-posta kontrolü yok. Her doğrulanmış yeni auth kullanıcısı 200 kredi alabiliyor.
6. Next.js `16.2.10`, bu uygulamanın kullandığı App Router Server Actions için bilinen yüksek
   önem dereceli CPU DoS açığını içeriyor.

### Sayısal sonuç

| Önem | Sayı | Anlam |
|---|---:|---|
| High | 7 | Para, shared-service kullanılabilirliği veya yakın live-aktivasyon blocker'ı |
| Medium | 28 | Erişilebilir hata, önemli invariant/mahremiyet/operasyon boşluğu |
| Low | 19 | Savunma derinliği, ürün doğruluğu, SEO, süreç ve bakım borcu |
| Toplam | 54 | Aynı kök nedenler birleştirildi; salt şüpheler bulgu sayılmadı |

## Yöntem ve sınırlar

- HEAD ve tracked ağaç sabitlendi; web, MCP/worker ve data/CI/ops ayrı inceleme hatlarında
  dosya envanteri ve satır odaklı okundu. İçe aktarma ve veri akışları hatlar arasında tekrar
  izlendi.
- İlk tam tarama `4e0098e` snapshot'ında tamamlandı. Audit yazılırken main'e gelen
  `d40c05e..55fea36` aralığındaki yedi guardrail/goal/PLAN dosyası ayrıca tam diff olarak
  incelendi. Yeni `verify-goals` SKIP görünürlüğü önceki sessiz-skip boşluğunu kapatıyor; aşağıdaki
  M-12'nin history-insensitive RLS/append-only ve CI'da `make goals` çalışmaması kısmını kapatmıyor.
- Para yolları reserve → execute → commit/release → reaper; Paddle signature → event →
  command → RPC/upsert; auth → trial → ledger şeklinde uçtan uca takip edildi.
- Tenant ilişkileri hem RLS hem service-role sorguları hem de ilişkisel FK düzeyinde incelendi.
- Dış ağ çağrılarında timeout, byte sınırı, SSRF, retry, idempotency ve maliyet muhasebesi arandı.
- Testlerin yalnız varlığı değil, hangi negatif davranışı gerçekten pinlediği kontrol edildi.
- `pnpm audit --prod`, `pnpm outdated -r`, lisans envanteri, full-history gitleaks, build/lint/
  typecheck/test ve sınırlı read-only canlı header/health gözlemleri çalıştırıldı.
- Paralı API çağrısı, prod DB mutasyonu, kullanıcı hesabı oluşturma, checkout veya webhook
  gönderimi yapılmadı. Bu nedenle ödeme sağlayıcısı ve auth bulguları kod/sözleşme
  izine dayanır; prod verisi değiştirilerek doğrulanmamıştır.
- “Her dosya okundu” ifadesi tracked HEAD içindir. Mevcut untracked kullanıcı dosyaları kanıt
  veya ürün kapsamı sayılmadı ve değiştirilmedi.

## High bulgular

### H-01 — Settlement hatası kredi rezervini kalıcı olarak açık bırakıyor

**Kanıt**

- `apps/mcp/src/credits/guard.ts:69-83`: `commit_reserve` hatası fırlatılıyor;
  `release_reserve` hatası yalnız loglanıp yutuluyor.
- `apps/mcp/src/credits/guard.ts:100-125`: sync çağrılara gerçek `jobs` satırı olmayan sentetik
  `job_id` veriliyor.
- `apps/mcp/src/queue/worker.ts:136-151`: settlement dahil tüm `withCredits` hataları işi
  `failed` yapıyor.
- `apps/mcp/src/queue/reaper.ts:135-142`: reaper yalnız `status = running` işleri seçiyor.

**Düşmanca senaryo**

Tool başarıyla çalışır, fakat geçici DB/PostgREST hatası nedeniyle commit başarısız olur.
Async satır `failed` olur; sync çağrı zaten jobs tablosunda yoktur. Handler hatası sonrası
release de geçici hata verirse aynı şekil oluşur. Açık negatif `spend_reserve` bakiyeyi düşürür
ve mevcut otomatik uzlaştırma iki yolu da bir daha göremez.

**Etki**

Kullanıcı sonuç alamadığı halde kredisi bloke edilir; retry yeni rezerv açabilir. Bu,
append-only ledger'ın yönünü bozmasa bile türetilen kullanılabilir bakiyeyi fiilen yanlış
hale getirir.

**Kapatma kanıtı**

Sync ve async yollarda ayrı ayrı commit/release failure injection; sonrasında otomatik
reconciliation'ın açık rezervi tek yönde ve idempotent kapattığını gösteren DB testi gerekir.

### H-02 — Crawler response ve sonuç belleği sınırsız

**Kanıt**

- `apps/mcp/src/crawler/crawl.ts:412-416,476-520`: HTML, robots ve sitemap gövdeleri sınırsız
  `res.text()` ile tamamen belleğe alınıyor.
- `apps/mcp/src/crawler/sitemap.ts:55-61`: tüm `<loc>` elemanları materialize ediliyor.
- `apps/mcp/src/crawler/crawl.ts:613-650`: limit uygulanmadan önce sitemap URL'leri birikiyor.
- `apps/mcp/src/crawler/crawl.ts:232-244,759-779`: bütün linkler toplanıyor; kuyruk artığı
  ayrıca `skipped` sonucuna kopyalanıyor.
- `apps/mcp/fly.toml:41-43`: makine belleği 512 MB.

**Düşmanca senaryo**

Bir kullanıcı kontrol ettiği public domaini projeye ekler; site hızlı fakat çok büyük,
sıkıştırılmış/chunked HTML veya milyonlarca `<loc>`/link döndürür. 100 URL ve 90 saniye
sınırı byte, parser nesnesi, kuyruk ve persisted JSON boyutunu sınırlamaz.

**Etki**

Web keşif isteği veya shared worker OOM/CPU baskısı yaşayabilir; tek tenant diğer bütün
tenant'ların crawler ve credit settlement kullanılabilirliğini düşürebilir.

**Kapatma kanıtı**

Compressed ve chunked fixture'larda response byte, açılmış byte, link/loc, kuyruk ve persisted
sonuç boyutlarının her birinin sabit üst sınırda kaldığını gösteren adversarial test gerekir.

### H-03 — DataForSEO günlük bütçe kapısı global, kalıcı veya atomik değil

**Kanıt**

- `apps/mcp/src/dfs/budget.ts:73-93`: her dosya okuma hatası `$0` sayılıyor; bozuk satırlar
  görmezden geliniyor.
- `apps/mcp/src/dfs/budget.ts:102-116,124-134`: read/check ile paid call sonrası append
  arasında lock/reservation yok.
- `apps/mcp/fly.toml:14-18`: ledger açıkça per-boot ephemeral `/tmp/dfs-spend`.
- Örnek çağrı `apps/mcp/src/dfs/client.ts:197-225`: kontrol ile kayıt arasında vendor isteği var.

**Düşmanca senaryo**

Eşzamanlı istekler aynı eski toplamı görüp birlikte geçer. Başka makine veya restart yeni
`$3` hakkı alır. Dosya okunamaması fail-open, yazılamaması ise vendor maliyeti oluştuktan sonra
fark edilir.

**Etki**

Anayasal `$3/gün` sınırı live modda gerçek bir maliyet tavanı değildir. Aynı mekanizma
müşteri trafiğine uygulanırsa meşru kullanıcılar da tek makinenin dev-smoke bütçesini
paylaşıp servis dışı kalır.

**Kapatma kanıtı**

Barrier kontrollü concurrent test, iki makine dizini ve restart simülasyonu birlikte tek
dayanıklı/atomik global sayaçtan fazla vendor çağrısı çıkmadığını kanıtlamalıdır.

### H-04 — Belgelenmiş açığa çıkmış vendor parolası live fonlama öncesi rotasyonsuz

**Kanıt**

- `PLAN.md:238-242`: DataForSEO hesabını fonlama ve `DFS_LIVE=1` sıradaki aktivasyon kapısı.
- `PLAN.md:256,317`: konuşmada açığa çıkan DataForSEO parolasının rotasyonsuz olduğu
  açıkça kaydedilmiş.
- `docs/plans/2026-07-28-dfs10-fiyat-karari.md:60-63`: aynı bağımlılığı tekrar kaydediyor.
- `docs/runbooks/secret-rotation.md:3-9,50-54`: açığa çıkan live credential'ın rotasyonunu
  zorunlu sayıyor.

**Düşmanca senaryo ve etki**

Transkripte erişimi olan biri, uygulamadaki `DFS_LIVE` bayrağından bağımsız biçimde doğrudan
vendor hesabına bağlanabilir. Planlanan minimum bakiye yüklendiği anda dormant risk harcanabilir
bakiyeye dönüşür.

**Sınır**

Bu denetim secret değerini okumadı veya vendor'a login denemedi. Bulgu, deponun kendi güncel
operasyon kayıtlarındaki “exposed + not rotated” beyanına dayanır.

### H-05 — Public `/status` iptal edilmeyen DB count amplifikatörü

**Kanıt**

- `apps/mcp/src/server.ts:174-193`: timeout `Promise.race`; alttaki read için AbortSignal yok.
- `apps/mcp/src/server.ts:439-451`: endpoint anonim ve throttlesız.
- `apps/mcp/src/db.ts:317-335`: `jobs` üzerinde exact service-role count; kod da status indexi
  olmadığını söylüyor.
- 2026-07-28 read-only canlı gözlem: endpoint `200` dönüyor ve `pendingJobs`, uptime, hata ve
  reaper sayaçlarını yayımlıyor.

**Düşmanca senaryo**

Anonim flood her istekte yeni exact count başlatır. HTTP cevabı bir saniye sonra `null`
dönebilir, fakat Supabase/PostgREST sorguları çalışmaya devam eder.

**Etki**

DB bağlantı ve CPU yükü auth, queue, credit settlement ve bütün tenant tool'larına taşınır.

**Kapatma kanıtı**

N concurrent status isteğinin timeout cevabından sonra N reader'ın hâlâ aktif kaldığı failure
testi ve gerçek iptal/cache/rate davranışının ölçümü gerekir.

### H-06 — Private-beta giriş ve trial-abuse kontrolleri gerçekte yok

**Kanıt**

- `apps/web/app/(marketing)/page.tsx:62-74,145-146`: waitlist/invite-only söylemi.
- `apps/web/app/(auth)/login/page.tsx:37-41`, `signup/page.tsx:8-17`,
  `auth-form.tsx:28-34`: public Supabase signup yolu.
- `apps/web/app/auth/callback/route.ts:54-70`: doğrulanan her yeni kullanıcı için trial çağrısı.
- `apps/web/lib/billing/trial.ts:43-56` ve migration `0009:95-128`: kilit yalnız auth `user_id`.
- Master spec `docs/specs/2026-07-pseo-saas-design.md:63`: IP/domain ve tek trial/domain ister.

**Düşmanca senaryo**

Disposable/alias e-postalarla çok sayıda hesap doğrulanır; invite, CAPTCHA, IP, domain veya
disposable-email kontrolü olmadan her hesap 200 kredi alır.

**Etki**

Waitlist fiilen bypass edilir; crawler/DB/egress kapasitesi ve live DFS açıldığında vendor
maliyeti Sybil hesaplarla tüketilebilir.

### H-07 — Kullanılan Next.js sürümünde erişilebilir Server Action CPU DoS açığı var

**Kanıt**

- `pnpm audit --prod`: `next@16.2.10` için
  [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj), High.
- Uygulama App Router Server Actions kullanıyor; örnekler
  `apps/web/app/app/billing/actions.ts` ve `apps/web/app/app/connection/actions.ts`.
- Audit sırasında `16.2.11+` düzeltilmiş hat yayımlanmıştı; `pnpm outdated -r` latest
  `16.2.12` gösterdi.

**Etki**

Framework düzeyindeki pahalı ayrıştırma/işleme yolu anonim veya düşük maliyetli isteklerle
CPU kullanılabilirliğini düşürebilir.

**Not**

Bu tek erişilebilir yüksek advisory'dir. Aynı audit çıktısındaki custom-server SSRF, rewrite
SSRF, single-locale proxy bypass, Edge payload ve image/SVG advisory'leri mevcut deploy veya
kullanım şekline uygulanabilir bulunmadı; aşağıdaki yanlış-pozitif bölümüne bakın.

## Medium bulgular

### M-01 — Queue ve `jobs` çift yazımı kalıcı “queued” iş bırakabilir

`apps/mcp/src/queue/boss.ts:101-126` önce DB satırı ekleyip sonra pg-boss'a gönderiyor;
`apps/mcp/src/queue/boss.ts:43-50` retry limitini sıfır yapıyor. Process iki işlem arasında
ölürse catch çalışmaz. `getJob`/`markJobRunning` hataları da
`apps/mcp/src/queue/worker.ts:101-134` içindeki ana catch'in dışında kalır.
`apps/mcp/src/queue/reaper.ts:135-142` queued satırları taramaz. Sonuç: kullanıcı sonsuza kadar
“queued” görebilir.

### M-02 — Paddle transaction item cardinality ve quantity doğrulanmıyor

`packages/core/src/billing/paddle-events.ts:61-63` item içinden yalnız price ID okuyor;
quantity şemada yok. `:83-95` ilk eşleşen paketi seçiyor, `:98-120` o paketin sabit kredi
miktarını bir kez grant ediyor. İmzalı bir `transaction.completed` birden fazla eşleşen item
veya quantity > 1 içerirse tahsilat ile kredi grant'i ayrışabilir. Dashboard bugün quantity
1 açsa da webhook, Paddle'ın imzaladığı gerçek transaction şeklinin tümünü doğrulamak zorunda.

### M-03 — Out-of-order Paddle event eski subscription state'i geri getirebilir

`apps/web/app/api/paddle/webhook/route.ts:92-137` raw event'i saklıyor fakat
`occurred_at`/version taşımıyor. `packages/core/src/billing/paddle-events.ts:123-155` ordering
alanı üretmiyor; `packages/db/src/paddle-repo.ts:147-160` `paddle_subscription_id` üzerinde
plan/status/period'i koşulsuz overwrite ediyor. Yeni `canceled` sonrasında gecikmiş eski
`active` farklı event ID ile kabul edilir; event-id idempotency ordering sağlamaz.

### M-04 — Aynı kullanıcı için birden fazla aktif subscription modellenmiyor

`packages/db/supabase/migrations/0001_core_tables.sql:67-75` yalnız Paddle subscription ID'yi
unique yapıyor; kullanıcı başına active plan invariantı yok. Billing sayfası active kullanıcıya
da tüm planlarda Buy gösteriyor (`apps/web/app/app/billing/page.tsx:63-65,87-109`).
Portal action `.limit(1)` ile keyfi tek kaydı seçip tek subscription ID gönderiyor
(`apps/web/app/app/billing/actions.ts:29-57`). Paddle bir customer altında birden fazla
subscription destekler ve portal session birden fazla subscription ID kabul eder:
[Paddle portal docs](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/).
Farklı Paddle customer/email ile açılan ikinci aktif abonelik görünmez ve yönetilemez kalabilir.

### M-05 — Paddle `customData.user_id` service-role yazıları için otorite kabul ediliyor

Checkout browser'da user ID gönderiyor (`apps/web/app/app/billing/checkout-button.tsx:54-64`);
webhook bunu ledger/subscription tenant'ı olarak kullanıyor
(`packages/core/src/billing/paddle-events.ts:65-75,106-119,131-154`). Paddle custom data,
checkout açıkken client tarafında güncellenebilir:
[Paddle custom data](https://developer.paddle.com/build/transactions/custom-data/).
Bu doğrudan “başkasının parasını çalma” kanıtı değildir; saldırgan kendi ödediği transaction'ı
bildiği başka UUID'ye yönlendirerek tenant attribution, destek ve audit bütünlüğünü bozabilir.

### M-06 — Purchase RPC event satırı olmadan kredi grant edebiliyor

`packages/db/supabase/migrations/0007_process_paddle_purchase.sql:47-56` önce ledger'a insert
ediyor, sonra `paddle_events` update'inin satır eşleştirdiğini kontrol etmiyor.
`packages/db/src/paddle-repo.db.test.ts:100-175` bütün testlerde event'i önceden ekliyor.
Service bug/recovery script/operator yanlış `p_event_id` ile unbacked purchase grant
oluşturabilir.

### M-07 — Trial “tek sefer” kilidi service role tarafından sıfırlanabilir

`packages/db/supabase/migrations/0006_users_profile_trial_and_grants.sql:20-24` service role'a
geniş UPDATE verir. `claim_trial`, yalnız `trial_granted_at IS NULL` kontrol eder
(`0009:112-126`). Kilit yanlışlıkla NULL yapılırsa ikinci grant kabul edilir. Bu public route
değil, fakat para invariantı DB'de geri döndürülemez değildir.

### M-08 — `paddle_events` idempotency/audit kimliği geniş UPDATE yetkisine sahip

Raw `event_id`, `event_type`, `payload` `0003:9-15` içinde saklanır; `0006:49-51` service
role'a tablo-geneli UPDATE verir. Normal uygulama yalnız `processed_at` günceller
(`packages/db/src/paddle-repo.ts:101-114`). Hatalı/ele geçirilmiş service writer event ID veya
payload'ı değiştirip idempotency ve forensic izi zayıflatabilir.

### M-09 — DB, negatif bakiyeyi engellemiyor

Core model `packages/core/src/billing/ledger.ts:97-104` negatif bakiyeye götüren adjustment'ı
reddeder; `goals/ledger-integrity.md` `balance ≥ 0` der. Buna karşın migration
`0011:20-33` `adjust` delta'sını bilinçli olarak sınırsız bırakır ve
`packages/db/src/ledger-shape.db.test.ts:150-156` bunu kabul edilen davranış olarak test eder.
DB-authoritative bir operator/service adjustment mevcut bakiyeden büyük negatif değer yazabilir.

### M-10 — İlişkisel tenant sahipliği composite FK ile korunmuyor

Jobs `user_id` ve `project_id`yi bağımsız FK'lerle tutar (`0001:89-95`), reports `user_id` ve
`job_id`yi bağımsız tutar (`0001:110-115`), GSC de aynı deseni kullanır (`0003:24-29`).
RLS satırın `user_id` alanına bakar. Mevcut writer'lar ownership filtreli olsa da gelecekteki
tek service-role hatası A'ya görünür satırı B'nin project/job nesnesine bağlayabilir.

### M-11 — Generated Supabase tipleri ve schema marker ciddi biçimde eski

`packages/db/src/types.ts:1-4` source-of-truth iddiasında; ancak `api_keys.last_used_at`,
`gsc_property`, job lifecycle/result/input, report title/html/tool, trial/welcome alanları ve
bütün RPC'ler eksik (`Functions` `:307-309` içinde `never`). Kod bunu çok sayıda overlay/cast
ile aşıyor. `packages/db/src/index.ts:1-2` on iki migration sonrasında hâlâ
`SCHEMA_VERSION = 0`. Migration drift'i typecheck yerine prod runtime'da patlayabilir.

### M-12 — RLS ve append-only statik guard'ları zayıflatılmış final state'i false-PASS ediyor

`guardrails/check-rls.sh:12-24` tüm migration tarihini birleştirip geçmişte ENABLE/FORCE var mı
diye bakıyor; sonraki `DISABLE`/`NO FORCE` görünmüyor. `check-append-only.sh:15-39` geçmiş
REVOKE/trigger varlığını arıyor; sonraki GRANT veya DROP TRIGGER'ı dikkate almıyor ve yalnız
`credit_ledger`ı kapsıyor. Sentetik sonraki-zayıflatma kontrollerinde iki script de exit 0 verdi.
CI ayrıca `make goals` çalıştırmıyor.

### M-13 — Production deploy CI ve cloud schema readiness ile bağlı değil

`.github/workflows/deploy-mcp.yml:5-39` main değişikliklerinde checkout sonrası doğrudan deploy
ediyor. Ayrı `.github/workflows/ci.yml` sonucuna `workflow_run`/required-job bağı yok; prod
schema-version/parity probe da yok. Kod ve migration birlikte merge olduğunda Fly yeni RPC/kolonu
CI bitmeden ve cloud migration uygulanmadan çağırabilir.

### M-14 — GSC/DFS/Resend dış çağrılarının uygulama deadline'ı yok

Bare fetch örnekleri: `packages/core/src/gsc/client.ts:115-131,178-183,201-217`,
`packages/core/src/waitlist/resend-store.ts:18-42`,
`apps/mcp/src/dfs/client.ts:180-182` ve diğer DFS client'ları. Provider socket açıp cevabı
bekletirse OAuth callback, waitlist request veya kredi rezervli sync tool platform timeout'una
kadar slot tutar. `email/send.ts` ve PostHog adapter'ında var olan 3 saniyelik AbortSignal
bu yolların tamamında yoktur.

### M-15 — GSC Disconnect başarısız Google revoke'u başarı gibi gösteriyor

`apps/web/lib/gsc/revoke.ts:29-43` non-2xx/network failure'da `false` döner. Caller boolean'ı
yok sayar; decrypt edilemeyen ciphertext'te de erken dönüp local satırı siler
(`apps/web/app/app/connection/actions.ts:150-197`). UI “access at Google revoked” vaat eder
(`page.tsx:110-114`); testler failure sonrası sessiz başarıyı pinler (`actions.test.ts:420-452`).
Tek retry materyali silindiği halde Google grant/token yaşamaya devam edebilir.

### M-16 — GSC ciphertext formatının key-version/rotation yolu yok

`packages/core/src/gsc/crypto.ts:16-27,65-98` yalnız `iv || tag || ciphertext` ve tek key
kullanır; key ID yoktur. `docs/runbooks/secret-rotation.md:43-48` rotasyonu ancak connection
sayısı sıfırken güvenli sayar. Gerçek kullanıcı sonrası key sızıntısı, toplu disconnect ile
kompromize key'i kullanmaya devam etme arasında bırakır.

### M-17 — GSC ciphertext tenant/project bağlamına cryptographic olarak bağlı değil

`packages/core/src/gsc/crypto.ts:65-92` AES-GCM'de AAD kullanmaz; decrypt expected
user/project almaz. DB writer hatası A'nın ciphertext'ini B'nin bağlantı satırına taşırsa global
key authentication'ı geçer ve B'nin pull'u A'nın Google hesabına gidebilir. Bu public DB
yazarı değil; cross-tenant hataya karşı eksik savunma katmanıdır.

### M-18 — IPv6 SSRF denylist bazı non-global/transition adreslerini public kabul ediyor

`apps/mcp/src/crawler/ssrf.ts:149-178,243-267` seçili IPv6 aralıklarını bloklayıp kalanını
allow eder; pinned fetch bu sonucu kullanır (`pinned-fetch.ts:124-144`). Pure-function
reprodüksiyonunda `fec0::1`, `100::1`, `2001::1`, `2002:7f00:1::1`,
`64:ff9b:1::7f00:1`, `::ffff:0:127.0.0.1` false döndü. Exploit route-dependent'tir; ilgili
site-local/6to4/NAT64/translated route yoksa hedefe varmaz, fakat “yalnız global public IP”
invariantı sağlanmaz.

### M-19 — `crawl_site` job ID üretmeden 25–30 saniye keşif yapabilir

Tool “immediate async job ID” vaat eder (`apps/mcp/src/tools/crawl-site.ts:18-21,224-227`);
fakat enqueue öncesi size discovery bekler (`:248-258`). Root sitemap, beş child sitemap ve
homepage seri timeout olabilir (`crawler/crawl.ts:882-884,942-960`). Client timeout/retry
aynı pahalı keşfi tekrarlar ve henüz izlenebilir job ID yoktur.

### M-20 — GSC freshness lag, stabil sayfayı content decay diye işaretleyebilir

`apps/mcp/src/gsc-data/windows.ts:7-11` 2–3 günlük gecikmeyi bilir, fakat current window'u
bugünde bitirir (`:44-51`). Yedi günlük aralıkta stabil 7 click/gün; önceki tam hafta 49,
son dört finalize gün 28 olduğunda `content-decay.ts:50-66` bunu `%42,86` düşüş sayar.
Kullanıcı yanlış refresh tavsiyesi için kredi harcar.

### M-21 — Auth callback trial RPC hatasında doğrulanmış hesabı kredisisiz bırakıyor

Auth/OTP doğrulaması tamamlandıktan sonra `apps/web/app/auth/callback/route.ts:48-66`
`grantTrialCredits` hatası 500 olarak kaçar. Normal password login doğrudan `/app`e gider
(`auth-form.tsx:47-54`) ve trial claim'i tekrar denemez. Transaction rollback doğru olsa da
bir defalık callback tüketildikten sonra geçici DB hatası kullanıcıyı reklamdaki 200 krediden
mahrum bırakabilir.

### M-22 — API-key rotation beş aktif key sınırını sınırsız aşabiliyor

Ownership lookup revoked key'i de kabul eder (`connection/actions.ts:59-72`;
`packages/db/src/api-keys-repo.ts:103-112`). Rotation yeni key'i önce mint eder ve beş-key
count'unu atlar (`actions.ts:103-129`); eski revoke no-op olabilir. Test
`actions.test.ts:221-236` 99 key varken count yapılmamasını özellikle pinler. Aynı revoked ID
ile tekrar veya aynı active ID'ye concurrent rotation sınırsız active key ve key-başına rate
limit çoğaltması üretir.

### M-23 — Public waitlist provider/analytics amplifikatörü

`apps/web/app/api/waitlist/route.ts:6-28` yalnız honeypot içerir; rate/IP/token sınırı yoktur.
Her geçerli istek store ve analytics çağırır (`packages/core/src/waitlist/waitlist.ts:37-53`);
duplicate tek e-posta bile Resend POST+GET ve PostHog event üretebilir. Bot `website` alanını
boş bırakarak quota, maliyet ve analitiği tüketebilir.

### M-24 — Vaat edilen 90 günlük crawl retention uygulanmıyor

Master spec `docs/specs/2026-07-pseo-saas-design.md:102-110` raw crawl için 90 gün der.
Sonuç `jobs.result` içinde kalır (`apps/mcp/src/queue/boss.ts:348-354`); reaper yalnız stuck
running işleri işler ve deployment'ta retention process/schedule yoktur. Eski başarılı crawl
sonuçlarını temizleyen yol repository taramasında bulunmadı.

### M-25 — Silme vaatleri ledger retention istisnasıyla çelişiyor

Privacy policy append-only ledger kayıtlarının silinmediğini açıklar
(`apps/web/app/(marketing)/privacy/page.tsx:35-36`). Data-retention docs
(`apps/web/content/docs/core-concepts/data-retention.mdx:6-8,21-25`) ve FAQ
(`faq.mdx:41-44`) istisnasız “removed” vaat eder. Support/GDPR/KVKK beklentisi resmi yüzeyler
arasında farklıdır.

### M-26 — Binding pricing, onaylı üç non-zero tool maliyetini göstermiyor

Pricing “what each run spends” deyip altı satır listeler
(`apps/web/app/(marketing)/pricing/page.tsx:11-18,49-71`). Generated referanslarda
`ranked_keywords=65`, `analyze_backlinks=70`, `compare_competitors=90` kredidir. DFS live
olduğunda resmi/binding pricing yüzeyi kullanıcının harcayabileceği üç büyük maliyeti atlar.
Pricing testi de yalnız seçili altı satırı pinler.

### M-27 — Product dependency lisans politikası gated değil ve mevcut ağaçla uyuşmuyor

`contract.md:3-6` yeni bağımlılıklar için yalnız MIT/Apache-2/ISC/BSD kabul eder.
`pnpm licenses list --prod --json` LGPL-3.0-or-later, Python-2.0, CC-BY-4.0, MPL-2.0,
0BSD ve MIT OR CC0-1.0 kategorileri raporladı. Bu “yasadışı kullanım” iddiası değildir;
repository'nin kendi allowlist politikasının belgelenmiş exception ve CI kontrolü olmadan
karşılanmadığı bulgusudur.

### M-28 — Next internal Server Function endpoint disclosure advisory'si uygulanabilir

`next@16.2.10`, `pnpm audit` içinde
[GHSA-955p-x3mx-jcvp](https://github.com/advisories/GHSA-955p-x3mx-jcvp) ile işaretlendi.
Uygulama Server Actions kullandığı için internal function endpoint/identifier görünürlüğü
teorik paket varlığından öte erişilebilir surface'tir. Tek başına action authorization bypass
kanıtı değildir; fakat reconnaissance maliyetini düşürür ve H-07 ile aynı patch eksikliğinin
parçasıdır.

## Low bulgular

### L-01 — Reaper “zaten refund” ile “zaten commit”i ayıramıyor

`apps/mcp/src/queue/reaper.ts:165-180` iki durumu aynı “already settled” hatasından okur;
`:199-204` kullanıcı mesajını her zaman “charge settled” seçer. Release başarılı fakat job
update başarısız olmuşsa sonraki sweep, para iade edilmişken kullanıcıya charge kaldı der.

### L-02 — `/status` reaper metriği gerçek reaper'ı gözlemleyemiyor

Metrics process-local (`apps/mcp/src/metrics.ts:87-93`); Fly web ve worker process group'ları
ayrı (`fly.toml:20-23`). Worker sweep yapsa bile public web `/status` normalde
`reaperRuns:0,lastReaperRunAt:null` gösterebilir. Canlı gözlem de bu şekli verdi.

### L-03 — Internal exception metni authenticated MCP client'a dönüyor

`apps/mcp/src/tools/registry.ts:269-279`, `error.message` değerini tool output'a ekler.
DB/RPC/provider hataları relation, function, schema ve operasyon detayı sızdırabilir.

### L-04 — DataForSEO client'ları zorunlu package boundary dışında

AGENTS/contract ve master spec dış API client'larını mock/fixture arkasında
`packages/core`a koyar; live DFS fetch adapter'ları `apps/mcp/src/dfs/*.ts` içindedir.
Davranış açığı değil, test/policy merkeziyetini bozan mimari drift'tir.

### L-05 — Waitlist membership ve Resend contact ID anonim kullanıcıya dönüyor

Route core sonucunu doğrudan döner (`waitlist/route.ts:26-28`); sonuç `id` ve
`alreadyExisted` içerir (`waitlist.ts:29-33,43-53`). Hedef e-posta listede mi sorgulanabilir
ve provider identifier gereksiz yere açılır.

### L-06 — Auth callback canonical fallback config hatasında Host-origin'e güvenir

`apps/web/app/auth/callback/route.ts:37-42`, `WEB_BASE_URL` yoksa request `url.origin` kullanır;
yorum proxy Host spoof riskini kabul eder. Doğru prod env altında kapalıdır, fakat broken
deployment auth sonrasında saldırgan-controlled origin redirect üretebilir.

### L-07 — Empty `NEXT_PUBLIC_SITE_URL` onboarding URL'lerini bozuyor

Signup ve welcome mail `??` kullandığı için set-but-empty değer fallback'i tetiklemez
(`auth-form.tsx:28-34`, `lib/billing/welcome.ts:80-86`). Confirmation redirect ve e-posta linki
relative olabilir.

### L-08 — Paddle init hatası sessiz, Buy düğmesi kalıcı disabled

`checkout-button.tsx:35-48` init rejection'ı yalnız console'a yazar; `:88-102` Paddle null
iken kullanıcıya error/retry göstermeden düğmeyi disabled tutar.

### L-09 — Billing dokümanı canlı checkout ile çelişiyor

`apps/web/content/docs/billing-and-credits.mdx:10-11` beta hesapları “trial credits only” der;
dashboard environment-enabled Paddle checkout sunar ve Terms güncel satışı anlatır. Aynı resmi
ürün iki farklı satın alma durumu bildirir.

### L-10 — GSC OAuth state tek kullanımlık değil ve PKCE yok

`apps/web/lib/gsc/oauth.ts:20-34` code challenge; callback exchange code verifier göndermez.
`apps/web/lib/gsc/state.ts:30-34` nonce store/replay reddi olmadığını açıklar. Signed state,
session binding ve 10 dakika expiry riski ciddi azaltır; bu yüzden Low defense-in-depth'tir.

### L-11 — Auth/dashboard için repository-enforced frame protection yok

`apps/web/next.config.ts:17-35` `frame-ancestors 'none'` yalnız `/r/:slug*` için ayarlar;
`netlify.toml` global CSP/X-Frame-Options koymaz. 2026-07-28 canlı `/`, `/login`, `/app`
cevaplarında HSTS ve nosniff vardı; frame protection, Referrer-Policy ve Permissions-Policy
yoktu. Login/dashboard clickjacking savunması platform varsayımına bırakılmıştır.

### L-12 — MCP public cevaplarında security header yok ve teknoloji banner'ı açık

Canlı `/healthz` ve `/status` `x-powered-by: Express` döndürdü; CSP/frame/referrer/permissions
header'ları yoktu. JSON endpoint'te CSP etkisi sınırlıdır; banner ve header eksikliği tek başına
exploit değildir.

### L-13 — Public report'un revoke/delete yönetimi yok

Rapor yaratımı public slug üretir (`apps/mcp/src/tools/generate-report.ts:147-159`);
dashboard bunu açıkça yalnız listeleme olarak sunar (`apps/web/app/app/reports/page.tsx:6-10`).
Kullanıcı bearer link'i iptal edemez veya raporu self-service silemez. 64-bit random slug bugün
pratik brute-force kanıtı değildir; asıl eksik yaşam döngüsü kontrolüdür.

### L-14 — Public report lookup negatif-cache/rate limit olmadan DB okuyor

`apps/web/lib/reports.ts:72-85` her random slug için service-role DB query yapar.
Anonim random-path flood Supabase okumasına dönüşür. Public report CSP ve escaped writer XSS'i
iyi sınırlar; bulgu availability yüzeyidir.

### L-15 — API key'in URL path biçimi secret'ı log/history yüzeylerine taşır

`packages/core/src/keys/api-key.ts:93-100` ve server card kişisel `/mcp/{key}` biçimini
destekler. Fixed header endpoint de vardır ve tercih edilebilir. D28 bilinçli ürün kararı olsa
da URL secret edge/access log, config UI, diagnostics ve history'lerde taşınır.

### L-16 — Reconciliation CLI aktif işi refund edecek küçük threshold kabul ediyor

`scripts/reconcile.mjs:20-28` her pozitif finite değeri kabul eder; runbook
`scripts/reconciliation.md:268-271` 90 saniyenin altının aktif işi reaper edebileceğini söyler.
`.15` dakika gibi typo dokuz saniyelik mutating sweep başlatır.

### L-17 — Incident script Node floor'u root `engines` ile uyuşmuyor

Root `package.json` `node >=22` der; `scripts/reconcile.mjs:13-15` ve runbook Node
`>=22.18`/`>=23` ister. Desteklenen 22.0–22.17 incident sırasında recovery scriptini
çalıştıramaz.

### L-18 — Docker build lock dışında registry executable çalıştırıyor

`apps/mcp/Dockerfile:13-26`, Corepack aktivasyonu ve `pnpm dlx turbo@2.10.4` kullanır.
Sonraki install frozen-lockfile olsa da build-stage executable repository lock integrity'sine
bağlı değildir.

### L-19 — SEO/kalite kapıları temsili yüzeylerin çoğunu ölçmüyor

- `lighthouserc.json:6-12` yalnız `/`, `/pricing`, `/how-it-works` ve tek run ölçer; docs,
  blog, legal, auth, dashboard, public-report layout'ları yoktur.
- Root `openGraph.url` homepage'e sabittir (`apps/web/app/layout.tsx:7-20`); pricing/how-it-works
  override etmez ve subpage share metadata'sı ana sayfayı gösterebilir.
- Robots yalnız `/app`i disallow eder; login/signup noindex değildir ve public linklidir.
- Coverage provider/config/threshold yoktur; yüksek test sayısı branch/path kapsamını kanıtlamaz.

## Ek ürün ve dokümantasyon drift'i

Aşağıdakiler ayrı güvenlik açığı değil, yanlış karar üretmeye elverişli gelişim alanlarıdır:

- Master spec ve README marka kararını pending gösterirken ürün SeoGrep'tir.
- Bazı launch/runbook dosyaları 16 tool ister; registry ve generated docs 19 tool'dur.
- Master spec Next 15/Vercel der; runtime Next 16/Netlify ve pg-boss'tur.
- Master spec full account purge der; ledger `ON DELETE RESTRICT` ve privacy istisnası vardır.
- `docs/plans/2026-07-28-dfs10-fiyat-karari.md` 65/70/90 değerlerini imzalayıp başka satırda
  “hepsi ≤60” der.
- `scripts/monitoring.md` aynı capability'yi hem deferred hem live anlatır.
- `docs/runbooks/secret-rotation.md` smoke'ta 16 tool beklediği için sağlıklı 19-tool deploy'u
  yanlışlıkla fail sayabilir.
- `billing-and-credits.mdx` canlı checkout'ı hâlâ launch-sonrası sayar.

## Dependency triage

`pnpm audit --prod --json`: 0 critical, 9 high, 7 moderate advisory; 398 production,
112 optional bağımlılık.

### Uygulanabilir

- Next Server Actions CPU DoS — H-07.
- Next internal Server Function endpoint disclosure — M-28.

### Mevcut kullanımda doğrudan erişilebilirliği kanıtlanmayanlar

- Next single-locale proxy bypass: app i18n/single-locale config kullanmıyor; `/app` server
  layout ayrıca `getUser()` yapıyor, proxy auth guard olarak kullanılmıyor.
- Next custom-server SSRF: Netlify deploy'da custom Next server yok.
- Next rewrites SSRF: `rewrites()` tanımı yok.
- Next Edge Server Action payload: actions default Node runtime'da.
- Next Image SVG DoS ve `sharp`: repository `next/image`/image optimizer kullanımı bulunmadı.
- `@hono/node-server` Windows traversal: production Linux ve Hono `serveStatic` kullanılmıyor.
- PostCSS file-read/path/XSS ve js-yaml CPU: yalnız trusted repository build content'i
  işliyor; untrusted runtime CSS/YAML yolu bulunmadı.
- `fast-uri`: transitive MCP SDK/AJV doğrulama yolunda; advisory var fakat crawler network
  target parsing'i bu pakete dayanmıyor, somut host-confusion sink'i kanıtlanmadı.

Bu maddeler “yükseltmeye gerek yok” demek değildir; exploitability ile bakım borcunu ayırır.

## Kanıtlanarak reddedilen yanlış pozitifler

- **Paddle imza/idempotency yok:** yanlış. Signature verification DB yazısından önce;
  event ID unique ve purchase ref/RPC idempotent. Bulgular distinct event ordering ve payload
  shape üzerindedir.
- **Current cross-tenant query:** tenant-facing job status `getJobForUser` kullanır; id-only
  `getJob` yalnız internal worker'dadır.
- **DNS rebinding açık:** crawler her hop'u doğrulanan DNS adresine pinned dispatcher ile bağlar.
  M-18 daha dar non-global IPv6 sınıflandırmasıdır.
- **Loopback project eklenebilir:** production project normalization IP literal/internal
  domainleri reddeder; test seam'i tenant route'u değildir.
- **Stored report XSS:** sole writer bütün dinamik değerleri HTML-escape eder; `/r` script/form/
  base/frame kapalı katı CSP taşır. Exploit zinciri bulunmadı.
- **GSC disconnect cross-tenant:** session user yeniden türetilir; lookup ve delete hem
  `user_id` hem `project_id` filtreler.
- **GSC open redirect:** GSC connect/callback canonical `WEB_BASE_URL` kullanır. L-06 yalnız
  ayrı auth callback broken-config fallback'idir.
- **API key hash saltsız:** key 24 random byte (~192 bit); SHA-256 offline brute-force için
  salt eksikliği pratik risk yaratmaz.
- **64-bit report slug kolay tahmin edilir:** mevcut hacimde pratik brute force gösterilmedi;
  bulgu revoke/lifecycle ve DB amplification'dır.
- **RLS kapalı:** mevcut migration final state'te 10/10 public tablo için ENABLE+FORCE ve
  owner policies mevcuttur. M-12 gelecekteki zayıflatmayı false-PASS eden guard hakkındadır.
- **Append-only ledger doğrudan UPDATE/DELETE edilebilir:** mevcut trigger/revoke ve DB testleri
  bunu reddeder. Açık rezerv lifecycle ve `adjust` invariantı ayrı problemlerdir.
- **Paddle custom data ile bedava kredi çalınır:** attacker'ın imzalı paid transaction'a
  ihtiyacı vardır. M-05 attribution/integrity bulgusudur, ücretsiz mint iddiası değildir.
- **`get_job_status` başka tenant sonucunu döndürür:** production yol user filter'lıdır.
- **DataForSEO parser failure kesin ücret yazmaz:** vendor'ın başarısız envelope maliyet
  semantiği offline kanıtlanamadı; bulguya yükseltilmedi.
- **Migration 0012 authenticated DELETE açar:** grant yalnız service role'adır ve app delete
  iki tenant filtresi kullanır.

## Doğrulama çıktıları

- Fresh `pnpm turbo run typecheck lint test build --force`: **16/16 task başarılı, 0 cached**.
- Web: **46 test dosyası, 337 test başarılı**; lint ve generated 19-tool docs sync başarılı.
- Core: **11 dosya, 116 test başarılı**.
- DB hızlı unit: **2 dosya, 5 test başarılı**.
- MCP scoped TypeScript no-emit ve ESLint no-cache başarılı; repository-wide fresh test task'i
  de geçti.
- `pnpm audit --prod`: **0 critical / 9 high / 7 moderate**; applicability yukarıda ayrıştırıldı.
- Full-history gitleaks: **414 commit / yaklaşık 2,72 MB**, bulgu yok.
- Lockfile: **934 resolution entry**, eksik integrity veya beklenmeyen git/tarball source yok.
- Statik RLS scripti: 10 tablo PASS; append-only script PASS. M-12 bu PASS'lerin final-state
  zayıflatmasına duyarsız olduğunu ayrıca gösterir.
- Mevcut Lighthouse artifact'ları `/`, `/pricing`, `/how-it-works` için sırasıyla yaklaşık
  performance 0,98 ve SEO 1,00 gösterir; L-19 kapsam eksikliğini anlatır.
- Read-only live gözlem: web `/`, `/login`, `/app`, `/r/nonexistent`; MCP `/healthz`,
  `/status`. Hiçbir form, auth, ödeme, webhook veya ücretli tool çağrısı yapılmadı.

## Öncelik sırası

Bu bir çözüm planı değil; hangi kanıtın önce üretilmesi gerektiğinin risk sırasıdır:

1. H-01 settlement/open-reserve ve M-01 queue dual-write failure testleri.
2. H-02 hostile response/body/link sınır testleri.
3. H-04 secret rotasyonu doğrulanmadan fonlama yapmama; ardından H-03 atomik/global budget kanıtı.
4. H-05 anonim status load/cancellation testi.
5. H-06 admission/trial abuse politikası ile runtime'ın tek sözleşmeye gelmesi.
6. H-07/M-28 patched framework üzerinde regression kapısı.
7. M-02–M-09 Paddle/ledger DB invariant test matrisi.
8. M-10–M-17 tenant ve GSC cryptographic lifecycle sertleştirme kanıtları.
9. M-18–M-28 availability, ürün doğruluğu ve CI/deploy kapıları.
10. Low ve docs drift temizliği.

## Nihai hüküm

Mevcut test/build kapısı yeşil olsa da **canlı para için NO-GO**: settlement rezervlerinin
kalıcı açık kalabilmesi, global olmayan vendor harcama kapısı, rotasyonsuz açığa çıkmış vendor
credential kaydı ve Paddle/ledger invariant boşlukları para doğruluğunu yeterince kanıtlamıyor.

**Kontrolsüz yeni beta kullanıcıları için de NO-GO**: açık signup/trial Sybil yüzeyi, crawler
memory DoS ve public status/waitlist amplifikatörleri shared-service kapasitesini tek saldırgana
açıyor.

Bu hüküm kodun genel kalitesinin düşük olduğu anlamına gelmez. Tam tersine, birçok doğru
güvenlik mekanizmasının çevresindeki recovery, ordering, global coordination ve fail-closed
detaylarının henüz aynı seviyede tamamlanmadığını gösterir.
