# goal: uptime
created: 2026-07-27
kaynak: Faz 4 T-D1 — spec §9 hedefi 'uptime': mcp.seogrep.com harici monitörde + /status sağlıklı.
Evidence dosyası (goals/evidence/uptime-monitor.txt) insan monitör kurulumunun kanıtı; yokken SKIP
(landing-live deseni). SKIP ≠ faz-çıkışı: çıkış kriteri evidence'ın varlığını ayrıca şart koşar
(ders L2 sınıfı maske önlenir).

## predicate
```predicate
[ ! -f goals/evidence/uptime-monitor.txt ] && exit 97
curl -sf --max-time 15 https://mcp.seogrep.com/healthz | grep -q '"ok":true'
curl -sf --max-time 15 https://mcp.seogrep.com/status | grep -q '"ok":true'
```

## on-violation
Şüpheliler: Fly deploy'u / makine durumu (fly status, son deploy), DB (/status'ta `pendingJobs: null`
= backlog okunamıyor; worker'ın düştüğünü MASKELER), harici monitörün kendisi (hesap/kota/yanlış URL —
monitör yanılıyor olabilir).
Runbook: `flyctl logs --app seogrep-mcp` ile 5xx/crash ayrımı → `scripts/monitoring.md` triyajı
(/healthz vs /status, errorsSinceBoot trendi, pendingJobs okuması) → takılı işler için
`scripts/reconciliation.md`. NOT: reaper worker process'inde koşar ve worker HTTP dinlemez; bu yüzden
`/status` reaper sayaçlarını ARTIK HİÇ TAŞIMIYOR (L-02 — daha önce daima `0 / 0 / null` gösteriyor,
ölçülmemiş bir sayıyı ölçülmüş gibi sunuyordu). Reaper canlılığı yalnız
`flyctl logs --app seogrep-mcp | grep 'reaper sweep'` ile doğrulanır (~10 dk'da bir satır).
→ 5xx'te İNSANI UYANDIR (contract.md). Otomatik düzeltme YOK.
