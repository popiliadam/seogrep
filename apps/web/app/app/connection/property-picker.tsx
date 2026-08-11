"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SavePropertyResult } from "./actions";

/** One selectable Search Console property, on one of the user's connected Google accounts. */
export interface PropertyOption {
  readonly accountId: string;
  /** The Google account the property belongs to — the group label in the dropdown. */
  readonly accountEmail: string;
  /** The property string exactly as `sites.list` reports it; replayed verbatim to Google. */
  readonly siteUrl: string;
  readonly permissionLevel: string;
  /** Whether Google will answer `searchAnalytics.query` at that permission level. */
  readonly queryable: boolean;
}

/**
 * What an UNMAPPED row still has stored: the property it read before its account went away
 * (migration 0021, or an account disconnect), plus a ready-to-save choice when some connected
 * account still lists it — null when none does.
 */
export interface RetainedMapping {
  readonly property: string;
  readonly choice: string | null;
  /**
   * Whether EVERY connected account's `sites.list` was actually read for this render. False
   * means at least one failed, so a `choice` of null proves nothing about the property: it may
   * still be listed on the account we could not reach. Without this the note asserted absence
   * from a failed read.
   */
  readonly listingComplete: boolean;
}

interface PropertyPickerProps {
  readonly projectId: string;
  /** The project's domain — names this picker in its label and in the group headings. */
  readonly domain: string;
  readonly options: readonly PropertyOption[];
  /** The LIVE mapping, encoded; empty when the project has none. */
  readonly current: string;
  /** The stored property of an unmapped row — named even when it cannot be selected. */
  readonly retained: RetainedMapping | null;
  /** `resolveGscProperty`'s suggestion, encoded; null when it matched nothing. */
  readonly suggested: string | null;
  /** A stored property that is no longer in the live listing — named, never dropped. */
  readonly missingProperty: string | null;
  /** How many OTHER projects map to the same property. Noted, never blocked. */
  readonly alsoMapped: number;
  readonly saveProjectProperty: (
    projectId: string,
    accountId: string,
    property: string,
  ) => Promise<SavePropertyResult>;
}

/**
 * ONE `<select>` has to carry TWO facts — which Google account, and which property on it —
 * because a user may connect several Google accounts and the same property string can appear
 * under more than one of them. The pair is joined by a SPACE: a uuid contains none, and
 * neither a url-prefix property nor an `sc-domain:` one may contain one either, so the split
 * is unambiguous where `:` (inside every domain property) or `/` (inside every url one) would
 * not be.
 */
export function encodeChoice(accountId: string, siteUrl: string): string {
  return `${accountId} ${siteUrl}`;
}

/** The inverse. Anything that is not a non-empty pair is refused rather than half-read. */
export function decodeChoice(value: string): { accountId: string; property: string } | null {
  const separator = value.indexOf(" ");
  if (separator <= 0) return null;
  const accountId = value.slice(0, separator);
  const property = value.slice(separator + 1);
  return property.length === 0 ? null : { accountId, property };
}

/** The options of one Google account, in the order the account was first seen. */
function groupByAccount(options: readonly PropertyOption[]) {
  const groups: { accountId: string; accountEmail: string; options: PropertyOption[] }[] = [];
  for (const option of options) {
    const group = groups.find((candidate) => candidate.accountId === option.accountId);
    if (group) {
      group.options.push(option);
    } else {
      groups.push({
        accountId: option.accountId,
        accountEmail: option.accountEmail,
        options: [option],
      });
    }
  }
  return groups;
}

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

/**
 * The second half of the retained-property note: what is true about that property RIGHT NOW,
 * for the render the user is actually looking at. Four states, and two of them used to be
 * asserted when they were not known.
 *
 *   - it IS the current selection            — one click (Save) finishes the job;
 *   - it is offered but something else is    — "It is selected below" was computed from the
 *     selected now                             props alone, so it kept claiming the retained
 *                                              value was selected AFTER the user picked a
 *                                              different option in the dropdown;
 *   - no account lists it, every listing     — genuinely absent, and saying so is the point:
 *     was read                                 this is the state every row is in right after
 *                                              migration 0021;
 *   - no account lists it and some listing   — UNKNOWN. A failed `sites.list` is not an empty
 *     could NOT be read                        one, and the page's account-level warning
 *                                              already tells the user a read failed, so this
 *                                              says what it does not know rather than
 *                                              inventing an absence.
 */
function retainedStatus(retained: RetainedMapping, selected: string): string {
  if (retained.choice !== null) {
    return retained.choice === selected
      ? "It is selected below — Save to switch it back on."
      : "Select it again below to switch it back on.";
  }
  return retained.listingComplete
    ? "No connected Google account lists it right now, so nothing reads it yet."
    : "We could not read every connected Google account, so whether it is still listed is unknown.";
}

/**
 * Client island for ONE project row: choose which Search Console property it reads.
 *
 * This is the surface migration 0021 made necessary. The OAuth callback used to match the
 * project's domain against the account's properties and write the answer itself; it now
 * stores a Google ACCOUNT and knows of no project, so somebody has to say which property each
 * project reads. `resolveGscProperty` still computes that match and is rendered here as a
 * SUGGESTION — pre-selected when nothing is stored, never overriding something that is.
 *
 * A property the account cannot query is shown WITH its permission level and disabled. The
 * user can therefore see it exists and why it is unusable, instead of wondering why a
 * property they can see in Search Console is absent from this list (finding #50). The disabled
 * attribute is a courtesy: `saveProjectProperty` re-fetches `sites.list` and re-checks both
 * facts, because nothing arriving from this component is evidence.
 *
 * Every refusal shown here is the SERVER'S OWN sentence, verbatim. That is the whole reason
 * the action returns a message instead of throwing: "could not save" would discard the only
 * explanation the user can act on.
 */
export function PropertyPicker({
  projectId,
  domain,
  options,
  current,
  retained,
  suggested,
  missingProperty,
  alsoMapped,
  saveProjectProperty,
}: PropertyPickerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Until the user touches the control it FOLLOWS the server: the live mapping if there is
  // one, otherwise the property this row still has STORED from before its account went away,
  // otherwise the suggestion. So a refresh caused by another action on this row (a Disconnect,
  // say) is reflected here rather than leaving a stale-looking selection behind.
  //
  // The retained value outranks the suggestion for the reason the live mapping outranks it:
  // `resolveGscProperty` is opinionated (a domain property beats a url-prefix one), so letting
  // it win would re-propose a DIFFERENT property to a user who had already chosen — which is
  // what every row migration 0021 touched did, silently.
  //
  // A choice with no matching option shows NOTHING selected. A `<select>` whose value matches
  // no `<option>` displays the first one instead, so a project whose stored property has
  // vanished — or whose account's listing could not be read at all — would appear to be
  // reading some OTHER property it was never mapped to. Falling back to the placeholder is the
  // honest state: nothing here is selected, and the notice below (or the page's account-level
  // warning) says why.
  const offered = new Set(
    options.map((option) => encodeChoice(option.accountId, option.siteUrl)),
  );
  const preferred = chosen ?? (current || retained?.choice || suggested || "");
  const value = offered.has(preferred) ? preferred : "";
  const selectId = `gsc-property-${projectId}`;

  // Shown in BOTH branches below, including the one with NO options — the state every row is
  // in right after migration 0021, and the one state the stored property is guaranteed to be
  // the only information there is.
  const retainedNote =
    !current && retained ? (
      <span role="status" className="text-xs text-neutral-500">
        {`Saved earlier for this project: ${retained.property}. ${retainedStatus(retained, value)}`}
      </span>
    ) : null;

  function submit() {
    const choice = decodeChoice(value);
    if (!choice) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await saveProjectProperty(projectId, choice.accountId, choice.property);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(true);
        router.refresh();
      } catch (caught) {
        console.error("saving the Search Console property failed:", caught);
        setError("Could not save that property. Please try again.");
      }
    });
  }

  if (options.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-neutral-500">
          No Search Console properties are available for this project yet. Connect a Google
          account that has verified this domain.
        </p>
        {retainedNote}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          Search Console property for {domain}
        </label>
        <select
          id={selectId}
          value={value}
          disabled={isPending}
          onChange={(event) => {
            setChosen(event.target.value);
            setSaved(false);
            setError(null);
          }}
          className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-800"
        >
          <option value="">Select a property…</option>
          {groupByAccount(options).map((group) => (
            <optgroup key={group.accountId} label={group.accountEmail}>
              {group.options.map((option) => (
                <option
                  key={`${option.accountId} ${option.siteUrl}`}
                  value={encodeChoice(option.accountId, option.siteUrl)}
                  disabled={!option.queryable}
                >
                  {option.siteUrl} — {option.permissionLevel}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          disabled={isPending || decodeChoice(value) === null}
          onClick={submit}
          className="font-medium text-neutral-700 hover:text-neutral-900 disabled:opacity-60"
        >
          Save
        </button>
        {!current && !retained && suggested ? (
          <span className="text-xs text-neutral-500">Suggested for this domain — save to apply.</span>
        ) : null}
      </div>

      {retainedNote}
      {missingProperty ? (
        <span role="status" className="text-xs text-amber-700">
          {missingProperty} — This property is no longer visible on this account — pick another.
        </span>
      ) : null}
      {alsoMapped > 0 ? (
        <span className="text-xs text-neutral-500">
          Also mapped to {plural(alsoMapped, "other project")}.
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
      {saved && !error ? (
        <span role="status" className="text-xs text-green-700">
          Saved.
        </span>
      ) : null}
    </div>
  );
}
