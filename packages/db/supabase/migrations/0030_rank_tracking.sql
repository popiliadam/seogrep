-- Migration 0030: the RANK-TRACKER storage — the keywords a tenant asked to watch, and the SERP
-- measurements taken for them. TWO tables, because the two answer two different questions and
-- neither can be derived from the other.
--
-- NUMBERING NOTE — RESOLVED, kept as the record of why this file is 0030 and not 0029. This was
-- written as 0029 on a branch based on main@ca645a9 (where 0028 was the highest committed
-- migration), while a sibling branch carried its own 0029 — `keyword_research_runs`. Both could not
-- keep the number: index.test.ts pins the migration numbering as a GAP-FREE 1..N run against
-- SCHEMA_VERSION, so numbering this one 0030 before the sibling landed would have left a hole at 29
-- and turned the fast gate red. The sibling landed first (PR #151), so THIS file was renamed to
-- 0030 at rebase and SCHEMA_VERSION moved 29 -> 30 with it. Those were the only two places the
-- number appears; nothing below refers to it again and no spec asserts it.
--
-- ── WHAT A ROW MEANS, IN BOTH TABLES ─────────────────────────────────────────────────────────
--
-- 0024/0025/0026/0027 opened the RUN axis: a row per lookup that ran. This slice is not that
-- shape, and saying so up front stops a reader looking for the fifth sibling. A SERP snapshot is
-- one paid request PER KEYWORD (apps/mcp/src/dfs/serp.ts: "`keyword` IS SINGULAR ... an N-keyword
-- snapshot is N requests"), and the thing anybody wants to read afterwards is not "a snapshot
-- happened" but "where was THIS keyword, and where was it last week". So the measurement table is
-- keyed by the measurement, not by the call that produced it.
--
--   QUESTION 1 — WHAT IS A TRACKED KEYWORD?
--   ONE ROW PER (project, keyword, location_name, language_code, device). The locale and the
--   device are part of the SUBSCRIPTION, not chosen later at snapshot time, and the alternative
--   was seriously considered and rejected: a row per (project, keyword) with the locale picked at
--   measurement time cannot say what it wants measured. "seo tools" on the US desktop SERP and
--   "seo tools" on the UK mobile SERP are two different questions with two different answers
--   (serp.ts DEVICE_MEANS says so in the words that ship to the caller), so a tracking row that
--   named neither would leave a refresher with nothing to refresh and a reader with two series
--   fused into one. The cost of this shape is stated rather than hidden: tracking one keyword on
--   two devices is TWO rows and counts twice against the per-project cap.
--
--   QUESTION 2 — WHAT IS A STORED MEASUREMENT?
--   ONE ROW PER KEYWORD PER SNAPSHOT — never one row per placement. The port already made this
--   decision and this table follows it rather than re-deciding it: SerpKeywordRow "is
--   independently storable, and identified without its neighbours". A row-per-PLACEMENT table
--   could not represent two of the three outcomes AT ALL — "the domain was searched for and not
--   found" and "nothing was measured" would both be ZERO ROWS, which is the exact collapse the
--   outcome union exists to prevent, and it would make the absence of a measurement
--   indistinguishable from the absence of a ranking. The placements (a domain can appear more than
--   once on one SERP) live INSIDE the row's `report`, where they belong to the measurement that
--   found them.
--
-- ── THE THREE OUTCOMES SURVIVE STORAGE, AND THE DATABASE IS WHAT KEEPS THEM APART ────────────
--
-- serp.ts keeps `ranked` / `absent_from_examined_results` / `not_measured` apart with a
-- discriminated union — "There is no `position: number | null` field anywhere in this module's
-- output, so a renderer cannot read a 0 or a null and guess which of the three it meant." A
-- nullable `position integer` column would throw all of that away on the way to disk: "not among
-- the 100 results we counted" and "we never took a measurement" would both arrive as NULL, and
-- every later reader would have to guess. So the discriminant is STORED, as `status`, and the four
-- CHECK constraints below bind every other column to it:
--
--   status = 'ranked'                       -> organic_items_examined NOT NULL,
--                                              not_measured_reason NULL,
--                                              best_rank_* MAY be set (see below).
--   status = 'absent_from_examined_results' -> organic_items_examined NOT NULL (the SCOPE of the
--                                              claim — counted, never assumed from the depth),
--                                              best_rank_* NULL, not_measured_reason NULL.
--   status = 'not_measured'                 -> organic_items_examined NULL (nothing was counted),
--                                              best_rank_* NULL, not_measured_reason NOT NULL.
--
-- That leaves exactly one null a reader must not misread, and it is deliberate: a `ranked` row may
-- carry a NULL `best_rank_group`, because the vendor may return a placement WITHOUT a rank
-- (SerpPlacement.rank_group is `number | null`). It means "found, and the vendor did not say
-- where" — recoverable ONLY because `status` is a column of its own. A schema that inferred the
-- status from the rank would have three different meanings for one NULL; this one has none.
--
-- Constraints rather than app discipline (0013's argument, and 0029's own): the WRITER of these
-- rows is a different slice from the reader, so a rule that lives only in the write path is a rule
-- the read path has to trust. rank-tracking.db.test.ts breaks each of the four on purpose.
--
-- ── IDENTITY IS COLUMNS HERE, NOT REPORT JSON — the OPPOSITE of 0027 and 0029 ────────────────
--
-- Both of those put the locale inside `report`, and 0029 gave the deciding reason: "a column
-- nobody filters or groups on in the database is a column nobody is paying for". Here EVERY read
-- filters on them. `keyword_positions` answers "the series for this keyword, on this locale and
-- this device", so keyword / location_name / language_code / device / target_domain are the WHERE
-- clause, not decoration — and the whole honesty of a series depends on never mixing two
-- identities into one line. The rule the three migrations share is therefore the same rule, not a
-- reversal: identity that is queried is a column, identity that is only displayed is not.
--
-- `search_engine`, `depth_requested` and `domain_match_rule` are columns for a different reason:
-- they are PINNED constants today (serp.ts SERP_DEPTH = 100, DFS_SERP_SEARCH_ENGINE = "google",
-- DOMAIN_MATCH_RULE), and a pinned constant is exactly the thing a stored row must not inherit
-- from the code that reads it. The pins are price decisions (NEVER #6) and can be re-signed; a row
-- measured at depth 100 must keep saying 100 after that. They are NOT part of any unique key and
-- nothing filters on them — they are what makes a row self-describing, which is the property that
-- lets `keyword_positions` state what was measured instead of assuming it.
--
-- ── THREE CLOCKS, KEPT APART ─────────────────────────────────────────────────────────────────
--
-- serp.ts refuses to substitute one for another and this table inherits that refusal:
--   vendor_reported_time_value — the VENDOR's own account of when it measured, VERBATIM text, NULL
--     when the vendor did not say. Never parsed into a timestamptz: DataForSEO's format is not
--     ISO-8601 (`2026-06-14 08:12:33 +00:00`, see tools/research-keywords.ts), and a parse is an
--     interpretation this table has no business making on the vendor's behalf.
--     vendor_reported_time_FIELD travels beside it so a reader knows WHICH key it came from.
--   fetched_at — OUR clock, when the process received the response. NOT NULL, and it is the SERIES
--     AXIS: a measurement belongs to the moment it was taken.
--   created_at — OUR clock, when the row was written. Kept because it is the only thing that can
--     ever show a deferred or replayed write, and because every sibling has one. It is NOT the
--     series axis, and ordering by it would silently re-date a backfill.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ─────────────────────────────────────────────
--
--   NO FK from a measurement to a tracked keyword. serp_snapshot measures a domain, and that
--   domain may be a bare `target` that is nobody's project (tools/project-target.ts is the shared
--   resolver), so a measurement can exist for a keyword nothing tracks. Requiring the FK would
--   make the ad-hoc snapshot unstorable; making it nullable would add a column that says nothing a
--   reader can act on. The two tables meet on (project_id, keyword, location, language, device) —
--   VALUES, which both carry — and that join is the panel's, not the database's.
--
--   NO per-project keyword CAP in the schema. A CHECK cannot count rows and a trigger that counts
--   on every insert is a different cost with a different failure mode; more importantly the cap is
--   a PRODUCT number (MAX_TRACKED_KEYWORDS_PER_PROJECT, tools/track-keywords.ts) and 0029's rule
--   applies unchanged: a signed decision to widen it must not start failing at INSERT. What the
--   database refuses is what is meaningless at any cap — a blank keyword.
--
--   NO unique constraint on a measurement. Two measurements of one identity are the POINT: that is
--   the series. Nothing here is de-duplicated, and re-measuring writes a new row.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- TABLE 1 — tracked_keywords: what the tenant asked to watch.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

create table public.tracked_keywords (
  id uuid primary key default gen_random_uuid(),
  -- The tenant. NOT a FK to auth.users, and that is the SIBLING pattern rather than an omission:
  -- 0024/0025/0026 carry none either, because `project_id` is NOT NULL here, so an account delete
  -- reaches every row of this table through `projects`. (0027 and 0029 needed the auth.users FK
  -- precisely because some — or all — of their rows have no parent in `public`.)
  user_id uuid not null,
  -- NOT NULL: a tracked keyword is a keyword tracked FOR A SITE. There is no such thing here as
  -- the bare-target row 0027 had to allow — an ad-hoc lookup of a competitor's domain is a
  -- snapshot, not a subscription, and it lands in the measurement table with no project at all.
  project_id uuid not null,
  -- THE KEYWORD, normalized by the write path (trim, collapse internal whitespace, lower-case).
  -- The DATABASE enforces only what is meaningless at any normalization: blank, or padded. The
  -- case fold is deliberately NOT asserted here — Postgres `lower()` is collation-dependent while
  -- JavaScript's `toLowerCase()` is not, and the two are not guaranteed to agree on every input,
  -- so a CHECK asserting the fold could reject a correctly-normalized keyword on a differently
  -- collated stack. The fold is the write path's, and normalizeTrackedKeyword's spec pins it.
  keyword text not null,
  -- WHERE the question is asked. `location_name` is a STRING and not a code because the SERP
  -- wrapper publishes no location_code for this family (serp.ts SerpSnapshotQuery) — the vendor's
  -- own shape, kept rather than translated into one this product would then have to maintain.
  location_name text not null,
  language_code text not null,
  -- The two SERPs the port measures. The CHECK is the same closed set serp.ts states as a type,
  -- written out because a `text` column is where a closed union goes to die otherwise.
  device text not null check (device in ('desktop', 'mobile')),
  created_at timestamptz not null default now(),
  -- UNTRACKING IS AN ARCHIVE STAMP, exactly like `projects.archived_at` (0022) — null = active,
  -- no default (a default would archive every row at birth; 0022 pinned that lesson already).
  -- WHY NOT A DELETE: it costs nothing to keep, and re-tracking the same keyword is then the SAME
  -- ROW with the same id and the same created_at, so "since when have I been watching this" is
  -- still answerable. It also keeps untracking a cheap, reversible act for the tenant, which is
  -- the property untrack_project's header argues for at project scale.
  untracked_at timestamptz,

  constraint tracked_keywords_keyword_not_blank
    check (length(keyword) >= 1 and keyword = btrim(keyword)),

  -- CROSS-TENANT ARMOR, 0017 pattern (0024:36-49 / 0025:56-62 / 0026:44-55 / 0027). Both columns
  -- are NOT NULL, so MATCH SIMPLE always checks and this table gets the FULL guarantee 0027 had to
  -- write a caveat about: a row cannot name another tenant's project. `projects` already carries
  -- the (user_id, id) unique constraint 0017 added, so no new parent constraint is needed.
  -- Column-list-free CASCADE: a deleted project takes its tracked keywords with it, and a deleted
  -- account takes its projects.
  constraint tracked_keywords_user_id_project_id_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id)
    on delete cascade
);
-- Reverse: drop table public.tracked_keywords;

-- THE IDENTITY, and the whole of registration idempotency. `track_keywords` upserts on exactly
-- these six columns, so asking twice for the same keyword on the same locale and device is ONE
-- row — and re-tracking an untracked keyword revives that row instead of forking the history.
-- `untracked_at` is deliberately NOT in the key: including it would let one keyword exist twice,
-- once active and once archived, and the pair would then disagree about since when it is watched.
create unique index tracked_keywords_identity_key
  on public.tracked_keywords (user_id, project_id, keyword, location_name, language_code, device);
-- Reverse: drop index public.tracked_keywords_identity_key;

-- The panel's and the cap's query: this project's tracked keywords, this tenant's only. The unique
-- index above already leads with (user_id, project_id) and is therefore also the backing index for
-- the parent-delete lookup, so no second index is created here — the reasoning 0017, 0023, 0024,
-- 0025, 0026 and 0027 all give for their own parent edges.

alter table public.tracked_keywords enable row level security;
alter table public.tracked_keywords force row level security;
-- Reverse: alter table public.tracked_keywords disable row level security;

create policy "tracked_keywords_select_own"
  on public.tracked_keywords for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "tracked_keywords_select_own" on public.tracked_keywords;

-- GRANTS — every one of the twelve cells DECIDED, or guardrails/check-grants.sh fails this
-- migration (0028's header: on the cloud project the default ACL hands a NEW table the full DML
-- surface to all three roles, so "not mentioned" means GRANTED there).
--
-- service_role: select + insert + UPDATE. The update is the DEPARTURE from the four run tables,
-- and it is the whole point of this one: `tracked_keywords` is not a ledger of what happened, it
-- is REGISTRATION STATE — a switch the tenant owns, whose only mutation is `untracked_at` going
-- null -> stamped -> null again (the same shape 0022 gave `projects.archived_at`). Nothing
-- historical is rewritable by it: a measurement is not touched by untracking, and the append-only
-- table is the one below. DELETE stays absent and revoked — rows leave with their project.
--
-- authenticated: table-level select. Nothing here is privileged beyond the tenant's own choices;
-- the words are theirs and the locale is a public fact about a search engine.
grant select on public.tracked_keywords to authenticated;
grant select, insert, update on public.tracked_keywords to service_role;
revoke select, insert, update, delete on public.tracked_keywords from anon;
revoke insert, update, delete on public.tracked_keywords from authenticated;
revoke delete on public.tracked_keywords from service_role;
-- Reverse: grant select, insert, update, delete on public.tracked_keywords to anon;
--          grant insert, update, delete on public.tracked_keywords to authenticated;
--          grant delete on public.tracked_keywords to service_role;
--          revoke select, insert, update on public.tracked_keywords from service_role;
--          revoke select on public.tracked_keywords from authenticated;

-- 0016 pattern — a NO-OP in the expected state and written anyway: TRUNCATE walks past RLS and
-- every row-level trigger alike, and 0016's documented residual (a second default ACL with grantor
-- `supabase_admin`) stays live if another role ever creates this table. The real defence is
-- public-truncate-armor.db.test.ts's ENUMERATION, which this table joins the moment it exists, as
-- it joins public-rls-force-armor.db.test.ts's.
revoke truncate on table public.tracked_keywords from anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- TABLE 2 — keyword_position_measurements: what was actually observed, and when.
--
-- THE NAME. Not `keyword_positions`, although that is the name of the tool that reads it: two of
-- the three outcomes carry NO position, so a table called `keyword_positions` would be false on
-- exactly the rows this design exists to keep honest. A row is a MEASUREMENT; whether it found a
-- position is what `status` says.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

create table public.keyword_position_measurements (
  id uuid primary key default gen_random_uuid(),
  -- The tenant, and — for a bare-target measurement — the row's ONLY parent anywhere. Same
  -- reasoning as 0027's: with a nullable project_id, a row can have no parent in `public` at all,
  -- and without this FK a deleted account would leave its ad-hoc snapshots behind forever carrying
  -- a tenant id that no longer resolves. Single column, for 0017's reason: the referenced column
  -- already IS the tenant and nothing can be forged.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- NULLABLE, and 0027's caveat applies here WORD FOR WORD rather than by analogy: `serp_snapshot`
  -- resolves EITHER a project or a bare `target` (tools/project-target.ts), and measuring a
  -- competitor's domain is a first-class use of it. See the composite FK below for what that
  -- nullability costs.
  project_id uuid,
  -- ── WHAT WAS ASKED (SerpMeasurementIdentity, stored column for column) ──────────────────────
  keyword text not null,
  -- The domain the placements were looked for. NOT derived from `projects` at read time: a project
  -- can be re-pointed at another domain, and a measurement must keep saying which domain it was
  -- about (0027's argument for its own `target` column, at a different grain).
  target_domain text not null,
  location_name text not null,
  language_code text not null,
  device text not null check (device in ('desktop', 'mobile')),
  -- The pinned facts, stored so the row stops depending on the code that reads it (see header).
  search_engine text not null,
  depth_requested integer not null check (depth_requested >= 1),
  domain_match_rule text not null,
  -- ── WHAT WAS FOUND ─────────────────────────────────────────────────────────────────────────
  -- THE DISCRIMINANT. The three answers serp.ts refuses to collapse, kept apart on disk by a
  -- column of their own and by the four CHECKs below. The CHECK on the value set is what stops a
  -- fourth status arriving as a silent typo that every reader then treats as "some other thing".
  status text not null check (
    status in ('ranked', 'absent_from_examined_results', 'not_measured')
  ),
  -- The vendor's `rank_group` — rank among ORGANIC results, the number that means "we rank #3".
  -- BEST (lowest) of the row's placements, lifted out of the report so a series can be read
  -- without opening a jsonb document per row. NULLABLE ON A RANKED ROW ON PURPOSE: the vendor may
  -- return a placement with no rank at all, and that is "found, position not stated" — a reading
  -- only `status` makes possible.
  best_rank_group integer check (best_rank_group >= 1),
  -- The vendor's `rank_absolute` — rank among ALL SERP elements — of THAT SAME placement. Kept
  -- because the two disagree whenever a SERP feature outranks the result, and serp.ts says the gap
  -- is itself the finding. Never compared with a rank_group: they are two different scales.
  best_rank_absolute integer check (best_rank_absolute >= 1),
  -- THE SCOPE OF THE CLAIM: how many organic results were actually examined. COUNTED from the
  -- response by the port, never assumed from `depth_requested` — "not in the top 100" would
  -- otherwise be a claim about results nobody looked at. NULL only when nothing was examined.
  organic_items_examined integer check (organic_items_examined >= 0),
  -- Why no measurement exists. Present ONLY on a not_measured row, and required there: a row that
  -- says "unknown" without saying why is a row nobody can act on.
  not_measured_reason text,
  -- ── WHEN (three clocks, see the header) ────────────────────────────────────────────────────
  vendor_reported_time_field text,
  vendor_reported_time_value text,
  fetched_at timestamptz not null,
  -- ── THE REST OF THE OBSERVATION ────────────────────────────────────────────────────────────
  -- STRUCTURAL report (jsonb), never rendered text — 0024:8-12 / 0025:13-17 / 0026:20-25 /
  -- 0027:33-37 / 0029, the same rule for the sixth time. It carries the PLACEMENTS (each with the
  -- vendor's own rank_group / rank_absolute / domain / url and its verbatim vendor_metrics) and
  -- the vendor's own account of the page: check_url, se_results_count, item_types, the echoed
  -- keyword. The `means` sentences the port ships with each outcome are NOT stored: they are
  -- derivable from `status` and `organic_items_examined`, and storing prose would force a second
  -- surface to parse English to learn what a row meant.
  --
  -- SCHEMALESS for 0024:28-32 / 0025:38-44's reason, and CAPPED for 0027's: nothing bounds a
  -- vendor payload, so the writer stores a capped projection of the placement list with its
  -- counters ABOVE it (how many were found, how many stored), and the O(1) facts a reader actually
  -- filters on are the COLUMNS above rather than paths into this document.
  report jsonb not null,
  created_at timestamptz not null default now(),

  -- ── THE FOUR CHECKS THAT MAKE THE THREE OUTCOMES RECOVERABLE ───────────────────────────────
  -- Written as equivalences (`(A) = (B)`) rather than as implications on purpose: an implication
  -- would let the OTHER direction through, and both directions are wrong. A `ranked` row with no
  -- examined count would be a placement inside an unknown scope; a `not_measured` row WITH one
  -- would be a count of results nobody looked at.
  constraint keyword_position_measurements_examined_iff_measured
    check ((status = 'not_measured') = (organic_items_examined is null)),
  constraint keyword_position_measurements_reason_iff_not_measured
    check ((status = 'not_measured') = (not_measured_reason is not null)),
  -- A rank can only exist where something was found. The converse is NOT asserted (a ranked row
  -- may carry a null rank — see the column notes), which is the one asymmetry in this block and is
  -- deliberate.
  constraint keyword_position_measurements_rank_group_only_when_ranked
    check (status = 'ranked' or best_rank_group is null),
  constraint keyword_position_measurements_rank_absolute_only_when_ranked
    check (status = 'ranked' or best_rank_absolute is null),

  -- CROSS-TENANT ARMOR, 0017 pattern — WITH 0027's COST, restated rather than cross-referenced,
  -- because a reader of THIS table must not have to find it elsewhere. `project_id` is NULLABLE
  -- and the default MATCH SIMPLE SKIPS THE CHECK ENTIRELY on a row where it is null. On those rows
  -- this constraint guarantees nothing, and the tenant guarantee is `user_id` ALONE — which is
  -- what the select policy filters on, what every read in tools/keyword-positions.ts filters on,
  -- and what the auth.users FK above anchors to a real account. That is a weaker guarantee than
  -- tracked_keywords has, it is the price of storing an ad-hoc snapshot of a domain that is
  -- nobody's project, and it is written down instead of being left for a reader to infer from a
  -- missing NOT NULL.
  constraint keyword_position_measurements_user_id_project_id_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id)
    on delete cascade
);
-- Reverse: drop table public.keyword_position_measurements;

-- THE SERIES QUERY, which is the only query this table has: one tenant, one DOMAIN, one keyword,
-- newest first —
--   where user_id = ? and target_domain = ? and keyword = ? order by fetched_at desc limit N
--
-- THE SUBJECT IS THE DOMAIN, NOT THE PROJECT, and that is why `project_id` is not in this index.
-- A measurement is about a domain: the same keyword measured for example.test through a project
-- and measured for example.test ad hoc are two readings of ONE series, and splitting them by which
-- input named the domain would hide half a tenant's own history from them for a reason that has
-- nothing to do with what was measured. `project_id` stays PROVENANCE (and the cascade edge);
-- `target_domain` is the question. tools/keyword-positions.ts filters on exactly this shape.
-- Ordered by fetched_at and NOT by created_at, for the reason the header gives.
--
-- The parent-delete lookups both run off `user_id`, this index's LEADING column: the account
-- cascade uses it directly, and a project delete scans this tenant's rows with `project_id` as a
-- residual filter — bounded by one tenant either way, which is the same trade 0025 and 0027 make
-- for their own residual columns. No second index is created for it.
create index keyword_position_measurements_series_idx
  on public.keyword_position_measurements (user_id, target_domain, keyword, fetched_at desc);
-- Reverse: drop index public.keyword_position_measurements_series_idx;

alter table public.keyword_position_measurements enable row level security;
alter table public.keyword_position_measurements force row level security;
-- Reverse: alter table public.keyword_position_measurements disable row level security;

create policy "keyword_position_measurements_select_own"
  on public.keyword_position_measurements for select to authenticated
  using (user_id = (select auth.uid()));
-- Reverse: drop policy "keyword_position_measurements_select_own"
--            on public.keyword_position_measurements;

-- GRANTS — twelve decided cells again (check-grants.sh).
--
-- service_role: select + insert. UPDATE/DELETE deliberately absent AND revoked, the run tables'
-- rule at this grain: a measurement is what the SERP looked like at that moment. Re-measuring
-- writes a NEW row, because otherwise "where did I rank last month" would be a question whose
-- answer can be rewritten — and here that would be worse than in a run ledger, since the whole
-- product of this slice is a series over time. Rows leave only with their parents.
--
-- authenticated: table-level select. `report` is a derivative of PUBLIC search results and the
-- identity columns are the tenant's own question; nothing here is privileged beyond the fact that
-- they paid to ask.
grant select on public.keyword_position_measurements to authenticated;
grant select, insert on public.keyword_position_measurements to service_role;
revoke select, insert, update, delete on public.keyword_position_measurements from anon;
revoke insert, update, delete on public.keyword_position_measurements from authenticated;
revoke update, delete on public.keyword_position_measurements from service_role;
-- Reverse: grant select, insert, update, delete on public.keyword_position_measurements to anon;
--          grant insert, update, delete on public.keyword_position_measurements to authenticated;
--          grant update, delete on public.keyword_position_measurements to service_role;
--          revoke select, insert on public.keyword_position_measurements from service_role;
--          revoke select on public.keyword_position_measurements from authenticated;

revoke truncate on table public.keyword_position_measurements from anon, authenticated, service_role;

-- Additive: no existing table, policy, grant, index or FK changed. The four run tables were NOT
-- touched — this is not a fifth sibling of theirs and does not extend any of them. Neither
-- credit_ledger (NEVER #2) nor dfs_spend (0014) was touched: the price of a snapshot stays in
-- credit_ledger, its vendor cost stays in dfs_spend, and what the SERP looked like is here. This
-- migration moves no price (NEVER #6) and grants no tool the right to spend anything.
