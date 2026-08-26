-- Migration 0033: credit_ledger learns WHICH PROJECT a spend was for.
--
-- THE MEASURED GAP (2026-08-26). "Which of my sites did my credits go to?" could not be answered
-- by any surface. The ledger carried user_id, tool and an amount, and nothing else that named a
-- site. Of 82 rows in a three-day window, every one had a job_id and only FOUR resolved to a real
-- jobs row — the rest carry the traceability uuid the registry mints for surface-mode tools,
-- which points at nothing. `reason` was null in all 82. So the answerable share of a 1,176-credit
-- window was 40 credits: 3.4%.
--
-- The attribution was never missing, only unjoined: audit_runs, audit_content_runs,
-- gsc_discovery_runs, domain_lookup_runs and subject_lookup_runs all carry project_id. The ledger
-- had no key to any of them. This adds the column to the ledger itself, which is the only place
-- that can answer the question for EVERY spend rather than for the tools that happen to keep a
-- run table.
--
-- NO FOREIGN KEY, AND THAT IS NOT AN OVERSIGHT.
-- `on delete set null` would UPDATE credit_ledger, and 0002 puts a BEFORE UPDATE OR DELETE trigger
-- on that table which raises unconditionally (plus REVOKE UPDATE from every role). The cascade
-- could therefore never run: deleting a project would fail with "append-only table: UPDATE
-- blocked on credit_ledger", turning a fix for a reporting gap into an outage on an unrelated
-- path. `on delete cascade` is worse still — it would DELETE ledger rows, which is the one thing
-- this table exists to make impossible.
--
-- A dangling id is also the RIGHT behaviour for an append-only log: the row records what was true
-- when the credits were spent, and a project removed afterwards does not change that history. In
-- practice untracking ARCHIVES (0022 stamps archived_at) rather than deletes, so the id keeps
-- resolving; readers join and fall back to naming the id when it does not.
--
-- NULL IS A REAL ANSWER, NOT A MISSING ONE. research_keywords takes a keyword set with no domain
-- at all; discover_keywords in seed mode has no site; ai_visibility can be asked about a subject
-- that is nobody's project (measured: a 90-credit call about "ahrefs.com"). Those rows are
-- project-less by nature, and the surfaces are required to say "no project scope" rather than
-- attribute them to something.

alter table public.credit_ledger add column project_id uuid;

comment on column public.credit_ledger.project_id is
  'The tenant project this spend was for, or NULL when the call had no project scope (a keyword '
  'set, a seed, a subject that is not a tracked site). Deliberately NOT a foreign key: an '
  'append-only table cannot accept on-delete-set-null, and a historical row keeps the id it was '
  'written with. See migration 0033.';

-- The read this column exists to serve: one tenant's ledger, grouped or filtered by project,
-- newest first. Without it every such read is a full scan of the tenant's history.
create index credit_ledger_user_project_created_idx
  on public.credit_ledger (user_id, project_id, created_at desc);

-- A SECOND index, for a read that predates this migration and was measured on 2026-08-26:
-- hasPaidBalance() asks "does this user have a purchase or a positive adjust?" on EVERY paid tool
-- call. EXPLAIN ANALYZE on the live ledger showed a Seq Scan — 0.082 ms for an account whose
-- purchase row happens to sit early in the heap, and a FULL scan (783 rows removed by filter) for
-- an account that has none, which is precisely the account that hits the gate most often. Both are
-- sub-millisecond today and neither stays that way as the table grows.
create index credit_ledger_user_kind_created_idx
  on public.credit_ledger (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- reserve_credits gains p_project_id. DROP + CREATE rather than an overload: two functions
-- differing only by arity would leave the 4-argument one callable, and a caller that kept using
-- it would write project-less rows that look exactly like the legitimately project-less ones
-- above. There must be no way to reserve WITHOUT deciding what the scope is.
--
-- The parameter DEFAULTS to null so PostgREST callers that pass four arguments still resolve, and
-- so the value is stated rather than positional at every call site.
-- ---------------------------------------------------------------------------
drop function public.reserve_credits(uuid, bigint, text, text);

create function public.reserve_credits(
  p_user_id uuid,
  p_amount bigint,
  p_tool text,
  p_job_id text,
  p_project_id uuid default null
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

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select coalesce(sum(delta), 0) into v_balance
  from public.credit_ledger
  where user_id = p_user_id;

  if v_balance < p_amount then
    raise exception 'insufficient balance: cannot reserve % (available %)', p_amount, v_balance;
  end if;

  insert into public.credit_ledger (user_id, delta, kind, tool, job_id, reserve_id, project_id)
  values (p_user_id, -p_amount, 'spend_reserve', p_tool, p_job_id, v_reserve_id, p_project_id);

  return v_reserve_id;
end;
$$;

revoke execute on function public.reserve_credits(uuid, bigint, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, bigint, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- commit_reserve and release_reserve COPY the scope from the reserve row they settle. The
-- settlement rows are not a second decision about which project this was: they are the same
-- spend, later. Reading it back is also what makes a commit impossible to mis-scope — there is
-- no argument for a caller to get wrong.
-- ---------------------------------------------------------------------------
create or replace function public.commit_reserve(p_reserve_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_tool text;
  v_job_id text;
  v_project_id uuid;
begin
  select user_id, tool, job_id, project_id into v_user_id, v_tool, v_job_id, v_project_id
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

  insert into public.credit_ledger (user_id, delta, kind, tool, job_id, reserve_id, project_id)
  values (v_user_id, 0, 'spend_commit', v_tool, v_job_id, p_reserve_id, v_project_id);
end;
$$;

create or replace function public.release_reserve(p_reserve_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_delta bigint;
  v_tool text;
  v_job_id text;
  v_project_id uuid;
begin
  select user_id, delta, tool, job_id, project_id
    into v_user_id, v_delta, v_tool, v_job_id, v_project_id
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

  insert into public.credit_ledger (user_id, delta, kind, tool, job_id, reserve_id, project_id)
  values (v_user_id, -v_delta, 'spend_release', v_tool, v_job_id, p_reserve_id, v_project_id);
end;
$$;
