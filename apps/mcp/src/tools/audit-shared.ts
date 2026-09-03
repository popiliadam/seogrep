import { z } from "zod";
import type { ToolName } from "../credits/costs.ts";
import {
  crawlScopeLine,
  findPriorAuditRun,
  loadLatestCrawl,
  writeAuditRun,
  type AuditCrawl,
  type AuditReport,
  type AuditRunWriter,
  type LoadCrawlFn,
  type PriorAuditRunFinder,
} from "../audit/index.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";
import { PreconditionNotMetError } from "./precondition.ts";
import {
  ARCHIVED_PROJECT_MESSAGE,
  loadOwnProject,
  type LoadProjectFn,
} from "./project-target.ts";

/**
 * Shared builder for the three sync audit tools (audit_onpage / audit_tech / audit_schema).
 * Each is a defineTool with the DEFAULT "surface" charge: it reserves at call time, runs
 * the rule engine over the latest crawl, and commits. All three take the same input
 * (project_id) and differ only in which rule engine + formatter they run.
 *
 * Money-safety subtlety: on the "surface" charge path the reserve is opened BEFORE the
 * handler runs, and withCredits COMMITS a handler that RETURNS (only a THROW releases). So
 * "no crawl to audit" must THROW, not return an error result — otherwise the caller would
 * be charged for being told to run crawl_site first. A crawl that exists but yields zero
 * findings is a delivered audit and DOES commit.
 */

/**
 * What one audit produced: the rule engine's STRUCTURAL report, and the text the tool returns.
 *
 * Both halves come out of ONE call so the row and the reply can never describe different runs —
 * a builder that re-ran the engine to get something to store would be storing a second
 * measurement that merely resembles the one the caller was shown.
 */
export interface AuditRendering {
  readonly report: AuditReport;
  readonly text: string;
}

/**
 * Turn a loaded crawl into the tool's output (rule engine + formatter).
 *
 * The three priced audits return an `AuditRendering`, and returning one is what puts a run in
 * `audit_runs`. A bare string stays legal — some callers of this builder have no rule engine and
 * therefore no structural report to record — and such a tool writes no row, which is exactly what
 * "there is nothing structural here to store" should mean. The three that DO produce a report are
 * pinned individually (audit-runs.db.test.ts), because a check inside a shared function proves
 * nothing about which callers reach it.
 */
export type RenderAudit = (crawl: AuditCrawl) => string | AuditRendering;

export interface AuditToolDeps {
  /** The crawl loader (default: the real tenant-scoped loadLatestCrawl). Injected in tests. */
  readonly loadCrawl?: LoadCrawlFn;
  /**
   * The audit-run recorder (default: the real `writeAuditRun`). A PORT for the same reason
   * loadCrawl is one — and so a spec can make the write fail without breaking a database.
   */
  readonly writeRun?: AuditRunWriter;
  /**
   * The tenant-scoped project reader the archive gate uses (default: the real loadOwnProject).
   * A PORT like loadCrawl, because this lane's fast specs are DB-less by construction — the
   * default reaches getServiceClient, which requires the full prod env.
   */
  readonly loadProject?: LoadProjectFn;
  /**
   * The "has this crawl been audited before?" reader (default: the real findPriorAuditRun). A PORT
   * for the same reason the other three are, and the one whose absence is harmless: it feeds a
   * sentence, not the report.
   */
  readonly findPriorRun?: PriorAuditRunFinder;
}

/**
 * `job_id` IS OPTIONAL AND IT IS THE POINT OF THE FIELD (measured live 2026-09-02).
 *
 * Until it existed the audits judged whichever crawl was newest and the caller could not say
 * otherwise. On adstark.com.tr a one-page `include_paths` crawl finished three minutes after a
 * 51-page crawl of the same site; `audit_onpage` charged 30 credits, audited the one page, and
 * the reader had no way to reach the wider crawl that already existed and was already paid for.
 * Omitting the field keeps the old behavior exactly, and the scope sentence now says which crawl
 * that behavior picked.
 */
const inputSchema = z.object({
  project_id: z.uuid().describe("The project to audit (from setup_project / list_projects)."),
  job_id: z
    .uuid()
    .optional()
    .describe(
      "Optional: the crawl_site job to audit (from list_jobs). Omit to audit the project's " +
        "most recent crawl.",
    ),
});

/**
 * The sentence a caller gets for auditing a crawl this tool has already judged — measured live
 * 2026-09-02: two identical calls seconds apart returned byte-for-byte the same text and were
 * charged twice, with nothing anywhere saying the first had happened.
 *
 * `""` when there is no earlier run, so the caller can drop it out of the reply. The stamp is cut
 * to the minute and labelled UTC: a Postgres timestamptz carries microseconds and an offset, and
 * neither belongs in a sentence whose whole job is "you have seen this before".
 */
function repeatNote(name: ToolName, priorAt: string | null): string {
  if (priorAt === null) return "";
  const when = `${priorAt.slice(0, 10)} ${priorAt.slice(11, 16)} UTC`;
  return (
    `Note: this crawl was already audited by ${name} on ${when}. Re-running produces the same ` +
    "report and is charged again."
  );
}

export function makeAuditTool(
  name: ToolName,
  description: string,
  render: RenderAudit,
  deps: AuditToolDeps = {},
): RegisteredTool {
  const loadCrawl = deps.loadCrawl ?? loadLatestCrawl;
  const loadProject = deps.loadProject ?? loadOwnProject;
  const writeRun = deps.writeRun ?? writeAuditRun;
  const findPriorRun = deps.findPriorRun ?? findPriorAuditRun;
  return defineTool({
    name,
    description,
    inputSchema,
    // charge defaults to "surface": reserve -> handler -> commit / release.
    handler: async (ctx, { project_id, job_id }) => {
      // THE ARCHIVE GATE, first — before the crawl read, because an archived project has nothing
      // to audit whatever crawl is stored against it, and "run crawl_site first" would be the
      // wrong instruction for a site the tenant removed (crawl_site refuses it too).
      //
      // It needs its OWN project read: everything below resolves through the succeeded crawl JOB
      // by project_id and never touches `projects`, which is why the shared by-id resolver — the
      // one place this sentence lives — did not reach these three tools. loadOwnProject IS that
      // resolver, not a second one.
      //
      // A project that does not resolve (unknown id, or another tenant's) is deliberately NOT
      // refused here: it falls through to the crawl read exactly as before, so another tenant's
      // ARCHIVED project answers NO_CRAWL_MESSAGE like any other id that is not yours. Answering
      // "that project is archived" would say the row EXISTS — the existence oracle
      // project-target.ts's ordering rule exists to prevent.
      //
      // THROW, and TYPED: withCredits COMMITS a handler that RETURNS, so an errorResult here
      // would charge 30/15/5 credits for a refusal, and the registry keys on the ERROR TYPE to
      // render a designed refusal's sentence verbatim instead of the generic crash sentence.
      const project = await loadProject(ctx.userId, project_id);
      if (project !== null && project.archivedAt !== null) {
        throw new PreconditionNotMetError(ARCHIVED_PROJECT_MESSAGE);
      }

      const load = await loadCrawl(ctx.userId, project_id, job_id);
      if (!load.ok) {
        // THROW so withCredits RELEASES the reserve — no charge when there is nothing to
        // audit. TYPED, because the registry's catch cannot otherwise tell this designed
        // refusal from a crash: it matches PreconditionNotMetError and returns load.error
        // verbatim, where a raw Error is swallowed by the generic "failed unexpectedly,
        // quote reference X" branch (which is what 18 live calls got on 2026-08-09).
        //
        // load.error is deliberately the same sentence for a missing project, another
        // tenant's project and a project never crawled (audit/load.ts). Now that it reaches
        // the user, that uniformity is what keeps project existence unobservable.
        throw new PreconditionNotMetError(load.error);
      }

      // THE SCOPE SENTENCE COMES FIRST, and it is prepended here rather than folded into the three
      // formatters on purpose. It is a fact about the CRAWL — which one, how big — and this is the
      // one place that resolved it; a formatter takes a report and has never been told which job
      // produced it. Prepending also leaves the formatters' byte-for-byte snapshots measuring what
      // they were cut to measure: the rendering of a report, unchanged by this slice.
      const scope = crawlScopeLine(load);
      const rendered = render(load.crawl);
      if (typeof rendered === "string") return textResult(`${scope}\n\n${rendered}`);

      // THE RUN IS RECORDED BEFORE THE REPORT IS HANDED OVER, and the write is not guarded.
      // withCredits commits a handler that RETURNS and releases one that THROWS, so an error
      // that escapes here costs the tenant nothing (audit/runs.ts states the same contract from
      // the other side). Caught and logged instead, the shape would be the house's worst: a
      // charged caller, a delivered report, and a panel that says the audit never ran.
      //
      // The job id is required rather than optional-and-skipped: `CrawlLoad.jobId` is optional
      // only so DB-less fakes keep compiling, and a report with nowhere to point would otherwise
      // become a SILENTLY unrecorded run — the one failure mode this whole write exists to
      // remove. Fail closed, before the reply is built.
      if (load.jobId === undefined) {
        throw new Error(`${name}: crawl load carried no job id — the audit run cannot be recorded`);
      }
      const target = {
        userId: ctx.userId,
        projectId: project_id,
        crawlJobId: load.jobId,
        tool: name,
      };

      // THE REPEAT WARNING, and it is read BEFORE the write below for the obvious reason: after it,
      // the row this call is about to insert would be the row it found. It is keyed to the crawl
      // that was LOADED rather than to the id the caller typed, so what is reported is what was
      // judged. The price is untouched — an operator-signed number this slice has no mandate over
      // — and the sentence names no figure, so it cannot drift from the table.
      const priorAt = await findPriorRun(target);

      await writeRun(target, rendered.report);
      return textResult([scope, repeatNote(name, priorAt), rendered.text].filter(Boolean).join("\n\n"));
    },
  });
}
