import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AuthContext } from "../auth.ts";
import type { ToolName } from "../credits/costs.ts";
import { NO_CRAWL_MESSAGE } from "../audit/load.ts";
import { NO_PULL_MESSAGE } from "../gsc-data/load.ts";
import { defineTool, registerAll, textResult, type RegisteredTool } from "./registry.ts";
import { makeAuditTool } from "./audit-shared.ts";
import { makeDiscoveryTool } from "./gsc-discovery-shared.ts";
import { PreconditionNotMetError, isPreconditionNotMet } from "./precondition.ts";

/**
 * Fast-lane pins for the pre-condition refusal: the "no crawl yet" / "no pull yet" sentence must
 * reach the client verbatim instead of the registry's generic crash sentence, and the branch that
 * does it must stay narrow enough that a real failure is still reported as one.
 *
 * The builders are exercised under a 0-CREDIT tool name (whats_next / get_job_status) so
 * withCredits short-circuits before it opens a DB client — this lane is DB-less by construction.
 * What is under test is the shared builder + the registry catch, neither of which reads the name;
 * the six PRICED tools that use these builders are named and charged for real in the db lane
 * (audit-onpage.db.test.ts, gsc-discovery.db.test.ts), which is also where the ledger nets to zero.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";

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

/** Wire ONE tool behind registerAll and hand back its tools/call entry point. */
function wire(tool: RegisteredTool): CallFn {
  const { server, handlers } = fakeServer();
  registerAll(server, { ctx: CTX, tools: [tool] });
  return handlers.get(CallToolRequestSchema) as CallFn;
}

async function callTool(tool: RegisteredTool, name: ToolName) {
  return wire(tool)({ params: { name, arguments: { project_id: PROJECT_ID } } });
}

describe("isPreconditionNotMet", () => {
  it("recognizes the typed refusal", () => {
    expect(isPreconditionNotMet(new PreconditionNotMetError(NO_CRAWL_MESSAGE))).toBe(true);
  });

  it("recognizes it across a DUPLICATED module instance (name fallback, not instanceof)", () => {
    // Test isolation and bundling can load this module twice; `instanceof` then silently
    // answers false and the user is back to the crash sentence. Simulate the second copy.
    const fromOtherCopy = new Error(NO_CRAWL_MESSAGE);
    fromOtherCopy.name = "PreconditionNotMetError";
    expect(isPreconditionNotMet(fromOtherCopy)).toBe(true);
  });

  it("does NOT recognize a plain Error carrying the very same sentence", () => {
    // The narrowing keys on the TYPE. A raw throw that happens to read like a refusal is still
    // an unexplained throw, and widening this to a text match is how the 12 genuine failures of
    // 2026-08-09 would get hidden behind a reassuring sentence.
    expect(isPreconditionNotMet(new Error(NO_CRAWL_MESSAGE))).toBe(false);
    expect(isPreconditionNotMet(new Error(NO_PULL_MESSAGE))).toBe(false);
  });

  it("does NOT recognize non-Error values", () => {
    expect(isPreconditionNotMet(NO_CRAWL_MESSAGE)).toBe(false);
    expect(isPreconditionNotMet({ name: "PreconditionNotMetError" })).toBe(false);
    expect(isPreconditionNotMet(null)).toBe(false);
    expect(isPreconditionNotMet(undefined)).toBe(false);
  });

  it("is an Error subclass — withCredits still RELEASES the reserve on it, unchanged", () => {
    expect(new PreconditionNotMetError("x")).toBeInstanceOf(Error);
  });
});

describe("the pre-condition refusal reaches the client verbatim", () => {
  it("audit builder: NO_CRAWL_MESSAGE, isError, no crash sentence, no reference, no log line", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const tool = makeAuditTool("whats_next", "d", () => "unreachable", {
        loadCrawl: async () => ({ ok: false, error: NO_CRAWL_MESSAGE }),
      });
      const result = await callTool(tool, "whats_next");

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(NO_CRAWL_MESSAGE);
      expect(result.content[0]?.text).not.toMatch(/failed unexpectedly/i);
      expect(result.content[0]?.text).not.toMatch(/reference/i);
      expect(result.content[0]?.text).not.toMatch(/[0-9a-f]{8}/);
      // No log line: an operator has nothing to diagnose in "this project has no crawl yet".
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("discovery builder: NO_PULL_MESSAGE, isError, no crash sentence, no reference, no log line", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const tool = makeDiscoveryTool("get_job_status", "d", () => "unreachable", {
        loadPull: async () => ({ ok: false, error: NO_PULL_MESSAGE }),
      });
      const result = await callTool(tool, "get_job_status");

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(NO_PULL_MESSAGE);
      expect(result.content[0]?.text).not.toMatch(/failed unexpectedly/i);
      expect(result.content[0]?.text).not.toMatch(/reference/i);
      expect(result.content[0]?.text).not.toMatch(/[0-9a-f]{8}/);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("a loaded crawl still renders normally (the refusal branch did not swallow the happy path)", async () => {
    const tool = makeAuditTool("whats_next", "d", (crawl) => `pages=${crawl.pages.length}`, {
      loadCrawl: async () => ({
        ok: true,
        crawl: { pages: [], skipped: [], fetchedAt: "2026-08-09T00:00:00.000Z" },
      }),
    });
    const result = await callTool(tool, "whats_next");
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("pages=0");
  });
});

describe("a genuine crash is still reported as one", () => {
  /**
   * The branch that must NOT be widened. A loader that blows up carries the SAME sentence the
   * refusal uses, but as a plain Error — if the registry matched on text it would answer a real
   * outage with "run crawl_site first" and the operator would never see the log line. Two sites
   * in the 2026-08-09 campaign failed for real and were already indistinguishable; that is the
   * harm this pin exists to prevent recurring in the opposite direction.
   */
  it("a plain Error carrying NO_CRAWL_MESSAGE gets the generic sentence, a reference, and a log line", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const tool = defineTool({
        name: "whats_next",
        description: "d",
        inputSchema: z.object({}),
        handler: async () => {
          throw new Error(NO_CRAWL_MESSAGE);
        },
      });
      const result = await wire(tool)({ params: { name: "whats_next", arguments: {} } });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toBe(NO_CRAWL_MESSAGE);
      expect(result.content[0]?.text).toMatch(/failed unexpectedly/);
      const reference = /reference ([0-9a-f]{8})\b/.exec(result.content[0]?.text ?? "")?.[1];
      expect(reference).toBeDefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.join(" ")).toContain(reference!);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("an ordinary unexpected failure is untouched by the new branch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const tool = makeAuditTool("whats_next", "d", () => "unreachable", {
        loadCrawl: async () => {
          throw new Error('relation "public.jobs" does not exist');
        },
      });
      const result = await callTool(tool, "whats_next");

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/failed unexpectedly/);
      expect(result.content[0]?.text).not.toMatch(/relation/);
      expect(errorSpy).toHaveBeenCalledOnce();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

/** The registry branch itself, independent of any builder. */
describe("registry catch — typed refusal vs crash", () => {
  it("returns the typed refusal's message verbatim and logs nothing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const tool = defineTool({
        name: "whats_next",
        description: "d",
        inputSchema: z.object({}),
        handler: async () => {
          throw new PreconditionNotMetError("sentence written by the loader");
        },
      });
      const result = await wire(tool)({ params: { name: "whats_next", arguments: {} } });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe("sentence written by the loader");
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("leaves a normal result alone", async () => {
    const tool = defineTool({
      name: "whats_next",
      description: "d",
      inputSchema: z.object({}),
      handler: async () => textResult("fine"),
    });
    const result = await wire(tool)({ params: { name: "whats_next", arguments: {} } });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("fine");
  });
});
