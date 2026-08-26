import type { RegisteredTool } from "./registry.ts";
import { setupProjectTool } from "./setup-project.ts";
import { connectGscTool } from "./connect-gsc.ts";
import { listProjectsTool } from "./list-projects.ts";
import { getCreditBalanceTool } from "./get-credit-balance.ts";
import { listCreditActivityTool } from "./list-credit-activity.ts";
import { crawlSiteTool } from "./crawl-site.ts";
import { getJobStatusTool } from "./get-job-status.ts";
import { listJobsTool } from "./list-jobs.ts";
import { pullGscDataTool } from "./pull-gsc-data.ts";
import { findQuickWinsTool } from "./find-quick-wins.ts";
import { detectCannibalizationTool } from "./detect-cannibalization.ts";
import { analyzeContentDecayTool } from "./analyze-content-decay.ts";
import { auditOnpageTool } from "./audit-onpage.ts";
import { auditTechTool } from "./audit-tech.ts";
import { auditSchemaTool } from "./audit-schema.ts";
import { auditSpeedTool } from "./audit-speed.ts";
import { auditContentTool } from "./audit-content.ts";
import { researchKeywordsTool } from "./research-keywords.ts";
import { discoverKeywordsTool } from "./discover-keywords.ts";
import { myPagesTool } from "./my-pages.ts";
import { rankedKeywordsTool } from "./ranked-keywords.ts";
import { analyzeBacklinksTool } from "./analyze-backlinks.ts";
import { compareCompetitorsTool } from "./compare-competitors.ts";
import { keywordGapTool } from "./keyword-gap.ts";
import { linkGapTool } from "./link-gap.ts";
import { backlinkChangesTool } from "./backlink-changes.ts";
import { backlinkDetailsTool } from "./backlink-details.ts";
import { disavowCandidatesTool } from "./disavow-candidates.ts";
import { aiVisibilityTool } from "./ai-visibility.ts";
import { aiVisibilityCompareTool } from "./ai-visibility-compare.ts";
import { generateReportTool } from "./generate-report.ts";
import { whatsNextTool } from "./whats-next.ts";
import { listGscPropertiesTool } from "./list-gsc-properties.ts";
import { trackGscPropertyTool } from "./track-gsc-property.ts";
import { untrackProjectTool } from "./untrack-project.ts";
import { trackKeywordsTool } from "./track-keywords.ts";
import { keywordPositionsTool } from "./keyword-positions.ts";
import { serpSnapshotTool } from "./serp-snapshot.ts";

export * from "./registry.ts";
export { setupProjectTool } from "./setup-project.ts";
export { connectGscTool } from "./connect-gsc.ts";
export {
  listProjectsTool,
  formatProjectList,
  NO_PROJECTS_MESSAGE,
  NO_TRACKED_PROJECTS_MESSAGE,
} from "./list-projects.ts";
export type { ProjectListRow } from "./list-projects.ts";
export { getCreditBalanceTool } from "./get-credit-balance.ts";
export {
  listCreditActivityTool,
  makeListCreditActivityTool,
  formatCreditActivity,
  formatActivityLine,
  formatDelta,
  kindLabel,
  listOwnCreditActivity,
  DEFAULT_ACTIVITY_LIMIT,
  MAX_ACTIVITY_LIMIT,
  NO_ACTIVITY_MESSAGE,
} from "./list-credit-activity.ts";
export type { CreditActivityRow, ListCreditActivityFn } from "./list-credit-activity.ts";
export { crawlSiteTool } from "./crawl-site.ts";
export { getJobStatusTool } from "./get-job-status.ts";
export {
  listJobsTool,
  makeListJobsTool,
  formatJobList,
  formatJobLine,
  listOwnJobs,
  DEFAULT_JOB_LIST_LIMIT,
  MAX_JOB_LIST_LIMIT,
  NO_JOBS_MESSAGE,
} from "./list-jobs.ts";
export type { JobListRow, ListJobsFn } from "./list-jobs.ts";
export { pullGscDataTool } from "./pull-gsc-data.ts";
export { findQuickWinsTool } from "./find-quick-wins.ts";
export { detectCannibalizationTool } from "./detect-cannibalization.ts";
export { analyzeContentDecayTool } from "./analyze-content-decay.ts";
export { auditOnpageTool } from "./audit-onpage.ts";
export { auditTechTool } from "./audit-tech.ts";
export { auditSchemaTool } from "./audit-schema.ts";
export { auditSpeedTool, makeAuditSpeedTool } from "./audit-speed.ts";
export {
  auditContentTool,
  makeAuditContentTool,
  makeContentAuditTool,
  renderContentAudit,
} from "./audit-content.ts";
export { researchKeywordsTool } from "./research-keywords.ts";
export {
  discoverKeywordsTool,
  makeDiscoverKeywordsTool,
  formatDiscoverKeywords,
} from "./discover-keywords.ts";
export { myPagesTool, makeMyPagesTool, formatMyPages } from "./my-pages.ts";
export { joinPages, loadCrawlSide, toCrawledPage } from "./my-pages-crawl.ts";
export type { CrawlSide, CrawledPage, LoadCrawlSideFn, MatchedPage, PageJoin } from "./my-pages-crawl.ts";
export { rankedKeywordsTool, makeRankedKeywordsTool } from "./ranked-keywords.ts";
export { analyzeBacklinksTool, makeAnalyzeBacklinksTool } from "./analyze-backlinks.ts";
export { compareCompetitorsTool, makeCompareCompetitorsTool } from "./compare-competitors.ts";
export { keywordGapTool, makeKeywordGapTool, formatKeywordGap } from "./keyword-gap.ts";
export { linkGapTool, makeLinkGapTool, formatLinkGap } from "./link-gap.ts";
export {
  backlinkChangesTool,
  makeBacklinkChangesTool,
  formatBacklinkChanges,
} from "./backlink-changes.ts";
export {
  backlinkDetailsTool,
  makeBacklinkDetailsTool,
  formatBacklinkDetails,
} from "./backlink-details.ts";
export {
  disavowCandidatesTool,
  makeDisavowCandidatesTool,
  formatDisavowCandidates,
} from "./disavow-candidates.ts";
export {
  aiVisibilityTool,
  makeAiVisibilityTool,
  formatAiVisibility,
} from "./ai-visibility.ts";
export {
  aiVisibilityCompareTool,
  makeAiVisibilityCompareTool,
  formatAiVisibilityCompare,
  comparedTargetCount,
} from "./ai-visibility-compare.ts";
export { generateReportTool, makeGenerateReportTool } from "./generate-report.ts";
export { whatsNextTool, makeWhatsNextTool } from "./whats-next.ts";
export { listGscPropertiesTool, makeListGscPropertiesTool } from "./list-gsc-properties.ts";
export { trackGscPropertyTool, makeTrackGscPropertyTool } from "./track-gsc-property.ts";
export { untrackProjectTool, makeUntrackProjectTool } from "./untrack-project.ts";
export { trackKeywordsTool, makeTrackKeywordsTool } from "./track-keywords.ts";
export {
  keywordPositionsTool,
  makeKeywordPositionsTool,
} from "./keyword-positions.ts";
export { formatKeywordPositions } from "./keyword-positions-format.ts";
export {
  serpSnapshotTool,
  makeSerpSnapshotTool,
  serpKeywordCount,
  serpSnapshotCredits,
} from "./serp-snapshot.ts";
export { formatSerpSnapshot } from "./serp-snapshot-format.ts";
export {
  bestPlacement,
  measurementReport,
  measurementRow,
  writeSerpMeasurements,
  MAX_STORED_PLACEMENTS,
} from "./serp-snapshot-store.ts";

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
  // Beside get_credit_balance on purpose: that tool answers "how many credits do I have", this one
  // answers "where did they go". Neighbours in tools/list, and therefore in the docs nav.
  listCreditActivityTool,
  crawlSiteTool,
  getJobStatusTool,
  // Beside get_job_status on purpose, and AFTER it: that tool answers about ONE job and needs its
  // id, this one hands you the ids. The pair is what makes a paid job reachable from a sentence
  // that carries no id at all. Neighbours in tools/list, and therefore in the docs nav.
  listJobsTool,
  pullGscDataTool,
  findQuickWinsTool,
  detectCannibalizationTool,
  analyzeContentDecayTool,
  auditOnpageTool,
  auditTechTool,
  auditSchemaTool,
  auditSpeedTool,
  auditContentTool,
  researchKeywordsTool,
  // Beside research_keywords on purpose: that tool PRICES a list the caller already has, this one
  // asks the vendor to produce one. Neighbours in tools/list, and therefore in the docs nav.
  discoverKeywordsTool,
  // Beside the keyword tools and BEFORE ranked_keywords on purpose: ranked_keywords answers "what
  // keywords does this domain rank for", my_pages answers "which PAGES does it rank with" — the
  // page axis of the same question, and the endpoint that does NOT return keywords. Neighbours in
  // tools/list, and therefore in the docs nav, so the two are read together.
  myPagesTool,
  rankedKeywordsTool,
  analyzeBacklinksTool,
  compareCompetitorsTool,
  keywordGapTool,
  linkGapTool,
  backlinkChangesTool,
  backlinkDetailsTool,
  disavowCandidatesTool,
  // The two AI-visibility tools, LAST of the DataForSEO block on purpose: they answer a question
  // none of the tools above touch — what a language model said — rather than what a search engine
  // ranked. Neighbours in tools/list, and therefore in the docs nav, so the single-target tool and
  // its side-by-side companion are read together.
  aiVisibilityTool,
  aiVisibilityCompareTool,
  generateReportTool,
  whatsNextTool,
  listGscPropertiesTool,
  trackGscPropertyTool,
  untrackProjectTool,
  // The rank tracker, LAST and as a TRIO on purpose, in the order a caller uses them: one
  // registers which keywords a project wants watched (free, and it measures nothing), one MEASURES
  // and stores a reading (the only one of the three that spends vendor money), and one reads back
  // what was measured. They are three parts of one subject and none is readable without the
  // others, so they are neighbours in tools/list and therefore in the docs nav.
  trackKeywordsTool,
  serpSnapshotTool,
  keywordPositionsTool,
];
