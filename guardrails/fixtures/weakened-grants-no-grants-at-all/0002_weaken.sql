-- SYNTHETIC WEAKENING - never applied. The SILENT case: a table created with no GRANT and no
-- REVOKE anywhere. Locally it is unreachable through the Data API and the author concludes it is
-- closed; on cloud it is born with SELECT/INSERT/UPDATE/DELETE for all three roles. Nothing in
-- the migration text says anything about it at all, which is precisely why "not mentioned" has
-- to be a failure rather than a default.
create table public.staging_scratch (
  id uuid primary key,
  payload jsonb not null
);
alter table public.staging_scratch enable row level security;
alter table public.staging_scratch force row level security;
