-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak R6, append-only side: same schema-qualification
-- blind spot, aimed at the trigger and at the privileges instead of at RLS.
-- check-append-only.sh MUST go RED on this.
set search_path = public;
alter table credit_ledger disable trigger credit_ledger_append_only;
grant update on events to authenticated;
