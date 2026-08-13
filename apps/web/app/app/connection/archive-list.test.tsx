import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ArchiveList } from "./archive-list";

/**
 * NOTHING IN THIS FILE IS MOCKED EXCEPT `next/navigation`. The component under test renders for
 * real, including its own markup and its own copy — a spec that mocked the thing it is testing
 * would measure the mock, which is precisely how the 2026-08-11 outage went unseen.
 *
 * Fixture domains are the operator's live ones and carry NO word these assertions match on
 * ("archive", "restore", "nothing", "keeps"). Three prescribed fixtures on this branch turned
 * out to echo the sentence under test and passed against unmodified source.
 */
const P_KATRENUR = "33333333-3333-4333-8333-333333333333";
const P_BAYDER = "44444444-4444-4444-8444-444444444444";

const ROWS = [
  { projectId: P_KATRENUR, domain: "katrenur.com", property: "sc-domain:katrenur.com" },
  { projectId: P_BAYDER, domain: "bayder.com.tr", property: null },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const ok = () => vi.fn().mockResolvedValue({ ok: true });

describe("ArchiveList", () => {
  /**
   * The heading survives an empty list on purpose: a user who has just removed a site has to be
   * able to see WHERE it went, and a section that disappears when it is empty cannot tell them.
   */
  it("keeps its heading and explains the empty state when nothing is put away", () => {
    render(<ArchiveList rows={[]} restoreProject={ok()} />);

    expect(screen.getByRole("heading", { name: /archive/i })).toBeTruthy();
    expect(screen.getByText(/nothing is archived/i)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  /** State four of the four this surface must render: the archive is not empty. */
  it("renders one row per archived project and names the property it still holds", () => {
    render(<ArchiveList rows={ROWS} restoreProject={ok()} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("katrenur.com")).toBeTruthy();
    // The mapping survives archiving (untrackProject leaves gsc_connections alone), so the row
    // says what coming back would give you — in the SAME row, not in a note somewhere above it.
    expect(within(rows[0] as HTMLElement).getByText(/sc-domain:katrenur\.com/)).toBeTruthy();
    expect(screen.queryByText(/nothing is archived/i)).toBeNull();
  });

  /** A project archived before it ever had a property is still restorable — and still shown. */
  it("renders a project that holds no property, without inventing one", () => {
    render(<ArchiveList rows={ROWS} restoreProject={ok()} />);

    const row = within(screen.getAllByRole("listitem")[1] as HTMLElement);
    expect(row.getByText("bayder.com.tr")).toBeTruthy();
    expect(row.getByRole("button", { name: /bayder\.com\.tr/i })).toBeTruthy();
    expect(row.queryByText(/sc-domain:/)).toBeNull();
  });

  it("restores the project it was clicked on, then refreshes so the page re-reads the truth", async () => {
    const restoreProject = ok();
    render(<ArchiveList rows={ROWS} restoreProject={restoreProject} />);

    // The SECOND row, deliberately. Clicking the first proves nothing about which project the
    // button is bound to: a handler hard-wired to `rows[0]` satisfies it, and one written that
    // way survived this spec until this line was changed (measured 2026-08-13, mutation A6).
    fireEvent.click(screen.getByRole("button", { name: /bayder\.com\.tr/i }));

    await waitFor(() => expect(restoreProject).toHaveBeenCalledWith(P_BAYDER));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * The server's own sentence reaches the user WORD FOR WORD. That is the whole reason these
   * actions return a message instead of throwing: a generic "could not restore" would discard
   * the only explanation the user can act on.
   */
  it("shows the server's refusal verbatim and does not refresh on it", async () => {
    const sentence =
      "That project changed while this was running, so nothing was restored. Please try again.";
    const restoreProject = vi.fn().mockResolvedValue({ ok: false, error: sentence });
    render(<ArchiveList rows={ROWS} restoreProject={restoreProject} />);

    fireEvent.click(screen.getByRole("button", { name: /katrenur\.com/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(sentence));
    expect(refresh).not.toHaveBeenCalled();
    // The refusal belongs to the row it came from, not to the section.
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByRole("alert")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByRole("alert")).toBeNull();
  });

  it("survives a thrown action with a message of its own instead of an empty row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const restoreProject = vi.fn().mockRejectedValue(new Error("network"));
    render(<ArchiveList rows={ROWS} restoreProject={restoreProject} />);

    fireEvent.click(screen.getByRole("button", { name: /katrenur\.com/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/try again/i));
    // Nothing from the thrown error reaches the browser: its text can carry anything.
    expect(screen.getByRole("alert").textContent).not.toMatch(/network/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
