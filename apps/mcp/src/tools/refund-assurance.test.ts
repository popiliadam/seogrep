import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AuthContext } from "../auth.ts";
import { ReserveCommitFailedError } from "../credits/guard.ts";
import {
  defineTool,
  refundAssurance,
  registerAll,
  type ChargeMode,
  type RegisteredTool,
} from "./registry.ts";

/**
 * What a FAILED tool call says about the caller's credits (D3).
 *
 * A 90-credit tool answering "failed unexpectedly … quote reference 3f9c1a20" left the user's
 * first question unanswered: did that cost me 90 credits? It did not — withCredits releases the
 * reserve on a throw — but nothing said so, so the honest reader had to assume the worst. Every
 * OTHER refusal branch in the registry already ends in "You were not charged"; the generic one
 * did not.
 *
 * The point of these specs is that the claim is NOT blanket. It is measured on EVERY charge mode
 * and EVERY reserve disposition, because it is true only where this request opened the reserve
 * and knows it came back — and a false money claim is worse than a missing sentence.
 *
 * DB-LESS by construction: every synthetic tool is named `whats_next` (TOOL_COSTS 0), so
 * withCredits short-circuits before it reaches for a client.
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
// --- D3: what the failure says about the caller's credits ------------------------------------

describe("refundAssurance — the claim is made only where it is provable", () => {
  it("promises the refund on the modes whose reserve this request opened and released", () => {
    for (const charge of ["surface", "handler"] as const) {
      expect(refundAssurance(charge, new Error("boom"))).toMatch(/not charged/i);
    }
  });

  it("says NOTHING on charge:worker — the background job may still charge", () => {
    // crawl_site enqueues and returns; a throw here means the enqueue path failed, but a jobs row
    // may already exist and the WORKER opens the reserve later. This request cannot see that.
    expect(refundAssurance("worker", new Error("boom"))).toBeNull();
  });

  it("splits by DISPOSITION when the tool ran but its charge would not settle", () => {
    const at = (d: "open" | "refunded" | "unknown") =>
      refundAssurance("surface", new ReserveCommitFailedError("reserve-1", "rpc down", d));
    // Already released: the money is home. Saying more would imply something else is coming.
    expect(at("refunded")).toMatch(/already refunded/i);
    expect(at("refunded")).toMatch(/not charged/i);
    // Verified open: the sweep WILL refund it — a promise the code can keep.
    expect(at("open")).toMatch(/reconciliation refunds it automatically/i);
    // The classifying read failed too. Promise NOTHING, and never the opposite of the truth.
    expect(at("unknown")).not.toMatch(/not charged/i);
    expect(at("unknown")).not.toMatch(/refund/i);
    expect(at("unknown")).toMatch(/contact support/i);
  });

  it("never claims a refund on a worker-mode commit failure either (mode wins first)", () => {
    for (const d of ["open", "refunded", "unknown"] as const) {
      expect(
        refundAssurance("worker", new ReserveCommitFailedError("reserve-1", "rpc down", d)),
      ).toBeNull();
    }
  });
});

describe("the generic crash sentence carries the credit answer", () => {
  it("tells a surface-mode caller they were not charged, alongside the reference", async () => {
    const { text } = await callThrowing(new Error('relation "public.jobs" does not exist'), "surface");
    expect(text).toMatch(/failed unexpectedly/i);
    expect(text).toMatch(/reference [0-9a-f]{8}/);
    expect(text).toMatch(/not charged/i);
    // The raw internals stay server-side — the reference is the only handle.
    expect(text).not.toMatch(/relation/);
  });

  it("tells a handler-mode caller the same", async () => {
    const { text } = await callThrowing(new Error("kaboom"), "handler");
    expect(text).toMatch(/not charged/i);
  });

  it("says NOTHING about credits to a worker-mode caller", async () => {
    const { text } = await callThrowing(new Error("enqueue failed"), "worker");
    expect(text).toMatch(/failed unexpectedly/i);
    expect(text).not.toMatch(/charged/i);
    expect(text).not.toMatch(/refund/i);
  });

  it("says nothing it cannot prove when the reserve's final state is unknown", async () => {
    const { text } = await callThrowing(
      new ReserveCommitFailedError("reserve-1", "rpc down", "unknown"),
      "surface",
    );
    expect(text).toMatch(/failed unexpectedly/i);
    expect(text).not.toMatch(/not charged/i);
    expect(text).toMatch(/contact support/i);
  });
});

describe("defineTool exposes the resolved charge mode", () => {
  it("defaults to surface and carries an explicit mode through", () => {
    const surface = defineTool({
      name: "whats_next",
      description: "d",
      inputSchema: z.object({}),
      handler: async () => ({ content: [] }),
    });
    expect(surface.charge).toBe("surface");
    for (const charge of ["handler", "worker"] as const) {
      const tool = defineTool({
        name: "whats_next",
        description: "d",
        inputSchema: z.object({}),
        charge,
        handler: async () => ({ content: [] }),
      });
      expect(tool.charge).toBe(charge);
    }
  });
});