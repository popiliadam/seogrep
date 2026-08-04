-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. check-rls.sh MUST go RED on this.
alter table public.credit_ledger no force row level security;
