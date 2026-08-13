import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { TrackedProjects, type TrackedProjectRow } from "./tracked-projects";

/**
 * THE REAL COMPONENT RENDERS HERE — only `next/navigation` is replaced. The one thing handed in
 * rather than built is the `picker` NODE, and that is a slot, not a mock of the code under test:
 * what is being measured is whether this component reveals it and when, so its contents are
 * deliberately opaque. (`page.test.tsx` mocking `./property-picker` is how a broken RSC boundary
 * passed every spec in 2026-08-11 — a component spec that mocks its own subject measures the mock.)
 *
 * Fixture domains are the operator's live ones. None contains a word these assertions match on:
 * "reads", "confirm", "change", "remove", "saved", "no search console property".
 */
const ACC = "44444444-4444-4444-8444-444444444444";
const P_ADSTARK = "11111111-1111-4111-8111-111111111111";
const P_EXAMPLE = "22222222-2222-4222-8222-222222222222";

function row(overrides: Partial<TrackedProjectRow> = {}): TrackedProjectRow {
  return {
    projectId: P_ADSTARK,
    domain: "adstark.com.tr",
    property: null,
    retained: null,
    suggestion: null,
    picker: null,
    ...overrides,
  };
}

/** The live mapping whose names do NOT match — the one that killed the property-first list. */
const READING = row({ property: "https://rkturizm.com/" });
/** Measured 2026-08-13: no property, no suggestion. It must still have a row. */
const BARE = row({ projectId: P_EXAMPLE, domain: "example.net" });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const ok = () => vi.fn().mockResolvedValue({ ok: true });

function mount(rows: readonly TrackedProjectRow[], overrides: Partial<{
  trackProperty: ReturnType<typeof ok>;
  untrackProject: ReturnType<typeof ok>;
}> = {}) {
  const props = {
    rows,
    trackProperty: overrides.trackProperty ?? ok(),
    untrackProject: overrides.untrackProject ?? ok(),
  };
  render(<TrackedProjects {...props} />);
  return props;
}

describe("TrackedProjects", () => {
  it("keeps its heading and explains the empty state when nothing is tracked", () => {
    mount([]);

    expect(screen.getByRole("heading", { name: /tracked sites/i })).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/no sites are tracked yet/i)).toBeTruthy();
  });

  /**
   * The spine is the PROJECT. A project with no property and no suggestion still gets a row —
   * crawl and audit run for it, and OAuth is deliberately the second step, so a property-keyed
   * list would erase a working project from the page.
   */
  it("gives every project a row, including one with no property at all", () => {
    mount([READING, BARE]);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[1] as HTMLElement).getByText("example.net")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText(/no search console property/i)).toBeTruthy();
    // One list, no per-project dropdown: nine of them (243 options) are what this replaces.
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("names what a project reads, even when the names do not match", () => {
    mount([READING]);

    const only = within(screen.getAllByRole("listitem")[0] as HTMLElement);
    expect(only.getByText(/reads https:\/\/rkturizm\.com\//i)).toBeTruthy();
    expect(only.queryByText(/no search console property/i)).toBeNull();
    // Nothing to confirm: it is already reading something.
    expect(only.queryByRole("button", { name: /^confirm/i })).toBeNull();
  });

  it("offers a suggestion as one click and sends the account with it", async () => {
    const props = mount([
      row({ suggestion: { accountId: ACC, property: "sc-domain:adstark.com.tr" } }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /^confirm/i }));

    await waitFor(() =>
      expect(props.trackProperty).toHaveBeenCalledWith(ACC, "sc-domain:adstark.com.tr"),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /**
   * `account_id IS NULL` with a property still stored is the state migration 0021 left every row
   * in. The stored value is named, and it is NOT reported as what the project reads.
   *
   * No Confirm is offered beside it, deliberately: `resolveGscProperty` is opinionated, so
   * confirming its suggestion here would re-point a project whose owner had already chosen
   * something else — which is what every migrated row silently suffered. Change is the way back.
   */
  it("names a stored-but-unread property and does not offer to overwrite it", () => {
    mount([
      row({
        retained: "https://rkturizm.com/",
        suggestion: { accountId: ACC, property: "sc-domain:adstark.com.tr" },
        picker: <span>picker slot</span>,
      }),
    ]);

    const only = within(screen.getAllByRole("listitem")[0] as HTMLElement);
    expect(only.getByText(/saved earlier: https:\/\/rkturizm\.com\//i)).toBeTruthy();
    expect(only.queryByText(/^reads /i)).toBeNull();
    expect(only.queryByRole("button", { name: /^confirm/i })).toBeNull();
    expect(only.getByRole("button", { name: /^change/i })).toBeTruthy();
  });

  /**
   * The name-mismatch escape hatch. `PropertyPicker` is not deleted by this redesign — it is the
   * only way to map `adstark.com.tr` to `https://rkturizm.com/`, which is what the live data
   * actually does. It stays behind a disclosure so it costs nothing until it is asked for.
   */
  it("reveals the change surface only when it is asked for", () => {
    mount([row({ picker: <span>picker slot</span> })]);

    expect(screen.queryByText("picker slot")).toBeNull();
    const change = screen.getByRole("button", { name: /^change/i });
    expect(change.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(change);

    expect(screen.getByText("picker slot")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^change/i }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("offers no change control when the page handed it no surface to open", () => {
    mount([BARE]);

    expect(screen.queryByRole("button", { name: /^change/i })).toBeNull();
  });

  it("removes the project it was clicked on, then refreshes", async () => {
    const props = mount([READING, BARE]);

    fireEvent.click(screen.getByRole("button", { name: /remove example\.net/i }));

    await waitFor(() => expect(props.untrackProject).toHaveBeenCalledWith(P_EXAMPLE));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the server's refusal verbatim, in the row it belongs to", async () => {
    const sentence =
      "That project changed while this was running, so nothing was archived. Please try again.";
    const untrackProject = vi.fn().mockResolvedValue({ ok: false, error: sentence });
    mount([READING, BARE], { untrackProject });

    fireEvent.click(screen.getByRole("button", { name: /remove adstark\.com\.tr/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(sentence));
    expect(refresh).not.toHaveBeenCalled();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByRole("alert")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByRole("alert")).toBeNull();
  });

  it("survives a thrown action without leaking its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const untrackProject = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    mount([READING], { untrackProject });

    fireEvent.click(screen.getByRole("button", { name: /remove adstark\.com\.tr/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/try again/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/ECONNRESET/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
