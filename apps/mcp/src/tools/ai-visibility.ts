import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT,
  resolveDefaultAiVisibilityPort,
  type AiVisibilityPort,
  type AiVisibilityQuery,
  type AiVisibilityResult,
  type MentionTarget,
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
  aiVisibilityRunReport,
  mentionSubjectIdentity,
  writeSubjectLookupRun,
  type SubjectLookupRunWriter,
} from "../dfs/subject-runs.ts";
import {
  loadOwnProject,
  projectIdField,
  resolveTarget,
  subjectLabel,
  targetField,
  type LoadProjectFn,
  type ProjectRef,
} from "./project-target.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * ai_visibility — "when someone asks a language model about this, does my domain (or my keyword)
 * come up?", answered from DataForSEO's LLM Mentions aggregated_metrics endpoint. One paid vendor
 * request per call, described in dfs/llm-mentions.ts (Part A).
 *
 * =====================================================================================
 * THE SUBJECT IS THE QUESTION, AND THE TWO SUBJECTS DO NOT TAKE THE SAME INPUT
 * =====================================================================================
 * The vendor's rule is "each target object must contain either `domain` or `keyword`", which Part A
 * models as a discriminated union. Flattening that into optional fields on this surface would let a
 * caller send a keyword to a domain lookup, where it is ignored and a DIFFERENT 90-credit question
 * is billed than the one they asked. So `subject` is required with no default, the refinement
 * rejects a field belonging to the other subject BEFORE any handler work (and therefore before any
 * reserve), and {@link buildAiVisibilityQuery} narrows on it — the same shape discover_keywords
 * uses for its four modes, and for the same reason.
 *
 * =====================================================================================
 * NEVER #7 — THE HONESTY BAR IS THE HIGHEST OF ANY TOOL ON THIS SURFACE
 * =====================================================================================
 * "AI visibility" is a claim about what a language model said at a moment in time, on ONE platform,
 * in ONE locale, over a period the caller cannot scope (this endpoint publishes no date parameter).
 * Every one of those limits is printed on every answer — see renderMeasurementScope in
 * ai-visibility-shared.ts. There is no visibility score, no share of voice, no sentiment and no
 * ordering of ours, and no field is renamed: this repo has never captured a response from this
 * vendor family, so the rows are printed under the vendor's own keys exactly as Part A carried them.
 *
 * Same credit path and the same two hard product rules as its DataForSEO siblings:
 *   1. Live DataForSEO data is OFF by default. While off, the tool returns a clear English error
 *      and NEVER serves fixture mentions as if a language model had really produced them.
 *   2. That refusal — and every invalid-input rejection, and the project-ownership refusal — is
 *      returned BEFORE any credit reserve, so the ledger is touched ZERO times (NEVER #2).
 *
 * charge:"handler": a SYNCHRONOUS tool that must run logic BEFORE the reserve. It settles via
 * withCredits WITHOUT a jobId (reserve -> commit, no jobs row). One lookup is charged ONCE; if the
 * vendor request fails, withCredits releases and nothing is billed.
 */

/** The two things a mention can be looked up for — the vendor's own either/or, on the surface. */
export const SUBJECT_KINDS = ["domain", "keyword"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** The input fields that belong to ONE subject only — what the discrimination is about. */
export const SUBJECT_SPECIFIC_FIELDS = ["target", "project_id", "keyword"] as const;
type SubjectField = (typeof SUBJECT_SPECIFIC_FIELDS)[number];

interface SubjectInputRule {
  /** Fields this subject accepts. Anything else in SUBJECT_SPECIFIC_FIELDS is rejected. */
  readonly takes: readonly SubjectField[];
  /** Fields this subject cannot run without. */
  readonly requires: readonly SubjectField[];
  /** What this subject takes, in words, for the rejection message. */
  readonly says: string;
}

/**
 * WHICH FIELDS EACH SUBJECT TAKES — the surface half of the port's discriminated union, in one
 * place. "domain" requires neither of its two fields at this layer: exactly-one-of
 * target/project_id is resolveTarget's rule and it already has the two sentences for it (naming
 * neither, and naming both), so repeating it here would produce a second wording for one mistake.
 */
export const SUBJECT_INPUT_RULES: Readonly<Record<SubjectKind, SubjectInputRule>> = {
  domain: {
    takes: ["target", "project_id"],
    requires: [],
    says: '"domain" takes a DOMAIN ("target" or "project_id") and no keyword',
  },
  keyword: {
    takes: ["keyword"],
    requires: ["keyword"],
    says: '"keyword" takes "keyword", exactly one search phrase, and no domain',
  },
};

const inputSchema = z
  .object({
    subject: z
      .enum(SUBJECT_KINDS)
      .describe(
        "WHAT to look for in the assistant's answers — required, with no default, because the two " +
          'answer different questions. "domain": how a site is mentioned (pass "target" or ' +
          '"project_id"). "keyword": how a search phrase is mentioned (pass "keyword"). Passing a ' +
          "field that belongs to the other subject is rejected, not ignored.",
      ),
    target: targetField("measure AI mentions for"),
    project_id: projectIdField,
    keyword: z
      .string()
      .min(1)
      .optional()
      .describe(
        'SUBJECT "keyword" ONLY: exactly one search phrase to measure mentions for. This endpoint ' +
          "takes one at a time, not a list — run the tool again for another.",
      ),
    platform: platformField,
    internal_list_limit: internalListLimitField,
    location_name: locationNameField,
    language_code: languageCodeField,
  })
  .superRefine((input, ctx) => {
    const rule = SUBJECT_INPUT_RULES[input.subject];
    for (const field of rule.requires) {
      if (input[field] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `subject ${rule.says} — "${field}" is missing`,
        });
      }
    }
    for (const field of SUBJECT_SPECIFIC_FIELDS) {
      if (input[field] !== undefined && !rule.takes.includes(field)) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message:
            `subject ${rule.says}, so it does not take "${field}". A field belonging to the other ` +
            "subject is refused rather than ignored: ignoring it would run a different lookup " +
            "than the one you asked for, and bill you for it.",
        });
      }
    }
  });

type AiVisibilityInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Measure how a domain or a keyword is mentioned in one AI assistant's answers, from DataForSEO's " +
  'LLM Mentions data. Pick a subject: "domain" (pass target or project_id) or "keyword" (pass ' +
  "keyword), and a platform — chat_gpt or google. The answer is scoped to THAT assistant, THAT " +
  "location and language, and whatever moment DataForSEO measured it: this vendor endpoint takes " +
  "no date range, so there is no period to ask for. Every figure is a DataForSEO field printed " +
  "under DataForSEO's own name — SeoGrep computes no visibility score, no share of voice and no " +
  "sentiment, and a figure the vendor did not report is shown as unreported rather than as zero. " +
  `Synchronous — everything comes back immediately. Costs ${TOOL_COSTS.ai_visibility} credits. ` +
  "Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access " +
  "is unavailable on this deployment, the tool says so and charges nothing.";

/** WHAT WAS ASKED, narrowed on the RESULT's own subject — never on the caller's input. */
export function describeSubject(subject: MentionTarget, project?: ProjectRef | null): string {
  return subject.kind === "domain"
    ? subjectLabel(subject.domain, project)
    : `the keyword "${subject.keyword}"`;
}

/**
 * The heading. Subject and vendor function both come from the RESULT and from the endpoint the
 * money is spent at, so an answer built for a different subject than the one requested says so
 * instead of wearing the caption the caller expected.
 */
export function renderHeading(result: AiVisibilityResult, project?: ProjectRef | null): string {
  return (
    `AI visibility for ${describeSubject(result.subject, project)} — DataForSEO LLM Mentions ` +
    `${vendorFunctionOf(DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT)}.`
  );
}

/** ONE row: the vendor's carried scalars, then the nested fields that were not carried. */
export function renderRow(row: AiVisibilityResult["result_set"]["rows"][number]): string {
  return `• ${renderVendorMetrics(row)}${renderNotCarried(row)}`;
}

/**
 * The "nothing came back" answer — a real, delivered result rather than an error, and deliberately
 * NOT the sentence "this is never mentioned". The vendor answered about one platform, one locale
 * and one moment; a lookup that matched no row is an answer about THAT, and Part A already throws
 * rather than returning an empty set when a response carried items it could not read.
 */
function renderNoRows(result: AiVisibilityResult, project?: ProjectRef | null): string {
  return [
    `No AI-mention rows for ${describeSubject(result.subject, project)} — DataForSEO LLM Mentions ` +
      `${vendorFunctionOf(DFS_LLM_MENTIONS_AGGREGATED_METRICS_ENDPOINT)}.`,
    renderMeasurementScope(result.scope),
    "DataForSEO returned no row for this lookup. That is an answer about this platform, this " +
      "locale and the moment the vendor measured — it is not a statement that nobody ever " +
      "mentions this, and it is not a zero: the vendor reported nothing to count.",
  ].join("\n\n");
}

/** Render one lookup as the plain-text tool output (pure — unit-tested directly). */
export function formatAiVisibility(
  result: AiVisibilityResult,
  project?: ProjectRef | null,
): string {
  if (result.result_set.rows.length === 0) {
    return renderNoRows(result, project);
  }
  return [
    renderHeading(result, project),
    renderMeasurementScope(result.scope),
    `Rows — ${renderRowCaption(result.result_set, "row")}`,
    result.result_set.rows.map(renderRow).join("\n"),
    `Row order: ${result.row_order_means}`,
    AI_VISIBILITY_JUDGEMENT_NOTE,
  ].join("\n\n");
}

/**
 * The port query, built by NARROWING on `subject`. This switch is where the surface rejoins Part
 * A's discriminated union: the compiler refuses to put a keyword on the domain branch or a domain
 * on the keyword branch, so the type system protects the wire even if the refinement above were
 * ever loosened. `domain` is the RESOLVED domain and is used by the domain subject alone.
 */
export function buildAiVisibilityQuery(
  input: AiVisibilityInput,
  domain: string | null,
): AiVisibilityQuery {
  const base = {
    platform: input.platform,
    internal_list_limit: input.internal_list_limit,
    location_name: input.location_name,
    language_code: input.language_code,
  };
  switch (input.subject) {
    case "domain": {
      if (domain === null) {
        throw new Error('internal: subject "domain" reached the vendor query without a domain');
      }
      return { ...base, target: { kind: "domain", domain } };
    }
    case "keyword": {
      const keyword = input.keyword;
      if (keyword === undefined) {
        throw new Error('internal: subject "keyword" reached the vendor query without a keyword');
      }
      return { ...base, target: { kind: "keyword", keyword } };
    }
  }
}

/** Dependencies — the port is injectable so tests run offline (mock/disabled). */
export interface AiVisibilityDeps {
  /**
   * The AI-visibility port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: AiVisibilityPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /**
   * The `subject_lookup_runs` writer (migration 0032). Injected so a spec can make the write fail
   * without breaking a database.
   */
  readonly writeRun?: SubjectLookupRunWriter;
}

export function makeAiVisibilityTool(deps: AiVisibilityDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeSubjectLookupRun;
  return defineTool<AiVisibilityInput>({
    name: "ai_visibility",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — only the domain subject names a domain, so a keyword lookup
      // reads no project at all and works on a deployment whose project table is unreachable.
      let project: ProjectRef | null = null;
      let domain: string | null = null;
      if (input.subject === "domain") {
        const resolved = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
        if (!resolved.ok) {
          return errorResult(resolved.error);
        }
        project = resolved.project;
        domain = resolved.domain;
      }
      const query = buildAiVisibilityQuery(input, domain);
      const port = deps.port ?? resolveDefaultAiVisibilityPort();
      // Free pre-reserve gate 2 — refuse rather than reserve credits or serve fixture mentions.
      if (!port.enabled) {
        return errorResult(notEnabledMessage("ai_visibility"));
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch -> commit
      // as one chain. The vendor request failing throws, so withCredits releases.
      return withCredits({ userId: ctx.userId }, { tool: "ai_visibility" }, async () => {
        const result = await port.fetchAiVisibility(query);
        const text = formatAiVisibility(result, project);
        // THE RUN IS RECORDED BEFORE THE REPLY IS RETURNED, unguarded — migration 0032, and
        // dfs/subject-runs.ts states the contract from the other side. withCredits commits a
        // handler that RETURNS and releases one that THROWS, so an error escaping here costs the
        // tenant nothing; swallowed, it would charge 90 credits for a lookup the panel will
        // forever say never ran.
        //
        // THE IDENTITY IS THE SHARED ONE. `mentionSubjectIdentity` is what ai_visibility_compare
        // uses for each of its targets too, so this domain measured alone and the same domain
        // measured inside a comparison land on the SAME identity — which is the whole reason 0032
        // keys a comparison by the subject rather than by the call.
        await writeRun(
          {
            userId: ctx.userId,
            projectId: project?.id ?? null,
            tool: "ai_visibility",
            identity: mentionSubjectIdentity(result.subject, "ai_visibility"),
          },
          aiVisibilityRunReport(result),
        );
        return textResult(text);
      });
    },
  });
}

/** The production ai_visibility tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const aiVisibilityTool = makeAiVisibilityTool();
