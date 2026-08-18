-- SYNTHETIC FIXTURE - never applied, and expected GREEN. The LIFECYCLE axis: a table created
-- and then dropped in the same migration set no longer exists in the final state, so demanding
-- revokes for it would be a false RED that no author could ever satisfy. The gate judges the
-- FINAL state, the way check-rls.sh and check-append-only.sh do.
create table public.temp_backfill (
  id uuid primary key
);
grant select, insert on public.temp_backfill to service_role;
drop table public.temp_backfill;
