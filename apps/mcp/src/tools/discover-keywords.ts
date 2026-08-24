import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  DEFAULT_DISCOVER_ROWS,
  DEFAULT_RELATED_DEPTH,
  DISCOVER_ENDPOINTS,
  MAX_DISCOVER_ROWS,
  MAX_RELATED_DEPTH,
  MAX_SEEDS,
  MIN_RELATED_DEPTH,
  resolveDefaultDiscoverKeywordsPort,
  type DiscoverKeywordRow,
  type DiscoverKeywordsPort,
  type DiscoverKeywordsQuery,
  type DiscoverKeywordsResult,
  type DiscoverMode,
  type DiscoverSubject,
  type DiscoverVolumeTrend,
} from "../dfs/discover-keywords.ts";
import type { VendorWindow } from "../dfs/backlink-details.ts";
import {
  discoverKeywordsRunReport,
  discoverSubjectIdentity,
  writeSubjectLookupRuns,
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
 * discover_keywords — keywords the caller does NOT yet have, produced by DataForSEO Labs from a
 * seed keyword, a seed LIST or a domain. One paid Labs request per call, described in
 * dfs/discover-keywords.ts (Part A).
 *
 * =====================================================================================
 * THE MODE IS THE QUESTION, AND THE FOUR MODES DO NOT TAKE THE SAME INPUT
 * =====================================================================================
 * The port is a DISCRIMINATED UNION on `mode` — the compiler refuses a `for_site` query carrying
 * a seed, an `ideas` query carrying a target, and `depth` on a mode the vendor gives no depth to.
 * A tool surface is where that protection is easiest to throw away: flatten the union into six
 * optional fields and a caller can send a seed to `for_site`, where it is silently ignored and a
 * DIFFERENT lookup is billed than the one they asked for.
 *
 * So the schema reproduces the discrimination rather than flattening it. {@link MODE_INPUT_RULES}
 * is the one table saying which fields each mode TAKES and which it REQUIRES, the refinement
 * rejects everything else BEFORE any handler work (and therefore before any reserve), and
 * {@link buildDiscoverQuery} narrows on `mode` in a switch — so the union is what the compiler
 * checks and the refinement is what the caller meets. A field belonging to another mode is an
 * ERROR, never an ignored extra: ignoring it would run a lookup the caller did not ask for and
 * charge them for it.
 *
 * =====================================================================================
 * NEVER #7 — THIS TOOL RECOMMENDS NOTHING
 * =====================================================================================
 * "Which keywords should I target" is a decision, and SeoGrep does not make it. There is no
 * composite opportunity score here, no "easy win" label, and no ordering of ours: the rows arrive
 * in the ONE vendor order the port asks for, and the answer prints that field's own name so the
 * reader knows what "first" means. Every printed number is a DataForSEO field under DataForSEO's
 * own name — including the vendor's TWO different competition fields (`competition`, a 0-1 float,
 * and `competition_level`, an advertiser band), which are never merged into one invented label.
 * `keyword_difficulty` is the vendor's own estimate about the SERP, not a forecast of where this
 * site would rank or what traffic it would earn, and the output says so.
 *
 * A vendor null is "the vendor did not say" and is printed in WORDS. A vendor 0 is an answer and
 * prints as 0. `foreign_intent` is the one field whose ABSENCE cannot be told apart from an empty
 * list (the port collapses both to []), so an empty one prints nothing at all rather than a claim
 * that the vendor reported none.
 *
 * Same credit path and the same two hard product rules as its DataForSEO siblings:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear English
 *      error and NEVER serves sample/placeholder keywords as if they were real (NEVER #7).
 *   2. That live-disabled error — and every invalid-input rejection, and the project-ownership
 *      refusal — is returned BEFORE any credit reserve, so the ledger is touched ZERO times
 *      (NEVER #2).
 *
 * charge:"handler": a SYNCHRONOUS tool that must run logic BEFORE the reserve. It settles via
 * withCredits WITHOUT a jobId (reserve -> commit, no jobs row). One lookup is charged ONCE; if the
 * vendor request fails, withCredits releases and nothing is billed.
 */

/** United States — the DataForSEO default location_code (the same default as every sibling). */
const DEFAULT_LOCATION_CODE = 2840;

/**
 * The vendor's documented range for `keyword_properties.keyword_difficulty`, which `max_difficulty`
 * filters on. Declared here because it bounds a CALLER's input; the value it filters is parsed
 * nullish by the port, so nothing here narrows what the vendor may return.
 */
const VENDOR_DIFFICULTY_MIN = 0;
const VENDOR_DIFFICULTY_MAX = 100;

const NOT_ENABLED_MESSAGE =
  "Keyword discovery is not yet enabled on this deployment. Live DataForSEO data is turned off, " +
  "and SeoGrep never returns sample or placeholder keywords as if they were real. This tool will " +
  "start returning data once live DataForSEO access is switched on — you were not charged.";

/**
 * The four modes, DERIVED from the port's endpoint table rather than retyped: a mode added there
 * without a surface rule cannot silently become an accepted-but-unruled input.
 */
const MODE_NAMES = Object.keys(DISCOVER_ENDPOINTS) as [DiscoverMode, ...DiscoverMode[]];

/** The input fields that belong to SOME modes only — the ones the discrimination is about. */
export const MODE_SPECIFIC_FIELDS = [
  "seeds",
  "seed",
  "depth",
  "target",
  "project_id",
  "include_subdomains",
] as const;

type ModeField = (typeof MODE_SPECIFIC_FIELDS)[number];

interface ModeInputRule {
  /** Fields this mode accepts. Anything else in MODE_SPECIFIC_FIELDS is rejected. */
  readonly takes: readonly ModeField[];
  /** Fields this mode cannot run without. */
  readonly requires: readonly ModeField[];
  /** What this mode takes, in words, for the rejection message. */
  readonly says: string;
}

/**
 * WHICH FIELDS EACH MODE TAKES — the surface half of the port's discriminated union, and the one
 * place it is written. Keyed by DiscoverMode, so a new mode in the port fails to compile here
 * until its input rule is stated.
 *
 * `for_site` requires neither of its two subject fields at this layer: exactly-one-of
 * target/project_id is resolveTarget's rule, and it already has the two sentences for it (naming
 * neither, and naming both). Repeating that rule here would produce a second, different wording
 * for the same mistake.
 */
export const MODE_INPUT_RULES: Readonly<Record<DiscoverMode, ModeInputRule>> = {
  ideas: {
    takes: ["seeds"],
    requires: ["seeds"],
    says: `"ideas" takes "seeds", a list of up to ${MAX_SEEDS} seed keywords`,
  },
  suggestions: {
    takes: ["seed"],
    requires: ["seed"],
    says: '"suggestions" takes "seed", exactly one keyword',
  },
  related: {
    takes: ["seed", "depth"],
    requires: ["seed"],
    says: '"related" takes "seed", exactly one keyword, and optionally "depth"',
  },
  for_site: {
    takes: ["target", "project_id", "include_subdomains"],
    requires: [],
    says: '"for_site" takes a DOMAIN ("target" or "project_id") and no seed keyword at all',
  },
};

const inputSchema = z
  .object({
    mode: z
      .enum(MODE_NAMES)
      .describe(
        'WHICH QUESTION to ask — required, with no default, because the four modes answer four ' +
          'different questions and take four different inputs. "ideas": keywords from the same ' +
          'product/service categories as your seed keywords (takes "seeds"). "suggestions": ' +
          'longer search queries that CONTAIN your seed keyword (takes "seed"). "related": the ' +
          'keywords Google lists under "searches related to" for your seed (takes "seed", and ' +
          'optionally "depth"). "for_site": keywords DataForSEO considers relevant to a DOMAIN, ' +
          'with no seed keyword involved (takes "target" or "project_id"). Passing a field that ' +
          "belongs to another mode is rejected, not ignored.",
      ),
    seeds: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_SEEDS)
      .optional()
      .describe(
        `MODE "ideas" ONLY: the seed keywords to draw ideas from (1-${MAX_SEEDS}, the vendor's ` +
          "own documented ceiling). The keywords that come back are the vendor's, not yours — " +
          "none of your seeds is guaranteed to appear in the answer.",
      ),
    seed: z
      .string()
      .min(1)
      .optional()
      .describe(
        'MODES "suggestions" and "related" ONLY: exactly one seed keyword. Both endpoints take a ' +
          "single keyword, not a list — pass one, and run the tool again for another.",
      ),
    depth: z
      .number()
      .int()
      .min(MIN_RELATED_DEPTH)
      .max(MAX_RELATED_DEPTH)
      .optional()
      .describe(
        `MODE "related" ONLY: how many times DataForSEO follows "searches related to" outward ` +
          `from your seed (${MIN_RELATED_DEPTH}-${MAX_RELATED_DEPTH}, the vendor's own range; ` +
          `default ${DEFAULT_RELATED_DEPTH} when omitted). A deeper search drifts further from ` +
          "the seed; it does not change the price.",
      ),
    target: targetField("discover keywords for"),
    project_id: projectIdField,
    include_subdomains: z
      .boolean()
      .optional()
      .describe(
        'MODE "for_site" ONLY: whether the domain\'s subdomains count as part of it (default ' +
          "true). Sent to DataForSEO explicitly either way, so the answer never depends on a " +
          "vendor default that could move.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_DISCOVER_ROWS)
      .default(DEFAULT_DISCOVER_ROWS)
      .describe(
        `How many keywords to return (1-${MAX_DISCOVER_ROWS}, default ${DEFAULT_DISCOVER_ROWS}). ` +
          "DataForSEO bills per returned row, so this is the price control, not a display " +
          "preference — the flat price was signed against this ceiling.",
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        "How many keywords to skip before this window starts (default 0). Page through a large " +
          "set by advancing it; the output always states the offset and limit the rows came back " +
          "under.",
      ),
    min_volume: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "OPTIONAL vendor filter: keep only keywords whose DataForSEO " +
          "`keyword_info.search_volume` is at least this. Omitted by default — no filter is sent " +
          "at all, so nothing is dropped on your behalf. Filtering happens at DataForSEO, so it " +
          "changes which rows you are billed for.",
      ),
    max_difficulty: z
      .number()
      .int()
      .min(VENDOR_DIFFICULTY_MIN)
      .max(VENDOR_DIFFICULTY_MAX)
      .optional()
      .describe(
        "OPTIONAL vendor filter: keep only keywords whose DataForSEO " +
          `\`keyword_properties.keyword_difficulty\` is at most this ` +
          `(${VENDOR_DIFFICULTY_MIN}-${VENDOR_DIFFICULTY_MAX}, the vendor's own scale). Omitted ` +
          "by default. The cut-off is YOURS: DataForSEO publishes the score but no threshold, and " +
          "a low score is not a promise that a keyword is winnable.",
      ),
    language_code: z.string().min(2).default("en").describe("Language code (default 'en')."),
    location_code: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_LOCATION_CODE)
      .describe(`DataForSEO location code (default ${DEFAULT_LOCATION_CODE} = United States).`),
  })
  .superRefine((input, ctx) => {
    const rule = MODE_INPUT_RULES[input.mode];
    for (const field of rule.requires) {
      if (input[field] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `mode ${rule.says} — "${field}" is missing`,
        });
      }
    }
    for (const field of MODE_SPECIFIC_FIELDS) {
      if (input[field] !== undefined && !rule.takes.includes(field)) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message:
            `mode ${rule.says}, so it does not take "${field}". A field belonging to another ` +
            "mode is refused rather than ignored: ignoring it would run a different lookup " +
            "than the one you asked for, and bill you for it.",
        });
      }
    }
  });

type DiscoverKeywordsInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Discover keywords to target, from DataForSEO Labs — the question that comes before pricing a " +
  'list you already have. Pick a mode: "ideas" (keywords in the same categories as up to ' +
  `${MAX_SEEDS} seed keywords), "suggestions" (longer queries containing one seed), "related" ` +
  '(the "searches related to" keywords for one seed), or "for_site" (keywords DataForSEO ' +
  "considers relevant to a DOMAIN — pass target or project_id). Each mode takes its own input, " +
  "and a field belonging to another mode is rejected rather than ignored. Returns each keyword " +
  "with DataForSEO's own search_volume, cpc, competition, competition_level, keyword_difficulty " +
  "and search intent, in the vendor's order by search volume — SeoGrep ranks nothing and " +
  "recommends nothing. Synchronous — everything comes back immediately. Costs " +
  `${TOOL_COSTS.discover_keywords} credits. Needs a paid credit balance: it is not available on ` +
  "trial credits. If live DataForSEO access is unavailable on this deployment, the tool says so " +
  "and charges nothing.";

/** Group digits with commas without depending on ICU/locale data (deterministic). */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A vendor field, always under the vendor's OWN name, and a silence always in WORDS.
 *
 * Both halves are load-bearing here for the same reason they are on the disavow surface. The NAME,
 * because this output carries two different competition measurements (`competition`, a 0-1 float,
 * and `competition_level`, a band) plus a difficulty score, and a friendly caption like
 * "competition: high" would invent one measurement DataForSEO never published. The WORDS, because
 * a missing search volume rendered as 0 would read "nobody searches this" — a claim from a
 * response that said nothing — on a page whose whole subject is what to spend months writing for.
 */
function vendorValue(field: string, value: string | null): string {
  return value === null ? `${field} not reported by DataForSEO` : `${field} ${value}`;
}

/** A vendor COUNT: grouped digits, or the honest silence. A vendor zero is a zero. */
function vendorCount(field: string, value: number | null): string {
  return vendorValue(field, value === null ? null : thousands(value));
}

/** A vendor NUMBER printed as the vendor sent it (no rounding, no unit invented). */
function vendorNumber(field: string, value: number | null): string {
  return vendorValue(field, value === null ? null : String(value));
}

/** One trend leg, signed so a percentage CHANGE cannot be read as a share. Zero stays "0%". */
function trendLeg(name: string, value: number | null): string {
  if (value === null) return `${name} not reported`;
  return `${name} ${value > 0 ? "+" : ""}${value}%`;
}

/**
 * The trend clause, or nothing at all. A whole trend object the vendor omitted prints NOTHING
 * rather than three "not reported" legs: the vendor said nothing about the trend, and three
 * silences dressed as a measurement is exactly the shape this file refuses everywhere else.
 */
function trendClause(trend: DiscoverVolumeTrend | null): string {
  if (trend === null) return "";
  return (
    ` · search_volume_trend ${trendLeg("monthly", trend.monthly)}, ` +
    `${trendLeg("quarterly", trend.quarterly)}, ${trendLeg("yearly", trend.yearly)}`
  );
}

/**
 * The secondary-intent clause — printed ONLY when the vendor listed one. An empty list cannot be
 * told apart from an absent field (the port collapses both to []), so "no secondary intent" would
 * be a claim about a response that may never have mentioned intent at all.
 */
function foreignIntentClause(intents: readonly string[]): string {
  return intents.length === 0 ? "" : ` · foreign_intent ${intents.join(", ")}`;
}

/**
 * ONE discovered keyword. Every metric is named with the vendor's own field name rather than a
 * friendly caption, and the two competition fields are printed side by side, unmerged.
 */
export function renderKeywordRow(row: DiscoverKeywordRow): string {
  return (
    `• ${row.keyword}\n` +
    `  ${vendorCount("search_volume", row.search_volume)} · ` +
    `${vendorNumber("cpc", row.cpc)} · ` +
    `${vendorNumber("competition", row.competition)} · ` +
    `${vendorValue("competition_level", row.competition_level)} · ` +
    `${vendorNumber("keyword_difficulty", row.keyword_difficulty)}\n` +
    `  ${vendorValue("main_intent", row.main_intent)}` +
    `${foreignIntentClause(row.foreign_intent)}` +
    `${trendClause(row.search_volume_trend)} · ` +
    `${vendorValue("last_updated_time", row.last_updated_time)}`
  );
}

/**
 * The vendor FUNCTION this mode calls, read off the endpoint that is really requested
 * (".../google/<function>/live"). Derived rather than retyped so the label in the heading cannot
 * name one vendor function while the money is spent at another.
 */
export function vendorFunctionOf(mode: DiscoverMode): string {
  const segments = DISCOVER_ENDPOINTS[mode].split("/").filter((part) => part.length > 0);
  const fn = segments[segments.length - 2];
  if (fn === undefined) {
    throw new Error(`cannot read the vendor function out of the "${mode}" endpoint`);
  }
  return fn;
}

/** WHAT WAS ASKED, narrowed on the subject's own discriminant — never on the caller's input. */
export function describeSubject(subject: DiscoverSubject, project?: ProjectRef | null): string {
  switch (subject.mode) {
    case "ideas": {
      const seeds = subject.seeds.map((seed) => `"${seed}"`).join(", ");
      const count = subject.seeds.length;
      return `${thousands(count)} seed ${count === 1 ? "keyword" : "keywords"} (${seeds})`;
    }
    case "suggestions":
      return `the seed keyword "${subject.seed}"`;
    case "related":
      return `the seed keyword "${subject.seed}", search depth ${subject.depth}`;
    case "for_site":
      return `${subjectLabel(subject.target, project)}${
        subject.include_subdomains ? " and its subdomains" : ", subdomains excluded"
      }`;
  }
}

/**
 * The heading. Mode, vendor function and subject all come from the RESULT — never from the input —
 * so an answer built for a different mode than the one requested says so instead of wearing the
 * caption the caller expected.
 */
export function renderHeading(result: DiscoverKeywordsResult, project?: ProjectRef | null): string {
  return (
    `Keyword discovery for ${describeSubject(result.subject, project)} — DataForSEO Labs ` +
    `${vendorFunctionOf(result.mode)} (mode "${result.mode}").`
  );
}

/**
 * WHAT PRODUCED THIS LIST: what the mode means in the vendor's terms, where the lookup ran, what
 * ordered it, and which vendor filters really went out.
 *
 * `mode_means` and `ordered_by_vendor_field` are printed VERBATIM from the result, and the filters
 * are printed in DataForSEO's own `[field, operator, value]` grammar exactly as they were sent —
 * a rendered summary of a filter would be a second description of the request, free to disagree
 * with the one the vendor actually received.
 */
export function renderCriteria(result: DiscoverKeywordsResult, input: LookupLocale): string {
  const filters =
    result.vendor_filters_applied.length === 0
      ? "No vendor filter was applied, so nothing was dropped before you saw it."
      : `DataForSEO filtered the set, in the vendor's own grammar: ` +
        `${JSON.stringify(result.vendor_filters_applied)} — bounds you chose, not ones SeoGrep or ` +
        "DataForSEO recommends.";
  return (
    `What this mode returns: ${result.mode_means}\n` +
    `Asked in language ${input.language_code}, location ${input.location_code}. The rows are in ` +
    `DataForSEO's own order, by ${result.ordered_by_vendor_field}, highest first — SeoGrep does ` +
    `not re-order them and computes no score of its own. ${filters}`
  );
}

/** The locale echoed back into the criteria line — the caller's own two request facts. */
export interface LookupLocale {
  readonly language_code: string;
  readonly location_code: number;
}

/**
 * The window caption. It says the same two things backlink_details' shared caption says — the rows
 * in hand under their bounds, and the vendor's whole-set count kept separate from them — but it is
 * NOT that function: the shared one says "for this target in total", and three of these four modes
 * have no target at all. A count "for this target" printed over a seed lookup would attribute the
 * number to a subject that was never named. The load-bearing sentence is kept word for word.
 */
export function renderDiscoveryCaption(window: VendorWindow<DiscoverKeywordRow>): string {
  const rows = window.window_row_count;
  const shown =
    `Keywords — ${thousands(rows)} ${rows === 1 ? "keyword" : "keywords"} in this window ` +
    `(offset ${thousands(window.window_offset)}, limit ${thousands(window.window_limit)})`;
  // `null` is the vendor DECLINING TO SAY. It is not 0, and it is not rows.length: either
  // substitution would publish a measurement of the whole set that nobody made.
  const whole =
    window.vendor_total_count === null
      ? "DataForSEO did not say how many keywords this lookup matches in total"
      : `DataForSEO counts ${thousands(window.vendor_total_count)} keywords matching this lookup ` +
        "in total";
  return `${shown}. ${whole} — this window is a slice of that set, not a count of it:`;
}

/**
 * Whose numbers these are, and what this tool does NOT claim. Printed on every answer, because a
 * list of keywords under the word "discover" reads as advice about what to write next, and SeoGrep
 * has no such opinion (NEVER #7).
 */
export const VENDOR_JUDGEMENT_NOTE =
  "Every value above is a DataForSEO field, printed under DataForSEO's own name. `competition` " +
  "and `competition_level` are TWO different vendor fields — a 0-1 float and an advertiser band — " +
  "and SeoGrep neither merges them nor derives one from the other. `keyword_difficulty` is " +
  "DataForSEO's own 0-100 estimate about the search results for a keyword; it is not a forecast " +
  "of where your site would rank, not a promise that a low number is winnable, and neither " +
  "DataForSEO nor SeoGrep can tell you what traffic any of these keywords would bring you. " +
  "SeoGrep adds no score of its own, ranks nothing by a formula of its own, and calls no keyword " +
  "easy or worth targeting — the order is the vendor's, and which of these to target is your " +
  "decision. A field DataForSEO did not report is shown as unreported, never as a zero.";

/** The "nothing came back" answer — a real, delivered result rather than an error. */
function renderNoKeywords(
  result: DiscoverKeywordsResult,
  input: LookupLocale,
  project?: ProjectRef | null,
): string {
  const { window_offset: offset, window_limit: limit } = result.window;
  return [
    `No keywords for ${describeSubject(result.subject, project)} — DataForSEO Labs ` +
      `${vendorFunctionOf(result.mode)} (mode "${result.mode}").`,
    renderCriteria(result, input),
    `DataForSEO returned no keyword for this lookup in the window that was asked for (offset ` +
      `${thousands(offset)}, limit ${thousands(limit)}). That is an answer about this window and ` +
      "these filters — it is not a statement that no such keywords exist.",
  ].join("\n\n");
}

/** Render one lookup as the plain-text tool output (pure — unit-tested directly). */
export function formatDiscoverKeywords(
  result: DiscoverKeywordsResult,
  input: LookupLocale,
  project?: ProjectRef | null,
): string {
  if (result.window.rows.length === 0) {
    return renderNoKeywords(result, input, project);
  }
  return [
    renderHeading(result, project),
    renderCriteria(result, input),
    renderDiscoveryCaption(result.window),
    result.window.rows.map(renderKeywordRow).join("\n"),
    VENDOR_JUDGEMENT_NOTE,
  ].join("\n\n");
}

/**
 * The refinement above guarantees the field is there; this is that invariant made LOUD instead of
 * assumed. It runs BEFORE the credit reserve, so even the impossible branch costs nothing — and it
 * never lets an empty seed reach a paid endpoint, which is what `?? ""` would have done.
 */
function required<T>(value: T | undefined, field: ModeField, mode: DiscoverMode): T {
  if (value === undefined) {
    throw new Error(`internal: mode "${mode}" reached the vendor query without "${field}"`);
  }
  return value;
}

/**
 * The port query, built by NARROWING on `mode`. This switch is where the surface rejoins the
 * port's discriminated union: the compiler refuses to put a seed on the `for_site` branch or a
 * target on the `ideas` branch, so the type system protects the wire even if the refinement above
 * were ever loosened. `domain` is the RESOLVED domain and is used by `for_site` alone.
 */
export function buildDiscoverQuery(
  input: DiscoverKeywordsInput,
  domain: string | null,
): DiscoverKeywordsQuery {
  const base = {
    limit: input.limit,
    offset: input.offset,
    language_code: input.language_code,
    location_code: input.location_code,
    min_volume: input.min_volume,
    max_difficulty: input.max_difficulty,
  };
  switch (input.mode) {
    case "ideas":
      return { ...base, mode: "ideas", seeds: required(input.seeds, "seeds", input.mode) };
    case "suggestions":
      return { ...base, mode: "suggestions", seed: required(input.seed, "seed", input.mode) };
    case "related":
      return {
        ...base,
        mode: "related",
        seed: required(input.seed, "seed", input.mode),
        depth: input.depth ?? DEFAULT_RELATED_DEPTH,
      };
    case "for_site":
      return {
        ...base,
        mode: "for_site",
        target: required(domain ?? undefined, "target", input.mode),
        // Pinned explicitly in BOTH directions rather than left to a vendor default that could
        // move under a price we signed against the row count it produces.
        include_subdomains: input.include_subdomains ?? true,
      };
  }
}

/** Dependencies — the port is injectable so tests run offline (mock/disabled). */
export interface DiscoverKeywordsDeps {
  /**
   * The keyword-discovery port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: DiscoverKeywordsPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /**
   * The `subject_lookup_runs` writer (migration 0032). Injected so a spec can make the write fail
   * without breaking a database, and so the DB lane can corrupt its argument to reach the
   * fail-closed path the tool itself cannot produce.
   */
  readonly writeRun?: SubjectLookupRunWriter;
}

export function makeDiscoverKeywordsTool(deps: DiscoverKeywordsDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeSubjectLookupRuns;
  return defineTool<DiscoverKeywordsInput>({
    name: "discover_keywords",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — only "for_site" names a domain, and only it reads a project.
      // The three seed modes carry no target and no project_id (the refinement rejects both), so
      // they resolve nothing and work on a deployment whose project table is unreachable.
      let project: ProjectRef | null = null;
      let domain: string | null = null;
      if (input.mode === "for_site") {
        const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
        if (!subject.ok) {
          return errorResult(subject.error);
        }
        project = subject.project;
        domain = subject.domain;
      }
      const query = buildDiscoverQuery(input, domain);
      const port = deps.port ?? resolveDefaultDiscoverKeywordsPort();
      // Free pre-reserve gate 2 — refuse rather than reserve credits or serve mock rows.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch -> commit
      // as one chain. The vendor request failing throws, so withCredits releases.
      return withCredits({ userId: ctx.userId }, { tool: "discover_keywords" }, async () => {
        const result = await port.fetchDiscoverKeywords(query);
        const text = formatDiscoverKeywords(result, input, project);
        // THE RUN IS RECORDED BEFORE THE REPLY IS RETURNED, and the write is NOT guarded
        // (migration 0032; dfs/subject-runs.ts states the same contract from the other side).
        // withCredits commits a handler that RETURNS and releases one that THROWS, so an error
        // escaping here costs the tenant nothing. Caught and logged instead, the shape would be
        // the house's worst at 40 credits a call: a charged caller, a delivered table, and a panel
        // that says forever that the lookup never ran.
        //
        // THE IDENTITY COMES OFF THE RESULT'S OWN SUBJECT UNION, never off `input`: the port
        // clamps the seed list and the depth, so reading the caller's arguments would record a
        // question that was not the one the vendor answered. `projectId` is null on all three seed
        // modes — they name no domain at all — and on a bare-target `for_site` call.
        // AN ARRAY OF ONE. There is no singular writer to reach for — see its own header:
        // one insert path means atomicity is a property of the writer rather than of which
        // function a call site picked, and this tool writes exactly one row.
        await writeRun([
          {
            target: {
              userId: ctx.userId,
              projectId: project?.id ?? null,
              tool: "discover_keywords",
              identity: discoverSubjectIdentity(result.subject),
            },
            report: discoverKeywordsRunReport(result, {
              language_code: input.language_code,
              location_code: input.location_code,
            }),
          },
        ]);
        return textResult(text);
      });
    },
  });
}

/** The production discover_keywords tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const discoverKeywordsTool = makeDiscoverKeywordsTool();
