import { z } from "zod";
import { errorResult, type ToolResult } from "./registry.ts";
import { defaultLocaleWarning, twoLetterTld } from "../format/locale-default.ts";
import { AI_QUERY_FAN_OUT_MECHANISM } from "./serp-features.ts";
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
 * =====================================================================================
 * THE PLATFORM x LOCALE MATRIX — the vendor's published rule, applied BEFORE the reserve
 * =====================================================================================
 * WHAT IT COST TO NOT HAVE THIS, measured live on 2026-09-04. `platform: "chat_gpt"` with
 * `location_name: "Turkey"` reserved 90 credits, went out to DataForSEO, and came back
 * `40501 Invalid Field: 'location_name'`; the same again with `language_code: "tr"`. Neither
 * charged the caller — withCredits released both — but each burned $0.30 of reserved vendor
 * budget, and two of them tripped the $0.50 daily free-vendor allowance and PAUSED the tool for
 * that account until 00:00 UTC. One caller's locale typo took the tool down for the day, and the
 * happy path could not be measured at all afterwards.
 *
 * NONE OF THAT NEEDED TO BE DISCOVERED BY SPENDING. DataForSEO publishes the rule on both
 * endpoints (read 2026-09-04): "chat_gpt data is available for `United States` and `English`
 * only", and again as codes — "chat_gpt data is available for `2840` location code and `en`
 * language code only". `cross_aggregated_metrics` says it as two notes ("for United States only",
 * "for English only"). So a chat_gpt request naming any other locale is refused HERE, for free.
 *
 * THE FIELDS THEMSELVES ARE NOT THE BUG, which is the correction the audit record needed: the
 * vendor DOES publish `location_name`, `location_code`, `language_name` and `language_code` on
 * both endpoints. Dropping them from the schema would have removed a capability `google` really
 * has (92 locations). What was missing is the pairing rule.
 *
 * WHY `google` IS WAVED THROUGH RATHER THAN CHECKED AGAINST A LIST. The vendor's list of 92
 * locations lives at the FREE `llm_mentions/locations_and_languages` endpoint, and this repo has
 * not cached it: the published documentation shows exactly ONE example item (Albania, 2008,
 * `sq`, platforms `["google"]`). A 1-of-92 allowlist would refuse 91 locations that work, and
 * writing the other 91 from memory is precisely the invention NEVER #7 forbids. So a google
 * lookup runs, and {@link UNVALIDATED_LOCALE_NOTE} says out loud that the value was not checked
 * against a list nobody here holds. Caching that endpoint is the follow-up; claiming to have
 * cached it is not.
 */

/** The ONLY location `chat_gpt` data exists for, in the vendor's own words. */
export const CHAT_GPT_ONLY_LOCATION_NAME = "United States";
/** The ONLY language `chat_gpt` data exists for, as the vendor's `language_code`. */
export const CHAT_GPT_ONLY_LANGUAGE_CODE = "en";
/** The vendor's published defaults for BOTH endpoints when the caller names no locale. */
export const LLM_MENTIONS_DEFAULT_LOCATION_CODE = 2840;
export const LLM_MENTIONS_DEFAULT_LANGUAGE_CODE = "en";

/** The vendor's sentence, quoted once so no surface paraphrases it into something softer. */
export const CHAT_GPT_LOCALE_QUOTE =
  '"chat_gpt data is available for United States and English only" (DataForSEO, LLM Mentions, ' +
  "read 2026-09-04)";

/** A caller's locale value, compared the way a NAME or a CODE is compared: trimmed, case-blind. */
function sameLocaleValue(given: string, published: string): boolean {
  return given.trim().toLowerCase() === published.toLowerCase();
}

/** The locale half of both tools' input — the only two fields this rule is about. */
export interface LocaleInput {
  readonly platform: LlmPlatform;
  readonly location_name?: string | undefined;
  readonly language_code?: string | undefined;
}

/**
 * The platform x locale rule as a ZOD refinement, shared by both tools.
 *
 * IT IS IN THE SCHEMA, NOT IN A HANDLER, and that is the point: a schema refusal happens before
 * the tool function is ever entered, so "no credit is reserved and no vendor request goes out" is
 * a property of the SHAPE rather than of the order somebody wrote the handler's gates in. It is
 * also why the refusal reaches the caller carrying the registry's own "You were not charged."
 *
 * BOTH offending fields are named when both are wrong, on the same argument the subject rules
 * make above: one message per mistake, not one message per call.
 */
export function refinePlatformLocale(input: LocaleInput, ctx: z.RefinementCtx): void {
  if (input.platform !== "chat_gpt") return;
  const wrong: Array<{ field: "location_name" | "language_code"; published: string }> = [];
  if (
    input.location_name !== undefined &&
    !sameLocaleValue(input.location_name, CHAT_GPT_ONLY_LOCATION_NAME)
  ) {
    wrong.push({ field: "location_name", published: `"${CHAT_GPT_ONLY_LOCATION_NAME}"` });
  }
  if (
    input.language_code !== undefined &&
    !sameLocaleValue(input.language_code, CHAT_GPT_ONLY_LANGUAGE_CODE)
  ) {
    wrong.push({ field: "language_code", published: `"${CHAT_GPT_ONLY_LANGUAGE_CODE}"` });
  }
  for (const { field, published } of wrong) {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message:
        `platform "chat_gpt" is measured in ONE locale and DataForSEO says so: ` +
        `${CHAT_GPT_LOCALE_QUOTE}. A "${field}" of anything but ${published} is rejected by the ` +
        "vendor AFTER the credits are reserved and the paid request has gone out, so it is " +
        `rejected here instead, where it costs nothing. Either drop "${field}" — the endpoint ` +
        `then runs in its own published default, location_code ` +
        `${LLM_MENTIONS_DEFAULT_LOCATION_CODE} in "${LLM_MENTIONS_DEFAULT_LANGUAGE_CODE}", which ` +
        `is that same locale — or pass ${published}, or ask platform "google", which DataForSEO ` +
        "does publish other locations and languages for.",
    });
  }
}

/**
 * `location_name` is what THIS surface sends — a STRING, not the `location_code` NUMBER every
 * other DataForSEO adapter in this repo sends. The description says so, because a caller who knows
 * the other tools will reach for a code.
 *
 * IT DOES NOT SAY THE VENDOR HAS NO CODE, and it used to. "This vendor family publishes no code"
 * was written without reading the vendor's field list and is false: `aggregated_metrics` and
 * `cross_aggregated_metrics` both publish `location_code` (default 2840) and `language_name`
 * alongside the two fields sent here. Which of the pair SeoGrep sends is a choice of ours; what
 * the vendor publishes is a fact, and the old sentence dressed the first up as the second.
 */
export const locationNameField = z
  .string()
  .min(1)
  .optional()
  .describe(
    'OPTIONAL DataForSEO `location_name` — a NAME, e.g. "United States", not the numeric ' +
      "location_code the other SeoGrep tools take (DataForSEO publishes a `location_code` for " +
      `this endpoint too, defaulting to ${LLM_MENTIONS_DEFAULT_LOCATION_CODE}; SeoGrep sends the ` +
      "name). Omitted by default, in which case the lookup runs in DataForSEO's own published " +
      "default — the United States — and the answer says so rather than leaving you to guess. " +
      'On platform "chat_gpt" that default is the ONLY location the vendor has data for, and any ' +
      "other value is refused before anything is charged.",
  );

export const languageCodeField = z
  .string()
  .min(2)
  .optional()
  .describe(
    'OPTIONAL DataForSEO `language_code`, e.g. "en". Omitted by default, in which case the ' +
      `lookup runs in DataForSEO's own published default — "${LLM_MENTIONS_DEFAULT_LANGUAGE_CODE}" ` +
      ", English — and the answer says so rather than leaving you to guess. On platform " +
      '"chat_gpt" that default is the ONLY language the vendor has data for, and any other value ' +
      "is refused before anything is charged.",
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

/**
 * A locale value the caller supplied, or the DEFAULT the vendor applied — NAMED.
 *
 * It used to say "DataForSEO applied its own default and SeoGrep does not know which", which was
 * an honest sentence about a fact nobody had looked up. The vendor publishes both defaults on both
 * endpoints — `location_code` 2840, `language_code` `en` — so the answer can name the locale it
 * really ran in. "We do not know" and "the United States, in English" are different answers to a
 * 90-credit question, and the reader can only act on the second one.
 */
function localeClause(field: string, value: string | null, fallback: string): string {
  return value === null
    ? `${field} not specified in this request, so the lookup ran in DataForSEO's own published default — ${fallback}`
    : `${field} "${value}"`;
}

/**
 * WHAT WAS NOT CHECKED, on a `google` lookup that named a locale.
 *
 * DataForSEO publishes the locations and languages this family supports at a FREE endpoint
 * (`llm_mentions/locations_and_languages`, 92 locations, each listing which platforms it has data
 * for). SeoGrep does not hold that list, so a `google` locale is passed straight through: it is
 * the vendor, not this product, that decides whether the value exists. Saying so is the difference
 * between a value that was checked and one that merely was not rejected — and a locale the vendor
 * has no data for comes back as a thin answer, not as an error, which is exactly the shape that
 * reads as "nobody mentions you".
 */
export const UNVALIDATED_LOCALE_NOTE =
  "The location and language above were sent to DataForSEO as you gave them: SeoGrep does not " +
  "hold the vendor's list of supported locations for this family, so it did not check them and " +
  "is not claiming they are valid. DataForSEO publishes that list at its own " +
  "`llm_mentions/locations_and_languages` endpoint. A locale the vendor has no data for comes " +
  "back as a thin answer rather than as an error, so a nearly empty result here is worth " +
  "re-reading as a locale question before it is read as an answer about your subject.";

/** Whether this lookup named any locale at all, or is riding both published defaults. */
function namedALocale(scope: MeasurementScope): boolean {
  return scope.location_name !== null || scope.language_code !== null;
}

/**
 * The locale paragraphs an answer carries, in order, and none of them when there is nothing to
 * say. ONE composer for both tools: the two surfaces differ in what they can resolve a domain
 * from, never in what they tell a reader about the same locale (format/locale-default.ts's rule).
 */
export function localeNotes(
  scope: MeasurementScope,
  domains: readonly string[],
): readonly string[] {
  const notes: string[] = [];
  const warning = aiVisibilityLocaleWarning(scope, domains);
  if (warning !== "") notes.push(warning);
  if (scope.platform_requested === "google" && namedALocale(scope)) {
    notes.push(UNVALIDATED_LOCALE_NOTE);
  }
  return notes;
}

/**
 * R-5.5 ON THE TWO SURFACES THAT MEASURE GOOGLE'S AI ANSWERS DIRECTLY, and until now the only two
 * with no fan-out sentence anywhere: `serp_snapshot` and `keyword_positions` have printed one
 * since #221, and they merely report that an AI Overview BLOCK was on a page. These two report
 * what came out of it, which is the reading the mechanism most changes the meaning of.
 *
 * IT SHARES THE FACT AND NOT THE SENTENCE. AI_QUERY_FAN_OUT_MECHANISM is the clause about Google;
 * the ending here is about THIS measurement, because the sibling's ending ("whether a site is
 * cited inside the block", "the one keyword measured here") describes things this family does not
 * report and a subject it may not have.
 *
 * `chat_gpt` gets nothing: query fan-out is a claim about Google, and printing it under a ChatGPT
 * measurement would be a mechanism asserted where none was measured.
 */
export const AI_VISIBILITY_FAN_OUT_NOTE =
  `${AI_QUERY_FAN_OUT_MECHANISM} before it writes an answer, so what DataForSEO counted here is ` +
  "the OUTPUT of that fan-out and not the result of any one query you could run yourself. A " +
  "figure above cannot be traced back to a single question a person asked, and asking a slightly " +
  "different one can produce a different set of cited pages.";

/** The fan-out note when this lookup asked about Google, and nothing when it did not. */
export function fanOutNotes(scope: MeasurementScope): readonly string[] {
  return scope.platform_requested === "google" ? [AI_VISIBILITY_FAN_OUT_NOTE] : [];
}

/**
 * THE US/ENGLISH DEFAULT, SAID OUT LOUD ON THIS FAMILY TOO — the sixth member of the class
 * format/locale-default.ts was written for, joined here rather than re-worded here.
 *
 * The trigger is that module's: both parameters omitted AND the subject carries a country-code
 * TLD. What differs is the ADVICE, and only on `chat_gpt`, where "pass the locale for that
 * country" would be advice the vendor refuses — DataForSEO has ChatGPT data for the United States
 * in English and for nothing else, so the honest next step is the other platform, not another
 * locale. On `google` the shared sentence is used verbatim, with the parameter NAMES this family
 * actually takes substituted in (it takes a location name, not a location code).
 *
 * `domains` is what the lookup RESOLVED to — a comparison passes all of its domain targets, and
 * the first country-code TLD among them is the one worth naming. A keyword subject passes none:
 * there is no TLD to argue from, and a phrase carries no country.
 */
export function aiVisibilityLocaleWarning(
  scope: MeasurementScope,
  domains: readonly string[],
): string {
  if (namedALocale(scope)) return "";
  const subject = domains.find((domain) => twoLetterTld(domain) !== null);
  if (subject === undefined) return "";
  if (scope.platform_requested === "chat_gpt") {
    return (
      `This lookup used DataForSEO's default locale — the United States (location_code ` +
      `${LLM_MENTIONS_DEFAULT_LOCATION_CODE}), in English — and ${subject} is a ` +
      `.${twoLetterTld(subject) ?? ""} domain, a two-letter country-code TLD. On platform ` +
      '"chat_gpt" that is not something to change: ' +
      `${CHAT_GPT_LOCALE_QUOTE}, so there is no other locale to ask for and passing one is ` +
      'refused. Platform "google" is the one DataForSEO publishes other locations for, and it is ' +
      "the question to ask if this site targets that country."
    );
  }
  return defaultLocaleWarning(
    subject,
    {
      language_code: LLM_MENTIONS_DEFAULT_LANGUAGE_CODE,
      location_code: LLM_MENTIONS_DEFAULT_LOCATION_CODE,
    },
    { language: "language_code", location: "location_name", noun: "value" },
  );
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
    `Where and in what language: ` +
    `${localeClause("location_name", scope.location_name, `location_code ${LLM_MENTIONS_DEFAULT_LOCATION_CODE}, the United States`)}, ` +
    `${localeClause("language_code", scope.language_code, `"${LLM_MENTIONS_DEFAULT_LANGUAGE_CODE}", English`)}.\n` +
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
