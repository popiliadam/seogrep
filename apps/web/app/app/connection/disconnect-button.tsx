"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GscRevocationOutcome } from "./actions";

/** Where a user finishes a revoke we could not confirm — Google's third-party access list. */
const GOOGLE_PERMISSIONS_URL = "https://myaccount.google.com/permissions";

interface DisconnectButtonProps {
  readonly projectId: string;
  /** The project's domain — names the connection in the button's accessible label. */
  readonly domain: string;
  /** Whether the DB still holds a connection. The BUTTON depends on it; the island does not. */
  readonly connected: boolean;
  readonly disconnectGscAction: (projectId: string) => Promise<GscRevocationOutcome>;
}

/**
 * Client island for ONE project row: the Disconnect action and whatever the disconnect left
 * unresolved. The RSC around it derives "connected" from the database, so the row flips back
 * to "Not connected" + Connect on the refresh this triggers — the island holds no connection
 * state of its own, it just stops rendering the button.
 *
 * It stays MOUNTED for an unconnected project on purpose (M-15): the warning below has to
 * outlive the very refresh that removes the button, and a component the page unmounts takes
 * its state with it — the user would have been told nothing at all.
 *
 * The failure message is deliberately generic (as in KeyPanel): the server action's own
 * wording distinguishes a missing connection from another user's, and neither belongs in
 * the UI.
 */
export function DisconnectButton({
  projectId,
  domain,
  connected,
  disconnectGscAction,
}: DisconnectButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  function disconnect() {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await disconnectGscAction(projectId);
        // Only a CONFIRMED revoke buys silence. Everything else — including an answer this
        // build does not recognise — is unknown, and unknown is never sold as done.
        setUnconfirmed(outcome !== "revoked");
        router.refresh();
      } catch (caught) {
        console.error("disconnect failed:", caught);
        setError("Could not disconnect. Please try again.");
      }
    });
  }

  return (
    <span className="flex items-center gap-2">
      {connected ? (
        <button
          type="button"
          disabled={isPending}
          onClick={disconnect}
          aria-label={`Disconnect ${domain} from Search Console`}
          className="font-medium text-neutral-700 hover:text-neutral-900 disabled:opacity-60"
        >
          Disconnect
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
      {unconfirmed ? (
        <span role="status" className="text-xs text-amber-700">
          Local connection removed. We could not confirm that access was revoked at Google —{" "}
          <a
            href={GOOGLE_PERMISSIONS_URL}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            remove it in your Google Account
          </a>
          .
        </span>
      ) : null}
    </span>
  );
}
