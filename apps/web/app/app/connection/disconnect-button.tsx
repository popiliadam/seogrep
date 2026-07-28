"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface DisconnectButtonProps {
  readonly projectId: string;
  /** The project's domain — names the connection in the button's accessible label. */
  readonly domain: string;
  readonly disconnectGscAction: (projectId: string) => Promise<void>;
}

/**
 * Client island for ONE connected project row: the Disconnect action. The RSC around it
 * derives "connected" from the database, so the row flips back to "Not connected" + Connect
 * on the refresh this triggers — the button holds no connection state of its own.
 *
 * The failure message is deliberately generic (as in KeyPanel): the server action's own
 * wording distinguishes a missing connection from another user's, and neither belongs in
 * the UI.
 */
export function DisconnectButton({
  projectId,
  domain,
  disconnectGscAction,
}: DisconnectButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function disconnect() {
    setError(null);
    startTransition(async () => {
      try {
        await disconnectGscAction(projectId);
        router.refresh();
      } catch (caught) {
        console.error("disconnect failed:", caught);
        setError("Could not disconnect. Please try again.");
      }
    });
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={disconnect}
        aria-label={`Disconnect ${domain} from Search Console`}
        className="font-medium text-neutral-700 hover:text-neutral-900 disabled:opacity-60"
      >
        Disconnect
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}
