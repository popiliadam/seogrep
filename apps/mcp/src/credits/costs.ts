/**
 * Per-tool credit costs (v0). These literals are the single source of truth for
 * what each MCP tool charges, and they are pinned by a byte-for-byte test.
 *
 * Human-approved: PR #12 merge sign-off; ranked_keywords, analyze_backlinks and
 * compare_competitors added at the prices signed off in
 * docs/plans/2026-07-28-dfs10-fiyat-karari.md. CLAUDE.md NEVER #6 —
 * price / credit cost / package figures do not change without human approval across
 * code + docs + pricing.
 * The credit guard (withCredits) reads the reserve amount from this table; a cost of
 * 0 means the tool runs without touching the ledger (no reserve/commit).
 */
export const TOOL_COSTS = {
  setup_project: 0,
  connect_gsc: 0,
  list_projects: 0,
  get_credit_balance: 0,
  crawl_site: 20,
  get_job_status: 0,
  pull_gsc_data: 5,
  research_keywords: 25,
  // discover_keywords (plan 2026-08-17 §B, MADDE 1 row #1): the DataForSEO Labs keyword-DISCOVERY
  // family — keyword_ideas / keyword_suggestions / related_keywords / keywords_for_site behind one
  // `mode`. SIGNED BY THE OPERATOR 2026-08-17 at 40, with the vendor cost MEASURED: typical $0.024
  // at 100 rows (20.7x) and worst $0.132 at 1,000 rows (3.8x) on the Labs tariff ($0.012 per
  // request + $0.00012 per row). The v1 draft's second price tier above `limit` > 500 was DROPPED
  // in v2 — there is ONE price, so the ROW CAP is the only thing holding the signed worst case up:
  // MAX_DISCOVER_ROWS (1,000) and ONE request per lookup (dfs/discover-keywords.ts) are part of
  // the signed price, not soft limits. It does not re-price research_keywords above it: that tool
  // prices a list the caller already has, this one asks the vendor to produce one. No existing
  // number moved.
  discover_keywords: 40,
  // my_pages (plan 2026-08-17 §B, MADDE 1 row #11): DataForSEO Labs `relevant_pages` — one row per
  // PAGE of a domain, carrying that page's position histogram and traffic estimates, joined
  // against the pages our own crawl fetched. SIGNED BY THE OPERATOR 2026-08-17 at 40, with the
  // vendor cost MEASURED on the Labs tariff ($0.012 per request + $0.00012 per row): typical
  // $0.024 at 100 rows (20.7x) and worst $0.132 at 1,000 rows (3.8x). The gap map's 35 is the
  // STALE figure and the signature is later. There is ONE price, so the ROW CAP is the only thing
  // holding the signed worst case up: MAX_RELEVANT_PAGES_ROWS (1,000) and ONE request per lookup
  // (dfs/relevant-pages.ts) are part of the signed price, not soft limits — and so is the ABSENCE
  // of `include_clickstream_data`, which doubles the vendor cost of the same request and would
  // drop the worst case to 1.88x, under the signature package's own 3x band. Reading `crawl_pages`
  // costs no vendor money: the join is analysis over data the tenant already paid for. No existing
  // number moved.
  my_pages: 40,
  ranked_keywords: 65,
  analyze_backlinks: 70,
  compare_competitors: 90,
  // The two GAP tools (operator-SIGNED 2026-08-17). Same question on two axes — what a rival
  // has that you do not — and one paid DataForSEO request each, on two different tariffs:
  // keyword_gap runs Labs domain_intersection ($0.012/request + $0.00012/row) and link_gap runs
  // Backlinks domain_intersection ($0.024/request + $0.000036/row). Both are priced at 45 because
  // a customer cannot be asked to know which vendor API sits behind which question; the worst
  // case (either tool at the vendor's 1,000-row cap) still clears the margin band the DFS #10
  // decision file set. No existing number moved.
  keyword_gap: 45,
  link_gap: 45,
  // backlink_changes (plan 2026-08-17 §B3, MADDE 1 row #6): the two DataForSEO Backlinks
  // time-series endpoints — new/lost per bucket, and the profile's own totals per bucket.
  // SIGNED BY THE OPERATOR 2026-08-17 at 35 (down from the v1 draft's 45). Two vendor requests on
  // the Backlinks tariff ($0.024/request + $0.000036/row), which is why the signed typical is
  // $0.061 and the signed worst case $0.12 — and the WINDOW CAP that keeps the worst case there
  // (MAX_BACKLINK_CHANGES_PERIODS, dfs/backlink-changes.ts) is part of the signed price, not a
  // soft limit. No existing number moved.
  backlink_changes: 35,
  // backlink_details (plan 2026-08-17 §B4, MADDE 1 row #9): the two DataForSEO Backlinks ROW
  // endpoints — the individual links (/backlinks/live) and the target's own pages
  // (/domain_pages_summary/live). SIGNED BY THE OPERATOR 2026-08-17 at 35, the same number as
  // backlink_changes and for the same shape of call: two requests on the Backlinks tariff
  // ($0.024/request + $0.000036/row). The ROW CAPS that keep the worst case inside the signed
  // margin band (MAX_BACKLINK_DETAIL_ROWS 700 + MAX_TARGET_PAGE_ROWS 200 = 900 billed rows,
  // dfs/backlink-details.ts) are part of the signed price, not a soft limit: at the vendor's own
  // 1,000-per-request ceiling the margin would fall through the signed floor. No existing number
  // moved.
  backlink_details: 35,
  // disavow_candidates (plan 2026-08-17 §B3, MADDE 1 row #8): THREE DataForSEO Backlinks requests
  // — the spam-filtered link window, the vendor's per-domain bulk_spam_score for the domains that
  // window named, and the referring IP networks. SIGNED BY THE OPERATOR 2026-08-17 at 40 (down
  // from the v1 draft's 55; the gap map's 55 is the stale figure and the signature is later).
  // The signature records this row's worst-case margin as 2.8x — BELOW the x3 band — and writes
  // its own remedy: "Çözüm fiyat değil kapak … Kapak koda yazılır, ve `limit`'in 1000'e çıkmasına
  // izin verilmez." So the ROW CAPS in dfs/disavow-candidates.ts (300 link rows + 200 candidate
  // domains + 50 network rows = 550 billed rows, margin 5.40x) are part of the signed price, not
  // a soft limit: at the vendor's own 1,000-per-request ceiling the same three requests bill
  // $0.180 and the margin collapses to 2.76x — the sub-band number the signature flagged. The
  // price was not moved to fit the caps; the caps were derived to hold the price. No existing
  // number moved.
  disavow_candidates: 40,
  find_quick_wins: 10,
  detect_cannibalization: 10,
  analyze_content_decay: 10,
  audit_onpage: 30,
  audit_tech: 15,
  audit_schema: 5,
  // audit_speed (plan 2026-08-17 §B6): Google Lighthouse through DataForSEO's OnPage API, up to
  // five page URLs per call. SIGNED BY THE OPERATOR 2026-08-17 at 15 — the same anchor as
  // audit_tech, and the `urls <= 5` cap is part of the signed price, not a soft limit. Measured
  // vendor cost: $0.005 per page, so five pages list at $0.025 against $0.186 of revenue (15
  // credits x $0.0124) — a 7.4x margin, inside the band. NEVER #6: this number does not move
  // without a fresh human signature across code + docs + pricing.
  audit_speed: 15,
  // audit_content (plan 2026-08-14 §4-N8 / §5): the GSC × crawl join — queries the site earns
  // impressions for whose words are missing from the page's own title and h1s. It reads TWO
  // stored measurements and calls no paid API, so the price is the analysis, not a vendor cost.
  // PROPOSED AT 12 AND NOT YET SIGNED — NEVER #6: this number is invalid until a human approves
  // it across code + docs + pricing, and the PR carrying it is parked for that signature.
  audit_content: 12,
  // The two AI-VISIBILITY tools (2026-08-17 signature package, MADDE 2 — SIGNED BY THE OPERATOR).
  // DataForSEO's LLM Mentions family: what a language model said about a domain or a keyword, on
  // ONE platform, in ONE locale. The tariff is $0.10 per request + $0.001 per returned row — ten
  // times the per-request cost of every other family this product touches — so the ROW CAP is what
  // holds these numbers up, not a soft limit: at MAX_INTERNAL_LIST_ROWS (100, dfs/llm-mentions.ts)
  // one lookup bills $0.20 against $1.116 of revenue (5.58x), and UNCAPPED at 1,000 rows it bills
  // $1.10 against the same $1.116 — a margin of 1.01x, i.e. gone. The signature says so in its own
  // words and makes `internal_list_limit <= 100` MANDATORY.
  ai_visibility: 90,
  // ai_visibility_compare is the ONLY PER-UNIT price in this table: the signed number is 90 credits
  // PER COMPARED TARGET over 2-10 targets, so one call charges 180-900. The number below is the
  // UNIT price, never the call price — see CREDIT_UNITS, which is what makes that readable to the
  // machinery (creditCostFor) instead of leaving 90 to be mistaken for a flat fee. The comparison
  // is ONE vendor request (cross_aggregated_metrics takes all 2-10 groups natively), which is why
  // the per-target margin RISES with the target count rather than falling.
  ai_visibility_compare: 90,
  generate_report: 15,
  whats_next: 0,
  // The Search Console property-management surface (2026-08-13, operator-approved scope
  // change): three tools that read and rewrite the user's OWN mapping rows and call no paid
  // API, so all three are 0. No existing number moved — the table grew by three zeros.
  list_gsc_properties: 0,
  track_gsc_property: 0,
  untrack_project: 0,
} as const;

export type ToolName = keyof typeof TOOL_COSTS;

/**
 * THE PER-UNIT PRICES — the one shape TOOL_COSTS alone cannot express.
 *
 * Every price above is what ONE CALL costs. `ai_visibility_compare` is the first signed price that
 * is not: the operator signed 90 credits PER COMPARED TARGET over 2-10 targets, so one call costs
 * 180-900. Three ways of not saying that were rejected before this table was written:
 *
 *   - charging the flat 90 for any target count gives away up to 810 credits of SIGNED value per
 *     call, which is a price change nobody signed (NEVER #6);
 *   - writing 900 into TOOL_COSTS and refunding the difference bills every 2-target comparison at
 *     ten targets' price until a refund lands, and invents a refund path the ledger does not have;
 *   - letting the tool hand withCredits its own credit AMOUNT moves the price out of this
 *     human-approved table and into a handler, which is exactly what the table exists to prevent.
 *
 * So the tool supplies a bounded COUNT and this table keeps the price: `creditCostFor` multiplies,
 * and `min_units`/`max_units` are what ONE CALL can really cost — 2 x 90 = 180 at the floor and
 * 10 x 90 = 900 at the ceiling. The 900 is ABOVE the registry's 200-credit D17 confirmation
 * threshold, so a wide comparison asks the caller first. That is the intended behaviour, not a
 * side effect (the signature calls the 900 out by name). The docs generator renders that range
 * rather than the bare 90, because "90 credits" on a page about a 2-10 target comparison is a
 * number no call ever costs.
 *
 * The bounds are stated here rather than imported from dfs/llm-mentions.ts on purpose: this module
 * is the price table and must stay free of runtime dependencies (apps/web imports it directly in a
 * jsdom test). costs.test.ts pins them EQUAL to MIN_COMPARE_TARGETS / MAX_COMPARE_TARGETS, so the
 * two cannot drift.
 */
export const CREDIT_UNITS = {
  ai_visibility_compare: { unit: "compared target", min_units: 2, max_units: 10 },
} as const satisfies Partial<
  Record<ToolName, { readonly unit: string; readonly min_units: number; readonly max_units: number }>
>;

/** A tool whose TOOL_COSTS entry is a PER-UNIT price rather than a per-call one. */
export type PerUnitToolName = keyof typeof CREDIT_UNITS;

/** Whether `tool` is priced per unit (and therefore may be charged for more than one unit). */
export function isPerUnitTool(tool: ToolName): tool is PerUnitToolName {
  return tool in CREDIT_UNITS;
}

/**
 * What ONE call of `tool` costs when it buys `units` priced units.
 *
 * The ONE place a credit amount is derived, so the multiplication cannot be re-implemented (and
 * mis-implemented) at a call site. `units` is a COUNT the caller's own request implies — the number
 * of compared targets — never a price: the per-unit figure stays TOOL_COSTS'.
 *
 * Fail-closed in both directions, and in THREE ways rather than two. A per-call tool asked to
 * charge for more than one unit THROWS rather than silently multiplying a flat price. A per-unit
 * tool asked for a count outside min_units..max_units throws rather than charging for a call the
 * vendor would refuse anyway. And a per-unit tool asked with NO count at all throws rather than
 * defaulting to one — the third case, and the one this signature originally got wrong.
 *
 * That third case is why `units` has no default. With `units = 1` an OMISSION was indistinguishable
 * from an explicit 1, so `creditCostFor("ai_visibility_compare")` returned the bare 90: the flat
 * price for a tool whose cheapest signed call is 180 and whose dearest is 900. Every call site
 * happened to pass the count, so nothing was mispriced — but the shape meant a call site DROPPING
 * `units:` (a refactor, a new caller) would give away up to 810 credits of signed value silently
 * and stay green, which is the NEVER #6 shape this whole mechanism exists to prevent. Omission is
 * now an error for a per-unit tool; for a per-call tool it stays the ordinary, overwhelmingly
 * common path and means exactly what it always meant.
 *
 * min_units is likewise ENFORCED here, not merely stored: it was rendered on the pricing page and
 * pinned in tests while the range check read `units < 1`, so a one-target comparison priced at 90
 * passed a floor the operator signed at 180.
 *
 * All three are internal errors — the tool surfaces bound the count in zod long before this — so
 * they are loud.
 */
export function creditCostFor(tool: ToolName, units?: number): number {
  const rule = isPerUnitTool(tool) ? CREDIT_UNITS[tool] : null;
  if (rule === null) {
    if (units !== undefined && units !== 1) {
      throw new Error(
        `"${tool}" is priced per call, so it cannot be charged for ${units} units. Only ` +
          `${Object.keys(CREDIT_UNITS).join(", ")} carry a per-unit price.`,
      );
    }
    return TOOL_COSTS[tool];
  }
  if (units === undefined) {
    throw new Error(
      `"${tool}" is priced per ${rule.unit}, so the call must say how many it buys. Charging it ` +
        `without a unit count would bill one call's flat ${TOOL_COSTS[tool]} for up to ` +
        `${rule.max_units} ${rule.unit}s.`,
    );
  }
  if (!Number.isInteger(units) || units < rule.min_units || units > rule.max_units) {
    throw new Error(
      `"${tool}" is priced per ${rule.unit} and charges for ${rule.min_units} to ` +
        `${rule.max_units} of them; ${units} is outside that range.`,
    );
  }
  return TOOL_COSTS[tool] * units;
}
