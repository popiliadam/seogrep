-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak R7: the table name is a QUOTED identifier, so
-- the "public.<bare-word>" shapes the gate matched never fire - while PostgreSQL applies
-- the statement exactly as if the quotes were absent.
-- Measured on postgres 17.6: base + this file leaves pg_class.relrowsecurity = false on
-- public.credit_ledger, i.e. the armor is really gone.
-- check-rls.sh MUST go RED on this.
alter table public."credit_ledger" disable row level security;
