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

function props(overrides: Partial<Parameters<typeof KeyPanel>[0]> = {}) {
  return {
    activeKeyId: null,
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
