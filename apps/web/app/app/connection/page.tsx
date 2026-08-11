import { listSites, mcpUrlFor, mcpUrlTemplate, type GscSite } from "@pseo/core";
import { listKeys } from "@pseo/db/api-keys-repo";
import { createServiceClient } from "@pseo/db/server";
import { formatDate } from "../../../lib/format";
import { accessTokenFor } from "../../../lib/gsc/accounts";
import { canQuerySearchAnalytics, resolveGscProperty } from "../../../lib/gsc/oauth";
import { mcpHeaderEndpoint } from "../../../lib/mcp-endpoint";
import { createClient } from "../../../lib/supabase/server";
import {
  createKeyAction,
  describeDisconnect,
  disconnectAccount,
  revokeKeyAction,
  rotateKeyAction,
  saveProjectProperty,
  unmapProject,
} from "./actions";
import { AccountDisconnectPanel, DisconnectButton } from "./disconnect-button";
import { KeyPanel } from "./key-panel";
import {
  encodeChoice,
  PropertyPicker,
  type PropertyOption,
  type RetainedMapping,
} from "./property-picker";

/** One project row: its identity plus the mapping `gsc_connections` holds for it. */
interface ProjectConnection {
  readonly id: string;
  readonly domain: string;
  /** The Google account this project reads through, or null when it is unmapped. */
  readonly accountId: string | null;
  /** The property string stored for it — survives an account disconnect (0021). */
  readonly property: string | null;
}

/** One connected Google account, with the property list read LIVE for this render. */
interface ConnectedAccount {
  readonly id: string;
  readonly email: string;
  /** `sites.list` as of now, or null when it could not be read at all. */
  readonly sites: readonly GscSite[] | null;
}

/** A repeated query param (?error=a&error=b) arrives as an array; only the first counts. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * What the OAuth callback can send the user back here with. Every message is a LITERAL: the
 * raw param is never echoed (the success one carries an account id), and an unknown value
 * renders nothing, so a crafted `?error=` can produce no output. A Map, not a record, so an
 * inherited key like "constructor" cannot resolve — the same posture as GscBanner.
 *
 * These four had NO reader until now: the callback has been redirecting here since the
 * account-based OAuth landed, and all four arrived silently.
 */
const CALLBACK_ERRORS: ReadonlyMap<string, string> = new Map([
  [
    "identity",
    "Google did not say which account consented, so nothing was stored. Please connect again.",
  ],
  [
    "no_token",
    "Google did not return a reusable token, so nothing was stored. This usually clears up if " +
      "you connect again.",
  ],
  [
    "verify",
    "That Google account was reached, but its Search Console properties could not be read — so " +
      "nothing was stored. Check the account has access in Search Console, then connect again.",
  ],
]);

const CONNECTED_MESSAGE =
  "Google account connected. Choose the Search Console property each project should read.";

/**
 * Consent belongs to a GOOGLE ACCOUNT, not to a project, so the link carries NO `project_id`.
 *
 * It used to. Migration 0021 moved the credential to `gsc_accounts`, Task 5 dropped the
 * project from the OAuth state, and the connect route now ignores the parameter outright — so
 * the old `?project_id=<id>` promised a project-scoped consent that cannot happen, and its
 * placement (one link per project row) offered a fresh Google round trip at exactly the moment
 * the user needed the property picker instead.
 */
const GSC_CONNECT_PATH = "/api/gsc/connect";

/**
 * The caller's projects and the mapping each one currently has. BOTH reads go through the
 * caller's authenticated client (RLS `*_select_own`) AND carry an explicit user_id filter as
 * defence in depth — no tenant table is ever queried unfiltered (constitution NEVER #4).
 * Read failures throw rather than degrade into a misleading "not connected" (the listReports
 * precedent).
 *
 * "Connected" is `account_id !== null`, NOT the existence of the row. Since migration 0021
 * the credential lives on `gsc_accounts` and `gsc_connections` is the MAPPING: `unmapProject`
 * clears `account_id` and keeps the row, and disconnecting an account nulls the same column
 * via `on delete set null` while every `gsc_property` survives. Reading row existence would
 * have shown both of those states as "Connected" — a Disconnect that visibly does nothing.
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
    supabase
      .from("gsc_connections")
      .select("project_id, account_id, gsc_property")
      .eq("user_id", userId),
  ]);
  if (projects.error) {
    throw new Error(`projects lookup failed: ${projects.error.message}`);
  }
  if (connections.error) {
    throw new Error(`gsc_connections lookup failed: ${connections.error.message}`);
  }

  const rows = (projects.data ?? []) as unknown as { id: string; domain: string }[];
  const mappings = new Map(
    (
      (connections.data ?? []) as unknown as {
        project_id: string;
        account_id: string | null;
        gsc_property: string | null;
      }[]
    ).map((row) => [row.project_id, row]),
  );
  return rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    accountId: mappings.get(row.id)?.account_id ?? null,
    property: mappings.get(row.id)?.gsc_property ?? null,
  }));
}

/**
 * The caller's Google accounts, each with its property list read LIVE.
 *
 * NOTHING IS CACHED, deliberately. A cache of `sites.list` would grow its own staleness
 * problem — a property removed in Search Console would stay selectable — and a dead token
 * SHOULD make this call fail: that failure is the single most useful thing this page can
 * show. It is also why a failure never throws: a credential that stopped working must render
 * as "reconnect this account", not as a 500 that hides the rest of the page (the API keys
 * live here too).
 *
 * The row list comes from the caller's own RLS-scoped client — `authenticated` holds a
 * column-level SELECT grant on `gsc_accounts` that EXCLUDES the ciphertext (migration 0021),
 * so the credential is unreachable from here. Only `accessTokenFor` needs the service client,
 * and its read is filtered on (id, user_id) — the tenant guard, since service-role bypasses
 * RLS (NEVER #4).
 */
async function listConnectedAccounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ConnectedAccount[]> {
  const { data, error } = await supabase
    .from("gsc_accounts")
    .select("id, google_account_email")
    .eq("user_id", userId);
  if (error) {
    throw new Error(`gsc_accounts lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { id: string; google_account_email: string }[];
  if (rows.length === 0) {
    return [];
  }

  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    // A broken deploy, not a per-account fault — say so once, loudly, in the log (lesson #5).
    // Every account then renders its unreadable state, which is the truth for all of them.
    console.error("/app/connection: TOKEN_ENCRYPTION_KEY is not configured");
  }
  const service = createServiceClient();
  return Promise.all(
    rows.map(async (row) => {
      const account = { id: row.id, email: row.google_account_email };
      if (!encryptionKey) {
        return { ...account, sites: null };
      }
      try {
        const accessToken = await accessTokenFor(service, row.id, userId, encryptionKey);
        return { ...account, sites: await listSites(accessToken) };
      } catch (caught) {
        // Never the ciphertext or a token — only which account, and what went wrong.
        console.error(`/app/connection: sites.list failed for account ${row.id}:`, caught);
        return { ...account, sites: null };
      }
    }),
  );
}

/** Every selectable property across every account, grouped later by the picker itself. */
function propertyOptions(accounts: readonly ConnectedAccount[]): PropertyOption[] {
  return accounts.flatMap((account) =>
    (account.sites ?? []).map((site) => ({
      accountId: account.id,
      accountEmail: account.email,
      siteUrl: site.siteUrl,
      permissionLevel: site.permissionLevel,
      queryable: canQuerySearchAnalytics(site.permissionLevel),
    })),
  );
}

/**
 * `resolveGscProperty`'s answer for one project, as an encoded picker choice — or null.
 *
 * This is the whole change of role: the same function that USED to decide the mapping inside
 * the OAuth callback now proposes one. Its logic is untouched, including the refusal that
 * keeps `blog.example.com` off the apex property, so the suggestion can never propose a bind
 * the old code would have refused. The accounts are walked in order and the first usable
 * match wins.
 */
function suggestionFor(domain: string, accounts: readonly ConnectedAccount[]): string | null {
  for (const account of accounts) {
    const match = resolveGscProperty(domain, account.sites ?? []);
    if (match.kind === "matched") {
      return encodeChoice(account.id, match.property);
    }
  }
  return null;
}

/**
 * The property an UNMAPPED row still stores, and where it can be picked up again.
 *
 * `account_id IS NULL` + `gsc_property` set is the design's own state (spec line 68): "the
 * mapping stands, connect to activate it" — what migration 0021 leaves EVERY migrated row in,
 * and what an account disconnect produces. No surface rendered it: `current` is computed only
 * when `accountId !== null`, so the row showed "Not connected" beside a freshly recomputed
 * SUGGESTION and the user's own earlier choice appeared nowhere.
 *
 * TWO facts, because two states differ: a connected account that still lists the property gives
 * the picker a ready-to-save choice; when none lists it (the state right after the migration,
 * before any account is connected) there is nothing to select — and the stored value is still
 * the honest thing to show, so it is named either way. Listing is not verification: the save
 * path re-fetches `sites.list` and re-checks the permission level, because nothing rendered
 * here is evidence (saveProjectProperty's own ruling).
 *
 * A THIRD fact, because "no account lists it" and "we could not ask every account" are not the
 * same sentence. `sites: null` is a FAILED read, and folding it into `?? []` made an unread
 * account look like an account that answered "nothing" — so the picker told the user no
 * connected account lists their property when the truth was that we could not find out.
 * `listingComplete` carries that distinction across, and it is the same principle
 * {@link missingPropertyFor} already applies to a MAPPED row: if the live fetch failed we know
 * nothing about the property's fate, and saying it is absent would be an invention.
 */
function retainedMappingFor(
  project: ProjectConnection,
  accounts: readonly ConnectedAccount[],
): RetainedMapping | null {
  if (project.accountId !== null || project.property === null) {
    return null;
  }
  const property = project.property;
  const host = accounts.find((account) =>
    (account.sites ?? []).some((site) => site.siteUrl === property),
  );
  return {
    property,
    choice: host ? encodeChoice(host.id, property) : null,
    // Every account answered. With no accounts at all this is vacuously true, which is right:
    // the post-migration state really does list the property nowhere.
    listingComplete: accounts.every((account) => account.sites !== null),
  };
}

/**
 * A stored property that its own account no longer lists — the property was deleted, or the
 * account's access to it was withdrawn. Reported, never swallowed: the alternative is a
 * dropdown that silently forgets the project's selection, and the loss is itself information.
 *
 * Only claimed when the account's listing was actually READ. If the live fetch failed we know
 * nothing about the property's fate, and saying it vanished would be an invention.
 */
function missingPropertyFor(
  project: ProjectConnection,
  accounts: readonly ConnectedAccount[],
): string | null {
  if (project.property === null || project.accountId === null) {
    return null;
  }
  const account = accounts.find((candidate) => candidate.id === project.accountId);
  if (!account || account.sites === null) {
    return null;
  }
  return account.sites.some((site) => site.siteUrl === project.property) ? null : project.property;
}

/**
 * Whether this project's row should offer a re-consent: it IS mapped, and the account it is
 * mapped to could not be read. That is the only state a trip to Google actually fixes.
 *
 * An UNMAPPED project is deliberately excluded, and that is the point of the control moving.
 * A user who has already connected an account and merely has not chosen a property for this
 * project needs the picker below the row — sending them back through a Google consent round
 * would re-grant something they already granted and still leave the property unchosen.
 */
function needsReconsent(
  project: ProjectConnection,
  accounts: readonly ConnectedAccount[],
): boolean {
  if (project.accountId === null) {
    return false;
  }
  const account = accounts.find((candidate) => candidate.id === project.accountId);
  return account !== undefined && account.sites === null;
}

/**
 * How many OTHER projects read the same property. Allowed on purpose — one domain property
 * can legitimately cover two projects — so this is a note the picker shows, never a block.
 * Only live mappings count: a row whose account was disconnected keeps its `gsc_property`
 * but reads nothing.
 */
function alsoMappedCount(
  project: ProjectConnection,
  projects: readonly ProjectConnection[],
): number {
  if (project.property === null || project.accountId === null) {
    return 0;
  }
  return projects.filter(
    (other) =>
      other.id !== project.id &&
      other.accountId !== null &&
      other.property === project.property,
  ).length;
}

/**
 * /app/connection — personal API keys + personal MCP URL + the Search Console surface: which
 * Google accounts are connected, and which property each project reads through them.
 *
 * The /app layout already guards the session; this RSC reads the caller's OWN keys, projects,
 * mappings and accounts through their authenticated client (RLS owner-SELECT). All mutations
 * live in the server actions, and the two client islands (picker, account disconnect) hold no
 * state the database does not already own. The page only ever shows the MASKED MCP URL; the
 * full URL is revealed once, client-side, at creation time.
 */
export default async function ConnectionPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackError = CALLBACK_ERRORS.get(firstValue(params.error) ?? "");
  const connected = firstValue(params.connected) !== undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const keys = user ? await listKeys(supabase, user.id) : [];
  const [projects, accounts] = user
    ? await Promise.all([
        listProjectConnections(supabase, user.id),
        listConnectedAccounts(supabase, user.id),
      ])
    : [[] as ProjectConnection[], [] as ConnectedAccount[]];
  const options = propertyOptions(accounts);
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
        {callbackError ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-600">
            {callbackError}
          </p>
        ) : null}
        {connected && !callbackError ? (
          <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-700">
            {CONNECTED_MESSAGE}
          </p>
        ) : null}
        {/* This paragraph is the only place the user learns what Disconnect does, so it says
            what the action actually does and nothing more. It used to promise a revoke at
            Google; since the credential moved to the Google ACCOUNT (migration 0021) the
            per-project button no longer performs one, and leaving the old wording would have
            told the user their Search Console access was revoked while the grant was live.
            The last sentence used to end at "a separate step on the Google account itself"
            because that step had no control here — it does now, so it names it. */}
        <p className="text-sm text-neutral-600">
          Link a project to Search Console so its tools can read your real query and click
          data. Connecting sends you to Google and back. Disconnecting removes the link
          between this project and Search Console. It does not revoke SeoGrep&apos;s access to
          your Google account, so your other projects keep working; to drop that access
          altogether, use Disconnect next to the Google account under Connected Google
          accounts below.
        </p>

        <h3 className="text-sm font-medium text-neutral-700">Connected Google accounts</h3>
        <AccountDisconnectPanel
          accounts={accounts.map((account) => ({ id: account.id, email: account.email }))}
          describeDisconnect={describeDisconnect}
          disconnectAccount={disconnectAccount}
        />
        {/* A plain <a>, like the old per-project link: this is the route handler that mints a
            signed state and 302s to Google, and next/link would prefetch it and start the flow.
            Rendered unconditionally — with no accounts it is the ONLY way to connect one, and
            with several it is how the next one is added. */}
        <a
          href={GSC_CONNECT_PATH}
          className="self-start font-medium text-neutral-700 hover:text-neutral-900"
        >
          Connect Google account
        </a>
        {accounts.some((account) => account.sites === null) ? (
          <p role="alert" className="text-sm text-amber-700">
            We could not read the Search Console properties on at least one of these accounts.
            Use Connect Google account to grant access again, or try again shortly.
          </p>
        ) : null}

        {projects.length === 0 ? (
          <p className="text-sm text-neutral-600">
            No projects yet. Create one from your MCP client with the setup_project tool.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex flex-col gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm"
              >
                <span className="flex items-center justify-between gap-4">
                  <span className="text-neutral-800">{project.domain}</span>
                  <span className="flex items-center gap-3 text-neutral-500">
                    {project.accountId !== null ? (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
                        Connected
                      </span>
                    ) : (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                        Not connected
                      </span>
                    )}
                    {/* The ONLY per-row trip to Google, and only for the one state a trip
                        fixes: a mapped project whose account credential no longer works. An
                        unmapped project is served by the picker below the row, not by a fresh
                        consent — and the consent it would start is account-wide anyway, so it
                        carries no project_id. */}
                    {needsReconsent(project, accounts) ? (
                      <a
                        href={GSC_CONNECT_PATH}
                        className="font-medium text-neutral-700 hover:text-neutral-900"
                      >
                        Reconnect
                      </a>
                    ) : null}
                    {/* The island renders the Disconnect button only for a linked project, but
                        is mounted either way. Per-project Disconnect UNLINKS only — the shared
                        Google grant is dropped from the account level (finding #63). */}
                    <DisconnectButton
                      projectId={project.id}
                      domain={project.domain}
                      connected={project.accountId !== null}
                      unmapProject={unmapProject}
                    />
                  </span>
                </span>
                <PropertyPicker
                  projectId={project.id}
                  domain={project.domain}
                  options={options}
                  current={
                    project.accountId !== null && project.property !== null
                      ? encodeChoice(project.accountId, project.property)
                      : ""
                  }
                  retained={retainedMappingFor(project, accounts)}
                  suggested={suggestionFor(project.domain, accounts)}
                  missingProperty={missingPropertyFor(project, accounts)}
                  alsoMapped={alsoMappedCount(project, projects)}
                  saveProjectProperty={saveProjectProperty}
                />
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
