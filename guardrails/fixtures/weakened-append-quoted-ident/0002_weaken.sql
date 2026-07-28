-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak R7, append-only side: same quoted-identifier
-- blind spot, aimed at the trigger and at the privileges instead of at RLS.
-- Measured on postgres 17.6: base + this file lets a plain UPDATE on public.credit_ledger
-- succeed (the trigger is off) and leaves UPDATE on public.events granted to authenticated.
-- check-append-only.sh MUST go RED on this.
alter table public."credit_ledger" disable trigger credit_ledger_append_only;
grant update on public."events" to authenticated;
