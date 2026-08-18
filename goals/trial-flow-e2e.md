# goal: trial-flow-e2e
created: 2026-07-20
kaynak: Faz 3 T16 — trial hesabın akışı uçtan uca: kayıt→key (insan adımı, MCP_SMOKE_URL bunun
kanıtı) → auth → tool yüzeyi 26/26 → ledger'dan bakiye okunuyor. Bu predicate PARASIZ ince dilimdir
(get_credit_balance 0 kredi); tam paralı zincir (crawl→audit→rapor) gerçek-client kanıtı olarak
PLAN'a işlenir. MCP_SMOKE_URL set değilken SKIP (landing-live deseni).

## predicate
```predicate
[ -z "${MCP_SMOKE_URL:-}" ] && exit 97
[ "$(curl -sf --max-time 20 -X POST "$MCP_SMOKE_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"inputSchema"' | wc -l | tr -d ' ')" = "26" ]
curl -sf --max-time 20 -X POST "$MCP_SMOKE_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_credit_balance","arguments":{}}}' | grep -qiE 'balance|credits'
```

## on-violation
Şüpheliler: registry değişikliği (26-tool pin kırıldıysa docs-schema-sync de bakar), auth yolu, credit_balances view, revoke edilmiş smoke key.
Runbook: tools/list sayısı ≠26 ise son merge'ün tool diff'ine bak → get_credit_balance hatasıysa fly logs + Supabase advisors → ledger tutarsızlığı şüphesinde İNSANI UYANDIR (contract.md: balance != SUM(ledger)). Otomatik düzeltme YOK.

## pin geçmişi — neden burada duruyor

Bu predicate yüzey sayısını LİTERAL pinler; kastı budur (yeni bir tool, sessizce değil bilinçli
gelsin). Ama pin 2026-07-28'den 2026-08-18'e kadar **19'da kaldı** ve yüzey 19 → 22 → 23 → 26 oldu.
Kimse görmedi çünkü `MCP_SMOKE_URL` yüklü olmayan her koşuda kalem **SKIP** verir ve `make goals`
"16/16 PASS" der. İmzalı ders 7'nin tam vakası: env-koşullu SKIP tam ölçüm gibi okundu.

**Bir tool eklediğinde bu satır da güncellenir** — `costs.test.ts` ve `server.test.ts`'in sayı
pinleriyle aynı anda. Onlar CI'da kırmızı verir, bu vermez: yalnız env yüklü bir `make goals`
koşusu görür.
