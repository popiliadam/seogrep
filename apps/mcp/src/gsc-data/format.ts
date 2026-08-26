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
 * Render the quick-win shortlist as a FLAT list (or a friendly empty message).
 *
 * NOT THE TOOL'S RENDERER ANY MORE, and this sentence is here because its absence already cost a
 * deterministic red: `find_quick_wins` groups its findings by page (find-quick-wins.ts
 * `formatGroupedQuickWins`), and a db-lane byte-pin went on naming THIS function as "what the
 * tool prints" long after it stopped being true. A second renderer that merely LOOKS like the
 * tool's is a second source of truth, and the lane that would have caught the drift is not the
 * one the unit gate runs.
 *
 * What is left is a stand-in: the three sibling specs that need SOME renderer behind a FAKE
 * 0-credit discovery tool (gsc-discovery-shared.test.ts, gsc-discovery-runs.test.ts) use it, and
 * format.test.ts pins it directly. Nothing in production calls it. Anything asserting what
 * find_quick_wins PRINTS must go through `formatGroupedQuickWins` instead.
 *
 * `total` is how many opportunities cleared the bands BEFORE the shortlist cap
 * (quick-wins.ts findQuickWinsResult). It defaults to the shortlist's own length so a caller
 * that has no total cannot accidentally claim rows were dropped; when it is larger, the count
 * of what was cut is PRINTED. Without that line a site with 400 qualifying queries reads "50
 * quick wins" and the user has no way to know the list is 12% of the answer — the shortlist cap
 * is a presentation choice, and presenting it as the finding is the same silent-truncation
 * failure the row cap has.
 *
 * IT CARRIES NO RECOMMENDATION, on purpose, and that is the one asymmetry with its two siblings
 * below. formatCannibalization and formatContentDecay ARE what their tools print, so the advice
 * belongs in them; this one is not, so advice added here would be read by nobody but the specs
 * that use it as a stand-in — a green suite proving a customer-facing line that never ships. The
 * quick-win recommendation lives with the renderer find_quick_wins actually calls
 * (find-quick-wins.ts `quickWinAdvice`). Copying it here would recreate the second source of
 * truth this docblock already exists to warn about.
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

/**
 * How far behind the best-ranked page every OTHER competing page must sit before "keep this one,
 * fold the rest into it" is something the data says rather than a coin flip.
 *
 * Five positions is roughly half a SERP page. Under that, two pages are not distinguishable from
 * this data at all: `position` is a mean over the whole window, so a 2-position spread is inside
 * the noise of which page Google happened to prefer on which day — and naming a keeper there
 * would be advice to DELETE the wrong page's ranking. The signature case the recommendation
 * exists for is the opposite shape entirely (measured 2026-08-25: position 7.7 beside position
 * 92.4 in the same group, with no sentence saying which one to canonicalize).
 */
export const CANNIBAL_CLEAR_LEADER_GAP = 5;

/**
 * The consolidation recommendation for one cannibalized query, or null when the data does not
 * support one.
 *
 * NULL IS A REAL ANSWER HERE, not a gap to fill later. Two floors have to hold before a keeper
 * can be named, and each closes a way of being confidently wrong:
 *
 *   1. EVERY other page sits at least CANNIBAL_CLEAR_LEADER_GAP behind the best-ranked one.
 *      "All" and not "the next one": two near-tied contenders at the top with a straggler below
 *      is not a keep-one-fold-the-rest shape, and reading only the runner-up would call it one.
 *   2. No trailing page out-EARNS the leader on clicks. A page ranking worse while taking more
 *      clicks is a contradiction between the two signals in the row — different intent, a better
 *      snippet, something this data cannot see — and consolidating on rank alone would throw
 *      away the page actually converting.
 *
 * The leader is chosen by POSITION and the caller's array is ordered by IMPRESSIONS, so this
 * re-sorts rather than reading `pages[0]`. On a query where the biggest page is not the
 * best-ranked one, trusting the incoming order names the wrong keeper.
 *
 * Every number in the sentence is read off the group's own rows — the URLs, both positions, the
 * measured gap, the impressions each side holds. Nothing is projected.
 */
export function cannibalizationAdvice(group: CannibalGroup): string | null {
  const ranked = [...group.pages].sort((a, b) => a.position - b.position);
  const [leader, ...trailing] = ranked;
  if (leader === undefined || trailing.length === 0) return null;

  const gaps = trailing.map((p) => p.position - leader.position);
  if (gaps.some((gap) => gap < CANNIBAL_CLEAR_LEADER_GAP)) return null;
  if (trailing.some((p) => p.clicks > leader.clicks)) return null;

  const minGap = Math.min(...gaps);
  const held = trailing.reduce((sum, p) => sum + p.impressions, 0);
  const named = trailing.map((p) => `${p.page} (position ${pos(p.position)})`).join(", ");
  // "84.7 positions behind" for one trailing page and "84.7+" for several: with one the gap IS
  // that number, and a "+" on an exact figure quietly tells the reader the tool is rounding when
  // it is not. With several it is the SMALLEST of their gaps, and the "+" is the honest part.
  const sit = trailing.length === 1 ? "it sits" : "they sit";
  const gapText = trailing.length === 1 ? pos(minGap) : `${pos(minGap)}+`;
  return (
    `    → Keep ${leader.page} (position ${pos(leader.position)}, ${grouped(leader.clicks)} clicks); ` +
    `canonicalize or merge ${named} into it — ${sit} ${gapText} positions behind while holding ` +
    `${grouped(held)} of this query's ${grouped(group.total_impressions)} impressions.`
  );
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
    // The recommendation rides UNDER the page lines it is derived from, and is OMITTED (never
    // blanked) when the data does not support one — the same rule the footer's optional lines
    // follow, so a group with no defensible keeper simply has no arrow rather than a hedge.
    const advice = cannibalizationAdvice(g);
    const body = advice === null ? pageLines : [...pageLines, advice];
    return `• "${g.query}" — ${g.pages.length} competing pages, ${g.total_impressions} impressions total:\n${body.join("\n")}`;
  });
  return (
    `${real.length} cannibalized quer${real.length === 1 ? "y" : "ies"} (most impressions first):\n` +
    blocks.join("\n") +
    brandNote
  );
}

/**
 * Where a partial slide stops being a slide. Past this share of its clicks gone, a page has not
 * drifted down its existing ranking — the ranking it had is not there any more — so "refresh and
 * add internal links" is the wrong instruction to hand the reader.
 */
export const DECAY_SEVERE_DROP_RATIO = 0.7;

/**
 * What to DO about one decaying page, derived from how the page actually fell.
 *
 * THREE OUTCOMES, not one sentence with the numbers swapped in. The list is uncapped
 * (analyzeContentDecay returns every page that cleared both thresholds), so a single template
 * repeated down thirty rows would be exactly the boilerplate this layer is not allowed to be:
 * it would cost the reader thirty lines and tell them nothing the row above it did not.
 *
 * The branches are the three genuinely different problems the numbers can describe:
 *
 *   - NOTHING LEFT (current === 0). The page is not underperforming, it has stopped appearing.
 *     Rewriting it is wasted work if it is deindexed, redirected, or erroring — and this is also
 *     the shape a truncated pull manufactures (a page that fell out of the row cap's top rows
 *     reads as zero), which is the second reason the instruction is VERIFY before rewrite. The
 *     footer's cap caveat is the other half of that guard.
 *   - SEVERE (>= DECAY_SEVERE_DROP_RATIO gone, some clicks left). Editing around the edges of a
 *     page that lost three quarters of its clicks does not get them back; the question is what
 *     outranks it now.
 *   - PARTIAL (the 30-70% band the thresholds admit). It still ranks and still earns — this is
 *     the case a refresh and internal links are actually for.
 *
 * Never null: a page only reaches this function by clearing both decay thresholds, so there is
 * always a real loss to act on. That is the difference from cannibalizationAdvice, where naming
 * a keeper can genuinely be unsupported.
 */
export function contentDecayAdvice(decay: PageDecay): string {
  if (decay.current_clicks === 0) {
    return (
      `    → Nothing left: ${grouped(decay.previous_clicks)} → 0 clicks. Check the page is still ` +
      "indexed, reachable and not redirected before rewriting anything."
    );
  }
  if (decay.drop_ratio >= DECAY_SEVERE_DROP_RATIO) {
    return (
      `    → Severe: ${pct(decay.drop_ratio)} gone, ${grouped(decay.current_clicks)} of ` +
      `${grouped(decay.previous_clicks)} clicks left. Re-target rather than tweak — check what ` +
      "ranks for this page's main query now, then rewrite against it."
    );
  }
  return (
    `    → Partial slide: ${grouped(decay.current_clicks)} of ${grouped(decay.previous_clicks)} ` +
    `clicks left, so the page still ranks. Refresh the content and add internal links to win ` +
    `back the ${grouped(decay.clicks_lost)} it lost.`
  );
}

/** Render the decaying pages, each with what to do about it (or a friendly empty message). */
export function formatContentDecay(decays: readonly PageDecay[]): string {
  if (decays.length === 0) {
    return "No content decay found: no page lost a meaningful share of its clicks vs the previous window.";
  }
  const lines = decays.map(
    (d) =>
      `• ${d.page} — ${d.previous_clicks} → ${d.current_clicks} clicks ` +
      `(lost ${d.clicks_lost}, down ${pct(d.drop_ratio)})\n${contentDecayAdvice(d)}`,
  );
  return `${decays.length} decaying page${decays.length === 1 ? "" : "s"} (biggest loss first):\n${lines.join("\n")}`;
}
