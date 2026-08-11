import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const listKeys = vi.fn();

/** Every table the page reads, and every .eq() filter it applied — the tenant-scoping proof. */
let fromCalls: string[] = [];
let eqCalls: { table: string; column: string; value: unknown }[] = [];
let projectRows: { id: string; domain: string }[] = [];
let connectionRows: {
  project_id: string;
  account_id: string | null;
  gsc_property: string | null;
}[] = [];
let accountRows: { id: string; google_account_email: string; user_id?: string }[] = [];
/** What `sites.list` answers for one account — or the failure it answers with instead. */
let sitesByAccount: Record<string, { siteUrl: string; permissionLevel: string }[] | Error> = {};

/**
 * Minimal PostgREST-ish builder: records the table + every .eq(), and resolves to that
 * table's rows whether the caller ends the chain with .order() or awaits it directly.
 *
 * It PROJECTS the requested columns, and that is load-bearing rather than tidiness. The link
 * state hangs on `account_id` and the picker's stored choice on `gsc_property`; handing back a
 * column the statement never selected would let "unmapped rows read Not connected" pass while
 * the real query returned no such column — green for the wrong reason. Projected, a forgotten
 * column reads `undefined` here exactly as it would from PostgREST, and the spec fails.
 */
function queryBuilder(table: string, columns: string) {
  const wanted = columns.split(",").map((column) => column.trim());
  const rows: Record<string, unknown>[] =
    table === "projects" ? projectRows : table === "gsc_accounts" ? accountRows : connectionRows;
  const filters: { column: string; value: unknown }[] = [];
  // It also APPLIES the filters, not merely records them — otherwise "the page hands the
  // account panel only the caller's accounts" would be green no matter what the page queried,
  // and a dropped `.eq("user_id", …)` would sail through. A filter is only applied to rows
  // that CARRY that column, so the fixtures above (which mostly omit `user_id`, since the
  // tenant scoping is asserted structurally by the NEVER #4 spec) stay unaffected; a fixture
  // that opts in by declaring `user_id` gets a filter that genuinely bites.
  function visible() {
    return rows.filter((row) =>
      filters.every((filter) => !(filter.column in row) || row[filter.column] === filter.value),
    );
  }
  function result() {
    return {
      data: visible().map((row) => Object.fromEntries(wanted.map((column) => [column, row[column]]))),
      error: null,
    };
  }
  const builder = {
    eq(column: string, value: unknown) {
      eqCalls.push({ table, column, value });
      filters.push({ column, value });
      return builder;
    },
    order() {
      return Promise.resolve(result());
    },
    then(
      onFulfilled?: (value: ReturnType<typeof result>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result()).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (table: string) => {
      fromCalls.push(table);
      return { select: (columns: string) => queryBuilder(table, columns) };
    },
  }),
}));
vi.mock("@pseo/db/api-keys-repo", () => ({ listKeys: (...args: unknown[]) => listKeys(...args) }));
// The service-role client exists only to be handed to `accessTokenFor`, which is mocked below;
// the page never issues a statement through it, and `fromCalls` above stays the complete list
// of tables this page reads (so the NEVER #4 spec still sees everything).
vi.mock("@pseo/db/server", () => ({ createServiceClient: () => ({}) }));
vi.mock("@pseo/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pseo/core")>()),
  mcpUrlFor: (key: string, template: string) => template.replace("{key}", key),
  mcpUrlTemplate: () => "https://mcp.seogrep.com/mcp/{key}",
  listSites: (accessToken: string) => listSites(accessToken),
}));
// The token mint is faked; `lib/gsc/oauth` is NOT, so the suggestion below is the real
// `resolveGscProperty` walking the real candidate order, and the disabled options are the
// real `canQuerySearchAnalytics` allowlist.
const accessTokenFor = vi.fn();
vi.mock("../../../lib/gsc/accounts", () => ({
  accessTokenFor: (...args: unknown[]) => accessTokenFor(...args),
}));
const listSites = vi.fn();
vi.mock("./actions", () => ({
  createKeyAction: vi.fn(),
  rotateKeyAction: vi.fn(),
  revokeKeyAction: vi.fn(),
  unmapProject: vi.fn(),
  saveProjectProperty: vi.fn(),
  describeDisconnect: vi.fn(),
  disconnectAccount: vi.fn(),
}));
// Stub the client island so the page test focuses on the RSC's list + masked URL, and
// surfaces which activeKeyId the page computed and hands down.
vi.mock("./key-panel", () => ({
  KeyPanel: (p: { activeKeyId: string | null }) => (
    <div data-testid="key-panel" data-active-key-id={p.activeKeyId ?? ""} />
  ),
}));
// Same treatment for the per-row island: the stub surfaces WHICH project the page bound it
// to and whether it was handed a real server action. It mirrors the real component's own
// split — the island is mounted for every project, the BUTTON exists only for a mapped one —
// so the specs below still pin exactly where a Disconnect affordance may appear.
//
// The ACCOUNT panel stub does the same one level up: it reports the account list the page
// computed and that both account-level actions reached it.
vi.mock("./disconnect-button", () => ({
  DisconnectButton: (p: {
    projectId: string;
    domain: string;
    connected: boolean;
    unmapProject: (projectId: string) => Promise<void>;
  }) => (
    <span data-testid="disconnect-island">
      {p.connected ? (
        <button
          type="button"
          data-testid="disconnect"
          data-project-id={p.projectId}
          data-domain={p.domain}
          data-has-action={typeof p.unmapProject === "function"}
        >
          Disconnect
        </button>
      ) : null}
    </span>
  ),
  AccountDisconnectPanel: (p: {
    accounts: readonly { id: string; email: string }[];
    describeDisconnect: (accountId: string) => Promise<string>;
    disconnectAccount: (accountId: string) => Promise<string>;
  }) => (
    <div
      data-testid="account-panel"
      data-accounts={JSON.stringify(p.accounts)}
      data-has-describe={typeof p.describeDisconnect === "function"}
      data-has-disconnect={typeof p.disconnectAccount === "function"}
    />
  ),
}));
// The picker island reports every decision the PAGE made for a row: what is stored, what
// `resolveGscProperty` suggested, what vanished from the live listing, and the option list.
vi.mock("./property-picker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./property-picker")>()),
  PropertyPicker: (p: {
    projectId: string;
    current: string;
    retained: { property: string; choice: string | null; listingComplete: boolean } | null;
    suggested: string | null;
    missingProperty: string | null;
    alsoMapped: number;
    options: readonly unknown[];
    saveProjectProperty: unknown;
  }) => (
    <div
      data-testid="picker"
      data-project-id={p.projectId}
      data-current={p.current}
      data-retained={p.retained ? p.retained.property : ""}
      data-retained-choice={p.retained?.choice ?? ""}
      data-retained-listing-complete={p.retained ? String(p.retained.listingComplete) : ""}
      data-suggested={p.suggested ?? ""}
      data-missing={p.missingProperty ?? ""}
      data-also-mapped={String(p.alsoMapped)}
      data-options={JSON.stringify(p.options)}
      data-has-action={typeof p.saveProjectProperty === "function"}
    />
  ),
}));

import ConnectionPage from "./page";
import { encodeChoice } from "./choice";

const ACTIVE = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  keyPrefix: "sg_active12",
  createdAt: "2026-07-01T10:00:00.000Z",
  revokedAt: null,
};
const REVOKED = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  keyPrefix: "sg_revoked9",
  createdAt: "2026-06-01T10:00:00.000Z",
  revokedAt: "2026-06-15T10:00:00.000Z",
};

const PROJECT_A = { id: "11111111-1111-4111-8111-111111111111", domain: "alpha.example" };
const PROJECT_B = { id: "22222222-2222-4222-8222-222222222222", domain: "beta.example" };
/** The gsc_accounts row a mapped project points at — link state is this being non-null. */
const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_ACCOUNT_ID = "55555555-5555-4555-8555-555555555555";

/** A gsc_connections row; `accountId: null` is a row whose mapping was cleared. */
function mapping(
  projectId: string,
  accountId: string | null = ACCOUNT_ID,
  gscProperty: string | null = null,
) {
  return { project_id: projectId, account_id: accountId, gsc_property: gscProperty };
}

function account(id = ACCOUNT_ID, email = "owner@example.com") {
  return { id, google_account_email: email };
}

function site(siteUrl: string, permissionLevel = "siteOwner") {
  return { siteUrl, permissionLevel };
}

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  // One token per account, so `listSites` can answer per account — which also proves the page
  // asks Google with the token of the account whose properties it then renders.
  accessTokenFor.mockImplementation(async (_client: unknown, accountId: string) => `token:${accountId}`);
  listSites.mockImplementation(async (accessToken: string) => {
    const answer = sitesByAccount[accessToken.replace("token:", "")] ?? [];
    if (answer instanceof Error) throw answer;
    return answer;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fromCalls = [];
  eqCalls = [];
  projectRows = [];
  connectionRows = [];
  accountRows = [];
  sitesByAccount = {};
});

async function renderPage(params: Record<string, string | string[] | undefined> = {}) {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  render(await ConnectionPage({ searchParams: Promise.resolve(params) }));
}

/** The <li> that carries a given domain, so per-row state is asserted inside its own row. */
function rowOf(domain: string): HTMLElement {
  const row = screen.getByText(domain).closest("li");
  if (row === null) throw new Error(`no row contains "${domain}"`);
  return row;
}

/** The picker props the page computed for one project row. */
function pickerOf(domain: string): HTMLElement {
  return within(rowOf(domain)).getByTestId("picker");
}

describe("ConnectionPage", () => {
  it("no keys: prompts to generate and hands KeyPanel a null active key", async () => {
    listKeys.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("No keys yet.")).toBeTruthy();
    expect(screen.getByText(/generate a key to reveal your personal mcp url/i)).toBeTruthy();
    expect(screen.getByTestId("key-panel").getAttribute("data-active-key-id")).toBe("");
  });

  it("active key: shows the masked MCP URL and passes its id to KeyPanel", async () => {
    listKeys.mockResolvedValue([ACTIVE]);
    await renderPage();
    expect(screen.getByText("https://mcp.seogrep.com/mcp/sg_active12…")).toBeTruthy();
    expect(screen.getByText("sg_active12…")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByTestId("key-panel").getAttribute("data-active-key-id")).toBe(ACTIVE.id);
  });

  it("revoked key in the list: shows the Revoked label; no active key for KeyPanel", async () => {
    listKeys.mockResolvedValue([REVOKED]);
    await renderPage();
    expect(screen.getByText("Revoked")).toBeTruthy();
    expect(screen.getByText("sg_revoked9…")).toBeTruthy();
    // No active key -> no masked URL, KeyPanel gets a null active id.
    expect(screen.getByText(/generate a key to reveal your personal mcp url/i)).toBeTruthy();
    expect(screen.getByTestId("key-panel").getAttribute("data-active-key-id")).toBe("");
  });
});

describe("ConnectionPage — Google Search Console", () => {
  /**
   * RE-AIMED. This spec used to assert a per-row `?project_id=` connect link on every project.
   * That link is gone: consent belongs to a Google ACCOUNT (migration 0021), Task 5 dropped
   * the project from the OAuth state, and the connect route ignores the parameter — so the
   * link promised a project-scoped consent that cannot happen, and offered a Google round trip
   * to a user whose actual next step was the picker. What the spec still guarantees, and all
   * this spec ever really guaranteed, is that each row is MARKED. Where the trip to Google
   * lives now is pinned in "the account-level connect control" below.
   */
  it("marks each project connected or not, with no per-project trip to Google", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [mapping(PROJECT_B.id)];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("sc-domain:alpha.example")] };
    await renderPage();

    const notConnected = rowOf(PROJECT_A.domain);
    expect(within(notConnected).getByText("Not connected")).toBeTruthy();
    const connected = rowOf(PROJECT_B.domain);
    expect(within(connected).getByText("Connected")).toBeTruthy();

    // Neither row sends the user to Google: the healthy one has nothing to re-consent, and
    // the unmapped one needs the picker it already carries.
    expect(within(notConnected).queryByRole("link")).toBeNull();
    expect(within(connected).queryByRole("link")).toBeNull();
    expect(within(notConnected).getByTestId("picker")).toBeTruthy();
    expect(within(connected).getByTestId("picker")).toBeTruthy();
  });

  it("offers Disconnect on the CONNECTED row only, bound to that project", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [mapping(PROJECT_B.id)];
    await renderPage();

    // Nothing to unlink on a project that was never linked.
    expect(within(rowOf(PROJECT_A.domain)).queryByTestId("disconnect")).toBeNull();
    // The island itself rides on BOTH rows, so an in-flight failure notice survives the very
    // refresh that flips the row to "Not connected".
    expect(within(rowOf(PROJECT_A.domain)).getByTestId("disconnect-island")).toBeTruthy();
    expect(within(rowOf(PROJECT_B.domain)).getByTestId("disconnect-island")).toBeTruthy();

    const disconnect = within(rowOf(PROJECT_B.domain)).getByTestId("disconnect");
    expect(disconnect.getAttribute("data-project-id")).toBe(PROJECT_B.id);
    expect(disconnect.getAttribute("data-domain")).toBe(PROJECT_B.domain);
    expect(disconnect.getAttribute("data-has-action")).toBe("true");
  });

  it("after the connection is gone the row reads Not connected + Connect, with no Disconnect", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_B];
    connectionRows = []; // no row at all — a project that was never linked
    await renderPage();

    const row = rowOf(PROJECT_B.domain);
    expect(within(row).getByText("Not connected")).toBeTruthy();
    // RE-AIMED from `getByRole("link", { name: "Connect" })`: an unmapped project's next step
    // is choosing a property on an account, not a fresh consent, so the row carries the picker
    // instead of a link out.
    expect(within(row).getByTestId("picker")).toBeTruthy();
    expect(within(row).queryByRole("link")).toBeNull();
    expect(within(row).queryByText("Connected")).toBeNull();
    expect(within(row).queryByTestId("disconnect")).toBeNull();
  });

  /**
   * THE STATE unmapProject ACTUALLY LEAVES BEHIND, and the reason this predicate is not row
   * existence. `unmapProject` clears `account_id` and KEEPS the row; disconnecting an account
   * nulls the same column through migration 0021's `on delete set null` while every
   * `gsc_property` survives. Reading mere row existence showed both as "Connected", so the
   * Disconnect button stayed on screen and the click looked like it had done nothing.
   */
  it("an UNMAPPED row (account_id null) reads Not connected + Connect, with no Disconnect", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_B];
    connectionRows = [mapping(PROJECT_B.id, null)]; // the row survives, the mapping does not
    await renderPage();

    const row = rowOf(PROJECT_B.domain);
    expect(within(row).getByText("Not connected")).toBeTruthy();
    // RE-AIMED exactly as the spec above, and for the same reason.
    expect(within(row).getByTestId("picker")).toBeTruthy();
    expect(within(row).queryByRole("link")).toBeNull();
    expect(within(row).queryByText("Connected")).toBeNull();
    expect(within(row).queryByTestId("disconnect")).toBeNull();
  });

  /**
   * The blurb is the only place a user learns what Disconnect does, so it may not promise
   * something the button does not do. It used to say Disconnect "asks Google to revoke
   * SeoGrep's access"; since the credential moved to the Google ACCOUNT (migration 0021) the
   * per-project button revokes nothing, and that sentence would have told a user their
   * Search Console access was gone while the grant was still live at Google.
   *
   * It also used to trail off at "a separate step on the Google account itself" — true when
   * no such control existed here, and a dead end once one did. It now names it.
   */
  it("the Search Console blurb does not promise a revoke the per-project button never performs", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_B];
    connectionRows = [mapping(PROJECT_B.id)];
    await renderPage();

    const blurb = screen.getByText(/link a project to search console/i).textContent ?? "";
    expect(blurb).toMatch(/does not revoke/i);
    expect(blurb).toMatch(/other projects keep working/i);
    // No claim that the stored credential is dropped or that Google was asked for anything.
    expect(blurb).not.toMatch(/asks google to revoke/i);
    expect(blurb).not.toMatch(/deletes the stored token/i);
    // And it points at the control that DOES drop the access, which now exists on this page.
    expect(blurb).toMatch(/connected google accounts/i);
    expect(screen.getByTestId("account-panel")).toBeTruthy();
  });

  it("reads EVERY tenant table with an explicit user_id filter (constitution NEVER #4)", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [];
    accountRows = [account()];
    await renderPage();

    expect(eqCalls).toContainEqual({ table: "projects", column: "user_id", value: "user-1" });
    expect(eqCalls).toContainEqual({
      table: "gsc_connections",
      column: "user_id",
      value: "user-1",
    });
    expect(eqCalls).toContainEqual({ table: "gsc_accounts", column: "user_id", value: "user-1" });
    // Nothing is read WITHOUT that filter: every table touched is a user_id-scoped one.
    const scoped = new Set(
      eqCalls.filter((c) => c.column === "user_id" && c.value === "user-1").map((c) => c.table),
    );
    expect(scoped).toEqual(new Set(fromCalls));
  });

  it("no projects: points at the setup_project tool instead of an empty list", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [];
    connectionRows = [];
    await renderPage();

    expect(
      screen.getByText("No projects yet. Create one from your MCP client with the setup_project tool."),
    ).toBeTruthy();
    // RE-AIMED. It used to assert there was no "Connect" link, which was true only because
    // every connect link hung off a project row — the very defect that left a projectless user
    // unable to connect anything. There are still no project rows, and the account-level
    // control is present and reachable.
    expect(screen.queryByTestId("picker")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Connect Google account" }).getAttribute("href"),
    ).toBe("/api/gsc/connect");
  });

  it("does not read projects at all when there is no user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    listKeys.mockResolvedValue([]);
    render(await ConnectionPage({ searchParams: Promise.resolve({}) }));

    expect(fromCalls).toEqual([]);
    expect(
      screen.getByText("No projects yet. Create one from your MCP client with the setup_project tool."),
    ).toBeTruthy();
  });
});

/**
 * THE FOUR CALLBACK PARAMETERS HAD NO READER. Since the OAuth callback started storing a
 * Google ACCOUNT it has redirected here with `?connected=<id>`, `?error=identity`,
 * `?error=verify` and `?error=no_token` — and this page read no `searchParams` at all, so
 * every one of them landed silently: a user who declined, or whose token could not be
 * verified, saw an ordinary connection page and no explanation.
 */
describe("ConnectionPage — what the OAuth callback sent us back with", () => {
  it("reports a stored account without ever echoing its id", async () => {
    listKeys.mockResolvedValue([]);
    accountRows = [account()];
    await renderPage({ connected: ACCOUNT_ID });

    const notice = screen.getByRole("status");
    expect(notice.textContent).toMatch(/google account connected/i);
    expect(notice.textContent).toMatch(/choose the search console property/i);
    expect(document.body.textContent).not.toContain(ACCOUNT_ID);
  });

  it.each([
    ["identity", /did not say which account consented/i],
    ["no_token", /did not return a reusable token/i],
    ["verify", /properties could not be read/i],
  ])("explains ?error=%s and says nothing was stored", async (code, expected) => {
    listKeys.mockResolvedValue([]);
    await renderPage({ error: code });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(expected);
    expect(alert.textContent).toMatch(/nothing was stored/i);
  });

  // A crafted value produces no output at all — the messages are literals behind a Map, so an
  // inherited key like "constructor" cannot resolve either.
  it.each(["nonsense", "constructor", "__proto__"])(
    "renders nothing for an unknown ?error=%s",
    async (code) => {
      listKeys.mockResolvedValue([]);
      await renderPage({ error: code });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    },
  );

  // `?connected=` with nothing after it is not an account id, so there is no stored account to
  // report. Unreachable from the real callback, which always carries one — but a success
  // message with nothing behind it is a success message all the same.
  it("says nothing for ?connected= with an empty value", async () => {
    listKeys.mockResolvedValue([]);
    await renderPage({ connected: "" });

    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toMatch(/google account connected/i);
  });

  it("a repeated param uses the first value only", async () => {
    listKeys.mockResolvedValue([]);
    await renderPage({ error: ["identity", "verify"] });

    expect(screen.getByRole("alert").textContent).toMatch(/did not say which account consented/i);
  });
});

/**
 * THE PICKER'S INPUTS — every decision the page makes for a row, read back off the island it
 * hands them to. The property list is fetched LIVE on each render and never cached: a cache
 * would grow its own staleness problem, and a dead token SHOULD make the fetch fail, because
 * that failure is what this page exists to reveal.
 */
describe("ConnectionPage — the property picker", () => {
  it("offers every live property, with its permission level and whether it is queryable", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [];
    accountRows = [account()];
    sitesByAccount = {
      [ACCOUNT_ID]: [
        site("sc-domain:alpha.example", "siteOwner"),
        site("https://alpha.example/", "siteUnverifiedUser"),
      ],
    };
    await renderPage();

    expect(JSON.parse(pickerOf(PROJECT_A.domain).getAttribute("data-options") ?? "[]")).toEqual([
      {
        accountId: ACCOUNT_ID,
        accountEmail: "owner@example.com",
        siteUrl: "sc-domain:alpha.example",
        permissionLevel: "siteOwner",
        queryable: true,
      },
      {
        accountId: ACCOUNT_ID,
        accountEmail: "owner@example.com",
        siteUrl: "https://alpha.example/",
        // The real allowlist decides this: an unverified user cannot query, so the option is
        // rendered (the user can see it exists) but never selectable — finding #50 made
        // structurally impossible rather than merely unlikely.
        permissionLevel: "siteUnverifiedUser",
        queryable: false,
      },
    ]);
  });

  it("asks Google with each account's OWN token and offers both accounts' properties", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    accountRows = [account(), account(SECOND_ACCOUNT_ID, "second@example.com")];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("sc-domain:alpha.example")],
      [SECOND_ACCOUNT_ID]: [site("https://beta.example/")],
    };
    await renderPage();

    expect(listSites).toHaveBeenCalledWith(`token:${ACCOUNT_ID}`);
    expect(listSites).toHaveBeenCalledWith(`token:${SECOND_ACCOUNT_ID}`);
    const options = JSON.parse(pickerOf(PROJECT_A.domain).getAttribute("data-options") ?? "[]");
    expect(options.map((option: { siteUrl: string }) => option.siteUrl)).toEqual([
      "sc-domain:alpha.example",
      "https://beta.example/",
    ]);
  });

  /**
   * `resolveGscProperty` is not mocked here: this is the real candidate walk, so the
   * suggestion inherits its preference order (a domain property outranks a url-prefix one)
   * AND its refusals. It no longer DECIDES anything — it proposes, and the row shows it
   * pre-selected until the user saves.
   */
  it("suggests resolveGscProperty's match for an unmapped project", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [];
    accountRows = [account()];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("https://alpha.example/"), site("sc-domain:alpha.example")],
    };
    await renderPage();

    const picker = pickerOf(PROJECT_A.domain);
    expect(picker.getAttribute("data-suggested")).toBe(
      encodeChoice(ACCOUNT_ID, "sc-domain:alpha.example"),
    );
    expect(picker.getAttribute("data-current")).toBe("");
    expect(picker.getAttribute("data-has-action")).toBe("true");
  });

  /**
   * The subdomain refusal `resolveGscProperty` has always carried is inherited whole: a
   * project on blog.alpha.example may not be suggested the apex property, because whoever
   * verified the apex never said they meant to hand us the subdomain's data.
   */
  it("suggests nothing where resolveGscProperty refuses — a subdomain never inherits the apex", async () => {
    listKeys.mockResolvedValue([]);
    const blog = { id: "66666666-6666-4666-8666-666666666666", domain: "blog.alpha.example" };
    projectRows = [blog];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("sc-domain:alpha.example")] };
    await renderPage();

    expect(pickerOf(blog.domain).getAttribute("data-suggested")).toBe("");
  });

  it("shows the STORED mapping as the picker's current value", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, ACCOUNT_ID, "https://alpha.example/")];
    accountRows = [account()];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("https://alpha.example/"), site("sc-domain:alpha.example")],
    };
    await renderPage();

    expect(pickerOf(PROJECT_A.domain).getAttribute("data-current")).toBe(
      encodeChoice(ACCOUNT_ID, "https://alpha.example/"),
    );
  });

  /**
   * `account_id IS NULL` + `gsc_property` set is the design's own state (spec line 68): "the
   * mapping stands, connect to activate it" — what migration 0021 leaves every migrated row in.
   * Nothing rendered it: `current` is computed only for a mapped row, so the page showed a
   * freshly recomputed SUGGESTION while the disconnect confirmation claimed the choice was kept.
   * The suggestion here is a DIFFERENT property (the real `resolveGscProperty` prefers the
   * domain one), so a fallback to it cannot pass this spec by accident.
   */
  it("surfaces the STORED property of an unmapped row, and pre-selects it where an account lists it", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, null, "https://alpha.example/")];
    accountRows = [account()];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("https://alpha.example/"), site("sc-domain:alpha.example")],
    };
    await renderPage();

    const picker = pickerOf(PROJECT_A.domain);
    expect(picker.getAttribute("data-retained")).toBe("https://alpha.example/");
    expect(picker.getAttribute("data-retained-choice")).toBe(
      encodeChoice(ACCOUNT_ID, "https://alpha.example/"),
    );
    // Still NOT a live mapping: the row reads Not connected until the user saves.
    expect(picker.getAttribute("data-current")).toBe("");
    expect(within(rowOf(PROJECT_A.domain)).getByText("Not connected")).toBeTruthy();
  });

  /**
   * Before any account is reconnected there is nothing to pre-select — and the stored value is
   * still what the user was told was kept, so it is named rather than dropped.
   */
  it("names the stored property of an unmapped row even when no account can offer it", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, null, "https://alpha.example/")];
    accountRows = [];
    await renderPage();

    const picker = pickerOf(PROJECT_A.domain);
    expect(picker.getAttribute("data-retained")).toBe("https://alpha.example/");
    expect(picker.getAttribute("data-retained-choice")).toBe("");
    // Nothing was left unread, so "no account lists it" is a fact the picker may state.
    expect(picker.getAttribute("data-retained-listing-complete")).toBe("true");
  });

  /**
   * `sites: null` is a FAILED read, not an empty listing. Folded through `?? []` it looked like
   * an account that answered "nothing", so a retained property nobody could confirm came out of
   * the picker as "No connected Google account lists it right now" — an absence derived from a
   * question that was never answered. `missingPropertyFor` already refuses this inference for a
   * MAPPED row; the unmapped path now refuses it too.
   *
   * MUTATION TARGET: hard-code `listingComplete: true` in `retainedMappingFor` and this spec
   * goes red on its first assertion.
   */
  it("cannot say a retained property is listed nowhere when a listing failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, null, "https://alpha.example/")];
    // TWO accounts: one answers and does not list the property, the other cannot be read at
    // all. The readable one alone would make the absence look established — it is not.
    accountRows = [account(), account(SECOND_ACCOUNT_ID, "second@example.com")];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("sc-domain:somewhere-else.example")],
      [SECOND_ACCOUNT_ID]: new Error("Google token endpoint failed (400): invalid_grant"),
    };
    await renderPage();

    const picker = pickerOf(PROJECT_A.domain);
    expect(picker.getAttribute("data-retained-listing-complete")).toBe("false");
    expect(picker.getAttribute("data-retained")).toBe("https://alpha.example/");
    expect(picker.getAttribute("data-retained-choice")).toBe("");
  });

  it("claims no retained property for a MAPPED row, or for one that stored none", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [
      mapping(PROJECT_A.id, ACCOUNT_ID, "https://alpha.example/"), // mapped -> `current` owns it
      mapping(PROJECT_B.id, null, null), // unmapped, nothing stored -> nothing to show
    ];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("https://alpha.example/")] };
    await renderPage();

    expect(pickerOf(PROJECT_A.domain).getAttribute("data-retained")).toBe("");
    expect(pickerOf(PROJECT_B.domain).getAttribute("data-retained")).toBe("");
  });

  /**
   * A stored property the account no longer lists is NAMED. Silently showing an empty
   * selection would hide the fact that the project stopped reading data — the loss is itself
   * information, and the exact wording is what tells the user what to do about it.
   */
  it("marks a stored property that has vanished from the live listing", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, ACCOUNT_ID, "https://gone.example/")];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("sc-domain:alpha.example")] };
    await renderPage();

    expect(pickerOf(PROJECT_A.domain).getAttribute("data-missing")).toBe("https://gone.example/");
  });

  // We only know a property VANISHED if we managed to read the listing. When the fetch failed
  // we know nothing about its fate, and saying it is gone would be an invention.
  it("claims nothing about a stored property when the listing could not be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, ACCOUNT_ID, "https://alpha.example/")];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: new Error("invalid_grant") };
    await renderPage();

    expect(pickerOf(PROJECT_A.domain).getAttribute("data-missing")).toBe("");
  });

  it("counts the OTHER projects sharing a property, and blocks nothing", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [
      mapping(PROJECT_A.id, ACCOUNT_ID, "sc-domain:alpha.example"),
      mapping(PROJECT_B.id, ACCOUNT_ID, "sc-domain:alpha.example"),
    ];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("sc-domain:alpha.example")] };
    await renderPage();

    expect(pickerOf(PROJECT_A.domain).getAttribute("data-also-mapped")).toBe("1");
    expect(pickerOf(PROJECT_B.domain).getAttribute("data-also-mapped")).toBe("1");
    // Both rows still read Connected: sharing one domain property across projects is legal.
    expect(within(rowOf(PROJECT_A.domain)).getByText("Connected")).toBeTruthy();
    expect(within(rowOf(PROJECT_B.domain)).getByText("Connected")).toBeTruthy();
  });
});

/**
 * A DEAD TOKEN MUST NOT 500 THE PAGE. The failure is the most useful thing this page can
 * report — but the API keys live here too, and a 500 would take them down with it.
 */
describe("ConnectionPage — an account whose properties cannot be read", () => {
  it("renders the page, says so, and offers nothing to pick", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    listKeys.mockResolvedValue([ACTIVE]);
    projectRows = [PROJECT_A];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: new Error("Google token endpoint failed (400): invalid_grant") };
    await renderPage();

    // The rest of the page is intact.
    expect(screen.getByText("https://mcp.seogrep.com/mcp/sg_active12…")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/could not read the search console/i);
    expect(pickerOf(PROJECT_A.domain).getAttribute("data-options")).toBe("[]");
    // The account is still listed, so the user can disconnect or reconnect it.
    expect(JSON.parse(screen.getByTestId("account-panel").getAttribute("data-accounts") ?? "[]")).toEqual([
      { id: ACCOUNT_ID, email: "owner@example.com" },
    ]);
    expect(error).toHaveBeenCalled();
  });

  it("does not attempt Google at all with no encryption key, and still renders", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    accountRows = [account()];
    await renderPage();

    expect(accessTokenFor).not.toHaveBeenCalled();
    expect(listSites).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/could not read the search console/i);
    expect(error).toHaveBeenCalled();
  });
});

/**
 * WHERE THE TRIP TO GOOGLE LIVES. It used to live on every project row as
 * `/api/gsc/connect?project_id=<id>`, which was wrong three ways once migration 0021 moved the
 * credential to the account: a user with no projects (or no connected account) could not
 * connect at all; a user who HAD connected an account was offered a fresh consent on an
 * unmapped project when the action they needed was the picker; and the `project_id` was dead,
 * ignored by a route that no longer knows about projects.
 */
describe("ConnectionPage — the account-level connect control", () => {
  it("offers Connect Google account with NO project_id, whatever else is on the page", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("sc-domain:alpha.example")] };
    await renderPage();

    const link = screen.getByRole("link", { name: "Connect Google account" });
    expect(link.getAttribute("href")).toBe("/api/gsc/connect");
    // The dead parameter appears nowhere on the page, on any link.
    expect(
      screen.queryAllByRole("link").filter((a) => (a.getAttribute("href") ?? "").includes("project_id")),
    ).toEqual([]);
  });

  it("is there for a user with no accounts and no projects at all", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [];
    accountRows = [];
    await renderPage();

    expect(
      screen.getByRole("link", { name: "Connect Google account" }).getAttribute("href"),
    ).toBe("/api/gsc/connect");
    // And the panel says plainly that there is nothing connected, without pointing at a
    // per-project control that may not exist.
    expect(screen.getByTestId("account-panel").getAttribute("data-accounts")).toBe("[]");
  });

  /**
   * The one state a per-row trip to Google actually fixes: the project IS mapped, and the
   * account behind it can no longer be read. Re-consenting that account is the repair; it
   * upserts the same `gsc_accounts` row (keyed on the Google `sub`) and every mapping survives.
   */
  it("offers Reconnect only for a project whose account credential is dead", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [mapping(PROJECT_A.id, ACCOUNT_ID), mapping(PROJECT_B.id, SECOND_ACCOUNT_ID)];
    accountRows = [account(), account(SECOND_ACCOUNT_ID, "second@example.com")];
    sitesByAccount = {
      [ACCOUNT_ID]: new Error("Google token endpoint failed (400): invalid_grant"),
      [SECOND_ACCOUNT_ID]: [site("sc-domain:beta.example")],
    };
    await renderPage();

    const broken = within(rowOf(PROJECT_A.domain)).getByRole("link", { name: "Reconnect" });
    expect(broken.getAttribute("href")).toBe("/api/gsc/connect");
    // The healthy project has nothing to re-consent.
    expect(within(rowOf(PROJECT_B.domain)).queryByRole("link")).toBeNull();
  });

  // An unmapped project is NOT a broken credential, even while another account is unreadable:
  // its next step is the picker, and offering Google would re-grant what is already granted.
  it("never offers Reconnect for a project that simply has no mapping", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, null)];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("sc-domain:alpha.example")] };
    await renderPage();

    expect(within(rowOf(PROJECT_A.domain)).queryByRole("link")).toBeNull();
    expect(within(rowOf(PROJECT_A.domain)).getByTestId("picker")).toBeTruthy();
  });
});

describe("ConnectionPage — the account panel", () => {
  it("hands the panel every connected account and both account-level actions", async () => {
    listKeys.mockResolvedValue([]);
    accountRows = [account(), account(SECOND_ACCOUNT_ID, "second@example.com")];
    await renderPage();

    const panel = screen.getByTestId("account-panel");
    expect(JSON.parse(panel.getAttribute("data-accounts") ?? "[]")).toEqual([
      { id: ACCOUNT_ID, email: "owner@example.com" },
      { id: SECOND_ACCOUNT_ID, email: "second@example.com" },
    ]);
    // describeDisconnect does no ownership check of its own, so the ONLY ids it may ever be
    // called with are these — read back under the session user's filter.
    expect(panel.getAttribute("data-has-describe")).toBe("true");
    expect(panel.getAttribute("data-has-disconnect")).toBe("true");
  });

  /**
   * WHERE describeDisconnect's OWNERSHIP COMES FROM. The action itself does no ownership check
   * — a foreign id counts zero rather than being refused — so the guarantee that it is only
   * ever asked about the caller's OWN accounts is made HERE, by the tenant-filtered read that
   * produces the panel's list (`AccountDisconnectPanel` calls it with `account.id` and nothing
   * else). That is a real dependency between two files, and it was recorded in prose only.
   *
   * MUTATION TARGET: drop `.eq("user_id", userId)` from `listConnectedAccounts` and this spec
   * goes red — the other tenant's account appears in the panel, and would then be an id the UI
   * hands to describeDisconnect.
   */
  it("the panel is handed the caller's OWN accounts only — the ids describeDisconnect trusts", async () => {
    listKeys.mockResolvedValue([]);
    // These fixtures declare `user_id`, so the fake applies the page's filter for real.
    accountRows = [
      { ...account(), user_id: "user-1" },
      { ...account(SECOND_ACCOUNT_ID, "stranger@example.com"), user_id: "user-2" },
    ];
    await renderPage();

    expect(
      JSON.parse(screen.getByTestId("account-panel").getAttribute("data-accounts") ?? "[]"),
    ).toEqual([{ id: ACCOUNT_ID, email: "owner@example.com" }]);
    expect(document.body.textContent).not.toContain("stranger@example.com");
  });

  it("is mounted with no accounts at all, so a disconnect notice has somewhere to live", async () => {
    listKeys.mockResolvedValue([]);
    accountRows = [];
    await renderPage();

    expect(screen.getByTestId("account-panel").getAttribute("data-accounts")).toBe("[]");
  });
});
