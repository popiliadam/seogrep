/**
 * Process-local operational metrics for the MCP gateway (the cheap end-the-blind-flight
 * signals the `/status` route exposes). This is deliberately IN-MEMORY and PER-PROCESS:
 * the counters live only in the running process, reset to zero on every deploy/restart,
 * and are NOT shared across Fly machines. That is the accepted beta scope — durable
 * metrics, history, and cross-instance aggregation are Faz 4 (see scripts/monitoring.md).
 * The module has no I/O and no dependency on the DB or env, so it is trivially testable.
 */

/** An immutable point-in-time view of the counters, returned by Metrics.snapshot(). */
export interface MetricsSnapshot {
  /** Whole seconds the process has been up (floored, never negative). */
  readonly uptimeSeconds: number;
  /** Count of 5xx server errors observed since this process booted. */
  readonly errorsSinceBoot: number;
}

/** The counter surface: a writer (recordServerError) plus two pure readers. */
export interface Metrics {
  /** Increment the since-boot server-error (5xx) count. */
  readonly recordServerError: () => void;
  /** Whole seconds since boot, derived from the construction clock. */
  readonly uptimeSeconds: () => number;
  /** An immutable snapshot of the current counters. */
  readonly snapshot: () => MetricsSnapshot;
}

/** Convert a millisecond delta to whole seconds, floored and clamped at 0. */
function toWholeSeconds(elapsedMs: number): number {
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

/**
 * Build a process-local metrics holder. `clock` (default Date.now) is read once at
 * construction to capture the boot instant, and again on every uptime/snapshot read —
 * so a test injects a mutable fake clock (() => now) to advance time deterministically
 * without touching real wall-clock time. The error count is a single encapsulated
 * integer; snapshots are frozen copies, so a caller can never mutate the live counter.
 */
export function createMetrics(clock: () => number = Date.now): Metrics {
  const bootMs = clock();
  let errorsSinceBoot = 0;
  const uptimeSeconds = (): number => toWholeSeconds(clock() - bootMs);
  return {
    recordServerError: () => {
      errorsSinceBoot += 1;
    },
    uptimeSeconds,
    snapshot: () => Object.freeze({ uptimeSeconds: uptimeSeconds(), errorsSinceBoot }),
  };
}

/**
 * The process-wide metrics singleton the gateway wires into its 5xx paths and reads on
 * `/status`. Its boot instant is captured HERE at module load, so uptimeSeconds measures
 * process lifetime. Per-process and in-memory (see the module note): it resets on deploy
 * and is not aggregated across machines — accepted beta scope, documented in the runbook.
 */
export const metrics: Metrics = createMetrics();
