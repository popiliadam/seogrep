import { inventoryRows } from "./connection-view";

/**
 * What ONE connected Google account can read — the inventory the page never showed.
 *
 * This list and the per-project pickers below it answer two DIFFERENT questions, so they are
 * two lists on purpose: this one is Google's truth ("what do you have access to"), the pickers
 * are ours ("what does each project read"). Merging them would hide the state where they
 * disagree — which is exactly the state a user lands in after a disconnect.
 *
 * A failed `sites.list` renders as "could not be read", never as an empty inventory: an
 * absence we did not observe is not an absence.
 */
export function AccountInventory({
  sites,
  projects,
  accountId,
}: {
  readonly sites: readonly { siteUrl: string; permissionLevel: string }[] | null;
  readonly projects: readonly { domain: string; accountId: string | null; property: string | null }[];
  readonly accountId: string;
}) {
  if (sites === null) {
    // NO `role="alert"`, deliberately. The page already raises exactly one alert for this state
    // ("We could not read the Search Console properties on at least one of these accounts"), and
    // it is the sentence with the repair in it. One alert per unreadable account would announce
    // the same fact N+1 times to a screen reader — and three existing specs read the page's
    // single alert by role, which is the guarantee that there is only one. This paragraph is the
    // per-account DETAIL under that alert, so it is visible amber text and nothing more.
    return (
      <p data-testid="account-inventory" className="text-xs text-amber-700">
        This account&apos;s Search Console properties could not be read just now, so what it can
        reach is unknown. Try again shortly, or reconnect the account.
      </p>
    );
  }

  const rows = inventoryRows(sites, projects, accountId);
  if (rows.length === 0) {
    return (
      // The FACT only, no remedy. The page-level sentence right below this one already says
      // what to do about it ("Verify a property in Search Console, or connect a different
      // Google account"), and the plan's original wording repeated that remedy verbatim — with
      // three such accounts the user read the same instruction four times in a row. The split
      // follows the scopes: this line is account-specific truth, the summary below is the
      // cross-account one, and the remedy belongs to the summary.
      <p data-testid="account-inventory" className="text-xs text-neutral-500">
        No Search Console properties on this account.
      </p>
    );
  }

  return (
    <ul data-testid="account-inventory" className="flex flex-col gap-1">
      {rows.map((row) => (
        <li
          key={row.siteUrl}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 px-2 py-1 text-xs"
        >
          <span className="text-neutral-800">{row.siteUrl}</span>
          <span className="text-neutral-500">{row.permissionLevel}</span>
          <span className="text-neutral-600">
            {row.usedBy.length > 0
              ? `Read by ${row.usedBy.join(", ")}`
              : row.queryable
                ? "Not used"
                : "Not used — this account cannot query it"}
          </span>
        </li>
      ))}
    </ul>
  );
}
