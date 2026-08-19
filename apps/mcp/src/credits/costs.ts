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
