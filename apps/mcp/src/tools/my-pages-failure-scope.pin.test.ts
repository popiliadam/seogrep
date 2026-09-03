import { describe, expect, it, vi } from "vitest";
import { CTX, PROJECT_ID, loadProject, writeRun } from "../test/project-scope-pin.ts";
import { currentRecorder, resetRecorder } from "../test/ledger-recorder.ts";

/**
 * Ş-2 — THE FAILURE PATH'S LEDGER SCOPE, AND WHAT MEASURING IT ACTUALLY SHOWED.
 *
 * =====================================================================================
 * THE CLAIM, AND ITS REFUTATION
 * =====================================================================================
 * The 2026-09-03 live round observed that `my_pages`'s one failing call left the ledger holding
 * `-40 charge · no project scope` followed by `+40 refund · no project scope`, while the same
 * tool's two SUCCESSFUL calls carried `project: adstark.com.tr` / `project: dentnotion.com`. The
 * hypothesis written down was: the failure path loses the project scope.
 *
 * IT DOES NOT. The raw record of that call (`dilim4.jsonl:22`) reads
 * `"args":{"target":"adstark.com.tr","item_types":["featured_snippet"]}` — a BARE TARGET. A call
 * that names no project resolves to no project, and "no project scope" is then the true answer and
 * not a lost one (credits/guard.ts: undefined is a REAL answer). The two scoped rows were
 * `project_id` calls and the blank pair was a `target` call; the axis that differed was the INPUT,
 * not success versus failure. The hypothesis and the evidence for it were compatible with a second
 * explanation nobody had ruled out (signed lesson 13: a prescribed diagnosis is a hypothesis until
 * it is run).
 *
 * =====================================================================================
 * SO WHY THIS FILE EXISTS
 * =====================================================================================
 * Because nothing in the fast lane could have told the two apart, and that is a real gap whichever
 * way the observation had gone. `rankings-project-scope.pin.test.ts` drives every one of these
 * tools with a port that SUCCEEDS, so the whole family's evidence for "the spend is scoped" comes
 * from the happy path alone. A regression that dropped the scope only when the vendor failed would
 * have been invisible there — and the failure path is exactly where a live reader would next look
 * and misread a legitimately blank row as the bug.
 *
 * WHAT THIS PINS, AND WHAT IT CANNOT. The reserve is opened BEFORE `fn` runs and `reserve_credits`
 * is the one write that decides the scope of a spend (migration 0033), so the arguments below are
 * the whole claim for the CHARGE row. The REFUND row's scope is copied from the reserve row by
 * `release_reserve` itself, in SQL — unobservable from here, and asserted against real rows by
 * `credits/guard.db.test.ts` ("refunds a released reserve under the same project"). That lane was
 * NOT run for this change (Docker); this file makes no claim about it.
 */

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => currentRecorder().client,
}));

const { makeMyPagesTool } = await import("./my-pages.ts");

/** The failure the live call actually took: the vendor half throws AFTER the reserve is open. */
const VENDOR_FAILURE = "DataForSEO task failed (status 40501): Invalid Field";

const failingPort = {
  enabled: true,
  fetchRelevantPages: async (): Promise<never> => {
    throw new Error(VENDOR_FAILURE);
  },
};

/** The crawl side is read before the reserve and is another spec's subject. */
const loadCrawl = async (): Promise<{ kind: "not_requested" }> => ({ kind: "not_requested" });

async function runFailing(input: Record<string, unknown>): Promise<void> {
  resetRecorder();
  const tool = makeMyPagesTool({ port: failingPort, loadProject, loadCrawl, writeRun });
  await expect(tool.run(CTX, input)).rejects.toThrow(VENDOR_FAILURE);
}

describe("my_pages keeps its ledger scope when the vendor call fails (Ş-2)", () => {
  it("reserves against the named project even though the call is about to fail", async () => {
    await runFailing({ project_id: PROJECT_ID });
    const reserve = currentRecorder().reserve();
    expect(reserve?.args.p_tool).toBe("my_pages");
    expect(reserve?.args.p_project_id).toBe(PROJECT_ID);
  });

  it("releases, and never commits — the refund inherits the scope from that one reserve", async () => {
    await runFailing({ project_id: PROJECT_ID });
    const settlements = currentRecorder()
      .rpcs.map((rpc) => rpc.name)
      .filter((name) => name !== "reserve_credits");
    // ONE release and NO commit. A commit here would charge for a lookup nobody received; a
    // SECOND reserve would be a differently scoped spend that 0033 could not link to this one.
    expect(settlements).toEqual(["release_reserve"]);
    const release = currentRecorder().rpcs.find((rpc) => rpc.name === "release_reserve");
    expect(typeof release?.args.p_reserve_id).toBe("string");
  });

  /**
   * THE OTHER DIRECTION, and it is the one the live round actually exercised: a bare `target`
   * failing must still record NULL. Pinning only the scoped case would pass a fix that attributed
   * every failed call to something, which is the invented number credits/guard.ts forbids — and it
   * would also re-enter the misreading this file's header takes apart.
   */
  it("records no project scope for a failing BARE-TARGET call, which is the true answer", async () => {
    await runFailing({ target: "adstark.com.tr", item_types: ["featured_snippet"] });
    const reserve = currentRecorder().reserve();
    expect(reserve?.args.p_tool).toBe("my_pages");
    expect(reserve?.args.p_project_id).toBeNull();
  });
});
