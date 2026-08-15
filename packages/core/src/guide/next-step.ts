/**
 * The whats_next decision ladder — PURE: no I/O, no DB, no runtime dependency.
 *
 * WHY IN CORE — the ladder answers "where does this project stand, and what is the one next
 * step?" from a handful of observable signals, and BOTH runtimes need that answer with the SAME
 * words:
 * the MCP `whats_next` tool renders it as text, and apps/web wants to show it in the panel. The
 * decision itself carries no transport, so it lives here and each surface renders it its own way.
 *
 * `apps/mcp/src/tools/whats-next.ts` re-exports everything that moved, so its callers and every
 * pin are unchanged. The I/O half — the tenant-scoped signal reads, the state loader, the
 * renderers and the tool definition — stays there, where the DB client is.
 *
 * The router is a HEURISTIC guide, not a precise tracker: audits and the discovery tools leave no
 * job trace (they are synchronous and return directly), so the ladder advances on the observable
 * DATA milestones — a project exists, a crawl succeeded, Search Console is connected, a pull
 * succeeded — and always surfaces the matching analysis trio as the recommended follow-up. Google
 * Search Console is framed as OPTIONAL at every rung (design D15: the first aha is crawl + audit
 * with no GSC; connecting it is never a barrier).
 */

/** Crawl / pull data newer than this many days counts as "fresh" for the all-set / refresh rungs. */
export const FRESHNESS_WINDOW_DAYS = 30;

/** The observable, tenant-scoped signals the ladder decides from. */
export interface ProjectSignals {
  readonly hasCrawl: boolean;
  readonly crawlFresh: boolean;
  readonly gscConnected: boolean;
  readonly hasPull: boolean;
  readonly pullFresh: boolean;
  /**
   * The stored health of the Google account behind the connection — `true` only when it is KNOWN
   * dead (`gsc_accounts.token_status = 'invalid'`, written by the paths that actually saw Google
   * answer `invalid_grant`).
   *
   * OPTIONAL, and read with `=== true` at the one rung that uses it. `undefined` means "this
   * surface does not measure connection health", NOT "healthy": a caller that omits it decides
   * byte-identically to the ladder that existed before this signal did — which is what lets the
   * MCP router adopt it ahead of the web panel without the two surfaces disagreeing about
   * projects whose connection is alive.
   */
  readonly gscTokenInvalid?: boolean;
}

/** A single next-step recommendation: the primary action, why, and what follows. */
export interface NextStep {
  /** The one recommended tool (or, at the all-set rung, the report payoff). */
  readonly primary: string;
  /** A short plain-English reason for the recommendation. */
  readonly reason: string;
  /** The two or three steps that come after (tool names, with optional/prompt hints). */
  readonly upcoming: readonly string[];
  /** True only when every applicable data source is present and fresh. */
  readonly allSet: boolean;
}

/**
 * The pure decision ladder for a RESOLVED project (first match wins). Kept free of I/O so every
 * rung is unit-tested directly. See the module header for why the ladder keys on data milestones.
 */
/**
 * The three tools that analyze a crawl. They appear on EVERY rung where a crawl exists, because
 * the ladder returns one primary step and the rest of the list is what the user can still do.
 *
 * Live product test 2026-08-07: two real projects with identical crawl state and only the Search
 * Console link differing. The un-connected one was told to audit; the connected one was routed
 * to pull_gsc_data and never heard of the audits at all — so connecting GSC silently hid the
 * analysis of a crawl the user had already paid 20 credits for. Connecting a data source must
 * ADD a path, never remove one.
 */
const AUDIT_TRIO = ["audit_onpage", "audit_tech", "audit_schema"] as const;

export function decideProjectNextStep(s: ProjectSignals): NextStep {
  // Rung 1 — no crawl: the GSC-less foundation (works without Search Console).
  if (!s.hasCrawl) {
    return {
      primary: "crawl_site",
      reason:
        "This project has no crawl yet. A crawl is the foundation of every audit, and it works " +
        "without connecting Google Search Console.",
      upcoming: ["audit_onpage", "audit_tech", "audit_schema", "connect_gsc (optional)"],
      allSet: false,
    };
  }
  // Rung 2 — crawl present, Search Console not connected, nothing pulled: audit the crawl now;
  // connecting GSC stays OPTIONAL (design D15 — never a barrier).
  if (!s.gscConnected && !s.hasPull) {
    return {
      primary: "audit_onpage",
      reason:
        "Your latest crawl is ready to analyze. Run the on-page audit first, then the technical " +
        "and schema audits. Connecting Google Search Console is optional and unlocks deeper, " +
        "query-level analysis.",
      upcoming: ["audit_tech", "audit_schema", "connect_gsc (optional)", "generate_report"],
      allSet: false,
    };
  }
  // Rung 3 — the connection EXISTS but the credential behind it is dead. Every rung below this
  // one recommends pull_gsc_data, which cannot succeed until the user re-approves: the router
  // would be handing out a guaranteed failure and calling it the next step. Reconnect first.
  //
  // POSITION IS THE POINT. It sits above BOTH pull rungs — the "nothing pulled yet" one and the
  // "your data is stale" one — because a dead account is equally unpullable in either state, and
  // above the all-set rung because a project resting on a fresh pull it can no longer refresh is
  // not all set. It sits BELOW the no-crawl rung on purpose: a crawl needs no Google account at
  // all (design D15), so a project with a dead connection and no crawl is still told to crawl.
  //
  // `=== true`, never a truthy test: `undefined` is "not measured" and must decide exactly as it
  // did before this rung existed (see ProjectSignals.gscTokenInvalid).
  if (s.gscConnected && s.gscTokenInvalid === true) {
    return {
      primary: "connect_gsc",
      reason:
        "Your Google connection has expired — run connect_gsc to reconnect, then refresh your " +
        "Search Console data. Until it is reconnected, Search Console pulls cannot succeed, but " +
        "your crawl is still ready to analyze.",
      // No pull_gsc_data and none of the three discovery tools: they all read a pull this project
      // cannot take, so listing them would put the guaranteed failure back one line lower. The
      // audits are what the user CAN still do, and they need no Google account.
      upcoming: [...AUDIT_TRIO, "generate_report"],
      allSet: false,
    };
  }
  // Rung 4 — Search Console connected but nothing pulled yet: pull to unlock the discovery tools.
  if (s.gscConnected && !s.hasPull) {
    return {
      primary: "pull_gsc_data",
      reason:
        "Google Search Console is connected. Pull your latest performance data to unlock quick " +
        "wins, cannibalization, and content-decay analysis. Your crawl is ready to analyze too.",
      upcoming: [
        "find_quick_wins",
        "detect_cannibalization",
        "analyze_content_decay",
        ...AUDIT_TRIO,
        "generate_report",
      ],
      allSet: false,
    };
  }
  // A pull exists (past the two rungs above implies hasPull here). If a present source is stale,
  // refresh it before acting so the numbers reflect the current picture.
  if (!s.pullFresh) {
    return {
      primary: "pull_gsc_data",
      reason:
        `Your Search Console data is more than ${FRESHNESS_WINDOW_DAYS} days old. Refresh it before ` +
        "acting on quick wins so the numbers reflect the current picture.",
      upcoming: [
        "find_quick_wins",
        "detect_cannibalization",
        "analyze_content_decay",
        ...AUDIT_TRIO,
        "generate_report",
      ],
      allSet: false,
    };
  }
  if (!s.crawlFresh) {
    return {
      primary: "crawl_site",
      reason:
        `Your crawl is more than ${FRESHNESS_WINDOW_DAYS} days old. Re-crawl so the audits reflect ` +
        "the current state of the site.",
      upcoming: ["audit_onpage", "audit_tech", "audit_schema", "generate_report"],
      allSet: false,
    };
  }
  // All-set — every applicable source is present and fresh. Point at the report payoff and the
  // monthly-routine prompt that keeps the data current.
  return {
    primary: "generate_report",
    reason:
      "You have a fresh crawl and fresh Search Console data — you're all set. Generate a shareable " +
      "report, and use the monthly-routine prompt to keep everything up to date.",
    upcoming: [
      "find_quick_wins",
      "detect_cannibalization",
      "analyze_content_decay",
      ...AUDIT_TRIO,
      "monthly-routine (prompt)",
    ],
    allSet: true,
  };
}
