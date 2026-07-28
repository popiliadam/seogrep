import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    // The confirmed outcome — Google acknowledged the revoke.
    disconnectGscAction: vi.fn().mockResolvedValue("revoked"),
    ...overrides,
  };
}

const clickDisconnect = () =>
  fireEvent.click(screen.getByRole("button", { name: /disconnect alpha\.example/i }));

describe("DisconnectButton", () => {
  it("calls disconnectGscAction(projectId) and refreshes so the row re-renders from the DB", async () => {
    const p = props();
    render(<DisconnectButton {...p} />);

    clickDisconnect();

    await waitFor(() => expect(p.disconnectGscAction).toHaveBeenCalledWith(PROJECT_ID));
    // The refresh is what flips the server-rendered row back to "Not connected" + Connect:
    // this island never fakes that state locally.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    // A CONFIRMED revoke needs no caveat: the row disappearing is the whole message.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("surfaces an error (role=alert) and does NOT refresh when the action rejects", async () => {
    const p = props({ disconnectGscAction: vi.fn().mockRejectedValue(new Error("boom")) });
    render(<DisconnectButton {...p} />);

    clickDisconnect();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * M-15 + T5. The local half of a disconnect always succeeds here — the row is gone — so
   * the refresh still runs. What must NOT happen is the silent "done" that let the user
   * believe SeoGrep's access at Google was gone when nobody had confirmed it, or when the
   * revoke was never even attempted (a token sealed with a retired key).
   */
  describe.each([
    ["Google did not acknowledge", "unconfirmed"],
    ["the revoke was never attempted", "not_attempted"],
    // Defence in depth: an unrecognised answer is treated as unconfirmed, never as proof.
    ["the action answers something unexpected", undefined],
  ])("when %s", (_case, outcome) => {
    it("says the local connection is gone and does NOT claim revocation", async () => {
      const p = props({ disconnectGscAction: vi.fn().mockResolvedValue(outcome) });
      render(<DisconnectButton {...p} />);

      clickDisconnect();

      const notice = await screen.findByRole("status");
      expect(notice.textContent).toMatch(/could not confirm/i);
      // The user is handed the ONE place they can finish the job themselves.
      const link = within(notice).getByRole("link");
      expect(link.getAttribute("href")).toBe("https://myaccount.google.com/permissions");
      // The local deletion really happened, so the row must still re-render from the DB.
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("keeps the warning after the refresh removes the button (the notice outlives the row)", async () => {
    const p = props({ disconnectGscAction: vi.fn().mockResolvedValue("unconfirmed") });
    const { rerender } = render(<DisconnectButton {...p} />);

    clickDisconnect();
    await screen.findByRole("status");

    // What router.refresh() produces: the server now reports the project as unlinked.
    rerender(<DisconnectButton {...p} connected={false} />);

    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/could not confirm/i);
  });

  it("renders nothing to click for a project that is not connected", () => {
    render(<DisconnectButton {...props({ connected: false })} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
