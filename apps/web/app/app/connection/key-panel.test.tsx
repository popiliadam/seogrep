import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { KeyPanel } from "./key-panel";

const REVEAL = {
  key: "sg_PLAINTEXTKEY",
  prefix: "sg_PLAINTE",
  mcpUrl: "https://mcp.seogrep.com/mcp/sg_PLAINTEXTKEY",
};
const ACTIVE_ID = "11111111-1111-4111-8111-111111111111";

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const HEADER_ENDPOINT = "https://mcp.seogrep.com/mcp";

function props(overrides: Partial<Parameters<typeof KeyPanel>[0]> = {}) {
  return {
    activeKeyId: null,
    headerEndpoint: HEADER_ENDPOINT,
    createKeyAction: vi.fn().mockResolvedValue(REVEAL),
    rotateKeyAction: vi.fn().mockResolvedValue(REVEAL),
    revokeKeyAction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("KeyPanel", () => {
  it("with no active key: shows Generate, reveals the key once, and copies the MCP URL", async () => {
    const p = props();
    render(<KeyPanel {...p} />);
    expect(screen.queryByRole("button", { name: /rotate key/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /generate key/i }));
    await waitFor(() => expect(p.createKeyAction).toHaveBeenCalledTimes(1));

    // One-time reveal: plaintext key + full MCP URL + the warning.
    expect(await screen.findByText(REVEAL.key)).toBeTruthy();
    expect(screen.getByText(REVEAL.mcpUrl)).toBeTruthy();
    expect(screen.getByText(/won't see this key again/i)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /copy mcp url/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(REVEAL.mcpUrl));
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/copied/i);
  });

  it("with an active key: shows Rotate + Revoke and rotates via rotateKeyAction(activeKeyId)", async () => {
    const p = props({ activeKeyId: ACTIVE_ID });
    render(<KeyPanel {...p} />);
    expect(screen.queryByRole("button", { name: /generate key/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /rotate key/i }));
    await waitFor(() => expect(p.rotateKeyAction).toHaveBeenCalledWith(ACTIVE_ID));
    expect(await screen.findByText(REVEAL.key)).toBeTruthy();
  });

  it("revoke calls revokeKeyAction(activeKeyId) and reveals no key", async () => {
    const p = props({ activeKeyId: ACTIVE_ID });
    render(<KeyPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /revoke key/i }));
    await waitFor(() => expect(p.revokeKeyAction).toHaveBeenCalledWith(ACTIVE_ID));
    expect(screen.queryByText(/won't see this key again/i)).toBeNull();
  });

  it("surfaces an error (role=alert) when the action rejects", async () => {
    const p = props({ createKeyAction: vi.fn().mockRejectedValue(new Error("boom")) });
    render(<KeyPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /generate key/i }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

/**
 * L-15. Both auth forms are supported by the server and both are documented, but the dashboard
 * offered only the URL-with-key form at the ONE moment the plaintext key is on screen — so a user
 * whose client sends headers had to leave and read the docs to learn the alternative existed.
 * This is strictly ADDITIVE: the URL form stays, and stays first.
 */
describe("KeyPanel — header auth alternative", () => {
  async function reveal(overrides: Partial<Parameters<typeof KeyPanel>[0]> = {}) {
    const p = props(overrides);
    render(<KeyPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /generate key/i }));
    await screen.findByText(REVEAL.key);
  }

  it("offers the fixed endpoint and an x-api-key snippet alongside the personal URL", async () => {
    await reveal();
    expect(screen.getByText(HEADER_ENDPOINT)).toBeTruthy();
    expect(screen.getByText(`x-api-key: ${REVEAL.key}`)).toBeTruthy();
  });

  it("does not replace or demote the URL form — both are offered, URL first", async () => {
    await reveal();
    const url = screen.getByText(REVEAL.mcpUrl);
    const header = screen.getByText(HEADER_ENDPOINT);
    expect(screen.getByRole("button", { name: /copy mcp url/i })).toBeTruthy();
    expect(url.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows nothing at all rather than an invented endpoint when none could be derived", async () => {
    await reveal({ headerEndpoint: null });
    expect(screen.getByText(REVEAL.mcpUrl)).toBeTruthy(); // the URL form is unaffected
    expect(screen.queryByText(/x-api-key/i)).toBeNull();
  });
});
