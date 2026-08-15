import type { CannibalGroup } from "./cannibalization.ts";
import type { PageDecay } from "./content-decay.ts";
import { MAX_ROW_LIMIT } from "./pull.ts";
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

/** Thousands-separate an integer for prose (15000 → "15,000") without depending on ICU. */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * One-line summary of a completed pull (row counts + the two window ranges).
 *
 * The cap sentence DERIVES its number from MAX_ROW_LIMIT rather than spelling one out. The
 * literal it replaces (`5,000`) is what the ceiling used to be, and prose is exactly where a
 * changed constant goes unnoticed — nothing compiles against a sentence. A wrong number here is
 * worse than none: it tells the user how much data they are missing, and they have no way to
 * check it.
 */
export function formatPullSummary(pull: PullData): string {
  const capWarning = pull.current.capped || pull.previous.capped
    ? `Note: this window hit the ${grouped(MAX_ROW_LIMIT)}-row cap — results cover the top rows only; comparisons may be partial.\n`
    : "";
  return (
    `Pulled ${pull.days} days of Search Console data.\n` +
    `Current window ${pull.current.start_date}..${pull.current.end_date}: ` +
    `${pull.current.rows.length} rows.\n` +
    `Previous window ${pull.previous.start_date}..${pull.previous.end_date}: ` +
    `${pull.previous.rows.length} rows.\n` +
    capWarning +
    "Run find_quick_wins, detect_cannibalization, or analyze_content_decay next."
  );
}

/**
 * The window line every discovery tool prints under its findings.
 *
 * The three engines apply ABSOLUTE thresholds — >= 20 impressions for a quick win, >= 10 for a
 * cannibalization competitor, >= 5 lost clicks for decay — and an absolute threshold means a
 * different thing over 7 days than over 90. Over the shortest window the tool accepts, a 20-
 * impression floor is roughly 13x the bar it is over the longest one. Nothing in the analysis
 * output said which of those the reader was holding: the pull's date was there, its LENGTH was
 * not, and the previous window a decay number is measured against was invisible entirely.
 *
 * ONE renderer for all three tools, the same reason renderPullProvenance is one (load.ts).
 */
export function renderAnalyzedWindow(pull: PullData): string {
  return (
    `Analyzed window: ${pull.current.start_date}..${pull.current.end_date} ` +
    `(${pull.days} days) vs previous ${pull.previous.start_date}..${pull.previous.end_date}.`
  );
}

/**
 * The row-cap caveat, or null when neither window was truncated.
 *
 * pull_gsc_data already warns at PULL time (formatPullSummary), and that was the whole of it:
 * the discovery tools read the stored pull days or weeks later, in a different conversation,
 * and ran over the truncated rows without a word. The consequences are not cosmetic — decay
 * reads a page that fell out of the current window's top rows as current=0 and reports a
 * GHOST collapse, and every cannibalization share is computed against a truncated denominator.
 *
 * The number DERIVES from MAX_ROW_LIMIT, like formatPullSummary's: prose is exactly where a
 * changed constant goes unnoticed, and a wrong figure here tells the user how much data they
 * are missing with no way to check it.
 *
 * An OR over the two windows, deliberately: the previous window is the baseline every decay
 * number is measured against, so truncating IT inflates every "lost clicks" figure the tool
 * prints.
 */
export function renderRowCapCaveat(pull: PullData): string | null {
  if (!pull.current.capped && !pull.previous.capped) return null;
  return (
    `Note: this analysis covers at most ${grouped(MAX_ROW_LIMIT)} rows per window — ` +
    "the pull hit that cap, so these results may be partial."
  );
}

/**
 * Render the quick-win shortlist (or a friendly empty message).
 *
 * `total` is how many opportunities cleared the bands BEFORE the shortlist cap
 * (quick-wins.ts findQuickWinsResult). It defaults to the shortlist's own length so a caller
 * that has no total cannot accidentally claim rows were dropped; when it is larger, the count
 * of what was cut is PRINTED. Without that line a site with 400 qualifying queries reads "50
 * quick wins" and the user has no way to know the list is 12% of the answer — the shortlist cap
 * is a presentation choice, and presenting it as the finding is the same silent-truncation
 * failure the row cap has.
 */
export function formatQuickWins(wins: readonly QuickWin[], total = wins.length): string {
  if (wins.length === 0) {
    return "No quick wins found: no query is ranking in positions 8–20 with enough impressions yet.";
  }
  const lines = wins.map(
    (w) =>
      `• "${w.query}" → ${w.page} — position ${pos(w.position)}, ` +
      `${w.impressions} impressions, ${w.clicks} clicks, CTR ${pct(w.ctr)}`,
  );
  const remainder =
    total > wins.length ? `\n…and ${grouped(total - wins.length)} more cleared the bands.` : "";
  return `${wins.length} quick win${wins.length === 1 ? "" : "s"} (position 8–20 with demand), best first:\n${lines.join("\n")}${remainder}`;
}

/** Render the cannibalization groups (or a friendly empty message). */
export function formatCannibalization(groups: readonly CannibalGroup[]): string {
  // Branded queries leave the LIST but not the answer. Several pages ranking for your own brand
  // is sitelink behaviour, not cannibalization, and consolidating them would be self-harm — but
  // silently dropping them would leave the user wondering where their biggest query went.
  const branded = groups.filter((g) => g.branded);
  const real = groups.filter((g) => !g.branded);
  const brandNote =
    branded.length === 0
      ? ""
      : `\n\nExcluded ${branded.length} branded quer${branded.length === 1 ? "y" : "ies"} ` +
        `(${branded.map((g) => `"${g.query}"`).join(", ")}): several of your pages ranking for ` +
        "your own brand is normal — Google shows sitelinks — and is not cannibalization.";

  if (real.length === 0) {
    return (
      "No cannibalization found: no query has two or more of your pages meaningfully competing for it." +
      brandNote
    );
  }
  const blocks = real.map((g) => {
    const pageLines = g.pages.map(
      (p) => `    - ${p.page} — position ${pos(p.position)}, ${p.impressions} impressions, ${p.clicks} clicks`,
    );
    return `• "${g.query}" — ${g.pages.length} competing pages, ${g.total_impressions} impressions total:\n${pageLines.join("\n")}`;
  });
  return (
    `${real.length} cannibalized quer${real.length === 1 ? "y" : "ies"} (most impressions first):\n` +
    blocks.join("\n") +
    brandNote
  );
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
