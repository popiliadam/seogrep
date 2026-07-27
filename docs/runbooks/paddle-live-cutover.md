# Paddle LIVE Cutover Runbook (Faz 4 — T-A2)

> Purpose: move payments from Paddle **sandbox** to **live** without violating NEVER #3
> (signature + idempotency proven in live) or NEVER #6 (no price/credit change without
> human approval). Roles: **HUMAN** does everything involving money, external accounts,
> and secret values; **CHIEF (şef)** verifies each step via read-only probes and writes
> the evidence file at the end. Never paste secret values into chat (T0 lesson).
>
> Prerequisite (code): T-A1 merged — server SDK now honors `NEXT_PUBLIC_PADDLE_ENV`.
> Until T-A1 is deployed, do NOT flip the env to `production`.

## 0. Preconditions

- [ ] Paddle **live account onboarding/verification approved** (external process; started
      back in Faz 2 — if still pending, this runbook waits; everything below is live-side).
- [ ] `feat/faz4-launch` branch merged + Netlify deploy green (T-A1 in prod).
- [ ] Human pricing session held (see §3) — outcome recorded even if "no change".

## 1. HUMAN — Paddle dashboard (LIVE mode)

All of this happens in Paddle's **live** dashboard (toggle out of sandbox):

1. Recreate the catalog — 4 products / 6 prices, same amounts as sandbox
   (Starter $19/mo, Pro $49/mo, Agency $149/mo, Top-up $10, $25, $50 — one-time).
   Copy each live `pri_…` id somewhere private (NOT chat).
2. Create a **live API key** with minimum scopes (same scope set as the sandbox key:
   transactions + subscriptions + customer portal sessions).
3. Copy the **live client-side token** (Checkout settings; overlay checkout must be
   enabled — same "Default payment link" trap as sandbox: set it to `https://seogrep.com`).
4. Notifications → add destination `https://seogrep.com/api/paddle/webhook`, events:
   `transaction.completed`, `subscription.created`, `subscription.updated`,
   `subscription.canceled`. Copy the **live webhook secret**.

## 2. HUMAN — Netlify environment (values never in chat)

Update these 10 vars to their LIVE values (Site settings → Environment variables).
**Scope note (recon-proven):** the `NEXT_PUBLIC_PADDLE_PRICE_*` vars are read
**server-side at request time** by the webhook price map (`route.ts:33-52`). They must be
set for the runtime/server context, not only as build-time values — a missing one makes
every purchase fall into the honest-but-noisy `record_only` 500-retry loop (B-C1 path).

```
PADDLE_API_KEY                      = <live api key>
PADDLE_WEBHOOK_SECRET               = <live webhook secret>
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN     = <live client token>
NEXT_PUBLIC_PADDLE_ENV              = production        # the actual cutover switch
NEXT_PUBLIC_PADDLE_PRICE_STARTER    = pri_…             # 6 live price ids
NEXT_PUBLIC_PADDLE_PRICE_PRO       = pri_…
NEXT_PUBLIC_PADDLE_PRICE_AGENCY    = pri_…
NEXT_PUBLIC_PADDLE_PRICE_TOPUP_10  = pri_…
NEXT_PUBLIC_PADDLE_PRICE_TOPUP_25  = pri_…
NEXT_PUBLIC_PADDLE_PRICE_TOPUP_50  = pri_…
```

Then trigger a redeploy (env changes need one). Tell the chief "env updated, deployed" —
no values.

## 3. HUMAN (+chief) — Final pricing session (NEVER #6 gate)

Decide and record (a one-line answer each is enough):

- [ ] Plan prices stay $19 / $49 / $149? Top-ups stay $10/$25/$50?
- [ ] Credit amounts stay 1,000 / 3,500 / 12,000 (+400/1,100/2,400)?
- [ ] Rollover policy (audit E-I1): current live behavior is *more generous than the copy*
      (credits never expire). Choose: (a) keep behavior, soften copy later, or
      (b) implement expiry (separate signed task, kod+docs+pricing together).
      Chief's recommendation: **(a) keep, revisit post-launch.**

If ANY number changes → STOP; that is a separate signed task touching code+docs+pricing
together (NEVER #6). This runbook assumes "no change".

## 4. CHIEF — read-only pre-smoke verification

- `curl -s -o /dev/null -w '%{http_code}' -X POST https://seogrep.com/api/paddle/webhook -d '{}'`
  → must be **401** (signature gate alive, fail-closed).
- Sign in to `/app/billing` (human's browser): plan cards show Buy buttons (client token +
  env resolved), **no "sandbox" badge** visible (badge renders only when env=sandbox).

## 5. HUMAN + CHIEF — live smoke (real money, smallest item)

1. Human buys the **$10 top-up** with a real card on `/app/billing`.
2. Chief verifies (read-only SQL via Supabase MCP):
   - `credit_ledger`: exactly ONE new row `kind='purchase', delta=+400, reason='paddle', ref='txn_…'`.
   - `paddle_events`: the event row has `processed_at` NOT NULL.
   - `/app` balance increased by exactly 400.
3. Human presses **Replay** on the delivered event in Paddle dashboard.
4. Chief re-checks: **still exactly one** ledger row for that `txn_…` ref (idempotency
   proven in LIVE — NEVER #3 evidence).
5. Optional (human's call): refund the $10 in Paddle. Note: refund does NOT auto-adjust
   the ledger (no handler for it — known, honest); if refunded, chief proposes a manual
   `adjust` ledger entry for human approval, or the credits simply stand.

## 6. CHIEF — evidence + goal flip

- Write `goals/evidence/purchase-flow-live.txt`: date + `txn_…` ref + "replay produced no
  second grant" (no secrets).
- `PROD_URL=https://seogrep.com make goals` → `purchase-flow-live` now runs its full
  predicate and must PASS.
- Ledger + PLAN.md updated with the cutover record.

## Rollback

Set `NEXT_PUBLIC_PADDLE_ENV=sandbox` + restore sandbox keys/prices in Netlify, redeploy.
The webhook keeps rejecting live-signed events once the secret is swapped back (401 —
fail-closed), and unprocessed live events remain replayable after re-cutover
(`processed_at NULL` retry semantics). No code change needed in either direction.

## Failure triage

| Symptom | Likely cause | Fix |
|---|---|---|
| Purchase succeeds in Paddle, balance unchanged, webhook deliveries show 500 retries | a `NEXT_PUBLIC_PADDLE_PRICE_*` missing/mismatched in server env (record_only path) | fix env, redeploy, press Replay — heal-window grants exactly once |
| Buy buttons missing | client token or env var unresolved (`configured` fail-closed) | check the 3 `NEXT_PUBLIC_*` vars + redeploy |
| Webhook 401 on real events | wrong `PADDLE_WEBHOOK_SECRET` (live vs sandbox mix) | re-copy live secret, redeploy |
| Portal link errors | `PADDLE_API_KEY` scope or env mismatch (server SDK now live-aware via T-A1) | verify key scopes + `NEXT_PUBLIC_PADDLE_ENV=production` |
