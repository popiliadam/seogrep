import { getServiceClient, type Database, type Json } from "../db.ts";
import { normalizeKeywordSet } from "./keyword-runs.ts";
import type { DiscoverKeywordRow, DiscoverKeywordsResult, DiscoverMode, DiscoverSubject } from "./discover-keywords.ts";
import type {
  AiVisibilityCompareResult,
  AiVisibilityCompareRow,
  AiVisibilityResult,
  AiVisibilityRow,
  CompareGroup,
  LlmPlatform,
  MeasurementScope,
  MentionTarget,
} from "./llm-mentions.ts";

/**
 * The SUBJECT LOOKUP RUN LEDGER (migration 0032): one row per MEASURED SUBJECT, for the three DFS
 * tools 0027's table and 0031's widening could not take.
 *
 * The SIXTH sibling of `audit/runs.ts` (0024), `gsc-data/runs.ts` (0025),
 * `tools/audit-content-runs.ts` (0026), `dfs/runs.ts` (0027 + 0031, seven domain lookups) and
 * `dfs/keyword-runs.ts` (0029, research_keywords). 0031's header named the three that were left:
 * discover_keywords, ai_visibility and ai_visibility_compare, "each of which would have to put a
 * non-domain in `target` on some of its rows", and said what they needed instead — "a
 * discriminated-subject axis of their own". 0032 is that axis and this module is its write half.
 *
 * All three ship the family's amnesia: `charge:"handler"`, synchronous, they call DataForSEO
 * inside the request, print a table and vanish. 40 credits, 90 credits, and 90 credits PER
 * COMPARED TARGET. Nothing here moves a price (NEVER #6).
 *
 * WHY THIS MODULE LIVES UNDER `dfs/` rather than `tools/`: `runs.ts`'s and `keyword-runs.ts`'s
 * reason, unchanged. It is the write half of the DFS family and sits beside `dfs/budget.ts`, the
 * other DB-backed module in this directory, under the constitution's SIGNED NEVER #5 exception
 * (audit L-04, human sign-off 2026-08-03). Nothing in this file talks to DataForSEO: it talks to
 * the SHAPES the two adapters in this directory return.
 *
 * WHAT IS STORED IS THE STRUCTURAL RESULT, not the rendered text — the family rule for the sixth
 * time. The prose is for a human and free to change; the numbers underneath are what a second
 * surface can query.
 *
 * ONE ai_visibility_compare CALL WRITES 2-10 ROWS. That is 0032's biggest decision and its header
 * argues it; the consequence for this module is that {@link aiVisibilityCompareRunRows} returns a
 * LIST of (identity, report) pairs and the tool loops the writer over it. A row per compared
 * target is also a row per PRICED UNIT, so the rows this module writes for that tool can be
 * counted against credit_ledger.
 */

/**
 * The row cap on every list a report here carries.
 *
 * 50, the same number as 0027's MAX_RUN_ROWS but decided again rather than imported — the two
 * tables are different tables and a shared constant would make one table's cap move when the other
 * one's argument changed (0029 made the same separation in the other direction, choosing 100).
 *
 * WHY 50 AND NOT 0029's "STORE THE WHOLE ANSWER": 0029 could store everything because its tool's
 * own input schema bounded the answer at 100 small rows. Neither bound exists here.
 * discover_keywords may ask for MAX_DISCOVER_ROWS = 1000 rows, each carrying a trend object and an
 * intent list; and the LLM Mentions rows are worse than large, they are UNKNOWN — no response from
 * that vendor family has ever been captured in this repo, so `vendor_metrics` is an open bag of
 * scalars under whatever keys the vendor chose, and a compare response carries up to
 * MAX_INTERNAL_LIST_ROWS = 100 of them PER TARGET across up to ten targets.
 *
 * The headline counters are always PRE-cap, so capping a list never changes what a row claims
 * about the run.
 */
export const MAX_SUBJECT_RUN_ROWS = 50;

/** The first MAX_SUBJECT_RUN_ROWS of a list, verbatim. Applied to EVERY list, uniformly. */
function capRows<Row>(rows: readonly Row[]): readonly Row[] {
  return rows.slice(0, MAX_SUBJECT_RUN_ROWS);
}

/** The three tools 0032's CHECK names. A fourth is a compile error before it is a 23514. */
export type SubjectLookupTool = "discover_keywords" | "ai_visibility" | "ai_visibility_compare";

/**
 * What KIND of thing a row is about — 0032's stored discriminant, and the reason one column can
 * hold a domain on one row and a keyword on the next without either row lying about itself.
 *
 * 'domain' and 'keyword' carry exactly one value; only 'keyword_set' may carry more. The DATABASE
 * enforces that (`subject_lookup_runs_subject_cardinality`), which is what keeps the discriminant
 * load-bearing rather than decorative.
 */
export type SubjectKind = "domain" | "keyword" | "keyword_set";

/** A row's whole identity: what kind of thing was looked up, and which one(s). */
export interface SubjectIdentity {
  readonly kind: SubjectKind;
  /** Normalized. For 'domain' it is `normalizeDomain`'s output; for the two keyword kinds it is
   * `normalizeKeywordSet`'s, so the identity of a keyword is derived in ONE place repo-wide. */
  readonly subject: readonly string[];
}

/**
 * A subject that normalized away to nothing cannot be stored (0032's non-empty CHECK) and could
 * never be shown to anyone, so it is refused HERE with a message that names the tool — before
 * PostgREST is asked and before the reply is returned.
 *
 * It is reachable only from a degenerate call: every one of these tools requires a non-empty
 * string, but `z.string().min(1)` accepts a single space, which `normalizeKeywordSet` correctly
 * drops. The tenant pays NOTHING for it — this throws inside `withCredits`, which releases — which
 * is the fail-closed contract working, not an edge case slipping through it.
 */
function requireSubject(kind: SubjectKind, subject: readonly string[], what: string): SubjectIdentity {
  if (subject.length === 0) {
    throw new Error(`${what}: the subject normalized to nothing, so this run cannot be recorded`);
  }
  return { kind, subject };
}

/**
 * discover_keywords' identity, narrowed on the RESULT's own subject union — never on the caller's
 * input, for the reason the tool's own renderer gives: an answer built for a different mode than
 * the one requested must say so rather than wear the caption the caller expected.
 *
 * `ideas` is a SET and gets 0029's normalizer whole (de-duplicated, sorted), so two calls that
 * differ only in the order the seeds were typed are one subject. `suggestions` and `related` name
 * ONE keyword each; `for_site` names one domain, already `normalizeDomain`'s output by the time
 * the port echoes it back.
 *
 * WHAT THIS DELIBERATELY DOES NOT PUT IN THE IDENTITY: the mode. `suggestions` and `related` on
 * the same seed are the same SUBJECT asked two different QUESTIONS, and the question is
 * `report.mode` — a column that folded them together would make the subject unreadable, and one
 * that split them would make an identity out of something that is not one.
 */
export function discoverSubjectIdentity(subject: DiscoverSubject): SubjectIdentity {
  switch (subject.mode) {
    case "ideas":
      return requireSubject("keyword_set", normalizeKeywordSet(subject.seeds), "discover_keywords");
    case "suggestions":
    case "related":
      return requireSubject("keyword", normalizeKeywordSet([subject.seed]), "discover_keywords");
    case "for_site":
      return requireSubject("domain", [subject.target], "discover_keywords");
  }
}

/**
 * An LLM-mentions target's identity — the vendor's own either/or, which Part A already models as
 * a discriminated union. Shared by both AI tools, so a domain measured alone and the same domain
 * measured inside a comparison produce the SAME identity and therefore one history.
 */
export function mentionSubjectIdentity(target: MentionTarget, what: string): SubjectIdentity {
  return target.kind === "domain"
    ? requireSubject("domain", [target.domain], what)
    : requireSubject("keyword", normalizeKeywordSet([target.keyword]), what);
}

/** The locale a Labs lookup ran under: this family takes a numeric `location_code`. */
export interface LabsRunLocale {
  readonly language_code: string;
  readonly location_code: number;
}

/**
 * The locale an LLM-mentions lookup ran under.
 *
 * A DIFFERENT SHAPE from every sibling's, and that is the vendor's doing rather than a slip: this
 * endpoint family takes `location_name`, a STRING ("United States"), where the Labs and Backlinks
 * families take a numeric `location_code`. Both fields are OPTIONAL on the wire, so both are
 * nullable here — null means "not specified in the request", which is a different fact from a
 * default this module would otherwise be inventing. 0032's header is why the two live inside
 * `report` rather than in one column with two meanings.
 */
export interface MentionsRunLocale {
  readonly location_name: string | null;
  readonly language_code: string | null;
}

/**
 * discover_keywords' report.
 *
 * THE MODE IS THE FIRST FIELD AND IT IS O(1), because `subject_kind` cannot recover it:
 * 'suggestions' and 'related' both produce a 'keyword' subject, and 'ideas' and 'for_site' are
 * told apart by their kind but only by accident. The mode is the QUESTION that was asked, the
 * panel prints it, and without it a row says what was looked up but not what was asked about it.
 *
 * `depth` and `include_subdomains` are MODE-SPECIFIC and are therefore optional: a reader narrows
 * on `mode` first, exactly as the port's own union forces a renderer to. They are `undefined` on
 * the modes that have no such parameter, and `JSON.stringify` drops an `undefined` key entirely —
 * so an absent key means "this question does not exist for this mode", never "it was not
 * recorded". That is the same distinction 0027 refused to blur with a nullable locale COLUMN,
 * kept inside a report where a discriminant sits beside it.
 */
export interface DiscoverKeywordsRunReport {
  readonly mode: DiscoverMode;
  readonly locale: LabsRunLocale;
  /**
   * DataForSEO's count of the WHOLE set matching this lookup, before the caller's window. NULL
   * when the vendor declined to say, and null is stored as null: the port refuses to back-fill it
   * from `rows.length`, and 0 would merge "the vendor did not say" with "nothing matches".
   */
  readonly total: number | null;
  /** Rows this response carried, BEFORE MAX_SUBJECT_RUN_ROWS. `rows` may be shorter; this is not. */
  readonly shown: number;
  /** The window the rows came back under — the caller's own two request facts. */
  readonly limit: number;
  readonly offset: number;
  /** MODE "related" only: how far the vendor followed "searches related to" outward. */
  readonly depth?: number;
  /** MODE "for_site" only: whether the domain's subdomains counted as part of it. */
  readonly include_subdomains?: boolean;
  /**
   * The first row in the VENDOR's order (by `keyword_info.search_volume`), or null on an empty
   * window. Duplicated out of `rows[0]` so the panel never downloads the list — 0025's
   * DiscoverySummary case: PostgREST navigates into jsonb but cannot take an array's first element.
   *
   * Every field stays NULLABLE. A keyword the vendor reported no volume for is not a keyword with
   * zero searches (NEVER #7), and this is the row a panel prints as the run's headline.
   */
  readonly top: {
    readonly keyword: string;
    readonly search_volume: number | null;
    readonly cpc: number | null;
    readonly keyword_difficulty: number | null;
  } | null;
  /**
   * The vendor-grammar filters really sent, VERBATIM and CAPPED. Bounded at two by construction
   * today (min_volume, max_difficulty); capped anyway, because "every list this report composes
   * goes through capRows" is a rule a reader can check, while "that one happens to be short" is a
   * fact about today's schema.
   *
   * It is stored rather than dropped because it is what `total` COUNTED: a filtered lookup and an
   * unfiltered one of the same subject counted different sets, and the panel's refusal to subtract
   * them rests on this field existing.
   */
  readonly vendor_filters_applied: readonly unknown[];
  /** The first MAX_SUBJECT_RUN_ROWS rows, VERBATIM. `total`/`shown` above are the pre-cap numbers. */
  readonly rows: readonly DiscoverKeywordRow[];
}

/** What both AI-visibility reports carry: the platform, the locale, and the vendor's own clock. */
interface MentionsRunReportBase {
  /** The platform this lookup ASKED about. Every figure below is scoped to THAT assistant. */
  readonly platform: LlmPlatform;
  /**
   * The platform the VENDOR echoed back, or null when it echoed none. Stored SEPARATELY from the
   * requested one on purpose: they are two different facts, and a row where they disagree is a row
   * whose numbers describe an assistant the caller did not ask about.
   */
  readonly vendor_echoed_platform: string | null;
  readonly locale: MentionsRunLocale;
  /**
   * The VENDOR's own account of when it measured — which KEY it came from, and its RAW value.
   *
   * 0030's three-clocks rule: never parsed into a timestamp, because this vendor family's format
   * is not ISO-8601 and a parse is an interpretation this table has no business making on the
   * vendor's behalf. Both are null when the vendor said nothing; `created_at` is OUR clock and is
   * never substituted for either, because "we do not know when the vendor measured this" and "the
   * vendor measured this just now" are different claims.
   */
  readonly vendor_reported_time_field: string | null;
  readonly vendor_reported_time_value: string | null;
  /** The row cap this lookup was fetched under — what the vendor was told, not what came back. */
  readonly internal_list_limit: number;
}

/** ai_visibility's report: one subject, the vendor's rows for it. */
export interface AiVisibilityRunReport extends MentionsRunReportBase {
  /**
   * The vendor's count of the whole matching set for this subject. NULL when it did not say, and
   * never back-filled from `rows.length` (Part A refuses that and so does this).
   */
  readonly total: number | null;
  /** Rows this response carried for the subject, BEFORE the cap. */
  readonly shown: number;
  /** The first MAX_SUBJECT_RUN_ROWS rows, VERBATIM, under the vendor's own keys. */
  readonly rows: readonly AiVisibilityRow[];
}

/**
 * ai_visibility_compare's report — ONE PER COMPARED TARGET, because 0032 keys these rows by the
 * subject rather than by the call.
 *
 * THERE IS NO `total` HERE, and the absence is a decision. The vendor's `vendor_total_count` on a
 * compare response counts rows across EVERY compared target; putting it on a per-subject row would
 * publish a number a reader would inevitably take for this target's. A count nobody made for this
 * subject is not stored under a name that suggests they did.
 */
export interface AiVisibilityCompareRunReport extends MentionsRunReportBase {
  /**
   * The CALLER's own label for this target, as the vendor echoed it and as rows were matched on.
   * It may differ from the subject — a caller may label a competitor's domain "them" — so it is
   * stored beside the subject rather than instead of it.
   */
  readonly aggregation_key: string;
  /**
   * Did DataForSEO return ANY row for this target? The one O(1) field that keeps "the vendor did
   * not report on this target" apart from "this target has zero mentions" — a distinction that
   * cost 90 credits to obtain, which the surface prints in words and which would otherwise be
   * unrecoverable from a row that simply carries no rows.
   */
  readonly answered: boolean;
  /** Rows this response carried FOR THIS TARGET, before the cap. 0 exactly when `answered` is false. */
  readonly shown: number;
  /** How many targets this one call compared — the PRICED unit, and this row's share of the bill. */
  readonly compared_target_count: number;
  /**
   * The OTHER targets' labels, CAPPED. What makes the whole comparison reconstructable from ANY
   * ONE of its rows, which is what 0032 traded a `run_id` column for.
   */
  readonly compared_with: readonly string[];
  /** This target's rows, first MAX_SUBJECT_RUN_ROWS, VERBATIM. */
  readonly rows: readonly AiVisibilityCompareRow[];
}

/** Every report this table stores. Schemaless in the column; discriminated by `tool` in the row. */
export type SubjectLookupReport =
  | DiscoverKeywordsRunReport
  | AiVisibilityRunReport
  | AiVisibilityCompareRunReport;

/** The locale + clock fields both AI reports share, read off ONE scope object. */
function mentionsBase(scope: MeasurementScope, internalListLimit: number): MentionsRunReportBase {
  return {
    platform: scope.platform_requested,
    vendor_echoed_platform: scope.vendor_echoed_platform,
    locale: { location_name: scope.location_name, language_code: scope.language_code },
    vendor_reported_time_field: scope.vendor_reported_time_field,
    vendor_reported_time_value: scope.vendor_reported_time_value,
    internal_list_limit: internalListLimit,
  };
}

/**
 * Build discover_keywords' report from the result the formatter is about to render (pure).
 *
 * The RESULT is the source of every mode-shaped field, never the input: the port clamps `depth`
 * and `seeds`, so reading them off the caller's arguments would record the value the caller typed
 * rather than the value the lookup ran under — `disavowCandidatesRunReport`'s rule, one adapter
 * over. Only the locale and the window come from the query, because the result does not carry them.
 */
export function discoverKeywordsRunReport(
  result: DiscoverKeywordsResult,
  query: LabsRunLocale,
): DiscoverKeywordsRunReport {
  const best = result.window.rows[0];
  return {
    mode: result.mode,
    locale: { language_code: query.language_code, location_code: query.location_code },
    total: result.window.vendor_total_count,
    shown: result.window.window_row_count,
    limit: result.window.window_limit,
    offset: result.window.window_offset,
    ...(result.subject.mode === "related" ? { depth: result.subject.depth } : {}),
    ...(result.subject.mode === "for_site"
      ? { include_subdomains: result.subject.include_subdomains }
      : {}),
    top:
      best === undefined
        ? null
        : {
            keyword: best.keyword,
            search_volume: best.search_volume,
            cpc: best.cpc,
            keyword_difficulty: best.keyword_difficulty,
          },
    vendor_filters_applied: capRows(result.vendor_filters_applied),
    rows: capRows(result.window.rows),
  };
}

/** Build ai_visibility's report from the result the formatter is about to render (pure). */
export function aiVisibilityRunReport(result: AiVisibilityResult): AiVisibilityRunReport {
  return {
    ...mentionsBase(result.scope, result.result_set.window_internal_list_limit),
    total: result.result_set.vendor_total_count,
    shown: result.result_set.window_row_count,
    rows: capRows(result.result_set.rows),
  };
}

/** One compared target's row: its identity, and the report that belongs to that subject alone. */
export interface SubjectLookupRunRow {
  readonly identity: SubjectIdentity;
  /** The project this target was resolved from, or null when it was a bare domain or a keyword. */
  readonly projectId: string | null;
  readonly report: AiVisibilityCompareRunReport;
}

/**
 * Build ONE ROW PER COMPARED TARGET from one comparison (pure) — 0032's per-subject key, in code.
 *
 * ROWS ARE MATCHED TO TARGETS ON THE CALLER'S OWN KEY as the vendor echoed it, never by position:
 * a positional match would turn a vendor reordering into one competitor silently wearing another's
 * figures, which is the trap the tool's own renderer names.
 *
 * A TARGET THE VENDOR ANSWERED NOTHING FOR STILL GETS A ROW, carrying `answered: false` and no
 * rows. Dropping it would make a target the tenant paid 90 credits for invisible on the very
 * surface built to stop paid lookups vanishing.
 *
 * `projectIds` is positional against `groups` because that is how the tool resolved them, and its
 * length is checked rather than assumed: a short list would silently record a project run as a
 * bare one.
 */
export function aiVisibilityCompareRunRows(
  result: AiVisibilityCompareResult,
  projectIds: readonly (string | null)[],
): SubjectLookupRunRow[] {
  const groups: readonly CompareGroup[] = result.groups;
  if (projectIds.length !== groups.length) {
    throw new Error(
      `ai_visibility_compare: ${projectIds.length} resolved projects for ${groups.length} compared targets`,
    );
  }
  const byKey = new Map<string, AiVisibilityCompareRow[]>();
  for (const row of result.result_set.rows) {
    byKey.set(row.aggregation_key, [...(byKey.get(row.aggregation_key) ?? []), row]);
  }
  const base = mentionsBase(result.scope, result.result_set.window_internal_list_limit);
  return groups.map((group, index) => {
    const rows = byKey.get(group.aggregation_key) ?? [];
    return {
      identity: mentionSubjectIdentity(group.target, "ai_visibility_compare"),
      projectId: projectIds[index] ?? null,
      report: {
        ...base,
        aggregation_key: group.aggregation_key,
        // The PORT's own answer, not `rows.length === 0`: Part A computes
        // `groups_without_vendor_row` from what the vendor sent, and re-deriving it here would be
        // a second, drifting definition of the one distinction this report exists to keep.
        answered: !result.groups_without_vendor_row.includes(group.aggregation_key),
        shown: rows.length,
        compared_target_count: result.cost.compared_target_count,
        compared_with: capRows(
          groups
            .filter((other) => other.aggregation_key !== group.aggregation_key)
            .map((other) => other.aggregation_key),
        ),
        rows: capRows(rows),
      },
    };
  });
}

/** Everything one `subject_lookup_runs` row is keyed by. */
export interface SubjectLookupRunTarget {
  readonly userId: string;
  /**
   * The project the subject was resolved from, or NULL. Null is the COMMON case on this table
   * (0032): five of the eight input shapes these three tools accept cannot name a project at all.
   */
  readonly projectId: string | null;
  readonly tool: SubjectLookupTool;
  readonly identity: SubjectIdentity;
}

/** The write itself — injectable so a spec can make it fail without breaking a database. */
export type SubjectLookupRunWriter = (
  target: SubjectLookupRunTarget,
  report: SubjectLookupReport,
) => Promise<void>;

type SubjectLookupRunInsert = Database["public"]["Tables"]["subject_lookup_runs"]["Insert"];

/**
 * The report as a `jsonb` value.
 *
 * A ROUND TRIP rather than a cast, for `runs.ts`'s three reasons — and the third one is at its
 * strongest here. `rows` is stored VERBATIM out of a zod parse of a DataForSEO response, and for
 * the two AI tools the parse is deliberately OPEN: `vendor_metrics` is `Record<string,
 * VendorScalar>` because no response from that family has ever been captured, so the concrete key
 * set is whatever the vendor sent. `JSON.stringify` is exactly the transformation PostgREST is
 * about to apply, so what is type-checked here is what is stored, whoever authored the fields —
 * and it is also what DROPS the `undefined` mode-specific keys, which is how an absent `depth`
 * stays absent rather than becoming a null.
 */
export function subjectLookupReportToJson(report: SubjectLookupReport): Json {
  return JSON.parse(JSON.stringify(report)) as Json;
}

/**
 * Record one measured subject.
 *
 * FAIL-CLOSED, and that is the whole contract (0024/0025/0026/0027/0029's rule): a PostgREST error
 * is re-thrown, never logged and swallowed. The caller runs inside `withCredits`, which COMMITS a
 * handler that returns and RELEASES one that throws — so throwing means the tenant pays NOTHING
 * for a run whose record was lost. Swallowing would produce the opposite and worse shape: a
 * charged tenant, a delivered table, and a panel that will forever say the lookup never ran.
 *
 * AT UP TO 900 CREDITS A CALL this is the most expensive place in the product to get that
 * backwards, and ai_visibility_compare makes the stakes sharper in a second way: the tool writes
 * one row per compared target, so a swallowed error would leave a comparison PARTLY recorded —
 * some targets on the panel and some not, from a call that was charged in full.
 */
export async function writeSubjectLookupRun(
  target: SubjectLookupRunTarget,
  report: SubjectLookupReport,
): Promise<void> {
  const row: SubjectLookupRunInsert = {
    user_id: target.userId,
    project_id: target.projectId,
    tool: target.tool,
    subject_kind: target.identity.kind,
    subject: [...target.identity.subject],
    report: subjectLookupReportToJson(report),
  };
  const { error } = await getServiceClient().from("subject_lookup_runs").insert(row);
  if (error) {
    throw new Error(`${target.tool}: subject_lookup_runs write failed (${error.message})`);
  }
}
