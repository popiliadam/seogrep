import { getServiceClient } from "../db.ts";
import { getLatestSucceededPull } from "../queue/boss.ts";
import { parsePullResult, type PullData } from "./types.ts";

/**
 * Shared input port for the three discovery tools (find_quick_wins / detect_cannibalization
 * / analyze_content_decay): load the most recent SUCCEEDED pull for a project (tenant-scoped)
 * and hand back a ready-to-analyze PullData. All three read the same pull, so this is the ONE
 * place that resolves + defensively parses it — mirroring the audit slice's loadLatestCrawl.
 */

export type PullLoad =
  | { readonly ok: true; readonly pull: PullData }
  | { readonly ok: false; readonly error: string };

/** The action-suggesting message a discovery tool gives when there is no pull to analyze. */
export const NO_PULL_MESSAGE =
  "No Search Console data found for this project. Run pull_gsc_data first.";

export type LoadPullFn = (userId: string, projectId: string) => Promise<PullLoad>;

/**
 * Resolve the latest pull for (userId, projectId). A missing project, another tenant's
 * project, or a project never pulled all resolve to the same NO_PULL_MESSAGE — no
 * cross-tenant existence leak, and the message tells the caller exactly what to do next. A
 * stored result that will not parse is treated the same way. NOTE: a pull whose windows are
 * genuinely EMPTY (a property with no data) still loads ok — the analysis then reports "no
 * findings" over real, delivered data rather than pointing back at pull_gsc_data.
 */
export async function loadLatestPull(userId: string, projectId: string): Promise<PullLoad> {
  const latest = await getLatestSucceededPull(getServiceClient(), projectId, userId);
  if (!latest) return { ok: false, error: NO_PULL_MESSAGE };
  const pull = parsePullResult(latest.result);
  if (!pull) return { ok: false, error: NO_PULL_MESSAGE };
  return { ok: true, pull };
}
