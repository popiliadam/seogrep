-- Migration 0028: narrow every public relation down to EXACTLY the DML the migrations grant,
-- and shut off the mechanism that keeps re-opening it.
--
-- THE MECHANISM. A relation's privileges are not what the migrations GRANT. They are the grants
-- PLUS whatever the server's default ACL hands out at CREATE TABLE time. On the cloud project
-- `pg_default_acl` carries TWO entries for schema public / objtype 'r':
--
--   grantor supabase_admin -> anon,authenticated,service_role = arwdDxtm
--   grantor postgres       -> anon,authenticated,service_role = arwdxtm
--
-- Migrations are applied as `postgres`, so the SECOND one fires on every table this repo has
-- ever created there, and `arwdxtm` is INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER,
-- MAINTAIN. The consequence is not subtle: on cloud every `grant select on ... to authenticated`
-- in this directory is a NO-OP, because SELECT was already there; and the sentence 0023, 0024,
-- 0025, 0026 and 0027 each write in their own words -- "service_role: select + insert.
-- UPDATE/DELETE deliberately absent" -- is FALSE on the only stack that takes money. 0006 said
-- it first and most plainly ("anon: nothing. DELETE: granted to no one."); it has never been
-- true on cloud.
--
-- WHY IT SURVIVED EVERY GATE IN THE REPO. The LOCAL stack's postgres-grantor default for a new
-- public table is `xtm` after 0016 -- REFERENCES/TRIGGER/MAINTAIN, no DML whatever (measured
-- again 2026-08-18 on the running stack: a table created inside a transaction is born
-- `anon=xtm,authenticated=xtm,service_role=xtm`; 0016:38-45 and 0021:38-44 measured the same
-- thing from the other side). So locally the relations really do carry only what was granted,
-- every db-test that asserts SQLSTATE 42501 for a forbidden write passes HONESTLY, and the
-- divergence is invisible to every check this repo runs. That is why the defence added
-- alongside this migration is a STATIC one on the migration text -- guardrails/check-grants.sh,
-- wired into guardrails/verify.sh -- and not a spec. A spec here would be green before and
-- after and would prove nothing at all.
--
-- SEVERITY, stated honestly rather than inflated. For anon and authenticated the extra
-- privileges are neutralised by RLS: every table in this schema is ENABLE + FORCE (0004, and
-- guardrails/check-rls.sh pins the final state), and the only policies are `for select to
-- authenticated using (user_id = auth.uid())`. An INSERT with no policy is refused whatever the
-- grant says. The real gap is `service_role`, which has rolbypassrls = true: for it the grant IS
-- the whole gate, and it currently holds UPDATE and DELETE on relations whose migrations say in
-- prose that it must not. The application issues no such statement (reconciled below); what was
-- missing is the layer that stops a future one, a recovery script, or a compromised service
-- writer -- the same argument 0013 makes for moving invariants out of app discipline.
--
-- ONE EXCEPTION IS NOT MERELY POSTURE, AND IT WAS MEASURED. 0021 gives `authenticated` a
-- COLUMN-LEVEL select on gsc_accounts, everything except `encrypted_refresh_token`, and says so
-- at length: "No UI ever needs the ciphertext client-side". A column grant confers no
-- table-level SELECT, so it does not displace the default's table-wide SELECT -- it sits beside
-- it. Measured on the local stack with the cloud shape simulated:
--
--   grant select on public.gsc_accounts to authenticated;   -- the default ACL, reproduced
--   -> has_column_privilege('authenticated', ..., 'encrypted_refresh_token', 'SELECT') = TRUE
--
-- On cloud an account owner can therefore read their own refresh-token ciphertext over the Data
-- API. The RLS policy scopes rows, never columns; the column list was the whole defence and it
-- has never been in force there.
--
-- AND THE FIX FOR IT HAS AN ORDER THAT CANNOT BE GUESSED. Also measured, and the opposite of
-- the obvious assumption: a TABLE-level `revoke select ... from authenticated` ALSO DROPS the
-- column-level entries -- pg_attribute.attacl goes from seven rows to none and
-- has_column_privilege(...,'google_account_email','SELECT') flips TRUE -> FALSE. Revoking alone
-- would blind the panel's token-health surface. So the gsc_accounts block below revokes and
-- then RE-GRANTS 0021's column list verbatim, in that order, and re-running the pair is
-- idempotent (measured twice through in one transaction).
--
-- credit_ledger (NEVER #2) IS THE PROOF THAT THE PATTERN WORKS, which is why it needs so little
-- here. 0002 does not rely on a default for anything: it REVOKEs UPDATE, DELETE and TRUNCATE
-- from all three roles explicitly, and that revoke is in force on cloud exactly as written --
-- the one table whose money armor was never quietly widened, because its author wrote the
-- revoke instead of trusting the absence of a grant. What 0002 could not foresee is the other
-- half: nobody ever revoked INSERT or SELECT, so on cloud `authenticated` holds INSERT on the
-- money ledger and `anon` holds SELECT and INSERT. Both are refused by RLS (there is no insert
-- policy, and anon matches no policy at all), so this is posture rather than a live hole -- but
-- it is posture on the ledger. This migration therefore touches credit_ledger, and touches it
-- ONLY SUBTRACTIVELY: three revokes of privileges nothing has ever used. No trigger, no policy,
-- no RLS state, and not one of 0002's own statements is altered; the append-only armor
-- guardrails/check-append-only.sh pins is untouched and stays green.
--
-- SUBTRACTIVE, MINIMAL, RE-RUNNABLE. Every statement below is a REVOKE (the two exceptions
-- being the gsc_accounts column re-grant, which restores a 0021 grant verbatim, and the default
-- privileges statement, which is also a revoke). Nothing is widened anywhere. Only pairs that
-- NO earlier migration decided are named -- 0002/0003 (UPDATE, DELETE), 0013/0015/0020 (DELETE)
-- and 0014 (`revoke all` for anon+authenticated on dfs_spend) already decided theirs, and
-- repeating them here would only hide which migration owns which guarantee. REVOKE of a
-- privilege the role does not hold is a no-op, so this file is safe to re-run and safe on a
-- fresh LOCAL stack where none of these were ever granted -- there it changes literally nothing,
-- which is precisely why it had to be written from the cloud's shape rather than from a local
-- measurement.
--
-- THE ENUMERATION IS NOT HAND-WRITTEN. The relation list and the per-role privilege lists below
-- are the output of guardrails/check-grants.sh run against 0001-0027 (48 findings across 19
-- relations). 0016's header records what a hand-written list costs here: four migrations each
-- pinned the one table under discussion and seven were still open when somebody finally measured
-- across the schema.
--
-- OUT OF SCOPE, said plainly rather than left to be inferred:
--   * TRUNCATE -- 0016 closed it schema-wide and altered the default; 0023-0027 revoke it per
--     table. Nothing here touches it.
--   * REFERENCES / TRIGGER / MAINTAIN (the `xtm`) -- left alone, 0016:105-109's reasoning
--     unchanged: neither bypasses RLS nor destroys data, so widening this migration into them
--     would put unrelated risk into a privilege fix. They are also the only privileges the
--     local and cloud defaults AGREE on.
--   * The `supabase_admin`-grantor default ACL -- a migration cannot alter it (`postgres` is not
--     a member; the attempt fails with "permission denied to change default privileges", 0016
--     measured it). Nothing in this repo creates relations as supabase_admin. Unchanged
--     residual, unchanged owner: public-truncate-armor.db.test.ts's enumeration.
--   * Roles other than anon / authenticated / service_role. `postgres` owns these relations and
--     is not in scope; no other role is granted anything in this directory.

-- ---------------------------------------------------------------------------
-- (1) 0001 core tables. authenticated reads its own rows, service_role writes what the app
--     actually calls (0006). Reconciled against the code: projects/api_keys/subscriptions/
--     jobs/reports are written ONLY through the service-role client, and the single production
--     `.delete()` in the whole repo is on gsc_accounts (apps/web/app/app/connection/
--     actions.ts:380) -- so DELETE is safe to take away from service_role on all five.
--     users_profile already lost DELETE in 0015.
-- ---------------------------------------------------------------------------
revoke select, insert, update on public.users_profile from anon;
revoke insert, update on public.users_profile from authenticated;
-- Reverse: grant select, insert, update on public.users_profile to anon;
--          grant insert, update on public.users_profile to authenticated;

revoke select, insert, update, delete on public.projects from anon;
revoke insert, update, delete on public.projects from authenticated;
revoke delete on public.projects from service_role;
-- Reverse: grant select, insert, update, delete on public.projects to anon;
--          grant insert, update, delete on public.projects to authenticated;
--          grant delete on public.projects to service_role;

revoke select, insert, update, delete on public.api_keys from anon;
revoke insert, update, delete on public.api_keys from authenticated;
revoke delete on public.api_keys from service_role;
-- Reverse: grant select, insert, update, delete on public.api_keys to anon;
--          grant insert, update, delete on public.api_keys to authenticated;
--          grant delete on public.api_keys to service_role;

revoke select, insert, update, delete on public.subscriptions from anon;
revoke insert, update, delete on public.subscriptions from authenticated;
revoke delete on public.subscriptions from service_role;
-- Reverse: grant select, insert, update, delete on public.subscriptions to anon;
--          grant insert, update, delete on public.subscriptions to authenticated;
--          grant delete on public.subscriptions to service_role;

revoke select, insert, update, delete on public.jobs from anon;
revoke insert, update, delete on public.jobs from authenticated;
revoke delete on public.jobs from service_role;
-- Reverse: grant select, insert, update, delete on public.jobs to anon;
--          grant insert, update, delete on public.jobs to authenticated;
--          grant delete on public.jobs to service_role;

revoke select, insert, update, delete on public.reports from anon;
revoke insert, update, delete on public.reports from authenticated;
revoke delete on public.reports from service_role;
-- Reverse: grant select, insert, update, delete on public.reports to anon;
--          grant insert, update, delete on public.reports to authenticated;
--          grant delete on public.reports to service_role;

-- ---------------------------------------------------------------------------
-- (2) The money relations. UPDATE/DELETE were already revoked from all three roles by 0002 and
--     0003 and are deliberately NOT repeated -- those two migrations own that guarantee and
--     check-append-only.sh reads it there. What is added is the half nobody wrote: INSERT and
--     SELECT for roles that were never meant to have either.
--
--     credit_balances is a VIEW, and it is here for the same reason the tables are: ALTER
--     DEFAULT PRIVILEGES ... ON TABLES covers views too, so it was born with the same surface.
--     It is `security_invoker`, so credit_ledger's RLS already governs what it can return, and
--     a grouped view is not auto-updatable so an INSERT would fail on its own -- this is posture
--     completion, not a hole. service_role appears in its revoke list because 0005 grants it
--     only SELECT there.
-- ---------------------------------------------------------------------------
revoke select, insert on public.credit_ledger from anon;
revoke insert on public.credit_ledger from authenticated;
-- Reverse: grant select, insert on public.credit_ledger to anon;
--          grant insert on public.credit_ledger to authenticated;

revoke select, insert, update, delete on public.credit_balances from anon;
revoke insert, update, delete on public.credit_balances from authenticated;
revoke insert, update, delete on public.credit_balances from service_role;
-- Reverse: grant select, insert, update, delete on public.credit_balances to anon;
--          grant insert, update, delete on public.credit_balances to authenticated;
--          grant insert, update, delete on public.credit_balances to service_role;

revoke select, insert on public.events from anon;
revoke insert on public.events from authenticated;
-- Reverse: grant select, insert on public.events to anon;
--          grant insert on public.events to authenticated;

-- paddle_events is service_role-only by 0006's design ("No anon/authenticated grant at all"),
-- so anon and authenticated lose the whole DML set they were never meant to hold. DELETE went
-- in 0013; service_role keeps SELECT/INSERT/UPDATE, which process_paddle_purchase (SECURITY
-- INVOKER, so it runs with the CALLER's privileges) and packages/db/src/paddle-repo.ts both use.
revoke select, insert, update on public.paddle_events from anon;
revoke select, insert, update on public.paddle_events from authenticated;
-- Reverse: grant select, insert, update on public.paddle_events to anon;
--          grant select, insert, update on public.paddle_events to authenticated;

-- trial_claims, same shape and same reason (0020). `claim_trial` is SECURITY DEFINER and writes
-- as the function owner, so its writes need no caller-side grant at all; service_role's
-- SELECT/INSERT/UPDATE stay because 0020 granted them.
revoke select, insert, update on public.trial_claims from anon;
revoke select, insert, update on public.trial_claims from authenticated;
-- Reverse: grant select, insert, update on public.trial_claims to anon;
--          grant select, insert, update on public.trial_claims to authenticated;

-- dfs_spend: 0014 already did `revoke all` for anon and authenticated, so only service_role's
-- DELETE is left undecided. Taking it away is the vendor-budget half of 0016's argument: the
-- $3/day cap is a SUM over today's rows, and a DELETE resets it exactly as TRUNCATE would --
-- quieter, and reachable by the role the application runs as. 0014's RPCs are SECURITY INVOKER
-- and need SELECT/INSERT/UPDATE; none of them deletes.
revoke delete on public.dfs_spend from service_role;
-- Reverse: grant delete on public.dfs_spend to service_role;

-- ---------------------------------------------------------------------------
-- (3) gsc_accounts -- the one block whose ORDER is load-bearing. See the header: a table-level
--     REVOKE also destroys pg_attribute column grants, so 0021's column list is re-granted
--     immediately afterwards, verbatim. Both statements together are idempotent. service_role
--     is absent from this block on purpose: 0021 grants it all four, including DELETE, which
--     disconnectAccount genuinely calls.
-- ---------------------------------------------------------------------------
revoke select, insert, update, delete on public.gsc_accounts from anon;
revoke select, insert, update, delete on public.gsc_accounts from authenticated;
grant select (id, user_id, google_account_sub, google_account_email, token_status, token_checked_at, created_at)
  on public.gsc_accounts to authenticated;
-- Reverse: grant select, insert, update, delete on public.gsc_accounts to anon, authenticated;
--          (the column grant above is 0021's own and must be left in place either way)

-- gsc_connections: service_role holds all four (0006 + 0012's DELETE) and is therefore already
-- decided; only anon and authenticated are narrowed.
revoke select, insert, update, delete on public.gsc_connections from anon;
revoke insert, update, delete on public.gsc_connections from authenticated;
-- Reverse: grant select, insert, update, delete on public.gsc_connections to anon;
--          grant insert, update, delete on public.gsc_connections to authenticated;

-- ---------------------------------------------------------------------------
-- (4) The five run ledgers (0023-0027). Each of these files states in prose that service_role
--     gets "select + insert" and that "UPDATE/DELETE deliberately absent"; these ten statements
--     are what makes that sentence true on cloud. A run row is the record of what was measured
--     at a moment -- 0027's words -- and nothing in the write path corrects one afterwards.
-- ---------------------------------------------------------------------------
revoke select, insert, update, delete on public.crawl_pages from anon;
revoke insert, update, delete on public.crawl_pages from authenticated;
revoke update, delete on public.crawl_pages from service_role;
-- Reverse: grant select, insert, update, delete on public.crawl_pages to anon;
--          grant insert, update, delete on public.crawl_pages to authenticated;
--          grant update, delete on public.crawl_pages to service_role;

revoke select, insert, update, delete on public.audit_runs from anon;
revoke insert, update, delete on public.audit_runs from authenticated;
revoke update, delete on public.audit_runs from service_role;
-- Reverse: grant select, insert, update, delete on public.audit_runs to anon;
--          grant insert, update, delete on public.audit_runs to authenticated;
--          grant update, delete on public.audit_runs to service_role;

revoke select, insert, update, delete on public.gsc_discovery_runs from anon;
revoke insert, update, delete on public.gsc_discovery_runs from authenticated;
revoke update, delete on public.gsc_discovery_runs from service_role;
-- Reverse: grant select, insert, update, delete on public.gsc_discovery_runs to anon;
--          grant insert, update, delete on public.gsc_discovery_runs to authenticated;
--          grant update, delete on public.gsc_discovery_runs to service_role;

revoke select, insert, update, delete on public.audit_content_runs from anon;
revoke insert, update, delete on public.audit_content_runs from authenticated;
revoke update, delete on public.audit_content_runs from service_role;
-- Reverse: grant select, insert, update, delete on public.audit_content_runs to anon;
--          grant insert, update, delete on public.audit_content_runs to authenticated;
--          grant update, delete on public.audit_content_runs to service_role;

revoke select, insert, update, delete on public.domain_lookup_runs from anon;
revoke insert, update, delete on public.domain_lookup_runs from authenticated;
revoke update, delete on public.domain_lookup_runs from service_role;
-- Reverse: grant select, insert, update, delete on public.domain_lookup_runs to anon;
--          grant insert, update, delete on public.domain_lookup_runs to authenticated;
--          grant update, delete on public.domain_lookup_runs to service_role;

-- ---------------------------------------------------------------------------
-- (5) The future: stop the next relation being born with the DML again.
--
-- 0016 did exactly this for TRUNCATE and its reasoning carries over word for word, including
-- WHY IT IS WRITTEN AGAINST `current_user`: a default privilege is stored PER GRANTOR ROLE, so
-- one written against the wrong role is not an error but a silent no-op -- green in the log and
-- worth nothing. `current_user` is by construction the role applying this migration and
-- therefore the role that will own the relations future migrations create. On both stacks it
-- resolves to `postgres`, which is the grantor named in every ACL entry measured on either side.
--
-- What 0016 left behind is the DML half. It revoked only TRUNCATE, and cloud's postgres-grantor
-- default has no TRUNCATE in it (`arwdxtm`, no D) -- so on cloud that statement changed nothing
-- at all and every table created after it (gsc_accounts, crawl_pages, audit_runs,
-- gsc_discovery_runs, audit_content_runs, domain_lookup_runs) was still born with the full DML
-- surface. This statement is the one that stops it.
--
-- Measured locally 2026-08-18 inside a rolled-back transaction: the statement runs clean, the
-- stored default stays `anon=xtm,authenticated=xtm,service_role=xtm` (it had no DML to remove),
-- and a table created straight after is born with the same `xtm` -- i.e. a true no-op on the
-- stack where the DML was never in the default, which is what makes it safe to apply here.
-- ---------------------------------------------------------------------------
do $$
begin
  execute format(
    'alter default privileges for role %I in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role',
    current_user
  );
end $$;
-- Reverse: alter default privileges for role postgres in schema public
--            grant select, insert, update, delete on tables to anon, authenticated, service_role;
--          (guardrails/check-grants.sh goes RED on that statement by design -- it is the
--           mechanism, and re-adding it would re-open every relation created afterwards.)

-- Additive in the only sense that matters here: nothing is GRANTed that was not already granted
-- by an earlier migration, so no posture is widened anywhere. No table, view, index, constraint,
-- policy, trigger or function is created, altered or dropped; no RLS enable/force state is
-- touched; credit_ledger's append-only armor (0002) and events' (0003) are untouched, as are
-- 0013's latches and 0016's TRUNCATE revokes. The one GRANT in the file restores 0021's own
-- column list after the revoke that would otherwise have taken it with it.
--
-- What this does NOT fix, restated once at the bottom so it cannot be missed: the
-- `supabase_admin`-grantor default ACL (unreachable from a migration), REFERENCES/TRIGGER/
-- MAINTAIN, and any relation created outside this directory. And it fixes nothing observable
-- on a local stack -- guardrails/check-grants.sh, not a spec, is what keeps it true.
