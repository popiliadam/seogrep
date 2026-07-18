"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GeneratedKeyResult } from "./actions";

interface KeyPanelProps {
  readonly activeKeyId: string | null;
  readonly createKeyAction: () => Promise<GeneratedKeyResult>;
  readonly rotateKeyAction: (oldKeyId: string) => Promise<GeneratedKeyResult>;
  readonly revokeKeyAction: (keyId: string) => Promise<void>;
}

/**
 * Client island for /app/connection: owns the generate / rotate / revoke buttons and
 * the one-time reveal of a freshly minted key (plaintext + full MCP URL + copy). The
 * plaintext lives only in this component's state for the current view — a refresh or a
 * navigation clears it, honouring the "shown once" contract.
 */
export function KeyPanel({
  activeKeyId,
  createKeyAction,
  rotateKeyAction,
  revokeKeyAction,
}: KeyPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState<GeneratedKeyResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<GeneratedKeyResult | null>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        setRevealed(result);
        setCopied(false);
        router.refresh();
      } catch (caught) {
        console.error("connection action failed:", caught);
        setError("Something went wrong. Please try again.");
      }
    });
  }

  async function copyUrl() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.mcpUrl);
      setCopied(true);
    } catch (caught) {
      console.error("clipboard write failed:", caught);
      setError("Could not copy to clipboard. Please copy the URL manually.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {activeKeyId ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => rotateKeyAction(activeKeyId))}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Rotate key
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(async () => {
                  await revokeKeyAction(activeKeyId);
                  return null;
                })
              }
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-60"
            >
              Revoke key
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(createKeyAction)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Generate key
          </button>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {revealed ? (
        <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Copy your key now — you won&apos;t see this key again.
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">API key</span>
            <code className="rounded border border-neutral-200 bg-white px-3 py-2 text-sm break-all">
              {revealed.key}
            </code>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Personal MCP URL</span>
            <code className="rounded border border-neutral-200 bg-white px-3 py-2 text-sm break-all">
              {revealed.mcpUrl}
            </code>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={copyUrl}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              Copy MCP URL
            </button>
            {copied ? (
              <span role="status" className="text-sm text-green-700">
                Copied
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
