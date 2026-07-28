import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { DisconnectButton } from "./disconnect-button";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function props(overrides: Partial<Parameters<typeof DisconnectButton>[0]> = {}) {
  return {
    projectId: PROJECT_ID,
    domain: "alpha.example",
    disconnectGscAction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("DisconnectButton", () => {
  it("calls disconnectGscAction(projectId) and refreshes so the row re-renders from the DB", async () => {
    const p = props();
    render(<DisconnectButton {...p} />);

    fireEvent.click(screen.getByRole("button", { name: /disconnect alpha\.example/i }));

    await waitFor(() => expect(p.disconnectGscAction).toHaveBeenCalledWith(PROJECT_ID));
    // The refresh is what flips the server-rendered row back to "Not connected" + Connect:
    // this island never fakes that state locally.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces an error (role=alert) and does NOT refresh when the action rejects", async () => {
    const p = props({ disconnectGscAction: vi.fn().mockRejectedValue(new Error("boom")) });
    render(<DisconnectButton {...p} />);

    fireEvent.click(screen.getByRole("button", { name: /disconnect alpha\.example/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
