#!/usr/bin/env bash
# DataForSEO daily dev-budget guard (constitution NEVER #5: live dev-smoke spend <= $3/day).
# Sums today's recorded spend (UTC) from guardrails/.dfs-spend/<YYYY-MM-DD>.jsonl and FAILS
# (exit 1, with a dump) once it has reached the $3.00 cap. No file today => nothing spent
# => exit 0. This is the goals/dfs-budget-guard predicate; apps/mcp dfs/budget.ts records
# each live call's cost. In test/CI there are ZERO live calls, so this file is normally empty.
set -euo pipefail
cd "$(dirname "$0")/.."

CAP="3.0"
DAY="$(date -u +%F)"
FILE="guardrails/.dfs-spend/${DAY}.jsonl"

if [ ! -f "$FILE" ]; then
  echo "dfs-budget: no spend recorded for ${DAY} (\$0.00 / \$${CAP}) — OK"
  exit 0
fi

# Sum the cost_usd field across the day's JSONL lines with node (always present in this repo;
# jq/python may not be). Malformed/blank lines are ignored, matching apps/mcp dfs/budget.ts.
TOTAL="$(FILE="$FILE" node -e '
  const fs = require("fs");
  let total = 0;
  for (const line of fs.readFileSync(process.env.FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { const o = JSON.parse(t); if (typeof o.cost_usd === "number" && isFinite(o.cost_usd)) total += o.cost_usd; } catch {}
  }
  process.stdout.write(total.toFixed(4));
')"

# Float comparison via node (bash cannot compare decimals). TOTAL is a node-formatted number.
if node -e "process.exit((${TOTAL} >= ${CAP}) ? 0 : 1)"; then
  echo "dfs-budget: FAIL — today's DataForSEO spend \$${TOTAL} has reached the \$${CAP} cap (${DAY})."
  echo "  Refusing further live calls. Wake the human (contract wake class: money / outside world)."
  echo "  --- ${FILE} ---"
  cat "$FILE"
  exit 1
fi

echo "dfs-budget: OK — today's DataForSEO spend \$${TOTAL} / \$${CAP} (${DAY})."
exit 0
