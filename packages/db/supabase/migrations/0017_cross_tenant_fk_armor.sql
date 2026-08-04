-- Migration 0017 (hostile-audit remediation, M-10): make a CROSS-TENANT ROW UNWRITABLE at the
-- database layer — a job, report or Search Console connection owned by one user but parented to
-- another user's project or job.
--
-- WHAT THE MEASUREMENT SAID, AND WHY IT CHANGED THE SHAPE OF THIS MIGRATION.
-- M-10 was filed as "add `with check` to the RLS policies". Measured on a clean 0001-0016 local
-- stack (2026-07-29), that would have been THEATRE, for three independent reasons — each verified
-- by running it, not by reading the catalog:
--
--   1. All nine policies in this schema are SELECT-only, and `WITH CHECK` cannot be attached to
--      one: PostgreSQL answers `ERROR: WITH CHECK cannot be applied to SELECT or DELETE`.
--   2. Adding a NEW insert/update policy for `authenticated` would sit on an unreachable path.
--      `anon` and `authenticated` hold INSERT/UPDATE/DELETE on ZERO public tables, so their writes
--      are refused by the GRANT layer before RLS is consulted at all:
--      `ERROR: permission denied for table projects`.
--   3. The app's ONLY writer is `service_role`, and `service_role` has rolbypassrls = true.
--      `row_security_active('public.projects')` is FALSE for it, and it inserts straight through a
--      RESTRICTIVE `using (false) with check (false)` policy — the strongest RLS that can be
--      written. FORCE ROW LEVEL SECURITY does not change this: FORCE removes the table-OWNER
--      exemption, not the BYPASSRLS attribute.
--
-- So no policy of any kind can constrain the writer that actually writes, and this migration adds
-- none. A FOREIGN KEY can: referential integrity is not RLS, and it is bypassed by neither
-- rolbypassrls nor superuser. It is the only layer in this schema that binds `service_role` — the
-- same reasoning 0011 (CHECK constraints) and 0013 (triggers) already followed for money.
--
-- THE WHOLE CROSS-TENANT SURFACE IS THREE EDGES. Every other FK in `public` points at
-- auth.users, where the single referenced column already IS the tenant and nothing can be forged:
--
--   jobs.project_id            -> projects.id   (nullable child, ON DELETE SET NULL)
--   gsc_connections.project_id -> projects.id   (NOT NULL child, ON DELETE CASCADE)
--   reports.job_id             -> jobs.id       (nullable child, ON DELETE SET NULL)
--
-- Each checked only that the parent id EXISTS — never that it belonged to the same tenant. The
-- app does check: crawl_site resolves the project through a user_id-scoped read, pull_gsc_data
-- filters on user_id AND project_id. That guard is real and stays. It was also the ONLY guard, so
-- one regression in a tool surface, one recovery script, or one compromised service writer put a
-- cross-tenant row in the table with nothing beneath it to say no. `credit_ledger.job_id` is NOT
-- in scope: it is `text` and carries no FK at all (it holds Paddle transaction ids as well as job
-- ids), so there is no edge here to make composite.
--
-- Additive to the tenant posture and non-breaking: no table created or dropped, no RLS enable/
-- force changed, no policy added or altered, no grant touched, and the credit_ledger append-only
-- armor (0002) is untouched. What changes is that three FKs get strictly STRONGER: every row they
-- accepted before, minus the cross-tenant ones.

-- ===========================================================================
-- (1) The composite FK targets: unique (user_id, id) on the two parent tables.
--
-- A foreign key must reference a UNIQUE or PRIMARY KEY constraint, so `(user_id, id)` has to be
-- declared unique before anything can point at it. This is the part M-10 called impossible
-- ("composite FK bugün yazılamıyor bile") and it is the cheapest part: `id` is already the primary
-- key, so it is unique on its own, and any superset of a unique column is unique too. A violation
-- of these two constraints is therefore ARITHMETICALLY IMPOSSIBLE in existing data — they cannot
-- fail to apply, here or on the cloud project, whatever is in the tables.
--
-- Each also leaves behind a btree on (user_id, id) that serves the tenant-scoped id lookups the
-- app already runs (getJobForUser: id = ? AND user_id = ?).
-- ===========================================================================

alter table public.projects
  add constraint projects_user_id_id_key unique (user_id, id);
-- Reverse: alter table public.projects drop constraint projects_user_id_id_key;

alter table public.jobs
  add constraint jobs_user_id_id_key unique (user_id, id);
-- Reverse: alter table public.jobs drop constraint jobs_user_id_id_key;

-- ===========================================================================
-- (2) The three edges, converted from single-column to composite.
--
-- The old constraint is DROPped rather than kept alongside: the composite is strictly stronger
-- (matching (user_id, project_id) against (user_id, id) implies project_id exists in projects.id),
-- so keeping both would only duplicate the check and fire two identical ON DELETE actions.
--
-- MATCH SIMPLE — the default, and load-bearing. Under MATCH SIMPLE a row whose FK columns are
-- NOT ALL non-null skips the check entirely, which is exactly the existing behaviour for the two
-- nullable edges: `enqueueJob` writes `project_id: input.projectId ?? null` for every non-project
-- tool, and `generate_report` inserts reports with no job_id. MATCH FULL would demand all-or-none
-- and, because user_id is NOT NULL, would effectively force project_id/job_id NOT NULL — breaking
-- both live write paths. Do NOT add MATCH FULL here.
--
-- ON DELETE SET NULL (project_id) — the column list is also load-bearing, and is the reason this
-- migration needs PostgreSQL 15+ (the cloud project and the local stack are both 17.6, measured).
-- A bare `ON DELETE SET NULL` on a composite key nulls EVERY referencing column, including the
-- NOT NULL user_id, so deleting a parent would fail outright with a not-null violation. The
-- column list restricts the nulling to the parent pointer and leaves ownership intact. That path
-- is not hypothetical: it is what runs when an account is deleted and auth.users cascades into
-- projects and jobs at once (pinned by cross-tenant-fk.db.test.ts).
--
-- ON UPDATE stays at the default NO ACTION, which buys a second guarantee for free: a project or
-- job that already has children can no longer have its user_id changed to another tenant. Nothing
-- in the codebase updates either column, so this refuses only writes that should never happen.
-- ===========================================================================

-- jobs -> projects. Backing index for the parent-delete lookup: jobs_user_created_idx
-- (user_id, created_at) serves the user_id prefix; a project delete is reachable only through the
-- account cascade, which already scans this table by user_id, so no new index is added for it.
alter table public.jobs drop constraint jobs_project_id_fkey;
alter table public.jobs
  add constraint jobs_user_id_project_id_fkey
  foreign key (user_id, project_id) references public.projects (user_id, id)
  on delete set null (project_id);
-- Reverse: alter table public.jobs drop constraint jobs_user_id_project_id_fkey;
--          alter table public.jobs add constraint jobs_project_id_fkey
--            foreign key (project_id) references public.projects (id) on delete set null;

-- gsc_connections -> projects. Both columns are NOT NULL, so MATCH SIMPLE always checks, and
-- CASCADE is unchanged: deleting a project still removes its connection row whole (no column list
-- is needed or allowed for CASCADE). The 0010 unique (user_id, project_id) already indexes it.
alter table public.gsc_connections drop constraint gsc_connections_project_id_fkey;
alter table public.gsc_connections
  add constraint gsc_connections_user_id_project_id_fkey
  foreign key (user_id, project_id) references public.projects (user_id, id)
  on delete cascade;
-- Reverse: alter table public.gsc_connections drop constraint gsc_connections_user_id_project_id_fkey;
--          alter table public.gsc_connections add constraint gsc_connections_project_id_fkey
--            foreign key (project_id) references public.projects (id) on delete cascade;

-- reports -> jobs.
alter table public.reports drop constraint reports_job_id_fkey;
alter table public.reports
  add constraint reports_user_id_job_id_fkey
  foreign key (user_id, job_id) references public.jobs (user_id, id)
  on delete set null (job_id);
-- Reverse: alter table public.reports drop constraint reports_user_id_job_id_fkey;
--          alter table public.reports add constraint reports_job_id_fkey
--            foreign key (job_id) references public.jobs (id) on delete set null;

-- ===========================================================================
-- (3) CLOUD APPLY IS NOT UNCONDITIONAL — run the pre-check FIRST.
--
-- Unlike (1), the three ADD CONSTRAINTs in (2) VALIDATE EVERY EXISTING ROW. If the live database
-- holds even one cross-tenant row, the ALTER does not skip it and does not warn: it FAILS with
-- SQLSTATE 23503 and the whole migration rolls back. That is the correct outcome — a silent
-- NOT VALID would leave the hole open — but it means the human applying this to the cloud project
-- must run the violation count BELOW before applying, and must resolve any non-zero row first.
-- (Local stacks are clean by construction: `supabase db reset` rebuilds from these migrations.)
--
-- Copy-paste, read-only, run against the live DB BEFORE apply. Expected: three rows, all 0.
--
--   select 'jobs->projects' as edge, count(*) as violations
--     from public.jobs j left join public.projects p on p.id = j.project_id
--     where j.project_id is not null and (p.id is null or p.user_id <> j.user_id)
--   union all
--   select 'gsc_connections->projects', count(*)
--     from public.gsc_connections g left join public.projects p on p.id = g.project_id
--     where g.project_id is not null and (p.id is null or p.user_id <> g.user_id)
--   union all
--   select 'reports->jobs', count(*)
--     from public.reports r left join public.jobs j on j.id = r.job_id
--     where r.job_id is not null and (j.id is null or j.user_id <> r.user_id);
--
-- Any non-zero count is a real cross-tenant row that predates this constraint. Do NOT "fix" it by
-- nulling the parent pointer without looking: it is evidence of the exact bug this migration
-- exists to prevent, and the owning user_id should be established before anything is rewritten.
-- ===========================================================================
