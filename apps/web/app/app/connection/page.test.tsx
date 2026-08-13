import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const listKeys = vi.fn();

/** Every table the page reads, and every .eq() filter it applied — the tenant-scoping proof. */
let fromCalls: string[] = [];
let eqCalls: { table: string; column: string; value: unknown }[] = [];
let projectRows: { id: string; domain: string; archived_at?: string | null }[] = [];
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
 * state hangs on `account_id`, the picker's stored choice on `gsc_property`, and the whole
 * tracked/archive split on `archived_at`; handing back a column the statement never selected
 * would let "an archived project stays out of Tracked sites" pass while the real query returned
 * no such column — green for the wrong reason. Projected, a forgotten column reads `undefined`
 * here exactly as it would from PostgREST, and the spec fails.
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
// The server actions, which cannot run under vitest. They are PROPS to the islands below, so
// what is measured is which action reached which control and with what — never a stand-in for
// a component this page renders.
vi.mock("./actions", () => ({
  createKeyAction: vi.fn(),
  rotateKeyAction: vi.fn(),
  revokeKeyAction: vi.fn(),
  unmapProject: vi.fn(),
  saveProjectProperty: vi.fn(),
  describeDisconnect: vi.fn(),
  disconnectAccount: vi.fn(),
}));
const trackProperty = vi.fn();
vi.mock("./tracking-actions", () => ({
  trackProperty: (...args: unknown[]) => trackProperty(...args),
  untrackProject: vi.fn(),
  restoreProject: vi.fn(),
}));
// The three group components run for real, so they need the router their refresh calls.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// Stub the client island so the page test focuses on the RSC's list + masked URL, and
// surfaces which activeKeyId the page computed and hands down. It is the ONE island still
// stubbed here, and it belongs to the API-key half of the page, which this surface does not
// touch — its own behaviour is pinned in key-panel.test.tsx.
vi.mock("./key-panel", () => ({
  KeyPanel: (p: { activeKeyId: string | null }) => (
    <div data-testid="key-panel" data-active-key-id={p.activeKeyId ?? ""} />
  ),
}));
// Same treatment for the disconnect islands: the stubs surface WHICH project (or account) the
// page bound them to and whether they were handed a real server action. The per-project stub
// mirrors the real component's own split — the island is mounted either way, the BUTTON exists
// only for a mapped project — so the specs below still pin exactly where a Disconnect
// affordance may appear. Both components' real behaviour is pinned in disconnect-button.test.tsx.
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

import ConnectionPage from "./page";
import { encodeChoice } from "./choice";

/**
 * WHAT THIS FILE RENDERS AND WHAT IT REPLACES — the 2026-08-11 lesson, applied deliberately.
 *
 * RENDERED FOR REAL: `TrackedProjects`, `PropertyLibrary`, `ArchiveList` and `PropertyPicker`.
 * The dropdown claim this task exists to make ("nine `<select>`s and 243 `<option>`s are gone")
 * can only be measured against a page that would actually have produced them, so the picker is
 * NOT stubbed here — that stub is exactly what let a broken RSC boundary pass every spec in
 * this file on 2026-08-11.
 *
 * REPLACED: `next/navigation` (there is no app router under vitest), the data layer, and the
 * server actions — plus `./key-panel` and `./disconnect-button`, two islands this redesign does
 * not change, kept as prop probes so the page's decisions for them stay readable. Neither can
 * render a `<select>`, so neither can flatter the combobox count.
 *
 * The RSC boundary itself is NOT measurable here at all — vitest has none. `rsc-boundary.test.ts`
 * is what gates it, by reading the sources.
 */

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
const PROJECT_C = { id: "33333333-3333-4333-8333-333333333333", domain: "gamma.example" };
/** The gsc_accounts row a mapped project points at — link state is this being non-null. */
const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_ACCOUNT_ID = "55555555-5555-4555-8555-555555555555";
/** Any past instant; only null-vs-not-null is ever read from it. */
const ARCHIVED_AT = "2026-08-13T09:00:00.000Z";

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
  trackProperty.mockResolvedValue({ ok: true });
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

/**
 * The group one section heading owns. The three groups each wrap their own `<h3>`, so this is
 * how "in the archive" and "not in Tracked sites" are asserted as different places rather than
 * as one document-wide text search.
 */
function groupOf(heading: RegExp): HTMLElement {
  const parent = screen.getByRole("heading", { name: heading }).parentElement;
  if (parent === null) throw new Error(`no group around ${String(heading)}`);
  return parent;
}

/** Open one tracked row's Change disclosure — where the surviving dropdown lives. */
function openChange(domain: string): HTMLElement {
  const row = rowOf(domain);
  fireEvent.click(within(row).getByRole("button", { name: /^change the search console property/i }));
  return row;
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

/**
 * THE MEASUREMENT THIS PAGE EXISTS FOR. Measured on the operator's live `/app/connection`
 * (2026-08-13): one Google account, 27 Search Console properties, 26 unused, and the SAME
 * 28-option `<select>` rendered once per project — 9 dropdowns, 243 `<option>` elements,
 * 2697px of page, every one of them expressing a single fact.
 *
 * These specs are the page-level claim, and they are only worth anything because this file
 * renders the real `PropertyPicker`: run against the previous `page.tsx` the first one fails
 * with three comboboxes and twelve options, which is what makes it a measurement rather than a
 * restatement of the components' own (vacuous) versions of it.
 */
describe("ConnectionPage — three groups instead of one dropdown per project", () => {
  it("renders no property dropdown at all, whatever the project count", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B, PROJECT_C];
    connectionRows = [];
    accountRows = [account()];
    sitesByAccount = {
      [ACCOUNT_ID]: [
        site("sc-domain:alpha.example"),
        site("https://spare.example/"),
        site("https://other.example/"),
      ],
    };
    await renderPage();

    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(document.querySelectorAll("option")).toHaveLength(0);
    // …and no project was dropped to achieve it: the spine is still the project.
    expect(within(groupOf(/^tracked sites$/i)).getAllByRole("listitem")).toHaveLength(3);
  });

  it("gives every project a row and names what it reads, with no trip to Google per row", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [mapping(PROJECT_B.id, ACCOUNT_ID, "https://beta.example/")];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("https://beta.example/")] };
    await renderPage();

    expect(within(rowOf(PROJECT_B.domain)).getByText("Reads https://beta.example/")).toBeTruthy();
    // A project with no property and no suggestion still gets a row that says so.
    expect(within(rowOf(PROJECT_A.domain)).getByText(/no search console property/i)).toBeTruthy();
    // Neither row sends the user to Google: the account-level control owns that trip, and the
    // per-row Reconnect link that used to duplicate it is gone with the rest of the row.
    expect(within(rowOf(PROJECT_A.domain)).queryByRole("link")).toBeNull();
    expect(within(rowOf(PROJECT_B.domain)).queryByRole("link")).toBeNull();
  });

  /**
   * THE ARCHIVE'S HEADING SURVIVES AN EMPTY LIST. A user who has just removed a site has to be
   * able to see where it went, and the archive is empty for every user until the first removal
   * — so a section that appears only when non-empty cannot tell anyone anything.
   */
  it("keeps the Archive section even when nothing is archived", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    await renderPage();

    expect(screen.getByRole("heading", { name: /^archive$/i })).toBeTruthy();
    expect(within(groupOf(/^archive$/i)).getByText(/nothing is archived/i)).toBeTruthy();
    expect(within(groupOf(/^archive$/i)).queryAllByRole("listitem")).toHaveLength(0);
  });

  /**
   * THE ARCHIVE FILTER, which this page had none of. `archived_at` was neither selected nor
   * read, so it was harmless only for as long as nothing ever wrote it — and this branch is
   * what writes it. The split is made by `groupConnectionRows`, not by the query, because this
   * is the one surface that MUST render archived rows: filtering them out in SQL (the shape
   * every MCP list path uses) would empty the group below.
   *
   * MUTATION TARGET: drop `archived_at` from the projects select and this goes red twice —
   * beta.example appears under Tracked sites and vanishes from the archive.
   */
  it("puts an archived project in the archive and never under tracked sites", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, { ...PROJECT_B, archived_at: ARCHIVED_AT }];
    connectionRows = [mapping(PROJECT_B.id, ACCOUNT_ID, "https://beta.example/")];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("https://beta.example/")] };
    await renderPage();

    const archive = groupOf(/^archive$/i);
    expect(within(archive).getByText(PROJECT_B.domain)).toBeTruthy();
    // Archiving keeps the mapping, which is what makes coming back free — so the row names it.
    expect(within(archive).getByText("Keeps https://beta.example/")).toBeTruthy();
    expect(within(archive).getByRole("button", { name: `Restore ${PROJECT_B.domain}` })).toBeTruthy();

    const tracked = groupOf(/^tracked sites$/i);
    expect(within(tracked).getByText(PROJECT_A.domain)).toBeTruthy();
    expect(within(tracked).queryByText(PROJECT_B.domain)).toBeNull();
  });

  /**
   * THE FOOT-TRAP `groupConnectionRows` DOCUMENTS. It is scoped to ONE account: `tracked` and
   * `archived` do not depend on the account at all, so calling it once per account would repeat
   * every project row N times, while `library` — which does depend on it — must be per account.
   *
   * MUTATION TARGET: move the tracked/archive groups inside an `accounts.map(…)` and the two
   * listitem counts below double.
   */
  it("renders ONE tracked group and ONE archive, and a library per connected account", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, { ...PROJECT_B, archived_at: ARCHIVED_AT }];
    connectionRows = [];
    accountRows = [account(), account(SECOND_ACCOUNT_ID, "second@example.com")];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("sc-domain:alpha.example")],
      [SECOND_ACCOUNT_ID]: [site("https://spare.example/")],
    };
    await renderPage();

    expect(screen.getAllByRole("heading", { name: /^tracked sites$/i })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: /^archive$/i })).toHaveLength(1);
    expect(within(groupOf(/^tracked sites$/i)).getAllByRole("listitem")).toHaveLength(1);
    expect(within(groupOf(/^archive$/i)).getAllByRole("listitem")).toHaveLength(1);

    const library = groupOf(/^add from search console$/i);
    expect(within(library).getByText("owner@example.com")).toBeTruthy();
    expect(within(library).getByText("second@example.com")).toBeTruthy();
    expect(within(library).getByText("sc-domain:alpha.example")).toBeTruthy();
    expect(within(library).getByText("https://spare.example/")).toBeTruthy();
  });

  /**
   * The library is what replaces 26 unusable options per dropdown: one row, one button, and
   * only for properties nothing reads yet. A property a project already reads is left out —
   * the tracked row above is where it is spoken about, and offering it twice under two
   * different names is the duplicated surface this redesign removes.
   */
  it("offers only the properties nothing reads, under the account that lists them", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, ACCOUNT_ID, "https://alpha.example/")];
    accountRows = [account()];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("https://alpha.example/"), site("https://spare.example/")],
    };
    await renderPage();

    const library = groupOf(/^add from search console$/i);
    expect(within(library).getByText("https://spare.example/")).toBeTruthy();
    expect(within(library).queryByText("https://alpha.example/")).toBeNull();
    expect(
      within(library).getByRole("button", { name: "Track https://spare.example/" }),
    ).toBeTruthy();
  });

  /**
   * ADDED BY THE IMPLEMENTER after a mutation survived. Hard-coding `listed: 0` in
   * `libraryAccountsFor` reddened NOTHING at page level: every page fixture whose library came
   * back empty was an account that genuinely listed nothing, so the two sentences were never
   * told apart from here. The distinction is pinned in property-library.test.tsx, but the value
   * that drives it is the PAGE's to compute — and the state it separates is the operator's own:
   * 27 properties, all of them tracked, told "No Search Console properties on this account."
   */
  it("says an account whose properties are ALL tracked is not an account with none", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, ACCOUNT_ID, "https://alpha.example/")];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("https://alpha.example/")] };
    await renderPage();

    const library = groupOf(/^add from search console$/i);
    expect(
      within(library).getByText("Every Search Console property on this account is already tracked."),
    ).toBeTruthy();
    expect(
      within(library).queryByText("No Search Console properties on this account."),
    ).toBeNull();
  });

  it("tracks the property the library button belongs to, on the account that lists it", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("https://spare.example/")] };
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Track https://spare.example/" }));

    await waitFor(() =>
      expect(trackProperty).toHaveBeenCalledWith(ACCOUNT_ID, "https://spare.example/"),
    );
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

  /**
   * RE-AIMED. This used to assert the page's own "No projects yet…" paragraph, which is gone:
   * `TrackedProjects` owns its empty state, and two paragraphs saying the same thing one above
   * the other is the repetition this redesign exists to remove. The instruction that mattered —
   * where a project comes from — is still on the page, and still exactly once.
   */
  it("no projects: the tracked group says so once, and still points at setup_project", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [];
    connectionRows = [];
    await renderPage();

    expect(screen.getAllByText(/no sites are tracked yet/i)).toHaveLength(1);
    expect(screen.getByText(/setup_project/)).toBeTruthy();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "Connect Google account" }).getAttribute("href"),
    ).toBe("/api/gsc/connect");
  });

  it("does not read projects at all when there is no user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    listKeys.mockResolvedValue([]);
    render(await ConnectionPage({ searchParams: Promise.resolve({}) }));

    expect(fromCalls).toEqual([]);
    expect(screen.getByText(/no sites are tracked yet/i)).toBeTruthy();
  });

  /**
   * The blurb is the only place a user learns what these controls do, so it may not promise
   * something they do not do. It used to say Disconnect "asks Google to revoke SeoGrep's
   * access"; since the credential moved to the Google ACCOUNT (migration 0021) no per-project
   * control revokes anything, and that sentence would have told a user their Search Console
   * access was gone while the grant was still live at Google.
   */
  it("the Search Console blurb does not promise a revoke no per-project control performs", async () => {
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
 * THE SURVIVING DROPDOWN — one per row, opened on demand, never rendered up front.
 *
 * `PropertyPicker` is not deleted by this redesign, and the reason is in the operator's own
 * data: `adstark.com.tr` reads `https://rkturizm.com/`. No name-based path can produce that
 * mapping, so the escape hatch has to stay reachable by hand — but behind a disclosure, which
 * is what takes it off the page until it is asked for.
 *
 * Every assertion below reads the REAL picker's DOM. The property list is fetched LIVE on each
 * render and never cached: a cache would grow its own staleness problem, and a dead token
 * SHOULD make the fetch fail, because that failure is what this page exists to reveal.
 */
describe("ConnectionPage — the property picker behind Change", () => {
  it("stays closed until Change is clicked, then offers the live properties", async () => {
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

    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    const row = openChange(PROJECT_A.domain);
    const options = within(within(row).getByRole("combobox")).getAllByRole("option");

    expect(options.map((option) => option.textContent)).toEqual([
      "Select a property…",
      "sc-domain:alpha.example — siteOwner",
      "https://alpha.example/ — siteUnverifiedUser",
    ]);
    // The real allowlist decides this: an unverified user cannot query, so the option is
    // rendered (the user can see it exists) but never selectable — finding #50 made
    // structurally impossible rather than merely unlikely.
    expect((options[1] as HTMLOptionElement).disabled).toBe(false);
    expect((options[2] as HTMLOptionElement).disabled).toBe(true);
  });

  it("asks Google with each account's OWN token and offers both accounts' properties", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    accountRows = [account(), account(SECOND_ACCOUNT_ID, "second@example.com")];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("sc-domain:alpha.example")],
      [SECOND_ACCOUNT_ID]: [site("https://spare.example/")],
    };
    await renderPage();

    expect(listSites).toHaveBeenCalledWith(`token:${ACCOUNT_ID}`);
    expect(listSites).toHaveBeenCalledWith(`token:${SECOND_ACCOUNT_ID}`);

    const select = within(openChange(PROJECT_A.domain)).getByRole("combobox");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual([
      "",
      encodeChoice(ACCOUNT_ID, "sc-domain:alpha.example"),
      encodeChoice(SECOND_ACCOUNT_ID, "https://spare.example/"),
    ]);
  });

  /**
   * `resolveGscProperty` is not mocked here: this is the real candidate walk, so the
   * suggestion inherits its preference order (a domain property outranks a url-prefix one)
   * AND its refusals. It no longer DECIDES anything — the row proposes it, one click applies
   * it, and the ACCOUNT rides with the property because the same string can sit on two.
   */
  it("proposes resolveGscProperty's match as one click, with the account attached", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [];
    accountRows = [account()];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("https://alpha.example/"), site("sc-domain:alpha.example")],
    };
    await renderPage();

    const row = rowOf(PROJECT_A.domain);
    expect(within(row).getByText("Suggested: sc-domain:alpha.example")).toBeTruthy();
    fireEvent.click(
      within(row).getByRole("button", {
        name: `Confirm sc-domain:alpha.example for ${PROJECT_A.domain}`,
      }),
    );

    await waitFor(() =>
      expect(trackProperty).toHaveBeenCalledWith(ACCOUNT_ID, "sc-domain:alpha.example"),
    );
    // The picker follows the same suggestion when it is opened.
    expect((within(openChange(PROJECT_A.domain)).getByRole("combobox") as HTMLSelectElement).value)
      .toBe(encodeChoice(ACCOUNT_ID, "sc-domain:alpha.example"));
  });

  /**
   * The subdomain refusal `resolveGscProperty` has always carried is inherited whole: a
   * project on blog.alpha.example may not be suggested the apex property, because whoever
   * verified the apex never said they meant to hand us the subdomain's data.
   */
  it("proposes nothing where resolveGscProperty refuses — a subdomain never inherits the apex", async () => {
    listKeys.mockResolvedValue([]);
    const blog = { id: "66666666-6666-4666-8666-666666666666", domain: "blog.alpha.example" };
    projectRows = [blog];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("sc-domain:alpha.example")] };
    await renderPage();

    const row = rowOf(blog.domain);
    expect(within(row).queryByRole("button", { name: /^confirm/i })).toBeNull();
    expect(within(row).getByText(/no search console property/i)).toBeTruthy();
    // The apex is still offered by hand — it is simply never proposed.
    expect((within(openChange(blog.domain)).getByRole("combobox") as HTMLSelectElement).value).toBe(
      "",
    );
  });

  it("shows the STORED mapping as what the row reads and as the picker's current value", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, ACCOUNT_ID, "https://alpha.example/")];
    accountRows = [account()];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("https://alpha.example/"), site("sc-domain:alpha.example")],
    };
    await renderPage();

    expect(within(rowOf(PROJECT_A.domain)).getByText("Reads https://alpha.example/")).toBeTruthy();
    // NOT the suggestion, which the real `resolveGscProperty` would answer with the DOMAIN
    // property — so a fallback to it cannot pass this by accident.
    expect(
      (within(openChange(PROJECT_A.domain)).getByRole("combobox") as HTMLSelectElement).value,
    ).toBe(encodeChoice(ACCOUNT_ID, "https://alpha.example/"));
  });

  /**
   * `account_id IS NULL` + `gsc_property` set is the design's own state (spec line 68): "the
   * mapping stands, connect to activate it" — what migration 0021 leaves every migrated row in.
   * It is NOT reported as what the project reads, and no Confirm is offered over it: the
   * suggestion here is a DIFFERENT property, and letting an opinionated matcher speak over a
   * value the user already chose is what every migrated row silently suffered.
   */
  it("names a stored-but-unread property, and pre-selects it where an account lists it", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, null, "https://alpha.example/")];
    accountRows = [account()];
    sitesByAccount = {
      [ACCOUNT_ID]: [site("https://alpha.example/"), site("sc-domain:alpha.example")],
    };
    await renderPage();

    const row = rowOf(PROJECT_A.domain);
    expect(
      within(row).getByText("Saved earlier: https://alpha.example/ — nothing reads it yet."),
    ).toBeTruthy();
    expect(within(row).queryByText(/^reads /i)).toBeNull();
    expect(within(row).queryByRole("button", { name: /^confirm/i })).toBeNull();

    const opened = openChange(PROJECT_A.domain);
    expect((within(opened).getByRole("combobox") as HTMLSelectElement).value).toBe(
      encodeChoice(ACCOUNT_ID, "https://alpha.example/"),
    );
    expect(
      within(opened).getByText(/it is selected below — save to switch it back on/i),
    ).toBeTruthy();
  });

  /**
   * Before any account is connected there is nothing to pick and nothing to unlink, so the row
   * opens onto nothing and offers no Change at all. The stored value is still what the user was
   * told was kept, so the ROW names it — that is the whole reason it is a row-level status and
   * not a note inside a control that may not exist.
   */
  it("names the stored property of an unmapped row even with no account to offer it", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [mapping(PROJECT_A.id, null, "https://alpha.example/")];
    accountRows = [];
    await renderPage();

    const row = rowOf(PROJECT_A.domain);
    expect(
      within(row).getByText("Saved earlier: https://alpha.example/ — nothing reads it yet."),
    ).toBeTruthy();
    expect(
      within(row).queryByRole("button", { name: /^change the search console property/i }),
    ).toBeNull();
  });

  /**
   * `sites: null` is a FAILED read, not an empty listing. Folded through `?? []` it looked like
   * an account that answered "nothing", so a retained property nobody could confirm came out of
   * the picker as "No connected Google account lists it right now" — an absence derived from a
   * question that was never answered.
   *
   * MUTATION TARGET: hard-code `listingComplete: true` in `retainedMappingFor` and the sentence
   * below flips to the "lists it nowhere" one.
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

    const opened = openChange(PROJECT_A.domain);
    expect(
      within(opened).getByText(/whether it is still listed is unknown/i),
    ).toBeTruthy();
    expect(within(opened).queryByText(/lists it right now/i)).toBeNull();
    expect((within(opened).getByRole("combobox") as HTMLSelectElement).value).toBe("");
  });

  it("claims no retained property for a MAPPED row, or for one that stored none", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [
      mapping(PROJECT_A.id, ACCOUNT_ID, "https://alpha.example/"), // mapped -> it READS it
      mapping(PROJECT_B.id, null, null), // unmapped, nothing stored -> nothing to show
    ];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("https://alpha.example/")] };
    await renderPage();

    expect(within(rowOf(PROJECT_A.domain)).queryByText(/saved earlier/i)).toBeNull();
    expect(within(rowOf(PROJECT_B.domain)).queryByText(/saved earlier/i)).toBeNull();
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

    expect(
      within(openChange(PROJECT_A.domain)).getByText(
        "https://gone.example/ is no longer visible on this account — pick another.",
      ),
    ).toBeTruthy();
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

    // The row is still openable — the mapping can be dropped even when Google is unreachable.
    expect(within(openChange(PROJECT_A.domain)).queryByText(/no longer visible/i)).toBeNull();
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

    expect(
      within(openChange(PROJECT_A.domain)).getByText("Also mapped to 1 other project."),
    ).toBeTruthy();
    // Both rows still read it: sharing one domain property across projects is legal.
    expect(
      within(rowOf(PROJECT_A.domain)).getByText("Reads sc-domain:alpha.example"),
    ).toBeTruthy();
    expect(
      within(rowOf(PROJECT_B.domain)).getByText("Reads sc-domain:alpha.example"),
    ).toBeTruthy();
  });

  /**
   * An ARCHIVED project is not a sharer the user can see. The note exists to say who else is
   * affected by a change, and naming a project that appears nowhere but the archive answers a
   * question the user cannot act on — the same "list paths hide archived rows" rule the tracked
   * group follows.
   *
   * MUTATION TARGET: drop `other.archivedAt === null` from `alsoMappedCount` and the count
   * below becomes 1.
   */
  it("does not count an ARCHIVED project as sharing the property", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, { ...PROJECT_B, archived_at: ARCHIVED_AT }];
    connectionRows = [
      mapping(PROJECT_A.id, ACCOUNT_ID, "sc-domain:alpha.example"),
      mapping(PROJECT_B.id, ACCOUNT_ID, "sc-domain:alpha.example"),
    ];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("sc-domain:alpha.example")] };
    await renderPage();

    expect(within(openChange(PROJECT_A.domain)).queryByText(/also mapped to/i)).toBeNull();
  });

  /**
   * DISCONNECT RIDES IN THE CHANGE SURFACE, not in the row. It answers the same question the
   * picker does ("what does this project read?") with "nothing", and it is NOT Remove: Remove
   * archives the whole project, this only clears the mapping.
   *
   * The island is mounted for both rows so an in-flight failure notice survives the very
   * refresh that unlinks the project; the BUTTON belongs to a mapped row only. That predicate
   * is `account_id`, not row existence — `unmapProject` keeps the row and an account disconnect
   * nulls the same column, and reading row existence showed both as still connected.
   */
  it("offers Disconnect inside Change, on the mapped row only", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [mapping(PROJECT_A.id, null, null), mapping(PROJECT_B.id)];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("https://spare.example/")] };
    await renderPage();

    // Nothing is revealed until it is asked for — that is what took the surface off the page.
    expect(screen.queryAllByTestId("disconnect-island")).toHaveLength(0);

    const mapped = openChange(PROJECT_B.domain);
    const disconnect = within(mapped).getByTestId("disconnect");
    expect(disconnect.getAttribute("data-project-id")).toBe(PROJECT_B.id);
    expect(disconnect.getAttribute("data-domain")).toBe(PROJECT_B.domain);
    expect(disconnect.getAttribute("data-has-action")).toBe("true");

    const unmapped = openChange(PROJECT_A.domain);
    expect(within(unmapped).getByTestId("disconnect-island")).toBeTruthy();
    expect(within(unmapped).queryByTestId("disconnect")).toBeNull();
    expect(within(unmapped).queryByText(/^reads /i)).toBeNull();
  });

  it("offers nothing to change for a project with no mapping and no property to pick", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_B];
    connectionRows = []; // no row at all — a project that was never linked
    accountRows = [];
    await renderPage();

    const row = rowOf(PROJECT_B.domain);
    expect(within(row).getByText(/no search console property/i)).toBeTruthy();
    expect(
      within(row).queryByRole("button", { name: /^change the search console property/i }),
    ).toBeNull();
    expect(screen.queryAllByTestId("disconnect")).toHaveLength(0);
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
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    // An unreadable account renders as unreadable in the library, never as one with nothing on
    // it: an absence we did not observe is not an absence.
    expect(
      within(groupOf(/^add from search console$/i)).getByText(/could not be read just now/i),
    ).toBeTruthy();
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

  /**
   * THE EMPTY STATE IS THE PAGE'S SENTENCE, NOT THE ROW'S. It used to be the row's: every
   * project rendered the same "No Search Console properties are available…" paragraph, so an
   * operator with nine projects who had just disconnected their account read the same thing
   * nine times and the only way back was a link with the weight of body text. The explanation
   * belongs where the state does — to the account list — and is asserted here to appear ONCE.
   */
  it("explains the empty state ONCE at page level, not once per project", async () => {
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [];
    accountRows = [];
    listKeys.mockResolvedValue([]);
    await renderPage();

    expect(
      screen.getAllByText(/Connect a Google account to choose which Search Console property/),
    ).toHaveLength(1);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  /**
   * ADDED BY THE IMPLEMENTER, not by the plan, because the plan's own mutation proved the spec
   * above does not pin what it claims to. Loosening the page's `accounts.length === 0` guard to
   * `>= 0` left the whole suite GREEN: the spec above renders with no accounts, so a sentence
   * that shows unconditionally still appears exactly once there. Nothing anywhere asserted the
   * sentence STOPS. This does — and with it, the mutation goes red.
   */
  it("stops saying it once an account is connected — the sentence is the EMPTY state's", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [site("sc-domain:alpha.example")] };
    await renderPage();

    expect(
      screen.queryByText(/Connect a Google account to choose which Search Console property/),
    ).toBeNull();
    // The way to add ANOTHER account is still on the page — the sentence goes, the control stays.
    expect(screen.getByRole("link", { name: "Connect Google account" })).toBeTruthy();
  });

  /**
   * THE STATE THE MOVE LEFT UNCOVERED, and the reason this page needs TWO sentences rather than
   * one condition. The row paragraph that was removed fired on `options.length === 0` — nothing
   * to pick, whatever the cause. Its replacement fires on `accounts.length === 0`, which is
   * STRICTLY NARROWER: an account can be connected and list no property at all, which is exactly
   * what picking the wrong Google account at the consent screen produces.
   *
   * Nothing else speaks in that state: the amber warning wants `sites === null` (a FAILED read,
   * not an empty listing), and the picker is behind a Change button that is not offered.
   */
  it("explains a connected account that lists NOTHING — an empty listing is not a failed one", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: [] }; // read fine; Google simply has nothing on it
    await renderPage();

    expect(
      screen.getAllByText(/None of your connected Google accounts lists a Search Console property/),
    ).toHaveLength(1);
    // NOT the zero-account sentence: an account IS connected, so asking the user to connect one
    // "to choose which property each project reads" would be false.
    expect(
      screen.queryByText(/Connect a Google account to choose which Search Console property/),
    ).toBeNull();
    // And no invented read failure — nothing failed. The library says the fact, not the remedy.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      within(groupOf(/^add from search console$/i)).getByText(
        "No Search Console properties on this account.",
      ),
    ).toBeTruthy();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  /**
   * THE OTHER HALF OF THAT SENTENCE'S HONESTY. A `sites.list` that FAILED tells us nothing about
   * what the account lists, so "none of them lists a property" would be an absence derived from
   * a question never answered — the inference `missingPropertyFor` and `listingComplete` already
   * refuse for a row. The amber warning owns this state, and it says something the user can act
   * on that the empty-listing sentence does not.
   */
  it("says nothing about the listing when a read FAILED — the amber warning owns that state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    accountRows = [account()];
    sitesByAccount = { [ACCOUNT_ID]: new Error("Google token endpoint failed (400): invalid_grant") };
    await renderPage();

    expect(
      screen.queryByText(/None of your connected Google accounts lists a Search Console property/),
    ).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/could not read the search console/i);
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
    // The library says the same thing in its own scope, with the way forward.
    expect(
      within(groupOf(/^add from search console$/i)).getByText(
        /connect a google account to add its search console properties/i,
      ),
    ).toBeTruthy();
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
