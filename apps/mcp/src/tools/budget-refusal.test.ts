import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AuthContext } from "../auth.ts";
import { DfsBudgetExhaustedError, isDfsBudgetExhausted } from "../dfs/budget-error.ts";
import { createMemorySpendLedger, reserveSpend } from "../dfs/budget.ts";
import { defineTool, registerAll, type ChargeMode, type RegisteredTool } from "./registry.ts";

/**
 * A DESIGNED refusal must not read as a crash — the DataForSEO daily cap axis (D2).
 *
 * The cap (NEVER #5) refuses a call by throwing, and until DfsBudgetExhaustedError existed that
 * throw landed in the registry's generic catch: "failed unexpectedly … quote reference 3f9c1a20".
 * Nothing had gone wrong; a guard the constitution requires had done its job, and a customer who
 * had just spent 65–90 credits was invited to file a bug about it. This is the SAME shape the
 * 2026-08-09 campaign measured on the precondition and reauth axes — measured, fixed there, and
 * left open here.
 *
 * DB-LESS by construction: every synthetic tool is named `whats_next`, whose TOOL_COSTS entry is
 * 0, so withCredits short-circuits before it reaches for a client (the device
 * precondition.test.ts uses). What is under test is the registry's catch, which never reads the
 * name; the harness below is deliberately self-contained for the same reason that file's is.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

/** A minimal fake MCP Server that records the handlers registerAll installs. */
function fakeServer() {
  const handlers = new Map<unknown, (request: unknown) => unknown>();
  const server = {
    setRequestHandler: (schema: unknown, handler: (request: unknown) => unknown) => {
      handlers.set(schema, handler);
    },
  } as unknown as Server;
  return { server, handlers };
}

type CallFn = (request: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function wire(tool: RegisteredTool): CallFn {
  const { server, handlers } = fakeServer();
  registerAll(server, { ctx: CTX, tools: [tool] });
  return handlers.get(CallToolRequestSchema) as CallFn;
}

/** A 0-credit tool in the given charge mode whose handler throws `error`. */
function throwingTool(error: unknown, charge: ChargeMode = "handler"): RegisteredTool {
  return defineTool({
    name: "whats_next",
    description: "d",
    inputSchema: z.object({}),
    charge,
    handler: async () => {
      throw error;
    },
  });
}

/**
 * Call a throwing tool and hand back what the USER saw plus what the OPERATOR log recorded.
 * The log lines are SNAPSHOT before mockRestore — vitest's restore also clears the recorded
 * calls, so reading the spy afterwards silently yields an empty history and every "the operator
 * still gets the detail" assertion would pass against nothing.
 */
async function callThrowing(error: unknown, charge: ChargeMode = "handler") {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const result = await wire(throwingTool(error, charge))({
      params: { name: "whats_next", arguments: {} },
    });
    const logged = errorSpy.mock.calls.map((call) => call.join(" "));
    return { text: result.content[0]?.text ?? "", isError: result.isError, logged };
  } finally {
    errorSpy.mockRestore();
  }
}
// --- D2: the budget cap is a refusal, not a crash -------------------------------------------

describe("isDfsBudgetExhausted", () => {
  it("recognizes the typed refusal", () => {
    expect(isDfsBudgetExhausted(new DfsBudgetExhaustedError("/v3/x", "over"))).toBe(true);
  });

  it("recognizes it across a DUPLICATED module instance (name fallback)", () => {
    const fromOtherCopy = new Error("daily budget exceeded");
    fromOtherCopy.name = "DfsBudgetExhaustedError";
    expect(isDfsBudgetExhausted(fromOtherCopy)).toBe(true);
  });

  it("does NOT recognize a plain Error carrying the very same words", () => {
    // The branch keys on the TYPE. A raw throw that happens to mention the budget is still an
    // unexplained throw — widening this to a text match is how a genuine failure gets hidden
    // behind a reassuring sentence (the mirror of the 2026-08-09 harm).
    expect(isDfsBudgetExhausted(new Error("DataForSEO daily budget exceeded: refusing"))).toBe(
      false,
    );
  });

  it("does NOT recognize non-Error values", () => {
    expect(isDfsBudgetExhausted("DfsBudgetExhaustedError")).toBe(false);
    expect(isDfsBudgetExhausted({ name: "DfsBudgetExhaustedError" })).toBe(false);
    expect(isDfsBudgetExhausted(null)).toBe(false);
    expect(isDfsBudgetExhausted(undefined)).toBe(false);
  });

  it("is an Error subclass — withCredits still RELEASES the reserve on it, unchanged", () => {
    expect(new DfsBudgetExhaustedError("/v3/x", "over")).toBeInstanceOf(Error);
  });
});

describe("reserveSpend raises the TYPED refusal at the cap (and only there)", () => {
  it("throws DfsBudgetExhaustedError when the ledger refuses at the cap", async () => {
    const ledger = createMemorySpendLedger(0.5);
    ledger.seed(0.45);
    await expect(reserveSpend(0.1, "/v3/search_volume", ledger)).rejects.toThrow(
      DfsBudgetExhaustedError,
    );
  });

  it("keeps the ledger's own words on the error (operator log + budget.test.ts pin)", async () => {
    const ledger = createMemorySpendLedger(0.5);
    ledger.seed(0.45);
    await expect(reserveSpend(0.1, "/v3/search_volume", ledger)).rejects.toThrow(
      /budget exceeded/i,
    );
  });

  it("does NOT type an UNREACHABLE ledger as a budget refusal — that is a real fault", async () => {
    // Fail-closed and fail-loud are different stories: "we are out of allowance today, come back
    // tomorrow" is actionable; "the counter is unreadable" is an operator incident and belongs in
    // the generic branch with a reference to grep.
    const ledger = createMemorySpendLedger();
    ledger.breakWith(new Error("connection refused"));
    await expect(reserveSpend(0.1, "/v3/search_volume", ledger)).rejects.not.toBeInstanceOf(
      DfsBudgetExhaustedError,
    );
  });
});

describe("the registry answers an exhausted DataForSEO budget as a refusal", () => {
  it("names the tool, whose limit it is, when it lifts, and that nothing was charged", async () => {
    const { text, isError } = await callThrowing(
      new DfsBudgetExhaustedError("/v3/backlinks/summary/live", "today's spend ($2.91) …"),
    );
    expect(isError).toBe(true);
    expect(text).toContain("whats_next");
    expect(text).toMatch(/daily allowance/i);
    expect(text).toMatch(/limit on our side, not on your account/i);
    expect(text).toMatch(/00:00 UTC/);
    expect(text).toMatch(/not charged/i);
  });

  it("does not read as a crash: no generic sentence, no failure reference", async () => {
    const { text } = await callThrowing(new DfsBudgetExhaustedError("/v3/x", "over the cap"));
    expect(text).not.toMatch(/failed unexpectedly/i);
    expect(text).not.toMatch(/reference [0-9a-f]{8}/);
  });

  it("leaks NO vendor spend figures — the ledger's dollars stay on the operator side", async () => {
    // The ledger sentence names OUR cost and OUR cap. This reply goes to whoever holds an API key.
    const { text, logged } = await callThrowing(
      new DfsBudgetExhaustedError(
        "/v3/backlinks/summary/live",
        "today's spend ($2.9100) plus this call's estimate ($0.3000) would pass the $3.00 cap.",
      ),
    );
    expect(text).not.toContain("$");
    expect(text).not.toContain("2.9100");
    expect(text).not.toContain("3.00");
    expect(text).not.toContain("/v3/");
    // …but the operator DOES get the whole thing, so a user complaint can be correlated.
    const operatorLog = logged.join("\n");
    expect(operatorLog).toContain("2.9100");
    expect(operatorLog).toContain("/v3/backlinks/summary/live");
    expect(operatorLog).toContain("whats_next");
  });

  it("a plain Error carrying the same words still gets the generic crash sentence", async () => {
    const { text, logged } = await callThrowing(
      new Error("DataForSEO daily budget exceeded: refusing the call."),
    );
    expect(text).toMatch(/failed unexpectedly/i);
    expect(text).not.toMatch(/daily allowance/i);
    expect(logged).toHaveLength(1);
  });
});