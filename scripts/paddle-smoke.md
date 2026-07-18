# Paddle sandbox smoke — human + chef run

The T7 code is proven by fixture tests (`verify` + `verify:db`). This end-to-end pass needs the
real Paddle **sandbox** keys, so it happens once the human has them. Nothing here charges real
money — sandbox uses test cards only. Follow it in order; stop and report if a step diverges.

## 0. Prerequisites
- A Paddle **sandbox** account (dashboard set to Sandbox, not Live).
- One sandbox **product + price** per package: Starter / Pro / Agency / Top-up 10 / 25 / 50.
  Copy each `pri_...` id.
- A sandbox **client-side token** (Paddle → Developer tools → Authentication → client-side tokens).
- A sandbox **API key** (`PADDLE_API_KEY`) and a **webhook secret** (`PADDLE_WEBHOOK_SECRET`,
  created with the destination in step 2).

## 1. Set env (never commit real values — `.env.local` is gitignored)
Fill these locally in `.env.local` and in the deploy env (Netlify site settings):
```
PADDLE_API_KEY=                      # sandbox API key (server only)
PADDLE_WEBHOOK_SECRET=               # from the notification destination (step 2)
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=     # sandbox client-side token
NEXT_PUBLIC_PADDLE_ENV=sandbox
NEXT_PUBLIC_PADDLE_PRICE_STARTER=pri_...
NEXT_PUBLIC_PADDLE_PRICE_PRO=pri_...
NEXT_PUBLIC_PADDLE_PRICE_AGENCY=pri_...
NEXT_PUBLIC_PADDLE_PRICE_TOPUP_10=pri_...
NEXT_PUBLIC_PADDLE_PRICE_TOPUP_25=pri_...
NEXT_PUBLIC_PADDLE_PRICE_TOPUP_50=pri_...
```
With these set, `/app/billing` shows a "Sandbox" badge and active Buy buttons; without them the
buttons stay disabled ("Checkout not configured").

## 2. Point Paddle's webhook at our route
The webhook route is `POST /api/paddle/webhook`. Paddle must reach a public URL:
- **Option A (preferred):** a Netlify deploy (preview or prod). Destination URL:
  `https://<deploy-host>/api/paddle/webhook`.
- **Option B (local):** expose `localhost:3000` with a tunnel, e.g.
  `cloudflared tunnel --url http://localhost:3000`, then use `https://<tunnel-host>/api/paddle/webhook`.

In Paddle → Notifications, create a **destination** with that URL, subscribe at least to
`transaction.completed` and `subscription.created/updated/canceled`, and copy its **secret** into
`PADDLE_WEBHOOK_SECRET`. Redeploy / restart so the secret is loaded.

## 3. Buy Starter with a sandbox test card
1. Sign in, open `/app/billing`, note the current balance on `/app` (Overview).
2. Click **Buy** on Starter → the Paddle overlay opens.
3. Pay with a Paddle sandbox test card (e.g. `4242 4242 4242 4242`, any future expiry / CVC).

## 4. Verify the effects
- **Webhook received + verified:** Paddle → Notifications → the destination shows the event
  delivered with a 200. (A 401 means the secret is wrong; a 500 means an env/DB problem — check
  logs, the event will retry.)
- **Ledger (source of truth):** exactly ONE purchase row for the transaction ref:
  ```sql
  select user_id, delta, kind, reason, job_id, created_at
  from public.credit_ledger
  where kind = 'purchase' and job_id = '<transaction id>';
  ```
  Expect `delta = 1000` (Starter), `reason = 'paddle'`. Re-delivering the same event (Paddle
  "Replay") must NOT add a second row — idempotency proof.
- **paddle_events:** the event row has `processed_at` set (not null).
- **Dashboard:** `/app` balance increased by 1000.

## 5. Subscription state (optional, same run)
A Starter subscription also emits `subscription.created`; confirm one row in
`public.subscriptions` for the user with `status = 'active'` and a `current_period_end`. On the
billing page a **Manage subscription** button now appears (portal bridge) — clicking it should
open the Paddle customer portal.

## Troubleshooting: paid but no credits
**Symptom:** checkout succeeded but the dashboard balance did not increase; Paddle shows the
webhook delivered with 200; the `paddle_events` row IS processed. Server logs show
`paddle webhook: PAID transaction recorded without credit` with a reason.

**Diagnosis:** price-map/env mismatch — the bought package's `NEXT_PUBLIC_PADDLE_PRICE_*` is
missing or wrong in the SERVER deploy env — or the checkout lost `custom_data.user_id`.

**Recovery:** fix the env + redeploy, then re-credit manually from the recorded payload:
```sql
-- Inspect the stored event (user id, price id, transaction id are all in the payload):
select payload from public.paddle_events where event_id = '<event id>';
-- Grant with the PACKAGE credit figure (packages/core CREDIT_PACKAGES — never invent one):
select public.process_paddle_purchase('<event id>', '<user uuid>', <package credits>, '<transaction id>');
```
This is ref-idempotent: if Paddle ever re-delivers the same transaction, the ref guard prevents
a second grant, so the manual call is safe.

## Evidence to capture
- The ledger row (SQL result) + the `/app` balance screenshot.
- The Paddle destination delivery log showing 200 (and 200 again on a replay, with no second
  ledger row).
