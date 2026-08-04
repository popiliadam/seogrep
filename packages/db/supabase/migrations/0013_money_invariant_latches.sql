-- Migration 0013 (hostile-audit remediation): three money-invariant latches that move
-- guarantees the app currently ASSERTS BY DISCIPLINE down into the database, where a service
-- bug, a recovery script or a compromised service writer cannot step around them.
--
-- Common root cause of all three (audit M-06 / M-08 / M-07): service_role is the app's only
-- writer, holds broad table privileges by design, and RLS does not apply to it. So for these
-- three invariants the DB was NOT the last word (constitution NEVER #2) — app code was.
--
-- Additive and non-breaking: no table dropped, no RLS disabled, no policy changed, no INSERT
-- privilege revoked (0011:13-18 — revoking INSERT would break every SECURITY INVOKER ledger
-- RPC), and the 0002 credit_ledger append-only armor is untouched.

-- ===========================================================================
-- (1) M-06 — a purchase grant now REQUIRES the webhook event it claims to come from.
--
-- 0007 inserted the ledger row first and then UPDATEd paddle_events, never checking that the
-- update matched a row. A wrong/invented p_event_id therefore minted credits with no webhook
-- evidence behind them and left no audit trail to reconcile against. The event row is the
-- ONLY proof that Paddle actually said this money moved, so it becomes a precondition.
--
-- Placement: after the advisory lock (so the check and the grant are one serialized unit) and
-- BEFORE the ledger insert, so a refusal writes nothing at all rather than relying on rollback.
--
-- RAISE, not `return false`: a silent false is indistinguishable from "already credited" and
-- would let the webhook route answer 200 and close a broken event. The raise surfaces as a 500
-- in the route's existing catch, so processed_at stays NULL and Paddle keeps retrying (B-C1).
-- The live path is unaffected: the route always insertEvent()s before calling this RPC.
--
-- Body is otherwise a verbatim carry-over of 0007 (signature, return type, SECURITY INVOKER,
-- pinned empty search_path, advisory lock, NOT EXISTS grant-once, processed_at stamp).
-- ===========================================================================

create or replace function public.process_paddle_purchase(
  p_event_id text,
  p_user_id uuid,
  p_amount bigint,
  p_ref text
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_granted boolean := false;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount: purchase amount must be positive (got %)', p_amount;
  end if;
  if p_ref is null or p_ref = '' then
    raise exception 'invalid ref: purchase ref must be a non-empty transaction id';
  end if;

  -- Serialize concurrent processing of the SAME ref; released at transaction end. This is
  -- what actually makes the grant single under a retry race — the NOT EXISTS below is the
  -- decision, this lock is what stops two deliveries racing through it.
  perform pg_advisory_xact_lock(hashtext('paddle_purchase:' || p_ref));

  -- Money may only be created against a recorded webhook event (M-06).
  perform 1 from public.paddle_events where event_id = p_event_id;
  if not found then
    raise exception 'unknown paddle event: no paddle_events row for event_id % — refusing to grant an unbacked purchase', p_event_id;
  end if;

  insert into public.credit_ledger (user_id, delta, kind, reason, job_id)
  select p_user_id, p_amount, 'purchase', 'paddle', p_ref
  where not exists (
    select 1 from public.credit_ledger where kind = 'purchase' and job_id = p_ref
  );
  v_granted := found; -- FOUND is true iff the INSERT wrote a row (ref not seen before).

  -- Same transaction: close the event whether or not THIS delivery granted. A duplicate
  -- delivery (ref already credited) still leaves its event row correctly marked processed.
  update public.paddle_events set processed_at = now() where event_id = p_event_id;

  return v_granted;
end;
$$;

-- CREATE OR REPLACE preserves privileges; re-stated so a from-scratch rebuild of this file's
-- posture is self-evident and cannot drift from 0007.
revoke execute on function public.process_paddle_purchase(text, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.process_paddle_purchase(text, uuid, bigint, text) to service_role;
-- Reverse: re-apply the 0007 body (drop the paddle_events precondition block).

-- ===========================================================================
-- (2) M-08 — paddle_events identity/audit columns become immutable.
--
-- paddle_events is two things at once: the idempotency key store (a replayed event_id must
-- always resolve to the same already-processed row) and the forensic record of what Paddle
-- actually sent. 0006:49-51 grants service_role table-wide UPDATE because the app must stamp
-- processed_at — which incidentally allowed rewriting event_id (re-opening a closed event for
-- a replay), event_type or payload (editing the audit trail after the fact).
--
-- This is DELIBERATELY NOT the 0002/0003 blanket armor (`REVOKE UPDATE` + reject_mutation on
-- every op): processed_at MUST stay writable or markProcessed breaks. The trigger narrows the
-- existing grant to exactly the one column the app legitimately writes. INSERT is untouched —
-- every webhook delivery depends on it.
--
-- created_at is included for the same reason as payload: it is part of the forensic record,
-- and no writer ever changes it (insertEvent upserts with ignoreDuplicates, i.e. ON CONFLICT
-- DO NOTHING, so a retry never reaches UPDATE).
-- ===========================================================================

create function public.reject_paddle_event_identity_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'paddle_events row is immutable: DELETE blocked (removing a processed event would re-open it for replay)';
  end if;
  if new.event_id is distinct from old.event_id
    or new.event_type is distinct from old.event_type
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at
  then
    raise exception 'paddle_events identity is immutable: only processed_at may change (event_id/event_type/payload/created_at are the idempotency key and audit record)';
  end if;
  return new;
end;
$$;
-- Reverse: drop function public.reject_paddle_event_identity_change() cascade;

create trigger paddle_events_identity_immutable
  before update or delete on public.paddle_events
  for each row execute function public.reject_paddle_event_identity_change();
-- Reverse: drop trigger paddle_events_identity_immutable on public.paddle_events;

-- Privilege layer under the trigger. UPDATE is NOT revoked (processed_at needs it) and INSERT
-- is NOT revoked (0011:13-18). DELETE/TRUNCATE are revoked because nothing in the codebase
-- deletes or truncates this table: on a migrations-built stack this is a no-op, but the cloud
-- project still carries legacy auto-grants (the rebuild-parity gap 0012 documented in the
-- other direction), so this is what actually closes the hole there. TRUNCATE needs the REVOKE
-- specifically — a row-level trigger does not fire on TRUNCATE.
REVOKE DELETE, TRUNCATE ON public.paddle_events FROM anon, authenticated, service_role;
-- Reverse: grant delete, truncate on public.paddle_events to service_role; (anon/authenticated
-- never legitimately held either — do NOT restore them.)

-- ===========================================================================
-- (3) M-07 — users_profile.trial_granted_at becomes a ONE-WAY latch.
--
-- claim_trial's entire "exactly once" guarantee is `UPDATE ... WHERE trial_granted_at IS NULL`
-- (0009:115-121). 0006:24 grants service_role table-wide UPDATE, so the lock was reversible:
-- clearing the column re-armed the free trial and a second grant became claimable for the same
-- user. Free credits are money, so the latch belongs in the DB, not in caller discipline.
--
-- One-way, not frozen: NULL -> value is the legitimate first claim and stays allowed, and the
-- trigger is scoped by a WHEN clause so updates to any other column (notably the 0008
-- welcomed_at lock) never even enter the function. Moving the stamp FORWARD is left allowed —
-- it unlocks nothing; only clearing it or dating it backwards does.
-- ===========================================================================

create function public.reject_trial_lock_reversal() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trial_granted_at is null or new.trial_granted_at < old.trial_granted_at then
    raise exception 'trial_granted_at is a one-way latch: the one-time trial lock cannot be cleared or moved backwards (locked at %, attempted %)', old.trial_granted_at, new.trial_granted_at;
  end if;
  return new;
end;
$$;
-- Reverse: drop function public.reject_trial_lock_reversal() cascade;

create trigger users_profile_trial_latch
  before update on public.users_profile
  for each row
  when (old.trial_granted_at is not null and new.trial_granted_at is distinct from old.trial_granted_at)
  execute function public.reject_trial_lock_reversal();
-- Reverse: drop trigger users_profile_trial_latch on public.users_profile;
