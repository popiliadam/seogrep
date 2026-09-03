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
import competitorsFixture from "../dfs/fixtures/competitors-domain.json";
import rankOverviewFixture from "../dfs/fixtures/domain-rank-overview.json";
import rankedKeywordsFixture from "../dfs/fixtures/ranked-keywords.json";
import keywordGapFixture from "../dfs/fixtures/domain-intersection.json";
import relevantPagesFixture from "../dfs/fixtures/labs-relevant-pages.json";

/** H-1 for the domain-ranking family. The argument is in test/project-scope-pin.ts. */

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => currentRecorder().client,
}));

const { makeCompareCompetitorsTool } = await import("./compare-competitors.ts");
const { makeKeywordGapTool } = await import("./keyword-gap.ts");
const { makeMyPagesTool } = await import("./my-pages.ts");
const { makeRankedKeywordsTool } = await import("./ranked-keywords.ts");
const { createMockCompetitorsPort } = await import("../dfs/competitors.ts");
const { createMockKeywordGapPort } = await import("../dfs/keyword-gap.ts");
const { createMockRelevantPagesPort } = await import("../dfs/relevant-pages.ts");
const { createMockRankedKeywordsPort } = await import("../dfs/ranked-keywords.ts");

/** my_pages reads its own crawl side before the reserve; that read is another spec's subject. */
const loadCrawl = async (): Promise<{ kind: "not_requested" }> => ({ kind: "not_requested" });

const CASES: readonly ProjectScopeCase[] = [
  {
    tool: "compare_competitors",
    make: () =>
      makeCompareCompetitorsTool({
        port: createMockCompetitorsPort({
          competitorsDomain: competitorsFixture,
          rankOverviews: { default: rankOverviewFixture },
        }),
        loadProject,
        writeRun,
      }),
    project: { project_id: PROJECT_ID },
    bare: { target: BARE_TARGET },
  },
  {
    tool: "keyword_gap",
    make: () =>
      makeKeywordGapTool({ port: createMockKeywordGapPort(keywordGapFixture), loadProject }),
    project: { project_id: PROJECT_ID, competitor: "rival.com" },
    bare: { target: BARE_TARGET, competitor: "rival.com" },
  },
  {
    tool: "my_pages",
    make: () =>
      makeMyPagesTool({
        port: createMockRelevantPagesPort(relevantPagesFixture),
        loadProject,
        loadCrawl,
        writeRun,
      }),
    project: { project_id: PROJECT_ID },
    bare: { target: BARE_TARGET },
  },
  {
    tool: "ranked_keywords",
    make: () =>
      makeRankedKeywordsTool({
        port: createMockRankedKeywordsPort(rankedKeywordsFixture),
        loadProject,
        writeRun,
      }),
    project: { project_id: PROJECT_ID },
    bare: { target: BARE_TARGET },
  },
];

describeProjectScope(CASES);
