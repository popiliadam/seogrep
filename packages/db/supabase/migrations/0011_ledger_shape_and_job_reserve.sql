-- Migration 0011 (Faz 3.5 hardening): make the credit_ledger enforce its OWN money shape
-- at the DB layer, and enforce one open reserve per job. Two verified cross-audit findings:
--
--   B-I4  service_role holds direct INSERT on credit_ledger (the 0005/0007/0009 RPCs are
--         SECURITY INVOKER and rely on that grant — see 0005). So the ONLY thing standing
--         between a bad row (e.g. kind='spend_commit', delta=-999, reserve_id=NULL) and a
--         negative SUM(delta) was app discipline, not the DB. That makes "the DB is the last
--         word" (constitution NEVER #2) untrue at the DB layer. The CHECK constraints below
--         close it: they reject exactly the shapes the RPCs never emit.
--   B-I1  reserve_credits (0005) had no per-job dedupe, so two deliveries of one job_id could
--         double-reserve. The partial unique index below caps it at one open reserve per job.
--
-- Posture unchanged and NON-BREAKING: additive only (ADD CONSTRAINT / CREATE UNIQUE INDEX),
-- no table/policy/RLS/grant touched, the 0002 append-only armor (REVOKE + reject_mutation
-- trigger) is untouched, and service_role INSERT is DELIBERATELY NOT revoked (revoking it
-- would break every reserve/commit/release/grant/purchase RPC, which are SECURITY INVOKER).
-- CHECK constraints — not a DEFINER+owner-role restructure — are the correct, minimal tool
-- here; the restructure is a larger follow-up, out of scope.
--
-- Provably rejects NO existing valid row: every writer already emits exactly the allowed
-- shapes — reserve_credits (spend_reserve, delta=-p_amount<0, reserve_id set), commit_reserve
-- (spend_commit, delta=0, reserve_id set), release_reserve (spend_release, delta=-v_delta>0,
-- reserve_id set), process_paddle_purchase (purchase, delta>0), claim_trial + grantCredits
-- (grant/purchase, delta>0). `adjust` is the manual-correction escape hatch and is LEFT
-- unconstrained on delta and reserve_id. The şef runs the pre-apply violation-count SELECT
-- (see the fix report) against the live DB before applying, so a validating ADD CONSTRAINT
-- cannot fail on legacy data.

-- ===========================================================================
-- (1) B-I4 — ledger shape invariants. One named CHECK per rule (named CHECKs surface a
--     precise constraint name in the error, so a violation says WHICH rule broke). Each is
--     an implication `kind <> X OR <predicate>`, so it constrains ONLY rows of that kind and
--     leaves every other kind (notably `adjust`) untouched.
-- ===========================================================================

-- spend_commit is a zero-delta settlement marker (the reserve already moved the balance).
alter table public.credit_ledger
  add constraint credit_ledger_spend_commit_zero_delta
  check (kind <> 'spend_commit' or delta = 0);
-- Reverse: alter table public.credit_ledger drop constraint credit_ledger_spend_commit_zero_delta;

-- spend_reserve debits: delta must be strictly negative.
alter table public.credit_ledger
  add constraint credit_ledger_spend_reserve_neg_delta
  check (kind <> 'spend_reserve' or delta < 0);
-- Reverse: alter table public.credit_ledger drop constraint credit_ledger_spend_reserve_neg_delta;

-- spend_release refunds: delta must be strictly positive.
alter table public.credit_ledger
  add constraint credit_ledger_spend_release_pos_delta
  check (kind <> 'spend_release' or delta > 0);
-- Reverse: alter table public.credit_ledger drop constraint credit_ledger_spend_release_pos_delta;

-- grants add credit: delta must be strictly positive.
alter table public.credit_ledger
  add constraint credit_ledger_grant_pos_delta
  check (kind <> 'grant' or delta > 0);
-- Reverse: alter table public.credit_ledger drop constraint credit_ledger_grant_pos_delta;

-- purchases add credit: delta must be strictly positive.
alter table public.credit_ledger
  add constraint credit_ledger_purchase_pos_delta
  check (kind <> 'purchase' or delta > 0);
-- Reverse: alter table public.credit_ledger drop constraint credit_ledger_purchase_pos_delta;

-- Every spend_* row is tied to a reserve: reserve_id must be present. (Left unconstrained
-- for grant/purchase/adjust — those legitimately carry a NULL reserve_id.)
alter table public.credit_ledger
  add constraint credit_ledger_spend_reserve_id_present
  check (kind not in ('spend_reserve', 'spend_commit', 'spend_release') or reserve_id is not null);
-- Reverse: alter table public.credit_ledger drop constraint credit_ledger_spend_reserve_id_present;

-- ===========================================================================
-- (2) B-I1 — one OPEN reserve per job. At most one spend_reserve row may exist per job_id.
--     Partial on kind='spend_reserve' is essential: spend_commit / spend_release copy the
--     reserve's job_id, so a non-partial index would collide the commit/release against the
--     reserve. Sync tools pass a fresh uuid per call (unique); async worker jobs pass the
--     real jobs.id (exactly one reserve). job_id NULL stays DISTINCT (standard NULL semantics
--     — NOT `nulls not distinct`): a legitimately job-less reserve is never rejected.
-- ===========================================================================
create unique index credit_ledger_one_reserve_per_job
  on public.credit_ledger (job_id)
  where kind = 'spend_reserve';
-- Reverse: drop index public.credit_ledger_one_reserve_per_job;
