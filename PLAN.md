# PLAN.md — Canlı Durum

> Şef her oturuma buradan başlar. Format: faz · biten · sıradaki 3 iş · blokajlar · insan kuyruğu.
> Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Faz 0: `docs/plans/2026-07-10-faz0-system-setup.md` · Faz 1: `docs/plans/2026-07-10-faz1-vitrin.md`

## Faz: 1 — KOD TAMAM (2026-07-11) → insan kapıları bekliyor (push/PR/merge + deploy)

## Biten (Faz 1 — tümü hakem onaylı + kapı yeşil; ledger: `.superpowers/sdd/progress.md`)
- **İş A — Landing + /pricing + /how-it-works (+ /terms /privacy taslak):** Lighthouse (lokal prod, Next 16, port 4517)
  / 0.99/1.0/1.0 · /pricing 0.99/1.0/1.0 · /how-it-works 0.99/1.0/1.0. Copy İngilizce, Ranklens markalı, uydurma metrik yok
  (chat demo "Illustrative example" etiketli); spec §3 rakamları bayt-bayt + testle pinli (top-up + kredi maliyetleri dahil).
- **İş B — Docs hub v1 (Fumadocs v16):** 20 /docs route'u build'de statik (prerender-manifest kanıtlı); nav spec §4 birebir
  (Tools Reference bilinçli yok — Faz 3'te zod şemadan otomatik); 5 client kurulum sayfası + 4 concept + 3 recipe + 4 üst sayfa;
  MCP URL daima `YOUR_MCP_URL` placeholder.
- **İş C — Waitlist:** packages/core port/adapter (Resend contact + PostHog capture, fetch-tabanlı, fixture testli, 15 test);
  /api/waitlist (honeypot + null-body guard + dev memory fallback); form landing'de 2 yerde; browser kanıtı: submit → success
  state + server log `POST /api/waitlist 200`. Gerçek anahtar kanıtı için `pnpm waitlist:smoke` hazır (anahtar insanda).
- **Hijyen + sistem:** engines>=22 · CI `permissions: contents: read` · allowBuilds pnpm 11'de doğru anahtar (teyitli).
  goals/: `lighthouse-90`, `landing-live` (deploy öncesi SKIP), `waitlist-works`, `docs-static` eklendi — **6/6 hedef PASS** (2026-07-11).
- **Sanctioned sapma:** Next.js 15.3 → **16.2.10** (fumadocs-ui@16 hard peer; kod migrasyonu sıfır, hakem doğruladı,
  Lighthouse Next 16'da yeniden kanıtlı). Faz 2 notu: Next 16'da `middleware.ts` → `proxy.ts`; Turbopack default.
- **QA zinciri:** 7 task + final whole-branch review (taze Fable) + fix dalgası (8 kalem) + re-review = **merge-ready**.
  Branch yığını (stacked): `feat/faz1-hygiene` → `feat/faz1-waitlist` → `feat/faz1-landing` → `feat/faz1-pages` → `feat/faz1-docs` (tip).

## Sıradaki 3 iş
1. **PR'ları aç + insan merge'i** (push insan onayı gelince — aşağıda komutlar). Merge sırası PR1→PR5.
2. **Vercel deploy (insan kapısı):** hesap bağla + apps/web deploy + env'e gerçek `RESEND_*`/`POSTHOG_*` anahtarları;
   sonra `pnpm waitlist:smoke` ile İş C'nin gerçek kanıtı (Resend contact id + PostHog event) + `PROD_URL` set edip
   `make goals` (landing-live aktifleşir). Deploy sonrası Paddle başvurusu (canlı site ister).
3. **Faz 2 planı:** superpowers:writing-plans ile `docs/plans/2026-07-XX-faz2-auth-para.md`
   (Supabase Auth+RLS, DB şema+migrations, kredi defteri property test, api_keys+kişisel MCP URL, dashboard, Paddle sandbox,
   Resend transactional, PostHog funnel — spec §9 Faz 2). Dikkat: Next 16 `proxy.ts` konvansiyonu; plan pinlerinde peer-uyum kontrolü.

## Blokajlar
- `git push` outward_action_gate'te — onay: `/pseo-approve sess-21b253e5 git_push "origin <branch>"` (session'a özel) ya da insan elle push'lar.
- ranklens.app satın alma (insan) → Vercel DNS → landing-live hedefi.
- Resend + PostHog hesap/anahtarları (insan, ücretsiz tier yeter): Resend API key + Audience ID; PostHog project key (EU host seçili).

## İnsan kuyruğu
1. ranklens.app satın al (Cloudflare Registrar / Porkbun).
2. Push onayı ver VEYA elle push:
   `git push origin main && git push -u origin feat/faz1-hygiene feat/faz1-waitlist feat/faz1-landing feat/faz1-pages feat/faz1-docs`
   (main 2 docs commit'i önde — önce main push'u PR diff'lerini temizler.)
3. PR'ları aç (push sonrası şef de açabilir) — stacked, merge sırası 1→5:
   PR1 hygiene→main · PR2 waitlist→hygiene · PR3 landing→waitlist · PR4 pages→landing · PR5 docs→pages.
   Güven kuralı: ilk hafta her PR insan okur; merge insan onayıyla. Not: CI bu branch'lerde henüz koşmadı (push gate'i) — tüm kanıt lokal+ledger.
4. Resend + PostHog hesapları → anahtarlar `.env` + Vercel env → `pnpm waitlist:smoke test@adresin.com`.
5. Waitlist canlanmadan önce karar: /api/waitlist rate-limit (şu an yalnız honeypot; anahtar yokken prod 503 zaten).
6. Compost önerisi (imza bekliyor, CLAUDE.md'ye yazılmadı): "Plan bağımlılık pinleri dispatch'ten önce peer-uyumluluk kontrolünden geçer"
   (Next 16 olayının dersi).

## Marka (KARAR — 2026-07-10)
**Ranklens** · domain: **ranklens.app** (RDAP müsait; satın alma insanda). Repo: https://github.com/popiliadam/ranklens

## Oturum devir notu (HANDOFF — fresh session bunu aynen alsın)
```
Proje: Ranklens — hosted SEO MCP SaaS. Dizin: "/Users/apple/dev/pseo web saas"
Sırayla oku: PLAN.md → CLAUDE.md → contract.md (+ master spec docs/specs/2026-07-pseo-saas-design.md §7-9).
Durum: Faz 1 KOD TAMAM (5'li stacked branch, tip: feat/faz1-docs; final Fable review + fix dalgası + re-review = merge-ready;
6/6 goal PASS). Push/PR/merge + Vercel deploy + Resend/PostHog anahtarları İNSAN kapısında (PLAN.md insan kuyruğu).
Görev: (a) push onayı gelmişse PR'ları aç ve insan merge'ini bekle; (b) deploy sonrası waitlist smoke + landing-live hedefi;
(c) Faz 2 planını superpowers:writing-plans ile üret (docs/plans/2026-07-XX-faz2-auth-para.md, spec §9 Faz 2;
Next 16: middleware yerine proxy.ts; plan pinlerine peer-uyum kontrolü ekle), sonra superpowers:subagent-driven-development ile yürüt.
Dispatch: CLAUDE.md DISPATCH tablosu (şef Fable · işçi Opus varsayılan, Sonnet mekanik · hakem taze Opus,
ledger/webhook/auth/RLS diff'inde ve >400 satır task'ta taze Fable · kapı guardrails/verify.sh).
UI işlerinde verify-change + Claude Browser kanıtı zorunlu (dev server port 3457 — 3000'i Docker tutuyor).
Context %90'a gelince aynı formatta yeni handoff yazıp fresh session'a devret.
```
