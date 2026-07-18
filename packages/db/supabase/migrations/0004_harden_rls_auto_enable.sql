-- Migration 0004: harden pre-existing groundwork function (security advisor WARN).
-- public.rls_auto_enable() is a SECURITY DEFINER event-trigger function installed
-- during Phase 2 groundwork (outside these migrations, cloud only). It was
-- executable by anon/authenticated via PostgREST RPC. Event triggers fire without
-- checking EXECUTE privilege, so revoking client execution is safe.
-- Guarded: the function does not exist on fresh local/CI stacks.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
