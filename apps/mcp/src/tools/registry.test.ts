import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CONFIRMATION_THRESHOLD_CREDITS,
  confirmationGate,
  declaredProjectId,
  defineTool,
  evaluateConfirmation,
  readConfirmFlag,
  registerAll,
  textResult,
  textResultWithCard,
  textResultWithData,
  type RegisteredTool,
} from "./registry.ts";
import { NOT_CHARGED_SENTENCE } from "../credits/free-refusal.ts";
import { PaidBalanceRequiredError } from "../credits/paid-balance.ts";
import { GscReauthRequiredError } from "../gsc-data/reauth-error.ts";
import type { AuthContext } from "../auth.ts";
import { ALL_TOOLS } from "./index.ts";
import { CARDED_TOOLS } from "../ui/card-map.ts";
import { UI_RESOURCES } from "../ui/card.ts";

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

  /**
   * DECLARATION-TIME refusal for a per-unit price, and the reason it is here rather than left to
   * creditCostFor: creditCostFor's own refusal lands when a USER calls the tool, whereas a missing
   * `units` hook is a mistake made when the module is WRITTEN. The gap between the two is a D17
   * under-estimate — the gate would weigh the unit price (90) rather than the call price (up to
   * 900) and wave a 900-credit call through unconfirmed, which is a quieter failure than a throw.
   *
   * Both branches are asserted: the per-unit name without a hook must throw, and the SAME spec
   * with a hook must not. Only the second half proves the check reads the hook rather than the
   * name alone.
   */
  it("refuses to declare a per-unit tool without a units hook, at declaration time", () => {
    const spec = {
      name: "ai_visibility_compare",
      description: "d",
      inputSchema: z.object({ targets: z.array(z.string()) }),
      charge: "handler",
      handler: async () => textResult("ok"),
    } as const;
    expect(() => defineTool(spec)).toThrow(/must declare a "units" hook/i);
    expect(() =>
      defineTool({ ...spec, units: (input: { targets: string[] }) => input.targets.length }),
    ).not.toThrow();
  });

  /**
   * The other side: a PER-CALL tool must stay declarable with no `units` hook at all. That is 36
   * of the 38 tools, so a check keyed to the wrong condition would fail the whole surface rather
   * than the two tools it is meant to guard.
   */
  it("still declares a per-call tool with no units hook", () => {
    expect(() =>
      defineTool({
        name: "ai_visibility",
        description: "d",
        inputSchema: z.object({}),
        handler: async () => textResult("ok"),
      }),
    ).not.toThrow();
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

  /**
   * THE MCP APPS WIRING (SEP-1865) — the one step that, removed, kills the whole feature in
   * silence.
   *
   * Measured 2026-08-27: deleting the `_meta` spread from tools/list left ALL 154 specs in this
   * area green. The server still SERVED the view and no host ever asked for it, because
   * `_meta.ui.resourceUri` is the only thing that tells a host a view exists. The pin above could
   * not see it: both of its tools declare no view, so with the spread gone their output is
   * byte-identical — it was varying the wrong axis (which FIELDS a tool emits, never whether a
   * tool HAS a view).
   *
   * Both directions, because either alone is green for the wrong reason: a tool with a view must
   * carry the meta, and a tool without one must carry NO `_meta` key at all — an explicit
   * `_meta: undefined` would change the serialized shape of all 37 view-less tools.
   */
  it("tools/list names a tool's MCP Apps view, and adds no _meta to a tool without one", () => {
    const viewed = defineTool({
      name: "get_credit_balance",
      description: "Has a view",
      inputSchema: z.object({}),
      ui: { resourceUri: "ui://seogrep/credit-balance" },
      handler: async () => textResult("ok"),
    });
    const { handlers, server } = fakeServer();
    registerAll(server, { ctx: CTX, tools: [viewed, echoTool] });
    const list = handlers.get(ListToolsRequestSchema) as () => { tools: Record<string, unknown>[] };
    const [withView, withoutView] = list().tools;
    expect(withView?._meta).toEqual({ ui: { resourceUri: "ui://seogrep/credit-balance" } });
    expect(withoutView && "_meta" in withoutView).toBe(false);
  });

  /**
   * The helper OWNS `summary`, so a caller cannot quietly decide which copy of the answer wins.
   * A throw at call time puts that conflict in a test run; silent overwriting would put it in
   * production, in whichever channel the host happened to render.
   */
  it("refuses a caller-supplied summary rather than overwriting it", () => {
    expect(() => textResultWithData("the answer", { summary: "something else" })).toThrow(
      /summary/i,
    );
    expect(textResultWithData("the answer", { n: 1 }).structuredContent).toEqual({
      n: 1,
      summary: "the answer",
    });
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

  /** Wire ONE tool that throws `message`, and return its tools/call entry point. */
  function callThrowing(message: string) {
    const boom = defineTool({
      name: "whats_next",
      description: "d",
      inputSchema: z.object({}),
      handler: async () => {
        throw new Error(message);
      },
    });
    const { server, handlers } = fakeServer();
    registerAll(server, { ctx: CTX, tools: [boom] });
    return handlers.get(CallToolRequestSchema) as (r: unknown) => Promise<{
      content: { text: string }[];
      isError?: boolean;
    }>;
  }

  it("tools/call surfaces a handler failure as an isError result — WITHOUT the raw detail (L-03)", async () => {
    // The caller learns that the tool failed and gets a reference to quote; the raw
    // message stays server-side. Strengthened from the previous assertion, which pinned
    // the leak itself (it required the thrown text to appear in the tool output).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const call = callThrowing("handler exploded");
      const result = await call({ params: { name: "whats_next", arguments: {} } });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toMatch(/handler exploded/);
      expect(result.content[0]?.text).toMatch(/whats_next/); // which tool failed is not sensitive
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("renders a paid-balance refusal VERBATIM, not as an unexpected failure", async () => {
    // The guard can only signal this refusal by throwing (withCredits is generic in T), so it
    // lands in the same catch as a crash. It is not a crash: it is a rule working. Printing
    // "failed unexpectedly — quote reference 3f9c1a20" would send a user who simply needs to
    // buy credits into a support thread about a bug that does not exist.
    const refused = defineTool({
      name: "ranked_keywords",
      description: "d",
      inputSchema: z.object({}),
      charge: "handler",
      handler: async () => {
        throw new PaidBalanceRequiredError("ranked_keywords", "needs a paid credit balance …");
      },
    });
    const { server, handlers } = fakeServer();
    registerAll(server, { ctx: CTX, tools: [refused] });
    const call = handlers.get(CallToolRequestSchema) as (r: unknown) => Promise<{
      content: { text: string }[];
      isError?: boolean;
    }>;

    const result = await call({ params: { name: "ranked_keywords", arguments: {} } });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("needs a paid credit balance …");
    expect(result.content[0]?.text).not.toMatch(/unexpectedly/i);
    expect(result.content[0]?.text).not.toMatch(/reference/i);
  });

  it("renders a dead Search Console grant as a reconnect instruction, not an unexpected failure", async () => {
    // Measured 2026-08-09: 12 live cells got "failed unexpectedly — quote reference 3f9c1a20"
    // for a refresh token Google had revoked. The cause was in the server log (invalid_grant)
    // and the cure was in the user's own hands. This branch is what hands it to them.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const dead = defineTool({
        name: "pull_gsc_data",
        description: "d",
        // "handler" charge so this unit test never reaches withCredits (no DB); the money
        // behaviour of the THROW is proven end-to-end in pull-gsc-data.db.test.ts.
        charge: "handler",
        inputSchema: z.object({}),
        handler: async () => {
          throw new GscReauthRequiredError("a@x.com", "https://web.test/api/gsc/connect?project_id=p1");
        },
      });
      const { server, handlers } = fakeServer();
      registerAll(server, { ctx: CTX, tools: [dead] });
      const call = handlers.get(CallToolRequestSchema) as (r: unknown) => Promise<{
        content: { text: string }[];
        isError?: boolean;
      }>;

      const result = await call({ params: { name: "pull_gsc_data", arguments: {} } });
      const text = result.content[0]?.text ?? "";

      expect(result.isError).toBe(true);
      // The exact sentence, pinned whole: this is the copy the fix is judged on.
      expect(text).toBe(
        "Your Google Search Console connection for a@x.com expired, so this data could not be " +
          "refreshed. Reconnect: https://web.test/api/gsc/connect?project_id=p1\n" +
          "You were not charged.",
      );
      expect(text).toMatch(/connection for a@x\.com expired.*reconnect/i);
      expect(text).not.toContain("failed unexpectedly");
      expect(text).not.toMatch(/reference [0-9a-f]{8}/);
      // A designed refusal, not a fault: nothing for an operator to read, so no log line.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  /**
   * THE GUARANTEE THAT MUST NOT EVAPORATE. When WEB_BASE_URL is unset there is no honest link to
   * print — and fabricating an origin would be worse than omitting one. What must NOT happen is
   * the refusal falling back to the generic crash sentence: that is the precise string this task
   * exists to abolish, reappearing in the precise situation it was written for. A guarantee that
   * holds only on a well-configured deployment is not a guarantee (signed lessons 5 and 6).
   */
  it("still names the account and says reconnect when there is no link to give", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const dead = defineTool({
        name: "pull_gsc_data",
        description: "d",
        charge: "handler",
        inputSchema: z.object({}),
        handler: async () => {
          throw new GscReauthRequiredError("a@x.com", null);
        },
      });
      const { server, handlers } = fakeServer();
      registerAll(server, { ctx: CTX, tools: [dead] });
      const call = handlers.get(CallToolRequestSchema) as (r: unknown) => Promise<{
        content: { text: string }[];
        isError?: boolean;
      }>;

      const result = await call({ params: { name: "pull_gsc_data", arguments: {} } });
      const text = result.content[0]?.text ?? "";

      expect(result.isError).toBe(true);
      // THE ASSERTION THAT MATTERS: never the crash sentence, no matter the environment.
      expect(text).not.toContain("failed unexpectedly");
      expect(text).not.toMatch(/reference [0-9a-f]{8}/);
      // …and the refusal is still actionable: whose connection, what happened, what to do.
      expect(text).toContain("a@x.com");
      expect(text).toMatch(/expired/i);
      expect(text).toMatch(/reconnect it from the Connection page/i);
      expect(text).toContain("You were not charged.");
      // No half-built link ever reaches the user.
      expect(text).not.toContain("null");
      expect(text).not.toContain("undefined");
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does NOT leak DB/RPC internals (relation, function, schema names) to the caller (L-03)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const call = callThrowing(
        'jobs pending count failed: relation "public.credit_ledger" does not exist',
      );
      const result = await call({ params: { name: "whats_next", arguments: {} } });
      const text = result.content[0]?.text ?? "";
      expect(text).not.toMatch(/relation/i);
      expect(text).not.toMatch(/credit_ledger/);
      expect(text).not.toMatch(/public\./);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs the FULL detail server-side under the same reference the caller was given (L-03)", async () => {
    // Operator diagnosis must not regress: the reference in the caller's message is the
    // key into a server log line that still carries the verbatim error.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const call = callThrowing('relation "public.jobs" does not exist');
      const result = await call({ params: { name: "whats_next", arguments: {} } });

      const reference = /\b([0-9a-f]{8,})\b/.exec(result.content[0]?.text ?? "")?.[1];
      expect(reference).toBeDefined();

      expect(errorSpy).toHaveBeenCalledOnce();
      const logged = errorSpy.mock.calls[0]?.join(" ") ?? "";
      expect(logged).toContain('relation "public.jobs" does not exist');
      expect(logged).toContain(reference!);
      expect(logged).toContain("whats_next");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("gives each failure its OWN reference (two failures are never confused in the log)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const call = callThrowing("boom");
      const first = await call({ params: { name: "whats_next", arguments: {} } });
      const second = await call({ params: { name: "whats_next", arguments: {} } });
      expect(first.content[0]?.text).not.toBe(second.content[0]?.text);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

/**
 * D17 credit confirmation threshold — the SaaS analogue of the consent ledger. No tool in
 * TOOL_COSTS reaches the threshold today (the whole table sits well below it), so the
 * OVER-threshold behaviour is proven here with SYNTHETIC estimates passed straight to the pure
 * gate — TOOL_COSTS is never touched. The registry wires confirmationGate(name, TOOL_COSTS[name], rawInput) before dispatch,
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


/**
 * G11 — the project scope the registry stamps on a surface tool's ledger rows (migration 0033).
 * Read generically off the validated input, because the registry opens the reserve BEFORE the
 * handler runs: a per-tool value could only arrive by threading an argument through thirty-odd
 * call sites, and a forgotten one writes a project-less row indistinguishable from an honestly
 * project-less one.
 */
describe("declaredProjectId", () => {
  it("takes the project_id a tool's own input declares", () => {
    expect(declaredProjectId({ project_id: "11111111-2222-4333-8444-555555555555" })).toBe(
      "11111111-2222-4333-8444-555555555555",
    );
  });

  it("is undefined for a tool that declares none — a real answer, not a failure", () => {
    expect(declaredProjectId({ keywords: ["a", "b"] })).toBeUndefined();
    expect(declaredProjectId({})).toBeUndefined();
  });

  /**
   * IT DOES NOT FALL BACK TO `target`. Thirteen tools accept a bare domain, including a
   * COMPETITOR'S, and resolving one to a project here would bill a competitor lookup against
   * whichever of the tenant's own sites happened to match the name. An honest blank beats an
   * invented scope, because a scope is a number somebody adds up.
   */
  it("never infers a project from a target domain", () => {
    expect(declaredProjectId({ target: "competitor.com" })).toBeUndefined();
  });

  it("treats a blank or non-string as no scope rather than as a scope", () => {
    expect(declaredProjectId({ project_id: "" })).toBeUndefined();
    expect(declaredProjectId({ project_id: 42 })).toBeUndefined();
    expect(declaredProjectId({ project_id: null })).toBeUndefined();
    expect(declaredProjectId(null)).toBeUndefined();
    expect(declaredProjectId("not-an-object")).toBeUndefined();
  });
});

/**
 * textResultWithCard — the MCP Apps card goes through zod on the way OUT, so a malformed card
 * fails in a test run and never as a blank frame in a customer's chat (spec §8.1).
 */
describe("textResultWithCard", () => {
  /**
   * The card goes through zod on the way out. A malformed card must fail in a test run, never in
   * a customer's chat — and never silently, as an empty frame the reader mistakes for a product
   * that does not work.
   */
  it("refuses a card the template cannot draw", () => {
    expect(() => textResultWithCard("the answer", { kind: "metric", title: "x", value: "" } as never))
      .toThrow(/card/i);
  });

  it("carries the sentence in both channels beside the card", () => {
    const result = textResultWithCard("the answer", {
      kind: "metric",
      title: "Credit balance",
      value: "4519",
      facts: [],
    });
    expect(result.content[0]?.text).toBe("the answer");
    expect(result.structuredContent?.summary).toBe("the answer");
    expect(result.structuredContent?.card).toMatchObject({ kind: "metric", value: "4519" });
  });
});

/**
 * §8.2 wiring gate — the biconditional between `ui.resourceUri` and `CARDED_TOOLS` membership.
 * Both directions, across every REGISTERED tool (ALL_TOOLS from tools/index.ts), not a
 * hand-maintained duplicate list: a hand-maintained list is exactly the hole this gate exists to
 * close. ALL_TOOLS is importable DB-free (registered-tool objects only; getServiceClient is a
 * lazy singleton — see db.ts), so this runs in the fast, DB-less lane.
 */
describe("card wiring gate (spec §8.2) — a tool carries ui.resourceUri iff it is in CARDED_TOOLS", () => {
  it("every carded tool declares ui.resourceUri", () => {
    for (const tool of ALL_TOOLS) {
      if (CARDED_TOOLS.has(tool.name)) {
        expect(tool.uiResourceUri, `${tool.name} is in CARDED_TOOLS but declares no ui.resourceUri`)
          .toBeDefined();
      }
    }
  });

  it("every tool that declares ui.resourceUri is in CARDED_TOOLS", () => {
    for (const tool of ALL_TOOLS) {
      if (tool.uiResourceUri !== undefined) {
        expect(CARDED_TOOLS.has(tool.name), `${tool.name} declares ui.resourceUri but is not in CARDED_TOOLS`)
          .toBe(true);
        // Fix round 2 (coordinator ruling): a typo'd URI (e.g. "ui://seogrep/crad") would satisfy
        // both directions above — the tool is carded, it declares SOME uri — while resources/read
        // misses and the host renders nothing. Pin the declared URI to one this server actually
        // serves.
        expect(
          UI_RESOURCES.some((resource) => resource.uri === tool.uiResourceUri),
          `${tool.name} declares ui.resourceUri "${tool.uiResourceUri}", which no UI_RESOURCES entry serves`,
        ).toBe(true);
      }
    }
  });

  /**
   * Fix round 2 (coordinator ruling): the two `it`s above are BOTH `if`-guarded inside a `for`,
   * so an empty or truncated ALL_TOOLS would pass both vacuously. This loop iterates
   * `CARDED_TOOLS` directly instead — a name in it that is defined but never wired into
   * `tools/index.ts`'s ALL_TOOLS ships a card nobody can call, and the two loops above stay
   * silent about a tool that is simply absent from what they walk.
   */
  it("every carded tool is actually registered in ALL_TOOLS", () => {
    for (const name of CARDED_TOOLS) {
      expect(ALL_TOOLS.some((tool) => tool.name === name)).toBe(true);
    }
  });
});

/**
 * S1 — UNKNOWN KEYS ARE REFUSED, AND THE ADVERTISED SCHEMA SAYS SO.
 *
 * Measured on the live surface 2026-09-02: not one of the 38 `inputSchema`s in `tools/list`
 * carried `additionalProperties: false`, and zod's default object parse STRIPS what it does not
 * recognise. So `{"limit": 5, "limitt": 500}` ran with the default limit and answered as if the
 * caller had asked for it — a typo, a stale parameter name, or a client sending a field this
 * server no longer supports all looked exactly like a correct call. The four control records that
 * caught it: get_credit_balance B-2, list_jobs B-1, list_projects B-2, list_gsc_properties LGP-4.
 *
 * The fix is at the REGISTRY, not in 38 schemas, so these tests are written against the registry:
 * one loop over every registered tool (a per-tool `.strict()` would be a hand-maintained list, and
 * this repo has paid for that shape before), plus the refusal's own behaviour.
 */
describe("S1 — unknown input keys are refused, not silently dropped", () => {
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

  it("every registered tool ADVERTISES additionalProperties:false in tools/list", () => {
    const loose = ALL_TOOLS.filter(
      (tool) =>
        (tool.inputJsonSchema as { additionalProperties?: unknown }).additionalProperties !== false,
    ).map((tool) => tool.name);
    expect(loose).toEqual([]);
    // Not vacuous: the filter above is silent on an empty ALL_TOOLS, and the surface is 38 tools.
    expect(ALL_TOOLS.length).toBe(38);
  });

  it("refuses an unknown key and NAMES it, without running the handler", async () => {
    const handler = vi.fn(async () => textResult("should not run"));
    const tool = defineTool({
      name: "whats_next",
      description: "d",
      inputSchema: z.object({ focus: z.string().optional() }),
      handler,
    });

    const result = await tool.run(CTX, { focus: "titles", fokus: "titles" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input for "whats_next"/i);
    expect(result.content[0]?.text).toMatch(/fokus/);
    expect(handler).not.toHaveBeenCalled();
  });

  /**
   * The refusal is free BY CONSTRUCTION — it returns before any charge mode — and on a PRICED
   * tool it must say so. With every SUPABASE_* var stripped, any reserve would throw loadEnv, so
   * an ordinary isError result is itself the proof that the guard never ran.
   */
  it("charges nothing for an unknown key on a PRICED surface tool, and says so", async () => {
    const handler = vi.fn(async () => textResult("should not run"));
    const tool = defineTool({
      name: "research_keywords", // priced (25); a surface charge here would need the DB
      description: "d",
      inputSchema: z.object({ keywords: z.array(z.string()).optional() }),
      handler,
    });

    const result = await tool.run(CTX, { keywords: ["a"], keyword: "a" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(NOT_CHARGED_SENTENCE);
    expect(handler).not.toHaveBeenCalled();
  });

  /**
   * `confirm` is the ONE reserved registry parameter (D17), deliberately absent from every tool's
   * zod schema. Strictness must not turn it into an unknown key: a caller told to "run it again
   * with confirm: true" would then be refused for doing exactly that, and the only tools the D17
   * gate ever fires for — ai_visibility_compare at 90 x targets, crawl_site's large-site prompt —
   * are precisely the ones that would become uncallable.
   */
  it("still accepts the reserved `confirm` flag, which no tool schema declares", async () => {
    const handler = vi.fn(async (_ctx: AuthContext, input: { targets: string[] }) =>
      textResult(`compared ${input.targets.length}`),
    );
    const tool = defineTool({
      name: "ai_visibility_compare", // 90 per target: ten targets is 900, over the D17 threshold
      description: "d",
      inputSchema: z.object({ targets: z.array(z.string()) }),
      charge: "handler",
      units: (input: { targets: string[] }) => input.targets.length,
      handler,
    });

    const targets = Array.from({ length: 10 }, (_value, index) => `t${index}.example`);
    const result = await tool.run(CTX, { targets, confirm: true });
    expect(result).toEqual(textResult("compared 10"));
    // The flag is stripped before the handler sees it — it is the registry's, not the tool's.
    expect(handler.mock.calls[0]?.[1]).toEqual({ targets });
  });
});
