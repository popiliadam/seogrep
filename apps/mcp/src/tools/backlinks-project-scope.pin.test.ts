import { vi } from "vitest";
import {
  BARE_TARGET,
  PROJECT_ID,
  describeProjectScope,
  loadProject,
  writeRun,
  type ProjectScopeCase,
} from "../test/project-scope-pin.ts";
import { currentRecorder } from "../test/ledger-recorder.ts";
import summaryFixture from "../dfs/fixtures/backlinks-summary.json";
import referringDomainsFixture from "../dfs/fixtures/backlinks-referring-domains.json";
import anchorsFixture from "../dfs/fixtures/backlinks-anchors.json";
import newLostFixture from "../dfs/fixtures/backlinks-timeseries-new-lost-summary.json";
import changesSummaryFixture from "../dfs/fixtures/backlinks-timeseries-summary.json";
import backlinksListFixture from "../dfs/fixtures/backlinks-list.json";
import targetPagesFixture from "../dfs/fixtures/backlinks-domain-pages-summary.json";
import spamLinksFixture from "../dfs/fixtures/backlinks-filtered-spam.json";
import spamScoresFixture from "../dfs/fixtures/backlinks-bulk-spam-score.json";
import networksFixture from "../dfs/fixtures/backlinks-referring-networks.json";
import linkGapFixture from "../dfs/fixtures/backlinks-domain-intersection.json";

/** H-1 for the backlink family and link_gap. The argument is in test/project-scope-pin.ts. */

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => currentRecorder().client,
}));

const { makeAnalyzeBacklinksTool } = await import("./analyze-backlinks.ts");
const { makeBacklinkChangesTool } = await import("./backlink-changes.ts");
const { makeBacklinkDetailsTool } = await import("./backlink-details.ts");
const { makeDisavowCandidatesTool } = await import("./disavow-candidates.ts");
const { makeLinkGapTool } = await import("./link-gap.ts");
const { createMockBacklinksPort } = await import("../dfs/backlinks.ts");
const { createMockBacklinkChangesPort } = await import("../dfs/backlink-changes.ts");
const { createMockBacklinkDetailsPort } = await import("../dfs/backlink-details.ts");
const { createMockDisavowCandidatesPort } = await import("../dfs/disavow-candidates.ts");
const { createMockLinkGapPort } = await import("../dfs/link-gap.ts");

/** `min_backlink_spam_score` is REQUIRED and deliberately has no default (disavow-candidates.ts). */
const SPAM_FLOOR = 50;

const CASES: readonly ProjectScopeCase[] = [
  {
    tool: "analyze_backlinks",
    make: () =>
      makeAnalyzeBacklinksTool({
        port: createMockBacklinksPort({
          summary: summaryFixture,
          referringDomains: referringDomainsFixture,
          anchors: anchorsFixture,
        }),
        loadProject,
        writeRun,
      }),
    project: { project_id: PROJECT_ID },
    bare: { target: BARE_TARGET },
  },
  {
    tool: "backlink_changes",
    make: () =>
      makeBacklinkChangesTool({
        port: createMockBacklinkChangesPort(newLostFixture, changesSummaryFixture),
        loadProject,
        writeRun,
      }),
    project: { project_id: PROJECT_ID },
    bare: { target: BARE_TARGET },
  },
  {
    tool: "backlink_details",
    make: () =>
      makeBacklinkDetailsTool({
        port: createMockBacklinkDetailsPort({
          backlinks: backlinksListFixture,
          targetPages: targetPagesFixture,
        }),
        loadProject,
        writeRun,
      }),
    project: { project_id: PROJECT_ID },
    bare: { target: BARE_TARGET },
  },
  {
    tool: "disavow_candidates",
    make: () =>
      makeDisavowCandidatesTool({
        port: createMockDisavowCandidatesPort({
          backlinks: spamLinksFixture,
          bulkSpamScore: spamScoresFixture,
          referringNetworks: networksFixture,
        }),
        loadProject,
        writeRun,
      }),
    project: { project_id: PROJECT_ID, min_backlink_spam_score: SPAM_FLOOR },
    bare: { target: BARE_TARGET, min_backlink_spam_score: SPAM_FLOOR },
  },
  {
    tool: "link_gap",
    make: () => makeLinkGapTool({ port: createMockLinkGapPort(linkGapFixture), loadProject }),
    project: { project_id: PROJECT_ID, competitor: "rival.com" },
    bare: { target: BARE_TARGET, competitor: "rival.com" },
  },
];

describeProjectScope(CASES);
