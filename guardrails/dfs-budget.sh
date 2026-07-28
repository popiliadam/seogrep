#!/usr/bin/env bash
# DataForSEO daily vendor-budget guard (constitution NEVER #5: live spend <= $3/day).
#
# What this gate MEASURES: today's (UTC) total in public.dfs_spend, read through the
# dfs_spend_today_usd RPC of whatever Supabase project SUPABASE_URL points at. Open reservations
# count at their estimate, settled ones at their real cost — the same number the app's own gate
# compares against the cap (apps/mcp/src/dfs/budget.ts, migration 0014).
#
# What it does NOT do: guess. Before migration 0014 this script summed
# guardrails/.dfs-spend/<day>.jsonl while production wrote its ledger to DFS_BUDGET_DIR=/tmp on
# the Fly machines — two different files, so the gate reported "$0.00 — OK" no matter what the
# fleet had spent (hostile audit H-03). It now either reads the real counter or says out loud
# that it cannot measure and reports SKIP; there is no silent green (signed lesson 7).
#
# Exit codes: 0 = measured, under the cap · 1 = measured and AT/OVER the cap, or the counter
# could not be read · 97 = not measured (SKIP sentinel understood by guardrails/verify-goals.sh).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

CAP="3.0"
DAY="$(date -u +%F)"

# A leftover pre-0014 file ledger is NOT the counter any more. Say so rather than let a reader
# assume the old tree still means something.
LEGACY_DIR="guardrails/.dfs-spend"
if [ -d "$LEGACY_DIR" ] && [ -n "$(ls -A "$LEGACY_DIR" 2>/dev/null)" ]; then
  echo "dfs-budget: note — ${LEGACY_DIR}/ still holds pre-0014 spend files. They are NOT counted;"
  echo "  the ledger is public.dfs_spend in the database. Safe to delete."
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "dfs-budget: SKIP — cannot measure production spend from here (${DAY})."
  echo "  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are not set, so the dfs_spend counter is"
  echo "  unreachable. This is NOT a \$0.00 reading and NOT a pass: nothing was measured."
  echo "  To measure, export the target project's env and re-run."
  exit 97
fi

# Read the counter through PostgREST. node is always present in this repo (jq/psql may not be).
READING="$(SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" node -e '
const url = `${process.env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/dfs_spend_today_usd`;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const res = await fetch(url, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: "{}",
  signal: AbortSignal.timeout(10_000),
});
const body = await res.text();
if (!res.ok) {
  process.stderr.write(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  process.exit(1);
}
const total = Number(JSON.parse(body));
if (!Number.isFinite(total)) {
  process.stderr.write(`non-numeric total: ${body.slice(0, 300)}`);
  process.exit(1);
}
process.stdout.write(total.toFixed(4));
' 2>&1)"
RC=$?

# The measurable host, named on every line of output, so a green result always says WHAT it read.
HOST="$(SUPABASE_URL="$SUPABASE_URL" node -e 'process.stdout.write(new URL(process.env.SUPABASE_URL).host)' 2>/dev/null || echo "unknown-host")"

if [ "$RC" -ne 0 ]; then
  echo "dfs-budget: FAIL — could not read the dfs_spend counter at ${HOST} (${DAY})."
  echo "  ${READING}"
  echo "  An uncountable budget is treated as unsafe, not as \$0.00 (fail-closed)."
  exit 1
fi

if node -e "process.exit((${READING} >= ${CAP}) ? 0 : 1)"; then
  echo "dfs-budget: FAIL — today's DataForSEO spend \$${READING} has reached the \$${CAP} cap (${DAY}, ${HOST})."
  echo "  Refusing further live calls. Wake the human (contract wake class: money / outside world)."
  exit 1
fi

echo "dfs-budget: OK — DataForSEO spend \$${READING} / \$${CAP} today (${DAY}), measured at ${HOST}."
exit 0
