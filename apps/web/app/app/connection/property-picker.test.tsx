import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { decodeChoice, encodeChoice, PropertyPicker, type PropertyOption } from "./property-picker";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_A = "44444444-4444-4444-8444-444444444444";
const ACCOUNT_B = "55555555-5555-4555-8555-555555555555";

const DOMAIN_PROPERTY = "sc-domain:alpha.example";
const URL_PROPERTY = "https://alpha.example/";

function option(overrides: Partial<PropertyOption> = {}): PropertyOption {
  return {
    accountId: ACCOUNT_A,
    accountEmail: "owner@example.com",
    siteUrl: DOMAIN_PROPERTY,
    permissionLevel: "siteOwner",
    queryable: true,
    ...overrides,
  };
}

function props(overrides: Partial<Parameters<typeof PropertyPicker>[0]> = {}) {
  return {
    projectId: PROJECT_ID,
    domain: "alpha.example",
    options: [option()],
    current: "",
    suggested: null,
    missingProperty: null,
    alsoMapped: 0,
    saveProjectProperty: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

const selectFor = (domain = "alpha.example") =>
  screen.getByLabelText(new RegExp(`search console property for ${domain}`, "i")) as HTMLSelectElement;

const save = () => fireEvent.click(screen.getByRole("button", { name: /save/i }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("encodeChoice / decodeChoice", () => {
  /**
   * ONE `<select>` has to carry TWO facts — which Google account, and which property on it —
   * because a user may have several accounts and the same property string can appear under
   * more than one. The pair is joined by a SPACE: a uuid contains none, and neither a URL
   * property nor an `sc-domain:` one may contain one either, so the split is unambiguous
   * where a `:` or a `/` separator would not be.
   */
  it("round-trips an sc-domain property, whose colon would break a naive separator", () => {
    expect(decodeChoice(encodeChoice(ACCOUNT_A, DOMAIN_PROPERTY))).toEqual({
      accountId: ACCOUNT_A,
      property: DOMAIN_PROPERTY,
    });
    expect(decodeChoice(encodeChoice(ACCOUNT_B, URL_PROPERTY))).toEqual({
      accountId: ACCOUNT_B,
      property: URL_PROPERTY,
    });
  });

  it("refuses a value that is not a pair, rather than inventing half of one", () => {
    expect(decodeChoice("")).toBeNull();
    expect(decodeChoice(ACCOUNT_A)).toBeNull();
    expect(decodeChoice(`${ACCOUNT_A} `)).toBeNull();
  });
});

describe("PropertyPicker", () => {
  it("pre-selects resolveGscProperty's SUGGESTION for a project that has no mapping yet", () => {
    const suggested = encodeChoice(ACCOUNT_A, DOMAIN_PROPERTY);
    render(<PropertyPicker {...props({ suggested })} />);

    expect(selectFor().value).toBe(suggested);
    // The suggestion is named as one, so the user knows nothing has been saved on their behalf.
    expect(screen.getByText(/suggested/i)).toBeTruthy();
  });

  /**
   * The suggestion never overrides a stored choice. `resolveGscProperty` is deliberately
   * opinionated (a domain property outranks a url-prefix one), so letting it win here would
   * silently re-propose a different property to a user who had already picked.
   */
  it("shows the STORED mapping, not the suggestion, once the project has one", () => {
    const current = encodeChoice(ACCOUNT_A, URL_PROPERTY);
    render(
      <PropertyPicker
        {...props({
          options: [option(), option({ siteUrl: URL_PROPERTY })],
          current,
          suggested: encodeChoice(ACCOUNT_A, DOMAIN_PROPERTY),
        })}
      />,
    );

    expect(selectFor().value).toBe(current);
  });

  /**
   * A `<select>` whose value matches no `<option>` DISPLAYS THE FIRST ONE. So a project whose
   * stored property vanished from the listing — or whose account could not be read at all —
   * would silently appear to be reading some other property it was never mapped to. The
   * placeholder is the honest state; the notice beside it says why.
   */
  it("shows nothing selected when the stored choice is not among the options", () => {
    render(
      <PropertyPicker
        {...props({
          options: [option({ siteUrl: "https://someone-else.example/" })],
          current: encodeChoice(ACCOUNT_A, URL_PROPERTY),
          missingProperty: URL_PROPERTY,
        })}
      />,
    );

    expect(selectFor().value).toBe("");
    expect((screen.getByRole("button", { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * Finding #50 made structurally impossible at the UI: a property the account cannot QUERY
   * is visible (so the user can see it is there and why it is unusable) but not selectable,
   * and its permission level is spelled out rather than hidden behind "unavailable".
   */
  it("renders a non-queryable property WITH its permission level, and disables it", () => {
    render(
      <PropertyPicker
        {...props({
          options: [
            option({ siteUrl: URL_PROPERTY, permissionLevel: "siteUnverifiedUser", queryable: false }),
            option(),
          ],
        })}
      />,
    );

    const unusable = within(selectFor()).getByRole("option", {
      name: new RegExp(`${URL_PROPERTY}.*siteUnverifiedUser`),
    }) as HTMLOptionElement;
    expect(unusable.disabled).toBe(true);
    const usable = within(selectFor()).getByRole("option", {
      name: new RegExp(`${DOMAIN_PROPERTY.replace(":", ":")}.*siteOwner`),
    }) as HTMLOptionElement;
    expect(usable.disabled).toBe(false);
  });

  it("groups properties by the Google account they belong to", () => {
    render(
      <PropertyPicker
        {...props({
          options: [
            option(),
            option({ accountId: ACCOUNT_B, accountEmail: "second@example.com", siteUrl: URL_PROPERTY }),
          ],
        })}
      />,
    );

    const groups = selectFor().querySelectorAll("optgroup");
    expect([...groups].map((group) => group.label)).toEqual([
      "owner@example.com",
      "second@example.com",
    ]);
  });

  it("saves the chosen (account, property) pair and refreshes so the row re-renders", async () => {
    const p = props({
      options: [option(), option({ accountId: ACCOUNT_B, accountEmail: "second@example.com", siteUrl: URL_PROPERTY })],
    });
    render(<PropertyPicker {...p} />);

    fireEvent.change(selectFor(), { target: { value: encodeChoice(ACCOUNT_B, URL_PROPERTY) } });
    save();

    await waitFor(() =>
      expect(p.saveProjectProperty).toHaveBeenCalledWith(PROJECT_ID, ACCOUNT_B, URL_PROPERTY),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /**
   * The server's refusal sentence is shown VERBATIM. It is the only place the user learns
   * that a property vanished from the account or that their permission level cannot query it
   * — replacing it with a house "Could not save" would throw away the whole point of the
   * action returning a message instead of throwing.
   */
  it("shows the server's own refusal and does NOT refresh", async () => {
    const p = props({
      suggested: encodeChoice(ACCOUNT_A, DOMAIN_PROPERTY),
      saveProjectProperty: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "That property is not listed on this Google account." }),
    });
    render(<PropertyPicker {...p} />);

    save();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That property is not listed on this Google account.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces a thrown action as an error, and does not refresh", async () => {
    // The island logs the throw for the operator; capture it rather than print it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const p = props({
      suggested: encodeChoice(ACCOUNT_A, DOMAIN_PROPERTY),
      saveProjectProperty: vi.fn().mockRejectedValue(new Error("boom")),
    });
    render(<PropertyPicker {...p} />);

    save();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * A stored property that is no longer in the LIVE listing (deleted in Search Console,
   * access withdrawn, or the account was disconnected) is named, not silently dropped. The
   * loss is itself information: without this the user sees an unexplained empty dropdown and
   * a project that quietly stopped reading data.
   */
  it("marks a stored property the live listing no longer contains", () => {
    render(<PropertyPicker {...props({ missingProperty: URL_PROPERTY })} />);

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(URL_PROPERTY);
    expect(notice.textContent).toContain(
      "This property is no longer visible on this account — pick another.",
    );
  });

  /**
   * A domain property can legitimately cover two projects, so sharing one is NOTED and never
   * blocked — the Save button stays live.
   */
  it("notes when the same property is mapped to other projects, without blocking the save", () => {
    render(<PropertyPicker {...props({ current: encodeChoice(ACCOUNT_A, DOMAIN_PROPERTY), alsoMapped: 2 })} />);

    expect(screen.getByText(/also mapped to 2 other projects/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /save/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says one project in the singular", () => {
    render(<PropertyPicker {...props({ current: encodeChoice(ACCOUNT_A, DOMAIN_PROPERTY), alsoMapped: 1 })} />);

    expect(screen.getByText(/also mapped to 1 other project(?!s)/i)).toBeTruthy();
  });

  // Never a silently empty dropdown: with nothing to choose from there is no <select> at all,
  // and the reason is on screen instead.
  it("explains an empty listing instead of rendering an empty dropdown", () => {
    render(<PropertyPicker {...props({ options: [] })} />);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/no search console properties/i)).toBeTruthy();
  });

  it("cannot save nothing: the button is inert until a property is chosen", () => {
    const p = props();
    render(<PropertyPicker {...p} />);

    expect(selectFor().value).toBe("");
    expect((screen.getByRole("button", { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
    save();
    expect(p.saveProjectProperty).not.toHaveBeenCalled();
  });
});
