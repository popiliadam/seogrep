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
  find_quick_wins: 10,
  detect_cannibalization: 10,
  analyze_content_decay: 10,
  audit_onpage: 30,
  audit_tech: 15,
  audit_schema: 5,
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
