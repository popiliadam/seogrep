import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PropertyLibrary, type LibraryAccount } from "./property-library";

/**
 * THE REAL COMPONENT RENDERS HERE — only `next/navigation` is replaced. Nothing about the
 * markup, the copy or the disabled state is mocked, because a component spec that mocks the
 * component measures the mock (2026-08-11: `page.test.tsx` mocked `./property-picker`, so a
 * broken RSC boundary passed every spec while production could not render).
 *
 * Fixture values carry no word these assertions match on — "track", "cannot", "query",
 * "read", "connect". `siteUnverifiedUser` is Google's own string and shares none of them.
 */
const ACC = "44444444-4444-4444-8444-444444444444";

const ROWS = [
  { siteUrl: "sc-domain:balerin.com", permissionLevel: "siteOwner", queryable: true },
  { siteUrl: "https://www.bigcattr.com/", permissionLevel: "siteUnverifiedUser", queryable: false },
];

function account(overrides: Partial<LibraryAccount> = {}): LibraryAccount {
  return {
    accountId: ACC,
    email: "suleymanncapar@gmail.com",
    rows: ROWS,
    listed: 4,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const ok = () => vi.fn().mockResolvedValue({ ok: true });

describe("PropertyLibrary", () => {
  /** State one of four: no Google account is connected at all. */
  it("keeps its heading and names the way forward when no account is connected", () => {
    render(<PropertyLibrary accounts={[]} trackProperty={ok()} />);

    expect(screen.getByRole("heading", { name: /add from search console/i })).toBeTruthy();
    expect(screen.getByText(/connect a google account/i)).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  /** State two: an account IS connected and Google lists nothing on it. */
  it("says the account lists nothing when it really lists nothing", () => {
    render(<PropertyLibrary accounts={[account({ rows: [], listed: 0 })]} trackProperty={ok()} />);

    expect(screen.getByText(/no search console properties on this account/i)).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  /**
   * The same account with an empty library for the OPPOSITE reason. Folding these two into one
   * sentence would tell a user with 27 properties that they have none.
   */
  it("distinguishes an empty account from one whose properties are all taken", () => {
    render(<PropertyLibrary accounts={[account({ rows: [], listed: 27 })]} trackProperty={ok()} />);

    expect(screen.queryByText(/no search console properties on this account/i)).toBeNull();
    expect(screen.getByText(/every search console property on this account/i)).toBeTruthy();
  });

  /**
   * State three, and the rule that governs it: an absence we did not observe is not an absence.
   * `account-inventory.tsx` already refuses to render a failed listing as an empty one, and
   * these two surfaces must not disagree about the same fact.
   */
  it("renders a failed listing as unreadable, never as an empty list", () => {
    render(<PropertyLibrary accounts={[account({ rows: null })]} trackProperty={ok()} />);

    expect(screen.getByText(/could not be read/i)).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    // …and it must not fall through to either empty-library sentence, which would both assert
    // an absence nothing observed.
    expect(screen.queryByText(/no search console properties on this account/i)).toBeNull();
    expect(screen.queryByText(/every search console property on this account/i)).toBeNull();
  });

  it("renders one row per unused property, under the account it belongs to", () => {
    render(<PropertyLibrary accounts={[account()]} trackProperty={ok()} />);

    expect(screen.getByRole("heading", { name: /suleymanncapar@gmail\.com/ })).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("sc-domain:balerin.com")).toBeTruthy();
    // One button per row and NO dropdown: nine identical 28-option selects (243 options on one
    // page, measured 2026-08-13) are what this surface replaces.
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  /**
   * THE LIVE DEFECT THIS FIXES. Today the reason a property cannot be picked lives up in the
   * account inventory, far from the control, so the operator saw options that "some of them
   * cannot be selected" with no visible cause. The reason now sits in the SAME row as the
   * button it explains — asserted by scoping the query to that row, so moving the sentence back
   * out to a heading or a footer fails this spec.
   */
  it("disables an unqueryable property and puts the reason in that property's own row", () => {
    render(<PropertyLibrary accounts={[account()]} trackProperty={ok()} />);

    const rows = screen.getAllByRole("listitem");
    const usable = within(rows[0] as HTMLElement);
    const blocked = within(rows[1] as HTMLElement);

    expect(usable.getByRole("button", { name: /balerin\.com/i }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(usable.queryByText(/cannot/i)).toBeNull();

    const button = blocked.getByRole("button", { name: /bigcattr\.com/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    // The reason, and the permission level it rests on, both in this row.
    expect(blocked.getByText(/cannot/i)).toBeTruthy();
    expect(blocked.getByText(/siteUnverifiedUser/)).toBeTruthy();
  });

  it("tracks the property of the row that was clicked, then refreshes", async () => {
    const trackProperty = ok();
    render(<PropertyLibrary accounts={[account()]} trackProperty={trackProperty} />);

    fireEvent.click(screen.getByRole("button", { name: /balerin\.com/i }));

    // The ACCOUNT rides with the property: the same property string can be listed on two
    // accounts, and the server has to know which one it is being asked about.
    await waitFor(() =>
      expect(trackProperty).toHaveBeenCalledWith(ACC, "sc-domain:balerin.com"),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the server's refusal verbatim, in the row it belongs to", async () => {
    const sentence =
      "This account cannot query that property (siteRestrictedUser) — ask its owner for full " +
      "access. No project was opened for it.";
    const trackProperty = vi.fn().mockResolvedValue({ ok: false, error: sentence });
    render(<PropertyLibrary accounts={[account()]} trackProperty={trackProperty} />);

    fireEvent.click(screen.getByRole("button", { name: /balerin\.com/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(sentence));
    expect(refresh).not.toHaveBeenCalled();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByRole("alert")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByRole("alert")).toBeNull();
  });

  /**
   * Two accounts, which the design supports and the live data has never had. Rows must stay
   * under the account they were listed on: a property offered under the wrong account would
   * ask the server about a listing that account never returned.
   */
  it("keeps each account's properties under that account", async () => {
    const other = "55555555-5555-4555-8555-555555555555";
    const trackProperty = ok();
    render(
      <PropertyLibrary
        accounts={[
          account({ rows: [ROWS[0] as (typeof ROWS)[number]] }),
          account({
            accountId: other,
            email: "second@gmail.com",
            rows: [{ siteUrl: "sc-domain:zephyrbrook.com", permissionLevel: "siteOwner", queryable: true }],
          }),
        ]}
        trackProperty={trackProperty}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /zephyrbrook\.com/i }));

    await waitFor(() =>
      expect(trackProperty).toHaveBeenCalledWith(other, "sc-domain:zephyrbrook.com"),
    );
  });

  it("survives a thrown action without leaking its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const trackProperty = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    render(<PropertyLibrary accounts={[account()]} trackProperty={trackProperty} />);

    fireEvent.click(screen.getByRole("button", { name: /balerin\.com/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/try again/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/ECONNRESET/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
