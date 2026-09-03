/**
 * WHAT THE VENDOR SAID WAS ON THE PAGE — the one place DataForSEO's page-level `item_types` list
 * is put into words, shared by the tool that MEASURES a SERP (`serp_snapshot`) and the tool that
 * READS that measurement back (`keyword_positions`).
 *
 * ONE MODULE RATHER THAN TWO COPIES, AND IT IMPORTS NOTHING AT ALL. Both halves are load-bearing:
 *
 *   · Two copies would be two wordings, and "AI Overview" appearing on one surface but not the
 *     other is exactly the shape this closes: the list was parsed, stored, PAID FOR and printed
 *     nowhere in the product (finding S-1, inherited from `keyword_positions` F-5).
 *   · NO IMPORTS — not even `ORGANIC_ITEM_TYPE` from `../dfs/serp.ts`. `keyword-positions-format.ts`
 *     imports this module, and a VALUE edge into the port would drag `keyword_positions` into the
 *     vendor-spend import graph (`credits/paid-balance.graph.test.ts`), flagging a tool that
 *     cannot buy anything as a spender. `serp-snapshot-store.ts`'s header records the same rule
 *     from the other direction, which is why "organic" is written here as its own constant.
 *
 * =====================================================================================
 * NOTHING IS RECOGNISED, SO NOTHING CAN BE DROPPED FOR BEING UNRECOGNISED (R-8.5)
 * =====================================================================================
 * There is no allowlist and no enum here — and, measured 2026-09-03, none in the parser either:
 * `dfs/serp.ts:590` reads `item_types: z.array(z.string()).nullish()`, and the only type
 * comparison anywhere in the path is `item.type === "organic"` (`:646`), which filters ITEMS for
 * placement counting and never touches this page-level list. So the risk R-8.5 names — a type
 * such as `ai_overview_expanded_element`, `ai_overview_video_element` or
 * `ai_overview_table_element` being silently discarded because nobody added it — has no site to
 * happen at, in the parser OR here. Every name the vendor sends is printed under the vendor's own
 * identifier, and none is renamed: inventing friendlier words would be inventing a mapping onto a
 * taxonomy this product does not own (`ranked-keywords.ts`'s `renderSerpContext` says the same).
 *
 * The AI Overview FLAG is a family test rather than a membership test for that same reason. A
 * list of names would have to be edited every time DataForSEO ships another element type, and
 * until somebody did, this surface would answer "no AI Overview reported" over a page that
 * carried one — the renderer hiding a fact the vendor sent.
 */

/**
 * The one name that is ever removed from the list. Every reading these lines are printed beside
 * IS an organic measurement by construction (the port counts `type === "organic"` items and
 * nothing else), so echoing it back adds nothing; what remains is the interesting part.
 *
 * Written as a literal instead of imported for the vendor-spend-graph reason in the header above.
 */
export const ORGANIC_FEATURE = "organic";

/** The AI Overview family's root. Every element type in R-8.4/R-8.5 is this plus a suffix. */
export const AI_OVERVIEW_FEATURE = "ai_overview";

/**
 * How many feature names one line prints before it starts counting instead.
 *
 * Nothing in a vendor payload is bounded by anything this product controls (migration 0024's
 * rule, quoted by `serp-snapshot-store.ts`), and `keyword_positions` may print up to 200 readings
 * in one answer — so an uncapped list is an unbounded answer. Eight is enough to carry the
 * features anybody acts on; beyond it the count is stated, and a stated remainder is not a silent
 * drop, which is the distinction this whole finding turned on.
 */
export const MAX_NAMED_SERP_FEATURES = 8;

/**
 * R-5.5, in one sentence, printed wherever this product claims an AI Overview was on the page.
 *
 * The claim it qualifies is narrow and easy to over-read: "DataForSEO reported an AI Overview
 * block on this results page for this keyword". Google builds AI features by QUERY FAN-OUT — it
 * issues its own searches across sub-topics and draws on a wider, more varied set of pages than
 * the single keyword measured here — so nothing in a one-keyword SERP reading says whether a site
 * is cited INSIDE that block, and this note is what keeps the two apart.
 */
export const AI_FAN_OUT_NOTE =
  "An AI Overview reported above is the presence of the block on that results page for that " +
  "keyword, and nothing more. Google builds its AI features by query fan-out — it runs further " +
  "searches of its own across sub-topics and draws on a wider set of pages than the one keyword " +
  "measured here — so this reading does not say whether a site is cited inside the block, and a " +
  "single keyword does not represent a site's AI visibility.";

/**
 * Is this one of DataForSEO's AI Overview element types? The FAMILY, not a list of its members —
 * see the header. `ai_overview` itself and anything under `ai_overview_`; `ai_mode` and a name
 * that merely contains the words are not members.
 */
export function isAiOverviewType(type: string): boolean {
  return type === AI_OVERVIEW_FEATURE || type.startsWith(`${AI_OVERVIEW_FEATURE}_`);
}

/**
 * ONE page's features, said plainly: how many besides organic, their vendor identifiers up to the
 * cap, and — always, in both directions — whether an AI Overview was among them.
 *
 * The AI clause is computed over the WHOLE list, never over the slice that fitted the cap. A flag
 * derived from the capped names would reintroduce "measured, stored, and never read" one layer
 * further down, on precisely the pages richest enough to carry an AI Overview.
 */
export function renderSerpFeatures(itemTypes: readonly string[]): string {
  const features = itemTypes.filter((type) => type !== ORGANIC_FEATURE);
  const ai = features.filter(isAiOverviewType);
  const aiClause =
    ai.length === 0
      ? "No AI Overview reported on this page."
      : `AI Overview PRESENT (${ai.join(", ")}).`;
  if (features.length === 0) {
    return `SERP features besides organic: none reported. ${aiClause}`;
  }
  const named = features.slice(0, MAX_NAMED_SERP_FEATURES);
  // An AI type past the cap is appended rather than counted away: the clause above names it, so
  // the list must be able to as well. The remainder is then whatever neither half showed.
  const shown = [...named, ...ai.filter((type) => !named.includes(type))];
  const rest = features.length - shown.length;
  const tail = rest === 0 ? "" : ` and ${rest} other SERP feature${rest === 1 ? "" : "s"}`;
  return `SERP features besides organic: ${features.length} — ${shown.join(", ")}${tail}. ${aiClause}`;
}
