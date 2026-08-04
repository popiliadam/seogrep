-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Regression guard for the ORIGINAL gate power: a new table
-- shipped with no RLS at all. check-rls.sh MUST go RED on this.
create table public.secrets_vault (
  id uuid primary key,
  user_id uuid not null
);
