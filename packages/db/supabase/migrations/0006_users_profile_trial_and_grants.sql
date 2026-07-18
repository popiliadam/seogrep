-- Migration 0006: one-time trial lock column + explicit Data API table privileges.
--
-- (a) users_profile.trial_granted_at: the signup trial grant is fired exactly once
--     per user by an atomic `UPDATE ... WHERE trial_granted_at IS NULL RETURNING`
--     (see apps/web trial grant). This column is the persistent one-time lock.
--
-- (b) Explicit GRANTs. Newer Supabase stacks no longer auto-grant table privileges
--     to anon/authenticated/service_role when a table is created (the auto-expose
--     default was flipped), so the tables from 0001/0003 are unreachable through the
--     Data API without these. On the cloud project the legacy auto-grants already sit
--     UNDERNEATH these statements, so re-granting is additive and idempotent (a no-op
--     that never widens the posture). Deliberate posture:
--       * authenticated: SELECT only (RLS still scopes rows to the owner).
--       * service_role: the write path each table actually needs (jobs/ + server routes).
--       * anon: nothing.
--       * DELETE: granted to no one.
--       * Append-only tables (events here, credit_ledger untouched) keep their 0002/0003
--         REVOKE of UPDATE/DELETE/TRUNCATE — those are NOT re-granted.

alter table public.users_profile add column trial_granted_at timestamptz;

-- Owner-readable tenant tables: authenticated reads own rows; service_role read+write.
grant select on public.users_profile to authenticated;
grant select, insert, update on public.users_profile to service_role;

grant select on public.projects to authenticated;
grant select, insert, update on public.projects to service_role;

grant select on public.api_keys to authenticated;
grant select, insert, update on public.api_keys to service_role;

grant select on public.subscriptions to authenticated;
grant select, insert, update on public.subscriptions to service_role;

grant select on public.jobs to authenticated;
grant select, insert, update on public.jobs to service_role;

grant select on public.reports to authenticated;
grant select, insert, update on public.reports to service_role;

grant select on public.gsc_connections to authenticated;
grant select, insert, update on public.gsc_connections to service_role;

-- events: append-only audit log. authenticated reads own; service_role appends only
-- (no UPDATE grant — the 0003 REVOKE of UPDATE/DELETE/TRUNCATE stays intact).
grant select on public.events to authenticated;
grant select, insert on public.events to service_role;

-- paddle_events: service_role only (webhook idempotency; processed_at update lands in
-- T7). No anon/authenticated grant at all.
grant select, insert, update on public.paddle_events to service_role;
