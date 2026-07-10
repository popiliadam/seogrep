# goal: repo-clean
created: 2026-07-10
kaynak: Faz 0 kickoff — kapı her zaman yeşil kalır.

## predicate
```predicate
bash guardrails/verify.sh
```

## on-violation
Şüpheliler: son 5 commit (`git log --oneline -5`), bağımlılık güncellemeleri, node sürümü.
Runbook: hangi turbo task'ının kırıldığını bul → ilgili paket dizininde tek başına çalıştır → düzeltmeyi ayrı commit'le. Otomatik düzeltme YOK — rapor et.
