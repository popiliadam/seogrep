import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const listKeys = vi.fn();

/** Every table the page reads, and every .eq() filter it applied — the tenant-scoping proof. */
let fromCalls: string[] = [];
let eqCalls: { table: string; column: string; value: unknown }[] = [];
let projectRows: { id: string; domain: string }[] = [];
let connectionRows: { project_id: string }[] = [];

/**
 * Minimal PostgREST-ish builder: records the table + every .eq(), and resolves to that
 * table's rows whether the caller ends the chain with .order() or awaits it directly.
 */
function queryBuilder(table: string) {
  const result = {
    data: table === "projects" ? projectRows : connectionRows,
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
      return { select: () => queryBuilder(table) };
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
// split — the island is mounted for every project so its unconfirmed-revoke warning outlives
// the refresh, while the BUTTON exists only for a connected one — so the specs below still
// pin exactly where a Disconnect affordance may appear.
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
    connectionRows = [{ project_id: PROJECT_B.id }];
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
    connectionRows = [{ project_id: PROJECT_B.id }];
    await renderPage();

    // Nothing to unlink on a project that was never linked.
    expect(within(rowOf(PROJECT_A.domain)).queryByTestId("disconnect")).toBeNull();
    // The island itself rides on BOTH rows: an unconfirmed revoke has to keep warning the
    // user through the very refresh that flips their row to "Not connected" (M-15).
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
    connectionRows = []; // the state a successful disconnect leaves behind
    await renderPage();

    const row = rowOf(PROJECT_B.domain);
    expect(within(row).getByText("Not connected")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "Connect" })).toBeTruthy();
    expect(within(row).queryByText("Connected")).toBeNull();
    expect(within(row).queryByTestId("disconnect")).toBeNull();
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
