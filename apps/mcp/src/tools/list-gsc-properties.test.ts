import { describe, expect, it, vi } from "vitest";
import type { GscSite } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import {
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
  /** A SECOND healthy account on the caller, for the failure-isolation spec. */
  readonly secondAccountSites?: readonly GscSite[];
  /** Projects reading a property, defaulting to ACCOUNT_ID when no account is named. */
  readonly mappings?: readonly { property: string; domain: string; accountId?: string }[];
  /** Call as somebody else — their own account lists their own property. */
  readonly asUser?: string;
}

const FOREIGN_SITE: GscSite = {
  siteUrl: "https://tenant-two-site.test/",
  permissionLevel: "siteOwner",
};

function accountsOf(userId: string, world: World = {}): GscAccountSummary[] {
  if (userId === USER) {
    const first = { id: ACCOUNT_ID, email: "first@mail.test" };
    return world.secondAccountSites
      ? [first, { id: SECOND_ACCOUNT_ID, email: "healthy@mail.test" }]
      : [first];
  }
  return userId === OTHER_USER
    ? [{ id: OTHER_TENANT_ACCOUNT_ID, email: "second@mail.test" }]
    : [];
}

function toolFor(world: World) {
  return makeListGscPropertiesTool({
    loadAccounts: (userId) => Promise.resolve(accountsOf(userId, world)),
    listAccountSites: (accountId, userId) => {
      if (!accountsOf(userId, world).some((account) => account.id === accountId)) {
        throw new Error(`fixture: account ${accountId} is not owned by ${userId}`);
      }
      if (accountId === OTHER_TENANT_ACCOUNT_ID) return Promise.resolve([FOREIGN_SITE]);
      if (accountId === SECOND_ACCOUNT_ID) {
        return Promise.resolve([...(world.secondAccountSites ?? [])]);
      }
      if (world.sitesListFails) return Promise.reject(new Error("fixture: sites.list refused"));
      return Promise.resolve([...(world.sites ?? [])]);
    },
    loadMappings: (userId): Promise<ProjectPropertyMapping[]> =>
      Promise.resolve(
        userId === USER
          ? (world.mappings ?? []).map((mapping) => ({
              domain: mapping.domain,
              accountId: mapping.accountId ?? ACCOUNT_ID,
              property: mapping.property,
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
    // An absence we did not observe is not an absence — AccountInventory's own rule
    // (apps/web/app/app/connection/account-inventory.tsx). The log line is silenced AND
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

  it("says an account has no properties only when it actually answered with none", async () => {
    const out = await callTool({}, { sites: [] });
    expect(out).toMatch(/no search console properties/i);
    expect(out).not.toMatch(/could not be read/i);
  });

  it("tells a user with no connected account how to connect one", async () => {
    const out = await callTool({}, { asUser: "user-with-nothing" });
    expect(out).toMatch(/connect_gsc/);
    expect(out).not.toMatch(/could not be read/i);
  });

  it("is a 0-credit tool that takes no parameters", () => {
    const tool = toolFor({});
    expect(tool.name).toBe("list_gsc_properties");
    expect(tool.description).toMatch(/0 credits/i);
    const schema = tool.inputJsonSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {})).toEqual([]);
  });
});
