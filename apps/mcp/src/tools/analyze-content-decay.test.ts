import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pullData, SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import { gscRow } from "../gsc-data/fixtures.ts";
import {
  GOOGLE_UPDATES_VERIFIED_ON,
  UPDATE_CALENDAR_STALE_DAYS,
  type PullData,
} from "../gsc-data/index.ts";
import { renderContentDecay } from "./analyze-content-decay.ts";

/**
 * B-1 AT THE TOOL — measured live 2026-09-03. The reply compared `2026-06-03..2026-08-31` against
 * `2026-03-05..2026-06-02`, returned ten decaying pages, and told the customer to change every one
 * of them. Both the March 2026 core update (27 Mar) and the May 2026 one (21 May) landed inside
 * that baseline window, and the string "core update" did not appear anywhere in the repository.
 *
 * These drive `renderContentDecay` — the function `makeAnalyzeContentDecayTool` is actually built
 * from — rather than rebuilding it out of the engine and the formatter. A spec that reassembles
 * the expression under test pins its own arithmetic, and this tool could have swapped renderers
 * under it without a red line (find_quick_wins already paid for that lesson).
 */

/** Two adjacent windows whose combined span holds no published update (1 Jul → 17 Aug 2026). */
const QUIET_PULL: PullData = {
  ...pullData(
    [gscRow({ query: "q", page: "https://x.test/p", clicks: 2, impressions: 100, position: 9 })],
    [gscRow({ query: "q", page: "https://x.test/p", clicks: 40, impressions: 900, position: 6 })],
  ),
  days: 24,
  current: {
    start_date: "2026-07-25",
    end_date: "2026-08-17",
    rows: [gscRow({ query: "q", page: "https://x.test/p", clicks: 2, impressions: 100, position: 9 })],
  },
  previous: {
    start_date: "2026-07-01",
    end_date: "2026-07-24",
    rows: [gscRow({ query: "q", page: "https://x.test/p", clicks: 40, impressions: 900, position: 6 })],
  },
};

/**
 * THE CLOCK IS FROZEN, and here it defuses a DATED bomb rather than one already gone off.
 *
 * `renderContentDecay` takes no `now`, so `renderUpdateOverlap` falls through to
 * `isUpdateCalendarStale(new Date())` — the wall clock. On GOOGLE_UPDATES_VERIFIED_ON +
 * UPDATE_CALENDAR_STALE_DAYS the product will correctly append " This update list was last
 * checked on … " to the note line, and every assertion below reads that same line. They survive
 * today only because each is a `toContain`, which is precisely how find_quick_wins' provenance
 * spec survived until someone anchored it — that one carried a fuse nobody had written down, and
 * it went off on a docs-only PR. This one's fuse is 90 days after the calendar was verified.
 *
 * Frozen inside the window, so the notes below mean what they were written to mean; the pair at
 * the bottom of this block then drives the clock ACROSS the threshold on purpose, so the branch
 * is measured rather than merely avoided.
 */
const VERIFIED_MS = Date.parse(`${GOOGLE_UPDATES_VERIFIED_ON}T00:00:00Z`);
const CALENDAR_FRESH = new Date(VERIFIED_MS + 86_400_000);

beforeAll(() => {
  // Date only — faking the timer queue would hang anything that awaited one.
  vi.useFakeTimers({ now: CALENDAR_FRESH, toFake: ["Date"] });
});

afterAll(() => {
  vi.useRealTimers();
});

describe("analyze_content_decay names an algorithm update the compared period spans (B-1)", () => {
  it("puts the update note ABOVE the list, not under it", () => {
    // SAMPLE_PULL compares 2026-01-19..2026-04-18 with 2026-04-19..2026-07-17 — a span holding
    // both 2026 core updates.
    const text = renderContentDecay(SAMPLE_PULL).text;
    const lines = text.split("\n");
    expect(lines[0]).toContain("March 2026 core update (27 Mar)");
    expect(lines[0]).toContain("May 2026 core update (21 May)");
    // The finding itself is still delivered, under it.
    expect(text).toContain("decaying page");
    expect(text.indexOf("March 2026 core update")).toBeLessThan(text.indexOf("decaying page"));
  });

  it("reads the period as previous-window START through current-window END", () => {
    // A baseline reshaped by an update distorts every loss measured against it, so an overlap
    // check that looked only at the CURRENT window would miss the live case entirely — both
    // updates were in the baseline.
    const text = renderContentDecay(SAMPLE_PULL).text;
    expect(text).toContain("February 2026 Discover update");
  });

  /**
   * THE COUNTERWEIGHT. A renderer that prepended the note unconditionally passes everything above
   * while telling every customer their drop might be an algorithm update — the same failure as
   * never mentioning one, pointed the other way.
   */
  it("says nothing about updates when the compared period spans none", () => {
    const text = renderContentDecay(QUIET_PULL).text;
    expect(text).not.toMatch(/update/i);
    expect(text).toContain("decaying page");
  });

  /**
   * BOTH SIDES OF THE CALENDAR'S OWN STALENESS, with the threshold IMPORTED rather than typed:
   * the note line is the only place this self-report can appear, and until now nothing measured
   * it from the tool at all — the branch would simply have switched on one day in December and
   * changed what every customer read, with no spec noticing either state.
   *
   * The clock is driven ACROSS the threshold here, which is what the frozen base makes possible:
   * a wall-clock spec can only ever observe whichever side of the fuse the calendar happens to
   * be on today.
   */
  it("keeps the note free of the self-report while the update calendar is still fresh", () => {
    const lines = renderContentDecay(SAMPLE_PULL).text.split("\n");

    expect(lines[0]).toMatch(/before rewriting any of them\.$/);
    expect(lines[0]).not.toMatch(/last checked on/);
  });

  it("appends the self-report to that same line once the calendar goes unverified", () => {
    vi.setSystemTime(new Date(VERIFIED_MS + (UPDATE_CALENDAR_STALE_DAYS + 1) * 86_400_000));
    try {
      const lines = renderContentDecay(SAMPLE_PULL).text.split("\n");

      expect(lines[0]).toMatch(
        new RegExp(
          `before rewriting any of them\\. This update list was last checked on ` +
            `${GOOGLE_UPDATES_VERIFIED_ON} and may be missing newer ones\\.$`,
        ),
      );
      // It rides on the note line rather than becoming one, so the block's shape is unchanged.
      expect(lines[1]).toBe("");
      expect(renderContentDecay(SAMPLE_PULL).text).toContain("decaying page");
    } finally {
      vi.setSystemTime(CALENDAR_FRESH);
    }
  });

  it("keeps the note out of the STORED report — the row holds the measurement", () => {
    const report = renderContentDecay(SAMPLE_PULL).report;
    expect(JSON.stringify(report)).not.toMatch(/core update/i);
  });
});
