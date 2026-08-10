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
    connected: true,
    unmapProject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const clickDisconnect = () =>
  fireEvent.click(screen.getByRole("button", { name: /disconnect alpha\.example/i }));

describe("DisconnectButton", () => {
  it("calls unmapProject(projectId) and refreshes so the row re-renders from the DB", async () => {
    const p = props();
    render(<DisconnectButton {...p} />);

    clickDisconnect();

    await waitFor(() => expect(p.unmapProject).toHaveBeenCalledWith(PROJECT_ID));
    // The refresh is what flips the server-rendered row back to "Not connected" + Connect:
    // this island never fakes that state locally.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * Finding #63, at the UI. This button is the PROJECT level: it unlinks one project and
   * never asks Google for anything. The M-15 rule it inherits — never let a user believe
   * SeoGrep's access at Google changed unless something confirmed it — is therefore met by
   * saying NOTHING about Google here, in either direction. A leftover "we could not confirm
   * the revocation" notice would be exactly the false alarm the split exists to remove; the
   * real warning lives with `disconnectAccount`'s outcome, which Task 6 mounts.
   */
  it("says nothing about Google or revocation — a project unmap revokes nothing", async () => {
    const p = props();
    const { container } = render(<DisconnectButton {...p} />);

    clickDisconnect();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).not.toMatch(/revok|google/i);
  });

  it("surfaces an error (role=alert) and does NOT refresh when the action rejects", async () => {
    const p = props({ unmapProject: vi.fn().mockRejectedValue(new Error("boom")) });
    render(<DisconnectButton {...p} />);

    clickDisconnect();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders nothing to click for a project that is not connected", () => {
    render(<DisconnectButton {...props({ connected: false })} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
