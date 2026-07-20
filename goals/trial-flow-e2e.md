# goal: trial-flow-e2e
created: 2026-07-20
kaynak: Faz 3 T16 — trial hesabın akışı uçtan uca: kayıt→key (insan adımı, MCP_SMOKE_URL bunun
kanıtı) → auth → tool yüzeyi 16/16 → ledger'dan bakiye okunuyor. Bu predicate PARASIZ ince dilimdir
(get_credit_balance 0 kredi); tam paralı zincir (crawl→audit→rapor) gerçek-client kanıtı olarak
PLAN'a işlenir. MCP_SMOKE_URL set değilken SKIP (landing-live deseni).

## predicate
```predicate
[ -z "${MCP_SMOKE_URL:-}" ] && exit 0
[ "$(curl -sf --max-time 20 -X POST "$MCP_SMOKE_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"inputSchema"' | wc -l | tr -d ' ')" = "16" ]
curl -sf --max-time 20 -X POST "$MCP_SMOKE_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_credit_balance","arguments":{}}}' | grep -qiE 'balance|credits'
```

## on-violation
Şüpheliler: registry değişikliği (16-tool pin kırıldıysa docs-schema-sync de bakar), auth yolu, credit_balances view, revoke edilmiş smoke key.
Runbook: tools/list sayısı ≠16 ise son merge'ün tool diff'ine bak → get_credit_balance hatasıysa fly logs + Supabase advisors → ledger tutarsızlığı şüphesinde İNSANI UYANDIR (contract.md: balance != SUM(ledger)). Otomatik düzeltme YOK.
