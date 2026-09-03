import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import type { ProjectRef } from "./project-target.ts";
import type { StoredMeasurement } from "./keyword-positions-store.ts";

/**
 * F-1 / H-1 — WHICH TOOL THE MONEY IS BOOKED AGAINST, AND WHICH PROJECT IT IS BOOKED TO, pinned
 * in the lane that actually runs.
 *
 * Measured 2026-09-03 (audit M2): changing `withCredits(…, { tool: "keyword_positions" }, …)` in
 * keyword-positions.ts to `{ tool: "audit_schema" }` left ALL 3914 tests of this package green,
 * and `tsc --noEmit` clean. The mutation is not cosmetic — `creditCostFor` prices the call from
 * the tool NAMED in that argument — so a 10-credit read would be charged 5 credits and appear in
 * the customer's `list_credit_activity` under a tool that never ran. Both halves of "what did my
 * credits go to?" would be wrong. The price TABLE is pinned twice (costs.test.ts and
 * keyword-positions.test.ts), but which row of it this call site reads was pinned by nothing.
 *
 * The only spec that saw either fact was `keyword-positions.db.test.ts`, and that lane needs
 * Docker: `make verify` does not run it (CLAUDE.md command table — "**secret taraması YOK · DB
 * şeritleri YOK**").
 *
 * H-1 is the second column of the same ledger row. `keyword_positions` settles itself
 * (charge:"handler"), so it never passes through the registry's surface path where
 * `declaredProjectId` supplies the scope — and it was passing no `projectId` at all, writing
 * "no project scope" onto a spend that HAS one. The resolved project is used rather than the raw
 * argument, so the scope is the row the ownership gate actually opened.
 *
 * HOW THIS FILE SEES IT WITHOUT A DATABASE, and why the evidence is trustworthy. The reserve is an
 * RPC — `reserve_credits(p_user_id, p_amount, p_tool, p_job_id, p_project_id)` — so the fake below
 * RECORDS the RPC calls and applies none of them, the same discipline test/fake-query.ts is
 * written under (signed lesson 12): the claim is about THE ARGUMENTS THE GUARD BUILT, never about
 * rows the fake handed back. `p_tool`, `p_amount` and `p_project_id` are three of the columns the
 * ledger row is made of, so pinning them here pins the charge itself and not a proxy for it.
 *
 * WHAT IT DOES NOT CLAIM: that migration 0005 and 0033 behave correctly against real rows. That is
 * keyword-positions.db.test.ts's job and it keeps it.
 */

const CTX: AuthContext = { userId: "user-under-test", keyId: "key-1" };
const RESERVE_ID = "c7c1a1ef-2f2f-4b3b-8d44-1b2c3d4e5f60";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

interface RecordedRpc {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

let rpcs: RecordedRpc[] = [];

/**
 * A recording stand-in for the service-role client. This tool is NOT on the paid-balance gate and
 * spends no vendor money, so neither pre-reserve ledger READ is reached; `from()` is present only
 * so an unexpected read fails loudly rather than as a TypeError.
 */
function createRecordingClient(): unknown {
  return {
    from: () => {
      throw new Error("keyword_positions must not open a ledger statement on this path");
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs = [...rpcs, { name, args }];
      return Promise.resolve({ data: name === "reserve_credits" ? RESERVE_ID : null, error: null });
    },
  };
}

let client: unknown = createRecordingClient();

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => client,
}));

const { makeKeywordPositionsTool } = await import("./keyword-positions.ts");

const READING: StoredMeasurement = {
  keyword: "seo tools",
  targetDomain: "example.com",
  locationName: "United States",
  languageCode: "en",
  device: "desktop",
  searchEngine: "google",
  depthRequested: 100,
  domainMatchRule: "exact_host_www_stripped",
  status: "ranked",
  bestRankGroup: 4,
  bestRankAbsolute: 6,
  organicItemsExamined: 100,
  notMeasuredReason: null,
  vendorReportedTimeField: "datetime",
  vendorReportedTimeValue: "2026-08-20 04:00:00 +00:00",
  fetchedAt: "2026-08-20T04:00:00.000Z",
};

/**
 * Run the tool over injected readers, returning the RPCs the credit guard issued.
 *
 * A read that throws leaves `withCredits` no exit but a throw — that throw is WHAT MAKES IT
 * RELEASE — and `run` does not catch it (the registry's tools/call handler does, one level up).
 * So it is swallowed here: what is under test is the ledger traffic either way, and the failing
 * case is asserted by the RPC names, not by the exception.
 */
async function runWith(
  input: Record<string, unknown>,
  options: { readonly stored?: number; readonly readFails?: boolean } = {},
): Promise<readonly RecordedRpc[]> {
  rpcs = [];
  client = createRecordingClient();
  const tool = makeKeywordPositionsTool({
    loadProject: async () => PROJECT,
    countMeasurements: async () => options.stored ?? 1,
    loadMeasurements: async () => {
      if (options.readFails === true) throw new Error("keyword_position_measurements read failed");
      return [READING];
    },
  });
  try {
    await tool.run(CTX, input);
  } catch {
    // deliberate — see above.
  }
  return rpcs;
}

describe("keyword_positions books its spend against its OWN name and price (F-1)", () => {
  it("reserves under the tool name `keyword_positions`", async () => {
    const reserves = (await runWith({ project_id: PROJECT_ID })).filter(
      (rpc) => rpc.name === "reserve_credits",
    );
    expect(reserves).toHaveLength(1);
    expect(reserves[0]?.args.p_tool).toBe("keyword_positions");
  });

  /**
   * The AMOUNT, beside the name, because the mutation moves both at once: the guard prices the
   * call from the tool it was handed, so a wrong name is silently a wrong price. The literal 10
   * is pinned in credits/costs.test.ts, where the whole signed table lives (NEVER #6); what
   * belongs here is that THIS call reserves THAT tool's price.
   */
  it("reserves exactly this tool's price, not another tool's", async () => {
    const reserve = (await runWith({ project_id: PROJECT_ID })).find(
      (rpc) => rpc.name === "reserve_credits",
    );
    expect(reserve?.args.p_amount).toBe(TOOL_COSTS.keyword_positions);
  });

  it("settles it exactly once — one commit, no release", async () => {
    const names = (await runWith({ project_id: PROJECT_ID })).map((rpc) => rpc.name);
    expect(names).toEqual(["reserve_credits", "commit_reserve"]);
  });

  /**
   * The refund direction, which until now was proven ONLY in the Docker lane: a read that fails
   * after the reserve takes the whole call with it, so the reserve is released and the balance
   * ends where it started. A half-read window is never billed.
   */
  it("releases the reserve — and never commits — when the stored read fails", async () => {
    const names = (await runWith({ project_id: PROJECT_ID }, { readFails: true })).map(
      (rpc) => rpc.name,
    );
    expect(names).toEqual(["reserve_credits", "release_reserve"]);
  });

  /**
   * The free branch, asserted on the LEDGER rather than on the sentence: an empty store must
   * leave no row at all — not a charge and a refund, which is what a reserve opened before the
   * count would have produced.
   */
  it("writes no ledger row at all when nothing has been measured", async () => {
    expect(await runWith({ project_id: PROJECT_ID }, { stored: 0 })).toEqual([]);
  });
});

describe("keyword_positions names the project its credits went to (H-1)", () => {
  /**
   * `charge:"handler"` means the registry's generic `declaredProjectId` read never runs for this
   * tool, so the scope has to be handed over here. Without it every keyword_positions row in
   * `list_credit_activity` reads "no project scope" for a spend that has one.
   */
  it("attributes the spend to the project the ownership gate resolved", async () => {
    const reserve = (await runWith({ project_id: PROJECT_ID })).find(
      (rpc) => rpc.name === "reserve_credits",
    );
    expect(reserve?.args.p_project_id).toBe(PROJECT_ID);
  });

  /**
   * …and NOT to an invented one on the bare-domain path. A `target` may be a competitor's domain
   * that is nobody's project, so "no project scope" is the honest answer there — credits/guard.ts
   * says so about this very column.
   */
  it("attributes a bare-target read to no project, because there is none to name", async () => {
    const reserve = (await runWith({ target: "example.com" })).find(
      (rpc) => rpc.name === "reserve_credits",
    );
    expect(reserve?.args.p_project_id).toBeNull();
  });
});
