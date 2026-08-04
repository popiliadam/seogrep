-- Migration 0019 (hostile-audit remediation, M-09): the database refuses to let a NEGATIVE
-- `adjust` drive a user's balance below zero — unless the row says, in writing, that it means to.
--
-- THE CONTRADICTION THIS RESOLVES. Three places in this repo disagreed about whether a balance
-- may go negative:
--
--   packages/core/src/billing/ledger.ts:97-104  throws on an adjust that would go below zero
--   goals/ledger-integrity.md                    asserts `balance >= 0` as a permanent goal
--   0011:20-33 + ledger-shape.db.test.ts:150-156 deliberately left `adjust` UNBOUNDED, and the
--                                                test PINNED that looseness as accepted behaviour
--
-- So the invariant was real in the app and absent in the DB, and the DB is the last word
-- (constitution NEVER #2). Measured on a clean 0001-0018 local stack (2026-08-03), against a
-- balance of 100:
--
--   insert into public.credit_ledger (user_id, delta, kind, reason) values (…, -500, 'adjust', 'typo');
--   INSERT 0 1                      <-- accepted
--   select coalesce(sum(delta),0) …
--    balance_after
--   ---------------
--             -400
--
-- service_role holds direct INSERT on this table by design (0011:13-18 — revoking it would break
-- every SECURITY INVOKER ledger RPC), so the only thing standing between that row and a negative
-- balance was caller discipline. Nothing in apps/ or packages/ writes an `adjust` row at all
-- (`adjust` appears only in the core state machine and as a UI label), which is precisely why it
-- matters: every `adjust` that will ever exist is typed by a human or a recovery script, at a
-- console, against production.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT. A CHECK sees one row. This rule is about the SUM of
-- every row for that user, which a CHECK cannot reach. It is also not a static predicate: the same
-- `-500` is legal at a balance of 500 and illegal at 100.
--
-- WHY AN ESCAPE HATCH, AND WHY IT IS AN OPT-IN MARKER. A blanket `balance >= 0` would break the
-- one legitimate case: clawing back credit that was granted by mistake and has already been partly
-- spent NECESSARILY lands below zero. Refusing it would leave the mistaken grant permanently on the
-- books — worse than the negative balance. So the rule stops what nobody intends (a typo, a service
-- bug, a script with a sign error) and stands aside for what somebody explicitly decided: a `reason`
-- beginning `override:`. That marker is not a bypass flag hidden in a config — it is stored on the
-- row itself, forever, in an append-only table, so every deliberate negative balance carries its own
-- audit trail and `where reason like 'override:%'` enumerates them all.
--
-- POSTURE UNCHANGED. credit_ledger stays APPEND-ONLY: this is a BEFORE INSERT trigger only. No
-- UPDATE or DELETE capability is added, the 0002 armor (REVOKE UPDATE/DELETE/TRUNCATE + the
-- credit_ledger_append_only reject_mutation trigger) is untouched, no RLS is enabled or disabled,
-- no policy is added or changed, and no grant is altered. The 0011 CHECK constraints are untouched
-- and still say exactly what they said: `adjust` remains unconstrained on delta SIGN and on
-- reserve_id. What is added is a different rule, at a different layer, about a different thing —
-- the resulting SUM.

-- ===========================================================================
-- (1) The guard function.
--
-- THE LOCK IS THE POINT, NOT THE COMPARISON. "Read the balance, then decide" is two operations
-- with a gap. Without serialization, eight concurrent `-30` adjusts against a balance of 100 all
-- read 100, all conclude `100 - 30 >= 0`, and all eight land — balance -140. Measured, not
-- assumed: that is exactly what the pre-fix run of the concurrency spec produced (8 accepted).
--
-- The key is `hashtext(user_id::text)` — DELIBERATELY the same key space 0005 reserve_credits /
-- commit_reserve / release_reserve already use, not a private one. That buys a second guarantee
-- for free: a negative adjust cannot slip into the window between reserve_credits' balance read
-- and its insert, because they contend for the same lock. A private key would have left that race
-- open. The lock is transaction-scoped (released at commit/abort) and re-entrant within a
-- transaction, so an adjust emitted from inside a function that already holds it cannot self-block.
--
-- Snapshot semantics: this is a VOLATILE plpgsql function, so in READ COMMITTED each statement
-- inside it takes a FRESH snapshot. The waiter therefore sees the winner's committed row after the
-- lock is released, rather than the stale sum it read before blocking. Proven by the concurrency
-- spec (exactly 3 of 8 accepted, balance 10), not by reading this paragraph.
--
-- A MULTI-ROW SINGLE STATEMENT IS ALSO COVERED — and this was checked rather than reasoned about,
-- because the reasoning gets it wrong. The plausible worry is that rows of the CURRENT statement
-- are not yet visible, so `insert ... values (a),(b)` would judge both against the pre-statement
-- balance and let both through. Measured on this migration, three rows in one statement against a
-- balance of 100:
--
--   insert into public.credit_ledger (…) values (…,-60,'adjust',…), (…,-30,'adjust',…), (…,-30,'adjust',…);
--   ERROR:  insufficient balance: adjust -30 would drive the balance below zero (current balance 10)
--
-- The third row saw the first two. A BEFORE ROW trigger runs with the command counter advanced past
-- the rows the current command has already inserted, so each row is judged against the running
-- total, not the pre-statement one. An operator batching corrections is therefore held to the same
-- rule as an operator typing them one at a time. Pinned by ledger-shape.db.test.ts so a future
-- Postgres or a rewrite to AFTER-STATEMENT cannot quietly lose it.
-- ===========================================================================

create function public.reject_ledger_negative_balance() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  -- Serialize against the other PER-USER money decisions; released at transaction end.
  -- Same key space as the 0005 trio (reserve_credits / commit_reserve / release_reserve), which
  -- also lock hashtext(user). Measured: an in-flight unmarked adjust blocks reserve_credits, which
  -- is exactly the point of sharing the key.
  --
  -- NOT shared with process_paddle_purchase (0007): that one locks
  -- hashtext('paddle_purchase:' || p_ref) — a per-REF key, deliberately, so two deliveries of the
  -- same purchase serialize while unrelated purchases do not. So a purchase does NOT serialize
  -- against this guard. That is safe in one direction only, and the reason is worth stating: a
  -- purchase is a CREDIT, so racing it can only make this guard read a lower balance and refuse
  -- conservatively — it can never make it accept something it should have refused. A refusal is a
  -- loud error the operator retries; a wrong acceptance would be silent money.
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));

  select coalesce(sum(delta), 0) into v_balance
  from public.credit_ledger
  where user_id = new.user_id;

  if v_balance + new.delta < 0 then
    raise exception
      'insufficient balance: adjust % would drive the balance below zero (current balance %). If this correction is deliberate, prefix reason with "override:" — the marker is stored on the row as its audit trail.',
      new.delta, v_balance;
  end if;

  return new;
end;
$$;
-- Reverse: drop function public.reject_ledger_negative_balance() cascade;

-- ===========================================================================
-- (2) The trigger, and the WHEN clause that keeps the hot path free.
--
-- The WHEN clause is load-bearing, not decoration. PostgreSQL evaluates it BEFORE calling the
-- function, so for every row that is not a below-zero-capable adjust the function is never
-- entered: no advisory lock, no SUM(delta), nothing. `spend_reserve` / `spend_commit` /
-- `spend_release` / `grant` / `purchase` — the entire live money path — pay exactly one boolean
-- expression, and reserve_credits keeps being the single place that reads a balance under a lock.
--
-- The three conjuncts, each doing one job:
--   kind = 'adjust'            the operator path, and the only kind 0011 left unbounded
--   delta < 0                  a positive or zero adjust cannot reduce a balance
--   reason not like 'override:%'   the deliberate-correction escape hatch
--
-- `reason is null or reason not like …` is spelled out because `NULL not like …` is NULL, not
-- true, and a NULL-reason WHEN clause would then evaluate to NULL and NOT fire — i.e. omitting
-- the reason entirely would silently bypass the guard. That is the exact opposite of the
-- intended default. LIKE with a leading anchor and no wildcard before it is a strict PREFIX
-- test: "customer asked for an override: refund" is NOT a marker.
-- ===========================================================================

create trigger credit_ledger_adjust_no_negative_balance
  before insert on public.credit_ledger
  for each row
  when (
    new.kind = 'adjust'
    and new.delta < 0
    and (new.reason is null or new.reason not like 'override:%')
  )
  execute function public.reject_ledger_negative_balance();
-- Reverse: drop trigger credit_ledger_adjust_no_negative_balance on public.credit_ledger;

-- ===========================================================================
-- (3) CLOUD APPLY — read the pre-check, but this migration CANNOT fail on data.
--
-- Unlike 0017 (whose ADD CONSTRAINTs validate every existing row and abort on the first
-- violation), CREATE FUNCTION and CREATE TRIGGER inspect no data at all: 0019 applies cleanly
-- against any contents whatsoever, including a database that already holds negative balances.
-- Nothing here has to be resolved before apply.
--
-- The pre-check below is therefore not an apply gate — it is the answer to the question the
-- operator will ask FIRST AFTERWARDS: "whose next correction is this going to refuse?" Any
-- account already at a negative balance will have its next unmarked negative adjust rejected,
-- because the rule is about the RESULTING sum. That is correct behaviour and it is also a
-- surprise if nobody looked. Copy-paste, read-only, run against the live DB.
--
--   -- (a) accounts already below zero — these are where the new refusals will land.
--   select user_id, balance from public.credit_balances where balance < 0 order by balance;
--
--   -- (b) how much history the new rule would have refused, had it always existed. A non-zero
--   --     count is not a problem to fix; it is the size of the operator habit being changed.
--   select count(*) as negative_adjust_rows,
--          count(*) filter (where reason like 'override:%') as already_marked
--     from public.credit_ledger where kind = 'adjust' and delta < 0;
--
-- Expected on the live project at time of writing: (a) empty, (b) 0 / 0 — nothing in apps/ or
-- packages/ has ever written an `adjust` row.
-- ===========================================================================
