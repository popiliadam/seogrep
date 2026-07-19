import { findQuickWins, formatQuickWins } from "../gsc-data/index.ts";
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
    (pull) => formatQuickWins(findQuickWins(pull)),
    deps,
  );
}

export const findQuickWinsTool = makeFindQuickWinsTool();
