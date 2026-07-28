-- Migration 0016 (hostile-audit remediation): close the TRUNCATE hole across the WHOLE public
-- schema, and stop it regenerating on every table added from here on.
--
-- WHY THIS IS NOT A SIXTH PER-TABLE PATCH. 0002 (credit_ledger), 0003 (events), 0013
-- (paddle_events) and 0015 (users_profile) each revoked TRUNCATE on the ONE table whose
-- invariant was under discussion at the time. Each was correct and each was narrow. Taking the
-- measurement ACROSS the schema instead of down one column — which is what 0015's author and
-- its reviewer independently did, and what nobody had done in the four migrations before — found
-- seven more tables still open:
--
--   table            | anon  | authenticated | service_role
--   -----------------+-------+---------------+-------------
--   api_keys         | TRUE  | TRUE          | TRUE
--   gsc_connections  | TRUE  | TRUE          | TRUE
--   jobs             | TRUE  | TRUE          | TRUE
--   projects         | TRUE  | TRUE          | TRUE
--   reports          | TRUE  | TRUE          | TRUE
--   subscriptions    | TRUE  | TRUE          | TRUE
--   dfs_spend        | false | false         | TRUE
--
-- (measured on a clean 0001-0015 local stack, 2026-07-29 — nineteen open grants, not inferred
-- from the cloud project.)
--
-- WHY IT MATTERS MORE THAN A DML GRANT. TRUNCATE bypasses RLS completely and fires no row-level
-- trigger. Every row-level defence in this repo — the 0013 latches, the 0002/0003 append-only
-- rejection triggers, every tenant-isolation policy — is simply walked around by it. It is also
-- invisible to the behavioural test suites, because TRUNCATE has no PostgREST verb: a fully
-- green supabase-js run says nothing whatsoever about it. That is exactly why it survived four
-- migrations of people looking straight at these tables.
--
-- THE MONEY PATH. `dfs_spend` is the one that turns this from posture into a live hole. 0014
-- caps DataForSEO vendor spend at $3.00/day by SUMMING today's dfs_spend rows inside
-- reserve_dfs_spend. TRUNCATE zeroes that sum — no trigger, no RLS, no ledger entry — and hands
-- back a full day's allowance as often as it is called, by the exact role the application runs
-- as. The H-03 budget gate closed the front door; this was the path running past it.
--
-- WHERE THE GRANT KEEPS COMING FROM. Not from any migration in this repo: no migration ever
-- granted TRUNCATE to anyone. It comes from the Supabase base image's default privileges —
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ... ON TABLES
--     TO anon, authenticated, service_role
--
-- whose stored ACL is `Dxtm` = TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. Those four are handed
-- out at CREATE TABLE time even on tables where the DML auto-grants were flipped off (0006:7-11
-- describes the DML half of that flip, which is why the TRUNCATE half went unnoticed). So every
-- table this repo has ever created was BORN with TRUNCATE granted to all three app roles, and
-- every table it creates tomorrow would be too. Revoking on today's eleven tables without
-- touching the default would fix the past and leave the mechanism running.

-- ---------------------------------------------------------------------------
-- (1) The past: revoke TRUNCATE on every table that exists in `public` right now.
--
-- Enumerated from pg_catalog rather than typed as a list, for the same reason the accompanying
-- spec enumerates: a hand-written list is a record of what someone remembered, and four
-- migrations of exactly that are what produced this hole. It also covers the cloud project,
-- whose live schema is the thing being repaired and which carries legacy auto-grants the local
-- rebuild does not (the rebuild-parity gap 0012 documented in the other direction).
--
-- Safe as a blanket: NOTHING in the codebase truncates anything. `grep -rniE '\btruncate\b'`
-- across apps/, packages/, guardrails/ and scripts/ returns only string-clamping helpers named
-- truncateAtWord and prose in comments — not one SQL TRUNCATE. There is no legitimate grant here
-- to preserve, which is what makes revoking on everything the low-risk option rather than the
-- bold one.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as tbl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p') -- ordinary + partitioned tables; nothing else takes TRUNCATE
     order by c.relname
  loop
    execute format('revoke truncate on table %s from anon, authenticated, service_role', r.tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- (2) The future: stop new tables being born with the grant.
--
-- Written against `current_user` deliberately. A default privilege is stored PER GRANTOR ROLE and
-- only governs tables that role creates, so one written against the wrong role is not an error —
-- it is a silent no-op, green in the migration log and worth nothing. `current_user` is by
-- construction the role applying this migration, and therefore the role that will own the tables
-- future migrations create; it is also the only role whose defaults can always be altered, so
-- this can neither mis-target nor fail on a permission check. On both stacks it resolves to
-- `postgres`, which is measured to own all eleven existing tables and to be the grantor named in
-- every one of their ACL entries.
--
-- Measured, not assumed (local, 2026-07-29): after this statement the stored default ACL goes
-- from `anon=Dxtm` to `anon=xtm`, and a table created immediately afterwards reports
-- has_table_privilege(...,'TRUNCATE') = false for all three roles. The accompanying spec re-runs
-- that experiment on a real table on every DB-gate run rather than trusting this comment.
--
-- KNOWN RESIDUAL GAP, stated rather than papered over: the base image carries a SECOND default
-- ACL for public tables whose grantor is `supabase_admin` and which still grants the full
-- `arwdDxtm`. A migration cannot touch it — `postgres` is not a member of `supabase_admin`, and
-- the attempt fails with "permission denied to change default privileges" (measured). A table
-- created BY supabase_admin would still be born with TRUNCATE. Nothing in this repo creates
-- tables that way, and the enumerating spec catches it if anything ever does — which is why that
-- spec, not this statement, is the primary defence.
--
-- Scope note: the same default also hands out REFERENCES, TRIGGER and MAINTAIN (the `xtm`). They
-- are left alone on purpose. Neither bypasses RLS nor destroys data, so they are a posture
-- question rather than the live hole this migration exists to close, and widening the revoke
-- would put unrelated risk in a money-path fix.
-- ---------------------------------------------------------------------------
do $$
begin
  execute format(
    'alter default privileges for role %I in schema public revoke truncate on tables from anon, authenticated, service_role',
    current_user
  );
end $$;

-- Additive and non-breaking. No DML, DELETE or EXECUTE grant is touched: in particular
-- service_role keeps DELETE on gsc_connections (0012, live — /app/connection Disconnect calls
-- deleteGscConnection) and keeps SELECT/INSERT/UPDATE on dfs_spend (0014's RPCs are SECURITY
-- INVOKER and need them). Both are pinned by public-truncate-armor.db.test.ts so a later
-- widening of this revoke turns the DB gate red.
--
-- Re-running is a no-op, so this is safe to re-apply. Reverse: there is no honest one — no role
-- ever legitimately truncated anything here, and restoring the grant re-opens both the money
-- path (a resettable DataForSEO budget) and the row-armor bypass on every other table.
