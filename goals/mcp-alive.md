# goal: mcp-alive
created: 2026-07-20
kaynak: Faz 3 T16 — MCP gateway prod'da ayakta. healthz koşulsuz; initialize+tools/list bir test
hesabının kişisel URL'ini ister (MCP_SMOKE_URL set değilken o kısım SKIP — landing-live deseni).

## predicate
```predicate
curl -sf --max-time 15 https://mcp.seogrep.com/healthz | grep -q '"ok":true'
[ -z "${MCP_SMOKE_URL:-}" ] && exit 0
curl -sf --max-time 20 -X POST "$MCP_SMOKE_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"goal-probe","version":"0.0.1"}}}' | grep -q '"serverInfo"'
curl -sf --max-time 20 -X POST "$MCP_SMOKE_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | grep -q '"whats_next"'
```

## on-violation
Şüpheliler: Fly makineleri (fly status), son deploy, DNS/cert (fly certs check mcp.seogrep.com), revoke edilmiş smoke key.
Runbook: önce healthz'i ayırt et (DNS mi 5xx mi) → fly logs → 5xx ise İNSANI UYANDIR (contract.md). Key 401'i ise dashboard'dan yeni key üret, MCP_SMOKE_URL'i tazele. Otomatik düzeltme YOK.
