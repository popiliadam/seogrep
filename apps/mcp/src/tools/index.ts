import type { RegisteredTool } from "./registry.ts";
import { setupProjectTool } from "./setup-project.ts";
import { listProjectsTool } from "./list-projects.ts";
import { getCreditBalanceTool } from "./get-credit-balance.ts";
import { crawlSiteTool } from "./crawl-site.ts";
import { getJobStatusTool } from "./get-job-status.ts";

export * from "./registry.ts";
export { setupProjectTool } from "./setup-project.ts";
export { listProjectsTool } from "./list-projects.ts";
export { getCreditBalanceTool } from "./get-credit-balance.ts";
export { crawlSiteTool } from "./crawl-site.ts";
export { getJobStatusTool } from "./get-job-status.ts";

/**
 * The production tool set, in tools/list order. The composition root (server.ts
 * buildDefaultDeps) wires this; unit tests inject their own tool arrays, and the
 * gateway's DB-free specs inject none (so tools/list stays empty there).
 */
export const ALL_TOOLS: readonly RegisteredTool[] = [
  setupProjectTool,
  listProjectsTool,
  getCreditBalanceTool,
  crawlSiteTool,
  getJobStatusTool,
];
