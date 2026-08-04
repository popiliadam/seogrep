-- Migration 0014 (hostile-audit H-03): the DataForSEO daily vendor-spend budget moves from a
-- per-machine JSONL file to ONE durable, fleet-global, atomic counter in the database.
--
-- What was wrong (apps/mcp/src/dfs/budget.ts before this migration):
--   * NOT ATOMIC  — read total, send the vendor request, THEN append. Every concurrent caller
--                   read the same pre-call total, so N callers each passed a gate that only one
--                   of them should have.
--   * NOT GLOBAL  — the ledger was a file. apps/mcp/fly.toml runs `web` and `worker` as separate
--                   machines, so each process group got its own private $3.00/day.
--   * NOT DURABLE — that file lived in DFS_BUDGET_DIR=/tmp/dfs-spend, i.e. per-boot ephemeral: a
--                   restart or redeploy handed back a full day's allowance.
--   * FAIL-OPEN   — any read error (ENOENT, EACCES, I/O) was counted as $0.00 spent.
--
-- This is VENDOR spend (money the business owes DataForSEO), NOT user credits: it deliberately
-- does not touch credit_ledger, has no user_id, and is not tenant data (constitution NEVER #2
-- keeps the credit ledger a separate, append-only thing).
--
-- Shape: the 0005 reserve/settle pattern. A reservation is written BEFORE the vendor request
-- under a per-day advisory lock and counts at its ESTIMATE until it is settled with the real
-- cost — which is what closes the check-then-spend window. An unsettled reservation therefore
-- keeps costing the budget its full estimate: a crashed or failed flow errs toward refusing the
-- next call, never toward admitting it.

-- ---------------------------------------------------------------------------
-- The counter. One row per vendor operation (one reservation), keyed by the UTC day so the
-- window matches the guard script's `date -u +%F`.
-- ---------------------------------------------------------------------------
create table public.dfs_spend (
  id uuid primary key default gen_random_uuid(),
  spend_day date not null,
  endpoint text not null,
  estimated_usd numeric(12, 6) not null check (estimated_usd >= 0),
  actual_usd numeric(12, 6) check (actual_usd >= 0),
  row_count integer,
  status text not null default 'open' check (status in ('open', 'settled')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

-- The only read pattern is "today's rows", and it runs on every live call.
create index dfs_spend_day_idx on public.dfs_spend (spend_day);

alter table public.dfs_spend enable row level security;
alter table public.dfs_spend force row level security;

-- No policies, by design: this is operator/vendor accounting, not tenant data, so no client role
-- may read or write it. service_role (BYPASSRLS) reaches it through the RPCs below only.
revoke all on public.dfs_spend from anon, authenticated;
grant select, insert, update on public.dfs_spend to service_role;

-- ---------------------------------------------------------------------------
-- The sanctioned cap, in ONE place. Constitution NEVER #5 fixes it at $3.00/day; changing it is
-- a human decision, so it lives as a function the app and guardrails/dfs-budget.sh both read
-- rather than as a number copied into three files.
-- ---------------------------------------------------------------------------
create function public.dfs_daily_budget_usd() returns numeric
language sql
immutable
set search_path = ''
as $$ select 3.0::numeric $$;

revoke execute on function public.dfs_daily_budget_usd() from public, anon, authenticated;
grant execute on function public.dfs_daily_budget_usd() to service_role;

-- ---------------------------------------------------------------------------
-- Today's committed spend (UTC): open reservations count at their ESTIMATE, settled ones at
-- their REAL cost. This is the number the gate compares against the cap, and the number
-- guardrails/dfs-budget.sh reports.
-- ---------------------------------------------------------------------------
create function public.dfs_spend_today_usd() returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(coalesce(actual_usd, estimated_usd)), 0)::numeric
  from public.dfs_spend
  where spend_day = (now() at time zone 'utc')::date;
$$;

revoke execute on function public.dfs_spend_today_usd() from public, anon, authenticated;
grant execute on function public.dfs_spend_today_usd() to service_role;

-- ---------------------------------------------------------------------------
-- reserve_dfs_spend: the pre-call gate AND the booking, as ONE serialized unit. Under a per-day
-- advisory lock it sums today's spend, refuses when this estimate would pass the cap, and
-- otherwise writes the reservation row before returning. Because the row is written inside the
-- lock, a second caller entering the gate already sees this reservation — the vendor request
-- that follows can no longer slip through a stale total.
--
-- The lock key is built with to_char(v_day, 'YYYY-MM-DD'), NOT v_day::text: date-to-text output
-- follows the DateStyle GUC, so the same day hashes differently under 'ISO, MDY' (-1268704674)
-- and 'German, DMY' (1979816615). Two sessions on different DateStyles would then take DIFFERENT
-- locks for the SAME day and serialize against nothing. to_char pins the format, so the key is
-- locale-independent. settle_dfs_spend below MUST build the key with the byte-identical
-- expression — a key that disagrees between the two functions is the real hazard here.
-- ---------------------------------------------------------------------------
create function public.reserve_dfs_spend(
  p_estimated_usd numeric,
  p_endpoint text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_cap numeric := public.dfs_daily_budget_usd();
  v_spent numeric;
  v_reservation_id uuid;
begin
  if p_estimated_usd is null or p_estimated_usd <= 0 then
    raise exception 'invalid estimate: DataForSEO spend estimate must be positive (got %)', p_estimated_usd;
  end if;
  if p_endpoint is null or p_endpoint = '' then
    raise exception 'invalid endpoint: DataForSEO spend reservation must name its endpoint';
  end if;

  -- Serialize every reservation for this UTC day; released at transaction end. This lock is
  -- what makes the check and the booking indivisible (the 0005 reserve_credits pattern).
  perform pg_advisory_xact_lock(hashtext('dfs_spend:' || to_char(v_day, 'YYYY-MM-DD')));

  select coalesce(sum(coalesce(actual_usd, estimated_usd)), 0)
    into v_spent
  from public.dfs_spend
  where spend_day = v_day;

  if v_spent + p_estimated_usd > v_cap then
    raise exception
      'DataForSEO daily budget exceeded: today''s spend ($%) plus this call''s estimate ($%) would pass the $% cap. Refusing the call.',
      round(v_spent, 4), round(p_estimated_usd, 4), round(v_cap, 2);
  end if;

  insert into public.dfs_spend (spend_day, endpoint, estimated_usd)
  values (v_day, p_endpoint, p_estimated_usd)
  returning id into v_reservation_id;

  return v_reservation_id;
end;
$$;

revoke execute on function public.reserve_dfs_spend(numeric, text) from public, anon, authenticated;
grant execute on function public.reserve_dfs_spend(numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- settle_dfs_spend: reconcile an open reservation with the REAL cost the vendor reported. Runs
-- under the same per-day lock so a settlement can never interleave with a reservation's read.
-- Raises on an unknown or already-settled reservation, so a double settle cannot quietly rewrite
-- the day's total.
--
-- Shape follows 0005 commit_reserve EXACTLY, and the order matters: the first SELECT only finds
-- WHICH day's lock to take, and its answer is stale the moment the lock is contended. The
-- open/settled DECISION is therefore re-read UNDER the lock (READ COMMITTED gives that statement
-- a fresh snapshot, so it sees a settlement another transaction has just committed). Deciding on
-- the pre-lock read instead would let two concurrent settlements BOTH report success and let the
-- last writer silently overwrite the recorded cost.
--
-- The lock key expression is byte-identical to reserve_dfs_spend's (see the note there): both
-- must hash the SAME string for the SAME day, or the two functions serialize against different
-- locks and the per-day lock stops meaning anything.
-- ---------------------------------------------------------------------------
create function public.settle_dfs_spend(
  p_reservation_id uuid,
  p_actual_usd numeric,
  p_row_count integer
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_day date;
begin
  if p_actual_usd is null or p_actual_usd < 0 then
    raise exception 'invalid actual cost: DataForSEO settlement must be zero or positive (got %)', p_actual_usd;
  end if;

  select spend_day into v_day
  from public.dfs_spend
  where id = p_reservation_id;

  if not found then
    raise exception 'unknown reservation: no dfs_spend row for id %', p_reservation_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('dfs_spend:' || to_char(v_day, 'YYYY-MM-DD')));

  if exists (
    select 1 from public.dfs_spend
    where id = p_reservation_id and status <> 'open'
  ) then
    raise exception 'reservation already settled: dfs_spend row % is not open', p_reservation_id;
  end if;

  update public.dfs_spend
     set actual_usd = p_actual_usd,
         row_count = p_row_count,
         status = 'settled',
         settled_at = now()
   where id = p_reservation_id;
end;
$$;

revoke execute on function public.settle_dfs_spend(uuid, numeric, integer) from public, anon, authenticated;
grant execute on function public.settle_dfs_spend(uuid, numeric, integer) to service_role;
