/**
 * THE US/ENGLISH DEFAULT, SAID OUT LOUD — one warning, for every paid lookup that takes a domain
 * and a locale and defaults that locale to the United States in English.
 *
 * =====================================================================================
 * WHAT THIS CLASS COST, MEASURED
 * =====================================================================================
 * Four tools take a domain plus `language_code` / `location_code`, and all four default to
 * `en` / 2840. Exactly ONE of them — `ranked_keywords` — ever mentioned it, and the lesson it
 * carries in its own source ("the same 65 credits, twice, to discover a parameter the tool never
 * mentioned") was never inherited by its siblings. On 2026-09-03 the round measured the bill:
 *
 *   my_pages   two paid calls against two Turkish sites — one with a 5-page crawl, one with a
 *              100-page crawl — BOTH returned `vendor_total_count` 1 on the en/2840 default, and
 *              the only advice the answer gave was to advance `offset`, which does nothing when
 *              the vendor says the whole set is one row. 2 x 40 credits, no sentence.
 *   keyword_gap  the locale is not derived from a resolved project either: a Turkish project's
 *              gap is measured in the United States, in English, unless the caller overrides it.
 *   discover_keywords  `for_site` takes a target and shares the same two defaults. NOT MEASURED
 *              this round — the paid ceiling was spent on other modes — so it is treated as the
 *              same shape, and nothing here claims it was observed.
 *
 * =====================================================================================
 * WHAT THIS MODULE WILL NOT DO
 * =====================================================================================
 * IT DOES NOT CHANGE A DEFAULT. Which locale a paid lookup runs in is a behaviour-and-price
 * decision with an operator's name on it, and a silently better default is still a default nobody
 * signed. This is a SENTENCE.
 *
 * IT DOES NOT GUESS A LOCATION CODE. Exactly two codes have ever been measured on this stack (US
 * 2840, TR 2792) — a pair of data points, not a table — and a guessed code does not fail loudly:
 * it returns another country's data, which reads as perfectly ordinary. So the warning names the
 * TLD and hands the caller the two parameters, and stops there. That rule is inherited verbatim
 * from `ranked_keywords`, along with {@link GENERIC_TWO_LETTER_TLDS}.
 *
 * IT IS ONE SENTENCE, NOT FOUR. Four tools telling one domain owner four different things about
 * the same mistake is the defect the round found in its own record; the surfaces differ in WHEN
 * they ask (see below), never in what they say.
 *
 * =====================================================================================
 * WHEN EACH SURFACE ASKS
 * =====================================================================================
 * `ranked_keywords` keeps its own trigger — a THIN result on the defaults — because that is what
 * its specs pin and it says more than this warning does (it leads with "Few results."). The three
 * surfaces added here have no comparable thinness signal that means the same thing, so they ask
 * the question this module can answer honestly: the caller is on the defaults AND the subject
 * carries a country-code TLD. On a `.com` they stay silent — a `.com` is evidence of nothing.
 */

/**
 * Two-letter TLDs that IANA delegated to a country but whose registries sell them worldwide with
 * no local-presence requirement, and whose registrants are overwhelmingly not in that country.
 *
 * They break the two-letter test in the direction that MATTERS. Telling the owner of a `.io` SaaS
 * that their domain is "a two-letter country-code TLD" and that they should pass the location code
 * for "that country" is advice about the British Indian Ocean Territory — a wrong claim stated in
 * the confident voice the rest of the warning earns, and stated exactly when the result was thin
 * and the reader is most inclined to act on it.
 *
 * The list is short and deliberately errs toward EXCLUDING: a genuinely Colombian `.co` site loses
 * the sentence rather than being handed a false one. Dropping a true clue costs a sentence;
 * keeping a false one costs the reader a paid lookup pointed at the wrong country.
 */
export const GENERIC_TWO_LETTER_TLDS: ReadonlySet<string> = new Set([
  "io",
  "ai",
  "co",
  "me",
  "tv",
  "cc",
  "fm",
  "gg",
  "ly",
  "sh",
  "to",
]);

/**
 * The domain's TLD when it is two letters AND is not one of the generically-marketed ones above,
 * otherwise null.
 *
 * Two letters is otherwise the whole test, and it is the whole claim: IANA delegates country-code
 * TLDs as two-letter labels. What this deliberately does NOT do is map that label to a DataForSEO
 * location_code — see the module header.
 */
export function twoLetterTld(domain: string): string | null {
  const tld = domain.slice(domain.lastIndexOf(".") + 1).toLowerCase();
  if (!/^[a-z]{2}$/.test(tld)) return null;
  return GENERIC_TWO_LETTER_TLDS.has(tld) ? null : tld;
}

/** The locale a caller is on when they passed neither parameter. Each tool owns its own schema
 * default; these are the values this warning's wording describes, and every caller compares its
 * own resolved input against them before asking for the sentence. */
export const DEFAULT_LOCATION_CODE = 2840;
export const DEFAULT_LANGUAGE_CODE = "en";

/** Whether a resolved request is still sitting on BOTH defaults — the only case worth warning on. */
export function onDefaultLocale(input: {
  readonly language_code: string;
  readonly location_code: number;
}): boolean {
  return (
    input.location_code === DEFAULT_LOCATION_CODE && input.language_code === DEFAULT_LANGUAGE_CODE
  );
}

/**
 * The warning, or `""` when it does not apply — the caller chose a locale, or the subject carries
 * no country-code TLD to argue from.
 *
 * `target` is the domain the lookup RESOLVED to, not the caller's raw argument: on a project-scoped
 * call the caller never typed a domain at all, which is exactly the case where a US default is
 * least likely to have been a decision.
 */
export function defaultLocaleWarning(
  target: string,
  input: { readonly language_code: string; readonly location_code: number },
  parameters: LocaleParameterNames = DEFAULT_LOCALE_PARAMETER_NAMES,
): string {
  if (!onDefaultLocale(input)) return "";
  const countryCode = twoLetterTld(target);
  if (countryCode === null) return "";
  return (
    `This lookup used the DEFAULT locale — the United States, in English — but ${target} is a ` +
    `.${countryCode} domain, a two-letter country-code TLD. If the site targets that country, ` +
    `pass ${parameters.language} and ${parameters.location} for it and run this again: a lookup ` +
    "measured under the wrong locale can come back nearly empty, or full of another country's " +
    `data, and neither looks wrong on the page. SeoGrep does not guess which ${parameters.noun} ` +
    "belongs to a TLD, so it is not naming one here."
  );
}

/**
 * What the two locale parameters are CALLED on the calling surface, and what one of them IS.
 *
 * The four original callers all take `language_code` + `location_code`, which is why the sentence
 * could name them outright. The LLM Mentions family takes a location NAME instead, so a warning
 * that told its caller to "pass location_code" would be advice about a parameter that tool does
 * not accept — a wrong instruction in the confident voice the rest of the sentence earns.
 *
 * The defaults keep the original wording BYTE-IDENTICAL, so the four surfaces that never pass
 * this are untouched and their pins (which compare against this function's own output) still
 * measure the same string. This is a substitution, not a second wording: the module header's rule
 * that one mistake gets ONE sentence is what makes parameterising it the right move rather than
 * copying it.
 */
export interface LocaleParameterNames {
  /** The language parameter's name on the calling surface. */
  readonly language: string;
  /** The location parameter's name on the calling surface. */
  readonly location: string;
  /** What that location parameter holds, for "does not guess which ___ belongs to a TLD". */
  readonly noun: string;
}

/** The names the four original callers use — the wording this sentence was written for. */
export const DEFAULT_LOCALE_PARAMETER_NAMES: LocaleParameterNames = {
  language: "language_code",
  location: "location_code",
  noun: "code",
};
