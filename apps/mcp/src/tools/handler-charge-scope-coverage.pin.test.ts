import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CTX, writeRun } from "../test/project-scope-pin.ts";
import { currentRecorder, resetRecorder } from "../test/ledger-recorder.ts";
import researchFixture from "../dfs/fixtures/keyword-overview.json";

/**
 * H-1, THE FAMILY SWEEP: every `charge:"handler"` tool either hands `withCredits` a project or is
 * named here as one that has none to hand.
 *
 * The per-tool pins beside this file each cover the tool they name. What none of them can see is
 * the tool NOBODY wrote a pin for — and that is the shape H-1 actually had: fifteen call sites, no
 * list anywhere, every one of them free to forget. So the roster comes from the REGISTRY
 * (`ALL_TOOLS`, filtered by `charge`), never from a list of names typed here: a sixteenth
 * self-settling tool lands in this spec the moment it is registered.
 *
 * The check reads SOURCE rather than running each tool, and that is the point — running them would
 * need a port, a fixture and an input per tool, which is exactly the per-tool work that already
 * exists. What is missing at the family level is cheap and structural: does the `withCredits` meta
 * at this tool's own call site mention `projectId` at all?
 */

const SOURCE_DIR = import.meta.dirname;

/** Tool name to module: the repo's one naming convention, `snake_case` -> `kebab-case.ts`. */
function sourceOf(tool: string): string {
  return readFileSync(`${SOURCE_DIR}/${tool.replaceAll("_", "-")}.ts`, "utf8");
}

/**
 * Does this tool's own `withCredits` meta name a project scope?
 *
 * The window is the `tool: "<name>"` line plus the few that follow, because the meta is written
 * both ways in the tree: on one line for a per-call tool, spread over several where a `units`
 * count shares the object. A whole-file search would pass on any file that mentions `projectId`
 * anywhere — including the run-row writes that were ALREADY correct while the ledger was blank,
 * which is the exact confusion this finding was made of.
 */
const META_WINDOW = 6;

function namesProjectScope(tool: string): boolean {
  const lines = sourceOf(tool).split("\n");
  const start = lines.findIndex((line) => line.includes(`tool: "${tool}"`));
  if (start === -1) throw new Error(`no withCredits meta found for "${tool}"`);
  return lines.slice(start, start + META_WINDOW).some((line) => line.includes("projectId"));
}

/**
 * The tools with NO project to name — each with the reason, because an exemption without one is
 * indistinguishable from an oversight. Both take a subject that is not a site at all, and
 * credits/guard.ts is explicit that undefined is a real answer rather than a missing one.
 */
const NO_SUBJECT_TO_SCOPE: Readonly<Record<string, string>> = {
  audit_speed: "takes page URLs and nothing else — no target, no project_id",
  research_keywords: "takes a keyword set and nothing else — no target, no project_id",
};

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => currentRecorder().client,
}));

const { ALL_TOOLS } = await import("./index.ts");
const { makeResearchKeywordsTool } = await import("./research-keywords.ts");
const { createMockResearchPort } = await import("../dfs/client.ts");

const SELF_SETTLING = ALL_TOOLS.filter((tool) => tool.charge === "handler").map(
  (tool) => tool.name,
);

describe("every charge:\"handler\" tool accounts for its ledger project scope (H-1)", () => {
  it("finds the family at all — the roster is the registry's, not a list typed here", () => {
    expect(SELF_SETTLING.length).toBeGreaterThan(10);
    for (const tool of Object.keys(NO_SUBJECT_TO_SCOPE)) {
      expect(SELF_SETTLING).toContain(tool);
    }
  });

  it("names a project at every call site that has one to name", () => {
    const missing = SELF_SETTLING.filter(
      (tool) => !(tool in NO_SUBJECT_TO_SCOPE) && !namesProjectScope(tool),
    );
    // keyword_positions is the ONE call site this slice did not own (its own fix slice does), and
    // this assertion is written so it CANNOT rot: the day that slice lands, `missing` empties and
    // this spec goes RED, which is what forces the line below to be deleted rather than believed.
    expect(missing).toEqual(["keyword_positions"]);
  });

  it("leaves the exempt tools genuinely without one, rather than quietly scoped", () => {
    for (const tool of Object.keys(NO_SUBJECT_TO_SCOPE)) {
      expect(namesProjectScope(tool)).toBe(false);
    }
  });

  /**
   * The exemption, MEASURED rather than asserted in prose: research_keywords really does reserve,
   * and the reserve it opens really does carry a null scope. audit_speed's own half of this claim
   * is audit-speed-charge.pin.test.ts's and it keeps it.
   */
  it("research_keywords reserves with no project scope, because it has no site to name", async () => {
    resetRecorder();
    const tool = makeResearchKeywordsTool({
      port: createMockResearchPort(researchFixture),
      writeRun,
    });
    try {
      await tool.run(CTX, { keywords: ["seo software"] });
    } catch {
      // deliberate — a throw is what makes withCredits RELEASE; the reserve is what is read.
    }
    const reserve = currentRecorder().reserve();
    expect(reserve?.args.p_tool).toBe("research_keywords");
    expect(reserve?.args.p_project_id).toBeNull();
  });
});
