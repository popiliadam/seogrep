import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const listKeys = vi.fn();

/** Every table the page reads, and every .eq() filter it applied — the tenant-scoping proof. */
let fromCalls: string[] = [];
let eqCalls: { table: string; column: string; value: unknown }[] = [];
let projectRows: { id: string; domain: string }[] = [];
let connectionRows: { project_id: string; account_id: string | null }[] = [];

/**
 * Minimal PostgREST-ish builder: records the table + every .eq(), and resolves to that
 * table's rows whether the caller ends the chain with .order() or awaits it directly.
 *
 * It PROJECTS the requested columns, and that is load-bearing rather than tidiness. The link
 * state now hangs on `account_id`; handing back a column the statement never selected would
 * let "unmapped rows read Not connected" pass while the real query returned no such column —
 * green for the wrong reason. Projected, a forgotten column reads `undefined` here exactly as
 * it would from PostgREST, and the spec fails.
 */
function queryBuilder(table: string, columns: string) {
  const wanted = columns.split(",").map((column) => column.trim());
  const rows: Record<string, unknown>[] = table === "projects" ? projectRows : connectionRows;
  const result = {
    data: rows.map((row) => Object.fromEntries(wanted.map((column) => [column, row[column]]))),
    error: null,
  };
  const builder = {
    eq(column: string, value: unknown) {
      eqCalls.push({ table, column, value });
      return builder;
    },
    order() {
      return Promise.resolve(result);
    },
    then(onFulfilled?: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
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
vi.mock("@pseo/core", () => ({
  mcpUrlFor: (key: string, template: string) => template.replace("{key}", key),
  mcpUrlTemplate: () => "https://mcp.seogrep.com/mcp/{key}",
}));
vi.mock("./actions", () => ({
  createKeyAction: vi.fn(),
  rotateKeyAction: vi.fn(),
  revokeKeyAction: vi.fn(),
  unmapProject: vi.fn(),
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
}));

import ConnectionPage from "./page";

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

/** A gsc_connections row; `accountId: null` is a row whose mapping was cleared. */
function mapping(projectId: string, accountId: string | null = ACCOUNT_ID) {
  return { project_id: projectId, account_id: accountId };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fromCalls = [];
  eqCalls = [];
  projectRows = [];
  connectionRows = [];
});

async function renderPage() {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  render(await ConnectionPage());
}

/** The <li> that carries a given domain, so per-row state is asserted inside its own row. */
function rowOf(domain: string): HTMLElement {
  const row = screen.getByText(domain).closest("li");
  if (row === null) throw new Error(`no row contains "${domain}"`);
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

describe("ConnectionPage — Google Search Console", () => {
  it("marks each project connected or not and links to the connect route with its id", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A, PROJECT_B];
    connectionRows = [mapping(PROJECT_B.id)];
    await renderPage();

    const notConnected = rowOf(PROJECT_A.domain);
    expect(within(notConnected).getByText("Not connected")).toBeTruthy();
    const connectLink = within(notConnected).getByRole("link", { name: "Connect" });
    expect(connectLink.getAttribute("href")).toBe(
      `/api/gsc/connect?project_id=${PROJECT_A.id}`,
    );

    const connected = rowOf(PROJECT_B.domain);
    expect(within(connected).getByText("Connected")).toBeTruthy();
    const reconnectLink = within(connected).getByRole("link", { name: "Reconnect" });
    expect(reconnectLink.getAttribute("href")).toBe(
      `/api/gsc/connect?project_id=${PROJECT_B.id}`,
    );
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
    expect(within(row).getByRole("link", { name: "Connect" })).toBeTruthy();
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
    expect(within(row).getByRole("link", { name: "Connect" })).toBeTruthy();
    expect(within(row).queryByText("Connected")).toBeNull();
    expect(within(row).queryByTestId("disconnect")).toBeNull();
  });

  /**
   * The blurb is the only place a user learns what Disconnect does, so it may not promise
   * something the button does not do. It used to say Disconnect "asks Google to revoke
   * SeoGrep's access"; since the credential moved to the Google ACCOUNT (migration 0021) the
   * per-project button revokes nothing, and that sentence would have told a user their
   * Search Console access was gone while the grant was still live at Google.
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
  });

  it("reads BOTH tenant tables with an explicit user_id filter (constitution NEVER #4)", async () => {
    listKeys.mockResolvedValue([]);
    projectRows = [PROJECT_A];
    connectionRows = [];
    await renderPage();

    expect(eqCalls).toContainEqual({ table: "projects", column: "user_id", value: "user-1" });
    expect(eqCalls).toContainEqual({
      table: "gsc_connections",
      column: "user_id",
      value: "user-1",
    });
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
    expect(screen.queryByRole("link", { name: "Connect" })).toBeNull();
  });

  it("does not read projects at all when there is no user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    listKeys.mockResolvedValue([]);
    render(await ConnectionPage());

    expect(fromCalls).toEqual([]);
    expect(
      screen.getByText("No projects yet. Create one from your MCP client with the setup_project tool."),
    ).toBeTruthy();
  });
});
