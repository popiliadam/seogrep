import { TOOL_COSTS } from "../credits/costs.ts";
import { withCredits, type CreditContext, type CreditMeta } from "../credits/guard.ts";
import { isPaidBalanceRequired } from "../credits/paid-balance.ts";
import { selectExtraSeeds } from "../crawler/crawl.ts";
import {
  pageJoinKey,
  resolveDefaultRelevantPagesPort,
  type RelevantPageRow,
  type RelevantPagesPort,
} from "../dfs/relevant-pages.ts";

/**
 * crawl_site's OPT-IN ranking-page seeding — the vendor half of `seed_from_ranking_pages`.
 *
 * =====================================================================================
 * WHAT IT FIXES, AND WHY IT IS NOT ON BY DEFAULT
 * =====================================================================================
 * MEASURED 2026-08-25: the site's HIGHEST-etv page (127.2) never entered a crawl at all. A crawl
 * seeds from the sitemap plus the homepage and stops at 100 pages, and a sitemap is not ordered by
 * importance — so the single page earning the traffic can sit hundreds of entries deep and be
 * dropped by the ceiling every single run. DataForSEO's relevant-pages list knows which pages rank;
 * seeding from it puts them in the first batch.
 *
 * That list is a PAID vendor lookup, so it cannot be free and it cannot be silent. It is therefore
 * OPT-IN and OFF by default, for a money reason stated plainly: `crawl_site` costs 20 credits and
 * the 2026-08-25 signature package explicitly does NOT cover changing any existing tool's price.
 * Seeding every crawl would make `crawl_site` cost 60 for everyone, which is exactly the change
 * that signature excluded.
 *
 * =====================================================================================
 * NO NEW PRICE IS INVENTED (NEVER #6)
 * =====================================================================================
 * The seeding IS a `my_pages` lookup — the same DataForSEO Labs `relevant_pages` request, through
 * the same port — so it is charged at the SIGNED `my_pages` price, as its own ledger line under
 * its own tool name. No row is added to TOOL_COSTS and `crawl_site`'s 20 does not move. The
 * customer sees two lines (crawl_site 20 + my_pages 40) and can read what each bought. Because the
 * charge runs under `my_pages`, that tool's paid-balance gate applies to it unchanged.
 *
 * =====================================================================================
 * NOTHING DELIVERED, NOTHING CHARGED
 * =====================================================================================
 * The rule of this signature round (items 5 and 6): an empty or failed result is free. Here that
 * is enforced by WHERE the emptiness check sits — INSIDE the credit guard's callback. withCredits
 * COMMITS a callback that returns and RELEASES one that throws, so a lookup that yields no usable
 * seed throws and costs nothing. "Usable" is measured AFTER filtering, not before: rows that are
 * all off-site or all outside `include_paths` seeded nothing, so they are not billable either.
 * A seeding that produces nothing never blocks the crawl — the crawl is queued without seeds and
 * the answer says so.
 *
 * When live DataForSEO is off (`DFS_LIVE != 1`) the port is disabled: no vendor request is made,
 * no credit is reserved, and the answer says the seeding did not run rather than quietly
 * substituting fixture URLs (NEVER #7).
 */

/**
 * The tool whose SIGNED price this seeding is charged at. Not a new price and not an alias: the
 * request on the wire IS `my_pages`'s request, so it is billed as `my_pages` and appears in the
 * ledger under that name.
 */
export const SEED_CHARGE_TOOL = "my_pages" as const;

/** Credits one seeding lookup costs — read from the human-approved table, never a literal. */
export const SEED_CHARGE_CREDITS = TOOL_COSTS[SEED_CHARGE_TOOL];

/**
 * The locale the seeding lookup runs under — the same defaults `my_pages` itself carries. Seeding
 * exposes no locale knob: `crawl_site` is a crawler, and a tenant who needs another market can run
 * `my_pages` directly and pass the URLs they want. Stated in the flag's description and the docs
 * page rather than left for a reader to discover from a row that is missing.
 */
const SEED_LANGUAGE_CODE = "en";
const SEED_LOCATION_CODE = 2840; // United States

/** What a seeding attempt did. Every branch names whether a credit was spent. */
export type RankingSeedKind =
  /** Live DataForSEO is off on this deployment — no request, no charge. */
  | "unavailable"
  /** The lookup ran and yielded no seed this crawl could use — released, not charged. */
  | "empty"
  /** The lookup could not run or failed — released, not charged. */
  | "failed"
  /** Seeds were produced and the lookup was charged. */
  | "seeded";

export interface RankingSeedOutcome {
  readonly kind: RankingSeedKind;
  /** Same-site, in-scope, normalized entry points to hand the crawl. Empty unless `seeded`. */
  readonly seeds: readonly string[];
  /** How many pages the vendor named in this window (0 when no request was made). */
  readonly rowsReturned: number;
  /** Vendor rows that are not pages of this site (a subdomain, or an address we could not key). */
  readonly offSite: number;
  /** Same-site pages dropped by `include_paths` or as a reserved infrastructure path. */
  readonly outOfScope: number;
  /** Credits actually spent. 0 on every branch but `seeded`. */
  readonly creditsCharged: number;
  /** One English sentence for the caller — always states the fee outcome. */
  readonly note: string;
}

/** The pure half of the vendor→crawl conversion: which rows are pages of THIS site, and where. */
export interface SeedCandidates {
  /** Absolute URLs on the project's own origin, in vendor order. */
  readonly candidates: string[];
  /** Rows that named some other host, or an address that could not be keyed at all. */
  readonly offSite: number;
}

/**
 * Turn vendor ranking rows into candidate URLs on the PROJECT'S OWN origin.
 *
 * The two sides do not arrive in the same shape — the vendor sends an absolute `page_address`
 * whose scheme and `www.` label are its own business, and the crawl runs against
 * `https://<project.domain>`. Rather than write a second normalizer (the failure
 * `dfs/relevant-pages.ts` names in its header), this reuses the ONE shared key both halves of the
 * `my_pages` join already use: {@link pageJoinKey}, which drops the scheme, lower-cases the host,
 * strips one leading `www.`, drops the fragment and trims one trailing slash. What survives is a
 * `host/path?query` string; a row whose host is not the project's is counted off-site (this
 * endpoint can and does return subdomain rows, and `blog.example.com` is not `example.com`), and
 * everything else is rebuilt as a path on the project's own origin.
 *
 * Pure. Scope, infrastructure paths and dedupe are NOT decided here — those are the crawl's own
 * predicates and are applied by `selectExtraSeeds`, so there is exactly one place that owns them.
 */
export function rankingSeedCandidates(
  rows: readonly RelevantPageRow[],
  domain: string,
): SeedCandidates {
  // pageJoinKey renders a bare domain as "example.com/" (its path is "/"), so the trailing slash
  // is trimmed here to get the HOST prefix the row keys are compared against.
  const originKey = (pageJoinKey(domain) ?? "").replace(/\/$/, "");
  if (originKey === "") return { candidates: [], offSite: rows.length };
  const base = `https://${domain}`;
  const candidates: string[] = [];
  let offSite = 0;
  for (const row of rows) {
    const key = row.our_join_key;
    if (key === null) {
      offSite++;
      continue;
    }
    // The separator is required, so "example.community/x" cannot pass as "example.com".
    let pathAndQuery: string | null = null;
    if (key === originKey) pathAndQuery = "/";
    else if (key.startsWith(`${originKey}/`)) pathAndQuery = key.slice(originKey.length);
    else if (key.startsWith(`${originKey}?`)) pathAndQuery = `/${key.slice(originKey.length)}`;
    if (pathAndQuery === null) {
      offSite++;
      continue;
    }
    try {
      candidates.push(new URL(pathAndQuery, base).toString());
    } catch {
      offSite++;
    }
  }
  return { candidates, offSite };
}

/** What a seeding attempt needs to know. `domain` is the project's stored, normalized domain. */
export interface RankingSeedRequest {
  readonly userId: string;
  readonly domain: string;
  /** The crawl's page cap — no more seeds are asked for or kept than the crawl could reach. */
  readonly maxUrls: number;
  /** The crawl's `include_paths`, applied to the seeds exactly as to everything else. */
  readonly includePaths?: readonly string[];
}

/** The seeding step as the `crawl_site` surface consumes it (injected in the fast lane). */
export type RankingSeedFetcher = (request: RankingSeedRequest) => Promise<RankingSeedOutcome>;

/**
 * The credit guard, as a port. Production passes {@link withCredits} itself; specs pass a fake so
 * the "empty result is free" contract can be OBSERVED without a database. The fake can only be
 * honest about it because it has the same shape as the real guard: it settles on whether the
 * callback returned or threw, which is the one fact this module steers.
 */
export type CreditRunner = <T>(
  ctx: CreditContext,
  meta: CreditMeta,
  fn: () => Promise<T>,
) => Promise<T>;

/** Raised INSIDE the credit callback so the guard releases the reserve. Carries what was seen. */
class NoUsableSeedsError extends Error {
  readonly rowsReturned: number;
  readonly offSite: number;
  readonly outOfScope: number;

  constructor(rowsReturned: number, offSite: number, outOfScope: number) {
    super("ranking-page seeding produced no usable seed");
    this.name = "NoUsableSeedsError";
    this.rowsReturned = rowsReturned;
    this.offSite = offSite;
    this.outOfScope = outOfScope;
  }
}

/** The sentence that ends every non-charged branch. One wording, one place. */
const QUEUED_WITHOUT_SEEDS =
  "The crawl was queued without them, and you were not charged for the seeding.";

/** Count clause the caller can weigh: what the vendor named, and what this crawl could not use. */
function droppedClause(rowsReturned: number, offSite: number, outOfScope: number): string {
  if (offSite === 0 && outOfScope === 0) return "";
  const parts: string[] = [];
  if (offSite > 0) parts.push(`${offSite} are not pages of this site`);
  if (outOfScope > 0) parts.push(`${outOfScope} fell outside this crawl's scope`);
  return ` Of the ${rowsReturned} pages DataForSEO named, ${parts.join(" and ")}.`;
}

export interface RankingSeedDeps {
  /** The relevant-pages port (default: env-resolved — disabled unless DFS_LIVE=1 + credentials). */
  readonly port?: RelevantPagesPort;
  /** The credit guard (default: the real withCredits). */
  readonly runCredits?: CreditRunner;
}

/**
 * Run the seeding lookup. Never throws: a crawl must not fail because an OPTIONAL, opt-in
 * enrichment could not run, so every failure becomes an outcome the caller prints.
 */
export async function fetchRankingSeeds(
  request: RankingSeedRequest,
  deps: RankingSeedDeps = {},
): Promise<RankingSeedOutcome> {
  const port = deps.port ?? resolveDefaultRelevantPagesPort();
  const runCredits = deps.runCredits ?? withCredits;

  // Free gate, before any reserve: refuse rather than serve fixture URLs as real ranking pages.
  if (!port.enabled) {
    return {
      kind: "unavailable",
      seeds: [],
      rowsReturned: 0,
      offSite: 0,
      outOfScope: 0,
      creditsCharged: 0,
      note:
        "Seeding from your ranking pages is not available on this deployment: live DataForSEO " +
        `data is turned off, and SeoGrep never seeds a crawl from sample pages. ${QUEUED_WITHOUT_SEEDS}`,
    };
  }

  try {
    const selected = await runCredits({ userId: request.userId }, { tool: SEED_CHARGE_TOOL }, async () => {
      const result = await port.fetchRelevantPages({
        target: request.domain,
        // Never more rows than the crawl could reach: the price is flat either way, and asking
        // for rows the page cap will drop only widens DataForSEO's own per-row bill.
        limit: request.maxUrls,
        offset: 0,
        language_code: SEED_LANGUAGE_CODE,
        location_code: SEED_LOCATION_CODE,
      });
      const rows = result.window.rows;
      const { candidates, offSite } = rankingSeedCandidates(rows, request.domain);
      // The crawl's OWN gates decide what is seedable — same function the crawler re-runs.
      const selection = selectExtraSeeds(
        candidates,
        `https://${request.domain}`,
        request.includePaths,
      );
      const seeds = selection.seeds.slice(0, request.maxUrls);
      if (seeds.length === 0) {
        // THROWN, not returned: this is what makes an empty result free. The guard releases the
        // reserve on a throw, so nothing settles for a lookup that seeded nothing.
        throw new NoUsableSeedsError(rows.length, offSite, selection.outOfScope);
      }
      return { seeds, rowsReturned: rows.length, offSite, outOfScope: selection.outOfScope };
    });

    return {
      kind: "seeded",
      seeds: selected.seeds,
      rowsReturned: selected.rowsReturned,
      offSite: selected.offSite,
      outOfScope: selected.outOfScope,
      creditsCharged: SEED_CHARGE_CREDITS,
      note:
        `Seeded this crawl with ${selected.seeds.length} of the pages DataForSEO reports as ` +
        `ranking for ${request.domain}, so they are fetched before the page cap is reached ` +
        `(charged ${SEED_CHARGE_CREDITS} credits, billed as my_pages — the crawl itself is ` +
        `unchanged at ${TOOL_COSTS.crawl_site}).` +
        droppedClause(selected.rowsReturned, selected.offSite, selected.outOfScope),
    };
  } catch (error) {
    if (error instanceof NoUsableSeedsError || (error as Error)?.name === "NoUsableSeedsError") {
      const seen = error as NoUsableSeedsError;
      return {
        kind: "empty",
        seeds: [],
        rowsReturned: seen.rowsReturned,
        offSite: seen.offSite,
        outOfScope: seen.outOfScope,
        creditsCharged: 0,
        note:
          "DataForSEO named no ranking page this crawl could use as a starting point." +
          droppedClause(seen.rowsReturned, seen.offSite, seen.outOfScope) +
          ` ${QUEUED_WITHOUT_SEEDS}`,
      };
    }
    // The paid-balance refusal is written to be READ by the customer, so it is passed through
    // verbatim. Every other failure is an operator fault and is reported without its detail.
    const reason = isPaidBalanceRequired(error)
      ? error.message
      : "the lookup could not be completed.";
    return {
      kind: "failed",
      seeds: [],
      rowsReturned: 0,
      offSite: 0,
      outOfScope: 0,
      creditsCharged: 0,
      note: `Seeding from your ranking pages did not run: ${reason} ${QUEUED_WITHOUT_SEEDS}`,
    };
  }
}
