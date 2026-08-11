#!/usr/bin/env bash
# DB-integration gate: boots the local Supabase stack, resets it to the committed
# migrations, exports connection env, and runs the DB-integration specs against it in
# three lanes off the SAME stack + env:
#   1. @pseo/db  — the ledger repo + claim_trial specs (packages/db).
#   2. @pseo/mcp — the gateway's DB-backed specs (auth / credit guard / queue worker).
#   3. @pseo/web — the gsc_accounts write layer (apps/web/lib/gsc/accounts.db.test.ts).
# Kept OUT of the fast gate (guardrails/verify.sh stays DB-less and fast). Requires
# Docker running + the supabase CLI (the pinned repo devDependency bin — same
# lockfile-controlled version locally and in CI; PATH is only a fallback).
#
# KNOWN FALSE ALARM — read this before believing a mass failure.
# `supabase db reset` recreates the auth container, and Kong can be left pointing at the
# OLD upstream. Every spec that provisions a user then dies with the same useless message:
#     admin.createUser failed: {}
# Dozens of failures, no assertion reached, nothing wrong with the schema or the code.
# Cure: `docker restart supabase_kong_seogrep`, then re-run. Confirm with
# `curl -s -o /dev/null -w '%{http_code}' "$SUPABASE_URL/auth/v1/health"` — 502 means Kong,
# 200 means the failure is real.
# Recorded because it has now cost two separate sessions an investigation each; the second
# time it was a fresh reviewer who nearly read 88 failures as a broken migration.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile

# Build the workspace library packages so the DB specs resolve their COMPILED
# deps: @pseo/core and @pseo/db are `main: ./dist/index.js`, so a clean checkout
# (CI) has no dist and @pseo/mcp's test:db dies with "Failed to resolve entry for
# @pseo/core". The fast gate (verify.sh) builds these via turbo's ^build; this DB
# lane runs `pnpm --filter … test:db` directly, so it must build the deps itself.
# Locally this is a fast turbo cache hit — the missing build was masked until now
# by a stale local dist, so CI (clean checkout) failed while local stayed green.
pnpm turbo run build --filter='./packages/*'

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

node packages/db/scripts/gen-db-types.mjs --check # drift gate: committed types.ts == freshly generated

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
pnpm --filter @pseo/mcp run test:db
pnpm --filter @pseo/web run test:db

echo "VERIFY-DB: PASS"
