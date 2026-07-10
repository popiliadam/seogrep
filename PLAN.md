# PLAN.md — Canlı Durum

> Şef her oturuma buradan başlar. Format: faz · biten · sıradaki 3 iş · blokajlar · insan kuyruğu.
> Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Faz 0 planı: `docs/plans/2026-07-10-faz0-system-setup.md`

## Faz: 0 — TAMAMLANDI (2026-07-10) → Faz 1'e hazır

## Biten
- Task 1-7: monorepo iskeleti (apps/web, apps/mcp, packages/core+db), anayasa (CLAUDE.md 55 satır),
  contract.md, verify-change skill, kapı (guardrails/verify.sh — VERIFY: PASS, 16/16 task),
  kalıcı hedefler (repo-clean ✓, no-secrets ✓), Makefile, CI workflow.
  Ledger: `.superpowers/sdd/progress.md` (tüm hakem incelemeleri temiz; commit zinciri 95795c7..b1a3564).
- Task 8: GitHub private repo (popiliadam/pseo-saas) + push + final whole-branch review + marka shortlist.

## Sıradaki 3 iş (Faz 1 — vitrin + docs + waitlist)
1. **Landing + pricing + how-it-works** (marka seçimi sonrası; frontend-design skill ile).
   done_when: (1) verify.sh yeşil, (2) local prod build'de Lighthouse perf/a11y/SEO ≥ 90 (lhci kanıtı),
   (3) h1/copy gerçek markayla, uydurma metrik yok.
2. **Docs hub v1** (Fumadocs): concepts + getting-started iskeleti + 3 recipe taslağı. Tool referansı YOK (Faz 3).
   done_when: (1) verify.sh yeşil, (2) /docs route'ları build'de statik üretiliyor, (3) nav yapısı spec §4 ile birebir.
3. **Waitlist** (form + Resend/DB kaydı + PostHog event).
   done_when: (1) verify.sh yeşil, (2) test e-postası kayıt id'siyle doğrulanıyor, (3) PostHog'da waitlist_signup event'i.

## Blokajlar
- **Marka seçimi (insan kapısı):** shortlist sunuldu, kullanıcı seçimi bekleniyor. Landing copy + domain buna bağlı.
- Vercel deploy (Faz 1 sonu insan kapısı): Vercel hesabı bağlama + DNS, marka netleşince.

## İnsan kuyruğu
- Marka seç (shortlist raporda) → domain satın al.
- Faz 1 canlıya çıkınca: Paddle hesap başvurusu (canlı site ister — en uzun bekleme).
- Faz 2 başında: Google Cloud projesi + OAuth consent başvurusu (doğrulama haftalar sürer).

## Oturum devir notu (handoff)
Yeni oturum şunu okusun: bu dosya + CLAUDE.md + contract.md + master spec §7-9.
Faz 1'i başlatmak için: superpowers:writing-plans ile `docs/plans/*faz1*.md` üret,
subagent-driven-development ile yürüt (dispatch: CLAUDE.md DISPATCH tablosu).
Güven kuralı: ilk hafta — her PR insan okur; Faz 1 işleri feature branch + PR ile yürür (Faz 0 istisnaydı: boş repo'da main'e scaffold).
