import { listSites, mcpUrlFor, mcpUrlTemplate, type GscSite } from "@pseo/core";
import { listKeys } from "@pseo/db/api-keys-repo";
import { createServiceClient } from "@pseo/db/server";
import type { ReactNode } from "react";
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
import { restoreProject, trackProperty, untrackProject } from "./tracking-actions";
import { ArchiveList } from "./archive-list";
// A COMPONENT, not a value: `ConnectionFilter` is rendered, never called, so a Server Component
// may import it from a `"use client"` module. `useConnectionQuery` beside it may NOT come here.
import { ConnectionFilter } from "./connection-filter";
import { groupConnectionRows, type ProjectRow } from "./connection-view";
import { AccountDisconnectPanel, DisconnectButton } from "./disconnect-button";
import { KeyPanel } from "./key-panel";
import { PropertyLibrary, type LibraryAccount } from "./property-library";
import { TrackedProjects, type TrackedProjectRow } from "./tracked-projects";
// `encodeChoice` comes from ./choice, NOT from ./property-picker: this file is a Server
// Component and the picker is `"use client"`, so importing a VALUE from it makes the call a
// client reference and the render throws. Types are erased. See ./choice for the outage.
import { encodeChoice } from "./choice";
import {
  PropertyPicker,
  type PropertyOption,
  type RetainedMapping,
} from "./property-picker";

/** One connected Google account, with the property list read LIVE for this render. */
interface ConnectedAccount {
  readonly id: string;
  readonly email: string;
  /** `sites.list` as of now, or null when it could not be read at all. */
  readonly sites: readonly GscSite[] | null;
}

/** The account and property one suggestion names — the account rides with it deliberately. */
interface Suggestion {
  readonly accountId: string;
  readonly property: string;
}

/** A repeated query param (?error=a&error=b) arrives as an array; only the first counts. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * What the OAuth callback can send the user back here with. Every message is a LITERAL: the
 * raw param is never echoed (the success one carries an account id), and an unknown value
 * renders nothing. A Map, not a record, so "constructor" cannot resolve — as in GscBanner.
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
 * It used to: migration 0021 moved the credential to `gsc_accounts`, Task 5 dropped the project
 * from the OAuth state, and the route now ignores the parameter — so the old `?project_id=<id>`
 * promised a project-scoped consent that cannot happen.
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
 * via `on delete set null` while every `gsc_property` survives.
 *
 * `archived_at` IS SELECTED AND IS DELIBERATELY NOT FILTERED. This page is the one surface that
 * must RENDER archived projects — the archive is how a removed site is found again — so the
 * `.is("archived_at", null)` every MCP list path carries would empty that group. "List paths
 * hide archived rows" is met one layer up instead: `groupConnectionRows` splits on this column,
 * so an archived project reaches the archive and nothing else. Until it was read at all, an
 * archived project would simply have appeared under Tracked sites.
 */
async function listProjectConnections(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ProjectRow[]> {
  const [projects, connections] = await Promise.all([
    supabase
      .from("projects")
      .select("id, domain, archived_at")
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

  const rows = (projects.data ?? []) as unknown as {
    id: string;
    domain: string;
    archived_at: string | null;
  }[];
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
    // The one place snake_case becomes camelCase for this column (the grouper's own name).
    archivedAt: row.archived_at ?? null,
  }));
}

/**
 * The caller's Google accounts, each with its property list read LIVE.
 *
 * NOTHING IS CACHED, deliberately. A cache of `sites.list` would grow its own staleness problem
 * — a property removed in Search Console would stay selectable — and a dead token SHOULD make
 * this call fail: that failure is the most useful thing this page can show. It is also why a
 * failure never throws: a credential that stopped working must render as "reconnect this
 * account", not as a 500 that takes the API keys down with it.
 *
 * The row list comes from the caller's own RLS-scoped client — `authenticated` holds a
 * column-level SELECT grant on `gsc_accounts` that EXCLUDES the ciphertext (migration 0021).
 * Only `accessTokenFor` needs the service client, and its read is filtered on (id, user_id) —
 * the tenant guard, since service-role bypasses RLS (NEVER #4).
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
 * `resolveGscProperty`'s answer for one project — or null. The function that USED to decide the
 * mapping inside the OAuth callback now proposes one; its logic is untouched, including the
 * refusal that keeps `blog.example.com` off the apex, so it can never propose a bind the old
 * code would have refused. First usable match wins, and the ACCOUNT rides with the property:
 * the same string can be listed on two different Google accounts.
 */
function suggestionFor(domain: string, accounts: readonly ConnectedAccount[]): Suggestion | null {
  for (const account of accounts) {
    const match = resolveGscProperty(domain, account.sites ?? []);
    if (match.kind === "matched") {
      return { accountId: account.id, property: match.property };
    }
  }
  return null;
}

/**
 * The property an UNMAPPED row still stores, and where it can be picked up again.
 *
 * `account_id IS NULL` + `gsc_property` set is the design's own state (spec line 68): "the
 * mapping stands, connect to activate it" — what migration 0021 leaves EVERY migrated row in,
 * and what an account disconnect produces.
 *
 * THREE facts, because three states differ: an account still listing the property gives the
 * picker a ready-to-save choice; nobody listing it (the post-migration state) leaves nothing to
 * select, and the stored value is still the honest thing to name; and a FAILED `sites.list` is
 * neither — folding it into `?? []` made an unread account look like one that answered
 * "nothing", so `listingComplete` carries the distinction {@link missingPropertyFor} already
 * makes. Listing is not verification either way: the save path re-reads and re-checks.
 */
function retainedMappingFor(
  project: ProjectRow,
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
    // Vacuously true with no accounts, which is right: nothing lists it after the migration.
    listingComplete: accounts.every((account) => account.sites !== null),
  };
}

/**
 * A stored property that its own account no longer lists — deleted, or access withdrawn.
 * Reported, never swallowed: the alternative is a dropdown that silently forgets the project's
 * selection, and the loss is itself information. Only claimed when the listing was actually
 * READ: if the live fetch failed, saying it vanished would be an invention.
 */
function missingPropertyFor(
  project: ProjectRow,
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
 * How many OTHER projects read the same property. Allowed on purpose — one domain property
 * can legitimately cover two projects — so this is a note the picker shows, never a block.
 *
 * Only LIVE mappings count, and only TRACKED projects: a row whose account was disconnected
 * keeps its `gsc_property` and reads nothing, and an archived project appears nowhere but the
 * archive — naming it would answer "who else is affected?" with someone the user cannot see.
 */
function alsoMappedCount(project: ProjectRow, projects: readonly ProjectRow[]): number {
  if (project.property === null || project.accountId === null) {
    return 0;
  }
  return projects.filter(
    (other) =>
      other.id !== project.id &&
      other.archivedAt === null &&
      other.accountId !== null &&
      other.property === project.property,
  ).length;
}

/**
 * The "Change" surface one tracked row opens: the existing `PropertyPicker`, plus the control
 * that unlinks the project without archiving it.
 *
 * THE PICKER IS NOT DELETED BY THIS REDESIGN and this is why. The library below maps a property
 * onto the project its name implies; `adstark.com.tr` reads `https://rkturizm.com/` on the
 * operator's live account, and no name-based path can ever produce that. So the picker stays —
 * behind a disclosure, which is what took nine dropdowns off the page: they are no longer
 * rendered up front.
 *
 * Disconnect rides here because it answers the same question ("what does this project read?")
 * with "nothing". It is NOT Remove: Remove archives the whole project, this only clears the
 * mapping. Null when there is neither a property to pick nor a mapping to drop, because
 * `TrackedProjects` hides its Change button exactly then.
 */
function changeSurfaceFor(
  project: ProjectRow,
  projects: readonly ProjectRow[],
  accounts: readonly ConnectedAccount[],
  options: readonly PropertyOption[],
  suggestion: Suggestion | null,
): ReactNode {
  if (options.length === 0 && project.accountId === null) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
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
        suggested={
          suggestion === null ? null : encodeChoice(suggestion.accountId, suggestion.property)
        }
        missingProperty={missingPropertyFor(project, accounts)}
        alsoMapped={alsoMappedCount(project, projects)}
        saveProjectProperty={saveProjectProperty}
      />
      <DisconnectButton
        projectId={project.id}
        domain={project.domain}
        connected={project.accountId !== null}
        unmapProject={unmapProject}
      />
    </div>
  );
}

/**
 * The tracked group, with the two things the grouper cannot know: each domain's suggestion and
 * the node its Change button opens. Driven by `tracked`, never by `projects`, so the grouper's
 * archive split is the ONLY thing deciding what appears here.
 */
function trackedRowsFor(
  tracked: ReturnType<typeof groupConnectionRows>["tracked"],
  projects: readonly ProjectRow[],
  accounts: readonly ConnectedAccount[],
  options: readonly PropertyOption[],
): TrackedProjectRow[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return tracked.flatMap((row) => {
    const project = byId.get(row.projectId);
    if (project === undefined) return [];
    const suggestion = suggestionFor(project.domain, accounts);
    return [
      {
        ...row,
        suggestion,
        picker: changeSurfaceFor(project, projects, accounts, options, suggestion),
      },
    ];
  });
}

/**
 * What each account still has FREE. `groupConnectionRows` is scoped to ONE account (the same
 * property string can sit on two, and a project reads it through exactly one), so the library —
 * and only the library — is computed once per account.
 *
 * A failed `sites.list` stays NULL all the way down: `?? []` here would turn "we could not ask"
 * into "the account has nothing", the one inference this page refuses everywhere else.
 */
function libraryAccountsFor(
  accounts: readonly ConnectedAccount[],
  projects: readonly ProjectRow[],
): LibraryAccount[] {
  return accounts.map((account) => ({
    accountId: account.id,
    email: account.email,
    rows:
      account.sites === null
        ? null
        : groupConnectionRows({ projects, sites: account.sites, accountId: account.id }).library,
    listed: account.sites?.length ?? 0,
  }));
}

/**
 * /app/connection — personal API keys + personal MCP URL + the Search Console surface: which
 * Google accounts are connected, which site each project reads, what is still free to take,
 * and what has been put away.
 *
 * THREE GROUPS, NOT NINE DROPDOWNS. Measured on the operator's live page (2026-08-13): one
 * Google account, 27 properties, 26 unused, and a 28-option `<select>` repeated once per
 * project — 243 `<option>` elements over 2697px, each expressing one fact. Tracked sites says
 * what every project reads, the library what is still free, the archive where a removed site
 * went; the dropdown survives only behind a row's Change button.
 *
 * The /app layout already guards the session; this RSC reads the caller's OWN keys, projects,
 * mappings and accounts through their authenticated client (RLS owner-SELECT). All mutations
 * live in the server actions, and the client islands hold no state the database does not
 * already own. Only the MASKED MCP URL is ever shown here.
 */
export default async function ConnectionPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackError = CALLBACK_ERRORS.get(firstValue(params.error) ?? "");
  // Truthiness, not mere presence: `?connected=` with an EMPTY value is not an account id, and
  // announcing a stored account from it would be a success message with nothing behind it.
  const connected = Boolean(firstValue(params.connected));

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
    : [[] as ProjectRow[], [] as ConnectedAccount[]];
  const options = propertyOptions(accounts);
  // ONE tracked group and ONE archive for the whole page. `groupConnectionRows` is scoped to a
  // single account and neither group depends on one, so calling it per account would repeat
  // every row N times; the account-shaped arguments are empty here and the library, which DOES
  // depend on the account, is taken per account in `libraryAccountsFor`.
  const groups = groupConnectionRows({ projects, sites: [], accountId: "" });
  // Whether EVERY account actually answered `sites.list`. The same refusal `retainedMappingFor`
  // and `missingPropertyFor` already make: a failed read is not an empty one, so "none of them
  // lists a property" may only be said when nothing was left unread.
  const listingComplete = accounts.every((account) => account.sites !== null);
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
        {/* The only place the user learns what removing a site does, so it says what the
            actions actually do and nothing more. It used to promise a revoke at Google; since
            the credential moved to the ACCOUNT (0021) no per-project control performs one. */}
        <p className="text-sm text-neutral-600">
          Link a project to Search Console so its tools can read your real query and click
          data. Connecting sends you to Google and back. Removing a site archives it — its
          history and its Search Console property are kept, so bringing it back costs one
          click. Removing a site does not revoke SeoGrep&apos;s access to your Google account,
          so your other projects keep working; to drop that access altogether, use Disconnect
          next to the Google account under Connected Google accounts below.
        </p>

        <h3 className="text-sm font-medium text-neutral-700">Connected Google accounts</h3>
        <AccountDisconnectPanel
          accounts={accounts.map((account) => ({ id: account.id, email: account.email }))}
          describeDisconnect={describeDisconnect}
          disconnectAccount={disconnectAccount}
        />
        {/* Said ONCE, by the page: the state belongs to the account list, not to any project.
            Every project row used to say it, so nine projects meant nine copies. TWO sentences,
            because "no account is connected" is strictly narrower than "nothing to pick":
            connecting the WRONG Google account reaches the other half, where the first is false
            and the amber warning stays silent (it wants a FAILED read, not an empty one). */}
        {accounts.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Connect a Google account to choose which Search Console property each project
            reads. Your projects stay exactly as they are — crawls and audits do not need it.
          </p>
        ) : options.length === 0 && listingComplete ? (
          <p className="text-sm text-neutral-600">
            None of your connected Google accounts lists a Search Console property, so there is
            nothing for a project to read yet. Verify a property in Search Console, or connect a
            different Google account.
          </p>
        ) : null}
        {/* A plain <a>: this route mints a signed state and 302s to Google, and next/link
            would prefetch it and start the flow. Unconditional — with no accounts it is the
            only way to connect one, and it is the repair the amber warning points at. */}
        <a
          href={GSC_CONNECT_PATH}
          className="self-start rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Connect Google account
        </a>
        {accounts.some((account) => account.sites === null) ? (
          <p role="alert" className="text-sm text-amber-700">
            We could not read the Search Console properties on at least one of these accounts.
            Use Connect Google account to grant access again, or try again shortly.
          </p>
        ) : null}

        {/* One search box for all three groups (design §3). It wraps them rather than sitting
            beside them because the query has to reach every group AND past the library's fold:
            the user asking "where is that site?" does not know which group holds it. */}
        <ConnectionFilter>
          <TrackedProjects
            rows={trackedRowsFor(groups.tracked, projects, accounts, options)}
            trackProperty={trackProperty}
            untrackProject={untrackProject}
          />
          <PropertyLibrary
            accounts={libraryAccountsFor(accounts, projects)}
            trackProperty={trackProperty}
          />
          <ArchiveList rows={groups.archived} restoreProject={restoreProject} />
        </ConnectionFilter>
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
