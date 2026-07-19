import type { GscRow, PullData } from "./types.ts";

/**
 * analyze_content_decay — pages that are losing clicks. Comparing the current window with
 * the previous one of equal length, a page whose clicks fell by a meaningful amount AND a
 * meaningful proportion is decaying: a refresh, re-optimization, or internal-link boost is
 * usually warranted before the slide continues. Pure over BOTH windows.
 *
 * A page is flagged only when it clears BOTH thresholds, so noise and tiny pages do not
 * crowd the list:
 *   - absolute drop >= 5 clicks (the loss is real, not a one-or-two-click wobble), AND
 *   - relative drop >= 30% of its previous clicks (a proportional slide, not normal churn).
 * A page with zero previous clicks cannot "decay" (there is no baseline), so it is skipped.
 *
 * Results are ordered by clicks lost desc — the biggest bleed first.
 */

/** Minimum absolute click loss (previous - current) to flag a page. */
export const DECAY_MIN_ABS_DROP = 5;
/** Minimum relative click loss (as a fraction of previous clicks) to flag a page. */
export const DECAY_MIN_DROP_RATIO = 0.3;

/** A decaying page: its clicks in each window, the loss, and the loss as a fraction. */
export interface PageDecay {
  readonly page: string;
  readonly previous_clicks: number;
  readonly current_clicks: number;
  readonly clicks_lost: number;
  /** clicks_lost / previous_clicks, in (0, 1]. */
  readonly drop_ratio: number;
}

/** Sum clicks per page across a window's rows (a page appears once per query it ranks for). */
function clicksByPage(rows: readonly GscRow[]): Map<string, number> {
  const byPage = new Map<string, number>();
  for (const row of rows) {
    byPage.set(row.page, (byPage.get(row.page) ?? 0) + row.clicks);
  }
  return byPage;
}

/**
 * Return the decaying pages (cleared both the absolute and relative click-loss thresholds),
 * biggest loss first. Empty when nothing is decaying.
 */
export function analyzeContentDecay(pull: PullData): PageDecay[] {
  const currentClicks = clicksByPage(pull.current.rows);
  const previousClicks = clicksByPage(pull.previous.rows);

  const decays: PageDecay[] = [];
  for (const [page, previous] of previousClicks) {
    if (previous <= 0) continue; // no baseline -> cannot decay
    const current = currentClicks.get(page) ?? 0;
    const lost = previous - current;
    const ratio = lost / previous;
    if (lost >= DECAY_MIN_ABS_DROP && ratio >= DECAY_MIN_DROP_RATIO) {
      decays.push({
        page,
        previous_clicks: previous,
        current_clicks: current,
        clicks_lost: lost,
        drop_ratio: ratio,
      });
    }
  }
  return decays.sort((a, b) => b.clicks_lost - a.clicks_lost);
}
