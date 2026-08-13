import { describe, expect, it, vi } from "vitest";
import type { GscSite } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import type { GscAccountSummary } from "./list-gsc-properties.ts";
import type { ProjectResolution } from "./setup-project.ts";
import { makeTrackGscPropertyTool, type OpenProjectFn } from "./track-gsc-property.ts";

/**
 * Fast-lane (DB-less) proofs for track_gsc_property. Every port is injected, so this file
 * touches neither the database nor Google (NEVER #5).
 *
 * WHAT THIS FILE MEASURES, and what it deliberately leaves to the DB lane. The four refusals
 * are the subject here, and each one is measured by the STRONGEST available statement: the
 * project-opening port was NEVER CALLED. "No project row exists afterwards" is the weaker
 * claim — it also holds when a project was attempted and something else refused it — so the
 * row counts stay in track-gsc-property.db.test.ts, against the real `projects` table and the
 * real create/restore path. Nothing here fakes that path's rules.
 *
 * The fakes MODEL the constraints the real readers carry rather than ignoring them (signed
 * lesson 12): `listAccountSites` THROWS when the (accountId, userId) pair do not own each
 * other, the way the real `(id, user_id)`-filtered read finds nothing.
 *
 * Fixture values share no substring with any sentence the tool prints — the trap Task 3 fell
 * into. In particular the not-listed fixture is `zephyrbrook.com`, NOT a `.test` name: `.test`
 * is a reserved TLD that `normalizeDomain` refuses on its own, so a `.test` fixture would let
 * "no project was opened" pass even with the listing check deleted.
 */

const USER = "user-track";
const CTX: AuthContext = { userId: USER, keyId: "key-track" };

const ACCOUNT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ACCOUNT_EMAIL = "primary@mail.invalid";
const SECOND_ACCOUNT_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const SECOND_ACCOUNT_EMAIL = "secondary@mail.invalid";
/** An id belonging to nobody in this world — used for the "not your account" probe. */
const FOREIGN_ACCOUNT_ID = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

const TRACKED: GscSite = { siteUrl: "sc-domain:katrenur.com", permissionLevel: "siteOwner" };
const UNQUERYABLE: GscSite = {
  siteUrl: "sc-domain:modnco.com",
  permissionLevel: "siteUnverifiedUser",
};

interface World {
  /** What the FIRST account lists. */
  readonly sites?: readonly GscSite[];
  /** A second connected account and what it lists (absent = the tenant has one account). */
  readonly secondAccountSites?: readonly GscSite[];
  /** Make the FIRST account's sites.list fail, the way a dead credential does. */
  readonly sitesListFails?: boolean;
  /** Call as somebody with no connected account at all. */
  readonly asUser?: string;
}

function accountsOf(userId: string, world: World): GscAccountSummary[] {
  if (userId !== USER) return [];
  const first = { id: ACCOUNT_ID, email: ACCOUNT_EMAIL };
  return world.secondAccountSites
    ? [first, { id: SECOND_ACCOUNT_ID, email: SECOND_ACCOUNT_EMAIL }]
    : [first];
}

/** One run's recording of what the tool did to the two write ports. */
interface Recorder {
  readonly opened: { userId: string; domain: string }[];
  readonly mapped: {
    userId: string;
    projectId: string;
    accountId: string;
    property: string;
  }[];
}

function toolFor(world: World, recorder: Recorder, openProject?: OpenProjectFn) {
  return makeTrackGscPropertyTool({
    loadAccounts: (userId) => Promise.resolve(accountsOf(userId, world)),
    listAccountSites: (accountId, userId) => {
      if (!accountsOf(userId, world).some((account) => account.id === accountId)) {
        throw new Error(`fixture: account ${accountId} is not owned by ${userId}`);
      }
      if (accountId === SECOND_ACCOUNT_ID) {
        return Promise.resolve([...(world.secondAccountSites ?? [])]);
      }
      if (world.sitesListFails) return Promise.reject(new Error("fixture: sites.list refused"));
      return Promise.resolve([...(world.sites ?? [])]);
    },
    openProject:
      openProject ??
      ((userId, domain): Promise<ProjectResolution> => {
        recorder.opened.push({ userId, domain });
        return Promise.resolve({
          ok: true,
          project: { id: "3d4e5f6a-7b8c-4d9e-8f01-2a3b4c5d6e7f", domain, outcome: "created" },
        });
      }),
    mapProperty: (args) => {
      recorder.mapped.push({ ...args });
      return Promise.resolve();
    },
  });
}

interface Run {
  readonly text: string;
  readonly isError: boolean;
  readonly recorder: Recorder;
}

async function callTool(
  input: Record<string, unknown>,
  world: World = {},
  openProject?: OpenProjectFn,
): Promise<Run> {
  const recorder: Recorder = { opened: [], mapped: [] };
  const result = await toolFor(world, recorder, openProject).run(
    { ...CTX, userId: world.asUser ?? USER },
    input,
  );
  return {
    text: result.content.map((part) => part.text).join("\n"),
    isError: result.isError === true,
    recorder,
  };
}

describe("track_gsc_property", () => {
  it("opens the project for a listed, queryable property and maps the property to it", async () => {
    const run = await callTool({ property: TRACKED.siteUrl }, { sites: [TRACKED] });

    expect(run.isError).toBe(false);
    expect(run.text).toMatch(/katrenur\.com/);
    // The domain came from the PROPERTY, and it is the one the project was opened for.
    expect(run.recorder.opened).toEqual([{ userId: USER, domain: "katrenur.com" }]);
    // The mapping names the account the property was actually found on — not a default, and
    // not something the caller supplied.
    expect(run.recorder.mapped).toEqual([
      {
        userId: USER,
        projectId: "3d4e5f6a-7b8c-4d9e-8f01-2a3b4c5d6e7f",
        accountId: ACCOUNT_ID,
        property: "sc-domain:katrenur.com",
      },
    ]);
  });

  it("refuses a property no connected account lists, and opens NO project", async () => {
    // Nothing arriving in the input is evidence (PropertyPicker's rule): the property must be
    // found in a live sites.list answer or it does not exist as far as this tool is concerned.
    const run = await callTool({ property: "sc-domain:zephyrbrook.com" }, { sites: [TRACKED] });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/not listed/i);
    expect(run.recorder.opened).toEqual([]);
    expect(run.recorder.mapped).toEqual([]);
  });

  it("refuses an unqueryable property BEFORE any project is opened, and says why", async () => {
    // Validation step 2. A property SeoGrep cannot query must never leave a project row
    // behind: that row would look tracked and answer nothing. Deleting the
    // canQuerySearchAnalytics check turns THIS spec red (the brief's step-6 mutation).
    const run = await callTool({ property: UNQUERYABLE.siteUrl }, { sites: [UNQUERYABLE] });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/siteUnverifiedUser/);
    expect(run.text).toMatch(/cannot be queried/i);
    expect(run.recorder.opened).toEqual([]);
    expect(run.recorder.mapped).toEqual([]);
  });

  it("refuses a property whose string names no website domain, and opens NO project", async () => {
    // Validation step 3. Search Console really does carry android-app:// properties, and
    // propertyToDomain answers null for them rather than guessing a host.
    const androidApp: GscSite = {
      siteUrl: "android-app://com.zephyrbrook.reader/",
      permissionLevel: "siteOwner",
    };
    const run = await callTool({ property: androidApp.siteUrl }, { sites: [androidApp] });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/does not recognise/i);
    expect(run.recorder.opened).toEqual([]);
    expect(run.recorder.mapped).toEqual([]);
  });

  it("asks WHICH account when two connected accounts list the same property", async () => {
    // The operator's own live account shows this is not hypothetical: the same property string
    // can sit on two Google accounts, and the project reads it through exactly one. Guessing
    // would bind the project to a credential the user did not choose.
    const run = await callTool(
      { property: TRACKED.siteUrl },
      { sites: [TRACKED], secondAccountSites: [TRACKED] },
    );

    expect(run.isError).toBe(true);
    expect(run.text).toContain(ACCOUNT_ID);
    expect(run.text).toContain(SECOND_ACCOUNT_ID);
    expect(run.text).toMatch(/account_id/);
    expect(run.recorder.opened).toEqual([]);
  });

  it("uses the account_id the caller named when more than one lists the property", async () => {
    const run = await callTool(
      { property: TRACKED.siteUrl, account_id: SECOND_ACCOUNT_ID },
      { sites: [TRACKED], secondAccountSites: [TRACKED] },
    );

    expect(run.isError).toBe(false);
    expect(run.recorder.mapped).toEqual([
      {
        userId: USER,
        projectId: "3d4e5f6a-7b8c-4d9e-8f01-2a3b4c5d6e7f",
        accountId: SECOND_ACCOUNT_ID,
        property: "sc-domain:katrenur.com",
      },
    ]);
  });

  it("answers an account_id that is not the caller's exactly like a property that is not listed", async () => {
    // No existence oracle: another tenant's account id and a typo produce the same sentence,
    // and neither reaches that account's listing (the fake would throw if it were asked).
    const run = await callTool(
      { property: TRACKED.siteUrl, account_id: FOREIGN_ACCOUNT_ID },
      { sites: [TRACKED] },
    );

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/not listed/i);
    expect(run.recorder.opened).toEqual([]);
  });

  it("does not call a property NOT LISTED when the account could not be read at all", async () => {
    // An absence we did not observe is not an absence (AccountInventory's rule). Telling the
    // user their property is not listed would send them to Search Console to verify a property
    // that was there all along; the answer is to reconnect.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = await callTool({ property: TRACKED.siteUrl }, { sitesListFails: true });
    errorSpy.mockRestore();

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/could not be read/i);
    expect(run.text).not.toMatch(/not listed/i);
    expect(run.recorder.opened).toEqual([]);
  });

  it("still finds the property on a healthy account when ANOTHER account cannot be read", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = await callTool(
      { property: TRACKED.siteUrl },
      { sitesListFails: true, secondAccountSites: [TRACKED] },
    );
    errorSpy.mockRestore();

    expect(run.isError).toBe(false);
    expect(run.recorder.mapped[0]?.accountId).toBe(SECOND_ACCOUNT_ID);
  });

  it("tells a user with no connected Google account how to connect one", async () => {
    const run = await callTool({ property: TRACKED.siteUrl }, { asUser: "user-with-nothing" });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/connect_gsc/);
    expect(run.recorder.opened).toEqual([]);
  });

  it("passes a refusal from the project-opening path straight through, and maps nothing", async () => {
    // The project route is setup_project's, refusals included — this tool does not paper over
    // one. The real refusal it produces (a non-public host) is measured in the DB lane, where
    // the real normalizer runs.
    const run = await callTool({ property: TRACKED.siteUrl }, { sites: [TRACKED] }, () =>
      Promise.resolve({ ok: false, error: "fixture: the project route refused this domain" }),
    );

    expect(run.isError).toBe(true);
    expect(run.text).toContain("fixture: the project route refused this domain");
    expect(run.recorder.mapped).toEqual([]);
  });

  it("is a 0-credit tool that takes a property and an optional account_id", () => {
    const tool = toolFor({}, { opened: [], mapped: [] });
    expect(tool.name).toBe("track_gsc_property");
    expect(tool.description).toMatch(/0 credits/i);
    const schema = tool.inputJsonSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["account_id", "property"]);
    expect(schema.required).toEqual(["property"]);
  });
});
