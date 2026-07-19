import { z } from "zod";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";

/**
 * Zod-based tool registry — the foundation the docs automation (D11) builds on: a
 * tool is declared ONCE as a zod schema + handler, and both surfaces are derived
 * from it — the MCP tools/list JSON Schema (via z.toJSONSchema, never hand-written)
 * and the tools/call dispatch. The cost comes from TOOL_COSTS keyed by the tool NAME,
 * so the tool's name is its single binding to the human-approved price table (a
 * 0-credit tool skips the ledger entirely — see credits/guard.ts).
 *
 * A tool's `charge` mode is a first-class part of the declaration — it names WHO owns the
 * credit settlement, and the three modes are mutually exclusive:
 *
 *   "surface" (default) — the REGISTRY owns settlement. A synchronous tool whose handler runs
 *     UNDER withCredits at call time (reserve -> handler -> commit / release). There is no jobs
 *     row, so the reserve is ledger-only (the guard passes a traceability job uuid and never
 *     writes a jobs row). Most read/analyze tools are surface.
 *   "handler" — the HANDLER owns settlement, SYNCHRONOUSLY. The registry does NOT wrap it; the
 *     handler decides for itself when to open a reserve and calls withCredits directly (no jobId
 *     — the same ledger-only shape as "surface"). This is for a synchronous tool that must run
 *     logic BEFORE the reserve — e.g. research_keywords refuses, and charges nothing, while live
 *     data is disabled: a pre-reserve honesty gate that "surface" cannot express.
 *   "worker" — the async WORKER owns settlement. The handler ITSELF enqueues a background job and
 *     returns a job_id immediately; the registry does NOT wrap it. The real reserve/commit is the
 *     WORKER's, keyed to the queued jobs.id (queue/worker.ts). crawl_site is the worker-mode tool.
 *
 * Only "surface" is wrapped by the registry; "handler" and "worker" both run the handler directly
 * (wrapping either would double-charge). The registry's ONE cross-cutting credit concern is the
 * D17 confirmation threshold below, applied to EVERY mode before dispatch.
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
 * How a tool settles credits — WHO owns the reserve/commit. "surface" (default): the registry
 * wraps the handler under the credit guard synchronously. "handler": the handler settles itself
 * synchronously (the registry does not wrap) — for a pre-reserve gate. "worker": the async worker
 * settles against the queued jobs.id (the handler enqueues and returns a job_id). See the module
 * header for the full contract.
 */
export type ChargeMode = "surface" | "handler" | "worker";

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
 * D17 credit confirmation threshold — the SaaS analogue of the consent ledger: a call whose
 * ESTIMATED cost exceeds this many credits must be explicitly confirmed before it runs, so a
 * large batch can never silently drain a balance. No tool in TOOL_COSTS exceeds it today (the
 * priciest is 30), so this is a forward-looking guard for future bulk operations — the
 * over-threshold path is exercised by the pure unit tests with SYNTHETIC estimates, never by a
 * real registered tool (confirmationGate takes the estimate as an argument for exactly that).
 */
export const CONFIRMATION_THRESHOLD_CREDITS = 200;

export interface ConfirmationDecision {
  /** True when the estimate is over the threshold AND the caller has not confirmed. */
  readonly requiresConfirmation: boolean;
  /** The estimate that was weighed, echoed back for the caller's confirmation message. */
  readonly estimate: number;
}

/**
 * Pure D17 rule: an estimate STRICTLY above the threshold requires confirmation unless the caller
 * already confirmed. Exactly the threshold does NOT require it (`>` is strict). Kept pure and
 * estimate-parameterised so the over-threshold branch is proven with synthetic values without
 * ever touching the human-approved TOOL_COSTS table (constitution NEVER #6).
 */
export function evaluateConfirmation(estimate: number, confirmed: boolean): ConfirmationDecision {
  return {
    requiresConfirmation: estimate > CONFIRMATION_THRESHOLD_CREDITS && !confirmed,
    estimate,
  };
}

/**
 * Read the registry-level `confirm` flag from the RAW tool arguments. `confirm` is a RESERVED
 * registry parameter, deliberately NOT part of any tool's zod schema — the schemas strip unknown
 * keys, so the flag would be lost after parsing; it is read here from the raw input instead, so it
 * never appears in tools/list. Only the literal boolean `true` counts as confirmation (a string
 * "true" or any truthy value does not), so a client must send `"confirm": true` explicitly.
 */
export function readConfirmFlag(rawInput: unknown): boolean {
  return (
    typeof rawInput === "object" &&
    rawInput !== null &&
    (rawInput as Record<string, unknown>).confirm === true
  );
}

/**
 * The D17 dispatch gate. Returns a "confirmation required" ToolResult when `estimate` is over the
 * threshold and the raw input did not set `confirm: true`, or null to proceed. A non-null return is
 * TERMINAL: the registry returns it BEFORE any charge mode runs, so neither the credit guard nor
 * the handler executes and the ledger is NEVER touched (zero-charge by construction). `estimate` is
 * passed in (from TOOL_COSTS at the single call site) so this gate is unit-tested with synthetic
 * over-threshold values without mutating the cost table. The result is NOT an error — it is a valid
 * "here is the estimate, confirm to proceed" response carrying the { requires_confirmation, estimate,
 * message } shape the client (or its LLM) acts on.
 */
export function confirmationGate(
  toolName: string,
  estimate: number,
  rawInput: unknown,
): ToolResult | null {
  const decision = evaluateConfirmation(estimate, readConfirmFlag(rawInput));
  if (!decision.requiresConfirmation) return null;
  const message =
    `Confirmation required: "${toolName}" is estimated to cost ${decision.estimate} credits, which ` +
    `is above the ${CONFIRMATION_THRESHOLD_CREDITS}-credit safety threshold. No credits have been ` +
    `charged. To proceed, run "${toolName}" again with "confirm": true.`;
  return textResult(
    JSON.stringify({ requires_confirmation: true, estimate_credits: decision.estimate, message }),
  );
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
 * Build a registered tool from its spec. run() validates the raw MCP arguments against the zod
 * schema (invalid -> an isError result, the handler never runs), applies the D17 confirmation
 * threshold (over-threshold + unconfirmed -> a confirmation prompt, nothing settles), then
 * dispatches by charge mode:
 *
 *   "surface" (default) — run the handler under withCredits (sync charge). No jobId is
 *     passed: there is no jobs row for a sync tool, so the guard records the reserve on
 *     the ledger with a fresh traceability uuid and never touches a jobs row. A 0-credit
 *     tool short-circuits inside the guard (no ledger at all).
 *   "handler" / "worker" — run the handler DIRECTLY (no guard wrap). A "handler" tool settles
 *     itself synchronously (it calls withCredits from inside, after any pre-reserve gate); a
 *     "worker" tool enqueues an async job whose reserve/commit is the worker's, keyed to the real
 *     jobs.id. Wrapping either here would double-charge.
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
      // D17 confirmation threshold — the ONE cross-cutting credit concern, applied to every charge
      // mode BEFORE dispatch: a call whose estimate exceeds the threshold and did not set
      // confirm:true returns a confirmation prompt and settles nothing (the guard/handler never
      // run). `confirm` is read from the RAW input (a reserved registry param, never in the tool
      // schema). No current tool exceeds the threshold, so on the real surface this always returns
      // null; the over-threshold path is pinned by registry.test.ts with synthetic estimates.
      const gate = confirmationGate(spec.name, TOOL_COSTS[spec.name], rawInput);
      if (gate) return gate;

      if (charge === "surface") {
        // Registry-owned settlement: charge at the surface. No jobId — the guard uses a
        // traceability uuid for the ledger and never writes a jobs row (credits/guard.ts).
        return withCredits({ userId: ctx.userId }, { tool: spec.name }, () =>
          spec.handler(ctx, parsed.data),
        );
      }
      // "handler" or "worker": settlement is the handler's (sync self-settle) or the worker's
      // (async, keyed to jobs.id). The registry does NOT wrap — wrapping would double-charge.
      return spec.handler(ctx, parsed.data);
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
