import { z } from "zod";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import type { ToolName } from "../credits/costs.ts";

/**
 * Zod-based tool registry — the foundation the docs automation (D11) builds on: a
 * tool is declared ONCE as a zod schema + handler, and both surfaces are derived
 * from it — the MCP tools/list JSON Schema (via z.toJSONSchema, never hand-written)
 * and the tools/call dispatch. Dispatch runs each handler under the credit guard;
 * the guard reads the cost from TOOL_COSTS keyed by the tool NAME, so the tool's
 * name is its single binding to the human-approved price table (a 0-credit tool
 * skips the ledger entirely — see credits/guard.ts).
 *
 * A tool's `charge` mode is a first-class part of the declaration:
 *
 *   "surface" (default) — a SYNCHRONOUS tool: the handler runs UNDER withCredits at
 *     call time (reserve -> handler -> commit / release). There is no jobs row, so the
 *     reserve is recorded only on the ledger (guard passes a traceability job uuid);
 *     the guard never writes to a jobs row on this path.
 *   "worker" — an ASYNC tool: the handler ITSELF enqueues a background job and returns
 *     a job_id immediately, and the guard does NOT wrap it. The real reserve/commit is
 *     the WORKER's, keyed to the queued jobs.id (queue/worker.ts). Wrapping here too
 *     would double-charge (once at the surface, once in the worker). crawl_site is the
 *     first worker-mode tool.
 */

/**
 * The MCP tool-call result shape this app returns (text content + optional error flag).
 * A `type`, not an `interface`, so it carries the implicit index signature the SDK's
 * (loose) CallToolResult requires — an interface lacks it and fails assignment.
 */
export type ToolResult = {
  readonly content: { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
};

/**
 * How a tool settles credits. "surface" (default) runs the handler under the credit
 * guard synchronously; "worker" leaves charging to the async worker (the handler
 * enqueues and returns a job_id). See the module header for the full contract.
 */
export type ChargeMode = "surface" | "worker";

/** A tool declaration. `name` is a keyof TOOL_COSTS, which binds the tool to its cost. */
export interface ToolSpec<TIn> {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: z.ZodType<TIn>;
  readonly handler: (ctx: AuthContext, input: TIn) => Promise<ToolResult>;
  /** Credit-settlement mode. Defaults to "surface" (sync charge under the guard). */
  readonly charge?: ChargeMode;
}

/**
 * A registered tool with its input generic erased: the zod schema + handler are
 * closed over inside run(), so the registry can hold heterogeneous tools without
 * `any`. inputJsonSchema is the derived MCP tools/list schema.
 */
export interface RegisteredTool {
  readonly name: ToolName;
  readonly description: string;
  readonly inputJsonSchema: Record<string, unknown>;
  run(ctx: AuthContext, rawInput: unknown): Promise<ToolResult>;
}

export interface RegistryDeps {
  /** The tenant context resolved by the gateway for THIS request (stateless server). */
  readonly ctx: AuthContext;
  readonly tools: readonly RegisteredTool[];
}

/** A plain text tool result. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** An error tool result (isError so the MCP client renders it as a failure, not data). */
export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Convert a zod schema to the MCP inputSchema (a bare JSON Schema object). The
 * $schema dialect marker z.toJSONSchema adds is dropped — MCP expects just the
 * object schema (type/properties/required). A new object is returned (no mutation).
 *
 * `io: "input"` is REQUIRED, and this is the ONE place it is applied: with the default
 * ("output") a field carrying a `.default()` (e.g. crawl_site's max_urls) is advertised
 * as REQUIRED in tools/list, so a client that omits it is wrongly rejected. The
 * "input" view models the pre-parse shape, marking defaulted fields optional. Every
 * tool derives its schema through here (defineTool + the worker-mode tools), so there
 * is no second copy of this conversion to drift.
 */
export function toInputJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  // MCP inputSchema is a bare object schema — drop the JSON Schema dialect marker.
  return Object.fromEntries(Object.entries(json).filter(([key]) => key !== "$schema"));
}

/**
 * Build a registered tool from its spec. run() validates the raw MCP arguments
 * against the zod schema (invalid -> an isError result, the handler never runs),
 * then dispatches by charge mode:
 *
 *   "surface" (default) — run the handler under withCredits (sync charge). No jobId is
 *     passed: there is no jobs row for a sync tool, so the guard records the reserve on
 *     the ledger with a fresh traceability uuid and never touches a jobs row. A 0-credit
 *     tool short-circuits inside the guard (no ledger at all).
 *   "worker" — run the handler DIRECTLY (no guard). The handler enqueues an async job
 *     and returns a job_id; the credit reserve/commit is the worker's, keyed to the
 *     real jobs.id. Wrapping here would double-charge.
 */
export function defineTool<TIn>(spec: ToolSpec<TIn>): RegisteredTool {
  const inputJsonSchema = toInputJsonSchema(spec.inputSchema);
  const charge: ChargeMode = spec.charge ?? "surface";
  return {
    name: spec.name,
    description: spec.description,
    inputJsonSchema,
    async run(ctx, rawInput) {
      const parsed = spec.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return errorResult(`Invalid input for "${spec.name}": ${z.prettifyError(parsed.error)}`);
      }
      if (charge === "worker") {
        // Async tool: the handler settles credits in the worker, not here.
        return spec.handler(ctx, parsed.data);
      }
      // Sync tool: charge at the surface. No jobId — the guard uses a traceability uuid
      // for the ledger and never writes to a jobs row on this path (credits/guard.ts).
      return withCredits({ userId: ctx.userId }, { tool: spec.name }, () =>
        spec.handler(ctx, parsed.data),
      );
    },
  };
}

/**
 * Wire the MCP tools/list + tools/call handlers over `deps.tools` for a single
 * stateless request (deps.ctx is this request's tenant). tools/list returns the
 * zod-derived schemas; tools/call resolves the named tool, runs it, and converts any
 * failure (unknown tool, or an error thrown out of the guarded handler) into an
 * isError result so a tool failure never breaks the JSON-RPC transport.
 */
export function registerAll(server: Server, deps: RegistryDeps): void {
  const byName = new Map(deps.tools.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: deps.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputJsonSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tool = byName.get(request.params.name as ToolName);
    if (!tool) {
      return errorResult(`Unknown tool: ${request.params.name}`);
    }
    try {
      return await tool.run(deps.ctx, request.params.arguments);
    } catch (error) {
      // The guard has already released any reserve it opened before rethrowing.
      return errorResult(`Tool "${tool.name}" failed: ${errorMessage(error)}`);
    }
  });
}
