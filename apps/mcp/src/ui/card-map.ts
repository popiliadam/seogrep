import type { ToolName } from "../credits/costs.ts";
import type { CardKind } from "./card-model.ts";

/**
 * Spec §3's table as code: the card kind PLANNED for every tool on the surface.
 *
 * `Record<ToolName, CardKind>` is exhaustive, so adding a tool without deciding its kind fails
 * the build rather than shipping a tool nobody looked at. The count assertions live in the spec
 * next door because a type cannot see that fourteen list tools became thirteen.
 */
export const CARD_KIND_BY_TOOL: Record<ToolName, CardKind> = {
  get_credit_balance: "metric",

  list_projects: "list",
  list_jobs: "list",
  list_credit_activity: "list",
  list_gsc_properties: "list",
  my_pages: "list",
  ranked_keywords: "list",
  keyword_positions: "list",
  research_keywords: "list",
  discover_keywords: "list",
  backlink_details: "list",
  disavow_candidates: "list",
  serp_snapshot: "list",
  link_gap: "list",
  keyword_gap: "list",

  audit_onpage: "report",
  audit_tech: "report",
  audit_schema: "report",
  audit_speed: "report",
  audit_content: "report",
  generate_report: "report",
  find_quick_wins: "report",
  detect_cannibalization: "report",
  analyze_content_decay: "report",
  compare_competitors: "report",
  analyze_backlinks: "report",
  backlink_changes: "report",
  ai_visibility: "report",
  ai_visibility_compare: "report",

  whats_next: "action",
  setup_project: "action",
  crawl_site: "action",
  pull_gsc_data: "action",
  connect_gsc: "action",
  track_gsc_property: "action",
  track_keywords: "action",
  untrack_project: "action",
  get_job_status: "action",
};

/**
 * Which tools SHIP a card today — the rollout front, not the plan.
 *
 * It is separate from the map on purpose: the map says what a tool's card WILL be, this says what
 * a customer can see NOW. Staged rollout (spec §9) makes "planned but not shipped" a legitimate
 * state, and naming it is what stops it from being a silent gap.
 */
export const CARDED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(["get_credit_balance"]);
