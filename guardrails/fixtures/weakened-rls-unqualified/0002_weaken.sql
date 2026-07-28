-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak R6: after SET search_path the table needs no
-- schema qualification, and a gate that only ever matched "public." never sees it.
-- check-rls.sh MUST go RED on this.
set search_path = public;
alter table credit_ledger disable row level security;
