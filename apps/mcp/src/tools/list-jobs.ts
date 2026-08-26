import { z } from "zod";
import { forUser, getServiceClient, type JobStatus } from "../db.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";

/**
 * list_jobs — the tenant's most recent async job runs, newest first. 0 credits (operator
 * signature 2026-08-25, item 15: three free read-back endpoints).
 *
 * WHY IT EXISTS. `crawl_site` costs 20 credits and hands back exactly one thing: a job id.
 * `pull_gsc_data` returns one too. `get_job_status` is the only way to read either back, and it
 * REQUIRES that id — which is the one thing a plain sentence cannot carry. A customer who asks
 * "how is the crawl I just started doing?" after the id has scrolled out of the conversation had,
 * before this tool, no way to reach a job they had already paid for. Nothing in the 36-tool
 * surface listed jobs.
 *
 * WHAT THE LIST SHOWS, AND WHAT COSTS A SECOND CALL. One line per job: which tool ran, what state
 * it is in, when it was created and finished, its project id when it has one, and the job id to
 * ask about. It shows NO result and NO error text, and that is a size decision with a measured
 * number behind it: one `pull_gsc_data` result row held 973 KB, and a crawl result is of the same
 * order. `jobs.result` is therefore not even PROJECTED by the query below — selecting it would
 * pull tens of megabytes across the wire to render a status word, whether or not the renderer then
 * dropped it. The detail — progress counts, the crawl summary, the failure message — is
 * `get_job_status`'s answer for ONE job, and the list closes by saying so, which is what makes a
 * paid job's result reachable from a sentence that carries no id.
 *
 * TENANT SCOPE. The read goes through `forUser`, so `user_id = the caller` is part of the query by
 * construction (NEVER #4) on a service-role client that bypasses RLS. There is no id INPUT here,
 * so there is no not-found answer to make indistinguishable: a list simply cannot name a row it
 * did not select, and `get_job_status`'s anti-enumeration message is untouched by this file.
 */

/**
 * One row of the list — deliberately NOT `JobRow`. The missing members are the point: `result`
 * (the megabyte) and `error` (the detail) are absent from the TYPE so that a future renderer
 * cannot reach for them without first widening the projection, which is the decision this
 * module's header records.
 */
export interface JobListRow {
  readonly id: string;
  readonly tool: string;
  readonly status: JobStatus;
  readonly project_id: string | null;
  readonly created_at: string;
  readonly finished_at: string | null;
}

/** Read this tenant's most recent jobs, newest first, at most `limit` of them. */
export type ListJobsFn = (userId: string, limit: number) => Promise<readonly JobListRow[]>;

/** How many jobs a call returns when it does not say. Small enough to read in one glance. */
export const DEFAULT_JOB_LIST_LIMIT = 10;

/**
 * The most jobs one call may return. A ceiling rather than a soft hint: the whole design of this
 * tool is that a job list stays readable, and an unbounded list of a busy account's history is
 * the shape that pushes the answer it was asked for off the top of the client's context.
 */
export const MAX_JOB_LIST_LIMIT = 50;

export interface ListJobsDeps {
  readonly listJobs?: ListJobsFn;
}

/**
 * The production read, exported so the DB lane can drive it HEAD-ON. That matters for the same
 * reason `archiveOwnProject` is exported in untrack-project.ts: at the tool level there is no id
 * to refuse, so a tool-level spec cannot tell whether the tenant filter inside is load-bearing.
 * Called directly with one tenant's id against another tenant's rows, it can — and must come back
 * empty.
 *
 * `jobs.result` is NOT in the projection (see the module header). The order is by `created_at`
 * descending with `id` as the tie-break, so two jobs stamped in the same millisecond still come
 * back in a stable order rather than in whatever order the scan produced.
 */
export async function listOwnJobs(
  userId: string,
  limit: number,
): Promise<readonly JobListRow[]> {
  const { data, error } = await forUser(getServiceClient(), userId)
    .selectOwn("jobs", "id, tool, status, project_id, created_at, finished_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`jobs list failed: ${error.message}`);
  }
  // forUser.selectOwn takes a runtime column string, so supabase-js cannot infer the row shape
  // (it falls back to GenericStringError[]); assert the projection this query asked for.
  return (data ?? []) as unknown as readonly JobListRow[];
}

/** The guidance an account with no async runs yet gets, instead of a bare empty list. */
export const NO_JOBS_MESSAGE =
  "You have not run any background jobs yet. crawl_site and pull_gsc_data create them, and they " +
  "return a job_id you can follow with get_job_status.";

/** The trailing `· key value` clauses of one job line, skipping the ones this job has not got. */
function detailsOf(job: JobListRow): string {
  return [
    `created ${job.created_at}`,
    job.finished_at ? `finished ${job.finished_at}` : null,
    job.project_id ? `project_id: ${job.project_id}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/** One job, on one line: what ran, how it went, when, and the id to ask about. */
export function formatJobLine(job: JobListRow): string {
  return `- ${job.tool} — ${job.status} · ${detailsOf(job)} · job_id: ${job.id}`;
}

/**
 * Render the whole answer. Pure, so every wording is pinned in the fast lane while the DB lane
 * proves the read underneath it.
 *
 * The closing sentence is the LOAD-BEARING half of this tool: without it the list is a set of ids
 * with no stated way to turn one into the result the customer paid for.
 */
export function formatJobList(jobs: readonly JobListRow[]): string {
  if (jobs.length === 0) return NO_JOBS_MESSAGE;
  const lines = jobs.map(formatJobLine).join("\n");
  return (
    `Your ${jobs.length} most recent job(s), newest first:\n${lines}\n` +
    "Run get_job_status with one of these job_id values for that job's full result — its crawl " +
    "summary, its progress, or why it failed."
  );
}

/** Build the tool. The read port is injectable, so the fast lane drives it with no database. */
export function makeListJobsTool(deps: ListJobsDeps = {}): RegisteredTool {
  const listJobs = deps.listJobs ?? listOwnJobs;
  return defineTool({
    name: "list_jobs",
    description:
      "List your recent background jobs — crawls and Search Console pulls — newest first, with " +
      "each job_id. Use it when you do not have a job_id to hand. Costs 0 credits.",
    inputSchema: z.object({
      limit: z
        .int()
        .min(1)
        .max(MAX_JOB_LIST_LIMIT)
        .default(DEFAULT_JOB_LIST_LIMIT)
        .describe(
          `How many recent jobs to return (1-${MAX_JOB_LIST_LIMIT}, default ${DEFAULT_JOB_LIST_LIMIT}).`,
        ),
    }),
    handler: async (ctx, { limit }) => {
      const jobs = await listJobs(ctx.userId, limit);
      return textResult(formatJobList(jobs));
    },
  });
}

/** The production list_jobs tool (real DB). */
export const listJobsTool = makeListJobsTool();
