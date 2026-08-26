/**
 * DataForSEO location NAMES — the vendor spells them its own way, and a name it does not know is
 * not a soft failure: the SERP task comes back `40501 Invalid Field: 'location_name'` AFTER the
 * search has been paid for. Measured 2026-08-25: `track_keywords` accepted `location_name:
 * "Türkiye"` — the form a Turkish customer types — and the paid `serp_snapshot` that followed cost
 * 13 credits and $0.03 for zero data. `z.string().min(1)` standing in for a structural check is
 * signed lesson 6 exactly.
 *
 * =====================================================================================
 * WHY THIS IS NOT AN ALLOWLIST OF EVERY VENDOR LOCATION
 * =====================================================================================
 * The obvious fix — "check the name against the vendor's list" — has no honest implementation
 * here, and the two ways to fake one are both worse than the bug:
 *
 *   FETCHING THE LIST AT REGISTRATION. `track_keywords` is 0 credits and its own answer promises
 *     "No search engine was contacted, no position was read, and nothing was charged". A network
 *     round trip on every registration breaks that promise, adds vendor latency to a tool that has
 *     none today, and puts a third-party outage between a customer and a free write. Refused.
 *
 *   BUNDLING A HAND-WRITTEN LIST OF ~250 COUNTRY NAMES. This repo has MEASURED exactly two
 *     DataForSEO locations (US 2840, TR 2792 — see tools/ranked-keywords.ts, which says the same
 *     thing about location CODES). Typing out the other ~248 from memory would be inventing vendor
 *     strings (NEVER #9), and the failure mode is the one that does not announce itself: one
 *     misremembered spelling turns into a REFUSAL of a name the vendor would have accepted, and
 *     the customer is now blocked on a location that used to work. A wrong allowlist is worse than
 *     no allowlist, because a wrong allowlist is trusted.
 *
 * SO THIS IS A KNOWN-WRONG TABLE, NOT A KNOWN-RIGHT ONE. It refuses a name only when it can name
 * the replacement, and it lets every unrecognised name through exactly as before. That direction
 * is deliberate: a false refusal costs a customer a location they could have measured, while a
 * miss costs them what they already pay today. The hole is real and stated — a location name that
 * is wrong in a way nobody has measured still reaches the paid call.
 *
 * HOW IT STAYS CORRECT AS THE VENDOR'S LIST CHANGES. There is nothing here to go stale in the way
 * a mirrored list goes stale. Two of the three rules are structural and independent of the list
 * ({@link checkLocationName}: a blank name, and a blank segment between commas, are invalid under
 * ANY list). The third is a table of pairs that only ever GROWS, and only when a real failure has
 * been measured — every row carries the measurement it came from. If the vendor renames a country
 * again, the old name keeps working until somebody measures that it does not, which is the same
 * position this product is in today; nothing regresses in the meantime.
 */

/**
 * One vendor location name this repo has MEASURED, with the spellings measured to be wrong for it.
 *
 * `alsoTyped` holds only forms that differ from the canonical by more than accents and case —
 * those two are handled generically by {@link foldKey}, so `Türkiye`, `TÜRKIYE` and `turkiye` need
 * no rows of their own and cannot fall out of step with the canonical they point at.
 */
export interface KnownLocation {
  readonly canonical: string;
  readonly alsoTyped: readonly string[];
  /** Where the canonical spelling was read from. Prose, for the next person to extend this. */
  readonly measured: string;
}

/**
 * The measured names. TWO of them, which is the honest size of this table — see the header on why
 * it is not 250. Adding a row is cheap and requires one thing: having actually asked the vendor.
 */
export const KNOWN_LOCATIONS: readonly KnownLocation[] = [
  {
    canonical: "United States",
    alsoTyped: [],
    measured:
      "The default this product has sent on every live SERP call since DFS_LIVE was opened " +
      "(2026-08-07); location_code 2840.",
  },
  {
    canonical: "Turkiye",
    // "Turkey" is the pre-2022 English name and is NOT what the vendor's country row is called —
    // measured, not assumed: serp_locations(TR, Country) returns exactly one row and it is
    // "Turkiye". It is the spelling every English-language source still prints, so it is the one a
    // customer reaches for after the accented form is refused.
    alsoTyped: ["Turkey"],
    measured: "serp_locations(country_code TR, location_type Country), 2026-08-25; code 2792.",
  },
];

/**
 * A comparison key that ignores the two things a customer gets wrong without being wrong about
 * WHICH PLACE they mean: accents and case. `Türkiye`, `TÜRKİYE` and `turkiye` all fold to the same
 * key as `Turkiye`, so one canonical row covers every casing and every accented variant of it.
 *
 * Decompose, strip the combining marks, then lower-case. Anything that is not an ASCII letter or
 * digit is dropped, which also folds spacing and punctuation differences.
 *
 * ON THE ORDER, corrected 2026-08-25 after a referee measured it: an earlier version of this
 * comment claimed decompose-before-lower-case was load-bearing for `İ` — that lower-casing first
 * would strand its dot. It is NOT. `"İ".toLowerCase()` yields `i` plus U+0307 COMBINING DOT ABOVE,
 * which is a `\p{M}` and is removed by the very next step whichever order runs first. The referee
 * ran it: swapping the two produced an EQUIVALENT MUTANT, green on all 15 cases. The order is kept
 * because decompose-first is the conventional Unicode folding sequence and is robust to marks that
 * case-folding does NOT produce — not because `İ` needs it. A rationale nobody measured is how a
 * comment starts drifting from the code it explains.
 */
export function foldKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** foldKey -> the vendor's own spelling, built from every canonical and every measured variant. */
const CANONICAL_BY_KEY: ReadonlyMap<string, string> = new Map(
  KNOWN_LOCATIONS.flatMap((known) =>
    [known.canonical, ...known.alsoTyped].map(
      (spelling) => [foldKey(spelling), known.canonical] as const,
    ),
  ),
);

/** Why a location name was refused. Only `unknown-spelling` can name a replacement. */
export type LocationRefusalReason = "empty" | "blank-segment" | "unknown-spelling";

export interface LocationRefusal {
  /** Exactly what the caller typed, so the message can quote it back. */
  readonly typed: string;
  readonly reason: LocationRefusalReason;
  /** The name to use instead, or null when this refusal cannot name one. */
  readonly suggestion: string | null;
}

/**
 * Refuse a location name the vendor will reject, or return null to let it through.
 *
 * The country is the LAST comma-separated segment — the vendor names a place from the inside out
 * (`London,England,United Kingdom`), so checking that segment covers a city, a region and a bare
 * country with one rule, and a corrected country is put back into the caller's own hierarchy
 * rather than replacing it.
 *
 * Three refusals, and the first two hold under ANY vendor list: a name that is blank once trimmed
 * names no place at all, and an empty segment between commas (`Istanbul,,Turkiye`) is not a
 * hierarchy the vendor publishes. The third is the measured table.
 */
export function checkLocationName(raw: string): LocationRefusal | null {
  const trimmed = raw.trim();
  if (trimmed === "") return { typed: raw, reason: "empty", suggestion: null };
  const segments = trimmed.split(",").map((segment) => segment.trim());
  if (segments.some((segment) => segment === "")) {
    return { typed: raw, reason: "blank-segment", suggestion: null };
  }
  const country = segments[segments.length - 1] ?? "";
  const canonical = CANONICAL_BY_KEY.get(foldKey(country));
  // Unknown to the table, or already spelled the vendor's way: nothing this can honestly refuse.
  if (canonical === undefined || canonical === country) return null;
  return {
    typed: raw,
    reason: "unknown-spelling",
    suggestion: [...segments.slice(0, -1), canonical].join(","),
  };
}

/**
 * The refusal, in the caller's language. It names the replacement wherever there is one, because a
 * refusal that only says "invalid" hands the customer back the same guessing game that cost them
 * 13 credits — and the name it offers is one this function's own table vouches for, so pasting it
 * back is a fix rather than another guess.
 *
 * The sentence about WHEN this was refused is not decoration. The whole point of moving the check
 * to registration is that the customer finds out before the money is spent, and the answer has to
 * say so or the improvement is invisible.
 */
export function locationRefusalMessage(refusal: LocationRefusal): string {
  if (refusal.reason === "empty") {
    return (
      "location_name was blank. Name the place the search is measured in, spelled the way " +
      `DataForSEO spells it — for example "${KNOWN_LOCATIONS[0]?.canonical}".`
    );
  }
  if (refusal.reason === "blank-segment") {
    return (
      `"${refusal.typed}" has an empty part between its commas. DataForSEO names a place from ` +
      'the inside out — "Istanbul,Turkiye" — with no gaps.'
    );
  }
  return (
    `DataForSEO does not know a location called "${refusal.typed}". Its own name for that place ` +
    `is "${refusal.suggestion}" — pass that instead. The vendor matches this name exactly, so an ` +
    "accented or renamed spelling is rejected outright rather than corrected, and it is rejected " +
    "at the END of a paid search. This was refused before any search was run."
  );
}
