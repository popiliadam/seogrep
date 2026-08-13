"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { SavePropertyResult } from "./action-support";
import type { TrackedRow } from "./connection-view";

/** One tracked project as this group renders it: the grouper's row, plus the page's extras. */
export interface TrackedProjectRow extends TrackedRow {
  /**
   * A property some connected account lists that matches this domain, ready to apply in one
   * click. The account rides with it: the same property string can be listed on two accounts.
   */
  readonly suggestion: { readonly accountId: string; readonly property: string } | null;
  /**
   * The "Change" surface for this row — the existing `PropertyPicker`, rendered by the page and
   * handed in as a slot. It stays a slot on purpose: this component decides only WHEN the
   * escape hatch is shown, and knows nothing about what choosing a property involves.
   */
  readonly picker: ReactNode;
}

interface TrackedProjectsProps {
  readonly rows: readonly TrackedProjectRow[];
  readonly trackProperty: (accountId: string, property: string) => Promise<SavePropertyResult>;
  readonly untrackProject: (projectId: string) => Promise<SavePropertyResult>;
}

/** Shown when an action threw — never the thrown message, which can carry anything. */
const GENERIC_FAILURE = "Could not update that site. Please try again.";

/**
 * What this row is doing right now, in one sentence.
 *
 * The order is a ranking, not a formatting choice. A LIVE mapping outranks everything, because
 * it is the only one of the three that is actually happening. A STORED property outranks a
 * suggestion, because `resolveGscProperty` is opinionated (a domain property beats a url-prefix
 * one) and letting it speak over a value the user already chose is exactly what every row
 * migration 0021 touched suffered, silently. Only a project that has neither says so.
 */
function statusOf(row: TrackedProjectRow): string {
  if (row.property !== null) {
    return `Reads ${row.property}`;
  }
  if (row.retained !== null) {
    return `Saved earlier: ${row.retained} — nothing reads it yet.`;
  }
  if (row.suggestion !== null) {
    return `Suggested: ${row.suggestion.property}`;
  }
  return "No Search Console property. Crawls and audits do not need one.";
}

/**
 * TRACKED SITES — one row per project, whatever state it is in.
 *
 * THE SPINE IS THE PROJECT. Measured on the operator's live account (2026-08-13): `example.net`
 * has no property and no suggestion, and a list keyed on properties would have dropped it from
 * the page although crawl and audit run for it. So this group is never filtered by whether a
 * property exists — a project with none gets a row that says so.
 *
 * THREE ACTIONS, and each exists for a state the live data is actually in. CONFIRM applies a
 * suggestion in one click, for the eight projects that have one and read nothing. CHANGE opens
 * the existing `PropertyPicker`, which this redesign does NOT delete: `adstark.com.tr` reads
 * `https://rkturizm.com/`, so a name-mismatched mapping has to stay reachable by hand. REMOVE
 * archives — it never deletes, so the project comes back on its own id with its history and its
 * mapping intact.
 *
 * Refusals are the SERVER'S OWN sentence, verbatim, in the row they came from.
 */
export function TrackedProjects({ rows, trackProperty, untrackProject }: TrackedProjectsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [opened, setOpened] = useState<Readonly<Record<string, boolean>>>({});

  function run(projectId: string, action: () => Promise<SavePropertyResult>) {
    // Cleared to the empty string rather than deleted: every reader below tests truthiness.
    setErrors((current) => ({ ...current, [projectId]: "" }));
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setErrors((current) => ({ ...current, [projectId]: result.error }));
          return;
        }
        // Where the row goes next — into the archive, or from suggested to reading — is the
        // server's answer, not this component's guess.
        router.refresh();
      } catch (caught) {
        console.error("updating the tracked project failed:", caught);
        setErrors((current) => ({ ...current, [projectId]: GENERIC_FAILURE }));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-neutral-700">Tracked sites</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No sites are tracked yet. Add one from Search Console below, or create a project from
          your MCP client with the setup_project tool.
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
                <span className="flex items-center gap-3">
                  {/* Offered only when nothing is stored: see statusOf for why a suggestion may
                      never speak over a property the user already chose. */}
                  {row.property === null && row.retained === null && row.suggestion !== null ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        const suggestion = row.suggestion;
                        if (suggestion === null) return;
                        run(row.projectId, () =>
                          trackProperty(suggestion.accountId, suggestion.property),
                        );
                      }}
                      aria-label={`Confirm ${row.suggestion.property} for ${row.domain}`}
                      className="font-medium text-neutral-700 hover:text-neutral-900 disabled:opacity-60"
                    >
                      Confirm
                    </button>
                  ) : null}
                  {row.picker ? (
                    <button
                      type="button"
                      onClick={() =>
                        setOpened((current) => ({
                          ...current,
                          [row.projectId]: !current[row.projectId],
                        }))
                      }
                      aria-expanded={opened[row.projectId] === true}
                      aria-label={`Change the Search Console property for ${row.domain}`}
                      className="font-medium text-neutral-700 hover:text-neutral-900"
                    >
                      Change
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(row.projectId, () => untrackProject(row.projectId))}
                    aria-label={`Remove ${row.domain} from tracked sites`}
                    className="font-medium text-neutral-700 hover:text-neutral-900 disabled:opacity-60"
                  >
                    Remove
                  </button>
                </span>
              </span>
              <span className="text-xs text-neutral-500">{statusOf(row)}</span>
              {opened[row.projectId] === true ? row.picker : null}
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
