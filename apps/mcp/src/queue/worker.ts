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
  type Json,
} from "./boss.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";

/**
 * pg-boss consumer + per-tool handler registry. Real tool handlers arrive in
 * later tasks; this module owns the run lifecycle:
 *
 *   queued -> running -> succeeded (result) | failed (error)
 *
 * Money safety: a job is executed ONLY from `queued`. A redelivered or crashed
 * `running` row is never re-run automatically (the queue's retryLimit is 0 and
 * this guard is the second belt) — re-running would reserve credits again.
 * Recovering stuck `running` rows is a reconciliation concern, not the worker's.
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

  const job = await getJob(jobId);
  if (!job) {
    console.error(`executeJob: jobs row ${jobId} not found; dropping message`);
    return;
  }
  if (job.status !== "queued") {
    // Redelivery / crash leftover — never auto re-run (see module comment).
    console.warn(`executeJob: job ${jobId} is "${job.status}", not "queued"; skipping`);
    return;
  }

  await markJobRunning(jobId);
  try {
    const result = await withCredits({ userId }, { tool, jobId }, () =>
      handler({ jobId, userId, payload }),
    );
    await completeJob(jobId, result);
  } catch (error) {
    await failJob(jobId, errorDetail(error));
  }
}

/**
 * Start the queue consumer. Registers the pg-boss work loop for JOBS_QUEUE;
 * handlers registered via registerToolHandler route the actual tool runs.
 */
export async function startWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work<JobMessage>(JOBS_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await executeJob(job.data);
    }
  });
}

/** Graceful stop for the SIGTERM path: drains in-flight work via pg-boss. */
export async function stopWorker(): Promise<void> {
  await stopBoss();
}
