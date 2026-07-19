-- Migration 0009 (Phase 3, PR-A): widen jobs/reports/api_keys/gsc_connections for the
-- MCP tool-run + report surfaces, add a lookup-index bundle for the hot ledger/jobs
-- queries, and fuse the signup trial lock+grant into ONE atomic SECURITY DEFINER RPC.
--
-- Nothing here loosens the posture: only additive ADD COLUMN (all nullable, so no backfill
-- and no default rewrite), CREATE INDEX, and one new function. No table is created (RLS
-- enable/force coverage is unchanged), no policy is touched, and the credit_ledger
-- append-only armor (0002 REVOKE + reject_mutation trigger) is untouched — claim_trial only
-- INSERTs the ledger. Existing Data API table grants (0006) automatically cover the new
-- columns, so no new GRANT is needed (same reasoning as 0008).

-- ===========================================================================
-- (1) Column additions. All nullable; each is written by a later Phase 3 slice.
-- ===========================================================================

-- jobs: execution lifecycle timestamps, failure detail, tool result payload, and the
-- credit reserve this run holds (commit on success / release on failure — reserve_id
-- matches the credit_ledger.reserve_id issued by reserve_credits in 0005).
alter table public.jobs
  add column started_at timestamptz,
  add column finished_at timestamptz,
  add column error text,
  add column result jsonb,
  add column reserve_id uuid;

-- reports: rendered output — human title, the HTML body served at the public_slug, and
-- the tool that produced it.
alter table public.reports
  add column title text,
  add column html text,
  add column tool text;

-- api_keys: last-use stamp, updated by the MCP gateway each time a key resolves.
alter table public.api_keys
  add column last_used_at timestamptz;

-- gsc_connections: the chosen Search Console property (e.g. 'sc-domain:example.com' or a
-- URL-prefix property) once the OAuth link is established.
alter table public.gsc_connections
  add column gsc_property text;

-- ===========================================================================
-- (2) Index bundle. Serves the hot lookups the ledger functions and dashboards run.
-- ===========================================================================

-- Purchase-dedup accelerator for process_paddle_purchase (0007), whose guard is
--   WHERE kind = 'purchase' AND job_id = p_ref
-- Predicate is on KIND, not reason: purchase rows carry reason='paddle' (0007 line 48),
-- so a `WHERE reason='purchase'` partial index would match ZERO rows and never serve that
-- query. Partial keeps the index to only the purchase rows (grants/spends are excluded).
create index credit_ledger_purchase_ref_idx
  on public.credit_ledger (job_id)
  where kind = 'purchase';

-- Reserve-settlement lookups in commit_reserve / release_reserve (0005), whose guards are
--   WHERE reserve_id = p_reserve_id AND kind = ...
create index credit_ledger_reserve_id_idx
  on public.credit_ledger (reserve_id);

-- User job history, newest-first — the dashboard/usage listing (WHERE user_id = ?
-- ORDER BY created_at DESC).
create index jobs_user_created_idx
  on public.jobs (user_id, created_at desc);

-- ===========================================================================
-- (3) claim_trial — atomic one-time signup trial lock + grant in ONE transaction.
-- ===========================================================================
--
-- Closes the known Phase 2 gap (progress.md): the app path (apps/web trial.ts + the 0006
-- trial_granted_at lock) flips the lock and grants credits as TWO statements, so a crash
-- landing between them leaves the user locked-but-creditless — the callback 500s and the
-- one-time lock blocks any retry. This RPC fuses lock+grant into one function body (one
-- transaction): if the grant INSERT raises, the lock UPDATE rolls back with it, so that
-- inconsistent state is unreachable. Returns true only when THIS call flipped the lock (a
-- real first-time grant, the signal the callback needs for the signup_completed event);
-- false is the idempotent already-granted no-op.
--
-- The credit AMOUNT is a parameter, never hardcoded: the single source of truth stays
-- CREDIT_PACKAGES.trial in packages/core (CLAUDE.md NEVER #6). The web caller is wired in a
-- later slice; this migration does NOT change any existing caller, so current behaviour and
-- tests are unaffected.
--
-- SECURITY DEFINER + search_path = '' + fully schema-qualified names (the 0005/0007
-- hardening pattern): the empty search_path closes the definer search-path attack, and
-- EXECUTE is revoked from anon/authenticated/public and granted to service_role only, so the
-- sole caller is the trusted server (service_role) via the PostgREST RPC. It only INSERTs
-- credit_ledger (append-only armor intact — the trigger fires on UPDATE/DELETE, not INSERT)
-- and UPDATEs/INSERTs users_profile.
create function public.claim_trial(p_user_id uuid, p_amount bigint)
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

  -- Atomic one-time lock: only the first caller flips NULL -> now and matches a row. Under
  -- two concurrent claims the row lock serializes them; the loser re-checks the committed
  -- row (trial_granted_at now set) and matches nothing, so FOUND is false below.
  update public.users_profile
  set trial_granted_at = now()
  where id = p_user_id and trial_granted_at is null;

  if not found then
    return false; -- already granted — idempotent no-op.
  end if;

  -- Same transaction as the lock: append the trial grant. A raise here rolls the lock back
  -- too, so a user is never left locked-but-creditless (the gap this RPC exists to close).
  insert into public.credit_ledger (user_id, delta, kind, reason)
  values (p_user_id, p_amount, 'grant', 'trial');

  return true;
end;
$$;

revoke execute on function public.claim_trial(uuid, bigint) from public, anon, authenticated;
grant execute on function public.claim_trial(uuid, bigint) to service_role;

-- ===========================================================================
-- (4) SECURITY DEFINER audit of 0001-0008 (no ALTER needed — all already hardened).
-- ===========================================================================
-- Every function reachable on a clean schema was checked (pg_proc.prosecdef +
-- pg_proc.proconfig + proacl). Result: none lacks a pinned search_path, and none is
-- client-callable that should not be. So this migration adds no ALTER FUNCTION.
--
--   function                       | security | search_path | execute grant        | verdict
--   -------------------------------+----------+-------------+----------------------+--------
--   reject_mutation()              | invoker  | '' (0005)   | (trigger fn; PUBLIC) | OK — pinned in 0005; returns trigger, not RPC-exposed
--   reserve_credits(...)           | invoker  | '' (0005)   | service_role only    | OK — hardened in 0005
--   commit_reserve(uuid)           | invoker  | '' (0005)   | service_role only    | OK — hardened in 0005
--   release_reserve(uuid)          | invoker  | '' (0005)   | service_role only    | OK — hardened in 0005
--   process_paddle_purchase(...)   | invoker  | '' (0007)   | service_role only    | OK — hardened in 0007
--   rls_auto_enable()              | definer  | (cloud)     | revoked (0004)       | OK — guard-revoked in 0004; cloud-only groundwork, absent on local/CI
--   claim_trial(uuid, bigint)      | definer  | '' (here)   | service_role only    | NEW — hardened above
--
-- The two Phase-2 items the brief flagged as already-closed are confirmed, not redone:
-- reject_mutation's search_path was pinned in 0005; rls_auto_enable was guard-revoked in
-- 0004 (and does not exist on the local/CI stack these migrations reset).
