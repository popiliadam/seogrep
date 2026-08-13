import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { findQuickWins, formatQuickWins, type LoadTokenStatusFn } from "../gsc-data/index.ts";
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

/** The web base URL the reconnect link is built from (gscConnectUrl reads it fail-closed). */
const WEB_BASE_URL = "https://app.test.seogrep.example";
let priorWebBaseUrl: string | undefined;

beforeAll(() => {
  priorWebBaseUrl = process.env.WEB_BASE_URL;
  process.env.WEB_BASE_URL = WEB_BASE_URL;
});

afterAll(() => {
  if (priorWebBaseUrl === undefined) delete process.env.WEB_BASE_URL;
  else process.env.WEB_BASE_URL = priorWebBaseUrl;
});

function buildFindQuickWins(pulledAt: string, loadTokenStatus: LoadTokenStatusFn = async () => "active") {
  return makeDiscoveryTool(
    "get_job_status",
    "d",
    (pull) => formatQuickWins(findQuickWins(pull)),
    {
      loadPull: async () => ({ ok: true, pull: SAMPLE_PULL, pulledAt }),
      loadTokenStatus,
      // The archive gate's project port, stubbed to "this id did not resolve" so this lane stays
      // DB-less (the real reader opens a service client). The gate itself is measured over the
      // real reader, per tool and on the ledger, in gsc-discovery.db.test.ts.
      loadProject: async () => null,
    },
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

/**
 * Step 4 of the task: an analysis whose connection is DEAD must say so. Without this line the
 * provenance line above it is worse than silent — "pulled 12 days ago" invites the user to run
 * pull_gsc_data, which is the one thing that cannot work until they re-approve.
 */
describe("find_quick_wins staleness warning", () => {
  it("warns, with the reconnect link, when the stored connection is invalid", async () => {
    const tool = buildFindQuickWins("2026-08-06T09:00:00.000Z", async () => "invalid");

    const result = await tool.run(CTX, { project_id: PROJECT_ID });

    const text = result.content[0]?.text ?? "";
    // The brief's client-visible claim: the dated line AND the warning, both present.
    expect(text).toContain("Search Console data pulled");
    expect(text).toMatch(/connection expired.*cannot be refreshed/i);
    expect(text).toContain(`${WEB_BASE_URL}/api/gsc/connect?project_id=${PROJECT_ID}`);
    // …the findings themselves are still delivered (this is a warning, not a refusal).
    expect(result.isError).toBeUndefined();
    expect(text).toContain("running shoes");
  });

  it("puts the warning AFTER the provenance line, on its own last line", async () => {
    const tool = buildFindQuickWins("2026-08-06T09:00:00.000Z", async () => "invalid");

    const result = await tool.run(CTX, { project_id: PROJECT_ID });

    const lines = (result.content[0]?.text ?? "").trimEnd().split("\n");
    expect(lines.at(-1)).toMatch(/^⚠ Your Google connection expired/);
    expect(lines.at(-2)).toMatch(/^Search Console data pulled/);
  });

  it("stays silent for a live connection and for a project with no connection at all", async () => {
    for (const status of ["active", null] as const) {
      const tool = buildFindQuickWins("2026-08-06T09:00:00.000Z", async () => status);
      const text = (await tool.run(CTX, { project_id: PROJECT_ID })).content[0]?.text ?? "";
      expect(text).not.toMatch(/connection expired/i);
    }
  });

  /**
   * The env-shape half of the same guarantee. With no WEB_BASE_URL there is no honest link, but
   * the user must still learn that the data under their nose cannot be refreshed — losing the
   * whole warning to a deploy variable would delete a fact about their own data (controller
   * ruling; same reasoning as the typed refusal in registry.test.ts).
   */
  it("keeps warning when WEB_BASE_URL is unset — the link goes, the warning stays", async () => {
    const saved = process.env.WEB_BASE_URL;
    delete process.env.WEB_BASE_URL;
    try {
      const tool = buildFindQuickWins("2026-08-06T09:00:00.000Z", async () => "invalid");

      const result = await tool.run(CTX, { project_id: PROJECT_ID });

      const text = result.content[0]?.text ?? "";
      expect(result.isError).toBeUndefined();
      expect(text).toMatch(/connection expired.*cannot be refreshed/i);
      expect(text).toContain("Reconnect it from the Connection page");
      expect(text).not.toContain("undefined/api/gsc/connect");
      expect(text).toContain("running shoes"); // the analysis is untouched
    } finally {
      // Delete-on-undefined, the shape this file's own afterAll and pull-gsc-data.db.test.ts
      // already use. A bare assignment writes the literal string "undefined" when `saved` is
      // undefined — harmless only because beforeAll happens to set the variable, which is a
      // property of the harness, not of this restore.
      if (saved === undefined) delete process.env.WEB_BASE_URL;
      else process.env.WEB_BASE_URL = saved;
    }
  });

  /**
   * The analysis is already complete and about to be charged when the health read runs, so a
   * failure there must cost the caller the WARNING, never the findings they paid for. Throwing
   * would release the reserve and answer a working analysis with "failed unexpectedly" — the
   * exact defect this task removes.
   */
  it("still delivers the analysis when the health read fails — the warning is best-effort", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const tool = buildFindQuickWins("2026-08-06T09:00:00.000Z", async () => {
        throw new Error("gsc connection health lookup failed: connection refused");
      });

      const result = await tool.run(CTX, { project_id: PROJECT_ID });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain("running shoes");
      expect(result.content[0]?.text).not.toMatch(/connection expired/i);
      // Swallowed, but never silent: the operator gets the reason.
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.join(" ")).toContain(PROJECT_ID);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
