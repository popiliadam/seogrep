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
 * The router is a HEURISTIC guide, not a precise tracker. It advances on the observable DATA
 * milestones — a project exists, a crawl succeeded, Search Console is connected, a pull
 * succeeded — and always surfaces the matching analysis trio as the recommended follow-up. Google
 * Search Console is framed as OPTIONAL at every rung (design D15: the first aha is crawl + audit
 * with no GSC; connecting it is never a barrier).
 *
 * THIS COMMENT USED TO SAY MORE, AND THE EXTRA CLAUSE WAS WRONG (E-9, smoke tour wave 4). It read
 * "audits and the discovery tools leave no job trace (they are synchronous and return directly)",
 * and the whole ladder was built on it: if no analysis leaves a trace, there is nothing to look
 * for, so it never looked. Migrations 0024 (`audit_runs`), 0025 (`gsc_discovery_runs`) and 0026
 * (`audit_content_runs`) had been storing exactly that trace for weeks — the panel reads two of
 * them — and the sentence stayed. The live witness: adstark.com.tr, fresh crawl, fresh pull, ZERO
 * analyses of any kind, and the tool's recommendation was a 15-credit report summarising findings
 * nobody had produced.
 *
 * A STALE COMMENT DOES NOT GO RED. It quietly carries a decision, which is why the premise is
 * now a SIGNAL (`hasAnalysis`) that the surface measures, rather than a claim this file makes
 * about the world.
 */

import { DATA_FRESHNESS_DAYS, describeDataAge } from "./freshness.js";

/**
 * Crawl / pull data newer than this many days counts as "fresh" for the all-set / refresh rungs.
 *
 * AN ALIAS NOW, not a literal: the number lives once in `./freshness.js` (see that module for
 * the three-independent-30s drift this closes). The NAME stays because apps/web imports it under
 * this name and its own parity spec pins the import, and because "the freshness window" is what
 * this ladder calls the threshold. The COMPARISON stays where it was too — both surfaces measure
 * `now - createdAt <= FRESHNESS_WINDOW_DAYS * MS_PER_DAY` — so this is a re-home, not a
 * re-decision, and every rung below decides byte-identically to before.
 */
export const FRESHNESS_WINDOW_DAYS = DATA_FRESHNESS_DAYS;

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
  /**
   * The connection exists but NO Search Console property is mapped to it — `true` only when a
   * `gsc_connections` row was read and its `gsc_property` was null.
   *
   * A SEPARATE signal from `gscConnected` for the reason `gscTokenInvalid` is separate: the link
   * is real, and the thing that cannot happen is the pull. Folding it into `gscConnected` would
   * send a project that HAS a working Google account back to `connect_gsc`, which is not the
   * step — the account is fine, the mapping is missing.
   *
   * OPTIONAL and read with `=== true`. `undefined` is "this surface does not measure it", never
   * "a property is mapped": a caller that omits it decides byte-identically to the ladder that
   * existed before this signal did, which is what lets the MCP router adopt it ahead of the web
   * panel without the two disagreeing.
   */
  readonly gscPropertyMissing?: boolean;
  /**
   * The project's domain is KNOWN not to resolve — `true` only when a DNS lookup came back with
   * "no such name", never when the lookup itself failed to run.
   *
   * OPTIONAL and read with `=== true`, exactly like `gscTokenInvalid` and for a sharper reason:
   * `undefined` means "nobody checked", and a check that could not run must never be reported as
   * a domain that does not exist. Getting that backwards would route every project to the
   * dead-domain rung during a DNS blip — the ladder would stop recommending paid work for a whole
   * account because one lookup timed out. The port that produces this signal decides the same way
   * (see apps/mcp `tools/domain-reachability.ts`).
   */
  readonly domainUnreachable?: boolean;
  /**
   * Whether ANY analysis has ever run for this project — an `audit_runs`, `gsc_discovery_runs` or
   * `audit_content_runs` row exists (migrations 0024 / 0025 / 0026).
   *
   * OPTIONAL and read with `=== false` at the one rung that uses it, which is the mirror of the
   * `=== true` convention above and chosen for the same reason: `undefined` means "this surface
   * does not measure it", and a caller that omits it decides byte-identically to the ladder that
   * existed before this signal did. Reading it truthily would send every unmeasured project down
   * the never-analysed branch — the ladder would re-route a whole surface on a signal nobody
   * supplied.
   *
   * PRESENCE, NOT FRESHNESS. The question this answers is "has anyone looked at this data at
   * all?", and one look is enough to stop the ladder claiming nobody has. Whether an old analysis
   * should be re-run against newer data is a different question, and answering it here would put
   * a second freshness rule beside the one FRESHNESS_WINDOW_DAYS already owns.
   */
  readonly hasAnalysis?: boolean;
  /**
   * Whole days since the latest crawl / pull, when the surface measured them. OPTIONAL: a caller
   * that omits them gets the same recommendation with the age left out of the wording, so
   * `crawlFresh` / `pullFresh` remain the only things the ladder DECIDES on. They exist so the
   * router can quote the SAME number generate_report quotes instead of an unanchored "fresh".
   */
  readonly crawlAgeDays?: number | null;
  readonly pullAgeDays?: number | null;
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

/**
 * " (16 days ago)" for a measured age, "" for one the surface did not measure.
 *
 * WHY THE EMPTY STRING MATTERS. "fresh" with no number is the whole of defect card 12: the same
 * 16-day-old crawl was `crawl from 2026-08-09` in audit_schema, `16 days ago` in generate_report
 * and simply "fresh" here, and a reader had no way to line the three up. The age is quoted
 * through `describeDataAge` — the SAME function the report's own age line goes through — so the
 * two cannot word the same crawl differently.
 *
 * But it is a decoration, never a decision: a caller that omits the ages (apps/web's panel today)
 * gets the sentence it got before, and `crawlFresh` / `pullFresh` remain the only inputs any rung
 * branches on. `describeDataAge(null)` returns "age unknown", which is true but useless inside
 * this sentence, so an unmeasured age produces no parenthetical at all.
 */
function agedClause(ageDays: number | null | undefined): string {
  return ageDays === undefined || ageDays === null ? "" : ` (${describeDataAge(ageDays)})`;
}

export function decideProjectNextStep(s: ProjectSignals): NextStep {
  // Rung 0 — the domain does not resolve. FIRST, above even the no-crawl foundation, because
  // every rung below recommends work against a host that is not there: the measured case
  // (2026-08-25) registered a nonsense domain and was told to run crawl_site, a 20-credit job
  // whose first DNS lookup cannot succeed. Nothing offered here costs credits.
  //
  // It does NOT refuse or un-track anything — a pre-launch site is a legitimate project and the
  // operator signed WARN, not block. It withholds the RECOMMENDATION to spend, and says why.
  //
  // `=== true`, never a truthy test: see ProjectSignals.domainUnreachable. An unchecked or
  // unanswerable domain falls straight through to the ladder that existed before this rung.
  if (s.domainUnreachable === true) {
    return {
      primary: "setup_project",
      reason:
        "This project's domain does not resolve — a DNS lookup found no such name, so a crawl " +
        "would have nothing to fetch and the paid tools would have nothing to measure. If the " +
        "site simply is not live yet, there is nothing to do until it is. If the domain was " +
        "mistyped, run setup_project with the correct one; if it was retired, untrack_project " +
        "removes it.",
      // Free steps only. Naming any paid tool here would put the same recommendation back one
      // line lower, which is the entire defect this rung exists to remove.
      upcoming: ["list_projects", "untrack_project", "whats_next (once the domain is live)"],
      allSet: false,
    };
  }
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
  // Rung 3 — rows WERE pulled once, but there is no connection now. Reaching this line already
  // means `hasPull` is true: rung 2 consumed the `!gscConnected && !hasPull` case, so the only
  // way past it without a connection is with a pull behind you.
  //
  // THE MEASURED WRONG (2026-08-25, dentnotion.com). Every rung below reads `hasPull` as if it
  // stood for a LIVE Search Console link. It does not: it is the existence of a succeeded
  // `pull_gsc_data` job, which survives a disconnect, an un-mapped property and an account
  // deletion forever. That project had one such job from 2026-08-09 and NO connection — in the
  // same session `list_gsc_properties` printed "not used by any project" and `connect_gsc` took
  // its not-connected branch — and the router answered "You have a fresh crawl and fresh Search
  // Console data — you're all set", then recommended generate_report at 15 credits. It skipped
  // the FREE connect_gsc that was the actual next step, and it charged for the privilege.
  //
  // So the ladder now separates "rows exist" from "the link is live", and the two rungs that
  // follow are the two ways a link can be not-live: never/no-longer connected (here), and
  // connected-but-dead (below). Both answer connect_gsc, and neither is all set.
  if (!s.gscConnected) {
    return {
      primary: "connect_gsc",
      reason:
        "This project has Search Console data from an earlier pull, but no live connection — " +
        "so that data can never be refreshed and the tools that read it are working from a " +
        "frozen snapshot. Reconnecting is free; do it before paying for anything that reads " +
        "Search Console. Your crawl is ready to analyze either way.",
      // Same discipline as the dead-credential rung below: nothing that reads a pull this
      // project can no longer refresh. The audits need no Google account at all.
      upcoming: [...AUDIT_TRIO, "generate_report"],
      allSet: false,
    };
  }
  // Rung 4 — the connection EXISTS but the credential behind it is dead. Every rung below this
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
  // Rung 4b — the account is live, but NO property is mapped to this project. Measured on
  // 2026-08-26: a gsc_connections row can carry a null `gsc_property`, and every rung below this
  // one recommends pull_gsc_data, which cannot succeed without one. That is the rung-3 wrong a
  // field over — a guaranteed failure handed out as the next step — so it is cut off here.
  //
  // NOT connect_gsc: the Google account behind this project WORKS. Sending the user through
  // another OAuth round would be asking them to fix something that is not broken. The step is to
  // see which properties the account can read and map one, and both tools are free.
  //
  // BELOW the dead-credential rung on purpose: with a dead credential you cannot list the
  // properties to choose from, so reconnecting has to come first. Position, not preference.
  //
  // `=== true`, never a truthy test: `undefined` is "not measured" (see gscPropertyMissing).
  if (s.gscConnected && s.gscPropertyMissing === true) {
    return {
      primary: "list_gsc_properties",
      reason:
        "Your Google account is connected to this project, but no Search Console property is " +
        "mapped to it yet — so Search Console pulls cannot run. List the properties the account " +
        "can read, then map one with track_gsc_property. Both are free. Your crawl is ready to " +
        "analyze either way.",
      // No pull_gsc_data and none of the three discovery tools: every one of them reads a pull
      // this project cannot take yet. The audits need no Google account at all.
      upcoming: ["track_gsc_property", ...AUDIT_TRIO, "generate_report"],
      allSet: false,
    };
  }
  // Rung 5 — Search Console connected but nothing pulled yet: pull to unlock the discovery tools.
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
        `Your Search Console data${agedClause(s.pullAgeDays)} is more than ` +
        `${FRESHNESS_WINDOW_DAYS} days old. Refresh it before acting on quick wins so the ` +
        "numbers reflect the current picture.",
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
        `Your crawl${agedClause(s.crawlAgeDays)} is more than ${FRESHNESS_WINDOW_DAYS} days old. ` +
        "Re-crawl so the audits reflect the current state of the site.",
      upcoming: ["audit_onpage", "audit_tech", "audit_schema", "generate_report"],
      allSet: false,
    };
  }
  // All-set, but NOTHING HAS BEEN ANALYSED YET. The data is complete and current; what is missing
  // is anyone having looked at it. Measured live 2026-08-27 on adstark.com.tr — fresh crawl,
  // fresh pull, zero rows in all three run tables — where the rung below recommended a 15-credit
  // report, i.e. a summary of findings that did not exist. The report is not wrong to offer, it
  // is wrong to offer FIRST: it is a cover over an empty folder, and the analyses that would fill
  // it were listed underneath as things to get to later.
  //
  // find_quick_wins, at 10 credits, is CHEAPER than the report it replaces, so the money ordering
  // improves rather than trading one spend for a bigger one. It is also already the first item of
  // the all-set follow-up list below — this rung PROMOTES the ladder's own existing first choice
  // to the headline rather than inventing a new preference — and it reads the fresh pull that
  // reaching this rung guarantees.
  //
  // `=== false`, never a falsy test: `undefined` is "this surface does not measure analyses" and
  // must decide exactly as the ladder did before this rung existed (see ProjectSignals.hasAnalysis).
  //
  // allSet stays TRUE: every applicable data source really is present and fresh, which is what
  // that flag has always meant. What changed is the recommendation, not the state of the data.
  if (s.hasAnalysis === false) {
    return {
      primary: "find_quick_wins",
      reason:
        `You have a fresh crawl${agedClause(s.crawlAgeDays)} and fresh Search Console data` +
        `${agedClause(s.pullAgeDays)} — both inside the ${FRESHNESS_WINDOW_DAYS}-day freshness ` +
        "window — but nothing has been analyzed yet. Start with quick wins: it reads the Search " +
        "Console data you already pulled and names the pages closest to moving up. Generate a " +
        "report once there are findings to put in it.",
      upcoming: [
        "detect_cannibalization",
        "analyze_content_decay",
        ...AUDIT_TRIO,
        "generate_report",
        "monthly-routine (prompt)",
      ],
      allSet: true,
    };
  }
  // All-set — every applicable source is present and fresh, and something has been analysed (or
  // this surface does not measure it). Point at the report payoff and the monthly-routine prompt.
  return {
    primary: "generate_report",
    reason:
      `You have a fresh crawl${agedClause(s.crawlAgeDays)} and fresh Search Console data` +
      `${agedClause(s.pullAgeDays)} — both inside the ${FRESHNESS_WINDOW_DAYS}-day freshness ` +
      "window, so you're all set. Generate a shareable report, and use the monthly-routine " +
      "prompt to keep everything up to date.",
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
