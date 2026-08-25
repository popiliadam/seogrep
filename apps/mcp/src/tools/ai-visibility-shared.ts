import { z } from "zod";
import { errorResult, type ToolResult } from "./registry.ts";
import {
  isLlmMentionsVendorError,
  PLATFORM_MEANS,
  type AiVisibilityRow,
  type LlmPlatform,
  type MeasurementScope,
  type MentionsResultSet,
  type VendorScalar,
} from "../dfs/llm-mentions.ts";

/**
 * What `ai_visibility` and `ai_visibility_compare` share: the four request fields that mean the
 * same thing on both surfaces, and the rendering of an answer whose ITEM SHAPE NOBODY HAS SEEN.
 *
 * =====================================================================================
 * THE RENDERER CANNOT NAME A FIELD, BECAUSE NO RESPONSE FROM THIS FAMILY HAS BEEN CAPTURED
 * =====================================================================================
 * Part A carries every scalar VERBATIM under the vendor's own key and lists the nested fields it
 * did not carry, precisely because a parser that guessed `mentions_count` would read `undefined`
 * in production while every fixture stayed green (signed lesson 12). A renderer that then printed
 * "Mentions: 37" would hand that guess back to the reader with a friendly caption on it — so this
 * one prints WHAT IS THERE: the vendor's own key, the vendor's own value, in the vendor's own
 * order, with no display name of ours anywhere. There is no field list in this file to go stale.
 *
 * =====================================================================================
 * NEVER #7 — WHAT THESE TWO TOOLS ARE NOT ALLOWED TO SAY
 * =====================================================================================
 * "AI visibility" is a claim about what a language model said at a moment in time, measured on ONE
 * platform, in ONE locale, over a period the caller cannot even scope — these endpoints publish no
 * date parameter, so there is no window to ask for and none to state. All of that has to be VISIBLE
 * in the answer, which is what {@link renderMeasurementScope} is for, and it is printed on every
 * answer rather than only when something is missing.
 *
 * There is no visibility score here, no share of voice, no sentiment, and no ranking by a formula
 * of ours. A vendor null is "the vendor did not say" and is printed in WORDS; a vendor 0 is an
 * answer and prints as 0. On a 90-credit question those are different answers, and this file is
 * where they are kept apart.
 */

/** The vendor's two platforms, DERIVED from the port's own table rather than retyped. */
export const PLATFORM_NAMES = Object.keys(PLATFORM_MEANS) as [LlmPlatform, ...LlmPlatform[]];

/**
 * WHICH assistant to ask about. Required with no default: the two platforms are two different
 * measurements, and a default would silently answer about one while the caller meant the other.
 */
export const platformField = z
  .enum(PLATFORM_NAMES)
  .describe(
    "WHICH assistant DataForSEO is asked about — required, with no default, because a measurement " +
      'of one says nothing about the other. "chat_gpt": mentions observed in ChatGPT answers. ' +
      '"google": mentions observed in Google\'s AI answers. There is no "all assistants" option ' +
      "here, and no answer covers an assistant the vendor did not query.",
  );

/**
 * THE CEILING IS THE VENDOR'S, AND IT IS DIFFERENT ON THE TWO ENDPOINTS — 20 on
 * `aggregated_metrics`, 10 on `cross_aggregated_metrics` (Part A holds the published quotes). So
 * this is a FACTORY rather than one shared field: a single schema could only have advertised one
 * of the two, and the version that advertised 100 advertised a value the vendor rejects outright —
 * the 2026-08-25 outage.
 *
 * IT IS NOT A PRICE CONTROL. The vendor's own words are "maximum number of elements within internal
 * arrays … `sources_domain` `search_results_domain`" — it caps two nested arrays inside the
 * aggregate, not the rows returned and not the rows billed. The old description called it "the
 * price control"; that claim is withdrawn here rather than restated, and the honest half of the old
 * wording ("Asking for fewer rows costs the same") is kept verbatim because it was always true.
 */
export function internalListLimitField(vendorMax: number) {
  return z
    .number()
    .int()
    .min(1)
    .max(vendorMax)
    .default(vendorMax)
    .describe(
      `How many entries DataForSEO may put inside its internal \`sources_domain\` and ` +
        `\`search_results_domain\` arrays (1-${vendorMax}, default ${vendorMax}) — the vendor's ` +
        `own \`internal_list_limit\`, whose published ceiling is ${vendorMax} on this endpoint. ` +
        "It controls how much supporting detail comes back, NOT what the lookup costs you. " +
        "Asking for fewer rows costs the same; asking for more is refused.",
    );
}

/**
 * `location_name` is a STRING on this family — not the `location_code` NUMBER every other
 * DataForSEO adapter in this repo sends. The description says so, because a caller who knows the
 * other tools will reach for a code.
 */
export const locationNameField = z
  .string()
  .min(1)
  .optional()
  .describe(
    'OPTIONAL DataForSEO `location_name` — a NAME, e.g. "United States", not the numeric ' +
      "location_code the other SeoGrep tools take (this vendor family publishes no code). Omitted " +
      "by default, in which case DataForSEO applies its own default and the answer says the " +
      "location was not specified rather than naming one nobody asked for.",
  );

export const languageCodeField = z
  .string()
  .min(2)
  .optional()
  .describe(
    "OPTIONAL DataForSEO `language_code`, e.g. \"en\". Omitted by default, in which case the " +
      "answer says the language was not specified rather than naming one nobody asked for.",
  );

/**
 * The vendor FUNCTION an endpoint really calls (".../<function>/live"), read off the endpoint the
 * money is spent at rather than retyped — so a heading cannot name one vendor function while the
 * request goes to another.
 */
export function vendorFunctionOf(endpoint: string): string {
  const segments = endpoint.split("/").filter((part) => part.length > 0);
  const fn = segments[segments.length - 2];
  if (fn === undefined) {
    throw new Error(`cannot read the vendor function out of the endpoint "${endpoint}"`);
  }
  return fn;
}

/** The pre-reserve honesty refusal, worded once for both tools. Charges nothing, serves nothing. */
export function notEnabledMessage(tool: string): string {
  return (
    `${tool} is not yet enabled on this deployment. Live DataForSEO data is turned off, and ` +
    "SeoGrep never returns sample or placeholder mentions as if a language model had really said " +
    "them. This tool will start returning data once live DataForSEO access is switched on — you " +
    "were not charged."
  );
}

/**
 * THE VENDOR-FAILURE REFUSAL, worded once for both tools — the sentence that replaces
 * `Tool "ai_visibility" failed unexpectedly … quote reference e383191d`.
 *
 * Four things the old sentence did not say and this one does:
 *
 *   WHAT FAILED   — the vendor, not the tool, and which vendor function the attempt was made at.
 *   WHAT IT SAID  — DataForSEO's OWN status code and message when it gave one. On 2026-08-25 the
 *                   vendor had already diagnosed the problem; nobody was shown it.
 *   WHAT IT MEANS — nothing about the subject. A failed measurement is not a low one, and this is
 *                   a 90-credit question about whether a brand is mentioned at all (NEVER #7).
 *   WHAT IT COST  — "You were not charged" was HALF true and read as the whole truth. The credits
 *                   really are released; the ATTEMPT really did use SeoGrep's own daily
 *                   third-party-data allowance. Both are said, and neither in dollars: our vendor
 *                   spend is our margin (budget-error.ts), and no credit figure is quoted here
 *                   because this file must not carry a price (NEVER #6).
 */
export function vendorFailureMessage(
  tool: string,
  endpoint: string,
  vendorStatusCode: number | null,
  vendorStatusMessage: string | null,
): string {
  const said =
    vendorStatusCode === null
      ? "DataForSEO did not return a readable answer, and gave no status of its own to quote."
      : `DataForSEO refused the request with status ${vendorStatusCode}` +
        (vendorStatusMessage === null ? "." : `: "${vendorStatusMessage}".`);
  return (
    `${tool} could not measure anything this time: the attempt to DataForSEO LLM Mentions ` +
    `${vendorFunctionOf(endpoint)} did not produce an answer. ${said}\n\n` +
    "This says nothing about the subject you asked about. A lookup that failed is not a lookup " +
    "that found nothing — no measurement was made at all, so no conclusion about mentions, or " +
    "the absence of them, can be drawn from it.\n\n" +
    "You were not charged any credits: the credits reserved for this lookup were released, and " +
    "the balance is unchanged. The attempt itself did go out to DataForSEO and used part of " +
    "SeoGrep's own daily third-party-data allowance — that is our cost, not yours, and it is " +
    "named here rather than left out so that \"you were not charged\" is not read as \"this cost " +
    "nobody anything\"."
  );
}

/**
 * Run one priced lookup and turn a VENDOR failure into an explanatory refusal.
 *
 * THE CATCH IS OUTSIDE withCredits, and that placement is the whole design. Catching INSIDE the
 * guarded region and returning a result would COMMIT — full price for a lookup that measured
 * nothing. The throw has to escape it to make the guard RELEASE; by the time it lands here the
 * release has already happened, so the refusal below is free (credits/guard.ts).
 *
 * Only the TYPED vendor failure is caught. Anything else is rethrown into the registry's generic
 * branch on purpose: a wider catch here would dress a genuine crash — a broken run-ledger write, a
 * bug in the renderer — as "the vendor had a problem", which is the disguise the 2026-08-09
 * campaign found twelve real failures wearing.
 *
 * The operator's log line is written HERE because this bypasses the registry catch that used to
 * write it.
 */
export async function catchVendorFailure(
  tool: string,
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    if (!isLlmMentionsVendorError(error)) throw error;
    console.error(`Tool "${tool}" refused — DataForSEO LLM Mentions: ${error.message}`);
    return errorResult(
      vendorFailureMessage(tool, error.endpoint, error.vendorStatusCode, error.vendorStatusMessage),
    );
  }
}

/** One vendor scalar, printed as the vendor sent it. `null` is a SILENCE and is printed in words. */
export function vendorScalar(field: string, value: VendorScalar): string {
  return value === null ? `${field} not reported by DataForSEO` : `${field} ${String(value)}`;
}

/**
 * One row's carried metrics, in the vendor's own key order, under the vendor's own names. No
 * rounding, no unit, no thousands separator: this repo has never seen a real row of this family,
 * so it does not know which of these keys are counts, shares, dates or ids, and formatting one
 * wrongly would be a claim about what it is.
 */
export function renderVendorMetrics(row: AiVisibilityRow): string {
  const entries = Object.entries(row.vendor_metrics);
  if (entries.length === 0) {
    return "DataForSEO carried no readable field on this row.";
  }
  return entries.map(([field, value]) => vendorScalar(field, value)).join(" · ");
}

/**
 * The nested vendor fields this port did NOT carry, named. A nested object or array is dropped
 * rather than flattened (Part A), and saying which ones is the difference between "the vendor sent
 * nothing else" and "the vendor sent more that you are not seeing here".
 */
export function renderNotCarried(row: AiVisibilityRow): string {
  if (row.vendor_nested_fields_not_carried.length === 0) return "";
  return (
    `\n  DataForSEO also sent these as nested objects or lists, which are not carried into this ` +
    `answer: ${row.vendor_nested_fields_not_carried.join(", ")}.`
  );
}

/** A locale value the caller supplied, or the honest statement that they supplied none. */
function localeClause(field: string, value: string | null): string {
  return value === null
    ? `${field} not specified in this request, so DataForSEO applied its own default and SeoGrep does not know which`
    : `${field} "${value}"`;
}

/**
 * WHAT THIS MEASUREMENT IS SCOPED TO — printed on EVERY answer, in full, never only when something
 * is missing. Four limits, and each one is a limit a reader would otherwise not know is there:
 *
 *   PLATFORM  — one assistant, in the vendor's own words, and the vendor's echo kept separate from
 *               our request. An un-echoed platform is not a confirmed platform.
 *   LOCALE    — one location and one language, or the plain statement that neither was specified.
 *   TIME      — the vendor's own timestamp WITH THE VENDOR KEY IT CAME FROM. When the vendor
 *               reported none, this says so; a clock reading is never substituted, because "we do
 *               not know when this was measured" and "this was measured just now" are different
 *               claims and only one of them is free to make.
 *   PERIOD    — there is none. These endpoints publish no date parameter, so no range was asked
 *               for and none can be. Silence here would read as "current", which is a claim.
 */
export function renderMeasurementScope(scope: MeasurementScope): string {
  const when =
    scope.vendor_reported_time_value === null
      ? "DataForSEO did not report when it measured this, and SeoGrep does not put its own clock " +
        "in place of a missing vendor timestamp."
      : `DataForSEO reported \`${scope.vendor_reported_time_field}\` ` +
        `${scope.vendor_reported_time_value} — the vendor's own value, under the vendor's own key.`;
  const echo =
    scope.vendor_echoed_platform === null
      ? "DataForSEO did not echo a platform back, so the platform above is the one this request " +
        "asked for rather than one the vendor confirmed."
      : `DataForSEO echoed the platform back as \`${scope.vendor_echoed_platform}\`.`;
  return (
    `What this measures: ${scope.platform_means}\n` +
    `Where and in what language: ${localeClause("location_name", scope.location_name)}, ` +
    `${localeClause("language_code", scope.language_code)}.\n` +
    `When: ${when} ${echo}\n` +
    "Over what period: this DataForSEO endpoint takes no date range, so none was asked for and " +
    "none can be — this answer is not scoped to a period you chose."
  );
}

/**
 * The row caption. `window_internal_list_limit` is OUR request fact and `window_row_count` OUR
 * count of the rows in hand; `vendor_total_count` is the VENDOR's whole-set number and is never
 * back-filled from the rows. There is deliberately no offset here: this family publishes no
 * pagination, so naming a window position would imply a capability it does not have.
 */
export function renderRowCaption<Row>(resultSet: MentionsResultSet<Row>, noun: string): string {
  const count = resultSet.window_row_count;
  const shown =
    `${count} ${count === 1 ? noun : `${noun}s`} came back under an internal_list_limit of ` +
    `${resultSet.window_internal_list_limit}`;
  const whole =
    resultSet.vendor_total_count === null
      ? "DataForSEO did not say how many this lookup matches in total"
      : `DataForSEO counts ${resultSet.vendor_total_count} matching this lookup in total`;
  return (
    `${shown}. ${whole}. This endpoint offers no paging — there is no offset to advance, so a ` +
    "wider set is a wider request, not a next page:"
  );
}

/**
 * WHOSE NUMBERS THESE ARE, and what neither tool claims. Printed on every answer, because a page
 * headed "AI visibility" reads as a verdict about how visible a brand IS, and neither SeoGrep nor
 * DataForSEO can say that (NEVER #7).
 */
export const AI_VISIBILITY_JUDGEMENT_NOTE =
  "Every value above is a DataForSEO field, printed under DataForSEO's own name and in the order " +
  "DataForSEO sent it. SeoGrep computes no visibility score, no share of voice and no sentiment, " +
  "ranks nothing by a formula of its own, and re-orders nothing — these endpoints publish no " +
  "ordering field, so there is nothing to sort by and none is invented. A field DataForSEO did " +
  "not report is shown as unreported, never as a zero: \"the vendor reported no mentions\" and " +
  "\"the vendor did not measure mentions\" are different answers to the same question, and only " +
  "the first one is about your brand. Nothing here predicts what an assistant will say next, and " +
  "nothing here generalises to an assistant DataForSEO was not asked about.";
