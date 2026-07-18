-- Migration 0001: core tenant tables + row level security.
-- Every table: created_at timestamptz not null default now(), RLS enabled AND forced.
-- Only owner-SELECT policies are defined here; writes are performed by service_role
-- (RLS bypass) in jobs/ or added in a later phase. Authenticated clients read own rows.
-- auth.uid() is wrapped in a subquery so the planner caches it once per statement.

-- ---------------------------------------------------------------------------
-- users_profile: 1:1 with auth.users; id is both primary key and foreign key.
-- ---------------------------------------------------------------------------
create table public.users_profile (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.users_profile enable row level security;
alter table public.users_profile force row level security;

create policy "users_profile_select_own"
  on public.users_profile
  for select
  to authenticated
  using (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- projects: a tracked domain owned by a user.
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;
alter table public.projects force row level security;

create policy "projects_select_own"
  on public.projects
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- api_keys: hashed, revocable personal API keys (resolve the personal MCP URL).
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.api_keys enable row level security;
alter table public.api_keys force row level security;

create policy "api_keys_select_own"
  on public.api_keys
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- subscriptions: Paddle-backed plan state per user.
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  paddle_subscription_id text unique,
  plan text not null,
  status text not null check (status in ('active', 'trialing', 'past_due', 'paused', 'canceled')),
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

create policy "subscriptions_select_own"
  on public.subscriptions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- jobs: tool execution records (skeleton; extended in a later phase).
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  tool text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.jobs enable row level security;
alter table public.jobs force row level security;

create policy "jobs_select_own"
  on public.jobs
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- reports: generated report records; public_slug nullable for shareable links.
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  public_slug text unique,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;
alter table public.reports force row level security;

create policy "reports_select_own"
  on public.reports
  for select
  to authenticated
  using (user_id = (select auth.uid()));
