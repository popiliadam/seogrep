-- Migration 0005: ledger SQL functions (reserve / commit / release) + search_path
-- hardening of the pre-existing reject_mutation() trigger function.
--
-- These functions are the ONLY writers of the spend_* ledger kinds. Concurrency
-- safety lives in the DB, not the app: pg_advisory_xact_lock(hashtext(user)) makes
-- concurrent reserves for the same user serialize, so a balance can never oversell.
-- SECURITY INVOKER (default): callers are service_role (RLS bypass) via PostgREST
-- RPC; EXECUTE is granted to service_role only (anon/authenticated revoked). Every
-- function pins search_path = '' and schema-qualifies every object it touches.

-- Harden the 0002 trigger function (behaviour identical; closes an advisor WARN).
alter function public.reject_mutation() set search_path = '';

-- Explicit ledger privileges. New stacks no longer auto-expose public-schema tables
-- to the Data API roles (auto_expose_new_tables default flipped), so the grants the
-- 0002 policies assume must be spelled out. Additive no-op where legacy auto-expose
-- already granted them. Deliberately narrow: no UPDATE/DELETE/TRUNCATE (append-only
-- armor in 0002 stays intact) and nothing for anon.
grant select on public.credit_ledger to authenticated;
grant select, insert on public.credit_ledger to service_role;
grant select on public.credit_balances to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- reserve_credits: debit p_amount by inserting a spend_reserve row (delta < 0)
-- after checking the derived balance under a per-user advisory lock. Returns the
-- new reserve_id. Raises on non-positive amount or insufficient balance.
-- ---------------------------------------------------------------------------
create function public.reserve_credits(
  p_user_id uuid,
  p_amount bigint,
  p_tool text,
  p_job_id text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_balance bigint;
  v_reserve_id uuid := gen_random_uuid();
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount: reserve amount must be positive (got %)', p_amount;
  end if;

  -- Serialize concurrent reserves for this user; released at transaction end.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select coalesce(sum(delta), 0) into v_balance
  from public.credit_ledger
  where user_id = p_user_id;

  if v_balance < p_amount then
    raise exception 'insufficient balance: cannot reserve % (available %)', p_amount, v_balance;
  end if;

  insert into public.credit_ledger (user_id, delta, kind, tool, job_id, reserve_id)
  values (p_user_id, -p_amount, 'spend_reserve', p_tool, p_job_id, v_reserve_id);

  return v_reserve_id;
end;
$$;

revoke execute on function public.reserve_credits(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, bigint, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- commit_reserve: settle an open reserve with a zero-delta spend_commit row. The
-- reserve already debited the balance, so commit changes no balance; it only
-- records that the spend is final. Raises if the reserve is unknown or already
-- settled (committed or released). The settled-check + insert run under the same
-- per-user advisory lock the reserve used, so a double-commit cannot race through.
-- ---------------------------------------------------------------------------
create function public.commit_reserve(p_reserve_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_tool text;
  v_job_id text;
begin
  select user_id, tool, job_id into v_user_id, v_tool, v_job_id
  from public.credit_ledger
  where reserve_id = p_reserve_id and kind = 'spend_reserve';

  if not found then
    raise exception 'unknown reserve: no spend_reserve row for reserve_id %', p_reserve_id;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  if exists (
    select 1 from public.credit_ledger
    where reserve_id = p_reserve_id and kind in ('spend_commit', 'spend_release')
  ) then
    raise exception 'reserve already settled: reserve_id % is not open', p_reserve_id;
  end if;

  insert into public.credit_ledger (user_id, delta, kind, tool, job_id, reserve_id)
  values (v_user_id, 0, 'spend_commit', v_tool, v_job_id, p_reserve_id);
end;
$$;

revoke execute on function public.commit_reserve(uuid) from public, anon, authenticated;
grant execute on function public.commit_reserve(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- release_reserve: refund an open reserve with a spend_release row (delta > 0,
-- equal to the reserved amount read back from the reserve row). Raises if the
-- reserve is unknown or already settled. Same per-user advisory lock as commit.
-- ---------------------------------------------------------------------------
create function public.release_reserve(p_reserve_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_delta bigint;
  v_tool text;
  v_job_id text;
begin
  select user_id, delta, tool, job_id into v_user_id, v_delta, v_tool, v_job_id
  from public.credit_ledger
  where reserve_id = p_reserve_id and kind = 'spend_reserve';

  if not found then
    raise exception 'unknown reserve: no spend_reserve row for reserve_id %', p_reserve_id;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  if exists (
    select 1 from public.credit_ledger
    where reserve_id = p_reserve_id and kind in ('spend_commit', 'spend_release')
  ) then
    raise exception 'reserve already settled: reserve_id % is not open', p_reserve_id;
  end if;

  insert into public.credit_ledger (user_id, delta, kind, tool, job_id, reserve_id)
  values (v_user_id, -v_delta, 'spend_release', v_tool, v_job_id, p_reserve_id);
end;
$$;

revoke execute on function public.release_reserve(uuid) from public, anon, authenticated;
grant execute on function public.release_reserve(uuid) to service_role;
