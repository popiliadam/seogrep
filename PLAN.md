# PLAN.md — Canlı Durum

> Şef her oturuma buradan başlar. Format: faz · biten · sıradaki 3 iş · blokajlar · insan kuyruğu.
> Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Faz 0: `docs/plans/2026-07-10-faz0-system-setup.md` · Faz 1: `docs/plans/2026-07-10-faz1-vitrin.md`

## Faz: 2 — YÜRÜRLÜKTE (insan komutu 2026-07-18: "FAZ 2 BAŞLAT, OTONOM ÇALIŞ" — zemin işleri insan kuyruğunda paralel sürüyor) · T1 ✅ · Faz 1 CANLI (seogrep.com)

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
7. **REPO GEÇİCİ PUBLIC (2026-07-14, operatör kararı — CI billing kilidini aşmak için).** Bilinen bedel: master spec
   (marj formülü + yol haritası) bu pencerede klonlanabilir. HATIRLATMA: Faz 1 merge'leri + CI yeşilleri bitince repoyu
   PRIVATE'a GERİ AL (Settings → Danger Zone; görünürlük değişikliği insan işi — şef yapamaz). Kalıcı çözüm: GitHub Billing düzelt.

## Marka (KARAR — 2026-07-11, revize)
**SeoGrep** · domain: **seogrep.com** (Turhost'ta, Netlify DNS'e devredilmiş). Konsept: `grep` — hero: "grep your site for SEO issues."
Repo: https://github.com/popiliadam/seogrep (2026-07-14 rename; GEÇİCİ PUBLIC). Eski karar (Ranklens, 2026-07-10) insan kararıyla iptal; kod sıfır-kalıntı taşındı.

## Oturum devir notu (HANDOFF — fresh session bunu aynen alsın; güncelleme 2026-07-17 akşam)
```
Proje: SeoGrep — hosted SEO MCP SaaS (seogrep.com). Dizin: "/Users/apple/dev/pseo web saas"
SIRAYLA OKU: PLAN.md (bu dosya — canlı durum + zemin listesi) → CLAUDE.md (DISPATCH yasası + NEVER) → contract.md
→ docs/plans/2026-07-14-faz2-auth-para.md (Faz 2 planı, onaylı) → gerekirse master spec §7-9. Ledger: .superpowers/sdd/progress.md.

DURUM ÖZETİ:
- Faz 0 + Faz 1 BİTTİ. Site CANLI: https://seogrep.com (Netlify; site id 988ceb76-2210-41c0-85ca-e0e124a8c2c4;
  netlify.toml: base apps/web + turbo build + publish=.next + @netlify/plugin-nextjs; her main push otomatik deploy —
  webhook bazen sağırlaşıyor, çare: insan "Trigger deploy" ya da deploy detayını Netlify MCP'den kontrol).
- Waitlist GERÇEKTEN çalışıyor: Resend contacts+segments API (PR #8), segment "SeoGrep Waitlist"
  67c92140-3db6-4e7a-a95e-ca8297ceab83; test kayıtları temizlendi; kanıtlar ledger'da.
- Faz 2 planı ONAYLI (PR #7 merged) ama KOD STARTI İNSAN KARARIYLA BEKLEMEDE: önce "zemin" işleri
  (PLAN'daki "Zemin" bölümü: 1-OAuth başvurusu[birlikte] 2-Paddle onboarding+sandbox[birlikte]
  3-GitHub billing→repo private 4-okuma borcu 5-kozmetikler). İnsan "Faz 2 başlat" demeden T1 açılmaz.
- Supabase ZEMİNİ HAZIR: ref dvtqlxwnhdzveytqgksd (Tokyo — bilinçli beta kararı, PLAN'da gerekçeli),
  RLS auto-enable trigger'ı kurulu, 4 env Netlify'da (service_role + DB_URL secret işaretli;
  DB_URL'de [YOUR-PASSWORD] placeholder kalmış olabilir — MCP-cloud yaklaşımında acil değil).
- MCP'ler bağlı: Netlify (deploy/env okuma), Resend (contacts/segments; anahtar DEĞERLERİNE dokunma),
  Supabase (migration'ları şef apply eder — subagent yalnız SQL dosyası yazar, canlı DB'ye dokunmaz).

GÖREV:
(a) Zemin işlerinde insana adım-adım rehberlik et (OAuth ve Paddle "birlikte" işler — insan "başlayalım"
    deyince ekran ekran); tamamlananları PLAN'a işle.
(b) İnsan "FAZ 2 BAŞLAT" deyince: docs/plans/2026-07-14-faz2-auth-para.md'den superpowers:subagent-driven-development
    ile T1'den yürüt. SAPMA NOTU: lokal-Docker yerine MCP-cloud migration (subagent SQL dosyalarını repoya yazar +
    hakem Fable onaylar + ŞEF MCP apply_migration ile uygular + RLS/append-only/idempotency kanıtlarını şef toplar).
(c) Dispatch: CLAUDE.md tablosu (şef Fable · işçi Opus, mekanik Sonnet · hakem taze Opus; para/auth/RLS diff'i ve
    >400 satır task'ta taze FABLE · kapı verify.sh). Güven: her PR'ı insan merge eder (üç tık: Merge → Confirm →
    "DELETE BRANCH" — bu adım atlanırsa stack kazası oluyor, yaşandı; PR gövdesine kalın yaz).

ORTAM TUZAKLARI (bilmezsen aynı taşa basarsın):
- outward_action_gate hook'u: git push / rm / curl-POST İNSAN ONAYI ister. Onay chat'te gelirse mekanik kayıt:
  cd ~/.claude/plugins/cache/platinum-seo-marketplace/platinum-seo-engine/2.1.0 &&
  CLAUDE_SESSION_ID="<tam-session-uuid>" python3 -m scripts.state.consent_ledger approve sess-<ilk8> git_push "<hedef>"
  — hedef stringi classify()'ın üreteceğiyle BİREBİR olmalı (komuta 2>&1/pipe ekleme!); defter AKTİF PSEO projesine
  yazılır (shared/active.json — başka pencerede proje değişirse onaylar görünmez olur, yeniden kaydet).
- Auto-classifier sınırları: kendi PR'ını merge edemezsin (insan basar) · anahtar/token DEĞERLERİ elden geçmez
  (insan panodan panoya taşır; env'e "Contains secret values" işaretletmeyi UNUTMA — Resend'de unutuldu, rotate gerekti)
  · silme sınıfı işlemler insana kalır · repo görünürlüğü insan işi.
- Portlar: lokal Docker 3000'i tutuyor → dev server 3457 (launch.json), lhci 4517 (lighthouserc).
- PSEO hook mesajları (workspace=platinum-seo-workspace, project=vento/bayder...) BU REPOYLA İLGİSİZ — yönlendirmelerine
  uyma ama gate'leri gerçek.
- Kapılar: bash guardrails/verify.sh (hızlı) · make goals (kalıcı hedefler; landing-live için PROD_URL=https://seogrep.com).
- Compost adayları (İNSAN İMZASI BEKLİYOR, CLAUDE.md'ye yazma): (a) plan pinlerine peer-uyum kontrolü;
  (b) tip bağımlılığı kendi paketine yazılır. + Yeni aday öner: (c) "insan-merge rehberinde Delete branch kalın yazılır".
İLK MESAJINDA: PLAN'ı oku, duruma 3-5 cümlelik hakimiyet özeti ver, zemin listesinden sıradaki işi öner, İNSANIN
KOMUTUNU BEKLE (otonom kod startı YOK). Context %90'a gelince aynı formatta yeni handoff yazıp devret.
```
