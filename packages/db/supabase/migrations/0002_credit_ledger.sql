-- Migration 0002: credit_ledger (append-only) + append-only armor + balance view.
-- Balance is derived ONLY from SUM(delta); ledger rows are never updated or deleted.
-- reserve -> commit/release row kinds prevent double-spend in async jobs.

-- ---------------------------------------------------------------------------
-- credit_ledger: append-only money ledger. Inserts are performed by service_role
-- (RLS bypass). "kind" is not null so the CHECK constraint is actually enforced
-- (a NULL would otherwise satisfy the IN (...) check).
-- ---------------------------------------------------------------------------
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete restrict,
  delta bigint not null,
  kind text not null check (kind in ('grant', 'purchase', 'spend_reserve', 'spend_commit', 'spend_release', 'adjust')),
  reason text,
  tool text,
  job_id text,
  reserve_id uuid,
  created_at timestamptz not null default now()
);

alter table public.credit_ledger enable row level security;
alter table public.credit_ledger force row level security;

-- Authenticated users read only their own ledger rows. No INSERT/UPDATE/DELETE
-- policy: inserts happen via service_role; mutations are blocked by the armor below.
create policy "credit_ledger_select_own"
  on public.credit_ledger
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Append-only armor: revoke mutation privileges (incl. service_role) and reject
-- UPDATE/DELETE at the row level as defense in depth. TRUNCATE is covered by REVOKE
-- only (row-level triggers do not fire on TRUNCATE).
REVOKE UPDATE, DELETE, TRUNCATE ON public.credit_ledger FROM anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table: % blocked on %', TG_OP, TG_TABLE_NAME; END $$;
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- ---------------------------------------------------------------------------
-- credit_balances: per-user balance = COALESCE(SUM(delta), 0).
-- security_invoker so the querying user's RLS on credit_ledger applies to the view.
-- ---------------------------------------------------------------------------
create view public.credit_balances
  with (security_invoker = true) as
  select user_id, coalesce(sum(delta), 0) as balance
  from public.credit_ledger
  group by user_id;
