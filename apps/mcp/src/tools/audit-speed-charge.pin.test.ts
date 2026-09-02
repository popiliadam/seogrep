import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { createMockSpeedPort, type SpeedPort } from "../dfs/lighthouse.ts";
import lighthouseFixture from "../dfs/fixtures/lighthouse.json";

/**
 * B-5 — WHICH TOOL THE MONEY IS BOOKED AGAINST, pinned in the lane that actually runs.
 *
 * Measured 2026-09-02: changing `withCredits(…, { tool: "audit_speed" }, …)` to
 * `{ tool: "audit_schema" }` in audit-speed.ts left ALL 3766 tests of this package green. That
 * mutation is not cosmetic — `creditCostFor` takes the price from the tool NAMED in that argument,
 * so the customer would pay 5 credits instead of the signed 15, and the ledger row would attribute
 * the spend to a tool that never ran. Both halves of "what did my credits go to?" would be wrong.
 *
 * The only spec that saw it was `audit-speed.db.test.ts:167`, and that lane needs Docker: `make
 * verify` does not run it (CLAUDE.md command table — "**secret taraması YOK · DB şeritleri YOK**").
 * So the daily gate could not see a 3x mispricing.
 *
 * HOW THIS FILE SEES IT WITHOUT A DATABASE, and why the evidence is trustworthy. The reserve is an
 * RPC — `reserve_credits(p_user_id, p_amount, p_tool, p_job_id, p_project_id)` — so the fake below
 * RECORDS the RPC calls and applies none of them, the same discipline test/fake-query.ts is
 * written under (signed lesson 12): the claim is about THE ARGUMENTS THE GUARD BUILT, never about
 * rows the fake handed back. `p_amount` and `p_tool` are the two columns the ledger row is made
 * of, so pinning them here pins the charge itself and not a proxy for it.
 *
 * WHAT IT DOES NOT CLAIM: that migration 0005 behaves correctly against real rows. That is
 * audit-speed.db.test.ts's job and it keeps it.
 */

const CTX: AuthContext = { userId: "user-under-test", keyId: "key-1" };
const RESERVE_ID = "b6b0f0de-1e1e-4a2a-9c33-0a1b2c3d4e5f";

interface RecordedRpc {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

let rpcs: RecordedRpc[] = [];

/**
 * A recording stand-in for the service-role client. `from()` answers the two PRE-reserve ledger
 * READS the guard makes — the paid-balance gate (audit_speed is gated, so it must see a payment or
 * the reserve is never reached) and the free-vendor-spend counter (nothing spent today). `rpc()`
 * records and answers; it never decides anything the assertions then read back.
 */
function createRecordingClient(): unknown {
  const chain = (projection: string): unknown => {
    const link: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "gt", "gte", "limit", "order"]) {
      link[method] = (...args: readonly unknown[]): unknown =>
        method === "select" ? chain(String(args[0] ?? "")) : link;
    }
    link.then = <A>(onFulfilled?: (value: unknown) => A): PromiseLike<A> =>
      Promise.resolve({
        // `select("id")` is the paid-balance probe; `select("tool")` the free-spend counter.
        data: projection === "id" ? [{ id: 1 }] : [],
        error: null,
        count: null,
      }).then(onFulfilled);
    return link;
  };
  return {
    from: () => chain(""),
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

const { makeAuditSpeedTool } = await import("./audit-speed.ts");

/**
 * Run the tool against a port, returning the RPCs the credit guard issued.
 *
 * A vendor failure leaves `withCredits` no exit but a throw — that throw is WHAT MAKES IT RELEASE
 * — and `run` does not catch it (the registry's own tools/call handler does, one level up). So the
 * throw is swallowed here rather than allowed to fail the spec: what is under test is the ledger
 * traffic either way, and the failing case is asserted by the RPC names, not by the exception.
 */
async function runWith(port: SpeedPort): Promise<readonly RecordedRpc[]> {
  rpcs = [];
  client = createRecordingClient();
  try {
    await makeAuditSpeedTool({ port }).run(CTX, { urls: ["https://slowshop.org/"] });
  } catch {
    // deliberate — see above.
  }
  return rpcs;
}

const servingPort = (): SpeedPort => createMockSpeedPort({ default: lighthouseFixture });

describe("audit_speed books its spend against its OWN name and price (B-5)", () => {
  it("reserves under the tool name `audit_speed`", async () => {
    const reserves = (await runWith(servingPort())).filter((rpc) => rpc.name === "reserve_credits");
    expect(reserves).toHaveLength(1);
    expect(reserves[0]?.args.p_tool).toBe("audit_speed");
  });

  /**
   * The AMOUNT, beside the name, because the mutation moves both at once: the guard prices the
   * call from the tool it was handed, so a wrong name is silently a wrong price. The literal 15
   * is pinned once, in credits/costs.test.ts, where the whole signed table lives (NEVER #6);
   * what belongs here is that THIS call reserves THAT tool's price.
   */
  it("reserves exactly this tool's price, not another tool's", async () => {
    const reserve = (await runWith(servingPort())).find((rpc) => rpc.name === "reserve_credits");
    expect(reserve?.args.p_amount).toBe(TOOL_COSTS.audit_speed);
  });

  /**
   * `no project scope` is the RIGHT answer here and was confirmed live on 2026-09-02: audit_speed
   * takes URLs, not a project, so there is no scope to attribute the spend to. An invented one
   * would be a number somebody adds up (credits/guard.ts says so about this very column).
   */
  it("attributes the spend to no project, because this tool has no project to name", async () => {
    const reserve = (await runWith(servingPort())).find((rpc) => rpc.name === "reserve_credits");
    expect(reserve?.args.p_project_id).toBeNull();
  });

  it("settles it exactly once — one commit, no release", async () => {
    const names = (await runWith(servingPort())).map((rpc) => rpc.name);
    expect(names).toEqual(["reserve_credits", "commit_reserve"]);
  });

  /**
   * The refund direction, which until now was proven ONLY in the Docker lane: a Lighthouse run
   * that fails takes the whole call with it, so the reserve is released and the balance ends where
   * it started. A partial table is never billed.
   */
  it("releases the reserve — and never commits — when the vendor call fails", async () => {
    const failing: SpeedPort = {
      enabled: true,
      fetchPageSpeed: async () => {
        throw new Error("DataForSEO request failed: HTTP 500");
      },
    };
    const names = (await runWith(failing)).map((rpc) => rpc.name);
    expect(names).toEqual(["reserve_credits", "release_reserve"]);
  });
});
