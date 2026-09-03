import { documentOf } from "./document.ts";
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
 * "A page" means a DOCUMENT, in BOTH windows: rows differing only by #fragment are one page
 * (document.ts), because Google decides per window which section anchors of an article it shows
 * and an unfolded fragment row moves a stable article's clicks onto a different key.
 *
 * Results are ordered by clicks lost desc — the biggest bleed first.
 */

/** Minimum absolute click loss (previous - current) to flag a page. */
export const DECAY_MIN_ABS_DROP = 5;
/** Minimum relative click loss (as a fraction of previous clicks) to flag a page. */
export const DECAY_MIN_DROP_RATIO = 0.3;

/**
 * A decaying page: its clicks in each window, the loss, and the loss as a fraction — plus the two
 * numbers that say WHY it fell.
 *
 * IMPRESSIONS AND POSITION ARE PART OF THE FINDING, not decoration (B-2, measured live
 * 2026-09-03). Clicks alone cannot separate "I lost the ranking" from "I kept the ranking and lost
 * the click-through", and those two want opposite work: the first is a content/ranking problem,
 * the second is a SERP one — R-7.12 documents the shape, since AI Overview impressions sit INSIDE
 * these counts while their clicks do not. Both numbers were already on every row Google sent
 * (`rows.ts`) and were being discarded here.
 */
export interface PageDecay {
  readonly page: string;
  readonly previous_clicks: number;
  readonly current_clicks: number;
  readonly clicks_lost: number;
  /** clicks_lost / previous_clicks, in (0, 1]. */
  readonly drop_ratio: number;
  /** Impressions summed over the page's rows in each window (0 when it did not appear). */
  readonly previous_impressions: number;
  readonly current_impressions: number;
  /**
   * The IMPRESSION-WEIGHTED average position in each window, or null when the page had no
   * impressions there. Null rather than 0: 0 is the best rank there is and would read as "pinned
   * at the top" (fixtures.ts states the same caveat), and carrying the other window's number
   * forward would print a rank nobody measured.
   */
  readonly previous_position: number | null;
  readonly current_position: number | null;
}

/** What one window's rows add up to for one document. */
interface PageTotals {
  readonly clicks: number;
  readonly impressions: number;
  /** sum(position * impressions) — the numerator of the weighted average. */
  readonly weighted: number;
}

const EMPTY_TOTALS: PageTotals = { clicks: 0, impressions: 0, weighted: 0 };

/**
 * Total each DOCUMENT's clicks, impressions and impression-weighted position across a window's
 * rows — a page appears once per query it ranks for, and once more per #fragment Google drew a
 * jump-link to (document.ts documentOf).
 *
 * The fragment fold is not cosmetic here, it is the difference between a real finding and a
 * manufactured one. Google decides per window which of an article's section anchors it shows, so
 * a stable article's click mass can sit on the bare URL in one window and on `…#renkler` in the
 * next. Keyed by the raw page string those are two different pages, one of which "lost all its
 * clicks": the decay list then tells the user to rewrite an article whose traffic never moved,
 * which is the same phantom-decay failure the freshness-lag work removed from the other end
 * (M-20, pinned below). Keyed by the document, the mass never leaves the page it belongs to.
 *
 * The position is weighted by impressions rather than averaged per row, which is collapseFragments'
 * rule one level down: Google's own position is already an impression-weighted mean over
 * appearances, so a plain mean across a page's queries would report a different kind of number
 * from the one every other surface here prints.
 */
function totalsByPage(rows: readonly GscRow[]): Map<string, PageTotals> {
  const byPage = new Map<string, PageTotals>();
  for (const row of rows) {
    const page = documentOf(row.page);
    const at = byPage.get(page) ?? EMPTY_TOTALS;
    byPage.set(page, {
      clicks: at.clicks + row.clicks,
      impressions: at.impressions + row.impressions,
      weighted: at.weighted + row.position * row.impressions,
    });
  }
  return byPage;
}

/** The window's average position for one document, or null when it drew no impressions. */
function averagePosition(totals: PageTotals): number | null {
  return totals.impressions > 0 ? totals.weighted / totals.impressions : null;
}

/**
 * Return the decaying pages (cleared both the absolute and relative click-loss thresholds),
 * biggest loss first. Empty when nothing is decaying.
 */
export function analyzeContentDecay(pull: PullData): PageDecay[] {
  const currentTotals = totalsByPage(pull.current.rows);
  const previousTotals = totalsByPage(pull.previous.rows);

  const decays: PageDecay[] = [];
  for (const [page, before] of previousTotals) {
    if (before.clicks <= 0) continue; // no baseline -> cannot decay
    const after = currentTotals.get(page) ?? EMPTY_TOTALS;
    const lost = before.clicks - after.clicks;
    const ratio = lost / before.clicks;
    if (lost >= DECAY_MIN_ABS_DROP && ratio >= DECAY_MIN_DROP_RATIO) {
      decays.push({
        page,
        previous_clicks: before.clicks,
        current_clicks: after.clicks,
        clicks_lost: lost,
        drop_ratio: ratio,
        previous_impressions: before.impressions,
        current_impressions: after.impressions,
        previous_position: averagePosition(before),
        current_position: averagePosition(after),
      });
    }
  }
  return decays.sort((a, b) => b.clicks_lost - a.clicks_lost);
}
