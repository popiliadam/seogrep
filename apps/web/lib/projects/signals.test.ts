import { FRESHNESS_WINDOW_DAYS } from "@pseo/core";
import { describe, expect, it } from "vitest";
import { deriveProjectSignals, isFresh, isGscConnected } from "./signals";

/**
 * The signal derivation, pinned directly. These specs exist because the panel and the MCP
 * `whats_next` tool must answer the same question the same way; a drift here shows up to the
 * user as the dashboard and the assistant disagreeing about the same project on the same day.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-14T12:00:00.000Z");

/** An ISO timestamp `ms` milliseconds before NOW. */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

/** The freshness boundary, TAKEN FROM CORE — never a literal 30, which would pin a copy. */
const WINDOW_MS = FRESHNESS_WINDOW_DAYS * MS_PER_DAY;

describe("isFresh — the freshness window", () => {
  it("counts a job inside the window as fresh", () => {
    expect(isFresh(ago(WINDOW_MS / 2), NOW)).toBe(true);
    expect(isFresh(ago(0), NOW)).toBe(true);
  });

  // The boundary itself: whats-next.ts's isFresh is `now - created <= WINDOW`, so a job EXACTLY
  // one window old is still fresh and one millisecond further is not. Both sides are asserted,
  // because a comparison flipped in either direction has to fail here.
  it("counts a job exactly one window old as fresh, and one millisecond older as stale", () => {
    expect(isFresh(ago(WINDOW_MS), NOW)).toBe(true);
    expect(isFresh(ago(WINDOW_MS + 1), NOW)).toBe(false);
  });

  it("counts a job well outside the window as stale", () => {
    expect(isFresh(ago(WINDOW_MS * 3), NOW)).toBe(false);
  });
});

describe("isGscConnected — connected is account_id, NOT the row", () => {
  // Defect #52. Since migration 0021 the credential lives on gsc_accounts and gsc_connections is
  // the MAPPING: unmapProject clears account_id and KEEPS the row, and an account disconnect
  // nulls the same column via `on delete set null` while gsc_property survives. A row alone
  // therefore reads nothing at all.
  it("reports NOT connected when the row exists but account_id is null", () => {
    expect(isGscConnected({ account_id: null, gsc_property: null })).toBe(false);
  });

  it("reports NOT connected when a retained property survives a disconnected account", () => {
    expect(isGscConnected({ account_id: null, gsc_property: "https://example.com/" })).toBe(false);
  });

  it("reports connected only when account_id is set", () => {
    expect(isGscConnected({ account_id: "acct-1", gsc_property: null })).toBe(true);
    expect(isGscConnected({ account_id: "acct-1", gsc_property: "sc-domain:example.com" })).toBe(
      true,
    );
  });

  it("reports NOT connected when the project has no row at all", () => {
    expect(isGscConnected(null)).toBe(false);
  });
});

describe("deriveProjectSignals", () => {
  it("reports nothing present for a project with no crawl, no pull and no connection", () => {
    expect(deriveProjectSignals({ crawl: null, pull: null, connection: null }, NOW)).toEqual({
      hasCrawl: false,
      crawlFresh: false,
      gscConnected: false,
      hasPull: false,
      pullFresh: false,
    });
  });

  it("marks a present-but-old source as present and STALE, not absent", () => {
    const signals = deriveProjectSignals(
      {
        crawl: { created_at: ago(WINDOW_MS + MS_PER_DAY), result: null },
        pull: { created_at: ago(WINDOW_MS + MS_PER_DAY), result: null },
        connection: { account_id: "acct-1", gsc_property: "https://example.com/" },
      },
      NOW,
    );
    expect(signals).toEqual({
      hasCrawl: true,
      crawlFresh: false,
      gscConnected: true,
      hasPull: true,
      pullFresh: false,
      });
  });

  it("marks recent sources fresh", () => {
    const signals = deriveProjectSignals(
      {
        crawl: { created_at: ago(MS_PER_DAY), result: null },
        pull: { created_at: ago(2 * MS_PER_DAY), result: null },
        connection: { account_id: "acct-1", gsc_property: "https://example.com/" },
      },
      NOW,
    );
    expect(signals.crawlFresh).toBe(true);
    expect(signals.pullFresh).toBe(true);
  });

  // The same defect-#52 axis, at the level the ladder actually consumes: a project whose row
  // lost its account must not be routed as if Search Console were live.
  it("carries the account_id definition of gscConnected into the signals", () => {
    const signals = deriveProjectSignals(
      {
        crawl: { created_at: ago(MS_PER_DAY), result: null },
        pull: null,
        connection: { account_id: null, gsc_property: "https://example.com/" },
      },
      NOW,
    );
    expect(signals.gscConnected).toBe(false);
  });
});
