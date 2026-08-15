#!/usr/bin/env bash
# DB-integration gate: TYPE-CHECKS the DB specs (statically, before anything boots — see
# the type-gate block below), then boots the local Supabase stack, resets it to the
# committed migrations, exports connection env, and runs the DB-integration specs against
# it in three lanes off the SAME stack + env:
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

# --- TYPE GATE for this lane ------------------------------------------------------------
# Until this step existed, *.db.test.ts had NO type checker anywhere. apps/mcp and
# packages/db exclude `src/**/*.test.ts` from their tsconfig, so `pnpm typecheck` never read
# one; vitest's transform strips types without checking them, so the lane was green while
# type errors piled up unseen (16 of them, across three files' worth of drifted fixtures and
# a schema slice the specs had outgrown). One `tsconfig.dbtest.json` per package re-adds
# exactly those files.
#
# BEFORE `supabase start` / `db reset` on purpose. The check is STATIC — no stack, no Docker,
# seconds — and resetting a shared stack to then discover a type error is minutes spent for
# nothing. It runs AFTER the workspace build above because the specs reach @pseo/core and
# @pseo/db through their COMPILED `dist/*.d.ts`.
#
# The file-count assertion is the gate's own gate, and it is not decoration: `tsc -p` on a
# config whose `include` matches nothing exits 0, so an emptied include would silently turn
# this step into a green no-op that reports success on any error at all. The expectation is
# DERIVED, never a pinned number — every *.db.test.ts on disk must appear in the program tsc
# actually loads, so a new spec is covered the moment it is written.
dbtest_typegate() {
  local pkg_dir="$1" pkg_name="$2"
  shift 2
  local found covered
  found=$(cd "$pkg_dir" && find "$@" -name '*.db.test.ts' | wc -l | tr -d ' ')
  covered=$(pnpm --filter "$pkg_name" exec tsc -p tsconfig.dbtest.json --noEmit --listFiles \
    2>/dev/null | grep -c '\.db\.test\.ts$' || true)
  if [ "$found" != "$covered" ]; then
    echo "verify-db: $pkg_dir/tsconfig.dbtest.json loads $covered of the $found *.db.test.ts" \
      "files on disk — the type gate is not covering the lane it claims to" >&2
    exit 1
  fi
  echo "verify-db: type gate $pkg_name — $covered/$found *.db.test.ts in the program"
  pnpm --filter "$pkg_name" exec tsc -p tsconfig.dbtest.json --noEmit
}

dbtest_typegate packages/db "@pseo/db" src
dbtest_typegate apps/mcp "@pseo/mcp" src
dbtest_typegate apps/web "@pseo/web" app lib

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
