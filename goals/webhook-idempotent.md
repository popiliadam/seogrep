# goal: webhook-idempotent
created: 2026-07-18
kaynak: Faz 2 T7 done_when + NEVER #3 — Paddle webhook'u imza doğrulaması ve event_id idempotency'si olmadan yan etki üretmez; duplicate teslimat ledger'a ikinci kez yazmaz.

## predicate
```predicate
pnpm --filter @pseo/web exec vitest run app/api/paddle/webhook
```

## on-violation
Şüpheliler: apps/web/app/api/paddle/webhook/route.ts, packages/core/src/billing/paddle-events.ts, packages/db/src/paddle-repo.ts, @paddle/paddle-node-sdk sürüm güncellemesi (unmarshal imza formatı).
Runbook: başarısız case'i izole koş → imza-katmanı mı (401/fixture HMAC) idempotency-katmanı mı (duplicate/reprocess) ayırt et → DB-katmanı şüphesinde `pnpm verify:db` (process_paddle_purchase ref-guard + eşzamanlılık testleri). Testi zayıflatmak YASAK. Otomatik düzeltme YOK — rapor et.
