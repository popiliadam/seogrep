"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface RevokeLinkButtonProps {
  readonly reportId: string;
  /** The report's name — identifies the link in the button's accessible label. */
  readonly title: string;
  readonly revokeReportLinkAction: (reportId: string) => Promise<void>;
}

/**
 * Client island for ONE report row: revoke its public link. The RSC around it derives the link's
 * existence from the database, so the row loses its View link and this button on the refresh
 * this triggers — the island holds no state of its own beyond a failure message.
 *
 * The failure message is deliberately generic (as in DisconnectButton): the server action's own
 * wording does not distinguish a missing report from another user's, and neither belongs here.
 */
export function RevokeLinkButton({ reportId, title, revokeReportLinkAction }: RevokeLinkButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function revoke() {
    setError(null);
    startTransition(async () => {
      try {
        await revokeReportLinkAction(reportId);
        router.refresh();
      } catch (caught) {
        console.error("revoking the report link failed:", caught);
        setError("Could not revoke. Please try again.");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={revoke}
        aria-label={`Revoke the public link for ${title}`}
        className="border-b border-confirm-border font-mono text-[11px] text-negative transition-colors duration-150 hover:border-negative disabled:opacity-60"
      >
        Revoke
      </button>
      {error ? (
        <span role="alert" className="font-mono text-[11px] text-negative">
          {error}
        </span>
      ) : null}
    </span>
  );
}
