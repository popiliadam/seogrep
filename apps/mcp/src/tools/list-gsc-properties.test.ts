import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GscSite } from "@pseo/core";
import type { AuthContext } from "../auth.ts";

/**
 * `../db.ts` is replaced so ONE spec can drive the production `loadGscAccounts` reader without a
 * database: the DB lane cannot run without the local stack, and the column list that reader asks
 * for is the difference between a warning that exists and a warning that never fires. Every other
 * spec in this file injects its ports and never reaches this module at all.
 */
const selectOwnCalls: { table: string; columns: string }[] = [];
let accountTableRows: Record<string, unknown>[] = [];
/** Which user id `forUser` was scoped to — the ONE tenant guard on this table (NEVER #4). */
let scopedUserIds: string[] = [];

vi.mock("../db.ts", () => ({
  getServiceClient: () => ({}),
  markGscAccountTokenInvalid: vi.fn(),
  forUser: (_client: unknown, userId: string) => {
    scopedUserIds.push(userId);
    return {
      userId,
      selectOwn: (table: string, columns: string) => {
        selectOwnCalls.push({ table, columns });
        // The fake ANSWERS ONLY WHAT WAS SELECTED (signed lesson 12): a reader that stops
        // asking for token_status gets `undefined` back for it here exactly as PostgREST would,
        // instead of a fixture generously handing over a column the statement never named.
        const wanted = columns.split(",").map((column) => column.trim());
        return Promise.resolve({
          data: accountTableRows
            // The tenant filter, applied rather than merely recorded.
            .filter((row) => !("user_id" in row) || row.user_id === userId)
            .map((row) => Object.fromEntries(wanted.map((column) => [column, row[column]]))),
          error: null,
        });
      },
    };
  },
}));

import {
  loadGscAccounts,
  makeListGscPropertiesTool,
  type GscAccountSummary,
  type ProjectPropertyMapping,
} from "./list-gsc-properties.ts";

/**
 * Fast-lane (DB-less) proofs for list_gsc_properties. Every port is injected, so this file
 * touches neither the database nor Google (NEVER #5).
 *
 * The fakes MODEL the constraints the real readers carry rather than ignoring them (signed
 * lesson 12 — a permissive double turns a missing constraint into a passing test):
 *   · the account reader FILTERS by user_id, so a tool that forgot to pass ctx.userId, or
 *     passed something else, reads another tenant's accounts and the tenancy spec fails;
 *   · the sites reader THROWS when the (accountId, userId) pair does not own each other, the
 *     way the real `(id, user_id)`-filtered read returns nothing.
 *
 * Fixture values are chosen so no assertion can pass for an unintended reason: the property
 * strings, the project domains and the account emails share no substring with each other or
 * with any sentence the tool prints.
 */

const USER = "user-1";
const OTHER_USER = "user-2";
const CTX: AuthContext = { userId: USER, keyId: "key-1" };

const ACCOUNT_ID = "acct-owner";
const SECOND_ACCOUNT_ID = "acct-owner-two";
const OTHER_ACCOUNT_ID = "acct-second";
const OTHER_TENANT_ACCOUNT_ID = "acct-foreign";

/** One tenant's accounts, and which sites each account lists. */
interface World {
  /** `sites.list` for the CALLER's first account. */
  readonly sites?: readonly GscSite[];
  /** Make that call fail, the way a dead credential or a Google outage does. */
  readonly sitesListFails?: boolean;
  /**
   * The message that failure carries. The default is deliberately NOT invalid_grant-shaped, so
   * the existing transient specs keep measuring the transient path; the reauth specs opt in.
   */
  readonly sitesListError?: string;
  /** The STORED token health of the caller's first account (migration 0021). */
  readonly tokenStatus?: "active" | "invalid" | null;
  /** A SECOND healthy account on the caller, for the failure-isolation spec. */
  readonly secondAccountSites?: readonly GscSite[];
  /**
   * Projects reading a property, defaulting to ACCOUNT_ID when no account is named. `property`
   * is OPTIONAL because a project that reads NOTHING is a real and common state — five of them
   * sat beside a matching property in the live account on 2026-08-25 — and the fixture could not
   * express it before.
   */
  readonly mappings?: readonly {
    property?: string | null;
    domain: string;
    /**
     * `null` is a REAL state, not "unset": disconnecting a Google account nulls `account_id` on
     * every project of that account (`on delete set null`) and leaves `gsc_property` in place.
     * The fixture could not express it before, which is why LGP-2 went unmeasured.
     */
    accountId?: string | null;
  }[];
  /** Call as somebody else — their own account lists their own property. */
  readonly asUser?: string;
}

const FOREIGN_SITE: GscSite = {
  siteUrl: "https://tenant-two-site.test/",
  permissionLevel: "siteOwner",
};

function accountsOf(userId: string, world: World = {}): GscAccountSummary[] {
  if (userId === USER) {
    const first = { id: ACCOUNT_ID, email: "first@mail.test", tokenStatus: world.tokenStatus ?? null };
    return world.secondAccountSites
      ? [first, { id: SECOND_ACCOUNT_ID, email: "healthy@mail.test", tokenStatus: null }]
      : [first];
  }
  return userId === OTHER_USER
    ? [{ id: OTHER_TENANT_ACCOUNT_ID, email: "second@mail.test", tokenStatus: null }]
    : [];
}

/** Every best-effort status write the tool made: (accountId, userId) pairs, in order. */
let statusWrites: { accountId: string; userId: string }[] = [];
/** Make the status write itself fail, so the log-and-swallow contract can be measured. */
let statusWriteFails = false;

function toolFor(world: World) {
  return makeListGscPropertiesTool({
    loadAccounts: (userId) => Promise.resolve(accountsOf(userId, world)),
    markTokenInvalid: (accountId, userId) => {
      statusWrites.push({ accountId, userId });
      return statusWriteFails
        ? Promise.reject(new Error("fixture: status write refused"))
        : Promise.resolve();
    },
    listAccountSites: (accountId, userId) => {
      if (!accountsOf(userId, world).some((account) => account.id === accountId)) {
        throw new Error(`fixture: account ${accountId} is not owned by ${userId}`);
      }
      if (accountId === OTHER_TENANT_ACCOUNT_ID) return Promise.resolve([FOREIGN_SITE]);
      if (accountId === SECOND_ACCOUNT_ID) {
        return Promise.resolve([...(world.secondAccountSites ?? [])]);
      }
      if (world.sitesListFails) {
        return Promise.reject(new Error(world.sitesListError ?? "fixture: sites.list refused"));
      }
      return Promise.resolve([...(world.sites ?? [])]);
    },
    loadMappings: (userId): Promise<ProjectPropertyMapping[]> =>
      Promise.resolve(
        userId === USER
          ? (world.mappings ?? []).map((mapping) => ({
              domain: mapping.domain,
              // `=== undefined`, not `??`: an explicit null must survive as null.
              accountId: mapping.accountId === undefined ? ACCOUNT_ID : mapping.accountId,
              property: mapping.property ?? null,
            }))
          : [],
      ),
  });
}

async function callTool(input: Record<string, unknown>, world: World = {}): Promise<string> {
  const result = await toolFor(world).run({ ...CTX, userId: world.asUser ?? USER }, input);
  expect(result.isError).toBeUndefined();
  return result.content.map((part) => part.text).join("\n");
}

beforeEach(() => {
  statusWrites = [];
  statusWriteFails = false;
  selectOwnCalls.length = 0;
  accountTableRows = [];
  scopedUserIds = [];
});

describe("list_gsc_properties", () => {
  it("lists every property with its permission level and the project that reads it", async () => {
    const out = await callTool(
      {},
      {
        sites: [
          { siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:modnco.com", permissionLevel: "siteUnverifiedUser" },
        ],
        mappings: [{ property: "https://rkturizm.com/", domain: "adstark.com.tr" }],
      },
    );
    expect(out).toMatch(/rkturizm\.com/);
    expect(out).toMatch(/siteOwner/);
    expect(out).toMatch(/adstark\.com\.tr/);
    // The unusable one is SHOWN, with its level and the reason it cannot be used — the whole
    // point of the tool is that a property visible in Search Console is not silently absent.
    expect(out).toMatch(/modnco\.com/);
    expect(out).toMatch(/siteUnverifiedUser/);
    expect(out).toMatch(/cannot be queried|not queryable/i);
  });

  it("does not render an unreadable account as an empty property list", async () => {
    // An absence we did not observe is not an absence — the rule /app/connection's property
    // library renders the same listing under. The log line is silenced AND
    // asserted: the user gets a sentence, the operator gets the underlying failure.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await callTool({}, { sitesListFails: true });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(ACCOUNT_ID),
      expect.any(Error),
    );
    errorSpy.mockRestore();
    expect(out).toMatch(/could not be read/i);
    expect(out).not.toMatch(/no properties/i);
    // The SHARP one: the brief's `/no properties/i` cannot fail under the prescribed mutation,
    // because the empty-account sentence is "No Search Console properties on this account."
    // This literal is what a failure-path-turned-empty-list would actually print.
    expect(out).not.toMatch(/no search console properties/i);
  });

  it("keeps listing the healthy accounts when ONE account cannot be read", async () => {
    // The docs page promises exactly this ("The other accounts are still listed") and the
    // module header claims it; nothing measured it while every fixture had a single account.
    // Hoisting the per-account try/catch out of `accounts.map` breaks the promise, and this
    // spec is what turns that red.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await callTool(
      {},
      {
        sitesListFails: true,
        secondAccountSites: [
          { siteUrl: "https://still-listed.test/", permissionLevel: "siteOwner" },
        ],
      },
    );
    errorSpy.mockRestore();
    // The sick account is named AND diagnosed…
    expect(out).toContain("first@mail.test");
    expect(out).toMatch(/could not be read/i);
    // …in the SAME answer that still carries the healthy account's inventory.
    expect(out).toContain("healthy@mail.test");
    expect(out).toContain("https://still-listed.test/");
    expect(out).toMatch(/siteOwner/);
  });

  /**
   * LGP-1 — MEASURED LIVE 2026-09-02: two identical calls returned the SAME 27 properties in two
   * DIFFERENT orders, because the listing was printed in whatever order Google answered in. An
   * inventory a user compares against Search Console cannot reshuffle itself between two reads.
   *
   * The order is BYTE value, not `localeCompare`, for the reason track_gsc_property's own
   * `compareStrings` states: a locale-dependent answer differs between a developer's machine and
   * the server. The fixture is chosen so the two rules DISAGREE — byte order puts "B" before "a",
   * an English collation does not — so a `localeCompare` implementation cannot pass this.
   */
  describe("the property listing is in a fixed order", () => {
    const SHUFFLED: readonly GscSite[] = [
      { siteUrl: "sc-domain:zeta.test", permissionLevel: "siteOwner" },
      { siteUrl: "https://a-lower.test/", permissionLevel: "siteOwner" },
      { siteUrl: "https://B-upper.test/", permissionLevel: "siteOwner" },
    ];

    /** The property strings, in the order the answer actually printed them. */
    const listed = (out: string): string[] =>
      out
        .split("\n")
        .map((line) => /^ {2}- (\S+) /.exec(line)?.[1])
        .filter((property): property is string => property !== undefined);

    it("prints the same order whichever order Google answers in", async () => {
      const forward = await callTool({}, { sites: SHUFFLED });
      const reversed = await callTool({}, { sites: [...SHUFFLED].reverse() });
      expect(listed(forward)).toHaveLength(SHUFFLED.length);
      expect(reversed).toBe(forward);
    });

    it("orders properties by BYTE value, not by locale collation", async () => {
      expect(listed(await callTool({}, { sites: SHUFFLED }))).toEqual([
        "https://B-upper.test/",
        "https://a-lower.test/",
        "sc-domain:zeta.test",
      ]);
    });
  });

  /**
   * LGP-2 — MEASURED LIVE 2026-09-02, and it is the hole this tool exists to close. A project
   * whose Google account was disconnected keeps its `gsc_property` and loses its `account_id`.
   * Neither hint saw it: `readBy` requires the account to match (it is null), and the same-site
   * hint requires the property to be null (it is not). So `https://rkturizm.com/` and
   * `https://bayder.com.tr/` printed as "not used by any project" — with no hint at all — while
   * `list_projects` said of the same projects "still mapped and comes back when you run
   * connect_gsc". Two free tools, one truth, two answers.
   */
  describe("a property still mapped by a project whose Google account is gone", () => {
    it("names the project and the call that brings it back", async () => {
      const out = await callTool(
        {},
        {
          sites: [{ siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" }],
          mappings: [
            { property: "https://rkturizm.com/", domain: "rkturizm.com", accountId: null },
          ],
        },
      );
      expect(out).toContain('your project "rkturizm.com"');
      expect(out).toMatch(/no longer connected/i);
      expect(out).toMatch(/connect_gsc/);
      // NOT the empty answer, which is what the two hints produced before.
      expect(out).not.toMatch(/not used by any project/);
      // …and not the same-site hint either: that one offers track_gsc_property, which links a
      // property this project ALREADY holds. The repair here is the account, not the mapping.
      expect(out).not.toMatch(/track_gsc_property/);
    });

    it("still names it when ANOTHER project reads the same property live", async () => {
      // The axis lesson 14 names: a disconnected project must not become invisible merely
      // because a healthy sibling occupies the "read by" clause of the same line.
      const out = await callTool(
        {},
        {
          sites: [{ siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" }],
          mappings: [
            { property: "https://rkturizm.com/", domain: "live-reader.test" },
            { property: "https://rkturizm.com/", domain: "rkturizm.com", accountId: null },
          ],
        },
      );
      expect(out).toContain("read by live-reader.test");
      expect(out).toContain('your project "rkturizm.com"');
      expect(out).toMatch(/connect_gsc/);
    });

    it("says nothing of the sort for a project mapped to a DIFFERENT property", async () => {
      const out = await callTool(
        {},
        {
          sites: [{ siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" }],
          mappings: [
            { property: "sc-domain:somewhere-else.test", domain: "elsewhere.test", accountId: null },
          ],
        },
      );
      expect(out).toMatch(/not used by any project/);
      expect(out).not.toMatch(/no longer connected/i);
      expect(out).not.toContain("elsewhere.test");
    });
  });

  it("never shows another tenant's account or its properties", async () => {
    const out = await callTool(
      {},
      {
        sites: [{ siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" }],
        mappings: [{ property: "https://rkturizm.com/", domain: "adstark.com.tr" }],
        asUser: OTHER_USER,
      },
    );
    // Non-empty on purpose: the caller sees their OWN account, so this proves scoping rather
    // than an empty answer that any broken read would also produce.
    expect(out).toContain(FOREIGN_SITE.siteUrl);
    expect(out).not.toMatch(/rkturizm/);
    expect(out).not.toMatch(/adstark/);
    expect(out).not.toMatch(/first@mail\.test/);
  });

  it("credits a project to the account it actually reads through, not to a namesake", async () => {
    // The same property string can exist on two Google accounts; a project reads it through
    // exactly one (apps/web/app/app/connection/connection-view.ts inventoryRows).
    const out = await callTool(
      {},
      {
        sites: [{ siteUrl: "https://rkturizm.com/", permissionLevel: "siteFullUser" }],
        mappings: [
          { property: "https://rkturizm.com/", domain: "adstark.com.tr", accountId: OTHER_ACCOUNT_ID },
        ],
      },
    );
    expect(out).toMatch(/rkturizm\.com/);
    expect(out).not.toMatch(/adstark/);
  });

  /**
   * S4 — THE FIVE UNLINKED PAIRS, measured live 2026-08-25. Of 27 properties, five had a
   * matching project that was NOT linked to them; the tool printed both sides and never said
   * they belonged together, while linking them is one free call.
   *
   * The fifth pair is the `www.` one (`sc-domain:noraninsaat.com` ↔ `www.noraninsaat.com`), and
   * it is here because a match that fails on `www.` is precisely how the split started.
   */
  describe("an unlinked property whose site the caller already has a project for", () => {
    it("names the matching project and the call that links them", async () => {
      const out = await callTool(
        {},
        {
          sites: [{ siteUrl: "https://dentnotion.com/", permissionLevel: "siteOwner" }],
          mappings: [{ domain: "dentnotion.com" }],
        },
      );
      expect(out).toMatch(/not used by any project/);
      expect(out).toContain('your project "dentnotion.com" is the same site');
      expect(out).toMatch(/track_gsc_property/);
    });

    it("matches ACROSS a `www.` difference — the fifth measured pair", async () => {
      const out = await callTool(
        {},
        {
          sites: [{ siteUrl: "sc-domain:noraninsaat.com", permissionLevel: "siteOwner" }],
          mappings: [{ domain: "www.noraninsaat.com" }],
        },
      );
      expect(out).toContain('your project "www.noraninsaat.com" is the same site');
    });

    it("does NOT match a subdomain project to the apex property", async () => {
      // Only `www.` is cosmetic. Offering `blog.rkturizm.com` for the apex property would send
      // the user to bind two different sites together.
      const out = await callTool(
        {},
        {
          sites: [{ siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" }],
          mappings: [{ domain: "blog.rkturizm.com" }],
        },
      );
      expect(out).toMatch(/not used by any project/);
      expect(out).not.toMatch(/same site/);
      expect(out).not.toMatch(/blog\.rkturizm/);
    });

    it("says nothing about a project that already reads a DIFFERENT property", async () => {
      // That project is in a deliberate state; "link them" would mean REPOINT it, which is a
      // different act with a different consequence.
      const out = await callTool(
        {},
        {
          sites: [{ siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" }],
          mappings: [{ domain: "rkturizm.com", property: "sc-domain:rkturizm.com" }],
        },
      );
      expect(out).toMatch(/not used by any project/);
      expect(out).not.toMatch(/same site/);
    });

    it("stays silent when no project names that site", async () => {
      // The negative control: a note that appears for every unread property says nothing.
      const out = await callTool(
        {},
        {
          sites: [{ siteUrl: "https://rkturizm.com/", permissionLevel: "siteOwner" }],
          mappings: [{ domain: "adstark.com.tr" }],
        },
      );
      expect(out).toMatch(/not used by any project/);
      expect(out).not.toMatch(/same site/);
      expect(out).not.toMatch(/adstark/);
    });

    it("names both candidates, in byte order, when the tenant holds the pair", async () => {
      // The live account really does hold `seogrep.com` AND `www.seogrep.com`.
      const out = await callTool(
        {},
        {
          sites: [{ siteUrl: "sc-domain:seogrep.com", permissionLevel: "siteOwner" }],
          mappings: [{ domain: "www.seogrep.com" }, { domain: "seogrep.com" }],
        },
      );
      expect(out).toContain('your projects "seogrep.com", "www.seogrep.com" are the same site');
    });

    it("offers nothing for a property that names no website at all", async () => {
      const out = await callTool(
        {},
        {
          sites: [
            { siteUrl: "android-app://com.zephyrbrook.reader/", permissionLevel: "siteOwner" },
          ],
          mappings: [{ domain: "zephyrbrook.com" }],
        },
      );
      expect(out).toMatch(/not used by any project/);
      expect(out).not.toMatch(/same site/);
    });
  });

  it("says an account has no properties only when it actually answered with none", async () => {
    const out = await callTool({}, { sites: [] });
    expect(out).toMatch(/no search console properties/i);
    expect(out).not.toMatch(/could not be read/i);
  });

  it("tells a user with no connected account how to connect one — from ZERO projects", async () => {
    const out = await callTool({}, { asUser: "user-with-nothing" });
    expect(out).toMatch(/connect_gsc/);
    // connect_gsc REQUIRES a project_id, so an account with no projects cannot run it at all.
    // Naming only connect_gsc sends a brand-new user to a tool that will refuse them.
    expect(out).toMatch(/setup_project/);
    expect(out).not.toMatch(/could not be read/i);
  });

  /**
   * THE DEAD-vs-SLOW DISTINCTION. The failure sentence already ends with "or reconnect the
   * account on the Connection page", so what is new here is not the remedy — it is REMOVING the
   * false hope beside it. "Try again shortly" is a lie when Google has already refused the
   * refresh token: no amount of waiting mints a new one, and the user who waits is the user who
   * was charged 5 credits on 2026-08-09 for a pull that could never have succeeded.
   */
  describe("a Google connection the database already knows is dead", () => {
    it("drops the 'try again' hope and says the connection expired instead", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const out = await callTool({}, { sitesListFails: true, tokenStatus: "invalid" });
      errorSpy.mockRestore();

      expect(out).toMatch(/connection has expired/i);
      expect(out).toMatch(/reconnect/i);
      // The whole point: waiting is NOT offered for a state waiting cannot clear.
      expect(out).not.toMatch(/try again shortly/i);
    });

    it("says reconnect on the FIRST observation, not on the next call", async () => {
      // THE WINDOW THIS CLOSES. `tokenStatus` is read at the top of the handler, BEFORE
      // sites.list runs, so on the very first death the column still says "active" — the state
      // all 12 measured invalid_grant failures were in. Reporting on the stored row alone prints
      // "Try again shortly" in the one request that just watched Google refuse the token, and
      // the right sentence arrives only on a SECOND call the user has no reason to make.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const out = await callTool(
        {},
        {
          tokenStatus: "active",
          sitesListFails: true,
          sitesListError: "Google token endpoint failed (400): invalid_grant",
        },
      );
      errorSpy.mockRestore();

      expect(out).toMatch(/connection has expired/i);
      expect(out).not.toMatch(/try again shortly/i);
    });

    it("says reconnect on the first observation even if the status write fails", async () => {
      // The sentence must not depend on whether the DATABASE accepted the status: a blip that
      // downgraded "reconnect" back to "try again later" would leave the user retrying a
      // credential that can never work — the very failure the write is best-effort to avoid.
      statusWriteFails = true;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const out = await callTool(
        {},
        {
          tokenStatus: "active",
          sitesListFails: true,
          sitesListError: "Google token endpoint failed (400): invalid_grant",
        },
      );
      errorSpy.mockRestore();

      expect(out).toMatch(/connection has expired/i);
      expect(out).not.toMatch(/try again shortly/i);
    });

    it("keeps the transient sentence verbatim when nothing says the account is dead", async () => {
      // A 5xx, a timeout, a mis-sealed ciphertext: the cause is genuinely unknown, and sending
      // the user through an OAuth round on a guess is the mirror-image mistake.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const out = await callTool({}, { sitesListFails: true, tokenStatus: "active" });
      errorSpy.mockRestore();

      expect(out).toMatch(/try again shortly/i);
      expect(out).not.toMatch(/connection has expired/i);
    });

    it("names the dead connection even when THIS listing happened to succeed", async () => {
      // A status written moments ago by pull_gsc_data, and a sites.list still riding a valid
      // access token. Staying silent because this call worked would let the account look healthy
      // right up until the next paid pull fails.
      const out = await callTool(
        {},
        {
          tokenStatus: "invalid",
          sites: [{ siteUrl: "https://still-listed.test/", permissionLevel: "siteOwner" }],
        },
      );

      expect(out).toMatch(/connection has expired/i);
      // …and the inventory is still delivered: the warning adds a fact, it does not remove one.
      expect(out).toContain("https://still-listed.test/");
      expect(out).not.toMatch(/could not be read/i);
    });

    it("says nothing about expiry for a healthy account", async () => {
      const out = await callTool(
        {},
        { sites: [{ siteUrl: "https://healthy.test/", permissionLevel: "siteOwner" }] },
      );
      expect(out).not.toMatch(/connection has expired/i);
    });
  });

  /**
   * WHERE THE COLUMN GETS WRITTEN. This tool costs 0 credits and is the first thing a confused
   * user runs, so it is often where a revoked grant is SEEN first — and until the column is
   * written, every other surface (the discovery tools' warning, the Connection badge, Overview)
   * is blind to it.
   */
  describe("recording a death it observed", () => {
    const DEAD = "Google token endpoint failed (400): invalid_grant";

    it("marks the account invalid when Google itself refused the refresh token", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await callTool({}, { sitesListFails: true, sitesListError: DEAD });
      errorSpy.mockRestore();

      // The CALLER's user id rides with it: the write is tenant-filtered downstream, and handing
      // it somebody else's id would flip a stranger's account (NEVER #4).
      expect(statusWrites).toEqual([{ accountId: ACCOUNT_ID, userId: USER }]);
    });

    it("never marks a live account dead over a transient failure", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await callTool({}, { sitesListFails: true, sitesListError: "fixture: Google 503" });
      errorSpy.mockRestore();

      expect(statusWrites).toEqual([]);
    });

    it("a failed status write costs the user nothing but a log line", async () => {
      // Best-effort, exactly as pull_gsc_data's own catch is: a DB blip must not delete the
      // listing the user asked for.
      statusWriteFails = true;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const out = await callTool(
        {},
        {
          sitesListFails: true,
          sitesListError: DEAD,
          secondAccountSites: [
            { siteUrl: "https://survives.test/", permissionLevel: "siteOwner" },
          ],
        },
      );
      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
      errorSpy.mockRestore();

      expect(statusWrites).toEqual([{ accountId: ACCOUNT_ID, userId: USER }]);
      expect(logged).toMatch(/failed to mark account .* invalid/i);
      // The answer is intact — both accounts, the sick one diagnosed and the healthy one listed.
      expect(out).toContain("https://survives.test/");
      // Diagnosed from the failure we JUST saw, so the DIAGNOSIS survives the failed write: the
      // user is told to reconnect even though nothing could be recorded about it.
      expect(out).toMatch(/connection has expired/i);
      expect(out).not.toMatch(/try again shortly/i);
    });
  });

  /**
   * THE READER ITSELF, which no injected-port spec can reach. The DB lane measures this against a
   * real database and does not run without the local stack, so the column list — the difference
   * between a warning that exists and one that never fires — is pinned here too.
   */
  describe("loadGscAccounts (the production reader)", () => {
    it("asks gsc_accounts for the token status, scoped to the caller", async () => {
      accountTableRows = [
        {
          id: "acct-1",
          user_id: USER,
          google_account_email: "reader@mail.test",
          token_status: "invalid",
        },
        {
          id: "acct-foreign",
          user_id: OTHER_USER,
          google_account_email: "stranger@mail.test",
          token_status: "invalid",
        },
      ];

      const accounts = await loadGscAccounts(USER);

      // MUTATION TARGET: drop `token_status` from the select and this goes red — the fake
      // projects what was asked for, so the tool would render every dead account as healthy.
      expect(selectOwnCalls).toEqual([
        { table: "gsc_accounts", columns: "id, google_account_email, token_status" },
      ]);
      expect(accounts).toEqual([
        { id: "acct-1", email: "reader@mail.test", tokenStatus: "invalid" },
      ]);
      // NEVER #4, head-on: the read is scoped to the CALLER, and another tenant's account is
      // indistinguishable from no account — status column included.
      expect(scopedUserIds).toEqual([USER]);
      expect(accounts.map((account) => account.email)).not.toContain("stranger@mail.test");
    });

    /**
     * LGP-3 — the reader's own header declares "Accounts, ordered by email so the output does not
     * depend on scan order", and on 2026-09-02 nothing measured it: dropping the sort left all
     * 3680 tests green. With one connected account the promise is invisible; the second account
     * makes every block of the answer depend on whatever order the table was scanned in.
     */
    it("orders accounts by email, whatever order the table answers in", async () => {
      accountTableRows = [
        { id: "acct-c", user_id: USER, google_account_email: "ccc@mail.test", token_status: null },
        { id: "acct-a", user_id: USER, google_account_email: "aaa@mail.test", token_status: null },
        { id: "acct-b", user_id: USER, google_account_email: "bbb@mail.test", token_status: null },
      ];

      const accounts = await loadGscAccounts(USER);

      expect(accounts.map((account) => account.email)).toEqual([
        "aaa@mail.test",
        "bbb@mail.test",
        "ccc@mail.test",
      ]);
    });

    it("reads a row that has never been checked as null, never as dead", async () => {
      accountTableRows = [
        { id: "acct-1", user_id: USER, google_account_email: "fresh@mail.test", token_status: null },
      ];
      expect(await loadGscAccounts(USER)).toEqual([
        { id: "acct-1", email: "fresh@mail.test", tokenStatus: null },
      ]);
    });
  });

  it("is a 0-credit tool that takes no parameters", () => {
    const tool = toolFor({});
    expect(tool.name).toBe("list_gsc_properties");
    expect(tool.description).toMatch(/0 credits/i);
    const schema = tool.inputJsonSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {})).toEqual([]);
  });
});
