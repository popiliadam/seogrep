#!/usr/bin/env bash
# append-only-armor goal predicate: credit_ledger must keep its 0002 append-only armor —
# BOTH the REVOKE of UPDATE/DELETE/TRUNCATE from the writer roles AND the row-level
# reject_mutation trigger — present somewhere in the committed migrations. Grep-based and
# DB-less on purpose (mirrors check-rls.sh) so `make goals` needs no Supabase stack; the
# LIVE negative that proves the armor actually rejects (even for service_role) runs in
# guardrails/verify-db.sh via append-only-armor.db.test.ts. Exit 0 = armor present; exit 1
# lists what is missing. (CLAUDE.md NEVER #2 — the ledger stays append-only.)
set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATIONS_DIR="packages/db/supabase/migrations"
[ -d "$MIGRATIONS_DIR" ] || { echo "check-append-only: no migrations dir"; exit 1; }

ALL_SQL="$(cat "$MIGRATIONS_DIR"/*.sql | tr '[:upper:]' '[:lower:]')"

fail=0

# 1) The rejection function the trigger executes.
if ! printf '%s' "$ALL_SQL" | grep -Eq 'create (or replace )?function public\.reject_mutation'; then
  echo "check-append-only: MISSING public.reject_mutation() function"
  fail=1
fi

# 2) REVOKE UPDATE + DELETE + TRUNCATE on credit_ledger (append-only: no role may mutate).
#    Whitespace/role-list ordering tolerant; require all three verbs + the table, in one
#    statement ([^;]* never crosses a semicolon).
if ! printf '%s' "$ALL_SQL" \
  | grep -Eq 'revoke[^;]*update[^;]*delete[^;]*truncate[^;]*on public\.credit_ledger'; then
  echo "check-append-only: MISSING REVOKE UPDATE,DELETE,TRUNCATE on public.credit_ledger"
  fail=1
fi

# 3) The row-level BEFORE UPDATE OR DELETE trigger on credit_ledger.
if ! printf '%s' "$ALL_SQL" \
  | grep -Eq 'create trigger [a-z_]+ before update or delete on public\.credit_ledger'; then
  echo "check-append-only: MISSING BEFORE UPDATE OR DELETE trigger on public.credit_ledger"
  fail=1
fi

[ "$fail" -eq 0 ] && echo "CHECK-APPEND-ONLY: PASS (credit_ledger REVOKE + reject_mutation trigger present)"
exit "$fail"
