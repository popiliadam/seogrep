import { describe, expect, it, vi } from "vitest";
import type { GscSite } from "@pseo/core";
import { openTrackedProject, type ProjectsClient } from "@pseo/db/projects";
import type { AuthContext } from "../auth.ts";
import type { GscAccountSummary, ListAccountSitesFn } from "./list-gsc-properties.ts";
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
    // An absence we did not observe is not an absence. Telling the
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

  it("REFUSES to bind when a healthy account lists it but ANOTHER account could not be read", async () => {
    // CONTROLLER RULING (2026-08-13). This spec previously pinned the OPPOSITE — that the tool
    // proceeds on the healthy account. The required BEHAVIOUR changed, so the spec changed with
    // it: that is a scope change, not a weakened assertion (NEVER #8 forbids editing a test to
    // make code pass, which is not what this is).
    //
    // Why the behaviour changed: the ambiguity guard can only weigh accounts that ANSWERED. The
    // silent one might list this property too, and had it answered the tool would be refusing.
    // Proceeding therefore lets a transient Google outage decide which credential the project
    // binds to — the single thing the ambiguity guard exists to never guess.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = await callTool(
      { property: TRACKED.siteUrl },
      { sitesListFails: true, secondAccountSites: [TRACKED] },
    );
    errorSpy.mockRestore();

    expect(run.isError).toBe(true);
    // (a) it says where the property WAS found…
    expect(run.text).toContain(SECOND_ACCOUNT_EMAIL);
    // (b) …and names the account that could not be read.
    expect(run.text).toContain(ACCOUNT_EMAIL);
    expect(run.text).toMatch(/could not be read/i);
    // (c) both ways forward.
    expect(run.text).toMatch(/account_id/);
    expect(run.text).toMatch(/wait until|run it again/i);
    // Nothing was bound and nothing was created.
    expect(run.recorder.opened).toEqual([]);
    expect(run.recorder.mapped).toEqual([]);
  });

  it("still binds when the caller NAMES the account, even though another one is unreadable", async () => {
    // The first way forward the refusal above offers must actually work — a refusal pointing at
    // a remedy that also fails is a dead end. Naming an account means no other account is asked,
    // so nothing is left unread behind the caller's back and there is nothing to fail closed on.
    const run = await callTool(
      { property: TRACKED.siteUrl, account_id: SECOND_ACCOUNT_ID },
      { sitesListFails: true, secondAccountSites: [TRACKED] },
    );

    expect(run.isError).toBe(false);
    expect(run.recorder.mapped[0]?.accountId).toBe(SECOND_ACCOUNT_ID);
  });

  it("tells a user with no connected Google account how to connect one — from ZERO projects", async () => {
    const run = await callTool({ property: TRACKED.siteUrl }, { asUser: "user-with-nothing" });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/connect_gsc/);
    // connect_gsc REQUIRES a project_id and refuses without one, so a brand-new account was
    // being pointed at a step it could not take, with the step it COULD take left unnamed.
    expect(run.text).toMatch(/setup_project/);
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

  /**
   * B20b — the near-miss suggestion. `list_gsc_properties` prints properties exactly as Google
   * spells them and this tool matches them exactly, so a lowercase letter or a trailing slash
   * the user dropped produces a flat "not listed" for a property that is right there.
   *
   * The suggestion is deliberately DUMB. It is one copy-paste from becoming the property a
   * project binds to, and a wrong binding only surfaces when the data stops making sense — so a
   * plausible-looking wrong suggestion is worse than none. Only differences that cannot change
   * which site is named qualify: letter case, and a trailing slash on a URL-prefix property.
   */
  it("suggests the listed property when only a trailing slash differs", async () => {
    const listed: GscSite = { siteUrl: "https://katrenur.com/", permissionLevel: "siteOwner" };
    const run = await callTool({ property: "https://katrenur.com" }, { sites: [listed] });

    expect(run.isError).toBe(true);
    expect(run.text).toContain('Did you mean "https://katrenur.com/"?');
    expect(run.recorder.opened).toEqual([]); // a suggestion is not a binding
  });

  it("suggests the listed property when only letter case differs", async () => {
    const run = await callTool({ property: "SC-DOMAIN:Katrenur.COM" }, { sites: [TRACKED] });

    expect(run.isError).toBe(true);
    expect(run.text).toContain('Did you mean "sc-domain:katrenur.com"?');
  });

  it("suggests NOTHING for an unrelated property, however many are listed", async () => {
    const run = await callTool(
      { property: "sc-domain:zephyrbrook.com" },
      { sites: [TRACKED, UNQUERYABLE] },
    );

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/not listed/i);
    expect(run.text).not.toMatch(/did you mean/i);
  });

  /**
   * `sc-domain:katrenur.com` and `https://katrenur.com/` are two DIFFERENT Search Console
   * properties for one site, with different data and different permissions. They look like a
   * cosmetic pair and are not, which is exactly why the rule is a canonical-form comparison
   * rather than a similarity score.
   */
  it("does not suggest a URL-prefix property for a domain property (or the reverse)", async () => {
    const run = await callTool({ property: "https://katrenur.com/" }, { sites: [TRACKED] });

    expect(run.isError).toBe(true);
    expect(run.text).not.toMatch(/did you mean/i);
  });

  it("suggests nothing when an account could not be read — that path says so instead", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = await callTool({ property: "sc-domain:KATRENUR.com" }, { sitesListFails: true });
    errorSpy.mockRestore();

    expect(run.text).toMatch(/could not be read/i);
    expect(run.text).not.toMatch(/did you mean/i);
  });

  /**
   * The property's host travels to the project route AS GOOGLE NAMES IT, `www.` and all. The
   * canonicalization is the route's job and happens inside it (see the `www.` describe block at
   * the bottom of this file, which drives the REAL route); `propertyToDomain` deliberately does
   * not pre-empt it, because it answers "what host does this property name", not "what is this
   * site called".
   */
  it("hands the project route the host the property actually names", async () => {
    const wwwSite: GscSite = {
      siteUrl: "sc-domain:www.noraninsaat.com",
      permissionLevel: "siteOwner",
    };
    const run = await callTool({ property: wwwSite.siteUrl }, { sites: [wwwSite] });

    expect(run.isError).toBe(false);
    expect(run.recorder.opened).toEqual([{ userId: USER, domain: "www.noraninsaat.com" }]);
    // The MAPPING carries Google's own spelling — that string is what sites.list returns and
    // what searchAnalytics.query has to be asked for.
    expect(run.recorder.mapped[0]?.property).toBe("sc-domain:www.noraninsaat.com");
  });

  /**
   * B-S4 — the bare host a customer speaks. Measured live: `track_gsc_property("dentnotion.com")`
   * was refused as "not listed on any Google account you have connected" while
   * `https://dentnotion.com/` sat in the SAME listing as the only candidate.
   */
  it("resolves a bare host to the ONE listed property that names it", async () => {
    const listed: GscSite = { siteUrl: "https://katrenur.com/", permissionLevel: "siteOwner" };
    const run = await callTool({ property: "katrenur.com" }, { sites: [listed] });

    expect(run.isError).toBe(false);
    expect(run.recorder.opened).toEqual([{ userId: USER, domain: "katrenur.com" }]);
    // Bound to Google's spelling of the property, never to the host the caller typed.
    expect(run.recorder.mapped[0]?.property).toBe("https://katrenur.com/");
    expect(run.text).toContain("https://katrenur.com/");
  });

  it("resolves a bare host across a `www.` difference in the property", async () => {
    const listed: GscSite = {
      siteUrl: "sc-domain:www.katrenur.com",
      permissionLevel: "siteFullUser",
    };
    const run = await callTool({ property: "katrenur.com" }, { sites: [listed] });

    expect(run.isError).toBe(false);
    expect(run.recorder.mapped[0]?.property).toBe("sc-domain:www.katrenur.com");
  });

  /**
   * …and it must NOT choose for the caller. `sc-domain:x` and `https://x/` are two different
   * properties with different data; picking one binds a project to a source, and the wrong bind
   * is only discovered when the numbers stop making sense.
   */
  it("OFFERS THE CHOICE when a bare host matches more than one property, and binds nothing", async () => {
    const run = await callTool(
      { property: "katrenur.com" },
      {
        sites: [
          TRACKED,
          { siteUrl: "https://katrenur.com/", permissionLevel: "siteOwner" },
        ],
      },
    );

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/more than one/i);
    expect(run.text).toContain("sc-domain:katrenur.com");
    expect(run.text).toContain("https://katrenur.com/");
    expect(run.recorder.opened).toEqual([]);
    expect(run.recorder.mapped).toEqual([]);
  });

  it("names the candidates in the same order however the listing arrives", async () => {
    const urlPrefix: GscSite = { siteUrl: "https://katrenur.com/", permissionLevel: "siteOwner" };
    const forward = await callTool({ property: "katrenur.com" }, { sites: [TRACKED, urlPrefix] });
    const reversed = await callTool({ property: "katrenur.com" }, { sites: [urlPrefix, TRACKED] });

    expect(forward.text).toBe(reversed.text);
  });

  it("does not read a bare host as a SUBDOMAIN's property, or the reverse", async () => {
    // Only `www.` is cosmetic. A blog on its own property is a different site.
    const blog: GscSite = { siteUrl: "sc-domain:blog.katrenur.com", permissionLevel: "siteOwner" };
    const run = await callTool({ property: "katrenur.com" }, { sites: [blog] });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/not listed/i);
    expect(run.recorder.opened).toEqual([]);
  });

  it("does not resolve a host that no listed property names", async () => {
    const run = await callTool({ property: "zephyrbrook.com" }, { sites: [TRACKED] });

    expect(run.isError).toBe(true);
    expect(run.text).toMatch(/not listed/i);
    expect(run.recorder.opened).toEqual([]);
  });

  it("leaves an EXACT property match alone — host resolution never reinterprets it", async () => {
    // `sc-domain:katrenur.com` is listed and so is the URL-prefix property for the same site.
    // The caller spelled one of them correctly, so the choice message must NOT appear.
    const run = await callTool(
      { property: TRACKED.siteUrl },
      { sites: [TRACKED, { siteUrl: "https://katrenur.com/", permissionLevel: "siteOwner" }] },
    );

    expect(run.isError).toBe(false);
    expect(run.recorder.mapped[0]?.property).toBe("sc-domain:katrenur.com");
  });

  /**
   * The already-tracked sentence used to shift subject halfway through: `Project "x" was already
   * tracked (project_id: …) and set it to read <property> through <email>` — "Project x … set
   * it" has no grammatical subject for the second clause. Product language is English and this
   * string is customer-visible.
   */
  it("says the already-tracked outcome in ONE grammatical sentence", async () => {
    const run = await callTool({ property: TRACKED.siteUrl }, { sites: [TRACKED] }, () =>
      Promise.resolve({
        ok: true,
        project: {
          id: "3d4e5f6a-7b8c-4d9e-8f01-2a3b4c5d6e7f",
          domain: "katrenur.com",
          outcome: "existing",
        },
      }),
    );

    expect(run.isError).toBe(false);
    expect(run.text).toContain(
      'Project "katrenur.com" was already tracked (project_id: ' +
        "3d4e5f6a-7b8c-4d9e-8f01-2a3b4c5d6e7f); it now reads sc-domain:katrenur.com through " +
        `${ACCOUNT_EMAIL}.`,
    );
    // The broken clause, pinned by its shape so a rewording cannot bring it back unnoticed.
    expect(run.text).not.toMatch(/was already tracked[^.]*and set it to/i);
  });

  it("keeps the created and restored sentences reading as one clause each", async () => {
    const created = await callTool({ property: TRACKED.siteUrl }, { sites: [TRACKED] });
    expect(created.text).toMatch(/^Created project "katrenur\.com" \(project_id: .+\) and set it to read sc-domain:katrenur\.com through /);

    const restored = await callTool({ property: TRACKED.siteUrl }, { sites: [TRACKED] }, () =>
      Promise.resolve({
        ok: true,
        project: {
          id: "3d4e5f6a-7b8c-4d9e-8f01-2a3b4c5d6e7f",
          domain: "katrenur.com",
          outcome: "restored",
        },
      }),
    );
    expect(restored.text).toMatch(/^Restored "katrenur\.com" from your archive \(project_id: .+\) and set it to read /);
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

/**
 * B20a — STEP 1 asks every candidate account AT ONCE, and the refusals it produces do not
 * depend on the order the accounts came back in.
 *
 * These need more than the two accounts the World fixture models, and they drive the reads
 * directly rather than through it, so the specs above stay exactly as they were — that they
 * pass unchanged is itself the evidence that going parallel altered no behaviour.
 */
describe("track_gsc_property STEP 1 (parallel, order-independent)", () => {
  /** Three accounts, deliberately NOT in email order — the order a query might hand back. */
  const ACCOUNTS: GscAccountSummary[] = [
    { id: "acc-zeta", email: "zeta@mail.invalid" },
    { id: "acc-alpha", email: "alpha@mail.invalid" },
    { id: "acc-mid", email: "mid@mail.invalid" },
  ];

  /** Build the tool over an explicit account list and a per-account sites answer. */
  function toolOver(
    accounts: readonly GscAccountSummary[],
    sitesFor: ListAccountSitesFn,
  ) {
    return makeTrackGscPropertyTool({
      loadAccounts: () => Promise.resolve([...accounts]),
      listAccountSites: sitesFor,
      openProject: () =>
        Promise.resolve({
          ok: true,
          project: { id: "3d4e5f6a-7b8c-4d9e-8f01-2a3b4c5d6e7f", domain: "katrenur.com", outcome: "created" },
        } satisfies ProjectResolution),
      mapProperty: () => Promise.resolve(),
    });
  }

  async function textOf(
    accounts: readonly GscAccountSummary[],
    sitesFor: (accountId: string) => Promise<GscSite[]>,
  ): Promise<string> {
    const result = await toolOver(accounts, sitesFor).run(CTX, { property: TRACKED.siteUrl });
    return result.content.map((part) => part.text).join("\n");
  }

  /** Every account fails except `listedOn`, which lists the tracked property. */
  function onlyOneAnswers(listedOn: string) {
    return (accountId: string): Promise<GscSite[]> =>
      accountId === listedOn
        ? Promise.resolve([TRACKED])
        : Promise.reject(new Error("fixture: sites.list refused"));
  }

  /**
   * THE OVERLAP ITSELF. Each account's read parks on a barrier that is only released once ALL
   * THREE have started, so this test can only finish if the three reads are in flight together.
   * A serial `for await` never starts the second one and the test times out.
   *
   * The timeout is short on purpose: a regression here should cost a second, not the default.
   */
  it("starts every account's read before any of them finishes", { timeout: 1500 }, async () => {
    let started = 0;
    let release = (): void => undefined;
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const text = await textOf(ACCOUNTS, async (accountId) => {
      started += 1;
      if (started === ACCOUNTS.length) release();
      await allStarted;
      return accountId === "acc-alpha" ? [TRACKED] : [];
    });
    expect(started).toBe(3);
    expect(text).toMatch(/katrenur\.com/); // and it still bound the project, on the one match
  });

  /**
   * DETERMINISM. `Promise.all` preserves INPUT order, and the input is whatever order the
   * accounts query happened to return — which nothing pins. Two accounts unreadable and one
   * holding the property must therefore produce a byte-identical refusal either way round.
   */
  it("names the unreadable accounts in the same order whatever order they arrive in", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const forward = await textOf(ACCOUNTS, onlyOneAnswers("acc-alpha"));
    const reversed = await textOf([...ACCOUNTS].reverse(), onlyOneAnswers("acc-alpha"));
    errorSpy.mockRestore();

    expect(forward).toBe(reversed);
    // Fail-closed, unchanged: one account answered and holds it, two are silent -> refuse.
    expect(forward).toMatch(/could not be read/i);
    expect(forward).toContain("alpha@mail.invalid"); // where it WAS found
    // ...and the silent ones, alphabetically, not in arrival order.
    expect(forward).toContain("mid@mail.invalid, zeta@mail.invalid");
  });

  it("keeps the all-unreadable refusal deterministic too", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const allFail = (): Promise<GscSite[]> =>
      Promise.reject(new Error("fixture: sites.list refused"));
    const forward = await textOf(ACCOUNTS, allFail);
    const reversed = await textOf([...ACCOUNTS].reverse(), allFail);
    errorSpy.mockRestore();

    expect(forward).toBe(reversed);
    expect(forward).toContain("alpha@mail.invalid, mid@mail.invalid, zeta@mail.invalid");
    expect(forward).not.toMatch(/not listed/i);
  });

  /**
   * WHICH order, not merely A CONSISTENT one.
   *
   * Every other fixture in this file uses lowercase ASCII emails, where byte order and locale
   * order agree — so all of them pass just as happily with `localeCompare` as with the byte
   * comparator, and none of them measures the choice. The choice matters: `localeCompare` reads
   * the RUNTIME's locale (and ICU version), so the same two accounts can be named in one order
   * on a developer's Mac and the other order on the server, which is precisely the drift the
   * sort was added to eliminate.
   *
   * A capitalised email separates them. Google account emails are stored as the user typed
   * them, so mixed case is ordinary rather than exotic:
   *   byte order    -> "Zeta@…", "alpha@…"   ('Z' is 0x5A, 'a' is 0x61)
   *   localeCompare -> "alpha@…", "Zeta@…"   (en collation folds case)
   * The assertion names the byte order explicitly, so swapping the comparator turns it red.
   */
  it("orders accounts by BYTE value, not by locale collation", async () => {
    const mixedCase: GscAccountSummary[] = [
      { id: "acc-upper-zeta", email: "Zeta@mail.invalid" },
      { id: "acc-lower-alpha", email: "alpha@mail.invalid" },
    ];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const allFail = (): Promise<GscSite[]> =>
      Promise.reject(new Error("fixture: sites.list refused"));
    const forward = await textOf(mixedCase, allFail);
    const reversed = await textOf([...mixedCase].reverse(), allFail);
    errorSpy.mockRestore();

    // Still order-independent...
    expect(forward).toBe(reversed);
    // ...and the order it settles on is the byte one. Under localeCompare this reads
    // "alpha@mail.invalid, Zeta@mail.invalid" and this assertion fails.
    expect(forward).toContain("Zeta@mail.invalid, alpha@mail.invalid");
  });

  it("keeps the ambiguous refusal deterministic when several accounts list it", async () => {
    const everyoneListsIt = (): Promise<GscSite[]> => Promise.resolve([TRACKED]);
    const forward = await textOf(ACCOUNTS, everyoneListsIt);
    const reversed = await textOf([...ACCOUNTS].reverse(), everyoneListsIt);

    expect(forward).toBe(reversed);
    expect(forward).toMatch(/more than one/i);
    // Named in email order, so the sentence does not shuffle between runs.
    expect(forward.indexOf("alpha@mail.invalid")).toBeLessThan(forward.indexOf("mid@mail.invalid"));
    expect(forward.indexOf("mid@mail.invalid")).toBeLessThan(forward.indexOf("zeta@mail.invalid"));
  });

  /**
   * ONE DEAD CREDENTIAL IS NOT AN OUTAGE. A single account's failure must never swallow the
   * accounts that answered perfectly well — that is the difference between "your property is
   * not on this account" and "nothing could be read", and this tool's whole discipline rests
   * on keeping the two apart.
   */
  it("still reads the healthy accounts when one account's credential is dead", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const text = await textOf(ACCOUNTS, (accountId) =>
      accountId === "acc-zeta"
        ? Promise.reject(new Error("fixture: sites.list refused"))
        : Promise.resolve(accountId === "acc-alpha" ? [TRACKED] : []),
    );
    errorSpy.mockRestore();

    // alpha's listing was READ (it is named as where the property was found), and only zeta is
    // reported as unreadable — mid answered "no properties" and is not confused with it.
    expect(text).toContain("alpha@mail.invalid");
    expect(text).toContain("zeta@mail.invalid");
    expect(text).not.toContain("mid@mail.invalid");
  });
});

/**
 * S4 — THE `www.` SPLIT, END TO END, over the REAL project route.
 *
 * Measured live 2026-08-25: `track_gsc_property("sc-domain:noraninsaat.com")` created a SECOND
 * project although `www.noraninsaat.com` already existed. Crawl history then lived on one
 * project and Search Console data on the other, and every tool that joins the two
 * (find_quick_wins, analyze_content_decay, detect_cannibalization) read half the data whichever
 * project it was called from.
 *
 * The injected `openProject` used by every spec above CANNOT measure this — it is a recorder,
 * and a recorder agrees with whatever it is handed. So these specs compose the tool with
 * `openTrackedProject` from @pseo/db itself, over a strict stand-in for the `projects` table
 * (the same discipline as setup-project.route.test.ts: every `.eq()` is APPLIED, the selected
 * columns are PROJECTED, and `ignoreDuplicates` is honoured on the (user_id, domain) conflict).
 * Still zero network and zero database.
 */
describe("track_gsc_property over the real project route (`www.`)", () => {
  interface ProjectRow {
    id: string;
    user_id: string;
    domain: string;
    archived_at: string | null;
  }

  function makeProjectsStore(initial: readonly ProjectRow[] = []) {
    const rows: ProjectRow[] = initial.map((row) => ({ ...row }));
    const inserted: { user_id: string; domain: string }[] = [];
    let nextId = 1;

    const project = (row: ProjectRow, columns: string): Record<string, unknown> =>
      Object.fromEntries(
        columns
          .split(",")
          .map((column) => column.trim())
          .map((column) => [column, row[column as keyof ProjectRow]]),
      );

    const matching = (filters: readonly [string, unknown][]): ProjectRow[] =>
      rows.filter((row) =>
        filters.every(([column, value]) => row[column as keyof ProjectRow] === value),
      );

    function selectChain(columns: string) {
      const filters: [string, unknown][] = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return chain;
        },
        maybeSingle() {
          const hit = matching(filters)[0];
          return Promise.resolve({ data: hit ? project(hit, columns) : null, error: null });
        },
      };
      return chain;
    }

    function updateChain(patch: Partial<ProjectRow>) {
      const filters: [string, unknown][] = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return chain;
        },
        select(columns: string) {
          return {
            maybeSingle() {
              const hits = matching(filters);
              hits.forEach((hit) => Object.assign(hit, patch));
              const hit = hits[0];
              return Promise.resolve({ data: hit ? project(hit, columns) : null, error: null });
            },
          };
        },
      };
      return chain;
    }

    const client = {
      from(table: string) {
        if (table !== "projects") {
          throw new Error(`the project route must not touch "${table}"`);
        }
        return {
          select: selectChain,
          update: updateChain,
          upsert(
            values: { user_id: string; domain: string },
            options: { onConflict: string; ignoreDuplicates: boolean },
          ) {
            return {
              select(columns: string) {
                const clash = rows.find(
                  (row) => row.user_id === values.user_id && row.domain === values.domain,
                );
                if (clash) {
                  return options.ignoreDuplicates
                    ? Promise.resolve({ data: [], error: null })
                    : Promise.resolve({ data: null, error: { message: "duplicate key" } });
                }
                const row: ProjectRow = {
                  id: `new-${nextId++}`,
                  user_id: values.user_id,
                  domain: values.domain,
                  archived_at: null,
                };
                rows.push(row);
                inserted.push({ user_id: values.user_id, domain: values.domain });
                return Promise.resolve({ data: [project(row, columns)], error: null });
              },
            };
          },
        };
      },
    };

    return { client, rows, inserted };
  }

  /** The tool, wired to the REAL route over `store`, and to a recorder for the mapping. */
  function toolOverStore(
    store: ReturnType<typeof makeProjectsStore>,
    sites: readonly GscSite[],
    mapped: { projectId: string; property: string }[],
  ) {
    return makeTrackGscPropertyTool({
      loadAccounts: () => Promise.resolve([{ id: ACCOUNT_ID, email: ACCOUNT_EMAIL }]),
      listAccountSites: () => Promise.resolve([...sites]),
      openProject: (userId, domain) =>
        openTrackedProject(store.client as unknown as ProjectsClient, userId, domain),
      mapProperty: ({ projectId, property }) => {
        mapped.push({ projectId, property });
        return Promise.resolve();
      },
    });
  }

  async function track(
    store: ReturnType<typeof makeProjectsStore>,
    property: string,
    sites: readonly GscSite[],
  ): Promise<{ text: string; isError: boolean; mapped: { projectId: string; property: string }[] }> {
    const mapped: { projectId: string; property: string }[] = [];
    const result = await toolOverStore(store, sites, mapped).run(CTX, { property });
    return {
      text: result.content.map((part) => part.text).join("\n"),
      isError: result.isError === true,
      mapped,
    };
  }

  /** THE MEASURED PAIR. */
  it("links `sc-domain:noraninsaat.com` to the EXISTING www. project, opening none", async () => {
    const store = makeProjectsStore([
      { id: "dcad126a", user_id: USER, domain: "www.noraninsaat.com", archived_at: null },
    ]);
    const site: GscSite = {
      siteUrl: "sc-domain:noraninsaat.com",
      permissionLevel: "siteOwner",
    };

    const run = await track(store, site.siteUrl, [site]);

    expect(run.isError).toBe(false);
    // No seventh project: the table still holds exactly the row that was already there.
    expect(store.inserted).toEqual([]);
    expect(store.rows).toHaveLength(1);
    // …and the property was mapped ONTO that project, which is the point of the call.
    expect(run.mapped).toEqual([
      { projectId: "dcad126a", property: "sc-domain:noraninsaat.com" },
    ]);
    expect(run.text).toMatch(/already tracked/i);
  });

  it("still opens a project for a site the tenant does not have yet", async () => {
    // The negative control: if the lookup matched anything at all, this would report "already
    // tracked" and insert nothing, and the spec above would pass for the wrong reason.
    const store = makeProjectsStore([
      { id: "dcad126a", user_id: USER, domain: "www.noraninsaat.com", archived_at: null },
    ]);
    const site: GscSite = { siteUrl: "sc-domain:katrenur.com", permissionLevel: "siteOwner" };

    const run = await track(store, site.siteUrl, [site]);

    expect(run.isError).toBe(false);
    expect(store.inserted).toEqual([{ user_id: USER, domain: "katrenur.com" }]);
  });

  it("does not fold a SUBDOMAIN property into the apex project", async () => {
    const store = makeProjectsStore([
      { id: "p-apex", user_id: USER, domain: "katrenur.com", archived_at: null },
    ]);
    const site: GscSite = {
      siteUrl: "sc-domain:blog.katrenur.com",
      permissionLevel: "siteOwner",
    };

    const run = await track(store, site.siteUrl, [site]);

    expect(run.isError).toBe(false);
    expect(store.inserted).toEqual([{ user_id: USER, domain: "blog.katrenur.com" }]);
    expect(run.mapped[0]?.projectId).not.toBe("p-apex");
  });
});
