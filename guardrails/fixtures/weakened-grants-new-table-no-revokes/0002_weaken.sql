-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. The BASELINE case: a new table shipped exactly the way 0023-0027
-- shipped theirs -- grants written, revokes forgotten. On the local stack this table really does
-- end up read-only for service_role; on cloud the default ACL gives it the full DML surface and
-- the comment above the grant becomes a false statement. check-grants.sh MUST go RED.
create table public.lookup_runs (
  id uuid primary key,
  user_id uuid not null
);
alter table public.lookup_runs enable row level security;
alter table public.lookup_runs force row level security;
grant select on public.lookup_runs to authenticated;
grant select, insert on public.lookup_runs to service_role;
