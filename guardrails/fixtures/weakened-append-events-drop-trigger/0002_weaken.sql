-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Proves public.events armor is in scope (0003 arms it).
-- check-append-only.sh MUST go RED on this.
drop trigger events_append_only on public.events;
