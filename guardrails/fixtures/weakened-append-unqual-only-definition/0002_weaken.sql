-- SYNTHETIC WEAKENING - never applied. Layered on top of fixtures/healthy by
-- check-guards-selftest.sh. This is the TRAP that guards the c22 fix, not a new leak: the
-- tree's ONLY surviving definition of reject_mutation is unqualified, and it DOES raise.
-- The gate is RED here for the right reason - "not defined in the final state" - because a
-- static reader cannot prove that an unqualified CREATE landed in public.
--
-- The naive way to close c22 (accept an unqualified CREATE as a definition) turns this case
-- from RED to GREEN, which is a LOSS of coverage. So the c22 fix is red-only-directional:
-- an unqualified CREATE may CLEAR fnraise, it may never SET fnexists.
-- Measured on postgres 17.6: CASCADE also takes both append-only triggers with it
-- (append_only_triggers = 0), so the armor really is gone here too.
-- check-append-only.sh MUST go RED on this, BEFORE and AFTER the c22 fix.
drop function public.reject_mutation() cascade;
set search_path = public;
create or replace function reject_mutation() returns trigger language plpgsql as $$
begin raise exception 'append-only table: % blocked on %', TG_OP, TG_TABLE_NAME; end $$;
