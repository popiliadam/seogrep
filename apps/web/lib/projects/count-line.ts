/**
 * The one sentence Overview says about projects.
 *
 * A pure function rather than JSX inside the page, for the reason signed lesson 12 states: the
 * page is a Server Component and vitest has no RSC boundary, so a spec that "rendered" it would
 * be more permissive than the runtime. Here the copy is executed by its own spec, and the page's
 * QUERY is pinned separately as source (app/app/overview-projects.test.ts).
 */

/**
 * `count` is the number of ACTIVE (non-archived) projects the caller tracks. A null count is
 * treated as none: PostgREST answers a head+count request with `count: null` only when it
 * returned no count at all, and inventing a number there would be worse than saying nothing.
 *
 * The singular is spelled out rather than "1 projects" — the sentence is read by every user on
 * their first day, when the count is exactly one.
 */
export function projectCountLine(count: number | null): string {
  if (count === null || count <= 0) {
    return "No projects yet.";
  }
  return count === 1 ? "You are tracking 1 project." : `You are tracking ${count} projects.`;
}
