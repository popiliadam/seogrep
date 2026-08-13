"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SavePropertyResult } from "./action-support";
import type { ArchivedRow } from "./connection-view";

interface ArchiveListProps {
  readonly rows: readonly ArchivedRow[];
  readonly restoreProject: (projectId: string) => Promise<SavePropertyResult>;
}

/** Shown to the user when the action itself threw — never the thrown message. */
const GENERIC_FAILURE = "Could not restore that site. Please try again.";

/**
 * ARCHIVE — where a removed site goes, and the one control that brings it back.
 *
 * Removing a site ARCHIVES it; nothing is deleted. The project keeps its id, its crawls, its
 * reports AND its Search Console mapping, which is what makes coming back free — so each row
 * names the property it still holds. Deleting instead would cascade `gsc_connections` away and
 * orphan every job, and a re-created project would take a NEW id that none of that history
 * could ever attach to again.
 *
 * THE HEADING SURVIVES AN EMPTY LIST, deliberately. A user who has just removed a site has to
 * be able to see where it went; a section that vanishes when empty cannot tell them, and the
 * archive is empty for every user until the first removal.
 *
 * Refusals are the SERVER'S OWN sentence, verbatim and in the row they belong to — that is why
 * the action returns a message instead of throwing. Only a THROWN failure gets the generic line
 * above: its text can carry anything and this string reaches a browser.
 */
export function ArchiveList({ rows, restoreProject }: ArchiveListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  function restore(projectId: string) {
    // Cleared to the empty string rather than deleted: every reader below tests truthiness, and
    // rebuilding the record without one key buys nothing but a rest-destructure to misread.
    setErrors((current) => ({ ...current, [projectId]: "" }));
    startTransition(async () => {
      try {
        const result = await restoreProject(projectId);
        if (!result.ok) {
          setErrors((current) => ({ ...current, [projectId]: result.error }));
          return;
        }
        // The row disappears on the next server render, which is also where the site reappears
        // under Tracked sites. This component fakes neither move.
        router.refresh();
      } catch (caught) {
        console.error("restoring the project failed:", caught);
        setErrors((current) => ({ ...current, [projectId]: GENERIC_FAILURE }));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-neutral-700">Archive</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">
          Nothing is archived. Removing a site puts it here, with its history and its Search
          Console property kept, so bringing it back costs one click.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li
              key={row.projectId}
              className="flex flex-col gap-1 rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-neutral-800">{row.domain}</span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => restore(row.projectId)}
                  aria-label={`Restore ${row.domain}`}
                  className="font-medium text-neutral-700 hover:text-neutral-900 disabled:opacity-60"
                >
                  Restore
                </button>
              </span>
              {/* Named in THIS row, not in a note above the list: what comes back with the site
                  is the only thing that distinguishes one archived row from another. */}
              {row.property ? (
                <span className="text-xs text-neutral-500">Keeps {row.property}</span>
              ) : null}
              {errors[row.projectId] ? (
                <span role="alert" className="text-xs text-red-600">
                  {errors[row.projectId]}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
