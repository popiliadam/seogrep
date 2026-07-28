-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. Residual leak c18, the sibling of R4: inside an E'' escape
-- string a backslash escapes the quote, so \' does NOT end the literal. A scanner that
-- treats it as the terminator thinks the two dashes that follow start a comment, drops the
-- rest of the LINE, and swallows the real statement sharing that line.
-- Measured on postgres 17.6: base + this file leaves pg_class.relrowsecurity = false on
-- public.credit_ledger - the swallowed ALTER really does execute.
-- check-rls.sh MUST go RED on this.
insert into public.events (kind) values (E'rollout\'--phase-2'); alter table public.credit_ledger disable row level security;
