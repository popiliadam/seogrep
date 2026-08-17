-- Migration 0026: the run axis for audit_content. Every content audit that ran is one row.
--
-- 0024 did this for the three CRAWL audits and 0025 for the three PULL analyses. audit_content is
-- the first tool that reads BOTH — it joins a stored Search Console pull (which queries the site
-- earns impressions for) against a stored crawl (what each page's title and h1s actually say) —
-- and that is precisely why it cannot borrow either table. 0024's row points at a crawl and has
-- no column for the pull; 0025's points at a pull and has no column for the crawl. A run recorded
-- in either would be missing half of its own provenance, and "which two measurements produced
-- this?" is the first question anyone comparing two runs has to answer.
--
-- NO `tool` COLUMN, and therefore no CHECK. 0024 and 0025 each serve THREE tools, so a `tool`
-- column is what tells their rows apart and the CHECK is what stops a fourth tool leaking in.
-- This table serves ONE tool and is named after it: a column whose value is the same literal on
-- every row states nothing, and a CHECK over a single-valued column is a constraint that can
-- never fire. If a second content tool is ever built, adding the column then is a migration —
-- adding it now is a guess about what that tool would need (YAGNI, deliberately).
--
-- YAPISAL RAPOR SAKLANIR, RENDER EDİLMİŞ METİN DEĞİL — 0024:8-12 and 0025:13-17, same rule and
-- same reason. `report` is the engine's ContentMatchResult plus the counters carried above it
-- (packages/core/src/content/title-query-match.ts, wrapped by apps/mcp/src/tools/
-- audit-content-runs.ts), never the formatted text the tool returns. The prose is for a human and
-- its wording is free to change; the numbers underneath — how many queries mismatched, the
-- biggest one, how much of the pull could not be joined — are what a second surface can query.

create table public.audit_content_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  -- The SUCCEEDED pull_gsc_data job the audit read (getLatestSucceededPull's), and the SUCCEEDED
  -- crawl_site job it read (getLatestSucceededCrawl's). BOTH NOT NULL: an audit_content run
  -- without either one cannot exist — the tool refuses, free of charge, before it reserves a
  -- credit (gsc-data/load.ts and audit/load.ts each answer first), so a row missing one of them
  -- would describe a run that never happened.
  pull_job_id uuid not null,
  crawl_job_id uuid not null,
  -- YAPISAL rapor (jsonb): the engine's object. KASTEN şemasız, 0024:28-32'nin gerekçesiyle — the
  -- mismatch list grows with the property and the panel reads the headline fields ONE BY ONE
  -- (`report->total`, `report->top`), never the whole document. Those two sit at the TOP of the
  -- report as O(1) fields for exactly that reason; the list itself is capped at 50
  -- (MAX_CONTENT_MISMATCHES) so a large site cannot make one row unbounded.
  report jsonb not null,
  created_at timestamptz not null default now(),

  -- CROSS-TENANT ZIRHI, 0017 deseni (0024:36-49 ve 0025:45-58 ile birebir aynı gerekçe). A
  -- single-column `pull_job_id -> jobs (id)` only asks "does this id exist"; the composite key
  -- also asks "and does it belong to the SAME tenant". jobs and projects carry the `(user_id, id)`
  -- unique constraints 0017 added, so none of these three FKs needs a new parent constraint.
  --
  -- All three column pairs are NOT NULL, so MATCH SIMPLE genuinely checks on every row. CASCADE
  -- without a column list: when EITHER input job — or the project — is deleted, the run goes with
  -- it. A content audit whose pull or whose crawl no longer exists is a row nobody can interpret,
  -- and unlike 0024/0025 there are two ways for that to happen, both of them covered here.
  constraint audit_content_runs_user_id_pull_job_id_fkey
    foreign key (user_id, pull_job_id) references public.jobs (user_id, id)
    on delete cascade,
  constraint audit_content_runs_user_id_crawl_job_id_fkey
    foreign key (user_id, crawl_job_id) references public.jobs (user_id, id)
    on delete cascade,
  constraint audit_content_runs_user_id_project_id_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id)
    on delete cascade
);
-- Reverse: drop table public.audit_content_runs;

-- PANELİN SORGUSU, 0024:53-58 / 0025:62-67 ile aynı şekil. /app/projects reads a project's most
-- recent run:
--   where user_id = ? and project_id = ? order by created_at desc limit 1
-- and unlike the other two tables there is no `tool` filter to leave residual, because there is
-- only one tool here — so this index covers the whole query. It is also the backing index for the
-- `projects` parent-delete lookup (user_id prefix).
create index audit_content_runs_user_project_created_idx
  on public.audit_content_runs (user_id, project_id, created_at desc);
-- Reverse: drop index public.audit_content_runs_user_project_created_idx;

-- No separate index for either `jobs` parent-delete lookup: a job is only ever deleted through an
-- account/project cascade, and that path already scans this table by its user_id prefix — the
-- reasoning 0025:72-74, 0024:63-65, 0023 and 0017 all give, unchanged by there being two job FKs
-- rather than one (both are searched by the same leading column).

alter table public.audit_content_runs enable row level security;
alter table public.audit_content_runs force row level security;
-- Reverse: alter table public.audit_content_runs disable row level security;

create policy "audit_content_runs_select_own"
  on public.audit_content_runs for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "audit_content_runs_select_own" on public.audit_content_runs;

-- 0021:38-44'te ölçülen şey (0023, 0024 ve 0025'te tekrarlandı): the base image's default ACL for
-- a new public table is Dxtm ONLY, not DML. Without a GRANT the service_role insert fails with
-- `permission denied for table audit_content_runs` even though it bypasses RLS. RLS is the SECOND
-- gate, never a replacement for the first.
--
-- service_role: select + insert. UPDATE/DELETE deliberately absent. A run is the record of what
-- was measured at that moment; correcting a threshold produces a NEW run rather than rewriting an
-- old one, because otherwise "what did this say last month" would be a question whose answer can
-- be changed retroactively. Rows leave only with their parents (either job / the project / the
-- account), via cascade.
--
-- authenticated: table-level select. No column here holds a secret — `report` is a derivative of
-- the tenant's OWN Search Console data and their own site's public HTML, and both of those are
-- already readable by this role through `jobs.result`.
grant select on public.audit_content_runs to authenticated;
grant select, insert on public.audit_content_runs to service_role;
-- Reverse: revoke select, insert on public.audit_content_runs from service_role;
--          revoke select on public.audit_content_runs from authenticated;

-- 0016 deseni (0016:111-117), applied to this table — a NO-OP in the expected state and written
-- anyway: the residual gap 0016 documents (a second default ACL with grantor `supabase_admin`)
-- stays live if another role ever creates this table, and TRUNCATE walks past RLS and every
-- row-level trigger alike. The real defence is public-truncate-armor.db.test.ts's ENUMERATION,
-- which this table joins the moment it exists.
revoke truncate on table public.audit_content_runs from anon, authenticated, service_role;

-- Additive: no existing table, policy, grant or FK changed. audit_runs and gsc_discovery_runs were
-- NOT touched (this is a third sibling, not an extension of either), and credit_ledger (NEVER #2)
-- was not touched — this table carries no money: the audit's price is in the ledger, the run
-- itself is here.
