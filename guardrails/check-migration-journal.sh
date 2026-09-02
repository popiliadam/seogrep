#!/usr/bin/env bash
# Repo migrations vs the CLOUD migration journal.
#
# WHY. `packages/db/supabase/migrations/*.sql` is the repo's history;
# `supabase_migrations.schema_migrations` is the cloud's record of what it believes it applied.
# `supabase db push` diffs the two, so when the journal falls behind, push tries to RE-APPLY
# migrations whose objects already exist and stops on "already exists" — or worse, pushes an
# operator toward a `repair` they have to reason out under time pressure.
#
# MEASURED 2026-08-27 against production: the repo held 33 migrations and the journal accounted for
# only 21 of them by repo version. TWELVE (0022-0033) were missing. The 2026-08-26 audit reported
# ONE (0033) — it read a handoff note rather than the table (M-08).
#
# HOW IT DRIFTED, which is the part worth keeping: 0001-0021 carry `created_by = NULL` and the
# file's own version, i.e. `supabase db push` wrote them. Everything after was applied by hand —
# four through the dashboard/MCP (journalled under a TIMESTAMP version and an operator email) and
# eight through the raw SQL editor (not journalled at all). The schema was right every time; only
# the record of it was lost. So this is not a discipline problem to be solved by remembering — it
# is what happens whenever the apply path is not `db push`, and it needs a gate.
#
# WHAT THIS GATE MEASURES, AND WHAT IT DOES NOT (imzalı ders 7):
#   MEASURES  — with SUPABASE_DB_URL set: every repo migration version present in the cloud journal.
#               It names the host it measured.
#   NOT       — whether the SQL that ran matches the file. A version present in the journal is
#               taken at its word; this compares NAMES, not content hashes. Content drift is a
#               different gate and does not exist yet.
#   NOT       — anything at all without SUPABASE_DB_URL: it reports SKIP (exit 97), never a silent
#               OK. `make goals` renders that as "PASS (SKIP)" — not a full measurement.
#   FAIL-CLOSED — with the env set but the journal unreadable, this FAILS. A journal that could not
#               be read is not an empty one.
#
# --self-test exercises the comparison offline, with no database at all.
set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATIONS_DIR="packages/db/supabase/migrations"

# Repo versions: the 4-digit prefix of each migration file, which is exactly the version string
# `supabase db push` records.
repo_versions() {
  find "$MIGRATIONS_DIR" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.sql' -exec basename {} \; \
    | sed 's/^\([0-9][0-9][0-9][0-9]\)_.*/\1/' | sort -u
}

# The comparison, as a pure function over two newline-separated lists. Everything testable lives
# here so --self-test can drive it without a database.
compare() {
  local repo="$1" journal="$2"
  comm -23 <(printf '%s\n' "$repo" | sort -u) <(printf '%s\n' "$journal" | sort -u)
}

if [ "${1:-}" = "--self-test" ]; then
  fails=0
  expect() { # name expected actual
    if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 — expected [$2], got [$3]"; fails=$((fails+1)); fi
  }
  expect "in sync -> nothing missing" "" "$(compare '0001
0002' '0001
0002')"
  expect "the EXACT 2026-08-27 shape (journal behind) -> named" "0033" "$(compare '0032
0033' '0032')"
  expect "several missing -> all named" "0022 0023" "$(compare '0021
0022
0023' '0021' | tr '\n' ' ' | sed 's/ $//')"
  expect "journal AHEAD of repo is not a failure here" "" "$(compare '0001' '0001
0002')"
  # The repo list must be derived, not empty: an empty repo list would make every comparison pass.
  n=$(repo_versions | wc -l | tr -d ' ')
  if [ "$n" -gt 0 ]; then echo "PASS  repo version list is non-empty ($n migrations)"; else
    echo "FAIL  repo version list came back EMPTY — the comparison would pass against anything"; fails=$((fails+1)); fi
  if [ "$fails" -gt 0 ]; then
    echo "check-migration-journal --self-test FAILED: $fails case(s)."; exit 1
  fi
  echo "check-migration-journal --self-test OK — a journal behind the repo measured RED offline."
  exit 0
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "check-migration-journal SKIP — SUPABASE_DB_URL is not set, so the cloud journal was NOT read."
  echo "  This is not an OK: export the production connection string and re-run to measure it."
  exit 97
fi

HOST="$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's#.*@([^:/?]+).*#\1#')"
echo "check-migration-journal: reading the journal on ${HOST}"

JOURNAL="$(
  node_modules/.bin/supabase migration list --db-url "$SUPABASE_DB_URL" 2>/dev/null \
    | sed -nE 's/^[[:space:]]*([0-9]+)?[[:space:]]*\|[[:space:]]*([0-9]+)[[:space:]]*\|.*/\2/p' \
    | sort -u
)" || true

if [ -z "$JOURNAL" ]; then
  echo "check-migration-journal FAILED — the journal on ${HOST} could not be read."
  echo "  A journal that cannot be read is NOT an empty one; refusing to report the repo in sync."
  exit 1
fi

MISSING="$(compare "$(repo_versions)" "$JOURNAL")"
if [ -n "$MISSING" ]; then
  echo "check-migration-journal FAILED — ${HOST} does not record these repo migrations:"
  printf '  - %s\n' $MISSING
  echo ""
  echo "  The schema may still be correct — these were probably applied by hand. Verify the objects,"
  echo "  then reconcile with \`supabase migration repair --status applied <version>\` per version."
  echo "  Do NOT re-run the migration: it will stop on \"already exists\"."
  exit 1
fi
echo "check-migration-journal OK — ${HOST} records all $(repo_versions | wc -l | tr -d ' ') repo migrations."
