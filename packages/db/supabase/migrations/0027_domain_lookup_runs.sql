-- Migration 0027: the run axis for the three DFS DOMAIN LOOKUPS. Every lookup that ran is one row.
--
-- 0024 (audit_runs), 0025 (gsc_discovery_runs) and 0026 (audit_content_runs) opened this axis for
-- the tools that read STORED measurements — a crawl, a Search Console pull, or both. The three
-- DataForSEO domain lookups (ranked_keywords / analyze_backlinks / compare_competitors) still run
-- synchronously, return text and LEAVE NO TRACE: the panel cannot show that a lookup happened,
-- "what did this competitor look like last month" cannot be asked, and a tenant who paid 65-90
-- credits for the answer cannot see it a second time. This table opens that axis.
--
-- WHY IT IS A FOURTH SIBLING RATHER THAN A ROW IN ANY OF THE THREE, and where it DEPARTS from
-- them. The three siblings share one spine: a `<x>_job_id uuid not null` pointing at the SUCCEEDED
-- job whose output the run read. These three tools have no such job and cannot get one. They are
-- charge:"handler" and synchronous — they call the vendor inside the request, settle the ledger
-- without a jobId, and never write a `jobs` row at all (apps/mcp/src/tools/ranked-keywords.ts and
-- its two neighbours say so in their own headers). So the sibling spine is not merely inconvenient
-- here, it is UNWRITABLE, and a nullable imitation of it would be a column that is null on every
-- row of the table forever. This migration therefore adds NO job FK of any kind, and that absence
-- is the first of the three departures recorded below.
--
-- NAME. `domain_lookup_runs`, deliberately NOT `dfs_runs`: `dfs_spend` (0014) is already the VENDOR
-- SPEND ledger and `dfs_spend_today_usd` is the schema sentinel RPC. A `dfs_runs` beside a
-- `dfs_spend` would put two tables one letter apart on the same prefix, one counting dollars and
-- one counting lookups, and every future reader would have to stop and work out which is which.
-- The name says what a row IS — a domain lookup that ran — not which vendor happened to serve it.
--
-- research_keywords IS DELIBERATELY NOT HERE, and that is why the CHECK below lists three names
-- rather than four. It is the fourth DFS tool and it has no domain: its input is a keyword LIST,
-- so it would have nothing to put in `target`, and squeezing a keyword list into a column named
-- `target` would turn the column's name into a lie — 0025's own words about `crawl_job_id`, the
-- same test applied to a different column. If research_keywords ever earns a run axis it earns its
-- own table, keyed by whatever identifies a keyword-set lookup.
--
-- STRUCTURAL REPORT IS STORED, NOT RENDERED TEXT — 0024:8-12, 0025:13-17 and 0026:20-25, the same
-- rule for the fourth time. `report` is the tool's structural result (the ranked-keyword rows and
-- the domain's organic distribution, the backlink summary with its referring domains and anchors,
-- the competitor comparison), never the formatted table the tool returns. The prose is for a human
-- and its wording is free to change; the numbers underneath are what a second surface can query.
--
-- PAYLOAD CLASS IS DIFFERENT FROM THE SIBLINGS, and the rule is stated here even though the code
-- that enforces it belongs to the write path. A ranked_keywords answer may carry up to
-- RANKED_KEYWORDS_MAX_LIMIT rows and a full 1000-row result is ~120 KB of raw vendor JSON — an
-- order of magnitude past anything 0024/0025/0026 store, because those three read measurements
-- this system already capped on the way in (MAX_PAGES_PERSISTED, MAX_CONTENT_MISMATCHES). Nothing
-- caps a vendor response. THE RULE: the writer stores a CAPPED projection of the lists, with the
-- headline counters (the domain's full ranked-keyword total, the referring-domain total, the
-- vendor's `total_count` before truncation) kept as O(1) fields at the TOP of the report so the
-- panel reads them one by one — `report->total`, never the whole document. The cap is the write
-- path's to choose and to test; what this migration fixes is that a row here is a SUMMARY of a
-- lookup, not an archive of a vendor payload.
--
-- LOCALE IS NOT A COLUMN. It goes inside `report`, and the reason is worth writing down because
-- "the tools take a locale, so add a locale column" is the obvious wrong move. analyze_backlinks'
-- vendor endpoint has NO locale parameter at all — its query is exactly `{ target, limit }`
-- (BacklinkProfileQuery, apps/mcp/src/dfs/backlinks.ts) — so a locale column would be null on a
-- whole THIRD of this table's rows for a reason that has nothing to do with the run: not "the
-- locale was unknown" but "the question does not exist for this tool". A column whose null means
-- something different per row is a column that cannot be read without a lookup table of caveats.
-- The panel also only ever DISPLAYS the locale of the run it is showing; it never filters or
-- groups on it, so nothing is paying for the column either.

create table public.domain_lookup_runs (
  id uuid primary key default gen_random_uuid(),
  -- ACCOUNT FK — the SECOND departure from the siblings, and the one that has to exist BECAUSE of
  -- the third (nullable project_id, below). 0024/0025/0026 carry no FK to auth.users and do not
  -- need one: their `project_id` is NOT NULL, so an account delete reaches every one of their rows
  -- through `projects`. Here a row with a null project_id has NO parent in `public` at all, so
  -- without this FK a deleted account would leave its bare-target lookups behind forever —
  -- orphaned rows carrying a tenant id that no longer resolves. A SINGLE-column FK is the right
  -- shape for exactly the reason 0017's header gives for every other one in this schema: "every
  -- other FK in public points at auth.users, where the single referenced column already IS the
  -- tenant and nothing can be forged". There is no cross-tenant edge to close on this side.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- NULLABLE — the THIRD departure, and the one that forces the honesty note on the composite FK
  -- below. All three tools accept EITHER a bare `target` (any public domain, typically a
  -- COMPETITOR's) OR a `project_id`, exactly one of the two (tools/project-target.ts). The
  -- bare-target call is the most typical PAID call these tools serve — looking up somebody else's
  -- domain is the point of them — so NOT NULL here would make the commonest paid lookup
  -- unrecordable, which is the whole failure this table exists to end.
  project_id uuid,
  -- The three synchronous domain lookups. The CHECK binds the table to these three runs: a fourth
  -- tool writing here is something this slice did not design for, and it fails at INSERT rather
  -- than leaking in silently. The column exists at all only because there is more than one tool —
  -- 0026's rule, applied in the other direction: a single-valued column would state nothing, three
  -- values are what tells these rows apart.
  tool text not null check (
    tool in ('ranked_keywords', 'analyze_backlinks', 'compare_competitors')
  ),
  -- The normalized domain the lookup RAN AGAINST (normalizeDomain's output, resolved from either
  -- input by resolveTarget). NOT NULL, and it is the load-bearing column of this table: for a
  -- bare-target run it is the row's whole identity — project_id is null, so `target` is the only
  -- answer to "what did I look up" — and for a project run it records what the project's domain
  -- was AT THE TIME, which a join to `projects` could not recover after the domain changed.
  target text not null,
  -- STRUCTURAL report (jsonb): the tool's own result object. Its shape varies by tool and is
  -- DELIBERATELY schemaless, 0024:28-32 / 0025:38-44's reasoning unchanged — the three reports
  -- share no common column set (one carries keyword rows, one a backlink profile, one a
  -- competitor comparison), and a column per field would make the table as sparse as their union.
  -- The locale of the run lives in here for the reason the header gives, alongside the capped
  -- lists and the headline counters above them.
  report jsonb not null,
  created_at timestamptz not null default now(),

  -- CROSS-TENANT ARMOR, 0017 pattern (0024:36-49 / 0025:56-62 / 0026:44-55, same reasoning) — WITH
  -- ONE COST THAT MUST BE STATED RATHER THAN HIDDEN. A single-column `project_id -> projects (id)`
  -- would only ask "does this id exist"; the composite key also asks "and does it belong to the
  -- SAME tenant". `projects` carries the `(user_id, id)` unique constraint 0017 added, so this FK
  -- needs no new parent constraint.
  --
  -- THE COST: unlike all three siblings, `project_id` here is NULLABLE, and the default MATCH
  -- SIMPLE SKIPS THE CHECK ENTIRELY on any row where it is null. On those rows this constraint
  -- guarantees nothing at all, and the tenant guarantee is `user_id` ALONE — which is what the
  -- select policy filters on, what the panel queries by, and what the auth.users FK above anchors
  -- to a real account. That is a genuinely weaker guarantee than the siblings have, it is the
  -- price of recording bare-target lookups, and it is written here rather than left for a reader
  -- to derive from the absence of a NOT NULL. Column-list-free CASCADE: when the project is
  -- deleted its lookups go with it; a project_id-null lookup of the same tenant is untouched by
  -- that delete and leaves only with the account.
  constraint domain_lookup_runs_user_id_project_id_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id)
    on delete cascade
);
-- Reverse: drop table public.domain_lookup_runs;

-- THE PANEL'S QUERY, 0024:53-58 / 0025:62-67 / 0026:57-63 shape. /app/projects reads the most
-- recent run of each tool for a project:
--   where user_id = ? and project_id = ? and tool = ? order by created_at desc limit 1
-- This index gives the first two columns and the ordering; `tool` stays a residual filter, because
-- a project's lookup count is of three-digit order and pushing that filter into the index buys
-- nothing measurable — 0025's argument, unchanged. The same index is the backing index for the
-- `projects` parent-delete lookup (user_id prefix).
create index domain_lookup_runs_user_project_created_idx
  on public.domain_lookup_runs (user_id, project_id, created_at desc);
-- Reverse: drop index public.domain_lookup_runs_user_project_created_idx;

-- No separate index for the auth.users parent-delete lookup: `user_id` is this index's LEADING
-- column, so the account cascade is already served by it — the reasoning 0017 (0017:96-98), 0023,
-- 0024, 0025 and 0026 all give for their own parent edges, and here it costs nothing extra.

alter table public.domain_lookup_runs enable row level security;
alter table public.domain_lookup_runs force row level security;
-- Reverse: alter table public.domain_lookup_runs disable row level security;

create policy "domain_lookup_runs_select_own"
  on public.domain_lookup_runs for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "domain_lookup_runs_select_own" on public.domain_lookup_runs;

-- What 0021:38-44 measured (repeated in 0023, 0024, 0025 and 0026): the base image's default ACL
-- for a new public table is Dxtm ONLY, not DML. Without a GRANT the service_role insert fails with
-- `permission denied for table domain_lookup_runs` even though it bypasses RLS. RLS is the SECOND
-- gate, never a replacement for the first.
--
-- service_role: select + insert. UPDATE/DELETE deliberately absent. A lookup run is the record of
-- what the vendor said at that moment; it is not something to correct later. Re-running the lookup
-- produces a NEW row rather than rewriting an old one, because otherwise "what did this domain
-- look like last month" would be a question whose answer can be changed retroactively. Rows leave
-- only with their parents — the project (when there is one) or the account — via cascade.
--
-- authenticated: table-level select. No column here holds a secret. `target` is a public domain
-- name and `report` is a derivative of PUBLIC search-result data about it; nothing in either is
-- privileged to the tenant beyond the fact that they paid to ask.
grant select on public.domain_lookup_runs to authenticated;
grant select, insert on public.domain_lookup_runs to service_role;
-- Reverse: revoke select, insert on public.domain_lookup_runs from service_role;
--          revoke select on public.domain_lookup_runs from authenticated;

-- 0016 pattern (0016:111-117), applied to this table — a NO-OP in the expected state and written
-- anyway: the residual gap 0016 documents (a second default ACL with grantor `supabase_admin`)
-- stays live if another role ever creates this table, and TRUNCATE walks past RLS and every
-- row-level trigger alike. The real defence is public-truncate-armor.db.test.ts's ENUMERATION,
-- which this table joins the moment it exists.
revoke truncate on table public.domain_lookup_runs from anon, authenticated, service_role;

-- Additive: no existing table, policy, grant or FK changed. audit_runs, gsc_discovery_runs and
-- audit_content_runs were NOT touched (this is a fourth sibling, not an extension of any of them),
-- and neither credit_ledger (NEVER #2) nor dfs_spend (0014) was touched. This table carries no
-- money at all, and it sits between the two that do: the lookup's PRICE is in credit_ledger, the
-- vendor COST is in dfs_spend, the run itself is here.
