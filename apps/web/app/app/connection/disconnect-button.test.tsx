import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AccountDisconnectPanel, DisconnectButton } from "./disconnect-button";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
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

  /**
   * `unmapProject` RESOLVES when it matched zero rows — a stale click on a project that is
   * already unmapped, or one that is not the caller's, is idempotent and non-enumerable by
   * design. So a resolved call is not evidence that anything changed, and this island must
   * not turn it into one: it reports nothing of its own and lets the refreshed row, read
   * back from the database, be the only statement about the new state.
   */
  it("claims no success of its own — a resolved unmap says only what the DB then says", async () => {
    const p = props();
    const { container } = render(<DisconnectButton {...p} />);

    clickDisconnect();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.textContent).not.toMatch(/disconnected|removed|unlinked|done/i);
  });

  it("surfaces an error (role=alert) and does NOT refresh when the action rejects", async () => {
    // The island logs the rejection for the operator; capture it rather than print it.
    vi.spyOn(console, "error").mockImplementation(() => {});
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

/**
 * THE ACCOUNT LEVEL (finding #63's other half, and M-15). `disconnectAccount` and
 * `describeDisconnect` have existed and been tested since the two-level split, with no
 * surface to reach them from: the task that built them was barred from mounting one. This is
 * that surface.
 *
 * Two things it must do that a plain button cannot:
 *   · name the BLAST RADIUS before the user commits — the grant is shared by every project
 *     mapped to the account, and a radius the user cannot see is one they cannot consent to;
 *   · tell the user when SeoGrep deleted its copy but Google did NOT confirm the revoke, and
 *     point at the page where they can finish the job themselves.
 *
 * The panel wraps the WHOLE account list rather than one row, and that is what makes the
 * second point survivable: `disconnectAccount` revalidates the page, so the row the user
 * clicked disappears — a per-row island would unmount and take the warning with it. The
 * project-level island solved the same problem by staying mounted for unlinked projects; this
 * is the same property one level up.
 */
describe("AccountDisconnectPanel", () => {
  const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";
  const SECOND_ID = "55555555-5555-4555-8555-555555555555";
  const RADIUS = "Disconnect this Google account? … 3 projects will stop reading Search Console data …";

  function panelProps(overrides: Partial<Parameters<typeof AccountDisconnectPanel>[0]> = {}) {
    return {
      accounts: [{ id: ACCOUNT_ID, email: "owner@example.com" }],
      describeDisconnect: vi.fn().mockResolvedValue(RADIUS),
      disconnectAccount: vi.fn().mockResolvedValue("revoked" as const),
      ...overrides,
    };
  }

  const clickAccountDisconnect = (email = "owner@example.com") =>
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`disconnect ${email}`, "i") }));
  /**
   * Click Confirm once it is actually CLICKABLE, which is not the same instant it is visible.
   *
   * Measured: for exactly one macrotask after the confirmation renders, the button is still
   * `disabled` — `ask()`'s `useTransition` pending flag has not cleared yet, and React commits
   * the question and the cleared flag in two separate passes. A click landing in that window
   * is a no-op on a disabled button, so `disconnectAccount` is never called and the assertion
   * that waits for it times out ~1s later. `findByText` normally flushes past the window; under
   * CPU contention its MutationObserver can fire inside it, which is the ~1-in-7 flake the
   * coordinator hit.
   *
   * Waiting for the control to be interactive is what a user does, and it is deterministic
   * either way.
   */
  async function confirmDisconnect() {
    const button = (await screen.findByRole("button", { name: /^confirm/i })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
  }

  it("names the blast radius BEFORE anything is disconnected", async () => {
    const p = panelProps();
    render(<AccountDisconnectPanel {...p} />);

    clickAccountDisconnect();

    // The count comes from describeDisconnect, called with the id of the row the user clicked
    // — an id this component only ever receives from the server-rendered, tenant-filtered
    // account list, because describeDisconnect performs no ownership check of its own.
    await waitFor(() => expect(p.describeDisconnect).toHaveBeenCalledWith(ACCOUNT_ID));
    expect(await screen.findByText(RADIUS)).toBeTruthy();
    expect(p.disconnectAccount).not.toHaveBeenCalled();
  });

  it("Cancel abandons the disconnect and asks Google for nothing", async () => {
    const p = panelProps();
    render(<AccountDisconnectPanel {...p} />);

    clickAccountDisconnect();
    await screen.findByText(RADIUS);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText(RADIUS)).toBeNull();
    expect(p.disconnectAccount).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("confirming disconnects that account and refreshes", async () => {
    const p = panelProps({
      accounts: [
        { id: ACCOUNT_ID, email: "owner@example.com" },
        { id: SECOND_ID, email: "second@example.com" },
      ],
    });
    render(<AccountDisconnectPanel {...p} />);

    clickAccountDisconnect("second@example.com");
    await screen.findByText(RADIUS);
    await confirmDisconnect();

    await waitFor(() => expect(p.disconnectAccount).toHaveBeenCalledWith(SECOND_ID));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /**
   * REGRESSION for the flake above, reproduced deterministically instead of by load.
   *
   * The suite normally reaches Confirm through `findByText`, which flushes past the one
   * macrotask in which the button is painted but still disabled. This spec lands INSIDE that
   * window on purpose — one `setTimeout(0)` after the click, measured as the tick where
   * `disabled` is still true — and then confirms through the helper. It goes red against a
   * bare `fireEvent.click`, which is the whole point: the fix is pinned, not just applied.
   *
   * It asserts the OUTCOME rather than the internal pending flag, so a future React that
   * commits both passes together makes this spec redundant, never flaky.
   */
  it("confirms even when it is reached in the tick where Confirm is still disabled", async () => {
    const p = panelProps();
    render(<AccountDisconnectPanel {...p} />);

    clickAccountDisconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText(RADIUS)).toBeTruthy();

    await confirmDisconnect();

    await waitFor(() => expect(p.disconnectAccount).toHaveBeenCalledWith(ACCOUNT_ID));
  });

  // M-15. `revoked` is the ONE outcome Google acknowledged, so it is the only one that may be
  // reported as a finished job — and the only one that must NOT send the user to Google.
  it("a confirmed revoke reports plainly and sends the user nowhere", async () => {
    const p = panelProps();
    render(<AccountDisconnectPanel {...p} />);

    clickAccountDisconnect();
    await screen.findByText(RADIUS);
    await confirmDisconnect();

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/revoked/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("link", { name: /google/i })).toBeNull();
  });

  it.each(["unconfirmed", "not_attempted"] as const)(
    "an %s revoke warns that Google may still list SeoGrep, with the page to finish it",
    async (outcome) => {
      const p = panelProps({ disconnectAccount: vi.fn().mockResolvedValue(outcome) });
      render(<AccountDisconnectPanel {...p} />);

      clickAccountDisconnect();
      await screen.findByText(RADIUS);
      await confirmDisconnect();

      const alert = await screen.findByRole("alert");
      // No claim that access is gone — only that OUR copy is, which is all we know.
      expect(alert.textContent).not.toMatch(/access (has been|was) revoked/i);
      expect(alert.textContent).toMatch(/could not confirm/i);
      const link = screen.getByRole("link", { name: /google/i });
      expect(link.getAttribute("href")).toBe("https://myaccount.google.com/permissions");
    },
  );

  /**
   * THE POINT OF PUTTING THIS ON THE PANEL AND NOT THE ROW. `disconnectAccount` revalidates
   * /app/connection, so the account the user just disconnected is gone from the next render.
   * A per-account island would unmount with it and the warning — the only place the user is
   * told to go finish the revoke at Google — would vanish in the same tick it appeared.
   */
  it("the warning SURVIVES the refresh that removes the account it was about", async () => {
    const p = panelProps({ disconnectAccount: vi.fn().mockResolvedValue("unconfirmed" as const) });
    const { rerender } = render(<AccountDisconnectPanel {...p} />);

    clickAccountDisconnect();
    await screen.findByText(RADIUS);
    await confirmDisconnect();
    await screen.findByRole("alert");

    // The server re-renders with the account gone — the island stays mounted.
    rerender(<AccountDisconnectPanel {...p} accounts={[]} />);

    expect(screen.getByRole("alert").textContent).toMatch(/could not confirm/i);
    expect(screen.queryByRole("button", { name: /disconnect owner@example\.com/i })).toBeNull();
  });

  it("a failed disconnect is reported and nothing is claimed about Google", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const p = panelProps({ disconnectAccount: vi.fn().mockRejectedValue(new Error("boom")) });
    render(<AccountDisconnectPanel {...p} />);

    clickAccountDisconnect();
    await screen.findByText(RADIUS);
    await confirmDisconnect();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not disconnect/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no accounts: still mounted, with nothing to disconnect and no false state", () => {
    render(<AccountDisconnectPanel {...panelProps({ accounts: [] })} />);

    expect(screen.getByText(/no google account is connected/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
