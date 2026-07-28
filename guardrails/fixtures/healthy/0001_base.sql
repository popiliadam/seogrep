-- SYNTHETIC FIXTURE - never applied to any database.
-- Minimal healthy migration set for guardrails/check-guards-selftest.sh: a shape both
-- static gates must accept. It carries the real armor of packages/db/supabase/migrations
-- 0002 + 0003 (REVOKE + reject_mutation() + BEFORE UPDATE OR DELETE triggers) plus a
-- plain RLS-only table, so the gates are also proven NOT to over-reach.

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  delta bigint not null
);
alter table public.credit_ledger enable row level security;
alter table public.credit_ledger force row level security;

create table public.events (
  id bigint generated always as identity primary key,
  kind text not null
);
alter table public.events enable row level security;
alter table public.events force row level security;

-- Not append-only: only RLS is expected on this one.
create table public.projects (
  id uuid primary key
);
alter table public.projects enable row level security;
alter table public.projects force row level security;

-- Append-only armor.
REVOKE UPDATE, DELETE, TRUNCATE ON public.credit_ledger FROM anon, authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.events FROM anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table: % blocked on %', TG_OP, TG_TABLE_NAME; END $$;

CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Legitimate grants that must stay GREEN (read + append are allowed).
grant select on public.credit_ledger to authenticated;
grant select, insert on public.credit_ledger to service_role;
grant select on public.events to authenticated;
grant select, insert on public.events to service_role;
grant select on public.projects to authenticated;
grant select, insert, update on public.projects to service_role;
