import {
  analyzeContentDecay,
  contentDecayReport,
  formatContentDecay,
  renderUpdateOverlap,
  type PullData,
} from "../gsc-data/index.ts";
import {
  makeDiscoveryTool,
  type DiscoveryRendering,
  type DiscoveryToolDeps,
} from "./gsc-discovery-shared.ts";
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

/**
 * The tool's own render, exported so a spec can drive THE REAL ONE (find_quick_wins' rule): a spec
 * that rebuilds this expression from its parts pins its own arithmetic, and the tool could change
 * renderers under it without a red line.
 *
 * ONE engine call feeds both halves (migration 0025): the row stores the same decay list the
 * caller reads, ordered biggest-loss-first, so `top` is simply its first entry.
 *
 * THE UPDATE NOTE GOES FIRST, ABOVE THE LIST (B-1). It qualifies the whole answer — if a published
 * core update landed inside the period being compared, "these ten pages are decaying" may be one
 * event rather than ten content problems — and a caveat printed under thirty "rewrite this page"
 * lines has already lost that argument. The period is the previous window's START through the
 * current window's END, because a baseline reshaped by an update distorts every loss measured
 * against it just as much as a shift inside the current window does.
 *
 * It is NOT part of the stored report: the report holds the measurement, and which updates a date
 * range spans is derivable from the window it already carries.
 */
export function renderContentDecay(pull: PullData): DiscoveryRendering {
  const decays = analyzeContentDecay(pull);
  const overlap = renderUpdateOverlap(pull.previous.start_date, pull.current.end_date);
  const findings = formatContentDecay(decays);
  return {
    report: contentDecayReport(pull, decays),
    text: overlap === null ? findings : `${overlap}\n\n${findings}`,
  };
}

export function makeAnalyzeContentDecayTool(deps: DiscoveryToolDeps = {}): RegisteredTool {
  return makeDiscoveryTool("analyze_content_decay", DESCRIPTION, renderContentDecay, deps);
}

export const analyzeContentDecayTool = makeAnalyzeContentDecayTool();
