import { z } from "zod";
import { newFailureReference } from "../failure-redaction.ts";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { AuthContext } from "../auth.ts";
import { cardSchema, type Card } from "../ui/card-model.ts";
import { isReserveCommitFailed, withCredits } from "../credits/guard.ts";
import { isPaidBalanceRequired } from "../credits/paid-balance.ts";
import { isFreeVendorSpendLimit } from "../credits/free-vendor-calls.ts";
import { NOT_CHARGED_SENTENCE, withNoChargeNote } from "../credits/free-refusal.ts";
import { isInsufficientCredits } from "../credits/insufficient-credits.ts";
import { isPreconditionNotMet } from "./precondition.ts";
import { isGscReauthRequired, renderReconnectInstruction } from "../gsc-data/reauth-error.ts";
import { isDfsBudgetExhausted } from "../dfs/budget-error.ts";
import {
  CREDIT_UNITS,
  TOOL_COSTS,
  creditCostFor,
  isPerUnitTool,
  type ToolName,
} from "../credits/costs.ts";

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
  /**
   * The same answer as DATA, for a host rendering this tool's MCP Apps view (SEP-1865).
   *
   * NEVER A REPLACEMENT FOR `content`. The spec keeps the text mandatory because it is what the
   * MODEL reads and what every non-supporting host shows; this is an extra channel a view can
   * read fields out of instead of scraping a sentence. A tool with no view omits it, and every
   * client that does not understand it ignores it.
   */
  readonly structuredContent?: Record<string, unknown>;
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
  /**
   * The tool body. Receives the parsed+validated `input` and, as a third argument, the RAW
   * MCP arguments — the pre-parse object. Almost every handler ignores `rawInput`; it exists
   * so a tool that must read a RESERVED, schema-less parameter (e.g. `confirm`, via
   * readConfirmFlag) can do so without polluting its zod schema / tools/list. Reading it does
   * NOT bypass the registry's own D17 gate below — that gate still runs first, unchanged.
   */
  readonly handler: (ctx: AuthContext, input: TIn, rawInput: unknown) => Promise<ToolResult>;
  /** Credit-settlement mode. Defaults to "surface" (sync charge under the guard). */
  readonly charge?: ChargeMode;
  /**
   * The HANDLER runs a confirmation prompt of its OWN, independent of the registry's D17 gate —
   * declared so the advertised schema carries the reserved `confirm` flag for it.
   *
   * D17 is derived from the signed price table and covers every tool whose worst case can trip
   * the threshold (canRequireConfirmation). This field covers the case the table CANNOT know:
   * crawl_site costs a flat 20 credits and can never trip the gate, yet its handler answers a
   * large site with a confirmation and the docs tell the reader to re-run with `"confirm": true`.
   * Since the schemas refuse unknown keys, an unadvertised flag is an instruction a
   * schema-validating client may not be able to follow.
   *
   * It changes the ADVERTISEMENT only. Nothing about parsing, charging or the handler's own logic
   * depends on it: `confirm` stays a reserved registry parameter, read off the raw input and
   * stripped before the parse, exactly as before.
   */
  readonly confirmsInHandler?: true;
  /**
   * The MCP Apps view (SEP-1865) a supporting host renders for this tool's results, named by the
   * `ui://` resource URI that `resources/list` advertises.
   *
   * DECLARED UNCONDITIONALLY, which the spec's own guidance ("check client capabilities before
   * registering UI-enabled tools") would rather we did not — and cannot be done here. This
   * gateway is STATELESS: `handleMcpRequest` builds a fresh Server per HTTP request with
   * `sessionIdGenerator: undefined`, so the capabilities a client advertised at `initialize`
   * are not in scope when a later `tools/list` arrives. Declaring it anyway is safe by the
   * extension's own backwards-compatibility rule — `_meta` a host does not understand is ignored
   * — and it is the reason `content` may never stop carrying the whole answer.
   */
  readonly ui?: { readonly resourceUri: string };
  /**
   * How many PRICED UNITS this call buys, read off the parsed input — declared ONLY by a tool whose
   * signed price is per unit rather than per call (credits/costs.ts CREDIT_UNITS). Optional in the
   * TYPE because every other tool omits it — omitted means one unit — but REQUIRED for a per-unit
   * name, and defineTool throws at declaration time when one is missing.
   *
   * It exists for the D17 gate below and nothing else: that gate has to weigh what the CALL will
   * cost, and for `ai_visibility_compare` that is 90 x targets — 900 at ten targets, well over the
   * 200-credit threshold. Reading TOOL_COSTS[name] alone would have weighed 90 and let a
   * 900-credit call through unconfirmed. The hook yields a COUNT, never an amount, so the price
   * arithmetic stays in creditCostFor and a tool cannot understate its own estimate to dodge the
   * gate (a count below the real one is bounded by the same zod schema the handler charges from,
   * and the two read the same field).
   */
  readonly units?: (input: TIn) => number;
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
  /**
   * The RESOLVED charge mode (spec.charge ?? "surface"), carried here because the registry's
   * failure path has to answer a money question the caller always asks first — "was I charged?" —
   * and the answer depends ENTIRELY on this. On "surface" and "handler" the reserve is opened and
   * released inside this request; on "worker" it belongs to a background job this catch cannot
   * see. See refundAssurance below.
   */
  readonly charge: ChargeMode;
  /** The tool's MCP Apps view URI, or undefined when it has none. See ToolSpec.ui. */
  readonly uiResourceUri?: string;
  /**
   * Whether `inputJsonSchema` advertises the reserved `confirm` flag — true when the D17 gate can
   * fire on this tool's signed price (canRequireConfirmation) OR the spec declares that its
   * handler prompts for itself (ToolSpec.confirmsInHandler). Carried here so the docs gate can
   * tell a REGISTRY-injected advertisement from a tool that wrongly declared `confirm` in its own
   * zod schema; the two look identical in the JSON Schema alone.
   */
  readonly confirmable: boolean;
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

/**
 * A text result that ALSO carries structured data for an MCP Apps view.
 *
 * A separate function rather than a second parameter on `textResult`, so the 37 tools that have
 * no view keep calling a function that cannot grow a second channel by accident.
 *
 * IT FOLDS THE SENTENCE INTO THE DATA, and that is the whole reason this function exists rather
 * than a literal at each call site. MEASURED 2026-08-27, minutes after the MCP Apps probe went
 * live: a real client that receives BOTH channels showed only `structuredContent` and dropped
 * `content` entirely, so the model saw `{"balance":4519,"paid":true}` where an hour earlier it
 * had seen the sentence — including the clause explaining that trial credits do not unlock the
 * vendor tools, which exists precisely so the assistant does not tell a trial account it is
 * ready to spend.
 *
 * The extension's promise is that `content` is what the model reads and the data is merely an
 * extra channel. That promise is the HOST's to keep, and at least one host does not. So this
 * server stops depending on it: whatever a client chooses to show, it cannot show less than the
 * whole answer, because the whole answer is in both channels.
 *
 * `summary` may not be supplied by the caller — a tool that passed its own would decide which
 * copy wins, which is the ambiguity this closes. Declaring one throws at call time rather than
 * being silently overwritten, so the conflict surfaces in a test run and never in production.
 */
export function textResultWithData(
  text: string,
  structuredContent: Record<string, unknown>,
): ToolResult {
  if ("summary" in structuredContent) {
    throw new Error(
      'textResultWithData owns the "summary" field: it carries the tool\'s full text answer so a ' +
        "host that renders only structuredContent cannot show less than the whole answer. Name " +
        "the caller's field something else.",
    );
  }
  return { content: [{ type: "text", text }], structuredContent: { ...structuredContent, summary: text } };
}

/**
 * A text result carrying a VALIDATED MCP Apps card beside it.
 *
 * The card goes through zod here rather than at each call site, so a tool cannot ship a shape the
 * template has no branch for. The failure is a THROW: a card that arrived malformed would paint
 * an empty frame, and an empty frame reads to a customer as a product that does not work — a
 * worse outcome than a loud test failure.
 *
 * `summary` still carries the whole sentence (see textResultWithData): a host that renders only
 * structuredContent must not be able to show less than the whole answer.
 */
export function textResultWithCard(text: string, card: Card): ToolResult {
  const parsed = cardSchema.safeParse(card);
  if (!parsed.success) {
    throw new Error(`Invalid MCP Apps card: ${z.prettifyError(parsed.error)}`);
  }
  return textResultWithData(text, { card: parsed.data });
}

/** An error tool result (isError so the MCP client renders it as a failure, not data). */
export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What this request can HONESTLY promise about the caller's credits after a failure — or null
 * when it can promise nothing.
 *
 * WHY IT EXISTS. A 90-credit tool answering "failed unexpectedly … quote reference 3f9c1a20"
 * leaves the user's first question unanswered: did that cost me 90 credits? The refund really
 * does happen (withCredits releases on a throw), but nothing said so, so the honest reader has
 * to assume the worst. Every OTHER refusal branch in this file already ends in "You were not
 * charged"; the generic branch was the one that did not.
 *
 * WHY IT IS NOT A BLANKET SENTENCE. The claim is only true where this request owns the reserve
 * and knows it came back. Three paths are carved out, and each is a real state, not caution:
 *
 *   charge "worker" — the handler ENQUEUED a background job. A throw here means the enqueue
 *     path failed, but a jobs row may already exist, and the WORKER opens and settles that
 *     reserve later (queue/worker.ts). This request cannot see the outcome, so it says nothing
 *     and leaves get_job_status as the honest answer. Writing "you were not charged" here would
 *     be a money claim about a charge that has not been decided yet.
 *   ReserveCommitFailedError, disposition "unknown" — the tool RAN, its commit would not
 *     confirm, AND the classifying read failed too (credits/guard.ts). The one state where the
 *     ledger itself cannot say. Promise nothing; point at the path that can resolve it.
 *   ReserveCommitFailedError, disposition "open" / "refunded" — a refund IS coming or already
 *     came, but "you were not charged" is not yet true for "open". Each gets its own sentence,
 *     the same split (and for the same reason) as COMMIT_FAILED_BY_DISPOSITION in
 *     queue/worker.ts: one blanket promise was a promise the code could not keep for every shape.
 *
 * Everything else on "surface" / "handler" is the plain case: the guard released the reserve
 * before rethrowing, which is exactly the guarantee the precondition and reauth branches already
 * state in the same words.
 */
export function refundAssurance(charge: ChargeMode, error: unknown): string | null {
  // The worker owns this reserve, and it has not run yet. Nothing here can be promised.
  if (charge === "worker") return null;
  if (isReserveCommitFailed(error)) {
    if (error.disposition === "refunded") {
      return "The credit reserve for this call was already refunded, so you were not charged.";
    }
    if (error.disposition === "open") {
      return (
        "The credit reserve for this call is still open; reconciliation refunds it automatically, " +
        "so you will not be charged for it."
      );
    }
    // "unknown": the ledger read failed too. No promise — just the one path that can settle it.
    return "The final state of this call's credit reserve could not be confirmed — contact support if your balance looks short.";
  }
  return NOT_CHARGED_SENTENCE;
}

/**
 * D17 credit confirmation threshold — the SaaS analogue of the consent ledger: a call whose
 * ESTIMATED cost exceeds this many credits must be explicitly confirmed before it runs, so a
 * large batch can never silently drain a balance.
 *
 * NO SINGLE ROW of TOOL_COSTS reaches it (the whole table sits well below), and for a long time
 * that meant no registered tool could — the over-threshold path was exercised only with SYNTHETIC
 * estimates. `ai_visibility_compare` (2026-08-19) is the first tool that DOES reach it, because
 * its signed price is 90 credits PER COMPARED TARGET: at three targets the estimate is 270 and at
 * ten it is 900. That is the gate working as designed on the first call expensive enough to need
 * it, not a threshold to move — the signature names the 900 and says asking first is correct.
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
 * registry parameter: it is in NO tool's zod schema, and `defineTool` advertises it — in the JSON
 * Schema alone — only on a confirmable tool. Only the literal boolean `true` counts as
 * confirmation (a string "true" or any truthy value does not), so a client must send
 * `"confirm": true` explicitly.
 *
 * It is read from the RAW input because the parsed input never carries it: the schemas REFUSE
 * unknown keys (S1), and on a confirmable tool `withoutReservedParams` strips this one before the
 * parse so the caller a confirmation prompt just told to "run it again with confirm: true" is not
 * then refused for doing exactly that. On a tool that advertises nothing the parse refuses it as
 * an unknown key, which returns BEFORE the dispatch gate — so this never runs for one.
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
 * Whether the D17 confirmation gate can EVER fire for `tool` — the worst call this tool's signed
 * price allows, weighed against the threshold.
 *
 * Derived from the price table rather than from a list of tool names, so a signed price change
 * moves the advertisement with it and a new tool needs nobody to remember. It reads the WORST
 * case because that is the only reading that separates the two per-unit tools: at the vendor's
 * own cap one clears the threshold and the other does not, so "declares a units hook" would offer
 * the flag on a call whose price can never need it. The two figures are deliberately NOT quoted
 * here — a price written into a comment is a second copy of CREDIT_UNITS, free to go stale
 * (a referee caught exactly that in this docstring); registry.test.ts computes them instead.
 *
 * It answers about the REGISTRY's gate only. A tool whose handler asks for a confirmation of its
 * own — crawl_site's large-site prompt — is invisible to the price table and declares itself
 * instead (ToolSpec.confirmsInHandler); defineTool advertises the flag for either route.
 */
export function canRequireConfirmation(tool: ToolName): boolean {
  const worstCase = isPerUnitTool(tool)
    ? creditCostFor(tool, CREDIT_UNITS[tool].max_units)
    : TOOL_COSTS[tool];
  return worstCase > CONFIRMATION_THRESHOLD_CREDITS;
}

/**
 * How the reserved `confirm` flag is ADVERTISED (never parsed — no zod schema declares it).
 *
 * English, the UI-copy language of this product, and deliberately the same vocabulary the prompts
 * use ("estimated to cost … above the … confirmation threshold"): a reader who meets a prompt and
 * then the schema must not have to work out that the two name the same flag. It names BOTH routes
 * that can produce one, because one sentence is advertised for both — D17's cost estimate, and a
 * handler's own scope prompt (crawl_site's large site), which is about no cost at all.
 */
const CONFIRM_INPUT_FIELD = {
  type: "boolean",
  description:
    "Set to true to re-run a call this tool answered with a confirmation prompt — an estimated " +
    "cost above the confirmation threshold, or a scope the tool asks you to confirm. Optional, " +
    "and only meaningful after such a prompt: nothing is charged until the call is re-run with it.",
} as const;

/**
 * The advertised schema with `confirm` added as an OPTIONAL property — a NEW object, and `required`
 * is left exactly as it was.
 *
 * Applied ONLY to a confirmable tool. Offering the flag on all 38 would put a parameter that can
 * never do anything in front of the model 37 times, and the schema is what the model reasons from.
 */
export function withConfirmField(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  const properties = (jsonSchema.properties ?? {}) as Record<string, unknown>;
  return { ...jsonSchema, properties: { ...properties, confirm: CONFIRM_INPUT_FIELD } };
}

/**
 * The registry's RESERVED input parameters — names a caller may send that belong to the REGISTRY
 * rather than to any tool, and which therefore appear in NO tool's zod schema. They are not
 * invisible: `defineTool` advertises `confirm` in the JSON Schema of a confirmable tool, and
 * only there. Today there is exactly one, read straight off the raw input by readConfirmFlag and
 * by crawl_site's large-site prompt.
 */
const RESERVED_INPUT_PARAMS: readonly string[] = ["confirm"];

/**
 * The caller's arguments with the reserved registry parameters removed, as a NEW object.
 *
 * It exists because of what refuseUnknownKeys below does: once a schema refuses what it does not
 * recognise, `confirm` — which by design no schema recognises — would be refused too, and the one
 * instruction a confirmation prompt gives ("run it again with confirm: true") would become the
 * one call that cannot succeed. Stripping it keeps the flag exactly where it has always been read
 * from (the raw input, which every path still receives untouched) while the tool's own fields
 * face a schema that names a typo instead of dropping it.
 *
 * APPLIED ONLY TO A TOOL THAT ADVERTISES THE FLAG (referee P2). Stripping it everywhere made the
 * other 36 tools swallow `confirm` in silence while their schemas promised to refuse it — the
 * same silent drop this slice exists to end, this time wearing the registry's own name. Where the
 * flag is not advertised it is an unknown key like any other.
 *
 * A non-object is returned unchanged so zod still produces its own "expected object" message.
 */
export function withoutReservedParams(rawInput: unknown): unknown {
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) return rawInput;
  return Object.fromEntries(
    Object.entries(rawInput as Record<string, unknown>).filter(
      ([key]) => !RESERVED_INPUT_PARAMS.includes(key),
    ),
  );
}

/**
 * The same schema, made to REFUSE an unrecognised key instead of silently dropping it (S1) — the
 * ONE place strictness is applied, for every tool at once.
 *
 * WHY IT IS HERE AND NOT IN 38 SCHEMAS. Zod's default object parse strips unknown keys, so until
 * this existed `{"limit": 5, "limitt": 500}` ran with the DEFAULT limit and answered as though
 * the caller had asked for it: a typo, a stale parameter name, and a client sending a field this
 * server no longer supports were all indistinguishable from a correct call, on all 38 tools
 * (measured on the live surface 2026-09-02 — not one advertised `additionalProperties: false`).
 * Adding `.strict()` tool by tool would be a hand-maintained list of 38 places to remember, which
 * is the shape this repo has already paid for; here it cannot be forgotten by a new tool, because
 * a new tool has nowhere else to be built.
 *
 * It is applied to both halves of the contract from this single call — the advertised JSON Schema
 * (toInputJsonSchema, so `additionalProperties: false` reaches tools/list) and the parse
 * (defineTool) — so the promise and the behaviour cannot drift apart.
 *
 * A schema that is not a plain object (none today) is returned untouched rather than wrapped: it
 * has no unknown-key notion to tighten. The gate against that going unnoticed is the loop over
 * ALL_TOOLS in registry.test.ts, which reads what each tool actually ADVERTISES.
 *
 * IT GOES ALL THE WAY DOWN (S1-b, 2026-09-05). The first version tightened only the outermost
 * object, and the loop that guarded it read only the outermost `additionalProperties` — so
 * `ai_visibility_compare`'s `targets[]` items advertised nothing, and a live call with
 * `{domain: "…", bogus_nested: "x"}` was accepted, silently stripped, and BILLED 180 credits.
 * That is S1's own failure mode one level down, on the priciest tool on the surface, where the
 * costliest typo is not a joke key but `label` — the vendor's `aggregation_key`, which is what
 * rows are matched on. Fixing it at the one nested schema would have rebuilt the hand-maintained
 * list this function exists to abolish.
 *
 * MEASURED BEFORE IT WAS WRITTEN: across all 38 tools there is exactly ONE nested object today
 * (`ai_visibility_compare.targets[]`), so the walk below has one real subject and cannot quietly
 * change 37 other contracts. registry.test.ts names that table rather than counting it, and
 * asserts over the ADVERTISED JSON SCHEMA rather than over the zod classes — a nested object
 * arriving under a wrapper this walk does not know about still shows up as an object node there.
 */
export function refuseUnknownKeys<TIn>(schema: z.ZodType<TIn>): z.ZodType<TIn> {
  return tightenNode(schema) as z.ZodType<TIn>;
}

/**
 * One node of a schema tree, tightened — objects made strict, and their fields (including the
 * element type of an array) tightened first.
 *
 * NOTHING IS REBUILT THAT DID NOT CHANGE. An unchanged node is returned by identity, so a schema
 * with no nested object is the same object the caller passed and the 37 tools with flat inputs are
 * untouched by construction rather than by inspection.
 *
 * `safeExtend`, not `extend`: zod REFUSES `.extend()` on an object carrying refinements, and every
 * interesting schema on this surface carries one (the subject rules, the exactly-one-of rules). An
 * array is cloned with its own def so `.min()`, `.max()` and its description survive — a tightener
 * that quietly dropped a bound while advertising a stricter contract would be worse than the hole.
 */
function tightenNode(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const tightenedFields: Record<string, z.ZodType> = {};
    for (const [key, field] of Object.entries(shape)) {
      const tightened = tightenNode(field);
      if (tightened !== field) tightenedFields[key] = tightened;
    }
    const withFields =
      Object.keys(tightenedFields).length === 0 ? schema : schema.safeExtend(tightenedFields);
    // Both safeExtend() and strict() return a NEW instance, so the object's own `.describe()` is
    // dropped here for the same reason clone() drops the array's — see carryMeta.
    return carryMeta(schema, withFields.strict()) as unknown as z.ZodType;
  }
  if (schema instanceof z.ZodArray) {
    const element = schema.element as z.ZodType;
    const tightened = tightenNode(element);
    if (tightened === element) return schema;
    return carryMeta(schema, schema.clone({ ...schema.def, element: tightened }));
  }
  return schema;
}

/**
 * Copy a schema's registry entry onto its rebuilt twin.
 *
 * `.describe()` in zod 4 does NOT live on the def — it is an entry in `z.globalRegistry` keyed by
 * the schema INSTANCE — so a `clone()` comes back anonymous and every `.describe()` on it is gone.
 * Measured the moment this walk was first written: `ai_visibility_compare`'s `targets` description
 * (the one that says THE PRICE IS PER COMPARED TARGET) vanished from tools/list and from its docs
 * page, and the tool-docs check in verify.sh is what said so. A tightener that silently deletes
 * the sentence naming a tool's price would have been a worse defect than the hole it closed.
 *
 * IT APPLIES TO OBJECTS TOO (F-5), and not only to the cloned array: `.safeExtend()` and
 * `.strict()` each return a new instance, so an OBJECT's own description was dropped by the same
 * mechanism. No inner object carries one today, so nothing was red — which is exactly why it was
 * worth closing before the first one is added and loses its sentence with no gate but docs-drift.
 */
function carryMeta<T extends z.ZodType>(from: z.ZodType, to: T): T {
  const meta = z.globalRegistry.get(from);
  if (meta !== undefined) z.globalRegistry.add(to, meta);
  return to;
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
  const json = z.toJSONSchema(refuseUnknownKeys(schema), { io: "input" }) as Record<
    string,
    unknown
  >;
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
 *
 * DECLARATION-TIME, not call-time: a tool whose price is PER UNIT must declare the `units` hook.
 * creditCostFor already refuses to price a per-unit tool without a count, but that refusal lands
 * when a user calls the tool; this one lands when the module is imported, which is every gate that
 * builds the registry. Without it, forgetting the hook would leave the D17 gate weighing the unit
 * price (90) instead of the call price (up to 900) and waving a 900-credit call through
 * unconfirmed — a silent under-estimate rather than a loud failure.
 */
/**
 * The `project_id` a tool's own validated input declares, or undefined when it declares none.
 *
 * Only a tool that TAKES a project_id can name one, and by the time this runs zod has already
 * accepted it — every such schema constrains the field to a uuid — so this neither validates nor
 * guesses. It does not fall back to `target`: a domain is not a project id, several tools accept
 * a competitor's domain that is nobody's project, and resolving one to a project here would
 * attribute a competitor lookup to whichever of the tenant's sites happened to match.
 *
 * Undefined means "no project scope", which is a real answer the ledger stores as null.
 */
export function declaredProjectId(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>).project_id;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Terminate a ONE-LINE zod refusal so the fee sentence that follows it reads as a sentence.
 *
 * `withNoChargeNote` joins a single-line refusal to "You were not charged." with a SPACE, which is
 * right for prose and wrong for zod: `z.prettifyError` ends a one-issue message with the offending
 * value and no terminator, so the join produced `✖ Unrecognized key: "limit" You were not charged.`
 * — measured live on all four GSC tools and on audit_speed before them.
 *
 * MULTI-LINE messages are returned UNTOUCHED. Those end on an indented field path (`→ at
 * project_id`) and withNoChargeNote already separates them with a blank line; a period there would
 * attach itself to the path and read as part of the field name.
 *
 * The fix lives here rather than in free-refusal.ts (slice 2 ruling): that module's separator rule
 * is correct for every caller, and this is the only caller that hands it an unterminated sentence.
 */
function terminateOneLine(message: string): string {
  if (message.includes("\n")) return message;
  return /[.!?:;]$/.test(message) ? message : `${message}.`;
}

export function defineTool<TIn>(spec: ToolSpec<TIn>): RegisteredTool {
  if (isPerUnitTool(spec.name) && spec.units === undefined) {
    throw new Error(
      `"${spec.name}" is priced per unit, so its spec must declare a "units" hook: the D17 ` +
        `confirmation gate weighs what the CALL costs, and without the hook it would weigh one ` +
        `unit's price instead.`,
    );
  }
  const parseSchema = refuseUnknownKeys(spec.inputSchema);
  // The advertised schema is the parsed one PLUS the reserved flag, on the tools where the D17
  // gate can fire. Without it `additionalProperties: false` would forbid the one retry the
  // confirmation prompt asks for; the parse still strips the flag, so no tool schema gains it.
  // Two independent routes to the same advertisement: a price that can trip D17, or a handler
  // that prompts on its own. Neither is a list of tool names.
  const confirmable = canRequireConfirmation(spec.name) || spec.confirmsInHandler === true;
  const derivedJsonSchema = toInputJsonSchema(parseSchema);
  const inputJsonSchema = confirmable ? withConfirmField(derivedJsonSchema) : derivedJsonSchema;
  const charge: ChargeMode = spec.charge ?? "surface";
  return {
    name: spec.name,
    description: spec.description,
    inputJsonSchema,
    charge,
    uiResourceUri: spec.ui?.resourceUri,
    confirmable,
    async run(ctx, rawInput) {
      // The reserved flag is stripped only where it is ADVERTISED; anywhere else the schema
      // promised to refuse an unknown key and must keep that promise. A refusal returns before
      // the D17 gate below, so an unadvertised tool never reaches readConfirmFlag at all.
      const candidate = confirmable ? withoutReservedParams(rawInput) : rawInput;
      const parsed = parseSchema.safeParse(candidate ?? {});
      if (!parsed.success) {
        // Free by construction — this returns before ANY charge mode runs, so the guard, the
        // handler and the enqueue are all unreached and the ledger is never touched. Said out
        // loud only for a PRICED tool: on a 0-credit tool "you were not charged" is noise about
        // a charge that could never have happened, and the table is read directly rather than
        // through creditCostFor, which throws for a per-unit tool when it is handed no count.
        const refusal = terminateOneLine(
          `Invalid input for "${spec.name}": ${z.prettifyError(parsed.error)}`,
        );
        return errorResult(TOOL_COSTS[spec.name] > 0 ? withNoChargeNote(refusal) : refusal);
      }
      // D17 confirmation threshold — the ONE cross-cutting credit concern, applied to every charge
      // mode BEFORE dispatch: a call whose estimate exceeds the threshold and did not set
      // confirm:true returns a confirmation prompt and settles nothing (the guard/handler never
      // run). `confirm` is read from the RAW input (a reserved registry param, never in the tool
      // schema).
      //
      // The estimate is the CALL's, not the row's: for a per-unit tool it is the unit price times
      // the units this input buys (spec.units), which is the only reason a 900-credit ten-target
      // comparison meets the gate at all. Every other tool declares no `units`, so this is
      // TOOL_COSTS[name] exactly as before.
      const gate = confirmationGate(
        spec.name,
        creditCostFor(spec.name, spec.units?.(parsed.data)),
        rawInput,
      );
      if (gate) return gate;

      if (charge === "surface") {
        // Registry-owned settlement: charge at the surface. No jobId — the guard uses a
        // traceability uuid for the ledger and never writes a jobs row (credits/guard.ts).
        //
        // The project scope is read GENERICALLY off the parsed input (migration 0033). Doing it
        // here rather than tool by tool is the whole point: the registry opens the reserve before
        // the handler runs, so a per-tool value could only arrive by threading an argument
        // through every surface tool — thirty-odd call sites, each of which could forget, and a
        // forgotten one writes a project-less row indistinguishable from an honestly
        // project-less one. Reading the declared `project_id` parameter cannot be forgotten
        // because it is not a call site at all.
        return withCredits(
          { userId: ctx.userId },
          { tool: spec.name, projectId: declaredProjectId(parsed.data) },
          () => spec.handler(ctx, parsed.data, rawInput),
        );
      }
      // "handler" or "worker": settlement is the handler's (sync self-settle) or the worker's
      // (async, keyed to jobs.id). The registry does NOT wrap — wrapping would double-charge.
      // rawInput is threaded so a worker/handler tool can read a reserved param (crawl_site's
      // dynamic large-site confirm) without adding it to its schema.
      return spec.handler(ctx, parsed.data, rawInput);
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
      // SEP-1865 names the view through `_meta.ui.resourceUri`. SPREAD, not a `_meta: undefined`
      // key: a tool with no view must serialize byte-identically to how it did before this
      // existed, or every client that hashes or diffs tools/list sees 38 tools change.
      ...(tool.uiResourceUri === undefined
        ? {}
        : { _meta: { ui: { resourceUri: tool.uiResourceUri } } }),
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
      // A DELIBERATE refusal that had no choice but to throw. The paid-balance gate lives inside
      // withCredits, which is generic in T and so cannot return a ToolResult — its only exit is
      // an exception, and it lands in this catch beside the genuine crashes. It is not one: the
      // rule worked. Its sentence is written to be read by the user (what happened, why, how to
      // clear it, that nothing was charged), so it is passed through verbatim. Falling through
      // to the generic branch would answer "buy credits" with "failed unexpectedly, quote
      // reference 3f9c1a20" and turn a working gate into a support ticket. No log line either:
      // an operator has nothing to diagnose here.
      if (isPaidBalanceRequired(error)) {
        return errorResult(error.message);
      }
      // The paid-balance gate's SIBLING, one axis over, and it lands in this catch for exactly the
      // same mechanical reason: it lives inside withCredits, which is generic in T and can only
      // exit by throwing. That gate asks whether an account may spend vendor money at all; this
      // one asks how much vendor money an account may spend WITHOUT EVER PAYING for a call,
      // because the $3.00/day vendor cap is fleet-wide and a single client stuck in a retry loop
      // could spend the whole day's allowance for every other customer. It rations DOLLARS rather
      // than calls: at the dearest tool's $1.65 a call, a ceiling on CALLS bounded nothing that
      // mattered (credits/free-vendor-calls.ts).
      //
      // The sentence is written at the gate — what happened, why, when it clears, that nothing was
      // charged — so it is passed through verbatim. It DOES get a log line, unlike paid-balance:
      // an account burning its whole free allowance is exactly what an operator must be able to
      // correlate with a vendor-budget complaint, and the gate's own line names the user but no
      // tool call.
      if (isFreeVendorSpendLimit(error)) {
        console.error(`Tool "${tool.name}" refused — free vendor-spend allowance: ${error.message}`);
        return errorResult(error.message);
      }
      // The SECOND deliberate refusal with no exit but a throw: a pre-condition the project has
      // not met yet — no crawl, no Search Console pull. Same mechanics as above; here the throw
      // is what makes withCredits RELEASE, so returning an error result at the handler would
      // charge the caller for being told which tool to run first (tools/precondition.ts). The
      // loader already wrote the sentence the user needs, so it is passed through verbatim, and
      // for the same reason as above there is no log line: an operator has nothing to diagnose
      // in "this project has not been crawled yet". Measured in the 2026-08-09 campaign: 26 live
      // calls in exactly this state were answered with the generic sentence below instead.
      //
      // The branch keys on the TYPE, never on the text: a plain Error carrying the same words is
      // still an unexplained throw and still belongs in the generic branch. A wider match here
      // would hide the 12 genuine failures that same campaign found wearing this disguise.
      //
      // THE FEE SENTENCE IS ADDED HERE, and this is the only place it could go without holes.
      // Measured 2026-08-25 (review card 12): audit_schema on a project with no crawl did not
      // charge — 5630 credits before, 5630 after — and did not say so, while keyword_positions
      // in the same state ends its refusal with "you were not charged". The loaders' sentences
      // were written one at a time and the reassurance was written into some of them and not
      // others; appending it at each throw site would leave exactly that kind of hole again.
      // Every typed pre-condition refusal in the app passes through THIS catch, so one call
      // covers all fourteen throw sites and every one added later.
      //
      // withNoChargeNote adds nothing to a message that already says it in its own words (the
      // pull_gsc_data property refusal says "No credits were charged"), and refundAssurance is
      // what decides whether this request may promise anything at all — on charge:"worker" it
      // may not, and the message goes through untouched.
      // OUT OF CREDITS, ahead of the generic branch (F-5). Without this the answer to "you have
      // 5 credits and this costs 20" was "failed unexpectedly, quote reference …", which sends a
      // customer to support over a balance they can read and fix themselves. Free, and it says so:
      // the reserve never opened, so nothing was charged for the attempt.
      if (isInsufficientCredits(error)) {
        return errorResult(withNoChargeNote(error.message));
      }
      if (isPreconditionNotMet(error)) {
        return errorResult(withNoChargeNote(error.message, refundAssurance(tool.charge, error)));
      }
      // The THIRD deliberate refusal with no exit but a throw, and the only one whose cure is
      // entirely in the USER's hands: Google refused the stored refresh token (invalid_grant),
      // so no amount of retrying will work and re-approving access fixes it in a minute.
      //
      // Unlike the two above, the sentence is BUILT HERE rather than passed through, because the
      // throw site cannot write it: the money rule forces a throw (withCredits releases only on
      // one — gsc-data/reauth-error.ts), and the two facts the user needs, WHICH account and
      // WHERE to reconnect, are the typed fields this error carries. Keyed on the TYPE for the
      // same reason as the precondition branch: text matching would let a genuine crash that
      // happens to mention Google wear an "everything is fine, just reconnect" sentence.
      //
      // No log line: an operator has nothing to diagnose in a user's revoked Google grant, and
      // the account row itself already records it (token_status='invalid', written on the
      // refresh path). Measured 2026-08-09: 12 live cells in exactly this state were answered
      // with the generic sentence below — and charged for it.
      //
      // The "where to fix it" clause is rendered, not interpolated: on a deployment missing
      // WEB_BASE_URL there is no honest link, and the branch must still produce the actionable
      // refusal rather than fall back to the generic sentence below (controller ruling —
      // gsc-data/reauth-error.ts renderReconnectInstruction).
      if (isGscReauthRequired(error)) {
        return errorResult(
          `Your Google Search Console connection for ${error.accountEmail} expired, so this data ` +
            `could not be refreshed. ${renderReconnectInstruction(error.reconnectUrl)}\n` +
            NOT_CHARGED_SENTENCE,
        );
      }
      // The FOURTH deliberate refusal with no exit but a throw, and the only one whose cause is
      // entirely on OUR side: SeoGrep's own daily allowance for live DataForSEO data is used up,
      // so the vendor guard refused the call before it went out (dfs/budget.ts, NEVER #5).
      //
      // Same mechanics as the three above — typed, never text-matched — and the same reason it
      // has to be here rather than at the throw site: the money rule forces a throw, which is
      // also what makes the refusal free. Without this branch the 2026-08-09 lesson stayed open
      // on the BUDGET axis: a working guard answered a paying customer with "failed unexpectedly
      // … quote reference 3f9c1a20", which is both a lie and, at 65–90 credits a call, a support
      // ticket about a balance the user has no way to check.
      //
      // The sentence is BUILT here and shares NO text with the error: the ledger's own words
      // carry OUR vendor spend in dollars, and this reply goes to whoever holds an API key
      // (budget-error.ts). What the user needs is the three facts below — whose limit it is,
      // when it lifts, and what it cost them.
      //
      // It DOES get a log line, unlike the three above: an exhausted vendor budget is exactly
      // the kind of thing an operator must be able to correlate with a user complaint, and
      // reserveSpend's own WAKE THE HUMAN line names the endpoint but no tool and no user.
      if (isDfsBudgetExhausted(error)) {
        console.error(`Tool "${tool.name}" refused — DataForSEO budget: ${error.message}`);
        const assurance = refundAssurance(tool.charge, error);
        return errorResult(
          `"${tool.name}" could not run: SeoGrep's own daily allowance for live third-party SEO ` +
            `data is used up for today. This is a limit on our side, not on your account, and it ` +
            `resets at 00:00 UTC — please try again after that.` +
            (assurance ? ` ${assurance}` : ""),
        );
      }
      // The guard has already released any reserve it opened before rethrowing.
      //
      // The raw message is NOT echoed to the caller. Anything that escapes a handler is an
      // UNEXPECTED failure, and those come from the layers that describe our internals:
      // Postgres names the relation, an RPC names the function, a provider names its
      // endpoint. Handing that to whoever holds an API key maps the schema for them.
      //
      // Instead the caller gets a stable, generic sentence plus a short REFERENCE, and the
      // verbatim message is logged server-side under that same reference — so operator
      // diagnosis is unchanged in power, just moved: the user quotes the reference, the
      // operator greps it and reads the full error. Deliberate, honest tool errors are
      // untouched: a tool that RETURNS errorResult(...) — the "live path is disabled"
      // refusal, a worker's fail-mark — never reaches this catch.
      //
      // What the caller is told about their CREDITS is appended, not baked into the sentence:
      // the refund is real on every path this catch owns (the guard releases before rethrowing),
      // and leaving it unsaid meant a 90-credit tool's failure read as a 90-credit loss. It is
      // omitted — deliberately, not by oversight — on the paths where this request genuinely
      // cannot know: see refundAssurance.
      const reference = newFailureReference();
      console.error(`Tool "${tool.name}" failed [ref ${reference}]: ${errorMessage(error)}`);
      const assurance = refundAssurance(tool.charge, error);
      return errorResult(
        `Tool "${tool.name}" failed unexpectedly. The server logged the details under ` +
          `reference ${reference} — quote it if you report this.` +
          (assurance ? ` ${assurance}` : ""),
      );
    }
  });
}
