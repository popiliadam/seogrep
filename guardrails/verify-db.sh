#!/usr/bin/env bash
# DB-integration gate: boots the local Supabase stack, resets it to the committed
# migrations, exports connection env, and runs the ledger repo tests against it.
# Kept OUT of the fast gate (guardrails/verify.sh stays DB-less and fast). Requires
# Docker running + the supabase CLI (the pinned repo devDependency bin — same
# lockfile-controlled version locally and in CI; PATH is only a fallback).
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile

# Prefer the pinned devDependency bin (deterministic, lockfile-controlled);
# fall back to a CLI on PATH only if the bin is missing.
SUPABASE="./node_modules/.bin/supabase"
if [ ! -x "$SUPABASE" ]; then
  SUPABASE="$(command -v supabase || true)"
fi
if [ -z "$SUPABASE" ] || [ ! -x "$SUPABASE" ]; then
  echo "verify-db: supabase CLI not found (./node_modules/.bin/supabase or PATH)" >&2
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
