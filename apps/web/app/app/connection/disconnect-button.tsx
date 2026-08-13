"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SavePropertyResult } from "./action-support";
import type { GscRevocationOutcome } from "./actions";

interface DisconnectButtonProps {
  readonly projectId: string;
  /** The project's domain — names the connection in the button's accessible label. */
  readonly domain: string;
  /** Whether the DB still holds a link. The BUTTON depends on it; the island does not. */
  readonly connected: boolean;
  readonly unmapProject: (projectId: string) => Promise<SavePropertyResult>;
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
 * A REFUSAL IS THE SERVER'S OWN SENTENCE, verbatim, exactly as in `PropertyPicker`. The generic
 * notice below is for a THROW only — a crash nobody has words for. The distinction is not
 * cosmetic: `unmapProject` refuses an archived project, so the one way in (a stale tab, rendered
 * while the project was still tracked) used to be answered with "Please try again", which cannot
 * work, instead of the sentence naming the way back.
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
        const result = await unmapProject(projectId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
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

/** One Google account the user has connected — everything this panel may show about it. */
export interface ConnectedAccount {
  readonly id: string;
  readonly email: string;
}

interface AccountDisconnectPanelProps {
  readonly accounts: readonly ConnectedAccount[];
  readonly describeDisconnect: (accountId: string) => Promise<string>;
  readonly disconnectAccount: (accountId: string) => Promise<GscRevocationOutcome>;
}

/** Where a user finishes a revoke SeoGrep could not confirm. Google's own permissions list. */
const GOOGLE_PERMISSIONS_URL = "https://myaccount.google.com/permissions";

/**
 * The CREDENTIAL level: drop SeoGrep's access to one Google account.
 *
 * Two things force this to be a panel over the whole list rather than a button per row.
 *
 * THE RADIUS. Since migration 0021 one grant is shared by every project mapped to that
 * account, so disconnecting reaches projects the user is not looking at. `describeDisconnect`
 * counts them and this asks for confirmation with that sentence — a radius the user cannot
 * see is a radius they cannot consent to (finding #63). It is called ONLY with an id taken
 * from the server-rendered account list, which is tenant-filtered; the function itself does
 * no ownership check, so a foreign id would come back as a plausible "0 projects" instead of
 * a refusal.
 *
 * THE OUTCOME (M-15). `disconnectAccount` always deletes our copy but can only report
 * `revoked` when Google acknowledged; `unconfirmed` and `not_attempted` both mean the grant
 * may still be live at Google, and the user has to finish the job there. That warning must
 * outlive the disconnect: the action revalidates this page, so the row the user clicked is
 * gone from the very next render — a per-account island would unmount and take the warning
 * with it. Mounted around the list, this survives, exactly as the per-project island stays
 * mounted for unlinked projects so its failure notice survives.
 */
export function AccountDisconnectPanel({
  accounts,
  describeDisconnect,
  disconnectAccount,
}: AccountDisconnectPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<{ accountId: string; question: string } | null>(null);
  const [outcome, setOutcome] = useState<GscRevocationOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  function ask(accountId: string) {
    setError(null);
    setOutcome(null);
    startTransition(async () => {
      try {
        setPending({ accountId, question: await describeDisconnect(accountId) });
      } catch (caught) {
        console.error("describing the disconnect failed:", caught);
        setError("Could not disconnect. Please try again.");
      }
    });
  }

  function commit(accountId: string) {
    setPending(null);
    startTransition(async () => {
      try {
        setOutcome(await disconnectAccount(accountId));
        router.refresh();
      } catch (caught) {
        console.error("account disconnect failed:", caught);
        setError("Could not disconnect. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {accounts.length === 0 ? (
        <p className="text-sm text-neutral-600">No Google account is connected yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-center justify-between gap-4 rounded-md border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="text-neutral-800">{account.email}</span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => ask(account.id)}
                aria-label={`Disconnect ${account.email} from SeoGrep`}
                className="font-medium text-neutral-700 hover:text-neutral-900 disabled:opacity-60"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p>{pending.question}</p>
          <span className="flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={() => commit(pending.accountId)}
              className="font-medium underline disabled:opacity-60"
            >
              Confirm disconnect
            </button>
            <button type="button" onClick={() => setPending(null)} className="font-medium">
              Cancel
            </button>
          </span>
        </div>
      ) : null}

      {error ? (
        <span role="alert" className="text-sm text-red-600">
          {error}
        </span>
      ) : null}

      {outcome === "revoked" ? (
        <span role="status" className="text-sm text-green-700">
          Disconnected. Google confirmed the access was revoked.
        </span>
      ) : null}
      {outcome === "unconfirmed" || outcome === "not_attempted" ? (
        <span role="alert" className="text-sm text-amber-700">
          Disconnected here, but we could not confirm with Google that the access was dropped.
          Check{" "}
          <a href={GOOGLE_PERMISSIONS_URL} target="_blank" rel="noreferrer" className="underline">
            your Google account permissions
          </a>{" "}
          and remove SeoGrep there if it is still listed.
        </span>
      ) : null}
    </div>
  );
}
