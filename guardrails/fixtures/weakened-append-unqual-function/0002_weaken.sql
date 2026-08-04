-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak c22: the triggers and the REVOKEs are untouched,
-- but the function they execute is REPLACED with a no-op under an UNQUALIFIED name -
-- search_path resolves it to public.reject_mutation all the same.
-- Measured on postgres 17.6: base + this file leaves prosrc without RAISE and a plain
-- UPDATE on public.credit_ledger returns "UPDATE 1" - the append-only armor is dead.
-- check-append-only.sh MUST go RED on this.
set search_path = public;
create or replace function reject_mutation() returns trigger language plpgsql as $$
begin return new; end $$;
