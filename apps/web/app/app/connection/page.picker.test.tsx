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
    // The stub only reports THAT it was handed an action; the real result shape is pinned in
    // disconnect-button.test.tsx, so this deliberately does not restate it.
    unmapProject: (projectId: string) => Promise<unknown>;
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
 * WHAT THIS FILE OWNS — split out of `page.test.tsx` on 2026-08-13, spec for spec, nothing
 * rewritten. That file had grown to 1247 lines against a 800-line house maximum; these three
 * `describe` blocks were the largest self-contained seam in it.
 *
 * The surfaces reached AFTER a trip to Google: what the OAuth callback sent us back with, what
 * the `Change` disclosure offers once it is opened, and the state where an account's properties
 * cannot be read at all — which is the same surface answering "nothing to pick", for a reason
 * worth telling apart from "nothing there".
 *
 * The rest of the page — the API-key half, the three-group layout, the account-level connect
 * control and the account panel — stays in `page.test.tsx`. The harness below is that file's
 * harness, duplicated rather than imported: `vi.mock` is hoisted per FILE, so mock factories
 * cannot be shared through a module. Fixtures no spec here uses were dropped; nothing else moved.
 *
 * WHAT THIS FILE RENDERS AND WHAT IT REPLACES — the 2026-08-11 lesson, applied deliberately.
 *
 * RENDERED FOR REAL: `TrackedProjects`, `PropertyLibrary`, `ArchiveList` and `PropertyPicker`.
 * The picker is emphatically NOT stubbed — stubbing it is exactly what let a broken RSC boundary
 * pass every spec in the original file on 2026-08-11, and every assertion below reads the real
 * picker's DOM.
 *
 * REPLACED: `next/navigation` (there is no app router under vitest), the data layer, and the
 * server actions — plus `./key-panel` and `./disconnect-button`, kept as prop probes so the
 * page's decisions for them stay readable. Neither can render a `<select>`.
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

const PROJECT_A = { id: "11111111-1111-4111-8111-111111111111", domain: "alpha.example" };
const PROJECT_B = { id: "22222222-2222-4222-8222-222222222222", domain: "beta.example" };
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
