import { mcpUrlFor, mcpUrlTemplate } from "@pseo/core";
import { listKeys } from "@pseo/db/api-keys-repo";
import { formatDate } from "../../../lib/format";
import { mcpHeaderEndpoint } from "../../../lib/mcp-endpoint";
import { createClient } from "../../../lib/supabase/server";
import {
  createKeyAction,
  disconnectGscAction,
  revokeKeyAction,
  rotateKeyAction,
} from "./actions";
import { DisconnectButton } from "./disconnect-button";
import { KeyPanel } from "./key-panel";

/** One project row with the only GSC fact this page shows: is it linked or not. */
interface ProjectConnection {
  readonly id: string;
  readonly domain: string;
  readonly connected: boolean;
}

/**
 * The caller's projects, each flagged with whether it already has a gsc_connections row.
 * BOTH reads go through the caller's authenticated client (RLS `*_select_own`) AND carry an
 * explicit user_id filter as defence in depth — no tenant table is ever queried unfiltered
 * (constitution NEVER #4). Two small reads joined in memory: `gsc_connections` is unique per
 * (user, project), so the project_id set is all the state the row needs. Read failures throw
 * rather than degrade into a misleading "not connected" (the listReports precedent).
 */
async function listProjectConnections(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ProjectConnection[]> {
  const [projects, connections] = await Promise.all([
    supabase
      .from("projects")
      .select("id, domain")
      .eq("user_id", userId)
      .order("domain", { ascending: true }),
    supabase.from("gsc_connections").select("project_id").eq("user_id", userId),
  ]);
  if (projects.error) {
    throw new Error(`projects lookup failed: ${projects.error.message}`);
  }
  if (connections.error) {
    throw new Error(`gsc_connections lookup failed: ${connections.error.message}`);
  }

  const rows = (projects.data ?? []) as unknown as { id: string; domain: string }[];
  const connectedIds = new Set(
    ((connections.data ?? []) as unknown as { project_id: string }[]).map((row) => row.project_id),
  );
  return rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    connected: connectedIds.has(row.id),
  }));
}

/**
 * /app/connection — personal API keys + personal MCP URL + the Search Console link state of
 * each project. The /app layout already guards the session; this RSC reads the caller's OWN
 * keys, projects and GSC connections through their authenticated client (RLS owner-SELECT)
 * and renders the static lists. All mutations and the one-time key reveal live in the
 * KeyPanel client island + the server actions. The page only ever shows the MASKED MCP URL
 * (prefix); the full URL is revealed once, client-side, at creation time.
 */
export default async function ConnectionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const keys = user ? await listKeys(supabase, user.id) : [];
  const projects = user ? await listProjectConnections(supabase, user.id) : [];
  const activeKey = keys.find((key) => key.revokedAt === null) ?? null;
  // ONE read of the template feeds both forms the server accepts, so they can never point at
  // different hosts: the personal URL below, and the key-free endpoint header auth uses (L-15).
  const urlTemplate = mcpUrlTemplate();
  const maskedMcpUrl = activeKey ? mcpUrlFor(`${activeKey.keyPrefix}…`, urlTemplate) : null;
  const headerEndpoint = mcpHeaderEndpoint(urlTemplate);

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
        headerEndpoint={headerEndpoint}
        createKeyAction={createKeyAction}
        rotateKeyAction={rotateKeyAction}
        revokeKeyAction={revokeKeyAction}
      />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Google Search Console</h2>
        <p className="text-sm text-neutral-600">
          Link a project to Search Console so its tools can read your real query and click
          data. Connecting sends you to Google and back. Disconnecting deletes the stored
          token and asks Google to revoke SeoGrep&apos;s access; if Google does not confirm
          the revocation, you will be told how to remove it yourself.
        </p>
        {projects.length === 0 ? (
          <p className="text-sm text-neutral-600">
            No projects yet. Create one from your MCP client with the setup_project tool.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex items-center justify-between gap-4 rounded-md border border-neutral-200 px-3 py-2 text-sm"
              >
                <span className="text-neutral-800">{project.domain}</span>
                <span className="flex items-center gap-3 text-neutral-500">
                  {project.connected ? (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
                      Connected
                    </span>
                  ) : (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                      Not connected
                    </span>
                  )}
                  {/* A plain <a>: this is the existing route handler that mints a signed state
                      and 302s to Google. next/link would prefetch it and start the flow. */}
                  <a
                    href={`/api/gsc/connect?project_id=${project.id}`}
                    className="font-medium text-neutral-700 hover:text-neutral-900"
                  >
                    {project.connected ? "Reconnect" : "Connect"}
                  </a>
                  {/* The island renders the Disconnect button only for a linked project, but
                      is mounted either way: it must survive the refresh that unlinks the row
                      to keep showing a revoke Google never confirmed (M-15). */}
                  <DisconnectButton
                    projectId={project.id}
                    domain={project.domain}
                    connected={project.connected}
                    disconnectGscAction={disconnectGscAction}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
