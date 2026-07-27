# goal: uptime
created: 2026-07-27
kaynak: Faz 4 T-D1 — spec §9 hedefi 'uptime': mcp.seogrep.com harici monitörde + /status sağlıklı.
Evidence dosyası (goals/evidence/uptime-monitor.txt) insan monitör kurulumunun kanıtı; yokken SKIP
(landing-live deseni). SKIP ≠ faz-çıkışı: çıkış kriteri evidence'ın varlığını ayrıca şart koşar
(ders L2 sınıfı maske önlenir).

## predicate
```predicate
[ ! -f goals/evidence/uptime-monitor.txt ] && exit 0
curl -sf --max-time 15 https://mcp.seogrep.com/healthz | grep -q '"ok":true'
curl -sf --max-time 15 https://mcp.seogrep.com/status | grep -q '"ok":true'
```

## on-violation
Şüpheliler: Fly deploy'u / makine durumu (fly status, son deploy), DB (/status'ta `pendingJobs: null`
= backlog okunamıyor; worker'ın düştüğünü MASKELER — reaper sayaçları da donar), harici monitörün
kendisi (hesap/kota/yanlış URL — monitör yanılıyor olabilir).
Runbook: `flyctl logs --app seogrep-mcp` ile 5xx/crash ayrımı → `scripts/monitoring.md` triyajı
(/healthz vs /status, errorsSinceBoot trendi, pendingJobs okuması) → takılı işler için
`scripts/reconciliation.md` (in-worker reaper 10 dk'da bir süpürür; `lastReaperRunAt` bayatsa
süpürme başarısız demektir) → 5xx'te İNSANI UYANDIR (contract.md). Otomatik düzeltme YOK.
