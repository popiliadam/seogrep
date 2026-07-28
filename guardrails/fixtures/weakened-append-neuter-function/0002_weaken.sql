-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Triggers and REVOKEs are untouched, but the function they
-- execute is replaced with a no-op. check-append-only.sh MUST go RED on this.
create or replace function public.reject_mutation() returns trigger language plpgsql as $$
begin return new; end $$;
