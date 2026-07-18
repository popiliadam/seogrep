import { mcpUrlFor, mcpUrlTemplate } from "@pseo/core";
import { listKeys } from "@pseo/db/api-keys-repo";
import { createClient } from "../../../lib/supabase/server";
import { createKeyAction, revokeKeyAction, rotateKeyAction } from "./actions";
import { KeyPanel } from "./key-panel";

/**
 * /app/connection — personal API keys + personal MCP URL. The /app layout already
 * guards the session; this RSC reads the caller's OWN keys through their authenticated
 * client (RLS owner-SELECT) and renders the static list. All mutations and the
 * one-time key reveal live in the KeyPanel client island + the server actions. The
 * page only ever shows the MASKED MCP URL (prefix); the full URL is revealed once,
 * client-side, at creation time.
 */
export default async function ConnectionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const keys = user ? await listKeys(supabase, user.id) : [];
  const activeKey = keys.find((key) => key.revokedAt === null) ?? null;
  const maskedMcpUrl = activeKey
    ? mcpUrlFor(`${activeKey.keyPrefix}…`, mcpUrlTemplate())
    : null;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Connection</h1>
        <p className="text-sm text-neutral-600">
          Your personal API key authenticates the SeoGrep MCP server. Generate a key,
          copy it once, and point your MCP client at the personal URL below.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Personal MCP URL</h2>
        {maskedMcpUrl ? (
          <code className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm break-all">
            {maskedMcpUrl}
          </code>
        ) : (
          <p className="text-sm text-neutral-600">Generate a key to reveal your personal MCP URL.</p>
        )}
      </div>

      <KeyPanel
        activeKeyId={activeKey?.id ?? null}
        createKeyAction={createKeyAction}
        rotateKeyAction={rotateKeyAction}
        revokeKeyAction={revokeKeyAction}
      />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Keys</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-neutral-600">No keys yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex items-center justify-between gap-4 rounded-md border border-neutral-200 px-3 py-2 text-sm"
              >
                <code className={key.revokedAt ? "text-neutral-400" : "text-neutral-800"}>
                  {key.keyPrefix}…
                </code>
                <span className="flex items-center gap-3 text-neutral-500">
                  <time dateTime={key.createdAt}>{formatDate(key.createdAt)}</time>
                  {key.revokedAt ? (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                      Revoked
                    </span>
                  ) : (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
                      Active
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Render an ISO timestamp as YYYY-MM-DD; fall back to the raw value if unparseable. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}
