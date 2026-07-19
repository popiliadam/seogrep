import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { defineTool, registerAll, textResult, type RegisteredTool } from "./registry.ts";
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
