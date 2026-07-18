#!/usr/bin/env bash
# DB-integration gate: boots the local Supabase stack, resets it to the committed
# migrations, exports connection env, and runs the ledger repo tests against it.
# Kept OUT of the fast gate (guardrails/verify.sh stays DB-less and fast). Requires
# Docker running + the supabase CLI (on PATH via supabase/setup-cli in CI, or the
# repo devDependency bin locally).
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile

# Prefer a CLI on PATH (CI: supabase/setup-cli); fall back to the devDependency bin.
SUPABASE="$(command -v supabase || true)"
if [ -z "$SUPABASE" ]; then
  SUPABASE="./node_modules/.bin/supabase"
fi
if [ ! -x "$SUPABASE" ] && ! command -v "$SUPABASE" >/dev/null 2>&1; then
  echo "verify-db: supabase CLI not found (PATH or ./node_modules/.bin/supabase)" >&2
  exit 1
fi

# Idempotent: 'start' is a no-op if the stack is already running.
"$SUPABASE" start --workdir packages/db
# Re-apply migrations from scratch so tests see a known-clean schema.
"$SUPABASE" db reset --workdir packages/db

# Export connection variables from the running stack under the names the tests read
# (createServiceClient reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; the RLS test
# also needs SUPABASE_ANON_KEY). Values come from the local stack — never hardcoded.
set -a
eval "$(
  "$SUPABASE" status --workdir packages/db -o env \
    --override-name api.url=SUPABASE_URL \
    --override-name auth.anon_key=SUPABASE_ANON_KEY \
    --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
    --override-name db.url=SUPABASE_DB_URL
)"
set +a

pnpm --filter @pseo/db run test:db

echo "VERIFY-DB: PASS"
