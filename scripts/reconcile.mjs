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
// N has a HARD 2-minute floor: reaping releases reserves and fails jobs, so a window shorter
// than the longest tool runtime (the crawl budget is 90s) reaps LIVE work. A typo like
// `--older-than-minutes=.15` used to be accepted as a nine-second window; it is now rejected
// unless you also pass --i-accept-refunding-live-jobs. The rules live in the reaper's
// parseReconcileArgs (unit-tested in apps/mcp/src/queue/reaper.test.ts), not here, so the CLI
// and the library can never disagree about what is safe.
//
// Node floor: this imports the reaper's .ts directly, so it needs Node >=22.18 (or >=23)
// with default type-stripping. Older Node exits with ERR_UNKNOWN_FILE_EXTENSION before any
// DB call — safe (no money moves), but confusing mid-incident; upgrade Node if you see it.
//
// Exit 0 on success, 1 on any error.
import { parseReconcileArgs, reconcileStuckJobs } from "../apps/mcp/src/queue/reaper.ts";

let args;
try {
  args = parseReconcileArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const { olderThanMinutes: minutes, allowUnsafeThreshold } = args;
if (allowUnsafeThreshold) {
  console.warn(`WARNING: sweeping with a ${minutes}-minute window — jobs still running may be refunded and failed.`);
}

try {
  const outcome = await reconcileStuckJobs({
    olderThanMs: minutes * 60_000,
    allowUnsafeThreshold,
  });
  console.log(`reconcileStuckJobs — done (olderThanMinutes=${minutes})`);
  console.log(`  scanned (stuck candidates found): ${outcome.scanned}`);
  console.log(`  released (reserves refunded):     ${outcome.released}`);
  console.log(`  alreadySettled (skipped, no dbl): ${outcome.alreadySettled}`);
  // The L-01 split. release_reserve reports a standing charge and an already-refunded
  // reserve with the same "already settled" error; only alreadyCommitted needs a human
  // (see reconciliation.md §2c/§2d) — alreadyReleased is money already back with the user.
  console.log(`    of which committed (charge STANDS, needs review): ${outcome.alreadyCommitted}`);
  console.log(`    of which already refunded (money returned):       ${outcome.alreadyReleased}`);
  console.log(`  failed (running -> failed):       ${outcome.failed}`);
  console.log(`  orphanReserves (via ledger.job_id): ${outcome.orphanReserves}`);
  process.exit(0);
} catch (error) {
  console.error(`reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
