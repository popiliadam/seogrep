import {
  analyzeContentDecay,
  contentDecayReport,
  formatContentDecay,
} from "../gsc-data/index.ts";
import { makeDiscoveryTool, type DiscoveryToolDeps } from "./gsc-discovery-shared.ts";
import type { RegisteredTool } from "./registry.ts";

/**
 * analyze_content_decay — 10 credits, SYNC. Compares the latest pull's two windows and flags
 * pages losing a meaningful amount AND proportion of their clicks — the pages most worth a
 * refresh or re-optimization before the slide continues.
 */
const DESCRIPTION =
  "Find decaying pages from your latest Search Console pull: pages whose clicks dropped " +
  "meaningfully (absolute and proportional) vs the previous window, biggest loss first. " +
  "Costs 10 credits. Run pull_gsc_data first.";

export function makeAnalyzeContentDecayTool(deps: DiscoveryToolDeps = {}): RegisteredTool {
  return makeDiscoveryTool(
    "analyze_content_decay",
    DESCRIPTION,
    // ONE engine call feeds both halves (migration 0025): the row stores the same decay list the
    // caller reads, ordered biggest-loss-first, so `top` is simply its first entry.
    (pull) => {
      const decays = analyzeContentDecay(pull);
      return { report: contentDecayReport(pull, decays), text: formatContentDecay(decays) };
    },
    deps,
  );
}

export const analyzeContentDecayTool = makeAnalyzeContentDecayTool();
