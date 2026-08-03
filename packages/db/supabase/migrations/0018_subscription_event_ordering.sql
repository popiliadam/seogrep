-- Migration 0018 (hostile-audit remediation, M-03): subscription events get an ORDERING key,
-- and applying one becomes a conditional, ATOMIC, newest-by-OCCURRENCE write.
--
-- The hole: Paddle guarantees delivery, not ORDER. A subscription.updated(status=active) that
-- OCCURRED at 11:00 can be delivered AFTER the subscription.canceled that occurred at 12:00 — a
-- retry after a timeout, a queue reorder, a backlog drain. That late event carries its OWN
-- event_id, so the paddle_events idempotency gate (0003/0013) correctly waves it through as a
-- first delivery, and the app's unconditional `upsert(..., onConflict: paddle_subscription_id)`
-- then overwrote plan / status / current_period_end wholesale. A cancelled subscription came
-- back to life as active, and the billing period rolled backwards with it.
--
-- Why this is SQL and not TypeScript: "read the stored occurred_at, compare, then write" is two
-- statements with a gap between them. Two concurrent deliveries both read the old watermark,
-- both decide they are newer, and both write — the loser landing last. The comparison has to
-- happen INSIDE the write. Postgres has exactly that shape: INSERT ... ON CONFLICT DO UPDATE
-- ... WHERE, evaluated with the conflicting row already locked. supabase-js `.upsert()` cannot
-- express that WHERE, so the operation moves into a function the repo calls.
--
-- Additive and non-breaking: one nullable column, one new function. No table dropped, no RLS
-- enabled/disabled, no policy changed, no privilege revoked, credit_ledger untouched. paddle_events
-- is deliberately NOT touched — its 0013 identity armor (event_id/event_type/payload/created_at
-- immutable, processed_at the only writable column) must keep holding, and it does: the raw
-- occurred_at is already inside the stored `payload`, so nothing there needed to change.

-- ===========================================================================
-- (1) The watermark column.
--
-- Nullable, and nullable ON PURPOSE. Rows that existed before this migration have no recorded
-- occurrence, and a backfill would have to INVENT one: created_at is when WE wrote the row, not
-- when Paddle says the event happened, and stamping now() would freeze every legacy row against
-- its own future events. NULL says exactly what is true — "unordered" — and the rule below makes
-- that state recoverable: the next dated event takes over and installs a real watermark.
-- ===========================================================================

alter table public.subscriptions add column occurred_at timestamptz;
-- Reverse: alter table public.subscriptions drop column occurred_at;

comment on column public.subscriptions.occurred_at is
  'Paddle occurred_at of the newest subscription event applied to this row — the ordering watermark. NULL means UNORDERED (a row predating migration 0018, or one created by an event with no usable occurred_at), never "oldest possible". See public.apply_subscription_event().';

-- ===========================================================================
-- (2) apply_subscription_event — the only way subscription state should be written.
--
-- Returns TRUE when this event was applied (inserted, or updated because it is strictly newer),
-- FALSE when it was refused as stale / tied / unorderable. FALSE is a normal outcome, not an
-- error: the caller has handled the event correctly by declining to regress state, so the
-- webhook still stamps it processed and answers 200 instead of provoking a Paddle retry storm.
--
-- The three rules encoded in the ON CONFLICT ... WHERE, in order:
--
--   a) `excluded.occurred_at is not null` — an event with NO usable ordering key may CREATE a
--      row (the insert path is untouched by this clause; a first-ever row is better than no
--      state, and it lands with occurred_at NULL, i.e. honestly marked unordered) but may NEVER
--      overwrite an existing one. It has no evidence it is newest, so it does not get to act
--      like it is. Fail-safe, and the mirror of the core-side record_only for the same case.
--
--   b) `s.occurred_at is null` — an UNORDERED stored row yields to any dated event. This is what
--      keeps rule (a) from freezing legacy rows forever.
--
--   c) `excluded.occurred_at > s.occurred_at` — STRICTLY newer wins, so an equal occurred_at is
--      a tie that changes nothing. Deliberate: the overwhelmingly common tie is the same event
--      redelivered — identical timestamp, identical content — so ignoring it makes the operation
--      a true no-op and idempotent. Two genuinely distinct events stamped at the same instant
--      carry no evidence of which is newer, and letting arrival order break the tie is exactly
--      the coin-flip this migration exists to remove; keeping what is already stored is at least
--      deterministic. KNOWN LIMIT, stated plainly: same-instant distinct events are therefore
--      resolved first-applied-wins, not by any semantic precedence between statuses.
--
-- SECURITY INVOKER (the default — no `security definer` here): the function grants no privilege
-- the caller does not already hold. service_role's existing INSERT/UPDATE on subscriptions
-- (0006) is what makes the write legal; anon/authenticated keep only the SELECT-own policy from
-- 0001 and cannot execute this at all (revoke below). search_path is pinned empty and every
-- object is schema-qualified, matching 0007/0013.
-- ===========================================================================

create function public.apply_subscription_event(
  p_user_id uuid,
  p_paddle_subscription_id text,
  p_plan text,
  p_status text,
  p_current_period_end timestamptz,
  p_occurred_at timestamptz
) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_paddle_subscription_id is null or p_paddle_subscription_id = '' then
    raise exception 'invalid subscription id: apply_subscription_event needs a non-empty paddle_subscription_id';
  end if;

  insert into public.subscriptions as s
    (user_id, paddle_subscription_id, plan, status, current_period_end, occurred_at)
  values
    (p_user_id, p_paddle_subscription_id, p_plan, p_status, p_current_period_end, p_occurred_at)
  on conflict (paddle_subscription_id) do update
    set user_id            = excluded.user_id,
        plan               = excluded.plan,
        status             = excluded.status,
        current_period_end = excluded.current_period_end,
        occurred_at        = excluded.occurred_at
    where excluded.occurred_at is not null
      and (s.occurred_at is null or excluded.occurred_at > s.occurred_at);

  -- FOUND is true iff the statement affected a row: inserted, or updated because the WHERE
  -- above held. A refused (stale/tied/unorderable) conflict affects nothing and returns false.
  return found;
end;
$$;
-- Reverse: drop function public.apply_subscription_event(uuid, text, text, text, timestamptz, timestamptz);

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Narrow it to the one role that owns this
-- write path — the webhook route's service-role client — exactly as 0007/0013 do for the
-- purchase RPC. Subscription state is billing state; no browser session gets to author it.
revoke execute on function public.apply_subscription_event(uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_subscription_event(uuid, text, text, text, timestamptz, timestamptz) to service_role;
-- Reverse: grant execute on function public.apply_subscription_event(uuid, text, text, text, timestamptz, timestamptz) to public;
