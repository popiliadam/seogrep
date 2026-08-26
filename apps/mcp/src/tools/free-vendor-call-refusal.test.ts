import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AuthContext } from "../auth.ts";
import {
  FREE_VENDOR_SPEND_DAILY_USD,
  FreeVendorSpendLimitError,
  freeVendorSpendLimitMessage,
} from "../credits/free-vendor-calls.ts";
import { defineTool, registerAll, type ChargeMode, type RegisteredTool } from "./registry.ts";

/**
 * The free-vendor-SPEND ceiling is a DESIGNED refusal and must not read as a crash.
 *
 * Same axis as budget-refusal.test.ts one file over, and the same failure it guards against: a
 * typed refusal that falls through to the registry's generic catch reaches the user as "failed
 * unexpectedly … quote reference 3f9c1a20", which is a lie about a rule working exactly as
 * designed and turns a working gate into a support ticket.
 *
 * DB-LESS by construction: every synthetic tool is named `whats_next` (0 credits), so withCredits
 * short-circuits before reaching for a client. What is under test is the registry's catch, which
 * never reads the name.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

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
 * Call a throwing tool and hand back what the USER saw plus what the OPERATOR log recorded. The
 * log lines are SNAPSHOT before mockRestore — vitest's restore clears the recorded calls too, so
 * reading the spy afterwards would silently yield an empty history and every "the operator still
 * gets the detail" assertion would pass against nothing.
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

const REFUSAL = freeVendorSpendLimitMessage("research_keywords", FREE_VENDOR_SPEND_DAILY_USD);

describe("the registry renders the free-vendor-spend refusal", () => {
  it("passes the gate's own sentence through verbatim", async () => {
    const seen = await callThrowing(new FreeVendorSpendLimitError("research_keywords", REFUSAL));
    expect(seen.text).toBe(REFUSAL);
    expect(seen.isError).toBe(true);
  });

  it("does NOT answer it with the generic crash sentence", async () => {
    const seen = await callThrowing(new FreeVendorSpendLimitError("research_keywords", REFUSAL));
    expect(seen.text).not.toMatch(/failed unexpectedly/i);
    expect(seen.text).not.toMatch(/quote it if you report this/i);
  });

  it("tells the user when it clears and that nothing was charged", async () => {
    const seen = await callThrowing(new FreeVendorSpendLimitError("research_keywords", REFUSAL));
    expect(seen.text).toMatch(/00:00 UTC/);
    expect(seen.text).toMatch(/not charged|neither is this refusal/i);
  });

  it("gives the operator a log line to correlate with a vendor-budget complaint", async () => {
    const seen = await callThrowing(new FreeVendorSpendLimitError("research_keywords", REFUSAL));
    expect(seen.logged.join("\n")).toMatch(/free vendor-spend allowance/i);
  });

  it("keys on the TYPE, so a plain Error carrying the same words is still a crash", async () => {
    // The whole reason the branch is typed: a wider text match would let a genuine failure that
    // happens to mention the allowance wear an "everything is fine" sentence.
    const seen = await callThrowing(new Error(REFUSAL));
    expect(seen.text).toMatch(/failed unexpectedly/i);
  });

  it("recognises the refusal across a duplicated module instance (name fallback)", async () => {
    const impostor = new Error(REFUSAL);
    impostor.name = "FreeVendorSpendLimitError";
    const seen = await callThrowing(impostor);
    expect(seen.text).toBe(REFUSAL);
  });
});
