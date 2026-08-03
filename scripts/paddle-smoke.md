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

## Attribution enforcement — `PADDLE_ATTRIBUTION_ENFORCE`

`custom_data.user_id` is settable from the browser while the overlay is open, so it is a CLAIM.
The checkout mints a short-lived signed token (`attribution_token`, HMAC-derived from
`PADDLE_WEBHOOK_SECRET`) and the webhook prefers its **signed subject** over that claim. This flag
decides what happens when the token cannot be verified. It is listed in the repo-root
`.env.example` as a **commented** line, because unset is the correct default.

### The two states

| `PADDLE_ATTRIBUTION_ENFORCE` | What the webhook does |
|---|---|
| **unset / empty / `0` / `false` — THE DEFAULT** | **Grace.** An absent, forged, malformed or expired token is still credited to the body's claimed `user_id`, and a `console.warn` line records why. Nothing is ever refused for attribution. |
| **`1` / `true`** | **Enforcement.** An event whose subject was never proved is refused: HTTP 500, no ledger row, no subscription write, `processed_at` left NULL, one `console.error` line. |
| anything else (`yes`, `on`, …) | Grace, plus a warn line saying the value was not recognised. It is **not** enforcement. |

### What enforcement refuses, and what it does not

Refused (every event type, including renewals): `absent`, `bad_signature`, `malformed`,
`malformed_expiry`, `bad_subject`, `not_a_string`, `no_signing_key` — every shape in which the
paying tenant was never proved. Plus `expired` on a **first-party checkout**.

**Not** refused: `expired` on an event Paddle raised on its own — a renewal charge, a plan change,
a cancellation. Nobody opens a checkout overlay to be renewed, so those carry the token minted at
the ORIGINAL checkout and it is always stale. The signature still holds there, so the subject is
still proved; only freshness lapsed. Without this carve-out, enforcement would kill every renewal
grant and every cancellation the moment Paddle stopped retrying — which is why it used to be
unusable as a steady state.

### Before you turn it on

1. **Watch `absent` go to zero first.** Count the warn lines: `paddle webhook: attribution ANOMALY`
   with `reason: "absent"`. `absent` means an overlay that carried no token, and under enforcement
   it becomes a refusal.
2. **Check for subscriptions older than the token.** Any subscription created before the token
   shipped has no `attribution_token` in its stored `custom_data`, so its renewals and its
   cancellation read as `absent` **forever** — waiting does not fix those, only churn does:
   ```sql
   select id, user_id, status, created_at from public.subscriptions
   where created_at < '<the deploy that shipped M-05>' and status in ('active','trialing','past_due','paused');
   ```
   A non-empty result means enforcement will refuse those customers' renewals. Do not enable.
3. **Do not enable right after rotating `PADDLE_WEBHOOK_SECRET`.** The token key is derived from
   that secret, so a rotation invalidates every token in flight AND every token already stored on a
   live subscription — they all become `bad_signature`, which enforcement refuses on every path.
   After a rotation, run in grace until the affected subscriptions have renewed at least once with
   a token minted under the new secret.

Treat enforcement as an **operator-supervised mode** you turn on while watching the logs, not a
setting you enable and forget.

### Heal path (nothing is lost by getting this wrong)

A refusal is deliberately non-destructive: the raw event is already stored in `paddle_events`, its
`processed_at` stays NULL, and nothing is written. So:

1. `unset PADDLE_ATTRIBUTION_ENFORCE` (or set it to `0`) in the deploy env and redeploy.
2. Paddle re-delivers on its own for ~3 days; each redelivery now takes the grace path and credits.
3. For anything already past that window, use **Troubleshooting: paid but no credits** above — the
   payload is in `paddle_events`, and `process_paddle_purchase` is ref-idempotent.

Symptom of an enforcement backlog: `paddle webhook: attribution REFUSED (enforcement on)` in the
logs, Paddle's destination showing repeated 500s, and `paddle_events` rows with `processed_at` null.

### Assumed vendor behaviour (verify in sandbox before relying on it)

- Paddle copies a subscription's `custom_data` onto its renewal transactions and its
  `subscription.*` events. The product already depends on this for `custom_data.user_id`.
- `origin` is present on every `transaction.completed` and is `web` for a checkout-overlay
  transaction, `subscription_*` for one Paddle raised itself.
- Paddle retries a 500 for roughly three days.

## Evidence to capture
- The ledger row (SQL result) + the `/app` balance screenshot.
- The Paddle destination delivery log showing 200 (and 200 again on a replay, with no second
  ledger row).
