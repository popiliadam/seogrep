"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface DisconnectButtonProps {
  readonly projectId: string;
  /** The project's domain — names the connection in the button's accessible label. */
  readonly domain: string;
  /** Whether the DB still holds a link. The BUTTON depends on it; the island does not. */
  readonly connected: boolean;
  readonly unmapProject: (projectId: string) => Promise<void>;
}

/**
 * Client island for ONE project row: unlink this project from Search Console. The RSC around
 * it derives "connected" from the database, so the row flips back to "Not connected" +
 * Connect on the refresh this triggers — the island holds no link state of its own, it just
 * stops rendering the button.
 *
 * IT MAKES NO CLAIM ABOUT GOOGLE, because the action behind it makes no request to Google
 * (finding #63). The grant belongs to the Google ACCOUNT and is shared by every project
 * mapped to it; unlinking one project leaves it — and every sibling project — alone. The
 * M-15 warning this component used to carry ("we could not confirm access was revoked")
 * moved with the thing it described: `disconnectAccount`'s `GscRevocationOutcome`, which
 * Task 6 mounts in the account section. Repeating it here would be worse than silence — it
 * would tell the user their Google access might be gone when nothing ever asked for it.
 *
 * The failure message is deliberately generic (as in KeyPanel): the server action's own
 * wording distinguishes a missing link from another user's, and neither belongs in the UI.
 */
export function DisconnectButton({
  projectId,
  domain,
  connected,
  unmapProject,
}: DisconnectButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function disconnect() {
    setError(null);
    startTransition(async () => {
      try {
        await unmapProject(projectId);
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
    </span>
  );
}
