import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CONFIRMATION_THRESHOLD_CREDITS,
  confirmationGate,
  defineTool,
  evaluateConfirmation,
  readConfirmFlag,
  registerAll,
  textResult,
  type RegisteredTool,
} from "./registry.ts";
import type { AuthContext } from "../auth.ts";

/**
 * Unit tests for the tool registry — the docs-automation foundation (D11): every
 * MCP tool definition is a zod schema, and tools/list JSON Schemas are DERIVED from
 * it (no hand-written JSON Schema). All tools here are 0-credit (whats_next /
 * get_job_status), so withCredits skips the ledger and no DB/env is touched — the
 * fast lane proves the wiring without a stack.
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

describe("defineTool", () => {
  it("derives the MCP inputSchema from the zod schema (no hand-written JSON Schema)", () => {
    const tool = defineTool({
      name: "whats_next",
      description: "Suggest the next action",
      inputSchema: z.object({ focus: z.string().min(1).describe("area to focus on") }),
      handler: async () => textResult("ok"),
    });

    expect(tool.inputJsonSchema).toMatchObject({
      type: "object",
      properties: { focus: { type: "string", minLength: 1, description: "area to focus on" } },
      required: ["focus"],
    });
    // The JSON Schema dialect marker is stripped — MCP inputSchema is a bare object schema.
    expect(tool.inputJsonSchema).not.toHaveProperty("$schema");
    expect(tool.name).toBe("whats_next");
    expect(tool.description).toBe("Suggest the next action");
  });

  it("run() validates input, then invokes the handler with the parsed value", async () => {
    const handler = vi.fn(async (_ctx: AuthContext, input: { focus: string }) =>
      textResult(`focus=${input.focus}`),
    );
    const tool = defineTool({
      name: "whats_next",
      description: "d",
      inputSchema: z.object({ focus: z.string() }),
      handler,
    });

    const result = await tool.run(CTX, { focus: "titles" });
    expect(result).toEqual({ content: [{ type: "text", text: "focus=titles" }] });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toEqual(CTX);
  });

  it("run() returns an isError result and does NOT call the handler on invalid input", async () => {
    const handler = vi.fn(async () => textResult("should not run"));
    const tool = defineTool({
      name: "whats_next",
      description: "d",
      inputSchema: z.object({ focus: z.string() }),
      handler,
    });

    const result = await tool.run(CTX, { focus: 123 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
    expect(handler).not.toHaveBeenCalled();
  });

  it("advertises a .default() field as OPTIONAL, not required (io:'input')", () => {
    // Regression pin: with the default JSON Schema view a defaulted field is emitted
    // REQUIRED, so a client omitting it is wrongly rejected. The single io:"input"
    // deriver models the pre-parse shape — max_urls here must be optional.
    const tool = defineTool({
      name: "crawl_site",
      description: "d",
      inputSchema: z.object({
        project_id: z.uuid(),
        max_urls: z.number().int().min(1).max(100).default(100),
      }),
      charge: "worker",
      handler: async () => textResult("ok"),
    });
    const schema = tool.inputJsonSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["project_id"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["max_urls", "project_id"]);
  });
});

describe("defineTool charge modes", () => {
  // Strip every SUPABASE var so ANY attempt to open a DB client (i.e. any reserve)
  // throws loadEnv — a priced worker-mode tool that runs to completion proves the
  // guard was NOT invoked (the reserve/commit is the worker's, keyed to jobs.id).
  const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("charge:'worker' runs a PRICED handler without the credit guard (no ledger touch)", async () => {
    const tool = defineTool({
      name: "crawl_site", // priced (20) — a surface charge here would need the DB and throw
      description: "d",
      inputSchema: z.object({}),
      charge: "worker",
      handler: async () => textResult("enqueued"),
    });
    const result = await tool.run(CTX, {});
    expect(result).toEqual(textResult("enqueued"));
  });

  it("charge:'handler' runs a PRICED handler without the credit guard (handler self-settles)", async () => {
    // research_keywords-shaped: priced (25) but the registry must NOT wrap it. A surface charge
    // would open a reserve -> getServiceClient -> loadEnv, which throws with SUPABASE_* stripped;
    // running to completion proves "handler" mode leaves settlement to the handler itself.
    const tool = defineTool({
      name: "research_keywords",
      description: "d",
      inputSchema: z.object({}),
      charge: "handler",
      handler: async () => textResult("self-settled"),
    });
    const result = await tool.run(CTX, {});
    expect(result).toEqual(textResult("self-settled"));
  });

  it("surface mode on a 0-credit tool skips the ledger entirely (default charge)", async () => {
    const tool = defineTool({
      name: "whats_next", // 0 credits — withCredits short-circuits before any DB client
      description: "d",
      inputSchema: z.object({}),
      handler: async () => textResult("advice"),
    });
    const result = await tool.run(CTX, {});
    expect(result).toEqual(textResult("advice"));
  });
});

describe("registerAll", () => {
  const listTool = defineTool({
    name: "whats_next",
    description: "Suggest the next action",
    inputSchema: z.object({}),
    handler: async () => textResult("advice"),
  });
  const echoTool = defineTool({
    name: "get_job_status",
    description: "Echo the job id",
    inputSchema: z.object({ jobId: z.string() }),
    handler: async (_ctx, input: { jobId: string }) => textResult(`job=${input.jobId}`),
  });
  const tools: RegisteredTool[] = [listTool, echoTool];

  function wire() {
    const { server, handlers } = fakeServer();
    registerAll(server, { ctx: CTX, tools });
    const list = handlers.get(ListToolsRequestSchema) as () => { tools: unknown[] };
    const call = handlers.get(CallToolRequestSchema) as (r: unknown) => Promise<{
      content: { text: string }[];
      isError?: boolean;
    }>;
    return { list, call };
  }

  it("tools/list advertises every tool with its zod-derived inputSchema", () => {
    const { list } = wire();
    const payload = list();
    expect(payload.tools).toEqual([
      { name: "whats_next", description: "Suggest the next action", inputSchema: listTool.inputJsonSchema },
      { name: "get_job_status", description: "Echo the job id", inputSchema: echoTool.inputJsonSchema },
    ]);
  });

  it("tools/call dispatches to the named tool and returns its result", async () => {
    const { call } = wire();
    const result = await call({ params: { name: "get_job_status", arguments: { jobId: "j-9" } } });
    expect(result).toEqual({ content: [{ type: "text", text: "job=j-9" }] });
  });

  it("tools/call on an unknown tool returns an isError result (no throw)", async () => {
    const { call } = wire();
    const result = await call({ params: { name: "no_such_tool", arguments: {} } });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/unknown tool/i);
  });

  it("tools/call surfaces a handler failure as an isError result", async () => {
    const boom = defineTool({
      name: "whats_next",
      description: "d",
      inputSchema: z.object({}),
      handler: async () => {
        throw new Error("handler exploded");
      },
    });
    const { server, handlers } = fakeServer();
    registerAll(server, { ctx: CTX, tools: [boom] });
    const call = handlers.get(CallToolRequestSchema) as (r: unknown) => Promise<{
      content: { text: string }[];
      isError?: boolean;
    }>;
    const result = await call({ params: { name: "whats_next", arguments: {} } });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/handler exploded/);
  });
});

/**
 * D17 credit confirmation threshold — the SaaS analogue of the consent ledger. No tool in
 * TOOL_COSTS exceeds the threshold today (the priciest is 30), so the OVER-threshold behaviour
 * is proven here with SYNTHETIC estimates passed straight to the pure gate — TOOL_COSTS is never
 * touched. The registry wires confirmationGate(name, TOOL_COSTS[name], rawInput) before dispatch,
 * so a triggered gate returns BEFORE withCredits and settles nothing (zero ledger by construction).
 */
describe("D17 threshold — evaluateConfirmation (pure rule)", () => {
  it("requires confirmation when the estimate is strictly ABOVE the threshold and unconfirmed", () => {
    expect(evaluateConfirmation(CONFIRMATION_THRESHOLD_CREDITS + 1, false)).toEqual({
      requiresConfirmation: true,
      estimate: CONFIRMATION_THRESHOLD_CREDITS + 1,
    });
    expect(evaluateConfirmation(250, false).requiresConfirmation).toBe(true);
  });

  it("does NOT require confirmation exactly AT the threshold (> is strict)", () => {
    expect(evaluateConfirmation(CONFIRMATION_THRESHOLD_CREDITS, false).requiresConfirmation).toBe(false);
  });

  it("does NOT require confirmation once the caller has confirmed (confirm:true -> normal flow)", () => {
    expect(evaluateConfirmation(250, true).requiresConfirmation).toBe(false);
  });

  it("does NOT require confirmation for ordinary sub-threshold costs", () => {
    expect(evaluateConfirmation(30, false).requiresConfirmation).toBe(false);
    expect(evaluateConfirmation(0, false).requiresConfirmation).toBe(false);
  });
});

describe("D17 threshold — readConfirmFlag (reserved registry param)", () => {
  it("is true ONLY for the literal boolean true", () => {
    expect(readConfirmFlag({ confirm: true })).toBe(true);
  });

  it("is false for a missing, non-boolean, or false confirm (and non-objects)", () => {
    expect(readConfirmFlag({})).toBe(false);
    expect(readConfirmFlag({ confirm: false })).toBe(false);
    expect(readConfirmFlag({ confirm: "true" })).toBe(false);
    expect(readConfirmFlag({ confirm: 1 })).toBe(false);
    expect(readConfirmFlag(null)).toBe(false);
    expect(readConfirmFlag(undefined)).toBe(false);
    expect(readConfirmFlag("nope")).toBe(false);
  });
});

describe("D17 threshold — confirmationGate (dispatch gate)", () => {
  it("returns a requires_confirmation result (NOT an error) for an over-threshold, unconfirmed call", () => {
    const result = confirmationGate("crawl_site", 250, {});
    expect(result).not.toBeNull();
    expect(result?.isError).toBeUndefined();
    const body = JSON.parse(result?.content[0]?.text ?? "{}") as {
      requires_confirmation: boolean;
      estimate_credits: number;
      message: string;
    };
    expect(body.requires_confirmation).toBe(true);
    expect(body.estimate_credits).toBe(250);
    expect(body.message).toMatch(/"confirm": true/);
  });

  it("returns null (proceed) when an over-threshold call carries confirm:true", () => {
    expect(confirmationGate("crawl_site", 250, { confirm: true })).toBeNull();
  });

  it("returns null (proceed) for a sub-threshold estimate — the only path real tools hit today", () => {
    expect(confirmationGate("crawl_site", 20, {})).toBeNull();
    expect(confirmationGate("whats_next", 0, {})).toBeNull();
  });
});
