-- Migration 0031: FOUR MORE synchronous domain lookups join 0027's run axis. One statement pair —
-- the `tool` CHECK widens from three names to seven. Nothing else about the table moves.
--
-- backlink_changes (35), backlink_details (35), disavow_candidates (40) and my_pages (40) shipped
-- after 0027 and shipped the way the first three shipped: they call DataForSEO inside the request,
-- print a table and LEAVE NO TRACE. The tenant pays 35-40 credits, reads the table once, and an
-- hour later has nothing to look at; no second surface can query what was found. That is the exact
-- failure 0027 exists to end, and it has been re-created four times.
--
-- ── WHY THESE FOUR BELONG IN THIS TABLE AND NOT IN A NEW ONE ─────────────────────────────────
--
-- 0027's header states the test: every column must mean the same thing on every row, and `target`
-- must genuinely be THE NORMALIZED DOMAIN THE LOOKUP RAN AGAINST. research_keywords failed that
-- test on one point — a keyword LIST has no domain — and got its own table (0029) rather than a
-- lying `target`. These four pass it on every point, and the check was made against the code
-- rather than against the family resemblance:
--
--   * INPUT SHAPE. All four take `target: targetField(...)` + `project_id: projectIdField` and
--     nothing else that identifies a subject (apps/mcp/src/tools/backlink-changes.ts,
--     backlink-details.ts, disavow-candidates.ts, my-pages.ts). Exactly one of the two is
--     required, and both resolve through the SAME `resolveTarget` / `normalizeDomain` the first
--     three use, so `target` here is the same kind of string it already is on every row.
--   * SETTLEMENT SHAPE. All four are `charge:"handler"`, synchronous, settle through withCredits
--     WITHOUT a jobId and write no `jobs` row — which is why 0027 carries no job FK and why these
--     four could not be given one either.
--   * NULLABLE project_id MEANS THE SAME THING. All four accept a bare competitor domain, and for
--     three of them that is the typical paid call. my_pages is the one where the project half does
--     extra work (it joins the vendor's pages against that project's last crawl), but a bare
--     target is still a first-class call there and still records the same fact: this domain was
--     looked up, and no project of yours was named.
--
-- ── WHAT IS DELIBERATELY NOT IN THIS MIGRATION ───────────────────────────────────────────────
--
-- discover_keywords, ai_visibility and ai_visibility_compare are the other three unsurfaced DFS
-- tools and they are NOT added here, for 0027's reason applied one tool at a time rather than as a
-- blanket. discover_keywords has four modes and three of them carry no domain; ai_visibility's
-- subject is a domain OR a keyword; ai_visibility_compare takes a flat 2-10 array with no headline
-- subject at all, each entry a domain, a keyword or a project id. Every one of them would have to
-- put a non-domain in `target` on some of its rows — the same lie 0027 refused for
-- research_keywords, which is precisely the sort of thing a CHECK widened "while we are here"
-- would let through. They need a discriminated-subject axis of their own.
--
-- ── HOW A CHECK IS WIDENED, AND WHY THIS ONE CANNOT FAIL ON DATA ─────────────────────────────
--
-- Postgres has no ALTER CONSTRAINT for a CHECK's predicate: the only way is to drop it and add it
-- back. That drop is the ONE destructive statement in this file and it is not a loss of anything —
-- the constraint is re-added in the next statement, in the same transaction the migration runner
-- wraps this file in, so there is no window in which the column is unconstrained for a concurrent
-- writer. The constraint's name is SERVER-GENERATED (0027 wrote the CHECK inline on the column and
-- named nothing), so it is quoted here as Postgres actually assigned it — measured against the
-- local stack, not guessed:
--   select conname from pg_constraint where conrelid = 'public.domain_lookup_runs'::regclass
--     and contype = 'c';  ->  domain_lookup_runs_tool_check
-- Re-adding the constraint REVALIDATES every existing row, and every existing row already holds
-- one of the first three names — the old predicate implies the new one — so the validation scan
-- cannot fail on data. It reads the whole table under an ACCESS EXCLUSIVE lock; this table holds
-- one row per paid domain lookup, so that scan is measured in milliseconds, not minutes.
--
-- NO ROW IS TOUCHED. There is no UPDATE and no DELETE anywhere in this file: the seven-name
-- predicate is a SUPERSET of the three-name one, so nothing already stored needs correcting.
--
-- ── WHAT THE WRITE PATH STILL OWES, RESTATED BECAUSE IT IS THIS TABLE'S REAL CONSTRAINT ──────
--
-- 0027's payload rule is unchanged and now applies to seven tools: `report` is the tool's
-- STRUCTURAL result, never the rendered table, with the headline counters kept as O(1) fields at
-- the TOP so the panel reads `report->total` instead of downloading the document, and every list
-- stored as a CAPPED projection (MAX_RUN_ROWS, apps/mcp/src/dfs/runs.ts). The four new tools make
-- that rule MORE load-bearing rather than less: backlink_details asks DataForSEO for up to 700 link
-- rows plus 200 page rows in one call, and disavow_candidates for up to 300 links plus 50 networks,
-- so an uncapped row here would be the largest single value in the schema by a wide margin.
--
-- NO NEW COLUMN, and specifically no locale column — 0027's reasoning holds and the four new tools
-- strengthen it. Three of them (backlink_changes, backlink_details, disavow_candidates) call
-- Backlinks endpoints that take NO locale parameter at all, so a locale column would now be null on
-- five of the seven tools' rows for a reason that has nothing to do with the run. The locale stays
-- inside `report`, present on exactly the reports whose endpoint has one.
--
-- NO NEW INDEX. The panel's query is unchanged — `(user_id, project_id, created_at desc)` with
-- `tool` as a residual filter — and adding four names to the column's vocabulary changes neither
-- the query nor its selectivity; a lookup count per tenant remains of three-digit order (0025's
-- argument, which 0027 already adopted).

alter table public.domain_lookup_runs drop constraint domain_lookup_runs_tool_check;

alter table public.domain_lookup_runs
  add constraint domain_lookup_runs_tool_check check (
    tool in (
      'ranked_keywords',
      'analyze_backlinks',
      'compare_competitors',
      'backlink_changes',
      'backlink_details',
      'disavow_candidates',
      'my_pages'
    )
  );
-- Reverse: alter table public.domain_lookup_runs drop constraint domain_lookup_runs_tool_check;
--          alter table public.domain_lookup_runs
--            add constraint domain_lookup_runs_tool_check check (
--              tool in ('ranked_keywords', 'analyze_backlinks', 'compare_competitors')
--            );
--          (The reverse is only applicable while no row names one of the four added above; the
--          narrower predicate is NOT implied by the wider one, so it would have to be validated
--          against real data. That asymmetry is what makes this widening safe and its reversal not.)

-- Additive in every sense that matters: no table, column, index, policy or grant was created,
-- dropped or altered; RLS and FORCE RLS on public.domain_lookup_runs are untouched, as are its
-- select policy and both GRANT lines (service_role select+insert, authenticated select — still no
-- UPDATE and no DELETE anywhere, because a lookup run is the record of what the vendor said at
-- that moment and is not something to correct later). credit_ledger (NEVER #2) and dfs_spend
-- (0014) were not touched: this table carries no money and still sits between the two that do.
