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

> Note the queries above also surface a running row with `started_at IS NULL` only by its
> absence — such a row is NOT reaped (it cannot be aged). The reaper logs those separately
> for manual inspection; investigate them by hand.

---

## 3. Recovery

Export the app env (the prod names, same as `guardrails/verify-db.sh`):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. Then run:

```sh
node scripts/reconcile.mjs [--older-than-minutes=N]   # N defaults to 15
```

What it does, per stuck job:

1. **Releases the open reserve → refund.** The refund goes through the migration-0005
   `release_reserve` RPC (the only refund path), which credits the user back the reserved
   amount under the per-user advisory lock.
2. **Marks the job `failed`** (only while it is still `running` — a status guard), with
   `error = 'reconciled: worker did not finish; reserve released, re-run the tool'`.
3. **Does NOT replay the tool.** The tool payload traveled in the pg-boss queue message,
   not on the `jobs` row, so it is gone. The user simply **re-runs the tool** — they were
   refunded, so re-running costs them the credits once, correctly.

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
- **No double-refund.** The detection filter excludes already-settled reserves, and the
  advisory-locked RPC is the final arbiter, so a reserve is refunded at most once.
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
