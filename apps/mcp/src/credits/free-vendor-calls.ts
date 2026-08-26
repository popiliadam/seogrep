import { PAID_BALANCE_TOOLS } from "./paid-balance.ts";
import { NOT_CHARGED_SENTENCE } from "./free-refusal.ts";
import type { ToolName } from "./costs.ts";
import { getServiceClient, type ServiceClient } from "../db.ts";

/**
 * THE PER-TENANT CEILING ON VENDOR SPEND NOBODY PAID FOR.
 *
 * WHY THIS EXISTS (measured 2026-08-26). Two rules meet here and, until this file, left a gap
 * between them:
 *
 *   - dfs/budget.ts caps live DataForSEO spend at $3.00/day. That counter (migration 0014
 *     `public.dfs_spend`) has NO `user_id` column and no RLS policies — by design, because it is
 *     vendor accounting rather than tenant data. So the cap is FLEET-WIDE: one number shared by
 *     every customer.
 *   - credits/guard.ts RELEASES the credit reserve whenever the tool body throws, and the
 *     registry then tells the caller "You were not charged". True, and it should stay true.
 *
 * Put together: a failed vendor call costs the CALLER nothing and costs the BUSINESS its full
 * vendor price, because `reserveSpend` books the estimate BEFORE the request and an unsettled
 * reservation keeps counting at that estimate (dfs/budget.ts settleSpend). All fifteen
 * PAID_BALANCE_TOOLS are charge:"handler" tools whose `withCredits` wraps ONLY the vendor-touching
 * body — every gate that refuses without reaching the vendor sits OUTSIDE it — so a failure that
 * releases the reserve is a failure that had already reached, or was about to reach, the vendor.
 *
 * Nothing bounded that. The per-key rate limiter (auth.ts) allows 60 requests a minute, and the
 * measured arithmetic is not close: two failed `ai_visibility_compare` calls book $3.30 against a
 * $3.00 fleet day, after which EVERY customer's paid tools refuse until 00:00 UTC. Zero revenue,
 * zero cost to whoever caused it, and a denial of service against the accounts that did pay. That
 * is the same threat paid-balance.ts was written for, one axis over: that gate asks "may this
 * account spend vendor money at all?", and this one asks "how much of it may this account spend
 * without ever paying for a single call?".
 *
 * WHY A DOLLAR BUDGET AND NOT A CALL COUNT. The first version of this file rationed CALLS (twenty
 * a day). It did not stop the attack it was written for: twenty `ai_visibility_compare` failures
 * are $33 of vendor money, eleven times the whole fleet's daily cap, and the counter would not
 * have reached three. A control whose limit does not bind the thing being spent is a control in
 * name only. The budget below binds DOLLARS, so one expensive tool is bounded exactly as tightly
 * as many cheap ones.
 *
 * WHAT IT COUNTS, AND WHY IT NEEDS NO NEW TABLE. `credit_ledger` already records this event: a
 * `spend_release` row for one of the vendor tools IS a vendor call the account was not charged
 * for. It carries `user_id`, `tool` and `created_at`, it is append-only, and it is read here with
 * a SELECT and nothing else — this counter never writes to the ledger, because the ledger is the
 * money book and an un-charged refusal is not money (constitution NEVER #2).
 *
 * WHAT IT DELIBERATELY DOES NOT COUNT: `spend_commit`. A call the account PAID for is not this
 * gate's business no matter how many of them there are, which is what keeps a heavy legitimate
 * user from ever meeting the budget.
 *
 * HONEST RESIDUAL LIMITS, since a gate is only worth what it actually measures:
 *   - The budget bounds ONE tenant's un-charged spend, not the fleet's. `dfs_spend` carries no
 *     tenant, so the fleet cap remains the only thing that stops total spend — this stops one
 *     account from being the reason it trips.
 *   - It OVER-counts, in the safe direction, for three separate reasons named below (worst-case
 *     pricing, unknown tools, throws that never reached the vendor). Every one of those is a call
 *     that failed, so treating it as spent is the conservative reading.
 *   - It is not atomic. Concurrent calls can read the same total and all pass; the fleet cap's
 *     own advisory lock is what still bounds the absolute total at $3.00.
 */

/**
 * How many dollars of un-charged vendor spend ONE account may accumulate between UTC midnights.
 *
 * WHY $0.50. The fleet cap is $3.00 and it is SHARED. Letting one account burn more than a sixth
 * of the day with calls it never paid for is handing it the power to stop every other account's
 * paid tools; $0.50 leaves the other $2.50 intact. It is NOT a price and changes none: no credit
 * cost, no pack, and not the $3.00 vendor cap itself (constitution NEVER #6).
 */
export const FREE_VENDOR_SPEND_DAILY_USD = 0.5;

/**
 * What ONE un-charged call to each vendor tool is counted at (USD).
 *
 * THESE ARE THE PORTS' OWN RESERVATION ESTIMATES AT EACH TOOL'S CAP — not a second price table.
 * `credit_ledger` records WHICH tool ran but not HOW BIG the call was (no keyword count, no target
 * count), so the size cannot be recovered and the WORST CASE is used. That is the conservative
 * direction and it is deliberate: a gate that guessed low would under-count exactly the calls that
 * cost the most.
 *
 * IT IS A COPY, AND THE COPY IS THE POINT. Importing the dfs ports from here would be a VALUE
 * import reaching `reserveSpend`, and since every tool imports credits/guard.ts, which imports
 * this file, the import-graph gate (paid-balance.graph.test.ts) would then flag EVERY tool in the
 * app as a vendor spender. That gate would be right to: it measures reachability, not intent. The
 * same problem, and the same answer, as tools/serp-devices.ts. What keeps the copy honest is
 * free-vendor-calls.pin.test.ts, which imports the real constants and asserts each number here
 * equals the port's own — a spec may import the money modules freely, because the scanner skips
 * test files. A tariff change in a port therefore turns that spec red instead of silently leaving
 * this table stale.
 *
 * Measured 2026-08-26 against the ports at their caps.
 */
export const FREE_VENDOR_CALL_ESTIMATE_USD: Readonly<Record<string, number>> = {
  // dfs/client.ts estimateKeywordOverviewCostUsd(100) — the schema's `.max(100)` keyword cap.
  research_keywords: 0.036,
  // dfs/ranked-keywords.ts estimateRankedKeywordsCostUsd(RANKED_KEYWORDS_MAX_LIMIT = 1000).
  ranked_keywords: 0.198,
  // dfs/backlinks.ts ESTIMATED_BACKLINK_PROFILE_CALL_USD — three requests per call.
  analyze_backlinks: 0.3,
  // dfs/competitors.ts ESTIMATED_COMPETITOR_COMPARISON_CALL_USD.
  compare_competitors: 0.21618,
  // dfs/keyword-gap.ts ESTIMATED_KEYWORD_GAP_CALL_USD.
  keyword_gap: 0.198,
  // dfs/link-gap.ts ESTIMATED_LINK_GAP_CALL_USD.
  link_gap: 0.09,
  // dfs/lighthouse.ts estimateLighthouseUsd(MAX_SPEED_URLS = 5) — the cheapest member.
  audit_speed: 0.0375,
  // dfs/backlink-changes.ts ESTIMATED_BACKLINK_CHANGES_CALL_USD.
  backlink_changes: 0.111528,
  // dfs/backlink-details.ts ESTIMATED_BACKLINK_DETAILS_CALL_USD.
  backlink_details: 0.1206,
  // dfs/disavow-candidates.ts ESTIMATED_DISAVOW_CANDIDATES_CALL_USD.
  disavow_candidates: 0.1377,
  // dfs/discover-keywords.ts ESTIMATED_DISCOVER_KEYWORDS_CALL_USD.
  discover_keywords: 0.198,
  // dfs/relevant-pages.ts ESTIMATED_RELEVANT_PAGES_CALL_USD.
  my_pages: 0.198,
  // dfs/llm-mentions.ts ESTIMATED_AI_VISIBILITY_CALL_USD.
  ai_visibility: 0.3,
  // dfs/llm-mentions.ts ESTIMATED_AI_VISIBILITY_COMPARE_CALL_USD — ten targets at the row cap.
  // The most expensive call this product can make, and on its own more than three times the
  // budget: ONE failure ends the allowance. That is the tool the budget exists for.
  ai_visibility_compare: 1.65,
  // dfs/serp.ts ESTIMATED_SERP_SNAPSHOT_MAX_USD — MAX_SERP_KEYWORDS at one request each.
  serp_snapshot: 0.3,
};

/** The cheapest un-charged call in the table — what the row ceiling below is derived from. */
const CHEAPEST_CALL_USD = Math.min(...Object.values(FREE_VENDOR_CALL_ESTIMATE_USD));

/** The dearest, used for a `tool` the table does not know (fail-closed — see estimateFor). */
const DEAREST_CALL_USD = Math.max(...Object.values(FREE_VENDOR_CALL_ESTIMATE_USD));

/**
 * How many ledger rows the counter ever needs to read, DERIVED rather than picked.
 *
 * Every counted row costs at least CHEAPEST_CALL_USD, so once this many rows exist the total is
 * necessarily past the budget no matter WHICH rows the database returned — the query has no
 * ORDER BY, and this bound holds for any subset precisely because it uses the minimum. Reading
 * more rows would change no decision.
 */
export const MAX_COUNTED_ROWS = Math.ceil(FREE_VENDOR_SPEND_DAILY_USD / CHEAPEST_CALL_USD) + 1;

/**
 * What one un-charged call to `tool` is counted at. An unrecognised tool counts as the DEAREST
 * call, not as free: the query already filters to PAID_BALANCE_TOOLS, so reaching this branch
 * means a vendor tool shipped without a row here, and the safe reading of "spends vendor money,
 * amount unknown" is the largest amount — never zero.
 */
export function estimateFor(tool: string | null): number {
  if (tool === null) return DEAREST_CALL_USD;
  return FREE_VENDOR_CALL_ESTIMATE_USD[tool] ?? DEAREST_CALL_USD;
}

/** USD are compared at the precision `dfs_spend.actual_usd` stores (numeric(12,6)). */
function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Start of the current UTC day as an ISO timestamp — the window boundary. UTC, not local, so it
 * lines up with the vendor budget's own day (`dfs_spend.spend_day` is `(now() at time zone
 * 'utc')::date`) and with the "resets at 00:00 UTC" sentence the user is told.
 */
export function utcDayStartIso(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  ).toISOString();
}

/**
 * The counter, as a port. Production reads `credit_ledger`; specs inject a fake, so no unit test
 * needs a database (constitution NEVER #5 posture, same shape as dfs/budget.ts SpendLedger).
 *
 * It REJECTS on a read failure — see the fail-closed note on assertFreeVendorSpendBudget.
 */
export interface FreeVendorSpendCounter {
  /** Estimated USD of un-charged vendor calls since 00:00 UTC, over at most `maxRows` rows. */
  spentTodayUsd(userId: string, maxRows: number): Promise<number>;
}

/**
 * The production counter: `credit_ledger` over the service-role client.
 *
 * The `.eq("user_id", …)` filter is load-bearing. This client is service-role and bypasses RLS,
 * so that filter is the ONLY thing making the read tenant-safe (constitution NEVER #4) — the same
 * reason hasPaidBalance says so in the same words.
 *
 * SELECT only. Nothing in this module inserts, updates or deletes a ledger row. It projects
 * `tool` and nothing else: the amount comes from the table above, never from the money columns.
 */
export function createDbFreeVendorSpendCounter(
  client?: ServiceClient,
  /** Injectable clock, so the day boundary is provable on any date rather than only today. */
  now: () => Date = () => new Date(),
): FreeVendorSpendCounter {
  const db = (): ServiceClient => client ?? getServiceClient();
  return {
    async spentTodayUsd(userId, maxRows) {
      const { data, error } = await db()
        .from("credit_ledger")
        .select("tool")
        .eq("user_id", userId)
        .eq("kind", "spend_release")
        .in("tool", [...PAID_BALANCE_TOOLS])
        .gte("created_at", utcDayStartIso(now()))
        .limit(maxRows);
      if (error) {
        throw new Error(`free vendor-spend read failed: ${error.message}`);
      }
      return roundUsd((data ?? []).reduce((sum, row) => sum + estimateFor(row.tool), 0));
    },
  };
}

/**
 * An account has used up its daily budget of vendor spend nobody paid for. TYPED rather than a raw
 * throw so the registry can tell this DELIBERATE refusal apart from a crash and print the sentence
 * verbatim — the generic "failed unexpectedly, quote reference X" would be a lie about a rule
 * working exactly as designed. Mirrors PaidBalanceRequiredError's shape for that reason.
 */
export class FreeVendorSpendLimitError extends Error {
  readonly tool: ToolName;

  constructor(tool: ToolName, message: string) {
    super(message);
    this.name = "FreeVendorSpendLimitError";
    this.tool = tool;
  }
}

/**
 * Narrow an unknown error to the free-vendor-spend refusal. The `name` fallback keeps this true
 * across a duplicated module instance (test isolation, bundling), where `instanceof` alone
 * silently answers false — the same hazard isPaidBalanceRequired guards against.
 */
export function isFreeVendorSpendLimit(error: unknown): error is FreeVendorSpendLimitError {
  return (
    error instanceof FreeVendorSpendLimitError ||
    (error instanceof Error && error.name === "FreeVendorSpendLimitError")
  );
}

/**
 * The refusal the user reads. English (UI-copy language for this product), and honest on the four
 * counts a refusal has to be: WHAT happened, WHY, WHEN it clears, and what it cost. Two things it
 * says that the earlier call-counting version could not:
 *
 *   - the limit is an AMOUNT, not a number of calls, so "but I only ran it twice" is answered
 *     before it is asked;
 *   - one call to an expensive tool can end the allowance by itself, which is true (the dearest
 *     tool is more than three times the budget) and is the single most surprising thing about
 *     this rule. Leaving it out would be the kind of accurate-but-misleading copy that turns a
 *     working rule into a support ticket.
 *
 * It also says the rest of the account is untouched, because the plain reading of a bare refusal
 * is "my account is suspended" — it is not; every other tool and every credit still works.
 */
export function freeVendorSpendLimitMessage(tool: ToolName, budgetUsd: number): string {
  return (
    `"${tool}" is paused for your account until 00:00 UTC. Calls that reach our third-party SEO ` +
    `data provider cost us money even when they fail or come back empty, so each account has a ` +
    `daily allowance of $${budgetUsd.toFixed(2)} worth of such un-charged calls — and yours is ` +
    `now used up for today. This is an allowance of SPEND, not of calls: the most expensive ` +
    `tools cost more than the whole allowance, so a single failed call to one of those can use ` +
    `it up on its own. None of those calls were charged to you, and neither is this refusal. ` +
    `Your credits, your other tools and your data are unaffected. If they were failing for a ` +
    `reason you cannot see, please contact support rather than retrying — the allowance resets ` +
    `at 00:00 UTC.`
  );
}

/**
 * The gate. Runs BEFORE the credit reserve and before the vendor request, for vendor tools only.
 *
 * THE RULE IS `used < budget`, NOT `used + estimate <= budget`, and the difference is deliberate.
 * A legitimate user must always be able to hit at least ONE failure, on any tool, however
 * expensive — otherwise the dearest tool would be refused on a fresh account's very first call,
 * before it had cost anyone anything, which is a broken product rather than a guard. So the
 * allowance is checked as ALREADY SPENT: at $0.00 spent every call passes, and the call that
 * takes the total past the budget is the last one admitted rather than the first one refused.
 *
 * FAIL-CLOSED, on purpose and in both directions. If the counter cannot be read, this refuses: an
 * allowance that cannot be counted is treated as spent, exactly as dfs/budget.ts treats an
 * unreadable spend counter as unaffordable. Answering "$0.00 so far" on a database blip would be
 * a gate in name only — and the account is losing nothing it can measure, because a ledger it
 * cannot read is a ledger the reserve two lines later could not have written to either.
 *
 * Non-vendor tools return immediately: crawls, audits over stored data, reports and Search Console
 * tools spend our own CPU and no vendor money, so there is nothing here to ration.
 */
export async function assertFreeVendorSpendBudget(
  userId: string,
  tool: ToolName,
  counter: FreeVendorSpendCounter,
  budgetUsd: number = FREE_VENDOR_SPEND_DAILY_USD,
): Promise<void> {
  if (!PAID_BALANCE_TOOLS.has(tool)) return;

  let usedUsd: number;
  try {
    usedUsd = await counter.spentTodayUsd(userId, MAX_COUNTED_ROWS);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `Free vendor-spend allowance could not be read for tool "${tool}", so the call was ` +
        `refused (fail-closed). Cause: ${detail}`,
    );
    throw new FreeVendorSpendLimitError(
      tool,
      `"${tool}" could not run: SeoGrep could not check this account's daily allowance for ` +
        `un-charged third-party data calls, and it refuses the call rather than spend on an ` +
        `allowance it cannot measure. This is a fault on our side — please try again shortly. ` +
        NOT_CHARGED_SENTENCE,
    );
  }

  if (usedUsd >= budgetUsd) {
    console.error(
      `Free vendor-spend allowance exhausted: user ${userId} has $${usedUsd.toFixed(4)} of ` +
        `un-charged vendor spend today (budget $${budgetUsd.toFixed(2)}); refusing "${tool}" ` +
        `until 00:00 UTC.`,
    );
    throw new FreeVendorSpendLimitError(tool, freeVendorSpendLimitMessage(tool, budgetUsd));
  }
}
