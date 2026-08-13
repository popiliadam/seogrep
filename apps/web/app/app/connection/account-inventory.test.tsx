import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AccountInventory } from "./account-inventory";

/**
 * MOVED OUT OF `page.test.tsx`, NOT WEAKENED. These four specs used to run through the whole
 * connection page, because that is where this component was rendered. It no longer is: Task 10
 * replaced the per-account inventory with the three groups — `TrackedProjects` says what each
 * project reads and `PropertyLibrary` says what is still free, so a third list of the same
 * properties would be the duplicated surface that redesign exists to remove.
 *
 * The component itself was NOT deleted (that needs a human's word, and this task had none), so
 * its four measured behaviours are kept here, driven directly. The real component renders —
 * nothing at all is mocked in this file.
 *
 * If `account-inventory.tsx` is removed, this file goes with it.
 */

const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";

const PROJECT_A = { domain: "alpha.example", accountId: ACCOUNT_ID, property: "https://alpha.example/" };
const PROJECT_B = { domain: "beta.example", accountId: null, property: null };

function site(siteUrl: string, permissionLevel = "siteOwner") {
  return { siteUrl, permissionLevel };
}

afterEach(cleanup);

describe("the property inventory", () => {
  it("lists what the account can read, with permission and what uses it", () => {
    render(
      <AccountInventory
        sites={[site("https://alpha.example/"), site("https://spare.example/", "siteUnverifiedUser")]}
        projects={[PROJECT_A, PROJECT_B]}
        accountId={ACCOUNT_ID}
      />,
    );

    const inventory = screen.getByTestId("account-inventory");
    expect(within(inventory).getByText("https://alpha.example/")).toBeTruthy();
    expect(within(inventory).getByText("siteUnverifiedUser")).toBeTruthy();
    // NOT /alpha\.example/ — that regex also matches the siteUrl cell above, and `getByText`
    // throws on more than one hit. Assert the sentence that only the usage cell can produce.
    expect(within(inventory).getByText("Read by alpha.example")).toBeTruthy();
    expect(within(inventory).getByText(/Not used — this account cannot query it/)).toBeTruthy();
  });

  /**
   * The fourth inventory state the spec requires (line 99) and the only one nothing asserted:
   * queryable AND unused. It is a DIFFERENT sentence from the unqueryable one — bare, with no
   * reason clause — because there is nothing to explain: the account can read the property,
   * we simply do not. Merging the two branches, or appending a reason to this one, would tell
   * the user a working property is broken.
   *
   * MUTATION TARGET: collapse `account-inventory.tsx`'s ternary to the "cannot query it"
   * string and this goes red twice over — the exact-string match below, and the negative one.
   */
  it("marks a queryable property nothing reads as plain Not used, with no reason attached", () => {
    // Both siteOwner, so both are queryable; only the first one is read by a project.
    render(
      <AccountInventory
        sites={[site("https://alpha.example/"), site("https://spare.example/")]}
        projects={[PROJECT_A]}
        accountId={ACCOUNT_ID}
      />,
    );

    const inventory = screen.getByTestId("account-inventory");
    // An EXACT string, not /Not used/: the "cannot query it" variant contains those two words,
    // so a regex would pass on the wrong branch — which is the whole distinction being pinned.
    expect(within(inventory).getByText("Not used")).toBeTruthy();
    expect(within(inventory).queryByText(/cannot query it/)).toBeNull();
    expect(within(inventory).getByText("Read by alpha.example")).toBeTruthy();
  });

  /**
   * The empty inventory — a listing we DID read that answered with nothing. The wording was
   * approved by hand during Task 2 (the fact alone, remedy deliberately left to the page-level
   * summary so three connected accounts do not repeat the same instruction four times).
   *
   * It also pins the honesty split the 2026-08-11 defect came from: read-and-empty is NOT
   * could-not-read, and the two must never share a sentence.
   */
  it("says an account that lists nothing has nothing — the fact only, not the remedy", () => {
    render(<AccountInventory sites={[]} projects={[PROJECT_A]} accountId={ACCOUNT_ID} />);

    const inventory = screen.getByTestId("account-inventory");
    expect(
      within(inventory).getByText("No Search Console properties on this account."),
    ).toBeTruthy();
    // NOT the unreadable wording: an empty answer we received is not an answer we missed.
    expect(within(inventory).queryByText(/could not be read/i)).toBeNull();
    // And NOT the remedy, which belongs to the cross-account summary the page owns. That the
    // page still says it once is asserted where the page is rendered, in page.test.tsx.
    expect(within(inventory).queryByText(/verify a property in search console/i)).toBeNull();
  });

  it("says the listing could NOT be read rather than claiming the account has nothing", () => {
    render(<AccountInventory sites={null} projects={[PROJECT_A]} accountId={ACCOUNT_ID} />);

    const inventory = screen.getByTestId("account-inventory");
    expect(within(inventory).getByText(/could not be read/i)).toBeTruthy();
    expect(within(inventory).queryByText(/Not used/)).toBeNull();
  });
});
