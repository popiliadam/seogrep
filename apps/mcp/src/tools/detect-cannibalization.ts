import { detectCannibalization, formatCannibalization } from "../gsc-data/index.ts";
import { makeDiscoveryTool, type DiscoveryToolDeps } from "./gsc-discovery-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * detect_cannibalization — 10 credits, SYNC. Reads the latest pull and finds queries where
 * two or more of the site's pages each pull a meaningful share of impressions — pages that
 * split the ranking signal and usually want consolidating or differentiating.
 */
const DESCRIPTION =
  "Detect keyword cannibalization from your latest Search Console pull: queries where two " +
  "or more of your pages meaningfully compete for the same query, grouped per query. " +
  "Costs 10 credits. Run pull_gsc_data first.";

export function makeDetectCannibalizationTool(deps: DiscoveryToolDeps = {}): RegisteredTool {
  return makeDiscoveryTool(
    "detect_cannibalization",
    DESCRIPTION,
    (pull) => formatCannibalization(detectCannibalization(pull)),
    deps,
  );
}

export const detectCannibalizationTool = makeDetectCannibalizationTool();
