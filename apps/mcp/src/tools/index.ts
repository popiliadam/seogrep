import type { RegisteredTool } from "./registry.ts";
import { setupProjectTool } from "./setup-project.ts";
import { connectGscTool } from "./connect-gsc.ts";
import { listProjectsTool } from "./list-projects.ts";
import { getCreditBalanceTool } from "./get-credit-balance.ts";
import { crawlSiteTool } from "./crawl-site.ts";
import { getJobStatusTool } from "./get-job-status.ts";
import { pullGscDataTool } from "./pull-gsc-data.ts";
import { findQuickWinsTool } from "./find-quick-wins.ts";
import { detectCannibalizationTool } from "./detect-cannibalization.ts";
import { analyzeContentDecayTool } from "./analyze-content-decay.ts";
import { auditOnpageTool } from "./audit-onpage.ts";
import { auditTechTool } from "./audit-tech.ts";
import { auditSchemaTool } from "./audit-schema.ts";
import { researchKeywordsTool } from "./research-keywords.ts";
import { generateReportTool } from "./generate-report.ts";

export * from "./registry.ts";
export { setupProjectTool } from "./setup-project.ts";
export { connectGscTool } from "./connect-gsc.ts";
export { listProjectsTool } from "./list-projects.ts";
export { getCreditBalanceTool } from "./get-credit-balance.ts";
export { crawlSiteTool } from "./crawl-site.ts";
export { getJobStatusTool } from "./get-job-status.ts";
export { pullGscDataTool } from "./pull-gsc-data.ts";
export { findQuickWinsTool } from "./find-quick-wins.ts";
export { detectCannibalizationTool } from "./detect-cannibalization.ts";
export { analyzeContentDecayTool } from "./analyze-content-decay.ts";
export { auditOnpageTool } from "./audit-onpage.ts";
export { auditTechTool } from "./audit-tech.ts";
export { auditSchemaTool } from "./audit-schema.ts";
export { researchKeywordsTool } from "./research-keywords.ts";
export { generateReportTool, makeGenerateReportTool } from "./generate-report.ts";

/**
 * The production tool set, in tools/list order. The composition root (server.ts
 * buildDefaultDeps) wires this; unit tests inject their own tool arrays, and the
 * gateway's DB-free specs inject none (so tools/list stays empty there).
 */
export const ALL_TOOLS: readonly RegisteredTool[] = [
  setupProjectTool,
  connectGscTool,
  listProjectsTool,
  getCreditBalanceTool,
  crawlSiteTool,
  getJobStatusTool,
  pullGscDataTool,
  findQuickWinsTool,
  detectCannibalizationTool,
  analyzeContentDecayTool,
  auditOnpageTool,
  auditTechTool,
  auditSchemaTool,
  researchKeywordsTool,
  generateReportTool,
];
