import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const listKeys = vi.fn();

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
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
}));
// Stub the client island so the page test focuses on the RSC's list + masked URL, and
// surfaces which activeKeyId the page computed and hands down.
vi.mock("./key-panel", () => ({
  KeyPanel: (p: { activeKeyId: string | null }) => (
    <div data-testid="key-panel" data-active-key-id={p.activeKeyId ?? ""} />
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage() {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  render(await ConnectionPage());
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
