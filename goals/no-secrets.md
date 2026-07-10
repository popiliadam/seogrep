# goal: no-secrets
created: 2026-07-10
kaynak: Faz 0 kickoff — repo'da hiçbir zaman secret bulunmaz.

## predicate
```predicate
gitleaks detect --source . --no-banner
```

## on-violation
Şüpheliler: yeni eklenen config/env dosyaları, test fixture'ları.
Runbook: gitleaks çıktısındaki dosya+satırı incele → gerçek secret ise DERHAL insanı uyandır (rotate gerekir) → false positive ise .gitleaksignore'a gerekçeli satır ekle. Otomatik düzeltme YOK.
