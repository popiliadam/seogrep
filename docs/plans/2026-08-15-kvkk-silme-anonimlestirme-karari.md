# KVKK/GDPR Silme Hakkı × Append-Only Defter — Karar Dosyası

> Durum: **HAZIR — İMZA BEKLİYOR. İmzasız hiçbir kod dispatch edilmez** (NEVER#2 + NEVER#6-sınıfı:
> para-invariantı + hukuk). Emsal biçim: `2026-07-28-dfs10-fiyat-karari.md`.
> Tetik: 2026-08-15 N8 oturumu ölçümü — kredi geçmişli hesapta `auth.admin.deleteUser` kalıcı 500
> (`credit_ledger_user_id_fkey` ON DELETE RESTRICT). Şu an self-servis silme YOK; süreç
> support@seogrep.com'a e-posta; **erasure runbook'u hiç yazılmadı** (PLAN'da açık takip işi,
> insan-kararı kalemi PLAN "E-I3/G-I2" olarak zaten kuyruktaydı).
> Olgu tabanı: bu oturumun şema/kod haritası (25 migration + kod yüzeyleri, satır alıntılı) —
> aşağıdaki her iddia oradan; yeniden-türetilmemiştir.

## §0 Ölçülmüş zemin (tartışmasız olgular)

1. **Tek blokör `credit_ledger`'dır**: şemadaki TEK `ON DELETE RESTRICT` (0002:12). Diğer her
   kullanıcı-bağlı tablo CASCADE (users_profile, projects→[jobs SET NULL proje-kolonu,
   crawl/audit/discovery koşuları CASCADE], reports, api_keys, subscriptions, gsc_accounts,
   gsc_connections) ya da SET NULL (events, trial_claims).
2. **Defterde anonimleştirme-UPDATE'i uygulama içinden İMKÂNSIZ** — üç bağımsız katman:
   UPDATE/DELETE/TRUNCATE tüm rollerden REVOKE (0002:36) · KOŞULSUZ `reject_mutation` trigger'ı
   (role ve kolona bakmaz; owner dahil — deletion-copy.test ölçümü) · `check-append-only.sh`
   kapısı + `append-only-armor` goal'ü (gevşetme = insan onayı şartı, yazılı).
3. **Kompozit FK'ler `ON UPDATE NO ACTION`** (0017): çocuğu olan projects/jobs satırının
   `user_id`'si DEĞİŞTİRİLEMEZ → "user_id'yi takma-kimliğe çevir" stratejisi ağaç genelinde
   uygulanamaz; silme-cascade'i tek uygulanabilir temizlik mekaniğidir.
4. **Login e-postası `public`'te değil** — yalnız `auth.users`'ta. `users_profile` kişisel alan
   taşımıyor (id + üç damga). Yani "hesap kaydı tutulur" demek, pratikte **çıplak bir uuid +
   auth satırı** tutulur demek olabilir — e-postasızlaştırılırsa.
5. **Asıl karanlık nokta `paddle_events`**: HAM webhook gövdesi (müşteri kimliği, fatura/vergi
   adresi, custom_data.user_id) · `user_id` kolonu YOK, hiçbir cascade değmiyor · DELETE hem
   REVOKE hem trigger-blok · UPDATE yalnız `processed_at` (identity_immutable) → **payload
   redaksiyonu da uygulama içinden imkânsız** · privacy sayfası bu tabloyu HİÇ anmıyor
   (yayınlanan istisna yalnız "credit ledger"). Vaat, şemanın fiilen tuttuğundan DAR.
6. **GSC tarafında cascade Google'ı bilgilendirmez**: `disconnectAccount` revoke+delete yapıyor;
   ama deleteUser-cascade'i yalnız satırı siler, OAuth grant'i kullanıcının Google hesabında
   canlı kalır. Her erasure akışı, auth'a dokunmadan ÖNCE hesap başına revoke çağırmak zorunda.
7. **Yayınlanan vaat testle kilitli** (`deletion-copy.test.tsx`, M-25): "ledger + hesap kaydı
   kalır, gerisi gider" cümleleri üç yüzeyde pinli. Tasarım bu vaadi ya AYNEN operasyonelleştirir
   ya da vaadi değiştirip pinleri YENİ metne göre günceller (NEVER#8 şerhiyle: davranış değişikliği
   kararı imzalıysa test güncellemesi meşrudur).
8. **`reports.html` içerik silme yolu yok** (revoke yalnız slug'ı nullar); tek temizlik cascade.
   `projects/jobs/reports`'ta DELETE grant'i YOK (yalnız gsc_connections + gsc_accounts'ta var) —
   yani "deleteUser'sız ağaç temizliği" bugünkü grant'lerle uygulamadan YAPILAMAZ.

## §1 Hukuki çerçeve (kısa)

- KVKK m.7 + GDPR m.17: silme hakkı MUTLAK DEĞİL — m.17(3)(b) "yasal yükümlülüğe uyum" ve (e)
  "hukuki taleplerin tesisi/savunması" istisnaları, finansal kayıt saklamayı destekler; KVKK'da
  karşılığı m.5/2(ç)+(e) hukuki yükümlülük/hak tesisi. **Şart: dayanağın YAZILI olması.** Bugün
  hiçbir doküman saklama süresi/dayanak beyan etmiyor (haritada ölçüldü) — mevcut gerekçe yalnız
  "append-only by design", bu bir MİMARİ gerekçe, HUKUKİ dayanak değil. Kapatılacak.
- Paddle **merchant of record**: fatura/vergi saklama yükü esasen Paddle'da. Bizim webhook
  kopyamız (paddle_events) için kendi dayanağımız gerekir: uzlaştırma/idempotency + ihtilaf
  savunması (meşru menfaat / hukuki yükümlülük) — süre sınırıyla birlikte beyan edilmeli.
- Standart sektör çözümü: finansal kayıtta satır silme değil **kimliksizleştirme** — kişiye
  giden bağın koparılması + kalan kaydın dayanak-süre çiftiyle saklanması.

## §2 Seçenekler

### Seçenek A — "Revoke → Ağacı sil → Kimliği koparıp tut" (ÖNERİLEN)

Vaat değişmez ("ledger + hesap kaydı kalır, gerisi gider") — bugün yalnız SÖZ olan şey
OPERASYONEL hâle gelir:

1. **`erase_tenant(user_id)` RPC** (SECURITY DEFINER, owner-yolu; emsal **`claim_trial`** —
   0009:98 + 0020:113 `security definer`; *hakem düzeltmesi 2026-08-17: ilk taslağın andığı 0018
   `apply_subscription_event` YANLIŞ emsaldi — o SECURITY INVOKER'dır (0018:69). claim_trial daha
   güçlü emsal: FORCE-RLS'li, yazma-policy'siz `users_profile` + `credit_ledger`'a owner yoluyla
   FİİLEN yazıyor, canlıda + db-testte kanıtlı — yani A'nın "grant'ler değişmez, owner koşar"
   mekaniği ölçülmüş durumda*): sırayla — gsc_accounts'ları oku → (web katmanında) her biri için
   Google revoke → projects DELETE (0017 gereği jobs.project_id SET NULL olur; crawl_pages/
   audit_runs/gsc_discovery_runs proje-cascade'iyle gider) → jobs/reports/api_keys/subscriptions/
   gsc_accounts/gsc_connections/users_profile DELETE → **trial_claims.user_id → NULL UPDATE**
   (SET NULL'un elle gerçekleştirilmesi — auth satırı silinmediği için FK tetiklenmez;
   service_role'un UPDATE grant'i 0020'de zaten var; `email_fingerprint` KALIR, ki 0020'nin kendi
   gerekçesiyle "daha mahrem hal" ve re-trial kapısının parçası). Grant'ler değişmez;
   `credit_ledger`/`events`/`paddle_events`'e DOKUNMAZ (trigger'lar fiziksel sigorta —
   `events.user_id` de append-only trigger'ı yüzünden NULL'lanamaz, aşağıda kalıntı listesinde).
   Migration numarası: sıradaki boş numara (komşu dalın 0026 `audit_content_runs` rezervasyonuna
   çarpmadan — dispatch anında ölçülür). 0016/0024 zırh üslubuyla, append-only kapısına yeni
   istisna AÇMADAN.
2. **`auth.users` satırı SİLİNMEZ, KİMLİKSİZLEŞTİRİLİR** (RESTRICT'e dokunulmaz): admin API ile
   e-posta → `erased-<uuid>@anon.invalid`, parola/oturum/factor temizliği + ban. **Doğrulama
   varsayımı (uygulama dilimi kanıtlamak zorunda):** `auth.identities` + `user_metadata`'nın da
   temizlendiği/temizlenebildiği ve ban süresinin admin API'de kalıcı kurulabildiği — imza değil
   ölçüm kalemi. **KALINTI ENVANTERİ (hakem düzeltmesi — SET NULL'lar auth-DELETE'siz ATEŞLENMEZ,
   dürüst liste):** (i) çıplak auth-uuid ↔ ledger toplamları; (ii) `trial_claims` satırı —
   `user_id` adım 1'de elle NULL'lanır, `email_fingerprint` (hash — KVKK'da hâlâ kişisel veri
   sayılır) + `email_domain` KALIR (dayanak: re-trial kötüye-kullanım önleme, meşru menfaat —
   imza maddesi 7); (iii) `events` satırları — `user_id` bağıyla KALIR (append-only trigger
   UPDATE'i de blokluyor; ölçüldü: bugün events'e yazan ÜRETİM KODU YOK, tablo fiilen boş — yazar
   eklenirse bu karar yeniden açılır, imza maddesi 8); (iv) `paddle_events` ham gövdesi (madde 2).
   KVKK yeterliliği bu DÜZELTİLMİŞ envanter üzerinden savunulur; dayanaklar §1 ile yazılı beyan
   edilir. Not: auth satırı canlıyken `users_profile` silmek 0015'in re-trial kapısını teorik
   açar — ban + fingerprint fiilen kapatır; uygulama diliminin db-spec'i bunu pinler.
3. **Runbook** (`docs/runbooks/kvkk-erasure.md`): talep → kimlik doğrulama → 30 gün bekleme
   (skill deseni; cayma penceresi) → erase akışı → tamamlama kaydı (events'e İNSERT — append-only
   uyumlu denetim izi) → başvurana yanıt. Beta'da operatör koşar; self-servis buton ayrı karar.
4. **paddle_events dayanak beyanı** (kod yok): privacy + retention doc'a ikinci istisna cümlesi
   ("payment-processing webhook records are retained for reconciliation and dispute defense for
   N years") + deletion-copy pinlerinin YENİ metne göre güncellenmesi. N önerisi: **10 yıl**
   (TR ticari defter uyumu; Paddle MoR olsa da ihtilaf savunması ekseni) — İMZA KALEMİ.
- **NEVER#2/#4 uyumu**: defter ve zırhları bayt-değişmez; RPC kiracı-anahtarlı tek parametre,
  cross-tenant yüzeyi yok (db-spec'le pinlenir: yabancı uuid → 0 satır etkisi).
- **Artı**: en küçük blast radius; vaat-metniyle uyumlu; bugün fiilen çalışmayan sürecin tamamı
  makine-kontrollü hale gelir. **Eksi**: uuid+auth satırı kalır (savunulabilir), paddle_events
  ham gövdesi kalır (dayanakla savunulur; minimizasyon Seçenek A2'de).

### Seçenek A2 — A + yeni-yazmalarda paddle payload minimizasyonu (ORTA VADE EKİ)

Webhook yazıcısı ham gövde yerine doğrulama+uzlaştırma için gereken alt kümeyi (event_id, type,
occurred_at, transaction/subscription id, custom_data.user_id, tutar) saklar; ham gövde saklanmaz.
Geriye dönük redaksiyon YAPILMAZ (trigger + imza gerektirir; mevcut satırlar N-yıl dayanakla
tutulur ve zamanla ölür). NEVER#3 idempotency'ye dokunmaz (event_id kalıyor). — Ayrı dilim,
ayrı imza; A'dan bağımsız uygulanabilir.

### Seçenek B — Takma-kimlik dolaylaması (subjects tablosu)

`credit_ledger.user_id` → `subjects(id)` dolaylaması; auth satırı tamamen silinebilir olur.
**RET önerisi**: 699 canlı satırlı defterde FK rewrite = NEVER#2'nin kalbinde büyük migration;
kazanç yalnız "uuid'li auth satırı da gitsin" — m.17(3) istisnaları zaten saklamayı savunuyor.
Maliyet/risk orantısız.

### Seçenek C — İmzalı DBA runbook'uyla gerçek silme (trigger-disable)

`ALTER TABLE ... DISABLE TRIGGER` + satır silme + yeniden-enable; yalnız owner-yolu, vaka başına
insan eliyle. **RET önerisi**: append-only-armor goal'ünün adıyla yasakladığı gevşetme; kapı
`check-append-only.sh` migration-replay'inde bunu görmez (canlı-DDL) = ölçülemeyen istisna;
muhasebe bütünlüğü kaybı. Yalnız mahkeme/kurum kararına saklı son çare olarak dosyada dursun.

## §3 Önerilen paket (imzaya sunulan)

**A + A2 + aşağıdaki imza maddeleri.** Uygulama sırası: (1) runbook + privacy/retention metin
güncellemesi (dayanaklar) → (2) 0027 `erase_tenant` + db-spec'ler (yabancı-kiracı 0-etki ·
ledger/paddle_events bayt-değişmez · cascade tam-liste) → (3) auth-kimliksizleştirme adımı web
admin yolunda → (4) A2 minimizasyon dilimi. Her dilim ayrı hakem; 0027 cloud-apply operatör
dalgası (0023/0024/0025 emsali).

## §4 İMZA MADDELERİ (her biri ayrı evet/hayır)

1. Model: **Seçenek A** (revoke→ağaç-sil→kimliksizleştir-tut) — B ve C RET.
2. `paddle_events` saklama dayanağı + süresi: uzlaştırma/ihtilaf, **N = 10 yıl** (öneri) —
   privacy'ye ikinci istisna cümlesi + deletion-copy pinlerinin güncellenmesi.
3. Ledger + auth-uuid saklama dayanağının yazılı beyanı (m.17(3)(b)/(e) ∥ KVKK m.5/2) —
   privacy "accounting records" cümlesine dayanak eki.
4. 30 günlük cayma penceresi (skill deseni) — evet/hayır + süre.
5. A2 payload minimizasyonu — evet/hayır (evet ise ayrı dilim olarak kuyruğa).
6. Self-servis silme butonu bu fazda VAR MI (öneri: HAYIR — beta'da e-posta+runbook; buton,
   D17-onay-tasarımı sınıfı ayrı iş).
7. `trial_claims` kalıntısı: `user_id` NULL'lanır, `email_fingerprint`+`email_domain` re-trial
   önleme dayanağıyla KALIR (öneri: EVET — 0020'nin kendi tasarım gerekçesi) — evet/hayır.
8. `events` kalıntısının kabulü: bugün yazarı yok/boş; append-only zırhı gereği user_id bağı
   temizlenemez; tabloya üretim yazarı eklenecek her gelecek dilim bu kararı YENİDEN AÇAR
   (öneri: kabul + bu şerh) — evet/hayır.

## §5 Bu dosyanın yazmadıkları (bilinçli)

Kod yok, migration taslağı yok, test yok — imzasız dispatch yasağı gereği. Ölçülmüş yan bulgular
(B11 jobs.result retention'sızlığı · M-24 90-gün spec-hizası · reports içerik-silme boşluğunun
cascade-bağımlılığı) kendi kayıtlarında; bu tasarım onları ÇÖZMEZ, çakışmaz.
