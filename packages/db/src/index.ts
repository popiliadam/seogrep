/**
 * The schema version this package models: the number of the HIGHEST migration committed under
 * `supabase/migrations/` (0025_… → 25). That definition is chosen over the alternatives (a
 * hand-picked release number, or a count) because it is the only one derivable from the repo with
 * no database and no bookkeeping — so `index.test.ts` can pin it mechanically, and a migration
 * that lands without bumping this constant turns the fast gate red. Migration numbering is a
 * gap-free 1..N run, so this equals the migration file count as well.
 *
 * It sat at 0 through thirteen migrations, which is exactly the drift the pin now prevents.
 */
export const SCHEMA_VERSION = 29;
