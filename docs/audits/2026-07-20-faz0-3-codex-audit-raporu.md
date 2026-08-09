# Faz 0-3 Codex Çapraz-Audit Raporu — 2026-07-20

## Yönetici özeti

Denetim snapshot'ı `48c908ef4461be192413495dd72c6e99aa56c346`; denetim sırasında Faz 3.5 dalı ilerlediği için sonraki commitler ayrı durum olarak ele alındı.
Critical #1: crawler snapshot'ta DNS/private-IP korumasını gerçek fetch yolunda kullanmıyor; ilk istek ve redirect SSRF'ye açık, sonraki fixler DNS rebinding'i tam kapatmıyor.
Critical #2: eşleşmeyen fakat ödenmiş Paddle `transaction.completed` olayı kredi vermeden `processed` yapılıyor; müşteri parası otomatik olarak karşılıksız kalabilir.
Critical #3: sohbet kaydına girdiği yazılı tüm prod secret'larının koordine rotasyonu bağımsız kanıtla doğrulanamadı; kapanış kanıtına kadar compromised kabul edilmeli.
En önemli para borçları: aynı job'ın eşzamanlı çift reserve/charge yarışı, kullanılmayan atomik `claim_trial` RPC'si ve commit-sonrası job sonucu kaybı.
En değerli ürün önerileri: versioned structured tool sonuçları, gerçek audit/discovery bulgularını taşıyan raporlar ve signup→ilk değer onboarding/funnel paketi.
En değerli ölçek önerisi: `jobs.result` tek JSONB yerine chunked crawl + page/edge depolama + progress/lease/reaper mimarisi.
RLS 10/10 ENABLE+FORCE, ledger SUM modeli, Paddle imza/idempotency çekirdeği, AES-GCM token saklama ve 106 DB entegrasyon testi güçlü taraflar.
Canlı `seogrep.com`, `/pricing`, `/docs`, örnek `/r/...` ve MCP health GET'leri 200; Fly'da web ve worker makineleri ayakta, `DFS_LIVE` secret listesinde yok.
Hüküm: canlı para ve yeni beta davetleri için **NO-GO**; aşağıdaki sıralı koşullar kapanınca koşullu GO yeniden değerlendirilebilir.

### Kapsam, snapshot ve kanıt disiplini

- Kör okuma sırası tamamlandı; önceki raporun kendisi ve sertleştirme promptu bu sentez yazılana kadar açılmadı.
- Zorunlu `progress.md` dosyasının 367. satırında önceki audit'in kısa özeti bulunuyordu. Bu nedenle kusursuz körlük teknik olarak mümkün değildi; A-I agent'ları yalnız iş emirleriyle izole edildi ve önceki rapor dosyasını açmadı.
- Satır referansları aksi belirtilmedikçe snapshot commit `48c908e` içindir. Ortak çalışma ağacı denetim sırasında değiştiğinden kanıtlar `git show 48c908e:<path>` ile sabitlendi.
- Snapshot'tan sonra `9130fde` crawler origin/redirect kontrolünü, `0bbb451` internal/reserved domain reddini, `53ab2f5` ek range testlerini ekledi. Bunlar bulgunun varlığını geriye dönük değiştirmez; mevcut durumu ayrıca etkiler.
- `bash guardrails/verify.sh`: temiz snapshot arşivinde 16/16 Turbo task PASS; denetim sırasında dirty ara durumda bir kez lint FAIL, sonraki stabil Faz 3.5 HEAD'de yeniden PASS.
- `bash guardrails/verify-db.sh`: migration 0001–0010 temiz reset; `packages/db` 37/37 ve `apps/mcp` DB lane'i 69/69 PASS.
- `PROD_URL=https://seogrep.com make goals`: 13/13 PASS; `mcp-alive` ve `trial-flow-e2e` için `MCP_SMOKE_URL` verilmediğinden ücretli/canlı kısımlar SKIP.
- Public GET: `/`, `/pricing`, `/docs`, `/r/BXrSwjichTQ` ve `mcp.seogrep.com/healthz` 200; uydurma rapor slug'ı 404. Rapor canlıda `noindex` ve yalnız SeoGrep kaynaklarına istek yaptı.
- `flyctl status`: iki web makinesi started/healthy, bir worker started, bir standby worker stopped. `flyctl secrets list`: 10 beklenen ad deployed, `DFS_LIVE` yok; değerler okunmadı ve rapora yazılmadı.

## Paket A — Güvenlik

### A-C1 — Critical — Crawler gerçek fetch yolunda SSRF'ye açıktı; güncel fix DNS rebinding'i tam kapatmıyor

Snapshot'ta `apps/mcp/src/crawler/ssrf.ts` 42 iyi pure teste sahipti fakat `crawlSite` tarafından çağrılmıyordu. `crawl.ts:455-474` URL parse/protokol kontrolünden sonra `/robots.txt` isteğini yayıyor; `crawl.ts:371-384` robots/sitemap redirect'ini `redirect: "follow"` ile önce gönderip son hedefi sonra yargılıyordu. `crawl.test.ts:321-341` loopback hedefin gerçekten çağrılmasını başarı olarak pinliyordu.

Bu, tenant kontrollü domain veya redirect ile RFC1918, link-local/metadata, Fly internal/6PN ve localhost HTTP yüzeylerine istek emisyonudur. Denetim sırasında gelen `9130fde` origin DNS kontrolü ve manual redirect ekledi; `0bbb451` internal/reserved adları reddetti. Ancak `ssrf.ts:21-28` de belirttiği gibi kontrol ayrı DNS çözümü, sonraki `fetch` ayrı çözüm yapıyor; IP-pinned dispatcher yok. Public-first/private-second DNS rebinding ve aynı-origin yeniden çözüm kalıntısı nedeniyle bugünkü düzeltme tam kapanış sayılmaz.

Öneri: her istek ve her redirect hop'u için tek çözümden elde edilen IP'ye bağlanan dispatcher/agent kullan; Host/SNI'ı orijinal hostta tut; tüm A/AAAA sonuçlarını doğrula; redirect, IPv4/IPv6-mapped ve DNS değişimi negatif testlerini gerçek request-log ile pinle.

### A-C2 — Critical operasyonel kapı — Prod secret rotasyonu kanıtlanamadı

`PLAN.md:29,141-143` ve `progress.md:279,321,326,353` service-role/sb_secret, DB şifresi, Google secret, token-encryption key ve DFS şifresinin sohbet kaydına girdiğini ve koordine rotasyonun açık insan işi olduğunu kaydediyor. Fly release/secrets salt-okunur kontrolleri servislerin çalıştığını gösterdi, fakat hangi değerlerin ne zaman rotasyondan geçtiğini kanıtlamıyor.

Bu defter beyanına tek başına güvenilmedi: bağımsız rotation receipt/digest-before-after ve Netlify/Fly çift-güncelleme kanıtı yok. Secret incident disiplini gereği kapanış kanıtına kadar tamamı compromised kabul edilmeli. Rotasyon; Supabase service key + DB password, Google client secret, `TOKEN_ENCRYPTION_KEY`, DFS credential ve sohbet sırasında açığa çıkan diğer credential'ları kapsamalı; eski değerlerin revoke edildiği ayrı doğrulanmalı.

### A-I1 — Important — Service-role tenant filtreleri yardımcı imzalarında zorunlu değil

`apps/mcp/src/db.ts:350-352` `touchLastUsed` yalnız key id; `queue/boss.ts:143-148,291-324` bazı job read/update'ları yalnız job id; `packages/db/src/api-keys-repo.ts:103-125` ownership/revoke yalnız key id; `apps/web/lib/gsc/store.ts:87-103` tenant-scoped read sonrası update'i row id ile yapıyor. Mevcut çağrılar çoğunlukla ön kontrol yapıyor, doğrudan exploit kanıtlanmadı; fakat service role RLS'yi bypass ettiği için yanlış gelecek çağrı cross-tenant mutasyona dönüşür.

Öneri: keşif amaçlı `findActiveKeyByHash` ve capability slug okuması dışında her helper `userId` alsın ve aynı SQL/PostgREST sorgusunda `.eq("user_id", userId)` uygulasın; id-only low-level fonksiyonlar private isimlendirilsin.

### A-I2 — Important — Invalid-key DB DoS ve instance-local limit

`apps/mcp/src/auth.ts:101-105` format/hash sonrası DB lookup, sonra rate-limit yapıyor; `auth.ts:138-165` limiter yalnız bulunan key id ve process memory üzerinde. İyi formatlı sınırsız sahte key her istekte DB'ye gider; iki web instance limiti ayrı uygular. Unknown ve revoked için aynı 401 GOOD, fakat internet-açık lookup yüzeyi korunmuyor.

Öneri: edge/Fly seviyesinde IP + hashed-prefix pre-auth limiter, paylaşımlı/adaptive store ve 401/429/DB-latency alarmı.

### A-I3 — Important — Gitleaks tüm test dosyalarını kör nokta yapıyor

`.gitleaks.toml:16-23` default ruleset'i koruyor, ancak `.*\.test\.tsx?$` tüm test dosyalarını allowlist ediyor. `.github/workflows/ci.yml:22-30` history tarasa bile testlere yanlışlıkla giren gerçek credential görünmez.

Öneri: yalnız bilinen deterministik fixture fingerprint/rule-id/path+line sınıfını gerekçeli allowlist et; bütün test uzantısını değil.

### A-I4 — Important/dağıtıma bağlı — Redirect origin canonical değil

GSC connect/callback ve auth callback sabit path'i `new URL(..., request.url origin)` ile kuruyor (`apps/web/app/api/gsc/connect/route.ts:21-35`, `gsc/callback/route.ts:29-40`, `auth/callback/route.ts:31-78`). Netlify attacker-controlled Host/X-Forwarded-Host'u normalize etmezse attacker origin'ine redirect üretilebilir. Arbitrary path alınmadığı için klasik açık redirect yok; risk edge davranışına bağlıdır.

Öneri: `WEB_BASE_URL` canonical origin veya explicit host allowlist; Netlify forwarded-host entegrasyon testi.

### A-I5 — Important test boşluğu — RLS negatifleri her tabloyu kapsamıyor

Migration taraması 10/10 tabloda ENABLE+FORCE gösterdi. Gerçek authenticated A/B negatifleri api_keys, ledger ve reports için var; `users_profile`, `projects`, `subscriptions`, `jobs`, `gsc_connections`, `events` için direct RLS negatif testi yok. Service-role app filter testleri RLS testi değildir.

Öneri: tek parametrik suite ile her tenant tablosunda A-own pozitif, B-read/write negatif; `paddle_events` yalnız service-role kanıtı.

### A-S1 — Doğrulanamadı — Cloud-only `rls_auto_enable()` search_path

`0004_harden_rls_auto_enable.sql:7-16` EXECUTE revoke ediyor fakat fonksiyon gövdesini/versioned `search_path` ayarını taşımıyor; `0009:149` yalnız cloud'da pinli olduğunu söylüyor. Event trigger çağrısı EXECUTE grant'ından bağımsızdır. Canlı DB'ye bağlanılmadı.

Gereken salt-okunur kanıt: `pg_proc.prosecdef`, `proconfig`, fonksiyon gövdesi ve trigger owner sorgusu. Repo migration'ında fonksiyonu tam tanımlamak daha güvenli.

### A-M1 — Minor — GSC state nonce'u tek kullanımlık değil

`apps/web/lib/gsc/state.ts:30-34` HMAC, 10 dakikalık TTL ve user/session eşleşmesi güçlü; nonce server-side consume edilmiyor. OAuth code tek kullanımlığı riski azaltır. PKCE + one-time nonce store defense-in-depth'tir.

### A-GOOD

- `claim_trial`, ledger ve Paddle SECURITY DEFINER fonksiyonları `search_path=''`, fully-qualified isimler ve service-role-only EXECUTE kullanıyor.
- API key CSPRNG 192-bit; DB'de plaintext değil SHA-256 hash/prefix var (`packages/core/src/keys/api-key.ts`, `apps/mcp/src/db.ts`).
- GSC token AES-256-GCM, taze IV/tag ve strict key doğrulamasıyla şifreli; cross-tenant testleri var.
- HTML generator dinamik stringleri escape ediyor ve external URL üretmiyor; bugünkü tek writer güvenli. Public raw-HTML sink nedeniyle CSP/sanitizer yine defense-in-depth olarak önerilir.

## Paket B — Para doğruluğu

### B-C1 — Critical — Ücretli Paddle olayı kredi vermeden terminal `processed`

`apps/web/app/api/paddle/webhook/route.ts:129-145`, `transaction.completed` price/user attribution eşleşmezse yalnız `console.error`, `markProcessed` ve HTTP 200 yapıyor. `route.test.ts:215-226` bunu “REAL customer money left un-credited; Paddle will not retry” diye özellikle pinliyor.

Ham event manuel kurtarmayı mümkün kılsa da otomatik entitlement yok; `processed_at` iş gerçeğini yanlış temsil ediyor. Live money öncesi bu dal 5xx/NULL-processed + alarm/reconcile state olarak kalmalı veya doğrulanmış transaction'dan güvenli attribution yapılmalı. Recovery idempotent olmalı.

### B-I1 — Important — Aynı job eşzamanlı çift reserve/charge yapabiliyor

`queue/worker.ts:103-126` önce queued okuyor, sonra atomik compare-and-set olmadan running yazıyor. `0005_ledger_functions.sql:45-57` bakiye lock'u var fakat aynı `job_id` reserve dedupe yok; `queue/boss.ts:319-333` ikinci reserve id ile job satırını ezebilir.

Yerel rollback repro'sunda 100 bakiye ile aynı `job_id` için iki `reserve_credits(...,20,...)` iki farklı reserve id, iki reserve satırı ve 60 bakiye üretti. Mevcut “same job cannot double-spend” testi yalnız 20 bakiye veriyor; ikinci çağrı idempotency değil yetersiz bakiye yüzünden düşüyor (`guard.db.test.ts:143-179`).

Öneri: job claim'i tek SQL `UPDATE ... WHERE status='queued' RETURNING`; queue delivery identity + settlement invariant; aynı job/attempt için unique/transactional guard ve gerçek concurrent test.

### B-I2 — Important — Atomik `claim_trial` var ama prod caller eski iki statement

`0009:95-133` ve `claim-trial.db.test.ts:121-167` doğru rollback/concurrency RPC'sini kanıtlıyor. Prod `apps/web/lib/billing/trial.ts:45-72` önce `trial_granted_at` lock'u, sonra ayrı `grantCredits` yazıyor; callback `auth/callback/route.ts:59` bunu çağırıyor. Aradaki hata kullanıcıyı kalıcı locked-but-creditless bırakır.

Öneri: prod helper yalnız `rpc("claim_trial", {p_user_id,p_amount})` kullansın; web-level failure/retry testi RPC'yi pinlesin.

### B-I3 — Important — Kredi commit'i job sonucundan önce kalıcılaşıyor

`worker.ts:125-131` `withCredits` içinde commit eder, sonra `completeJob` sonucu yazar. Commit başarılı/result update başarısızsa catch job'ı failed yapar; müşteri öder fakat çıktı kaybolur. Failure-injection/reconciler yok.

Öneri: sonuç persistence ve settlement tek transaction/outbox state machine; en azından `paid_but_result_pending` durumu + idempotent recovery.

### B-I4 — Important — DB ledger şekil invariantlarını zorlamıyor

`0002_credit_ledger.sql:10-18` yalnız kind enum kontrol ediyor. Delta işareti, commit için `delta=0`, reserve/release için `reserve_id` zorunluluğu DB CHECK değildir; service role INSERT yetkili. Yerel rollback repro, `kind='spend_commit', delta=-999, reserve_id=NULL` satırını kabul edip bakiyeyi negatife indirdi.

Uygulama yolu bugün doğru ve core zod reddediyor; fakat “DB son söz” para tasarımı için CHECK constraint veya tüm INSERT'i revoke edip yalnız sıkı RPC'lere grant gerekir.

### B-I5 — Important operasyon — Open reserve reconciler yok

Handler hatasında release, commit hatasında no-release yönü muhafazakâr ve doğrudur (`guard.ts:76-126`). Fakat release/commit/crash arızalarında open reserve kapanmıyor; gerçek reaper/runbook yok. Ücretli kullanıcıdan önce stuck/open-reserve sorgusu, alarm, operatör onaylı release ve audit kaydı gerekir.

### B-M1 — Minor — Tool fiyatının marketing kopyası ayrı

Tahsilat `TOOL_COSTS`; marketing işlem satırları `pricing/page.tsx:7-14` literal. Paket kredi ve plan/top-up fiyatları ortak kaynaktan geliyor; tool marketing drift'i generator kapsamı dışında.

### B-GOOD

- Ledger append-only: UPDATE/DELETE/TRUNCATE revoke + trigger; RLS ENABLE+FORCE.
- Bakiye yalnız server-side `SUM(delta)`/`credit_balances`; 1.500 satır regresyonu max-row kesmesini kapatıyor.
- Reserve oversell ve commit/release XOR advisory lock altında, concurrency testli.
- ChargeMode `surface|worker|handler` güncel yüzeyde çift sarmalamıyor.
- Webhook imzası DB client'tan önce doğrulanıyor; `event_id` PK, NULL-processed retry, purchase grant+processed tek RPC ve ref advisory lock güçlü.

## Paket C — Test gerçekliği ve kod kalitesi

### C-I1 — Important — Bazı testler yanlış davranışı kanıt diye pinliyor

- SSRF redirect testi saldırı hedefinin gerçekten çağrılmasını bekliyordu; doğru pre-emission negatifler snapshot'ta FAIL.
- Paddle unmatched-paid testi 200 + processed + no credit'i başarı sayıyor.
- “same job id cannot double-spend” testi tek maliyet kadar fonlayarak idempotency yerine insufficient balance ölçüyor.
- Trial unit mock builder `.eq/.is` argümanlarını kaydetmiyor; user id/NULL guard kaldırılsa test yeşil kalabilir.

Bu dosyalar vakum değil; daha tehlikelisi yanlış gereksinimi sabitlemeleri. Test adları invariantı değil gerçek adversarial koşulu ölçmeli.

### C-I2 — Important — DFS bütçe testleri fail-open ve concurrency boşluğunu kaçırıyor

`apps/mcp/src/dfs/budget.ts:73-79` ENOENT dahil her read hatasını `$0` sayıyor; EACCES/I/O negatif testi yok. Check ve append ayrı olduğu için eşzamanlı live çağrılar aynı toplamı görüp limiti aşabilir. Fly `/tmp` sayaç da restart/makine başına sıfırlanır.

### C-I3 — Important test boşluğu — Append-only mutation regresyonu yok

Migration zırhı doğru, ancak DB suite authenticated/service-owner UPDATE, DELETE ve TRUNCATE girişimlerini doğrudan denemiyor. Anayasal invariant için bu negatifler zorunlu goal olmalı.

### C-S1 — Şüphe/hardening — Raw report sink provenance'a bağlı

`report/html.test.ts` gerçek generator escape'ini iyi testliyor. `app/r/[slug]/page.tsx` DB HTML'ini `dangerouslySetInnerHTML` ile verbatim render ediyor; page testi de bunu pinliyor. Bugünkü tek service-role writer güvenli, dolayısıyla tenant exploit kanıtlanmadı. İkinci writer/import yolu eklenirse stored-XSS olur; CSP/sanitizer veya signed-renderer provenance savunması önerilir.

### C-MINOR

- Property suite aynı seed ile 100 ve 250 run yaparak ilk kısmı tekrar ediyor; invalid generator purchase/release/extra-field/non-integer şekillerini tam üretmiyor.
- `crawl.ts` snapshot'ta 604, docs generator 662 satır; 800+ kaynak yok fakat crawler parser/fetch/robots/sitemap/orchestration'ı tek dosyada topluyor.
- Prod `as any` yok; tek eşleşme test mock'unda. `.skip/.only` yok.

### C-GOOD

35+ vaka/15+ dosya satır satır incelendi. HMAC, webhook replay/NULL retry, Paddle concurrent ref, claim_trial rollback/concurrency, auth revoked/cross-tenant, HTML escape, ledger properties ve RLS rapor testi gerçek davranışı ölçüyor. Git geçmişinde test dosyası silme veya `.skip/.only` ile yeşile çekme kanıtı bulunmadı.

## Paket D — Deploy, CI ve env

### D-I1 — Important — Deploy path filtresi Docker image girdilerini kaçırıyor

`deploy-mcp.yml:9-12` yalnız `apps/mcp/**`, `packages/core/**`, workflow'u izliyor. Docker prune/build; root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` ve `.dockerignore` girdilerine bağlı. Bu dosyalar tek başına değişirse main deploy tetiklenmez.

Öneri: prune output/input listesiyle path filter'ı test et; tüm root manifest/lock/config/build-context girdilerini ekle veya path filter'ı kaldır.

### D-I2 — Important — Prod env negatif sözleşmesi eksik

MCP ana env ve DFS/GSC core testleri iyi. Fakat `apps/mcp/src/db.ts`, `packages/db/src/server.ts`, web Supabase client/server/proxy, waitlist deps, billing portal ve bazı GSC `WEB_BASE_URL`/public Supabase kombinasyonları eksik env testine sahip değil. Env'siz temiz snapshot arşivinde `CI=true verify.sh` tamamen PASS; eksik public Supabase prod env'si kapıyı kırmıyor.

Öneri: her env factory tek strict schema/factory'den geçsin; produn gerçek adlarıyla parametrik missing-variable testleri ve route composition testleri.

### D-I3 — Important — CI Action ve image pinleri mutable

Checkout, pnpm setup, setup-node major tag; gitleaks v2 tag. Yalnız Fly setup tam SHA pinli. `node:22-alpine` digest değil; `pnpm dlx turbo@2.10.4` lockfile dışı executable indiriyor. Deploy secret step-scoped olsa da önceki mutable action workspace/PATH etkileyebilir.

Öneri: tüm Actions full SHA + update bot; base image digest; Turbo root devDependency/pinned binary.

### D-I4 — Important — DFS bütçesi günlük global değil

`fly.toml:14-18` `/tmp/dfs-spend`; reboot/deploy ve her makine sayaç sıfırlar. `DFS_LIVE` şu an kapalı olması GOOD; yeniden açılmadan atomik DB/ortak sayaç şart.

### D-MINOR

- `/healthz` yalnız liveness `{ok:true}`; DB/queue/worker readiness değil.
- `fly.toml:45-46` worker'ı stub/scale-0 diye anlatıyor; live `flyctl status` worker'ın çalıştığını gösterdi. Yanlış yorum operatörü gerçek consumer'ı kapatmaya yöneltebilir; etkisi nedeniyle birleşik koşullarda öne alındı.

### D-GOOD

Workflow permissions `contents: read`; Fly token yalnız deploy step; `.dockerignore` env/git metadata'yı dışlıyor. Docker multi-stage core→MCP build, prod-only runtime, `USER node`; Fly MODE ve internal port uyumlu. `verify-db.sh` clean-checkout workspace build düzeltmesini içeriyor; CI aynı scriptleri çağırıyor.

## Paket E — Docs dürüstlüğü ve vitrin

### E-I1 — Important — Rollover/2× cap politikası uygulanmıyor

Canlı `/pricing` ve `billing-and-credits.mdx` “unused credits roll over for one month, capped at twice...” diyor. Runtime her completed transaction'da tam krediyi append ediyor; bakiye tüm ledger toplamı. Süre, expiry, rollover bucket veya 2× cap kodu yok. Para vaadi ya uygulanmalı ya beta copy'sinden kaldırılmalı; rakam/politika değişikliği insan onayı gerektirir.

### E-I2 — Important — “One trial per domain” uygulanmıyor

Pricing bunu vaat ediyor; trial lock yalnız user id. `(user_id,domain)` uniqueness farklı hesapların aynı domain için trial almasını engellemez. Invite/abuse gate ile birlikte çözülmeli veya copy dürüstçe daraltılmalı.

### E-I3 — Important — 90 günlük otomatik silme/full purge uygulanmıyor

Privacy ve retention docs raw crawl'ın 90 günde otomatik silindiğini söylüyor. Scheduler/TTL/purge endpoint/runbook yok; crawl `jobs.result` içinde kalıyor. Ledger `ON DELETE RESTRICT` nedeniyle “account deletion removes all” da gerçek uygulama akışına sahip değil. Bu bir compliance ve güven vaadi sapmasıdır.

### E-I4 — Important — Audit/rapor davranışı fazla vaat ediliyor

- `/how-it-works`: “Crawls and audits run as background jobs”; yalnız crawl async, auditler sync.
- Chat demo `audit_onpage` için broken internal links gösteriyor; onpage rule engine'de broken-link yok.
- “Any analysis can become an HTML report”; generator yalnız crawl/GSC pull okuyor, audit/discovery bulgularını persist/roll-up etmiyor.
- “Full on-page + technical audit — 50” metni 30+15=45; 50 ancak schema 5 de açıkça dahilse doğru.

### E-I5 — Important — One-time MCP URL ile kurulum/troubleshooting çelişiyor

Plain URL yalnız create/rotate dönüşünde bir kez görünür; sonrasında maskeli. Docs “dashboard'dan yeniden copy” diyor. Kullanıcı rotate etmek zorunda kalır. Rehber one-time reveal, güvenli saklama ve recovery/rotate akışını açıkça anlatmalı.

### E-I6 — Important — Tool docs kapısı stale dist ile false-PASS olabilir

Generator `apps/mcp/dist` import ediyor; source değişip build edilmezse mevcut dist ile PASS. Goal yalnız dist yoksa build ediyor; ana `verify.sh` docs check/goals çağırmıyor. Generator byte drift, `confirm`, tool sıra/meta'yı yakalıyor; handler davranışı/output, JSON-schema min/max/enum/pattern/default, marketing/privacy/recipes ve live deploy drift'ini yakalamıyor.

### E-MINOR — 5 client uygulanabilirliği

- Claude.ai/Desktop remote connector çalışır; “paid plans only” güncel değil ve menü güncel `Customize → Connectors`. Team/Enterprise owner rolü belirtilmeli.
- Claude Code HTTP komutu çalışabilir; resmi sıra `claude mcp add --transport http seogrep YOUR_MCP_URL`; global kullanım için `--scope user` anlatılmalı.
- Cursor `.cursor/mcp.json` doğru; global `~/.cursor/mcp.json` eksik.
- Windsurf `mcp_config.json` ve `serverUrl/url` uygulanabilir.
- Tümünde ilk smoke “Crawl my site” boş hesapta proje id'si vermez; önce `setup_project` anlatılmalı.

Resmi doğrulama: Anthropic custom connectors ve Claude Code MCP belgeleri, Cursor MCP belgesi, Windsurf MCP belgesi.

### E-GOOD

Uydurma müşteri sayısı/testimonial/rating/logo/“most popular” yok. Demo illustrative etiketi taşıyor. Paket/plan/top-up rakamları ortak kaynaktan ve canlıyla uyumlu. 16 generated tool sayfası registry/cost kaynağına bağlı. GSC'nin ilk değer için opsiyonel olduğu iddiası kodla uyumlu.

## Paket F — Lisans ve AGPL

### F-I1 — Important release-gate — Third-party notice/SBOM yok

Repo snapshot'ında LICENSE/COPYING/NOTICE/third-party notice yok. Prod tree 396 paket içinde AGPL/GPL/SSPL/unknown bulunmadı; ancak `@img/sharp-libvips-*` LGPL-3.0-or-later, `lightningcss` MPL-2.0 ve `caniuse-lite` CC-BY-4.0. Salt hosted çalıştırma tüm uygulamayı açma yükümlülüğü doğurmaz; container/browser artefact dağıtımında lisans metni, attribution ve ilgili source/relink koşulları yönetilmelidir.

Öneri: release'te deterministic SBOM + third-party notices; repo'nun özel/proprietary lisans statüsünü açıkça belgele.

### F-GOOD — Platinum temiz-oda kanıtı

Platinum repo erişilebilir ve AGPL-3.0. SeoGrep crawler/audit/report 27 TS dosyası ile platinum ilgili 153 dosyada normalize 3-satır shingle taraması:

- SeoGrep 1.853 blok / 1.818 unique; platinum 22.581 / 20.730 unique; kesişim **0**.
- Yakın-blok 4-token gram Dice en yüksek yalnız `0,1622`; ortaklık standart `<meta name="robots">` alan kavramı.
- Dosya çiftlerinde 2+ ortak normalize 7-token gram yok.

Sonuç: incelenen modüllerde 3+ satır birebir/yakın kopya kanıtı yok; ortak title/meta/H1/canonical/JSON-LD fikirleri standart SEO kavramlarıdır. `pg-boss` MIT, MCP SDK MIT, Paddle SDK/JS Apache-2.0; `googleapis` manifest/lock'ta yok.

## Paket G — Operasyonel borç envanteri

Diskteki mutable progress defteri 31 deduplu aile verdi: 8 Important açık, 13 Minor açık, 6 kapanmış, 4 stale/tercih. Faz 4'e doğrudan geçmeden operasyon dilimi gerekir.

### G-I1 — Important — Stuck job/open reserve reaper ve runbook yok

`worker.ts:23-26` running işi dış reconciliation'a bırakıyor; `guard.ts:18-20,81` settlement arızasını kapatmıyor. Gerekli: job-age/open-reserve sorgusu, release/paid-result recovery kararı, periyodik reaper, alarm ve immutable operatör kaydı.

### G-I2 — Important — Retention, purge ve deletion runbook yok

90 gün/full purge sözleri uygulamasız; ledger FK RESTRICT. Progress gerçek silmede adjust + email archive workaround kaydediyor. Politika ile teknik silme modeli uzlaştırılmalı.

### G-I3 — Important — DR/incident/restore hazırlığı yok

`scripts/*.md` tek dosya `paddle-smoke.md`. Supabase restore testi, RTO/RPO, Fly rollback, migration recovery, secret compromise, severity/escalation/communication/postmortem runbook'ları yok. Goal on-violation notları DR değildir.

### G-I4 — Important — GSC 5.000 satır cap bilgisi persist edilmiyor

İlk pull yanıtı `capped` uyarır; serializer/parser alanı düşürür. Sonraki discovery/report kısmi veriyi tam sanır. Pagination veya en az kalıcı cap metadata zorunlu.

### G-I5 — Important — Deploy/queue/auth/DFS borçları

Invalid-key prefilter, worker comment/path-filter drift, distributed DFS budget ve queue option/update/rollback prosedürü A/D/H bulgularıyla aynı köktür; dedup edildi.

### G-MINOR açık aileler

Test typecheck exclusion; duplicate waitlist analytics ve waitlist rate-limit; mobile nav/sign-in; generated type overlay'leri; Paddle portal/status/markProcessed nits; queue send-fail orphan; crawler/audit provenance/parser; GSC banner/PKCE; report/global-error/docs meta drift; cloud unindexed FK sweep.

### G-GOOD/kapanmış

`verify-goals` hardening, waitlist null-body/lint, Faz 1 a11y/theme/routes, aggregate/0010 races/key cap/format helper, auth crash/rate/tenant, GSC core terfisi, generator ve clean-checkout DB build düzeltmeleri kodda doğrulandı. Eski `/health`, `.source` import ve “db zod yok” kayıtları stale/yanlış.

## Paket H — Gelişim değerlendirmesi

### H1 — Tool yüzeyi ve LLM-client kalite değerlendirmesi

16 tool, async crawl, GSC'siz ilk audit ve ücretsiz router iyi bir v1 çekirdektir (`tools/index.ts:42-59`, `credits/costs.ts:10-27`). Önkoşul yoksa audit/discovery “önce crawl/pull” deyip rezervi serbest bırakır; bu hem LLM yönlendirmesi hem para yönü açısından GOOD.

Ana kalite boşlukları:

1. **Structured output yok.** Sonuç kontratı çoğunlukla `content[].text + isError`; versioned `structuredContent`, stabil result schema, error code, `next_actions`, `charged_credits`, `remaining_balance` yok (`registry.ts:42-49,88-95`). Client prose'u yeniden parse ediyor.
2. **Report gerçek audit/discovery bulgularını taşımıyor.** Model crawl'dan dört basit sayım ve GSC top-listesi çıkarıyor; prompt “roll everything/findings up” diyor (`report/model.ts:5-13,94-162`, `prompts.ts:61-94`).
3. **`whats_next` milestone tutmuyor.** Audit/discovery iz bırakmadığı için crawl sonrası aynı audit'i, fresh pull sonrası aynı report'u tekrar önerebilir (`whats-next.ts:14-19,304-309`).
4. **GSC cap ve response bound zayıf.** 5.000 cap persist değil; quick wins 50 ile sınırlı, cannibalization/decay tüm sonucu prose'a basabilir.
5. **Prompt/tool şekli uyuşmuyor.** Quick-wins prompt “affected pages” audit önerirken audit yalnız project id alıp tüm crawl'u çalıştırır.
6. **`research_keywords` listede fakat default beta'da disabled.** Dürüst error/no-charge GOOD; ürün yüzeyi “16 listelenen, 15 varsayılan kullanılabilir” diye availability göstermeli.
7. **Eksik analiz aileleri:** backlink/competitor/ranked keywords, rank tracking, CWV/speed, internal-link graph/orphan/depth, scheduled/diff crawl, page-group/template segmentation, notification ve import/export. İçerik üretiminin v1.1'e ertelenmesi bilinçli ve kusur sayılmadı.

### H2 — Kredi UX ve ilk değer

- Gerçek tek-tool maliyetleri ≤30; >200 confirmation kapısı hiçbir mevcut tool'da tetiklenmiyor. `new-site-audit` toplam ~85, monthly routine ~50 kredi; workflow toplam tahmini/onayı yok.
- `confirm` registry-level olup input schema'da gizleniyor; strict client bilinmeyen alanı gönderemeyebilir. Gelecek >200 tool'dan önce gerçek-client testi şart.
- Başarılı yanıtta charged/remaining yok; yetersiz bakiye genel RPC hata metnine dönüşüyor ve top-up CTA yok.
- Signup callback yalın Overview'a gider; key→client→connection test→setup→first crawl checklist'i yok. Overview yalnız balance/ledger.
- Getting Started ilk prompt “Crawl my site and find quick wins”; quick wins GSC/pull ister ve GSC'siz ilk değer vaadiyle çelişir.

### H3 — Webapp ve funnel

Authenticated ekranlar: Overview, Connection, Reports, Usage, Billing. Spec'teki Projects/Settings; project detail, job history/progress, GSC status ve usage graph yok. Connection client-specific snippets/docs/test CTA taşımıyor.

Funnel yalnız `signup_completed`, `mcp_key_created`, `purchase_completed`; `connector_verified`, `first_tool`, `first_crawl_succeeded`, `first_audit`, `first_report`, `gsc_connected` yok. Signup→ilk değer darboğazı ölçülemiyor.

Landing private beta/waitlist diyor; `/signup` invite/IP/domain gate olmadan erişilebilir. Bu yalnız copy değil abuse ve beta kapasite riskidir.

### H4 — Beta ve operasyon

- Stale running job/open reserve reaper ve alarm yok.
- Trial user-based; invite, CAPTCHA, IP/domain bağları ve plan/project quota yok; pricing one-trial/domain diyor.
- Rate limit valid-key/process-memory; invalid-key lookup sınırsız; iki web instance limiti katlar.
- Health yalnız liveness; metrics/tracing/Sentry/queue depth/job-age/open-reserve/5xx alarmı görünmüyor.
- Worker serial `for await`; concurrency/backpressure/tenant fairness yok.
- DFS budget local ephemeral; DFS kapalı kaldığı sürece risk pasif.
- Support yalnız belirsiz “waitlist email”; status/support endpoint/SLA yok.

### H5 — 10k+ sayfa ölçeği

Bugün public/worker cap 100 URL, crawler seri ve 90 saniye bütçeli. Tüm `pages/skipped` RAM'de, sonra tek `jobs.result jsonb`; heartbeat/progress/checkpoint yok. Latest-result filtresi mevcut index ile tam eşleşmiyor.

10k hedefi için önerilen mimari:

1. `jobs.result` yalnız summary + artifact manifest.
2. Normalize `crawl_pages`/`crawl_edges` veya bounded chunk artefact'ları.
3. Parent crawl → idempotent chunk jobs; host/tenant/global bounded concurrency.
4. Lease/heartbeat/checkpoint/reaper; `processed/total/discovered/skipped/eta` progress.
5. Parent reserve bir kez; terminal deliverable/outbox ile settlement.
6. Auditler SQL/stream üzerinde; partial/composite index ve retention partitioning.
7. 10k load/cost testi ve kredi/fiyat kararı insan onaylı.

### Öneri tablosu — etki × çaba × kova

| Sıra | Öneri | Etki | Çaba | Kova |
|---:|---|---|---|---|
| 1 | Prod trial yolunu atomik `claim_trial` RPC'ye bağla | Yüksek | Küçük | QUICK-WIN |
| 2 | Stuck/open-reserve reaper + alarm + reconciliation runbook | Yüksek | Orta | QUICK-WIN |
| 3 | Invite/trial abuse gate (invite, IP/domain/user, CAPTCHA/rate) | Yüksek | Orta | QUICK-WIN |
| 4 | Paddle unmatched-paid state'i retry/reconcile-safe yap | Yüksek | Küçük | QUICK-WIN |
| 5 | Her tool'a versioned structured result/error/next_actions/cost | Yüksek | Orta | STRATEJİK |
| 6 | Audit/discovery sonuçlarını persist edip report'a dahil et | Yüksek | Orta | STRATEJİK |
| 7 | GSC `capped` persistence + bounded output/pagination | Yüksek | Küçük | QUICK-WIN |
| 8 | Workflow toplam kredi tahmini/onayı + charged/remaining | Yüksek | Küçük | QUICK-WIN |
| 9 | Signup onboarding checklist + doğru GSC'siz ilk komut | Yüksek | Orta | QUICK-WIN |
| 10 | İlk-değer funnel eventleri | Yüksek | Küçük | QUICK-WIN |
| 11 | Shared rate limit + 5xx/queue/job/open-reserve observability | Yüksek | Orta | STRATEJİK |
| 12 | Projects/GSC/jobs dashboard + usage graph | Orta | Orta | STRATEJİK |
| 13 | Retention/purge/restore/support runbook ve gerçek uygulama | Yüksek | Orta | STRATEJİK |
| 14 | 10k chunked crawl + normalized storage/progress/lease | Yüksek | Büyük | STRATEJİK |
| 15 | Latest-result composite partial index | Orta | Küçük | QUICK-WIN |
| 16 | Backlink/competitor/ranked-keyword + CWV/speed araç ailesi | Yüksek | Büyük | STRATEJİK |
| 17 | Internal-link graph, template/page-group, crawl diff/schedule | Orta | Büyük | ERTELENEBİLİR |
| 18 | `import_crawl` ve export artefact'ları | Orta | Orta | ERTELENEBİLİR |

### Sıralı aday backlog

1. Secret rotasyonu ve SSRF/Paddle Critical kapıları.
2. Atomik trial + same-job atomic claim/idempotency.
3. Reaper/reconciliation + metrics/alerts/runbooks.
4. Dürüst retention/rollover/trial policy düzeltmesi.
5. GSC cap persistence ve bounded results.
6. Structured tool envelope + workflow cost UX.
7. Signup onboarding ve first-value telemetry.
8. Report findings persistence + `whats_next` milestones.
9. Projects/GSC/jobs dashboard yüzeyi.
10. 10k architecture design/load test.
11. DFS-depth/backlink/competitor/CWV tool expansion.
12. Import/export, scheduled/diff crawl ve internal-link graph.

## Paket I — Süreç kanıtı

### I-I1 — Important — İşçi/hakem ledger'ı immutable değil

`.superpowers/sdd/.gitignore` `*`; progress, task raporları ve review diff'leri snapshot git tree'sinde tracked değil. Model/hakem/re-review anlatısı sonradan değiştirilebilir; yalnız commit diff'i ve CI bağımsız kanıt. Audit summary'nin progress'e sonradan yazılması körlük protokolünü de zayıflattı.

### I-I2 — Important — Model provenance doğrulanamıyor

Progress T15 Fable limitini ve Opus 4.8 hakem override'ını açıkça yazıyor; bu dürüstlük GOOD. Fakat T15 işçisini Opus diye tanımlayan kayda karşı altı commit `Co-Authored-By: Claude Fable 5` taşıyor. Trailer gerçek model kanıtı değildir; immutable dispatch/review receipt yok.

### I-I3 — Important — “Done” kapıları tam birleşik değil

Onlarca task closure'a karşı 13 goal var; task başına persistent done_when yok. `verify.sh` DB/goals çalıştırmıyor; CI goals çalıştırmıyor. `landing-live`, `mcp-alive`, `trial-flow-e2e` env yokken SKIP; docs goals stale artefact kabul edebilir. “VERIFY PASS” tek başına done değildir.

### I-I4 — Important — CI bitmeden merge ve branch protection yok

GitHub salt-okunur kayıtları PR #14–#17'de verify-db/gitleaks bitmeden veya FAIL sonrası merge örnekleri gösterdi; `main` branch protection sorgusu 404/not protected. `0abbd7f` clean-checkout build'i düzeltti, fakat üç PR boyunca kırık DB check main'e taşındı.

### I-I5 — Important süreç — Commit boyu yasası uygulanmıyor

Snapshot geçmişinde 64 non-merge commit >200 satır; örnek `515041d` 905, `b092433` 1293, `43111f2` 927. Fable review bazılarında devreye girdi, fakat anayasa önce bölmeyi şart koşuyor; generator+test+package gibi commitler bölünebilir.

### I spot-check

1. Faz 2 T7 webhook reviewer bulgusu gerçekten `907449f` ile loud log/runbook/concurrent ref/failure testleriyle kapatılmış; teknik review zinciri doğru. Buna rağmen bugünkü `record_only+processed` tasarımının kendisi yeni Critical bulgudur.
2. Faz 3 T15 Opus kararı teknik olarak doğru: aggregate view + user filter, 1.500 satır DB testi, 0010 unique/upsert yarışları ve T15'te settlement diff'i olmaması doğrulandı. Provenance ise tracked değil.

### I-GOOD

Test dosyası silme/skip/only zayıflatması yok; test yüzeyi 104 dosya ve +11.818 satır büyümüş. İki spot-check'te worker→hakem→fix→re-review teknik sonucu kodla örtüştü. `0abbd7f` gate'i zayıflatmadan güçlendirdi.

## Gelişim değerlendirmesi

Paket H bu raporun ana gelişim değerlendirmesidir. Kısa stratejik hüküm: SeoGrep'in fark yaratabileceği yer yeni bir web-crawler yazmak değil, satın alınan veri katmanını (GSC/DFS/CrUX vb.) LLM-uyumlu, güvenli ve stateful SEO iş akışlarına dönüştürmektir. Bugünkü 16 tool iyi bir çekirdek, fakat ürünün “tek konuşmada güvenilir sonuç” vaadini yükseltmek için tool sayısından önce structured contract, milestone state, gerçek report composition, ilk-değer UX'i ve operasyon güvenilirliği tamamlanmalıdır.

Faz 4 planı iki iz halinde kurulmalı:

- **Beta güvenilirlik izi:** Critical'lar, para state machine'leri, reaper/alert/runbook, dürüst policy copy, onboarding/funnel.
- **Ürün derinliği izi:** report findings, GSC bounded data, competitor/backlink/CWV, internal links, import/export ve 10k architecture.

Yeni ücret/rakam önerilmedi. Her crawl tier, render fallback, DFS-depth veya BYO-key fiyat kararı NEVER #6 gereği insan onayına gitmelidir.

## Doğrulanamayanlar

| Kontrol | Neden | Gereken erişim/komut |
|---|---|---|
| Koordine secret rotasyonu | Değerler okunmadı; digest-before/after ve revoke receipt yok | Her sağlayıcıda rotate/revoke zaman damgası + Fly/Netlify deployed digest matrisi; secret değeri raporlanmadan |
| Canlı full MCP tool E2E | Geçici `MCP_SMOKE_URL` verilmedi; goal SKIP kolu çalıştı | İnsan geçici URL verir; `MCP_SMOKE_URL=... PROD_URL=https://seogrep.com make goals`, sonra key revoke |
| Canlı para/Paddle live | Canlı mutasyon ve gerçek ödeme yasak | Sandbox signed fixture + insan-kapılı Paddle live smoke; event/ledger id ile, secret değersiz |
| Canlı DB RLS/ledger invariant | Canlı DB bağlantısı yasak | İnsan tarafından çalıştırılan read-only katalog/invariant sorguları; bağlantı dizesi paylaşılmadan |
| `rls_auto_enable` cloud config | Fonksiyon gövdesi repo'da yok | `pg_proc`/`pg_trigger` read-only katalog çıktısı |
| Netlify gerçek env matrisi | Maskeli dış state, değer okunmadı | Env adları+scope+updated_at listesi; değer yok |
| Google OAuth gerçek hesap | Login/mutasyon gerektirir | İnsan test user ile connect/callback; encrypted row metadata ve UI banner kanıtı |
| Backup/PITR/restore | Sağlayıcı ayarı repo dışı | Supabase plan/PITR ekranı + ayrı restore drill kaydı |
| Branch required checks | Agent 404/not-protected gördü; ayarı değiştirme yetkisi yok | `gh api repos/popiliadam/seogrep/branches/main/protection` yetkili read |
| Live deploy commit eşliği | Public HTML commit hash sunmuyor | Netlify deploy SHA + Fly image source revision metadata |

## Çapraz karşılaştırma

Kör sentez yukarıdaki bölümlere ve bu dosyaya yazıldıktan sonra ilk denetim
`docs/audits/2026-07-20-faz0-3-audit-raporu.md` ile onun Faz 3.5 promptu açıldı. Karşılaştırma aynı
snapshot sınırlamasına tabidir: ilk rapor canlı MCP/DB mutasyonlu bir oturumdan kanıt taşıyor; bu
denetimin bağlayıcı sınırları canlı DB'yi ve geçici smoke URL olmadan MCP çağrısını yasakladı. Bu
nedenle önceki canlı kanıtları tarihsel kanıt olarak kabul ettim, bugünkü durum diye yeniden
onaylamadım.

### İlk denetimin bulduğu, bu denetimin kaçırdığı veya eksik kanıtladığı noktalar

| İlk denetim bulgusu | Hakem hükmü | Neden kaçırdım / eksik kaldım |
|---|---|---|
| Gerçek-client dogfooding'de 42/42 canonical eksikliği, 0/42 JSON-LD, beş duplike meta ve raporun buna rağmen “No basic on-page issues” demesi | **Haklı; en değerli bağımsız ürün kanıtı.** Koddan raporun audit bulgularını taşımadığını buldum, fakat aynı canlı veri setini üretmedim. | İstenen geçici `MCP_SMOKE_URL` yoktu ve bu denetim canlı mutasyonu yasaklıyordu. Kaçırma metodolojik olarak gerekçeli, ürün sentezinde yine de açıkça delta olmalıydı. |
| Landing'de Sign in linki yok; rapor silme/public-slug iptali yok; çoklu-key UI tek-key varsayıyor | **Haklı.** Bunlar sırasıyla onboarding, gizlilik ve yönetim boşluğudur. | Dashboard/funnel'ı genel inceledim fakat bu üç somut UI davranışını ayrı satır ve canlı kanıtla çıkarmadım. |
| Kendi sitenin canonical/meta/JSON-LD quick-win paketi ve generated docs meta'larının 190–268 karakter olması | **Haklı.** Beta güvenilirliği için ucuz ve görünür düzeltmelerdir; güvenlik blocker'ı değildir. | Tool/docs sözleşmesine ve eksik yeteneklere daha fazla ağırlık verdim; ürünün kendisini MCP ile dogfood edemediğim için kesin sayıları bulamadım. |
| `stripCostSentences` regex'inin cümle başındaki “Cost(s)” biçimini kaçırması | **Haklı, Minor/latent.** | Generator'ın daha geniş stale-dist ve schema/behavior drift sınıflarını inceledim, bu dar regex kenarını ayrıca örneklemedim. |
| Canlı Supabase'de `pgboss.*` mutable `search_path` uyarıları ve leaked-password protection'ın kapalı olması | **Haklı fakat Minor.** `pgboss` şeması anon/authenticated'a açık değil; leaked-password ayarı defense-in-depth. | Mevcut görev canlı DB bağlantısını açıkça yasaklıyordu. Repo-only kanıttan cloud advisor durumunu çıkaramazdım. |
| Canlı E2E'nin 85 krediyle crawl→audit→report akışını ve `balance=SUM(ledger)` canlı invariantını kanıtlaması | **Haklı tarihsel GOOD.** | Bu denetim local DB ve public GET ile sınırlıydı; canlı tool/ledger mutasyonu için insan kapısı açılmadı. |
| `PageRecord.originalUrls`, root `global-error`, prod cap redaksiyonu gibi küçük progress borçlarının tek tek adreslenmesi | **Büyük ölçüde haklı, Minor.** | Bunları Paket G'de deduplu minor aile olarak tuttum; ilk rapor kadar tek tek açmadım. Bu, bulgu kaybından çok raporlama granülaritesi kaybıdır. |

### Bu denetimin bulduğu, ilk denetimin kaçırdığı noktalar

1. **Critical Paddle kaybı:** eşleşmeyen ama ödenmiş `transaction.completed` olayının kredi vermeden
   `processed_at` alıp 200 dönmesi. İlk rapor webhook çekirdeğine genel GOOD verdi ve “paid-but-no-credit”
   runbook'unu not etti; terminal state'in kendisini para doğruluğu ihlali saymadı.
2. **Job/ledger yarış ve state-machine boşlukları:** aynı job için iki reserve üretilebildiği rollback'li
   repro; worker claim'inin CAS olmaması; commit'in result persistence'tan önce gelmesi; DB'nin ledger
   delta/kind/reserve şekillerini CHECK ile zorlamaması; open-reserve reconciler eksikliği.
3. **Atomik trial'ın üretimde kullanılmaması:** migration ve DB testi doğru `claim_trial` RPC'yi kanıtlarken
   gerçek callback iki ayrı statement'lı eski helper'ı çağırıyor. İlk rapor yalnız RPC'nin varlığına bakıp
   prod wiring'i doğrulamadı.
4. **Yanlış davranışı sabitleyen testler:** unmatched-paid 200/processed, yetersiz bakiyeyle sahte
   same-job idempotency ve eksik trial mock argümanları. İlk raporun “0 Important test problemi” hükmü
   bu adversarial okumayı kaçırdı.
5. **SSRF'nin daha derin şekli:** snapshot'taki 42-testli pure helper gerçek crawler'a bağlı değildi ve
   robots/sitemap yolu isteği hükümden önce yayıyordu. İlk rapor DNS-sonrası private-IP boşluğunu buldu;
   bu denetim ayrıca testin tehlikeli emisyonu pinlediğini ve Faz 3.5 fixinde IP-pinning/DNS-rebinding
   kalıntısını gösterdi.
6. **Service-role ve RLS test yüzeyi:** id-only update/helper imzaları, her tenant tablosu için doğrudan
   A/B RLS negatifinin bulunmaması ve Host-origin'e bağlı redirect riski. Bugünkü çağrılarda kanıtlı
   cross-tenant exploit yok; bunlar Important hardening borcudur.
7. **Secret tarama kör noktası:** tüm `*.test.ts(x)` dosyalarının gitleaks allowlist'inde olması. İlk rapor
   bunu “dar ve kabul edilir” saydı; test fixture'larının secret yapıştırılmasının olağan hedefi olması
   nedeniyle bu denetim Important saydı.
8. **Dürüstlük/politika sapmaları:** rollover + 2× cap, one-trial-per-domain, 90-gün deletion/full purge,
   “all audits background”, broken-link demo, “any analysis report” ve one-time MCP URL'yi dashboard'dan
   yeniden kopyalama anlatımları kodla uyuşmuyor.
9. **Deploy/env kapsamı:** path filtresi yalnız lockfile/tsconfig değil root manifest, workspace, Turbo ve
   dockerignore girdilerini de kaçırıyor; birçok web/DB env factory'si gerçek prod adlarıyla negatif-testli
   değil; base image ve Actions mutable, Turbo `pnpm dlx` ile lock dışından geliyor.
10. **Lisans release kapısı:** AGPL/GPL kopya yok sonucu aynı, fakat transitive ağaç tamamen permissive değil;
    LGPL sharp-libvips, MPL lightningcss ve CC-BY caniuse-lite için SBOM/third-party notice süreci yok.
11. **Ürün ve ölçek tasarımı:** versioned structured output/error/cost envelope; kalıcı milestones;
    bounded GSC sonuçları; onboarding/first-value telemetry; invite abuse gate; 10k için chunk storage,
    lease/progress/reaper ve idempotent settlement tasarımı ilk raporda bu ayrıntıyla yoktu.
12. **Süreç kanıtı:** review/progress artefact'larının git dışında mutable olması, model provenance
    çelişkisi, goals/verify/DB kapılarının birleşmemesi, required branch protection'ın bulunmaması ve
    64 adet 200+ satırlık non-merge commit.

### Çelişen hükümler ve nihai hakem kararı

| Konu | İlk denetim | Kör Codex denetimi | Nihai hüküm |
|---|---|---|---|
| GO/NO-GO | “KOŞULLU GO”, fakat üç blocker kapanmadan para/beta yok | **NO-GO** | Operasyonel anlamları yakın olsa da bağlayıcı tanımda açık Critical varken durum GO değildir. **NO-GO** daha az muğlaktır; koşullar kapanınca yeniden değerlendirilir. |
| Secret rotasyonu | “Yapılmadı” diye kesin Critical | Bağımsız receipt yok, “doğrulanamadı; compromised kabul et” Critical | Açık plan kaydı güçlü negatif kanıttır ama dış sistem bugünkü durumu repo kanıtlayamaz. Kapanış receipt'i gelene dek Critical açık kalır; mutlak tarihsel iddia yerine doğrulanamama dili kullanılır. |
| SSRF sınıfı | Important blocker | Snapshot için Critical; Faz 3.5 sonrası DNS-rebinding kalıntısı | İç servis/metadata erişimi veri/secret sınırını aşabileceği için snapshot **Critical**. Origin/manual-redirect/internal-TLD fixlerinden sonra IP-pinning yokluğu en az **Important**, kanıtlı rebinding emisyonu varsa yeniden Critical'dır. |
| Worker “stub/scale 0” yorumu | Important blocker | İlk sentezde Minor, birleşik koşulda öne alındı | İlk sınıflamam insan-faktörü etkisini düşük tarttı. Üretim consumer'ını kapatmayı açıkça öğütleyen deploy talimatı canlı işleri kırabilir; **Important** kabul edilir. |
| Test suite | 0 Critical/0 Important; genel olarak güvenilir | Dört yanlış/eksik invariant Important | İkinci denetimin dosya ve repro kanıtı üstün: suite'in güçlü bölümleri GOOD kalır, fakat genel “0 Important” hükmü reddedilir. |
| Webhook | İmza/idempotency GOOD | Aynı çekirdek GOOD; unmatched-paid dalı Critical | Çelişki değil kapsam ayrımıdır. İmza ve replay güvenliği güçlü; entitlement state machine Critical hatalıdır. GOOD etiketi tüm route'a genellenemez. |
| Prod env testleri | Ders #5 uygulanmış, GOOD | Birkaç merkezde var fakat bütün env-reader'ları kapsamıyor, Important | Dersin belirli incident yolu kapanmış; “her env okuyan yol” iddiası kapanmamış. Geniş matris kanıtı nedeniyle ikinci hüküm geçerli. |
| Gitleaks test allowlist'i | Minor latent/kabul edilebilir | Important | Mevcut leak bulunmadığı için Critical değil; history taramasında bütün test ağacını görünmez yaptığı için **Important**. |
| Lisans ağacı | “Permissive; copyleft yok” | Sınırlı/copyleft ve attribution lisansları var; release notice yok | Uygulama kodunu AGPL yapacak bağımlılık yok, fakat “tamamen permissive” yanlış. SBOM/notices release kapısıdır; lisans sahibinin dağıtım biçimine göre son hukuk kontrolü gerekir. |

### İki denetimin birleşik zorunlu-koşul listesi

1. Sohbette açığa çıktığı kaydedilen bütün prod credential'ları koordine rotate/revoke et; Netlify/Fly
   güncellemesini ve provider receipt/digest değişimini secret değeri olmadan kaydet.
2. Crawler'da ilk istek ve her redirect hop'unu aynı doğrulanmış A/AAAA sonucuna pinle; private,
   loopback, link-local, ULA/6PN, mapped-IP, non-public TLD ve DNS-rebinding negatiflerini gerçek
   request-log ile kanıtla.
3. Unmatched paid Paddle olaylarını terminal `processed` yapma; retry/reconcile state'i, alarm,
   idempotent attribution ve paid-but-no-credit recovery smoke'u ekle.
4. Prod signup yolunu atomik `claim_trial` RPC'ye bağla; one-trial/domain vaadini uygulayan invite,
   user/domain/IP abuse kapısını kur veya insan-onaylı kopyayı dürüstçe daralt.
5. Worker claim'ini atomik CAS yap; job/attempt reserve'ini idempotent kıl; result persistence ile
   settlement için recoverable state/outbox ve concurrent redelivery testleri ekle.
6. Stuck-running/open-reserve/paid-result reaper'ı, yaş eşiklerini, alarmı ve operatör kontrollü
   reconciliation runbook'unu devreye al.
7. Invalid-key için DB lookup öncesi paylaşımlı/edge rate-limit; uptime, 5xx, queue depth, job age,
   open reserve ve DFS budget metrik/alarmlarını kur.
8. Worker'ı “stub/scale 0” diye anlatan talimatı kaldır; deploy path filtresini bütün image girdileriyle
   eşleştir; prod env negatif matrisini tamamla; Actions/base-image/Turbo kaynağını immutable pinle.
9. Rollover/2× cap, retention/deletion/full purge ve rapor iptali vaatlerini uygula veya fiyat/politika
   sahibi insanın onayıyla kopyayı gerçeğe daralt; `research_keywords` availability'sini açık göster.
10. Yanlış invariantları pinleyen testleri düzeltmeden yeni davranışı bağımsız adversarial testlerle
    kanıtla; gitleaks allowlist'ini daralt; tüm tenant tablolarında RLS ve ledger'da
    UPDATE/DELETE/TRUNCATE negatiflerini çalıştır.
11. `verify`, `verify-db`, gitleaks, goals/docs freshness ve zorunlu human smoke'u required checks altında
    birleştir; merge-before-green'i branch protection ile engelle; review receipt'lerini immutable yap.
12. İnsan-kapılı release smoke'unda signup→trial→key→crawl→audit→report→ledger akışını ve duplicate,
    concurrent, failure/retry/recovery yollarını doğrula; sonra canlı para ve yeni beta davetleri için
    yeni GO/NO-GO kararı ver.

## GO/NO-GO

### Nihai kör hüküm: NO-GO

Canlı para için NO-GO; yeni beta davetleri için de NO-GO. Mevcut canlı read-only vitrin/health yüzeyleri kalabilir; yeni ücretli kullanıcı ve kontrolsüz signup daveti açılmamalı.

### Sıralı zorunlu koşullar

1. Exposed kabul edilen tüm prod credential'ları koordine rotate et; eski değerleri revoke et; Netlify/Fly çift-güncelleme ve smoke kanıtını secret değersiz kaydet.
2. Crawler SSRF'yi IP-pinned/pre-emission çöz: origin + her redirect + IPv4/IPv6 + internal/reserved + DNS rebinding; gerçek request-log negatifleri ve bağımsız review.
3. Paddle unmatched-paid `transaction.completed` olayını terminal processed yapma; retry/reconcile-safe state, alarm ve idempotent recovery testi.
4. Atomik `claim_trial` RPC'yi prod caller'a bağla; invite/domain/IP abuse gate ve honest pricing copy ile doğrula.
5. Worker job claim'i atomic CAS yap; aynı job/attempt reserve idempotency, concurrent redelivery testi ve result+settlement recovery state'i ekle.
6. Stuck job/open reserve reaper, paid-result recovery ve runbook/alert paketini devreye al.
7. Public para/retention vaatlerini ya uygula ya insan-onaylı dürüst copy ile daralt: rollover/2× cap, one-trial/domain, 90-day deletion/full purge.
8. Invalid-key pre-auth shared rate limit, 5xx/queue/job-age/open-reserve metrics ve alarmı kur.
9. Deploy path filtrelerini tüm image girdileriyle eşle; worker stub yorumunu sil; Actions/image pinlerini sertleştir; env negatif matrisini tamamla.
10. Gitleaks test-geneli allowlist'i daralt; RLS tüm tablolar ve append-only mutation negatif suite'ini ekle.
11. Branch protection/required checks ile verify + verify-db + gitleaks + goals tamamlanmadan merge'i engelle; review receipts/progress kanıtını tracked/immutable yap.
12. Paddle live veya beta daveti öncesi insan-kapılı tam smoke: signup→trial→key→crawl→audit→report→ledger; başarısız/duplicate/concurrent/recovery senaryoları dahil.
