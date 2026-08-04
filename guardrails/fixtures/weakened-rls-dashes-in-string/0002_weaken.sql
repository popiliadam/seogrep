-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak R4: the two dashes live inside a string literal,
-- so they start no comment - but a scanner that is blind to string literals drops the rest
-- of the line and swallows the real statement that follows on it.
-- check-rls.sh MUST go RED on this.
insert into public.events (kind) values ('rollout--phase-2'); alter table public.credit_ledger disable row level security;
