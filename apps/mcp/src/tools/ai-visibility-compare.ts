import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT,
  MAX_COMPARE_TARGETS,
  MIN_COMPARE_TARGETS,
  resolveDefaultAiVisibilityPort,
  validateCompareGroups,
  type AiVisibilityCompareQuery,
  type AiVisibilityCompareResult,
  type AiVisibilityCompareRow,
  type AiVisibilityPort,
  type CompareGroup,
} from "../dfs/llm-mentions.ts";
import {
  AI_VISIBILITY_JUDGEMENT_NOTE,
  internalListLimitField,
  languageCodeField,
  locationNameField,
  notEnabledMessage,
  platformField,
  renderMeasurementScope,
  renderNotCarried,
  renderRowCaption,
  renderVendorMetrics,
  vendorFunctionOf,
} from "./ai-visibility-shared.ts";
import {
  aiVisibilityCompareRunRows,
  writeSubjectLookupRun,
  type SubjectLookupRunWriter,
} from "../dfs/subject-runs.ts";
import {
  loadOwnProject,
  resolveTarget,
  type LoadProjectFn,
  type ProjectRef,
} from "./project-target.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * ai_visibility_compare — the same question as `ai_visibility`, asked about 2-10 targets side by
 * side in ONE paid vendor request (DataForSEO cross_aggregated_metrics takes all the groups
 * natively; see dfs/llm-mentions.ts, Part A).
 *
 * =====================================================================================
 * THE PRICE IS PER COMPARED TARGET — THE ONLY ONE ON THIS SURFACE
 * =====================================================================================
 * The 2026-08-17 signature (MADDE 2) prices this tool at 90 credits PER COMPARED TARGET over 2-10
 * targets, so one call costs 180-900. Every other tool in TOOL_COSTS has a flat per-CALL price,
 * and two pieces of shared machinery had to learn the difference (credits/costs.ts CREDIT_UNITS +
 * creditCostFor, and the registry's `units` hook):
 *
 *   THE CHARGE  — withCredits is given `units: <compared target count>`, and creditCostFor
 *     multiplies the table's 90 by it. The reservation is opened BEFORE the vendor request and is
 *     sized from the ACTUAL target count, never from a flat guess: a 10-target comparison reserves
 *     900, and if the vendor request fails all 900 are released.
 *   THE CONFIRMATION — the registry's D17 gate weighs the same product, so a comparison over the
 *     200-credit threshold (three targets and up) returns a confirmation prompt and settles
 *     NOTHING until the caller re-runs it with `confirm: true`. The signature calls out the
 *     900-credit ten-target case by name and says asking first is the correct behaviour.
 *
 * Both read the count through {@link comparedTargetCount}, so the number the gate weighs and the
 * number the ledger charges cannot drift apart.
 *
 * =====================================================================================
 * NEVER #7 — A SIDE-BY-SIDE VIEW IS WHERE AN INVENTED RANKING WOULD SNEAK IN
 * =====================================================================================
 * Comparing brands is exactly the shape that wants a leaderboard, and there is none here. Neither
 * aggregated endpoint publishes an `order_by`, so there is no vendor field to rank by and this tool
 * invents none: THE TARGETS APPEAR IN THE ORDER THE CALLER LISTED THEM, and the answer says so in
 * those words. No visibility score, no share of voice, no "winner".
 *
 * The second honesty edge is the one the signature paid for twice over: a target the vendor
 * returned NO row for is named as unanswered, never rendered as a zero. "The vendor did not report
 * on this target" and "this target has zero mentions" are different answers to a question that
 * costs 90 credits per target, and Part A keeps them apart in
 * `groups_without_vendor_row` so this surface can print the difference.
 *
 * charge:"handler": every rejection below — an invalid comparison set, a duplicate label, a project
 * that is not the caller's, the live-disabled refusal — is returned BEFORE any reserve, so the
 * ledger is touched ZERO times (NEVER #2).
 */

/**
 * ONE compared target: exactly one of three ways to name it, plus an optional label. The three are
 * mutually exclusive for the same reason Part A's target is a discriminated union — the vendor
 * accepts a domain OR a keyword, and `project_id` is a domain the tenant already owns.
 */
const compareTargetSchema = z
  .object({
    label: z
      .string()
      .min(1)
      .optional()
      .describe(
        "OPTIONAL name for this target in the answer (DataForSEO's `aggregation_key`, which the " +
          "vendor echoes back and rows are matched on). Defaults to the domain or keyword itself. " +
          "Two targets may not share a label — the echo would be ambiguous and rows would collide.",
      ),
    domain: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A domain to compare, e.g. "example.com" — any public domain, including a competitor\'s. ' +
          "Pass exactly one of domain, keyword or project_id.",
      ),
    keyword: z
      .string()
      .min(1)
      .optional()
      .describe(
        "A search phrase to compare instead of a domain. Pass exactly one of domain, keyword or " +
          "project_id.",
      ),
    project_id: z
      .uuid()
      .optional()
      .describe(
        "One of your own projects (from setup_project / list_projects) — its domain is used as " +
          "this target. Pass exactly one of domain, keyword or project_id.",
      ),
  })
  .superRefine((target, ctx) => {
    const named = [target.domain, target.keyword, target.project_id].filter(
      (value) => value !== undefined,
    );
    if (named.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message:
          named.length === 0
            ? 'Each compared target needs exactly one of "domain", "keyword" or "project_id" — ' +
              "this one names none."
            : 'Each compared target names exactly one of "domain", "keyword" or "project_id" — ' +
              "this one names several, and SeoGrep will not guess which you meant.",
      });
    }
  });

type CompareTargetInput = z.infer<typeof compareTargetSchema>;

const inputSchema = z.object({
  targets: z
    .array(compareTargetSchema)
    .min(MIN_COMPARE_TARGETS)
    .max(MAX_COMPARE_TARGETS)
    .describe(
      `The targets to compare — ${MIN_COMPARE_TARGETS} to ${MAX_COMPARE_TARGETS}, which is ` +
        "DataForSEO's own bound for this endpoint. Each one is a domain, a keyword or one of your " +
        `project ids. THE PRICE IS PER COMPARED TARGET (${TOOL_COSTS.ai_visibility_compare} ` +
        "credits each), so this list is what the call costs: comparing ten targets costs ten " +
        "targets' worth of credits, and a comparison above the safety threshold asks you to " +
        "confirm before it runs.",
    ),
  platform: platformField,
  internal_list_limit: internalListLimitField,
  location_name: locationNameField,
  language_code: languageCodeField,
});

type AiVisibilityCompareInput = z.infer<typeof inputSchema>;

/**
 * THE PRICED UNIT COUNT, read off the input. Read by BOTH the registry's D17 gate (before dispatch)
 * and the handler's own reserve, so the estimate the caller is asked to confirm and the amount the
 * ledger reserves are the same number by construction rather than by agreement.
 */
export function comparedTargetCount(input: AiVisibilityCompareInput): number {
  return input.targets.length;
}

const DESCRIPTION =
  "Compare how several domains or keywords are mentioned in one AI assistant's answers, side by " +
  "side, from DataForSEO's LLM Mentions data. Pass 2-10 targets (each a domain, a keyword or one " +
  "of your project ids) and a platform — chat_gpt or google. The answer is scoped to THAT " +
  "assistant, THAT location and language, and whatever moment DataForSEO measured it: this vendor " +
  "endpoint takes no date range, so there is no period to ask for. The targets are listed in the " +
  "order you passed them and nothing is ranked: SeoGrep computes no visibility score, no share of " +
  "voice and no winner, and a target DataForSEO returned no row for is named as unanswered rather " +
  `than shown as a zero. Synchronous — everything comes back immediately. Costs ` +
  `${TOOL_COSTS.ai_visibility_compare} credits, charged per compared target — two targets cost ` +
  `${TOOL_COSTS.ai_visibility_compare * MIN_COMPARE_TARGETS} and ten cost ` +
  `${TOOL_COSTS.ai_visibility_compare * MAX_COMPARE_TARGETS}, and a comparison above the safety ` +
  "threshold asks you to confirm before it runs. Needs a paid credit balance: it is not available " +
  "on trial credits. If live DataForSEO access is unavailable on this deployment, the tool says " +
  "so and charges nothing.";

/** What a resolved target is, once a project_id (if any) has been turned into a domain. */
export interface ResolvedTarget {
  readonly group: CompareGroup;
  /** The project this target came from, when it came from one — for the "your project" wording. */
  readonly project: ProjectRef | null;
}

/**
 * Resolve ONE compared target into the port's own shape. Free and pre-reserve: a project that is
 * not the caller's leaves through resolveTarget's own not-found sentence, which is byte-identical
 * to the one an unknown id gets, so this tool cannot be used to probe which project ids exist.
 *
 * The LABEL defaults to what the target names — the domain (resolved, so a project's label is its
 * domain rather than a uuid) or the keyword. A uuid label would name nothing a reader recognises.
 */
async function resolveCompareTarget(
  userId: string,
  target: CompareTargetInput,
  loadProject: LoadProjectFn,
): Promise<{ ok: true; resolved: ResolvedTarget } | { ok: false; error: string }> {
  if (target.keyword !== undefined) {
    return {
      ok: true,
      resolved: {
        group: {
          aggregation_key: target.label ?? target.keyword,
          target: { kind: "keyword", keyword: target.keyword },
        },
        project: null,
      },
    };
  }
  const subject = await resolveTarget(
    userId,
    { target: target.domain, project_id: target.project_id },
    loadProject,
  );
  if (!subject.ok) {
    return { ok: false, error: subject.error };
  }
  return {
    ok: true,
    resolved: {
      group: {
        aggregation_key: target.label ?? subject.domain,
        target: { kind: "domain", domain: subject.domain },
      },
      project: subject.project,
    },
  };
}

/** How one compared target is named in the answer: its label, and what that label stands for. */
export function describeTarget(resolved: ResolvedTarget): string {
  const group = resolved.group;
  const what =
    group.target.kind === "keyword"
      ? `keyword "${group.target.keyword}"`
      : resolved.project
        ? `your project "${group.target.domain}"`
        : `domain "${group.target.domain}"`;
  return `${group.aggregation_key} — ${what}`;
}

/**
 * WHY THE TARGETS ARE IN THIS ORDER. Printed on every answer, because a side-by-side view is read
 * top-down as a ranking unless it says otherwise. The order is the CALLER's, and the reason it is
 * theirs rather than a vendor field's is stated: these endpoints publish none.
 */
export const CALLER_ORDER_NOTE =
  "The targets below are in the order you listed them. DataForSEO publishes no ordering field for " +
  "this endpoint, so there is nothing to sort by and SeoGrep sorts nothing: this is not a " +
  "ranking, and position here means only what you typed.";

/** ONE compared target's rows, matched on the caller's own key — never by position. */
export function renderTargetSection(
  index: number,
  resolved: ResolvedTarget,
  rows: readonly AiVisibilityCompareRow[],
): string {
  const heading = `${index + 1}. ${describeTarget(resolved)}`;
  if (rows.length === 0) {
    return (
      `${heading}\n  DataForSEO returned no row for this target. That is not a zero: the vendor ` +
      "did not report on it at all, and a zero would be a measurement nobody made."
    );
  }
  return [
    heading,
    ...rows.map((row) => `  ${renderVendorMetrics(row)}${renderNotCarried(row)}`),
  ].join("\n");
}

/** Render one comparison as the plain-text tool output (pure — unit-tested directly). */
export function formatAiVisibilityCompare(
  result: AiVisibilityCompareResult,
  resolved: readonly ResolvedTarget[],
): string {
  // Matched on the caller's OWN key as the vendor echoed it. A positional match would turn a
  // vendor reordering into one competitor silently wearing another's figures.
  const byKey = new Map<string, AiVisibilityCompareRow[]>();
  for (const row of result.result_set.rows) {
    byKey.set(row.aggregation_key, [...(byKey.get(row.aggregation_key) ?? []), row]);
  }
  const unanswered = result.groups_without_vendor_row;
  const unansweredNote =
    unanswered.length === 0
      ? ""
      : `\n\nDataForSEO returned no row for ${unanswered.length} of the ` +
        `${result.cost.compared_target_count} compared targets: ${unanswered.join(", ")}. Those ` +
        "are unanswered, not zeroes.";
  return [
    `AI visibility comparison across ${result.cost.compared_target_count} targets — DataForSEO ` +
      `LLM Mentions ${vendorFunctionOf(DFS_LLM_MENTIONS_CROSS_AGGREGATED_METRICS_ENDPOINT)}, ` +
      "one request for all of them.",
    renderMeasurementScope(result.scope),
    `${CALLER_ORDER_NOTE} ${renderRowCaption(result.result_set, "row")}`,
    resolved
      .map((target, index) =>
        renderTargetSection(index, target, byKey.get(target.group.aggregation_key) ?? []),
      )
      .join("\n\n"),
    `${AI_VISIBILITY_JUDGEMENT_NOTE}${unansweredNote}`,
  ].join("\n\n");
}

/** Dependencies — the port is injectable so tests run offline (mock/disabled). */
export interface AiVisibilityCompareDeps {
  readonly port?: AiVisibilityPort;
  readonly loadProject?: LoadProjectFn;
  /**
   * The `subject_lookup_runs` writer (migration 0032). ONE call drives it 2-10 times — once per
   * compared target — because 0032 keys these rows by the subject rather than by the call.
   */
  readonly writeRun?: SubjectLookupRunWriter;
}

export function makeAiVisibilityCompareTool(deps: AiVisibilityCompareDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeSubjectLookupRun;
  return defineTool<AiVisibilityCompareInput>({
    name: "ai_visibility_compare",
    description: DESCRIPTION,
    inputSchema,
    charge: "handler",
    // THE PRICED UNIT COUNT for the registry's D17 gate — the same function the handler charges
    // from, so the estimate the caller confirms is the amount the ledger reserves.
    units: comparedTargetCount,
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — resolve every target first. A project that is not the caller's
      // refuses here, before a single credit is reserved and before the vendor is called.
      const resolved: ResolvedTarget[] = [];
      for (const target of input.targets) {
        const one = await resolveCompareTarget(
          ctx.userId,
          target,
          deps.loadProject ?? loadOwnProject,
        );
        if (!one.ok) {
          return errorResult(one.error);
        }
        resolved.push(one.resolved);
      }
      const groups = resolved.map((target) => target.group);
      // Free pre-reserve gate 2 — the comparison set itself. Part A refuses to trim, pad or
      // de-duplicate it, and its refusals are the caller's to fix; reaching them from inside the
      // reserve would charge a caller for being told their labels collide.
      try {
        validateCompareGroups(groups);
      } catch (error) {
        return errorResult(
          `${error instanceof Error ? error.message : String(error)} You were not charged.`,
        );
      }
      const query: AiVisibilityCompareQuery = {
        groups,
        platform: input.platform,
        internal_list_limit: input.internal_list_limit,
        location_name: input.location_name,
        language_code: input.language_code,
      };
      const port = deps.port ?? resolveDefaultAiVisibilityPort();
      // Free pre-reserve gate 3 — refuse rather than reserve credits or serve fixture mentions.
      if (!port.enabled) {
        return errorResult(notEnabledMessage("ai_visibility_compare"));
      }
      // THE PER-TARGET CHARGE. `units` is the count, never an amount: credits/costs.ts multiplies
      // the signed 90 by it, so the reservation opened here is 90 x targets and is sized from the
      // real comparison set before any vendor request goes out.
      return withCredits(
        { userId: ctx.userId },
        { tool: "ai_visibility_compare", units: comparedTargetCount(input) },
        async () => {
          const result = await port.fetchAiVisibilityCompare(query);
          const text = formatAiVisibilityCompare(result, resolved);
          // ONE ROW PER COMPARED TARGET, recorded before the reply is returned and UNGUARDED —
          // migration 0032. withCredits commits a handler that RETURNS and releases one that
          // THROWS, so an error escaping here costs the tenant nothing; swallowed, at up to 900
          // credits a call it would leave a comparison PARTLY on the panel, charged in full.
          //
          // The rows go out in the caller's order and each carries its own resolved project — the
          // fan-out itself, including the match on the vendor's echoed key and the row for a
          // target the vendor answered nothing for, is dfs/subject-runs.ts's and is unit-tested
          // there.
          for (const row of aiVisibilityCompareRunRows(
            result,
            resolved.map((target) => target.project?.id ?? null),
          )) {
            await writeRun(
              {
                userId: ctx.userId,
                projectId: row.projectId,
                tool: "ai_visibility_compare",
                identity: row.identity,
              },
              row.report,
            );
          }
          return textResult(text);
        },
      );
    },
  });
}

/** The production ai_visibility_compare tool (disabled port unless DFS_LIVE=1 + creds). */
export const aiVisibilityCompareTool = makeAiVisibilityCompareTool();
