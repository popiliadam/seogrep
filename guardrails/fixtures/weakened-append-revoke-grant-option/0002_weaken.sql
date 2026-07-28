-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak R1: REVOKE GRANT OPTION FOR only takes away the
-- right to re-grant; the UPDATE privilege itself SURVIVES on authenticated. A parser that
-- treats it as a plain REVOKE reports a false GREEN.
-- check-append-only.sh MUST go RED on this.
grant update on public.credit_ledger to authenticated with grant option;
revoke grant option for update on public.credit_ledger from authenticated;
