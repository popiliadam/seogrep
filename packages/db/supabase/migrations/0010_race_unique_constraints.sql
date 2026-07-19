-- Migration 0010 (Phase 3, PR-E): close two race windows at the DB level with the unique
-- constraints the app upserts can bind an ON CONFLICT target to. Additive only — no table,
-- policy, RLS enable/force, or grant is touched, and the credit_ledger append-only armor
-- (0002) is untouched. Each unique constraint auto-creates a backing unique index that ALSO
-- serves the (user_id, ...) lookups the two write paths already run, so no separate index is
-- added. Reversible: each constraint drops cleanly (see the paired DROP below each ADD).
--
-- The existing data is already canonical, so both constraints add safely with no backfill:
--   - projects: setup_project has always normalized the domain (normalizeDomain: lowercase,
--     host-only, trailing-dot stripped) before writing, and enforced idempotency by reading
--     first — so no user currently holds two rows for the same (user_id, domain).
--   - gsc_connections: the OAuth callback write path (upsertGscConnection) is read-then-
--     update/insert, so at most one row per (user_id, project_id) exists today.

-- ---------------------------------------------------------------------------
-- projects: one tracked domain per (user, domain). Backs setup_project's ON CONFLICT
-- (user_id, domain) upsert — two truly-simultaneous first calls can no longer each insert
-- a row; the loser's INSERT hits DO NOTHING and the read-back returns the winner's row.
-- ---------------------------------------------------------------------------
alter table public.projects
  add constraint projects_user_id_domain_key unique (user_id, domain);
-- Reverse: alter table public.projects drop constraint projects_user_id_domain_key;

-- ---------------------------------------------------------------------------
-- gsc_connections: one connection per (user, project). Backs upsertGscConnection's
-- ON CONFLICT (user_id, project_id) upsert — a concurrent first-link racer can no longer
-- open a second row; on conflict its write merges into the existing row (re-connect
-- semantics: the newer refresh token + property win), which is exactly the update path.
-- ---------------------------------------------------------------------------
alter table public.gsc_connections
  add constraint gsc_connections_user_id_project_id_key unique (user_id, project_id);
-- Reverse: alter table public.gsc_connections drop constraint gsc_connections_user_id_project_id_key;
