# Stuck-job reconciliation runbook

Audit §7 (stuck-job recovery, a "before first paying user" condition). A crashed or
redeployed worker can leave a `jobs` row in `status = 'running'` with an **open credit
reserve**: the user was debited, the work never delivered, and the reserve never settles.
This runbook is the documented, tested recovery path. The reaper lives in
`apps/mcp/src/queue/reaper.ts`; the operator entrypoint is `scripts/reconcile.mjs`.

---

## 1. When to run

Run reconciliation when you see any of:

- Jobs stuck in `status = 'running'` well past the tool time budget (a crawl's budget is
  90s; anything running for many minutes is not progressing).
- A user reports that a tool "ran but nothing happened" **and** their credit balance is
  short by the tool's cost with no result — the classic symptom of an open reserve on a
  crashed run.
- A known worker crash, OOM, or redeploy (SIGKILL) that could have interrupted in-flight
  runs between the credit reserve and the job's completion.

Always run **detection (§2) first** to see what would be reconciled before acting.

---

## 2. Detection (read-only)

These queries only READ. Run them against the database (service-role / `SUPABASE_DB_URL`).

`credit_ledger.job_id` is `text` and `jobs.id` is `uuid`, so the join casts `j.id::text`.
It joins on **`job_id`, not `jobs.reserve_id`** — that is deliberate: a crash between
`reserve_credits` and `setJobReserve` leaves `jobs.reserve_id = NULL` while the ledger
reserve is already open (the "orphan" case). Joining by `job_id` finds those too.

### 2a. Stuck jobs and their OPEN reserves

```sql
-- Running jobs older than 15 minutes that still hold an OPEN reserve (a spend_reserve
-- row with no matching spend_commit / spend_release). These are the reconcile targets.
select
  j.id                as job_id,
  j.user_id,
  j.tool,
  j.started_at,
  r.reserve_id,
  -r.delta            as reserved_credits   -- spend_reserve.delta is negative; negate to show the amount held
from public.jobs j
join public.credit_ledger r
  on r.job_id = j.id::text
 and r.kind = 'spend_reserve'
where j.status = 'running'
  and j.started_at is not null
  and j.started_at < now() - interval '15 minutes'
  and not exists (
    select 1
    from public.credit_ledger s
    where s.reserve_id = r.reserve_id
      and s.kind in ('spend_commit', 'spend_release')
  )
order by j.started_at asc;
```

### 2b. Balance impact per affected user

```sql
-- For each affected user: how many credits are currently held by stuck-job open reserves
-- (i.e. would be refunded by reconciliation) versus their current derived balance.
select
  j.user_id,
  count(*)            as open_reserves,
  sum(-r.delta)       as held_credits,        -- total to be refunded
  b.balance           as current_balance
from public.jobs j
join public.credit_ledger r
  on r.job_id = j.id::text
 and r.kind = 'spend_reserve'
left join public.credit_balances b
  on b.user_id = j.user_id
where j.status = 'running'
  and j.started_at is not null
  and j.started_at < now() - interval '15 minutes'
  and not exists (
    select 1
    from public.credit_ledger s
    where s.reserve_id = r.reserve_id
      and s.kind in ('spend_commit', 'spend_release')
  )
group by j.user_id, b.balance
order by held_credits desc;
```

### 2c. Crash-after-commit (charged, NOT refundable)

A stuck `running` job whose reserve is already **committed** is a *crash-after-commit*: the
worker died in the window between `commit_reserve` and `completeJob`, so the charge stood and
the work may be lost. The reaper CANNOT refund it (`release_reserve` correctly raises
`already settled`) — it needs **manual review / a support credit grant**, not an automatic
refund. These are **invisible to §2a** (that query lists only OPEN reserves), so find them
explicitly:

```sql
-- Running jobs older than 15 minutes whose reserve is already COMMITTED (the charge stood).
select
  j.id            as job_id,
  j.user_id,
  j.tool,
  j.started_at,
  c.reserve_id,
  -res.delta      as charged_credits
from public.jobs j
join public.credit_ledger c
  on c.job_id = j.id::text
 and c.kind = 'spend_commit'
join public.credit_ledger res
  on res.reserve_id = c.reserve_id
 and res.kind = 'spend_reserve'
where j.status = 'running'
  and j.started_at is not null
  and j.started_at < now() - interval '15 minutes'
order by j.started_at asc;
```

> Note the queries above also surface a running row with `started_at IS NULL` only by its
> absence — such a row is NOT reaped (it cannot be aged). The reaper logs those separately
> for manual inspection; investigate them by hand.

### 2d. Charged but result lost (failed after commit, NOT refundable)

A job can end `status = 'failed'` with its reserve already **committed** (a `spend_commit`
exists for the reserve, no `spend_release`). That is the *charged-but-result-lost* shape: the
tool ran and the charge settled inside `withCredits`, but persisting the result failed
afterward (`completeJob` errored while the process was still alive — B-I3), so the worker
marked the job failed with the honest `charge settled but result did not persist — contact
support` wording. It is **NOT refundable** (the charge is a settled commit, same money position
as §2c) — it needs **manual review / a support credit**, not an automatic refund. A *normal*
handler failure instead carries a `spend_release` (the reserve was refunded), so joining on
`spend_commit` isolates exactly these. (This query also re-surfaces any §2c crash-after-commit
job the reaper has already transitioned to `failed` — same class, same handling.)

```sql
-- Failed jobs whose reserve is already COMMITTED (charge stood, result did not persist).
select
  j.id            as job_id,
  j.user_id,
  j.tool,
  j.finished_at,
  j.error,
  c.reserve_id,
  -res.delta      as charged_credits
from public.jobs j
join public.credit_ledger c
  on c.job_id = j.id::text
 and c.kind = 'spend_commit'
join public.credit_ledger res
  on res.reserve_id = c.reserve_id
 and res.kind = 'spend_reserve'
where j.status = 'failed'
order by j.finished_at asc;
```

Recovery is operator-judged: the tool is idempotent, so the user can simply **re-run it**
(charging them once, correctly, for a result they can keep), or — if you would rather not
charge twice for the same intent — issue a **support credit** for the lost run. Either way this
is a support decision, never an automatic refund (the original charge is a valid settled
commit).

### 2e. Paid Paddle events not yet attributed (B-C1)

A different money surface: the Paddle **webhook**, not the jobs/ledger. A paid
`transaction.completed` the webhook could not attribute — unmapped price (server env drift) or a
lost `custom_data.user_id` (checkout regression) — returns 500 **without** stamping
`processed_at` (B-C1), so Paddle keeps retrying across its ~3-day window and the row sits in
`paddle_events` with `processed_at IS NULL`. Within that window an env fix / data correction lets
a retry self-heal (it maps to `purchase`, grants, and stamps). A row still NULL well past a day
is a **persistent** attribution failure worth acting on *now* (so the remaining retries heal it);
one past the full retry window has **dead-lettered** — Paddle gave up — and the customer paid for
nothing until it is replayed by hand.

```sql
-- Paid transactions the webhook has not attributed (processed_at still NULL) for over a day.
-- These are real customer money awaiting attribution — investigate the price env / user before
-- Paddle's retry window closes.
select
  event_id,
  event_type,
  created_at
from public.paddle_events
where event_type = 'transaction.completed'
  and processed_at is null
  and created_at < now() - interval '1 day'
order by created_at asc;
```

Recovery: fix the root cause — set the missing price env var (`NEXT_PUBLIC_PADDLE_PRICE_*`) and
redeploy, or resolve the correct user for the lost `custom_data.user_id`. If the row is still
inside Paddle's retry window the next retry then attributes it automatically; if it has already
dead-lettered, the full raw event is preserved in `paddle_events.payload`, so replay it via the
webhook runbook (`scripts/paddle-smoke.md`, "paid but no credits") to grant the credits. Never
fabricate a grant that bypasses the `process_paddle_purchase` idempotency guard — replay through
the real path so a later Paddle retry cannot double-grant.

---

## 3. Recovery

Export the app env (the prod names, same as `guardrails/verify-db.sh`):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. Then run:

```sh
node scripts/reconcile.mjs [--older-than-minutes=N]   # N defaults to 15
```

> **Node floor:** `reconcile.mjs` imports the reaper's TypeScript directly, which needs
> **Node ≥22.18 (or ≥23)** with default type-stripping. Older Node exits with
> `ERR_UNKNOWN_FILE_EXTENSION` *before any DB call* — safe (no money moves), but confusing
> mid-incident; upgrade Node if you hit it.

What it does, per stuck job:

1. **Releases the open reserve → refund.** The refund goes through the migration-0005
   `release_reserve` RPC (the only refund path), which credits the user back the reserved
   amount under the per-user advisory lock.
2. **Marks the job `failed`** (only while it is still `running` — a status guard), with a
   `reconciled: …` error: `reserve released, re-run the tool` when the reserve was refunded,
   or `the charge had already settled; … contact support for review` for a crash-after-commit
   (§2c) where no refund was possible.
3. **Does NOT replay the tool.** The tool payload traveled in the pg-boss queue message,
   not on the `jobs` row, so it is gone. The user simply **re-runs the tool** — for a refunded
   job, re-running costs them the credits once, correctly (a crash-after-commit job was
   already charged; that one is a support case, not a self-service re-run).

It prints a summary: `scanned`, `released`, `alreadySettled` (reserves a real worker
settled concurrently — skipped, never double-refunded), `failed`, and `orphanReserves`
(open reserves found via `ledger.job_id` when `jobs.reserve_id` was NULL).

### Verify afterward

- Re-run the **detection queries (§2)** — they should now return **0 rows** for the
  reconciled jobs.
- Confirm `credit_balances.balance` for each affected user **increased by exactly the
  `held_credits`** reported in §2b (the refund landed).
- The reconciled `jobs` rows now read `status = 'failed'` with the `reconciled: …` error.

---

## 4. Money-safety

- **Releasing is the conservative direction.** The crashed run did not deliver, so the
  user must not be charged for it — we refund. Charging for undelivered work would be the
  wrong direction; leaving the reserve open forever silently holds the user's credits.
- **Double-charge is impossible.** `commit_reserve` and `release_reserve` are mutually
  exclusive under the same per-user advisory lock (migration 0005): the first to settle a
  reserve wins, and the second raises `reserve already settled`. If the real worker
  commits at the very moment the reaper runs, the reaper's `release_reserve` gets
  `already settled` and **skips** — it never re-refunds (counted as `alreadySettled`).
- **No double-refund.** The **§2 detection SQL** excludes already-settled reserves so an
  operator sees only what is refundable. The **reaper itself does not pre-filter** — it
  enumerates every reserve for a stuck job and lets the advisory-locked `release_reserve` RPC
  arbitrate; a reserve settled concurrently comes back `already settled` and is skipped, so
  any reserve is refunded at most once.
- **Crash-after-commit is charged, not refundable.** If a worker dies AFTER `commit_reserve`
  but before `completeJob`, the job is stuck `running` with an already-SETTLED reserve. The
  reaper cannot refund it (release raises `already settled`, counted as `alreadySettled`) and
  marks it failed with the distinct "charge had already settled; … contact support" wording,
  NOT "reserve released". Find these with **§2c** and handle by manual review / a support
  credit grant.
- **The 15-minute threshold** must exceed the longest job runtime (the crawl time budget
  is 90s) so a job that is genuinely still running is never reaped. Lower it below the max
  runtime only if you accept the risk of refunding a live job (which would then fail when
  its own commit hits `already settled`).

---

## 5. Scope

This is **manual / on-demand** recovery: an operator runs detection, then the one command.
`scripts/reconcile.mjs` is one-shot by design — no daemon, no scheduling.

Automatic periodic reaping (a cron/scheduled invocation) plus alerting on stuck-job counts
is **deferred to the Faz 4 monitoring work** — see the monitoring task and the audit
finding for stuck-job recovery (§7). Until then, run this runbook when the symptoms in §1
appear or after any worker crash/redeploy.
