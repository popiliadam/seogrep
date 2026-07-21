// Stuck-job reconciliation — one-shot operator entrypoint (audit §7).
//
// Refunds the open credit reserves of crashed/stuck jobs and marks those jobs failed
// (see scripts/reconciliation.md for the full runbook). Run manually, or by an external
// scheduler per the runbook — this is intentionally NOT a daemon. Automatic periodic
// reaping + alerting is deferred to the Faz 4 monitoring work.
//
// Usage:
//   # export the same env the app uses (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
//   # SUPABASE_DB_URL — the prod names, matching guardrails/verify-db.sh)
//   node scripts/reconcile.mjs [--older-than-minutes=N]   # N defaults to 15
//
// Node floor: this imports the reaper's .ts directly, so it needs Node >=22.18 (or >=23)
// with default type-stripping. Older Node exits with ERR_UNKNOWN_FILE_EXTENSION before any
// DB call — safe (no money moves), but confusing mid-incident; upgrade Node if you see it.
//
// Exit 0 on success, 1 on any error.
import { reconcileStuckJobs } from "../apps/mcp/src/queue/reaper.ts";

const flag = process.argv.slice(2).find((arg) => arg.startsWith("--older-than-minutes="));
const minutes = flag ? Number(flag.slice("--older-than-minutes=".length)) : 15;
if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error(`invalid --older-than-minutes: ${flag} (expected a positive number)`);
  process.exit(1);
}

try {
  const outcome = await reconcileStuckJobs({ olderThanMs: minutes * 60_000 });
  console.log(`reconcileStuckJobs — done (olderThanMinutes=${minutes})`);
  console.log(`  scanned (stuck candidates found): ${outcome.scanned}`);
  console.log(`  released (reserves refunded):     ${outcome.released}`);
  console.log(`  alreadySettled (skipped, no dbl): ${outcome.alreadySettled}`);
  console.log(`  failed (running -> failed):       ${outcome.failed}`);
  console.log(`  orphanReserves (via ledger.job_id): ${outcome.orphanReserves}`);
  process.exit(0);
} catch (error) {
  console.error(`reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
