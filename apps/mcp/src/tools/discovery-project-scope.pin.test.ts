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
import aggregatedFixture from "../dfs/fixtures/llm-mentions-aggregated-metrics.json";
import crossFixture from "../dfs/fixtures/llm-mentions-cross-aggregated-metrics.json";
import forSiteFixture from "../dfs/fixtures/labs-keywords-for-site.json";
import serpFixture from "../dfs/fixtures/serp-organic-live-advanced.json";

/**
 * H-1 for the three tools whose project is CONDITIONAL — the argument is in
 * test/project-scope-pin.ts. All three take a subject/mode that decides whether a project can be
 * named at all, so both cases below stay on the domain branch: the axis under test is
 * "project named or not", not "which branch of the schema".
 */

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => currentRecorder().client,
}));

const { makeAiVisibilityTool } = await import("./ai-visibility.ts");
const { makeDiscoverKeywordsTool } = await import("./discover-keywords.ts");
const { makeSerpSnapshotTool } = await import("./serp-snapshot.ts");
const { createMockAiVisibilityPort } = await import("../dfs/llm-mentions.ts");
const { createMockDiscoverKeywordsPort } = await import("../dfs/discover-keywords.ts");
const { createMockSerpSnapshotPort } = await import("../dfs/serp.ts");

/** Pinned so `fetched_at` is not a race; nothing here asserts on it. */
const CLOCK = (): string => "2026-09-03T09:00:00.000Z";

const CASES: readonly ProjectScopeCase[] = [
  {
    tool: "ai_visibility",
    make: () =>
      makeAiVisibilityTool({
        port: createMockAiVisibilityPort({
          aggregated: aggregatedFixture,
          crossAggregated: crossFixture,
        }),
        loadProject,
        writeRun,
      }),
    project: { subject: "domain", project_id: PROJECT_ID, platform: "chat_gpt" },
    bare: { subject: "domain", target: BARE_TARGET, platform: "chat_gpt" },
  },
  {
    tool: "discover_keywords",
    make: () =>
      makeDiscoverKeywordsTool({
        port: createMockDiscoverKeywordsPort({ for_site: forSiteFixture }),
        loadProject,
        writeRun,
      }),
    project: { mode: "for_site", project_id: PROJECT_ID },
    bare: { mode: "for_site", target: BARE_TARGET },
  },
  {
    tool: "serp_snapshot",
    make: () =>
      makeSerpSnapshotTool({
        port: createMockSerpSnapshotPort(serpFixture, CLOCK),
        loadProject,
        writeMeasurements: writeRun,
      }),
    project: { project_id: PROJECT_ID, keywords: ["seo software"] },
    bare: { target: BARE_TARGET, keywords: ["seo software"] },
  },
];

describeProjectScope(CASES);
