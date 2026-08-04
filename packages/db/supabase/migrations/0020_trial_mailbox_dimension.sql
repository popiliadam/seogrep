-- Migration 0020 (hostile-audit remediation, H-06): give the one-time signup trial a SECOND
-- dimension — the MAILBOX the signup address reaches — beside `auth.uid`.
--
-- WHAT WAS MEASURED, on a clean 0001-0019 local stack (2026-08-03), not inferred:
--
--   account A : redteam.h06.<t>@gmail.com        claim_trial(A, 200) -> true
--   account B : redteam.h06.<t>+free2@gmail.com  claim_trial(B, 200) -> true
--   credit_ledger: TWO grant/trial rows, 400 credits, from ONE real inbox.
--
-- 0009 keys the trial on `p_user_id` alone and 0006's `trial_granted_at` is a per-ROW lock, so
-- every rule already in place answers "has THIS uid claimed?" and none of them answers "has this
-- MAILBOX claimed?". Plus-aliasing (RFC 5233 sub-addressing) mints uids for free, so the trial
-- was effectively unlimited. 0013 (one-way latch) and 0015 (row-removal armor) closed the two
-- ways to re-arm an EXISTING lock; this closes the way to sidestep it with a NEW uid.
--
-- A NEW TABLE, NOT A COLUMN ON users_profile: a fingerprint column plus a unique index would
-- work, but it would hang a new uniqueness constraint off the exact row 0013's latch trigger and
-- 0015's DELETE/TRUNCATE revoke exist to protect. A separate table cannot weaken either — both
-- are untouched by this file — and it cannot fail on live data (see (4)).
--
-- THE NORMALISER IS NOT HERE, DELIBERATELY. `p_email_fingerprint` comes from packages/core
-- `trialEmailIdentity()`. Re-implementing those rules in PL/pgSQL would give a money decision
-- two sources of truth, and they are conservative on purpose: dots are folded only where they
-- are genuinely insensitive (gmail), because merging two DIFFERENT REAL PEOPLE would deny the
-- second the 200 credits the site advertises.
--
-- BACKWARD COMPATIBLE BY CONSTRUCTION. The web caller is NOT touched by this slice and keeps
-- calling `claim_trial(p_user_id, p_amount)`. With no fingerprint the function takes exactly
-- the 0009 path, so today's behaviour is preserved until a later slice wires the caller.

-- ===========================================================================
-- (1) trial_claims — one row per MAILBOX that has consumed a trial.
--
-- `user_id` is ON DELETE SET NULL, not CASCADE, and that is load-bearing: under CASCADE,
-- deleting the auth user would take the fingerprint with it and the mailbox could claim again —
-- the re-arming hole 0015 had to shut on users_profile. SET NULL keeps the fact ("this mailbox
-- consumed a trial") and drops the link to the person, which is also the more private state.
-- Erasing a fingerprint is therefore a deliberate act by the table owner, not something the app
-- role can do (see the REVOKE below).
--
-- `email_domain` / `disposable_domain` are the RECORDED SIGNAL, never a gate — nothing reads
-- them back to decide anything. A curated disposable list has real false positives, and denying
-- a legitimate user their advertised trial is worse than granting one to a throwaway address.
-- The domain sits next to the flag so a false positive is diagnosable (and correctable in
-- packages/core) rather than an anonymous count. `collision_count` is the other half of that
-- visibility — 40 collisions is farming, 1 may be a real person wrongly merged — and is bounded
-- by construction: one row per mailbox, not one per attempt.
-- ===========================================================================
create table public.trial_claims (
  email_fingerprint text primary key,
  user_id uuid references auth.users (id) on delete set null,
  email_domain text,
  disposable_domain boolean not null default false,
  -- When the FINGERPRINT was recorded, which for a pre-0020 user backfilled by a later
  -- re-claim is LATER than their credit_ledger grant. The ledger stays the money record.
  recorded_at timestamptz not null default now(),
  collision_count integer not null default 0,
  last_collision_at timestamptz
);
-- Reverse: drop table public.trial_claims;

alter table public.trial_claims enable row level security;
alter table public.trial_claims force row level security;

-- No policy and no anon/authenticated grant: this table is operator + service_role only. One
-- user must not be able to probe whether a mailbox hash has claimed. service_role needs UPDATE
-- for the collision bump only.
grant select, insert, update on public.trial_claims to service_role;

-- Same armor 0015 put on users_profile, for the same reason: removing a row here re-arms the
-- trial for that mailbox. DELETE is granted to no one and TRUNCATE is revoked explicitly rather
-- than left to 0016's ALTER DEFAULT PRIVILEGES, so the posture is readable at the table that
-- needs it. The FK's ON DELETE SET NULL is a system action and is unaffected by either.
REVOKE DELETE, TRUNCATE ON public.trial_claims FROM anon, authenticated, service_role;

-- The operator's read of the recorded signal. Deliberately UNINDEXED: one row per mailbox is a
-- small table and this is an occasional human query, so an index would be schema weight on the
-- money path for no measured need.
--   select email_domain, count(*), sum(collision_count) from public.trial_claims
--    where disposable_domain group by 1 order by 2 desc;

-- ===========================================================================
-- (2) claim_trial gains the dimension. DROP + CREATE, not an added overload.
--
-- MEASURED, not assumed: adding `claim_trial(uuid, bigint, text, text, boolean)` ALONGSIDE the
-- 0009 `claim_trial(uuid, bigint)` is accepted by CREATE FUNCTION and then breaks the existing
-- caller at CALL time — `ERROR: function claim_trial(uuid, bigint) is not unique`. With the old
-- signature dropped there is exactly one candidate, and the two-argument call PostgREST issues
-- for the untouched web caller's `{p_user_id, p_amount}` body resolves to it with the defaults
-- filled in. Nothing else in the schema depends on the old signature.
--
-- ORDER OF OPERATIONS IS THE WHOLE CORRECTNESS ARGUMENT. The mailbox claim is taken BEFORE the
-- `trial_granted_at` UPDATE. Taking it after would flip the lock and then return false on a
-- collision, committing exactly the locked-but-creditless state 0009 exists to make unreachable.
-- A refused caller is left as it was: no lock, no ledger row.
--
-- `insert ... on conflict do nothing` is the race-proof form: a concurrent second claimant blocks
-- on the row, finds it committed, inserts nothing, and `FOUND` is false — so a collision returns
-- a clean `false` instead of a unique violation that would abort the transaction.
--
-- The no-EXCEPTION-block rule from 0009 still holds and for the same reason: any raise must
-- abort the whole body so the mailbox row, the lock and the grant can never land apart.
-- ===========================================================================
drop function public.claim_trial(uuid, bigint);
-- Reverse: see 0009:95-133 for the original two-argument body and grants.

create function public.claim_trial(
  p_user_id uuid,
  p_amount bigint,
  p_email_fingerprint text default null,
  p_email_domain text default null,
  p_disposable_domain boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount: trial grant amount must be positive (got %)', p_amount;
  end if;

  -- Ensure the 1:1 profile row exists before the lock UPDATE (mirrors the app upsert): a
  -- missing row would match 0 rows and be indistinguishable from "already granted".
  insert into public.users_profile (id)
  values (p_user_id)
  on conflict (id) do nothing;

  -- Second dimension. Skipped entirely when no fingerprint is supplied, which is what makes
  -- the 0009 two-argument calling convention behave exactly as it did before this migration.
  -- An empty string is treated as absent: a caller that computed nothing must not be able to
  -- claim the '' mailbox and lock every later empty-fingerprint caller out of the trial.
  if p_email_fingerprint is not null and p_email_fingerprint <> '' then
    insert into public.trial_claims (email_fingerprint, user_id, email_domain, disposable_domain)
    values (p_email_fingerprint, p_user_id, p_email_domain, coalesce(p_disposable_domain, false))
    on conflict (email_fingerprint) do nothing;

    if not found then
      -- This mailbox already consumed a trial. Record the attempt for the operator (a
      -- self-re-claim by the holder is not a collision and is deliberately not counted), then
      -- refuse WITHOUT touching the lock or the ledger.
      update public.trial_claims
      set collision_count = collision_count + 1,
          last_collision_at = now()
      where email_fingerprint = p_email_fingerprint
        and user_id is distinct from p_user_id;
      return false;
    end if;
  end if;

  -- Atomic one-time per-uid lock, unchanged from 0009: only the first caller flips NULL -> now.
  update public.users_profile
  set trial_granted_at = now()
  where id = p_user_id and trial_granted_at is null;

  if not found then
    return false; -- already granted — idempotent no-op.
  end if;

  -- Same transaction as the lock: append the trial grant. A raise here rolls the lock AND the
  -- mailbox row back with it, so a user is never left locked-but-creditless.
  insert into public.credit_ledger (user_id, delta, kind, reason)
  values (p_user_id, p_amount, 'grant', 'trial');

  return true;
end;
$$;

revoke execute on function public.claim_trial(uuid, bigint, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_trial(uuid, bigint, text, text, boolean) to service_role;

-- ===========================================================================
-- (3) WHAT THIS DOES NOT CLOSE — stated rather than papered over.
--
-- (a) Every trial claimed BEFORE this migration has NO fingerprint row, so a mailbox that
--     already farmed N trials keeps them and can claim once more; the first post-wiring claim
--     by an existing user backfills their fingerprint and shuts it after that. SQL backfill was
--     rejected on purpose — it would re-implement the packages/core rules in PL/pgSQL and give
--     a money decision two sources of truth.
-- (b) NOTHING CALLS THIS WITH A FINGERPRINT YET. apps/web still issues the two-argument call,
--     so the dimension is dormant until the caller-wiring slice lands.
-- (c) Signup rate-limiting / CAPTCHA / `enable_signup` are Supabase dashboard settings and are
--     not reachable from a migration.
--
-- Read-only DETECTION query for mailboxes that already double-claimed. It APPROXIMATES the
-- packages/core normaliser (lowercase + plus-strip, dots folded on gmail only) — for looking,
-- not for writing:
--
--   select fingerprint, count(*) as accounts, sum(l.delta) as credits
--     from (
--       select u.id,
--              case when split_part(lower(u.email), '@', 2) in ('gmail.com','googlemail.com')
--                   then replace(split_part(split_part(lower(u.email), '@', 1), '+', 1), '.', '')
--                        || '@gmail.com'
--                   else split_part(split_part(lower(u.email), '@', 1), '+', 1)
--                        || '@' || split_part(lower(u.email), '@', 2)
--              end as fingerprint
--         from auth.users u
--     ) m
--     join public.credit_ledger l
--       on l.user_id = m.id and l.kind = 'grant' and l.reason = 'trial'
--    group by 1 having count(*) > 1 order by credits desc;
--
-- ===========================================================================
-- (4) CLOUD APPLY: no pre-check gate needed, and here is why that is a claim and not a hope.
--
-- Unlike 0017, nothing here validates existing rows. `create table` cannot conflict with data
-- that does not exist yet; its primary key is declared on that same empty table; no constraint
-- or column is added to any existing table; DROP/CREATE FUNCTION is data-independent. The only
-- way this fails on the cloud project is a NAME collision (`public.trial_claims` already
-- existing), which fails loudly and harmlessly at apply time.
--
-- (An earlier draft of this comment also cited "the partial index". There is no partial index —
-- §1 says the table is deliberately UNINDEXED beyond its primary key, and pg_indexes shows only
-- trial_claims_pkey. The conclusion above holds without it; the clause was simply false.)
--
-- ORDERING: this migration requires 0009, because it DROPs the claim_trial(uuid, bigint) that
-- 0009 created and the DROP is not idempotent. It does NOT depend on 0013..0019 — its only
-- constraints are trial_claims_pkey and the FK to auth.users. Apply in order anyway; the
-- dependency is on 0009 specifically, which is a narrower and more accurate statement than
-- "must not jump 0013..0019".
--
-- It must not jump the 0013..0019 queue: it drops the function 0009 created, so applying it to a
-- database that never received 0009 would fail on the DROP.
-- ===========================================================================
