/**
 * WHAT A SEARCH VOLUME IS — one sentence, on every surface that prints one (R-8.9).
 *
 * =====================================================================================
 * WHY THIS IS ONE CONSTANT AND NOT FOUR SENTENCES
 * =====================================================================================
 * Four tools print the SAME vendor field — `keyword_info.search_volume` — and, before this file,
 * none of them said what it is. Measured 2026-09-03 across all four records of the tool round:
 * `grep -rniE "12.month|rounded|close variant|exact match"` over `research-keywords.ts`,
 * `discover-keywords.ts`, `keyword-gap.ts`, `ranked-keywords.ts`, their DataForSEO adapters and
 * their four docs pages returned ZERO matches. The reader was shown `volume 8,100` with nothing
 * beside it, and `average monthly Google searches` in the docs — which states the average and
 * states neither the rounding nor the close-variant pool.
 *
 * The four sentences could have been written four times. They must not be: the same number
 * explained four ways is how two tools end up printing one figure with two different degrees of
 * honesty, and the round that measured this found the divergence already beginning (three of the
 * four surfaces said "average monthly Google searches", the fourth said nothing at all). The
 * precedent is {@link AVERAGE_POSITION_NOTE} in `gsc-data/format.ts`, which holds the same line
 * for the two tools that print a GSC position.
 *
 * =====================================================================================
 * WHAT THE SENTENCE MAY CLAIM
 * =====================================================================================
 * Only what Google publishes about the figure (support.google.com/google-ads/answer/3022575,
 * read 2026-09-02 — reference R-8.9):
 *
 *   1. it is an average over TWELVE MONTHS, not a count for the month just gone;
 *   2. it covers the keyword AND ITS CLOSE VARIANTS, so it is not an exact-match count;
 *   3. it is ROUNDED by Google — which is why totals across rows or locations do not add up.
 *
 * It does NOT say by how much a figure is rounded, which bucket edges Google uses, or how wide a
 * "close variant" pool is: Google publishes none of those, and a number invented here would be
 * exactly the defect this note exists to remove (NEVER #7). It also does not tell the reader the
 * figure is unreliable — it is the vendor's own figure, passed through unmodified, and the note
 * changes no number.
 *
 * =====================================================================================
 * WHY IT MATTERS ON THE ORDERING, NOT JUST ON THE ROW
 * =====================================================================================
 * The rounding is not cosmetic where a list is SORTED by this field. Measured live 2026-09-03 on
 * `discover_keywords` (`ideas`, tr/2792): 100 rows carried FOUR distinct volumes — 90,500 ×18,
 * 74,000 ×21, 60,500 ×24, 49,500 ×37 — so "highest first" separated 4 rows of 100 and the order
 * inside each band was the vendor's arbitrary one. A reader who prioritises down such a list is
 * reading a ranking into a tie. {@link SEARCH_VOLUME_BAND_NOTE} says that, and is printed only by
 * the surfaces that actually order rows by this field.
 *
 * Pure and dependency-free, and it costs nothing: no vendor call, no credit, no price. It lives
 * beside `flat-zero.ts` and `quantities.ts` for the reason those modules state about themselves —
 * every consumer is an MCP tool renderer, and putting a formatter behind `packages/core`'s built
 * `dist/` would hide a source change from the MCP test lane until a rebuild.
 */

/**
 * The R-8.9 disclosure, in full. Printed once per answer by every tool that prints a volume.
 *
 * Any tool that prints `keyword_info.search_volume` prints THIS — not a paraphrase of it. The
 * four tool test files each pin the whole string plus a distinctive fragment, so emptying or
 * rewording this constant turns four suites red rather than silently changing what four products
 * tell a paying customer.
 */
export const SEARCH_VOLUME_NOTE =
  "About these search volumes: they are Google Keyword Planner figures, passed through from " +
  "DataForSEO unchanged. Each one is a 12-MONTH AVERAGE for the keyword AND ITS CLOSE VARIANTS, " +
  "and Google ROUNDS it — so a volume here is not a count of exact-match searches in the month " +
  "just gone, two keywords can share a figure only because both were rounded onto it, and " +
  "volumes added up across rows or across locations will not come out exact.";

/**
 * The extra half for a surface that ORDERS its rows by this field.
 *
 * Separate from {@link SEARCH_VOLUME_NOTE} because it is a claim about the LIST, not about the
 * number: a tool that prints volumes without sorting by them (research_keywords answers in the
 * caller's own keyword order) would be telling the reader something untrue about its own output.
 */
export const SEARCH_VOLUME_BAND_NOTE =
  "Because the figures are rounded, many rows land on the SAME volume: sorting by it groups the " +
  "list into bands rather than ranking it, and the order of rows sharing one figure carries no " +
  "meaning — do not read a row above another as the stronger keyword when both print the same " +
  "volume.";

/**
 * The one-clause version for a tool `description` — the terse tools/list surface an LLM reads
 * before it decides what a returned number means.
 *
 * A description is budgeted (it also becomes the docs page's meta description, truncated at
 * `FRONTMATTER_DESCRIPTION_MAX`), so the full note does not belong there; what does belong is the
 * part that changes how the figure is USED. Derived from the same three published facts.
 */
export const SEARCH_VOLUME_DESCRIPTION_CLAUSE =
  "Search volumes are Google Keyword Planner figures: a rounded 12-month average covering the " +
  "keyword and its close variants, so they do not sum exactly.";
