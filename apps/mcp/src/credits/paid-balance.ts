import type { ToolName } from "./costs.ts";
import { getServiceClient } from "../db.ts";

/**
 * The paid-balance gate: which tools may spend REAL VENDOR MONEY, and who is allowed to.
 *
 * WHY THIS EXISTS (operator decision 2026-08-06). Signup is open self-serve and every verified
 * account is granted trial credits. The mailbox fingerprint behind that grant is blind to a
 * catch-all domain, so someone with their own domain can mint accounts without limit. The money
 * loss is capped by the daily DataForSEO budget — that is NOT the threat. The threat is that a
 * farm burning the day's vendor budget by morning makes the DataForSEO tools REFUSE for the
 * customers who paid for them that day: a denial of service against paying users at zero cost to
 * the attacker. Rather than shrink the trial (a farm answers by minting more accounts; only the
 * honest user is punished), the surface that CARRIES the risk is cut off from trial credits.
 *
 * The gate is deliberately narrow: it lists exactly the tools that spend VENDOR money. Crawl,
 * report and Search Console tools are untouched, because their marginal cost is our own CPU — and
 * so are audit_onpage / audit_tech / audit_schema / audit_content, which read stored measurements.
 * `audit_speed` is the one audit that is NOT in that company: despite the family name it buys a
 * Lighthouse run per page from DataForSEO, so it belongs on the paid side of the line.
 *
 * WHERE IT RUNS: credits/guard.ts, BEFORE the reserve. A refused call therefore burns zero
 * credits and writes no ledger row at all — refusing after a reserve would need a refund path,
 * and the cheapest refund is the one that never has to happen.
 */

/**
 * Tools that require a paid balance — the vendor-cost surface, keyed by TOOL NAME.
 *
 * Keyed by name, NOT by a flag the caller passes: withCredits is reached from many places (the
 * handlers below, the registry's "surface" path, and the async worker), and a flag is a thing a
 * future tool can forget to set. A name in this table is consulted no matter which path the call
 * arrives on, so the gate fails CLOSED. paid-balance.test.ts pins the exact membership, and
 * paid-balance.graph.test.ts derives the requirement from the import graph — a new tool that can
 * reach reserveSpend and is missing here turns that spec red rather than shipping ungated.
 */
export const PAID_BALANCE_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "research_keywords",
  "ranked_keywords",
  "analyze_backlinks",
  "compare_competitors",
  // The two gap tools (2026-08-17). Each spends a real DataForSEO request, so each carries the
  // same denial-of-service risk the gate exists to stop.
  "keyword_gap",
  "link_gap",
  // audit_speed, the same day — and the first member whose NAME does not announce it. It sits in
  // the audit family, whose other four members only cost us CPU; this one buys a Lighthouse run
  // per page. The import-graph spec is what caught it, not the name.
  "audit_speed",
  // backlink_changes (2026-08-17) — TWO real DataForSEO Backlinks requests per call, so one call
  // spends vendor money twice over. It belongs here for the same reason the gap tools do.
  "backlink_changes",
  // backlink_details (2026-08-18) — also TWO real DataForSEO Backlinks requests per call, and on
  // the ROW tariff, so its worst case buys 900 billed rows. Same reason as backlink_changes.
  "backlink_details",
  // disavow_candidates (2026-08-19) — THREE real DataForSEO Backlinks requests per call, on the
  // ROW tariff. Same reason as the two backlink tools above.
  //
  // NO ROUND-TRIP RANKING IS CLAIMED FOR ANY MEMBER, here or in the docs, and the removal is the
  // lesson: this entry and backlink_changes above both used to rank themselves top of this list by
  // vendor round trips, and BOTH were false the day they were written. audit_speed fans out one
  // Lighthouse request per URL up to MAX_SPEED_URLS — five — which no member of this list reaches.
  // Nothing in this file carries a per-call request count, so a ranking over it cannot be checked
  // from here; the one that escaped into a published docs page is exactly what NEVER #7 forbids.
  // paid-balance.test.ts pins the shape out.
  "disavow_candidates",
  // discover_keywords (2026-08-19) — a real DataForSEO Labs call, billed per returned row up to
  // that port's cap. Gated on exactly the same ground as every member above: it spends vendor
  // money, and the daily budget it spends from is shared with the customers who paid for it. The
  // criterion is "does it spend?", never "how much?" — and per the note above, no member's
  // per-call request count lives in this file, so this entry compares itself to nothing.
  "discover_keywords",
  // my_pages (2026-08-19) — one real DataForSEO Labs request per call, billed per returned row up
  // to that port's cap. Its OTHER half reads `crawl_pages`, which spends nothing at all; half a
  // tool being free exempts nothing, because the criterion is "does it spend?" and one paid
  // request is a yes. No comparison to any member above is made or implied.
  "my_pages",
  // The two AI-visibility tools (2026-08-19) — one real DataForSEO LLM Mentions request each, on
  // the most expensive tariff this product touches ($0.10 per request plus $0.001 per row). The
  // criterion is unchanged and is still "does it spend?", not "how much?"; what the price buys is
  // stated in dfs/llm-mentions.ts, not compared to anything in this file.
  "ai_visibility",
  "ai_visibility_compare",
]);

/** Whether `tool` may only run on an account that has paid. */
export function requiresPaidBalance(tool: ToolName): boolean {
  return PAID_BALANCE_TOOLS.has(tool);
}

/**
 * A gated tool was called by an account that has never paid. A TYPED error rather than a raw
 * throw so the registry can tell this DELIBERATE refusal apart from a crash and render the
 * sentence below verbatim — the generic "failed unexpectedly, quote reference X" would be a
 * lie about a rule working exactly as designed. Mirrors ReserveCommitFailedError's shape.
 */
export class PaidBalanceRequiredError extends Error {
  readonly tool: ToolName;

  constructor(tool: ToolName, message: string) {
    super(message);
    this.name = "PaidBalanceRequiredError";
    this.tool = tool;
  }
}

/**
 * Narrow an unknown error to the paid-balance refusal. The `name` fallback keeps this true
 * across a duplicated module instance (test isolation, bundling), where `instanceof` alone
 * silently answers false — the same hazard isReserveCommitFailed guards against.
 */
export function isPaidBalanceRequired(error: unknown): error is PaidBalanceRequiredError {
  return (
    error instanceof PaidBalanceRequiredError ||
    (error instanceof Error && error.name === "PaidBalanceRequiredError")
  );
}

/**
 * The refusal the user reads. English (UI-copy language for this product), and honest on all
 * four counts a refusal has to be: WHAT happened, WHY, HOW to clear it, and that nothing was
 * charged. It also says the existing credits still work, because the plain reading of a bare
 * refusal is "my credits are worthless" — they are not; they run every other tool.
 *
 * `billingUrl` is the web base URL or null. Null must not degrade the sentence: WEB_BASE_URL is
 * only ever unset by misconfiguration, and a refusal that renders "undefined/app/billing" would
 * turn a working rule into a support ticket.
 */
export function paidBalanceRequiredMessage(tool: ToolName, billingUrl: string | null): string {
  const where = billingUrl
    ? `at ${billingUrl}/app/billing`
    : "from the Billing page in your SeoGrep dashboard";
  return (
    `"${tool}" needs a paid credit balance. It reads live data from a paid third-party SEO ` +
    `provider, so it is not available on trial credits. Buy any credit pack ${where} and this ` +
    `tool unlocks straight away. Your existing credits are untouched and keep working for ` +
    `crawls, audits, reports and Search Console tools. You were not charged.`
  );
}

/**
 * Has this account ever had value put into it by a human or by Paddle?
 *
 * TRUE for a positive `purchase` (money arrived through Paddle) or a positive `adjust` (the
 * operator deliberately credited the account — a support gesture or a make-good). FALSE for a
 * `grant`, which is the machine-issued trial: gating that is the entire point.
 *
 * Operator decision 2026-08-06, and the reason `adjust` counts: nothing in apps/ or packages/
 * writes an `adjust` row (migration 0019 says so in writing), so every one of them is a
 * deliberate human SQL statement. `delta > 0` is what keeps a CORRECTIVE adjust — the archive
 * test in production is a -200 — from reading as a payment.
 *
 * Derived from the LEDGER, never from `subscriptions`: a customer who bought a top-up and holds
 * no subscription has still paid, and reading the subscription table would lock them out.
 *
 * The `.eq("user_id", …)` filter is load-bearing. This client is service-role and bypasses RLS,
 * so the filter is the ONLY thing making the read tenant-safe (constitution NEVER #4).
 *
 * Throws when the read fails. Fail CLOSED and fail LOUD: a gate that answered "true" on a
 * database blip would be a gate in name only, and one that answered "false" would refuse a
 * paying customer while claiming a rule that did not actually apply.
 */
export async function hasPaidBalance(userId: string): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .in("kind", ["purchase", "adjust"])
    .gt("delta", 0)
    .limit(1);
  if (error) {
    throw new Error(`paid-balance check failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}
