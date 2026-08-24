-- Migration 0032: the run axis for the THREE DFS tools 0027 and 0031 could not take — the ones
-- whose subject is not a domain, and not always the same KIND of thing twice.
--
-- 0031's header names them and says what they need: "discover_keywords has four modes and three of
-- them carry no domain; ai_visibility's subject is a domain OR a keyword; ai_visibility_compare
-- takes a flat 2-10 array with no headline subject at all, each entry a domain, a keyword or a
-- project id. Every one of them would have to put a non-domain in `target` ... They need a
-- discriminated-subject axis of their own." This is that axis.
--
-- All three ship the same amnesia the other eight shipped: synchronous, `charge:"handler"`, they
-- call DataForSEO inside the request, print a table and LEAVE NO TRACE. discover_keywords is 40
-- credits a call, ai_visibility 90, ai_visibility_compare 90 PER COMPARED TARGET (180-900 a call).
-- This migration moves NO price (NEVER #6): they cost exactly the same before and after it.
--
-- ══ THE LOAD-BEARING COLUMN, AND 0027'S TEST APPLIED TO IT ═══════════════════════════════════
--
-- 0027's test is that every column must mean the same thing on every row, and that its `target`
-- must genuinely be THE NORMALIZED DOMAIN THE LOOKUP RAN AGAINST. 0029 answered the same question
-- for a keyword LIST with `keyword_set text[]`. Neither shape fits a row that might be one domain,
-- one keyword, an array of seed keywords, or one of ten mixed targets in a comparison.
--
-- THE ANSWER HERE IS TWO COLUMNS THAT ARE READ TOGETHER: `subject_kind` (STORED) and
-- `subject text[]`. `subject` is always the normalized thing (or things) the measurement is ABOUT,
-- and `subject_kind` says what kind of thing every element of it is:
--
--   subject_kind = 'domain'      -> subject = [ normalizeDomain's output ], exactly one.
--   subject_kind = 'keyword'     -> subject = [ one normalized search phrase ], exactly one.
--   subject_kind = 'keyword_set' -> subject = 1..N normalized seed keywords, de-duplicated and
--                                   sorted — 0029's normalizer, reused rather than re-derived.
--
-- That is what makes this legitimate rather than a bag of optional columns, and it is the shape
-- 0030 already uses for `status`: a null's meaning — and here an ELEMENT's meaning — is determined
-- by a value STORED ON THE SAME ROW, not by a caveat a reader has to import from somewhere else.
-- 0027's objection ("a column whose null means something different per row") is answered head-on:
-- nothing here means something different per row, because the discriminant travels with the data.
--
-- AND THE READER TEST PASSES. From ONE row alone — `subject_kind`, `subject`, `tool` — a reader
-- can say exactly what was looked up: "the domain example.com", "the keyword seo tools", "these
-- eleven seed keywords". No join, no lookup table of caveats, no field that is meaningful only in
-- the light of the caller's original arguments.
--
-- THE DISCRIMINANT IS NOT DECORATIVE, and the database is what makes it load-bearing:
-- `subject_lookup_runs_subject_cardinality` binds the CARDINALITY of `subject` to `subject_kind`
-- ('domain' and 'keyword' are singular; only 'keyword_set' may hold more than one), which is
-- 0030's seven-CHECKs pattern at this table's scale. A row claiming 'domain' while carrying three
-- values fails at INSERT rather than being rendered as a domain called "a, b, c".
--
-- ══ WHY ONE TABLE FOR THREE TOOLS, NOT TWO OR THREE ═════════════════════════════════════════
--
-- The alternative seriously considered was a table per tool, or a split into "discovery" and "AI
-- visibility". It was rejected on 0027's own logic rather than on tidiness: 0027 put SEVEN very
-- different tools (keyword rankings, backlink profiles, competitor comparisons, disavow lists) in
-- ONE table because the LOAD-BEARING COLUMN meant the same thing on every row. It did not require
-- the reports to resemble each other — `report` is schemaless there and here for exactly 0024:28-32
-- / 0025:38-44's reason. The same is true here: `subject_kind` + `subject` mean the same thing on
-- all three tools' rows, so a split would produce two or three tables with IDENTICAL columns
-- differing only in which `tool` values they accept — which is 0026's rule in reverse, a `tool`
-- column spelled as a table name.
--
-- The `tool` column exists here for 0026's rule read forwards: there is more than one value, and
-- three values are what tells these rows apart. Its CHECK binds the table to exactly these three;
-- a fourth tool writing here fails at INSERT rather than leaking in, which is what 0031 had to
-- widen deliberately when four more tools earned 0027's table.
--
-- ══ ai_visibility_compare IS KEYED BY THE SUBJECT, NOT BY THE CALL ══════════════════════════
--
-- One `ai_visibility_compare` call writes 2-10 ROWS, one per compared target. This is the biggest
-- decision in the file and it is 0030's argument applied here rather than re-derived: 0030 keyed
-- its measurements by the KEYWORD and not by the snapshot because "the thing anybody wants to read
-- afterwards is not 'a snapshot happened' but 'where was THIS keyword, and where was it last
-- week'". The same holds here. Afterwards nobody asks "did I run a comparison"; they ask "how is
-- MY domain doing in ChatGPT's answers, and how does it compare".
--
-- Four things follow from that key, and each of them is a reason it was chosen:
--
--   1. IT MAKES THE TWO AI TOOLS ONE SERIES. An `ai_visibility` row and one row of a comparison
--      measure THE SAME THING about THE SAME SUBJECT at the SAME vendor endpoint family. Keyed by
--      the subject, they are the same shape, so a tenant who measured their domain alone last week
--      and inside a five-way comparison this week has ONE history of that domain. Keyed by the
--      call, those would be two unrelated shapes and the join would be a jsonb search.
--   2. THE ROW COUNT IS THE PRICED UNIT. The price is 90 PER COMPARED TARGET, so a ten-target call
--      costs 900 and writes ten rows: the panel's row count for this tool is auditable against
--      credit_ledger instead of being a number only the report knows.
--   3. A TARGET THE VENDOR DID NOT ANSWER FOR STILL GETS ITS OWN ROW. The port keeps "the vendor
--      returned no row for this target" apart from "this target has zero mentions"
--      (`groups_without_vendor_row`), and that distinction cost 90 credits to obtain. Keyed by the
--      call it would be one name inside one blob; keyed by the subject it is a row of its own,
--      carrying `answered: false`, visible on the panel next to the targets that did answer.
--   4. IT IS THE ONLY KEY THAT KEEPS `subject` HONEST. Keyed by the call, one row would have to
--      hold a FLAT array mixing domains and keywords, and `subject_kind` could no longer say what
--      an element is — the element-level version of exactly the lie 0027 refused for a keyword
--      list in a column named `target`.
--
-- THE COST, STATED RATHER THAN HIDDEN: the comparison AS A UNIT is not a row. There is no
-- `run_id`, and a `run_id` was considered and dropped — on the two single-subject tools it would
-- equal `id` on every row, a column that states nothing (0026's rule), and nothing on the panel
-- needs to group ten rows back into one call. What a reader needs instead travels IN EACH ROW's
-- report: `compared_target_count` and `compared_with` (the other targets' labels, capped), so the
-- whole comparison can be reconstructed from ANY ONE of its rows. What is genuinely lost is the
-- ability to tell two comparisons of the same targets made in the same microsecond apart. That is
-- the trade, and it is written here rather than left for a reader to discover.
--
-- ══ WHERE `platform` LIVES: INSIDE THE REPORT, AND THE ARGUMENT IS 0027'S ═══════════════════
--
-- "The tools take a platform, so add a platform column" is the obvious wrong move, and 0027's
-- locale paragraph is the reason. discover_keywords has NO platform at all — it reads DataForSEO
-- Labs, not LLM Mentions — so a `platform` column would be NULL on every one of its rows for a
-- reason that has nothing to do with the run: not "the platform was unknown" but "the question
-- does not exist for this tool". That is precisely the column 0027 refused, one field over.
--
-- 0030's counter-case was checked and does not apply. There the locale and device BECAME columns
-- because "every read filters on them" — the rule the three migrations share is that identity
-- which is QUERIED is a column and identity which is only DISPLAYED is not. Nothing filters or
-- groups on `platform` in the database: the panel's only read is "this tenant's runs, newest
-- first", bounded, and the platform is read as an O(1) jsonb sub-field (`report->platform`) and
-- compared in memory over that window — 0029's decision for `locale`, unchanged.
--
-- The SAME reasoning puts the locale in the report again, and here it has an extra edge worth
-- recording: this vendor family takes `location_name` (a STRING, e.g. "United States") while every
-- sibling family takes `location_code` (an integer). Two differently-typed locales in one column
-- would be a column with two meanings; in the report each tool's locale is whatever that endpoint
-- really took, under its own vendor name.
--
-- ══ STRUCTURAL REPORT STORED, NEVER RENDERED TEXT ═══════════════════════════════════════════
--
-- 0024:8-12, 0025:13-17, 0026:20-25, 0027:33-37 and 0029, the same rule for the sixth time.
-- `report` is the tool's STRUCTURAL result — the discovered keyword rows, the vendor's mention
-- metrics — never the table the tool prints. The prose is for a human and free to change; the
-- numbers underneath are what a second surface can query.
--
-- THE CAP, and why it is 50. Nothing bounds a vendor response: discover_keywords may ask for
-- MAX_DISCOVER_ROWS = 1000 rows, and the LLM Mentions endpoints carry up to
-- MAX_INTERNAL_LIST_ROWS = 100 rows PER COMPARED TARGET whose field set is not even known to this
-- repo (no response from that family has ever been captured, so `vendor_metrics` is an open bag of
-- scalars under the vendor's own keys). MAX_SUBJECT_RUN_ROWS is 50 for 0027's reason, not 0029's:
-- 0029 stored the whole answer because its tool's own schema bounded it at 100 small rows, while
-- here the answer is unbounded in one tool and unknown in shape in the other two. The headline
-- counters are always PRE-cap and sit at the TOP of the report, so the panel reads `report->total`
-- one field at a time and never downloads the document.
--
-- WHAT THE COMPARE REPORT DELIBERATELY DOES NOT CARRY: the response-wide `vendor_total_count`. It
-- counts rows across EVERY compared target, so putting it on a per-subject row would publish a
-- number a reader would inevitably read as this target's. A count nobody made for this subject is
-- not stored under a name that suggests they did.

create table public.subject_lookup_runs (
  id uuid primary key default gen_random_uuid(),
  -- THE TENANT. A single-column FK for 0017's reason (the referenced column already IS the tenant
  -- and nothing can be forged), and it is MANDATORY here for 0029's reason rather than 0027's:
  -- on 0027 only the bare-target rows were parentless in `public`, while here MOST rows are —
  -- every keyword subject, every seed set, and every bare-domain comparison target has no project
  -- at all. Without this edge a deleted account would leave them behind forever, carrying a tenant
  -- id that no longer resolves.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- NULLABLE, and null is the COMMON case here rather than 0027's minority one. Only three of the
  -- eight input shapes these tools accept can name a project at all (discover_keywords "for_site",
  -- ai_visibility subject "domain", and a compare target given as a project_id); the other five
  -- carry no domain and therefore no project. It records WHERE THE REQUEST CAME FROM and is never
  -- a claim about what was measured.
  project_id uuid,
  -- The three tools. 0026's rule read forwards: the column exists because there is more than one
  -- value to tell rows apart. The CHECK binds the table to these three — a fourth tool writing
  -- here is something this slice did not design for and fails at INSERT rather than leaking in.
  tool text not null constraint subject_lookup_runs_tool_check check (
    tool in ('discover_keywords', 'ai_visibility', 'ai_visibility_compare')
  ),
  -- WHAT KIND OF THING THIS ROW IS ABOUT — the STORED discriminant the header argues for. It is
  -- read TOGETHER with `subject`, and it is what lets one column hold a domain on one row and a
  -- keyword on the next without either row lying about itself.
  subject_kind text not null constraint subject_lookup_runs_subject_kind_check check (
    subject_kind in ('domain', 'keyword', 'keyword_set')
  ),
  -- THE SUBJECT OF THE MEASUREMENT, normalized. The load-bearing column of this table, in exactly
  -- the sense 0027's `target` and 0029's `keyword_set` are of theirs. text[] and not a digest, for
  -- 0029's reason: a key nobody can recompute is a key nobody can query, the panel prints these
  -- words, and `subject @> array['…']` stays available to a later per-subject surface.
  --
  -- For 'domain' it is `normalizeDomain`'s output, so a project run records what the project's
  -- domain was AT THE TIME — a join to `projects` could not recover that after the domain changed.
  subject text[] not null,
  -- A run about nothing identifies nothing and could never be shown to anyone, so the empty
  -- subject is refused by the DATABASE rather than by app discipline (0013's argument at 0029's
  -- scale). The write path cannot produce it from a well-formed call: every tool's schema requires
  -- a non-empty seed, keyword or target.
  constraint subject_lookup_runs_subject_not_empty
    check (cardinality(subject) >= 1),
  -- THE DISCRIMINANT BINDS THE DATA, which is what stops `subject_kind` from being decoration.
  -- 'domain' and 'keyword' name ONE thing each — the vendor's own either/or on both AI endpoints,
  -- and a single seed on two of discover_keywords' modes — so a row claiming either while carrying
  -- several values is refused rather than rendered as a domain whose name contains commas. Only
  -- 'keyword_set' (discover_keywords' "ideas" mode) may hold more than one, and it may also hold
  -- exactly one: a caller may draw ideas from a single seed, and that is a different question from
  -- asking for suggestions on it. NO UPPER BOUND, for 0029's reason — MAX_SEEDS is a product
  -- decision about a caller-facing surface, and copying it here would mean a signed decision to
  -- widen the tool starts failing at INSERT, after the vendor was paid.
  constraint subject_lookup_runs_subject_cardinality
    check (subject_kind = 'keyword_set' or cardinality(subject) = 1),
  -- STRUCTURAL report (jsonb): the headline counters first, then the capped lists. Schemaless for
  -- 0024:28-32 / 0025:38-44's reason, and here that reason is at its strongest: two of the three
  -- reports carry rows out of a vendor family whose field set this repo has never captured, so a
  -- column per field could not even be enumerated. The platform, the locale and the mode live in
  -- here for the reasons the header gives.
  report jsonb not null,
  created_at timestamptz not null default now(),

  -- CROSS-TENANT ARMOR, 0017's pattern — WITH 0027's COST, stated again because it is LARGER here.
  -- A single-column `project_id -> projects (id)` would only ask "does this id exist"; the
  -- composite key also asks "and does it belong to the SAME tenant". `projects` carries the
  -- `(user_id, id)` unique constraint 0017 added, so this FK needs no new parent constraint.
  --
  -- THE COST: `project_id` is NULLABLE and the default MATCH SIMPLE SKIPS THE CHECK ENTIRELY on
  -- any row where it is null. 0027 wrote that down for a minority of its rows; here it is the
  -- MAJORITY, because five of the eight input shapes cannot name a project at all. On those rows
  -- this constraint guarantees nothing and the tenant guarantee is `user_id` ALONE — which is what
  -- the select policy filters on, what the panel queries by, and what the auth.users FK above
  -- anchors to a real account. Column-list-free CASCADE: when a project is deleted its lookups go
  -- with it; a project_id-null lookup of the same tenant is untouched and leaves with the account.
  constraint subject_lookup_runs_user_id_project_id_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id)
    on delete cascade
);
-- Reverse: drop table public.subject_lookup_runs;

-- THE PANEL'S QUERY, 0029's shape rather than 0027's, and the difference is not cosmetic. 0027
-- indexed `(user_id, project_id, created_at desc)` because its first reader was the PROJECT CARD.
-- This table's rows are mostly project-less, so its reader is the ACCOUNT-WIDE history:
--   where user_id = ? order by created_at desc limit N
-- `user_id` is this index's leading column, so it also serves BOTH parent-delete lookups — the
-- auth.users cascade and the `projects` one — which is the reasoning 0017 (0017:96-98), 0023-0027
-- and 0029 all give for their own parent edges.
--
-- NO INDEX ON `subject`, and none on `(tool, subject_kind)`: nothing queries by either today (the
-- panel groups in memory over the bounded window above), and an unused GIN index on an array
-- column costs writes to answer a question nobody is asking yet — 0029's argument, unchanged.
create index subject_lookup_runs_user_created_idx
  on public.subject_lookup_runs (user_id, created_at desc);
-- Reverse: drop index public.subject_lookup_runs_user_created_idx;

alter table public.subject_lookup_runs enable row level security;
alter table public.subject_lookup_runs force row level security;
-- Reverse: alter table public.subject_lookup_runs disable row level security;

create policy "subject_lookup_runs_select_own"
  on public.subject_lookup_runs for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "subject_lookup_runs_select_own" on public.subject_lookup_runs;

-- GRANTS, and every one of the twelve cells is DECIDED — guardrails/check-grants.sh fails this
-- migration otherwise, and 0028's header says why a silent cell is not a small thing: on the cloud
-- project the default ACL hands a NEW table the full DML surface to all three roles, so "not
-- mentioned" means GRANTED there while the local stack shows nothing at all.
--
-- service_role: select + insert. UPDATE/DELETE deliberately absent AND actually revoked — a run is
-- what the vendor said at that moment, re-running produces a NEW row, and rows leave only with
-- their project or their account via cascade. There is no UPDATE case to argue for: nothing about
-- a delivered lookup is corrected later, and a comparison target that came back unanswered is a
-- measured fact rather than a placeholder to be filled in.
--
-- authenticated: table-level select; no column here is privileged beyond the fact that the tenant
-- paid to ask — `subject` holds public domain names and words they typed, `report` is a derivative
-- of PUBLIC data about them. anon: nothing at all.
grant select on public.subject_lookup_runs to authenticated;
grant select, insert on public.subject_lookup_runs to service_role;
-- Reverse: revoke select, insert on public.subject_lookup_runs from service_role;
--          revoke select on public.subject_lookup_runs from authenticated;

revoke select, insert, update, delete on public.subject_lookup_runs from anon;
revoke insert, update, delete on public.subject_lookup_runs from authenticated;
revoke update, delete on public.subject_lookup_runs from service_role;
-- Reverse: grant select, insert, update, delete on public.subject_lookup_runs to anon;
--          grant insert, update, delete on public.subject_lookup_runs to authenticated;
--          grant update, delete on public.subject_lookup_runs to service_role;

-- 0016 pattern, applied to this table — a NO-OP in the expected state and written anyway: TRUNCATE
-- walks past RLS and every row-level trigger alike, and 0016's documented residual (a second
-- default ACL with grantor `supabase_admin`) stays live if another role ever creates this table.
-- The real defence is public-truncate-armor.db.test.ts's ENUMERATION over pg_catalog, which this
-- table joins the moment it exists, as it joins public-rls-force-armor.db.test.ts's.
revoke truncate on table public.subject_lookup_runs from anon, authenticated, service_role;

-- PURELY ADDITIVE. No table, column, index, policy, grant or constraint is dropped or altered
-- anywhere in this file: there is no DROP of any kind and no UPDATE or DELETE of any row.
-- domain_lookup_runs (0027/0031) and keyword_research_runs (0029) are NOT touched — this is a
-- SIXTH sibling, not an extension of either, and 0027's `tool` CHECK still names seven tools and
-- still excludes these three. Neither credit_ledger (NEVER #2) nor dfs_spend (0014) was touched:
-- the lookup's PRICE stays in credit_ledger, the vendor COST stays in dfs_spend, and the run
-- itself is here. This migration moves no price (NEVER #6): discover_keywords costs 40 credits
-- before it and 40 after, ai_visibility 90 and 90, ai_visibility_compare 90 per compared target
-- and 90 per compared target.
