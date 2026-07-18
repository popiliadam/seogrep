-- Migration 0008: users_profile.welcomed_at — one-time welcome-email lock.
--
-- The first-login welcome email (Resend transactional) is fired exactly once per user
-- by an atomic `UPDATE ... WHERE welcomed_at IS NULL RETURNING` (see apps/web
-- sendWelcomeIfFirst), mirroring the 0006 trial_granted_at lock. This column is the
-- persistent one-time lock.
--
-- At-most-once (deliberately NOT at-least-once): the lock flips BEFORE the send, so if
-- the send fails afterwards welcomed_at STAYS set and the mail is never retried — a
-- welcome mail is non-critical and not double-sending outweighs guaranteed delivery.
--
-- No new privileges: service_role already holds UPDATE on public.users_profile and
-- authenticated holds SELECT (both from 0006), and PostgreSQL table grants cover new
-- columns. RLS is unchanged (service_role bypasses it; the flip runs service-side).

alter table public.users_profile add column welcomed_at timestamptz;
