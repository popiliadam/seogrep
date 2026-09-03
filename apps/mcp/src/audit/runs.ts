import { getServiceClient, type Database, type Json } from "../db.ts";
import type { OnpageReport } from "./rules/onpage.ts";
import type { SchemaReport } from "./rules/schema.ts";
import type { TechReport } from "./rules/tech.ts";

/**
 * The AUDIT RUN LEDGER (migration 0024): one row per audit that actually ran.
 *
 * The three audits were sync and left NO TRACE — the report existed only in the reply the
 * caller happened to be reading. The panel could not show that an audit had ever run, and
 * "what changed since last week" was unanswerable for a tool the tenant had paid for. This
 * module is the write half; `apps/web/lib/projects/audits.ts` is the read half.
 *
 * WHAT IS STORED IS THE STRUCTURAL REPORT, not the rendered text. The text is prose for a
 * human and its wording is free to change; the numbers underneath are what a second surface
 * can query. Storing the text would force the panel to parse sentences to learn how many
 * pages carried a finding.
 */

/** The rule engines' outputs — the only three things `audit_runs.report` ever holds. */
export type AuditReport = OnpageReport | TechReport | SchemaReport;

/** Everything one `audit_runs` row is keyed by. Every field but `tool` is a tenant key. */
export interface AuditRunTarget {
  readonly userId: string;
  readonly projectId: string;
  /** The SUCCEEDED `crawl_site` job the audit read (NOT NULL in 0024). */
  readonly crawlJobId: string;
  /** One of audit_onpage / audit_tech / audit_schema — the CHECK constraint's vocabulary. */
  readonly tool: string;
}

/** The write itself — injectable so a spec can make it fail without breaking a database. */
export type AuditRunWriter = (target: AuditRunTarget, report: AuditReport) => Promise<void>;

/**
 * The READ half of the same key: when did this tool last audit THIS crawl, if ever? `null` means
 * never — or that the question could not be answered, which `findPriorAuditRun` explains.
 */
export type PriorAuditRunFinder = (target: AuditRunTarget) => Promise<string | null>;

/**
 * When this exact audit last ran over this exact crawl.
 *
 * FAIL-OPEN, and that is the deliberate OPPOSITE of `writeAuditRun` below. The write must throw:
 * losing the record of a delivered audit is the failure the table exists to prevent. This read
 * produces a COURTESY SENTENCE, and a throw would send `withCredits` down its release path and
 * refuse an audit the tenant asked for and the engine could have delivered. A warning that cannot
 * be computed is a missing warning, never a missing report — so a failed lookup is logged and
 * answered `null`, and the reply is exactly what it was before this note existed.
 *
 * THE WHOLE STATEMENT IS INSIDE THE `try`, NOT JUST THE AWAIT, and the difference is a measured
 * one. A guard that only reads PostgREST's `error` field covers failures arriving THROUGH the
 * promise and nothing else; building the statement can throw first. It did: `audit-schema.test.ts`
 * fakes `getServiceClient` down to the single method withCredits needs (`rpc`), because the money
 * is all that spec measures — so `.from(...)` was a SYNCHRONOUS TypeError on the delivered-audit
 * path, and a fail-open function that had never been tested against an unusable client took a
 * green ledger spec red the moment two branches met. A client this function cannot use is the
 * plainest case of "the question cannot be answered", which is the case it already promised to
 * survive.
 *
 * Tenant-scoped on the RLS-bypassing service client for the usual reason (NEVER #4): all four key
 * columns are filtered, so it can only ever find the caller's own earlier run.
 */
export async function findPriorAuditRun(target: AuditRunTarget): Promise<string | null> {
  try {
    const { data, error } = await getServiceClient()
      .from("audit_runs")
      .select("created_at")
      .eq("user_id", target.userId)
      .eq("project_id", target.projectId)
      .eq("crawl_job_id", target.crawlJobId)
      .eq("tool", target.tool)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error(`${target.tool}: prior audit_runs lookup failed (${error.message})`);
      return null;
    }
    return data?.created_at ?? null;
  } catch (cause) {
    console.error(
      `${target.tool}: prior audit_runs lookup could not run (${String(cause)}); ` +
        "the report is unaffected",
    );
    return null;
  }
}

type AuditRunInsert = Database["public"]["Tables"]["audit_runs"]["Insert"];

/**
 * The report as a `jsonb` value.
 *
 * A round trip rather than a cast, and it does real work: `Json` demands the implicit index
 * signature a TS interface never has, so no amount of typing makes `OnpageReport` assignable to
 * it, and a bare `as unknown as Json` would ALSO accept a report that carried a Date, a
 * function or an `undefined` — values that either change shape or vanish on the wire, silently.
 * `JSON.stringify` is exactly the transformation PostgREST is about to apply anyway; doing it
 * here means what is type-checked is what is stored. The reports are small (bounded by the
 * crawler's 100-page cap), so the copy costs nothing worth measuring.
 */
export function auditReportToJson(report: AuditReport): Json {
  return JSON.parse(JSON.stringify(report)) as Json;
}

/**
 * Record one audit run.
 *
 * FAIL-CLOSED, and that is the whole contract (crawl-pages.ts's rule, applied to the sync
 * path): a PostgREST error is re-thrown, never logged and swallowed. The caller runs inside
 * `withCredits`, which COMMITS a handler that returns and RELEASES one that throws — so
 * throwing means the tenant pays nothing for an audit whose record was lost. Swallowing would
 * produce the opposite and worse shape: a charged tenant, a returned report, and a panel that
 * will forever say the audit never ran.
 */
export async function writeAuditRun(target: AuditRunTarget, report: AuditReport): Promise<void> {
  const row: AuditRunInsert = {
    user_id: target.userId,
    project_id: target.projectId,
    crawl_job_id: target.crawlJobId,
    tool: target.tool,
    report: auditReportToJson(report),
  };
  const { error } = await getServiceClient().from("audit_runs").insert(row);
  if (error) {
    throw new Error(`${target.tool}: audit_runs write failed (${error.message})`);
  }
}
