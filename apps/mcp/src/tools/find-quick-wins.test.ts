import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { findQuickWins, formatQuickWins } from "../gsc-data/index.ts";
import { SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import { makeDiscoveryTool } from "./gsc-discovery-shared.ts";

/**
 * Fast-lane spec for find_quick_wins' provenance line. The charge/refusal behavior is the
 * shared builder's (gsc-discovery.db.test.ts, precondition.test.ts); this pins the ONE thing
 * specific to a loaded pull's rendering: the tool dates the data it just charged the caller
 * for, via the shared gsc-discovery-shared.ts call site (gsc-data/load.ts renderPullProvenance).
 *
 * Built through makeDiscoveryTool directly under a 0-CREDIT name ("get_job_status"), the same
 * trick precondition.test.ts uses, so withCredits short-circuits before opening a DB client —
 * this is a DB-less unit test by construction. find-quick-wins.ts's OWN render (findQuickWins +
 * formatQuickWins) is exercised for real; only the tool NAME is swapped so no ledger write is
 * attempted. The paid "find_quick_wins" name is exercised for real in gsc-discovery.db.test.ts.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";

function buildFindQuickWins(pulledAt: string) {
  return makeDiscoveryTool(
    "get_job_status",
    "d",
    (pull) => formatQuickWins(findQuickWins(pull)),
    { loadPull: async () => ({ ok: true, pull: SAMPLE_PULL, pulledAt }) },
  );
}

describe("find_quick_wins provenance", () => {
  it("dates the data it just charged for", async () => {
    const tool = buildFindQuickWins("2026-08-06T09:00:00.000Z");

    const result = await tool.run(CTX, { project_id: PROJECT_ID });

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Search Console data pulled 2026-08-06");
  });

  it("puts the provenance line at the end, separated from the findings by a blank line", async () => {
    const tool = buildFindQuickWins("2026-08-06T09:00:00.000Z");

    const result = await tool.run(CTX, { project_id: PROJECT_ID });

    const text = result.content[0]?.text ?? "";
    const lines = text.trimEnd().split("\n");
    expect(lines.at(-1)).toMatch(/^Search Console data pulled 2026-08-06 \(.+\)\.$/);
    expect(lines.at(-2)).toBe("");
  });
});
