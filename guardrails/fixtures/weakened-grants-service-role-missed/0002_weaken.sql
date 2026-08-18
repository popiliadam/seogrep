-- SYNTHETIC WEAKENING - never applied. The HALF-DONE case, and the likeliest way this gate is
-- fooled by a careful author: anon and authenticated are narrowed properly, service_role is
-- forgotten. service_role is the only one of the three that matters -- it has rolbypassrls, so
-- for it the grant IS the gate and RLS will not catch what the ACL let through.
create table public.lookup_runs (
  id uuid primary key,
  user_id uuid not null
);
alter table public.lookup_runs enable row level security;
alter table public.lookup_runs force row level security;
grant select on public.lookup_runs to authenticated;
grant select, insert on public.lookup_runs to service_role;
revoke select, insert, update, delete on public.lookup_runs from anon;
revoke insert, update, delete on public.lookup_runs from authenticated;
