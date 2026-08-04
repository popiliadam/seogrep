-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Proves BOTH that public.events is in scope and that
-- GRANT ALL counts as granting UPDATE/DELETE/TRUNCATE.
-- check-append-only.sh MUST go RED on this.
grant all on public.events to authenticated;
