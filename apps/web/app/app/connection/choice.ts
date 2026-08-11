/**
 * The picker's choice codec — deliberately NOT in `property-picker.tsx`.
 *
 * ONE `<select>` has to carry TWO facts — which Google account, and which property on it —
 * because a user may connect several Google accounts and the same property string can appear
 * under more than one of them. The pair is joined by a SPACE: a uuid contains none, and
 * neither a url-prefix property nor an `sc-domain:` one may contain one either, so the split
 * is unambiguous where `:` (inside every domain property) or `/` (inside every url one) would
 * not be.
 *
 * WHY ITS OWN MODULE — this cost a production outage on 2026-08-11, so it is written down.
 * These two functions live on BOTH sides of the RSC boundary: `page.tsx` (a Server Component)
 * encodes the stored mapping and the suggestion, and `property-picker.tsx` (`"use client"`)
 * decodes what the user picked. While they lived in the client module, Next turned the server's
 * import into a client REFERENCE, and the first render threw:
 *
 *     Attempted to call encodeChoice() from the server but encodeChoice is on the client.
 *
 * Nothing caught it: `next build` accepts it (the failure is at render, not at compile),
 * and `page.test.tsx` mocks `./property-picker`, so under vitest — where no such boundary
 * exists — the call was an ordinary function call and every spec passed.
 *
 * A module with no `"use client"` and no `server-only` import can be imported from either
 * side, which is exactly what a value shared across the boundary needs. Keep it that way:
 * do not add a directive to this file, and do not move these back.
 */

export function encodeChoice(accountId: string, siteUrl: string): string {
  return `${accountId} ${siteUrl}`;
}

/** The inverse. Anything that is not a non-empty pair is refused rather than half-read. */
export function decodeChoice(value: string): { accountId: string; property: string } | null {
  const separator = value.indexOf(" ");
  if (separator <= 0) return null;
  const accountId = value.slice(0, separator);
  const property = value.slice(separator + 1);
  return property.length === 0 ? null : { accountId, property };
}
