-- SYNTHETIC WEAKENING - never applied. The TYPO case: the revokes exist, are complete, cover
-- all three roles -- and name a table that is not the one just created. A gate that only counted
-- revoke statements, or grepped the file for the word "revoke", would pass this. The table under
-- discussion must still be reported.
create table public.lookup_runs (
  id uuid primary key,
  user_id uuid not null
);
alter table public.lookup_runs enable row level security;
alter table public.lookup_runs force row level security;
grant select on public.lookup_runs to authenticated;
grant select, insert on public.lookup_runs to service_role;
revoke select, insert, update, delete on public.projects from anon;
revoke insert, update, delete on public.projects from authenticated;
revoke update, delete on public.projects from service_role;
