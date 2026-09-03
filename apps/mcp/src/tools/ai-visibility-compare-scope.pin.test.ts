import { describe, expect, it, vi } from "vitest";
import {
  CTX,
  FOREIGN_PROJECT_ID,
  PROJECT,
  PROJECT_ID,
  writeRun,
} from "../test/project-scope-pin.ts";
import { currentRecorder, resetRecorder } from "../test/ledger-recorder.ts";
import type { LoadProjectFn } from "./project-target.ts";
import aggregatedFixture from "../dfs/fixtures/llm-mentions-aggregated-metrics.json";
import crossFixture from "../dfs/fixtures/llm-mentions-cross-aggregated-metrics.json";

/**
 * H-1 for `ai_visibility_compare` — the one tool in the family whose call can name SEVERAL
 * projects, and the most expensive in the product (90 credits per compared target, up to 900).
 *
 * The ledger row holds ONE scope, so the rule this pins is the only non-guessing one available:
 * a comparison whose project-backed targets all came from the SAME project is booked against that
 * project; a comparison of two of the caller's own projects, or of none, records no scope at all.
 * Picking the first named target would attribute a 900-credit call to list order (credits/guard.ts
 * — never guess one here).
 *
 * Two targets rather than three deliberately: at 90 each that is 180 credits, under the D17
 * confirmation threshold, so the call dispatches without a confirm flag and the reserve is reached.
 */

const OTHER_PROJECT_ID = "8c2e4a6b-1d3f-4b8a-9e50-7a1c3e5d9b04";
const OTHER_PROJECT = { id: OTHER_PROJECT_ID, domain: "second-site.com", archivedAt: null };

/** Two of the caller's own projects; anything else reads as nobody's, exactly like production. */
const loadTwoProjects: LoadProjectFn = async (userId, projectId) => {
  if (userId !== CTX.userId) return null;
  if (projectId === PROJECT_ID) return PROJECT;
  return projectId === OTHER_PROJECT_ID ? OTHER_PROJECT : null;
};

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => currentRecorder().client,
}));

const { makeAiVisibilityCompareTool } = await import("./ai-visibility-compare.ts");
const { createMockAiVisibilityPort } = await import("../dfs/llm-mentions.ts");

const tool = (): ReturnType<typeof makeAiVisibilityCompareTool> =>
  makeAiVisibilityCompareTool({
    port: createMockAiVisibilityPort({
      aggregated: aggregatedFixture,
      crossAggregated: crossFixture,
    }),
    loadProject: loadTwoProjects,
    writeRun,
  });

/** The reserve the guard opened for one comparison; a vendor throw still leaves one behind. */
async function reserveFor(
  targets: readonly Record<string, unknown>[],
): Promise<Record<string, unknown> | undefined> {
  resetRecorder();
  try {
    await tool().run(CTX, { targets, platform: "chat_gpt" });
  } catch {
    // deliberate — the throw is what makes withCredits RELEASE, and the reserve is what is read.
  }
  return currentRecorder().reserve()?.args;
}

describe("ai_visibility_compare records which project its spend was for (H-1)", () => {
  it("books the comparison against the single project its targets came from", async () => {
    const args = await reserveFor([{ project_id: PROJECT_ID }, { domain: "competitor.com" }]);
    expect(args?.p_tool).toBe("ai_visibility_compare");
    expect(args?.p_project_id).toBe(PROJECT_ID);
  });

  it("records no project scope when no target named a project", async () => {
    const args = await reserveFor([{ domain: "competitor.com" }, { domain: "rival.com" }]);
    expect(args?.p_project_id).toBeNull();
  });

  /**
   * The case a "just take the first one" fix would get wrong, and the reason the rule is written
   * as "exactly one distinct project" rather than as a precedence: comparing two of your own sites
   * is a legitimate call, and neither of them is the answer to "where did these credits go?".
   */
  it("records no project scope when the comparison spans two of the caller's projects", async () => {
    const args = await reserveFor([{ project_id: PROJECT_ID }, { project_id: OTHER_PROJECT_ID }]);
    expect(args?.p_tool).toBe("ai_visibility_compare");
    expect(args?.p_project_id).toBeNull();
  });

  /**
   * THE SOURCE, not just the value — the family claim (test/project-scope-pin.ts), on the tool
   * that resolves its targets one at a time. Every assertion above is equally happy with the
   * caller's RAW `project_id`; only this one says the ownership gate ran BEFORE the reserve, and
   * at 90 credits per target that gate is what stops a foreign id from being both charged for and
   * written onto this tenant's ledger row.
   */
  it("opens NO reserve at all when one target names a project that is not the caller's", async () => {
    const args = await reserveFor([{ project_id: FOREIGN_PROJECT_ID }, { domain: "rival.com" }]);
    expect(args).toBeUndefined();
  });
});
