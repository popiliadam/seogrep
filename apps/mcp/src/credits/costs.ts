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
