-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak R3: ALTER TABLE [ IF EXISTS ] [ ONLY ] is
-- PostgreSQL's own keyword order, but the gate only recognised ONLY before IF EXISTS.
-- Unusual spelling, fully valid statement.
-- check-rls.sh MUST go RED on this.
alter table if exists only public.credit_ledger disable row level security;
