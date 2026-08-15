import { describe, expect, it } from "vitest";
import { buildProjectCard, summarizePullWindow, type ProjectCardInput } from "./card";
import type { PullRow } from "./signals";

/**
 * WHAT THE LAST SEARCH CONSOLE PULL COVERED — the line beside its date.
 *
 * The card used to print the date alone, which is the weaker half of the fact: two pulls a day
 * apart can cover a 7-day and a 90-day window, and every number the discovery tools print off them
 * means something different because all three engines apply ABSOLUTE thresholds. The MCP tools
 * have printed this in their footer since `renderAnalyzedWindow` landed; the panel said nothing.
 *
 * Pure, and driven through the real card builder as well as the summarizer, because the two can
 * disagree: a builder that forgot to call it would leave every spec on the summarizer green.
 */

const NOW = new Date("2026-08-14T12:00:00.000Z");
const PROJECT = { id: "p-1", domain: "example.com", created_at: "2026-01-02T00:00:00.000Z" };

function pullRow(over: Partial<PullRow> = {}): PullRow {
  return {
    created_at: "2026-08-12T00:00:00.000Z",
    window_days: 90,
    window_start: "2026-04-19",
    window_end: "2026-07-17",
    window_capped: false,
    previous_capped: false,
    ...over,
  };
}

const cardWith = (pull: PullRow | null) =>
  buildProjectCard(
    { project: PROJECT, crawl: null, pull, connection: null } satisfies ProjectCardInput,
    NOW,
  );

describe("the pull line states the window it covered", () => {
  it("prints the window's dates and its length", () => {
    expect(summarizePullWindow(pullRow())?.range).toBe("2026-04-19..2026-07-17 (90 days)");
  });

  it("says day in the singular", () => {
    expect(summarizePullWindow(pullRow({ window_days: 1 }))?.range).toContain("(1 day)");
  });

  /** The card carries it, so the summarizer being right is not merely a private fact. */
  it("reaches the card, beside the date that was already there", () => {
    const card = cardWith(pullRow());
    expect(card.pullAt).toBe("2026-08-12T00:00:00.000Z");
    expect(card.pullWindow?.range).toBe("2026-04-19..2026-07-17 (90 days)");
  });

  it("has no window at all when the project has never been pulled", () => {
    const card = cardWith(null);
    expect(card.pullAt).toBeNull();
    expect(card.pullWindow).toBeNull();
  });
});

describe("an unreadable stored window drops the line rather than inventing one", () => {
  /**
   * A pull stored before these fields existed, or a corrupt result. The card then shows the date
   * alone — exactly what it showed before this line existed. A guessed range would be worse than
   * silence: the reader has no way to check it.
   */
  it.each([
    { name: "no days", over: { window_days: undefined } },
    { name: "days as text", over: { window_days: "90" } },
    { name: "no start date", over: { window_start: undefined } },
    { name: "empty end date", over: { window_end: "" } },
  ])("returns null when the pull carries $name", ({ over }) => {
    expect(summarizePullWindow(pullRow(over))).toBeNull();
    expect(cardWith(pullRow(over)).pullWindow).toBeNull();
  });
});

describe("a truncated pull is flagged, an untruncated one is not", () => {
  /**
   * THE COUNTERWEIGHT FIRST: a complete pull must never be branded partial. Without this half, a
   * condition inverted to always-true would still satisfy every "warns when capped" assertion.
   */
  it("does not call a complete pull partial", () => {
    expect(summarizePullWindow(pullRow())?.capped).toBe(false);
    expect(cardWith(pullRow()).pullWindow?.capped).toBe(false);
  });

  /**
   * EITHER window counts, matching `renderRowCapCaveat` in apps/mcp: the previous window is the
   * baseline every decay number is measured against and every cannibalization share is divided by,
   * so truncating IT corrupts the answer at least as badly as truncating the current one. A
   * condition narrowed to `window_capped` alone keeps the first case below green.
   */
  it.each(["window_capped", "previous_capped"] as const)("flags a pull whose %s window hit the cap", (field) => {
    expect(summarizePullWindow(pullRow({ [field]: true }))?.capped).toBe(true);
    expect(cardWith(pullRow({ [field]: true })).pullWindow?.capped).toBe(true);
  });

  /** A missing flag is "not capped", not "unknown": older pulls simply predate it. */
  it("treats an absent cap flag as not truncated", () => {
    const row = pullRow({ window_capped: undefined, previous_capped: undefined });
    expect(summarizePullWindow(row)?.capped).toBe(false);
  });
});
