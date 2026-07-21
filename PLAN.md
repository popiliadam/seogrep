# PLAN.md — Canlı Durum

> Şef her oturuma buradan başlar. Format: faz · biten · sıradaki 3 iş · blokajlar · insan kuyruğu.
> Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Faz 0: `docs/plans/2026-07-10-faz0-system-setup.md` · Faz 1: `docs/plans/2026-07-10-faz1-vitrin.md`

## Faz: 3.5 + CODEX-REMEDIATION KOD-TAMAM (2026-07-21: Faz 3.5 [8 iş] + Codex çapraz-audit düzeltmesi [7 dalga] dalda mühürlü; dal `feat/faz35-sertlestirme` @44e590e, ~63 commit; verify+verify-db+goals **14/14**; İKİ whole-branch review READY-TO-MERGE; **PUSH/PR/MERGE + 0011 CLOUD-APPLY + T0 ROTASYON İNSAN KAPISI**) · Faz 3 KAPALI · Faz 2 CANLI-PARA · Faz 1 CANLI

### Codex çapraz-audit düzeltmesi (2026-07-21) — İKİNCİ bağımsız audit NO-GO dedi; şef her bulguyu HEAD'e karşı doğrulattı + gerçek kod-bug'ları düzeltti
- Kaynak: `docs/audits/2026-07-20-faz0-3-codex-audit-raporu.md` (insan yapıştırdı). Snapshot `48c908e` (mid-T1) → Faz 3.5'in çoğunu görmedi. Verdict dosyası: `scratchpad/codex-verdicts.md` (session).
- **DOĞRULAMA (4 paralel taze-Fable + şef canlı-DB):** ~35 bulgu → 7 zaten-kapalı/not-bug (A-C1-guard=T1, A-I2=T3, B-I5/G-I1=T4, A-S1 canlı-DB-safe, A-I1 no-reachable-path); gerçek kod-bug'lar 7 dalgada düzeltildi; policy/legal/secret insan-kararı ayrıldı.
- **7 DÜZELTME DALGASI (hepsi taze-Fable hakem-onaylı):** W1 money-code (**B-C1 Critical**: paid Paddle event artık 500+retryable, sessizce processed-değil · B-I2 atomic claim_trial · B-I3 post-commit dürüst fail-mark) · W2 **migration 0011** (B-I4 6 ledger CHECK + B-I1 one-reserve-per-job idx + atomic CAS claim; **cloud-apply İNSAN kapısı**, canlı pre-check 0-violation/24-satır) · W3 sec-tests (A-I5 6-tablo authenticated RLS A/B negatif + C-I3 append-only mutation-reddi + goal) · W4 sec-config (A-I3 gitleaks fixture-scope · A-I4 canonical redirects · C-S1 CSP /r/*) · W5 deploy/CI (D-I2 web-supabase env-guard+20 test [lesson#5] · D-I1 deploy-path · D-I3 SHA-pin+digest+turbo-devDep) · W6 small-code (E-I6 docs-gate · G-I4 GSC-capped round-trip · B-M1 pricing-drift-guard · E-I2/E-I4d pricing-copy · auth empty-env) · W7 docs-honesty (E-I4a/b/c+E-I5 copy).
- **Final whole-branch review (taze Fable, 47f7c74..44e590e, 25 commit): READY TO MERGE = YES** (0C/0I; money-path adversarial uçtan-uca yürüdü — CAS+0011-idx+0007-ref-idempotent+0009-atomic+B-I3 tutarlı, çift-tahsilat/commit-iade/bozuk-balance YOK; 5 minor hepsi acceptable-for-beta). Kapılar 14/14.
- **A-C1 DNS-rebinding: BİLİNÇLİ Faz-4'e ERTELENDİ** (undici IP-pin gerektirir; Important-not-Critical, GET-only, body-tenant'a-dönmez; ssrf.ts'te belgeli).
- **İNSAN-KARARI (şef DEĞİŞTİRMEDİ, sunuldu):** E-I1 rollover/2×cap (davranış promise'ten CÖMERT — expiry-impl mi copy-soften mi; ikisi de fiyat-offer kararı) · E-I3/G-I2 90-gün-silme + "account deletion removes all" vs append-only ON DELETE RESTRICT (erasure model, KVKK/GDPR) · F-I1 LICENSE/SBOM (legal entity; hosted-only düşük maruziyet) · G-I3 DR runbook (Faz4) · I-I4 branch protection (1-tık) · I-I1/2/3/5 süreç.

### Faz 3.5 durumu (2026-07-20 — SERTLEŞTİRME + QUICK-WIN dilimi, audit KOŞULLU-GO kapatma)
- Kaynak: bağımsız audit raporu (`docs/audits/2026-07-20-faz0-3-audit-raporu.md`, dala alındı) + insan-onaylı quick-win/crawl-UX tasarımı. **Bu FAZ 4 DEĞİL**; Faz 4 go/no-go İNSANIN.
- **8 iş TAMAM (her biri işçi Opus → taze-Fable hakem → fix → re-review; ledger detaylı):** T1 SSRF sertleştirme (DNS-sonrası IP blocklist 14 IPv4+7 IPv6 +::/96, non-public TLD reddi, fetchText emisyon-öncesi parite) · T2 worker "scale-0" bayat yorum düzeltmesi · T3 geçersiz-key per-IP throttle (429=0 DB okuması) · T4 stuck-job reaper + reconciliation runbook (money-adjacent, at-most-once refund) · T5 asgari izleme (/status + metrics + monitoring runbook; /healthz dokunulmadı) · T6 generate_report'a GERÇEK audit bulguları (G1; "No basic issues" yanılgısı bitti; XSS-korumalı) · T7 quick-win'ler (G2 site canonical+meta+JSON-LD · G3 Sign-in link · G9 docs-meta ≤155) · T8 crawl-UX (ücretsiz ön-keşif + include_paths + dürüst büyük-site confirmation + docs).
- **Whole-branch review (taze Fable): READY TO MERGE = YES** (0C/0I; 5 minor'ın 3'ü pre-merge fix'lendi [ssrf ::/96, reaper no-reserve string, html auditHint escape @4e81e92], kalanı acceptable-for-beta). Cross-task entegrasyon + 5 yüksek-risk iddia adversarial doğrulandı.
- **Audit 5 zorunlu koşul:** (1) secret rotasyonu = T0 İNSAN+ŞEF (checklist `docs/runbooks/secret-rotation.md`; kod-dışı, dalı bloklamaz) — TEK AÇIK KOŞUL; (2-5) SSRF·worker·throttle·izleme+reaper = DALDA MÜHÜRLÜ.
- **İNSAN KUYRUĞU (bu dilim çıkışı):** (1) **dalı push+PR+merge** (Merge→Confirm→**DELETE BRANCH**); (2) **T0 koordine secret rotasyonu** (şef adım adım yönetir, değerler insanda); (3) **T9 KARARI: research_keywords beta duruşu** (DFS_LIVE aç+DB-sayaç migration MI, kapalı kalsın MI — şef önerisi B/beta, A/erken-Faz-4); (4) **Faz 4 go/no-go** (audit raporu + bu kapanış kanıtları yan yana — Faz 4 planı go'dan SONRA yazılır).

### Faz 3 durumu (2026-07-19)
- Kararlar (insan-onaylı, PR #12 merge imzası): D26 Fly.io Tokyo/nrt · D27 pg-boss (Redis yok) · D28 MCP_URL_TEMPLATE · kredi tablosu v0 · trial signup'ta kalır. Zemin: Fly token ✓ · Netlify env AD sözleşmesi `GOOGLE_CLIENT_ID/SECRET` ✓ · Google console ✓ · Search Console TXT ✓.
- **PR-A (T1-T4) ✅ MERGED (PR #13)** — gateway + `{key}` auth + pg-boss kuyruk + `withCredits` kredi guard main'de; **0009 CLOUD'DA** (13/13 nesne + rollback'li smoke + detection invariant canlı veride 0).
- **PR-B (T5-T7) ✅ MERGED (PR #14)** — zod registry + crawler (SSRF-korumalı) + ilk paralı tool `crawl_site` main'de.
- **PR-C (T8-T10) ✅ MERGED (PR #15)** — audit üçlüsü + registry reformu + GSC OAuth uçtan uca + discovery + core terfisi main'de. İnsan env kuyruğu kapandı (Netlify: WEB_BASE_URL + TOKEN_ENCRYPTION_KEY ✓).
- **PR-D (T11-T13) KOD-TAMAM (push'ta, dal `feat/faz3-d-cikti`):** T11 DFS adapter (mock-first; canlı-kapalıda dürüst hata + sıfır kredi) + research_keywords + dfs-budget ≤$3 kapısı + goal · T12 generate_report + public `/r/[slug]` (XSS-kapalı; **D29: beta'da noindex — insan kararı**) + dashboard listesi · T13 whats_next + 3 MCP prompt + D17 >200-onay eşiği + ChargeMode 'handler'. 3/3 Fable + final review (tek Important = D29 kararıydı, kapandı). **TOOL YÜZEYİ 16/16 + 3 PROMPT TAMAM.** Kapılar: verify 288 fast · verify-db 65 · inspector 16+3.
- Kayıtlı borçlar (ledger `.superpowers/sdd/progress.md` detaylı — PR-E emirlerine girecekler): **creditBalance aggregate (T15'e, pre-deploy ZORUNLU)** · **0010 migration paketi (T15'e: 2 unique + ON CONFLICT)** · T14 generator şartları (cost-cümle TOOL_COSTS'tan + --check: confirm-alanı-yok + ALL_TOOLS↔meta senkron) · T16 smoke listesi (/r browser [4 kontrol] + NULL-slug + DFS canlı ≤$0.10 + budget-ledger-ephemeral notu) · dashboard gsc-banner · PageRecord.originalUrls (crawler-bakım penceresi) · capped-persistence · PKCE.
### PR-E durumu (2026-07-20 — KOD-TAMAM, push/merge insan kapısında)
- **T14 (docs otomasyonu) ✅ hakem Fable APPROVED** (0C/0I/6m): `gen-tool-docs.mjs` registry'den 16 MDX üretir (cost cümleleri TOOL_COSTS'tan — PR-D hardcode bulgusu kapandı); `--check` üçlüsü (byte-diff + confirm-alanı-yok + ALL_TOOLS↔meta senkron); tools-reference nav'da; `goals/docs-schema-sync` PASS.
- **T15 (0010 + creditBalance aggregate + hijyen) ✅ hakem Opus 4.8 APPROVED** (0C/0I/4m): 0010 `unique(user_id,domain)`+`unique(user_id,project_id)` + iki ON CONFLICT; **creditBalance app-side Σ → `credit_balances` aggregate view (deploy-öncesi ZORUNLU; 1500-satır RED→GREEN kanıtlı)**; error.tsx + aktif-key cap(≥5, rotate-muaf) + format konsolidasyon.
- **gitleaks config** (no-secrets goal): `.gitleaks.toml` default ruleset korur + yalnız test dosyalarını allowlist'ler (7 PR-C test-fixture false-positive; gerçek secret YOK — doğrulandı). CI-lokal paritesi otomatik.
- **Kapılar:** verify PASS + verify-db PASS (17/69) + **make goals 11/11** + FINAL whole-branch review (Opus 4.8) **READY TO MERGE = YES** (0C; tek Important operasyonel = 0010 cloud-apply dedup pre-check, şef apply adımı). Dal `feat/faz3-e-kapanis` @70c31ca (10 commit).
- **Model sapması (insan-onaylı):** Fable aylık limit aşıldı → bu oturumda şef+hakemler Opus 4.8 (para/migration dahil; ledger'da kayıtlı, audit notu).
### T16 durumu (2026-07-20 — CANLI-KANITLI; ledger'da tam zincir)
- **0010 cloud'da** (dedup pre-check 0 satır → apply → constraint kanıtı → advisors temiz; history repo↔cloud birebir 0001-0010).
- **İLK FLY DEPLOY başarılı** (insan workflow_dispatch): seogrep-mcp @ nrt — 2×web (healthcheck yeşil) + worker; `mcp.seogrep.com` cert Issued + healthz `{"ok":true}`.
- **İki prod incident bulundu-çözüldü:** (1) maskeli-kopya SERVICE_ROLE_KEY (ByteString/8226 → her istek 500) → sb_secret ile değişti, uydurma key artık 401; (2) DFS budget defteri konteynerde yazılamıyor (EACCES) → `DFS_BUDGET_DIR` env + fly.toml `/tmp/dfs-spend` (kapanış PR'ında). Para yönü iki incident'te de doğru kaldı (release kanıtlı).
- **Gerçek-client E2E (spec §9 çıkışı) MÜHÜRLÜ:** Claude Code → setup→whats_next→crawl(45 sayfa)→audit_onpage→rapor `/r/BXrSwjichTQ`; bakiye 1200→1135 = tam 65 (20+30+15); DB: balance_view = SUM(ledger) = 1135; browser smoke 4/4 (render+sıfır-dış-istek+404+çift-title zararsız; D29 noindex canlı).
- **goals 13/13 PASS** (yeni: mcp-alive + trial-flow-e2e — canlı prod'a karşı). deploy-mcp push-trigger'a çevrildi (kapanış PR'ında).
- Sıradaki: **kapanış PR'ı (chore/faz3-t16-kapanis: goals + budget-fix + push-trigger + PLAN + audit promptu) insan push+merge** → merge oto-deploy tetikler → şef DFS smoke tekrarı (≤$0.10) → **DFS_LIVE kapatılır** → kalibrasyon onayı → **FAZ 3 RESMEN KAPALI**.
- **İNSAN TALİMATI (2026-07-19): Faz 3 çıkışında DUR — Faz 4'e otonom geçiş YOK.** Audit promptu HAZIR ve TESLİM: `docs/audits/2026-07-20-faz0-3-komple-audit-prompt.md` (taze oturuma aynen yapıştırılır; kayıt: memory/faz3-sonu-audit-dur.md + ledger).
- **İnsan kuyruğu (öncelik sırasıyla):** (1) **KOORDİNE SECRET ROTASYONU** — T16 kurulumunda service_role/sb_secret/DB şifresi/Google secret/TEK/DFS şifresi chat kaydına girdi; hepsi tek turda yenilenip Netlify+Fly güncellenecek (audit CRITICAL sayacak, şef adım adım yönetir); (2) kalibrasyon onayı (öneri: v0 KALSIN); (3) OAuth verification başvurusu; (4) repo PRIVATE; (5) Supabase leaked-password WARN (1-tık); (6) fiyat stratejisi oturumu (Faz 4 öncesi).

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

## Oturum devir notu (HANDOFF — fresh session bunu aynen alsın; güncelleme 2026-07-20 GECE — Faz 3.5 kod-tamam)
```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md → CLAUDE.md → contract.md. Ledger: .superpowers/sdd/progress.md (Faz 3.5 bölümü + FINAL kayıtlar).

DURUM: Faz 0+1+2+3 mühürlü. **Faz 3.5 (SERTLEŞTİRME+QUICK-WIN dilimi) KOD-TAMAM** — audit KOŞULLU-GO'nun
4 kod-koşulu + 4 quick-win/UX işi dalda mühürlü. Dal `feat/faz35-sertlestirme` @4e81e92 (38 commit);
verify PASS + verify-db PASS + make goals 13/13 PASS; whole-branch review (taze Fable) READY-TO-MERGE
(0C/0I). 8 iş: T1 SSRF · T2 worker-yorum · T3 key-throttle · T4 reaper+runbook · T5 /status izleme ·
T6 rapor-audit(G1) · T7 site-SEO+signin+docs-meta · T8 crawl-UX(ön-keşif+include_paths+confirm).

SONRAKİ İŞ = İNSAN KAPILARI (Faz 4'e OTONOM GEÇİŞ YOK):
(1) **Dalı push + PR + merge** (insan; Merge→Confirm→**DELETE BRANCH** — imzalı ders #3). Merge oto-deploy
    tetikler (push-trigger). Merge sonrası şef: mcp.seogrep.com healthz/tools-list smoke + goals tekrar.
(2) **T0 KOORDİNE SECRET ROTASYONU** (en öncelikli; kod-dışı, dalı beklemez): runbook
    `docs/runbooks/secret-rotation.md` — 6 secret (service_role/sb_secret · DB şifresi[5432 session pooler] ·
    Google secret · TOKEN_ENCRYPTION_KEY[gsc_connections=0→bedava, Netlify+Fly AYNI değer] · DataForSEO şifresi ·
    smoke key sg_9wYke…). DEĞERLER İNSANDA KALIR (chat'e YAPIŞTIRMA — geçen sefer bu audit CRITICAL'ıydı).
    Şef yalnız adım listesi verir + flyctl secrets list digest-değişimi + canlı smoke ile doğrular; kanıt ledger'a.
(3) **T9 KARARI (İNSANA SORULACAK — kod yok karar yok):** research_keywords beta duruşu —
    A) DFS_LIVE aç + bütçe sayacını /tmp'den DB tablosuna taşı (migration akışı: işçi SQL→hakem→şef cloud-apply)
    B) kapalı kalsın (dürüst "not yet enabled" hatası sürer). ŞEF ÖNERİSİ: B (beta), A erken-Faz-4.
    Detay: scratchpad T9-research-keywords-decision.md (özeti PLAN'da).
(4) **Faz 4 go/no-go** (audit raporu + bu kapanış kanıtları yan yana). Faz 4 planı go'dan SONRA.
    Faz 4 aday backlog: ledger "FAZ 4 ADAY BACKLOG" (1-12) + audit G-tablosu (G4/G5/G7/G8/G10/G11 vb.).

DİĞER İNSAN KUYRUĞU (audit + önceki): repo PRIVATE · OAuth verification başvurusu · Supabase leaked-password
WARN(1-tık) · fiyat stratejisi oturumu(Faz 4 öncesi, kullanıcı istedi) · kalibrasyon v0 KALSIN(öneri).
Acceptable-for-beta minor'lar (Faz-4 follow-up, ledger'da): /status throttle · pre-discovery robots · vb.

ORTAM: bu dilimde şef Fable (ana oturum) + hakemler TAZE Fable (erişilebilir — sapma yok; Opus 4.8
işçilerde). Push/rm/curl-POST/consent/DB-mutasyon gate'li (insan kapısı); flyctl secrets set/list şefe
açık; curl-GET serbest. Portlar: dev 3457 · mcp 3458 · Supabase lokal 553xx (skala 543xx DOKUNMA).
UI copy İngilizce (ders #4). PSEO hook (bayder) İLGİSİZ. Not: repo'da untracked .agents/.codex/AGENTS.md +
codex-audit-*.md var (paralel aktivite, BU DİLİME AİT DEĞİL — merge'e katma).

İLK MESAJINDA: durum özeti; dalın merge durumunu gh ile teyit et; merge OLMADIYSA insana push+merge+
DELETE-BRANCH hatırlat + T0 rotasyonu başlatmayı öner + T9 kararını sor; merge OLDUYSA smoke+goals koş.
Faz 4 planını YAZMA (go kararından sonra). Context %90'da aynı formatta yeni handoff yaz.
```
