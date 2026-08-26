import { z } from "zod";
import { forUser, getServiceClient } from "../db.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";

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
export type ListCreditActivityFn = (
  userId: string,
  limit: number,
) => Promise<readonly CreditActivityRow[]>;

/** How many entries a call returns when it does not say. */
export const DEFAULT_ACTIVITY_LIMIT = 10;

/** The most entries one call may return — the same readability ceiling list_jobs carries. */
export const MAX_ACTIVITY_LIMIT = 50;

/** Read this tenant's project ids and domains, for naming the scope on a spend line. */
export type ListProjectDomainsFn = (userId: string) => Promise<ReadonlyMap<string, string>>;

export interface ListCreditActivityDeps {
  readonly listActivity?: ListCreditActivityFn;
  readonly listDomains?: ListProjectDomainsFn;
}

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
): Promise<readonly CreditActivityRow[]> {
  const { data, error } = await getServiceClient()
    .from("credit_ledger")
    .select("id, delta, kind, reason, tool, project_id, created_at")
    // The tenant guard on an RLS-bypassing client (NEVER #4). Not decorative: proven load-bearing
    // in list-credit-activity.db.test.ts by calling this function with the wrong tenant's id.
    .eq("user_id", userId)
    .neq("delta", 0)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`credit activity list failed: ${error.message}`);
  }
  return (data ?? []) as readonly CreditActivityRow[];
}

/**
 * The tenant's projects as id -> domain, for turning a stored project_id into a name.
 *
 * ARCHIVED PROJECTS ARE INCLUDED, deliberately: the spend happened while the project was tracked,
 * and untracking it later does not make the history unreadable. Filtering them out would push
 * every such row onto the id fallback for no reason.
 *
 * Tenant-scoped through `forUser` (NEVER #4). A failure THROWS rather than degrading to an empty
 * map: an empty map is indistinguishable from "this tenant has no projects", and the whole answer
 * would quietly fall back to printing uuids.
 */
export async function listOwnProjectDomains(userId: string): Promise<ReadonlyMap<string, string>> {
  const { data, error } = await forUser(getServiceClient(), userId).selectOwn(
    "projects",
    "id, domain",
  );
  if (error) {
    throw new Error(`project domain lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { id: string; domain: string }[];
  return new Map(rows.map((row) => [row.id, row.domain]));
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
  if (row.project_id === null) return "no project scope";
  return `project: ${domains.get(row.project_id) ?? row.project_id}`;
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
  rows: readonly CreditActivityRow[],
  domains: ReadonlyMap<string, string> = new Map(),
): string {
  if (rows.length === 0) return NO_ACTIVITY_MESSAGE;
  const lines = rows.map((row) => formatActivityLine(row, domains)).join("\n");
  return (
    `Your ${rows.length} most recent credit entries, newest first:\n${lines}\n` +
    "These are the entries that moved your balance, so a refunded run shows both its charge and " +
    "its refund. Run get_credit_balance for your current total."
  );
}

/** Build the tool. The read port is injectable, so the fast lane drives it with no database. */
export function makeListCreditActivityTool(deps: ListCreditActivityDeps = {}): RegisteredTool {
  const listActivity = deps.listActivity ?? listOwnCreditActivity;
  const listDomains = deps.listDomains ?? listOwnProjectDomains;
  return defineTool({
    name: "list_credit_activity",
    description:
      "List your most recent credit ledger entries, newest first — what was granted, what you " +
      "bought, and which tool charged what, for which project. Costs 0 credits.",
    inputSchema: z.object({
      limit: z
        .int()
        .min(1)
        .max(MAX_ACTIVITY_LIMIT)
        .default(DEFAULT_ACTIVITY_LIMIT)
        .describe(
          `How many recent entries to return (1-${MAX_ACTIVITY_LIMIT}, default ${DEFAULT_ACTIVITY_LIMIT}).`,
        ),
    }),
    handler: async (ctx, { limit }) => {
      // In parallel: the two reads are independent, and the domain map is small (one row per
      // project) however long the requested page is.
      const [rows, domains] = await Promise.all([
        listActivity(ctx.userId, limit),
        listDomains(ctx.userId),
      ]);
      return textResult(formatCreditActivity(rows, domains));
    },
  });
}

/** The production list_credit_activity tool (real DB). */
export const listCreditActivityTool = makeListCreditActivityTool();
