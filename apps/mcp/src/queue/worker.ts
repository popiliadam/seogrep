import { z } from "zod";
import {
  JOBS_QUEUE,
  failJob,
  getBoss,
  getJob,
  markJobRunning,
  completeJob,
  stopBoss,
  type JobMessage,
} from "./boss.ts";
import type { Json } from "../db.ts";
import {
  isReserveCommitFailed,
  withCredits,
  type ReserveCommitFailedError,
} from "../credits/guard.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import { createCrawlHandler } from "./handlers/crawl.ts";
import { reconcileStuckJobs, type ReconcileOutcome } from "./reaper.ts";
import { DAILY_BUDGET_USD } from "../dfs/budget.ts";
import { metrics } from "../metrics.ts";

/**
 * pg-boss consumer + per-tool handler registry. Real tool handlers arrive in
 * later tasks; this module owns the run lifecycle:
 *
 *   queued -> running -> succeeded (result) | failed (error)
 *
 * Money safety: a job is executed ONLY from `queued`, and the transition is claimed
 * by an ATOMIC compare-and-set (markJobRunning: UPDATE ... WHERE status='queued'). A
 * redelivered or crashed `running` row loses the claim and is never re-run automatically
 * (retryLimit 0 is the first belt; the atomic claim is the second) — re-running would
 * reserve credits again. Recovering stuck `running` rows is a reconciliation concern,
 * not the worker's.
 */

export interface ToolHandlerInput {
  jobId: string;
  userId: string;
  payload: Record<string, unknown>;
}

export type ToolHandler = (input: ToolHandlerInput) => Promise<Json | null>;

const registry = new Map<ToolName, ToolHandler>();

/** Register the handler for a tool. Exactly one handler per tool — no overwrites. */
export function registerToolHandler(tool: ToolName, handler: ToolHandler): void {
  if (registry.has(tool)) {
    throw new Error(`tool handler already registered for "${tool}"`);
  }
  registry.set(tool, handler);
}

export function getToolHandler(tool: ToolName): ToolHandler | undefined {
  return registry.get(tool);
}

/** Test helper: drop every registered handler. */
export function clearToolHandlers(): void {
  registry.clear();
}

/**
 * Register the production tool handlers. Called once by startWorker before the
 * consumer loop opens, keeping registration OUT of module import (so the fast-lane
 * registry specs see an empty registry until they populate it themselves). Idempotent
 * by design — a repeated worker startup re-registers nothing rather than tripping the
 * no-overwrite guard. crawl_site is the first real handler; more land in T8+.
 */
export function registerBuiltinHandlers(): void {
  if (getToolHandler("crawl_site") === undefined) {
    registerToolHandler("crawl_site", createCrawlHandler());
  }
}

const toolNames = Object.keys(TOOL_COSTS) as [ToolName, ...ToolName[]];

/** Queue messages are external input — validate before acting on them. */
const jobMessageSchema = z.object({
  jobId: z.string().min(1),
  userId: z.string().min(1),
  tool: z.enum(toolNames),
  payload: z.record(z.string(), z.unknown()).default({}),
});

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stamped when the tool ran but its charge could not settle (guard.ts's ReserveCommitFailedError).
 * This is NOT the same story as a handler failure: the run produced a result the user never
 * received. What happens to their credits NEXT depends on the reserve's actual disposition, so
 * each one gets its own sentence. A single blanket "reconciliation refunds it automatically"
 * was a promise the code could not keep for every shape — the reaper skips a settled reserve,
 * so a user told to expect a refund would have waited for one that never came.
 */
const COMMIT_FAILED_PREFIX = "the tool ran but its credit charge could not be settled";
const COMMIT_FAILED_BY_DISPOSITION: Record<
  ReserveCommitFailedError["disposition"],
  string
> = {
  // Verified open in the ledger: the sweep WILL find and refund it. A promise we can keep.
  open: `${COMMIT_FAILED_PREFIX} — the reserve is still open and reconciliation refunds it automatically; re-run the tool`,
  // Already released: the money is back now. Nothing further is coming, so do not imply it is.
  refunded: `${COMMIT_FAILED_PREFIX} — the reserve had already been refunded, so you were not charged; re-run the tool`,
  // The classifying read failed too. Promise NOTHING; point at the one path that can resolve it.
  unknown: `${COMMIT_FAILED_PREFIX} and the reserve's final state could not be confirmed — contact support if your balance looks short`,
};

/** The fail-mark for a rejection inside executeJob: honest for the commit shape, raw otherwise. */
function failureDetail(error: unknown): string {
  return isReserveCommitFailed(error)
    ? `${COMMIT_FAILED_BY_DISPOSITION[error.disposition]} (${error.message})`
    : errorDetail(error);
}

/**
 * failJob that cannot itself break executeJob's never-throws contract. The claim path is now
 * inside the main try (M-01), and its most likely failure is the database being unreachable —
 * in which case the recording write fails for the same reason. Log and give up rather than
 * turning a recorded failure into an unhandled rejection that kills the worker.
 */
async function failJobSafely(jobId: string, detail: string): Promise<void> {
  try {
    await failJob(jobId, detail);
  } catch (markError) {
    console.error(`executeJob: could not record failure on job ${jobId}: ${errorDetail(markError)}`);
  }
}

/**
 * Execute one queue message end to end. Never throws: the jobs row is the source
 * of truth for the outcome (succeeded/failed), so handler errors are recorded via
 * failJob and swallowed — with retryLimit 0 a boss-level failure would only
 * duplicate what the row already says.
 */
export async function executeJob(message: JobMessage): Promise<void> {
  const parsed = jobMessageSchema.safeParse(message);
  if (!parsed.success) {
    console.error(`executeJob: dropping malformed queue message: ${parsed.error.message}`);
    return;
  }
  const { jobId, userId, tool, payload } = parsed.data;

  const handler = registry.get(tool);
  if (!handler) {
    await failJob(jobId, `no handler registered for tool "${tool}"`);
    return;
  }

  let result: Json | null;
  try {
    // The CLAIM PATH runs inside this try (M-01). getJob and markJobRunning used to sit
    // outside it, so a blip in either escaped executeJob as a rejected promise: the message
    // was consumed, nothing was recorded, and the row stayed `queued` forever — the exact
    // shape the reaper's new queued lane also backstops. The jobs row is the source of truth
    // for the outcome, so every failure from here on must land ON it.
    const job = await getJob(jobId);
    if (!job) {
      console.error(`executeJob: jobs row ${jobId} not found; dropping message`);
      return;
    }
    if (job.user_id !== userId) {
      // Tenant-isolation guard: the queue message's userId must match the jobs
      // row's owner before the handler runs or any credit reserve opens. A
      // mismatch means a forged/corrupted message or a caller that resolved
      // job ownership incorrectly — fail closed instead of running (and
      // potentially billing) someone else's job under the wrong identity.
      // This runs BEFORE the claim so a mismatched delivery never even flips the
      // row to running (started_at stays NULL).
      console.error(`executeJob: job ${jobId} does not belong to message userId ${userId}; failing`);
      await failJob(jobId, "job owner mismatch: refusing to execute under a different user_id");
      return;
    }

    // Atomic claim: flip queued -> running ONLY if still queued (see markJobRunning). This is
    // the single money-safe gate against double-reserve (B-I1): a redelivery or a second
    // concurrent consumer that loses the race gets claimed=false and returns here, BEFORE any
    // reserve opens. It replaces the old read-status-then-unconditional-mark, whose gap two
    // concurrent deliveries could both slip through and each reserve credits.
    const claimed = await markJobRunning(jobId);
    if (!claimed) {
      console.warn(`executeJob: job ${jobId} was not claimable (already claimed or not queued); skipping`);
      return;
    }

    result = await withCredits({ userId }, { tool, jobId }, () =>
      handler({ jobId, userId, payload }),
    );
  } catch (error) {
    // Three shapes reach here:
    //   • a claim-path error (getJob / markJobRunning) — no reserve ever opened;
    //   • a reserve or handler error — the guard RELEASED the reserve (a clean, refunded
    //     failure), recorded with the raw detail because that detail IS the story;
    //   • a commit_reserve failure — the guard leaves the reserve OPEN (money direction and
    //     reasoning in guard.ts), so this gets its own honest wording. That distinguishing
    //     signal (ReserveCommitFailedError) is the Faz-4 follow-up this comment used to ask
    //     for; the reserve is refunded by reaper.ts's ledger-keyed sweep, not left forever.
    await failJobSafely(jobId, failureDetail(error));
    return;
  }

  // Reaching here means the charge COMMITTED (withCredits returned) and the work is done. A
  // completeJob failure now is NOT a plain failure: the customer was charged and the result is
  // lost, so mark it HONESTLY (never release — refunding a committed, delivered charge would be
  // the wrong money direction; guard.ts keeps the commit). Detection/recovery: reconciliation.md
  // §2d ("paid but result lost") — re-run the idempotent tool or a support credit, operator-judged.
  try {
    await completeJob(jobId, result);
  } catch (error) {
    await failJob(
      jobId,
      `charge settled but result did not persist — contact support (${errorDetail(error)})`,
    );
  }
}

/**
 * How often the worker sweeps for stuck jobs. Comfortably above the reaper's own 15-minute
 * staleness threshold in cost (one bounded query per sweep) and well below the hours a
 * refund used to wait for a human to run scripts/reconcile.mjs by hand.
 */
const REAPER_INTERVAL_MS = 10 * 60_000;

export interface StartWorkerOptions {
  /** Sweep period (default REAPER_INTERVAL_MS). Tests pin it small. */
  readonly reaperIntervalMs?: number;
  /** The sweep itself (default the real reconcileStuckJobs) — the DB-free test seam. */
  readonly reconcile?: () => Promise<ReconcileOutcome>;
}

/** The live sweep timer, or null when the worker is stopped. At most ONE ever exists. */
let reaperTimer: ReturnType<typeof setInterval> | null = null;

/**
 * One sweep. NEVER rejects: a failure is logged and dropped so a broken sweep can neither
 * kill the worker (an unhandled rejection would, under Node's default policy) nor cancel
 * the timer — the next tick simply tries again. Only a COMPLETED sweep is counted, so
 * lastReaperRunAt going stale is an honest "sweeps are failing" signal.
 *
 * The success path also LOGS the outcome, and that log is the operator's real heartbeat: the
 * worker process runs no HTTP listener, so the counters recorded here are unreachable — the
 * public /status is answered by the WEB process, whose metrics singleton never sees a sweep
 * and therefore always reports zeros. A quiet sweep (nothing stuck) leaves no DB trace either,
 * so without this line a silently dead timer would be invisible. One greppable line per sweep:
 * `flyctl logs --app seogrep-mcp | grep 'reaper sweep'` (see scripts/monitoring.md §4).
 */
async function runReaperTick(reconcile: () => Promise<ReconcileOutcome>): Promise<void> {
  try {
    const outcome = await reconcile();
    // BOTH lanes count as refunds — the ledger lane's releases are real money returned, so
    // leaving them out would under-report the one counter an operator reads as "refunds are
    // happening". The heartbeat line below keeps its exact shape; the ledger lane writes its
    // own `orphan reserve sweep:` line from reaper.ts whenever it finds something.
    metrics.recordReaperRun({ released: outcome.released + outcome.orphanReleased });
    console.warn(
      `reaper sweep: scanned=${outcome.scanned} released=${outcome.released}` +
        ` alreadySettled=${outcome.alreadySettled} failed=${outcome.failed}` +
        ` orphanReserves=${outcome.orphanReserves}`,
    );
    const staleDfs = formatStaleDfsWarning(outcome);
    if (staleDfs !== null) console.warn(staleDfs);
    // ESCALATION, not a second copy of the line above. Below the threshold an abandoned
    // reservation is bookkeeping; above it the day's remaining allowance is small enough that
    // PAYING customers start being refused for spend that never happened — a human decision,
    // and therefore the error channel rather than the warn one.
    const wake = formatStaleDfsWake(outcome);
    if (wake !== null) console.error(wake);
  } catch (error) {
    console.error("reaper run failed:", error);
  }
}

/**
 * The stale-DFS warning line, or null when there is nothing to warn about.
 *
 * Extracted so the emission itself is testable. Inlined in the tick it was NOT: a mutation
 * inverting its condition — so the warning never printed at all — passed 761 unit and 148 DB
 * tests. A slice whose entire purpose is observability cannot leave its own output channel
 * unguarded (signed lesson 9).
 *
 * The cap is deliberately not quoted here; it lives in dfs_daily_budget_usd() and a number
 * copied into a log line goes stale the day it changes.
 */
export function formatStaleDfsWarning(outcome: {
  staleDfsReserves: number;
  staleDfsEstimatedUsd: number;
}): string | null {
  if (outcome.staleDfsReserves <= 0) return null;
  return (
    `stale dfs reserves: count=${outcome.staleDfsReserves}` +
    ` holdingUsd=${outcome.staleDfsEstimatedUsd.toFixed(4)}` +
    " — abandoned DataForSEO reservations are charging today's budget their estimate"
  );
}

/**
 * The share of the sanctioned daily cap that abandoned reservations may hold before a human is
 * woken. Half, deliberately: at that point roughly half the day's live DataForSEO capacity has
 * been consumed by spend that did not happen, and every further refusal hits a customer who
 * PAID for those tools. Lower and the line cries wolf over one crashed fan-out; higher and the
 * warning arrives after the denial-of-service it exists to predict.
 */
export const STALE_DFS_WAKE_FRACTION = 0.5;

/**
 * The WAKE-THE-HUMAN escalation of the line above, or null when the residue is still ordinary.
 *
 * WHY THIS AND NOT AN AUTOMATIC CLEANUP. The obvious "fix" for an abandoned reservation is to
 * settle it at $0 on the error path, and that is WRONG here: a run that dies mid-fan-out has
 * really spent part of its estimate, and the team already decided — and pinned with tests — that
 * such a row must never settle for LESS than what actually happened (dfs/backlinks.ts,
 * queue/reaper.ts countStaleDfsReserves). Settling at zero would also rest on an unmeasured
 * assumption, that a failed DataForSEO task is never billed. Nothing here moves money; the DFS
 * lane stays OBSERVATION ONLY, and what changes is that its most dangerous state now reaches a
 * human instead of scrolling past on the warn channel with every routine sweep.
 *
 * Measured 2026-08-07/08: two abandoned rows held $0.30 EACH of a $3.00 day against roughly
 * $0.08 of real spend. Fifteen such rows are the whole day, and every DataForSEO call after them
 * is refused for a budget nobody actually spent.
 *
 * The cap is taken from DAILY_BUDGET_USD — the app-side copy that budget.db.test.ts pins to
 * dfs_daily_budget_usd() — so the threshold moves with the sanctioned figure instead of being a
 * second, drifting literal. Neither the cap nor the threshold is PRINTED, for the reason the
 * warning line already gives: a number copied into a log line goes stale the day it changes.
 */
export function formatStaleDfsWake(
  outcome: { staleDfsReserves: number; staleDfsEstimatedUsd: number },
  capUsd: number = DAILY_BUDGET_USD,
): string | null {
  if (outcome.staleDfsReserves <= 0) return null;
  if (outcome.staleDfsEstimatedUsd < capUsd * STALE_DFS_WAKE_FRACTION) return null;
  return (
    `WAKE THE HUMAN — abandoned DataForSEO reservations are holding ` +
    `$${outcome.staleDfsEstimatedUsd.toFixed(4)} of today's budget across ` +
    `${outcome.staleDfsReserves} open row(s) — more than half the sanctioned daily cap, for ` +
    `spend that never happened. Live DataForSEO tools will start refusing PAYING customers ` +
    `before the UTC day rolls over (contract wake class: money / outside world).`
  );
}

/**
 * Start the periodic stuck-job sweep. Called by startWorker once the consumer is up, and
 * driven directly by the fast-lane spec (which has no boss/DB to start). Idempotent: an
 * existing timer is cleared first, so a repeated start can never stack two sweeps. The
 * timer is unref'd — it must never be the reason the process stays alive.
 *
 * A plain interval, deliberately: pg-boss scheduling would need a second queue whose
 * message shape is not a JobMessage, and the sweep needs no durability (a missed tick is
 * picked up by the next one, and the reaper is idempotent by construction).
 */
export function startReaperTimer(opts: StartWorkerOptions = {}): void {
  stopReaperTimer();
  const reconcile = opts.reconcile ?? reconcileStuckJobs;
  const intervalMs = opts.reaperIntervalMs ?? REAPER_INTERVAL_MS;
  reaperTimer = setInterval(() => {
    void runReaperTick(reconcile);
  }, intervalMs);
  reaperTimer.unref();
}

/** Cancel the sweep timer if one is running. Safe to call when none is. */
function stopReaperTimer(): void {
  if (reaperTimer !== null) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
}

/**
 * Start the queue consumer. Registers the pg-boss work loop for JOBS_QUEUE;
 * handlers registered via registerToolHandler route the actual tool runs. Once the
 * consumer is up, the periodic stuck-job reaper starts alongside it (see
 * startReaperTimer) — the worker process is the one place that owns both.
 */
export async function startWorker(opts: StartWorkerOptions = {}): Promise<void> {
  registerBuiltinHandlers();
  const boss = await getBoss();
  await boss.work<JobMessage>(JOBS_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await executeJob(job.data);
    }
  });
  startReaperTimer(opts);
}

/**
 * Graceful stop for the SIGTERM path: cancels the reaper sweep FIRST (so no new sweep
 * opens while the queue drains), then drains in-flight work via pg-boss.
 */
export async function stopWorker(): Promise<void> {
  stopReaperTimer();
  await stopBoss();
}
