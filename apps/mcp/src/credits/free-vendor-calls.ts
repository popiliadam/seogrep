import { PAID_BALANCE_TOOLS } from "./paid-balance.ts";
import { NOT_CHARGED_SENTENCE } from "./free-refusal.ts";
import type { ToolName } from "./costs.ts";
import { getServiceClient, type ServiceClient } from "../db.ts";

/**
 * THE PER-TENANT CEILING ON VENDOR CALLS NOBODY PAID FOR.
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
 * Nothing bounded how many of those one account could produce. The per-key rate limiter (auth.ts)
 * allows 60 requests a minute, and at the Labs keyword-overview tariff ($0.012 per request plus
 * $0.00012 per keyword) roughly 247 single-keyword calls exhaust the whole fleet's $3.00 day — a
 * few minutes of one client stuck in a retry loop, after which EVERY customer's paid tools refuse
 * until 00:00 UTC. Zero revenue, zero cost to whoever caused it, and a denial of service against
 * the accounts that did pay. That is the same threat paid-balance.ts was written for, one axis
 * over: that gate asks "may this account spend vendor money at all?", and this one asks "how much
 * of it may this account spend without ever paying for a single call?".
 *
 * WHAT IT COUNTS, AND WHY IT NEEDS NO NEW TABLE. `credit_ledger` already records exactly this
 * event: a `spend_release` row for one of the vendor tools IS a vendor call the account was not
 * charged for. It carries `user_id`, `tool` and `created_at`, it is append-only, and it is read
 * here with a SELECT and nothing else — this counter never writes to the ledger, because the
 * ledger is the money book and an un-charged refusal is not money (constitution NEVER #2).
 *
 * WHAT IT DELIBERATELY DOES NOT COUNT: `spend_commit`. A call the account PAID for is not this
 * gate's business no matter how many of them there are, which is what keeps a heavy legitimate
 * user from ever meeting the limit.
 *
 * HONEST RESIDUAL LIMITS, since a gate is only worth what it actually measures:
 *   - It counts CALLS, not dollars. Tying a dollar figure to a tenant would need `dfs_spend` to
 *     carry a `user_id`, i.e. a migration and a user identity threaded through fourteen
 *     vendor-agnostic ports. The ceiling is therefore a bound on the NUMBER of free vendor calls,
 *     and the dollars behind one call still differ by endpoint.
 *   - It slightly OVER-counts, in the safe direction. A throw inside the guarded body that never
 *     reached the vendor (the fleet budget already exhausted, a run-record write failing) also
 *     releases the reserve and is counted. Every one of those is a call that failed, so treating
 *     it as one is the conservative reading — and it means a client hammering a broken path is
 *     slowed down rather than encouraged.
 */

/**
 * How many un-charged vendor-tool calls ONE account may make between UTC midnights.
 *
 * NOT A PRICE, and deliberately not derived from one: it changes no credit cost, no pack and no
 * vendor cap (constitution NEVER #6 — the $3.00/day figure in dfs/budget.ts is untouched). It is
 * an abuse ceiling, sized so that no honest use meets it: a failure means the vendor was down or
 * the input could not be served, and twenty of those in one UTC day for one account is already a
 * state worth a support conversation rather than a twenty-first retry.
 */
export const FREE_VENDOR_CALL_DAILY_LIMIT = 20;

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
 * `ceiling` bounds the work: the caller only ever needs to know whether the limit is reached, so
 * the implementation may stop counting there. It REJECTS on a read failure — see the fail-closed
 * note on assertFreeVendorCallBudget.
 */
export interface FreeVendorCallCounter {
  /** Un-charged vendor-tool calls this account has made since 00:00 UTC, counted up to `ceiling`. */
  countToday(userId: string, ceiling: number): Promise<number>;
}

/**
 * The production counter: `credit_ledger` over the service-role client.
 *
 * The `.eq("user_id", …)` filter is load-bearing. This client is service-role and bypasses RLS,
 * so that filter is the ONLY thing making the read tenant-safe (constitution NEVER #4) — the same
 * reason hasPaidBalance says so in the same words.
 *
 * SELECT only. Nothing in this module inserts, updates or deletes a ledger row.
 */
export function createDbFreeVendorCallCounter(
  client?: ServiceClient,
  /** Injectable clock, so the day boundary is provable on any date rather than only today. */
  now: () => Date = () => new Date(),
): FreeVendorCallCounter {
  const db = (): ServiceClient => client ?? getServiceClient();
  return {
    async countToday(userId, ceiling) {
      const { data, error } = await db()
        .from("credit_ledger")
        .select("id")
        .eq("user_id", userId)
        .eq("kind", "spend_release")
        .in("tool", [...PAID_BALANCE_TOOLS])
        .gte("created_at", utcDayStartIso(now()))
        .limit(ceiling);
      if (error) {
        throw new Error(`free vendor-call count failed: ${error.message}`);
      }
      return (data ?? []).length;
    },
  };
}

/**
 * An account has used up its daily allowance of vendor calls nobody paid for. TYPED rather than a
 * raw throw so the registry can tell this DELIBERATE refusal apart from a crash and print the
 * sentence verbatim — the generic "failed unexpectedly, quote reference X" would be a lie about a
 * rule working exactly as designed. Mirrors PaidBalanceRequiredError's shape for that reason.
 */
export class FreeVendorCallLimitError extends Error {
  readonly tool: ToolName;

  constructor(tool: ToolName, message: string) {
    super(message);
    this.name = "FreeVendorCallLimitError";
    this.tool = tool;
  }
}

/**
 * Narrow an unknown error to the free-vendor-call refusal. The `name` fallback keeps this true
 * across a duplicated module instance (test isolation, bundling), where `instanceof` alone
 * silently answers false — the same hazard isPaidBalanceRequired guards against.
 */
export function isFreeVendorCallLimit(error: unknown): error is FreeVendorCallLimitError {
  return (
    error instanceof FreeVendorCallLimitError ||
    (error instanceof Error && error.name === "FreeVendorCallLimitError")
  );
}

/**
 * The refusal the user reads. English (UI-copy language for this product), and honest on the four
 * counts a refusal has to be: WHAT happened, WHY, WHEN it clears, and what it cost. It also says
 * the rest of the account is untouched, because the plain reading of a bare refusal is "my
 * account is suspended" — it is not; every other tool and every credit still works.
 */
export function freeVendorCallLimitMessage(tool: ToolName, limit: number): string {
  return (
    `"${tool}" is paused for your account until 00:00 UTC. Calls that reach our third-party SEO ` +
    `data provider cost us money even when they fail or come back empty, so each account may ` +
    `make ${limit} such un-charged calls per day, and yours has now used all ${limit} today. ` +
    `None of them were charged to you, and neither is this refusal. Your credits, your other ` +
    `tools and your data are unaffected. If those calls were failing for a reason you cannot ` +
    `see, please contact support rather than retrying — the allowance resets at 00:00 UTC.`
  );
}

/**
 * The gate. Runs BEFORE the credit reserve and before the vendor request, for vendor tools only.
 *
 * FAIL-CLOSED, on purpose and in both directions. If the counter cannot be read, this refuses:
 * an allowance that cannot be counted is treated as spent, exactly as dfs/budget.ts treats an
 * unreadable spend counter as unaffordable. Answering "0 so far" on a database blip would be a
 * gate in name only — and the account is losing nothing it can measure, because a ledger it
 * cannot read is a ledger the reserve two lines later could not have written to either.
 *
 * Non-vendor tools return immediately: crawls, audits over stored data, reports and Search Console
 * tools spend our own CPU and no vendor money, so there is nothing here to ration.
 */
export async function assertFreeVendorCallBudget(
  userId: string,
  tool: ToolName,
  counter: FreeVendorCallCounter,
  limit: number = FREE_VENDOR_CALL_DAILY_LIMIT,
): Promise<void> {
  if (!PAID_BALANCE_TOOLS.has(tool)) return;

  let used: number;
  try {
    used = await counter.countToday(userId, limit);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `Free vendor-call allowance could not be counted for tool "${tool}", so the call was ` +
        `refused (fail-closed). Cause: ${detail}`,
    );
    throw new FreeVendorCallLimitError(
      tool,
      `"${tool}" could not run: SeoGrep could not check this account's daily allowance for ` +
        `un-charged third-party data calls, and it refuses the call rather than spend on an ` +
        `allowance it cannot count. This is a fault on our side — please try again shortly. ` +
        NOT_CHARGED_SENTENCE,
    );
  }

  if (used >= limit) {
    console.error(
      `Free vendor-call allowance exhausted: user ${userId} has ${used} un-charged vendor calls ` +
        `today (limit ${limit}); refusing "${tool}" until 00:00 UTC.`,
    );
    throw new FreeVendorCallLimitError(tool, freeVendorCallLimitMessage(tool, limit));
  }
}
