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
  // The rank tracker's two tools (plan 2026-08-17 signature package, MADDE 1 rows #3 and #5 —
  // SIGNED BY THE OPERATOR). Neither calls a paid API, and the two zeros of the signature are two
  // different zeros:
  //
  // track_keywords = 0 (row #3). Registration only: it records which keywords a project wants
  // watched and takes no measurement at all, so there is no vendor cost and nothing to price. It
  // joins the three 0-credit Search Console tools above on exactly that ground.
  track_keywords: 0,
  // keyword_positions = 10 (row #5, "saklanmışı okur" — it reads what was stored). Vendor cost
  // $0.00: the measurements it reads were paid for when they were TAKEN, by the tool that spends
  // the DataForSEO money, so the margin here is not a ratio at all. The 10 is the analysis, and it
  // is anchored on the three stored-measurement scans (find_quick_wins / detect_cannibalization /
  // analyze_content_decay, 10 each) rather than on any DataForSEO family — the same question those
  // three answer about stored data, on a different axis. It is NOT on the paid-balance gate: that
  // gate lists the tools that can spend vendor money, and this one cannot reach reserveSpend
  // (paid-balance.graph.test.ts derives that from the import graph rather than from this comment).
  // No existing number moved.
  keyword_positions: 10,
  // serp_snapshot = 8 PER KEYWORD, on top of a fixed 5 per call — the MEASURING sibling of the two
  // rows above (MADDE 1 row #4 of the same 2026-08-17 signature package, SIGNED BY THE OPERATOR;
  // its keyword cap counter-signed 2026-08-24 as option A1). The 8 here is the UNIT price and is
  // never a call price: CREDIT_UNITS below carries the 5, and one call costs 13 to 85.
  //
  // The vendor cost was MEASURED: DataForSEO's live SERP tariff is FLAT PER REQUEST ($0.02 at the
  // pinned depth of 100) with no per-row term, and `keyword` is SINGULAR in the vendor's own
  // contract — so an N-keyword snapshot is N requests, not one batched one. That is why this price
  // has a base at all: the fixed 5 amortises as N grows, so the margin FALLS with the count (8.06x
  // at one keyword, 5.27x at ten) and the worst case sits at the CAP rather than at the floor.
  //
  // MAX_SERP_KEYWORDS (10, dfs/serp.ts) is therefore PART OF THE SIGNED PRICE, not a soft limit: it
  // is the largest count at which the signature's own "worst case 5.3x" is still true — eleven
  // keywords give 5.24x, and no cap however wide can reach 5.3x again without moving the price (the
  // asymptote is 4.96x). SERP_DEPTH (100) is pinned for the same reason: depth 10 is a different
  // vendor price tier, so a caller-chosen depth would be a caller-chosen price. Moving either is
  // NEVER #6. No existing number moved.
  serp_snapshot: 8,
} as const;

export type ToolName = keyof typeof TOOL_COSTS;

/**
 * ONE per-unit price rule: what a unit is called, what one call costs before any units are counted,
 * and how many units one call may buy.
 *
 * `base` is the SECOND shape TOOL_COSTS cannot express, and it exists because a signed price asked
 * for it: `serp_snapshot` (signature package 2026-08-17, MADDE 1 row #4) is **5 credits + 8 per
 * keyword**, i.e. a fixed part that does not scale with the count and a variable part that does.
 * `unit x N` alone can express neither half of that without lying about the other: pricing it at 13
 * per keyword overcharges every call above one keyword, and pricing it at 8 gives the fixed 5 away.
 *
 * It is OPTIONAL, and `ai_visibility_compare` carries none — which is what keeps that rule
 * byte-identical: an absent base is 0, and `0 + 90 x n` is `90 x n`. A base of 0 written out and an
 * absent base mean exactly the same thing and must stay indistinguishable in the arithmetic.
 *
 * NEVER #6 applies to `base` exactly as it applies to TOOL_COSTS: it is a PRICE, and it does not move
 * without a human signature across code + docs + pricing.
 */
export interface PerUnitPriceRule {
  /** The thing being counted, in words, for the message a caller reads ("compared target"). */
  readonly unit: string;
  /**
   * Credits charged ONCE per call, whatever the count. Absent means 0 — the shape
   * `ai_visibility_compare` has. See {@link creditsForUnits} for the one place it is added.
   */
  readonly base?: number;
  readonly min_units: number;
  readonly max_units: number;
}

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
 * `serp_snapshot` is the SECOND, and the first to use `base`: the operator signed 5 credits per call
 * PLUS 8 per keyword over 1-10 keywords, so one call costs 13 to 85. Both halves are prices and both
 * are covered by NEVER #6. Two shapes were available and neither is honest — folding the 5 into the
 * unit (13 per keyword) overcharges every call above one keyword by 5 credits a keyword, and dropping
 * it (8 per keyword) gives the signed fixed part away on every call — which is precisely the gap
 * `base` was added to close.
 *
 * ITS max_units IS THE SIGNED WORST CASE, not a comfort limit. The margin falls with the count
 * because the base amortises, so 10 is the largest cap at which the signature's own 5.3x is still
 * true; a wider one would price a call nobody signed. Its min_units is 1 — one keyword is a
 * legitimate snapshot, and a zero-keyword call would otherwise be priced at the bare base.
 *
 * The bounds are stated here rather than imported from dfs/llm-mentions.ts and dfs/serp.ts on
 * purpose: this module is the price table and must stay free of runtime dependencies (apps/web
 * imports it directly in a jsdom test). costs.test.ts pins them EQUAL to the ports' own
 * MIN/MAX constants, so the two cannot drift.
 */
export const CREDIT_UNITS = {
  ai_visibility_compare: { unit: "compared target", min_units: 2, max_units: 10 },
  serp_snapshot: { unit: "keyword", base: 5, min_units: 1, max_units: 10 },
} as const satisfies Partial<Record<ToolName, PerUnitPriceRule>>;

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
 * of compared targets — never a price: the per-unit figure stays TOOL_COSTS', and the fixed part (a
 * rule's `base`, carried today by `serp_snapshot`) stays CREDIT_UNITS'. The arithmetic itself lives
 * in {@link creditsForUnits}, which is also where the count is bounded.
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
  if (!isPerUnitTool(tool)) {
    if (units !== undefined && units !== 1) {
      throw new Error(
        `"${tool}" is priced per call, so it cannot be charged for ${units} units. Only ` +
          `${Object.keys(CREDIT_UNITS).join(", ")} carry a per-unit price.`,
      );
    }
    return TOOL_COSTS[tool];
  }
  return creditsForUnits(tool, CREDIT_UNITS[tool], TOOL_COSTS[tool], units);
}

/**
 * THE ONE PLACE `base + unit x count` IS COMPUTED — and the one place the count is enforced.
 *
 * Split out of {@link creditCostFor} rather than inlined so that a per-unit price can be exercised
 * as ARITHMETIC before its tool exists. `serp_snapshot`'s signed 5 + 8 per keyword cannot be added
 * to TOOL_COSTS in the slice that built its port: a non-zero TOOL_COSTS row with no pricing-page row
 * turns apps/web's pricing spec RED in three places (MEASURED), which is exactly the gate that keeps
 * a price from shipping ahead of the tool it prices. So the rule is proven here, against the signed
 * numbers, and the table stays untouched until the tool lands.
 *
 * `label` is only ever a tool name in production; it is a plain string so the same enforcement can
 * be measured against a rule whose tool is not in the table yet.
 *
 * Everything it refuses, it refuses LOUDLY (internal errors — the tool surfaces bound the count in
 * zod long before this):
 *   - OMISSION      — a per-unit tool asked with no count at all. Never a silent 1: with a default
 *                     of 1 an omission was indistinguishable from an explicit 1, and a call site
 *                     dropping `units:` gave away up to 810 signed credits while staying green.
 *   - BELOW  min    — `min_units` is ENFORCED here, not merely stored. It was rendered on the
 *                     pricing page and pinned in tests while the range check read `units < 1`, so a
 *                     one-target comparison priced at 90 passed a floor the operator signed at 180.
 *   - ABOVE  max    — pricing a call the vendor would refuse anyway.
 *   - NON-INTEGER   — half a unit is not a count.
 *   - A RULE THAT IS NOT A PRICE — see {@link assertPriceRuleIsWellFormed} directly below, and read
 *                     the paragraph after this list for what that does and does NOT buy.
 *
 * WHAT THIS FUNCTION GUARANTEES ABOUT ITS ARGUMENTS, AND WHAT IT CANNOT.
 *
 * It GUARANTEES, for every call, that the four numbers it multiplies and adds are numbers a price
 * could be made of: `base` and `unitCredits` are non-negative whole credits, `min_units` is a whole
 * count of at least 1, and `max_units` is a whole count no lower than `min_units` (the checks below,
 * pinned by their own specs). What follows from that alone is worth naming, because it is exactly
 * what the arithmetic would otherwise take on trust: the returned amount is a non-negative integer,
 * it never DECREASES as the count rises, and no in-range count can price a call below the floor
 * `min_units` was signed at.
 *
 * It does NOT — and CANNOT — guarantee that the rule it was handed is a rule anybody SIGNED. The
 * `rule` and `unitCredits` arrive as parameters rather than being looked up from CREDIT_UNITS and
 * TOOL_COSTS by name, deliberately (see the paragraph above about proving a price as arithmetic
 * before its tool exists, which the specs in costs.test.ts rely on), and that is a hole with a
 * shape: nothing here can tell `serp_snapshot`'s signed `base: 5` from a `base: 4` a future handler
 * invented, because both are well-formed. Well-formed is not approved.
 *
 * What holds THAT line is one level up, and is unaffected by these checks: {@link creditCostFor}
 * reads both numbers out of the human-approved tables by tool name and is the only path a real
 * charge takes (guard.ts calls it; no handler calls this function to bill), and both tables are
 * pinned byte-for-byte in costs.test.ts, so an edited price fails there before it can be charged.
 * The checks below therefore protect the DIRECT caller — the arithmetic-before-the-tool path, and
 * any future rule on its way into the table — not today's two signed rules, which cannot hold a
 * malformed value without failing the byte-pins first.
 */
export function creditsForUnits(
  label: string,
  rule: PerUnitPriceRule,
  unitCredits: number,
  units: number | undefined,
): number {
  const base = rule.base ?? 0;
  assertPriceRuleIsWellFormed(label, rule, base, unitCredits);
  if (units === undefined) {
    throw new Error(
      `"${label}" is priced per ${rule.unit}, so the call must say how many it buys. Charging it ` +
        `without a unit count would bill one call's flat ${base + unitCredits} for up to ` +
        `${rule.max_units} ${rule.unit}s.`,
    );
  }
  if (!Number.isInteger(units) || units < rule.min_units || units > rule.max_units) {
    throw new Error(
      `"${label}" is priced per ${rule.unit} and charges for ${rule.min_units} to ` +
        `${rule.max_units} of them; ${units} is outside that range.`,
    );
  }
  return base + unitCredits * units;
}

/**
 * THE RULE ITSELF, CHECKED — the preconditions `base + unit x count` was silently taking on trust.
 *
 * {@link creditsForUnits} refused everything about the COUNT and nothing about the PRICE it counted
 * against: `rule.base ?? 0` accepted a negative base, `unitCredits` accepted any number at all, and
 * a floor of 0 or a ceiling below its own floor were simply arithmetic. Each of those computes a
 * number and returns it, which is the shape that mis-charges a tenant while every gate stays green.
 *
 * A NEGATIVE BASE IS NOT CAUGHT BY THE RANGE PIN ABOVE IT, measured rather than assumed: the loop in
 * costs.test.ts that prices every rule at both ends asserts the floor is `> 0`, and on the signed
 * `serp_snapshot` rule (unit 8, min_units 1) a base of -5 gives a floor of 3 — greater than zero,
 * with the gap and the base-counted-once assertions both still satisfied, because a negative base is
 * as consistent with `base + unit x N` as a positive one. What catches it on the TABLE is the
 * byte-for-byte `toEqual` pin of CREDIT_UNITS, which no direct caller passes through.
 *
 * So these refusals are for the DIRECT caller: the path costs.ts's own header describes, where a
 * price is proven as arithmetic against a hand-made rule before its tool exists, and where a future
 * rule is shaped before it reaches the signed table. They are LOUD and they are internal errors —
 * every one of them means a caller inside this codebase built a rule that is not a price.
 *
 * Each bound is chosen to be UNREACHABLE by anything currently signed, checked against both tables
 * before it was written: `unitCredits >= 0` admits every TOOL_COSTS value including the zero rows
 * (costs.test.ts pins the whole table as non-negative integers, so this can never reject a signed
 * price), `base >= 0` admits the one base that exists (5) and the absent-means-0 shape, `min_units
 * >= 1` admits 2 and 1, and `max_units >= min_units` admits both 10s. A guard that rejected a signed
 * value would be an outage, not a safeguard.
 */
function assertPriceRuleIsWellFormed(
  label: string,
  rule: PerUnitPriceRule,
  base: number,
  unitCredits: number,
): void {
  // `Number.isInteger` is false for NaN and for both infinities, so "finite" needs no second check.
  const isCreditAmount = (value: number): boolean => Number.isInteger(value) && value >= 0;

  if (!isCreditAmount(base)) {
    throw new Error(
      `"${label}" carries a base of ${base}, which is not a price: the fixed part of a call is ` +
        `charged once per call and must be a whole number of credits, zero or more.`,
    );
  }
  if (!isCreditAmount(unitCredits)) {
    throw new Error(
      `"${label}" is priced at ${unitCredits} per ${rule.unit}, which is not a price: a unit ` +
        `price must be a whole number of credits, zero or more.`,
    );
  }
  if (!Number.isInteger(rule.min_units) || rule.min_units < 1) {
    throw new Error(
      `"${label}" claims a floor of ${rule.min_units} ${rule.unit}s: a priced call buys at least ` +
        `one, so the floor must be a whole number of 1 or more.`,
    );
  }
  if (!Number.isInteger(rule.max_units) || rule.max_units < rule.min_units) {
    throw new Error(
      `"${label}" claims a ceiling of ${rule.max_units} ${rule.unit}s against a floor of ` +
        `${rule.min_units}: the ceiling must be a whole number no lower than the floor.`,
    );
  }
}
