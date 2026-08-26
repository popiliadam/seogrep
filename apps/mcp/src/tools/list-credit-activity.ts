import { z } from "zod";
import { getServiceClient } from "../db.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";
import {
  listOwnProjectDomains,
  projectLabel,
  type ListProjectDomainsFn,
} from "./project-domains.ts";

/**
 * list_credit_activity — the tenant's most recent credit-ledger movements, newest first.
 * 0 credits (operator signature 2026-08-25, item 15: three free read-back endpoints).
 *
 * WHY IT EXISTS. Spend history lived ONLY in the /app/usage panel. A customer working inside an
 * MCP client could read their BALANCE (get_credit_balance) but had no way to see what moved it —
 * which tool took the credits, when, and whether anything came back. This is the third of the
 * three read-backs: the product wrote rows the customer paid for and offered no way to read them.
 *
 * IT IS READ-ONLY, AND THAT IS A CONSTITUTIONAL POINT, NOT A HABIT. `credit_ledger` is append-only
 * (NEVER #2) and the balance derives ONLY from the sum of its rows. Nothing in this file writes,
 * updates or deletes a ledger row; the module imports no RPC and no write path.
 *
 * ## What is shown, and why it is not every row
 *
 * A spend is a PAIR of rows, not one (migrations 0002 / 0005 / 0011, and apps/web/lib/spend.ts
 * derives the same rule for the panel):
 *
 *   spend_reserve   delta < 0   the row that actually moves the balance
 *   spend_commit    delta = 0   a settlement MARKER — a DB CHECK forces delta to 0
 *   spend_release   delta > 0   the reserve refunded in full
 *
 * Listing raw rows would answer "what did this crawl cost me?" with a -20 line followed by a 0
 * line for the same tool a second later, which reads as a bug rather than as bookkeeping. So the
 * query keeps only rows that MOVED the balance (`delta <> 0`), which is exactly the set whose sum
 * IS the balance. The rule is expressed as the arithmetic rather than as a list of kind names on
 * purpose: it stays true for a kind nobody has invented yet, and it cannot silently drop a kind
 * that does move credits.
 *
 * The consequence is a property worth stating, and the answer states it: the numbers in this list
 * are the numbers that changed the balance, so a refunded job shows BOTH its debit and its refund
 * rather than quietly disappearing.
 *
 * This is the useful subset, NOT a port of /app/usage: no chart, no per-day aggregation, no
 * totals. The running total is get_credit_balance's answer and stays there.
 *
 * TENANT SCOPE. Every query below filters on `user_id = the caller` (NEVER #4) on a service-role
 * client that bypasses RLS. That filter is written out by hand rather than inherited from
 * `forUser` — see listOwnCreditActivity for why it cannot be, and for the head-on spec that proves
 * it load-bearing. There is no id INPUT here, so there is no not-found answer to make
 * indistinguishable: a list cannot name a row it did not select.
 */

/** One balance-moving ledger row, as this tool reads it. */
export interface CreditActivityRow {
  readonly id: number;
  readonly delta: number;
  readonly kind: string;
  readonly reason: string | null;
  readonly tool: string | null;
  /**
   * The project this spend was for (migration 0033), or null when the call had no project scope.
   * NULL IS AN ANSWER — a keyword set, a seed, a subject that is nobody's tracked site — and the
   * line says so in words rather than leaving a blank that reads as an omission.
   */
  readonly project_id: string | null;
  readonly created_at: string;
}

/** Read this tenant's most recent balance-moving ledger rows, newest first. */
/**
 * One page of entries AND how many balance-moving rows the tenant has in total.
 *
 * Measured live on 2026-08-26: the tenant had 512 and a 50-entry call answered "Your 50 most
 * recent credit entries" with no hint that 462 more existed. True, and read as the whole ledger.
 */
export interface CreditActivityPage {
  readonly rows: readonly CreditActivityRow[];
  readonly total: number;
}

export type ListCreditActivityFn = (
  userId: string,
  limit: number,
  beforeId?: number,
) => Promise<CreditActivityPage>;

/**
 * Net credits a tenant has spent, per tool, across the WHOLE ledger.
 *
 * WHY THE TOOL NEEDED THIS (measured 2026-08-26). Asked "which tools did my credits go to?", the
 * product could not answer: 512 balance-moving entries, 50 per call, and no total anywhere. The
 * numbers existed — they had to be computed straight out of the database by hand, which is
 * exactly what a customer cannot do. One line of arithmetic answers the question the list was
 * being read to answer.
 *
 * NET, not gross: a reserve that was released costs nothing, so `audit_onpage` reads 720 rather
 * than the 1080 its 36 charges add up to. That is the number that left the balance.
 */
export interface SpendSummary {
  /** Tools by net spend, largest first. A tool whose spend nets to zero is left out. */
  readonly byTool: readonly { readonly tool: string; readonly net: number }[];
  readonly totalNet: number;
  /** How many spend rows the arithmetic actually saw, and how many exist. Equal = complete. */
  readonly rowsCovered: number;
  readonly rowsTotal: number;
}

export type SummarizeSpendFn = (userId: string) => Promise<SpendSummary>;

/** How many entries a call returns when it does not say. */
export const DEFAULT_ACTIVITY_LIMIT = 10;

/** The most entries one call may return — the same readability ceiling list_jobs carries. */
export const MAX_ACTIVITY_LIMIT = 50;

export interface ListCreditActivityDeps {
  readonly listActivity?: ListCreditActivityFn;
  readonly listDomains?: ListProjectDomainsFn;
  readonly summarizeSpend?: SummarizeSpendFn;
}

/**
 * The most spend rows one summary will read. A CEILING WITH A VOICE: when the tenant has more,
 * the answer says the total covers the most recent N of M rather than presenting a partial sum as
 * the whole truth. Silent truncation is the failure this whole review keeps finding.
 */
export const SUMMARY_ROW_CAP = 2_000;

/**
 * The production read, exported so the DB lane can drive it HEAD-ON — at the tool level there is
 * no id to refuse, so only a direct call with one tenant's id against another tenant's rows can
 * show that the `.eq("user_id", …)` below is load-bearing.
 *
 * WHY IT DOES NOT GO THROUGH `forUser`, unlike every other list in this directory. `selectOwn`
 * takes a `TenantTable` — a UNION of every tenant-owned table — so the builder it hands back only
 * admits filters on columns ALL of them share (`id`, `user_id`, `created_at`). `delta` belongs to
 * this table alone, so `.neq("delta", 0)` does not type through it. The tenant guard is therefore
 * written out here, exactly as `creditBalance` (db.ts) and `archiveOwnProject`
 * (untrack-project.ts) write theirs: this client is service-role and bypasses RLS, so this one
 * `.eq` is the whole of NEVER #4 for this query — which is precisely why the DB lane calls this
 * function head-on with a mismatched tenant id and asserts it comes back with none of the other
 * tenant's rows.
 *
 * `.neq("delta", 0)` is the zero-delta settlement marker being left out (see the header). The
 * order is by `created_at` descending with the ledger's own monotonic `id` as the tie-break, which
 * matters more here than elsewhere: a reserve and its release can land in the same millisecond.
 */
export async function listOwnCreditActivity(
  userId: string,
  limit: number,
  beforeId?: number,
): Promise<CreditActivityPage> {
  const query = getServiceClient()
    .from("credit_ledger")
    .select("id, delta, kind, reason, tool, project_id, created_at", { count: "exact" })
    // The tenant guard on an RLS-bypassing client (NEVER #4). Not decorative: proven load-bearing
    // in list-credit-activity.db.test.ts by calling this function with the wrong tenant's id.
    .eq("user_id", userId)
    .neq("delta", 0);
  // THE CURSOR IS THE ID, NOT THE TIMESTAMP, and that is the whole reason older entries can now
  // be reached at all. This module's own header warns that a reserve and its release can land in
  // the same millisecond; a `created_at < …` cursor would then either skip a row or repeat one.
  // `id` is the ledger's monotonic insert order on an append-only table, so it is exact.
  const paged = beforeId === undefined ? query : query.lt("id", beforeId);
  const { data, error, count } = await paged
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`credit activity list failed: ${error.message}`);
  }
  return { rows: (data ?? []) as readonly CreditActivityRow[], total: count ?? 0 };
}

/**
 * The production summary read: every spend row's tool and delta, summed in memory.
 *
 * IN MEMORY RATHER THAN IN SQL, deliberately and for now: a `group by` would mean a new RPC,
 * which means a migration, and the arithmetic over a few thousand two-column rows is nothing.
 * `SUMMARY_ROW_CAP` bounds it, `rowsCovered` vs `rowsTotal` reports whether the bound bit, and
 * the sentence changes when it did — a partial total that calls itself complete is worse than no
 * total at all.
 *
 * Tenant guard written out by hand for the same reason `listOwnCreditActivity` writes it out
 * (NEVER #4, service-role client), and driven head-on by the DB lane.
 */
export async function summarizeOwnSpend(userId: string): Promise<SpendSummary> {
  const { data, error, count } = await getServiceClient()
    .from("credit_ledger")
    .select("tool, delta", { count: "exact" })
    .eq("user_id", userId)
    .in("kind", ["spend_reserve", "spend_release"])
    .order("id", { ascending: false })
    .limit(SUMMARY_ROW_CAP);
  if (error) {
    throw new Error(`credit spend summary failed: ${error.message}`);
  }
  const rows = (data ?? []) as readonly { tool: string | null; delta: number }[];
  return summarizeSpendRows(rows, count ?? rows.length);
}

/**
 * The arithmetic, pure — so the wording and the netting are pinned without a database.
 *
 * A reserve is negative and its release positive, so NET is simply `-sum(delta)` per tool. Tools
 * whose spend nets to zero (every call refunded) are dropped: a `0` line answers "what did this
 * cost me" with a number that is true and useless, and the list is read for the ones that cost
 * something. `null` tool (a grant has none, but so could a future kind) is skipped rather than
 * bucketed under a made-up name.
 */
export function summarizeSpendRows(
  rows: readonly { tool: string | null; delta: number }[],
  rowsTotal: number,
): SpendSummary {
  const nets = new Map<string, number>();
  for (const row of rows) {
    if (row.tool === null) continue;
    nets.set(row.tool, (nets.get(row.tool) ?? 0) - row.delta);
  }
  const byTool = [...nets.entries()]
    .map(([tool, net]) => ({ tool, net }))
    .filter((entry) => entry.net !== 0)
    .sort((a, b) => b.net - a.net || a.tool.localeCompare(b.tool));
  return {
    byTool,
    totalNet: byTool.reduce((sum, entry) => sum + entry.net, 0),
    rowsCovered: rows.length,
    rowsTotal,
  };
}

/** How many tools the summary line names before it collapses the rest into one number. */
export const SUMMARY_TOP_TOOLS = 5;

/**
 * The one-line answer to "where did my credits go?".
 *
 * ONE LINE, not a table. The question is real and was unanswerable, but a 24-row breakdown
 * printed on every call would bury the entries the tool exists to list. The top five carry the
 * shape of the spend and the tail is named as a number, so nothing is hidden and nothing is
 * repeated at length.
 */
export function formatSpendSummary(summary: SpendSummary): string {
  if (summary.byTool.length === 0) return "";
  const top = summary.byTool.slice(0, SUMMARY_TOP_TOOLS);
  const rest = summary.byTool.slice(SUMMARY_TOP_TOOLS);
  const restNet = rest.reduce((sum, entry) => sum + entry.net, 0);
  const tail =
    rest.length === 0
      ? ""
      : ` — ${restNet} across ${rest.length} other tool${rest.length === 1 ? "" : "s"}`;
  // WHEN THE CAP BIT, SAY SO. Anything else would present a partial sum as the whole ledger.
  const scope =
    summary.rowsCovered < summary.rowsTotal
      ? ` (the most recent ${summary.rowsCovered} of ${summary.rowsTotal} spend entries)`
      : "";
  return (
    `\nSpent so far${scope}: ${summary.totalNet} credits, net of refunds, across ` +
    `${summary.byTool.length} tool${summary.byTool.length === 1 ? "" : "s"}. Top: ` +
    `${top.map((entry) => `${entry.tool} ${entry.net}`).join(" · ")}${tail}.`
  );
}

/**
 * Plain-English names for the ledger's own `kind` values (migration 0002's CHECK list).
 *
 * `spend_reserve` is the row a customer means by "charge" — it is the one that takes the credits —
 * and `spend_release` is the refund of one. `spend_commit` never reaches here: it is the
 * zero-delta marker the query already excluded.
 *
 * An UNKNOWN kind falls through to its raw value rather than to a generic word. A future kind
 * appearing as `some_new_kind` is ugly and TRUE; showing it as "activity" would hide a movement of
 * the customer's credits behind a label that says nothing.
 */
const KIND_LABELS: Readonly<Record<string, string>> = {
  grant: "grant",
  purchase: "purchase",
  spend_reserve: "charge",
  spend_release: "refund",
  adjust: "adjustment",
};

/** The word a customer reads for one ledger `kind`. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/** A signed credit amount, with the `+` a positive number does not carry on its own. */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

/** The ledger kinds for which "which project?" is a question anybody actually has. */
const SPEND_KINDS: ReadonlySet<string> = new Set(["spend_reserve", "spend_release"]);

/**
 * WHEN THE LEDGER LEARNED TO CARRY A PROJECT — the moment the deploy that WRITES `project_id`
 * went live (2026-08-26 17:48 UTC, `deploy-mcp` on `642804c`; migration 0033 had landed twelve
 * minutes earlier).
 *
 * WHY A CONSTANT AND NOT A JOIN. A row written before that deploy has `project_id = null` for one
 * reason and one reason only: THE COLUMN COULD NOT BE WRITTEN. A row written after it means
 * something completely different by the same null — the call genuinely had no project scope
 * (a keyword set, a seed, a subject that is nobody's site). One value, two meanings, and only the
 * clock can tell them apart, because the ledger is APPEND-ONLY: those 778 rows can never be
 * backfilled (0002 blocks UPDATE with a trigger AND revokes it from every role), so the ambiguity
 * is permanent and has to be answered at read time, forever.
 *
 * MEASURED, 2026-08-26. `list_credit_activity` printed `no project scope` for a `crawl_site`
 * charge whose job row names `noraninsaat.com`. That call HAD a project. Printing the words "no
 * project scope" for it is the exact failure this tour exists to find — an unrecorded value
 * presented as a positive finding — and it is the same shape as "unreported, never as a zero".
 */
export const LEDGER_PROJECT_SCOPE_SINCE_MS = Date.parse("2026-08-26T17:48:00.000Z");

/** What a null `project_id` means for a row written at `createdAt`. */
export function nullScopeReason(createdAt: string): "not_recorded" | "no_scope" {
  const at = Date.parse(createdAt);
  // An unparseable stamp takes the WEAKER claim. "Not recorded" concedes ignorance; "no project
  // scope" asserts a fact about the customer's call, and a fact must not rest on a date nobody
  // could read.
  return Number.isNaN(at) || at < LEDGER_PROJECT_SCOPE_SINCE_MS ? "not_recorded" : "no_scope";
}

/** The words for each of those two, and the sentence that explains the first one once. */
export const NOT_RECORDED_LABEL = "project not recorded";
export const NO_SCOPE_LABEL = "no project scope";
export const NOT_RECORDED_NOTE =
  " Entries marked \"project not recorded\" are older than the day the ledger began storing which " +
  "project a spend was for, so their scope is unknown rather than absent — the ledger is " +
  "append-only, so they cannot be filled in afterwards. Newer entries say \"no project scope\" " +
  "only when the call really had no site.";

/**
 * The scope clause for one line, or null when the row is not a spend.
 *
 * Three outcomes, and the middle one is the point (migration 0033):
 *   • a known project  -> its domain
 *   • no project scope -> those words, printed. A blank would read as "the tool forgot" rather
 *     than as "there was no site", and it is the ANSWER for that row, not an absence.
 *   • an id the tenant no longer has -> the id itself. 0033 keeps no foreign key on purpose, so
 *     this is reachable, and an id is TRUE where a shrug is not.
 *
 * Grants and purchases get nothing: they are not spends, nobody asks which project a grant was
 * for, and annotating every row would bury the ones where the question is real.
 */
export function scopeClause(
  row: CreditActivityRow,
  domains: ReadonlyMap<string, string>,
): string | null {
  if (!SPEND_KINDS.has(row.kind)) return null;
  if (row.project_id === null) {
    // Two different nulls, two different sentences — see LEDGER_PROJECT_SCOPE_SINCE_MS. This is
    // the one place list_credit_activity does NOT share list_jobs' wording, and the reason is that
    // the two tables are not in the same position: `jobs.project_id` has existed since the table
    // did, so a null there has only ever had one meaning.
    return nullScopeReason(row.created_at) === "not_recorded" ? NOT_RECORDED_LABEL : NO_SCOPE_LABEL;
  }
  // A known project (or, for an id the tenant no longer has, the id itself) — the SAME answer
  // list_jobs gives, from the same function, so two surfaces cannot describe one project
  // differently.
  return `project: ${projectLabel(row.project_id, domains)}`;
}

/** One ledger entry, on one line. */
export function formatActivityLine(
  row: CreditActivityRow,
  domains: ReadonlyMap<string, string> = new Map(),
): string {
  const parts = [
    `- ${row.created_at}`,
    `${formatDelta(row.delta)} credits`,
    kindLabel(row.kind),
    row.tool,
    scopeClause(row, domains),
    row.reason,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/** The guidance an account with no balance-moving ledger rows gets, instead of an empty list. */
export const NO_ACTIVITY_MESSAGE =
  "No credit activity yet. Your ledger records credits granted, credits bought, and credits a " +
  "tool charged — nothing has moved your balance so far.";

/**
 * Render the whole answer. Pure, so every wording is pinned in the fast lane while the DB lane
 * proves the read underneath it.
 */
export function formatCreditActivity(
  page: CreditActivityPage,
  domains: ReadonlyMap<string, string> = new Map(),
  summary?: SpendSummary,
): string {
  const { rows, total } = page;
  if (rows.length === 0) return NO_ACTIVITY_MESSAGE;
  const lines = rows.map((row) => formatActivityLine(row, domains)).join("\n");
  // WHAT WAS LEFT OUT, AND HOW TO REACH IT. Measured 2026-08-26: 512 balance-moving rows behind a
  // 50-entry answer whose advice was "raise `limit` (max 50)" — TO A CALLER ALREADY AT 50. The
  // sentence was true about the count and a dead end about the remedy: 462 entries with no way to
  // reach them. The remedy is now a cursor, and it is named with the value to pass.
  const oldest = rows[rows.length - 1]?.id;
  const remaining = total - rows.length;
  const cut =
    remaining > 0 && oldest !== undefined
      ? ` ${remaining} older entr${remaining === 1 ? "y" : "ies"} not shown — call again with \`before_id: ${oldest}\` for the next page.`
      : "";
  // The "not recorded" sentence appears ONLY when such a row is on screen, and once. A permanent
  // footnote about a permanent historical quirk would be read past within a week.
  const explainsNotRecorded = rows.some(
    (row) => scopeClause(row, domains) === NOT_RECORDED_LABEL,
  )
    ? NOT_RECORDED_NOTE
    : "";
  return (
    `Your ${rows.length} most recent credit entries of ${total}, newest first:\n${lines}\n` +
    "These are the entries that moved your balance, so a refunded run shows both its charge and " +
    `its refund. Run get_credit_balance for your current total.${cut}${explainsNotRecorded}` +
    `${summary === undefined ? "" : formatSpendSummary(summary)}`
  );
}

/** Build the tool. The read port is injectable, so the fast lane drives it with no database. */
export function makeListCreditActivityTool(deps: ListCreditActivityDeps = {}): RegisteredTool {
  const listActivity = deps.listActivity ?? listOwnCreditActivity;
  const listDomains = deps.listDomains ?? listOwnProjectDomains;
  const summarizeSpend = deps.summarizeSpend ?? summarizeOwnSpend;
  return defineTool({
    name: "list_credit_activity",
    description:
      "List your credit ledger entries, newest first — what each tool charged, for which " +
      "project, plus net spend per tool. Pages with before_id. Costs 0 credits.",
    inputSchema: z.object({
      limit: z
        .int()
        .min(1)
        .max(MAX_ACTIVITY_LIMIT)
        .default(DEFAULT_ACTIVITY_LIMIT)
        .describe(
          `How many recent entries to return (1-${MAX_ACTIVITY_LIMIT}, default ${DEFAULT_ACTIVITY_LIMIT}).`,
        ),
      before_id: z
        .int()
        .positive()
        .optional()
        .describe(
          "Paging cursor: return only entries older than this entry id. Each answer names the " +
            "value to pass for the next page. Omit for the newest entries.",
        ),
    }),
    handler: async (ctx, { limit, before_id }) => {
      // In parallel: the three reads are independent. The domain map is small (one row per
      // project) however long the requested page is, and the summary is two columns.
      const [page, domains, summary] = await Promise.all([
        listActivity(ctx.userId, limit, before_id),
        listDomains(ctx.userId),
        summarizeSpend(ctx.userId),
      ]);
      return textResult(formatCreditActivity(page, domains, summary));
    },
  });
}

/** The production list_credit_activity tool (real DB). */
export const listCreditActivityTool = makeListCreditActivityTool();
