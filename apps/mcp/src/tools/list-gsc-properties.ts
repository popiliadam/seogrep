import { z } from "zod";
import {
  canQuerySearchAnalytics,
  decryptToken,
  fromByteaHex,
  listSites,
  refreshAccessToken,
  type GscSite,
} from "@pseo/core";
import { forUser, getServiceClient } from "../db.ts";
import { requireTokenEncryptionKey } from "../env.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";

/**
 * list_gsc_properties — what the connected Google accounts can actually reach, and what reads
 * it. 0 credits: it calls no paid API and never touches the ledger.
 *
 * Until now this inventory existed ONLY on /app/connection, so an MCP client could not answer
 * "why is my property missing?" at all. Three rules are carried over from that page rather than
 * re-decided here, because a second answer to the same question is a second truth:
 *
 *   1. A FAILED `sites.list` is never rendered as an empty list. An absence we did not observe
 *      is not an absence (AccountInventory's own words) — the account is reported unreadable.
 *   2. An UNUSABLE property is SHOWN, with its permission level and the reason. Hiding it
 *      leaves the user comparing this list against Search Console and finding a hole; the
 *      permission rule itself comes from @pseo/core's canQuerySearchAnalytics, never re-derived.
 *   3. "Read by" is filtered by ACCOUNT as well as property string (inventoryRows): the same
 *      property can sit on two Google accounts and a project reads it through exactly one, so
 *      an unfiltered match would tell the user their data comes from somewhere it does not.
 *
 * Every read is tenant-scoped through forUser (constitution NEVER #4), so another tenant's
 * account is indistinguishable from no account at all. Google is reached through an injected
 * port, so tests run with zero network (NEVER #5).
 */

/** One connected Google account, as this tool names it. */
export interface GscAccountSummary {
  readonly id: string;
  readonly email: string;
}

/** A project and the mapping it holds: which account it reads through, and which property. */
export interface ProjectPropertyMapping {
  readonly domain: string;
  readonly accountId: string | null;
  readonly property: string | null;
}

/** The caller's connected Google accounts (tenant-scoped). */
export type LoadGscAccountsFn = (userId: string) => Promise<GscAccountSummary[]>;

/** The caller's active projects with their stored mapping (tenant-scoped). */
export type LoadProjectMappingsFn = (userId: string) => Promise<ProjectPropertyMapping[]>;

/** `sites.list` for ONE account of ONE tenant. Throws when the account cannot be read. */
export type ListAccountSitesFn = (accountId: string, userId: string) => Promise<GscSite[]>;

export interface ListGscPropertiesDeps {
  readonly loadAccounts?: LoadGscAccountsFn;
  readonly loadMappings?: LoadProjectMappingsFn;
  readonly listAccountSites?: ListAccountSitesFn;
}

/** Accounts, ordered by email so the output does not depend on scan order. */
export const loadGscAccounts: LoadGscAccountsFn = async (userId) => {
  const { data, error } = await forUser(getServiceClient(), userId).selectOwn(
    "gsc_accounts",
    "id, google_account_email",
  );
  if (error) {
    throw new Error(`gsc_accounts lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { id: string; google_account_email: string }[];
  return [...rows]
    .sort((a, b) => a.google_account_email.localeCompare(b.google_account_email))
    .map((row) => ({ id: row.id, email: row.google_account_email }));
};

/**
 * Projects + their `gsc_connections` mapping, joined in memory. ARCHIVED projects are left out
 * for the same reason list_projects hides them: the tenant stopped tracking them, so they are
 * not part of "what reads this property".
 *
 * EXPORTED SO ITS TENANT FILTER CAN BE MEASURED, which through the tool it cannot be. `readBy`
 * only ever matches a mapping whose `accountId` is one of the rendered accounts, and those come
 * from `loadGscAccounts` — already tenant-scoped — so an UNFILTERED read here loads every
 * tenant's projects and then silently discards them: the tool's output is byte-identical and
 * every spec stays green. The guard is real, the leak it prevents is real, and the only place
 * either is visible is head-on (signed lesson 14 / the untrack-project.db.test.ts pattern).
 */
export const defaultLoadMappings: LoadProjectMappingsFn = async (userId) => {
  const tenant = forUser(getServiceClient(), userId);
  const [projects, connections] = await Promise.all([
    tenant.selectOwn("projects", "id, domain").is("archived_at", null),
    tenant.selectOwn("gsc_connections", "project_id, account_id, gsc_property"),
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
  return [...rows]
    .sort((a, b) => a.domain.localeCompare(b.domain))
    .map((row) => ({
      domain: row.domain,
      accountId: mappings.get(row.id)?.account_id ?? null,
      property: mappings.get(row.id)?.gsc_property ?? null,
    }));
};

/**
 * The real listing: open the account's sealed refresh token, mint an access token, ask Google.
 * The row read is filtered by (id, user_id) — service_role bypasses RLS, so that filter is the
 * only tenant guard on the table holding every Google credential (NEVER #4). Nothing is cached:
 * a stale property list is worse than a slow one, and a dead credential SHOULD fail here — that
 * failure is the most useful thing this tool can report about an account.
 */
export const listAccountSitesFor: ListAccountSitesFn = async (accountId, userId) => {
  const row = await forUser(getServiceClient(), userId).selectOwnById<{
    encrypted_refresh_token: string;
  }>("gsc_accounts", accountId, "encrypted_refresh_token");
  if (!row) {
    throw new Error(`gsc_accounts: no account ${accountId} for this user`);
  }
  const refreshToken = decryptToken(
    fromByteaHex(row.encrypted_refresh_token),
    requireTokenEncryptionKey(),
    { userId, accountId },
  );
  const { accessToken } = await refreshAccessToken(refreshToken);
  return listSites(accessToken);
};

/** The domains reading `siteUrl` THROUGH `accountId` — never through a namesake elsewhere. */
function readBy(
  mappings: readonly ProjectPropertyMapping[],
  accountId: string,
  siteUrl: string,
): string[] {
  return mappings
    .filter((mapping) => mapping.accountId === accountId && mapping.property === siteUrl)
    .map((mapping) => mapping.domain);
}

/** One property line: what it is, what SeoGrep may do with it, and who reads it. */
function renderSite(
  site: GscSite,
  mappings: readonly ProjectPropertyMapping[],
  accountId: string,
): string {
  const readers = readBy(mappings, accountId, site.siteUrl);
  const usage = readers.length > 0 ? `read by ${readers.join(", ")}` : "not used by any project";
  const note = canQuerySearchAnalytics(site.permissionLevel)
    ? ""
    : " — NOT QUERYABLE: SeoGrep cannot read Search Console data at this permission level";
  return `  - ${site.siteUrl} (${site.permissionLevel}) — ${usage}${note}`;
}

/** One account block. `sites === null` means the listing FAILED, not that it is empty. */
function renderAccount(
  account: GscAccountSummary,
  sites: readonly GscSite[] | null,
  mappings: readonly ProjectPropertyMapping[],
): string {
  const header = `${account.email} (account_id: ${account.id})`;
  if (sites === null) {
    return (
      `${header}\n  This account's Search Console properties could not be read just now, so ` +
      "what it can reach is unknown. Try again shortly, or reconnect the account on the " +
      "Connection page."
    );
  }
  if (sites.length === 0) {
    return `${header}\n  No Search Console properties on this account.`;
  }
  return `${header}\n${sites.map((site) => renderSite(site, mappings, account.id)).join("\n")}`;
}

const EMPTY =
  "No Google account is connected yet, so there are no Search Console properties to list. " +
  "Run connect_gsc for one of your projects to connect one.";

/** The remedy, printed ONCE and only when at least one property actually needs it. */
const UNQUERYABLE_FOOTER =
  'A property marked "NOT QUERYABLE" stays visible on purpose: it exists in Search Console, but ' +
  "this Google account may not read its performance data. Verify the property in Search " +
  "Console, or ask one of its owners to grant this account access.";

/**
 * Build the tool. All I/O is injectable, so the fast-lane spec drives it with zero network and
 * zero database.
 */
export function makeListGscPropertiesTool(deps: ListGscPropertiesDeps = {}): RegisteredTool {
  const loadAccounts = deps.loadAccounts ?? loadGscAccounts;
  const loadMappings = deps.loadMappings ?? defaultLoadMappings;
  const listAccountSites = deps.listAccountSites ?? listAccountSitesFor;
  return defineTool({
    name: "list_gsc_properties",
    description:
      "List the Search Console properties on your connected Google accounts: permission level, " +
      "whether SeoGrep can query each one, and which project reads it. Costs 0 credits.",
    inputSchema: z.object({}),
    handler: async (ctx) => {
      const [accounts, mappings] = await Promise.all([
        loadAccounts(ctx.userId),
        loadMappings(ctx.userId),
      ]);
      if (accounts.length === 0) {
        return textResult(EMPTY);
      }
      const blocks = await Promise.all(
        accounts.map(async (account) => {
          // ONE unreadable account never costs the user the other accounts' inventories — and
          // it is reported as unreadable rather than as empty (rule 1 in the header).
          let sites: GscSite[] | null = null;
          try {
            sites = [...(await listAccountSites(account.id, ctx.userId))];
          } catch (error) {
            console.error(
              `list_gsc_properties: sites.list failed for account ${account.id}:`,
              error,
            );
          }
          return { sites, text: renderAccount(account, sites, mappings) };
        }),
      );
      const needsFooter = blocks.some((block) =>
        (block.sites ?? []).some((site) => !canQuerySearchAnalytics(site.permissionLevel)),
      );
      const body = `Search Console properties on your connected Google account(s):\n\n${blocks
        .map((block) => block.text)
        .join("\n\n")}`;
      return textResult(needsFooter ? `${body}\n\n${UNQUERYABLE_FOOTER}` : body);
    },
  });
}

/** The production list_gsc_properties tool (real DB + Google client). */
export const listGscPropertiesTool = makeListGscPropertiesTool();
