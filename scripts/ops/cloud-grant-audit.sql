-- cloud-grant-audit.sql — READ-ONLY. Reports any public relation whose table-level DML exceeds
-- what packages/db/supabase/migrations grants. Run it BY HAND against the cloud project; see
-- docs/runbooks/cloud-grant-audit.md for when and how.
--
-- WHY THIS IS A MANUAL PROCEDURE AND NOT A CI JOB, said before anything else so it cannot be
-- misread later: no gate in this repo can reach the cloud project, and the divergence this
-- query looks for DOES NOT EXIST on a local stack. The local default ACL for a new public table
-- is `xtm` (no DML); the cloud one is `arwdxtm`. So a local run of this query is green whatever
-- the cloud is doing, and running it in CI would produce a green light that means nothing.
-- Nothing automated covers this. A human runs it, or it is not run.
--
-- WHAT IT DOES NOT COVER: TRUNCATE (public-truncate-armor.db.test.ts and 0016 own it),
-- REFERENCES / TRIGGER / MAINTAIN (0016 left them deliberately), roles other than the three
-- application roles, and privileges on schemas other than public.
--
-- Writes nothing. Safe on production. Every statement is a SELECT.

-- ===========================================================================================
-- (A) THE MECHANISM. Read this first — it is the cause, and the per-relation report below is
-- only its symptom. Expected AFTER migration 0028:
--
--   grantor postgres        -> anon/authenticated/service_role = xtm
--   grantor supabase_admin  -> anon/authenticated/service_role = arwdDxtm   (known residual,
--                              unreachable from a migration — 0016 measured the permission
--                              denial. Harmless only because nothing creates relations as
--                              supabase_admin; if a relation ever appears with the full set
--                              and no migration explains it, this is the first suspect.)
--
-- Any `a`, `r`, `w` or `d` in the POSTGRES row means 0028 part (5) was not applied, or was
-- applied by a role other than the one that owns the relations. Every relation created after
-- that point is born wide open again.
-- ===========================================================================================
select
  defaclrole::regrole            as grantor,
  defaclobjtype                  as objtype,
  defaclacl                      as stored_default_acl
from pg_default_acl
where defaclnamespace = 'public'::regnamespace
order by defaclrole::regrole::text;

-- ===========================================================================================
-- (B) PER-RELATION EXCESS. One row per (relation, role) where the role holds a table-level DML
-- privilege the migrations never granted it.
--
-- The `expected` list below is transcribed from the migrations and is the one hand-maintained
-- thing here: when a migration grants a NEW privilege, add it, or this query will report the
-- legitimate grant as excess. It is deliberately not derived — a query that derived the
-- expectation from the live database would agree with whatever it found.
--
-- Sources, per relation: 0002/0005 (credit_ledger, credit_balances) · 0003/0006 (events,
-- paddle_events, gsc_connections) · 0006 (0001's six core tables) · 0012 (gsc_connections
-- DELETE) · 0014 (dfs_spend) · 0020 (trial_claims) · 0021 (gsc_accounts) · 0023-0027 (the five
-- run ledgers). gsc_accounts expects NOTHING table-level for authenticated on purpose: 0021
-- grants it a COLUMN list, and a table-level SELECT there is precisely the hole 0028 closed —
-- it would let an owner read encrypted_refresh_token over the Data API.
-- ===========================================================================================
with expected(relname, role_name, privs) as (
  values
    ('users_profile','anon',''),              ('users_profile','authenticated','SELECT'),              ('users_profile','service_role','SELECT,INSERT,UPDATE'),
    ('projects','anon',''),                   ('projects','authenticated','SELECT'),                   ('projects','service_role','SELECT,INSERT,UPDATE'),
    ('api_keys','anon',''),                   ('api_keys','authenticated','SELECT'),                   ('api_keys','service_role','SELECT,INSERT,UPDATE'),
    ('subscriptions','anon',''),              ('subscriptions','authenticated','SELECT'),              ('subscriptions','service_role','SELECT,INSERT,UPDATE'),
    ('jobs','anon',''),                       ('jobs','authenticated','SELECT'),                       ('jobs','service_role','SELECT,INSERT,UPDATE'),
    ('reports','anon',''),                    ('reports','authenticated','SELECT'),                    ('reports','service_role','SELECT,INSERT,UPDATE'),
    ('credit_ledger','anon',''),              ('credit_ledger','authenticated','SELECT'),              ('credit_ledger','service_role','SELECT,INSERT'),
    ('credit_balances','anon',''),            ('credit_balances','authenticated','SELECT'),            ('credit_balances','service_role','SELECT'),
    ('events','anon',''),                     ('events','authenticated','SELECT'),                     ('events','service_role','SELECT,INSERT'),
    ('paddle_events','anon',''),              ('paddle_events','authenticated',''),                    ('paddle_events','service_role','SELECT,INSERT,UPDATE'),
    ('gsc_connections','anon',''),            ('gsc_connections','authenticated','SELECT'),            ('gsc_connections','service_role','SELECT,INSERT,UPDATE,DELETE'),
    ('dfs_spend','anon',''),                  ('dfs_spend','authenticated',''),                        ('dfs_spend','service_role','SELECT,INSERT,UPDATE'),
    ('trial_claims','anon',''),               ('trial_claims','authenticated',''),                     ('trial_claims','service_role','SELECT,INSERT,UPDATE'),
    ('gsc_accounts','anon',''),               ('gsc_accounts','authenticated',''),                     ('gsc_accounts','service_role','SELECT,INSERT,UPDATE,DELETE'),
    ('crawl_pages','anon',''),                ('crawl_pages','authenticated','SELECT'),                ('crawl_pages','service_role','SELECT,INSERT'),
    ('audit_runs','anon',''),                 ('audit_runs','authenticated','SELECT'),                 ('audit_runs','service_role','SELECT,INSERT'),
    ('gsc_discovery_runs','anon',''),         ('gsc_discovery_runs','authenticated','SELECT'),         ('gsc_discovery_runs','service_role','SELECT,INSERT'),
    ('audit_content_runs','anon',''),         ('audit_content_runs','authenticated','SELECT'),         ('audit_content_runs','service_role','SELECT,INSERT'),
    ('domain_lookup_runs','anon',''),         ('domain_lookup_runs','authenticated','SELECT'),         ('domain_lookup_runs','service_role','SELECT,INSERT')
),
live as (
  select c.relname::text as relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm')
),
actual as (
  select l.relname, r.role_name, p.priv
    from live l
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
   where has_table_privilege(r.role_name, ('public.' || quote_ident(l.relname))::regclass, p.priv)
)
select
  a.relname,
  a.role_name,
  a.priv                                     as held_but_not_granted,
  coalesce(e.privs, '(relation not in the expected list — a migration added it and this file '
                    'was not updated, or something outside the migrations created it)') as expected_here
from actual a
left join expected e on e.relname = a.relname and e.role_name = a.role_name
where e.privs is null
   or position(a.priv in e.privs) = 0
order by a.relname, a.role_name, a.priv;
-- ZERO ROWS is the pass. Any row is a live excess privilege on the production database.

-- ===========================================================================================
-- (C) THE COLUMN-LEVEL HALF, for gsc_accounts only. 0021 fences off encrypted_refresh_token
-- with a column grant; (B) proves no table-level SELECT is standing beside it, and this proves
-- the column grant itself survived — a table-level REVOKE drops column entries too, so a
-- mis-ordered repair silently blinds the panel instead of erroring.
--
-- Expected: ciphertext_readable = false, panel_columns_readable = true. Any other combination
-- is a finding: `true/…` is the leak, `…/false` is the panel broken.
-- ===========================================================================================
select
  has_column_privilege('authenticated', 'public.gsc_accounts', 'encrypted_refresh_token', 'SELECT')
    as ciphertext_readable,
  has_column_privilege('authenticated', 'public.gsc_accounts', 'google_account_email', 'SELECT')
   and has_column_privilege('authenticated', 'public.gsc_accounts', 'token_status', 'SELECT')
    as panel_columns_readable;
