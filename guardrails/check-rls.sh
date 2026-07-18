#!/usr/bin/env bash
# rls-enabled goal predicate: every table created in packages/db/supabase/migrations/
# must have BOTH "enable row level security" and "force row level security" statements
# somewhere in the migrations directory. Exit 0 = all covered; exit 1 lists offenders.
# (Grep-based, deliberately simple: table names are extracted from "create table" lines.)
set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATIONS_DIR="packages/db/supabase/migrations"
[ -d "$MIGRATIONS_DIR" ] || { echo "check-rls: no migrations dir"; exit 1; }

ALL_SQL="$(cat "$MIGRATIONS_DIR"/*.sql | tr '[:upper:]' '[:lower:]')"

tables="$(printf '%s\n' "$ALL_SQL" | grep -Eo 'create table (if not exists )?public\.[a-z_]+' | sed -E 's/.*public\.//' | sort -u)"

fail=0
for t in $tables; do
  if ! printf '%s' "$ALL_SQL" | grep -Eq "alter table public\.$t enable row level security"; then
    echo "check-rls: MISSING enable RLS for public.$t"
    fail=1
  fi
  if ! printf '%s' "$ALL_SQL" | grep -Eq "alter table public\.$t force row level security"; then
    echo "check-rls: MISSING force RLS for public.$t"
    fail=1
  fi
done

[ "$fail" -eq 0 ] && echo "CHECK-RLS: PASS ($(printf '%s\n' "$tables" | wc -l | tr -d ' ') tables)"
exit "$fail"
