import { findQuickWinsResult, formatQuickWins } from "../gsc-data/index.ts";
import { makeDiscoveryTool, type DiscoveryToolDeps } from "./gsc-discovery-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * find_quick_wins — 10 credits, SYNC. Reads the latest pull and surfaces the "almost there"
 * queries: (query, page) pairs ranking in positions 8–20 with real impressions, where a
 * small push can convert existing demand into clicks. Prioritized, biggest opportunity first.
 */
const DESCRIPTION =
  "Find quick-win keyword opportunities from your latest Search Console pull: queries " +
  "ranking in positions 8–20 with enough impressions to be worth a push, prioritized. " +
  "Costs 10 credits. Run pull_gsc_data first.";

export function makeFindQuickWinsTool(deps: DiscoveryToolDeps = {}): RegisteredTool {
  return makeDiscoveryTool(
    "find_quick_wins",
    DESCRIPTION,
    (pull) => {
      // The PRE-CAP total travels with the shortlist, so a site with more opportunities than the
      // cap is told how many were left out instead of reading the top 50 as the whole answer.
      const { wins, total } = findQuickWinsResult(pull);
      return formatQuickWins(wins, total);
    },
    deps,
  );
}

export const findQuickWinsTool = makeFindQuickWinsTool();
