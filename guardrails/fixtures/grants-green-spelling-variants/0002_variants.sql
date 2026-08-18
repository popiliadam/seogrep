-- SYNTHETIC FIXTURE - never applied, and expected GREEN. The SPELLING axis: PostgreSQL accepts
-- several equivalent ways to write the same revoke, and a gate that only matched the one
-- spelling used in this repo would silently demand a reformat -- or worse, quietly fail to
-- credit a revoke that is genuinely there and send an author looking for a bug that does not
-- exist. Every statement below is a legitimate spelling of a complete narrowing.
create table public.lookup_runs (
  id uuid primary key,
  user_id uuid not null
);
alter table public.lookup_runs enable row level security;
alter table public.lookup_runs force row level security;
GRANT SELECT ON TABLE public.lookup_runs TO authenticated;
GRANT SELECT, INSERT ON TABLE public.lookup_runs TO service_role;
-- Upper case + the optional TABLE keyword + several roles in one statement.
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.lookup_runs FROM anon;
-- Lower case, no TABLE keyword, unqualified table name (search_path resolves it to public).
revoke insert, update, delete on lookup_runs from authenticated;
-- A quoted identifier, which postgres treats exactly like the bare word here.
revoke update, delete on public."lookup_runs" from service_role;
