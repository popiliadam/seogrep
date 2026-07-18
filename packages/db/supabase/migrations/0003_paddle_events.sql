-- Migration 0003: paddle_events (webhook idempotency) + gsc_connections skeleton
-- + events audit log (append-only). Reuses public.reject_mutation() from 0002.

-- ---------------------------------------------------------------------------
-- paddle_events: raw webhook events; event_id primary key gives idempotency
-- (a second insert of the same event_id raises a unique violation). RLS is enabled
-- and forced with NO policy, so only service_role (RLS bypass) may access it.
-- ---------------------------------------------------------------------------
create table public.paddle_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.paddle_events enable row level security;
alter table public.paddle_events force row level security;

-- ---------------------------------------------------------------------------
-- gsc_connections: Google Search Console link (skeleton). The encrypted refresh
-- token is written by service_role in a later phase (Phase 3); no write policy here.
-- ---------------------------------------------------------------------------
create table public.gsc_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  encrypted_refresh_token bytea,
  created_at timestamptz not null default now()
);

alter table public.gsc_connections enable row level security;
alter table public.gsc_connections force row level security;

create policy "gsc_connections_select_own"
  on public.gsc_connections
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- events: append-only audit log. user_id is nullable (ON DELETE SET NULL) so audit
-- rows survive user deletion; orphaned rows are then visible to no client. Owner-only
-- SELECT; no INSERT/UPDATE policy (inserts via service_role).
-- ---------------------------------------------------------------------------
create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;
alter table public.events force row level security;

create policy "events_select_own"
  on public.events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Append-only armor (same as credit_ledger): reuse public.reject_mutation().
REVOKE UPDATE, DELETE, TRUNCATE ON public.events FROM anon, authenticated, service_role;
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
