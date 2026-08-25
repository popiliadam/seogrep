import { z } from "zod";
import { summarizeCrawlResult, summarizePullResult } from "@pseo/core";
import { getServiceClient, type JobRow } from "../db.ts";
import { getJobForUser } from "../queue/boss.ts";
import { defineTool, errorResult, textResult } from "./registry.ts";

/**
 * get_job_status — check an async job (e.g. a crawl_site run). 0 credits. Reads the
 * job TENANT-SCOPED via getJobForUser (the ONLY job read a tool surface may use): an
 * unknown id and another tenant's job are indistinguishable, so there is no
 * cross-tenant existence leak. Never wire the id-only getJob here.
 */

/**
 * The pure crawl-result summarizer, re-exported from its new home in @pseo/core
 * (`guide/crawl-summary`). `import` + a separate `export` rather than `export … from`, because
 * `formatJobStatus` below CALLS it and `export … from` creates no local binding (the emsal:
 * setup-project.ts's `normalizeDomain`).
 *
 * It moved because apps/web needs the SAME sentence: the panel shows a job's crawl summary, and
 * a second copy of "how many pages, why were they skipped, was the HOMEPAGE among them" would be
 * a second place for the two surfaces to disagree. Its private helpers (dominantSkipReason,
 * urlOf, pathOf, skippedHomepageNote) went with it.
 */
export { summarizeCrawlResult };

/**
 * Summarize a finished job's stored result, whatever tool produced it, or null when nothing
 * here can read it.
 *
 * DISPATCHED ON SHAPE, NOT ON `job.tool`. A crawl result is `{ pages[], skipped[] }` and a pull
 * result is `{ current: {rows[]}, previous: {rows[]} }`; neither satisfies the other's guard, so
 * the two summarizers are mutually exclusive and the order below is arbitrary rather than
 * load-bearing. Reading the tool NAME would look equivalent and is not: it would make the status
 * line depend on a string, so a job recorded under a renamed or unexpected tool would lose its
 * summary even though its result is perfectly readable — and it would need a new branch here
 * every time a tool is added, which is the maintenance shape that leaves the third one out.
 *
 * A result no summarizer recognises returns null and the caller prints the status line with no
 * detail — the behaviour every non-crawl job had before this.
 */
export function summarizeJobResult(result: JobRow["result"]): string | null {
  return summarizeCrawlResult(result) ?? summarizePullResult(result);
}

/**
 * What can truthfully be said about how long a job took.
 *
 *   ok           — the stamps are ordered and both ends of the run are present.
 *   none         — nothing is wrong, there is just no run to measure yet (queued; running with
 *                  no finish; or a terminal row that was never claimed, so it has a finish and
 *                  no start — enqueue-send failures, owner mismatches, the reaper's queued lane).
 *   inconsistent — the STORED stamps contradict each other. Not hypothetical: every
 *                  pull_gsc_data row written before this fix has `created_at` stamped at INSERT
 *                  time, i.e. AFTER the work it describes, so `finished_at` precedes it.
 */
export type JobTiming =
  | { readonly kind: "ok"; readonly durationMs: number }
  | { readonly kind: "none" }
  | { readonly kind: "inconsistent" };

/**
 * Classify a job's lifecycle stamps. Pure, and the ONLY place the ordering rule lives.
 *
 * THE RULE: created_at <= started_at <= finished_at, over the stamps that are actually present.
 * Absent stamps are skipped rather than defaulted — a queued job has no start and a
 * never-claimed failed job has a finish but no start, and neither is a contradiction. Filtering
 * the nulls out of an already-chronological list and comparing neighbours is exactly "each
 * present stamp is at or after the previous present one".
 *
 * WHY A NEGATIVE DURATION IS NEVER RETURNED, rather than clamped: a stored pair that violates
 * the rule does not describe a short run, it describes an UNKNOWN one. Any number derived from
 * it — including 0 — is a fabricated measurement presented as fact. Reporting `inconsistent`
 * and printing no figure is the only honest option left to a reader that cannot re-time the run.
 */
export function jobTiming(job: JobRow): JobTiming {
  const started = job.started_at === null ? null : Date.parse(job.started_at);
  const finished = job.finished_at === null ? null : Date.parse(job.finished_at);
  const present = [Date.parse(job.created_at), started, finished].filter(
    (ms): ms is number => ms !== null,
  );
  // An unparseable stamp is a contradiction too: it cannot be ordered against anything.
  if (present.some((ms) => Number.isNaN(ms))) return { kind: "inconsistent" };
  for (let i = 1; i < present.length; i++) {
    if ((present[i] as number) < (present[i - 1] as number)) return { kind: "inconsistent" };
  }
  if (started === null || finished === null) return { kind: "none" };
  return { kind: "ok", durationMs: finished - started };
}

/** Render a non-negative millisecond span the way a person reads a stopwatch. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

/**
 * What a reader is told when the stored stamps contradict each other. It names the STORED DATA
 * as the problem, not the job: the run itself may well have been fine, and telling a customer
 * their job failed because its bookkeeping is crooked would be a second lie on top of the first.
 */
export const TIMING_INCONSISTENT_NOTE =
  "timing unavailable (this job's stored timestamps are out of order)";

/** The trailing timing clause, or null when there is nothing truthful to say. */
function timingPart(job: JobRow): string | null {
  const timing = jobTiming(job);
  if (timing.kind === "ok") return `took ${formatDuration(timing.durationMs)}`;
  if (timing.kind === "inconsistent") return TIMING_INCONSISTENT_NOTE;
  return null;
}

/** Join the non-null lifecycle stamps into a compact ` · `-separated trail. */
function stampsOf(job: JobRow): string {
  return [
    `created ${job.created_at}`,
    job.started_at ? `started ${job.started_at}` : null,
    job.finished_at ? `finished ${job.finished_at}` : null,
    timingPart(job),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * Render a human-readable status line for a job. Pure (no I/O) so the fast lane can
 * pin the wording of every status; the tenant-scoped read is proven in the db spec.
 */
export function formatJobStatus(job: JobRow): string {
  const head = `Job ${job.id} (${job.tool})`;
  const stamps = stampsOf(job);
  switch (job.status) {
    case "queued":
      return `${head} is queued. ${stamps}.`;
    case "running":
      return `${head} is running. ${stamps}.`;
    case "succeeded": {
      const summary = summarizeJobResult(job.result);
      return `${head} succeeded. ${stamps}.${summary ? ` ${summary}.` : ""}`;
    }
    case "failed":
      return `${head} failed: ${job.error ?? "unknown error"}. ${stamps}.`;
  }
}

export const getJobStatusTool = defineTool({
  name: "get_job_status",
  description:
    "Check the status and result summary of an async job (e.g. a crawl_site run), by its job_id.",
  inputSchema: z.object({
    job_id: z.uuid().describe("The job_id returned by an async tool such as crawl_site."),
  }),
  handler: async (ctx, { job_id }) => {
    const job = await getJobForUser(getServiceClient(), job_id, ctx.userId);
    if (!job) {
      // Unknown id and another tenant's job both land here (see getJobForUser) — one
      // message, no cross-tenant existence leak.
      return errorResult(`No job found with id ${job_id}.`);
    }
    return textResult(formatJobStatus(job));
  },
});
