-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. check-append-only.sh MUST go RED on this.
drop trigger credit_ledger_append_only on public.credit_ledger;
