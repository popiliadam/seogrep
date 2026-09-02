# Runbook — `main` branch protection'ı anayasayla hizala

> Durum: **AÇIK, operatör eylemi bekliyor.** 2026-08-27'de ölçüldü ve payload hazırlandı; uygulama
> bu oturumun izin katmanı tarafından reddedildi (dışa dönük ayar değişikliği).
> İlgili: audit 2026-08-26 **M-03** ve **L-04**

## Ölçüm (2026-08-27, GitHub API)

```
required_approving_review_count : 0      <- anayasa "taze bağlamlı hakem" istiyor
require_code_owner_reviews      : false
require_last_push_approval      : false
dismiss_stale_reviews           : false
required contexts               : gitleaks, verify, verify-db, licenses, static-guards
                                  (lighthouse YOK -> L-04)
strict / enforce_admins         : true / true      (bunlar doğru)
force push / delete             : kapalı           (bunlar doğru)
```

CLAUDE.md'nin DONE mekaniği "taze bağlamlı hakem iş emri + diff üzerinden doğrular" diyor ve
NEVER #10 belirli diff'lerde Fable hakem şart koşuyor. **GitHub bunların hiçbirini zorlamıyordu.**
Zorlama haritasında bu satır YALNIZ PROSE sütunundaydı.

### CLAUDE.md ders 16 ile çelişki — ve ölçüm kimi haklı çıkardı

Ders 16 (2026-08-27 imzalı) "branch protection *eksik*" iddiasını **kapanmış bayat bir iddia**
olarak listeliyor. Ölçüm ikisinin de yarı haklı olduğunu gösterdi:

- **check ekseni kapanmış** ✓ — beş required context, strict, enforce_admins açık.
- **onay ekseni hiç kapanmamış** ✗ — approval count 0.

Yani kapanış, **hangi eksende ölçüldüğü yazılmadan** ilan edilmiş. Bu tam olarak **ders 14**'ün
("delik kalmadı derken HANGİ EKSENİ varyantladığın yazılır") tarif ettiği hata; ders 16 ders 14'ün
ihlali üzerine kurulmuş. Ders 16'nın vaka listesi bu tura göre düzeltildi.

## Uygulama

```bash
gh api -X PUT repos/popiliadam/seogrep/branches/main/protection --input docs/runbooks/branch-protection.json
```

Payload mevcut her ayarı **korur** ve yalnız eksik ekseni ekler:

| alan | önce | sonra | neden |
|---|---|---|---|
| `required_approving_review_count` | 0 | **1** | M-03 — hakem şartını GitHub'a taşır |
| `require_last_push_approval` | false | **true** | son commit'ten SONRA onay: hakem gerçek diff'i görür |
| `dismiss_stale_reviews` | false | **true** | yeni commit eski onayı düşürür — "taze" bağlamın anlamı |
| required contexts | 5 | **6** (`lighthouse`) | L-04 |

### Bilerek yapılmayanlar

- **`advisories` required kontrol DEĞİL.** Job bu PR ile geliyor ve henüz `main`'de yok; şimdi
  zorunlu kılmak, hiç koşmamış bir kontrolü bekleyerek **her PR'ı kilitler**. Bu PR merge olduktan
  SONRA `contexts` listesine eklenmeli.
- **`required_linear_history` false BIRAKILDI.** `qa-loop.md`: gitleaks çalışma ağacını değil git
  GEÇMİŞİNİ tarar ve `.gitleaksignore` parmak izleri squash/rebase ile geçersizleşir. Linear history
  zorunlu kılmak, o parmak izlerini taşıyan dalların merge'ini kırardı.
- **`require_code_owner_reviews` false BIRAKILDI.** Depoda `CODEOWNERS` yok; onu açmak hiçbir
  onaylayıcısı olmayan bir kural üretir.

## Doğrulama

```bash
gh api repos/popiliadam/seogrep/branches/main/protection --jq '{approvals: .required_pull_request_reviews.required_approving_review_count, last_push: .required_pull_request_reviews.require_last_push_approval, stale: .required_pull_request_reviews.dismiss_stale_reviews, checks: .required_status_checks.contexts}'
```

Beklenen: `approvals: 1`, `last_push: true`, `stale: true`, ve contexts'te `lighthouse`.

## Uyarı

Bu ayar açıldıktan sonra **bu PR de bir onay ister**. Kasıtlı: anayasa zaten bu diff için taze bir
hakem şart koşuyor (NEVER #10: toplam diff >400 satır → hakem her durumda Fable).
