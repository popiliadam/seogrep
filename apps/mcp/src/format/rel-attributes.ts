/**
 * =====================================================================================
 * THE `rel` ATTRIBUTES ON ONE LINK — reference R-6.2, findings BD-3 / DC B-6 (2026-09-04)
 * =====================================================================================
 * Google's spam policies name three declarations a link can carry, and they are NOT
 * interchangeable:
 *   • `nofollow` — the original "do not count this link";
 *   • `sponsored` — a paid or advertising link, the one qualification Google's paid-link rule is
 *     written about;
 *   • `ugc`      — user-generated content: a forum signature, a comment, a profile page.
 * A link marked `sponsored` and a link marked `ugc` say two different things about how it was
 * placed, and R-6.2 is the rule that separates them.
 *
 * DataForSEO sends its own list of the values it saw, per link, in a field it calls `attributes`
 * (its published `backlink` item carries it beside `dofollow`). Until 2026-09-04 no parser in this
 * repo read it: a `rel="sponsored"` paid link and a plain `rel="nofollow"` link rendered as the
 * same word, in the two tools whose whole job is showing links one at a time — including the one
 * that decides which domain names go into a disavow file.
 *
 * WHAT THIS MODULE MAY DO: print the vendor's list under the vendor's own field name, in the order
 * it arrived. WHAT IT MAY NOT DO: rename a value, add one the vendor did not send, or turn the
 * vendor's silence into "this link carries no rel attribute". A link the vendor said nothing about
 * is a link nobody measured (signed lesson 12), so it renders exactly as it did before this file
 * existed — with no clause at all, rather than a manufactured "none".
 */

/** The vendor's own field name, printed so a reader can trace the words back to the response. */
export const REL_ATTRIBUTES_VENDOR_FIELD = "attributes";

/**
 * The three values R-6.2 names. Used ONLY to answer "did the vendor report a qualification on this
 * link", never to filter, reorder or score anything: the list a row prints is always the vendor's
 * whole list, including values (like `noopener`) that say nothing about link equity.
 */
export const QUALIFYING_REL_ATTRIBUTES: readonly string[] = ["nofollow", "sponsored", "ugc"];

/**
 * The clause for one link, or `null` when the vendor said nothing — in which case the caller
 * prints NO clause. Both an absent field and an empty list are silences here: DataForSEO documents
 * neither as "this link carries no rel attribute", and publishing that sentence out of a response
 * that did not make it is the mistake this whole family of renderers exists to avoid.
 */
export function relAttributesClause(attributes: readonly string[] | null): string | null {
  if (attributes === null || attributes.length === 0) return null;
  return `DataForSEO ${REL_ATTRIBUTES_VENDOR_FIELD}: ${attributes.join(", ")}`;
}

/** Whether the vendor reported one of the three R-6.2 values on this link. */
export function hasQualifyingRelAttribute(attributes: readonly string[] | null): boolean {
  return (attributes ?? []).some((value) => QUALIFYING_REL_ATTRIBUTES.includes(value));
}

/**
 * WHAT THOSE WORDS MEAN, printed once per answer that shows any of them. Without it the reader is
 * handed vendor jargon — `ugc`, `sponsored` — beside a follow status, with nothing saying that
 * Google reads them as three different declarations. It states Google's rule and stops: whether a
 * given sponsored link is a problem is not something SeoGrep measured.
 */
export const REL_ATTRIBUTES_NOTE =
  "`attributes` above is DataForSEO's own list of the rel values it saw on a link. Google's spam " +
  "policies treat three of them as a declaration that the link should not be counted for " +
  "ranking: nofollow, sponsored (paid or advertising links) and ugc (user-generated content, such " +
  "as forum posts and comments). The list is printed exactly as the vendor sent it, and SeoGrep " +
  "adds no judgement of its own; a link with no list is a link DataForSEO reported nothing about.";
