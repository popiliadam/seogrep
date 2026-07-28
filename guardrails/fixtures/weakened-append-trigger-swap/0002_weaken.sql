-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. A trigger with the same name and the same
-- BEFORE UPDATE OR DELETE timing survives, but it now executes a permissive function.
-- check-append-only.sh MUST go RED on this.
create or replace function public.allow_mutation() returns trigger language plpgsql as $$
begin return new; end $$;

drop trigger credit_ledger_append_only on public.credit_ledger;
create trigger credit_ledger_append_only before update or delete on public.credit_ledger
  for each row execute function public.allow_mutation();
