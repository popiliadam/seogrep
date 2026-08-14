"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SavePropertyResult } from "./action-support";
import { useConnectionQuery } from "./connection-filter";
import { matchesQuery, type LibraryRow } from "./connection-view";

/** One connected Google account, and what is still free to take on it. */
export interface LibraryAccount {
  readonly accountId: string;
  readonly email: string;
  /**
   * The properties on this account that nothing reads yet — or NULL when `sites.list` could not
   * be read at all. Null is not an empty list, and the two must never render the same.
   */
  readonly rows: readonly LibraryRow[] | null;
  /**
   * How many properties the account lists in total. It is what tells "this account has none"
   * apart from "every one of them is already tracked" — two states that produce the same empty
   * `rows` and owe the user opposite sentences.
   */
  readonly listed: number;
}

interface PropertyLibraryProps {
  readonly accounts: readonly LibraryAccount[];
  readonly trackProperty: (accountId: string, property: string) => Promise<SavePropertyResult>;
}

/** Shown when the action itself threw — never the thrown message, which can carry anything. */
const GENERIC_FAILURE = "Could not start tracking that property. Please try again.";

/** One row's key. The property alone is not unique: two accounts can list the same string. */
function rowKey(accountId: string, siteUrl: string): string {
  return `${accountId} ${siteUrl}`;
}

/** What a closed fold says about itself. A fold with no count is a fold nobody opens. */
function foldLabel(count: number): string {
  return count === 1 ? "Show 1 available property" : `Show ${count} available properties`;
}

/**
 * ADD FROM SEARCH CONSOLE — every property that is not being read yet, one row, one button.
 *
 * This replaces nine identical dropdowns. Measured on the operator's account (2026-08-13): 1
 * Google account, 27 properties, 26 of them unused, and a 28-option `<select>` repeated once
 * per project — 243 `<option>` elements on a 2697px page, all to express one fact each. A flat
 * list with a button per row says the same thing once.
 *
 * THE REASON A PROPERTY CANNOT BE TAKEN SITS IN ITS OWN ROW. That is the second defect being
 * fixed here, and it is a defect of PLACEMENT rather than of information: the permission level
 * was already rendered, up in the account inventory, far from the disabled control it explained
 * — so the operator saw options that could not be selected with no visible cause. The disabled
 * attribute remains a courtesy either way: `trackProperty` re-reads `sites.list` and re-checks
 * the permission level, because nothing arriving from this component is evidence.
 *
 * AN UNREADABLE ACCOUNT RENDERS AS UNREADABLE, never as an account with nothing on it — an
 * absence we did not observe is not an absence. The MCP tool `list_gsc_properties` renders the
 * same listing under the same rule, and the two surfaces may not disagree about it.
 */
export function PropertyLibrary({ accounts, trackProperty }: PropertyLibraryProps) {
  const router = useRouter();
  const query = useConnectionQuery();
  const searching = query.trim() !== "";
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  function track(accountId: string, siteUrl: string) {
    const key = rowKey(accountId, siteUrl);
    // Cleared to the empty string rather than deleted: every reader below tests truthiness.
    setErrors((current) => ({ ...current, [key]: "" }));
    startTransition(async () => {
      try {
        const result = await trackProperty(accountId, siteUrl);
        if (!result.ok) {
          setErrors((current) => ({ ...current, [key]: result.error }));
          return;
        }
        // The row leaves this list on the next server render and appears under Tracked sites.
        // Nothing here fakes that move.
        router.refresh();
      } catch (caught) {
        console.error("tracking the property failed:", caught);
        setErrors((current) => ({ ...current, [key]: GENERIC_FAILURE }));
      }
    });
  }

  /**
   * One account's rows. A function rather than a component so the row markup is written once
   * for both the folded list and the filtered one — the two differ only in what wraps them.
   */
  function rowList(account: LibraryAccount, rows: readonly LibraryRow[]) {
    return (
      <ul className="flex flex-col gap-1 pt-1">
        {rows.map((row) => (
          <li
            key={rowKey(account.accountId, row.siteUrl)}
            className="flex flex-col gap-1 border border-hairline px-2 py-1 text-xs"
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ink">{row.siteUrl}</span>
              <button
                type="button"
                disabled={isPending || !row.queryable}
                onClick={() => track(account.accountId, row.siteUrl)}
                aria-label={`Track ${row.siteUrl}`}
                className="font-medium text-body hover:text-ink disabled:opacity-60"
              >
                Track
              </button>
            </span>
            {!row.queryable ? (
              <span className="text-warn">
                {`Google will not answer search data at this account's access level (${row.permissionLevel}), so SeoGrep cannot track it. Ask the property's owner for full access.`}
              </span>
            ) : null}
            {errors[rowKey(account.accountId, row.siteUrl)] ? (
              <span role="alert" className="text-negative">
                {errors[rowKey(account.accountId, row.siteUrl)]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-body">Add from Search Console</h3>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">
          Connect a Google account to add its Search Console properties here.
        </p>
      ) : null}
      {accounts.map((account) => {
        // Empty query keeps every row, so this is the whole list on the default page.
        const shown = (account.rows ?? []).filter((row) => matchesQuery(query, row.siteUrl));
        return (
          <div key={account.accountId} className="flex flex-col gap-1">
            <h4 className="text-xs font-medium text-body">{account.email}</h4>
            {account.rows === null ? (
              // NO `role="alert"`: the page raises exactly one alert for this state and that is
              // the sentence with the repair in it. Repeating it per account would announce the
              // same fact N+1 times to a screen reader. This is the per-account detail under it.
              //
              // IT OUTLIVES THE SEARCH BOX TOO. We cannot know whether the query would have
              // matched something on an account we could not read, so "nothing matches" would
              // claim we looked. The honest sentence is this one, whatever is typed.
              <p className="text-xs text-warn">
                This account&apos;s Search Console properties could not be read just now, so what
                it can reach is unknown. Try again shortly, or reconnect the account.
              </p>
            ) : account.rows.length === 0 ? (
              <p className="text-xs text-faint">
                {account.listed === 0
                  ? "No Search Console properties on this account."
                  : "Every Search Console property on this account is already tracked."}
              </p>
            ) : shown.length === 0 ? (
              // Only reachable while filtering — the account HAS rows. Said out loud rather than
              // rendered as an empty list, which would read as "this account has none".
              <p className="text-xs text-faint">Nothing on this account matches that search.</p>
            ) : searching ? (
              // A hit may not stay behind a fold: the box exists to reach past it.
              rowList(account, shown)
            ) : (
              // THE ROWS, AND ONLY THE ROWS, ARE BEHIND THE FOLD. Both sentences above it are
              // absences a user must not have to click to discover, and the amber one is a
              // FAILURE — folding it away would turn "we could not ask" into a quiet account,
              // the inference this whole surface refuses.
              //
              // `<details>` rather than a button and a piece of state: the disclosure it gives
              // is keyboard-operable and screen-reader-announced for free, works with no JS at
              // all, and holds its own open/closed — nothing here can get out of step with it.
              <details className="flex flex-col gap-1">
                <summary className="cursor-pointer text-xs text-muted marker:text-faintest">
                  {foldLabel(shown.length)}
                </summary>
                {rowList(account, shown)}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
