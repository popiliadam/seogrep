-- Migration 0007: process_paddle_purchase — the single money-critical webhook write.
--
-- For one transaction.completed event the Paddle webhook (T7) must do TWO things that can
-- never diverge: (a) append the purchase to credit_ledger, (b) stamp the paddle_events row
-- processed. As two separate statements a crash between them would either DOUBLE-GRANT (a
-- retry re-runs the grant) or LOSE credits (a retry sees the event already processed and
-- skips the grant). This function fuses them into ONE transaction and makes the grant
-- idempotent on the external transaction ref, so a retry after a half-completed attempt is
-- always safe (grant-once, then close the event).
--
-- Concurrency: two deliveries of the same event can both reach here after a prior crash
-- left processed_at NULL. INSERT ... SELECT ... WHERE NOT EXISTS is NOT race-safe on its own
-- under READ COMMITTED (both could see "not exists" and both insert). A per-ref advisory
-- lock — the same pg_advisory_xact_lock pattern the ledger functions use in 0005 — serializes
-- same-ref processing, so a ref is credited at most once. This closes the chef's stated intent
-- (NEVER #2: append-only ledger, balance integrity) that the NOT EXISTS guard alone leaves open.
--
-- SECURITY INVOKER (default): the sole caller is service_role via the PostgREST RPC (the
-- webhook route); EXECUTE is granted to service_role only. search_path = '' + fully
-- schema-qualified names (0005 hardening pattern). It only INSERTs credit_ledger (append-only
-- armor untouched) and UPDATEs paddle_events (service_role holds UPDATE there since 0006).

create function public.process_paddle_purchase(
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

revoke execute on function public.process_paddle_purchase(text, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.process_paddle_purchase(text, uuid, bigint, text) to service_role;
