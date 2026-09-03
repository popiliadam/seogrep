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

/** How many CODE lines of the meta object are read once the guard call has been found. */
const META_WINDOW = 8;
/** How many CODE lines above its guard call a `const meta = …` binding may sit. */
const BINDING_REACH = 4;

/** Source with comment lines dropped, so a window is a count of CODE and not of prose. */
function codeLines(tool: string): readonly string[] {
  return sourceOf(tool)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

/**
 * The lines of the credit meta THIS tool hands `withCredits`, ANCHORED ON THE GUARD CALL.
 *
 * The anchor matters more than the window. Anchoring on the first `tool: "<name>"` in the file —
 * which is what this check did first — reads whichever object happens to come first, and several
 * of these tools write a RUN ROW carrying the very same `tool:` key and a `projectId` beside it.
 * Those writes were already correct while the ledger row was blank, so a check anchored on them
 * reports green for exactly the defect it was written to find.
 *
 * Two shapes exist in the tree and both are followed from the call outwards: the meta inline in
 * the `withCredits(...)` arguments, or bound to `const meta = …` immediately above it. A binding
 * further away than BINDING_REACH THROWS rather than falling back to a file-wide search — the
 * fallback is the hole, not the missing match.
 */
function creditMetaLines(tool: string): readonly string[] {
  const lines = codeLines(tool);
  const call = lines.findIndex((line) => line.includes("withCredits("));
  if (call === -1) throw new Error(`no withCredits call found in "${tool}"`);
  const inline = lines.slice(call, call + META_WINDOW);
  if (inline.some((line) => line.includes(`tool: "${tool}"`))) return inline;
  const above = lines.slice(Math.max(0, call - BINDING_REACH), call);
  for (let i = above.length - 1; i >= 0; i -= 1) {
    const line = above[i] as string;
    if (!line.includes("const meta =")) continue;
    if (!line.includes(`tool: "${tool}"`)) break;
    return [line];
  }
  throw new Error(
    `the credit meta for "${tool}" is neither inline at its withCredits call nor bound within ` +
      `${BINDING_REACH} code lines above it — and a window that widens to find it would start ` +
      "matching run-row writes instead",
  );
}

function namesProjectScope(tool: string): boolean {
  return creditMetaLines(tool).some((line) => line.includes("projectId"));
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
    // keyword_positions landed in fix/positions-d3 (merged after fix/ledger-scope-d3), so the
    // roster is complete: every charge:"handler" tool with a subject scopes its ledger row.
    expect(missing).toEqual([]);
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
