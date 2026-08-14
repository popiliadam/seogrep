"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";

/**
 * What the user has typed, read by every group below the box. The default is the empty string,
 * so a group rendered OUTSIDE this island (as each is in its own spec file) filters nothing —
 * the absence of a provider is not a filter that hides everything.
 */
const QueryContext = createContext("");

/** The current search text, for a group that filters its own rows through {@link matchesQuery}. */
export function useConnectionQuery(): string {
  return useContext(QueryContext);
}

/**
 * THE SEARCH BOX, ABOVE ALL THREE GROUPS — the design's "başta arama kutusu" (spec §3), which
 * the implementation plan never carried into a task.
 *
 * IT FILTERS ALL THREE GROUPS, not the library alone, and that is the whole point of its
 * position. The question a search answers here is "where is that site, and what does it read?",
 * and the user asking it does not know which group holds the answer — tracked, still free, or
 * archived. A box that filtered only the library would answer it for one third of the page and
 * silently ignore the other two.
 *
 * It also has to reach PAST the library's fold: on the default page every property is folded
 * away, so a box living inside the library would be hidden by the very collapse it exists to
 * make bearable.
 *
 * A React context rather than a prop drilled through the page: the three groups are rendered by
 * a Server Component and handed here as children, so there is no client-side call site to pass
 * a prop from. Context reaches them because each group is itself a client component — server
 * children in between change nothing.
 *
 * NO STATUS FILTER. The design named one beside the search box, and the three groups now ARE
 * the status split (tracked · free · archived), so a control that re-filtered the page by the
 * same axis its layout already expresses would be a second way to say one thing. Not built
 * rather than built unused; if a group ever grows sub-states worth filtering, this is where it
 * would go.
 */
export function ConnectionFilter({ children }: { readonly children: ReactNode }) {
  const [query, setQuery] = useState("");
  const inputId = useId();

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-xs text-muted">
        Find a site or property
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by domain or Search Console property"
        className="border border-hairline px-3 py-2 text-sm"
      />
      <QueryContext.Provider value={query}>{children}</QueryContext.Provider>
    </div>
  );
}
