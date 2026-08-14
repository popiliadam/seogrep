"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GeneratedKeyResult } from "./actions";

interface KeyPanelProps {
  readonly activeKeyId: string | null;
  /**
   * The fixed, key-free MCP endpoint for header auth, derived server-side from the same template
   * as the personal URL. `null` when it could not be derived — render nothing rather than guess.
   */
  readonly headerEndpoint: string | null;
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
  headerEndpoint,
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
              className="bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
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
              className="border border-hairline-mid px-4 py-2 text-sm font-medium text-body disabled:opacity-60"
            >
              Revoke key
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(createKeyAction)}
            className="bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
          >
            Generate key
          </button>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}

      {revealed ? (
        <div className="flex flex-col gap-3 border border-accent-badge-border bg-accent-badge-bg p-4">
          <p className="text-sm font-medium text-amber-900">
            Copy your key now — you won&apos;t see this key again.
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">API key</span>
            <code className="border border-hairline bg-card px-3 py-2 text-sm break-all">
              {revealed.key}
            </code>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Personal MCP URL</span>
            <code className="border border-hairline bg-card px-3 py-2 text-sm break-all">
              {revealed.mcpUrl}
            </code>
          </div>
          {/* Additive alternative (L-15): the server accepts BOTH the URL-with-key form above and
              header auth, but this — the one moment the plaintext key is on screen — only ever
              showed the URL, so a user whose client sends headers had to go read the docs to find
              out the option existed. The URL form stays first and stays the default. */}
          {headerEndpoint ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Or use header auth</span>
              <p className="text-xs text-muted">
                If your client can send custom headers, point it at this fixed URL and pass the key
                in an <code>x-api-key</code> header instead — then no secret sits in the URL.
              </p>
              <code className="border border-hairline bg-card px-3 py-2 text-sm break-all">
                {headerEndpoint}
              </code>
              <code className="border border-hairline bg-card px-3 py-2 text-sm break-all">
                {`x-api-key: ${revealed.key}`}
              </code>
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={copyUrl}
              className="bg-ink px-4 py-2 text-sm font-medium text-paper"
            >
              Copy MCP URL
            </button>
            {copied ? (
              <span role="status" className="text-sm text-positive">
                Copied
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
