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
