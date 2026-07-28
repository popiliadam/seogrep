# goal: purchase-flow-live
created: 2026-07-27
kaynak: Faz 4 T-G1 — spec §9 hedefi 'purchase-flow-live': ürün CANLI (Paddle live) ödeme alıyor.
İki katman: (1) canlı webhook imza kapısı fail-closed AYAKTA (imzasız POST daima 401 — NEVER#3'ün
her koşuda makine-kontrollü yüzü); (2) insan+şef canlı smoke kanıtı (goals/evidence/purchase-flow-live.txt:
gerçek txn ref + Replay-idempotency notu — docs/runbooks/paddle-live-cutover.md §5-6). Evidence yokken
2. katman SKIP (landing-live deseni); SKIP ≠ faz-çıkışı — çıkış kriteri evidence'ın varlığını ayrıca şart
koşar (ders L2 sınıfı maske önlenir). PROD_URL unset'te tümü SKIP.

## predicate
```predicate
[ -z "${PROD_URL:-}" ] && exit 3
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$PROD_URL/api/paddle/webhook" -H 'content-type: application/json' -d '{}')" = "401" ]
[ ! -f goals/evidence/purchase-flow-live.txt ] && exit 3
grep -q "txn_" goals/evidence/purchase-flow-live.txt
```

## on-violation
Şüpheliler: PADDLE_WEBHOOK_SECRET/PADDLE_API_KEY deploy env'i (401 yerine 500 = fail-closed guard secret
eksik demektir; 200 = İMZA KAPISI DÜŞMÜŞ, ÇOK CİDDİ), Netlify deploy, webhook route diff'i.
Runbook: 401 değilse docs/runbooks/paddle-live-cutover.md "Failure triage" tablosu → scripts/paddle-smoke.md
troubleshooting; 200 dönüyorsa İNSANI UYANDIR (imza doğrulaması bypass = NEVER#3 ihlali şüphesi).
Evidence dosyası eksikse cutover §5-6 (insan canlı smoke) henüz koşmamış demektir — hata değil, bekleyen
insan adımı. Otomatik düzeltme YOK.
