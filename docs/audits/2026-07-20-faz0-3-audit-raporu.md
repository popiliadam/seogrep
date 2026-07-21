# Faz 0–3 Komple Audit Raporu — 2026-07-20

> Bağımsız denetçi (taze oturum, önceki bağlam yok). Yöntem: yalnız kanıt — repo okuması,
> canlı Supabase SQL, Fly durum/secret listesi, canlı HTTP + gerçek-client dogfooding.
> Şef dahil hiçbir beyana güvenilmedi; her iddia kanıtla doğrulandı ya da "doğrulanamadı"
> işaretlendi. READ-ONLY (tek istisna: test hesabıyla uçtan uca akış — ledger'a 85 kredi harcandı).

## Yönetici özeti

**En kritik 3 bulgu:**
1. **CRITICAL — Secret rotasyonu yapılmadı.** 2026-07-20 T16 kurulumunda chat'e yapıştırılan canlı prod credentials (Supabase service_role JWT + sb_secret + DB şifresi + Google client secret + TOKEN_ENCRYPTION_KEY + DFS şifresi) hâlâ döndürülmedi; koordine rotasyon PLAN insan kuyruğunda #1 olarak AÇIK, DFS şifresini operatör açıkça reddetti. Bunlar prod DB'ye tam erişim + GSC token şifre çözme anahtarı; canlı paraya geçmeden ZORUNLU.
2. **Important — Crawler SSRF: iç-ağ/özel-IP filtresi yok.** `normalizeDomain` IP-literal ve tek-etiket host reddediyor ama `*.internal` (Fly 6PN), `metadata.google.internal` gibi çok-etiketli iç adları kabul ediyor; ayrıca DNS-çözümü sonrası IP kontrolü hiç yok → public bir domain'in A-kaydı 127.0.0.1/169.254/fdaa'ya işaret ederse tüm string-guard'lar aşılır. Crawl, 6PN erişimli Fly worker'ında koşuyor.
3. **Important — `fly.toml` + `index.ts` worker'ı "stub, scale to 0" diye anlatıyor** ama worker GERÇEK pg-boss tüketicisi (canlı çalışıyor). Yorumu izleyen operatör `fly scale count worker=0` derse TÜM async crawl/audit işleri sessizce durur.

**En değerli 3 gelişim önerisi:**
1. `generate_report` audit bulgularını İÇERMİYOR — paylaşılan rapor (organik-edinim yüzeyi) yalnız ham-crawl sığ bayraklarını gösteriyor; canlı kanıt: rapor "No basic on-page issues detected" derken audit_onpage 42 eksik-canonical buldu. Ürünü hem yanlış tanıtıyor hem değersizleştiriyor.
2. Kendi sitemizin SEO'su zayıf (dogfooding): 42/42 sayfa canonical'sız, 0/42 sayfa structured-data, 5 pazarlama sayfası aynı 178-char meta'yı paylaşıyor. Bir SEO aracının kendi SEO'su bozuk olması lansmanda inandırıcılık sorunu — beta öncesi ücuz düzeltme.
3. İzleme/alarm/status YOK (yalnız Fly `/healthz`); rate-limit sadece geçerli-key sonrası çalışıyor → geçersiz-key seli sınırsız DB lookup; research_keywords beta'da kapalı (DFS_LIVE off) → amiral tool "not yet enabled" dönüyor.

**Genel hüküm:** Faz 0–3'ün mühendislik kalitesi YÜKSEK. Para doğruluğu (append-only zırh + bakiye=SUM invariant'ı canlıda 0 ihlal), RLS (10/10 tablo force), test gerçekliği (0 crit/0 imp, gerçek-davranış, zayıflatma yok), AGPL temiz-oda (kod kopyası yok) ve süreç kanıtı (hakem zinciri tam) DOĞRULANDI. Ancak canlı paraya geçiş için **KOŞULLU GO**: 1 Critical (secret rotasyonu) + 2 Important (SSRF, worker-comment) blocker; beta operasyon zemini (izleme, rate-limit, reaper) eksik. Detay §FAZ 4 GO/NO-GO.

---

## Boyut raporları (1–8)

### 1. GÜVENLİK

**[CRITICAL] Chat'e maruz kalan canlı secret'lar döndürülmedi.**
Kanıt: PLAN.md İnsan kuyruğu #1 "KOORDİNE SECRET ROTASYONU — EN ÖNCELİKLİ" hâlâ açık; `.superpowers/sdd/progress.md:321,326` rotasyonu "insan kuyruğuna" yazmış + sb_secret'ı da kapsayacak şekilde genişletmiş, hiçbir yerde "tamam" kaydı yok; DFS şifresi operatörce rotasyon-reddi (progress:279). `flyctl secrets list` 10 secret'ı "Deployed" gösteriyor ama digest'lerin değer-baseline'ı yok, dolayısıyla listeden rotasyon KANITLANAMAZ — ve standing kanıt (kuyruk açık) rotasyonun YAPILMADIĞINI gösteriyor. Maruz kalan set prod DB'ye tam erişim (service_role + DB pass), OAuth client secret ve GSC refresh-token şifre-çözme anahtarı içeriyor.
Öneri: Canlı para/beta ÖNCESİ tek turda koordine rotasyon — Supabase service key + DB pass + Google secret + TOKEN_ENCRYPTION_KEY (gsc_connections=0 → bedava) + DFS pass; Netlify + Fly çift güncelleme. TOKEN_ENCRYPTION_KEY dönerse mevcut GSC bağlantıları (bugün 0) geçersiz olur — sorun değil.

**[GOOD] RLS her tabloda enable + force.** Kanıt: canlı `pg_class` sorgusu — 10/10 public tablo `relrowsecurity=true AND relforcerowsecurity=true` (api_keys, credit_ledger, events, gsc_connections, jobs, paddle_events, projects, reports, subscriptions, users_profile); `guardrails/check-rls.sh` → PASS. Tenant izolasyonu: service-role sorguları açık `.eq("user_id", …)` filtreli (setup-project.ts:110, crawl-site.ts:67 `forUser().selectOwnById`, db.ts:414); cross-tenant negatif testler gerçek iki-JWT ile (subagent doğruladı: auth.db.test cross-tenant, ledger-repo.db RLS poz+neg).

**[GOOD] SECURITY DEFINER fonksiyonları kilitli.** Kanıt: canlı `pg_proc` — `claim_trial` (prosecdef=true, `search_path=""`, anon/authenticated EXECUTE=false, yalnız service_role) + `rls_auto_enable` (prosecdef=true, `search_path=pg_catalog`, anon/auth=false). `reject_mutation`/reserve/commit/release SECURITY INVOKER + search_path pinli.

**[Important] Crawler SSRF: DNS-sonrası IP filtresi yok.** Kanıt: `apps/mcp/src/tools/setup-project.ts:15` `DOMAIN_RE` son etiketi `[a-z]{2,63}` istiyor → `169.254.169.254`/`localhost`/`[::1]` reddedilir (iyi) AMA `foo.internal`, `metadata.google.internal` KABUL (son etiket alfabetik). `crawl.ts` `isIpLiteralHost` yalnız string IP-literal yakalıyor; DNS çözümü sonrası çözülen IP hiç kontrol edilmiyor → public domain A-kaydı özel/link-local/ULA'ya işaret ederse tüm guard'lar aşılır. `crawlSite` yalnız `protocol==http(s)` kontrolü yapıyor; origin'in kendisi iç-ağsa `fetchPage` same-origin redirect zinciri hep iç-ağda kalır. Crawl, 6PN erişimli Fly worker'ında koşar. Kimlik-doğrulamalı + kredi-gerektiren SSRF; kod yorumu (`crawl.ts:351-354`) bunu "faz-sonu audit'e" bırakmıştı.
İkincil: `fetchText` (robots/sitemap) `redirect:"follow"` kullanıyor → SSRF isteği post-follow kontrolünden ÖNCE EMİT ediliyor (kör-SSRF/yan-etki GET mümkün; yalnız gövde okuması bloklu); `fetchPage` manual-redirect ile emisyonu önlüyor — "manual-redirect paritesi" boşluğu (progress:236 kayıtlı).
Öneri: fetch öncesi host'u çöz + özel/loopback/link-local/ULA/6PN aralıklarını reddet (allowlist yerine blocklist); `.internal`/`.local` gibi non-public TLD'leri normalize aşamasında reddet. Beta (hosted crawler) öncesi ZORUNLU sertleştirme.

**[Important] Geçersiz-key seli sınırsız DB lookup tetikler.** Kanıt: `auth.ts:101-105` — rate-limiter yalnız BAŞARILI lookup sonrası (`record.keyId` gerekir) çalışıyor; geçersiz `sg_xxx` her istekte `api_keys where key_hash=…` lookup'ı yapıyor, rate-limit YOK. Kimlik-doğrulamasız istek seli = sınırsız DB okuması. Progress:202 runbook notu ("halka açılmadan Fly/proxy per-IP throttle") ile eşleşiyor.
Öneri: Fly/proxy düzeyinde per-IP throttle ya da format-gate sonrası (lookup öncesi) per-IP token bucket.

**[GOOD] gitleaks config ürün kodunu zayıflatmıyor.** Kanıt: `.gitleaks.toml` `[extend] useDefault=true` + `[allowlist] paths=['.*\.test\.tsx?$']` — YALNIZ test dosyaları muaf; ürün/kütüphane/fixture (dfs/fixtures, crawler/fixtures, gsc-data/fixtures) tam taranır. `gitleaks detect --source .` → 226 commit, no leaks. Latent risk: bir `.test.ts`'e gerçek secret konursa yakalanmaz (dar; kabul edilir).

**[Minor] pgboss.* fonksiyonları mutable search_path (advisor WARN).** Kanıt: canlı advisors 5 WARN (pgboss.create_queue vb.). Ancak canlı sorgu: anon/authenticated'ın `pgboss` şemasına USAGE'ı YOK (anon_usage=false, auth_usage=false) → EXECUTE grant'ı ulaşılamaz; şema PostgREST-exposed değil. Gerçek maruziyet yok; pg-boss kütüphane-üretimi. Derinlik-savunması için pinlenebilir, düşük öncelik.

**[Minor] Supabase leaked-password koruması kapalı** (advisor WARN, auth ayarı, 1-tık insan işi).

**[GOOD] DFS_LIVE kapalı.** Kanıt: `flyctl secrets list` DFS_LIVE İÇERMİYOR; canlı `research_keywords` tool açıklaması "Live keyword data is off during beta … returns a clear 'not yet enabled' error and charges nothing". Smoke round-2 (ledger id 20/21, 14:52) başarılı commit sonrası kapatılmış.

### 2. PARA DOĞRULUĞU

**[GOOD] Append-only zırh canlıda sağlam.** Kanıt: canlı `pg_trigger` — `credit_ledger_append_only` + `events_append_only` triggerleri `reject_mutation` çağırıyor (BEFORE UPDATE OR DELETE). Grant matrisi: anon/authenticated/service_role'de UPDATE/DELETE/TRUNCATE YOK (yalnız INSERT+SELECT); yalnız `postgres` (owner) tam yetki. Canlı UPDATE/DELETE deneme SQL'i güvenlik-classifier'ınca bloklandı (doğru davranış) → zırh trigger+grant varlığıyla yapısal doğrulandı; lokal `verify-db.sh` bu zırhı rollback'li DO ile kanıtlıyor.

**[GOOD] balance = SUM(ledger) invariant'ı canlıda 0 ihlal.** Kanıt: canlı sorgu `credit_balances` view vs `sum(delta)` — 0 fark (14 satır). View tanımı: `SELECT user_id, COALESCE(sum(delta),0) FROM credit_ledger GROUP BY user_id`, `security_invoker=true` — server-side SUM (max_rows bağışık). TÜM okuma yolları view'da: MCP `db.ts:410 creditBalance` + web `ledger-read.ts:75 getBalance`, ikisi de `.from("credit_balances").eq("user_id",…)`. `select("delta")` toplama/`.reduce` kalıntısı grep'te YOK (ürün kodunda); `balanceOf` (core) yalnız test-caller.

**[GOOD] reserve→commit/release hata-yolu disiplinli.** Kanıt: `credits/guard.ts` — cost 0→ledger'a dokunmaz; reserve→fn ok→commit; fn err→release+rethrow; **commit fail→release ETMEDEN rethrow** (iş teslim edildi, para yönü doğru); release fail→logla+orijinal hatayı fırlat; async(jobId) yolunda setJobReserve satır-assert'li, sync yolda jobs'a dokunulmaz (traceability uuid). Canlı release kanıtı: DFS EACCES incident'inde ledger `spend_reserve -25 → spend_release +25`, bakiye değişmedi (progress:333; ledger id 18/19).

**[GOOD] Webhook idempotency tam (NEVER #3).** Kanıt: `webhook/route.ts` — secret/apiKey yoksa fail-closed 500; `unmarshal` HMAC doğrulaması, throw/null→401 SIFIR yan-etki (service client bile kurulmaz); `insertEvent` ON CONFLICT(event_id) DO NOTHING ilk-teslimat kapısı; duplicate+processed→200 no-op; duplicate+null-processed→yeniden işle (ref-idempotent RPC); paid-ama-atfedilemeyen→sesli trace; hata→500+processed_at NULL retry; secret/payload loglanmaz. `paddle_events` PK + `processed_at` canlıda 2/2 processed. Alt-katman canlı: E2E'de `purchase +1000 ref=txn_…` tek satır (progress:156,329).

**[GOOD] Kredi tablosu v0 tek-kaynak, bayt-tutarlı.** Kanıt: `costs.ts TOOL_COSTS` (crawl 20/onpage 30/tech 15/schema 5/report 15/research 25/gsc 5/discovery×3=10/rest 0) plan §3 ile birebir; `pricing-plans.ts` fiyatlar ($0/19/49/149 + 10/25/50) tek dosyada, kredi SAYILARI `CREDIT_PACKAGES`'tan türetilir (kopya değil); tools-reference cost satırları TOOL_COSTS'tan üretilir. Canlı E2E ledger tam: 1110→1025 = crawl 20 + onpage 30 + tech 15 + schema 5 + report 15 = 85, her biri reserve→commit(delta=0). Kalibrasyon v0 KALDI (insan onaylı, NEVER #6).

### 3. KOD KALİTESİ + TEST GERÇEKLİĞİ

**[GOOD] Test suite güvenilir (bağımsız derin-okuma: 0 Critical / 0 Important).** Kanıt (13 dosya + git-log okundu):
- Para: `ledger.property.test.ts:104` fast-check 1000-op state-aware, `balance===Σdelta` + `≥0` seed'li; `paddle-events.test.ts:45` düşman `amount:999_999`→çıktı `CREDIT_PACKAGES`'tan (event'ten değil); `route.test.ts:169` imza-sonrası kurcalama→401+`expectNoRepoWrites`; `paddle-repo.db.test.ts:141` GERÇEK DB'de 2 eşzamanlı aynı-ref→tam 1 grant; `ledger-repo.db.test.ts:160` 5 paralel reserve→tam 3 başarılı, bakiye≥0.
- Auth: `auth.test.ts` revoked/rate-limit/key-loglanmıyor davranışsal; `auth.db.test.ts` cross-tenant iki gerçek user.
- SSRF: `crawl.test.ts:360` off-origin child→ayrı loopback request-log **0 istek**; IP-literal redirect post-follow guard gerçek kanıtlı.
- XSS: `html.test.ts:89` gerçek payload `<script>alert(1)`/`<img onerror>`→escaped, tek href beyaz-liste `seogrep.com`, GSC URL'leri link değil metin.
- Zayıflatma: `.skip/.only/xit` tüm ağaçta **0**; T14 stripCostSentences + trial-seed(200→137) fixture düzenlemeleri MEŞRU sertleştirme (git-log ile doğrulandı, additive/rename). Vacuum: 85 `toHaveBeenCalled`'ın 80'i `.not.` (yan-etki-yok kanıtı).
- Minor: property generator yalnız geçerli girdi üretir (≥0 kısmen inşa-gereği); analytics/welcome'da 5 çıplak-pozitif log-yolu assert'i argüman sınamıyor.

`bash guardrails/verify.sh` → lokal PASS (exit 0). console.log ürün kodunda 0.

### 4. DEPLOY / CI / ENV SÖZLEŞMELERİ

**[GOOD] Ders #5 (env negatif test) + temiz-checkout eşdeğerliği.** Kanıt: `verify-db.sh` artık `pnpm turbo run build --filter='./packages/*'` içeriyor (2026-07-20 stale-dist fix) → CI temiz-checkout'ta `@pseo/core`/`@pseo/db` dist'i build ediliyor. env okuyan kod prod adlarıyla negatif-testli (faz3 plan Global Constraints; subagent env-strip testlerini doğruladı). CI (ci.yml) `permissions: contents: read`, 3 job.

**[Important] worker "stub / scale to 0" yorumu BAYAT ve tehlikeli.** Kanıt: `fly.toml:45-47` "The worker process is a stub … Keep it scaled to 0 … `fly scale count worker=0`" + `index.ts:31` docstring "(stub) worker" — ama `index.ts:main()` GERÇEK `startWorker/stopWorker` (SIGTERM graceful pg-boss stop) çağırıyor ve `fly status` worker'ı "started" gösteriyor. Yorumu izleyen operatör worker'ı 0'a çekerse tüm crawl_site/audit async işleri kuyrukta kalır. Progress:323 "BAYAT … follow-up" demiş ama shipped fly.toml'da duruyor.
Öneri: fly.toml + index.ts yorumlarını düzelt (worker = gerçek pg-boss tüketicisi, 0'a çekilmez).

**[GOOD] Supply-chain: FLY_API_TOKEN alan action SHA-pinli.** Kanıt: `deploy-mcp.yml` `superfly/flyctl-actions/setup-flyctl@ed8efb33…` SHA-pin. Diğer action'lar (checkout/pnpm/setup-node/gitleaks-action@v2) mutable major-tag.
**[Minor]** İlk-taraf olmayan `gitleaks-action@v2` GITHUB_TOKEN (read-scoped) alıyor, mutable tag. Düşük risk; SHA-pin derinlik-savunması.

**[Minor] deploy-mcp path filtresi imaj-girdilerini tam kapsamıyor.** Kanıt: `deploy-mcp.yml` paths = apps/mcp/**, packages/core/**, workflow. Ama Dockerfile `COPY . .` + `pnpm install --frozen-lockfile` ile `pnpm-lock.yaml` + `tsconfig.base.json`'a da bağlı — bunlar path'lerde YOK. Yalnız-lockfile dep bump'ı (transitive güvenlik yaması) ya da tsconfig değişimi bir sonraki apps/mcp push'una kadar prod'a gitmez. (apps/mcp `@pseo/db`'ye bağımlı DEĞİL — kendi db.ts'i; packages/db değişimi imajı etkilemez, doğru dışarıda.)
Öneri: path'lere `pnpm-lock.yaml` + `tsconfig.base.json` ekle (ucuz, drift'i kapatır).

**[Minor] `make goals` predicate'lerinde stale-artifact penceresi (stale-dist sınıfının kuzeni).** Kanıt: `goals/docs-schema-sync.md` predicate `[ -d apps/mcp/dist ] || build` — VARLIK kontrolü, TAZELIK değil; bayat `apps/mcp/dist` yerelde docs-drift'i maskeleyip false-PASS verebilir. `goals/docs-static.md` aynı (`[ -f .next/prerender-manifest.json ] ||`). CI temiz-checkout'ta build ettiği için CI etkilenmez; yalnız yerel `make goals`. Progress T14 m4 kayıtlı. Öneri: predicate koşulsuz rebuild etsin.

### 5. DOCS DÜRÜSTLÜĞÜ

**[GOOD] tools-reference şema/maliyet doğru + drift-korumalı.** Kanıt: `gen-tool-docs.mjs` cost satırını TOOL_COSTS'tan, input tablosunu zod-türevi JSON-schema'dan üretiyor; `crawl-site.mdx` "**Cost:** 20 credits." = TOOL_COSTS.crawl_site; audit-onpage "30 credits" eşleşiyor. `--check` üçlüsü (byte-diff + confirm-alanı-yok + ALL_TOOLS↔meta senkron). El-yazımı kredi rakamı YOK (15/16-hardcode bulgusu T14'te kapandı).

**[GOOD] Vitrin dürüst — uydurma metrik/yorum/logo YOK.** Kanıt: canlı seogrep.com — chat demo "Illustrative example — sample site, sample numbers." etiketli; trust iddiaları doğru ("data never trains AI models" = LLM çağırmıyoruz); ölçülmemiş hız/başarı iddiası yok; müşteri yorumu/logo yok.

**[Minor] `stripCostSentences` baş-pozisyon boşluğu (latent).** Kanıt: `gen-tool-docs.mjs:43` regex `/\s+Costs?\s+\d+…/` — "Costs" öncesi `\s+` şart; cost-cümlesiyle BAŞLAYAN bir açıklama strip edilmez → sayı iki kez çıkar. Bugün hiçbir tool açıklaması cost-cümlesiyle başlamıyor (etkisiz). Progress PR-E m2 kayıtlı. Öneri: strip-sonrası `/\d+\s+credits?/` kalıntı-assert'i.

**[Minor] Otomatik-üretilen tools-reference meta description'ları >160 char** (kendi audit'imizde 190–268 char bulundu — bkz §9). Dürüstlük değil, ama docs-generator kaynaklı kalite; §9'da işlendi.

### 6. AGPL / LİSANS

**[GOOD] Temiz-oda iddiası doğrulandı — kod kopyası YOK.** Kanıt (bağımsız derin karşılaştırma, `~/Documents/platinum-seo-engine` AGPLv3 salt-okunur): 10/10 modülde (onpage/tech/schema/quick-wins/cannibalization/content-decay/robots/sitemap/crawl/report) 3+ satır birebir/yakın-birebir blok YOK. Diller (Python↔TS) + veri modelleri + girdi kaynakları farklı (kaynak kendi crawler'ı yok, Screaming Frog/DFS sürüyor). Örtüşme yalnız fikir/rakam düzeyi (60/160 char, 200 kelime, poz-20, %30 — evrensel SEO standartları, telif-dışı). Güçlü bağımsızlık: hedef kaynağın ayırt-edici algoritmalarının HİÇBİRİNİ taşımıyor (CTR-uplift eğrisi, AIO faktörü, YMYL eşikleri, click-dilution) ve kaynağın güncel kanonik değerlerinden aktif sapıyor (quick-win 8-20 vs kaynak 11-20). Hedef dosyalar bilinçli clean-room notu taşıyor (onpage.ts:9 vb.).

**[GOOD] Bağımlılık lisans ağacı permissive.** Kanıt: fast-check/zod/express = MIT (doğrudan doğrulandı); pg-boss@12.26.1 MIT, @paddle/paddle-node-sdk Apache-2.0, @supabase/* MIT, @modelcontextprotocol/sdk MIT, googleapis Apache-2.0 (introduction'da hakem-kontrollü, ledger'da kayıtlı). Copyleft dep yok. (Not: birkaçı pnpm-store hoisting nedeniyle script'le çözülemedi; introduction hakem-kaydı + bilinen lisanslar teyit sağlıyor.)

### 7. OPERASYONEL BORÇLAR

Açık borç envanteri ayrı tabloda (§Açık borç envanteri). Öne çıkanlar canlı teyitli:
- **Reaper/stuck-job reconciliation YOK** — `worker.ts:26` "Recovering stuck running rows is a reconciliation concern, not the worker's." Reconciliation runbook'u dosya olarak yok; progress "ILK ÜCRETLİ KULLANICIDAN ÖNCE" şartı koşmuş. AÇIK.
- **İzleme/alarm/status YOK** — repo'da sentry/uptime/statuspage/alerting/pagerduty grep=0; yalnız Fly `/healthz`. 5xx/kuyruk-birikimi/bütçe/downtime alarmı yok. AÇIK.
- **Runbook'lar:** `scripts/paddle-smoke.md` mevcut (paid-but-no-credits kurtarma dahil). Stuck-job reconciliation runbook'u ayrı dosya değil. reconciliation SQL progress'te var, runbook'a taşınmalı.
- PageRecord.originalUrls (crawler-bakım); PKCE; capped-persistence (GSC pull blob'a taşınmıyor); dashboard gsc-banner; error.tsx root-layout kapsamamıyor; cap-mesajı prod redaksiyon; DFS budget /tmp-ephemeral (kalıcı DFS_LIVE öncesi DB-sayaç şartı); landing Sign-in link — hepsi canlı/kod ile teyit edildi, tablo'da.

### 8. SÜREÇ KANITI + PR-E DERİN İNCELEME

**[GOOD] Hakem zinciri tam.** Kanıt: `progress.md` — her task işçi→hakem→(gerek/fix→re-review) düzenini taşıyor; final whole-branch review'lar (PR-A..E) kayıtlı; migration akışı işçi-yazar→hakem→şef-cloud-apply→rollback'li kanıt+advisors disiplinli. Canlı migration senkronu: `list_migrations` repo 0001-0010 ↔ cloud BİREBİR (10 kayıt).

**[GOOD] PR-E (Opus-hakemli dilim) derin teknik inceleme — sağlam.** Model sapması kaydı (progress:286): Fable aylık-limit → 0010 + creditBalance aggregate + T16 Opus 4.8 hakemliğiyle geçti. Bizzat okundu:
- `0010_race_unique_constraints.sql`: yalnız 2 ALTER ADD CONSTRAINT (projects user_id+domain, gsc_connections user_id+project_id); additive-only, her birine ters-DROP yorumu, RLS/grant/append-only zırha dokunmuyor. Canlı `pg_constraint` teyidi: iki constraint contype='u' doğru kolonlarda. setup_project ON CONFLICT DO NOTHING + read-back (READ COMMITTED altında created:true|false tutarlı — 8-yollu test).
- creditBalance aggregate: `db.ts:410` + `ledger-read.ts:77` ikisi de view'da; app-side `select("delta")`+reduce YOK (grep boş); tenant filtresi açık; view server-side SUM (1500-satır regresyon RED→GREEN kanıtlı). Para yolu (reserve/commit/release) diff'te dokunulmamış.
- `guard.ts`: para-yönü disiplinleri (commit-fail-no-release vb.) doğru; async/sync ayrımı traceable.
Hüküm: Opus-hakemli dilim Fable-standardını karşılıyor; yeni risk bulunmadı.

---

## Gelişim değerlendirmesi (Boyut 9)

Yöntem: ürün GERÇEKTEN kullanıldı — test hesabıyla canlı MCP gateway'e bağlanıp SeoGrep'in kendi
araçları seogrep.com'a karşı koşuldu (setup_project → whats_next → crawl_site → audit_onpage/tech/schema
→ generate_report), ledger canlı doğrulandı, public rapor tarayıcıda açıldı.

### a) Dogfooding — kendi sitemizin gerçek SEO bulguları (çifte değer)

Uçtan uca akış SORUNSUZ çalıştı ve GERÇEK değer üretti. Canlı akış:
- `setup_project(seogrep.com)` → created; `whats_next` → doğru yönlendirme ("run crawl_site" + gerekçe + sonraki adımlar). Router akıl-yürütmesi net.
- `crawl_site` → job async ~24s, 42 sayfa, 0 skip, 0 crawl-seviyesi issue.
- `audit_onpage` → **42/42 sayfa canonical'sız**; 5 pazarlama sayfası (/, /pricing, /how-it-works, /terms, /privacy) aynı 178-char meta'yı paylaşıyor (duplicate + too-long); 6 thin-content docs sayfası (129-196 kelime); whats-next docs sayfası meta 268 char; birçok tools-reference sayfası meta 190-242 char.
- `audit_tech` → temiz teknik sağlık: 42 tümü 2xx, 0 redirect, 0 robots çakışması.
- `audit_schema` → **0/42 sayfa JSON-LD structured-data** — sıfır Organization/WebSite/SoftwareApplication/Article şeması.
- `generate_report` → public rapor https://seogrep.com/r/UbAykGWKrjk; tarayıcı: render+stil OK, `noindex,nofollow` aktif, tek link seogrep.com, SIFIR dış-istek, uydurma slug→404.

**Kendi sitemizin SEO hükmü:** Teknik sağlık iyi ama on-page + structured-data zayıf. Bir SEO aracının
kendi sitesi sattığı denetimlerin çoğunda başarısız — lansmanda inandırıcılık riski. Beta öncesi
düzeltilmeli (ucuz): (1) her sayfaya self-referencing canonical; (2) sayfa-başı özgün meta (178-char
paylaşımlı meta'yı böl); (3) Organization + WebSite + SoftwareApplication JSON-LD; (4) tools-reference
meta'larını ~155 char'a kırp (docs-generator description-truncate).

**Ürün-değer kanıtı:** Araç 42/42 canonical eksiğini + 0 şema kapsamını + duplike meta'ları doğru
yakaladı; audit çıktıları temiz, sayfa-başı, önceliklendirilmiş. LLM-client için prose dengesi iyi.

### b) Araç yüzeyi — 16 tool ne kadar kapsıyor?

Mevcut 16 tool crawl+audit(3)+GSC-discovery(3)+keyword+report+router çekirdeğini iyi kapsıyor. Bir SEO
ajansının/agent'ının gerçek iş akışında **eksik** olanlar (fikir düzeyi; platinum-seo-engine AGPL — kod asla):
rank tracking (pozisyon-zaman serisi), backlink analizi, rakip analizi (SERP competitors), içerik
önerisi/brief, çoklu-site/toplu yönetim, zamanlanmış/periyodik tarama, bildirim/webhook (crawl bitti,
sıralama düştü), Core Web Vitals/Lighthouse (perf sinyalleri), internal-link/orphan analizi, image/alt audit.

**Kritik beta boşluğu:** `research_keywords` (tek paralı DFS tool'u) beta'da KAPALI (DFS_LIVE off) → "not
yet enabled" dönüyor. Amiral bir veri-tool'unun ölü olması demo/edinim değerini düşürür. DFS_LIVE beta
duruşu (DB-sayaçlı kalıcı açılış mı, kapalı mı) karara bağlanmalı.

**Tool çıktı kalitesi (LLM-client):** whats_next akıl-yürütmesi güçlü (durum→tek-en-iyi-adım+gerekçe+sonraki);
audit çıktıları structured+okunur; hata mesajları yönlendirici ("run crawl_site first"). **En büyük çıktı
boşluğu:** generate_report audit bulgularını içermiyor (bkz. aşağıda) — rapor, tool zincirinin en değerli
çıktısını (audit) atlıyor.

### c) Webapp / Dashboard UX — time-to-value

- **Landing'de Sign-in YOK** (canlı teyit: header = SeoGrep|How it works|Pricing|Docs|Join waitlist; `hasSignIn:false`) ama `/login` canlı ("Log in · SeoGrep"). Davet-edilmiş beta kullanıcısı ana sayfadan dashboard'una ulaşamaz.
- Site hâlâ **waitlist-only** — tam ürün canlıyken signup CTA yok (lansman kararı; beta invite akışı netleşmeli).
- **Rapor yönetimi yok:** /app/reports salt-liste; silme/yeniden-adlandırma/public-slug-iptali yok → paylaşılan rapor sonsuza dek yaşar (GDPR/gizlilik: kullanıcı raporunu silemez).
- Kullanım grafiği yok (Overview bakiye+son-hareketler; zaman-serisi grafik spec'te vardı, yok).
- gsc-banner (`?gsc=` durum mesajları render edilmiyor) + cap-mesajı prod redaksiyon — bilinen, açık.
- Çoklu-key: cap 5 ama UI tek-aktif-key varsayıyor; takım/işbirliği yok.

### d) Vitrin + docs + funnel

- 5 client kurulum rehberi mevcut (claude-desktop/claude-ai/claude-code/cursor/windsurf) — docs statik build'de, nav §4 birebir.
- Funnel: landing→waitlist tek yol; pricing net ($0/19/49/149 + top-up, "beta" bağlamı). Dönüşüm için signup/sign-in eksik (yukarıda).
- Sitenin kendi SEO'su (dogfooding): canonical/şema/meta eksikleri — funnel-öncesi güven işareti; düzeltilmeli.

### e) Beta / operasyon hazırlığı

- **İzleme/alarm YOK** (sentry/uptime/statuspage/alerting grep=0); yalnız Fly healthcheck. 5xx/kuyruk/bütçe/downtime görünürlüğü yok.
- **Reaper YOK** — crash olan worker jobs'ı 'running' + açık-reserve bırakır; reconciliation runbook'u dosya değil.
- **Rate-limit** yalnız geçerli-key sonrası (geçersiz-key seli sınırsız DB lookup — §1).
- **DFS budget** Fly'da /tmp ephemeral (boot-başına sıfırlanır) — kalıcı DFS_LIVE öncesi DB-sayaç şart.
- Yedekleme/DR: Supabase managed backup (default) var ama DR runbook'u yok. Destek kanalı: sitede görünür destek e-postası/iletişim yok.

### Öneri tablosu

| # | Öneri | Gözlem-kanıtı | Etki | Çaba | Kova |
|---|---|---|---|---|---|
| G1 | generate_report'a audit_onpage/tech/schema bulgularını ekle | Canlı rapor "No basic on-page issues" derken audit 42 canonical-eksiği buldu | Yüksek | Orta | FAZ-4-STRATEJİK |
| G2 | Kendi sitemizin SEO'sunu düzelt (canonical + özgün meta + JSON-LD) | Dogfooding: 42/42 canonical'sız, 0/42 şema, 5 dup meta | Yüksek | Küçük | QUICK-WIN |
| G3 | Landing header'a Sign-in linki ekle | Canlı: header'da sign-in yok, /login canlı | Orta | Küçük | QUICK-WIN |
| G4 | İzleme/alarm (5xx, kuyruk, bütçe, uptime) + status sayfası | grep: sentry/uptime/alerting=0 | Yüksek | Orta | FAZ-4-STRATEJİK |
| G5 | Geçersiz-key için per-IP throttle (Fly/proxy) | auth.ts:101 rate-limit lookup-sonrası | Yüksek | Orta | FAZ-4-STRATEJİK |
| G6 | research_keywords beta duruşu (DFS_LIVE + DB-sayaç) karara bağla | Tool "not yet enabled" dönüyor | Orta | Orta | FAZ-4-STRATEJİK |
| G7 | Reaper / stuck-job reconciliation (worker crash kurtarma) | worker.ts:26 defer; runbook yok | Orta | Orta | FAZ-4-STRATEJİK |
| G8 | Rapor yönetimi: silme + public-slug iptali (GDPR) | /app/reports salt-liste | Orta | Orta | FAZ-4-STRATEJİK |
| G9 | tools-reference meta'larını ~155 char'a kırp | Kendi audit: 190-268 char meta'lar | Düşük | Küçük | QUICK-WIN |
| G10 | Yeni tool adayları: rank-tracking, backlink, rakip, scheduled-crawl, bildirim | Araç yüzeyi ajans iş akışını kısmen kapsıyor | Yüksek | Büyük | ERTELENEBİLİR (v1.1+) |
| G11 | Kullanım grafiği (Overview zaman-serisi) | Overview yalnız bakiye+son-5 | Düşük | Küçük | ERTELENEBİLİR |
| G12 | Destek kanalı + DR runbook | Sitede destek iletişimi yok | Orta | Küçük | FAZ-4-STRATEJİK |

### Önerilen FAZ 4 aday backlog (sıralı)

1. **(Blocker) Koordine secret rotasyonu** — §1 CRITICAL.
2. **(Blocker) SSRF sertleştirme** — DNS-sonrası özel-IP reddi + non-public TLD reddi.
3. **(Blocker) worker "stub/scale-0" yorumlarını düzelt** — ops-tuzağı.
4. G5 geçersiz-key throttle + G4 izleme/alarm/status — beta operasyon zemini.
5. G7 reaper/reconciliation runbook — ilk ücretli kullanıcı öncesi.
6. G1 generate_report audit-entegrasyonu — ürün-değeri/inandırıcılık.
7. G2 + G3 + G9 — kendi SEO + Sign-in link + docs-meta (ucuz güven işaretleri).
8. G6 research_keywords beta duruşu + G8 rapor yönetimi (GDPR) + G12 destek/DR.
9. G10/G11 — v1.1 tool genişlemesi (ertelenebilir).

---

## Açık borç envanteri

| Kayıt | Kaynak | Faz-4-öncesi mi? | Öneri |
|---|---|---|---|
| Secret rotasyonu yapılmadı (chat-maruz canlı credentials) | PLAN kuyruk #1; progress:321,326 | **EVET (blocker)** | Tek turda koordine rotasyon, Netlify+Fly |
| SSRF: DNS-sonrası özel-IP/iç-TLD filtresi yok | crawl.ts:351-354; setup-project.ts:15 | **EVET (blocker)** | Çözüm-sonrası IP blocklist + .internal reddi |
| worker "stub, scale 0" bayat yorum | fly.toml:45; index.ts:31 | **EVET (blocker)** | Yorumları düzelt (gerçek tüketici) |
| Geçersiz-key sınırsız DB lookup (rate-limit sonrası) | auth.ts:101; progress:202 | EVET (güçlü öneri) | Fly/proxy per-IP throttle |
| İzleme/alarm/status yok | grep=0; yalnız /healthz | EVET (güçlü öneri) | Uptime+5xx+kuyruk+bütçe alarmı |
| Reaper / stuck-job reconciliation | worker.ts:26 | EVET (ilk ücretli öncesi) | Reaper + reconciliation runbook |
| generate_report audit'i içermiyor | Canlı rapor + audit karşıt | Öneri (yüksek değer) | Rapora audit bölümleri ekle |
| Landing Sign-in link yok | Canlı header teyidi | Öneri (quick-win) | Header'a Sign-in |
| research_keywords beta'da kapalı (DFS_LIVE off) | Tool açıklaması; secrets | EVET (karar) | Beta duruşu + DB-sayaç |
| Rapor yönetimi (silme/slug-iptal) yok | /app/reports | Öneri (GDPR) | Silme + public-slug iptali |
| Kendi sitemizin SEO'su zayıf | Dogfooding audit | Öneri (quick-win) | canonical+meta+JSON-LD |
| DFS budget /tmp ephemeral | fly.toml:17; progress:333 | EVET (kalıcı DFS_LIVE öncesi) | DB-tabanlı bütçe sayacı |
| deploy-mcp path pnpm-lock/tsconfig eksik | deploy-mcp.yml | Hayır (minor) | Path'lere ekle |
| CI action'ları SHA-pinsiz (flyctl hariç) | ci.yml | Hayır (minor) | SHA-pin derinlik-savunması |
| make goals stale-artifact false-PASS | goals/docs-schema-sync, docs-static | Hayır (minor) | Predicate koşulsuz rebuild |
| stripCostSentences baş-boşluk (latent) | gen-tool-docs.mjs:43 | Hayır (minor) | Kalıntı-assert |
| pgboss.* mutable search_path | advisors | Hayır (non-issue) | İsteğe bağlı pin |
| Supabase leaked-password kapalı | advisors | Hayır (1-tık) | Dashboard'dan aç |
| error.tsx root-layout kapsamıyor | progress:289 | Hayır (minor) | global-error.tsx |
| cap-mesajı prod redaksiyon | progress:281,289 | Hayır (minor) | structured-return |
| PageRecord.originalUrls; PKCE; capped-persistence; gsc-banner | progress:242,248,254 | Hayır (backlog) | v1.1 |

---

## FAZ 4 GO / NO-GO tavsiyesi

**Hüküm: KOŞULLU GO.** Mühendislik çekirdeği (para, RLS, test, lisans, süreç) canlı-kanıtla sağlam;
ama canlı paraya/beta davetlerine geçiş 3 blocker + operasyon-zemini eksikleriyle engelli.

**Zorunlu koşullar (canlı para / beta davet ÖNCESİ — sırayla):**
1. **Koordine secret rotasyonu** (CRITICAL) — chat-maruz tüm canlı credentials döner; Netlify+Fly çift güncelleme; rotasyon kanıtı ledger'a.
2. **SSRF sertleştirme** — crawler'da DNS-çözümü sonrası özel/loopback/link-local/ULA/6PN IP reddi + `.internal`/`.local` non-public TLD reddi; `fetchText` emisyon-öncesi kontrol (parity).
3. **worker "stub/scale-0" yorumlarını düzelt** (fly.toml + index.ts) — ops-tuzağını kaldır.
4. **Geçersiz-key per-IP throttle** (Fly/proxy) — halka açılmadan DB-lookup abuse yüzeyini kapat.
5. **Asgari izleme + reaper/reconciliation runbook** — uptime/5xx/kuyruk/bütçe alarmı + ilk ücretli kullanıcı öncesi stuck-job kurtarma.

**Go-kararına alınması önerilen gelişim öğeleri (Faz-4 kapsamı):**
- G1 (generate_report audit-entegrasyonu) — ürün-değerinin en büyük tek eksiği; paylaşılan rapor edinim yüzeyi.
- G2+G3+G9 (kendi SEO + Sign-in + docs-meta) — ucuz güven/inandırıcılık işaretleri, lansman öncesi.
- G6 (research_keywords beta duruşu) — amiral veri-tool'u şu an ölü; beta demo değeri için karar şart.
- G8 (rapor silme/slug-iptal) — GDPR/gizlilik; paylaşılan public rapor iptal edilemiyor.

**Değiştirilmemesi gerekenler:** Kredi tablosu v0 (insan onaylı, marj sağlıklı — NEVER #6); RLS/ledger
zırhı; append-only invariant; temiz-oda AGPL disiplini. Fiyat/kredi/paket önerileri tavsiye düzeyinde kaldı.

**Denetim burada DURUYOR** — Faz 4 işi başlatılmadı; go/no-go ve koşulların uygulama sırası insan kararı.
