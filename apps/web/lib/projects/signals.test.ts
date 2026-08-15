import { FRESHNESS_WINDOW_DAYS } from "@pseo/core";
import { describe, expect, it } from "vitest";
import {
  deriveProjectSignals,
  isFresh,
  isGscConnected,
  tokenStatusFor,
  type GscTokenStatus,
} from "./signals";

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

/**
 * THE JOIN, driven rather than described.
 *
 * Every case here uses a map with MORE THAN ONE account and asks about a project linked to a
 * specific one. A single-account fixture would be green under any lookup at all — including "take
 * the first value in the map", which is exactly the mutation that survived the whole first round
 * of specs: the page's account-health map was built correctly, the ladder read the signal
 * correctly, and the one line that picked WHICH account a project reads through was executed by
 * nothing. Multi-account is not an edge case here; it is the axis migration 0021 introduced, and
 * the health map has one entry per Google account the user connected.
 */
describe("tokenStatusFor — which account's health this project reads", () => {
  const HEALTH: ReadonlyMap<string, GscTokenStatus> = new Map([
    ["acct-dead", "invalid"],
    ["acct-live", "active"],
  ]);

  function connection(accountId: string | null) {
    return { account_id: accountId, gsc_property: "sc-domain:example.com" };
  }

  it("reads the health of the account THIS project is linked to", () => {
    expect(tokenStatusFor(connection("acct-dead"), HEALTH)).toBe("invalid");
    expect(tokenStatusFor(connection("acct-live"), HEALTH)).toBe("active");
  });

  /**
   * The pair above in the other order, so a lookup that returns the map's FIRST entry cannot pass
   * by luck of insertion order: whichever account is first, one of these two assertions is wrong.
   */
  it("does not hand every project the same account's health", () => {
    const reversed: ReadonlyMap<string, GscTokenStatus> = new Map([
      ["acct-live", "active"],
      ["acct-dead", "invalid"],
    ]);
    expect(tokenStatusFor(connection("acct-dead"), reversed)).toBe("invalid");
    expect(tokenStatusFor(connection("acct-live"), reversed)).toBe("active");
  });

  it("reads nothing for a project with no account link, however many accounts exist", () => {
    expect(tokenStatusFor(connection(null), HEALTH)).toBeNull();
    expect(tokenStatusFor(null, HEALTH)).toBeNull();
  });

  /**
   * An `account_id` naming no readable row is NOT a death. It is what a row this caller cannot see
   * looks like; calling it invalid would send the user to reconnect an account that is fine.
   */
  it("reads nothing for an account_id that names no row in the map", () => {
    expect(tokenStatusFor(connection("acct-unknown"), HEALTH)).toBeNull();
  });
});

/**
 * …and the same join carried all the way to the ladder, on the surface's own two steps: the wrong
 * account's status must not be able to reach `gscTokenInvalid` either.
 */
describe("tokenStatusFor feeds deriveProjectSignals per project", () => {
  const HEALTH: ReadonlyMap<string, GscTokenStatus> = new Map([
    ["acct-dead", "invalid"],
    ["acct-live", "active"],
  ]);

  function signalsFor(accountId: string) {
    const connection = { account_id: accountId, gsc_property: "sc-domain:example.com" };
    return deriveProjectSignals(
      { crawl: null, pull: null, connection, tokenStatus: tokenStatusFor(connection, HEALTH) },
      NOW,
    );
  }

  it("marks only the project on the dead account as invalid", () => {
    expect(signalsFor("acct-dead").gscTokenInvalid).toBe(true);
    expect(signalsFor("acct-live").gscTokenInvalid).toBe(false);
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

  /**
   * The health signal's THREE input states, each asserted separately, because two of them produce
   * `false` for opposite reasons and the third produces nothing at all:
   *
   *   absent  -> the key is MISSING, not false. The ladder reads it with `=== true`, so a missing
   *              signal decides exactly as it did before the reconnect rung existed — while a
   *              `false` would be this layer claiming a measurement its caller never made.
   *   null    -> measured, no account health to have. False: nothing is known to be wrong.
   *   active  -> false.  invalid -> true.
   */
  it("omits gscTokenInvalid entirely when the caller measures no health", () => {
    const signals = deriveProjectSignals({ crawl: null, pull: null, connection: null }, NOW);
    expect("gscTokenInvalid" in signals).toBe(false);
    expect(signals.gscTokenInvalid).toBeUndefined();
  });

  it("reports a measured-but-absent health as not-invalid rather than unmeasured", () => {
    const signals = deriveProjectSignals(
      { crawl: null, pull: null, connection: null, tokenStatus: null },
      NOW,
    );
    expect("gscTokenInvalid" in signals).toBe(true);
    expect(signals.gscTokenInvalid).toBe(false);
  });

  it("reports a live account as not invalid", () => {
    const signals = deriveProjectSignals(
      {
        crawl: null,
        pull: null,
        connection: { account_id: "acct-1", gsc_property: "sc-domain:example.com" },
        tokenStatus: "active",
      },
      NOW,
    );
    expect(signals.gscTokenInvalid).toBe(false);
  });

  it("reports a stored 'invalid' account as invalid", () => {
    const signals = deriveProjectSignals(
      {
        crawl: null,
        pull: null,
        connection: { account_id: "acct-1", gsc_property: "sc-domain:example.com" },
        tokenStatus: "invalid",
      },
      NOW,
    );
    expect(signals.gscTokenInvalid).toBe(true);
    // …and the connection is still a CONNECTION. Collapsing the two would make an expired project
    // look like one that never connected, which routes it to the optional-GSC rung instead of to
    // reconnect (whats-next.ts's own note on readGscConnected).
    expect(signals.gscConnected).toBe(true);
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
