# Codex Çapraz-Audit — Remediation Closure Report (2026-07-21)

> Kaynak audit: `docs/audits/2026-07-20-faz0-3-codex-audit-raporu.md` (hüküm: **NO-GO**).
> Yöntem: her bulgu HEAD'e (`feat/faz35-sertlestirme`) karşı 4 paralel taze-Fable denetçi + şef canlı-DB ile
> DOĞRULANDI (Codex snapshot `48c908e` = mid-T1, Faz 3.5'in çoğunu görmedi). Gerçek kod-bug'lar 7 dalgada
> düzeltildi; her dalga taze-Fable hakem-onaylı; final whole-branch review (25 commit, 47f7c74..44e590e)
> **READY TO MERGE = YES** (0 Critical / 0 Important). Kapılar: verify + verify-db + goals **14/14**.

## Özet
- **Düzeltildi (bu remediation, 7 dalga):** 1 Critical (B-C1) + money/security/deploy/docs bulguları.
- **Zaten kapalı / not-a-bug (Codex eski snapshot):** 7 bulgu.
- **Bilinçli ertelendi (Faz 4, belgeli):** A-C1 DNS-rebinding.
- **İnsan-kararı (şef değiştirmedi):** politika/legal/secret/branch-protection.

---

## 1. Düzeltilen gerçek kod-bug'ları

| Bulgu | Sınıf | Düzeltme (dalga) | Kanıt |
|---|---|---|---|
| **B-C1** paid Paddle event kredisiz `processed` | **Critical** | W1: `transaction.completed`+record_only → 500 + `processed_at` NULL (retryable heal-window); non-transaction → 200 korundu | webhook test flip; healing-retry single-grant (0007 advisory-lock+NOT-EXISTS) hakem-teyitli |
| B-I2 atomic `claim_trial` prod'da kullanılmıyor | Important | W1: `grantTrialCredits` → tek RPC (upsert+lock+grant, all-or-nothing) | locked-but-creditless penceresi kapandı; C-I1d dead-mock kapandı |
| B-I3 commit-sonrası sonuç-kaybı sessiz | Medium | W1: post-commit `completeJob`-fail → dürüst string + runbook §2d/§2e | charge stands, no-release; §2e paid-unattributed detection |
| B-I4 DB ledger şekil-invariant'ı zorlamıyor | Important | W2 (0011): 6 named CHECK (spend_commit=0, sign checks, spend_*⇒reserve_id) | canlı pre-check 0-violation/24-satır; RPC şekilleriyle tutarlı |
| B-I1 aynı-job çift-reserve mümkün | Medium | W2 (0011): partial unique idx (job_id) WHERE spend_reserve + worker atomic CAS claim | fund-2× test index'le reddi kanıtlı |
| C-I1(b,c,d) test yanlış-davranış pinliyor | Important | W1/W2: webhook flip + fund-2× + claim_trial mock | üçü de doğru-kontrata çevrildi |
| A-I5 RLS negatifleri 6 tabloyu kapsamıyor | Important | W3: authenticated A/B negatif (users_profile/projects/subscriptions/jobs/gsc_connections/events) + paddle_events service-only | gerçek RLS yolu (JWT client), app-filter değil |
| C-I3 append-only mutation regresyon-testi yok | Important | W3: credit_ledger UPDATE/DELETE service-role reddi + `goals/append-only-armor.md` | armor-agnostic; RED-when-stripped |
| A-I3 gitleaks tüm test dosyalarını kör-nokta | Minor | W4: blanket path allowlist → 3 fixture value-regex | gerçek-secret test'te artık yakalanır (demo) |
| A-I4 redirect origin canonical değil | Minor–Imp | W4: internal 302'ler WEB_BASE_URL'den; spoofed-Host testleri | OAuth redirect_uri zaten canonical'dı |
| C-S1 raw report sink CSP'siz | Hardening | W4: `/r/*` CSP `script-src 'none'` | browser: injected script bloklu, render intact |
| D-I2 web-supabase env negatif-testsiz | Important | W5: bare `!` → throwing guards + 20 negatif test (lesson#5) | eksikte throw kanıtlı; NEXT_PUBLIC inline korundu |
| D-I1 deploy path Docker-girdilerini kaçırıyor | Important | W5: 6 root build-input eklendi | silent prod-stale kapandı |
| D-I3 CI action/image pinleri mutable | Medium | W5: 4 action SHA-pin (GitHub-teyitli) + node digest-pin + turbo devDep | dlx residual belgeli |
| E-I6 docs-gate stale-dist false-PASS | Medium | W6: goal her zaman rebuild-then-check | make goals 14/14 |
| G-I4 GSC `capped` serialize/parse'ta düşüyor | Medium | W6: iki-yönde taşınıyor + round-trip test | report capped-uyarısı artık canlı |
| B-M1 marketing tool-fiyat drift riski | Minor | W6: pricing-drift-guard test (TOOL_COSTS'a pinli) | 20→21 FAIL kanıtlı |
| E-I2/E-I4d/E-I4a/b/c/E-I5 docs-honesty | Important/copy | W6+W7: "per account" · "+schema — 50" (sayı sabit) · "audits instant" · demo real-finding · one-time-URL | copy-only, sayı değişmedi |

## 2. Zaten kapalı / not-a-bug (Codex eski snapshot'ı denetledi)
| Bulgu | Durum |
|---|---|
| A-C1 (crawler guard "wired değil") | **Faz 3.5 T1'de wired** (her fetch yolu); rebinding residual = ayrı, aşağıda |
| A-I2 (invalid-key sınırsız DB lookup) | **T3** — server.ts:322 per-IP throttle DB-lookup öncesi (canlı teyit) |
| B-I5 / G-I1 (open-reserve reconciler / reaper yok) | **T4** — reaper.ts + reconciliation.md + reconcile.mjs |
| C-I1(a) (SSRF testi emission pinliyor) | **T1** — zero-emission'a çevrildi |
| D-MINOR (worker "stub/scale-0" yorumu) | **T2** |
| E-I4c-core (report audit içermiyor) | **T6** |
| A-S1 (rls_auto_enable search_path) | **Canlı-DB SAFE** (SECDEF, search_path=pg_catalog, anon/auth EXECUTE=false) |
| A-I1 (tenant-filter helper imzaları) | **No reachable cross-tenant path** (her id-only helper call-site'ta tenant-gated) |

## 3. Bilinçli ertelenen (Faz 4)
- **A-C1 DNS-rebinding:** temiz kapanış fetch-katmanında IP-pinning ister (undici dispatcher / http.request); undici-paket footgun'ı + 45-test crawler destabilizasyon riski → ayrı Faz-4 dilimi. Important-not-Critical (iki audit); GET-only, gövde tenant'a dönmez; rebinding-DIŞI tüm SSRF zaten bloklu. `ssrf.ts:21-28`'de belgeli.

## 4. İnsan-kapıları (kod-dışı, sırayla)
1. **Dalı push + PR + merge** (Merge→Confirm→**DELETE BRANCH**). 63 commit; iki whole-branch review READY-TO-MERGE + kapılar yeşil.
2. **Migration 0011 cloud-apply** — canlı pre-check 0-violation koşuldu; live-DB apply insan kapısı (classifier gate'i).
3. **T0 koordine secret rotasyonu** — `docs/runbooks/secret-rotation.md` (chat-maruz credentials; değerler insanda).

## 5. İnsan-kararı (şef tek-taraflı değiştirmedi — anayasa)
- **E-I1** rollover/2×cap: davranış promise'ten CÖMERT (kredi hiç expire olmuyor). Karar: expiry-implement (fiyat+eng) VEYA copy-soften. İkisi de fiyat-offer beyanı.
- **E-I3 / G-I2** erasure: "90-gün otomatik silme" + "account deletion removes all" backing'siz (append-only ledger ON DELETE RESTRICT). KVKK/GDPR modeli kararı.
- **F-I1** LICENSE/SBOM: proprietary LICENSE legal-entity ismi ister; third-party notices/SBOM mekanik (karar sonrası). Hosted-only düşük maruziyet.
- **G-I3** DR/incident runbook (Faz 4 ops). **I-I4** branch protection (1-tık owner). **T9** research_keywords/DFS duruşu (şef önerisi: beta'da kapalı, A/erken-Faz-4). **I-I1/2/3/5** süreç.

## 6. GO/NO-GO
Codex NO-GO'su gördüğü snapshot + gerçek **B-C1 money-Critical** için doğruydu — B-C1 artık düzeltildi ve money-review'lı.
Kod-remediation merge + 0011 apply + T0 rotasyon sonrası mühendislik-blocker'ları kapanır; GO için kalan =
insan politika/compliance kararları (E-I1 fiyat-offer dürüstlüğü, E-I3 erasure) + operasyon kapıları. Faz 4 go/no-go İNSANIN.
