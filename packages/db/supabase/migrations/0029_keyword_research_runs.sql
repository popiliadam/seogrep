-- Migration 0029: the run axis for research_keywords — the ONE DFS tool 0027 deliberately left out.
--
-- 0027 opened the run axis for the three DFS DOMAIN lookups and named the exclusion in its own
-- header: "research_keywords IS DELIBERATELY NOT HERE ... it has no domain: its input is a keyword
-- LIST, so it would have nothing to put in `target`, and squeezing a keyword list into a column
-- named `target` would turn the column's name into a lie. If research_keywords ever earns a run
-- axis it earns its own table, keyed by whatever identifies a keyword-set lookup."
--
-- This is that table, and the whole of the design below is the answer to that last clause. The
-- tool is 25 credits a call (NEVER #6 — unchanged by this migration and by the code beside it), it
-- runs synchronously, prints a table and leaves no trace: a tenant who priced forty keywords last
-- month cannot see what the numbers were, and nothing in the panel can say the lookup happened.
--
-- ── WHAT IDENTIFIES A KEYWORD-SET LOOKUP ─────────────────────────────────────────────────────
--
-- The subject of a domain lookup is a domain, and 0027 stores `normalizeDomain`'s output. The
-- subject here is the SET OF KEYWORDS ASKED ABOUT, and this table stores it directly, in
-- `keyword_set`, as the normalizer's output — nothing is hashed, nothing is invented, and there is
-- no surrogate "set id" for a reader to fail to recompute. The identity IS the data, it is printed
-- on the panel, and a tenant can read their own key off the screen. The derivation, which
-- `normalizeKeywordSet` (apps/mcp/src/dfs/keyword-runs.ts) owns and its spec pins:
--
--   trim → collapse internal whitespace runs to one space → lowercase → drop blanks → dedupe →
--   sort ascending by UTF-16 code unit.
--
-- Each step answers a question this table has to have an answer to, and the answers are written
-- here rather than left for a reader to derive from the code:
--
--   IS THE SAME LIST ASKED TWICE ONE RUN OR TWO? TWO ROWS, always. This table is append-only in
--   exactly 0027's sense — a row is what the vendor said at that moment, and "what was this
--   keyword worth last month" must not be a question whose answer can be rewritten. Two rows
--   sharing a `keyword_set` is not a duplicate; it is the entire mechanism by which a change over
--   time can be shown, so there is deliberately no unique constraint on (user_id, keyword_set).
--
--   DOES ORDER MATTER? NO. The vendor answers per keyword and the answer for "seo tools" does not
--   depend on whether it was typed first or fortieth, so a sorted set is the honest subject and
--   two runs that differ only in typing order are two runs of the SAME question. The cost is
--   stated rather than hidden: this column is NOT the caller's literal argument, and a surface
--   that wanted to replay a request verbatim cannot get it from here.
--
--   DOES CASE MATTER? NO — and the EVIDENCE FOR THAT IS WEAKER THAN THE DECISION, which is why
--   the two are separated here rather than blended into one confident sentence. What the repo can
--   show: every keyword in its own captured response fixture
--   (apps/mcp/src/dfs/fixtures/keyword-overview.json) comes back lowercase. What the repo CANNOT
--   show: the casing of the REQUEST that produced it, which is recorded nowhere. So "the vendor
--   lowercases what you send" is an INFERENCE from a response-only capture, not a measurement of
--   the round trip — the exact gap signed lesson 9 exists to name, and it is written down instead
--   of being rounded up to "measured".
--
--   The decision survives the weaker evidence, which is the point of stating both. Folding case is
--   safe in the direction that matters: if the vendor really is case-insensitive, splitting "SEO
--   Tools" from "seo tools" would fork ONE subject into two that can never be compared, for a
--   difference the answer does not carry. If the vendor were case-SENSITIVE, folding would merge
--   two subjects — but then the merged rows would disagree on their numbers, which is visible,
--   whereas a silent fork is not. A capture of a mixed-case REQUEST would settle it and upgrade
--   this paragraph from inference to measurement; until someone runs one, it stays an inference.
--
--   HOW DOES A 40-KEYWORD LIST RELATE TO A 39-KEYWORD SUBSET? AT THIS GRAIN, NOT AT ALL, and the
--   refusal is the point. The comparable number a set-shaped run carries is an AGGREGATE (total
--   monthly searches across the answered keywords), and subtracting the aggregate of 39 keywords
--   from that of 40 would print "+2,400 searches a month" when the tenant merely added a keyword —
--   the same manufactured measurement `compare_competitors` is refused a change clause for
--   (apps/web/lib/projects/lookup-history.ts). So the panel compares a run only with another run
--   of the IDENTICAL set.
--   The genuinely interesting question that grain cannot answer — "what happened to THIS keyword
--   across every list I ever asked it in" — is named here rather than pretended away: it needs a
--   per-keyword axis (a row per keyword per run), which is a different table and a different
--   slice. `keyword_set` is a `text[]` and not an opaque digest partly so that axis stays open:
--   `where keyword_set @> array['seo tools']` is a query this shape can answer and a hash cannot.
--
--   WHAT IF THE CALLER ASKS FOR 100 AND THE VENDOR ANSWERS FOR 97? The IDENTITY is the QUESTION,
--   never the answer, so `keyword_set` still carries all 100: a partial answer must not silently
--   become a different subject, or a tenant's history would fork every time the vendor's coverage
--   moved. The coverage itself is recorded IN THE REPORT — `requested`, `returned` and `answered`
--   are three separate O(1) fields — and the panel folds `answered` into its comparison key, so a
--   run that answered 97 is never subtracted from one that answered 100. A keyword crossing from
--   "no data" to "data" adds its whole volume to the aggregate; reporting that as demand growth
--   would be the panel asserting a measurement nobody made.
--
-- ── NO `tool` COLUMN, AND NO `project_id` COLUMN ─────────────────────────────────────────────
--
-- NO `tool`: 0026's rule, which 0027 quotes in the other direction — a column exists because there
-- is more than one value to tell rows apart, and a single-valued column states nothing. One tool
-- writes here and the table's NAME says which. A second keyword-set tool earns the column then,
-- additively, together with the CHECK that constrains it.
--
-- NO `project_id`: research_keywords takes no project. Its input schema is `keywords` +
-- `language_code` + `location_code` and nothing else (apps/mcp/src/tools/research-keywords.ts), so
-- unlike 0027's three tools there is no `resolveTarget` here and no project to resolve from. A
-- nullable project column would be null on every row of this table forever — precisely the
-- "unwritable spine" 0027 refused to imitate for the job FK. It follows that this table cannot
-- appear on a project card at all, and the panel half of this slice says so out loud instead of
-- inventing a project↔keyword-set relation the tool never established.
--
-- ── THE auth.users FK IS MANDATORY HERE, NOT A DEPARTURE ─────────────────────────────────────
--
-- 0024/0025/0026 need no FK to auth.users because their `project_id` is NOT NULL, so an account
-- delete reaches their rows through `projects`. 0027 needed one because SOME of its rows (the
-- bare-target ones) have no parent in `public`. Here EVERY row has no parent in `public`: there is
-- no project column to cascade through, so without this FK a deleted account would leave its whole
-- keyword-research history behind forever, carrying a tenant id that no longer resolves. Single
-- column, for 0017's reason: the referenced column already IS the tenant and nothing can be forged,
-- so there is no cross-tenant edge to close on this side — and, unlike 0027, no composite FK is
-- possible or needed, which also means the tenant guarantee here is `user_id` alone WITHOUT the
-- caveat 0027 had to write: there is no second key whose MATCH SIMPLE check silently skips.
--
-- ── STRUCTURAL REPORT STORED, NEVER RENDERED TEXT ────────────────────────────────────────────
--
-- 0024:8-12, 0025:13-17, 0026:20-25 and 0027:33-37, the same rule for the fifth time. `report` is
-- the tool's structural result — the per-keyword metric rows and the counters above them — never
-- the table the tool prints. The prose is for a human and free to change; the numbers underneath
-- are what a second surface can query. Storing the sentence would force a panel to parse English
-- to learn what a keyword's volume was.
--
-- THE CAP, and why it is 100 rather than 0027's 50. 0027 capped at 50 because NOTHING bounds a
-- ranked_keywords answer — the caller may ask for 1000 rows and get ~120 KB of vendor JSON. Here
-- the tool's own input schema is `.max(100)`, so the answer is bounded at ~100 small rows
-- (keyword, volume, cpc, competition, difficulty, intent, trend ≈ 25 KB worst case, the same size
-- class as a 50-row ranked_keywords report) and the whole answer is what the tenant paid for: a
-- half-stored keyword table would make the row useless for the one thing this table exists for.
-- MAX_KEYWORD_RUN_ROWS is therefore a CONSTANT that happens to equal today's input ceiling and
-- does NOT track it: the day the schema's `.max()` moves, the stored payload does not, which is
-- exactly the property a cap has to have. The headline counters (`total`, `requested`, `returned`,
-- `answered`) are always PRE-cap and sit at the TOP of the report, so the panel reads
-- `report->total` and never downloads the row list — 0025's DiscoverySummary argument: PostgREST
-- navigates into jsonb but cannot count an array or take its first element.
--
-- LOCALE LIVES INSIDE THE REPORT, and here the reason is the opposite of 0027's. There the locale
-- was refused a column because it would be null on a third of the rows (analyze_backlinks' vendor
-- endpoint has no locale parameter at all); here EVERY row has one, so that argument does not
-- apply and a column would be well-defined. It stays in the report anyway because nothing queries
-- it: the panel's only read is "this tenant's runs, newest first", the locale is compared in
-- memory over that bounded window, and a column nobody filters or groups on in the database is a
-- column nobody is paying for. Consistency with the four sibling reports is the tiebreak, not the
-- argument.

create table public.keyword_research_runs (
  id uuid primary key default gen_random_uuid(),
  -- The tenant, and the ONLY parent this table has anywhere. See the FK note in the header: every
  -- row here is parentless in `public`, which is the whole reason this reference is not optional.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- THE SUBJECT OF THE RUN: the normalized, de-duplicated, sorted keyword set the lookup asked
  -- about. NOT the caller's literal argument — the header states the derivation and what is
  -- deliberately lost with it. This is the load-bearing column of the table, in exactly the sense
  -- 0027's `target` is the load-bearing column of its own: there is no project and no domain, so
  -- this is the only answer to "what did I look up".
  --
  -- text[] and not a digest, on purpose: a key nobody can recompute is a key nobody can query. The
  -- panel prints these words, so the tenant can read the key off the screen, and a later
  -- per-keyword surface can ask `keyword_set @> array['…']` of it.
  keyword_set text[] not null,
  -- A run with no subject identifies nothing and could never be shown to anyone, so the empty set
  -- is refused by the DATABASE rather than by app discipline (0013's argument, at this table's
  -- scale). The write path cannot reach this: research_keywords refuses an all-blank keyword list
  -- BEFORE the credit reserve, free of charge. That is what a CHECK should be — an invariant, not
  -- an app error path — and the spec that proves it fires hands the real writer an empty set
  -- directly.
  --
  -- NO UPPER BOUND HERE, deliberately. The tool's `.max(100)` is a product decision about one
  -- caller-facing surface; copying it into the schema would mean a signed decision to widen the
  -- tool starts failing at INSERT, after the vendor was paid — the write path's cap
  -- (MAX_KEYWORD_RUN_ROWS) is where a bound belongs, because it truncates instead of rejecting.
  constraint keyword_research_runs_keyword_set_not_empty
    check (cardinality(keyword_set) >= 1),
  -- STRUCTURAL report (jsonb): counters first, then the capped per-keyword rows. Schemaless for
  -- 0024:28-32 / 0025:38-44's reason — the vendor's per-keyword field set is theirs, not ours, and
  -- a column per metric would make this table as wide and as sparse as DataForSEO's response.
  report jsonb not null,
  created_at timestamptz not null default now()
);
-- Reverse: drop table public.keyword_research_runs;

-- THE PANEL'S QUERY, 0027:124-132 shape one column shorter. /app/lookups reads this tenant's runs,
-- newest first, bounded:
--   where user_id = ? order by created_at desc limit N
-- This index is exactly that, and it is also the backing index for the auth.users parent-delete
-- lookup (`user_id` is its leading column) — the reasoning 0017, 0023, 0024, 0025, 0026 and 0027
-- all give for their own parent edges. No index on `keyword_set`: nothing queries by set today
-- (the panel groups in memory over the bounded window above), and an unused GIN index on a column
-- of up to 100 short strings costs writes to answer a question nobody is asking yet.
create index keyword_research_runs_user_created_idx
  on public.keyword_research_runs (user_id, created_at desc);
-- Reverse: drop index public.keyword_research_runs_user_created_idx;

alter table public.keyword_research_runs enable row level security;
alter table public.keyword_research_runs force row level security;
-- Reverse: alter table public.keyword_research_runs disable row level security;

create policy "keyword_research_runs_select_own"
  on public.keyword_research_runs for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "keyword_research_runs_select_own" on public.keyword_research_runs;

-- GRANTS, and every one of the twelve cells is DECIDED — guardrails/check-grants.sh (added
-- alongside 0028, wired into verify.sh and CI static-guards) fails this migration otherwise, and
-- 0028's header says why a silent cell is not a small thing: on the cloud project the default ACL
-- hands a NEW table the full DML surface to all three roles, so "not mentioned" means GRANTED
-- there while the local stack shows nothing at all.
--
-- service_role: select + insert. UPDATE/DELETE deliberately absent and now actually revoked — a
-- run is what the vendor said at that moment, re-running produces a NEW row, and rows leave only
-- with their account via cascade. authenticated: table-level select; no column here is privileged
-- beyond the fact that the tenant paid to ask — `keyword_set` is a list of words they typed and
-- `report` is a derivative of PUBLIC search-volume data about them. anon: nothing at all.
grant select on public.keyword_research_runs to authenticated;
grant select, insert on public.keyword_research_runs to service_role;
-- Reverse: revoke select, insert on public.keyword_research_runs from service_role;
--          revoke select on public.keyword_research_runs from authenticated;

revoke select, insert, update, delete on public.keyword_research_runs from anon;
revoke insert, update, delete on public.keyword_research_runs from authenticated;
revoke update, delete on public.keyword_research_runs from service_role;
-- Reverse: grant select, insert, update, delete on public.keyword_research_runs to anon;
--          grant insert, update, delete on public.keyword_research_runs to authenticated;
--          grant update, delete on public.keyword_research_runs to service_role;

-- 0016 pattern, applied to this table — a NO-OP in the expected state and written anyway: TRUNCATE
-- walks past RLS and every row-level trigger alike, and 0016's documented residual (a second
-- default ACL with grantor `supabase_admin`) stays live if another role ever creates this table.
-- The real defence is public-truncate-armor.db.test.ts's ENUMERATION over pg_catalog, which this
-- table joins the moment it exists, as it joins public-rls-force-armor.db.test.ts's.
revoke truncate on table public.keyword_research_runs from anon, authenticated, service_role;

-- Additive: no existing table, policy, grant, index or FK changed. domain_lookup_runs was NOT
-- touched — this is a FIFTH sibling, not an extension of the fourth, and 0027's CHECK still names
-- three tools and still excludes this one. Neither credit_ledger (NEVER #2) nor dfs_spend (0014)
-- was touched: the lookup's PRICE stays in credit_ledger, the vendor COST stays in dfs_spend, and
-- the run itself is here. This migration moves no price (NEVER #6): research_keywords costs 25
-- credits before it and 25 credits after it.
