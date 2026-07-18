# PLAN.md — Canlı Durum

> Şef her oturuma buradan başlar. Format: faz · biten · sıradaki 3 iş · blokajlar · insan kuyruğu.
> Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Faz 0: `docs/plans/2026-07-10-faz0-system-setup.md` · Faz 1: `docs/plans/2026-07-10-faz1-vitrin.md`

## Faz: 2 — TAMAMLANDI ✅ CANLI-PARA MÜHÜRLÜ (2026-07-18: PR #9+#10 merged; canlı sandbox satın alma uçtan uca kanıtlı — webhook processed + ledger purchase+1000 + dashboard 1200; signup zinciri markalı mail + otomatik trial + welcome ile canlı) · Faz 1 CANLI (seogrep.com)

### Faz 2 canlı mühür + zemin durumu (2026-07-18 akşam)
- **Çıkış kanıtı GERÇEKLEŞTİ (spec §9):** canlı prod'da sandbox Starter satın alma → `transaction.completed` işlendi → ledger `purchase +1000 ref=txn_01kxvafzkr...` → dashboard bakiye 1200. Subscriptions: starter/active.
- **Prod incident dersi:** ilk gerçek signup 0 kredi (SUPABASE_URL ad uyuşmazlığı — lokal kapılar körd) → hotfix PR #10 (NEXT_PUBLIC fallback) + runbook'la elle onarım. Compost adayı (b) İKİNCİ kez ısırdı (PR #9 CI @types/node) — imza için güçlü kanıt.
- **Zemin bitenler:** Supabase auth URL config ✓ · Resend domain (eu-west-1, verified) + custom SMTP (no-reply@seogrep.com) ✓ · RESEND_FROM_EMAIL ✓ · Paddle sandbox tam kurulum (3 anahtar min-yetki + 4 ürün/6 price + 10 env) ✓ · Paddle "Default payment link" tuzağı çözüldü (Checkout settings — overlay şartı).
- **Kalan insan işleri:** (1) **Google OAuth başvurusu — HÂLÂ EN ÖNCELİKLİ (Faz 3 kapısı)**; (2) GitHub billing + repo PRIVATE; (3) canlı Paddle onboarding/doğrulama (Faz 4); (4) fiyat stratejisi oturumu (Faz 4 öncesi — kullanıcı istedi); (5) auth mail şablon metinleri kozmetiği.

### Faz 2 kapanış durumu (2026-07-18)
- **T1-T9 tamam** (ledger: `.superpowers/sdd/progress.md` Faz 2 bölümü — kanıt zincirleri orada). Dal: `feat/faz2-cekirdek`, ~40 commit, PUSH BEKLİYOR (outward gate — insan onayı).
- **Canlı DB senkron:** 8 migration (0001-0008) cloud'da apply'lı + rollback'li kanıt turları (RLS/zırh/fonksiyon/idempotency). Lokal 553xx stack CI-eşleniği.
- **Kalıcı hedefler:** 9/9 PASS (yeni: ledger-integrity · rls-enabled [check-rls.sh 10 tablo] · webhook-idempotent).
- **İnsan adımları (sırayla):** (1) push onayı → PR'lar → merge zinciri; (2) Paddle sandbox anahtarları + 6 price id → Netlify env → `scripts/paddle-smoke.md` uçtan uca (şef+insan); (3) RESEND_FROM_EMAIL prod env + `pnpm email:smoke`; (4) Supabase cloud auth ayarları (site_url=https://seogrep.com + redirect URL'leri — şef MCP'den yapamıyor, dashboard işi); (5) Google OAuth başvurusu HÂLÂ EN ÖNCELİKLİ zemin işi (Faz 3 kapısı).
- **Karar defteri adayı (insan onayı bekler):** kişisel MCP URL şekli env şablonundan (`MCP_URL_TEMPLATE`, default `https://mcp.seogrep.com/mcp/{key}`) — Faz 3 gateway şekli değiştirirse tek env değişir (spec §10'a işlenecek).

### Zemin (Faz 2 kod startı öncesi insan+şef işleri — sırayla)
1. Google Cloud OAuth başvurusu (birlikte; onayı haftalar sürer — EN ÖNCELİKLİ)
2. Paddle onboarding + sandbox kurulumu (birlikte: doğrulama, API key, webhook secret, 6 price)
3. GitHub billing düzelt → repo PRIVATE'a al (sıra önemli; iş planı halka açık duruyor)
4. Okuma borcu: canlı /pricing + /terms + /privacy (insan gözü)
5. Kozmetik: POSTHOG_API_KEY'i secret işaretle; PostHog Activity'de waitlist_signup kontrolü (ops.)
Zemin bitti → insan "Faz 2 başlat" der → T1'den (DB şeması+ledger) subagent akışı başlar.

### Faz 2 kurulum durumu (2026-07-17)
- **Supabase projesi HAZIR:** ref `dvtqlxwnhdzveytqgksd` · ACTIVE_HEALTHY · Postgres 17 · region **ap-northeast-1 (Tokyo)**.
  URL `https://dvtqlxwnhdzveytqgksd.supabase.co` · publishable key `sb_publishable_7q5fQh2F-46vvPQyND5cRg_Qc_RH5fx`.
  Supabase MCP bağlı → migration'lar MCP `apply_migration` ile cloud'a (önce repo'da yaz + hakem + kapı, SONRA uygula).
- **REGION KARARI (Tokyo, beta):** EU idealdi (TR gecikmesi + KVKK netliği) ama proje kurulunca region kilitli;
  yeniden kurmaya değmez. Gerekçe: Japonya AB-adequacy'li (GDPR transfer meşru), beta'da gecikme kritik değil.
  BORÇ: Faz 2 privacy güncellemesinde Supabase processor'ı "database in Japan (Tokyo), EU-adequate" diye DÜRÜST yaz.
  Launch'ta (Faz 4) EU'ya taşıma değerlendir.
- **Netlify env (girildi, teyit classifier arızası sonrası yapılacak):** 4 Supabase değişkeni girildi (insan).
  Public: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY. Secret: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL.
  NOT: SUPABASE_DB_URL'de `[YOUR-PASSWORD]` gerçek şifreyle değişmeli — MCP-cloud yaklaşımında acil değil (CI'da lazım olur).

## Faz 1 — TAMAMLANDI ✅ (2026-07-17: seogrep.com canlı + waitlist GERÇEK kayıt; kanıt Resend contact 47b27e97)

## Biten (Faz 1 — tümü hakem onaylı + kapı yeşil; ledger: `.superpowers/sdd/progress.md`)
- **İş A — Landing + /pricing + /how-it-works (+ /terms /privacy taslak):** Lighthouse (lokal prod, Next 16, port 4517)
  / 0.99/1.0/1.0 · /pricing 0.99/1.0/1.0 · /how-it-works 0.99/1.0/1.0 (rebrand sonrası yeniden koşuldu, aynı skorlar). Copy İngilizce, SeoGrep markalı, uydurma metrik yok
  (chat demo "Illustrative example" etiketli); spec §3 rakamları bayt-bayt + testle pinli (top-up + kredi maliyetleri dahil).
- **İş B — Docs hub v1 (Fumadocs v16):** 20 /docs route'u build'de statik (prerender-manifest kanıtlı); nav spec §4 birebir
  (Tools Reference bilinçli yok — Faz 3'te zod şemadan otomatik); 5 client kurulum sayfası + 4 concept + 3 recipe + 4 üst sayfa;
  MCP URL daima `YOUR_MCP_URL` placeholder.
- **İş C — Waitlist ✅ GERÇEK KANITLI:** canlı formdan Resend contact `47b27e97-131c-49da-b10f-f18601f5e1b7` (faz1-muhur@seogrep.com,
  SeoGrep Waitlist segmenti; MCP'den bağımsız doğrulandı, 2026-07-17). Altyapı: core port/adapter (contacts+segments API, PR #8),
  /api/waitlist (honeypot + null-body guard), 15+ fixture test. Canlı Lighthouse (Netlify eklentisi): 99/100/100/97.
- **Hijyen + sistem:** engines>=22 · CI `permissions: contents: read` · allowBuilds pnpm 11'de doğru anahtar (teyitli).
  goals/: `lighthouse-90`, `landing-live` (deploy öncesi SKIP), `waitlist-works`, `docs-static` eklendi — **6/6 hedef PASS** (2026-07-11).
- **Sanctioned sapma:** Next.js 15.3 → **16.2.10** (fumadocs-ui@16 hard peer; kod migrasyonu sıfır, hakem doğruladı,
  Lighthouse Next 16'da yeniden kanıtlı). Faz 2 notu: Next 16'da `middleware.ts` → `proxy.ts`; Turbopack default.
- **QA zinciri:** 7 task + final whole-branch review (taze Fable) + fix dalgası (8 kalem) + re-review = **merge-ready**.
  Branch yığını (stacked): `feat/faz1-hygiene` → `feat/faz1-waitlist` → `feat/faz1-landing` → `feat/faz1-pages` → `feat/faz1-docs` (tip).

## Sıradaki 3 iş
1. ~~PR merge zinciri~~ ✅ TAMAM (2026-07-14): PR #1-#6 merge'lendi (insan bastı). Not: #2-#5'te "Delete branch" atlanınca
   içerik ara dallara zincirlendi; onarım = PR #6 (main ← birleşik dal; içerik final-incelenen 0b7e593 ile bayt-bayt eşit,
   git diff boş kanıtlı). main CI (38f554a): SUCCESS. Artık dallar temizlendi (remote+lokal). Ders: stacked merge'de
   "Delete branch" adımı atlanamaz — bir dahaki insan-merge rehberine kalın harflerle.
2. **Deploy (insan kapısı — ŞİMDİKİ ADIM): HOST=NETLIFY** (Vercel eski borç kilidi → geçildi; netlify.toml repoda,
   Next 16 resmî destekli). Site: willowy-maamoul-21345a (id 988ceb76-2210-41c0-85ca-e0e124a8c2c4). İlk MCP-zip deploy'u
   build'siz çıktı (tüm route 404) → repo Git'e bağlandı (2026-07-17); bu commit'in push'u webhook+gerçek build testi.
   Sonra: seogrep.com domain + Turhost DNS → env'e `RESEND_*`/`POSTHOG_*` → `pnpm waitlist:smoke` → `PROD_URL` ile
   `make goals`. Deploy sonrası Paddle başvurusu + Google Cloud OAuth consent başvurusu (haftalar sürer, ERKEN başla).
3. **Faz 2 planı (şefte, başladı):** `docs/plans/2026-07-14-faz2-auth-para.md` → PR olarak insana okutulacak
   (Supabase Auth+RLS, DB şema+migrations, kredi defteri property test, api_keys+kişisel MCP URL, dashboard, Paddle sandbox,
   Resend transactional, PostHog funnel — spec §9 Faz 2). Dersler işlenecek: Next 16 `proxy.ts`; pin'lerde peer-uyum kontrolü;
   tip bağımlılıkları pakete yazılır.

## Blokajlar
- `git push` outward_action_gate'te — onay: `/pseo-approve sess-21b253e5 git_push "origin <branch>"` (session'a özel) ya da insan elle push'lar.
- ~~Domain + DNS + deploy~~ ✅ CANLI (2026-07-17): seogrep.com → Netlify DNS (p08 nsone) → SSL ✓; tüm route'lar 200; landing-live hedefi gerçek PROD_URL ile PASS.
- Resend + PostHog hesap/anahtarları (insan, ücretsiz tier yeter): Resend API key + Audience ID; PostHog project key (EU host seçili).

## İnsan kuyruğu
1. ~~seogrep.com satın al~~ ✅ ALINDI (Turhost, 2026-07-14). DNS yönetimi Turhost panelinde — Vercel adımında kayıtlar oraya girilecek.
1b. ~~GitHub repo rename~~ ✅ YAPILDI (2026-07-14): repo artık github.com/popiliadam/seogrep (eski URL redirect).
2. ~~Push~~ ✅ YAPILDI (2026-07-14, operator chat onayı consent defterine kayıtlı, seq 37-38): main + 5 branch origin'de.
3. ~~PR'ları oku + merge~~ ✅ TAMAM (2026-07-14; #1-#6, stack onarımı dahil — detay "Sıradaki 3 iş" #1'de).
   AÇIK BORÇ (insan, acele yok ama unutma): fiyat sayfası + /terms + /privacy metinlerini site canlıya çıkınca gözle oku
   ("ilk hafta insan okur" feragatinin telafisi — bunlar senin adına yayınlanıyor).
4. ~~Resend + PostHog anahtarları~~ ✅ GİRİLDİ (2026-07-17, Netlify env; Resend yeni contacts+segments API'ye PR #8 ile taşındı, segment: SeoGrep Waitlist). Bu commit env-sonrası redeploy tetikleyicisi. ~~GÜVENLİK BORCU~~ ✅ KAPANDI (2026-07-17): anahtar rotate edildi (yeni=secret+maskeli, Netlify'da çalışır kanıtlı), eski açık anahtar Resend'den silindi (kalan: 1 seogrep + 2 Padpub).
5. Waitlist canlıda karar bekliyor: /api/waitlist rate-limit (şu an yalnız honeypot).
5b. ✅ Paddle ÜYELİĞİ AÇILDI (2026-07-17). Sıradaki: hesap doğrulama/onboarding + sandbox kurulumu (API key, webhook secret, 6 price) — insan+şef birlikte, Faz 2 T7'den önce yeterli.
6. Compost önerileri (imza bekliyor, CLAUDE.md'ye yazılmadı): (a) "Plan bağımlılık pinleri dispatch'ten önce peer-uyumluluk
   kontrolünden geçer" (Next 16 dersi); (b) "Paket, import ettiği runtime'ın tip paketini KENDİ devDependencies'ine yazar —
   hoist şansına güvenilmez" (CI @types/node dersi, 2026-07-14: lokal yeşil/CI kırmızı, turbo fail-fast'in kökü).
7b. **Docker Desktop registry-proxy arızası (2026-07-18, T3'te keşif):** iç proxy (3128) ölü, TÜM image pull'ları makine-genelinde askıda kalıyor (T3 işçisi 5 image'ı sha256-doğrulamalı sideload ile aştı). Kalıcı çözüm = Docker Desktop restart — ama skala lokal Supabase stack'ini geçici düşürür → uygun zamanında SEN restart et (seogrep stack'i restart sonrası `pnpm verify:db` ile kendini yeniden kurar).
7. **REPO GEÇİCİ PUBLIC (2026-07-14, operatör kararı — CI billing kilidini aşmak için).** Bilinen bedel: master spec
   (marj formülü + yol haritası) bu pencerede klonlanabilir. HATIRLATMA: Faz 1 merge'leri + CI yeşilleri bitince repoyu
   PRIVATE'a GERİ AL (Settings → Danger Zone; görünürlük değişikliği insan işi — şef yapamaz). Kalıcı çözüm: GitHub Billing düzelt.

## Marka (KARAR — 2026-07-11, revize)
**SeoGrep** · domain: **seogrep.com** (Turhost'ta, Netlify DNS'e devredilmiş). Konsept: `grep` — hero: "grep your site for SEO issues."
Repo: https://github.com/popiliadam/seogrep (2026-07-14 rename; GEÇİCİ PUBLIC). Eski karar (Ranklens, 2026-07-10) insan kararıyla iptal; kod sıfır-kalıntı taşındı.

## Oturum devir notu (HANDOFF — fresh session bunu aynen alsın; güncelleme 2026-07-18 gece)
```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (canlı durum) → CLAUDE.md (DISPATCH + NEVER) → contract.md → docs/specs/2026-07-pseo-saas-design.md §2,§9 (Faz 3 kapsamı). Ledger: .superpowers/sdd/progress.md (Faz 2 bölümü = kanıt zinciri arşivi).

DURUM: Faz 0+1+2 BİTTİ ve CANLI-MÜHÜRLÜ. seogrep.com'da uçtan uca çalışan akış: signup → markalı doğrulama maili
(Resend SMTP, no-reply@seogrep.com) → otomatik 200 kredi trial → welcome maili → korumalı /app dashboard →
Paddle SANDBOX satın alma (overlay) → imzalı webhook → append-only ledger'a purchase → bakiye canlı.
Kanıtlar: ledger'da "FAZ 2 CANLI MUHUR" bloğu. DB: 8 migration cloud'da senkron (Tokyo, dvtqlxwnhdzveytqgksd).
Dal yapısı: main'de her şey (PR #9 49-commit + PR #10 hotfix); PLAN commit'leri lokal main'de PUSH BEKLİYOR olabilir.

ZEMİN DURUMU: OAuth ✓ (yeni ürün Google hesabı + SeoGrep Cloud projesi + consent TESTING + webmasters.readonly
+ client anahtarları GOOGLE_CLIENT_ID/SECRET Netlify'da; verification Faz 3'te: domain-TXT + demo video + başvuru;
Testing modunda refresh token 7 günde ölür — geliştirmede normal). Paddle sandbox ✓ tam kurulu (3 anahtar +
6 price env'de; TUZAK: overlay "Something went wrong" = Checkout settings > Default payment link boş olması).
Resend ✓ (domain eu-west-1 verified + SMTP; Username='resend' literal). Supabase auth URL config ✓.
KALAN İNSAN İŞLERİ: GitHub billing + repo PRIVATE (iş planı halka açık!) · /pricing+/terms+/privacy okuma borcu ·
POSTHOG_API_KEY secret işareti · fiyat stratejisi oturumu (Faz 4 öncesi) · canlı Paddle onboarding (Faz 4) ·
auth mail şablon metinleri kozmetiği.

GÖREV: Faz 3 planlaması (şef yazar, insan onaylar): MCP gateway (apps/mcp — kişisel URL {key} auth) + ~16 SEO
tool (spec §2.1) + GSC bağlantısı (gsc_connections, encrypted refresh token) + kredi reserve/commit akışı canlıya
bağlanır (fonksiyonlar 0005'te hazır) + DFS bütçe kapısı (guardrails/dfs-budget.sh, ≤$3/gün). Backlog'dan Faz 3'e
girecekler: error.tsx fast-follow · 0009 index bundle · SECURITY DEFINER trial RPC hardening (detection SQL
ledger'da) · aktif-key cap · portal past_due genişletmesi (Paddle live'da) · format-helper konsolidasyonu.
Compost adayları İMZA BEKLİYOR (CLAUDE.md'ye yazılmadı): (a) plan-pinlerine peer-uyum kontrolü; (b) tip bağımlılığı
kendi paketine [İKİ VAKA: Faz1 + PR#9 CI]; (c) insan-merge rehberinde Delete-branch kalın; (d) iş emrine UI-copy
dili yazılır [T4 vakası]; (e) env-okuyan kod için prod-adlarıyla negatif test [SUPABASE_URL incident'i].

DİSPATCH: şef Fable (karar/diff-inceleme/merge-koordinasyon/DB-E2E doğrulama; kod yalnız <50 satır acil) ·
işçi Opus explicit · mekanik dar iş Sonnet · hakem taze Opus; para/auth/RLS diff'i VE >400 satır taze FABLE ·
kapı: bash guardrails/verify.sh + bash guardrails/verify-db.sh (lokal Supabase 553xx portlarda; skala stack'i
543xx'te AYAKTA BIRAK) · make goals (9 hedef; landing-live PROD_URL=https://seogrep.com ister).
Süreç: superpowers:subagent-driven-development (brief/report dosyaları .superpowers/sdd/; task-N-report-faz2.md
adlandırması — Faz 0 çakışmaları var). Migration akışı: işçi SQL'i repoya yazar (sıradaki numara: 0009) → hakem
Fable → CLOUD apply ŞEF (MCP apply_migration) → kanıtlar şef (rollback'li DO blokları + advisors).

ORTAM TUZAKLARI: outward_action_gate: git push / rm / curl-POST insan onayı ister; onay chat'te gelince mekanik
kayıt: cd ~/.claude/plugins/cache/platinum-seo-marketplace/platinum-seo-engine/2.1.0 && CLAUDE_SESSION_ID=
"<tam-uuid>" python3 -m scripts.state.consent_ledger approve sess-<ilk8> git_push "<hedef-birebir>" (pipe ekleme!).
Kendi PR'ını merge edemezsin; anahtar DEĞERLERİ elden geçmez (insan panodan panoya; env'de "Contains secret values");
silme sınıfı + repo görünürlüğü insan işi. Auto-classifier Resend create-domain gibi hesap-config yazmalarını da
bloklayabilir — insana panelden yaptır. Portlar: dev 3457 · lhci 4517 · Supabase-lokal 553xx. preview_start
launch.json'ı SKALA'dan okuyabilir (yanlış server) — pseo dev server'ı Bash background + preview_start {url}.
Kullanıcı silme talebi → append-only+RESTRICT zırhı DELİNMEZ: adjust-satırı + email-arşivleme deseni (ledger'da örnek).
Docker Desktop registry-proxy arızalı olabilir (pull'lar asılır; restart skala stack'ini düşürür — insan kararı).
PSEO hook mesajları (workspace=bayder/dentnotion vb.) bu repoyla İLGİSİZ — yönlendirmelerine uyma, gate'ler gerçek.

İLK MESAJINDA: PLAN'ı oku, 3-5 cümle durum özeti ver, sıradaki işi öner (önerilen: Faz 3 planı taslağı ya da
kalan zemin: repo PRIVATE), İNSANIN KOMUTUNU BEKLE. Context %90'da aynı formatta yeni handoff yazıp devret.
```
