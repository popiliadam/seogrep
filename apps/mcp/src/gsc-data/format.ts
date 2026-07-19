import type { CannibalGroup } from "./cannibalization.ts";
import type { PageDecay } from "./content-decay.ts";
import type { QuickWin } from "./quick-wins.ts";
import type { PullData } from "./types.ts";

/**
 * Render the GSC analysis results as the plain-text tool output. Kept out of the engines so
 * the pure analysis functions return data (unit-testable) and only these turn them into the
 * human-readable string the MCP client shows. Numbers are rounded for reading; the
 * underlying rows keep full precision.
 */

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function pos(position: number): string {
  return position.toFixed(1);
}

/** One-line summary of a completed pull (row counts + the two window ranges). */
export function formatPullSummary(pull: PullData): string {
  return (
    `Pulled ${pull.days} days of Search Console data.\n` +
    `Current window ${pull.current.start_date}..${pull.current.end_date}: ` +
    `${pull.current.rows.length} rows.\n` +
    `Previous window ${pull.previous.start_date}..${pull.previous.end_date}: ` +
    `${pull.previous.rows.length} rows.\n` +
    "Run find_quick_wins, detect_cannibalization, or analyze_content_decay next."
  );
}

/** Render the quick-win shortlist (or a friendly empty message). */
export function formatQuickWins(wins: readonly QuickWin[]): string {
  if (wins.length === 0) {
    return "No quick wins found: no query is ranking in positions 8–20 with enough impressions yet.";
  }
  const lines = wins.map(
    (w) =>
      `• "${w.query}" → ${w.page} — position ${pos(w.position)}, ` +
      `${w.impressions} impressions, ${w.clicks} clicks, CTR ${pct(w.ctr)}`,
  );
  return `${wins.length} quick win${wins.length === 1 ? "" : "s"} (position 8–20 with demand), best first:\n${lines.join("\n")}`;
}

/** Render the cannibalization groups (or a friendly empty message). */
export function formatCannibalization(groups: readonly CannibalGroup[]): string {
  if (groups.length === 0) {
    return "No cannibalization found: no query has two or more of your pages meaningfully competing for it.";
  }
  const blocks = groups.map((g) => {
    const pageLines = g.pages.map(
      (p) => `    - ${p.page} — position ${pos(p.position)}, ${p.impressions} impressions, ${p.clicks} clicks`,
    );
    return `• "${g.query}" — ${g.pages.length} competing pages, ${g.total_impressions} impressions total:\n${pageLines.join("\n")}`;
  });
  return `${groups.length} cannibalized quer${groups.length === 1 ? "y" : "ies"} (most impressions first):\n${blocks.join("\n")}`;
}

/** Render the decaying pages (or a friendly empty message). */
export function formatContentDecay(decays: readonly PageDecay[]): string {
  if (decays.length === 0) {
    return "No content decay found: no page lost a meaningful share of its clicks vs the previous window.";
  }
  const lines = decays.map(
    (d) =>
      `• ${d.page} — ${d.previous_clicks} → ${d.current_clicks} clicks ` +
      `(lost ${d.clicks_lost}, down ${pct(d.drop_ratio)})`,
  );
  return `${decays.length} decaying page${decays.length === 1 ? "" : "s"} (biggest loss first):\n${lines.join("\n")}`;
}
