-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. The trigger still EXISTS but no longer fires.
-- check-append-only.sh MUST go RED on this.
alter table public.credit_ledger disable trigger credit_ledger_append_only;
