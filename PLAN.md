# PLAN.md — Canlı Durum

> Şef her oturuma buradan başlar. Format: faz · biten · sıradaki 3 iş · blokajlar · insan kuyruğu.
> Master spec: `docs/specs/2026-07-pseo-saas-design.md` · Faz 0 planı: `docs/plans/2026-07-10-faz0-system-setup.md`

## Faz: 0 — TAMAMLANDI (2026-07-10) → Faz 1'e hazır

## Biten
- Task 1-7: monorepo iskeleti (apps/web, apps/mcp, packages/core+db), anayasa (CLAUDE.md 55 satır),
  contract.md, verify-change skill, kapı (guardrails/verify.sh — VERIFY: PASS, 16/16 task),
  kalıcı hedefler (repo-clean ✓, no-secrets ✓), Makefile, CI workflow.
  Ledger: `.superpowers/sdd/progress.md` (tüm hakem incelemeleri temiz; commit zinciri 95795c7..b1a3564).
- Task 8: GitHub private repo https://github.com/popiliadam/pseo-saas + push + final whole-branch review
  (N1 cold-checkout fix'i taze-klon kanıtıyla kapandı) + marka shortlist (7 müsait .app adayı sunuldu).
- Devreden bulgular (ledger FAZ 0 kapanış satırı): engines>=22, CI `permissions:` bloğu,
  allowBuilds key teyidi → Faz 1 · /health routing → Faz 3 · test-typecheck uniformity → kozmetik.

## Sıradaki 3 iş (Faz 1 — vitrin + docs + waitlist)
1. **Landing + pricing + how-it-works** (marka seçimi sonrası; frontend-design skill ile).
   done_when: (1) verify.sh yeşil, (2) local prod build'de Lighthouse perf/a11y/SEO ≥ 90 (lhci kanıtı),
   (3) h1/copy gerçek markayla, uydurma metrik yok.
2. **Docs hub v1** (Fumadocs): concepts + getting-started iskeleti + 3 recipe taslağı. Tool referansı YOK (Faz 3).
   done_when: (1) verify.sh yeşil, (2) /docs route'ları build'de statik üretiliyor, (3) nav yapısı spec §4 ile birebir.
3. **Waitlist** (form + Resend/DB kaydı + PostHog event).
   done_when: (1) verify.sh yeşil, (2) test e-postası kayıt id'siyle doğrulanıyor, (3) PostHog'da waitlist_signup event'i.

## Marka (KARAR — 2026-07-10)
**Ranklens** · domain: **ranklens.app** (RDAP müsait doğrulandı; satın alma insanda).
Repo rename edildi: https://github.com/popiliadam/ranklens (eski pseo-saas URL'i redirect).
Landing konsept çekirdeği: "Point a lens at your site" — analiz çekirdeği (v1) konumlandırmasıyla örtüşür.

## Blokajlar
- Domain satın alma (insan): ranklens.app — registrar önerisi: Cloudflare Registrar (at-cost) veya Porkbun.
- Vercel deploy (Faz 1 sonu insan kapısı): Vercel hesabı bağlama + DNS, domain alınınca.

## İnsan kuyruğu
- ranklens.app satın al.
- `git push` gate onayı: `/pseo-approve sess-<session> git_push "origin"` (veya push'u elle at) — son docs commit'leri lokal.
- Faz 1 canlıya çıkınca: Paddle hesap başvurusu (canlı site ister — en uzun bekleme).
- Faz 2 başında: Google Cloud projesi + OAuth consent başvurusu (doğrulama haftalar sürer).

## Oturum devir notu (HANDOFF — fresh session bunu aynen alsın)
```
Proje: Ranklens — hosted SEO MCP SaaS. Dizin: "/Users/apple/dev/pseo web saas"
Sırayla oku: PLAN.md → CLAUDE.md → contract.md (+ master spec docs/specs/2026-07-pseo-saas-design.md §7-9).
Durum: Faz 0 kapalı (kapı taze klonda kanıtlı; repo github.com/popiliadam/ranklens).
Marka: Ranklens / ranklens.app (satın alma insanda — copy'de domain'i kullan, DNS işine girme).
Görev: Faz 1'i yürüt — superpowers:writing-plans ile docs/plans/2026-07-XX-faz1-vitrin.md üret
(kapsam ve done_when'ler bu dosyanın "Sıradaki 3 iş" bölümünde; landing copy İngilizce,
uydurma metrik YOK), sonra superpowers:subagent-driven-development ile task task yürüt.
Dispatch: CLAUDE.md DISPATCH tablosu (şef Fable · işçi Opus varsayılan, Sonnet mekanik ·
hakem taze Opus · kapı guardrails/verify.sh). Faz 1 işleri feature branch + PR (güven kuralı:
ilk hafta her PR insan okur; merge insan onayıyla). UI işlerinde verify-change skill + Claude
Browser kanıtı zorunlu. Context %90'a gelince aynı formatta yeni handoff yazıp fresh session'a devret.
```
Güven kuralı hatırlatma: Faz 0 istisnaydı (boş repo'da main'e scaffold); Faz 1'den itibaren branch+PR.
